  // Focus mode: hide every chrome surface (top bar, sidebar strip, dock)
  // and leave only the page. Toggled by Ctrl+Alt+F and the palette
  // ("Toggle Focus Mode"); session-only and per-window, like workspaces
  // themselves — the expando + document attribute below both die with the
  // window, so nothing persists, restores, or syncs.
  // The palette overlay mounts on documentElement (outside the toolbox),
  // so Ctrl+K still opens in focus mode — hotkey + palette are the exit
  // paths, plus the floating exit pill below (mouse users must never get
  // stuck: the whole point of focus is hiding the chrome that would
  // otherwise offer the way out). Esc is deliberately NOT an exit (it
  // belongs to page content: video players, dialogs, editors).
  // The pill is a hint, not furniture: it fades after a few idle seconds
  // and returns on the next pointer/key activity, so a long focus session
  // never wears a permanent badge over the page. Clicking it exits at any
  // moment, visible or not. One short idle timer + window-scoped poke
  // listeners only: both die with the exit path (timer cleared, listeners
  // removed), so nothing outlives the mode and there is nothing to leak
  // on unload.
  const FOCUS_ATTR = "data-aph-focus";
  const FOCUS_IDLE_ATTR = "data-aph-focus-idle";
  const FOCUS_EXIT_ID = "aph-focus-exit";
  // Idle seconds before the hint fades (tests drive short waits through
  // window.__aphFocusExitIdleMs, same __aph* override idiom as the suite).
  const FOCUS_EXIT_IDLE_MS = 4000;

  function focusExitIdleMs() {
    try {
      const v = window.__aphFocusExitIdleMs;
      if (typeof v === "number" && isFinite(v) && v >= 0) {
        return v;
      }
    } catch (e) {}
    return FOCUS_EXIT_IDLE_MS;
  }

  function isFocusMode() {
    try {
      return !!window.__aphFocus;
    } catch (e) {
      return false;
    }
  }

  function setFocusMode(on) {
    const enable = !!on;
    let changed = true;
    try {
      changed = !!window.__aphFocus !== enable;
    } catch (e) {
      changed = true;
    }
    try {
      window.__aphFocus = enable;
    } catch (e) {}
    // The pill tracks the mode: visible exactly while focused. DOM always
    // re-syncs (never early-returns on the expando alone): a stray pill
    // can never outlive the mode, and a missing pill can never survive
    // re-entry — the exit path is unconditional.
    try {
      if (enable) {
        document.documentElement.setAttribute(FOCUS_ATTR, "1");
      } else {
        document.documentElement.removeAttribute(FOCUS_ATTR);
      }
    } catch (e) {}
    try {
      document.documentElement.removeAttribute(FOCUS_IDLE_ATTR);
    } catch (e) {}
    try {
      if (enable) {
        ensureFocusExit();
        armFocusExitPokes();
        armFocusExitIdle();
      } else {
        disarmFocusExitPokes();
        clearFocusExitIdle();
        removeFocusExit();
      }
    } catch (e) {}
    // Focus follows the visible surface: page content when hiding chrome,
    // the urlbar when bringing it back (same discipline as openBoundTab).
    // Steering runs on transitions only — a redundant set must not yank
    // focus away from wherever the user put it.
    try {
      if (!changed) {
        return enable;
      }
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

  // Idle fade: the hint shows on entry, then yields the page after a few
  // quiet seconds. Any pointer/key activity pokes it back; the poke
  // listeners live only while focused (armed on enter, removed on exit),
  // and the timer is single-shot and cleared on exit, so neither outlives
  // the mode. Firing late (after an exit that raced the timeout) is a
  // no-op: the marker lands only while the mode is still on.
  let focusExitIdleTimer = null;
  let focusExitPokesArmed = false;

  function markFocusExitIdle() {
    focusExitIdleTimer = null;
    try {
      if (!isFocusMode()) {
        return;
      }
    } catch (e) {
      return;
    }
    try {
      if (focusExitNode()) {
        document.documentElement.setAttribute(FOCUS_IDLE_ATTR, "1");
      }
    } catch (e) {}
  }

  function clearFocusExitIdle() {
    try {
      if (focusExitIdleTimer) {
        clearTimeout(focusExitIdleTimer);
      }
    } catch (e) {}
    focusExitIdleTimer = null;
  }

  function armFocusExitIdle() {
    try {
      clearFocusExitIdle();
      focusExitIdleTimer = setTimeout(markFocusExitIdle, focusExitIdleMs());
      // Node-harness only: unref so a pending idle wait never holds the
      // test process open (Firefox setTimeout returns a number — no-op).
      if (focusExitIdleTimer && typeof focusExitIdleTimer.unref === "function") {
        focusExitIdleTimer.unref();
      }
    } catch (e) {}
  }

  function onFocusExitPoke() {
    try {
      if (!isFocusMode()) {
        return;
      }
    } catch (e) {
      return;
    }
    try {
      document.documentElement.removeAttribute(FOCUS_IDLE_ATTR);
    } catch (e) {}
    try {
      armFocusExitIdle();
    } catch (e) {}
  }

  function armFocusExitPokes() {
    try {
      if (focusExitPokesArmed) {
        return;
      }
      if (typeof window.addEventListener !== "function") {
        return;
      }
      window.addEventListener("pointermove", onFocusExitPoke);
      window.addEventListener("pointerdown", onFocusExitPoke);
      window.addEventListener("keydown", onFocusExitPoke, true);
      focusExitPokesArmed = true;
    } catch (e) {}
  }

  function disarmFocusExitPokes() {
    try {
      if (!focusExitPokesArmed) {
        return;
      }
      if (typeof window.removeEventListener === "function") {
        try {
          window.removeEventListener("pointermove", onFocusExitPoke);
        } catch (_e) {}
        try {
          window.removeEventListener("pointerdown", onFocusExitPoke);
        } catch (_e) {}
        try {
          window.removeEventListener("keydown", onFocusExitPoke, true);
        } catch (_e) {}
      }
    } catch (e) {}
    try {
      focusExitPokesArmed = false;
    } catch (_e) {}
  }
