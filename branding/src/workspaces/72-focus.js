  // Focus mode: hide every chrome surface (top bar, sidebar strip, dock)
  // and leave only the page. Toggled by Ctrl+Alt+F and the palette
  // ("Toggle Focus Mode"); session-only and per-window, like workspaces
  // themselves — the expando + document attribute below both die with the
  // window, so nothing persists, restores, or syncs. No pref, no Settings
  // row, no observers, no timers: nothing to leak on unload.
  // The palette overlay mounts on documentElement (outside the toolbox),
  // so Ctrl+K still opens in focus mode — hotkey + palette are the exit
  // paths, plus the floating exit pill below (mouse users must never get
  // stuck: the whole point of focus is hiding the chrome that would
  // otherwise offer the way out). Esc is deliberately NOT an exit (it
  // belongs to page content: video players, dialogs, editors).
  const FOCUS_ATTR = "data-aph-focus";
  const FOCUS_EXIT_ID = "aph-focus-exit";

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
    // The exit pill tracks the mode: visible exactly while focused.
    try {
      if (enable) {
        ensureFocusExit();
      } else {
        removeFocusExit();
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

  // Exit pill: the one visible way out for mouse users. Mounts on
  // documentElement (outside every hidden surface, like the palette and
  // the switch bloom), created on enter and removed on exit — nothing
  // lingers, nothing persists. Native button: keyboard-focusable with
  // platform Enter/Space, no manual key handling. Everything fails
  // silent (house style) so a missing host never breaks the toggle.
  function focusExitNode() {
    try {
      if (typeof document.getElementById === "function") {
        return document.getElementById(FOCUS_EXIT_ID) || null;
      }
    } catch (e) {}
    return null;
  }

  function ensureFocusExit() {
    try {
      if (focusExitNode()) {
        return;
      }
      if (typeof document.createElement !== "function") {
        return;
      }
      const btn = document.createElement("button");
      if (!btn) {
        return;
      }
      try {
        btn.id = FOCUS_EXIT_ID;
      } catch (e) {}
      try {
        if (typeof btn.setAttribute === "function") {
          btn.setAttribute("type", "button");
          btn.setAttribute("aria-label", "Exit focus mode (Ctrl+Alt+F)");
        }
      } catch (e) {}
      const label = "Exit focus · Ctrl+Alt+F";
      try {
        btn.textContent = label;
      } catch (e) {}
      try {
        btn.title = label;
      } catch (e) {}
      try {
        if (typeof btn.addEventListener === "function") {
          btn.addEventListener("click", () => {
            try {
              setFocusMode(false);
            } catch (_e) {}
          });
        }
      } catch (e) {}
      try {
        const root = document.documentElement;
        if (root && typeof root.appendChild === "function") {
          root.appendChild(btn);
        }
      } catch (e) {}
    } catch (e) {}
  }

  function removeFocusExit() {
    try {
      const btn = focusExitNode();
      if (!btn) {
        return;
      }
      try {
        if (btn.parentNode && typeof btn.parentNode.removeChild === "function") {
          btn.parentNode.removeChild(btn);
          return;
        }
      } catch (e) {}
      try {
        if (typeof btn.remove === "function") {
          btn.remove();
        }
      } catch (e) {}
    } catch (e) {}
  }
