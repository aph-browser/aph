  // Load rings: busy tabs wear the workspace accent on their favicon
  // tile (CSS §22c) instead of stock grey. This module owns exactly one
  // thing — the restore-storm gate. While more than a handful of tabs
  // load at once (session restore, window-open storms) every ring
  // renders static, so the strip never becomes a shimmer wall; below the
  // threshold rings breathe. Session-only and per-window (the count
  // derives from live tab state on every event), no pref behind it.
  // House style: fail-silent everywhere so a missing host never breaks
  // tabs. Teardown mirrors init (strong listener references must die
  // with the window — see cleanupWindowObservers).
  const LOAD_STORM_ATTR = "data-aph-load-storm";
  const LOAD_STORM_THRESHOLD = 3;

  function loadRingBusyCount() {
    let n = 0;
    try {
      const tabs = gBrowser && gBrowser.tabs;
      if (!tabs) {
        return 0;
      }
      for (const t of tabs) {
        try {
          if (!t) {
            continue;
          }
          if (typeof t.hasAttribute === "function") {
            if (t.hasAttribute("busy")) {
              n++;
            }
          } else if (t.busy) {
            n++;
          }
        } catch (e) {}
      }
    } catch (e) {}
    return n;
  }

  function syncLoadStorm() {
    let storm = false;
    try {
      storm = loadRingBusyCount() > LOAD_STORM_THRESHOLD;
    } catch (e) {
      storm = false;
    }
    try {
      const root = document.documentElement;
      if (!root) {
        return;
      }
      if (storm) {
        root.setAttribute(LOAD_STORM_ATTR, "1");
      } else {
        root.removeAttribute(LOAD_STORM_ATTR);
      }
    } catch (e) {}
  }

  function onLoadRingTabEvent() {
    try {
      syncLoadStorm();
    } catch (e) {}
  }

  function cleanupLoadRings() {
    try {
      if (gBrowser && gBrowser.tabContainer) {
        gBrowser.tabContainer.removeEventListener("TabAttrModified", onLoadRingTabEvent);
        gBrowser.tabContainer.removeEventListener("TabOpen", onLoadRingTabEvent);
        gBrowser.tabContainer.removeEventListener("TabClose", onLoadRingTabEvent);
      }
    } catch (e) {}
    try {
      const root = document.documentElement;
      if (root && typeof root.removeAttribute === "function") {
        root.removeAttribute(LOAD_STORM_ATTR);
      }
    } catch (e) {}
  }

  function initLoadRings() {
    try {
      syncLoadStorm();
    } catch (e) {}
    try {
      if (gBrowser && gBrowser.tabContainer) {
        gBrowser.tabContainer.addEventListener("TabAttrModified", onLoadRingTabEvent);
        gBrowser.tabContainer.addEventListener("TabOpen", onLoadRingTabEvent);
        gBrowser.tabContainer.addEventListener("TabClose", onLoadRingTabEvent);
      }
    } catch (e) {}
    try {
      window.addEventListener("unload", cleanupLoadRings, { once: true });
    } catch (e) {}
  }

  if (document.readyState === "complete") {
    initLoadRings();
  } else {
    window.addEventListener("load", initLoadRings, { once: true });
  }
