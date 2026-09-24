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

  function moveSelection(delta) {
    if (!items.length) {
      return;
    }
    selected = (selected + delta + items.length) % items.length;
    paint();
  }

  // Live modifier peeking: holding bare Alt/Ctrl morphs the footer in
  // real time to show what Enter (or Ctrl+W) would do — no commit needed.
  // Release restores the normal footer via the keyup handler below.
  function peekBaseAction(it) {
    try {
      if (!it) {
        return "Run";
      }
      if (it.kind === "tab") {
        return "Switch to tab";
      }
      if (it.kind === "help") {
        return "Insert prefix";
      }
      if (it.kind === "archive") {
        return "Restore entry";
      }
      if (it.kind === "go" || it.kind === "bookmark" || it.kind === "history") {
        return "Open";
      }
      if (it.kind === "search") {
        return "Search";
      }
      return "Run command";
    } catch (e) {
      return "Run";
    }
  }

  function peekText(it, alt, ctrlMod) {
    try {
      if (ctrlMod && it && (it.kind === "tab" || it.tabRef)) {
        return "⌃W Close tab — palette stays open · release to cancel";
      }
      if (alt && it && it.runInTemp) {
        return "⌥↵ Open in temp container · release to cancel";
      }
      return `↵ ${peekBaseAction(it)} · hold ⌥/⌃ to peek alternatives`;
    } catch (e) {
      return "";
    }
  }

  // True when e is a bare modifier press handled as a footer peek.
  function modifierPeek(e) {
    try {
      const k = e.key || "";
      const bareAlt = k === "Alt" && !e.ctrlKey && !e.metaKey && !e.shiftKey;
      const bareCtrl =
        (k === "Control" || k === "Meta") && !e.altKey && !e.shiftKey;
      if (!bareAlt && !bareCtrl) {
        return false;
      }
      // Swallow so bare Alt can't yank focus to the Firefox menu bar.
      e.preventDefault();
      e.stopPropagation();
      if (footer) {
        const t = peekText(items[selected], bareAlt, bareCtrl);
        if (t) {
          footer.textContent = t;
        }
      }
      return true;
    } catch (e) {
      return false;
    }
  }

  function onListKey(e) {
    if (modifierPeek(e)) {
      return;
    }
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
    } else if (e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      choose(!!(e.altKey || e.shiftKey));
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
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
    // Toggle on Ctrl/⌘+K (hijack Firefox's search-focus binding).
    if (mod && !e.altKey && !e.shiftKey && e.code === "KeyK") {
      // Never steal keystrokes from editable text (urlbar, sidebar
      // inputs, devtools, page editors). Our own field is exempt so
      // Ctrl+K still closes an open palette.
      if (!isOpen() && isEditableFocused()) {
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
      e.key === "Tab" ||
      e.key === "Alt" ||
      e.key === "Control" ||
      e.key === "Meta"
    ) {
      // Input-level handler covers these when focused; this is the fallback.
      onListKey(e);
    }
  }

  window.addEventListener("keydown", onKey, true);

  // Releasing a peeked modifier restores the normal footer (repaint is
  // cheap with pooled rows). Swallows bare Alt release so the Firefox
  // menu bar never steals focus from an open palette.
  window.addEventListener(
    "keyup",
    (e) => {
      try {
        if (!isOpen()) {
          return;
        }
        const k = e.key || "";
        if (k === "Alt" || k === "Control" || k === "Meta") {
          e.preventDefault();
          e.stopPropagation();
          paint();
        }
      } catch (_e) {}
    },
    true
  );

  // Public API for the workspace badge / shortcuts / tab rename.
  try {
    window.AphPalette = { open, toggle, renameCurrent, prompt: startPrompt };
  } catch (e) {}

  if (document.readyState === "complete") {
    build();
  } else {
    window.addEventListener("load", build, { once: true });
  }
})();
