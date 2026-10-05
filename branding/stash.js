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
    const pruned = L ? L.pruneSnapshots(list) : (list || []).slice(0, 20);
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

  // Live tabs that a stash of `target` would capture: untagged-ish pages
  // only, pins and internal pages excluded, de-duplicated by URL.
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
          picked.push({
            title: String(t.label || "") || url,
            url,
            cid: Number(t.userContextId) || 0,
          });
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
  // workspace once with the first tab selected. Nothing is ever closed,
  // so a stale stash can only ever add tabs, never lose work. URLs
  // already open in the target workspace are skipped (counted, never
  // duplicated); containers that no longer exist fall back to unbound
  // and are counted. Result: {ok, opened, skipped, unbound} (+reason
  // when !ok). A short summary toast confirms what landed.
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
      for (const t of entry.tabs || []) {
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
          present.add(url);
          opened++;
          if (!first) {
            first = tab;
          }
        } catch (e) {}
      }
      if (!opened && !skipped) {
        return { ok: false, reason: "open-failed", opened: 0, skipped: 0, unbound: 0 };
      }
      try {
        if (w && typeof w.switchTo === "function" && w.getCurrent && w.getCurrent() !== target) {
          w.switchTo(target);
        }
      } catch (e) {}
      try {
        if (first) {
          gBrowser.showTab(first);
          gBrowser.selectedTab = first;
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
          picked.push({
            title: String(t.label || "") || url,
            url,
            cid: Number(t.userContextId) || 0,
          });
        } catch (e) {}
      }
      if (!picked.length) {
        return { ok: false, reason: "empty", count: 0 };
      }
      entry.tabs = picked;
      entry.ts = Date.now();
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

  // Capture one workspace when its live URL set moved since its newest
  // auto capture. 1 = captured, 0 = nothing to do. No due-check here:
  // callers layer cadence (tick) or urgency (quit) on top.
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
      const now = urlSetOf(tabs);
      if (!now) {
        return 0;
      }
      const last = newestAutoStashFor(wsId);
      if (last) {
        // Stored tabs are plain {title,url,cid} records, so compare the
        // saved URL set directly rather than re-deriving it from live tabs.
        const prev = savedUrlSet(last);
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

  // Shutdown net (window unload): capture every workspace whose URL set
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
        autoStashTick,
        captureChangedWorkspaces,
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
    try {
      Services.obs.addObserver(restoreObserver, OBS_RESTORE, false);
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
