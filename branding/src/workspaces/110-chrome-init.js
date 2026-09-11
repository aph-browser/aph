  // Keep the auto-hide top bar pinned while a nav-bar popup (uBO,
  // extensions, hamburger, all-tabs) is open. Pure `:hover` loses when the
  // mouse moves from the button into the panel, the anchor slides away, and
  // the popup closes. CSS `:has([open])` covers it when supported; this JS
  // sets [data-aph-popup-open] as the bulletproof fallback.
  function initNavPopupHold() {
    let toolbox = null;
    let navBar = null;
    try {
      toolbox = document.getElementById("navigator-toolbox");
      navBar = document.getElementById("nav-bar");
    } catch (e) {}
    if (!toolbox || !navBar) {
      return;
    }
    const openPopups = new Set();

    function syncHold() {
      let hasOpen = false;
      try {
        hasOpen = !!navBar.querySelector(
          ":is(toolbarbutton, toolbaritem)[open='true'], :is(toolbarbutton, toolbaritem)[open]"
        );
      } catch (e) {}
      const held = hasOpen || openPopups.size > 0;
      for (const el of [toolbox, navBar]) {
        try {
          if (held) {
            el.setAttribute("data-aph-popup-open", "1");
          } else {
            el.removeAttribute("data-aph-popup-open");
          }
        } catch (e) {}
      }
    }

    function popupAnchorInNavBar(popup) {
      try {
        const anchor = popup.triggerNode || popup.anchorNode;
        if (anchor && anchor.nodeType === 1) {
          if (typeof anchor.closest === "function" && anchor.closest("#nav-bar")) {
            return true;
          }
          try {
            if (navBar.contains(anchor)) {
              return true;
            }
          } catch (e) {}
        }
      } catch (e) {}
      // Extension popups don't always expose triggerNode — if a nav-bar
      // button is currently [open], assume the popup belongs to it.
      try {
        if (navBar.querySelector(":is(toolbarbutton, toolbaritem)[open]")) {
          return true;
        }
      } catch (e) {}
      return false;
    }

    try {
      const obs = new MutationObserver(syncHold);
      obs.observe(navBar, {
        subtree: true,
        attributes: true,
        attributeFilter: ["open", "aria-expanded"],
      });
      navPopupObserver = obs;
    } catch (e) {
      navPopupObserver = null;
    }

    window.addEventListener(
      "popupshowing",
      (e) => {
        try {
          const p = e.target;
          if (!p || (p.localName !== "menupopup" && p.localName !== "panel")) {
            return;
          }
          if (popupAnchorInNavBar(p)) {
            openPopups.add(p);
            syncHold();
          }
        } catch (err) {}
      },
      true
    );
    const onHide = (e) => {
      try {
        const p = e.target;
        if (openPopups.has(p)) {
          openPopups.delete(p);
        }
      } catch (err) {}
      // popuphidden fires before [open] clears — defer one tick.
      setTimeout(syncHold, 0);
    };
    window.addEventListener("popuphidden", onHide, true);
    window.addEventListener("popuphiding", onHide, true);
    syncHold();
    return navPopupObserver;
  }

  // Releases every process-global registration owned by this window.
  // Services hold their observers strongly: without this, each closed
  // window stays reachable (observer -> closure -> document/gBrowser) and
  // leaks until process exit.
  function cleanupWindowObservers() {
    try {
      if (bindingObserver) {
        Services.prefs.removeObserver(WS_CONTAINER_PREF, bindingObserver);
      }
    } catch (e) {}
    try {
      if (routeObserver) {
        Services.prefs.removeObserver(WS_ROUTES_PREF, routeObserver);
      }
    } catch (e) {}
    try {
      if (nameObserver) {
        Services.prefs.removeObserver(WS_NAMES_PREF, nameObserver);
      }
    } catch (e) {}
    bindingObserver = null;
    routeObserver = null;
    nameObserver = null;
    try {
      if (startupRestoreObserver && Services.obs) {
        Services.obs.removeObserver(
          startupRestoreObserver,
          "sessionstore-windows-restored"
        );
      }
    } catch (e) {}
    startupRestoreObserver = null;
    try {
      if (navPopupObserver && typeof navPopupObserver.disconnect === "function") {
        navPopupObserver.disconnect();
      }
    } catch (e) {}
    navPopupObserver = null;
    try {
      if (wsPulseTimer) {
        clearTimeout(wsPulseTimer);
        wsPulseTimer = null;
      }
    } catch (e) {}
    try {
      if (
        typeof gBrowser !== "undefined" &&
        gBrowser &&
        typeof gBrowser.removeTabsProgressListener === "function"
      ) {
        gBrowser.removeTabsProgressListener(routeListener);
      }
    } catch (e) {}
    try {
      if (window.__aphRouteListener === routeListener) {
        window.__aphRouteListener = null;
      }
    } catch (e) {}
  }

  // One-time rescue for toolbar buttons wiped on fresh profiles.
  // Fresh profiles that pre-seed sidebar.verticalTabs (Aph does) hit a
  // CustomizableUI restore path that builds the navbar from
  // verticalTabsDefaultPlacements (["alltabs-button", "ai-window-toggle"])
  // INSTEAD of the full defaultPlacements — so the removable defaults are
  // never placed and end up banished to the customization palette. The
  // downloads-button case is the loud one (no node in the document means
  // Firefox's own DownloadsButton.getAnchor() fails — "Downloads button
  // cannot be found", downloads.js — so no progress ring or auto-open
  // panel ever appears); stop-reload-button goes missing the same way.
  // Modeled on Mozilla's own ShowHomeButton enterprise policy
  // (Policies.sys.mjs): if unplaced, re-add at the stock position. Runs
  // once per profile (DL_RESCUE_PREF marker) so it never fights an
  // intentional user removal afterwards. The marker was renamed when the
  // rescue widened beyond downloads-button so already-healed profiles get
  // one more pass (the old aph.toolbar.downloadsRescued lingers harmlessly).
  const DL_RESCUE_PREF = "aph.toolbar.widgetsRescued";

  // Re-place one widget at its stock position (anchor + offset, mirroring
  // ShowHomeButton, which inserts home-button after forward-button + 2).
  // Returns true when the widget is placed (or already was).
  function rescueToolbarWidget(cui, id, anchorId, offset) {
    let placement = null;
    try {
      placement = cui.getPlacementOfWidget(id);
    } catch (e) {
      return false;
    }
    if (placement) {
      return true;
    }
    let pos = null;
    try {
      const anchor = cui.getPlacementOfWidget(anchorId);
      if (
        anchor &&
        anchor.area === cui.AREA_NAVBAR &&
        typeof anchor.position === "number"
      ) {
        pos = anchor.position + offset;
      }
    } catch (e) {}
    try {
      cui.addWidgetToArea(id, cui.AREA_NAVBAR, pos);
    } catch (e) {
      return false;
    }
    return true;
  }

  function rescueToolbarButtons() {
    let rescued = false;
    try {
      if (!Services.prefs || typeof Services.prefs.getBoolPref !== "function") {
        return;
      }
      rescued = !!Services.prefs.getBoolPref(DL_RESCUE_PREF);
    } catch (e) {
      rescued = false; // unset pref reads as "not rescued yet"
    }
    if (rescued) {
      return;
    }
    let cui = null;
    try {
      cui = window.CustomizableUI || null;
    } catch (e) {
      cui = null;
    }
    if (!cui) {
      // moz-src path first: canonical in packaged builds (see 00-core-open.js).
      try {
        ({ CustomizableUI: cui } = ChromeUtils.importESModule(
          "moz-src:///browser/components/customizableui/CustomizableUI.sys.mjs"
        ));
      } catch (e) {
        return;
      }
      if (!cui) {
        return;
      }
    }
    let ok = true;
    try {
      ok = rescueToolbarWidget(cui, "downloads-button", "urlbar-container", 2) && ok;
    } catch (e) {
      ok = false;
    }
    try {
      ok = rescueToolbarWidget(cui, "stop-reload-button", "forward-button", 1) && ok;
    } catch (e) {
      ok = false;
    }
    if (!ok) {
      return; // retry next launch; partial progress stands
    }
    try {
      if (typeof Services.prefs.setBoolPref === "function") {
        Services.prefs.setBoolPref(DL_RESCUE_PREF, true);
      }
    } catch (e) {}
  }

  function init() {
    // Heal toolbar state first: re-place wiped removable defaults
    // (one-time, marker-guarded — see below).
    try {
      rescueToolbarButtons();
    } catch (e) {}
    // Public API for command palette (and future chrome UI).
    try {
      window.AphWorkspaces = {
        switchTo,
        sendTabTo,
        cycleWorkspace,
        toggleLastWorkspace,
        getActiveWorkspaces: getActiveIds,
        getLastWorkspace: () => lastUsed,
        openTempTab,
        openBoundTab,
        openInWorkspace,
        bindCurrentWs: bindCurrentWsToSelectedTab,
        clearWsBinding,
        getWsContainer: getWsContainerId,
        describeContainer,
        getAllBindings,
        getRoutes: getAllRoutes,
        setRoute,
        deleteRoute,
        matchRoute,
        getWsName,
        setWsName,
        getCurrent: () => current,
        getWs,
        isTabMatchingBinding,
        syncTabBindingMatch,
        syncAllTabBindingMatches,
        canUnloadTab,
        unloadEligibleTabs,
        getUnloadOnSwitch,
      };
    } catch (e) {}
    current = initialWorkspace();
    if (isValidId(current)) {
      try {
        gBrowser.tabContainer.setAttribute("data-aph-ws", current);
      } catch (e) {}
    }
    updateIndicator();
    try {
      for (const t of gBrowser.tabs) {
        if (!rawWs(t)) {
          setWs(t, isValidId(current) ? current : "1");
        }
        // Pre-existing tabs resume live pages — settled, never auto-route.
        try {
          t.__aphFresh = false;
        } catch (e) {}
        // Heal legacy per-workspace pins: pins are global, never hidden.
        try {
          if (t.pinned && t.hidden) {
            aphShowTab(t);
          }
        } catch (e) {}
      }
      // Restored tabs keep their tags (no setWs above) — sync matches anyway.
      syncAllTabBindingMatches();
    } catch (e) {}
    // Session restore may not preserve hidden state; force a full pass.
    try {
      const saved = isValidId(current) ? current : "1";
      current = saved === "1" ? "__force__" : "1";
      switchTo(saved);
    } catch (e) {}
    gBrowser.tabContainer.addEventListener("TabOpen", onTabOpen);
    gBrowser.tabContainer.addEventListener("TabClose", onTabClose);
    gBrowser.tabContainer.addEventListener("SSTabRestored", onTabRestored);
    gBrowser.tabContainer.addEventListener("TabPinned", onTabPinned);
    gBrowser.tabContainer.addEventListener("TabUnpinned", onTabPinned);
    gBrowser.tabContainer.addEventListener("TabGroupCreate", onGroupChange);
    gBrowser.tabContainer.addEventListener("TabGroupUpdate", onGroupChange);
    window.addEventListener("keydown", onKey, true);
    try {
      navPopupObserver = initNavPopupHold() || null;
    } catch (e) {
      navPopupObserver = null;
    }
    // Cross-window binding sync: re-read the pref + repaint the badge.
    try {
      bindingObserver = {
        observe() {
          try {
            wsBindings = null;
            updateIndicator();
            syncAllTabBindingMatches();
          } catch (e) {}
        },
      };
      Services.prefs.addObserver(WS_CONTAINER_PREF, bindingObserver);
    } catch (e) {
      bindingObserver = null;
    }
    // Cross-window route sync: drop the cached rules so the next match
    // re-reads the pref.
    try {
      routeObserver = {
        observe() {
          try {
            wsRoutes = null;
          } catch (e) {}
        },
      };
      Services.prefs.addObserver(WS_ROUTES_PREF, routeObserver);
    } catch (e) {
      routeObserver = null;
    }
    // Cross-window name sync: drop the cache and repaint the badge.
    try {
      nameObserver = {
        observe() {
          try {
            wsNames = null;
            updateIndicator();
          } catch (e) {}
        },
      };
      Services.prefs.addObserver(WS_NAMES_PREF, nameObserver);
    } catch (e) {
      nameObserver = null;
    }
    try {
      initRouteListener();
    } catch (e) {}
    scheduleStartupRestore();
    // Global-service registrations above outlive this window unless removed.
    try {
      window.addEventListener("unload", cleanupWindowObservers, { once: true });
    } catch (e) {}
  }

  if (document.readyState === "complete") {
    init();
  } else {
    window.addEventListener("load", init, { once: true });
  }
})();
