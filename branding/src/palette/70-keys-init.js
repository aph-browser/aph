  // True when keyboard focus sits in editable text that isn't our own
  // input — urlbar, inputs, textareas, contenteditable editors. Same
  // shape as isEditableTarget() in workspaces.js, rooted at the active
  // element instead of the event target.
  function isEditableFocused() {
    try {
      const ae = document.activeElement;
      if (!ae || ae === input) {
        return false;
      }
      const tn = String(ae.tagName || ae.localName || "").toLowerCase();
      if (tn === "input" || tn === "textarea" || tn === "select") {
        return true;
      }
      if (ae.isContentEditable) {
        return true;
      }
      if (typeof ae.closest === "function" && ae.closest("[contenteditable],#urlbar,#searchbar")) {
        return true;
      }
      return false;
    } catch (e) {
      return false;
    }
  }

  // True when focus sits in the browser's own search-entry fields
  // (urlbar / searchbar). The stock Ctrl+K binding lives exactly there
  // (focus-search), and hijacking it is the toggle's whole job — fresh
  // tabs focus the urlbar, so treating those fields as blockers would
  // surrender Ctrl+K to the search engine on every new tab.
  function isSearchFieldFocused() {
    try {
      const ae = document.activeElement;
      if (!ae || typeof ae.closest !== "function") {
        return false;
      }
      return !!ae.closest("#urlbar, #searchbar");
    } catch (e) {
      return false;
    }
  }

  // Whether focus blocks the Ctrl+K toggle: editable text keeps its
  // keystrokes, except the browser's own search fields (see above).
  // Our own field never blocks (ae === input reads as non-editable),
  // so Ctrl+K still closes an open palette.
  function ctrlKBlockedByFocus() {
    try {
      if (isOpen()) {
        return false;
      }
      if (!isEditableFocused()) {
        return false;
      }
      return !isSearchFieldFocused();
    } catch (e) {
      return false;
    }
  }

  function moveSelection(delta) {
    if (!items.length) {
      return;
    }
    selected = (selected + delta + items.length) % items.length;
    paint();
    if (viewStack.length > 0) {
      const top = viewStack[viewStack.length - 1];
      if (typeof top.onPreview === "function") {
        try {
          top.onPreview(items[selected] || null);
        } catch (_e) {}
      }
    }
  }

  function onListKey(e) {
    const ctrl = !!(e.ctrlKey || e.metaKey);
    // Ctrl+N/P + Ctrl+J navigation (Ctrl+K stays the toggle — never hijack).
    if (ctrl && !e.altKey && !e.shiftKey && (e.key === "n" || e.key === "N" || e.key === "j" || e.key === "J")) {
      e.preventDefault();
      e.stopPropagation();
      moveSelection(1);
      return;
    }
    if (ctrl && !e.altKey && !e.shiftKey && (e.key === "p" || e.key === "P")) {
      e.preventDefault();
      e.stopPropagation();
      moveSelection(-1);
      return;
    }
    // Ctrl+W on a tab row closes that tab, keeps the palette open.
    if (ctrl && !e.altKey && !e.shiftKey && (e.key === "w" || e.key === "W")) {
      const it = items[selected];
      if (it && (it.kind === "tab" || it.tabRef)) {
        e.preventDefault();
        e.stopPropagation();
        try {
          if (typeof closeRowTab === "function" && closeRowTab(it)) {
            return;
          }
        } catch (_e) {}
      }
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      const it = items[selected];
      if (
        it &&
        !viewStack.length &&
        !prompt &&
        !iconPick &&
        (it.kind === "tab" || it.kind === "bookmark" || it.kind === "history" || it.kind === "go") &&
        typeof pushView === "function" &&
        typeof rowActionsView === "function"
      ) {
        e.preventDefault();
        e.stopPropagation();
        pushView(rowActionsView(it));
      }
      return;
    }
    if (e.altKey && !e.ctrlKey && !e.metaKey && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
      if (!viewStack.length && !prompt && !iconPick && typeof setPaletteMode === "function") {
        e.preventDefault();
        e.stopPropagation();
        const prefixes = ["", "@", "#", "b:", "h:", ">"];
        const modes = ["all", "tabs", "workspaces", "bookmarks", "history", "commands"];
        const curMode = typeof parseMode === "function" ? parseMode((input && input.value) || "").mode : "all";
        const idx = Math.max(0, modes.indexOf(curMode));
        const nextIdx = (idx + (e.key === "ArrowRight" ? 1 : -1) + modes.length) % modes.length;
        setPaletteMode(prefixes[nextIdx]);
      }
      return;
    }
    // Alt/ctrl + 1–9 quick-pick.
    if ((e.altKey || ctrl) && /^[1-9]$/.test(e.key || "")) {
      const idx = Number(e.key) - 1;
      if (idx < items.length) {
        e.preventDefault();
        e.stopPropagation();
        selected = idx;
        choose(!!e.shiftKey);
      }
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      e.stopPropagation();
      moveSelection(e.ctrlKey ? 10 : 1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      e.stopPropagation();
      // Terminal-history recall: empty input + Up restores the last
      // committed query instead of moving selection.
      try {
        const v = input && input.value ? String(input.value) : "";
        if (!v.trim() && lastCommittedQuery) {
          input.value = lastCommittedQuery;
          render(input.value);
          try {
            input.focus();
          } catch (_e) {}
          return;
        }
      } catch (_e) {}
      moveSelection(e.ctrlKey ? -10 : -1);
    } else if (e.key === "PageDown") {
      e.preventDefault();
      e.stopPropagation();
      moveSelection(10);
    } else if (e.key === "PageUp") {
      e.preventDefault();
      e.stopPropagation();
      moveSelection(-10);
    } else if (e.key === "Home") {
      e.preventDefault();
      e.stopPropagation();
      if (items.length) {
        selected = 0;
        paint();
      }
    } else if (e.key === "End") {
      e.preventDefault();
      e.stopPropagation();
      if (items.length) {
        selected = items.length - 1;
        paint();
      }
    } else if (e.key === "Tab") {
      // Autocomplete the highlighted row title into the input.
      const it = items[selected];
      if (it && input) {
        e.preventDefault();
        e.stopPropagation();
        try {
          input.value = it.title || "";
          render(input.value);
          try {
            input.focus();
          } catch (_e) {}
        } catch (_e2) {}
      }
    } else if (e.key === "Backspace") {
      if (viewStack.length > 0 && !(input && input.value)) {
        e.preventDefault();
        e.stopPropagation();
        if (typeof popView === "function") {
          popView(true);
        }
      }
    } else if (e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      choose(!!(e.altKey || e.shiftKey));
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      if (viewStack.length > 0 && typeof popView === "function") {
        popView(true);
        return;
      }
      // First Esc with a mode prefix + query clears to the prefix;
      // second Esc closes.
      try {
        const v = (input && input.value) || "";
        if (v.length > 1 && /^[>@#?]/.test(v)) {
          input.value = v[0];
          render(input.value);
          return;
        }
        if (/^[a-zA-Z]\s*:\s*\S/.test(v.trim())) {
          const m = v.match(/^([a-zA-Z]\s*:)/);
          if (m) {
            input.value = m[1] + " ";
            render(input.value);
            return;
          }
        }
      } catch (_e) {}
      close();
    }
  }

  function onKey(e) {
    if (e.repeat) {
      return;
    }
    const mod = e.ctrlKey || e.metaKey;
    // Ctrl/⌘+L opens the omnibox pre-filled with the current tab's URL.
    if (mod && !e.altKey && !e.shiftKey && e.code === "KeyL") {
      e.preventDefault();
      e.stopPropagation();
      if (typeof openEditURL === "function") {
        openEditURL();
      }
      return;
    }
    // Toggle on Ctrl/⌘+K (hijack Firefox's search-focus binding).
    if (mod && !e.altKey && !e.shiftKey && e.code === "KeyK") {
      // Never steal keystrokes from editable text (page editors,
      // sidebar inputs, devtools) — except the browser's own search
      // fields, which is where the hijacked binding lives.
      if (ctrlKBlockedByFocus()) {
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      toggle();
      return;
    }
    if (!isOpen()) {
      return;
    }
    if (
      e.key === "Escape" ||
      e.key === "ArrowDown" ||
      e.key === "ArrowUp" ||
      e.key === "Enter" ||
      e.key === "PageDown" ||
      e.key === "PageUp" ||
      e.key === "Home" ||
      e.key === "End" ||
      e.key === "Tab"
    ) {
      // Input-level handler covers these when focused; this is the fallback.
      onListKey(e);
    }
  }

  window.addEventListener("keydown", onKey, true);

  // Public API for the workspace badge / shortcuts / tab rename.
  try {
    window.AphPalette = {
      open,
      openMode,
      openEditURL,
      toggle,
      renameCurrent,
      setWsIcon: (n) => startIconPick(n),
      prompt: startPrompt,
    };
  } catch (e) {}

  if (document.readyState === "complete") {
    build();
  } else {
    window.addEventListener("load", build, { once: true });
  }
})();
