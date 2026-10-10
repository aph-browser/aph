/* Aph Stash — window-side controller (chrome window).
 *
 * One place to put tabs aside and bring them back intact, in two flavors:
 *
 * 1. Stashed tabs (swept singles): stashing closes the tab(s) and stores
 *    title, URL, workspace, container and time in a capped JSON pref
 *    (newest-first, FIFO at 300). The Stash page
 *    (chrome://browser/content/aph-stash.html) browses/restores them with
 *    full context (workspace + container).
 *
 * 2. Workspace stashes (snapshots): saveStash captures one whole workspace
 *    as a named set of restorable tabs (aph.stash.snapshots pref, separate caps
 *    for manual vs auto captures). Restore is append-only — it never
 *    closes anything.
 *
 * Entry points: tab context menu ("Stash Tab(s)"), the command palette
 * ("Stash Current Tab" / "Stash Current Workspace…" / "Open Stash"), and
 * the Stash page. Automatic stashing (opt-in via aph.stash.autoEnabled,
 * default off) sweeps eligible hidden-workspace tabs 15 s after each
 * workspace switch — each switch re-arms the settle timer, so the sweep
 * only fires once you've sat still (see scheduleAutoStashSweep). Restore
 * removes the entry (Shift+click keeps it); delete drops it without
 * opening. Snapshot automation (aph.stash.snapshots.autoEnabled,
 * default on; cadence aph.stash.snapshots.intervalMin; bulk-close
 * threshold aph.stash.safetyMin — all three in Aph Settings under
 * Stash) covers the heartbeat capture of changed workspaces, the safety
 * capture before a bulk workspace close, and the shutdown capture on
 * window unload.
 *
 * Pref keys live under aph.stash.*. Profiles created before the
 * rename ("Stash" everywhere user-facing) may still hold the previous
 * aph.archive.* / aph.snapshots keys — the loaders below read those as
 * a fallback once and adopt the data forward (write new key, clear old),
 * so nothing stashed is ever stranded. Everything user-facing reads
 * "Stash".
 *
 * Page bridge: the Stash page runs in a content process, so it reads the
 * pref directly (Services is available to system-principal chrome pages)
 * and asks for restores via the "aph-stash-restore" observer topic with
 * {contextId, id, keep, kind}. Only the window owning that browsing context
 * acts (matched by linkedBrowser.browsingContext.id); it answers on
 * "aph-stash-result" so the page can confirm. Observer registrations are
 * released on unload (same discipline as workspaces.js cleanupWindowObservers).
 *
 * Injected into browser.xhtml via rebrand.py (after stash-shared.js).
 */
