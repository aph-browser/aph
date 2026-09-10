/* Aph tab rename — per-tab custom labels (chrome window).
 *
 * Stores a display name per tab in a SessionStore custom value: tab-scoped,
 * so it survives restarts, dies with the tab, and writes nothing to prefs.
 * The name is applied over the tab's `label` attribute (what the strip
 * renders). Stock Firefox recomputes labels on title changes through
 * _setTabLabel, which manually dispatches TabAttrModified — one listener
 * re-applies the stored name with no loop risk (raw attribute sets fire
 * no event of their own).
 *
 * Entry points: command palette ("Rename Tab…", via AphPalette.prompt) and
 * the tab context menu. Empty input clears back to the page title. The OS
 * titlebar follows via updateTitlebar when the renamed tab is selected.
 * Renamed tabs carry an unstyled `data-aph-renamed` hook for later theming.
 * Injected into browser.xhtml via rebrand.py.
 */
(function () {
  if (window.__aphTabRenameLoaded) {
    return;
  }
  window.__aphTabRenameLoaded = true;

  const KEY = "aphTabName";
  const HOOK = "data-aph-renamed";
  const NAME_MAX = 100;

  let menuItem = null;

  function rawName(tab) {
    try {
      const v = SessionStore.getCustomTabValue(tab, KEY);
      return typeof v === "string" && v ? v : null;
    } catch (e) {
      return null;
    }
  }

  function getName(tab) {
    try {
      return rawName(tab) || "";
    } catch (e) {
      return "";
    }
  }

  // The OS titlebar mirrors the selected tab — keep it agreeing with the
  // strip after a (re-)apply. Guarded: no-op everywhere without a titlebar
  // (tests, popups).
  function nudgeTitlebar(tab) {
    try {
      if (
        gBrowser.selectedTab === tab &&
        typeof gBrowser.updateTitlebar === "function"
      ) {
        gBrowser.updateTitlebar();
      }
    } catch (e) {}
  }

  // Idempotent: no-ops when the tab already shows the stored name.
  function applyName(tab) {
    let name = null;
    try {
      name = rawName(tab);
    } catch (e) {
      return false;
    }
    if (!name) {
      return false;
    }
    try {
      if (tab.closing) {
        return false;
      }
    } catch (e) {
      return false;
    }
    try {
      if (typeof tab.getAttribute === "function" && tab.getAttribute("label") !== name) {
        tab.setAttribute("label", name);
      }
    } catch (e) {}
    try {
      if (typeof tab.setAttribute === "function") {
        tab.setAttribute(HOOK, "1");
      }
    } catch (e) {}
    nudgeTitlebar(tab);
    return true;
  }

  function renameTab(tab, name) {
    if (!tab) {
      return false;
    }
    try {
      if (tab.closing) {
        return false;
      }
    } catch (e) {
      return false;
    }
    const trimmed = String(name == null ? "" : name).trim().slice(0, NAME_MAX);
    try {
      if (trimmed) {
        SessionStore.setCustomTabValue(tab, KEY, trimmed);
        applyName(tab);
      } else {
        try {
          SessionStore.deleteCustomTabValue(tab, KEY);
        } catch (e) {
          SessionStore.setCustomTabValue(tab, KEY, "");
        }
        try {
          if (typeof tab.removeAttribute === "function") {
            tab.removeAttribute(HOOK);
          }
        } catch (e) {}
        // Restore the real page title immediately instead of waiting for
        // the next title push.
        try {
          if (typeof gBrowser.setTabTitle === "function") {
            gBrowser.setTabTitle(tab);
          }
        } catch (e) {}
        nudgeTitlebar(tab);
      }
    } catch (e) {
      return false;
    }
    return true;
  }

  // Stock overwrote the label (navigation, SPA title push, restore) — put
  // the stored name back. Cheap: one SessionStore read + one compare, and
  // a no-op for the overwhelmingly common unrenamed case.
  function onTabAttrModified(e) {
    try {
      const tab = e && e.target;
      if (!tab) {
        return;
      }
      applyName(tab);
    } catch (e) {}
  }

  // Restored tabs keep their custom value but render the page title first.
  function onTabRestored(e) {
    try {
      if (e && e.target) {
        applyName(e.target);
      }
    } catch (e) {}
  }

  function palettePrompt() {
    try {
      return window.AphPalette && window.AphPalette.prompt
        ? window.AphPalette.prompt
        : null;
    } catch (e) {
      return null;
    }
  }

  function promptRename(tab) {
    const prompt = palettePrompt();
    if (!prompt || !tab) {
      return false;
    }
    try {
      if (tab.closing) {
        return false;
      }
    } catch (e) {
      return false;
    }
    let current = "";
    try {
      current = tab.label || "";
    } catch (e) {}
    try {
      prompt({
        title: "Rename Tab — Enter saves, empty clears",
        initial: getName(tab) || current,
        onCommit: (v) => {
          try {
            renameTab(tab, v);
          } catch (e) {}
        },
      });
      return true;
    } catch (e) {
      return false;
    }
  }

  // ---- inline editor (double-click the label text) ----
  // A floating <input> over the tab's label (the XUL <label> itself is not
  // editable). Commits through renameTab, so storage/re-apply semantics
  // are identical to the prompt path. Blur commits, Esc cancels, opening a
  // second editor commits the first.
  const EDITOR_ID = "aph-tab-rename-input";
  const EDITOR_MIN_WIDTH = 120;
  let editor = null; // { input, tab } while open

  function labelBox(tab) {
    try {
      const el =
        tab.querySelector(".tab-text") ||
        tab.querySelector(".tab-label-container");
      if (!el || typeof el.getBoundingClientRect !== "function") {
        return null;
      }
      const r = el.getBoundingClientRect();
      if (!r || (r.width <= 0 && r.height <= 0)) {
        return null;
      }
      return r;
    } catch (e) {
      return null;
    }
  }

  // Detach without committing (Esc, tab closed). Blur/Enter paths commit
  // first via closeEditor(true), which nulls `editor` so the trailing blur
  // becomes a no-op.
  function closeEditor(commit) {
    const ed = editor;
    editor = null;
    if (!ed) {
      return false;
    }
    let value = "";
    try {
      value = ed.input.value;
    } catch (e) {}
    try {
      ed.input.remove();
    } catch (e) {}
    if (commit) {
      try {
        renameTab(ed.tab, value);
      } catch (e) {}
      return true;
    }
    return false;
  }

  function syncEditorPos() {
    if (!editor) {
      return;
    }
    let r = null;
    try {
      r = labelBox(editor.tab);
    } catch (e) {}
    if (!r) {
      closeEditor(false);
      return;
    }
    try {
      const s = editor.input.style;
      s.left = `${r.left}px`;
      s.top = `${r.top}px`;
      s.width = `${Math.max(EDITOR_MIN_WIDTH, r.width)}px`;
      s.height = `${r.height}px`;
    } catch (e) {}
  }

  function openEditor(tab) {
    if (!tab) {
      return false;
    }
    try {
      if (tab.closing) {
        return false;
      }
    } catch (e) {
      return false;
    }
    if (editor) {
      if (editor.tab === tab) {
        try {
          editor.input.focus();
        } catch (e) {}
        return true;
      }
      closeEditor(true);
    }
    let r = null;
    try {
      r = labelBox(tab);
    } catch (e) {}
    if (!r) {
      return false;
    }
    let input = null;
    try {
      input = document.createElement("input");
      input.id = EDITOR_ID;
      input.setAttribute("autocomplete", "off");
      input.setAttribute("spellcheck", "false");
      const s = input.style;
      // Geometry only — all paint lives in theme.css #aph-tab-rename-input
      // (theme field vars, borderless). Never set visual styles here.
      s.position = "fixed";
      s.zIndex = "2147483647";
      s.left = `${r.left}px`;
      s.top = `${r.top}px`;
      s.width = `${Math.max(EDITOR_MIN_WIDTH, r.width)}px`;
      s.height = `${r.height}px`;
      try {
        input.value = getName(tab) || tab.label || "";
      } catch (e) {}
      (document.body || document.documentElement).appendChild(input);
    } catch (e) {
      return false;
    }
    editor = { input, tab };
    input.addEventListener("keydown", (ev) => {
      try {
        if (!ev) {
          return;
        }
        if (ev.key === "Enter") {
          ev.preventDefault();
          closeEditor(true);
        } else if (ev.key === "Escape") {
          ev.preventDefault();
          closeEditor(false);
        }
      } catch (e) {}
    });
    // NOTE: window-capture shortcut listeners (workspaces, textpick) run
    // before input handlers, so the input cannot shield itself — those
    // handlers early-return on EDITOR_ID targets instead.
    input.addEventListener("blur", () => {
      closeEditor(true);
    });
    try {
      input.focus();
    } catch (e) {}
    try {
      if (input.select) {
        input.select();
      }
    } catch (e) {}
    return true;
  }

  // Label text only: favicon, close and speaker buttons never start an
  // edit. Anything else (empty strip, other chrome) passes through so
  // stock dblclick behavior (new tab on empty area) is preserved.
  function onTabDblClick(e) {
    try {
      if (!e || e.button !== 0) {
        return;
      }
      let tab = null;
      try {
        const t = e.target;
        if (t && typeof t.closest === "function") {
          const labelEl = t.closest(".tab-label-container, .tab-text");
          if (
            labelEl &&
            typeof labelEl.closest === "function"
          ) {
            tab = labelEl.closest("tab");
          }
        }
      } catch (err) {}
      if (!tab) {
        return;
      }
      // The opt-in close-on-double-click pref wins over rename.
      try {
        if (gBrowser.tabContainer._closeTabByDblclick) {
          return;
        }
      } catch (err) {}
      try {
        if (tab.closing) {
          return;
        }
      } catch (err) {
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      openEditor(tab);
    } catch (err) {}
  }

  function onEditedTabClose(e) {
    try {
      if (editor && e && e.target === editor.tab) {
        closeEditor(false);
      }
    } catch (err) {}
  }

  function onStripScroll() {
    syncEditorPos();
  }

  function onTabMoved() {
    syncEditorPos();
  }

  function onWindowResize() {
    syncEditorPos();
  }

  function onTabMenuShowing(e) {
    try {
      const menu = e.currentTarget || e.target;
      if (!menu || typeof menu.appendChild !== "function") {
        return;
      }
      try {
        if (menuItem && menuItem.parentNode) {
          menuItem.remove();
        }
      } catch (err) {}
      menuItem = null;
      if (!palettePrompt()) {
        return;
      }
      let node = null;
      try {
        const popup = e.target;
        node = (popup && popup.triggerNode) || document.popupNode || null;
      } catch (err) {}
      // Same resolution as stock tab-context-menu.js and archive.js.
      let clicked = null;
      try {
        if (node) {
          clicked =
            node.tab ||
            (typeof node.closest === "function" ? node.closest("tab") : null);
        }
        if (!clicked && gBrowser.selectedTab) {
          clicked = gBrowser.selectedTab;
        }
      } catch (err) {
        clicked = null;
      }
      if (!clicked) {
        return;
      }
      try {
        if (clicked.closing) {
          return;
        }
      } catch (err) {}
      // browser.xhtml is XHTML: menu items must be XUL elements.
      const item =
        typeof document.createXULElement === "function"
          ? document.createXULElement("menuitem")
          : document.createElement("menuitem");
      try {
        item.id = "aph-rename-tab";
        item.setAttribute("label", "Rename Tab…");
      } catch (err) {}
      item.addEventListener("command", () => {
        try {
          promptRename(clicked);
        } catch (err) {}
      });
      menu.appendChild(item);
      menuItem = item;
    } catch (e) {}
  }

  function cleanup() {
    closeEditor(false);
    try {
      gBrowser.tabContainer.removeEventListener("TabAttrModified", onTabAttrModified);
    } catch (e) {}
    try {
      gBrowser.tabContainer.removeEventListener("SSTabRestored", onTabRestored);
    } catch (e) {}
    try {
      gBrowser.tabContainer.removeEventListener("dblclick", onTabDblClick);
    } catch (e) {}
    try {
      gBrowser.tabContainer.removeEventListener("TabClose", onEditedTabClose);
    } catch (e) {}
    try {
      gBrowser.tabContainer.removeEventListener("TabMove", onTabMoved);
    } catch (e) {}
    try {
      gBrowser.tabContainer.removeEventListener("scroll", onStripScroll, true);
    } catch (e) {}
    try {
      window.removeEventListener("resize", onWindowResize);
    } catch (e) {}
    try {
      const menu = document.getElementById("tabContextMenu");
      if (menu) {
        menu.removeEventListener("popupshowing", onTabMenuShowing);
      }
    } catch (e) {}
    try {
      if (menuItem && menuItem.parentNode) {
        menuItem.remove();
      }
    } catch (e) {}
    menuItem = null;
  }

  function init() {
    try {
      window.AphTabRename = { renameTab, getName, applyName, promptRename };
    } catch (e) {}
    try {
      gBrowser.tabContainer.addEventListener("TabAttrModified", onTabAttrModified);
    } catch (e) {}
    try {
      gBrowser.tabContainer.addEventListener("SSTabRestored", onTabRestored);
    } catch (e) {}
    try {
      gBrowser.tabContainer.addEventListener("dblclick", onTabDblClick);
    } catch (e) {}
    try {
      gBrowser.tabContainer.addEventListener("TabClose", onEditedTabClose);
    } catch (e) {}
    try {
      gBrowser.tabContainer.addEventListener("TabMove", onTabMoved);
    } catch (e) {}
    // Scroll doesn't bubble, but capture listeners on the container still
    // see inner strip scrolls (same technique as the text picker).
    try {
      gBrowser.tabContainer.addEventListener("scroll", onStripScroll, true);
    } catch (e) {}
    try {
      window.addEventListener("resize", onWindowResize);
    } catch (e) {}
    try {
      const menu = document.getElementById("tabContextMenu");
      if (menu && typeof menu.addEventListener === "function") {
        menu.addEventListener("popupshowing", onTabMenuShowing);
      }
    } catch (e) {}
    try {
      window.addEventListener("unload", cleanup, { once: true });
    } catch (e) {}
  }

  if (document.readyState === "complete") {
    init();
  } else {
    window.addEventListener("load", init, { once: true });
  }
})();
