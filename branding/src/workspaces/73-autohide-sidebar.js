  // Auto-hide sidebar / Peek mode:
  // When enabled, the sidebar collapses off-screen to the left (width: 0px),
  // leaving 100% full width for web content. Moving the pointer to the left
  // edge (or hovering the sidebar) smoothly slides it out as a floating glass
  // drawer over the page.
  //
  // Toggled by Ctrl+\ (or Cmd+\) and Command Palette ("Toggle Auto-Hide Sidebar").
  // State is backed by pref `aph.sidebar.autohide` and reflected on
  // document.documentElement as [data-aph-autohide-sidebar="1"].
  // Pointer proximity sets [data-aph-sidebar-peek="1"] while hovering.

  const AUTOHIDE_SIDEBAR_PREF = "aph.sidebar.autohide";
  const AUTOHIDE_SIDEBAR_ATTR = "data-aph-autohide-sidebar";
  const AUTOHIDE_SIDEBAR_PEEK_ATTR = "data-aph-sidebar-peek";

  let autohideSidebarArmed = false;
  let autohideSidebarObserver = null;

  function isAutohideSidebar() {
    try {
      if (typeof window !== "undefined" && typeof window.__aphAutohideSidebar === "boolean") {
        return window.__aphAutohideSidebar;
      }
      if (typeof Services !== "undefined" && Services.prefs) {
        return Services.prefs.getBoolPref(AUTOHIDE_SIDEBAR_PREF, false);
      }
    } catch (e) {}
    return false;
  }

  function onAutohidePointerMove(e) {
    try {
      if (!isAutohideSidebar()) {
        return;
      }
      const x = Number(e.clientX) || 0;
      const docEl = typeof document !== "undefined" ? document.documentElement : null;
      if (!docEl) {
        return;
      }
      // Left edge proximity: trigger peek when pointer hits within 14px of left edge.
      if (x <= 14) {
        docEl.setAttribute(AUTOHIDE_SIDEBAR_PEEK_ATTR, "1");
      } else if (x > 260) {
        // Outside the 240px sidebar drawer + 20px buffer: dismiss peek.
        docEl.removeAttribute(AUTOHIDE_SIDEBAR_PEEK_ATTR);
      }
    } catch (err) {}
  }

  function armAutohidePeekListeners() {
    try {
      if (autohideSidebarArmed) {
        return;
      }
      if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
        window.addEventListener("pointermove", onAutohidePointerMove, true);
        autohideSidebarArmed = true;
      }
    } catch (e) {}
  }

  function disarmAutohidePeekListeners() {
    try {
      if (!autohideSidebarArmed) {
        return;
      }
      if (typeof window !== "undefined" && typeof window.removeEventListener === "function") {
        window.removeEventListener("pointermove", onAutohidePointerMove, true);
        autohideSidebarArmed = false;
      }
    } catch (e) {}
  }

  function applyAutohideSidebar(enable) {
    const on = !!enable;
    try {
      if (typeof window !== "undefined") {
        window.__aphAutohideSidebar = on;
      }
    } catch (e) {}
    try {
      const docEl = typeof document !== "undefined" ? document.documentElement : null;
      if (docEl) {
        if (on) {
          docEl.setAttribute(AUTOHIDE_SIDEBAR_ATTR, "1");
          armAutohidePeekListeners();
        } else {
          docEl.removeAttribute(AUTOHIDE_SIDEBAR_ATTR);
          docEl.removeAttribute(AUTOHIDE_SIDEBAR_PEEK_ATTR);
          disarmAutohidePeekListeners();
        }
      }
    } catch (e) {}
    return on;
  }

  function setAutohideSidebar(on) {
    const enable = !!on;
    try {
      if (typeof Services !== "undefined" && Services.prefs) {
        Services.prefs.setBoolPref(AUTOHIDE_SIDEBAR_PREF, enable);
      }
    } catch (e) {}
    return applyAutohideSidebar(enable);
  }

  function toggleAutohideSidebar() {
    return setAutohideSidebar(!isAutohideSidebar());
  }

  function initAutohideSidebar() {
    try {
      const initial = isAutohideSidebar();
      applyAutohideSidebar(initial);
      if (typeof Services !== "undefined" && Services.prefs && !autohideSidebarObserver) {
        autohideSidebarObserver = {
          observe() {
            try {
              const cur = Services.prefs.getBoolPref(AUTOHIDE_SIDEBAR_PREF, false);
              applyAutohideSidebar(cur);
            } catch (e) {}
          },
        };
        Services.prefs.addObserver(AUTOHIDE_SIDEBAR_PREF, autohideSidebarObserver);
      }
    } catch (e) {}
  }

  function cleanupAutohideSidebar() {
    try {
      disarmAutohidePeekListeners();
      if (autohideSidebarObserver && typeof Services !== "undefined" && Services.prefs) {
        Services.prefs.removeObserver(AUTOHIDE_SIDEBAR_PREF, autohideSidebarObserver);
        autohideSidebarObserver = null;
      }
    } catch (e) {}
  }