(function () {
  if (window.__aphStashLoaded) {
    return;
  }
  window.__aphStashLoaded = true;

  const PREF = "aph.stash.tabs";
  const OBS_RESTORE = "aph-stash-restore";
  const OBS_RESULT = "aph-stash-result";
  const STASH_URL = "chrome://browser/content/aph-stash.html";
  const TOAST_MS = 2400;

  // Pre-rename keys (one-time migration source only — never written).
  // A profile that stashed under the old names adopts forward on first
  // read: the new key is written and the old one best-effort cleared.
  const OLD_PREF = "aph.archive.tabs";
  const OLD_AUTO_PREF = "aph.archive.autoEnabled";
  const OLD_STALE_PREF = "aph.archive.autoStaleMin";
  const OLD_SNAP_PREF = "aph.snapshots";
  const OLD_SNAP_AUTO_PREF = "aph.snapshots.autoEnabled";
  const OLD_STASH_URL = "chrome://browser/content/aph-archive.html";
  let migratedEntries = false;
  let migratedStashes = false;

  function clearPref(pref) {
    try {
      if (Services.prefs && typeof Services.prefs.clearUserPref === "function") {
        Services.prefs.clearUserPref(pref);
      }
    } catch (e) {}
  }

  function readBoolPref(pref, fallbackPref, def) {
    try {
      if (Services.prefs && typeof Services.prefs.getBoolPref === "function") {
        try {
          return !!Services.prefs.getBoolPref(pref);
        } catch (e) {}
        if (fallbackPref) {
          try {
            return !!Services.prefs.getBoolPref(fallbackPref);
          } catch (_e) {}
        }
      }
    } catch (e) {}
    return def;
  }

  function readIntPref(pref, fallbackPref, def) {
    try {
      if (Services.prefs && typeof Services.prefs.getIntPref === "function") {
        try {
          const m = Services.prefs.getIntPref(pref);
          if (Number.isFinite(m)) {
            return m;
          }
        } catch (e) {}
        if (fallbackPref) {
          try {
            const m = Services.prefs.getIntPref(fallbackPref);
            if (Number.isFinite(m)) {
              return m;
            }
          } catch (_e) {}
        }
      }
    } catch (e) {}
    return def;
  }

  let toastTimer = null;
  let cache = null; // null = not yet read (or invalidated by pref observer)
  let menuItem = null;
  let prefsObserver = null;

  function ws() {
    try {
      return window.AphWorkspaces || null;
    } catch (e) {
      return null;
    }
  }

  function logic() {
    try {
      return window.AphStashLogic || null;
    } catch (e) {
      return null;
    }
  }

  // Private windows never stash (fail open when the service is missing —
  // stashing is the safe direction; the page/restore path re-checks nothing).
  let PB = null;
  try {
    ({ PrivateBrowsingUtils: PB } = ChromeUtils.importESModule(
      "resource://gre/modules/PrivateBrowsingUtils.sys.mjs"
    ));
  } catch (e) {}

  function isPrivateWindow() {
    try {
      return !!(PB && PB.isWindowPrivate(window));
    } catch (e) {
      return false;
    }
  }

  function loadEntries() {
    if (cache) {
      return cache;
    }
    cache = [];
    try {
      let raw = "";
      try {
        raw = Services.prefs.getStringPref(PREF, "") || "";
      } catch (e) {
        raw = "";
      }
      let fromLegacy = false;
      if (!raw) {
        try {
          raw = Services.prefs.getStringPref(OLD_PREF, "") || "";
          fromLegacy = !!raw;
        } catch (e) {
          raw = "";
        }
      }
      if (raw) {
        const arr = JSON.parse(raw);
        const L = logic();
        cache = L ? L.sanitizeEntries(arr) : [];
        // Adopt pre-rename data forward exactly once (see header).
        if (fromLegacy && !migratedEntries) {
          migratedEntries = true;
          try {
            Services.prefs.setStringPref(PREF, JSON.stringify(cache));
          } catch (e) {}
          clearPref(OLD_PREF);
        }
      }
    } catch (e) {
      cache = [];
    }
    return cache;
  }

  function saveEntries(list) {
    const L = logic();
    const pruned = L ? L.pruneEntries(list) : (list || []).slice(0, 300);
    cache = pruned;
    try {
      Services.prefs.setStringPref(PREF, JSON.stringify(pruned));
    } catch (e) {}
    clearPref(OLD_PREF);
  }

  function tabUrl(tab) {
    try {
      return tab.linkedBrowser?.currentURI?.spec || "";
    } catch (e) {
      return "";
    }
  }

  function isStashable(tab) {
    try {
      if (!tab || tab.closing) {
        return false;
      }
      if (isPrivateWindow()) {
        return false;
      }
      const url = tabUrl(tab);
      const L = logic();
      return L ? L.isArchivableUrl(url) : /^https?:\/\//i.test(url);
    } catch (e) {
      return false;
    }
  }

  function normalizeEntry(tab) {
    try {
      const w = ws();
      const url = tabUrl(tab);
      if (!url) {
        return null;
      }
      let wsId = "1";
      try {
        if (w && w.getWs) {
          const g = w.getWs(tab);
          if (typeof g === "string" && /^[1-9]$/.test(g)) {
            wsId = g;
          }
        }
      } catch (e) {}
      let cid = 0;
      try {
        cid = tab.userContextId || 0;
      } catch (e) {}
      let cname = "";
      try {
        if (w && cid && w.describeContainer) {
          const d = w.describeContainer(cid);
          if (d && d.name) {
            cname = d.name;
          }
        }
      } catch (e) {}
      let title = "";
      try {
        title = tab.label || "";
      } catch (e) {}
      let favicon = "";
      try {
        if (typeof tab.image === "string" && tab.image.length <= 8192) {
          favicon = tab.image;
        }
      } catch (e) {}
      const L = logic();
      return {
        id: `${Date.now().toString(36)}-${Math.floor(Math.random() * 0xffffff).toString(36)}`,
        title: title || url,
        url,
        host: L ? L.hostOfUrl(url) : "",
        ws: wsId,
        cid,
        cname,
        favicon,
        ts: Date.now(),
      };
    } catch (e) {
      return null;
    }
  }

  // Clicked tab wins; when it belongs to a multiselection the whole
  // selection goes. Null (palette path) stashes the current selection.
  function resolveTargets(clicked) {
    let tabs = [];
    try {
      const multi = gBrowser.selectedTabs || gBrowser.multiselectedTabs || [];
      if (clicked) {
        tabs = multi.includes(clicked) && multi.length > 1 ? [...multi] : [clicked];
      } else if (multi.length) {
        tabs = [...multi];
      } else if (gBrowser.selectedTab) {
        tabs = [gBrowser.selectedTab];
      }
    } catch (e) {
      tabs = [];
    }
    return tabs.filter((t) => t && !t.closing);
  }

  function stashTabs(tabs) {
    let list = [];
    try {
      list = (tabs || []).filter(isStashable);
    } catch (e) {
      list = [];
    }
    if (!list.length) {
      toast("Nothing stashable here");
      return 0;
    }
    const entries = list.map(normalizeEntry).filter((e) => e && e.url);
    if (!entries.length) {
      return 0;
    }
    saveEntries([...entries, ...loadEntries()]);
    // Close unselected tabs first so the selection (and its workspace
    // bookkeeping) stays sane while the sweep runs.
    let sel = null;
    try {
      sel = gBrowser.selectedTab;
    } catch (e) {}
    const ordered = [...list].sort((a, b) => (a === sel ? 1 : b === sel ? -1 : 0));
    for (const t of ordered) {
      try {
        gBrowser.removeTab(t, { animate: false });
      } catch (e) {
        try {
          gBrowser.removeTab(t);
        } catch (_e) {}
      }
    }
    toast(`Stashed ${entries.length} tab${entries.length === 1 ? "" : "s"}`);
    return entries.length;
  }

  function stashTab(tab) {
    return stashTabs(resolveTargets(tab || null));
  }

  function stashCurrent() {
    return stashTabs(resolveTargets(null));
  }

  // Palette label helper: "Stash Current Tab" or "Stash N Tabs".
  function pendingStashCount() {
    try {
      return resolveTargets(null).filter(isStashable).length;
    } catch (e) {
      return 0;
    }
  }

  // Automatic stashing (V1): opt-in via aph.stash.autoEnabled (default
  // off). Fires once the settle timer (≈15 s of sitting still) goes off:
  // stashes every eligible tab in HIDDEN workspaces — "everything I'm not
  // looking at gets put away" — except tabs viewed within the staleness
  // threshold (below). Guards mirror canUnloadTab's fail-closed shape
  // (selected/pinned/audible/loading/unsaved never auto-close) plus the
  // archivable check; starred tabs are user-marked keepers and stay too.
  // Closes via stashTabs, so entries land newest-first under the shared
  // cap and the toast is the feedback.
  const AUTO_PREF = "aph.stash.autoEnabled";

  function getAutoEnabled() {
    return readBoolPref(AUTO_PREF, OLD_AUTO_PREF, false);
  }

  // Staleness threshold: minutes (pref aph.stash.autoStaleMin, default
  // 5), read live so about:config flips apply to the next sweep. Any
  // failure reads as the default; compared in ms at the filter below.
  const AUTO_STALE_PREF = "aph.stash.autoStaleMin";
  const AUTO_STALE_DEFAULT_MIN = 5;

  function getStaleThresholdMs() {
    return readIntPref(AUTO_STALE_PREF, OLD_STALE_PREF, AUTO_STALE_DEFAULT_MIN) * 60000;
  }

  // Last-viewed read for staleness: SessionStore custom tab value
  // "aphLastViewed" (ms epoch, written by the workspaces bundle on
  // TabSelect/TabOpen — key duplicated here by design, same pattern as
  // "aphStarred"). Missing/unreadable/malformed reads as 0 (epoch):
  // untracked tabs count as stale.
  const LAST_VIEWED_KEY = "aphLastViewed";

  function readLastViewed(tab) {
    try {
      if (SessionStore && typeof SessionStore.getCustomTabValue === "function") {
        const v = SessionStore.getCustomTabValue(tab, LAST_VIEWED_KEY);
        const n = typeof v === "string" || typeof v === "number" ? Number(v) : NaN;
        if (Number.isFinite(n) && n > 0) {
          return n;
        }
      }
    } catch (e) {}
    return 0;
  }

  function isAutoEligible(tab) {
    try {
      if (!tab || tab.closing) {
        return false;
      }
      // SessionStore owns restoring tabs (workspace tag + last-viewed
      // unsettled): never auto-close. A tagless restored tab defaults to
      // WS1 via getWs, so without this the sweep would absorb pages from
      // other workspaces mid-restore (same hazard as closeWorkspaceTabs).
      try {
        if (
          typeof SessionStore !== "undefined" &&
          SessionStore &&
          typeof SessionStore.isTabRestoring === "function" &&
          SessionStore.isTabRestoring(tab)
        ) {
          return false;
        }
      } catch (e) {}
      try {
        if (tab.selected) {
          return false;
        }
      } catch (e) {}
      try {
        if (gBrowser.selectedTab === tab) {
          return false;
        }
      } catch (e) {}
      try {
        if (tab.pinned) {
          return false;
        }
      } catch (e) {}
      try {
        if (typeof tab.hasAttribute === "function" && tab.hasAttribute("data-aph-starred")) {
          return false;
        }
      } catch (e) {}
      try {
        if (tab.soundPlaying || tab.audible) {
          return false;
        }
      } catch (e) {}
      try {
        if (tab.busy) {
          return false;
        }
      } catch (e) {}
      try {
        if (tab.linkedBrowser?.frameLoader?.tabParent?.hasBeforeUnload) {
          return false;
        }
      } catch (e) {}
      // Unloaded/pending tabs haven't committed a URL yet (lazy restore,
      // discard): their blank face may be transient, and auto-closing them
      // destroys unloaded state. Same rule as the unload + prune guards.
      try {
        if (typeof tab.hasAttribute === "function" && tab.hasAttribute("pending")) {
          return false;
        }
      } catch (e) {}
      // Staleness: viewed within the threshold → spared.
      try {
        if (Date.now() - readLastViewed(tab) < getStaleThresholdMs()) {
          return false;
        }
      } catch (e) {}
      return isStashable(tab);
    } catch (e) {
      return false;
    }
  }

  // Settle delay (the time-based foundation): the switch hook does not
  // sweep instantly — it arms this, and every further switch re-arms it,
  // so the sweep only fires once you've sat on one workspace for the full
  // delay. Guards + the hidden set re-check at fire time, so a stale timer
  // can never close a tab you came back to.
  const AUTO_DELAY_MS = 15000;
  let autoTimer = null;

  // (Re-)arm the settle timer. Disabling the pref disarms a pending sweep.
  // True when a sweep is now pending, false otherwise.
  function scheduleAutoStashSweep() {
    try {
      if (autoTimer !== null && autoTimer !== undefined) {
        try {
          clearTimeout(autoTimer);
        } catch (e) {}
        autoTimer = null;
      }
      if (!getAutoEnabled()) {
        return false;
      }
      autoTimer = setTimeout(() => {
        autoTimer = null;
        try {
          autoStashSweep();
        } catch (e) {}
      }, AUTO_DELAY_MS);
      return autoTimer !== null && autoTimer !== undefined;
    } catch (e) {
      return false;
    }
  }

  function autoStashSweep() {
    try {
      if (!getAutoEnabled()) {
        return 0;
      }
      // Without the workspaces API the current workspace is unknowable —
      // fail closed rather than risk closing visible tabs.
      const w = ws();
      let cur = null;
      try {
        cur = w && w.getCurrent ? w.getCurrent() : null;
      } catch (e) {}
      if (!w || !cur) {
        return 0;
      }
      let tabs = [];
      try {
        tabs = Array.from(gBrowser.tabs || []);
      } catch (e) {
        return 0;
      }
      const list = tabs.filter((t) => {
        try {
          if (w.getWs(t) === cur) {
            return false;
          }
        } catch (e) {}
        return isAutoEligible(t);
      });
      if (!list.length) {
        return 0;
      }
      return stashTabs(list);
    } catch (e) {
      return 0;
    }
  }

  // Stored container may be gone (deleted, or a temp container cleaned up
  // after its last tab closed) — fall back to unbound rather than failing.
  function validCid(cid) {
    try {
      const w = ws();
      if (!cid || !w || !w.describeContainer) {
        return 0;
      }
      return w.describeContainer(cid) ? cid : 0;
    } catch (e) {
      return 0;
    }
  }

  function restoreStashEntry(id, opts) {
    const keep = !!(opts && opts.keep);
    try {
      const entries = loadEntries();
      const i = entries.findIndex((e) => e && e.id === id);
      if (i === -1) {
        return { ok: false, reason: "missing" };
      }
      const entry = entries[i];
      const w = ws();
      const target =
        typeof entry.ws === "string" && /^[1-9]$/.test(entry.ws) ? entry.ws : null;
      const cid = validCid(entry.cid);
      let tab = null;
      try {
        if (w && w.openInWorkspace) {
          tab = w.openInWorkspace(entry.url, target, cid);
        } else {
          tab = gBrowser.addTrustedTab(entry.url);
        }
      } catch (e) {
        tab = null;
      }
      if (!tab) {
        return { ok: false, reason: "open-failed" };
      }
      if (!keep) {
        entries.splice(i, 1);
        saveEntries(entries);
      }
      // Pull the window along when the entry belongs elsewhere, then land
      // selection on the restored tab (switchTo alone focuses MRU/first).
      try {
        if (w && w.getCurrent && w.switchTo && target && target !== w.getCurrent()) {
          w.switchTo(target);
        }
      } catch (e) {}
      try {
        gBrowser.showTab(tab);
      } catch (e) {}
      try {
        gBrowser.selectedTab = tab;
      } catch (e) {}
      return { ok: true };
    } catch (e) {
      return { ok: false, reason: "error" };
    }
  }

  function deleteStashEntry(id) {
    try {
      const entries = loadEntries();
      const i = entries.findIndex((e) => e && e.id === id);
      if (i === -1) {
        return false;
      }
      entries.splice(i, 1);
      saveEntries(entries);
      return true;
    } catch (e) {
      return false;
    }
  }

  function getStashEntries() {
    try {
      return loadEntries().slice();
    } catch (e) {
      return [];
    }
  }

  // Reuse one stash page tab per window instead of stacking duplicates.
  // A tab left on the pre-rename page URL is pointed at the new URL
  // instead of stranding a dead page after the upgrade.
  function openStash() {
    try {
      for (const t of Array.from(gBrowser.tabs || [])) {
        try {
          if (!t.closing && tabUrl(t) === STASH_URL) {
            gBrowser.selectedTab = t;
            return true;
          }
          if (!t.closing && tabUrl(t) === OLD_STASH_URL) {
            try {
              if (
                t.linkedBrowser &&
                typeof t.linkedBrowser.loadURI === "function" &&
                Services.scriptSecurityManager &&
                typeof Services.scriptSecurityManager.getSystemPrincipal === "function"
              ) {
                t.linkedBrowser.loadURI(STASH_URL, {
                  triggeringPrincipal:
                    Services.scriptSecurityManager.getSystemPrincipal(),
                });
              }
            } catch (e) {}
            try {
              gBrowser.selectedTab = t;
            } catch (e) {}
            return true;
          }
        } catch (e) {}
      }
    } catch (e) {}
    try {
      const t = gBrowser.addTrustedTab(STASH_URL);
      gBrowser.selectedTab = t;
      return true;
    } catch (e) {
      return false;
    }
  }

  // ---------------------------------------------------------------- snapshots
  // Workspace stashes. Second store, same discipline as the per-tab one
  // above: lazy cache + pref observer invalidation + fail-silent helpers,
  // plus the same one-time pre-rename adoption (aph.snapshots).
  const SNAP_PREF = "aph.stash.snapshots";
  const SNAP_AUTO_PREF = "aph.stash.snapshots.autoEnabled";
  const SNAP_INTERVAL_PREF = "aph.stash.snapshots.intervalMin";
  const SNAP_INTERVAL_DEFAULT_MIN = 30;
  // Bulk-close safety threshold (doomed tabs at or above this auto-stash
  // first). Tunable live; the dock reads it through safetyThreshold().
  const SNAP_SAFETY_PREF = "aph.stash.safetyMin";
  const SNAP_SAFETY_DEFAULT_MIN = 3;
  const SNAP_SAFETY_MIN_MIN = 1;
  const SNAP_SAFETY_MAX_MIN = 9;
  // Tiered autos retention (global): newest maxAuto recents plus newest
  // one per calendar day for keepDailies days. Manuals stay flat 20.
  const SNAP_MAX_AUTO_PREF = "aph.stash.snapshots.maxAuto";
  const SNAP_DAILIES_PREF = "aph.stash.snapshots.keepDailies";
  // Sweeper heartbeat. Short enough that cadence flips apply within
  // minutes without timer surgery; each fire is a cheap URL-set compare
  // and captures only due-and-changed workspaces (often nothing).
  const SNAP_TICK_MS = 5 * 60 * 1000;
  // A capture must differ from the last auto capture to be worth storing.
  // Compared as a sorted URL set: titles churn, URLs don't.
  let snapCache = null; // null = not yet read (or invalidated by pref observer)
  let snapPrefsObserver = null;
  let snapIntervalId = null;

  function getSnapAutoEnabled() {
    // Default ON when absent: capturing is cheap, bounded, and
    // append-only to restore — the safer direction when unsure.
    return readBoolPref(SNAP_AUTO_PREF, OLD_SNAP_AUTO_PREF, true);
  }

  function getSnapIntervalMin() {
    const L = logic();
    const fallback = L && Number.isInteger(L.SNAP_INTERVAL_DEFAULT_MIN)
      ? L.SNAP_INTERVAL_DEFAULT_MIN
      : SNAP_INTERVAL_DEFAULT_MIN;
    try {
      const v = readIntPref(SNAP_INTERVAL_PREF, "", fallback);
      if (L && typeof L.clampSnapIntervalMin === "function") {
        return L.clampSnapIntervalMin(v);
      }
      const n = Number(v);
      return Number.isFinite(n)
        ? Math.min(240, Math.max(5, Math.floor(n)))
        : fallback;
    } catch (e) {
      return fallback;
    }
  }

  function clampSafetyMin(m) {
    try {
      const n = Number(m);
      if (Number.isFinite(n)) {
        return Math.min(
          SNAP_SAFETY_MAX_MIN,
          Math.max(SNAP_SAFETY_MIN_MIN, Math.floor(n))
        );
      }
    } catch (e) {}
    return SNAP_SAFETY_DEFAULT_MIN;
  }

  // Live bulk-close threshold for the dock (no legacy key ever existed).
  function safetyThreshold() {
    try {
      return clampSafetyMin(readIntPref(SNAP_SAFETY_PREF, "", SNAP_SAFETY_DEFAULT_MIN));
    } catch (e) {
      return SNAP_SAFETY_DEFAULT_MIN;
    }
  }

  function getMaxAuto() {
    const L = logic();
    const fallback = L && Number.isInteger(L.SNAP_MAX_AUTO) ? L.SNAP_MAX_AUTO : 10;
    try {
      const v = readIntPref(SNAP_MAX_AUTO_PREF, "", fallback);
      if (L && typeof L.clampMaxAuto === "function") {
        return L.clampMaxAuto(v);
      }
      const n = Number(v);
      return Number.isFinite(n) ? Math.min(50, Math.max(1, Math.floor(n))) : fallback;
    } catch (e) {
      return fallback;
    }
  }

  function getKeepDailies() {
    const L = logic();
    const fallback = L && Number.isInteger(L.SNAP_KEEP_DAILIES_DEFAULT)
      ? L.SNAP_KEEP_DAILIES_DEFAULT
      : 7;
    try {
      const v = readIntPref(SNAP_DAILIES_PREF, "", fallback);
      if (L && typeof L.clampKeepDailies === "function") {
        return L.clampKeepDailies(v);
      }
      const n = Number(v);
      return Number.isFinite(n) ? Math.min(30, Math.max(0, Math.floor(n))) : fallback;
    } catch (e) {
      return fallback;
    }
  }

  function loadStashes() {
    if (snapCache) {
      return snapCache;
    }
    snapCache = [];
    try {
      let raw = "";
      try {
        raw = Services.prefs.getStringPref(SNAP_PREF, "") || "";
      } catch (e) {
        raw = "";
      }
      let fromLegacy = false;
      if (!raw) {
        try {
          raw = Services.prefs.getStringPref(OLD_SNAP_PREF, "") || "";
          fromLegacy = !!raw;
        } catch (e) {
          raw = "";
        }
      }
      if (raw) {
        const arr = JSON.parse(raw);
        const L = logic();
        snapCache = L ? L.sanitizeSnapshots(arr) : [];
        if (fromLegacy && !migratedStashes) {
          migratedStashes = true;
          try {
            Services.prefs.setStringPref(SNAP_PREF, JSON.stringify(snapCache));
          } catch (e) {}
          clearPref(OLD_SNAP_PREF);
        }
      }
    } catch (e) {
      snapCache = [];
    }
    return snapCache;
  }

  function saveStashes(list) {
    const L = logic();
    let pruned = null;
    try {
      if (L && typeof L.pruneSnapshotsTiered === "function") {
        pruned = L.pruneSnapshotsTiered(list, getMaxAuto(), getKeepDailies(), Date.now());
      } else if (L) {
        pruned = L.pruneSnapshots(list);
      } else {
        pruned = (list || []).slice(0, 20);
      }
    } catch (e) {
      pruned = null;
    }
    if (!Array.isArray(pruned)) {
      try {
        pruned = L ? L.pruneSnapshots(list) : (list || []).slice(0, 20);
      } catch (_e) {
        pruned = (list || []).slice(0, 20);
      }
    }
    snapCache = pruned;
    try {
      Services.prefs.setStringPref(SNAP_PREF, JSON.stringify(pruned));
    } catch (e) {}
    clearPref(OLD_SNAP_PREF);
  }

  function listStashes() {
    try {
      return loadStashes().slice();
    } catch (e) {
      return [];
    }
  }

  // SessionStore custom-value read (fail-safe: missing service or key
  // reads as empty). Keys duplicated here by design — same pattern as
  // aphLastViewed / aphStarred elsewhere in this file.
  function readTabValue(tab, key) {
    try {
      if (
        typeof SessionStore !== "undefined" &&
        SessionStore &&
        typeof SessionStore.getCustomTabValue === "function"
      ) {
        const v = SessionStore.getCustomTabValue(tab, key);
        return typeof v === "string" || typeof v === "number" ? v : "";
      }
    } catch (e) {}
    return "";
  }

  function writeTabValue(tab, key, value) {
    try {
      if (
        typeof SessionStore !== "undefined" &&
        SessionStore &&
        typeof SessionStore.setCustomTabValue === "function"
      ) {
        SessionStore.setCustomTabValue(tab, key, String(value));
        return true;
      }
    } catch (e) {}
    return false;
  }

  // Native group state off a live tab. Reads label/color/collapsed
  // defensively — stock shapes vary by Firefox version (label vs name vs
  // title) and tests only model a subset. Returns null when ungrouped.
  function groupInfoOf(tab) {
    try {
      const g = tab && tab.group;
      if (!g || typeof g !== "object") {
        return null;
      }
      let name = "";
      try {
        name =
          (typeof g.label === "string" && g.label) ||
          (typeof g.name === "string" && g.name) ||
          (typeof g.title === "string" && g.title) ||
          "";
      } catch (e) {}
      let color = "";
      try {
        color = typeof g.color === "string" ? g.color : "";
      } catch (e) {}
      let collapsed = false;
      try {
        collapsed = g.collapsed === true || g.collapsed === 1;
      } catch (e) {}
      return { name: String(name || ""), color: String(color || ""), collapsed };
    } catch (e) {
      return null;
    }
  }

  function fidelityOf(tab, cid) {
    const out = {};
    try {
      let star = false;
      try {
        if (readTabValue(tab, "aphStarred") === "1") {
          star = true;
        } else if (
          typeof tab.hasAttribute === "function" &&
          tab.hasAttribute("data-aph-starred")
        ) {
          star = true;
        }
      } catch (e) {}
      if (star) {
        out.star = true;
      }
      try {
        const su = readTabValue(tab, "aphStarURL");
        if (su && String(su).length <= 2048) {
          out.starURL = String(su);
        }
      } catch (e) {}
      try {
        const nm = readTabValue(tab, "aphTabName");
        if (nm && String(nm).trim()) {
          out.tabName = String(nm).trim().slice(0, 100);
        }
      } catch (e) {}
      try {
        const lv = Number(readTabValue(tab, "aphLastViewed"));
        if (Number.isFinite(lv) && lv > 0) {
          out.lastViewed = Math.floor(lv);
        }
      } catch (e) {}
      try {
        if (typeof tab.image === "string" && tab.image && tab.image.length <= 8192) {
          out.favicon = tab.image;
        }
      } catch (e) {}
      try {
        const w = ws();
        if (cid && w && typeof w.describeContainer === "function") {
          const d = w.describeContainer(cid);
          if (d && d.name) {
            out.cname = String(d.name).slice(0, 80);
          }
        }
      } catch (e) {}
    } catch (e) {}
    return out;
  }

  function selectedUrlOf(target) {
    try {
      const sel = gBrowser.selectedTab;
      if (!sel || sel.closing) {
        return "";
      }
      const w = ws();
      try {
        if (w && typeof w.getWs === "function" && w.getWs(sel) !== target) {
          return "";
        }
      } catch (e) {}
      return tabUrl(sel) || "";
    } catch (e) {
      return "";
    }
  }

  function wsNameOf(target) {
    try {
      const w = ws();
      if (w && typeof w.getWsName === "function") {
        const n = w.getWsName(target);
        if (n && String(n).trim()) {
          return String(n).trim().slice(0, 40);
        }
      }
    } catch (e) {}
    return "";
  }

  // Live tabs that a stash of `target` would capture: untagged-ish pages
  // only, pins and internal pages excluded, de-duplicated by URL.
  // Strip order is preserved (callers store idx for reorder + display).
  function stashedTabsIn(target) {
    const out = [];
    const seen = new Set();
    let tabs = [];
    try {
      tabs = Array.from(gBrowser.tabs || []);
    } catch (e) {
      return out;
    }
    const w = ws();
    for (const t of tabs) {
      try {
        if (!t || t.closing || t.pinned) {
          continue;
        }
        const tag = w && typeof w.getWs === "function" ? w.getWs(t) : null;
        if (String(tag || "") !== target) {
          continue;
        }
        const url = tabUrl(t);
        if (!url || !isStashable(t) || seen.has(url)) {
          continue;
        }
        seen.add(url);
        out.push(t);
      } catch (e) {}
    }
    return out;
  }

  // Capture `tabs` (defaults to everything live in `ws`) as one stash.
  // http(s) only; pinned and closing tabs are skipped — pins are global
  // app anchors, not workspace content, so a snapshot would duplicate
  // them across every capture. Returns the new count (0 = nothing
  // stashable, e.g. an empty or all-internal workspace).
  function captureStash(tabs, wsArg, name, auto) {
    try {
      return captureStashEx(tabs, wsArg, name, auto).count;
    } catch (e) {
      return 0;
    }
  }

  // Same capture, but also reporting the new stash id so safety-net
  // callers can offer an undo. Internal: saveStash keeps the plain
  // count contract the palette relies on.
  //
  // Fidelity: per-tab strip order (idx), native group membership (gi +
  // denormalized gname/gcolor/gcollapsed + envelope groups[]), selected
  // URL, workspace name, starred state + base URL, custom tab name,
  // last-viewed, favicon and container display name. All optional —
  // old snapshots without them still restore.
  function captureStashEx(tabs, wsArg, name, auto) {
    const none = { count: 0, id: "" };
    try {
      if (isPrivateWindow()) {
        return none;
      }
      const w = ws();
      const target =
        typeof wsArg === "string" && /^[1-9]$/.test(wsArg)
          ? wsArg
          : (w && typeof w.getCurrent === "function" ? w.getCurrent() : "1");
      // An explicit tab list (the safety capture) is already the caller's
      // chosen set; otherwise the workspace defines the scope, so a
      // snapshot really is one workspace.
      const live = Array.isArray(tabs) ? tabs : stashedTabsIn(target);
      const picked = [];
      const seen = new Set();
      const groupObjs = [];
      const groupIndex = new Map();
      for (const t of live) {
        try {
          if (!t || t.closing || t.pinned) {
            continue;
          }
          const url = tabUrl(t);
          if (!url || !isStashable(t) || seen.has(url)) {
            continue;
          }
          seen.add(url);
          const cid = Number(t.userContextId) || 0;
          const rec = {
            title: String(t.label || "") || url,
            url,
            cid,
            idx: picked.length,
          };
          try {
            const gi0 = groupInfoOf(t);
            if (gi0 && t.group && typeof t.group === "object") {
              let gi = groupIndex.get(t.group);
              if (gi === undefined) {
                gi = groupObjs.length;
                groupObjs.push({
                  name: String(gi0.name || "").slice(0, 80),
                  color: String(gi0.color || "").slice(0, 32),
                  collapsed: !!gi0.collapsed,
                });
                groupIndex.set(t.group, gi);
              }
              rec.gi = gi;
              if (gi0.name) {
                rec.gname = String(gi0.name).slice(0, 80);
              }
              if (gi0.color) {
                rec.gcolor = String(gi0.color).slice(0, 32);
              }
              if (gi0.collapsed) {
                rec.gcollapsed = true;
              }
            } else {
              rec.gi = null;
            }
          } catch (e) {
            try {
              rec.gi = null;
            } catch (_e) {}
          }
          try {
            const f = fidelityOf(t, cid) || {};
            if (f.star) {
              rec.star = true;
            }
            if (f.starURL) {
              rec.starURL = f.starURL;
            }
            if (f.tabName) {
              rec.tabName = f.tabName;
            }
            if (f.lastViewed) {
              rec.lastViewed = f.lastViewed;
            }
            if (f.favicon) {
              rec.favicon = f.favicon;
            }
            if (f.cname) {
              rec.cname = f.cname;
            }
          } catch (e) {}
          picked.push(rec);
        } catch (e) {}
      }
      if (!picked.length) {
        return none;
      }
      const entry = {
        id: `${Date.now().toString(36)}-${Math.floor(Math.random() * 0xffffff).toString(36)}`,
        name: String(name || "").trim() || defaultStashName(target, !!auto),
        ws: target,
        ts: Date.now(),
        auto: !!auto,
        tabs: picked,
      };
      if (groupObjs.length) {
        entry.groups = groupObjs;
      }
      try {
        const su = selectedUrlOf(target);
        if (su) {
          entry.selUrl = su;
        }
      } catch (e) {}
      try {
        const wn = wsNameOf(target);
        if (wn) {
          entry.wsName = wn;
        }
      } catch (e) {}
      const L = logic();
      const list = L ? L.sanitizeSnapshots([entry]) : [entry];
      if (!list.length) {
        return none;
      }
      saveStashes([list[0], ...loadStashes()]);
      return { count: list[0].tabs.length, id: list[0].id };
    } catch (e) {
      return none;
    }
  }

  function defaultStashName(target, auto) {
    let when = "";
    try {
      when = new Date().toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
    } catch (e) {}
    return `${auto ? "Auto" : "Stash"} · WS ${target}${when ? ` · ${when}` : ""}`;
  }

  // Manual capture of one workspace (palette command).
  function saveStash(name, wsArg) {
    return captureStash(null, wsArg, name, false);
  }

  // Safety capture for a bulk close (called by workspaces.js before it
  // closes a workspace's tabs). Returns the captured tab count. On
  // success the stash is remembered as the pending safety net so
  // confirmBulkClose (called after the close lands) can offer an undo.
  let lastSafety = null; // {id, ws, count, ts} | null

  function autoStashTabs(tabs, name) {
    try {
      if (!getSnapAutoEnabled()) {
        return 0;
      }
      // The doomed tabs are already tagged with their workspace; read it
      // off the first one so the stash restores where it came from.
      let target = null;
      try {
        const w = ws();
        for (const t of tabs || []) {
          const v = w && typeof w.getWs === "function" ? w.getWs(t) : null;
          if (typeof v === "string" && /^[1-9]$/.test(v)) {
            target = v;
            break;
          }
        }
      } catch (e) {}
      const r = captureStashEx(tabs, target, name, true);
      if (r.count > 0 && r.id) {
        lastSafety = { id: r.id, ws: target || "1", count: r.count, ts: Date.now() };
      }
      return r.count;
    } catch (e) {
      return 0;
    }
  }

  // Undo offer for a landed bulk close. Called by the dock AFTER the
  // tabs are gone (so Undo can only ever add back, never destroy): when
  // the safety capture above just ran for this close, toast with an Undo
  // action that restores it. Stale safety nets (older than half a minute,
  // or already undone) stay silent — true when an offer was shown.
  const SAFETY_UNDO_MS = 30000;
  let safetyPending = null; // {id} awaiting an Undo click

  function undoSafetyStash() {
    try {
      const s = safetyPending;
      safetyPending = null;
      if (!s || !s.id) {
        return { ok: false, reason: "missing" };
      }
      return restoreStash(s.id);
    } catch (e) {
      return { ok: false, reason: "error" };
    }
  }

  function confirmBulkClose(wsId, closedCount) {
    try {
      const s = lastSafety;
      lastSafety = null;
      if (!s || !s.id || !(s.count > 0)) {
        return false;
      }
      try {
        if (Date.now() - (s.ts || 0) > SAFETY_UNDO_MS) {
          return false;
        }
      } catch (e) {}
      const n = Number(closedCount) || 0;
      safetyPending = { id: s.id };
      toast(`Closed WS ${s.ws} (${n} tab${n === 1 ? "" : "s"}) · safety-stashed`, {
        label: "Undo",
        run: () => {
          try {
            undoSafetyStash();
          } catch (e) {}
        },
      });
      return true;
    } catch (e) {
      return false;
    }
  }

  // Restore is append-only: every tab is opened into its own workspace
  // with its container intact, unselected; then the window lands on that
  // workspace once with the saved selected tab (or first) selected.
  // Ordering is best-effort restored (relative order of the snapshot),
  // native groups are recreated when the stock API exists, and per-tab
  // fidelity (starred, custom name, last-viewed) is re-applied. Nothing
  // is ever closed, so a stale stash can only ever add tabs, never lose
  // work. URLs already open in the target workspace are skipped (counted,
  // never duplicated); containers that no longer exist fall back to
  // unbound and are counted. Result: {ok, opened, skipped, unbound}
  // (+reason when !ok). A short summary toast confirms what landed.
  function applyFidelityToTab(tab, rec) {
    try {
      if (!tab || !rec) {
        return;
      }
      if (rec.star) {
        writeTabValue(tab, "aphStarred", "1");
        try {
          if (typeof tab.setAttribute === "function") {
            tab.setAttribute("data-aph-starred", "1");
          }
        } catch (e) {}
      }
      if (typeof rec.starURL === "string" && rec.starURL) {
        writeTabValue(tab, "aphStarURL", rec.starURL);
      }
      if (typeof rec.tabName === "string" && rec.tabName.trim()) {
        const nm = rec.tabName.trim().slice(0, 100);
        writeTabValue(tab, "aphTabName", nm);
        try {
          if (typeof tab.setAttribute === "function") {
            tab.setAttribute("label", nm);
          }
        } catch (e) {}
        try {
          if (typeof tab.setAttribute === "function") {
            tab.setAttribute("data-aph-renamed", "1");
          }
        } catch (e) {}
      }
      if (typeof rec.lastViewed === "number" && rec.lastViewed > 0) {
        writeTabValue(tab, "aphLastViewed", String(Math.floor(rec.lastViewed)));
      }
    } catch (e) {}
  }

  // Best-effort relative reorder: walk snapshot order and place each tab
  // right after its predecessor. Absolute indices are intentionally not
  // restored (existing tabs stay where they are) — only the restored run
  // keeps its internal order. All fail-silent.
  function reorderRestored(openedTabs) {
    try {
      if (!Array.isArray(openedTabs) || openedTabs.length < 2) {
        return;
      }
      if (!gBrowser || typeof gBrowser.moveTabTo !== "function") {
        return;
      }
      let tabs = null;
      try {
        tabs = Array.from(gBrowser.tabs || []);
      } catch (e) {
        return;
      }
      for (let i = 1; i < openedTabs.length; i++) {
        try {
          const prev = openedTabs[i - 1] && openedTabs[i - 1].tab;
          const cur = openedTabs[i] && openedTabs[i].tab;
          if (!prev || !cur || prev.closing || cur.closing) {
            continue;
          }
          const pi = tabs.indexOf(prev);
          const ci = tabs.indexOf(cur);
          if (pi === -1 || ci === -1) {
            continue;
          }
          if (ci === pi + 1) {
            continue;
          }
          gBrowser.moveTabTo(cur, { tabIndex: pi + 1 });
          try {
            tabs = Array.from(gBrowser.tabs || []);
          } catch (e) {}
        } catch (e) {}
      }
    } catch (e) {}
  }

  // Best-effort regroup: recreate each snapshot group with 2+ newly
  // opened tabs via the stock addTabGroup API when present, then re-apply
  // label/color/collapsed. Singletons are skipped (no need for a
  // one-tab group). Unknown group APIs fail silent — tabs stay ungrouped.
  function regroupRestored(entry, openedByGi) {
    try {
      if (!openedByGi || typeof openedByGi.size !== "number" || !openedByGi.size) {
        return;
      }
      const groups = (entry && Array.isArray(entry.groups)) ? entry.groups : [];
      const canGroup =
        gBrowser && typeof gBrowser.addTabGroup === "function";
      if (!canGroup) {
        return;
      }
      const gis = Array.from(openedByGi.keys()).sort((a, b) => a - b);
      for (const gi of gis) {
        try {
          const members = openedByGi.get(gi) || [];
          const live = members.filter((t) => t && !t.closing);
          if (live.length < 2) {
            continue;
          }
          let g = null;
          try {
            g = gBrowser.addTabGroup(live, { insertBefore: live[0] });
          } catch (e) {
            g = null;
          }
          if (!g) {
            continue;
          }
          const meta = groups[gi] || {};
          try {
            const nm =
              (meta.name && String(meta.name)) ||
              (live[0] && live[0].group ? "" : "");
            if (meta.name && typeof g.label !== "undefined") {
              try {
                g.label = String(meta.name).slice(0, 80);
              } catch (e) {}
            }
            if (meta.name && typeof g.name !== "undefined" && !g.label) {
              try {
                g.name = String(meta.name).slice(0, 80);
              } catch (e) {}
            }
            void nm;
          } catch (e) {}
          try {
            if (meta.color && typeof g.color !== "undefined") {
              g.color = String(meta.color).slice(0, 32);
            }
          } catch (e) {}
          try {
            if (typeof g.collapsed !== "undefined") {
              g.collapsed = !!meta.collapsed;
            }
          } catch (e) {}
        } catch (e) {}
      }
    } catch (e) {}
  }

  function openUrlsIn(target) {
    const out = new Set();
    try {
      const w = ws();
      for (const t of Array.from(gBrowser.tabs || [])) {
        try {
          if (!t || t.closing) {
            continue;
          }
          if (w && typeof w.getWs === "function" && w.getWs(t) !== target) {
            continue;
          }
          const url = tabUrl(t);
          if (url) {
            out.add(url);
          }
        } catch (e) {}
      }
    } catch (e) {}
    return out;
  }

  function restoreSummaryText(target, opened, skipped, unbound) {
    try {
      if (opened > 0) {
        let s = `Restored ${opened} tab${opened === 1 ? "" : "s"} to WS ${target}`;
        if (skipped > 0) {
          s += ` · ${skipped} already open`;
        }
        if (unbound > 0) {
          s += ` · ${unbound} lost its container`;
        }
        return s;
      }
      if (skipped > 0) {
        return `Already open in WS ${target} — nothing to restore`;
      }
    } catch (e) {}
    return "";
  }

  function restoreStash(id) {
    try {
      const entry = loadStashes().find((s) => s && s.id === id);
      if (!entry) {
        return { ok: false, reason: "missing", opened: 0, skipped: 0, unbound: 0 };
      }
      const w = ws();
      const target = /^[1-9]$/.test(String(entry.ws)) ? entry.ws : "1";
      const present = openUrlsIn(target);
      let opened = 0;
      let skipped = 0;
      let unbound = 0;
      let first = null;
      const openedTabs = [];
      const openedByGi = new Map();
      const ordered = (entry.tabs || []).slice().sort((a, b) => {
        const ai = a && Number.isInteger(a.idx) ? a.idx : 1e9;
        const bi = b && Number.isInteger(b.idx) ? b.idx : 1e9;
        return ai - bi;
      });
      for (const t of ordered) {
        try {
          const url = t && typeof t.url === "string" ? t.url : "";
          if (!url) {
            continue;
          }
          if (present.has(url)) {
            skipped++;
            continue;
          }
          const asked = Number(t.cid) || 0;
          const cid = validCid(asked);
          if (asked > 0 && cid !== asked) {
            unbound++;
          }
          const tab =
            w && typeof w.openInWorkspace === "function"
              ? w.openInWorkspace(url, target, cid)
              : gBrowser.addTrustedTab(url);
          if (!tab) {
            continue;
          }
          try {
            applyFidelityToTab(tab, t);
          } catch (e) {}
          present.add(url);
          opened++;
          openedTabs.push({ tab, rec: t });
          if (!first) {
            first = tab;
          }
          try {
            const gi = t && Number.isInteger(t.gi) && t.gi >= 0 ? t.gi : -1;
            if (gi >= 0) {
              if (!openedByGi.has(gi)) {
                openedByGi.set(gi, []);
              }
              openedByGi.get(gi).push(tab);
            }
          } catch (e) {}
        } catch (e) {}
      }
      if (!opened && !skipped) {
        return { ok: false, reason: "open-failed", opened: 0, skipped: 0, unbound: 0 };
      }
      try {
        reorderRestored(openedTabs);
      } catch (e) {}
      try {
        regroupRestored(entry, openedByGi);
      } catch (e) {}
      // Prefer the saved selected tab; fall back to first opened.
      let selTab = null;
      try {
        const want = entry && typeof entry.selUrl === "string" ? entry.selUrl : "";
        if (want) {
          for (const o of openedTabs) {
            try {
              if (o && o.rec && o.rec.url === want) {
                selTab = o.tab;
                break;
              }
            } catch (e) {}
          }
        }
      } catch (e) {}
      try {
        if (w && typeof w.switchTo === "function" && w.getCurrent && w.getCurrent() !== target) {
          w.switchTo(target);
        }
      } catch (e) {}
      try {
        const pick = selTab || first;
        if (pick) {
          gBrowser.showTab(pick);
          gBrowser.selectedTab = pick;
        }
      } catch (e) {}
      const msg = restoreSummaryText(target, opened, skipped, unbound);
      if (msg) {
        toast(msg);
      }
      return { ok: true, opened, skipped, unbound };
    } catch (e) {
      return { ok: false, reason: "error", opened: 0, skipped: 0, unbound: 0 };
    }
  }

  // Single tab out of a snapshot (stash-card preview rows): same
  // land-and-select as a per-tab restore, keeping the snapshot itself
  // untouched. Quiet (the page toasts from the bridge result).
  function restoreStashTab(id, url) {
    try {
      const entry = loadStashes().find((s) => s && s.id === id);
      if (!entry) {
        return { ok: false, reason: "missing" };
      }
      const want = typeof url === "string" ? url : "";
      const rec = (entry.tabs || []).find((t) => t && t.url === want);
      if (!rec) {
        return { ok: false, reason: "missing" };
      }
      const w = ws();
      const target = /^[1-9]$/.test(String(entry.ws)) ? entry.ws : "1";
      const cid = validCid(rec.cid);
      let tab = null;
      try {
        tab =
          w && typeof w.openInWorkspace === "function"
            ? w.openInWorkspace(rec.url, target, cid)
            : gBrowser.addTrustedTab(rec.url);
      } catch (e) {
        tab = null;
      }
      if (!tab) {
        return { ok: false, reason: "open-failed" };
      }
      try {
        applyFidelityToTab(tab, rec);
      } catch (e) {}
      try {
        if (w && typeof w.switchTo === "function" && w.getCurrent && w.getCurrent() !== target) {
          w.switchTo(target);
        }
      } catch (e) {}
      try {
        gBrowser.showTab(tab);
      } catch (e) {}
      try {
        gBrowser.selectedTab = tab;
      } catch (e) {}
      return { ok: true, opened: 1 };
    } catch (e) {
      return { ok: false, reason: "error" };
    }
  }

  function deleteStash(id) {
    try {
      const list = loadStashes();
      const i = list.findIndex((s) => s && s.id === id);
      if (i === -1) {
        return false;
      }
      list.splice(i, 1);
      saveStashes(list);
      return true;
    } catch (e) {
      return false;
    }
  }

  // Re-capture a snapshot's home workspace into the SAME entry (name,
  // auto flag and id kept; tabs + timestamp refreshed). The rolling-
  // snapshot primitive: "current sprint" stays one card. Empty home
  // workspace refuses ({ok:false,reason:"empty"}) rather than storing
  // a hollow entry sanitizeSnapshots would drop on next read.
  function updateStash(id) {
    try {
      const list = loadStashes();
      const entry = list.find((s) => s && s.id === id);
      if (!entry) {
        return { ok: false, reason: "missing", count: 0 };
      }
      const target = /^[1-9]$/.test(String(entry.ws)) ? entry.ws : "1";
      const live = stashedTabsIn(target);
      const picked = [];
      const seen = new Set();
      const groupObjs = [];
      const groupIndex = new Map();
      for (const t of live) {
        try {
          if (!t || t.closing || t.pinned) {
            continue;
          }
          const url = tabUrl(t);
          if (!url || !isStashable(t) || seen.has(url)) {
            continue;
          }
          seen.add(url);
          const cid = Number(t.userContextId) || 0;
          const rec = {
            title: String(t.label || "") || url,
            url,
            cid,
            idx: picked.length,
          };
          try {
            const gi0 = groupInfoOf(t);
            if (gi0 && t.group && typeof t.group === "object") {
              let gi = groupIndex.get(t.group);
              if (gi === undefined) {
                gi = groupObjs.length;
                groupObjs.push({
                  name: String(gi0.name || "").slice(0, 80),
                  color: String(gi0.color || "").slice(0, 32),
                  collapsed: !!gi0.collapsed,
                });
                groupIndex.set(t.group, gi);
              }
              rec.gi = gi;
              if (gi0.name) {
                rec.gname = String(gi0.name).slice(0, 80);
              }
              if (gi0.color) {
                rec.gcolor = String(gi0.color).slice(0, 32);
              }
              if (gi0.collapsed) {
                rec.gcollapsed = true;
              }
            } else {
              rec.gi = null;
            }
          } catch (e) {
            try {
              rec.gi = null;
            } catch (_e) {}
          }
          try {
            const f = fidelityOf(t, cid) || {};
            if (f.star) {
              rec.star = true;
            }
            if (f.starURL) {
              rec.starURL = f.starURL;
            }
            if (f.tabName) {
              rec.tabName = f.tabName;
            }
            if (f.lastViewed) {
              rec.lastViewed = f.lastViewed;
            }
            if (f.favicon) {
              rec.favicon = f.favicon;
            }
            if (f.cname) {
              rec.cname = f.cname;
            }
          } catch (e) {}
          picked.push(rec);
        } catch (e) {}
      }
      if (!picked.length) {
        return { ok: false, reason: "empty", count: 0 };
      }
      entry.tabs = picked;
      entry.ts = Date.now();
      if (groupObjs.length) {
        entry.groups = groupObjs;
      } else {
        try {
          delete entry.groups;
        } catch (e) {}
      }
      try {
        const su = selectedUrlOf(target);
        if (su) {
          entry.selUrl = su;
        } else {
          try {
            delete entry.selUrl;
          } catch (_e) {}
        }
      } catch (e) {}
      try {
        const wn = wsNameOf(target);
        if (wn) {
          entry.wsName = wn;
        }
      } catch (e) {}
      saveStashes(list);
      return { ok: true, count: picked.length };
    } catch (e) {
      return { ok: false, reason: "error", count: 0 };
    }
  }
  // Rename a snapshot in place (tabs, workspace and history untouched).
  // Blank names are rejected (the old name stands); overlong names trim
  // to the same 80 chars sanitizeSnapshots enforces. True when anything
  // changed.
  function renameStash(id, name) {
    try {
      const clean = String(name == null ? "" : name).trim().slice(0, 80);
      if (!clean) {
        return false;
      }
      const list = loadStashes();
      const entry = list.find((s) => s && s.id === id);
      if (!entry || entry.name === clean) {
        return false;
      }
      entry.name = clean;
      saveStashes(list);
      return true;
    } catch (e) {
      return false;
    }
  }

  // Periodic capture of the current workspace, skipped when nothing moved
  // since the last auto capture. Pure comparison extracted so tests can
  // drive it without timers.
  //
  // Legacy URL-set helpers stay for compat; sweepWorkspace now compares
  // the richer content key (URLs + order + groups + selected URL) so
  // regroups/reorders/selects also trigger a new auto snapshot.
  function urlSetOf(tabs) {
    const out = new Set();
    for (const t of tabs || []) {
      try {
        if (!t || t.closing || t.pinned) {
          continue;
        }
        const url = tabUrl(t);
        if (url && isStashable(t)) {
          out.add(url);
        }
      } catch (e) {}
    }
    return [...out].sort().join("\n");
  }

  function newestAutoStash() {
    try {
      return (
        loadStashes()
          .filter((s) => s && s.auto)
          .sort((a, b) => (b.ts || 0) - (a.ts || 0))[0] || null
      );
    } catch (e) {
      return null;
    }
  }

  // Newest auto stash for one workspace (null when never captured).
  // Drives both the changed-check and the due-check below.
  function newestAutoStashFor(wsId) {
    try {
      const list = loadStashes().filter((s) => s && s.auto && s.ws === wsId);
      list.sort((a, b) => (b.ts || 0) - (a.ts || 0));
      return list[0] || null;
    } catch (e) {
      return null;
    }
  }

  function savedUrlSet(snap) {
    let out = "";
    try {
      out = (snap.tabs || [])
        .map((t) => String(t && t.url ? t.url : ""))
        .filter(Boolean)
        .sort()
        .join("\n");
    } catch (e) {}
    return out;
  }

  // Rich content key for live tabs: URL set + strip order + group
  // signature + selected URL. Falls back to the legacy URL set when the
  // shared logic is unavailable (tests, old bundles).
  function liveContentKey(tabs, target) {
    try {
      const L = logic();
      const recs = [];
      try {
        for (const t of tabs || []) {
          if (!t || t.closing || t.pinned) {
            continue;
          }
          const url = tabUrl(t);
          if (!url || !isStashable(t)) {
            continue;
          }
          const r = { url };
          try {
            const gi0 = groupInfoOf(t);
            if (gi0 && t.group && typeof t.group === "object") {
              r.gi = groupSlotOf(t.group, tabs);
              if (gi0.name) {
                r.gname = gi0.name;
              }
              if (gi0.color) {
                r.gcolor = gi0.color;
              }
              if (gi0.collapsed) {
                r.gcollapsed = true;
              }
            } else {
              r.gi = -1;
            }
          } catch (e) {
            r.gi = -1;
          }
          recs.push(r);
        }
      } catch (e) {}
      if (!recs.length) {
        return "";
      }
      let sel = "";
      try {
        sel = selectedUrlOf(target) || "";
      } catch (e) {}
      if (L && typeof L.snapshotContentKey === "function") {
        return L.snapshotContentKey(recs, sel);
      }
      return `${urlSetOf(tabs)}\n---sel---\n${sel}`;
    } catch (e) {
      return "";
    }
  }

  // Stable per-strip group slot: first-seen group object order. Matches
  // the capture-time gi assignment so live vs saved keys agree.
  function groupSlotOf(group, tabs) {
    try {
      let slot = -1;
      let next = 0;
      const seen = new Map();
      for (const t of tabs || []) {
        try {
          const g = t && t.group;
          if (!g || typeof g !== "object") {
            continue;
          }
          if (!seen.has(g)) {
            seen.set(g, next++);
          }
          if (g === group) {
            slot = seen.get(g);
            break;
          }
        } catch (e) {}
      }
      return slot;
    } catch (e) {
      return -1;
    }
  }

  function savedContentKey(snap) {
    try {
      const L = logic();
      if (L && typeof L.savedContentKey === "function") {
        const k = L.savedContentKey(snap);
        if (k) {
          return k;
        }
      }
    } catch (e) {}
    return savedUrlSet(snap);
  }

  // Slow-tier keys: selection-blind so selection-only drift never mints
  // a 6h/daily snapshot. Opened / closed / moved (URLs + order + groups
  // incl. collapsed) still move the key.
  function liveSlowKey(tabs) {
    try {
      const L = logic();
      const recs = [];
      try {
        for (const t of tabs || []) {
          if (!t || t.closing || t.pinned) {
            continue;
          }
          const url = tabUrl(t);
          if (!url || !isStashable(t)) {
            continue;
          }
          const r = { url };
          try {
            const gi0 = groupInfoOf(t);
            if (gi0 && t.group && typeof t.group === "object") {
              r.gi = groupSlotOf(t.group, tabs);
              if (gi0.name) {
                r.gname = gi0.name;
              }
              if (gi0.color) {
                r.gcolor = gi0.color;
              }
              if (gi0.collapsed) {
                r.gcollapsed = true;
              }
            } else {
              r.gi = -1;
            }
          } catch (e) {
            r.gi = -1;
          }
          recs.push(r);
        }
      } catch (e) {}
      if (!recs.length) {
        return "";
      }
      if (L) {
        if (typeof L.slowContentKey === "function") {
          return L.slowContentKey(recs);
        }
        if (typeof L.snapshotContentKey === "function") {
          return L.snapshotContentKey(recs, "");
        }
      }
      return urlSetOf(tabs);
    } catch (e) {
      return "";
    }
  }

  function savedSlowKey(snap) {
    try {
      const L = logic();
      if (L && typeof L.savedSlowKey === "function") {
        const k = L.savedSlowKey(snap);
        if (k) {
          return k;
        }
      }
      if (L && typeof L.snapshotContentKey === "function") {
        const k = L.snapshotContentKey((snap && snap.tabs) || [], "");
        if (k) {
          return k;
        }
      }
    } catch (e) {}
    return savedUrlSet(snap);
  }

  // Capture one workspace when its live content moved since its newest
  // auto capture. 1 = captured, 0 = nothing to do. No due-check here:
  // callers layer cadence (tick), budget (events) or urgency (quit) on top.
  function sweepWorkspace(wsId) {
    try {
      if (!getSnapAutoEnabled()) {
        return 0;
      }
      if (!/^[1-9]$/.test(String(wsId || ""))) {
        return 0;
      }
      // The same workspace-scoped view captureStash will store, so the
      // change check and the capture can never disagree about what
      // "unchanged" means (a whole-window set would always look changed).
      const tabs = stashedTabsIn(wsId);
      const now = liveContentKey(tabs, wsId) || urlSetOf(tabs);
      if (!now) {
        return 0;
      }
      const last = newestAutoStashFor(wsId);
      if (last) {
        const prev = savedContentKey(last) || savedUrlSet(last);
        if (prev && prev === now) {
          return 0;
        }
      }
      // Deliberately not the tab count: callers ask "did a capture
      // happen", and the set is unchanged when it returns 0.
      return captureStash(tabs, wsId, "", true) > 0 ? 1 : 0;
    } catch (e) {
      return 0;
    }
  }

  function autoStashSweepNow() {
    try {
      if (!getSnapAutoEnabled()) {
        return 0;
      }
      const w = ws();
      const cur = w && typeof w.getCurrent === "function" ? w.getCurrent() : null;
      if (!/^[1-9]$/.test(String(cur || ""))) {
        return 0;
      }
      return sweepWorkspace(cur);
    } catch (e) {
      return 0;
    }
  }

  // Active workspace ids, newest API first (getActiveWorkspaces), older
  // fallback (getActiveIds), current-only last resort. Never throws.
  function activeWorkspaceIds(fallbackCur) {
    try {
      const w = ws();
      if (w) {
        try {
          if (typeof w.getActiveWorkspaces === "function") {
            const ids = w.getActiveWorkspaces();
            if (Array.isArray(ids) && ids.length) {
              return ids.filter((id) => /^[1-9]$/.test(String(id || "")));
            }
          }
        } catch (e) {}
        try {
          if (typeof w.getActiveIds === "function") {
            const ids = w.getActiveIds();
            if (Array.isArray(ids) && ids.length) {
              return ids.filter((id) => /^[1-9]$/.test(String(id || "")));
            }
          }
        } catch (e) {}
      }
    } catch (e) {}
    return /^[1-9]$/.test(String(fallbackCur || "")) ? [fallbackCur] : [];
  }

  function snapshotDueAt(ts, nowMs) {
    try {
      const L = logic();
      if (L && typeof L.snapshotDue === "function") {
        return L.snapshotDue(ts, nowMs, getSnapIntervalMin());
      }
      return (Number(nowMs) || 0) - (Number(ts) || 0) >= getSnapIntervalMin() * 60000;
    } catch (e) {
      return false;
    }
  }

  // One workspace, due-gated: capture only when the cadence elapsed AND
  // the URL set moved. Returns 1/0 like sweepWorkspace.
  function sweepDueWorkspace(wsId, nowMs) {
    try {
      const last = newestAutoStashFor(wsId);
      if (last && !snapshotDueAt(last.ts, nowMs)) {
        return 0;
      }
      return sweepWorkspace(wsId);
    } catch (e) {
      return 0;
    }
  }

  // Heartbeat body (every SNAP_TICK_MS): current workspace plus every
  // idle background workspace, each due-gated and changed-gated.
  // Returns the capture count. Windows with no workspaces API stay quiet.
  function autoStashTick(nowMs) {
    try {
      if (!getSnapAutoEnabled()) {
        return 0;
      }
      const w = ws();
      if (!w) {
        return 0;
      }
      const now = nowMs == null ? Date.now() : nowMs;
      let cur = null;
      try {
        cur = typeof w.getCurrent === "function" ? w.getCurrent() : null;
      } catch (e) {}
      let n = 0;
      const ids = activeWorkspaceIds(cur);
      if (!ids.length) {
        return 0;
      }
      for (const id of ids) {
        try {
          n += sweepDueWorkspace(id, now);
        } catch (e) {}
      }
      return n;
    } catch (e) {
      return 0;
    }
  }

  // Shutdown net (window unload): capture every workspace whose content
  // moved, regardless of cadence — quitting is the last chance. Changed
  // gating still applies, so a quiet shutdown writes nothing.
  function captureChangedWorkspaces() {
    try {
      if (!getSnapAutoEnabled()) {
        return 0;
      }
      const w = ws();
      if (!w) {
        return 0;
      }
      let cur = null;
      try {
        cur = typeof w.getCurrent === "function" ? w.getCurrent() : null;
      } catch (e) {}
      let n = 0;
      for (const id of activeWorkspaceIds(cur)) {
        try {
          n += sweepWorkspace(id);
        } catch (e) {}
      }
      return n;
    } catch (e) {
      return 0;
    }
  }

  // Slow-tier sweep (fixed 6h heartbeat + daily): selection-blind
  // changed gate — opened / closed / moved only. No due-check and no
  // event cooldown: the 6h cadence IS the budget, and the narrowed key
  // keeps selection-only drift from minting snapshots.
  function sweepSlowWorkspace(wsId) {
    try {
      if (!getSnapAutoEnabled()) {
        return 0;
      }
      if (!/^[1-9]$/.test(String(wsId || ""))) {
        return 0;
      }
      const tabs = stashedTabsIn(wsId);
      const now = liveSlowKey(tabs) || urlSetOf(tabs);
      if (!now) {
        return 0;
      }
      const last = newestAutoStashFor(wsId);
      if (last) {
        const prev = savedSlowKey(last) || savedUrlSet(last);
        if (prev && prev === now) {
          return 0;
        }
      }
      return captureStash(tabs, wsId, "", true) > 0 ? 1 : 0;
    } catch (e) {
      return 0;
    }
  }

  // Slow heartbeat body (every SLOW_TICK_MS): same workspace set as the
  // fast tick, each selection-blind changed-gated. Returns capture count.
  function autoStashSlowTick(nowMs) {
    try {
      if (!getSnapAutoEnabled()) {
        return 0;
      }
      const w = ws();
      if (!w) {
        return 0;
      }
      let cur = null;
      try {
        cur = typeof w.getCurrent === "function" ? w.getCurrent() : null;
      } catch (e) {}
      void nowMs;
      let n = 0;
      const ids = activeWorkspaceIds(cur);
      if (!ids.length) {
        return 0;
      }
      for (const id of ids) {
        try {
          n += sweepSlowWorkspace(id);
        } catch (e) {}
      }
      return n;
    } catch (e) {
      return 0;
    }
  }

  // Event-driven captures (hybrid timing): time ticks stay the backstop,
  // but closes / group edits / workspace switches capture promptly when
  // content actually moved. Bursts coalesce via debounce + per-workspace
  // cooldown so a 10-close burst or a drag storm stores one snapshot.
  const EVENT_COOLDOWN_DEFAULT_MS = 10 * 60 * 1000;
  const CLOSE_DEBOUNCE_MS = 30000;
  const STARTUP_CAPTURE_DELAY_MS = 45000;
  // Slow backstop: fixed 6h heartbeat for idle workspaces + the daily
  // tier in retention. Still changed-gated (selection-blind), so quiet
  // 6h windows write nothing.
  const SLOW_TICK_MS = 6 * 60 * 60 * 1000;
  let lastEventCapture = null; // {wsId: ts} | null
  let eventTimers = null; // {wsId: timeoutId} | null
  let startupTimer = null;
  let tabCloseHook = null;
  let groupHook = null;
  let startupObserver = null;
  let slowIntervalId = null;
  let closeHook = null;
  let quitObserver = null;

  function eventCooldownMs() {
    try {
      const L = logic();
      if (L && Number.isFinite(Number(L.SNAP_EVENT_COOLDOWN_MS))) {
        return Number(L.SNAP_EVENT_COOLDOWN_MS);
      }
    } catch (e) {}
    return EVENT_COOLDOWN_DEFAULT_MS;
  }

  function eventDueAt(wsId, nowMs) {
    try {
      const L = logic();
      const cd = eventCooldownMs();
      const last = lastEventCapture ? lastEventCapture[String(wsId)] || 0 : 0;
      if (L && typeof L.eventDue === "function") {
        return L.eventDue(last, nowMs, cd);
      }
      const now = Number(nowMs);
      if (!Number.isFinite(now) || now < 0) {
        return false;
      }
      if (!(Number(last) > 0)) {
        return true;
      }
      return now - Number(last) >= cd;
    } catch (e) {
      return false;
    }
  }

  // Changed-gated + cooldown-gated capture for one workspace. 1 =
  // captured, 0 = nothing to do (disabled, cooling down, unchanged or
  // empty). No due-check: events are urgent, the cooldown is the budget.
  function sweepWorkspaceEvent(wsId, nowMs) {
    try {
      if (!getSnapAutoEnabled()) {
        return 0;
      }
      if (!/^[1-9]$/.test(String(wsId || ""))) {
        return 0;
      }
      const now = nowMs == null ? Date.now() : nowMs;
      if (!eventDueAt(wsId, now)) {
        return 0;
      }
      const r = sweepWorkspace(wsId);
      if (r > 0) {
        try {
          if (!lastEventCapture) {
            lastEventCapture = {};
          }
          lastEventCapture[String(wsId)] = now;
        } catch (e) {}
      }
      return r;
    } catch (e) {
      return 0;
    }
  }

  // Debounced wrapper: rapid closes collapse to one capture per workspace.
  function queueEventCapture(wsId) {
    try {
      if (!getSnapAutoEnabled()) {
        return false;
      }
      if (!/^[1-9]$/.test(String(wsId || ""))) {
        return false;
      }
      if (typeof setTimeout !== "function") {
        return false;
      }
      if (!eventTimers) {
        eventTimers = {};
      }
      const key = String(wsId);
      try {
        if (eventTimers[key]) {
          try {
            clearTimeout(eventTimers[key]);
          } catch (e) {}
        }
      } catch (e) {}
      const id = setTimeout(() => {
        try {
          delete eventTimers[key];
        } catch (e) {}
        try {
          sweepWorkspaceEvent(key);
        } catch (e) {}
      }, CLOSE_DEBOUNCE_MS);
      if (!id) {
        try {
          delete eventTimers[key];
        } catch (e) {}
        return false;
      }
      eventTimers[key] = id;
      return true;
    } catch (e) {
      return false;
    }
  }

  // Called by the workspaces bundle right after a switch settles (and
  // directly testable): immediate due-gated sweep of the arrival
  // workspace — no extra timer, the changed-gate keeps it quiet when
  // nothing moved.
  function notifyWorkspaceSwitch(wsId) {
    try {
      if (!getSnapAutoEnabled()) {
        return 0;
      }
      const target =
        /^[1-9]$/.test(String(wsId || "")) ?
          String(wsId) :
          (() => {
            try {
              const w = ws();
              return w && typeof w.getCurrent === "function" ? w.getCurrent() : null;
            } catch (e) {
              return null;
            }
          })();
      if (!/^[1-9]$/.test(String(target || ""))) {
        return 0;
      }
      return sweepDueWorkspace(target, Date.now());
    } catch (e) {
      return 0;
    }
  }

  function wsIdOfTab(tab) {
    try {
      const w = ws();
      if (w && typeof w.getWs === "function") {
        const v = w.getWs(tab);
        if (/^[1-9]$/.test(String(v || ""))) {
          return v;
        }
      }
    } catch (e) {}
    try {
      const w = ws();
      if (w && typeof w.getCurrent === "function") {
        return w.getCurrent();
      }
    } catch (e) {}
    return null;
  }

  function onStashTabClose(e) {
    try {
      if (!getSnapAutoEnabled()) {
        return;
      }
      let tab = null;
      try {
        tab = e && e.target;
      } catch (err) {}
      const id = wsIdOfTab(tab);
      if (/^[1-9]$/.test(String(id || ""))) {
        queueEventCapture(id);
      }
    } catch (e) {}
  }

  function onStashGroupChange(e) {
    try {
      if (!getSnapAutoEnabled()) {
        return;
      }
      let tab = null;
      try {
        const t = e && e.target;
        if (t && typeof t.closest === "function") {
          const g = t.closest("tab-group");
          if (g) {
            const members = Array.from(g.tabs || []);
            tab = members[0] || null;
          }
        }
        if (!tab && t && t.group) {
          const members = Array.from((t.group && t.group.tabs) || []);
          tab = members[0] || t;
        }
        if (!tab) {
          tab = t;
        }
      } catch (err) {}
      const id = wsIdOfTab(tab);
      if (/^[1-9]$/.test(String(id || ""))) {
        queueEventCapture(id);
      }
    } catch (e) {}
  }

  function scheduleStartupCapture() {
    try {
      if (typeof setTimeout !== "function") {
        return false;
      }
      if (startupTimer) {
        return true;
      }
      const id = setTimeout(() => {
        startupTimer = null;
        try {
          captureChangedWorkspaces();
        } catch (e) {}
      }, STARTUP_CAPTURE_DELAY_MS);
      if (!id) {
        startupTimer = null;
        return false;
      }
      startupTimer = id;
      return true;
    } catch (e) {
      return false;
    }
  }

  function startStashSweeper() {
    try {
      if (snapIntervalId !== null && snapIntervalId !== undefined) {
        return true;
      }
      if (typeof setInterval !== "function") {
        return false;
      }
      snapIntervalId = setInterval(() => {
        try {
          autoStashTick();
        } catch (e) {}
      }, SNAP_TICK_MS);
      return snapIntervalId !== null && snapIntervalId !== undefined;
    } catch (e) {
      return false;
    }
  }

  function stopStashSweeper() {
    try {
      if (snapIntervalId !== null && snapIntervalId !== undefined) {
        clearInterval(snapIntervalId);
      }
    } catch (e) {}
    snapIntervalId = null;
  }

  function startSlowSweeper() {
    try {
      if (slowIntervalId) {
        return true;
      }
      if (typeof setInterval !== "function") {
        return false;
      }
      const id = setInterval(() => {
        try {
          autoStashSlowTick();
        } catch (e) {}
      }, SLOW_TICK_MS);
      if (!id) {
        slowIntervalId = null;
        return false;
      }
      slowIntervalId = id;
      return true;
    } catch (e) {
      return false;
    }
  }

  function stopSlowSweeper() {
    try {
      if (slowIntervalId) {
        clearInterval(slowIntervalId);
      }
    } catch (e) {}
    slowIntervalId = null;
  }

  // Dedicated window-close net, in addition to the unload net in
  // cleanup(): fires earlier (close/quit), still changed-gated, so the
  // later unload pass finds nothing moved and stays quiet.
  function onStashWindowClose() {
    try {
      captureChangedWorkspaces();
    } catch (e) {}
  }

  function contextIdOf(tab) {
    try {
      return tab.linkedBrowser?.browsingContext?.id || 0;
    } catch (e) {
      return 0;
    }
  }

  // Restore requests from the Stash page (any process): only the window
  // that owns the requesting browsing context acts. kind:"stash" routes to
  // the workspace-snapshot restore, kind:"stash-tab" to one tab out of a
  // snapshot, kind:"stash-update" to a re-capture; anything else stays
  // the per-tab path.
  const restoreObserver = {
    observe(subj, topic, data) {
      try {
        if (topic !== OBS_RESTORE) {
          return;
        }
        let msg = null;
        try {
          msg = JSON.parse(data);
        } catch (e) {
          return;
        }
        if (!msg || !msg.id || !msg.contextId) {
          return;
        }
        let owns = false;
        try {
          for (const t of Array.from(gBrowser.tabs || [])) {
            if (!t.closing && contextIdOf(t) === msg.contextId) {
              owns = true;
              break;
            }
          }
        } catch (e) {}
        if (!owns) {
          return;
        }
        const kind =
          msg.kind === "stash-tab"
            ? "stash-tab"
            : msg.kind === "stash-update"
              ? "stash-update"
              : msg.kind === "stash"
                ? "stash"
                : "tab";
        // Snapshots are kept on restore (they are the point); per-tab
        // entries keep the existing remove-unless-kept contract. Updates
        // refresh the snapshot in place and report the new tab count.
        const r =
          kind === "stash-tab"
            ? restoreStashTab(msg.id, msg.url)
            : kind === "stash-update"
              ? updateStash(msg.id)
              : kind === "stash"
                ? restoreStash(msg.id)
                : restoreStashEntry(msg.id, { keep: !!msg.keep });
        try {
          Services.obs.notifyObservers(
            null,
            OBS_RESULT,
            JSON.stringify({
              contextId: msg.contextId,
              id: msg.id,
              kind,
              ok: !!r.ok,
              reason: r.reason || "",
              opened: r.opened || 0,
              skipped: r.skipped || 0,
              unbound: r.unbound || 0,
              count: r.count || 0,
            })
          );
        } catch (e) {}
      } catch (e) {}
    },
  };

  function onTabMenuShowing(e) {
    try {
      const menu = e.currentTarget || e.target;
      if (!menu || typeof menu.appendChild !== "function") {
        return;
      }
      try {
        if (menuItem && menuItem.parentNode) {
          menuItem.remove();
        }
      } catch (err) {}
      menuItem = null;
      let node = null;
      try {
        const popup = e.target;
        node = (popup && popup.triggerNode) || document.popupNode || null;
      } catch (err) {}
      // Mirror stock tab-context-menu.js: triggerNode may carry the tab
      // directly (.tab) or contain it; fall back to the selected tab.
      let clicked = null;
      try {
        if (node) {
          clicked =
            node.tab ||
            (typeof node.closest === "function" ? node.closest("tab") : null);
        }
        if (!clicked && gBrowser.selectedTab) {
          clicked = gBrowser.selectedTab;
        }
      } catch (err) {
        clicked = null;
      }
      const targets = resolveTargets(clicked).filter(isStashable);
      if (!targets.length) {
        return;
      }
      // browser.xhtml is an XHTML document: document.createElement would
      // build an HTML-namespaced dud that never renders inside the XUL
      // menupopup. Stock code uses createXULElement (see _createTabGroupMenuItem).
      const item =
        typeof document.createXULElement === "function"
          ? document.createXULElement("menuitem")
          : document.createElement("menuitem");
      try {
        // Element id stays legacy: harmless, and keeps the menu row
        // identifiable across the rename.
        item.id = "aph-stash-tab";
        item.setAttribute(
          "label",
          targets.length > 1 ? `Stash ${targets.length} Tabs` : "Stash Tab"
        );
      } catch (err) {}
      item.addEventListener("command", () => {
        try {
          stashTabs(targets);
        } catch (err) {}
      });
      menu.appendChild(item);
      menuItem = item;
    } catch (e) {}
  }

  function ensureToast() {
    try {
      let el = document.getElementById("aph-toast");
      if (el) {
        return el;
      }
      el = document.createElement("div");
      el.id = "aph-toast";
      (document.body || document.documentElement).appendChild(el);
      return el;
    } catch (e) {
      return null;
    }
  }

  // Action toasts (Undo after a bulk close) share the one #aph-toast
  // slot: text plus at most one button. Action toasts linger longer so
  // the button is actually reachable; any toast replaces the previous.
  const TOAST_ACTION_MS = 8000;

  function toast(msg, action) {
    try {
      const el = ensureToast();
      if (!el) {
        return;
      }
      try {
        while (el.firstChild) {
          el.removeChild(el.firstChild);
        }
      } catch (e) {
        try {
          el.textContent = "";
        } catch (_e) {}
      }
      let span = null;
      try {
        span = document.createElement("span");
        span.textContent = msg;
        el.appendChild(span);
      } catch (e) {
        try {
          el.textContent = msg;
        } catch (_e) {}
      }
      let wait = TOAST_MS;
      try {
        if (action && action.label && typeof action.run === "function") {
          const btn = document.createElement("button");
          btn.type = "button";
          btn.textContent = action.label;
          btn.addEventListener("click", () => {
            try {
              el.classList.remove("show");
            } catch (_e) {}
            try {
              if (toastTimer) {
                clearTimeout(toastTimer);
                toastTimer = null;
              }
            } catch (_e) {}
            try {
              action.run();
            } catch (_e) {}
          });
          el.appendChild(btn);
          wait = TOAST_ACTION_MS;
        }
      } catch (e) {}
      el.classList.add("show");
      if (toastTimer) {
        clearTimeout(toastTimer);
      }
      toastTimer = setTimeout(() => {
        try {
          el.classList.remove("show");
        } catch (e) {}
        toastTimer = null;
      }, wait);
    } catch (e) {}
  }

  function cleanup() {
    // Shutdown net first: capture changed workspaces while gBrowser still
    // exists (quit is the last chance; changed-gating keeps quiet
    // shutdowns write-free).
    try {
      captureChangedWorkspaces();
    } catch (e) {}
    try {
      if (autoTimer !== null && autoTimer !== undefined) {
        clearTimeout(autoTimer);
      }
    } catch (e) {}
    autoTimer = null;
    try {
      if (eventTimers) {
        for (const k of Object.keys(eventTimers)) {
          try {
            if (eventTimers[k]) {
              clearTimeout(eventTimers[k]);
            }
          } catch (e) {}
        }
      }
    } catch (e) {}
    eventTimers = null;
    try {
      if (startupTimer) {
        clearTimeout(startupTimer);
      }
    } catch (e) {}
    startupTimer = null;
    try {
      if (gBrowser && gBrowser.tabContainer) {
        if (tabCloseHook) {
          try {
            gBrowser.tabContainer.removeEventListener("TabClose", tabCloseHook);
          } catch (e) {}
        }
        if (groupHook) {
          for (const t of [
            "TabGroupCreate",
            "TabGroupUpdate",
            "TabGroupRemoved",
            "TabGroupCollapse",
            "TabGroupExpand",
            "TabGroupMoved",
          ]) {
            try {
              gBrowser.tabContainer.removeEventListener(t, groupHook);
            } catch (e) {}
          }
        }
      }
    } catch (e) {}
    tabCloseHook = null;
    groupHook = null;
    try {
      if (startupObserver && Services.obs) {
        Services.obs.removeObserver(
          startupObserver,
          "sessionstore-windows-restored"
        );
      }
    } catch (e) {}
    startupObserver = null;
    try {
      if (prefsObserver) {
        Services.prefs.removeObserver(PREF, prefsObserver);
      }
    } catch (e) {}
    prefsObserver = null;
    try {
      if (snapPrefsObserver) {
        Services.prefs.removeObserver(SNAP_PREF, snapPrefsObserver);
      }
    } catch (e) {}
    snapPrefsObserver = null;
    try {
      stopStashSweeper();
    } catch (e) {}
    try {
      stopSlowSweeper();
    } catch (e) {}
    try {
      if (closeHook && window) {
        try {
          window.removeEventListener("close", closeHook);
        } catch (e) {}
      }
    } catch (e) {}
    closeHook = null;
    try {
      if (quitObserver && Services.obs) {
        try {
          Services.obs.removeObserver(quitObserver, "quit-application");
        } catch (e) {}
        try {
          Services.obs.removeObserver(quitObserver, "browser-window-before-close");
        } catch (e) {}
      }
    } catch (e) {}
    quitObserver = null;
    try {
      Services.obs.removeObserver(restoreObserver, OBS_RESTORE);
    } catch (e) {}
    try {
      const menu = document.getElementById("tabContextMenu");
      if (menu) {
        menu.removeEventListener("popupshowing", onTabMenuShowing);
      }
    } catch (e) {}
    try {
      if (menuItem && menuItem.parentNode) {
        menuItem.remove();
      }
    } catch (e) {}
    menuItem = null;
    try {
      if (toastTimer) {
        clearTimeout(toastTimer);
        toastTimer = null;
      }
    } catch (e) {}
  }

  function init() {
    try {
      window.AphStash = {
        stashTabs,
        stashTab,
        stashCurrent,
        pendingStashCount,
        autoStashSweep,
        scheduleAutoStashSweep,
        getStashEntries,
        restoreStashEntry,
        deleteStashEntry,
        openStash,
        isStashable,
        // Workspace snapshots ("stashes") — see SNAPSHOT_PREF below.
        saveStash,
        listStashes,
        restoreStash,
        restoreStashTab,
        deleteStash,
        autoStashTabs,
        autoStashSweepNow,
        confirmBulkClose,
        undoSafetyStash,
        renameStash,
        updateStash,
        safetyThreshold,
        getMaxAuto,
        getKeepDailies,
        autoStashTick,
        autoStashSlowTick,
        captureChangedWorkspaces,
        sweepWorkspace,
        sweepDueWorkspace,
        sweepSlowWorkspace,
        sweepWorkspaceEvent,
        queueEventCapture,
        notifyWorkspaceSwitch,
        // Test + diagnosis surface (not user-facing).
        debugSnapshots: () => {
          try {
            return {
              lastEventCapture: lastEventCapture
                ? JSON.parse(JSON.stringify(lastEventCapture))
                : {},
              eventCooldownMs: eventCooldownMs(),
            };
          } catch (e) {
            return { lastEventCapture: {}, eventCooldownMs: 0 };
          }
        },
      };
    } catch (e) {}
    try {
      prefsObserver = {
        observe() {
          try {
            cache = null;
          } catch (e) {}
        },
      };
      Services.prefs.addObserver(PREF, prefsObserver);
    } catch (e) {
      prefsObserver = null;
    }
    try {
      snapPrefsObserver = {
        observe() {
          try {
            snapCache = null;
          } catch (e) {}
        },
      };
      Services.prefs.addObserver(SNAP_PREF, snapPrefsObserver);
    } catch (e) {
      snapPrefsObserver = null;
    }
    // Periodic workspace capture (off via aph.stash.snapshots.autoEnabled, or
    // skipped when nothing moved since the last auto stash).
    try {
      startStashSweeper();
    } catch (e) {}
    // Slow backstop (fixed 6h, selection-blind changed gate).
    try {
      startSlowSweeper();
    } catch (e) {}
    // Dedicated window-close net (earlier than unload; changed-gated so
    // the later unload pass stays quiet when close already captured).
    try {
      closeHook = onStashWindowClose;
      if (window && typeof window.addEventListener === "function") {
        window.addEventListener("close", closeHook);
      }
    } catch (e) {}
    try {
      if (Services.obs) {
        quitObserver = {
          observe() {
            try {
              onStashWindowClose();
            } catch (e) {}
          },
        };
        try {
          Services.obs.addObserver(quitObserver, "quit-application", false);
        } catch (e) {}
        try {
          Services.obs.addObserver(quitObserver, "browser-window-before-close", false);
        } catch (e) {}
      }
    } catch (e) {
      quitObserver = null;
    }
    try {
      Services.obs.addObserver(restoreObserver, OBS_RESTORE, false);
    } catch (e) {}
    // Event-driven captures: closes + group edits queue a debounced
    // changed-gated capture; startup schedules one delayed safety net.
    // All fail-silent when containers/observers are missing (tests).
    try {
      if (gBrowser && gBrowser.tabContainer) {
        tabCloseHook = onStashTabClose;
        try {
          gBrowser.tabContainer.addEventListener("TabClose", tabCloseHook);
        } catch (e) {}
        groupHook = onStashGroupChange;
        for (const t of [
          "TabGroupCreate",
          "TabGroupUpdate",
          "TabGroupRemoved",
          "TabGroupCollapse",
          "TabGroupExpand",
          "TabGroupMoved",
        ]) {
          try {
            gBrowser.tabContainer.addEventListener(t, groupHook);
          } catch (e) {}
        }
      }
    } catch (e) {}
    try {
      if (Services.obs) {
        startupObserver = {
          observe() {
            try {
              Services.obs.removeObserver(
                startupObserver,
                "sessionstore-windows-restored"
              );
            } catch (e) {}
            startupObserver = null;
            scheduleStartupCapture();
          },
        };
        Services.obs.addObserver(
          startupObserver,
          "sessionstore-windows-restored",
          false
        );
      }
    } catch (e) {
      startupObserver = null;
    }
    try {
      scheduleStartupCapture();
    } catch (e) {}
    try {
      const menu = document.getElementById("tabContextMenu");
      if (menu && typeof menu.addEventListener === "function") {
        menu.addEventListener("popupshowing", onTabMenuShowing);
      }
    } catch (e) {}
    try {
      window.addEventListener("unload", cleanup, { once: true });
    } catch (e) {}
  }

  if (document.readyState === "complete") {
    init();
  } else {
    window.addEventListener("load", init, { once: true });
  }
})();
