  // Tab unloading (memory): discard eligible tabs via gBrowser.discardBrowser
  // (tab element + aphWs tag survive; selecting reloads). V1 scope is hidden
  // foreign-workspace tabs only; current-WS idle timers are deferred to V2.
  // All guards fail closed — when in doubt, keep the tab loaded.
  const WS_UNLOAD_PREF = "aph.workspaces.unloadOnSwitch";

  function unloadLog(msg) {
    try {
      Services.console.logStringMessage(`[AphUnload] ${msg}`);
    } catch (e) {}
  }

  function getUnloadOnSwitch() {
    try {
      if (!Services.prefs || typeof Services.prefs.getBoolPref !== "function") {
        return false;
      }
      return !!Services.prefs.getBoolPref(WS_UNLOAD_PREF);
    } catch (e) {
      return false;
    }
  }

  // Never unload if any guard holds: selected (visible page), pinned (app
  // anchor), audible media, active load, WebRTC sharing, already pending,
  // unsaved work (beforeunload), internal pages, or unreadable URL.
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

  // Discard every eligible tab in scope ("foreign" = hidden workspaces only).
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
    let unloaded = 0;
    let skipped = 0;
    for (const t of tabs) {
      try {
        if (scope === "foreign" && getWs(t) === current) {
          continue;
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

