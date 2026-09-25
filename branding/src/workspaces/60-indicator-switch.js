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
        // Bound container: colored dot + tooltip (theme.css §6 renders the
        // dot from data-aph-bound + --aph-ws-dot). Attribute + var driven
        // so the fixed-height pill never shifts layout, and the filled
        // dot reads on light and dark toolbars alike.
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
          if (color) {
            // Var first: if the style write throws (minimal stubs), the
            // attribute never lands and no var-less dot renders.
            el.style.setProperty("--aph-ws-dot", color);
            el.setAttribute("data-aph-bound", "1");
          } else {
            el.removeAttribute("data-aph-bound");
            el.style.removeProperty("--aph-ws-dot");
          }
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

  // Switch animation: fade incoming tabs in after the synchronous
  // hidden-attribute swap. A leave-side tab fade is impossible here — the
  // whole switch commits in one task, so a leave frame would never paint
  // (splitting the commit async would break every sync visibility
  // assertion for a 100ms cosmetic). Instead the CARD dips (§24
  // .aph-ws-dip via dipWorkspaceCard below): the synchronous swap reads
  // as a dissolve rather than a blink, with zero visibility-semantics
  // change. Pins are global (never change) so they are excluded.
  // Fail-silent throughout (test tabs have no classList, which just
  // no-ops; test documents return null for the card, also a no-op).
  function animateIncomingTabs(tabs) {
    let animated = null;
    try {
      for (const t of tabs || []) {
        try {
          if (!t || t.closing || t.pinned) {
            continue;
          }
          if (t.hidden) {
            continue;
          }
          if (typeof t.hasAttribute === "function" && t.hasAttribute("hidden")) {
            continue;
          }
          if (!t.classList || typeof t.classList.add !== "function") {
            continue;
          }
          t.classList.add("aph-ws-enter");
          (animated = animated || []).push(t);
        } catch (e) {}
      }
    } catch (e) {}
    if (!animated) {
      return;
    }
    try {
      setTimeout(() => {
        try {
          for (const t of animated) {
            try {
              t.classList.remove("aph-ws-enter");
            } catch (e) {}
          }
        } catch (e) {}
      }, 200);
    } catch (e) {}
  }

  // Card dip dissolve (§24): called after reconcile's synchronous swap.
  // Adds .aph-ws-dip to #tabbrowser-tabbox (100ms dip to 0.45) and
  // removes it on a 120ms timer (180ms glide back). Retrigger-safe: a
  // mid-dip switch clears the pending removal and re-arms, so mashing
  // workspaces never sticks the card dim. Skipped under
  // prefers-reduced-motion. Visual only — no visibility semantics, so
  // sync tests observe nothing (their document stub returns null here).
  let wsDipTimer = null;
  function dipWorkspaceCard() {
    try {
      if (
        typeof window.matchMedia === "function" &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches
      ) {
        return;
      }
    } catch (e) {}
    let box = null;
    try {
      box = document.getElementById("tabbrowser-tabbox");
    } catch (e) {}
    if (!box || !box.classList || typeof box.classList.add !== "function") {
      return;
    }
    try {
      if (wsDipTimer) {
        clearTimeout(wsDipTimer);
        wsDipTimer = null;
      }
    } catch (e) {}
    try {
      box.classList.add("aph-ws-dip");
    } catch (e) {
      return;
    }
    try {
      wsDipTimer = setTimeout(() => {
        wsDipTimer = null;
        try {
          box.classList.remove("aph-ws-dip");
        } catch (e) {}
      }, 120);
    } catch (e) {}
  }

  // Local-only switch: show `target` in this window. `switchTo` is local
  // too; this entry exists for callers that already claimed (startup
  // restore) and for console use. Returns "local"/"noop" so console
  // callers can confirm what ran (no UI effect).
  function switchLocal(target) {
    if (!isValidId(target) || target === current) {
      return "noop";
    }
    beginWorkspaceSwitch(target);
    finishWorkspaceSwitch(target);
    return "local";
  }

  // Window-level workspace stamp: mirrors the tabContainer claim onto
  // documentElement so theme.css can tint per workspace
  // (:root[data-aph-ws="N"] -> --aph-ws-accent, §20). try/catch like the
  // tabContainer stamp — paint must never break a switch.
  function stampWindowWs(target) {
    try {
      document.documentElement.setAttribute("data-aph-ws", target);
    } catch (e) {}
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
    stampWindowWs(target);
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
    dipWorkspaceCard();
    pruneExtraNewTabs(target);
    // Fresh snapshot: reconcile may have opened a tab for an empty
    // workspace, which the stale list above would miss.
    try {
      animateIncomingTabs(Array.from(gBrowser.tabs));
    } catch (e) {}
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

  // Window-scoped entry: every keyboard/dock/palette path funnels here.
  // Each window switches purely locally — other windows are never
  // consulted, pulled from, or focused. A workspace with no local tabs
  // opens a fresh tab via reconcile; same-id workspaces elsewhere are
  // independent tab sets. Returns "switched"/"local"/"noop" for console
  // diagnosis (callers ignore it).
  function switchTo(target) {
    if (!isValidId(target) || target === current) {
      return "noop";
    }
    try {
      if (typeof beginWorkspaceSwitch === "function") {
        beginWorkspaceSwitch(target);
      }
    } catch (e) {}
    try {
      if (typeof finishWorkspaceSwitch === "function") {
        finishWorkspaceSwitch(target);
      } else {
        switchLocal(target);
      }
    } catch (e) {}
    return "switched";
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
          try {
            pulseWorkspaceIndicator();
          } catch (_e) {}
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
        pruneExtraNewTabs(current);
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

  // Send family helpers: native groups move as units, single tabs move
  // as-is. `preservedSendGroups` keeps membership when the move covers a
  // whole group (no ungroup); partial moves eject as before.
  // `executeWorkspaceSend` is the shared core: eject non-preserved members,
  // then retag the whole set.
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
    for (const tab of list) {
      try {
        setWs(tab, target);
      } catch (e) {}
    }
    try {
      if (typeof aphTabsLog === "function") {
        aphTabsLog(`send ws=${target} moved=${list.length}`);
      }
    } catch (_e) {}
    anchorAllGroups();
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
        // Single explicit tab (drag or caller): liveness filtering needs
        // the strip, which may itself throw — either way it moves alone.
        tabs = [explicit];
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
  // multiselection this is just the active tab. The selection moves as-is.
  // Native groups stay joined when the move covers
  // the whole group; partial moves eject as before (groups are single-WS).
  // Pinned tabs are global so sent pins stay visible; their tags are dormant
  // state applied on eventual unpin. Sent tabs keep their containers
  // (containers are immutable per tab), and position; bindings only affect
  // newly opened tabs.
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

