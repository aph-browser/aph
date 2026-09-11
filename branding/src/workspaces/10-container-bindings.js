  // Workspace ↔ container bindings: each workspace may be bound to one
  // Firefox container (userContextId). New tabs in a bound workspace land
  // in that container. Persisted as JSON in a plain pref (survives
  // restarts); bindings whose container vanished are pruned lazily on
  // read. Disposable temp containers can never be bound.
  const WS_CONTAINER_PREF = "aph.workspaces.containerBindings";
  let wsBindings = null; // lazy-loaded {wsId: userContextId}
  const CONTAINER_HEX = {
    blue: "#37adff", turquoise: "#00c79a", green: "#51cf66",
    yellow: "#e8d44d", orange: "#ff8a36", red: "#ff375f",
    pink: "#ff7ab2", purple: "#af51f5",
  };

  function loadBindings() {
    if (wsBindings) {
      return wsBindings;
    }
    wsBindings = Object.create(null);
    try {
      let raw = "";
      try {
        raw = Services.prefs.getStringPref(WS_CONTAINER_PREF, "");
      } catch (e) {}
      if (raw) {
        const obj = JSON.parse(raw);
        for (const k of Object.keys(obj || {})) {
          const id = Number(obj[k]);
          if (isValidId(k) && Number.isInteger(id) && id > 0) {
            wsBindings[k] = id;
          }
        }
      }
    } catch (e) {}
    return wsBindings;
  }

  function saveBindings() {
    try {
      const plain = {};
      const map = loadBindings();
      for (const k of Object.keys(map)) {
        plain[k] = map[k];
      }
      Services.prefs.setStringPref(WS_CONTAINER_PREF, JSON.stringify(plain));
    } catch (e) {}
  }

  function describeContainer(id) {
    try {
      const nid = Number(id) || 0;
      if (!nid || !IdentityService) {
        return null;
      }
      const ident = IdentityService.getPublicIdentityFromId(nid);
      if (!ident) {
        return null;
      }
      return { name: ident.name || "", color: ident.color || "", icon: ident.icon || "" };
    } catch (e) {
      return null;
    }
  }

  // Validated binding for `ws` (0 = none). Prunes stale entries.
  function getWsContainerId(ws) {
    if (!isValidId(ws) || !IdentityService) {
      return 0;
    }
    const map = loadBindings();
    const id = Number(map[ws]) || 0;
    if (!id) {
      return 0;
    }
    let ok = false;
    try {
      ok = !tempContainers.has(id) && !!IdentityService.getPublicIdentityFromId(id);
    } catch (e) {
      ok = false;
    }
    if (!ok) {
      try {
        delete map[ws];
        saveBindings();
      } catch (e) {}
      return 0;
    }
    return id;
  }

  function getAllBindings() {
    const out = Object.create(null);
    for (let i = 1; i <= 9; i++) {
      const ws = String(i);
      const id = getWsContainerId(ws);
      if (id) {
        out[ws] = { userContextId: id, ...(describeContainer(id) || {}) };
      }
    }
    return out;
  }

  // Per-tab container-line dimming: when a tab's container equals its own
  // workspace's bound container, the native `.tab-context-line` is redundant
  // (the WS badge in updateIndicator already shows the binding). Matching
  // tabs get `data-aph-bound-match="1"`; theme.css hides the line for those.
  // Mismatches, unbound workspaces, and default (cid 0) tabs never match,
  // so their lines stay visible. Temp containers can never be bound, so they
  // always show.
  function isTabMatchingBinding(tab) {
    try {
      if (!tab || tab.closing) {
        return false;
      }
      let cid = 0;
      try {
        cid = tab.userContextId || 0;
      } catch (e) {
        return false;
      }
      if (!cid) {
        return false;
      }
      let ws = null;
      try {
        ws = getWs(tab);
      } catch (e) {
        return false;
      }
      if (!isValidId(ws)) {
        return false;
      }
      let bound = 0;
      try {
        bound = getWsContainerId(ws);
      } catch (e) {
        return false;
      }
      return !!bound && bound === cid;
    } catch (e) {
      return false;
    }
  }

  function syncTabBindingMatch(tab) {
    try {
      if (!tab) {
        return;
      }
      if (typeof tab.setAttribute !== "function" || typeof tab.removeAttribute !== "function") {
        return;
      }
      if (isTabMatchingBinding(tab)) {
        try {
          tab.setAttribute("data-aph-bound-match", "1");
        } catch (e) {}
      } else {
        try {
          tab.removeAttribute("data-aph-bound-match");
        } catch (e) {}
      }
    } catch (e) {}
  }

  function syncAllTabBindingMatches() {
    try {
      const tabs = gBrowser ? gBrowser.tabs : null;
      if (!tabs) {
        return;
      }
      for (const t of Array.from(tabs)) {
        syncTabBindingMatch(t);
      }
    } catch (e) {}
  }

  // Bind the current workspace to the selected tab's container.
  // On a default (containerless) tab this clears the binding instead.
  // Refuses disposable temp containers (they are deleted on last close).
  function bindCurrentWsToSelectedTab() {
    if (!isValidId(current)) {
      return { ok: false, reason: "no-workspace" };
    }
    let tab = null;
    try {
      tab = gBrowser.selectedTab;
    } catch (e) {}
    if (!tab) {
      return { ok: false, reason: "no-tab" };
    }
    let id = 0;
    try {
      id = tab.userContextId || 0;
    } catch (e) {}
    if (!id) {
      clearWsBinding(current);
      return { ok: true, cleared: true };
    }
    try {
      if (tempContainers.has(id)) {
        return { ok: false, reason: "temp" };
      }
    } catch (e) {}
    const ident = describeContainer(id);
    if (!ident) {
      return { ok: false, reason: "unknown" };
    }
    loadBindings()[current] = id;
    saveBindings();
    updateIndicator();
    syncAllTabBindingMatches();
    pulseWorkspaceIndicator();
    return { ok: true, userContextId: id, name: ident.name };
  }

  function clearWsBinding(ws) {
    const target = isValidId(ws) ? ws : isValidId(current) ? current : null;
    if (!target) {
      return;
    }
    try {
      delete loadBindings()[target];
      saveBindings();
    } catch (e) {}
    updateIndicator();
    syncAllTabBindingMatches();
  }

  // New tab in `ws` using its bound container (plain tab when unbound).
  function openBoundTab(url = "about:newtab", wsArg) {
    const ws = isValidId(wsArg) ? wsArg : isValidId(current) ? current : "1";
    const bound = getWsContainerId(ws);
    try {
      const t = bound
        ? gBrowser.addTrustedTab(url, { userContextId: bound })
        : gBrowser.addTrustedTab(url);
      // insertAfterCurrent births tabs inside the selected tab's group — eject.
      try {
        gBrowser.ungroupTab(t);
      } catch (e) {}
      setWs(t, ws);
      aphShowTab(t);
      gBrowser.selectedTab = t;
      focusUrlBar();
      return t;
    } catch (e) {
      return null;
    }
  }

  // Open `url` tagged into `ws` with an explicit container (0 = default).
  // Unlike openBoundTab (which uses the workspace's bound container), the
  // container is chosen by the caller — used by the tab archive to restore
  // full context (workspace + container). Returns the tab, unselected.
  function openInWorkspace(url, wsArg, userContextId) {
    const target = isValidId(wsArg) ? wsArg : isValidId(current) ? current : "1";
    try {
      const t = userContextId
        ? gBrowser.addTrustedTab(url, { userContextId })
        : gBrowser.addTrustedTab(url);
      // insertAfterCurrent births tabs inside the selected tab's group — eject.
      try {
        gBrowser.ungroupTab(t);
      } catch (e) {}
      setWs(t, target);
      return t;
    } catch (e) {
      return null;
    }
  }

  // Stock BrowserOpenTab focuses the urlbar after selecting the new tab.
  // Our programmatic opens (bound Ctrl+T, temp tab, container-repair swap)
  // select tabs without that step, so typing would go nowhere. Guarded:
  // no-ops in contexts without a urlbar (tests, popups).
  function focusUrlBar() {
    try {
      if (typeof gURLBar !== "undefined" && gURLBar && typeof gURLBar.focus === "function") {
        gURLBar.focus();
      }
    } catch (e) {}
  }

  // Fallback for empty-tab births that bypass the BrowserOpenTab wrapper
  // (window.open, extensions, restore paths): the container is immutable
  // after TabOpen, so repair selected, still-empty newtab pages one tick
  // later by swapping in a correctly-containered tab.
  // ONLY about:newtab/about:home — never about:blank — so window.open
  // popups and in-flight link loads (blank at TabOpen) are never touched.
  function armContainerRepair(tab) {
    try {
      if (!tab || rawWs(tab) || !isValidId(current)) {
        return false;
      }
      const bound = getWsContainerId(current);
      if (!bound) {
        return false;
      }
      if ((tab.userContextId || 0) !== 0) {
        return false;
      }
      // NOTE: selection is NOT checked here — at TabOpen time the opener
      // often hasn't selected the tab yet (+ button selects right after).
      // Selection is verified in the deferred callback instead.
      tab.__aphRepairArmed = bound;
      setTimeout(() => {
        let armed = 0;
        try {
          armed = tab.__aphRepairArmed || 0;
          delete tab.__aphRepairArmed;
        } catch (e) {}
        try {
          if (!armed || tab.closing || !gBrowser.tabs.includes(tab)) {
            return;
          }
          if (gBrowser.selectedTab !== tab) {
            // Background tab — leave it alone, tag normally.
            stampTab(tab);
            return;
          }
          if (rawWs(tab) || (tab.userContextId || 0) !== 0) {
            return;
          }
          const uri = tab.linkedBrowser?.currentURI?.spec;
          if (uri !== "about:newtab" && uri !== "about:home") {
            // Navigated away meanwhile (link load, popup) — tag normally.
            stampTab(tab);
            return;
          }
          if (!isValidId(current) || getWsContainerId(current) !== armed) {
            stampTab(tab);
            return;
          }
          const replacement = gBrowser.addTrustedTab("about:newtab", { userContextId: armed });
          try {
            gBrowser.ungroupTab(replacement);
          } catch (e) {}
          setWs(replacement, current);
          aphShowTab(replacement);
          try {
            gBrowser.selectedTab = replacement;
          } catch (e) {}
          // Stock focused the urlbar for the original tab; the swap moves
          // selection, so re-focus or typing lands in the page.
          focusUrlBar();
          try {
            gBrowser.removeTab(tab, { animate: false });
          } catch (e) {
            try {
              gBrowser.removeTab(tab);
            } catch (_e) {}
          }
        } catch (e) {}
      }, 0);
      return true;
    } catch (e) {
      return false;
    }
  }

