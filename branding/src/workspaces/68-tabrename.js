/* Aph tab rename — per-tab custom labels (chrome window).
 *
 * Stores a display name per tab in a SessionStore custom value: tab-scoped,
 * so it survives restarts, dies with the tab, and writes nothing to prefs.
 * The name is applied over the tab's `label` attribute (what the strip
 * renders). Stock Firefox recomputes labels on title changes through
 * _setTabLabel, which manually dispatches TabAttrModified — one listener
 * re-applies the stored name with no loop risk.
 *
 * Entry points: command palette ("Rename Tab…"), tab context menu, and
 * double-clicking the tab's label text. All paths route through AphPalette.prompt.
 * Injected into browser.xhtml via workspaces.js.
 */
  const TAB_NAME_KEY = "aphTabName";
  const TAB_NAME_HOOK = "data-aph-renamed";
  const TAB_NAME_MAX = 100;

  let tabRenameMenuItem = null;

  function rawName(tab) {
    try {
      const v = SessionStore.getCustomTabValue(tab, TAB_NAME_KEY);
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
        tab.setAttribute(TAB_NAME_HOOK, "1");
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
    const trimmed = String(name == null ? "" : name).trim().slice(0, TAB_NAME_MAX);
    try {
      if (trimmed) {
        SessionStore.setCustomTabValue(tab, TAB_NAME_KEY, trimmed);
        applyName(tab);
      } else {
        try {
          SessionStore.deleteCustomTabValue(tab, TAB_NAME_KEY);
        } catch (e) {
          SessionStore.setCustomTabValue(tab, TAB_NAME_KEY, "");
        }
        try {
          if (typeof tab.removeAttribute === "function") {
            tab.removeAttribute(TAB_NAME_HOOK);
          }
        } catch (e) {}
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

  function onTabAttrModified(e) {
    try {
      const tab = e && e.target;
      if (tab) {
        applyName(tab);
      }
    } catch (e) {}
  }

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

  function onTabDblClick(e) {
    try {
      if (!e || e.button !== 0) {
        return;
      }
      if (
        gBrowser &&
        gBrowser.tabContainer &&
        gBrowser.tabContainer._closeTabByDblclick
      ) {
        return;
      }
      const target = e.target;
      if (!target || typeof target.closest !== "function") {
        return;
      }
      const label = target.closest(
        ".tab-label, .tab-text, .tab-label-container"
      );
      if (!label) {
        return;
      }
      const tab =
        (typeof label.closest === "function" && label.closest("tab, .tabbrowser-tab")) ||
        (typeof target.closest === "function" && target.closest("tab, .tabbrowser-tab"));
      if (!tab || tab.closing) {
        return;
      }
      if (typeof e.preventDefault === "function") {
        e.preventDefault();
      }
      if (typeof e.stopPropagation === "function") {
        e.stopPropagation();
      }
      promptRename(tab);
    } catch (err) {}
  }

  function onTabMenuShowing(e) {
    try {
      const menu = document.getElementById("tabContextMenu");
      if (!menu) return;
      if (tabRenameMenuItem?.parentNode) {
        tabRenameMenuItem.remove();
        tabRenameMenuItem = null;
      }
      const trigger = (e?.target?.triggerNode) || (document?.popupNode) || null;
      const clicked = (typeof contextClickedTab === "function" ? contextClickedTab(e) : null) || (trigger?.closest?.("tab")) || (typeof gBrowser !== "undefined" && gBrowser?.selectedTab) || null;
      if (!clicked || clicked.closing) return;
      const item =
        typeof document.createXULElement === "function"
          ? document.createXULElement("menuitem")
          : document.createElement("menuitem");
      item.id = "aph-rename-tab";
      item.setAttribute("label", "Rename Tab…");
      item.addEventListener("command", () => {
        try {
          promptRename(clicked);
        } catch (err) {}
      });
      menu.appendChild(item);
      tabRenameMenuItem = item;
    } catch (e) {}
  }

  function cleanup() {
    try {
      gBrowser.tabContainer.removeEventListener("TabAttrModified", onTabAttrModified);
      gBrowser.tabContainer.removeEventListener("SSTabRestored", onTabRestored);
      gBrowser.tabContainer.removeEventListener("dblclick", onTabDblClick);
    } catch (e) {}
    try {
      const menu = document.getElementById("tabContextMenu");
      if (menu) {
        menu.removeEventListener("popupshowing", onTabMenuShowing);
      }
    } catch (e) {}
    try {
      if (tabRenameMenuItem && tabRenameMenuItem.parentNode) {
        tabRenameMenuItem.remove();
      }
    } catch (e) {}
    tabRenameMenuItem = null;
  }

  function initTabRename() {
    try {
      window.AphTabRename = { renameTab, getName, applyName, promptRename };
    } catch (e) {}
    try {
      gBrowser.tabContainer.addEventListener("TabAttrModified", onTabAttrModified);
      gBrowser.tabContainer.addEventListener("SSTabRestored", onTabRestored);
      gBrowser.tabContainer.addEventListener("dblclick", onTabDblClick);
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
    initTabRename();
  } else {
    window.addEventListener("load", initTabRename, { once: true });
  }
