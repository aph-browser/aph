  // Starred tabs: normal per-workspace tabs with an Essentials-style base
  // URL (captured at star time, editable). Right-click offers Star/Unstar
  // + "Reset to Starred Page" + "Set Starred Page…"; Ctrl/Cmd+W mirrors
  // pins (drifted resets in place, at-base parks via 50-unload.js).
  // State persists via SessionStore custom tab values (same mechanism as
  // workspace tags and 75-pinreset.js), so it survives session restore
  // free; `data-aph-starred="1"` is the CSS-only marker (theme.css).
  // Mutually exclusive with pins: starring a pinned tab is refused, and
  // pinning a starred tab unstars it (one base URL owns Ctrl+W).
  const STAR_FLAG_KEY = "aphStarred";
  const STAR_URL_KEY = "aphStarURL";
  const STAR_ATTR = "data-aph-starred";
  // The tab close button shows a star instead of the X on starred tabs
  // (theme.css §18 swaps the glyph); activating it unstars (below).
  const STAR_CLOSE_SELECTOR = ".tab-close-button";
  const STAR_CLOSE_TIP = "Unstar tab";

  // Last failure code for Browser-Console diagnosis (AphStar.debug()).
  // House style stays silent in prod; this keeps the silence debuggable.
  let starLastError = "";

  function starSpec(tab) {
    try {
      const uri = tab && tab.linkedBrowser && tab.linkedBrowser.currentURI;
      const spec = uri && uri.spec;
      return typeof spec === "string" ? spec : "";
    } catch (e) {
      return "";
    }
  }

  function isStarrableURL(url) {
    try {
      const u = new URL(String(url || ""));
      if (u.protocol === "javascript:") {
        return false;
      }
      return !!u.host || u.protocol.indexOf("about:") === 0;
    } catch (e) {
      return false;
    }
  }

  function isStarredTab(tab) {
    try {
      if (!tab) {
        return false;
      }
      let v = null;
      try {
        v = SessionStore.getCustomTabValue(tab, STAR_FLAG_KEY);
      } catch (e) {
        v = null;
      }
      if (v === "1") {
        return true;
      }
      // Restored before SSTabRestored re-applies: attribute backstop.
      try {
        if (typeof tab.hasAttribute === "function" && tab.hasAttribute(STAR_ATTR)) {
          return true;
        }
      } catch (e) {}
      try {
        if (typeof tab.getAttribute === "function" && tab.getAttribute(STAR_ATTR) === "1") {
          return true;
        }
      } catch (e) {}
      return false;
    } catch (e) {
      return false;
    }
  }

  function getStarURL(tab) {
    try {
      if (!tab) {
        return "";
      }
      let v = null;
      try {
        v = SessionStore.getCustomTabValue(tab, STAR_URL_KEY);
      } catch (e) {
        v = null;
      }
      return typeof v === "string" && v ? v : "";
    } catch (e) {
      return "";
    }
  }

  // Returns true when stored. Invalid URLs are rejected (previous value
  // kept) so a typo in the edit dialog can never brick the reset target.
  function setStarURL(tab, url) {
    try {
      if (!tab || !isStarrableURL(url)) {
        return false;
      }
      SessionStore.setCustomTabValue(tab, STAR_URL_KEY, String(url));
      return true;
    } catch (e) {
      try {
        starLastError = "set-threw";
      } catch (err) {}
      return false;
    }
  }

  function applyStarAttribute(tab) {
    try {
      if (!tab) {
        return;
      }
      const on = isStarredTab(tab);
      try {
        if (on) {
          if (typeof tab.setAttribute === "function") {
            tab.setAttribute(STAR_ATTR, "1");
          }
        } else if (typeof tab.removeAttribute === "function") {
          tab.removeAttribute(STAR_ATTR);
        }
      } catch (e) {}
    } catch (e) {}
  }

  function clearStar(tab) {
    try {
      if (!tab) {
        return;
      }
      try {
        if (SessionStore && typeof SessionStore.deleteCustomTabValue === "function") {
          SessionStore.deleteCustomTabValue(tab, STAR_FLAG_KEY);
          SessionStore.deleteCustomTabValue(tab, STAR_URL_KEY);
        } else {
          SessionStore.setCustomTabValue(tab, STAR_FLAG_KEY, "");
          SessionStore.setCustomTabValue(tab, STAR_URL_KEY, "");
        }
      } catch (e) {}
      try {
        if (typeof tab.removeAttribute === "function") {
          tab.removeAttribute(STAR_ATTR);
        }
      } catch (e) {}
      try {
        syncStarCloseTooltip(tab);
      } catch (e) {}
    } catch (e) {}
  }

  // Starred tabs without a stored value (flag restored, URL lost) fall
  // back to the live URL so reset/menu never dead-end on them.
  function effectiveStarURL(tab) {
    try {
      return getStarURL(tab) || starSpec(tab);
    } catch (e) {
      return "";
    }
  }

  function loadStarURL(browser, url) {
    let principal = null;
    try {
      principal = systemPrincipal();
    } catch (e) {
      principal = null;
    }
    try {
      if (browser && typeof browser.fixupAndLoadURIString === "function") {
        browser.fixupAndLoadURIString(url, { triggeringPrincipal: principal });
        return true;
      }
    } catch (e) {
      try {
        starLastError = "fixup-threw";
      } catch (err) {}
    }
    // Fallback for browsers without the fixup helper wired up.
    try {
      if (browser && typeof browser.loadURI === "function" && Services && Services.io) {
        browser.loadURI(Services.io.newURI(url), { triggeringPrincipal: principal });
        return true;
      }
    } catch (e) {
      try {
        starLastError = "loadURI-threw";
      } catch (err) {}
    }
    try {
      if (!starLastError) {
        starLastError = "no-loader";
      }
    } catch (err) {}
    return false;
  }

  // Returns true when navigation was kicked off.
  function resetStarTab(tab) {
    try {
      if (!tab || !isStarredTab(tab)) {
        return false;
      }
      if (tab.pinned) {
        return false;
      }
      const url = effectiveStarURL(tab);
      if (!url) {
        try {
          starLastError = "no-url";
        } catch (err) {}
        return false;
      }
      const browser = tab.linkedBrowser;
      if (!browser) {
        try {
          starLastError = "no-browser";
        } catch (err) {}
        return false;
      }
      return loadStarURL(browser, url);
    } catch (e) {
      try {
        starLastError = "reset-threw";
      } catch (err) {}
      return false;
    }
  }

  // Star captures the live page as the default base URL (a custom value
  // wins — re-starring never clobbers an edited URL). Pinned tabs refuse:
  // pins own their own base URL via 75-pinreset.js.
  function starTab(tab) {
    try {
      if (!tab || tab.pinned) {
        return false;
      }
      try {
        SessionStore.setCustomTabValue(tab, STAR_FLAG_KEY, "1");
      } catch (e) {
        return false;
      }
      if (!getStarURL(tab)) {
        const spec = starSpec(tab);
        if (spec) {
          try {
            SessionStore.setCustomTabValue(tab, STAR_URL_KEY, spec);
          } catch (e) {}
        }
      }
      applyStarAttribute(tab);
      try {
        syncStarCloseTooltip(tab);
      } catch (e) {}
      return true;
    } catch (e) {
      return false;
    }
  }

  function unstarTab(tab) {
    try {
      if (!tab || !isStarredTab(tab)) {
        return false;
      }
      clearStar(tab);
      return true;
    } catch (e) {
      return false;
    }
  }

  function toggleStarTab(tab) {
    try {
      if (!tab) {
        return false;
      }
      if (isStarredTab(tab)) {
        return unstarTab(tab);
      }
      return starTab(tab);
    } catch (e) {
      return false;
    }
  }

  function toggleSelectedStar() {
    try {
      if (gBrowser && gBrowser.selectedTab) {
        return toggleStarTab(gBrowser.selectedTab);
      }
    } catch (e) {}
    return false;
  }

  // Pinning wins: a pinned tab keeps the pin base URL only.
  function onStarTabPinned(e) {
    let tab = null;
    try {
      tab = e && e.target;
    } catch (err) {}
    try {
      if (tab && tab.pinned && isStarredTab(tab)) {
        clearStar(tab);
      }
    } catch (err) {}
  }

  // Restored tabs keep SessionStore values; re-apply the CSS marker.
  function onStarTabRestored(e) {
    let tab = null;
    try {
      tab = e && e.target;
    } catch (err) {}
    if (!tab) {
      return;
    }
    try {
      syncStarTabChrome(tab);
    } catch (err) {}
  }

  // Resolve the right-clicked tab, mirroring 75-pinreset.js: triggerNode
  // may carry the tab directly (.tab) or contain it; fall back to selected.
  function starClickedTab(e) {
    try {
      const popup = e && e.target;
      const node = (popup && popup.triggerNode) || document.popupNode || null;
      if (node) {
        const direct =
          node.tab ||
          (typeof node.closest === "function" ? node.closest("tab") : null);
        if (direct) {
          return direct;
        }
      }
      if (gBrowser && gBrowser.selectedTab) {
        return gBrowser.selectedTab;
      }
    } catch (err) {}
    return null;
  }

  function makeStarMenuItem(id, label, action) {
    let item = null;
    try {
      // browser.xhtml is an XHTML document: document.createElement would
      // build an HTML-namespaced dud inside the XUL menupopup (same
      // gotcha as archive.js / 75-pinreset.js).
      item =
        typeof document.createXULElement === "function"
          ? document.createXULElement("menuitem")
          : document.createElement("menuitem");
      item.id = id;
      item.setAttribute("label", label);
      if (typeof item.addEventListener === "function") {
        item.addEventListener("command", action);
      }
    } catch (err) {
      item = null;
    }
    return item;
  }

  let starMenuItems = [];

  function clearStarMenu() {
    try {
      for (const it of starMenuItems) {
        try {
          if (it && it.parentNode) {
            it.parentNode.removeChild(it);
          } else if (it && typeof it.remove === "function") {
            it.remove();
          }
        } catch (err) {}
      }
    } catch (err) {}
    starMenuItems = [];
  }

  function promptStarURL(tab, initial) {
    const commit = (v) => {
      try {
        const value = String(v == null ? "" : v).trim();
        if (value) {
          setStarURL(tab, value);
        }
      } catch (err) {}
    };
    try {
      if (window.AphPalette && typeof window.AphPalette.prompt === "function") {
        window.AphPalette.prompt({
          title: "Set Starred Page — Enter saves, Esc cancels",
          initial: initial || "",
          onCommit: commit,
        });
        return;
      }
    } catch (err) {}
    // Palette unavailable (tests, minimal chrome): stock prompt fallback.
    try {
      if (typeof window.prompt === "function") {
        commit(window.prompt("Set Starred Page URL:", initial || ""));
      }
    } catch (err) {}
  }

  function onStarMenuShowing(e) {
    try {
      const menu = (e && (e.currentTarget || e.target)) || null;
      if (!menu || typeof menu.appendChild !== "function") {
        return;
      }
      clearStarMenu();
      const tab = starClickedTab(e);
      if (!tab || tab.pinned) {
        return;
      }
      const starred = isStarredTab(tab);
      const toggle = makeStarMenuItem(
        "aph-star-toggle",
        starred ? "Unstar Tab" : "Star Tab",
        () => {
          try {
            toggleStarTab(tab);
          } catch (err) {}
        }
      );
      if (toggle) {
        try {
          menu.appendChild(toggle);
          starMenuItems.push(toggle);
        } catch (err) {}
      }
      if (!starred) {
        return;
      }
      const stored = effectiveStarURL(tab);
      const reset = makeStarMenuItem("aph-star-reset", "Reset to Starred Page", () => {
        try {
          resetStarTab(tab);
        } catch (err) {}
      });
      if (reset) {
        // Grey out when already there — nothing to do.
        try {
          if (stored && stored === starSpec(tab)) {
            reset.setAttribute("disabled", "true");
          }
        } catch (err) {}
        try {
          menu.appendChild(reset);
          starMenuItems.push(reset);
        } catch (err) {}
      }
      const edit = makeStarMenuItem("aph-star-set", "Set Starred Page…", () => {
        try {
          // Live-first: Enter alone re-stars the current page (the common
          // "make this the base" case); stored is the fallback.
          promptStarURL(tab, starSpec(tab) || stored);
        } catch (err) {}
      });
      if (edit) {
        try {
          menu.appendChild(edit);
          starMenuItems.push(edit);
        } catch (err) {}
      }
    } catch (err) {}
  }

  function closeButtonOf(tab) {
    try {
      if (tab && typeof tab.querySelector === "function") {
        return tab.querySelector(STAR_CLOSE_SELECTOR);
      }
    } catch (err) {}
    return null;
  }

  // Best-effort tooltip: the star button unstars, so "Close tab" would
  // lie. Stock may overwrite it on hover; the glyph (theme.css §18)
  // remains the source of truth.
  function syncStarCloseTooltip(tab) {
    let btn = null;
    try {
      btn = closeButtonOf(tab);
    } catch (err) {}
    if (!btn) {
      return;
    }
    try {
      if (isStarredTab(tab) && !(tab && tab.pinned)) {
        if (typeof btn.setAttribute === "function") {
          btn.setAttribute("tooltiptext", STAR_CLOSE_TIP);
        }
      } else if (typeof btn.removeAttribute === "function") {
        btn.removeAttribute("tooltiptext");
      }
    } catch (err) {}
  }

  // Central per-tab star sync (the visual half of syncTabChrome in
  // 30-names-tags.js): marker + close tooltip always reflect state,
  // setting or removing as needed.
  function syncStarTabChrome(tab) {
    try {
      applyStarAttribute(tab);
    } catch (err) {}
    try {
      syncStarCloseTooltip(tab);
    } catch (err) {}
  }

  // Owner tab when the event targets a starred tab's close (star)
  // button; null otherwise. Pinned tabs are excluded — pins own X.
  function starCloseOwner(e) {
    try {
      const t = e && e.target;
      const btn =
        t && typeof t.closest === "function" ? t.closest(STAR_CLOSE_SELECTOR) : null;
      if (!btn) {
        return null;
      }
      const tab =
        typeof btn.closest === "function" ? btn.closest("tab") : null;
      if (tab && !tab.pinned && isStarredTab(tab)) {
        return tab;
      }
    } catch (err) {}
    return null;
  }

  // The star button unstars instead of closing. Capture on the tab
  // container (ancestor — fires before the button's own stock handler),
  // so the swallowed activation can never leak through to a close.
  // Listens to both `click` (mouse/touch) and `command` (keyboard
  // activation via Space/Enter on a focused button, which bypasses
  // click). mousedown is deliberately untouched (no stock close acts
  // on it; selection side effects are harmless).
  function onStarCloseEvent(e) {
    let tab = null;
    try {
      tab = starCloseOwner(e);
    } catch (err) {}
    if (!tab) {
      return;
    }
    try {
      if (e) {
        if (typeof e.preventDefault === "function") {
          e.preventDefault();
        }
        if (typeof e.stopPropagation === "function") {
          e.stopPropagation();
        }
      }
    } catch (err) {}
    try {
      unstarTab(tab);
    } catch (err) {}
  }

  function syncAllStarAttributes() {
    try {
      if (!gBrowser || !gBrowser.tabs) {
        return;
      }
      for (const t of gBrowser.tabs) {
        try {
          // Single spelling for the per-tab sync (same outcome as the
          // inline version: the attribute backstop in isStarredTab keeps
          // a marker that SessionStore hasn't contradicted yet).
          syncStarTabChrome(t);
        } catch (e) {}
      }
    } catch (e) {}
  }

  function cleanupStar() {
    try {
      clearStarMenu();
    } catch (e) {}
    try {
      if (gBrowser && gBrowser.tabContainer) {
        gBrowser.tabContainer.removeEventListener("TabPinned", onStarTabPinned);
        gBrowser.tabContainer.removeEventListener("SSTabRestored", onStarTabRestored);
        gBrowser.tabContainer.removeEventListener("click", onStarCloseEvent, true);
        gBrowser.tabContainer.removeEventListener("command", onStarCloseEvent, true);
      }
    } catch (e) {}
    try {
      const menu = document.getElementById("tabContextMenu");
      if (menu) {
        menu.removeEventListener("popupshowing", onStarMenuShowing);
      }
    } catch (e) {}
  }

  function initStar() {
    try {
      syncAllStarAttributes();
    } catch (e) {}
    try {
      if (gBrowser && gBrowser.tabContainer) {
        gBrowser.tabContainer.addEventListener("TabPinned", onStarTabPinned);
        gBrowser.tabContainer.addEventListener("SSTabRestored", onStarTabRestored);
        gBrowser.tabContainer.addEventListener("click", onStarCloseEvent, true);
        gBrowser.tabContainer.addEventListener("command", onStarCloseEvent, true);
      }
    } catch (e) {}
    try {
      const menu = document.getElementById("tabContextMenu");
      if (menu && typeof menu.addEventListener === "function") {
        menu.addEventListener("popupshowing", onStarMenuShowing);
      }
    } catch (e) {}
    try {
      window.addEventListener("unload", cleanupStar, { once: true });
    } catch (e) {}
    try {
      window.AphStar = {
        isStarred: isStarredTab,
        getStarURL,
        setStarURL,
        starTab,
        unstarTab,
        toggleStarTab,
        toggleSelectedStar,
        resetStarTab,
        promptStarURL,
        STAR_FLAG_KEY,
        STAR_URL_KEY,
        debug: () => {
          try {
            return { lastError: starLastError || null };
          } catch (err) {
            return { lastError: "debug-threw" };
          }
        },
      };
    } catch (e) {}
  }

  if (document.readyState === "complete") {
    initStar();
  } else {
    window.addEventListener("load", initStar, { once: true });
  }
