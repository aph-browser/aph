  // Workspace switching + window stamping (the top pill is gone —
  // the dock's current pill is the readout now, so this file owns no
  // DOM of its own). The `data-aph-ws` attribute on tabContainer
  // already existed; stampWindowWs mirrors it onto documentElement so
  // theme.css tints per workspace (:root[data-aph-ws="N"]).
  function updateIndicator() {
    // Name kept for the call sites (init, switches, pref observers):
    // repaint is dock-only now.
    try {
      renderDock();
    } catch (e) {}
  }

  let bindingObserver = null;
  let routeObserver = null;
  let nameObserver = null;
  let wsIconObserver = null;
  let wsAccentObserver = null;
  let startupRestoreObserver = null;
  let origBrowserOpenTab = null;
  let prevWorkspace = "";

  // Instant strip reveal: stock brings the newly selected tab into view
  // through the strip's own smooth scroll. Native TabSelect calls the tab
  // container's _handleTabSelect() with no instant flag, and the
  // arrowscrollbox's shadow scrollbox carries `scroll-behavior: smooth`
  // (the `smoothscroll` attribute it inherits from pref
  // toolkit.scrollbox.smoothScroll, default on), so the reveal animates.
  // Stock never notices: a click lands on a visible tab, and Ctrl+Tab
  // walks neighbours. A workspace switch moves the selection across the
  // whole strip in one synchronous commit, so on a crowded strip that
  // glide scrolls the entire list under the eye. Wherever Aph
  // moves the selection itself, it re-aims the reveal as instant.
  function revealSelectionInstant() {
    try {
      const tc = gBrowser && gBrowser.tabContainer;
      if (!tc) {
        return;
      }
      if (typeof tc._handleTabSelect === "function") {
        try {
          tc._handleTabSelect(true);
          return;
        } catch (e) {}
      }
      let box = null;
      try {
        box = tc.arrowScrollbox;
      } catch (e) {}
      let sel = null;
      try {
        sel = gBrowser.selectedTab;
      } catch (e) {}
      if (
        box &&
        sel &&
        box.overflowing &&
        typeof box.ensureElementIsVisible === "function"
      ) {
        box.ensureElementIsVisible(sel, true);
        return;
      }
      if (!box && sel && typeof sel.scrollIntoView === "function") {
        sel.scrollIntoView({ block: "nearest", behavior: "instant" });
      }
    } catch (e) {}
  }

  // Window-level workspace stamp: mirrors the tabContainer claim onto
  // documentElement so theme.css can tint per workspace
  function stampWindowWs(target) {
    try {
      document.documentElement?.setAttribute?.("data-aph-ws", target);
      const hue = typeof getWsAccent === "function" ? getWsAccent(target) : "";
      if (
        hue &&
        (typeof isHueId === "function"
          ? isHueId(hue)
          : (typeof isValidId === "function" && isValidId(hue)))
      ) {
        document.documentElement?.setAttribute?.("data-aph-accent", hue);
      } else {
        document.documentElement?.removeAttribute?.("data-aph-accent");
      }
    } catch (e) {}
  }

  // Window-scoped entry: every keyboard/dock/palette path funnels here.
  // Each window switches purely locally — other windows are never
  // consulted, pulled from, or focused.
  function switchTo(target) {
    if (!isValidId(target) || target === current) {
      return "noop";
    }
    prevWorkspace = current;

    try {
      if (typeof dissolveSplitsForSwitch === "function") {
        dissolveSplitsForSwitch();
      }
    } catch (e) {}

    let tabs = [];
    try {
      tabs = Array.from(gBrowser?.tabs || []);
    } catch (e) {}
    rememberCurrent(tabs);

    prevWorkspace = current;
    current = target;
    try {
      gBrowser?.tabContainer?.setAttribute?.("data-aph-ws", target);
      stampWindowWs(target);
      updateIndicator();
      if (typeof setWindowWs === "function") {
        setWindowWs(target);
      } else {
        SessionStore?.setCustomWindowValue?.(window, WIN_KEY, target);
      }
    } catch (e) {}

    anchorAllGroups();
    reconcile(target, tabs);
    revealSelectionInstant();

    try {
      for (const t of tabs) {
        if (t?.pinned && typeof syncTabChrome === "function") {
          syncTabChrome(t);
        }
      }
    } catch (e) {}

    try {
      scheduleUnloadSweep();
    } catch (e) {}

    return "switched";
  }

  function switchToLastWorkspace() {
    if (isValidId(prevWorkspace) && prevWorkspace !== current) {
      return switchTo(prevWorkspace);
    }
    return "noop";
  }

  // Explicit cross-window move ("Move Tab to Other Window"): adopt each tab
  // into `destWin` and retag arrivals to the destination's current
  // workspace (confirmed semantics — arrivals join what the other window
  // shows). Whole native groups stay joined when the move covers the whole
  // group; partial moves eject like local sends. Pinned tabs never move
  // (app anchors don't duplicate). Never crosses the private boundary.
  // With no explicit set, the live selection moves (palette path).
  // Returns the moved count.
  function moveTabsToWindow(destWin, moveSet) {
    try {
      if (!destWin || destWin.closed || !destWin.gBrowser) {
        return 0;
      }
      let set = moveSet;
      try {
        if ((!set || !set.length) && typeof resolveSendBase === "function") {
          set = resolveSendBase(null);
        }
      } catch (e) {}
      let selfPrivate = false;
      try {
        selfPrivate =
          typeof aphIsPrivateWindow === "function" && aphIsPrivateWindow(window);
      } catch (e) {}
      try {
        if (
          typeof aphIsPrivateWindow === "function" &&
          !!aphIsPrivateWindow(destWin) !== !!selfPrivate
        ) {
          return 0;
        }
      } catch (e) {}
      const moving = [];
      try {
        const live = new Set(Array.from(gBrowser.tabs || []));
        for (const t of set || []) {
          if (t && !t.closing && !t.pinned && live.has(t)) {
            moving.push(t);
          }
        }
      } catch (e) {}
      if (!moving.length) {
        return 0;
      }
      let destWs = null;
      try {
        const dw = destWin.AphWorkspaces;
        if (dw && typeof dw.getCurrent === "function") {
          const c = dw.getCurrent();
          if (isValidId(c)) {
            destWs = c;
          }
        }
      } catch (e) {}
      if (!destWs) {
        try {
          destWs = getWindowWs(destWin);
        } catch (e) {}
      }
      if (!isValidId(destWs)) {
        return 0;
      }
      // Whole-group preservation mirrors the local send rule.
      const movingSet = new Set(moving);
      let preserved = null;
      try {
        preserved = preservedSendGroups(moving);
      } catch (e) {
        preserved = new Set();
      }
      for (const tab of moving) {
        try {
          if (!tab.group) {
            continue;
          }
          let keep = false;
          try {
            keep = preserved && preserved.has(tab.group);
          } catch (e) {}
          if (!keep) {
            gBrowser.ungroupTab(tab);
          }
        } catch (e) {}
      }
      let moved = 0;
      for (const t of moving) {
        try {
          if (!t || t.closing || t.pinned) {
            continue;
          }
          let nt = null;
          try {
            if (typeof destWin.gBrowser.adoptTab === "function") {
              let idx = 0;
              try {
                idx = (destWin.gBrowser.tabs && destWin.gBrowser.tabs.length) || 0;
              } catch (e) {}
              try {
                nt = destWin.gBrowser.adoptTab(t, { tabIndex: idx }) || null;
              } catch (e) {
                try {
                  nt = destWin.gBrowser.adoptTab(t) || null;
                } catch (_e) {}
              }
            }
          } catch (e) {}
          if (!nt) {
            continue;
          }
          moved++;
          try {
            if (typeof scrubAdoptionGhost === "function") {
              scrubAdoptionGhost(window, t);
            }
          } catch (e) {}
          try {
            setWs(nt, destWs);
          } catch (e) {}
        } catch (e) {}
      }
      try {
        if (moved > 0 && typeof aphTabsLog === "function") {
          aphTabsLog(`move-to-window ws=${destWs} moved=${moved}`);
        }
      } catch (_e) {}
      try {
        const dw = destWin.AphWorkspaces;
        if (dw && typeof dw.renderDock === "function") {
          dw.renderDock();
        }
      } catch (e) {}
      try {
        reconcile(current, Array.from(gBrowser.tabs));
      } catch (e) {}
      try {
        if (typeof renderDock === "function") {
          renderDock();
        }
      } catch (e) {}
      return moved;
    } catch (e) {
      return 0;
    }
  }



  // Cycling: "active" = has a live tab in that workspace;
  // current always counts so an empty workspace never strands you.
  // Sorted so next/prev wrap deterministically.
  function getActiveIds() {
    const seen = new Set();
    try {
      for (const t of Array.from(gBrowser.tabs || [])) {
        try {
          if (t.closing || t.pinned) {
            continue;
          }
          // Restoring or not-yet-tagged tabs belong to no workspace yet
          // (getWs defaults tagless to "1"): counting them inflates WS1
          // mid-restore and misroutes cycle/plus/close targets.
          if (typeof isRestoringTab === "function" && isRestoringTab(t)) {
            continue;
          }
          let tagged = false;
          try {
            tagged = typeof rawWs === "function" && !!rawWs(t);
          } catch (e) {}
          if (!tagged) {
            continue;
          }
          const w = getWs(t);
          if (isValidId(w)) {
            seen.add(w);
          }
        } catch (e) {}
      }
    } catch (e) {}
    if (isValidId(current)) {
      seen.add(current);
    }
    return [...seen].sort();
  }

  function cycleWorkspace(dir) {
    const ids = getActiveIds();
    if (ids.length < 2) {
      return;
    }
    const i = ids.indexOf(isValidId(current) ? current : "1");
    switchTo(ids[(i + dir + ids.length) % ids.length]);
  }



  // Tab MRU walk for Ctrl+` (Ctrl+Shift+` reverses): each press selects
  // the next-most-recently-viewed tab, wrapping. Workspace-safe: landing
  // on a tab from another workspace switches there first (explicit, so
  // the workspace MRU records the visit), then selects workspace-safely
  // like the palette (expand collapsed group, show, select).
  // Snapshot walk: the first press freezes lastViewed order (selected
  // first); rapid repeats advance the frozen snapshot instead of
  // re-sorting (re-sorting would toggle, since selecting re-stamps).
  // After TAB_WALK_MS idle the snapshot rebuilds from live recency.
  let tabWalkOrder = null;
  let tabWalkIndex = -1;
  let tabWalkAt = 0;
  const TAB_WALK_MS = 1500;

  function liveTabsForWalk() {
    try {
      const tabs = (typeof gBrowser !== "undefined" && gBrowser.tabs) || [];
      return Array.from(tabs).filter((t) => t && !t.closing);
    } catch (e) {
      return [];
    }
  }

  function tabLastViewed(t) {
    try {
      if (typeof readUnloadLastViewed === "function") {
        return readUnloadLastViewed(t) || 0;
      }
    } catch (e) {}
    return 0;
  }

  function getTabWalkOrder() {
    try {
      const live = liveTabsForWalk();
      if (!live.length) {
        return [];
      }
      let sel = null;
      try {
        sel = (typeof gBrowser !== "undefined" && gBrowser.selectedTab) || null;
      } catch (e) {}
      const scored = [];
      try {
        for (let i = 0; i < live.length; i++) {
          scored.push({ t: live[i], v: tabLastViewed(live[i]), i });
        }
      } catch (e) {}
      try {
        scored.sort((a, b) => {
          if (a.v !== b.v) {
            return b.v - a.v;
          }
          return a.i - b.i;
        });
      } catch (e) {}
      let order = scored.map((s) => s.t);
      // Selected first so index 0 is always current (stamps can tie in
      // tests or miss on restored tabs).
      try {
        if (sel && order.includes(sel)) {
          order = [sel].concat(order.filter((t) => t !== sel));
        }
      } catch (e) {}
      return order;
    } catch (e) {
      return [];
    }
  }

  function selectTabWalkSafe(t) {
    try {
      if (!t || t.closing) {
        return false;
      }
    } catch (e) {
      return false;
    }
    // Pinned tabs are global: never switch workspace for them.
    let pinned = false;
    try {
      pinned = !!t.pinned;
    } catch (e) {}
    let switched = false;
    if (!pinned) {
      try {
        const ws = typeof getWs === "function" ? getWs(t) : null;
        if (isValidId(ws) && ws !== current) {
          switchTo(ws);
          switched = true;
        }
      } catch (e) {}
    }
    try {
      if (t.group && t.group.collapsed) {
        t.group.collapsed = false;
      }
    } catch (e) {}
    try {
      if (t.hidden) {
        if (typeof aphShowTab === "function") {
          aphShowTab(t);
        } else if (gBrowser && typeof gBrowser.showTab === "function") {
          gBrowser.showTab(t);
        }
      }
    } catch (e) {}
    try {
      gBrowser.selectedTab = t;
    } catch (e) {
      return false;
    }
    // A walk that crossed workspaces lands far from the strip's viewport
    // (the switch above revealed the destination's remembered tab, not
    // this one) — same instant landing, same reason as the switch itself.
    // Same-workspace walks keep stock behavior: Ctrl+` between neighbours
    // glides, exactly like Ctrl+Tab.
    if (switched) {
      revealSelectionInstant();
    }
    // TabSelect stamps in chrome; the node harness setter does not fire
    // listeners, so stamp explicitly (same ms, harmless in chrome).
    try {
      if (typeof stampLastViewed === "function") {
        stampLastViewed(t);
      }
    } catch (e) {}
    return true;
  }

  function cycleTabMru(dir) {
    try {
      const step = dir === -1 ? -1 : 1;
      const now = Date.now();
      const sel = gBrowser?.selectedTab || null;
      const live = liveTabsForWalk();
      if (live.length < 2) {
        return;
      }
      const liveSet = new Set(live);
      let order = tabWalkOrder;
      const useSnapshot =
        Array.isArray(order) &&
        order.length === live.length &&
        now - tabWalkAt < TAB_WALK_MS &&
        order.every((t) => liveSet.has(t));

      if (!useSnapshot) {
        order = getTabWalkOrder();
        if (!Array.isArray(order) || order.length < 2) {
          return;
        }
        tabWalkOrder = order;
        tabWalkIndex = 0;
        tabWalkAt = now;
      } else {
        const cur = order.indexOf(sel);
        tabWalkIndex = cur >= 0 ? cur : tabWalkIndex;
      }
      let idx = tabWalkIndex;
      const cur = order.indexOf(sel);
      if (cur >= 0 && cur !== idx) {
        idx = cur;
      }
      const len = order.length;
      const nextIdx = (idx + step + len) % len;
      tabWalkIndex = nextIdx;
      tabWalkAt = now;
      const target = order[nextIdx];
      if (target && !target.closing && liveSet.has(target)) {
        selectTabWalkSafe(target);
      }
    } catch (e) {}
  }

  function dedupTabs(tabs) {
    const out = [];
    const seen = new Set();
    try {
      for (const t of tabs || []) {
        try {
          if (t && !t.closing && !seen.has(t)) {
            seen.add(t);
            out.push(t);
          }
        } catch (e) {}
      }
    } catch (e) {}
    return out;
  }

  function collectGroupFamily(baseTabs) {
    const out = [];
    const seen = new Set();
    try {
      const groups = new Set();
      for (const t of baseTabs || []) {
        try {
          if (t && !t.closing && t.group) {
            groups.add(t.group);
          }
        } catch (e) {}
      }
      if (!groups.size) {
        return dedupTabs(baseTabs);
      }
      const members = [];
      for (const g of groups) {
        let ms = [];
        try {
          ms = typeof groupMembers === "function" ? groupMembers(g) : [];
        } catch (e) {
          ms = [];
        }
        for (const m of ms || []) {
          try {
            if (m && !m.closing && !seen.has(m)) {
              seen.add(m);
              members.push(m);
            }
          } catch (e) {}
        }
      }
      return members.length ? members : dedupTabs(baseTabs);
    } catch (e) {}
    return dedupTabs(baseTabs);
  }

  function preservedSendGroups(moveSet) {
    const preserved = new Set();
    try {
      let groups = [];
      try {
        groups = gBrowser.tabGroups || [];
      } catch (e) {
        return preserved;
      }
      const moving = new Set(moveSet || []);
      for (const g of groups || []) {
        let members = [];
        try {
          members =
            typeof groupMembers === "function"
              ? groupMembers(g).filter((t) => !t.pinned)
              : [];
        } catch (e) {
          members = [];
        }
        if (!members.length) {
          continue;
        }
        let allMoving = true;
        for (const m of members) {
          try {
            if (!moving.has(m)) {
              allMoving = false;
              break;
            }
          } catch (e) {
            allMoving = false;
            break;
          }
        }
        if (allMoving) {
          preserved.add(g);
        }
      }
    } catch (e) {}
    return preserved;
  }

  function executeWorkspaceSend(target, moveSet) {
    if (!isValidId(target) || !moveSet || !moveSet.length) {
      return false;
    }
    // Window-scoped: every send retags locally. Other windows showing the
    // same id are independent tab sets and are never touched.
    const moving = new Set();
    try {
      for (const t of moveSet) {
        if (t && !t.closing) {
          moving.add(t);
        }
      }
    } catch (e) {}
    if (!moving.size) {
      return false;
    }
    const list = Array.from(moving);
    // A split pair must not straddle workspaces: separate any split
    // touching the move set before retagging (both tabs stay open —
    // the sent tab hides on reconcile below).
    try {
      if (typeof separateSplitsOf === "function") {
        separateSplitsOf(list);
      }
    } catch (e) {}
    let preserved = null;
    try {
      preserved = preservedSendGroups(list);
    } catch (e) {
      preserved = new Set();
    }
    // Eject partial-group members; whole groups stay joined so membership
    // survives the retag.
    for (const tab of list) {
      try {
        if (!tab.group) {
          continue;
        }
        let keep = false;
        try {
          keep = preserved && preserved.has(tab.group);
        } catch (e) {}
        if (!keep) {
          gBrowser.ungroupTab(tab);
        }
      } catch (e) {}
    }
    // Top insertion anchor for destination workspace before retagging
    let neighbor = null;
    try {
      if (typeof getTopWorkingIndex === "function" && typeof gBrowser !== "undefined") {
        const targetIdx = getTopWorkingIndex(target);
        const allTabs = Array.from(gBrowser.tabs || []);
        if (targetIdx >= 0 && targetIdx < allTabs.length) {
          for (let i = targetIdx; i < allTabs.length; i++) {
            const candidate = allTabs[i];
            if (candidate && !moving.has(candidate) && !candidate.closing && !candidate.pinned) {
              neighbor = candidate;
              break;
            }
          }
        }
      }
    } catch (e) {}

    for (const tab of list) {
      try {
        setWs(tab, target);
      } catch (e) {}
    }

    try {
      const unpinned = list.filter((t) => t && !t.closing && !t.pinned);
      if (unpinned.length && typeof gBrowser !== "undefined") {
        let moved = false;
        if (neighbor && typeof gBrowser.moveTabsBefore === "function") {
          try {
            gBrowser.moveTabsBefore(unpinned, neighbor);
            moved = true;
          } catch (e) {}
        }
        if (!moved) {
          for (const tab of unpinned) {
            if (neighbor) {
              if (typeof gBrowser.moveTabBefore === "function") {
                try {
                  gBrowser.moveTabBefore(tab, neighbor);
                  continue;
                } catch (e) {}
              }
              const tabs = Array.from(gBrowser.tabs || []);
              const curNeighborIdx = tabs.indexOf(neighbor);
              const curTabIdx = tabs.indexOf(tab);
              if (curTabIdx !== -1 && curNeighborIdx !== -1 && curTabIdx !== curNeighborIdx) {
                const destIdx = curTabIdx < curNeighborIdx ? curNeighborIdx - 1 : curNeighborIdx;
                try {
                  gBrowser.moveTabTo?.(tab, { tabIndex: destIdx, forceUngrouped: !tab.group });
                } catch (e) {
                  gBrowser.moveTabTo?.(tab, destIdx);
                }
              }
            } else {
              if (typeof gBrowser.moveTabToEnd === "function") {
                try {
                  gBrowser.moveTabToEnd(tab);
                  continue;
                } catch (e) {}
              }
              const endIdx = (gBrowser.tabs || []).length - 1;
              try {
                gBrowser.moveTabTo?.(tab, { tabIndex: endIdx, forceUngrouped: !tab.group });
              } catch (e) {
                gBrowser.moveTabTo?.(tab, endIdx);
              }
            }
          }
        }
      }
    } catch (e) {}

    try {
      if (typeof aphTabsLog === "function") {
        aphTabsLog(`send ws=${target} moved=${list.length}`);
      }
    } catch (_e) {}
    anchorAllGroups();
    try {
      reconcile(current, Array.from(gBrowser.tabs));
    } catch (e) {}
    // Dock counts are tag-based: repaint so pill counts follow the move
    // immediately (drag-mode expansion collapses on dragend).
    try {
      if (typeof renderDock === "function") {
        renderDock();
      }
    } catch (e) {}
    return true;
  }

  function resolveSendBase(explicit) {
    try {
      if (Array.isArray(explicit)) {
        const live = new Set(Array.from(gBrowser?.tabs || []));
        const filtered = explicit.filter((t) => t && !t.closing && (live.size === 0 || live.has(t)));
        if (filtered.length) return filtered;
      } else if (explicit && !explicit.closing) {
        return [explicit];
      }
      const multi = gBrowser?.selectedTabs || gBrowser?.multiselectedTabs || [];
      const multiFiltered = Array.from(multi).filter((t) => t && !t.closing);
      if (multiFiltered.length) return multiFiltered;

      const sel = gBrowser?.selectedTab;
      if (sel && !sel.closing) return [sel];
    } catch (e) {}
    return [];
  }

  function sendTabTo(target, explicit) {
    if (!isValidId(target) || target === current) {
      return;
    }
    const base = resolveSendBase(explicit);
    if (!base.length) {
      return;
    }
    executeWorkspaceSend(target, base);
  }

  // Explicit native-group move: every tab in the containing group(s)
  // travels together with membership intact.
  // Ungrouped tabs move as-is.
  function sendGroupTo(target, explicit) {
    if (!isValidId(target) || target === current) {
      return;
    }
    const base = resolveSendBase(explicit);
    if (!base.length) {
      return;
    }
    executeWorkspaceSend(target, collectGroupFamily(base));
  }

