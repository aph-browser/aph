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

  // Reject javascript: URLs; hostful http(s) and about: pages are fine.
  function isValidBaseURL(url) {
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

  function getStoredURL(tab, key) {
    try {
      if (!tab) {
        return "";
      }
      let v = null;
      try {
        v = SessionStore.getCustomTabValue(tab, key);
      } catch (e) {
        v = null;
      }
      return typeof v === "string" && v ? v : "";
    } catch (e) {
      return "";
    }
  }

  function setStoredURL(tab, key, url) {
    try {
      if (!tab || !isValidBaseURL(url)) {
        return false;
      }
      SessionStore.setCustomTabValue(tab, key, String(url));
      return true;
    } catch (e) {
      return false;
    }
  }

  function systemPrincipal() {
    try {
      return Services.scriptSecurityManager.getSystemPrincipal();
    } catch (e) {
      return null;
    }
  }

  function loadBaseURL(browser, url) {
    const principal = systemPrincipal();
    try {
      if (browser && typeof browser.fixupAndLoadURIString === "function") {
        browser.fixupAndLoadURIString(url, { triggeringPrincipal: principal });
        return true;
      }
    } catch (e) {}
    try {
      if (browser && typeof browser.loadURI === "function" && Services && Services.io) {
        browser.loadURI(Services.io.newURI(url), { triggeringPrincipal: principal });
        return true;
      }
    } catch (e) {}
    return false;
  }

  function promptBaseURL(tab, initial, dialogTitle, promptTitle, setURL) {
    if (!window.AphPalette?.prompt || !tab) return;
    try {
      window.AphPalette.prompt({
        title: dialogTitle,
        initial: initial || "",
        onCommit: (v) => {
          const value = String(v == null ? "" : v).trim();
          if (value && typeof setURL === "function") {
            setURL(tab, value);
          }
        },
      });
    } catch (err) {}
  }

  function getPinURL(tab) {
    return getStoredURL(tab, PIN_URL_KEY);
  }

  // Returns true when stored. Invalid URLs are rejected (previous value
  // kept) so a typo in the edit dialog can never brick the reset target.
  function setPinURL(tab, url) {
    return setStoredURL(tab, PIN_URL_KEY, url);
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
      return getPinURL(tab) || tabSpec(tab);
    } catch (e) {
      return "";
    }
  }

  // Returns true when navigation was kicked off.
  function resetPinTab(tab) {
    try {
      if (!tab || !tab.pinned) {
        return false;
      }
      const url = effectivePinURL(tab);
      const browser = tab.linkedBrowser;
      if (!url || !browser) {
        return false;
      }
      return loadBaseURL(browser, url);
    } catch (e) {
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
          const spec = tabSpec(tab);
          if (spec) {
            SessionStore.setCustomTabValue(tab, PIN_URL_KEY, spec);
          }
        }
      } else {
        clearPinURL(tab);
      }
    } catch (err) {}
  }

  let pinMenuItems = [];

  function clearPinMenu() {
    pinMenuItems = typeof clearMenuItems === "function" ? clearMenuItems(pinMenuItems) : [];
  }

  function promptPinURL(tab, initial) {
    promptBaseURL(
      tab,
      initial,
      "Set Pinned Page — Enter saves, Esc cancels",
      "Set Pinned Page URL:",
      setPinURL
    );
  }

  function onPinMenuShowing(e) {
    try {
      const menu = (e && (e.currentTarget || e.target)) || null;
      if (!menu || typeof menu.appendChild !== "function") {
        return;
      }
      clearPinMenu();
      const tab = contextClickedTab(e);
      if (!tab || !tab.pinned) {
        return;
      }
      const stored = effectivePinURL(tab);
      const reset = makeDockMenuItem("aph-pinreset-reset", "Reset to Pinned Page", () => {
        try {
          resetPinTab(tab);
        } catch (err) {}
      });
      if (reset) {
        // Grey out when already there — nothing to do.
        try {
          if (stored && stored === tabSpec(tab)) {
            reset.setAttribute("disabled", "true");
          }
        } catch (err) {}
        try {
          menu.appendChild(reset);
          pinMenuItems.push(reset);
        } catch (err) {}
      }
      const edit = makeDockMenuItem("aph-pinreset-set", "Set Pinned Page…", () => {
        try {
          // Live-first: Enter alone re-pins the current page (the common
          // "make this the base" case); stored is the fallback.
          promptPinURL(tab, tabSpec(tab) || stored);
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
        promptPinURL,
        capturePinDefault: onPinChanged,
        PIN_URL_KEY,
      };
    } catch (e) {}
  }

  if (document.readyState === "complete") {
    initPinReset();
  } else {
    window.addEventListener("load", initPinReset, { once: true });
  }
