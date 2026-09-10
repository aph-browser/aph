  // New windows (Ctrl+N) inherit the source window's workspace instead of
  // falling back to "1". Stored value wins (session restore); else opener,
  // else most-recent / any open browser window; else "1".
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
          return ow;
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
    // Prefer the restored selected tab when it already lives in target,
    // so we focus the exact tab left open instead of the first in order.
    try {
      const sel = gBrowser.selectedTab;
      if (sel && !sel.closing && rawWs(sel) === target) {
        lastSelected[target] = sel;
      }
    } catch (e) {}
    try {
      switchTo(target);
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

