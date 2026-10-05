  // Focus mode: hide every chrome surface (top bar, sidebar strip, dock)
  // and leave only the page. Toggled by Ctrl+Alt+F and the palette
  // ("Toggle Focus Mode"); session-only and per-window, like workspaces
  // themselves — the expando + document attribute below both die with the
  // window, so nothing persists, restores, or syncs. No pref, no Settings
  // row, no observers, no timers: nothing to leak on unload.
  // The palette overlay mounts on documentElement (outside the toolbox),
  // so Ctrl+K still opens in focus mode — hotkey + palette are the exit
  // paths. Esc is deliberately NOT an exit (it belongs to page content:
  // video players, dialogs, editors).
  const FOCUS_ATTR = "data-aph-focus";

  function isFocusMode() {
    try {
      return !!window.__aphFocus;
    } catch (e) {
      return false;
    }
  }

  function setFocusMode(on) {
    const enable = !!on;
    try {
      if (!!window.__aphFocus === enable) {
        return enable;
      }
    } catch (e) {
      return isFocusMode();
    }
    try {
      window.__aphFocus = enable;
    } catch (e) {}
    try {
      if (enable) {
        document.documentElement.setAttribute(FOCUS_ATTR, "1");
      } else {
        document.documentElement.removeAttribute(FOCUS_ATTR);
      }
    } catch (e) {}
    // Focus follows the visible surface: page content when hiding chrome,
    // the urlbar when bringing it back (same discipline as openBoundTab).
    try {
      if (enable) {
        const bw = gBrowser.selectedBrowser;
        if (bw && typeof bw.focus === "function") {
          bw.focus();
        }
      } else if (typeof focusUrlBar === "function") {
        focusUrlBar();
      }
    } catch (e) {}
    return enable;
  }

  function toggleFocusMode() {
    try {
      return setFocusMode(!isFocusMode());
    } catch (e) {
      return isFocusMode();
    }
  }
