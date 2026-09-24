  // Owned-tab base URL machinery, shared by 75-pinreset.js (pinned tabs)
  // and 76-starred.js (starred tabs). Both features are the same machine
  // with different nouns: a per-tab stored URL (SessionStore custom value,
  // survives restore free), validated editing, container-aware loading,
  // and a right-click menu. Kind-specific state (pin capture, star flag +
  // close-button swap) and menu shapes stay in their own files; everything
  // byte-identical lives here. Same-bundle scope: 55-exclusive.js owns
  // tabSpec (used for the live-URL fallback), 65-dock.js owns the XUL
  // menu factory.
  //
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

  // Returns true when stored. Invalid URLs are rejected (previous value
  // kept) so a typo in the edit dialog can never brick the reset target.
  // noteErr receives failure codes for Browser-Console diagnosis.
  function setStoredURL(tab, key, url, noteErr) {
    try {
      if (!tab || !isValidBaseURL(url)) {
        return false;
      }
      SessionStore.setCustomTabValue(tab, key, String(url));
      return true;
    } catch (e) {
      try {
        if (typeof noteErr === "function") {
          noteErr("set-threw");
        }
      } catch (err) {}
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

  function loadBaseURL(browser, url, noteErr) {
    const principal = systemPrincipal();
    let noted = false;
    const note = (code) => {
      noted = true;
      try {
        if (typeof noteErr === "function") {
          noteErr(code);
        }
      } catch (err) {}
    };
    try {
      if (browser && typeof browser.fixupAndLoadURIString === "function") {
        browser.fixupAndLoadURIString(url, { triggeringPrincipal: principal });
        return true;
      }
    } catch (e) {
      note("fixup-threw");
    }
    // Fallback for browsers without the fixup helper wired up.
    try {
      if (browser && typeof browser.loadURI === "function" && Services && Services.io) {
        browser.loadURI(Services.io.newURI(url), { triggeringPrincipal: principal });
        return true;
      }
    } catch (e) {
      note("loadURI-threw");
    }
    if (!noted) {
      note("no-loader");
    }
    return false;
  }

  // Resolve the right-clicked tab, mirroring stock tab-context-menu.js and
  // the archive.js pattern: triggerNode may carry the tab directly (.tab)
  // or contain it; fall back to the selected tab.
  function contextClickedTab(e) {
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

  // Detach every tracked menu item; returns [] for `items = takeDown...`.
  function takeDownMenuItems(items) {
    try {
      for (const it of items || []) {
        try {
          if (it && it.parentNode) {
            it.parentNode.removeChild(it);
          } else if (it && typeof it.remove === "function") {
            it.remove();
          }
        } catch (err) {}
      }
    } catch (err) {}
    return [];
  }

  function promptBaseURL(tab, initial, dialogTitle, promptTitle, setURL) {
    const commit = (v) => {
      try {
        const value = String(v == null ? "" : v).trim();
        if (value && typeof setURL === "function") {
          setURL(tab, value);
        }
      } catch (err) {}
    };
    try {
      if (window.AphPalette && typeof window.AphPalette.prompt === "function") {
        window.AphPalette.prompt({
          title: dialogTitle,
          initial: initial || "",
          onCommit: commit,
        });
        return;
      }
    } catch (err) {}
    // Palette unavailable (tests, minimal chrome): stock prompt fallback.
    try {
      if (typeof window.prompt === "function") {
        commit(window.prompt(promptTitle, initial || ""));
      }
    } catch (err) {}
  }
