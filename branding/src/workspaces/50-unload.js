  // Tab unloading (memory): discard eligible tabs via gBrowser.discardBrowser
  // (tab element + aphWs tag survive; selecting reloads). Scopes:
  // "foreign" (hidden workspaces, no staleness — manual palette command),
  // "workspace" (one workspace, dock menu), "auto" (every workspace except
  // the selected tab, filtered by staleness — the automatic sweeper).
  // All guards fail closed — when in doubt, keep the tab loaded.
  const UNLOAD_AUTO_PREF = "aph.unload.autoEnabled";
  const UNLOAD_STALE_PREF = "aph.unload.staleMin";
  const UNLOAD_LOWMEM_PREF = "aph.unload.onLowMemory";
  const UNLOAD_STALE_DEFAULT_MIN = 30;
  // Oldest-first sweep cap (Firefox priority-queue shape): one sweep
  // unloads at most this many tabs, oldest-viewed first; the rest wait for
  // the next sweep. Bounds first-enable storms, never binds steady state.
  // A constant, not a pref — one fewer knob for the same behavior.
  const UNLOAD_SWEEP_CAP = 25;

  function unloadLog(msg) {
    try {
      Services.console.logStringMessage(`[AphUnload] ${msg}`);
    } catch (e) {}
  }

  function getUnloadAutoEnabled() {
    try {
      if (!Services.prefs || typeof Services.prefs.getBoolPref !== "function") {
        return false;
      }
      return !!Services.prefs.getBoolPref(UNLOAD_AUTO_PREF);
    } catch (e) {
      return false;
    }
  }

  function getUnloadOnLowMemory() {
    try {
      if (!Services.prefs || typeof Services.prefs.getBoolPref !== "function") {
        return true;
      }
      return !!Services.prefs.getBoolPref(UNLOAD_LOWMEM_PREF);
    } catch (e) {
      return true;
    }
  }

  // Staleness threshold for the automatic sweeper: minutes (pref
  // aph.unload.staleMin, default 30), read live so about:config flips apply
  // to the next sweep. Separate from aph.archive.autoStaleMin on purpose:
  // unloading is cheap and reversible (click reloads) while archiving
  // closes the tab, so they deserve different thresholds. Pair them as
  // unload < archive so tabs discard before they close.
  function getUnloadStaleMs() {
    try {
      if (Services.prefs && typeof Services.prefs.getIntPref === "function") {
        const m = Services.prefs.getIntPref(UNLOAD_STALE_PREF);
        if (Number.isFinite(m)) {
          return Math.max(0, m) * 60000;
        }
      }
    } catch (e) {}
    return UNLOAD_STALE_DEFAULT_MIN * 60000;
  }

  // Last-viewed read for staleness: SessionStore custom tab value
  // "aphLastViewed" (ms epoch, stamped by the workspaces bundle on
  // TabSelect/TabOpen — key duplicated here by design, same pattern as
  // "aphStarred" and archive.js). Missing/unreadable/malformed reads as 0
  // (epoch): untracked tabs count as stale.
  const UNLOAD_LAST_VIEWED_KEY = "aphLastViewed";

  function readUnloadLastViewed(tab) {
    try {
      if (SessionStore && typeof SessionStore.getCustomTabValue === "function") {
        const v = SessionStore.getCustomTabValue(tab, UNLOAD_LAST_VIEWED_KEY);
        const n = typeof v === "string" || typeof v === "number" ? Number(v) : NaN;
        if (Number.isFinite(n) && n > 0) {
          return n;
        }
      }
    } catch (e) {}
    return 0;
  }

  // Lowercase host of a tab ("mail.google.com"), "" when unreadable.
  // Port never survives (the match stops at ":"), scheme required.
  function unloadTabHost(tab) {
    try {
      let spec = null;
      try {
        spec = tab.linkedBrowser?.currentURI?.spec;
      } catch (e) {
        return "";
      }
      if (typeof spec !== "string") {
        return "";
      }
      const m = /^[a-z0-9+.-]+:\/\/([^/:?#]+)/i.exec(spec);
      if (!m) {
        return "";
      }
      return m[1].toLowerCase();
    } catch (e) {
      return "";
    }
  }

  // Auto-only eligibility: the manual guards plus the starred exemption
  // and staleness. Starred tabs are user-marked keepers
  // (archive.js already exempts them); manual scopes stay a force tool and
  // skip both filters.
  // nowMs/staleMs are parameters so tests can drive time deterministically;
  // callers that pass nothing get live values.
  function isAutoUnloadEligible(tab, nowMs, staleMs) {
    try {
      if (!canUnloadTab(tab).ok) {
        return false;
      }
      try {
        if (typeof isStarredForPark === "function" && isStarredForPark(tab)) {
          return false;
        }
      } catch (e) {}
      let now = nowMs;
      if (!Number.isFinite(now)) {
        try {
          now = Date.now();
        } catch (e) {
          return false;
        }
      }
      let stale = staleMs;
      if (!Number.isFinite(stale)) {
        try {
          stale = getUnloadStaleMs();
        } catch (e) {
          return false;
        }
      }
      try {
        if (now - readUnloadLastViewed(tab) < stale) {
          return false;
        }
      } catch (e) {}
      return true;
    } catch (e) {
      return false;
    }
  }

  // Never unload if any guard holds: selected (visible page), pinned (app
  // anchor), audible media, active load, WebRTC sharing, already pending,
  // unsaved work (beforeunload), internal pages, or unreadable URL.
  // Deliberately NOT covered (spike outcome): paused-but-present media and
  // dirty-forms-without-beforeunload have no reliable synchronous
  // chrome-side signal — probing them would be heuristic guesswork with
  // false positives in both directions. Sites that care about either set
  // beforeunload (guarded) or play audibly (guarded); everything
  // else unloads — no per-site exception list by design.
  function canUnloadTab(tab) {
    try {
      if (!tab) {
        return { ok: false, reason: "no-tab" };
      }
      try {
        if (tab.closing) {
          return { ok: false, reason: "closing" };
        }
      } catch (e) {}
      try {
        if (tab.selected) {
          return { ok: false, reason: "selected" };
        }
      } catch (e) {}
      try {
        if (gBrowser.selectedTab === tab) {
          return { ok: false, reason: "selected" };
        }
      } catch (e) {}
      try {
        if (tab.pinned) {
          return { ok: false, reason: "pinned" };
        }
      } catch (e) {}
      try {
        if (tab.soundPlaying || tab.audible) {
          return { ok: false, reason: "audio" };
        }
      } catch (e) {}
      try {
        if (tab.busy) {
          return { ok: false, reason: "loading" };
        }
      } catch (e) {}
      try {
        if (tab.linkedBrowser?._sharingState?.webRTC?.sharing) {
          return { ok: false, reason: "sharing" };
        }
      } catch (e) {}
      try {
        if (typeof tab.hasAttribute === "function" && tab.hasAttribute("pending")) {
          return { ok: false, reason: "pending" };
        }
      } catch (e) {}
      try {
        if (tab.linkedBrowser?.frameLoader?.tabParent?.hasBeforeUnload) {
          return { ok: false, reason: "beforeunload" };
        }
      } catch (e) {}
      let spec;
      try {
        spec = tab.linkedBrowser?.currentURI?.spec;
      } catch (e) {
        return { ok: false, reason: "unknown-url" };
      }
      if (typeof spec !== "string" || !spec) {
        return { ok: false, reason: "unknown-url" };
      }
      if (spec.startsWith("about:") || spec.startsWith("chrome:") || spec.startsWith("resource:")) {
        return { ok: false, reason: "internal" };
      }
      try {
        if (isNewTab(tab)) {
          return { ok: false, reason: "newtab" };
        }
      } catch (e) {}
      return { ok: true };
    } catch (e) {
      return { ok: false, reason: "error" };
    }
  }

  // Discard eligible tabs in scope ("foreign" = hidden workspaces only, no
  // staleness; "workspace" = one workspace, dock menu; "auto" = every
  // workspace, staleness-filtered — the automatic sweeper).
  // Auto sweeps run oldest-viewed-first under a per-sweep cap (Firefox
  // priority-queue shape): `due` reports the full eligible count so the
  // log line can say how many wait for the next sweep. Dry runs count the
  // full eligible set (the cap binds discards, not counting).
  // Synchronous loop: discardBrowser itself is cheap (teardown is async in
  // Gecko), so counts are exact on return. One failure never aborts the sweep.
  function unloadEligibleTabs(opts) {
    const scope = (opts && opts.scope) || "foreign";
    const dryRun = !!(opts && opts.dryRun);
    try {
      if (typeof navigator !== "undefined" && navigator.onLine === false) {
        return { unloaded: 0, skipped: 0, reason: "offline" };
      }
    } catch (e) {}
    if (typeof gBrowser.discardBrowser !== "function") {
      return { unloaded: 0, skipped: 0, reason: "no-api" };
    }
    let tabs = [];
    try {
      tabs = Array.from(gBrowser.tabs);
    } catch (e) {
      return { unloaded: 0, skipped: 0, reason: "no-tabs" };
    }
    const auto = scope === "auto";
    let autoNow = NaN;
    let autoStale = NaN;
    if (auto) {
      try {
        autoNow =
          opts && Number.isFinite(opts.nowMs) ? opts.nowMs : Date.now();
      } catch (e) {
        autoNow = NaN;
      }
      try {
        autoStale =
          opts && Number.isFinite(opts.staleMs) ? opts.staleMs : getUnloadStaleMs();
      } catch (e) {
        autoStale = NaN;
      }
    }
    // Auto scope pre-passes into an oldest-first queue; manual scopes keep
    // strip order (small, explicit, immediate).
    let queue = null;
    if (auto) {
      queue = [];
      for (const t of tabs) {
        try {
          if (isAutoUnloadEligible(t, autoNow, autoStale)) {
            queue.push(t);
          }
        } catch (e) {}
      }
      try {
        queue.sort((a, b) => readUnloadLastViewed(a) - readUnloadLastViewed(b));
      } catch (e) {}
    }
    let unloaded = 0;
    let skipped = 0;
    let due = 0;
    if (auto) {
      due = queue.length;
      const cap =
        opts && Number.isFinite(opts.cap) && opts.cap >= 0
          ? Math.floor(opts.cap)
          : UNLOAD_SWEEP_CAP;
      const victims = queue.slice(0, cap);
      for (const t of victims) {
        try {
          if (dryRun) {
            unloaded++;
            continue;
          }
          gBrowser.discardBrowser(t);
          // Discarded reload must not re-trigger domain routing.
          try {
            t.__aphFresh = false;
          } catch (e) {}
          unloaded++;
        } catch (e) {
          skipped++;
        }
      }
      // Ineligible tabs plus eligible-but-capped ones count as skipped
      // context for the log line (the cap binds discards, not counting).
      skipped += Math.max(0, tabs.length - victims.length);
      const deferred = Math.max(0, due - victims.length);
      if (unloaded > 0 && !dryRun) {
        unloadLog(
          `sweep scope=auto: ${unloaded} unloaded, ${skipped} guarded` +
            (deferred > 0 ? `, ${deferred} deferred to next sweep` : "")
        );
      }
      return { unloaded, skipped, due, deferred };
    }
    for (const t of tabs) {
      try {
        if (scope === "foreign" && getWs(t) === current) {
          continue;
        }
        // Dock "Unload Inactive Tabs": one workspace only. Unknown or
        // missing ws fails closed (nothing unloads).
        if (scope === "workspace") {
          const only = opts && opts.ws;
          if (!isValidId(only) || getWs(t) !== only) {
            continue;
          }
        }
        const c = canUnloadTab(t);
        if (!c.ok) {
          skipped++;
          continue;
        }
        if (dryRun) {
          unloaded++;
          continue;
        }
        gBrowser.discardBrowser(t);
        // Discarded reload must not re-trigger domain routing.
        try {
          t.__aphFresh = false;
        } catch (e) {}
        unloaded++;
      } catch (e) {
        skipped++;
      }
    }
    if (unloaded > 0 && !dryRun) {
      unloadLog(`sweep scope=${scope}: ${unloaded} unloaded, ${skipped} guarded`);
    }
    return { unloaded, skipped };
  }

  // Diagnostic queue for the palette (about:unloads-lite): every tab the
  // next auto sweep would unload, oldest first, as plain info objects.
  // Read-only — never discards. `limit` caps the returned list (default
  // 10); `total` always reports the full due count.
  function unloadCandidates(limit) {
    const out = { total: 0, list: [] };
    try {
      let tabs = [];
      try {
        tabs = Array.from(gBrowser.tabs || []);
      } catch (e) {
        return out;
      }
      let now = NaN;
      let stale = NaN;
      try {
        now = Date.now();
      } catch (e) {}
      try {
        stale = getUnloadStaleMs();
      } catch (e) {}
      const q = [];
      for (const t of tabs) {
        try {
          if (isAutoUnloadEligible(t, now, stale)) {
            let title = "";
            let host = "";
            let ws = "";
            try {
              title = String(t.label || "");
            } catch (e) {}
            try {
              host = unloadTabHost(t);
            } catch (e) {}
            try {
              ws = getWs(t);
            } catch (e) {}
            q.push({ title, host, ws, lastViewed: readUnloadLastViewed(t) });
          }
        } catch (e) {}
      }
      try {
        q.sort((a, b) => a.lastViewed - b.lastViewed);
      } catch (e) {}
      out.total = q.length;
      const n =
        limit === undefined || limit === null
          ? 10
          : Math.max(0, Math.floor(Number(limit)));
      out.list = q.slice(0, Number.isFinite(n) ? n : 10);
    } catch (e) {}
    return out;
  }

  // Single-tab unload (palette "Unload Current Tab", tab context menu):
  // guards via canUnloadTab, then discard. Stock refuses the SELECTED tab
  // even forced (tabbrowser.js _mayDiscardBrowser), so selection moves to
  // a visible neighbor first — the focus jump mirrors a close, same as
  // pin/star parking below. Sole-visible-tab and guarded tabs fail with a
  // reason instead of silently doing nothing (the old palette command
  // ignored discardBrowser's false and dead-buttoned).
  function unloadSingleTab(tab) {
    try {
      if (!tab) {
        return { ok: false, reason: "no-tab" };
      }
      try {
        if (tab.closing) {
          return { ok: false, reason: "closing" };
        }
      } catch (e) {}
      // Selected first (before the guards — canUnloadTab spares selected):
      // claim a neighbor so the discard has somewhere to leave focus.
      try {
        let isSel = false;
        try {
          isSel = !!tab.selected;
        } catch (e) {}
        try {
          isSel = isSel || gBrowser.selectedTab === tab;
        } catch (e) {}
        if (isSel) {
          const next =
            typeof findParkNeighbor === "function" ? findParkNeighbor(tab) : null;
          if (!next) {
            return { ok: false, reason: "only-tab" };
          }
          try {
            gBrowser.selectedTab = next;
          } catch (e) {
            return { ok: false, reason: "no-select" };
          }
        }
      } catch (e) {
        return { ok: false, reason: "no-select" };
      }
      const c = canUnloadTab(tab);
      if (!c.ok) {
        return { ok: false, reason: c.reason || "guarded" };
      }
      if (typeof gBrowser.discardBrowser !== "function") {
        return { ok: false, reason: "no-api" };
      }
      let discarded = false;
      try {
        discarded = gBrowser.discardBrowser(tab) !== false;
      } catch (e) {
        discarded = false;
      }
      if (!discarded) {
        try {
          gBrowser.selectedTab = tab;
        } catch (_e) {}
        return { ok: false, reason: "discard-refused" };
      }
      // Discarded reload must not re-trigger domain routing.
      try {
        tab.__aphFresh = false;
      } catch (e) {}
      return { ok: true };
    } catch (e) {
      return { ok: false, reason: "error" };
    }
  }

  // Settle delay (the time-based foundation, same shape as archive.js):
  // the switch hook does not sweep instantly — it arms this, and every
  // further switch re-arms it, so the sweep only fires once you've sat on
  // one workspace for the full delay. Guards + the hidden set re-check at
  // fire time, so a stale timer can never unload a tab you came back to.
  // When auto-unload is on the sweep runs scope "auto" (staleness covers
  // hidden and idle-current tabs alike); with it off nothing sweeps.
  const UNLOAD_SETTLE_MS = 15000;
  let unloadSettleTimer = null;

  // (Re-)arm the settle timer. True when a sweep is now pending, false
  // when auto-unload is off (or timers are unavailable, as in the
  // node:vm harness where setTimeout is stubbed to 0).
  function scheduleUnloadSweep() {
    try {
      if (unloadSettleTimer !== null && unloadSettleTimer !== undefined) {
        try {
          clearTimeout(unloadSettleTimer);
        } catch (e) {}
        unloadSettleTimer = null;
      }
      if (!getUnloadAutoEnabled()) {
        return false;
      }
      try {
        if (typeof setTimeout !== "function") {
          return false;
        }
      } catch (e) {
        return false;
      }
      unloadSettleTimer = setTimeout(() => {
        unloadSettleTimer = null;
        try {
          unloadEligibleTabs({ scope: "auto" });
        } catch (e) {}
      }, UNLOAD_SETTLE_MS);
      return unloadSettleTimer !== null && unloadSettleTimer !== undefined;
    } catch (e) {
      return false;
    }
  }

  // Periodic idle sweeper: every UNLOAD_INTERVAL_MS, unload stale tabs
  // (scope "auto") when the master toggle is on. Cheap no-op otherwise —
  // the pref + offline + API guards re-check at fire time. Started once
  // from init(), stopped on window unload.
  const UNLOAD_INTERVAL_MS = 5 * 60 * 1000;
  let unloadIntervalId = null;

  function startUnloadSweeper() {
    try {
      if (unloadIntervalId !== null && unloadIntervalId !== undefined) {
        return true;
      }
      try {
        if (typeof setInterval !== "function") {
          return false;
        }
      } catch (e) {
        return false;
      }
      unloadIntervalId = setInterval(() => {
        try {
          if (!getUnloadAutoEnabled()) {
            return;
          }
          unloadEligibleTabs({ scope: "auto" });
        } catch (e) {}
      }, UNLOAD_INTERVAL_MS);
      return unloadIntervalId !== null && unloadIntervalId !== undefined;
    } catch (e) {
      return false;
    }
  }

  function stopUnloadSweeper() {
    try {
      if (unloadSettleTimer !== null && unloadSettleTimer !== undefined) {
        try {
          clearTimeout(unloadSettleTimer);
        } catch (e) {}
      }
    } catch (e) {}
    unloadSettleTimer = null;
    try {
      if (unloadIntervalId !== null && unloadIntervalId !== undefined) {
        try {
          clearInterval(unloadIntervalId);
        } catch (e) {}
      }
    } catch (e) {}
    unloadIntervalId = null;
  }

  // Low-memory hook: a memory-pressure notification unloads stale tabs once
  // (scope "auto", guards re-check at fire time). Behind
  // aph.unload.onLowMemory (default on — the guard set already protects
  // media, WebRTC, loads and unsaved work, so an extra sweep is safe).
  let unloadMemObserver = null;

  function initUnloadLowMemory() {
    try {
      if (unloadMemObserver) {
        return true;
      }
      if (!Services.obs || typeof Services.obs.addObserver !== "function") {
        return false;
      }
      const obs = {
        observe(_subject, topic) {
          try {
            if (typeof topic === "string" && topic.indexOf("memory-pressure") === -1) {
              return;
            }
            if (!getUnloadOnLowMemory()) {
              return;
            }
            unloadEligibleTabs({ scope: "auto" });
          } catch (e) {}
        },
      };
      try {
        Services.obs.addObserver(obs, "memory-pressure");
      } catch (e) {
        return false;
      }
      unloadMemObserver = obs;
      return true;
    } catch (e) {
      return false;
    }
  }

  function cleanupUnloadLowMemory() {
    try {
      if (unloadMemObserver && Services.obs && typeof Services.obs.removeObserver === "function") {
        try {
          Services.obs.removeObserver(unloadMemObserver, "memory-pressure");
        } catch (e) {}
      }
    } catch (e) {}
    unloadMemObserver = null;
    stopUnloadSweeper();
  }

  // Ctrl/Cmd+W on a selected pinned tab keeps it open (pref
  // aph.pins.ctrlWUnloads, default on — same default-true shape as
  // silenceFirstRun): pins are app anchors. A drifted pin first resets to
  // its pinned base URL in place (stay selected, no unload — next press,
  // now at base, parks); a pin already at base parks (unloads) instead of
  // closing; a second press (now pending) falls through to stock close, as
  // do middle-click and the context menu. Stock refuses to discard the
  // SELECTED tab even forced (tabbrowser.js _mayDiscardBrowser), so parking
  // moves selection to a visible neighbor first — the focus jump mirrors a
  // close. Anything where a discard would silently lose state or no-op
  // falls through to stock (which prompts or closes): unsaved work,
  // already-pending, internal pages, sole-visible-tab windows,
  // multiselections.
  const PIN_PARK_PREF = "aph.pins.ctrlWUnloads";

  function getCtrlWParksPinned() {
    try {
      if (Services.prefs && typeof Services.prefs.getBoolPref === "function") {
        return Services.prefs.getBoolPref(PIN_PARK_PREF);
      }
    } catch (e) {}
    return true;
  }

  // Next visible tab after `tab` in strip order, else the nearest visible
  // tab before it. Hidden (foreign-workspace), closing,
  // and the tab itself never qualify. Null when nothing else is visible.
  function findParkNeighbor(tab) {
    try {
      let tabs = [];
      try {
        tabs = Array.from(gBrowser.tabs || []);
      } catch (e) {
        return null;
      }
      const at = tabs.indexOf(tab);
      if (at === -1) {
        return null;
      }
      const visible = (t) => {
        try {
          if (!t || t === tab || t.closing) {
            return false;
          }
        } catch (e) {
          return false;
        }
        try {
          if (t.hidden) {
            return false;
          }
        } catch (e) {}
        try {
          if (typeof t.hasAttribute === "function" && t.hasAttribute("hidden")) {
            return false;
          }
        } catch (e) {}
        return true;
      };
      for (let i = at + 1; i < tabs.length; i++) {
        try {
          if (visible(tabs[i])) {
            return tabs[i];
          }
        } catch (e) {}
      }
      for (let i = at - 1; i >= 0; i--) {
        try {
          if (visible(tabs[i])) {
            return tabs[i];
          }
        } catch (e) {}
      }
    } catch (e) {}
    return null;
  }

  // Ctrl/Cmd+W on a selected STARRED tab mirrors pins (pref
  // aph.stars.ctrlWUnloads, default on): starred tabs are normal
  // per-workspace tabs with a base URL owned by 76-starred.js. A drifted
  // star first resets to its starred base URL in place (stay selected, no
  // unload — next press, now at base, parks); a star already at base parks
  // (unloads) instead of closing; a second press (now pending) falls
  // through to stock close. Same guards as pins: unsaved work,
  // already-pending, internal pages, sole-visible-tab windows,
  // multiselections. Pinned tabs never reach here (pin park runs first).
  const STAR_PARK_PREF = "aph.stars.ctrlWUnloads";

  function getCtrlWParksStarred() {
    try {
      if (Services.prefs && typeof Services.prefs.getBoolPref === "function") {
        return Services.prefs.getBoolPref(STAR_PARK_PREF);
      }
    } catch (e) {}
    return true;
  }

  // 76-starred.js loads after this file in the bundle; resolve through
  // typeof guards so a missing star module fails closed to stock close.
  function isStarredForPark(tab) {
    try {
      if (typeof isStarredTab === "function") {
        return !!isStarredTab(tab);
      }
    } catch (e) {}
    try {
      if (SessionStore && typeof SessionStore.getCustomTabValue === "function") {
        if (SessionStore.getCustomTabValue(tab, "aphStarred") === "1") {
          return true;
        }
      }
    } catch (e) {}
    try {
      if (tab && typeof tab.hasAttribute === "function" && tab.hasAttribute("data-aph-starred")) {
        return true;
      }
    } catch (e) {}
    return false;
  }

  // Shared Ctrl+W park for owned-base-URL tabs (pins + stars): guards,
  // drift-reset-in-place, then neighbor-select + discard. checkOwned(sel)
  // returns a reason string when the tab isn't eligible, null when it is
  // (each kind keeps its own check order); getTarget/doReset carry the
  // kind's base-URL accessors with the usual typeof guards (50 loads
  // before 75/76).
  function parkSelectedOwnedTab(prefOn, checkOwned, getTarget, doReset) {
    try {
      if (!prefOn()) {
        return { ok: false, reason: "disabled" };
      }
      let sel = null;
      try {
        sel = gBrowser.selectedTab;
      } catch (e) {}
      if (!sel) {
        return { ok: false, reason: "no-tab" };
      }
      try {
        if (sel.closing) {
          return { ok: false, reason: "closing" };
        }
      } catch (e) {}
      const notOwned = checkOwned(sel);
      if (notOwned) {
        return { ok: false, reason: notOwned };
      }
      // Multiselection closes as a unit in stock — never half-park it.
      try {
        const multi = gBrowser.selectedTabs || gBrowser.multiselectedTabs || null;
        if (Array.isArray(multi) && multi.length > 1) {
          return { ok: false, reason: "multi" };
        }
      } catch (e) {}
      // Already parked: let stock close (second press closes).
      try {
        if (typeof sel.hasAttribute === "function" && sel.hasAttribute("pending")) {
          return { ok: false, reason: "pending" };
        }
      } catch (e) {}
      // Unsaved work: non-force discard would not prompt, so fall through
      // to stock close, which does.
      try {
        if (sel.linkedBrowser?.frameLoader?.tabParent?.hasBeforeUnload) {
          return { ok: false, reason: "beforeunload" };
        }
      } catch (e) {}
      let spec = null;
      try {
        spec = sel.linkedBrowser?.currentURI?.spec;
      } catch (e) {}
      if (typeof spec !== "string" || !spec) {
        return { ok: false, reason: "unknown-url" };
      }
      if (
        spec.startsWith("about:") ||
        spec.startsWith("chrome:") ||
        spec.startsWith("resource:")
      ) {
        return { ok: false, reason: "internal" };
      }
      try {
        if (isNewTab(sel)) {
          return { ok: false, reason: "newtab" };
        }
      } catch (e) {}
      // Drifted base: reset to the base URL in place (stay selected, no
      // unload) and claim the keystroke. Runs after the guards above so
      // unsaved work still falls through to stock (which prompts) and
      // internal pages never navigate; runs before the neighbor check so
      // a sole-tab owned tab can still reset. Reset-then-discard in one
      // press is deliberately avoided: the fresh navigation would race
      // the discard (which tears down the load), so park happens on the
      // next press, once at base.
      try {
        const target = getTarget(sel);
        if (target && spec && target !== spec) {
          try {
            doReset(sel);
          } catch (_e) {}
          // Reset navigation must not re-trigger domain routing.
          try {
            sel.__aphFresh = false;
          } catch (_e) {}
          return { ok: true, reset: true };
        }
      } catch (e) {}
      const next = findParkNeighbor(sel);
      if (!next) {
        return { ok: false, reason: "only-tab" };
      }
      if (typeof gBrowser.discardBrowser !== "function") {
        return { ok: false, reason: "no-api" };
      }
      try {
        gBrowser.selectedTab = next;
      } catch (e) {
        return { ok: false, reason: "no-select" };
      }
      let discarded = false;
      try {
        // Stock returns false on refusal, undefined on success.
        discarded = gBrowser.discardBrowser(sel) !== false;
      } catch (e) {
        discarded = false;
      }
      if (!discarded) {
        try {
          gBrowser.selectedTab = sel;
        } catch (_e) {}
        return { ok: false, reason: "discard-refused" };
      }
      // Discarded reload must not re-trigger domain routing.
      try {
        sel.__aphFresh = false;
      } catch (e) {}
      return { ok: true };
    } catch (e) {
      return { ok: false, reason: "error" };
    }
  }

  function parkSelectedStarredTab() {
    return parkSelectedOwnedTab(
      getCtrlWParksStarred,
      (sel) => {
        try {
          if (sel.pinned) {
            return "pinned";
          }
        } catch (e) {}
        if (!isStarredForPark(sel)) {
          return "not-starred";
        }
        return null;
      },
      (sel) => (typeof effectiveStarURL === "function" ? effectiveStarURL(sel) : ""),
      (sel) => {
        if (typeof resetStarTab === "function") {
          resetStarTab(sel);
        }
      }
    );
  }

  function parkSelectedPinnedTab() {
    return parkSelectedOwnedTab(
      getCtrlWParksPinned,
      (sel) => {
        try {
          if (!sel.pinned) {
            return "not-pinned";
          }
        } catch (e) {
          return "not-pinned";
        }
        return null;
      },
      (sel) => (typeof effectivePinURL === "function" ? effectivePinURL(sel) : ""),
      (sel) => {
        if (typeof resetPinTab === "function") {
          resetPinTab(sel);
        }
      }
    );
  }

