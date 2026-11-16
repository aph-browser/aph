  // New windows (Ctrl+N) land on the lowest workspace no other live
  // window claims, instead of inheriting the source window's workspace, so
  // two fresh windows don't open on top of each other. Stored value wins
  // (session restore); otherwise the opener's workspace is inherited
  // (window-scoped: sharing an id is harmless — independent tab sets).
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
      return;
    }
    // Window-scoped landing: each window restores its own saved workspace
    // and reconciles its own strip (switchLocal — purely local). Same-id
    // workspaces elsewhere are independent tab sets; no de-dupe needed.
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

  // True from init() until SessionStore has finished populating this window
  // (or the fallback fires). While it is true, an empty workspace is not
  // evidence that it is empty: reconcile must not create a placeholder tab.
  // Only the window born before the initial session restore is armed; new
  // windows (Ctrl+N) see more than one browser window and keep normal
  // empty-workspace behavior. Embedders/tests without a tracked SessionStore
  // window (__SSi) are treated as settled.
  let sessionRestorePending = false;

  // The launcher writes this marker before every launch. Removing it is the
  // browser's promise that the restore it saw was usable; if it survives
  // (quick quit, crash, or blank tabs), the next launch rolls the profile
  // back to that launch's pre-restore snapshot.
  const SESSION_RESTORE_MARKER = ".aph-session-restore-pending";
  let quitGuardObserver = null;
  let quitHeld = false;
  let restoreMarkerTimer = null;
  // Only the window that was born before the initial restore owns the
  // profile-wide marker; a later Ctrl+N window must never clear it early.
  let restoreMarkerOwned = false;

  function restoreMarkerPath() {
    try {
      if (typeof PathUtils !== "undefined" && PathUtils.profileDir) {
        return PathUtils.join(PathUtils.profileDir, SESSION_RESTORE_MARKER);
      }
    } catch (e) {}
    try {
      // Older/embedder chrome may not expose PathUtils; dirsvc always does.
      if (
        typeof Services !== "undefined" &&
        Services.dirsvc &&
        typeof Ci !== "undefined" &&
        Ci.nsIFile
      ) {
        const profD = Services.dirsvc.get("ProfD", Ci.nsIFile);
        if (profD && typeof profD.path === "string" && profD.path) {
          return profD.path.replace(/[\\/]$/, "") + "/" + SESSION_RESTORE_MARKER;
        }
      }
    } catch (e) {}
    return null;
  }

  function clearRestoreMarker() {
    // Prefer the synchronous nsIFile path: a healthy restore can release a
    // held quit immediately, and an async unlink could still be pending when
    // the process exits (leaving the marker to roll back a good session).
    try {
      if (
        typeof Services !== "undefined" &&
        Services.dirsvc &&
        typeof Ci !== "undefined" &&
        Ci.nsIFile
      ) {
        const profD = Services.dirsvc.get("ProfD", Ci.nsIFile);
        const file = typeof profD.clone === "function" ? profD.clone() : profD;
        file.append(SESSION_RESTORE_MARKER);
        if (file.exists()) {
          file.remove(false);
        }
        return;
      }
    } catch (e) {}
    const path = restoreMarkerPath();
    if (!path || typeof IOUtils === "undefined") {
      return;
    }
    try {
      Promise.resolve(IOUtils.remove(path, { ignoreAbsent: true })).catch(() => {});
    } catch (e) {}
  }

  // A restored session is usable only when its tabs carry real titles. An
  // empty selected tab and empty lazy tabs are the signature of a failed
  // SessionStore history restore; a lone blank tab is equally unusable.
  function sessionRestoreLooksHealthy() {
    try {
      const tabs = Array.from(gBrowser.tabs || []);
      if (!tabs.length) {
        return false;
      }
      let named = 0;
      let unlabeled = 0;
      for (const tab of tabs) {
        let label = "";
        try {
          label = String(tab.label || "").trim();
        } catch (e) {}
        if (!label) {
          unlabeled++;
        } else if (label !== "New Tab") {
          named++;
        }
      }
      // The selected tab is what the user sees on launch. If it is still
      // blank, do not call the restore healthy just because a hidden tab
      // in another workspace has a title.
      let selectedLabel = "";
      try {
        selectedLabel = String((gBrowser.selectedTab && gBrowser.selectedTab.label) || "").trim();
      } catch (e) {}
      if (!selectedLabel) {
        return false;
      }
      try {
        const browser = gBrowser.selectedTab && gBrowser.selectedTab.linkedBrowser;
        if (browser && browser.currentURI && typeof browser.currentURI.spec === "string") {
          const uri = browser.currentURI.spec;
          if (!uri || uri === "about:blank") {
            return false;
          }
        }
      } catch (e) {}
      if (tabs.length === 1) {
        return unlabeled === 0;
      }
      return named > 0;
    } catch (e) {
      return true;
    }
  }

  function selectRealRestoredTab() {
    try {
      const selected = gBrowser.selectedTab;
      let selectedLabel = "";
      try {
        selectedLabel = String((selected && selected.label) || "").trim();
      } catch (e) {}
      if (selectedLabel) {
        return;
      }
      let want = null;
      try {
        want = typeof current !== "undefined" ? current : null;
      } catch (e) {}
      for (const tab of Array.from(gBrowser.tabs || [])) {
        let label = "";
        try {
          label = String(tab.label || "").trim();
        } catch (e) {}
        if (!label) {
          continue;
        }
        if (want && typeof rawWs === "function") {
          let tabWs = null;
          try {
            tabWs = rawWs(tab);
          } catch (e) {}
          if (tabWs && tabWs !== want) {
            continue;
          }
        }
        gBrowser.selectedTab = tab;
        return;
      }
    } catch (e) {}
  }

  // Hold the first quit request while the initial restore is still running.
  // A second request always goes through; the launcher marker still recovers
  // the pre-launch snapshot if that forced quit leaves a degraded session.
  function onQuitWhileRestoring(subject) {
    if (!sessionRestorePending || quitHeld) {
      return;
    }
    try {
      subject.data = true;
    } catch (e) {
      return;
    }
    quitHeld = true;
  }

  function releaseQuitHold() {
    if (!quitHeld) {
      return;
    }
    quitHeld = false;
    // Re-issue the application quit the user asked for, not just this
    // window's close, so a multi-window shutdown still shuts down.
    try {
      if (
        typeof Services !== "undefined" &&
        Services.startup &&
        typeof Ci !== "undefined" &&
        Ci.nsIAppStartup
      ) {
        Services.startup.quit(Ci.nsIAppStartup.eAttemptQuit);
        return;
      }
    } catch (e) {}
    try {
      window.close();
    } catch (e) {}
  }

  function detectSessionRestorePending() {
    try {
      if (SessionStore.canRestoreLastSession) {
        return true;
      }
    } catch (e) {}
    try {
      if (window.__SS_lastSessionWindowID) {
        return true;
      }
    } catch (e) {}
    try {
      // Window counting is only meaningful when SessionStore can actually
      // restore a session. Minimal test/embed doubles have no such API (and
      // nothing to wait for), so they stay permissive.
      if (typeof SessionStore.getWindowState !== "function") {
        return false;
      }
    } catch (e) {
      return false;
    }
    try {
      let count = 0;
      const en = Services.wm.getEnumerator("navigator:browser");
      while (en.hasMoreElements()) {
        let w = null;
        try {
          w = en.getNext();
        } catch (e) {}
        if (w && !w.closed) {
          count++;
        }
      }
      if (!count && window.__SSi) {
        count = 1;
      }
      if (
        !count &&
        typeof Services.wm.getMostRecentWindow === "function" &&
        Services.wm.getMostRecentWindow("navigator:browser") === window
      ) {
        count = 1;
      }
      return count === 1;
    } catch (e) {}
    return false;
  }

  let startupRestoreDone = false;
  function runStartupRestoreOnce(force, settled) {
    if (startupRestoreDone && !force) {
      return;
    }
    startupRestoreDone = true;
    // The restore has settled (observer) or the fallback owns the landing
    // now. Clear before startupRestore so a genuinely empty workspace can
    // still get its newtab at the final reconcile.
    sessionRestorePending = false;
    try {
      startupRestore();
    } catch (e) {}
    // Restore settled: temp-container tabs are all present (or gone), so
    // the reconcile sweep can tell live tracked ids from leaked ones.
    try {
      if (typeof reconcileTempContainers === "function") {
        reconcileTempContainers();
      }
    } catch (e) {}
    // Bulk-restored tabs can arrive with tag/container still settling when
    // their SSTabRestored fires — one full chrome pass once session
    // restore completes, so no tab waits on a binding change for markers.
    try {
      if (typeof syncAllTabChrome === "function") {
        syncAllTabChrome();
      }
    } catch (e) {}

    if (settled) {
      // A malformed restore can leave the saved selected tab empty while
      // other tabs still carry usable titles. Never leave that blank tab
      // focused: the user would see an empty window and quit.
      selectRealRestoredTab();
      if (restoreMarkerOwned && sessionRestoreLooksHealthy()) {
        clearRestoreMarker();
      }
    }
    // The first quit request is held only until restore settles or the
    // fallback fires; a forced second quit is handled by the launcher marker.
    releaseQuitHold();
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
            // Force the final pass even when the 3 s fallback already
            // landed: tabs that arrived after the fallback can still need
            // the restore-time reconcile/unhide.
            setTimeout(() => runStartupRestoreOnce(true, true), 0);
          },
        };
        Services.obs.addObserver(startupRestoreObserver, "sessionstore-windows-restored", false);
      }
    } catch (e) {
      startupRestoreObserver = null;
    }
    if (sessionRestorePending && typeof Services !== "undefined" && Services.obs) {
      try {
        quitGuardObserver = {
          observe(subject) {
            onQuitWhileRestoring(subject);
          },
        };
        Services.obs.addObserver(quitGuardObserver, "quit-application-requested", false);
      } catch (e) {
        quitGuardObserver = null;
      }
    }
    // Fallback in case the notification already fired or obs is unavailable.
    setTimeout(() => runStartupRestoreOnce(false, false), 3000);
    // If the restore notification is late but the tabs are already usable,
    // drop the launcher marker rather than rolling back a whole session on
    // the next launch.
    restoreMarkerTimer = setTimeout(() => {
      restoreMarkerTimer = null;
      if (restoreMarkerOwned && !sessionRestorePending && sessionRestoreLooksHealthy()) {
        clearRestoreMarker();
      }
    }, 15000);
  }

