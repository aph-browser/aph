  // Workspace indicator: number, or "N: name" pill once named. Click
  // renames via the command palette (no popover exists — this is the
  // mouse path). The `data-aph-ws` attribute on tabContainer already
  // existed but nothing rendered it — this badge does.
  function ensureIndicator() {
    try {
      let el = document.getElementById("aph-ws-indicator");
      if (el) {
        return el;
      }
      const navBar = document.getElementById("nav-bar");
      if (!navBar) {
        return null;
      }
      el = document.createElement("div");
      el.id = "aph-ws-indicator";
      el.textContent = isValidId(current) ? current : "1";
      el.title = "Workspace (Alt+Shift+1..9, ]/[ to cycle, Tab for last)";
      try {
        el.addEventListener("click", () => {
          try {
            if (window.AphPalette) {
              window.AphPalette.renameCurrent();
            }
          } catch (e) {}
        });
      } catch (e) {}
      navBar.prepend(el);
      return el;
    } catch (e) {
      return null;
    }
  }

  function updateIndicator() {
    try {
      const el = document.getElementById("aph-ws-indicator") || ensureIndicator();
      if (el) {
        const cur = isValidId(current) ? current : "1";
        const name = getWsName(cur);
        el.textContent = name ? `${cur}: ${name}` : cur;
        // Bound container: color underline + tooltip. boxShadow (not border)
        // so the fixed 24px badge never shifts layout.
        let title = `Workspace ${cur}${name ? `: ${name}` : ""} (Alt+Shift+1..9 · ]/[ cycle · Tab toggles last · click to rename)`;
        let color = "";
        try {
          const bid = getWsContainerId(cur);
          if (bid) {
            const d = describeContainer(bid);
            if (d && d.name) {
              title = `Workspace ${cur}${name ? `: ${name}` : ""} · ${d.name} container (Ctrl+T opens here · click to rename)`;
            }
            if (d && d.color && CONTAINER_HEX[d.color]) {
              color = CONTAINER_HEX[d.color];
            }
          }
        } catch (e) {}
        try {
          let routed = 0;
          const map = loadRoutes();
          for (const k of Object.keys(map)) {
            if (map[k] === cur) {
              routed++;
            }
          }
          if (routed) {
            title += ` · ${routed} routed domain${routed === 1 ? "" : "s"}`;
          }
        } catch (e) {}
        el.title = title;
        try {
          el.style.boxShadow = color ? `inset 0 -2px 0 ${color}` : "";
        } catch (e) {}
      }
      // Dock repaints with the badge: switch/rename/bind/pref-sync covered.
      // Tab open/close/restore/pin call renderDock from their own handlers.
      try {
        renderDock();
      } catch (e) {}
    } catch (e) {}
  }

  // Crimson pulse timer for the workspace indicator (200ms flash).
  let wsPulseTimer = null;
  // Handles for process-global registrations owned by this window. Prefs /
  // progress / obs observers are held strongly by their service, so each
  // must be released on unload or the closed window (document, gBrowser,
  // tabs) leaks via the observer closure until process exit.
  let bindingObserver = null;
  let routeObserver = null;
  let nameObserver = null;
  let startupRestoreObserver = null;
  let navPopupObserver = null;
  // Original window.BrowserOpenTab, captured before initBoundNewTab wraps
  // it so + button / menu births land in the bound container. Restored on
  // unload (cleanupWindowObservers).
  let origBrowserOpenTab = null;
  function pulseWorkspaceIndicator() {
    try {
      const el = gBrowser.tabContainer;
      el.setAttribute("data-aph-ws-pulse", "1");
      const badge = document.getElementById("aph-ws-indicator");
      if (badge) {
        badge.setAttribute("data-aph-ws-pulse", "1");
      }
      if (wsPulseTimer) {
        clearTimeout(wsPulseTimer);
      }
      wsPulseTimer = setTimeout(() => {
        try {
          el.removeAttribute("data-aph-ws-pulse");
        } catch (e) {}
        try {
          if (badge) {
            badge.removeAttribute("data-aph-ws-pulse");
          }
        } catch (e) {}
        wsPulseTimer = null;
      }, 200);
    } catch (e) {}
  }

  // Local-only switch: show `target` in this window. Cross-window policy
  // lives in switchTo (55-exclusive.js); callers that already resolved
  // ownership (startup de-dupe) use this directly. Returns "local"/"noop"
  // so console callers can confirm what ran (no UI effect).
  function switchLocal(target) {
    if (!isValidId(target) || target === current) {
      return "noop";
    }
    beginWorkspaceSwitch(target);
    finishWorkspaceSwitch(target);
    return "local";
  }

  // Commit this window's claim first: current + WIN_KEY + indicator. The
  // adopted-tab handler stamps arrivals to `current`, so the claim must
  // precede any pull — otherwise pulled tabs land in the old workspace.
  function beginWorkspaceSwitch(target) {
    if (!isValidId(target) || target === current) {
      return;
    }
    let tabs = [];
    try {
      tabs = Array.from(gBrowser.tabs);
    } catch (e) {}
    rememberCurrent(tabs);
    lastUsed = current;
    current = target;
    try {
      gBrowser.tabContainer.setAttribute("data-aph-ws", target);
    } catch (e) {}
    updateIndicator();
    pulseWorkspaceIndicator();
    try {
      if (typeof setWindowWs === "function") {
        setWindowWs(target);
      } else {
        SessionStore.setCustomWindowValue(window, WIN_KEY, target);
      }
    } catch (e) {}
  }

  // Settle visibility after the claim (and any pull): fresh tab snapshot
  // so adopted tabs reconcile in the same pass.
  function finishWorkspaceSwitch(target) {
    if (!isValidId(target)) {
      return;
    }
    let tabs = [];
    try {
      tabs = Array.from(gBrowser.tabs);
    } catch (e) {}
    anchorAllGroups();
    reconcile(target, tabs);
    pruneExtraNewTabs(target);
    // Pinned tabs match the viewed workspace (not their dormant tag), so
    // every switch re-syncs markers; unpinned matches are tag-stable and
    // the pass is a cheap no-op for them.
    try {
      if (typeof syncAllTabChrome === "function") {
        syncAllTabChrome();
      }
    } catch (e) {}
    // Deferred so the switch stays snappy; guards re-check at fire time.
    try {
      if (getUnloadOnSwitch()) {
        setTimeout(() => {
          try {
            unloadEligibleTabs({ scope: "foreign" });
          } catch (e) {}
        }, 0);
      }
    } catch (e) {}
    // Auto-archive (opt-in pref, default off — archive.js owns the pref
    // read, eligibility and timing): each switch (re-)arms a 15 s settle
    // timer there, so the sweep fires only once you've sat still; V1 has
    // no staleness threshold and every eligible hidden-workspace tab goes.
    try {
      const arc = window.AphArchive;
      if (arc && typeof arc.scheduleAutoSweep === "function") {
        arc.scheduleAutoSweep();
      }
    } catch (e) {}
  }

  // Exclusive entry: every keyboard/dock/palette path funnels here.
  // Owned elsewhere -> focus-jump (V1 has no steal). Dormant -> claim
  // first (so arrivals stamp correctly), pull its tabs here via adoptTab,
  // then settle. Private windows bypass the pool and switch locally.
  // Returns "focused"/"focus-failed"/"switched"/"local"/"noop" for console
  // diagnosis (callers ignore it).
  function switchTo(target) {
    if (!isValidId(target) || target === current) {
      return "noop";
    }
    try {
      if (typeof aphIsPrivateWindow === "function" && aphIsPrivateWindow(window)) {
        switchLocal(target);
        return "local";
      }
    } catch (e) {}
    let owner = null;
    try {
      owner = typeof findWsOwner === "function" ? findWsOwner(target) : null;
    } catch (e) {
      owner = null;
    }
    if (owner && owner !== window) {
      let ok = false;
      try {
        if (typeof focusWsOwner === "function") {
          ok = focusWsOwner(owner);
        } else if (owner && typeof owner.focus === "function") {
          owner.focus();
          ok = true;
        }
      } catch (e) {
        ok = false;
      }
      try {
        pulseWorkspaceIndicator();
      } catch (e) {}
      return ok ? "focused" : "focus-failed";
    }
    try {
      if (typeof beginWorkspaceSwitch === "function") {
        beginWorkspaceSwitch(target);
      }
    } catch (e) {}
    try {
      if (typeof pullDormantTabs === "function") {
        pullDormantTabs(target);
      }
    } catch (e) {}
    try {
      if (typeof finishWorkspaceSwitch === "function") {
        finishWorkspaceSwitch(target);
      } else {
        switchLocal(target);
      }
    } catch (e) {}
    try {
      if (typeof broadcastWsSwitch === "function") {
        broadcastWsSwitch(target);
      }
    } catch (e) {}
    return "switched";
  }

  // Cycling: "active" = has a live unpinned tab (pins are global with a
  // dormant tag, so they don't count); current always counts so an empty
  // workspace never strands you. Sorted so next/prev wrap deterministically.
  function getActiveIds() {
    const seen = new Set();
    try {
      for (const t of Array.from(gBrowser.tabs || [])) {
        try {
          if (t.closing || t.pinned) {
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

  function toggleLastWorkspace() {
    if (isValidId(lastUsed) && lastUsed !== current) {
      switchTo(lastUsed);
    }
  }

  // Send family helpers: trees and native groups move as units, single
  // tabs extract. `collectTreeFamily` carries linked descendants (same-WS,
  // same-group filtered — stranded cross-edge tabs read detached and stay).
  // `preservedSendGroups` keeps membership when the move covers a whole
  // group (no ungroup); partial moves eject as before. `executeWorkspaceSend`
  // is the shared core: eject non-preserved members, keep links whose
  // parent travels, detach roots whose parent stays, promote stragglers
  // left behind, then retag the whole set.
  function collectTreeFamily(baseTabs) {
    const out = [];
    const seen = new Set();
    try {
      for (const t of baseTabs || []) {
        try {
          if (!t || t.closing || seen.has(t)) {
            continue;
          }
          seen.add(t);
          out.push(t);
        } catch (e) {}
      }
      // Descendants of each root join (recursive already); newly added
      // members can themselves own deeper levels, but getTreeDescendants
      // is transitive so one pass suffices.
      const roots = out.slice();
      for (const r of roots) {
        let kids = [];
        try {
          kids =
            typeof getTreeDescendants === "function" ? getTreeDescendants(r) : [];
        } catch (e) {
          kids = [];
        }
        for (const k of kids || []) {
          try {
            if (!k || k.closing || seen.has(k)) {
              continue;
            }
            seen.add(k);
            out.push(k);
          } catch (e) {}
        }
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
        return collectTreeFamily(baseTabs);
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
      // Carry grouped trees along (same filtered walk as single moves).
      return collectTreeFamily(members.length ? members : baseTabs);
    } catch (e) {}
    return collectTreeFamily(baseTabs);
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

  // Forward a send into the window that owns `target` (adopt + tag there).
  // The owner's adopted-tab handler settles selection/headers/dock; this
  // side heals selection in case a selected tab rode along. Pinned tabs
  // never forward (app anchors don't duplicate); trees/groups flatten on
  // forward (v1 — same rule as partial moves ejecting).
  function forwardWorkspaceSend(owner, target, moveSet) {
    try {
      const moving = [];
      try {
        for (const t of moveSet || []) {
          if (t && !t.closing && !t.pinned) {
            moving.push(t);
          }
        }
      } catch (e) {}
      if (!moving.length || !owner || owner.closed || !owner.gBrowser) {
        return false;
      }
      let forwarded = 0;
      for (const t of moving) {
        try {
          if (!t || t.closing || t.pinned) {
            continue;
          }
          let nt = null;
          try {
            if (typeof owner.gBrowser.adoptTab === "function") {
              let idx = 0;
              try {
                idx = (owner.gBrowser.tabs && owner.gBrowser.tabs.length) || 0;
              } catch (e) {}
              try {
                nt = owner.gBrowser.adoptTab(t, { tabIndex: idx }) || null;
              } catch (e) {
                try {
                  nt = owner.gBrowser.adoptTab(t) || null;
                } catch (_e) {}
              }
            }
          } catch (e) {}
          if (!nt) {
            continue;
          }
          forwarded++;
          // Scrub the adoption ghost: source is this window, and undo must
          // not resurrect the forwarded tab as a duplicate.
          try {
            if (typeof scrubAdoptionGhost === "function") {
              scrubAdoptionGhost(window, t);
            }
          } catch (e) {}
          try {
            setWs(nt, target);
          } catch (e) {}
          try {
            if (typeof clearTreeParent === "function") {
              clearTreeParent(nt);
            }
          } catch (e) {}
          try {
            if (typeof ensureTreeId === "function") {
              ensureTreeId(nt);
            }
          } catch (e) {}
        } catch (e) {}
      }
      try {
        if (
          owner.AphWorkspaces &&
          typeof owner.AphWorkspaces.renderDock === "function"
        ) {
          owner.AphWorkspaces.renderDock();
        }
      } catch (e) {}
      try {
        reconcile(current, Array.from(gBrowser.tabs));
        pruneExtraNewTabs(current);
      } catch (e) {}
      try {
        if (typeof renderDock === "function") {
          renderDock();
        }
      } catch (e) {}
      return forwarded > 0;
    } catch (e) {
      return false;
    }
  }

  function executeWorkspaceSend(target, moveSet) {
    if (!isValidId(target) || !moveSet || !moveSet.length) {
      return false;
    }
    // Remote-owned target: forwarding into the owner beats stranding tabs
    // hidden here and absent there (invisible in both windows). A
    // private-owned target refuses instead — never cross that boundary.
    try {
      const selfPrivate =
        typeof aphIsPrivateWindow === "function" && aphIsPrivateWindow(window);
      if (!selfPrivate && typeof findWsOwner === "function") {
        const owner = findWsOwner(target);
        if (owner && owner !== window) {
          return forwardWorkspaceSend(owner, target, moveSet);
        }
        try {
          if (typeof findWsOwner === "function" && findWsOwner(target, true)) {
            try {
              pulseWorkspaceIndicator();
            } catch (e) {}
            return false;
          }
        } catch (e) {}
      }
    } catch (e) {}
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
    let preserved = null;
    try {
      preserved = preservedSendGroups(list);
    } catch (e) {
      preserved = new Set();
    }
    // Snapshot parent links before any retag (getWs-gated reads go stale
    // after the first setWs).
    const parentOf = new Map();
    try {
      for (const t of list) {
        let p = null;
        try {
          p =
            typeof getTreeParentTab === "function" ? getTreeParentTab(t) : null;
        } catch (e) {
          p = null;
        }
        parentOf.set(t, p || null);
      }
    } catch (e) {}
    // Eject partial-group members; whole groups stay joined so membership
    // (and the tree nesting invariant) survives the retag.
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
    // Detach roots whose parent stays behind; keep edges whose parent
    // travels. Stragglers (non-moving children of movers) promote to the
    // grandparent or to roots — the detachTreeForWorkspaceSend rule.
    try {
      const hasTreeFns =
        typeof clearTreeParent === "function" &&
        typeof ensureTreeId === "function";
      if (hasTreeFns) {
        for (const tab of list) {
          try {
            const parent = parentOf.get(tab) || null;
            if (parent && !moving.has(parent)) {
              clearTreeParent(tab);
            }
            try {
              ensureTreeId(tab);
            } catch (e) {}
          } catch (e) {}
        }
        // Promote non-moving children left behind by each mover.
        let allTabs = [];
        try {
          allTabs = Array.from(gBrowser.tabs || []);
        } catch (e) {}
        for (const mover of list) {
          let moverId = null;
          try {
            moverId =
              typeof rawTreeId === "function" ? rawTreeId(mover) : null;
          } catch (e) {}
          if (!moverId) {
            continue;
          }
          for (const t of allTabs) {
            try {
              if (!t || t === mover || moving.has(t) || t.closing) {
                continue;
              }
              let pid = null;
              try {
                pid =
                  typeof rawTreeParentId === "function"
                    ? rawTreeParentId(t)
                    : null;
              } catch (e) {}
              if (pid !== moverId) {
                continue;
              }
              // Child stays: re-hang to the mover's parent when that
              // parent stays too, else to a root.
              const gpTab = parentOf.get(mover) || null;
              if (gpTab && !moving.has(gpTab) && !gpTab.closing) {
                let gid = null;
                try {
                  gid =
                    typeof rawTreeId === "function" ? rawTreeId(gpTab) : null;
                } catch (e) {}
                if (gid) {
                  try {
                    if (typeof setTreeParent === "function") {
                      setTreeParent(t, gid);
                    }
                  } catch (e) {}
                  continue;
                }
              }
              try {
                clearTreeParent(t);
              } catch (e) {}
            } catch (e) {}
          }
          // Collapse flag travels with the family; drop it when nothing
          // was carried (mirrors detachTreeForWorkspaceSend).
          try {
            let carried = false;
            for (const t of list) {
              if (parentOf.get(t) === mover) {
                carried = true;
                break;
              }
            }
            if (!carried && typeof collapsedTreeParents !== "undefined") {
              try {
                collapsedTreeParents.delete(moverId);
              } catch (e) {}
            }
          } catch (e) {}
        }
      }
    } catch (e) {}
    for (const tab of list) {
      try {
        setWs(tab, target);
      } catch (e) {}
    }
    anchorAllGroups();
    try {
      if (typeof renderTree === "function") {
        renderTree();
      }
    } catch (e) {}
    try {
      reconcile(current, Array.from(gBrowser.tabs));
      pruneExtraNewTabs(current);
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
    let tabs = [];
    // Explicit drag set wins (dock DnD): dragging an unselected tab must
    // move that tab, not whatever happens to be selected. Keyboard/palette
    // callers pass nothing and keep the live-selection behavior below.
    try {
      if (Array.isArray(explicit)) {
        try {
          const live = new Set(Array.from(gBrowser.tabs || []));
          tabs = explicit.filter((t) => t && !t.closing && live.has(t));
        } catch (e) {
          tabs = explicit.filter((t) => t && !t.closing);
        }
      } else if (explicit && !explicit.closing) {
        try {
          const live = Array.from(gBrowser.tabs || []);
          tabs = live.includes(explicit) ? [explicit] : [explicit];
        } catch (e) {
          tabs = [explicit];
        }
      }
    } catch (e) {}
    if (!tabs.length) {
      try {
        const multi = gBrowser.selectedTabs || gBrowser.multiselectedTabs || [];
        tabs = Array.from(multi).filter((t) => t && !t.closing);
      } catch (e) {}
    }
    if (!tabs.length) {
      try {
        const sel = gBrowser.selectedTab;
        if (sel && !sel.closing) {
          tabs = [sel];
        }
      } catch (e) {}
    }
    return tabs;
  }

  // Send the multiselection (Ctrl+click) to WS N and stay; with no
  // multiselection this is just the active tab. Trees travel: linked
  // descendants join automatically so a parent move keeps its hierarchy in
  // the target workspace. Native groups stay joined when the move covers
  // the whole group; partial moves eject as before (groups are single-WS).
  // Pinned tabs are global so sent pins stay visible; their tags are dormant
  // state applied on eventual unpin. Sent tabs keep their containers
  // (containers are immutable per tab), and position; bindings only affect
  // newly opened tabs.
  function sendTabTo(target, explicit, opts) {
    if (!isValidId(target) || target === current) {
      return;
    }
    const base = resolveSendBase(explicit);
    if (!base.length) {
      return;
    }
    let moveSet = base;
    try {
      const withTree = !opts || opts.withTree !== false;
      moveSet = withTree ? collectTreeFamily(base) : base.slice();
    } catch (e) {
      moveSet = base;
    }
    executeWorkspaceSend(target, moveSet);
  }

  // Explicit tree move: the tab(s) plus all linked descendants travel
  // together, preserving parent links in the target workspace. Falls back
  // to the live selection like sendTabTo when given nothing.
  function sendTreeTo(target, explicit) {
    if (!isValidId(target) || target === current) {
      return;
    }
    const base = resolveSendBase(explicit);
    if (!base.length) {
      return;
    }
    executeWorkspaceSend(target, collectTreeFamily(base));
  }

  // Explicit native-group move: every tab in the containing group(s)
  // travels together with membership intact (plus linked tree descendants).
  // Ungrouped tabs fall back to a tree move.
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

