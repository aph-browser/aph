  // Exclusive workspaces (tiling-WM model): a workspace renders in at most
  // one window at a time. Tabs carry the global tag (aphWs); each window
  // owns exactly one active workspace (WIN_KEY). Switching to a dormant
  // workspace pulls its tabs here via gBrowser.adoptTab (no reload);
  // switching to a workspace live elsewhere focus-jumps (no steal in V1).
  // Remote-pill state is derived live per render — never cached.
  const WS_SWITCH_TOPIC = "aph-workspace-switched";

  function aphWinId() {
    try {
      if (!window.__aphWinId) {
        window.__aphWinId =
          Math.random().toString(36).slice(2) + Date.now().toString(36);
      }
      return window.__aphWinId;
    } catch (e) {
      return "win";
    }
  }

  // Private windows never join the pool (no own, no pull, no merge).
  function aphIsPrivateWindow(win) {
    try {
      const target = win || window;
      const pbu = target.PrivateBrowsingUtils || window.PrivateBrowsingUtils;
      if (pbu && typeof pbu.isWindowPrivate === "function") {
        return !!pbu.isWindowPrivate(target);
      }
    } catch (e) {}
    return false;
  }

  function listAphWindows() {
    const out = [];
    try {
      if (typeof Services === "undefined" || !Services.wm) {
        return [window];
      }
      const en = Services.wm.getEnumerator("navigator:browser");
      while (en && typeof en.hasMoreElements === "function" && en.hasMoreElements()) {
        let w = null;
        try {
          w = en.getNext();
        } catch (e) {}
        try {
          if (w && !w.closed && w.gBrowser) {
            out.push(w);
          }
        } catch (e) {}
      }
    } catch (e) {}
    try {
      if (!out.includes(window)) {
        out.push(window);
      }
    } catch (e) {}
    return out;
  }

  // Live ownership registry: a direct expando on the chrome window is the
  // primary store — synchronous, no SessionStore tracking dependency, and
  // readable from any same-privilege window the moment it is set. (Session
  // window values throw "Window is not tracked" outside tracking and every
  // failure degrades silently to "no owner": no focus-jump, pulls instead.
  // The expando cannot fail that way.) SessionStore remains as persistence
  // + restore fallback (extData survives restarts; expandos don't).
  function setWindowWs(target) {
    if (!isValidId(target)) {
      return;
    }
    try {
      window.__aphWsCurrent = target;
    } catch (e) {}
    try {
      SessionStore.setCustomWindowValue(window, WIN_KEY, target);
    } catch (e) {}
  }

  function getWindowWs(win) {
    try {
      const live = win && win.__aphWsCurrent;
      if (isValidId(live)) {
        return live;
      }
    } catch (e) {}
    try {
      const v = SessionStore.getCustomWindowValue(win, WIN_KEY);
      return isValidId(v) ? v : null;
    } catch (e) {
      return null;
    }
  }

  // Owner of `target` among other windows, or null when dormant.
  // Private windows are invisible to the pool on both sides, unless
  // `includePrivate` (used only to refuse boundary crossings explicitly —
  // never to move tabs across them).
  function findWsOwner(target, includePrivate) {
    if (!isValidId(target)) {
      return null;
    }
    let skipPrivate = !includePrivate;
    try {
      if (skipPrivate && aphIsPrivateWindow(window)) {
        return null;
      }
    } catch (e) {}
    let wins = [];
    try {
      wins = listAphWindows();
    } catch (e) {
      return null;
    }
    for (const w of wins) {
      try {
        if (!w || w === window || w.closed) {
          continue;
        }
        if (skipPrivate && aphIsPrivateWindow(w)) {
          continue;
        }
        if (getWindowWs(w) === target) {
          return w;
        }
      } catch (e) {}
    }
    return null;
  }

  function isWsOwnedElsewhere(target) {
    try {
      return !!findWsOwner(target);
    } catch (e) {
      return false;
    }
  }

  // Workspaces live elsewhere right now: {wsId: true}. Derived per call.
  function getRemoteOwners() {
    const out = Object.create(null);
    try {
      if (aphIsPrivateWindow(window)) {
        return out;
      }
    } catch (e) {}
    let wins = [];
    try {
      wins = listAphWindows();
    } catch (e) {
      return out;
    }
    for (const w of wins) {
      try {
        if (!w || w === window || w.closed) {
          continue;
        }
        if (aphIsPrivateWindow(w)) {
          continue;
        }
        const ws = getWindowWs(w);
        if (isValidId(ws)) {
          out[ws] = true;
        }
      } catch (e) {}
    }
    return out;
  }

  // Bring the owning window forward. focus() alone is a hint some window
  // managers ignore while a same-app window holds focus, so release first
  // (blur), unminimize when the platform exposes it, then focus — the same
  // primitive stock switch-to-tab uses, just given every chance. Returns
  // whether focus was requested (the compositor still has final say).
  function focusWsOwner(ownerWin) {
    try {
      if (!ownerWin || ownerWin.closed) {
        return false;
      }
      try {
        if (ownerWin !== window && typeof window.blur === "function") {
          window.blur();
        }
      } catch (e) {}
      try {
        if (
          typeof ownerWin.restore === "function" &&
          typeof ownerWin.windowState === "number" &&
          typeof ownerWin.STATE_MINIMIZED === "number" &&
          ownerWin.windowState === ownerWin.STATE_MINIMIZED
        ) {
          ownerWin.restore();
        }
      } catch (e) {}
      if (typeof ownerWin.focus === "function") {
        ownerWin.focus();
        return true;
      }
    } catch (e) {}
    return false;
  }

  function readRemoteTabWs(tab) {
    try {
      const v = SessionStore.getCustomTabValue(tab, KEY);
      return isValidId(v) ? v : null;
    } catch (e) {
      return null;
    }
  }

  // Adoption-ghost scrub: closing a tab by adoption records it in the
  // source window's closed-tab list (SessionStore has no adoption
  // exemption), so Ctrl+Shift+T would resurrect a duplicate of the live
  // adopted tab. Immediately after a successful adoption, forget the
  // freshest closed entry — synchronous, so nothing else can interleave.
  // Only for tabs SessionStore would actually record (real, non-internal
  // URLs — blank/newtab closes record nothing, and scrubbing then would
  // eat the user's genuine undo entry). Throws are stop-signals, never
  // retried: an untracked window or empty list means no ghost exists.
  function scrubAdoptionGhost(ownerWin, oldTab) {
    try {
      if (!ownerWin || !oldTab) {
        return;
      }
      try {
        const spec = tabSpec(oldTab);
        if (!spec || isInternalSpec(spec)) {
          return;
        }
      } catch (e) {
        return;
      }
      if (
        !SessionStore ||
        typeof SessionStore.forgetClosedTab !== "function"
      ) {
        return;
      }
      SessionStore.forgetClosedTab(ownerWin, 0);
    } catch (e) {}
  }

  function findTabOwnerWindow(tab) {
    try {
      if (!tab) {
        return null;
      }
      for (const w of listAphWindows()) {
        try {
          if (w && !w.closed && w.gBrowser && w.gBrowser.tabs && w.gBrowser.tabs.includes(tab)) {
            return w;
          }
        } catch (e) {}
      }
    } catch (e) {}
    return null;
  }

  // Adoption swaps in a NEW tab element in the destination
  // (Tabbrowser.sys.mjs: adoptTab(aTab, {tabIndex, selectTab}) fires
  // TabOpen with detail.adoptedTab there and closes the source tab).
  // Returns the new tab, or null. Callers must work with the returned
  // element — never the (now closed) source.
  function adoptOneTab(tab, destBrowser) {
    try {
      if (!tab || tab.closing || tab.pinned) {
        return null;
      }
      const gb = destBrowser || gBrowser;
      if (!gb || typeof gb.adoptTab !== "function") {
        return null;
      }
      let ownerWin = null;
      try {
        ownerWin = findTabOwnerWindow(tab);
      } catch (e) {}
      let index = 0;
      try {
        index = (gb.tabs && gb.tabs.length) || 0;
      } catch (e) {}
      let nt = null;
      try {
        nt = gb.adoptTab(tab, { tabIndex: index }) || null;
      } catch (e) {}
      if (!nt) {
        try {
          nt = gb.adoptTab(tab) || null;
        } catch (_e) {}
      }
      if (nt && ownerWin) {
        scrubAdoptionGhost(ownerWin, tab);
      }
      return nt;
    } catch (e) {
      return null;
    }
  }

  // Adopt one whole source group with membership intact. Native path first
  // (adoptTabGroup preserves id/label/color, like group-header drags);
  // fallback adopts members adjacently and rebuilds the group. Registers
  // every old->new pair in `link` for workspace adopt/tag relinking. Returns moved count.
  function pullWholeGroup(group, members, target, link) {
    let label = "";
    let color = "";
    let collapsed = false;
    try {
      label = group.label || "";
    } catch (e) {}
    try {
      color = group.color || "";
    } catch (e) {}
    try {
      collapsed = !!group.collapsed;
    } catch (e) {}
    // Source window resolved BEFORE adoption (members live here after).
    let srcWin = null;
    try {
      srcWin =
        members.length && typeof findTabOwnerWindow === "function"
          ? findTabOwnerWindow(members[0])
          : null;
    } catch (e) {}
    const finishOne = (oldT, nt) => {
      if (!nt) {
        return false;
      }
      try {
        link.set(oldT, nt);
      } catch (e) {}
      try {
        setWs(nt, target);
      } catch (e) {}
      try {
        if (typeof syncTabChrome === "function") {
          syncTabChrome(nt);
        }
      } catch (e) {}
      return true;
    };
    // Native path.
    try {
      if (typeof gBrowser.adoptTabGroup === "function") {
        let idx = 0;
        try {
          idx = (gBrowser.tabs && gBrowser.tabs.length) || 0;
        } catch (e) {}
        const ng = gBrowser.adoptTabGroup(group, { tabIndex: idx });
        if (ng) {
          let news = [];
          try {
            news = Array.from(ng.tabs || []);
          } catch (e) {}
          // Order-preserving adoption: pair by position. On mismatch pair
          // what we can; unmapped arrivals keep the handler's (correct-by-
          // claim-order) tag as plain tagged tabs.
          const n = Math.min(members.length, news.length);
          let ok = 0;
          for (let i = 0; i < n; i++) {
            try {
              if (finishOne(members[i], news[i])) {
                ok++;
              }
            } catch (e) {}
          }
          try {
            if (collapsed && !ng.collapsed) {
              ng.collapsed = true;
            }
          } catch (e) {}
          // Scrub adoption ghosts for mapped members: undo must not
          // resurrect moved tabs as duplicates.
          try {
            if (ok > 0 && srcWin && typeof scrubAdoptionGhost === "function") {
              for (let i = 0; i < n; i++) {
                try {
                  if (link && typeof link.has === "function" && link.has(members[i])) {
                    scrubAdoptionGhost(srcWin, members[i]);
                  }
                } catch (e) {}
              }
            }
          } catch (e) {}
          return ok;
        }
      }
    } catch (e) {}
    // Rebuild path: adjacent adoption, then regroup with copied chrome.
    const news = [];
    for (const m of members) {
      try {
        const nt = adoptOneTab(m);
        if (nt && link) {
          try {
            link.set(m, nt);
          } catch (e) {}
        }
        if (nt) {
          try {
            setWs(nt, target);
          } catch (e) {}
          try {
            if (typeof syncTabChrome === "function") {
              syncTabChrome(nt);
            }
          } catch (e) {}
          news.push(nt);
        }
      } catch (e) {}
    }
    // Regroup only when the whole unit survived (partial arrivals stay flat
    // — same rule as partial sends ejecting).
    if (news.length === members.length && news.length > 0) {
      try {
        if (typeof gBrowser.addTabGroup === "function") {
          const ng = gBrowser.addTabGroup(news, { label, color });
          if (ng && collapsed) {
            try {
              ng.collapsed = true;
            } catch (e) {}
          }
        }
      } catch (e) {}
    }
    return news.length;
  }

  // Pull every unpinned tab tagged `target` from all other windows here.
  // Groups move as units (membership/label/color/collapse preserved);
  // tabs keep workspace tags; no relinking. The
  // destination's adopted-tab handler stamps arrivals to its current
  // workspace (drag-drop semantics), so the tag is set explicitly on the
  // RETURNED tab afterwards — never trust the stamp. Visibility settles in
  // finishWorkspaceSwitch's reconcile. Returns the adopted count.
  function pullDormantTabs(target) {
    if (!isValidId(target)) {
      return 0;
    }
    try {
      if (aphIsPrivateWindow(window)) {
        return 0;
      }
    } catch (e) {}
    let wins = [];
    try {
      wins = listAphWindows();
    } catch (e) {
      return 0;
    }
    // Snapshot candidates per source window before adoption mutates strips.
    const jobs = [];
    for (const w of wins) {
      try {
        if (!w || w === window || w.closed || !w.gBrowser) {
          continue;
        }
        if (aphIsPrivateWindow(w)) {
          continue;
        }
        let tabs = [];
        try {
          tabs = Array.from(w.gBrowser.tabs || []);
        } catch (e) {}
        const cands = [];
        for (const t of tabs) {
          try {
            if (!t || t.closing || t.pinned) {
              continue;
            }
            if (readRemoteTabWs(t) !== target) {
              continue;
            }
            cands.push(t);
          } catch (e) {}
        }
        if (cands.length) {
          jobs.push(cands);
        }
      } catch (e) {}
    }
    if (!jobs.length) {
      return 0;
    }
    const candSet = new Set();
    for (const cands of jobs) {
      for (const t of cands) {
        candSet.add(t);
      }
    }
    const oldToNew = new Map();
    let moved = 0;
    const adoptSingleInto = (t) => {
      try {
        const nt = adoptOneTab(t);
        if (!nt) {
          return false;
        }
        try {
          oldToNew.set(t, nt);
        } catch (e) {}
        moved++;
        try {
          setWs(nt, target);
        } catch (e) {}
        try {
          if (typeof syncTabChrome === "function") {
            syncTabChrome(nt);
          }
        } catch (e) {}
        return true;
      } catch (e) {
        return false;
      }
    };
    for (const cands of jobs) {
      // Source strip order: a whole group moves when its first member is
      // reached (Aph groups are single-workspace, so whole-group is the
      // norm); partial groups fall through to single adoption and land
      // flat — the healing case. Order preservation keeps focus + strip
      // position stable across the move.
      const done = new Set();
      for (const t of cands) {
        try {
          if (!t || done.has(t)) {
            continue;
          }
          let g = null;
          try {
            g = t.group || null;
          } catch (e) {}
          if (g) {
            let members = [];
            try {
              members =
                typeof groupMembers === "function"
                  ? groupMembers(g).filter((x) => !x.pinned)
                  : [];
            } catch (e) {}
            const whole =
              members.length > 0 &&
              members.every((x) => !x.closing && candSet.has(x));
            if (whole) {
              const n = pullWholeGroup(g, members, target, oldToNew);
              if (n > 0) {
                moved += n;
                // Only mapped members are done: refused members (source
                // tab left alive) retry below as singles.
                for (const m of members) {
                  try {
                    if (oldToNew.has(m)) {
                      done.add(m);
                    }
                  } catch (e) {}
                }
                continue;
              }
            }
          }
          if (adoptSingleInto(t)) {
            done.add(t);
          }
        } catch (e) {}
      }
    }
    return moved;
  }

  // Lowest workspace no live window owns (new-window + restore de-dupe).
  // Window claims only (WIN_KEY), never local tab tags: a fresh window has
  // no tabs yet and must land on "1" when the pool is empty.
  function lowestUnownedWorkspace() {
    try {
      const owned = new Set();
      if (!aphIsPrivateWindow(window)) {
        for (const w of listAphWindows()) {
          try {
            if (!w || w.closed || aphIsPrivateWindow(w)) {
              continue;
            }
            const ws = w === window ? null : getWindowWs(w);
            if (isValidId(ws)) {
              owned.add(ws);
            }
          } catch (e) {}
        }
      }
      for (let i = 1; i <= 9; i++) {
        const id = String(i);
        if (!owned.has(id)) {
          return id;
        }
      }
    } catch (e) {}
    return null;
  }

  // Browser-Console diagnosis (Ctrl+Shift+J):
  //   Services.wm.getMostRecentWindow("navigator:browser").AphWorkspaces.debugExclusive()
  // Shows this window's claim and every live window's workspace, so a
  // "focus never fires" report can distinguish registry failure (owner
  // missing/wrong here) from a platform focus refusal (owner correct).
  function debugExclusive() {
    const out = { winId: null, current: null, windows: [], remote: [] };
    try {
      out.winId = aphWinId();
    } catch (e) {}
    try {
      out.current = isValidId(current) ? current : null;
    } catch (e) {}
    try {
      for (const w of listAphWindows()) {
        try {
          out.windows.push({
            ws: getWindowWs(w),
            self: w === window,
            closed: !!w.closed,
          });
        } catch (e) {}
      }
    } catch (e) {}
    try {
      out.remote = Object.keys(getRemoteOwners()).sort();
    } catch (e) {}
    return out;
  }

  // Session forensics (Browser Console, Ctrl+Shift+J):
  //   Services.wm.getMostRecentWindow("navigator:browser").AphWorkspaces.debugSession()
  // Run BEFORE closing windows and AFTER restore, then diff: every live
  // window with its workspace claim and per-tab tag/visibility/pinned/
  // pending state. Answers "was it snapshotted?" vs "did restore drop it?".
  function debugSession() {
    const out = [];
    try {
      for (const w of listAphWindows()) {
        const rec = { ws: null, self: false, tabs: [] };
        try {
          rec.ws = getWindowWs(w);
        } catch (e) {}
        try {
          rec.self = w === window;
        } catch (e) {}
        let tabs = [];
        try {
          tabs = Array.from(w.gBrowser.tabs || []);
        } catch (e) {}
        for (const t of tabs) {
          const r = {};
          try {
            r.label = String(t.label || "").slice(0, 60);
          } catch (e) {
            r.label = "?";
          }
          try {
            r.spec = String(
              (t.linkedBrowser && t.linkedBrowser.currentURI && t.linkedBrowser.currentURI.spec) || "?"
            ).slice(0, 80);
          } catch (e) {
            r.spec = "?";
          }
          try {
            r.ws = readRemoteTabWs(t);
          } catch (e) {
            r.ws = null;
          }
          for (const k of ["hidden", "pinned", "selected", "closing"]) {
            try {
              r[k] = !!t[k];
            } catch (e) {}
          }
          try {
            r.pending = !!(t.hasAttribute && t.hasAttribute("pending"));
          } catch (e) {}
          rec.tabs.push(r);
        }
        out.push(rec);
      }
    } catch (e) {}
    return out;
  }

  // Duplicate cleanup (Browser Console recovery tool):
  //   AphWorkspaces.findDuplicateTabs() → [{ key, spec, ws, tabs: [{label, win, hidden, ...}]}]
  //   AphWorkspaces.closeDuplicateTabs({ dryRun: true }) → preview (default, closes nothing)
  //   AphWorkspaces.closeDuplicateTabs({ dryRun: false }) → close the losers
  // Pool-wide same-URL + same-workspace groups (quit-scramble artifacts from
  // builds predating the shutdown merge-skip). Keeps one per group:
  // selected > visible > loaded > first. Never touches pinned, selected,
  // visible-in-owner... precisely: never closes selected tabs, pinned tabs,
  // loading tabs, or internal about:* pages (every window legitimately has
  // its own newtab). Deliberate same-URL dupes are indistinguishable from
  // artifacts, so dry-run is the default — review before executing.
  function duplicateKey(spec, ws) {
    try {
      return `${ws}\n${String(spec || "")}`;
    } catch (e) {
      return "";
    }
  }

  function tabSpec(t) {
    try {
      const s = t && t.linkedBrowser && t.linkedBrowser.currentURI && t.linkedBrowser.currentURI.spec;
      return typeof s === "string" ? s : "";
    } catch (e) {
      return "";
    }
  }

  function isInternalSpec(spec) {
    try {
      const s = String(spec || "").toLowerCase();
      return (
        s.startsWith("about:") ||
        s.startsWith("chrome:") ||
        s.startsWith("resource:")
      );
    } catch (e) {
      return true;
    }
  }

  function collectPoolTabs() {
    const out = [];
    let selfPrivate = false;
    try {
      selfPrivate = aphIsPrivateWindow(window);
    } catch (e) {}
    let wins = [];
    try {
      wins = listAphWindows();
    } catch (e) {}
    for (const w of wins) {
      try {
        if (!w || w.closed || !w.gBrowser) {
          continue;
        }
        // Never mix the private boundary, even for reporting closures.
        try {
          if (!!aphIsPrivateWindow(w) !== !!selfPrivate) {
            continue;
          }
        } catch (e) {}
        let tabs = [];
        try {
          tabs = Array.from(w.gBrowser.tabs || []);
        } catch (e) {}
        for (const t of tabs) {
          try {
            if (!t || t.closing) {
              continue;
            }
            out.push({ win: w, tab: t });
          } catch (e) {}
        }
      } catch (e) {}
    }
    return out;
  }

  function findDuplicateTabs() {
    const groups = new Map();
    try {
      for (const { win, tab } of collectPoolTabs()) {
        try {
          if (tab.pinned) {
            continue;
          }
          const spec = tabSpec(tab);
          if (!spec || isInternalSpec(spec)) {
            continue;
          }
          const ws = readRemoteTabWs(tab);
          if (!isValidId(ws)) {
            continue;
          }
          const key = duplicateKey(spec, ws);
          if (!key) {
            continue;
          }
          if (!groups.has(key)) {
            groups.set(key, { key, spec, ws, tabs: [] });
          }
          let info = {};
          try {
            info.label = String(tab.label || "").slice(0, 60);
          } catch (e) {
            info.label = "?";
          }
          try {
            info.hidden = !!tab.hidden;
          } catch (e) {}
          try {
            info.selected =
              !!tab.selected ||
              (win.gBrowser && win.gBrowser.selectedTab === tab);
          } catch (e) {}
          try {
            info.pending = !!(tab.hasAttribute && tab.hasAttribute("pending"));
          } catch (e) {}
          try {
            info.selfWin = win === window;
          } catch (e) {}
          groups.get(key).tabs.push({ ...info, win, tab });
        } catch (e) {}
      }
    } catch (e) {}
    const out = [];
    try {
      for (const g of groups.values()) {
        if (g.tabs.length > 1) {
          // Strip live refs for console readability; keep count.
          out.push({
            key: g.key,
            spec: g.spec,
            ws: g.ws,
            count: g.tabs.length,
            tabs: g.tabs.map((t) => {
              const c = { ...t };
              delete c.win;
              delete c.tab;
              return c;
            }),
            _refs: g.tabs,
          });
        }
      }
    } catch (e) {}
    return out;
  }

  // Rank keeper first: selected, then visible, then loaded, then first seen.
  function rankDupe(t) {
    try {
      if (t.selected) {
        return 0;
      }
      if (!t.hidden) {
        return 1;
      }
      if (!t.pending) {
        return 2;
      }
      return 3;
    } catch (e) {
      return 3;
    }
  }

  function closeDuplicateTabs(opts) {
    const dryRun = !opts || opts.dryRun !== false;
    const result = { dryRun, closed: 0, doomed: [], groups: 0 };
    try {
      const groups = findDuplicateTabs();
      result.groups = groups.length;
      for (const g of groups) {
        try {
          const ranked = (g._refs || []).slice().sort((a, b) => rankDupe(a) - rankDupe(b));
          // Keeper (ranked first) always survives. Only hidden + unselected
          // copies are eligible: a visible copy is some window's live strip
          // (hands off — findDuplicateTabs still reports the group for
          // manual handling).
          for (const loser of ranked.slice(1)) {
            try {
              const eligible = !!loser.hidden && !loser.selected;
              if (!eligible) {
                continue;
              }
              const entry = {
                label: loser.label || "?",
                spec: g.spec,
                ws: g.ws,
                selfWin: !!loser.selfWin,
              };
              result.doomed.push(entry);
              if (!dryRun) {
                try {
                  if (loser.win && !loser.win.closed && loser.win.gBrowser) {
                    loser.win.gBrowser.removeTab(loser.tab);
                    result.closed++;
                  }
                } catch (e) {}
              }
            } catch (e) {}
          }
        } catch (e) {}
      }
    } catch (e) {}
    try {
      if (!dryRun && typeof renderDock === "function") {
        renderDock();
      }
    } catch (e) {}
    return result;
  }

  function broadcastWsSwitch(wsId) {
    try {
      if (typeof Services === "undefined" || !Services.obs) {
        return;
      }
      if (typeof Services.obs.notifyObservers !== "function") {
        return;
      }
      Services.obs.notifyObservers(
        null,
        WS_SWITCH_TOPIC,
        JSON.stringify({ winId: aphWinId(), ws: wsId })
      );
    } catch (e) {}
  }

  function handleWsSwitchPayload(data) {
    try {
      const msg = JSON.parse(String(data || ""));
      if (msg && msg.winId && msg.winId === aphWinId()) {
        return;
      }
    } catch (e) {}
    try {
      updateIndicator();
    } catch (e) {
      try {
        renderDock();
      } catch (_e) {}
    }
  }

  let wsSwitchObserver = null;

  // Quit guard: during application shutdown every window unloads, so there
  // is no survivor — merging would shuffle tabs among dying windows and
  // the shutdown snapshot would restore the scrambled arrangement next
  // launch. quit-application-granted fires before any unload (cancel
  // precedes it), so the flag is settled by merge time.
  let aphQuitGranted = false;
  let quitFlagObserver = null;

  function initQuitFlag() {
    try {
      if (quitFlagObserver) {
        return;
      }
      if (typeof Services === "undefined" || !Services.obs) {
        return;
      }
      if (typeof Services.obs.addObserver !== "function") {
        return;
      }
      quitFlagObserver = {
        observe(_subject, topic) {
          try {
            if (topic === "quit-application-granted" || topic === "quit-application") {
              aphQuitGranted = true;
            }
          } catch (e) {}
        },
      };
      try {
        Services.obs.addObserver(quitFlagObserver, "quit-application-granted", false);
      } catch (e) {}
      try {
        Services.obs.addObserver(quitFlagObserver, "quit-application", false);
      } catch (e) {}
    } catch (e) {
      quitFlagObserver = null;
    }
  }

  function cleanupQuitFlag() {
    try {
      if (quitFlagObserver && Services && Services.obs) {
        try {
          Services.obs.removeObserver(quitFlagObserver, "quit-application-granted");
        } catch (e) {}
        try {
          Services.obs.removeObserver(quitFlagObserver, "quit-application");
        } catch (e) {}
      }
    } catch (e) {}
    quitFlagObserver = null;
  }

  function initWsSwitchObserver() {
    try {
      if (wsSwitchObserver) {
        return;
      }
      if (typeof Services === "undefined" || !Services.obs) {
        return;
      }
      if (typeof Services.obs.addObserver !== "function") {
        return;
      }
      wsSwitchObserver = {
        observe(_subject, _topic, data) {
          try {
            handleWsSwitchPayload(data);
          } catch (e) {}
        },
      };
      Services.obs.addObserver(wsSwitchObserver, WS_SWITCH_TOPIC, false);
    } catch (e) {
      wsSwitchObserver = null;
    }
  }

  function cleanupWsSwitchObserver() {
    try {
      if (wsSwitchObserver && Services && Services.obs) {
        Services.obs.removeObserver(wsSwitchObserver, WS_SWITCH_TOPIC);
      }
    } catch (e) {}
    wsSwitchObserver = null;
  }

  // Merge-back: a closing window must never destroy a workspace. Adopt all
  // unpinned tabs into the first surviving window; pins die with the window
  // (stock semantics — avoids duplicate pin strips in the survivor).
  // Survivor hides non-matching tabs best-effort; its next switchTo heals
  // the rest. Never crosses the private boundary; never runs at shutdown
  // (quit shuffle would corrupt the session snapshot).
  function mergeTabsIntoSurvivor() {
    try {
      // Shutdown: no survivor lives on; moving tabs now only scrambles
      // the session snapshot. SessionStore records each dying window
      // as-is, which is exactly what restore needs.
      try {
        if (aphQuitGranted) {
          return { merged: 0, reason: "shutdown" };
        }
      } catch (e) {}
      const selfPrivate = aphIsPrivateWindow(window);
      let survivor = null;
      for (const w of listAphWindows()) {
        try {
          if (!w || w === window || w.closed || !w.gBrowser) {
            continue;
          }
          if (!!aphIsPrivateWindow(w) !== !!selfPrivate) {
            continue;
          }
          survivor = w;
          break;
        } catch (e) {}
      }
      if (!survivor) {
        return { merged: 0, reason: "no-survivor" };
      }
      let doomed = [];
      try {
        doomed = Array.from(gBrowser.tabs || []).filter(
          (t) => t && !t.closing && !t.pinned
        );
      } catch (e) {
        return { merged: 0, reason: "no-tabs" };
      }
      if (!doomed.length) {
        return { merged: 0 };
      }
      let survivorWs = null;
      try {
        survivorWs = getWindowWs(survivor);
      } catch (e) {}
      let merged = 0;
      for (const t of doomed.slice()) {
        try {
          if (!t || t.closing || t.pinned) {
            continue;
          }
          // Snapshot first: adoption closes the source element.
          let tag = null;
          try {
            tag = readRemoteTabWs(t);
          } catch (e) {}
          const nt = adoptOneTab(t, survivor.gBrowser);
          if (!nt) {
            continue;
          }
          merged++;
          // Re-assert the tag: the survivor's adopted-tab handler stamps
          // arrivals to ITS current workspace — that would scramble every
          // foreign workspace into one.
          try {
            if (isValidId(tag)) {
              setWs(nt, tag);
            }
          } catch (e) {}
          try {
            if (survivorWs && tag !== survivorWs) {
              nt.setAttribute("hidden", "true");
            }
          } catch (e) {}
        } catch (e) {}
      }
      try {
        if (survivor.gBrowser && survivor.gBrowser.tabContainer &&
            typeof survivor.gBrowser.tabContainer._invalidateCachedVisibleTabs === "function") {
          survivor.gBrowser.tabContainer._invalidateCachedVisibleTabs();
        }
      } catch (e) {}
      try {
        if (survivor.AphWorkspaces && typeof survivor.AphWorkspaces.renderDock === "function") {
          survivor.AphWorkspaces.renderDock();
        }
      } catch (e) {}
      return { merged };
    } catch (e) {
      return { merged: 0, reason: "error" };
    }
  }
