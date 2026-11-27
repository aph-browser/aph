  // Sacred return-of-focus: remember who had focus before the palette
  // stole it (page input, editor, video player). Skips our own input and
  // anything already inside the overlay so reopen keeps the original element.
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
    // Already open: never replay the pop animation or wipe the typed
    // query (redundant open() calls arrive from dock-menu fallbacks).
    if (isOpen()) {
      setTimeout(() => {
        try {
          input.focus();
        } catch (e) {}
      }, 0);
      return;
    }
    captureFocus();
    prompt = null;
    iconPick = null;
    editCurrentTab = false;
    try {
      if (typeof invalidatePaletteCache === "function") {
        invalidatePaletteCache();
      }
    } catch (e) {}
    overlay.hidden = false;
    // Pop-in animation: re-trigger on every open, skipped under
    // reduced-motion (parity with close() instant-hide).
    try {
      let reduce = false;
      try {
        reduce = !!(
          window.matchMedia &&
          window.matchMedia("(prefers-reduced-motion: reduce)").matches
        );
      } catch (e) {}
      if (!reduce) {
        // Add only — no remove + forced reflow. The class is absent on
        // every arrival: close() strips it (both the animated and
        // instant paths), and the already-open early-return above means
        // open() can never reach here twice in a row. Re-adding alone
        // restarts the animation because the element is display:none
        // until `overlay.hidden = false` a line earlier.
        const box =
          overlay.querySelector && overlay.querySelector("#aph-palette");
        if (box) {
          box.classList.add("aph-palette-anim");
        }
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
    if (overlay.hidden) {
      captureFocus();
    }
    prompt = opts;
    iconPick = null;
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

  // Icon-pick mode: the list becomes the vendored Lucide grid for one
  // workspace. Typing filters by key/label, Enter commits the mark,
  // Esc cancels via close(). Single code path for the palette command,
  // the dock-menu shortcut, and Alt+number (all funnel through choose
  // or the row run below).
  function startIconPick(n) {
    const api = ws();
    if (!api || typeof api.setWsIcon !== "function") {
      return;
    }
    let id = "";
    try {
      id = /^[1-9]$/.test(String(n)) ? String(n) : (api.getCurrent && api.getCurrent()) || "";
    } catch (e) {}
    if (!/^[1-9]$/.test(id)) {
      return;
    }
    if (!overlay) {
      build();
    }
    if (!overlay || !input) {
      return;
    }
    if (overlay.hidden) {
      captureFocus();
    }
    prompt = null;
    iconPick = { ws: id };
    overlay.hidden = false;
    try {
      input.setAttribute(
        "placeholder",
        `Icon for Workspace ${id} — type to filter, Enter sets, Esc cancels`
      );
    } catch (e) {}
    try {
      input.value = "";
    } catch (e) {}
    render("");
    setTimeout(() => {
      try {
        input.focus();
      } catch (e) {}
    }, 0);
  }

  function commitIconKey(wsId, key) {
    const api = ws();
    iconPick = null;
    close();
    try {
      if (api && typeof api.setWsIcon === "function") {
        api.setWsIcon(wsId, key || "");
      }
    } catch (e) {}
  }

  // Tab rename entry point: prompts for the selected tab via the tab-rename
  // controller (branding/src/workspaces/68-tabrename.js). No-ops when it is absent (tests).
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

  function pushView(view) {
    if (!overlay) {
      build();
    }
    if (overlay && overlay.hidden) {
      captureFocus();
      overlay.hidden = false;
    }
    viewStack.push({
      ...view,
      prevQuery: (input && input.value) || "",
      prevSelected: selected,
    });
    try {
      if (input) {
        input.value = "";
        if (view.placeholder) {
          input.setAttribute("placeholder", view.placeholder);
        }
      }
    } catch (_e) {}
    render("");
    setTimeout(() => {
      try {
        input && input.focus();
      } catch (_e) {}
    }, 0);
  }

  function popView(cancel) {
    if (!viewStack.length) {
      return false;
    }
    const top = viewStack.pop();
    if (cancel && typeof top.onCancel === "function") {
      try {
        top.onCancel();
      } catch (_e) {}
    }
    const prevQ = top.prevQuery || "";
    try {
      if (input) {
        input.value = prevQ;
      }
    } catch (_e) {}
    render(prevQ);
    if (typeof top.prevSelected === "number" && top.prevSelected < items.length) {
      selected = top.prevSelected;
      paint();
    }
    try {
      input && input.focus();
    } catch (_e) {}
    return true;
  }

  function clearViews(cancel) {
    while (viewStack.length) {
      const top = viewStack.pop();
      if (cancel && typeof top.onCancel === "function") {
        try {
          top.onCancel();
        } catch (_e) {}
      }
    }
  }

  function close() {
    prompt = null;
    iconPick = null;
    editCurrentTab = false;
    clearViews(true);
    try {
      if (typeof invalidatePaletteCache === "function") {
        invalidatePaletteCache();
      }
    } catch (e) {}
    if (!overlay || overlay.hidden) {
      return;
    }
    restoreFocus();
    overlay.hidden = true;
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

  function setPaletteMode(prefix) {
    if (!overlay) {
      build();
    }
    const cur = (input && input.value) || "";
    const parsed = typeof parseMode === "function" ? parseMode(cur) : { q: cur.trim() };
    const q = parsed.q || "";
    const next = prefix ? (prefix.endsWith(":") ? `${prefix} ${q}` : `${prefix}${q}`) : q;
    if (input) {
      input.value = next;
    }
    render(next);
    try {
      input && input.focus();
    } catch (_e) {}
  }

  function openMode(prefix) {
    open();
    setPaletteMode(prefix || "");
  }

  function openEditURL() {
    let url = "";
    try {
      const spec = gBrowser?.selectedBrowser?.currentURI?.spec || "";
      if (spec && spec !== "about:newtab" && spec !== "about:blank") {
        url = spec;
      }
    } catch (_e) {}
    open();
    editCurrentTab = true;
    try {
      if (input) {
        input.value = url;
        render(url);
        setTimeout(() => {
          try {
            input.focus();
            if (url && typeof input.select === "function") {
              input.select();
            }
          } catch (_e) {}
        }, 0);
      }
    } catch (_e) {}
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
    if (viewStack.length > 0) {
      const top = viewStack[viewStack.length - 1];
      const it = items[selected];
      if (!it) {
        popView(true);
        return;
      }
      if (!it.keepOpen) {
        clearViews(false);
        close();
      }
      try {
        if (typeof top.onSelect === "function") {
          top.onSelect(it);
        } else if (typeof it.run === "function") {
          it.run();
        }
      } catch (_e) {}
      if (it.keepOpen) {
        try {
          if (typeof invalidatePaletteCache === "function") {
            invalidatePaletteCache();
          }
          render(input ? input.value : "");
        } catch (_e) {}
      }
      return;
    }
    if (iconPick) {
      const it = items[selected];
      // Empty filter match: nothing to commit — just leave.
      if (!it) {
        iconPick = null;
        close();
        return;
      }
      const wsId = iconPick.ws;
      const key = it.iconKey || "";
      commitIconKey(wsId, key);
      return;
    }
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

