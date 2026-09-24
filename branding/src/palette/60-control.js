  function cancelCloseTimer() {
    try {
      if (closeTimer) {
        clearTimeout(closeTimer);
        closeTimer = null;
      }
    } catch (e) {
      closeTimer = null;
    }
    try {
      if (overlay && overlay.classList) {
        overlay.classList.remove("aph-palette-closing");
      }
    } catch (e) {}
    try {
      const box = overlay && overlay.querySelector && overlay.querySelector("#aph-palette");
      if (box && box.classList) {
        box.classList.remove("aph-palette-closing");
      }
    } catch (e) {}
  }

  // Sacred return-of-focus: remember who had focus before the palette
  // stole it (page input, editor, video player). Skips our own input and
  // anything already inside the overlay so reopen-during-close keeps the
  // original element.
  function captureFocus() {
    try {
      const ae = document.activeElement;
      if (!ae || ae === input) {
        return;
      }
      try {
        if (overlay && overlay.contains && overlay.contains(ae)) {
          return;
        }
      } catch (e) {}
      returnFocusTo = ae;
    } catch (e) {}
  }

  // Restored synchronously in close() — before it.run() executes — so a
  // tab switch afterwards owns focus naturally instead of being yanked
  // back to the old tab. No-op when the element is gone.
  function restoreFocus() {
    const el = returnFocusTo;
    returnFocusTo = null;
    try {
      if (!el || typeof el.focus !== "function") {
        return;
      }
      try {
        if (typeof el.isConnected === "boolean" && !el.isConnected) {
          return;
        }
        if (document.contains && !document.contains(el)) {
          return;
        }
      } catch (e) {}
      el.focus();
    } catch (e) {}
  }

  function open() {
    if (!overlay) {
      build();
    }
    captureFocus();
    prompt = null;
    try {
      if (typeof invalidatePaletteCache === "function") {
        invalidatePaletteCache();
      }
    } catch (e) {}
    cancelCloseTimer();
    overlay.hidden = false;
    // Pop-in animation: re-trigger on every open.
    try {
      overlay.classList.remove("aph-palette-anim");
      const box = overlay.querySelector && overlay.querySelector("#aph-palette");
      if (box) {
        box.classList.remove("aph-palette-anim");
        void box.offsetWidth;
        box.classList.add("aph-palette-anim");
      }
    } catch (e) {}
    input.value = "";
    try {
      input.setAttribute("placeholder", PLACEHOLDER);
    } catch (e) {}
    render("");
    setTimeout(() => {
      try {
        input.focus();
      } catch (e) {}
    }, 0);
  }

  // Rename prompt: replaces the list with a single commit row; typing
  // filters nothing, Enter commits, Esc cancels (via close).
  function startPrompt(opts) {
    if (!overlay) {
      build();
    }
    if (!overlay || !input) {
      return;
    }
    prompt = opts;
    cancelCloseTimer();
    overlay.hidden = false;
    try {
      input.setAttribute("placeholder", opts.title);
    } catch (e) {}
    try {
      input.value = opts.initial || "";
    } catch (e) {}
    render("");
    setTimeout(() => {
      try {
        input.focus();
      } catch (e) {}
      try {
        if (input.select) {
          input.select();
        }
      } catch (e) {}
    }, 0);
  }

  function renameCurrent() {
    const api = ws();
    if (!api || !api.getCurrent || !api.setWsName) {
      return;
    }
    let n = "1";
    try {
      n = api.getCurrent() || "1";
    } catch (e) {}
    let cur = "";
    try {
      cur = (api.getWsName && api.getWsName(n)) || "";
    } catch (e) {}
    startPrompt({
      title: `Rename Workspace ${n} — Enter saves, Esc cancels`,
      initial: cur,
      onCommit: (v) => {
        try {
          api.setWsName(n, v);
        } catch (e) {}
      },
    });
  }

  // Tab rename entry point: prompts for the selected tab via the tab-rename
  // controller (branding/tabrename.js). No-ops when it is absent (tests).
  function renameCurrentTab() {
    let api = null;
    try {
      api = window.AphTabRename || null;
    } catch (e) {}
    if (!api || typeof api.promptRename !== "function") {
      return;
    }
    let tab = null;
    try {
      tab = gBrowser.selectedTab;
    } catch (e) {}
    if (!tab) {
      return;
    }
    try {
      api.promptRename(tab);
    } catch (e) {}
  }

  function close() {
    prompt = null;
    try {
      if (typeof invalidatePaletteCache === "function") {
        invalidatePaletteCache();
      }
    } catch (e) {}
    if (!overlay || overlay.hidden) {
      cancelCloseTimer();
      return;
    }
    // Already transitioning open→closed past this point, so returning
    // focus is safe exactly once (early-return above never restores).
    restoreFocus();
    // Reduced-motion (or no timer support in tests): hide instantly.
    let reduce = false;
    try {
      reduce = !!(
        window.matchMedia &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches
      );
    } catch (e) {}
    if (reduce || typeof setTimeout !== "function") {
      cancelCloseTimer();
      overlay.hidden = true;
      return;
    }
    // Animated exit: fade the backdrop, sink + shrink the panel, then
    // hide. Reopening cancels the timer (see open/cancelCloseTimer).
    cancelCloseTimer();
    try {
      overlay.classList.add("aph-palette-closing");
    } catch (e) {}
    try {
      const box = overlay.querySelector && overlay.querySelector("#aph-palette");
      if (box) {
        box.classList.remove("aph-palette-anim");
        box.classList.add("aph-palette-closing");
      }
    } catch (e) {}
    try {
      closeTimer = setTimeout(() => {
        closeTimer = null;
        try {
          if (overlay) {
            overlay.hidden = true;
            overlay.classList.remove("aph-palette-closing");
            const box =
              overlay.querySelector && overlay.querySelector("#aph-palette");
            if (box) {
              box.classList.remove("aph-palette-closing", "aph-palette-anim");
            }
          }
        } catch (e) {}
      }, 130);
    } catch (e) {
      try {
        overlay.hidden = true;
      } catch (_e) {}
    }
  }

  // Ctrl+W on a tab row: closes that tab, keeps the palette open.
  function closeRowTab(it) {
    try {
      const t = (it && it.tabRef) || null;
      if (!t || t.closing) {
        return false;
      }
      if (typeof gBrowser !== "undefined" && gBrowser && typeof gBrowser.removeTab === "function") {
        gBrowser.removeTab(t, { animate: false });
      } else if (typeof gBrowser !== "undefined" && gBrowser && typeof gBrowser.removeCurrentTab === "function") {
        // Fallback when removeTab is absent (tests): only when it's current.
        try {
          if (gBrowser.selectedTab === t) {
            gBrowser.removeCurrentTab();
          } else {
            return false;
          }
        } catch (e) {
          return false;
        }
      } else {
        return false;
      }
      if (typeof invalidatePaletteCache === "function") {
        invalidatePaletteCache();
      }
      try {
        render(input ? input.value : "");
      } catch (e) {}
      return true;
    } catch (e) {
      return false;
    }
  }

  function isOpen() {
    return overlay && !overlay.hidden;
  }

  function toggle() {
    if (isOpen()) {
      close();
    } else {
      open();
    }
  }

  // Alt+Enter (or Shift+Enter) forces the disposable temp container when
  // the entry supports it (URL / search fallback); plain Enter uses run().
  // In rename-prompt mode Enter commits the input instead. Rows marked
  // keepOpen (e.g. Rename) run without closing first.
  function choose(useTemp) {
    if (prompt) {
      const cb = prompt.onCommit;
      let v = "";
      try {
        v = input.value;
      } catch (e) {}
      prompt = null;
      close();
      if (!cb) {
        return;
      }
      try {
        cb(v);
      } catch (e) {}
      return;
    }
    const it = items[selected];
    if (!it) {
      close();
      return;
    }
    // Terminal-history recall: remember the committed query so an empty
    // ArrowUp can bring it back (see onListKey).
    try {
      const qv = input && input.value ? String(input.value).trim() : "";
      if (qv) {
        lastCommittedQuery = qv;
      }
    } catch (e) {}
    try {
      if (typeof recordFrecency === "function") {
        recordFrecency(it);
      }
    } catch (e) {}
    if (!it.keepOpen) {
      close();
    }
    try {
      if (useTemp && it.runInTemp) {
        it.runInTemp();
      } else {
        it.run();
      }
    } catch (e) {}
    // keepOpen rows mutate live state (bind/pin/mute) — drop the cache so
    // the repainted list (e.g. sidebar-footer toggle) reflects fresh titles.
    try {
      if (it.keepOpen && typeof invalidatePaletteCache === "function") {
        invalidatePaletteCache();
      }
    } catch (e) {}
  }

