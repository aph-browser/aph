  // Workspace ↔ container bindings: each workspace may be bound to one
  // Firefox container (userContextId). New tabs in a bound workspace land
  // in that container. Persisted as JSON in a plain pref (survives
  // restarts); bindings whose container vanished are pruned lazily on
  // read. Disposable temp containers can never be bound.
  const WS_CONTAINER_PREF = "aph.workspaces.containerBindings";
  let wsBindings = null; // lazy-loaded {wsId: userContextId}

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

  // Stock Firefox ships four default containers WITHOUT a `name` — only
  // an `l10nId` (user-context-personal/work/banking/shopping). Reading
  // `ident.name` alone renders them as "Container 1..4". The service's own
  // `getUserContextLabel(id)` resolves name-first, l10n-second, so prefer
  // it; the static map covers contexts where it is unavailable (tests,
  // older layouts). User-created containers always carry `name`.
  const CONTAINER_L10N_FALLBACK = {
    "user-context-personal": "Personal",
    "user-context-work": "Work",
    "user-context-banking": "Banking",
    "user-context-shopping": "Shopping",
  };

  function containerLabel(nid, ident) {
    try {
      if (ident && ident.name) {
        return ident.name;
      }
    } catch (e) {}
    try {
      if (
        IdentityService &&
        typeof IdentityService.getUserContextLabel === "function"
      ) {
        const label = IdentityService.getUserContextLabel(nid);
        if (label) {
          return label;
        }
      }
    } catch (e) {}
    try {
      const l10n = ident && (ident.l10nId || ident.l10nID);
      if (l10n && CONTAINER_L10N_FALLBACK[l10n]) {
        return CONTAINER_L10N_FALLBACK[l10n];
      }
    } catch (e) {}
    return "";
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
      return {
        name: containerLabel(nid, ident),
        color: ident.color || "",
        icon: ident.icon || "",
      };
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
      ok = !isTempContainerId(id) && !!IdentityService.getPublicIdentityFromId(id);
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

  // Per-tab container-line dimming: when a tab's container equals its
  // workspace's bound container, the native `.tab-context-line` is redundant
  // (the WS badge in updateIndicator already shows the binding). Matching
  // tabs get `data-aph-bound-match="1"`; theme.css hides the line for those.
  // Mismatches, unbound workspaces, and default (cid 0) tabs never match,
  // so their lines stay visible. Temp containers can never be bound, so they
  // always show.
  // Pins are global (visible in every workspace) with only a dormant tag:
  // they match against the viewed (current) workspace, not that tag — a
  // pinned Work-container tab hides its line exactly in Work-bound
  // workspaces. Unpinned tabs match against their own tag.
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
        let pinned = false;
        try {
          pinned = !!tab.pinned;
        } catch (e) {}
        ws = pinned && isValidId(current) ? current : getWs(tab);
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
      if (!tab.userContextId) {
        if (typeof tab.hasAttribute === "function" && tab.hasAttribute("data-aph-bound-match")) {
          try {
            tab.removeAttribute("data-aph-bound-match");
          } catch (e) {}
        }
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
      if (isTempContainerId(id)) {
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

  // Bind any workspace (not just current) to a container id. 0 clears.
  // Same guards as bindCurrentWsToSelectedTab: unknown ids and disposable
  // temp containers refuse. Used by the dock's Bind submenu.
  function setWsBinding(ws, id) {
    if (!isValidId(ws)) {
      return { ok: false, reason: "bad-workspace" };
    }
    const nid = Number(id) || 0;
    if (!nid) {
      clearWsBinding(ws);
      return { ok: true, cleared: true };
    }
    try {
      if (isTempContainerId(nid)) {
        return { ok: false, reason: "temp" };
      }
    } catch (e) {}
    const ident = describeContainer(nid);
    if (!ident) {
      return { ok: false, reason: "unknown" };
    }
    loadBindings()[ws] = nid;
    saveBindings();
    updateIndicator();
    syncAllTabBindingMatches();
    return { ok: true, userContextId: nid, name: ident.name };
  }

  // All bindable containers for the dock's Bind submenu. Temp containers
  // excluded (deleted on last close — can never be bound).
  function listContainers() {
    const out = [];
    try {
      const svc = IdentityService;
      if (svc && typeof svc.getPublicIdentities === "function") {
        for (const ident of Array.from(svc.getPublicIdentities() || [])) {
          const nid = Number(ident && ident.userContextId) || 0;
          if (!nid) {
            continue;
          }
          try {
            if (isTempContainerId(nid)) {
              continue;
            }
          } catch (e) {}
          out.push({
            userContextId: nid,
            name: containerLabel(nid, ident),
            color: (ident && ident.color) || "",
            icon: (ident && ident.icon) || "",
          });
        }
      }
    } catch (e) {}
    return out;
  }

  // Calculate top of ephemeral working stack in workspace ws (immediately after pinned tabs).
  // Manual new tabs (Ctrl+T, + button) spawn here, acting as an Inbox (LIFO stack).
  function getTopWorkingIndex(wsArg) {
    try {
      if (!gBrowser || !gBrowser.tabs) {
        return 0;
      }
      const allTabs = Array.from(gBrowser.tabs);
      const ws = isValidId(wsArg) ? wsArg : isValidId(current) ? current : "1";
      const numPinned =
        typeof gBrowser._numPinnedTabs === "number"
          ? gBrowser._numPinnedTabs
          : allTabs.filter((t) => t && t.pinned).length;

      const wsTabs = allTabs.filter(
        (t) =>
          t &&
          !t.closing &&
          !t.pinned &&
          (typeof getWs === "function" ? getWs(t) : "1") === ws
      );

      // Target below any Starred group in this workspace so new tabs don't push Starred down
      const starredTabs = wsTabs.filter((t) => {
        try {
          if (typeof isTabStarred === "function") {
            return isTabStarred(t);
          }
          const g = t && t.group;
          const lbl =
            g?.label ||
            g?.name ||
            (typeof g?.getAttribute === "function" ? g.getAttribute("label") : "");
          return lbl === "Starred";
        } catch (e) {
          return false;
        }
      });
      if (starredTabs.length > 0) {
        const lastStar = starredTabs[starredTabs.length - 1];
        const lastIdx = allTabs.indexOf(lastStar);
        if (lastIdx !== -1) {
          return lastIdx + 1;
        }
      }

      // Target at the top of this workspace's tabs
      if (wsTabs.length > 0) {
        const firstWsTab = wsTabs[0];
        const firstIdx = allTabs.indexOf(firstWsTab);
        if (firstIdx !== -1) {
          return Math.max(numPinned, firstIdx);
        }
      }

      // Case 3: Workspace is currently empty. Insert before any subsequent workspace
      const wsNum = parseInt(ws, 10);
      if (!Number.isNaN(wsNum)) {
        const nextWsTab = allTabs.find((t) => {
          if (!t || t.pinned || t.closing) return false;
          const tWs = typeof getWs === "function" ? parseInt(getWs(t), 10) : 1;
          return !Number.isNaN(tWs) && tWs > wsNum;
        });
        if (nextWsTab) {
          const nextIdx = allTabs.indexOf(nextWsTab);
          if (nextIdx !== -1) {
            return Math.max(numPinned, nextIdx);
          }
        }
      }

      return Math.max(numPinned, allTabs.length);
    } catch (e) {
      return 0;
    }
  }

  // New tab in `ws` using its bound container (plain tab when unbound).
  // Manual birth (Ctrl+T, + button): inserted at the top of the workspace.
  function openBoundTab(url = "about:newtab", wsArg) {
    const ws = isValidId(wsArg) ? wsArg : isValidId(current) ? current : "1";
    const bound = getWsContainerId(ws);
    const targetIndex = getTopWorkingIndex(ws);
    try {
      const opts = { index: targetIndex };
      if (bound) {
        opts.userContextId = bound;
      }
      let t = null;
      try {
        t = gBrowser.addTrustedTab(url, opts);
      } catch (e) {
        try {
          t = gBrowser.addTab(url, opts);
        } catch (err) {
          t = gBrowser.addTrustedTab(url);
        }
      }
      if (!t) {
        return null;
      }
      try {
        gBrowser.ungroupTab(t);
      } catch (e) {}
      setWs(t, ws);
      aphShowTab(t);
      if (typeof gBrowser.moveTabTo === "function") {
        try {
          const curIdx = Array.from(gBrowser.tabs || []).indexOf(t);
          if (curIdx !== -1 && curIdx !== targetIndex) {
            gBrowser.moveTabTo(t, { tabIndex: targetIndex, forceUngrouped: true });
          }
        } catch (e) {
          try { gBrowser.moveTabTo(t, targetIndex); } catch (err) {}
        }
      }
      gBrowser.selectedTab = t;
      focusUrlBar();
      return t;
    } catch (e) {
      return null;
    }
  }

  // Open `url` tagged into `ws` with an explicit container (0 = default).
  // Unlike openBoundTab (which uses the workspace's bound container), the
  // container is chosen by the caller. Returns the tab, unselected.
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
        if (typeof gURLBar.select === "function") {
          gURLBar.select();
        }
      }
    } catch (e) {}
  }


