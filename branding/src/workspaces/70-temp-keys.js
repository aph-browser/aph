  // Open a clean disposable container tab in the current workspace. Falls
  // back to a normal tab if the identity service is unavailable.
  function openTempTab(url = "about:newtab") {
    const ws = isValidId(current) ? current : "1";
    if (!IdentityService) {
      try {
        const t = gBrowser.addTrustedTab(url);
        setWs(t, ws);
        gBrowser.selectedTab = t;
        focusUrlBar();
      } catch (e) {}
      return;
    }
    try {
      const identity = IdentityService.create(`Tmp ${tempCounter++}`, "fingerprint", "purple");
      const tab = gBrowser.addTrustedTab(url, { userContextId: identity.userContextId });
      // insertAfterCurrent births tabs inside the selected tab's group — eject.
      try {
        gBrowser.ungroupTab(tab);
      } catch (e) {}
      tempContainers.add(identity.userContextId);
      setWs(tab, ws);
      aphShowTab(tab);
      gBrowser.selectedTab = tab;
      focusUrlBar();
    } catch (e) {}
  }

  // If a disposable container's last tab closed (any window), remove the
  // identity — remove() also wipes its cookies/storage/cache internally.
  function cleanupTempContainer(tab) {
    let id = null;
    try {
      id = tab.userContextId;
    } catch (e) {
      return;
    }
    if (!id || !IdentityService || !tempContainers.has(id)) {
      return;
    }
    setTimeout(() => {
      try {
        const en = Services.wm.getEnumerator("navigator:browser");
        while (en.hasMoreElements()) {
          const w = en.getNext();
          if (!w || w.closed || !w.gBrowser) {
            continue;
          }
          for (const t of w.gBrowser.tabs) {
            if (!t.closing && t.userContextId === id) {
              return; // still in use
            }
          }
        }
        tempContainers.delete(id);
        IdentityService.remove(id);
        if (tempContainers.size === 0) {
          tempCounter = 1; // Clean slate: next round starts at Tmp 1
        }
      } catch (e) {}
    }, 100);
  }

  // e.code, not e.key: Shift turns "1" into "!".
  function digitFromCode(code) {
    const m = code && code.match(/^(?:Digit|Numpad)([1-9])$/);
    return m ? m[1] : null;
  }

  // True when the key event targets editable text (page inputs, urlbar).
  function isEditableTarget(t) {
    try {
      if (!t) {
        return false;
      }
      if (typeof t.closest === "function" && t.closest("input,textarea,select,[contenteditable]")) {
        return true;
      }
      const tn = String(t.tagName || t.localName || "").toLowerCase();
      if (tn === "input" || tn === "textarea" || tn === "select") {
        return true;
      }
      return t.isContentEditable === true;
    } catch (e) {
      return false;
    }
  }

  function onKey(e) {
    // Inline tab-rename editor owns its keystrokes: window capture fires
    // before the input's own handlers, so it cannot shield itself.
    try {
      if (e.target && e.target.id === "aph-tab-rename-input") {
        return;
      }
    } catch (err) {}
    if (e.repeat) {
      return;
    }
    // Windows international keyboards: AltGr arrives as Ctrl+Alt, so bare
    // modifier checks can't tell "AltGr+Q → @" (German) apart from a real
    // Ctrl+Alt hotkey. The OS flags genuine AltGr composition via the
    // AltGraph modifier state — when set, the user is typing a character,
    // never invoking a workspace hotkey (Ctrl+Alt+T/B/R/digits below).
    // Real Ctrl+Alt on layouts without AltGr reports AltGraph=false and is
    // unaffected. Guarded: getModifierState is absent in tests/contexts
    // without full KeyboardEvent support.
    try {
      if (typeof e.getModifierState === "function" && e.getModifierState("AltGraph")) {
        return;
      }
    } catch (err) {}
    // Plain Ctrl+T opens in the workspace's bound container (if any).
    // Unbound workspaces fall through to stock Firefox behavior.
    if (e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey && e.code === "KeyT") {
      let bound = 0;
      try {
        bound = getWsContainerId(isValidId(current) ? current : "1");
      } catch (err) {}
      if (bound) {
        e.preventDefault();
        e.stopPropagation();
        try {
          openBoundTab();
        } catch (err) {}
      }
      return;
    }
    if (!e.altKey || e.metaKey) {
      return;
    }
    if (e.ctrlKey && !e.shiftKey && e.code === "KeyT") {
      e.preventDefault();
      e.stopPropagation();
      openTempTab();
      return;
    }
    // Ctrl+Alt+B binds the current workspace to the selected tab's
    // container (default tab = clear); Ctrl+Alt+Shift+B clears directly.
    if (e.ctrlKey && e.code === "KeyB") {
      e.preventDefault();
      e.stopPropagation();
      try {
        if (e.shiftKey) {
          clearWsBinding(isValidId(current) ? current : "1");
        } else {
          bindCurrentWsToSelectedTab();
        }
      } catch (err) {}
      return;
    }
    // Ctrl+Alt+R quick-renames the current workspace via the palette.
    // Skipped in editable text so AltGr+R (®) keeps working while typing.
    if (e.ctrlKey && !e.shiftKey && e.code === "KeyR") {
      if (isEditableTarget(e.target)) {
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      try {
        if (window.AphPalette) {
          window.AphPalette.renameCurrent();
        }
      } catch (err) {}
      return;
    }
    // Alt+Shift cycling: brackets always, arrows outside editable text
    // (Alt+Shift+Left/Right selects words while typing), Tab toggles MRU.
    // e.code, not e.key: Shift turns "[" into "{".
    if (!e.ctrlKey && e.shiftKey && !e.metaKey) {
      if (e.code === "BracketRight") {
        e.preventDefault();
        e.stopPropagation();
        cycleWorkspace(1);
        return;
      }
      if (e.code === "BracketLeft") {
        e.preventDefault();
        e.stopPropagation();
        cycleWorkspace(-1);
        return;
      }
      if ((e.code === "ArrowRight" || e.code === "ArrowLeft") && !isEditableTarget(e.target)) {
        e.preventDefault();
        e.stopPropagation();
        cycleWorkspace(e.code === "ArrowRight" ? 1 : -1);
        return;
      }
      if (e.code === "Tab") {
        e.preventDefault();
        e.stopPropagation();
        toggleLastWorkspace();
        return;
      }
    }
    const d = digitFromCode(e.code);
    if (!d) {
      return;
    }
    if (e.ctrlKey) {
      e.preventDefault();
      e.stopPropagation();
      sendTabTo(d);
    } else if (e.shiftKey) {
      e.preventDefault();
      e.stopPropagation();
      switchTo(d);
    }
  }

