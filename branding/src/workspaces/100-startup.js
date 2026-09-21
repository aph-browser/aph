  // New windows (Ctrl+N) land on the lowest workspace no live window owns
  // instead of inheriting the source window's workspace (which would
  // collide under mutual exclusion). Stored value wins (session restore);
  // opener inherits only when it would not collide; else lowest-unowned.
  function initialWorkspace() {
    try {
      const w = SessionStore.getCustomWindowValue(window, WIN_KEY);
      if (isValidId(w)) {
        return w;
      }
    } catch (e) {}
    try {
      const op = window.opener;
      if (op && op !== window && !op.closed) {
        const ow = SessionStore.getCustomWindowValue(op, WIN_KEY);
        if (isValidId(ow)) {
          let collides = true;
          try {
            collides =
              typeof findWsOwner === "function" ? !!findWsOwner(ow) : true;
          } catch (_e) {
            collides = true;
          }
          if (!collides) {
            return ow;
          }
        }
      }
    } catch (e) {}
    try {
      if (typeof lowestUnownedWorkspace === "function") {
        const free = lowestUnownedWorkspace();
        if (isValidId(free)) {
          return free;
        }
      }
    } catch (e) {}
    try {
      if (typeof Services !== "undefined" && Services.wm) {
        const recent = Services.wm.getMostRecentWindow("navigator:browser");
        if (recent && recent !== window && !recent.closed) {
          const rw = SessionStore.getCustomWindowValue(recent, WIN_KEY);
          if (isValidId(rw)) {
            return rw;
          }
        }
        const en = Services.wm.getEnumerator("navigator:browser");
        while (en.hasMoreElements()) {
          const w = en.getNext();
          if (!w || w === window || w.closed) {
            continue;
          }
          try {
            const v = SessionStore.getCustomWindowValue(w, WIN_KEY);
            if (isValidId(v)) {
              return v;
            }
          } catch (_e) {}
        }
      }
    } catch (e) {}
    return "1";
  }

  // Startup: SessionStore restores window values + tab tags asynchronously,
  // so the value read in init() can miss. Re-read once session restore
  // finishes (observer) with a timeout fallback, then land on it.
  // Falls back to the restored selected tab's workspace when no value yet.
  function startupRestore() {
    let target = null;
    try {
      const w = SessionStore.getCustomWindowValue(window, WIN_KEY);
      if (isValidId(w)) {
        target = w;
      }
    } catch (e) {}
    if (!target) {
      try {
        const sel = gBrowser.selectedTab;
        const sw = sel ? rawWs(sel) : null;
        if (isValidId(sw)) {
          target = sw;
        }
      } catch (e) {}
    }
    if (!target || target === current) {
      try {
        anchorAllGroups();
      } catch (e) {}
      try {
        reconcile(isValidId(current) ? current : "1", Array.from(gBrowser.tabs));
      } catch (e) {}
      try {
        pruneExtraNewTabs(isValidId(current) ? current : "1");
      } catch (e) {}
      return;
    }
    // Session-restore de-dupe: two windows can resurrect onto the same
    // workspace. The second one falls back to the lowest unowned workspace
    // instead of co-displaying. switchLocal (not switchTo): focusing
    // another window mid-restore would be wrong.
    try {
      if (typeof findWsOwner === "function" && findWsOwner(target)) {
        const free =
          typeof lowestUnownedWorkspace === "function"
            ? lowestUnownedWorkspace()
            : null;
        if (isValidId(free)) {
          target = free;
        }
      }
    } catch (e) {}
    // Prefer the restored selected tab when it already lives in target,
    // so we focus the exact tab left open instead of the first in order.
    try {
      const sel = gBrowser.selectedTab;
      if (sel && !sel.closing && rawWs(sel) === target) {
        lastSelected[target] = sel;
      }
    } catch (e) {}
    try {
      if (typeof switchLocal === "function") {
        switchLocal(target);
      } else {
        switchTo(target);
      }
    } catch (e) {}
  }

  let startupRestoreDone = false;
  function runStartupRestoreOnce() {
    if (startupRestoreDone) {
      return;
    }
    startupRestoreDone = true;
    try {
      startupRestore();
    } catch (e) {}
    // Bulk-restored tabs can arrive with tag/container still settling when
    // their SSTabRestored fires — one full chrome pass once session
    // restore completes, so no tab waits on a binding change for markers.
    try {
      if (typeof syncAllTabChrome === "function") {
        syncAllTabChrome();
      }
    } catch (e) {}
  }

  function scheduleStartupRestore() {
    try {
      if (typeof Services !== "undefined" && Services.obs) {
        startupRestoreObserver = {
          observe() {
            try {
              Services.obs.removeObserver(
                startupRestoreObserver,
                "sessionstore-windows-restored"
              );
            } catch (e) {}
            startupRestoreObserver = null;
            setTimeout(runStartupRestoreOnce, 0);
          },
        };
        Services.obs.addObserver(startupRestoreObserver, "sessionstore-windows-restored", false);
      }
    } catch (e) {
      startupRestoreObserver = null;
    }
    // Fallback in case the notification already fired or obs is unavailable.
    setTimeout(runStartupRestoreOnce, 3000);
  }

