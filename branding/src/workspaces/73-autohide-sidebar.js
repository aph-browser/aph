  // Auto-hide sidebar / Peek mode:
  // When enabled, the sidebar collapses off-screen to the left (width: 0px),
  // leaving 100% full width for web content. Moving the pointer to the left
  // edge (or hovering the sidebar) smoothly slides it out as a floating glass
  // drawer over the page.
  //
  // Toggled by Ctrl+\ (or Cmd+\) and Command Palette ("Toggle Auto-Hide Sidebar").
  // State is backed by pref `aph.sidebar.autohide` and reflected on
  // document.documentElement as [data-aph-autohide-sidebar="1"].
  // Hover reveal is compositor-driven in theme.css (#sidebar-container:hover).

  const AUTOHIDE_SIDEBAR_PREF = "aph.sidebar.autohide";
  const AUTOHIDE_SIDEBAR_ATTR = "data-aph-autohide-sidebar";

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
        } else {
          docEl.removeAttribute(AUTOHIDE_SIDEBAR_ATTR);
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
      if (autohideSidebarObserver && typeof Services !== "undefined" && Services.prefs) {
        Services.prefs.removeObserver(AUTOHIDE_SIDEBAR_PREF, autohideSidebarObserver);
        autohideSidebarObserver = null;
      }
    } catch (e) {}
  }
