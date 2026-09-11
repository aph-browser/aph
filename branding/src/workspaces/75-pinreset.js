  // Zen-style pinned-tab URLs: every pinned tab owns a "pinned URL"
  // (captured at pin time, editable). Right-click offers "Reset to Pinned
  // Page" + "Set Pinned Page…". Values persist via SessionStore custom
  // tab values (same mechanism as workspace tags), so they survive
  // session restore free.
  // NOTE: close-to-reset was tried and removed — TabClose is a
  // non-cancelable notification in stock Firefox ("committed to closing"),
  // and the re-open replacement proved unreliable in practice. Pinned
  // tabs close normally; getting back is what Reset is for.
  const PIN_URL_KEY = "aphPinURL";

  // Last failure code for Browser-Console diagnosis (AphPinReset.debug()).
  // House style stays silent in prod; this keeps the silence debuggable.
  let pinLastError = "";

  function pinSpec(tab) {
    try {
      const uri = tab && tab.linkedBrowser && tab.linkedBrowser.currentURI;
      const spec = uri && uri.spec;
      return typeof spec === "string" ? spec : "";
    } catch (e) {
      return "";
    }
  }

  function isPinnableURL(url) {
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

  function getPinURL(tab) {
    try {
      if (!tab) {
        return "";
      }
      let v = null;
      try {
        v = SessionStore.getCustomTabValue(tab, PIN_URL_KEY);
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
  function setPinURL(tab, url) {
    try {
      if (!tab || !isPinnableURL(url)) {
        return false;
      }
      SessionStore.setCustomTabValue(tab, PIN_URL_KEY, String(url));
      return true;
    } catch (e) {
      try {
        pinLastError = "set-threw";
      } catch (err) {}
      return false;
    }
  }

  function clearPinURL(tab) {
    try {
      if (!tab) {
        return;
      }
      if (SessionStore && typeof SessionStore.deleteCustomTabValue === "function") {
        SessionStore.deleteCustomTabValue(tab, PIN_URL_KEY);
      } else {
        SessionStore.setCustomTabValue(tab, PIN_URL_KEY, "");
      }
    } catch (e) {}
  }

  // Legacy pins (pinned before this feature) have no stored value:
  // fall back to the live URL so reset/menu never dead-end on them.
  function effectivePinURL(tab) {
    try {
      return getPinURL(tab) || pinSpec(tab);
    } catch (e) {
      return "";
    }
  }

  function systemPrincipal() {
    try {
      return Services.scriptSecurityManager.getSystemPrincipal();
    } catch (e) {
      return null;
    }
  }

  function loadPinURL(browser, url) {
    const principal = systemPrincipal();
    try {
      if (browser && typeof browser.fixupAndLoadURIString === "function") {
        browser.fixupAndLoadURIString(url, { triggeringPrincipal: principal });
        return true;
      }
    } catch (e) {
      try {
        pinLastError = "fixup-threw";
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
        pinLastError = "loadURI-threw";
      } catch (err) {}
    }
    try {
      if (!pinLastError) {
        pinLastError = "no-loader";
      }
    } catch (err) {}
    return false;
  }

  // Returns true when navigation was kicked off.
  function resetPinTab(tab) {
    try {
      if (!tab || !tab.pinned) {
        return false;
      }
      const url = effectivePinURL(tab);
      if (!url) {
        try {
          pinLastError = "no-url";
        } catch (err) {}
        return false;
      }
      const browser = tab.linkedBrowser;
      if (!browser) {
        try {
          pinLastError = "no-browser";
        } catch (err) {}
        return false;
      }
      return loadPinURL(browser, url);
    } catch (e) {
      try {
        pinLastError = "reset-threw";
      } catch (err) {}
      return false;
    }
  }

  // Pin captures its live page as the default (custom values win — a
  // re-pin never clobbers an edited URL). Unpin clears for a fresh
  // default next time.
  function onPinChanged(e) {
    let tab = null;
    try {
      tab = e && e.target;
    } catch (err) {}
    if (!tab) {
      return;
    }
    try {
      if (tab.pinned) {
        if (!getPinURL(tab)) {
          const spec = pinSpec(tab);
          if (spec) {
            SessionStore.setCustomTabValue(tab, PIN_URL_KEY, spec);
          }
        }
      } else {
        clearPinURL(tab);
      }
    } catch (err) {}
  }

  // Resolve the right-clicked tab, mirroring stock tab-context-menu.js and
  // the archive.js pattern: triggerNode may carry the tab directly (.tab)
  // or contain it; fall back to the selected tab.
  function pinClickedTab(e) {
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

  function makePinMenuItem(id, label, action) {
    let item = null;
    try {
      // browser.xhtml is an XHTML document: document.createElement would
      // build an HTML-namespaced dud inside the XUL menupopup (same
      // gotcha as archive.js).
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

  let pinMenuItems = [];

  function clearPinMenu() {
    try {
      for (const it of pinMenuItems) {
        try {
          if (it && it.parentNode) {
            it.parentNode.removeChild(it);
          } else if (it && typeof it.remove === "function") {
            it.remove();
          }
        } catch (err) {}
      }
    } catch (err) {}
    pinMenuItems = [];
  }

  function promptPinURL(tab, initial) {
    const commit = (v) => {
      try {
        const value = String(v == null ? "" : v).trim();
        if (value) {
          setPinURL(tab, value);
        }
      } catch (err) {}
    };
    try {
      if (window.AphPalette && typeof window.AphPalette.prompt === "function") {
        window.AphPalette.prompt({
          title: "Set Pinned Page — Enter saves, Esc cancels",
          initial: initial || "",
          onCommit: commit,
        });
        return;
      }
    } catch (err) {}
    // Palette unavailable (tests, minimal chrome): stock prompt fallback.
    try {
      if (typeof window.prompt === "function") {
        commit(window.prompt("Set Pinned Page URL:", initial || ""));
      }
    } catch (err) {}
  }

  function onPinMenuShowing(e) {
    try {
      const menu = (e && (e.currentTarget || e.target)) || null;
      if (!menu || typeof menu.appendChild !== "function") {
        return;
      }
      clearPinMenu();
      const tab = pinClickedTab(e);
      if (!tab || !tab.pinned) {
        return;
      }
      const stored = effectivePinURL(tab);
      const reset = makePinMenuItem("aph-pinreset-reset", "Reset to Pinned Page", () => {
        try {
          resetPinTab(tab);
        } catch (err) {}
      });
      if (reset) {
        // Grey out when already there — nothing to do.
        try {
          if (stored && stored === pinSpec(tab)) {
            reset.setAttribute("disabled", "true");
          }
        } catch (err) {}
        try {
          menu.appendChild(reset);
          pinMenuItems.push(reset);
        } catch (err) {}
      }
      const edit = makePinMenuItem("aph-pinreset-set", "Set Pinned Page…", () => {
        try {
          promptPinURL(tab, stored || pinSpec(tab));
        } catch (err) {}
      });
      if (edit) {
        try {
          menu.appendChild(edit);
          pinMenuItems.push(edit);
        } catch (err) {}
      }
    } catch (err) {}
  }

  function cleanupPinReset() {
    try {
      clearPinMenu();
    } catch (e) {}
    try {
      if (gBrowser && gBrowser.tabContainer) {
        gBrowser.tabContainer.removeEventListener("TabPinned", onPinChanged);
        gBrowser.tabContainer.removeEventListener("TabUnpinned", onPinChanged);
      }
    } catch (e) {}
    try {
      const menu = document.getElementById("tabContextMenu");
      if (menu) {
        menu.removeEventListener("popupshowing", onPinMenuShowing);
      }
    } catch (e) {}
  }

  function initPinReset() {
    try {
      if (!gBrowser || !gBrowser.tabContainer) {
        return;
      }
      gBrowser.tabContainer.addEventListener("TabPinned", onPinChanged);
      gBrowser.tabContainer.addEventListener("TabUnpinned", onPinChanged);
    } catch (e) {}
    try {
      const menu = document.getElementById("tabContextMenu");
      if (menu && typeof menu.addEventListener === "function") {
        menu.addEventListener("popupshowing", onPinMenuShowing);
      }
    } catch (e) {}
    try {
      window.addEventListener("unload", cleanupPinReset, { once: true });
    } catch (e) {}
    try {
      window.AphPinReset = {
        getPinURL,
        setPinURL,
        clearPinURL,
        resetPinTab,
        capturePinDefault: onPinChanged,
        PIN_URL_KEY,
        debug: () => {
          try {
            return { lastError: pinLastError || null };
          } catch (err) {
            return { lastError: "debug-threw" };
          }
        },
      };
    } catch (e) {}
  }

  if (document.readyState === "complete") {
    initPinReset();
  } else {
    window.addEventListener("load", initPinReset, { once: true });
  }
