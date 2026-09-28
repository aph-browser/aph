  // First-run welcome: open the tour tab once per profile, then never
  // again (aph.welcome.seen). No back-compat gating on purpose — every
  // profile without the pref sees it exactly once after updating, fresh
  // profiles on first launch. Waits for session restore to settle (same
  // observer + timeout fallback as scheduleStartupRestore) so the tab
  // isn't buried by restored tabs; skips private windows and secondary
  // windows. Everything fails silent (house style).
  const WELCOME_URL = "chrome://browser/content/aph-welcome.html";
  const WELCOME_SEEN_PREF = "aph.welcome.seen";
  let welcomeObserver = null;
  let welcomeFired = false;

  function welcomeSeen() {
    try {
      if (
        typeof Services !== "undefined" &&
        Services.prefs &&
        typeof Services.prefs.getBoolPref === "function"
      ) {
        try {
          return !!Services.prefs.getBoolPref(WELCOME_SEEN_PREF, false);
        } catch (e) {
          try {
            return !!Services.prefs.getBoolPref(WELCOME_SEEN_PREF);
          } catch (_e) {
            return false;
          }
        }
      }
    } catch (e) {}
    return false;
  }

  function setWelcomeSeen() {
    try {
      if (
        typeof Services !== "undefined" &&
        Services.prefs &&
        typeof Services.prefs.setBoolPref === "function"
      ) {
        Services.prefs.setBoolPref(WELCOME_SEEN_PREF, true);
      }
    } catch (e) {}
  }

  function isFirstWelcomeWindow() {
    try {
      const op = window.opener;
      if (op && op !== window && !op.closed) {
        return false;
      }
    } catch (e) {}
    try {
      if (typeof Services !== "undefined" && Services.wm) {
        const en = Services.wm.getEnumerator("navigator:browser");
        let count = 0;
        while (en.hasMoreElements()) {
          let w = null;
          try {
            w = en.getNext();
          } catch (_e) {}
          if (w && !w.closed) {
            count++;
            if (count > 1) {
              return false;
            }
          }
        }
        return true;
      }
    } catch (e) {}
    return true;
  }

  function isPrivateWelcomeWindow() {
    try {
      const pbu = window.PrivateBrowsingUtils;
      if (pbu && typeof pbu.isWindowPrivate === "function") {
        return !!pbu.isWindowPrivate(window);
      }
    } catch (e) {}
    return false;
  }

  // Reuse one welcome tab per window instead of stacking duplicates.
  function aphOpenWelcome() {
    try {
      for (const t of Array.from((typeof gBrowser !== "undefined" && gBrowser.tabs) || [])) {
        try {
          const spec = t && t.linkedBrowser && t.linkedBrowser.currentURI && t.linkedBrowser.currentURI.spec;
          if (!t.closing && spec === WELCOME_URL) {
            gBrowser.selectedTab = t;
            return;
          }
        } catch (e) {}
      }
    } catch (e) {}
    try {
      aphOpenTab(WELCOME_URL);
    } catch (e) {}
  }

  function maybeShowWelcome() {
    if (welcomeFired) {
      return;
    }
    welcomeFired = true;
    try {
      if (welcomeSeen()) {
        return;
      }
      if (isPrivateWelcomeWindow()) {
        return;
      }
      if (!isFirstWelcomeWindow()) {
        return;
      }
      // Mark first so a second window racing us stays quiet.
      setWelcomeSeen();
      aphOpenWelcome();
    } catch (e) {}
  }

  function scheduleWelcome() {
    try {
      if (typeof Services !== "undefined" && Services.obs) {
        welcomeObserver = {
          observe() {
            try {
              Services.obs.removeObserver(
                welcomeObserver,
                "sessionstore-windows-restored"
              );
            } catch (e) {}
            welcomeObserver = null;
            setTimeout(maybeShowWelcome, 0);
          },
        };
        Services.obs.addObserver(welcomeObserver, "sessionstore-windows-restored", false);
      }
    } catch (e) {
      welcomeObserver = null;
    }
    // Fallback in case the notification already fired or obs is unavailable.
    setTimeout(maybeShowWelcome, 3000);
  }
