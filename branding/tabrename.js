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
      if (!menu) {
        return;
      }
      if (menuItem && menuItem.parentNode) {
        menuItem.remove();
        menuItem = null;
      }
      const trigger =
        (e && e.target && e.target.triggerNode) ||
        (document && document.popupNode) ||
        null;
      if (!trigger || typeof trigger.closest !== "function") {
        return;
      }
      const clicked = trigger.closest("tab");
      if (!clicked || clicked.closing) {
        return;
      }
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
      menuItem = item;
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
    init();
  } else {
    window.addEventListener("load", init, { once: true });
  }
})();
