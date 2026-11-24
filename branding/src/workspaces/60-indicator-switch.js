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

  // Switch flash timer (200ms): stamps data-aph-ws-pulse on the tab
  // container so a failed or empty switch still signals instead of
  // dying silent. (It used to flash the top pill too — pill gone, the
  // container stamp plus the bloom carry the signal now.)
  let wsPulseTimer = null;
  // Handles for process-global registrations owned by this window. Prefs /
  // progress / obs observers are held strongly by their service, so each
  // must be released on unload or the closed window (document, gBrowser,
  // tabs) leaks via the observer closure until process exit.
  let bindingObserver = null;
  let routeObserver = null;
  let nameObserver = null;
  let wsIconObserver = null;
  let wsAccentObserver = null;
  let startupRestoreObserver = null;
  // Original window.BrowserOpenTab, captured before initBoundNewTab wraps
  // it so + button / menu births land in the bound container. Restored on
  // unload (cleanupWindowObservers).
  let origBrowserOpenTab = null;
  function pulseWorkspaceIndicator() {
    try {
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
      if (wsPulseTimer) {
        clearTimeout(wsPulseTimer);
      }
      // Short presence flash: clears well inside the bloom decay.
      wsPulseTimer = setTimeout(() => {
        try {
          el.removeAttribute("data-aph-ws-pulse");
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
  // global (never change) so they are excluded. The strip's OWN reveal is
  // the third signal: it lands instantly instead of scrolling the crowded
  // list under the eye (revealSelectionInstant below), so nothing reads
  // as the switch "still going". Fail-silent throughout (test tabs have
  // no classList, which just no-ops; test documents return null for the
  // card, also a no-op).
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
    if (!eligible || eligible.length > 40) {
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

  // Instant strip reveal: stock brings the newly selected tab into view
  // through the strip's own smooth scroll. Native TabSelect calls the tab
  // container's _handleTabSelect() with no instant flag, and the
  // arrowscrollbox's shadow scrollbox carries `scroll-behavior: smooth`
  // (the `smoothscroll` attribute it inherits from pref
  // toolkit.scrollbox.smoothScroll, default on), so the reveal animates.
  // Stock never notices: a click lands on a visible tab, and Ctrl+Tab
  // walks neighbours. A workspace switch moves the selection across the
  // whole strip in one synchronous commit, so on a crowded strip that
  // glide scrolls the entire list under the eye — the one switch signal
  // that is loud and long beside the 120ms glide + bloom. Wherever Aph
  // moves the selection itself, it re-aims the reveal as instant: the
  // native entry lands in the same pending-rAF slot the TabSelect reveal
  // used, so that frame is cancelled and replaced, never raced (the frame
  // itself keeps the scroll out of the hidden-swap layout pass).
  // Fail-silent: suites that stub none of these paths just no-op, and the
  // two fallbacks only exist for internals renamed upstream.
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
      // No scrollbox API at all: a plain element reveal, and only then —
      // a strip that is merely idle must not scroll (native scrolls on
      // overflow alone).
      if (!box && sel && typeof sel.scrollIntoView === "function") {
        sel.scrollIntoView({ block: "nearest", behavior: "instant" });
      }
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
    // The commit is synchronous everywhere else, so the arrival lands on
    // the strip instead of gliding to it.
    revealSelectionInstant();
    strikeBloom();
    // Fresh snapshot: reconcile may have opened a tab for an empty
    // workspace, which the stale list above would miss.
    try {
      animateIncomingTabs(Array.from(gBrowser.tabs), switchDir);
    } catch (e) {}
    // Pinned tabs match the viewed workspace (not their dormant tag), so
    // every switch re-syncs markers; unpinned matches are tag-stable and
    // the pass is a cheap no-op for them.
    try {
      for (const t of tabs) {
        if (t && t.pinned && typeof syncTabChrome === "function") {
          syncTabChrome(t);
        }
      }
    } catch (e) {}
    // Deferred settle sweep so the switch stays snappy: each switch
    // (re-)arms a 15 s timer there, so the sweep fires only once
    // you've sat still. Guards re-check at fire time. Scope "auto"
    // (staleness covers hidden and idle-current tabs); no other auto path
    // exists: every automatic unload in this bundle flows through
    // scheduleUnloadSweep.
    try {
      scheduleUnloadSweep();
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
    const step = dir === -1 ? -1 : 1;
    let now = 0;
    try {
      now = Date.now();
    } catch (e) {}
    let sel = null;
    try {
      sel = (typeof gBrowser !== "undefined" && gBrowser.selectedTab) || null;
    } catch (e) {}
    const live = liveTabsForWalk();
    if (live.length < 2) {
      try {
        pulseWorkspaceIndicator();
      } catch (e) {}
      return;
    }
    const liveSet = new Set(live);
    let order = tabWalkOrder;
    let useSnapshot = false;
    try {
      useSnapshot =
        Array.isArray(order) &&
        order.length === live.length &&
        now - tabWalkAt < TAB_WALK_MS &&
        order.every((t) => liveSet.has(t));
    } catch (e) {
      useSnapshot = false;
    }
    if (!useSnapshot) {
      try {
        order = getTabWalkOrder();
      } catch (e) {
        order = [];
      }
      if (!Array.isArray(order) || order.length < 2) {
        try {
          pulseWorkspaceIndicator();
        } catch (e) {}
        return;
      }
      tabWalkOrder = order;
      tabWalkIndex = 0;
      try {
        tabWalkAt = now;
      } catch (e) {}
    } else {
      // Continuing a walk: advance from where the selection is. An
      // explicit click since the last walk moves the base (no trap).
      let base = tabWalkIndex;
      try {
        const cur = order.indexOf(sel);
        if (cur >= 0) {
          base = cur;
        }
      } catch (e) {}
      tabWalkIndex = base;
    }
    let idx = tabWalkIndex;
    try {
      const cur = order.indexOf(sel);
      if (cur >= 0) {
        idx = cur;
      }
    } catch (e) {}
    let target = null;
    try {
      target = order[(idx + step + order.length) % order.length];
    } catch (e) {
      target = null;
    }
    if (!target || target === sel) {
      return;
    }
    try {
      tabWalkIndex = (idx + step + order.length) % order.length;
    } catch (e) {}
    try {
      tabWalkAt = now;
    } catch (e) {}
    selectTabWalkSafe(target);
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
  // Pinned tabs belong to workspaces: sent pins hide until that workspace is
  // viewed. Sent tabs keep their containers (containers are immutable per
  // tab), and position; bindings only affect newly opened tabs.
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

