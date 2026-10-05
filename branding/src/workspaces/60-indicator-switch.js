  // Workspace indicator pill (nav-bar): icon + name readout. Click
  // renames via the command palette, right-click opens the icon picker
  // (same Rename / Set Icon pair as the dock right-click menu — the pill
  // is the top-left equivalent for the current workspace). No popover
  // exists — both are mouse paths into the palette. The `data-aph-ws`
  // attribute on tabContainer already existed but nothing rendered it —
  // this badge does.
  // Indicator: icon + name. The icon (when set) leads, the label is
  // the name or the bare number — the dock below already shows all
  // nine numbers, and the tooltip keeps `Workspace N: Name`, so the
  // address survives one hover away. Mixed content (never textContent:
  // that would stringify the mark); the svg is aria-hidden paint.
  function paintIndicatorLabel(el, wsId, name) {
    try {
      while (el.firstChild) {
        el.removeChild(el.firstChild);
      }
    } catch (e) {}
    try {
      const mark = makeWsIconSvg(getWsIcon(wsId), 14);
      if (mark) {
        try {
          el.appendChild(mark);
        } catch (e) {}
      }
    } catch (e) {}
    try {
      el.appendChild(document.createTextNode(name || wsId));
    } catch (e) {
      el.textContent = name || wsId;
    }
  }
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
      el.title = "Workspace (Alt+1..9 switch, Alt+Shift+]/[ cycle, Alt+Shift+Tab last, click to rename, right-click for icon)";
      try {
        el.addEventListener("click", () => {
          try {
            if (window.AphPalette) {
              window.AphPalette.renameCurrent();
            }
          } catch (e) {}
        });
      } catch (e) {}
      // Right-click edits the mark, mirroring the dock menu's Set Icon
      // item for the current workspace. Suppresses the stock nav-bar
      // context menu on the pill (toolbar customize lives everywhere
      // else on the bar). Fail-silent: test pills have no addEventListener.
      try {
        el.addEventListener("contextmenu", (e) => {
          try {
            if (e && typeof e.preventDefault === "function") {
              e.preventDefault();
            }
          } catch (_e) {}
          try {
            if (e && typeof e.stopPropagation === "function") {
              e.stopPropagation();
            }
          } catch (_e) {}
          try {
            const api = window.AphPalette;
            if (api && typeof api.setWsIcon === "function") {
              api.setWsIcon(isValidId(current) ? current : "1");
            }
          } catch (_e) {}
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
        // Icon + name readout (paintIndicatorLabel above): the icon
        // leads when set, the label is the name or the bare number.
        // The tooltip below keeps `Workspace N: Name` + shortcuts, so
        // the address survives one hover away.
        paintIndicatorLabel(el, cur, name);
        // Bound container: tooltip only, no color marker — bound pills
        // read identical to unbound ones (monochrome chrome). The palette
        // Bind rows are the editor; this title is the checker.
        let title = `Workspace ${cur}${name ? `: ${name}` : ""} (Alt+1..9 switch · Alt+Shift+]/[ cycle · Alt+Shift+Tab last · click to rename · right-click for icon)`;
        try {
          const bid = getWsContainerId(cur);
          if (bid) {
            const d = describeContainer(bid);
            if (d && d.name) {
              title = `Workspace ${cur}${name ? `: ${name}` : ""} · ${d.name} container (Ctrl+T opens here · click to rename · right-click for icon)`;
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
  let wsIconObserver = null;
  let startupRestoreObserver = null;
  let navPopupObserver = null;
  // Original window.BrowserOpenTab, captured before initBoundNewTab wraps
  // it so + button / menu births land in the bound container. Restored on
  // unload (cleanupWindowObservers).
  let origBrowserOpenTab = null;
  function pulseWorkspaceIndicator() {    try {
      try {
        if (
          typeof window.matchMedia === "function" &&
          window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ) {
          return;
        }
      } catch (e) {}
      const el = gBrowser.tabContainer;
      el.setAttribute("data-aph-ws-pulse", "1");
      const badge = document.getElementById("aph-ws-indicator");
      if (badge) {
        badge.setAttribute("data-aph-ws-pulse", "1");
      }
      if (wsPulseTimer) {
        clearTimeout(wsPulseTimer);
      }
      // Short presence flash: clears well inside the bloom decay so the
    // indicator never outlives the switch signal.
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
      }, 140);
    } catch (e) {}
  }

  // Switch animation: the commit is synchronous (hidden-attribute
  // swap), so a leave-side fade could never paint — and a card dip
  // flashed the whole page. Two calm signals instead: (1) a rim bloom
  // on the content card (strikeBloom below — a fixed overlay flashing
  // the destination accent, opacity-only, 220ms decay), and
  // (2) incoming tabs gliding 10px as ONE unified plane, no stagger,
  // full opacity throughout. Direction rides switchDir, captured in
  // beginWorkspaceSwitch before the claim flips `current`: ascending
  // (1->2) rises from below, descending sinks from above. Rapid
  // re-switches strip both glide classes, reflow, and re-strike —
  // transitions never queue, only the latest target animates. Pins are
  // global (never change) so they are excluded. Fail-silent throughout
  // (test tabs have no classList, which just no-ops; test documents
  // return null for the card, also a no-op).
  const APH_WS_ENTER_GLIDE_MS = 120;
  const APH_WS_ENTER_CLEANUP_MS = APH_WS_ENTER_GLIDE_MS + 60;
  const APH_WS_BLOOM_ID = "aph-ws-bloom";
  let switchDir = 1;
  // Breadcrumb for console diagnosis (did the switch animate?): set in
  // beginWorkspaceSwitch, read via AphWorkspaces.debugLastSwitch().
  let lastSwitchInfo = null;
  function debugLastSwitch() {
    try {
      if (!lastSwitchInfo) {
        return null;
      }
      return {
        from: lastSwitchInfo.from,
        to: lastSwitchInfo.to,
        dir: lastSwitchInfo.dir,
        at: lastSwitchInfo.at,
      };
    } catch (e) {
      return null;
    }
  }
  function animateIncomingTabs(tabs, dir) {
    try {
      if (
        typeof window.matchMedia === "function" &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches
      ) {
        return;
      }
    } catch (e) {}
    const cls = dir < 0 ? "aph-ws-enter-down" : "aph-ws-enter-up";
    const other = dir < 0 ? "aph-ws-enter-up" : "aph-ws-enter-down";
    let eligible = null;
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
          (eligible = eligible || []).push(t);
        } catch (e) {}
      }
    } catch (e) {}
    if (!eligible) {
      return;
    }
    // Strip first, reflow, then add: the reflow between removal and
    // application restarts the keyframes so a mid-flight re-switch
    // re-glides instead of freezing mid-travel.
    try {
      for (const t of eligible) {
        try {
          t.classList.remove(cls);
        } catch (e) {}
        try {
          t.classList.remove(other);
        } catch (e) {}
      }
    } catch (e) {}
    try {
      const tc = gBrowser && gBrowser.tabContainer;
      if (tc) {
        void tc.offsetWidth;
      }
    } catch (e) {}
    let animated = null;
    try {
      for (const t of eligible) {
        try {
          t.classList.add(cls);
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
              t.classList.remove(cls);
            } catch (e) {}
            try {
              t.classList.remove(other);
            } catch (e) {}
          }
        } catch (e) {}
      }, APH_WS_ENTER_CLEANUP_MS);
    } catch (e) {}
  }

  // Rim bloom (§24): a fixed overlay flashing the destination accent
  // at the card edge. The overlay is a plain div under
  // documentElement, rect-locked to #tabbrowser-tabbox on every strike
  // — fixed positioning (never a tabbox child) so the card's
  // overflow:clip never eats the plume and no containing-block surgery
  // touches findbar geometry. Painted once per strike (the glow is
  // baked box-shadow reading live --aph-ws-accent, already flipped to
  // the destination in begin); only opacity animates, so the compositor
  // owns the whole 140ms. No cleanup timer: the keyframes land back at
  // opacity 0 with no fill mode, and the next strike retriggers via
  // remove → reflow → add. Skipped in DOM fullscreen (no card frame
  // there) and under prefers-reduced-motion. Visual only — sync tests
  // observe nothing (their document stub returns null here).
  function ensureBloomLayer() {
    try {
      const doc = typeof document !== "undefined" ? document : null;
      if (!doc) {
        return null;
      }
      let layer = null;
      try {
        layer =
          typeof doc.getElementById === "function"
            ? doc.getElementById(APH_WS_BLOOM_ID)
            : null;
      } catch (e) {
        layer = null;
      }
      if (layer) {
        return layer;
      }
      if (typeof doc.createElement !== "function") {
        return null;
      }
      layer = doc.createElement("div");
      if (!layer) {
        return null;
      }
      try {
        layer.id = APH_WS_BLOOM_ID;
      } catch (e) {}
      try {
        const root = doc.documentElement;
        if (root && typeof root.appendChild === "function") {
          root.appendChild(layer);
          return layer;
        }
      } catch (e) {}
      return null;
    } catch (e) {
      return null;
    }
  }
  function strikeBloom() {
    try {
      if (
        typeof window.matchMedia === "function" &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches
      ) {
        return;
      }
    } catch (e) {}
    try {
      const root = document && document.documentElement;
      if (
        root &&
        typeof root.hasAttribute === "function" &&
        root.hasAttribute("inDOMFullscreen")
      ) {
        return;
      }
    } catch (e) {}
    let box = null;
    try {
      box = document.getElementById("tabbrowser-tabbox");
    } catch (e) {}
    if (!box || typeof box.getBoundingClientRect !== "function") {
      return;
    }
    let r = null;
    try {
      r = box.getBoundingClientRect();
    } catch (e) {}
    if (!r || !r.width || !r.height) {
      return;
    }
    const layer = ensureBloomLayer();
    if (!layer || !layer.style || !layer.classList) {
      return;
    }
    try {
      layer.style.left = `${r.left}px`;
      layer.style.top = `${r.top}px`;
      layer.style.width = `${r.width}px`;
      layer.style.height = `${r.height}px`;
    } catch (e) {
      return;
    }
    try {
      const cs =
        typeof window.getComputedStyle === "function"
          ? window.getComputedStyle(box)
          : null;
      const radius = cs && cs.borderRadius ? cs.borderRadius : "14px";
      layer.style.borderRadius = radius;
    } catch (e) {}
    try {
      layer.classList.remove("on");
    } catch (e) {}
    try {
      void layer.offsetWidth;
    } catch (e) {}
    try {
      layer.classList.add("on");
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
  // (:root[data-aph-ws="N"] -> --aph-ws-accent, §20). Per-WS accent
  // override (32) rides alongside as data-aph-accent="M" (absent =
  // follow workspace). try/catch like the tabContainer stamp — paint
  // must never break a switch.
  function stampWindowWs(target) {
    try {
      document.documentElement.setAttribute("data-aph-ws", target);
    } catch (e) {}
    try {
      let hue = "";
      try {
        hue = typeof getWsAccent === "function" ? getWsAccent(target) : "";
      } catch (e) {}
      if (
        hue &&
        (typeof isHueId === "function"
          ? isHueId(hue)
          : (typeof isValidId === "function" && isValidId(hue)))
      ) {
        document.documentElement.setAttribute("data-aph-accent", hue);
      } else if (document.documentElement.removeAttribute) {
        document.documentElement.removeAttribute("data-aph-accent");
      }
    } catch (e) {}
  }

  // Commit this window's claim first: current + WIN_KEY + indicator. The
  // adopted-tab handler stamps arrivals to `current`, so the claim must
  // precede any pull — otherwise pulled tabs land in the old workspace.
  function beginWorkspaceSwitch(target) {
    if (!isValidId(target) || target === current) {
      return;
    }
    // Splits are session-scoped: dissolve first so a tab hidden by the
    // switch below can never keep painting inside the content card.
    // Both tabs stay open, each tagged to its own workspace.
    try {
      if (typeof dissolveSplitsForSwitch === "function") {
        dissolveSplitsForSwitch();
      }
    } catch (e) {}
    let tabs = [];
    try {
      tabs = Array.from(gBrowser.tabs);
    } catch (e) {}
    rememberCurrent(tabs);
    lastUsed = current;
    // Glide direction for finishWorkspaceSwitch: ascending rises from
    // below, descending sinks from above. Captured before the flip —
    // every entry path (switchTo, switchLocal, cycle, dock, palette,
    // startup) funnels through here.
    try {
      switchDir = Number(target) > Number(current) ? 1 : -1;
    } catch (e) {
      switchDir = 1;
    }
    try {
      lastSwitchInfo = { from: current, to: target, dir: switchDir, at: Date.now() };
    } catch (e) {}
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
    strikeBloom();
    pruneExtraNewTabs(target);
    // Fresh snapshot: reconcile may have opened a tab for an empty
    // workspace, which the stale list above would miss.
    try {
      animateIncomingTabs(Array.from(gBrowser.tabs), switchDir);
    } catch (e) {}
    // Pinned tabs match the viewed workspace (not their dormant tag), so
    // every switch re-syncs markers; unpinned matches are tag-stable and
    // the pass is a cheap no-op for them.
    try {
      if (typeof syncAllTabChrome === "function") {
        syncAllTabChrome();
      }
    } catch (e) {}
    // Deferred settle sweep so the switch stays snappy: each switch
    // (re-)arms a 15 s timer there (same shape as auto-stash below), so
    // the sweep fires only once you've sat still. Guards re-check at fire
    // time. Scope "auto" (staleness covers hidden and idle-current tabs);
    // no other auto path exists: every automatic unload in this bundle
    // flows through scheduleUnloadSweep.
    try {
      scheduleUnloadSweep();
    } catch (e) {}
    // Auto-stash (opt-in pref, default off — stash.js owns the pref
    // read, eligibility and timing): each switch (re-)arms a 15 s settle
    // timer there, so the sweep fires only once you've sat still; V1 has
    // no staleness threshold and every eligible hidden-workspace tab goes.
    try {
      const arc = window.AphStash;
      if (arc && typeof arc.scheduleAutoStashSweep === "function") {
        arc.scheduleAutoStashSweep();
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
      // Nowhere to go — pulse instead of dying silent (every other
      // Aph no-op signals; a dead gesture reads as broken input).
      try {
        pulseWorkspaceIndicator();
      } catch (e) {}
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

