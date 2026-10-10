  // Workspace dock: mouse-first pills pinned to the bottom of the
  // vertical tab strip. Mounts under #vertical-tabs (or the sidebar
  // container fallback) and settles at the strip bottom via flex. The
  // dock is the workspace readout now (the old nav-bar pill is gone):
  // active workspaces + current + a "+" jump-to-next-empty pill, with container underlines, drag-and-
  // drop retagging, and a right-click menu (rename / icon / accent /
  // bind / unload / close). Accent overrides persist in
  // aph.workspaces.accents; everything else reuses tags, names and
  // bindings. Pills are native <button>s (platform keyboard + screen
  // reader support, index/icon glyph only — tab counts live in
  // tooltips/titles and the palette, never as badge chrome) with the
  // Aph key inline beside them opening the single merged Aph menu. Horizontal-tabs mode has
  // no strip: the nav-bar switcher (#aph-ws-nav-switcher) is the
  // readout there — exactly one readout at a time.
  // Anchor: #vertical-tabs (light-DOM box projected into sidebar-main's
  // tabstrip slot, above the tools area). Horizontal-tabs mode leaves
  // #sidebar-container hidden, so the dock skips itself (horizontal
  // mode has no strip readout). Everything fails silent (house
  // style) so a missing anchor never breaks chrome.
  const DOCK_ID = "aph-ws-dock";
  const DOCK_MENU_ID = "aph-ws-dock-menu";
  // Accent hue names for the dock Accent submenu + settings picker.
  // Full 16-stop scale (theme.css §21). Default nine are the deep→bright
  // ramp (1 Indigo → 9 Violet); Ruby/Green/Purple/Pink/Plum/Slate/Tomato
  // are accent-only extras. Labels only — the CSS owns the hexes.
  const WS_ACCENT_NAMES = {
    1: "Indigo",
    2: "Blue",
    3: "Cyan",
    4: "Jade",
    5: "Grass",
    6: "Amber",
    7: "Orange",
    8: "Crimson",
    9: "Violet",
    10: "Tomato",
    11: "Ruby",
    12: "Green",
    13: "Purple",
    14: "Pink",
    15: "Plum",
    16: "Slate",
  };
  // Tab being dragged over the dock (stock tab dataTransfer carries no tab
  // ref, so track dragstart on the shared tab container instead). Group
  // headers drag the whole native group: stock strip lets a <tab-group>
  // label move all its tabs, so the dock tracks that separately.
  let dockDragTab = null;
  let dockDragGroup = null;
  // Drag-mode: while a tab/group drag is in flight the dock expands to all
  // 9 workspaces so any workspace (including empty ones) is a drop target.
  // renderDock() checks this flag; enter/exit helpers re-render. The "+" pill
  // also accepts drops (moves to the lowest inactive workspace).
  let dockDragActive = false;

  function dockTabDragType(e) {
    try {
      const dt = e && e.dataTransfer;
      if (!dt) {
        return false;
      }
      // Chrome-privileged tab-drag identity (browser.xhtml runs as chrome,
      // so moz* APIs are visible here — unlike content, where bug 1345591
      // hides them). This is the same check the strip's own
      // getDropEffectForTabDrag uses: first type must be TAB_DROP_TYPE.
      try {
        if (typeof dt.mozItemCount === "number" && dt.mozItemCount > 0 &&
            typeof dt.mozTypesAt === "function") {
          const types = dt.mozTypesAt(0) || [];
          if (types[0] === "application/x-moz-tabbrowser-tab") {
            return true;
          }
        }
      } catch (err) {}
      // Firefox tab DnD carries application/x-moz-tabbrowser-tab (nsDragService).
      // types may be a DOMStringList (contains()) or a plain array (includes()).
      try {
        if (typeof dt.contains === "function" && dt.contains("application/x-moz-tabbrowser-tab")) {
          return true;
        }
      } catch (err) {}
      try {
        const types = dt.types || [];
        for (const t of Array.from(types)) {
          if (t === "application/x-moz-tabbrowser-tab") {
            return true;
          }
        }
      } catch (err) {}
    } catch (e) {}
    return false;
  }

  function isDockDropArmed(e) {
    try {
      if (dockDragTab || dockDragGroup || dockDragActive) {
        return true;
      }
    } catch (err) {}
    try {
      return dockTabDragType(e);
    } catch (err) {
      return false;
    }
  }

  // What will a drop move? Base tabs from resolveDockDragTabs
  // (sendTabTo moves the selection). Used for drop tooltips.
  function dockDropPreview() {
    try {
      const base = resolveDockDragTabs();
      if (!base.length) {
        return { count: 0, kind: "tab" };
      }
      const wasGroup = !!dockDragGroup;
      const seen = new Set();
      for (const t of base) {
        if (t && !t.closing) {
          seen.add(t);
        }
      }
      const count = seen.size;
      let kind = base.length > 1 ? `${base.length} tabs` : "tab";
      if (wasGroup) {
        kind = `group (${count} tab${count === 1 ? "" : "s"})`;
      } else if (base.length > 1) {
        kind = `${count} tabs`;
      } else {
        kind = "tab";
      }
      return { count, kind };
    } catch (e) {
      return { count: 0, kind: "tab" };
    }
  }

  // Drag-mode layout without destruction: the old path called
  // renderDock(), which destroyed every pill mid-gesture (content +
  // listeners rebuilt while the strip's own drag session was live).
  // Instead the existing pill nodes are detached and re-appended in
  // numeric order — same objects, listeners and paint intact — missing
  // workspaces are appended as empty ghosts, and the Aph key is parked
  // (pills + plus are the only drop UI in play). The exit path
  // (onDockDragEnd → renderDock) rebuilds active-only once the drag
  // has unwound.
  function layoutDragPills() {
    try {
      let dock = null;
      try {
        dock = document.getElementById(DOCK_ID);
      } catch (e) {}
      if (!dock || typeof dock.appendChild !== "function") {
        return false;
      }
      try {
        dock.setAttribute("data-aph-dragging", "1");
      } catch (e) {}
      const cur = isValidId(current) ? current : "1";
      let counts = {};
      try {
        counts = dockCounts();
      } catch (e) {}
      const byWs = Object.create(null);
      let plusNode = null;
      try {
        for (const c of Array.from(dock.children || [])) {
          try {
            dock.removeChild(c);
          } catch (e) {
            continue;
          }
          try {
            if (
              c &&
              c.classList &&
              typeof c.classList.contains === "function" &&
              c.classList.contains("aph-ws-add")
            ) {
              if (!plusNode) {
                plusNode = c;
              }
              continue;
            }
            if (
              c &&
              c.classList &&
              typeof c.classList.contains === "function" &&
              c.classList.contains("aph-dock-aph")
            ) {
              continue;
            }
            const ws =
              c && typeof c.getAttribute === "function" ? c.getAttribute("data-ws") : null;
            if (ws && isValidId(ws) && !byWs[ws]) {
              byWs[ws] = c;
              continue;
            }
          } catch (e) {}
        }
      } catch (e) {}
      for (let i = 1; i <= 9; i++) {
        const id = String(i);
        try {
          const pill = byWs[id] || makeDockPill(id, id === cur, counts[id] || 0, true);
          if (pill) {
            dock.appendChild(pill);
          }
        } catch (e) {}
      }
      try {
        const plus = plusNode || makeDockPlus(lowestInactiveId(getActiveIds()));
        if (plus) {
          dock.appendChild(plus);
        }
      } catch (e) {}
      return true;
    } catch (e) {
      return false;
    }
  }

  function enterDockDragMode() {
    try {
      if (!dockDragActive) {
        dockDragActive = true;
        try {
          if (!layoutDragPills()) {
            renderDock();
          }
        } catch (e) {
          renderDock();
        }
      }
    } catch (e) {}
  }

  function exitDockDragMode() {
    try {
      if (dockDragActive) {
        dockDragActive = false;
        renderDock();
      }
    } catch (e) {
      try {
        dockDragActive = false;
      } catch (_e) {}
    }
  }

  // Drop-then-hide ordering: hiding the dragged tab while Firefox's own tab
  // drag session is still active leaves its strip animation (translateY
  // shoves, drop-indicator margins) stranded mid-flight — visible as
  // overlapping tabs, gaps, and tabs pushed past the new-tab button. The
  // strip's own cleanup runs on dragend (finishAnimateTabMove /
  // _resetTabsAfterDrop clear inline styles), so a drop during a live tab
  // drag is recorded here and only executed once dragend has unwound the
  // session. Non-drag callers (tests, palette, context menu) and payloads
  // without a live session keep the synchronous path.
  let dockPendingDrop = null;

  // A live Firefox tab drag parks its state on the dragged tab (_dragData,
  // set by startTabDrag, deleted on dragend). Mocks and non-tab drags never
  // carry it, so they stay synchronous (and existing tests keep passing).
  function isLiveTabDragSession(tabs) {
    try {
      for (const t of tabs || []) {
        try {
          if (t && t._dragData) {
            return true;
          }
        } catch (e) {}
      }
      for (const t of [dockDragTab]) {
        try {
          if (t && t._dragData) {
            return true;
          }
        } catch (e) {}
      }
    } catch (e) {}
    return false;
  }

  function executeDockDrop(dest, dragTabs, wasGroup) {
    try {
      if (!dragTabs || !dragTabs.length || !isValidId(dest)) {
        return false;
      }
      if (dest === current) {
        try {
          pulseWorkspaceIndicator();
        } catch (e) {}
        return false;
      }
      if (wasGroup && typeof sendGroupTo === "function") {
        sendGroupTo(dest, dragTabs);
      } else {
        sendTabTo(dest, dragTabs);
      }
      // Ingestion confirm: a 100ms micro-dip on the destination pill so
      // a drop onto an inactive workspace visibly lands. No full switch
      // — the user stays put.
      try {
        pulseDockPill(dest);
      } catch (e) {}
      return true;
    } catch (e) {
      return false;
    }
  }

  // Drop-ingestion micro-pulse: brief 2px dip on the destination pill.
  // Timer-released; a second drop while armed re-arms (same retrigger
  // idiom as the old card dip). Fail-silent: test docks without a
  // queryable container just no-op.
  let dockPulseTimer = null;
  function pulseDockPill(dest) {
    try {
      let dock = null;
      try {
        dock = document.getElementById(DOCK_ID);
      } catch (e) {}
      if (!dock) {
        return;
      }
      let pill = null;
      try {
        pill =
          typeof dock.querySelector === "function"
            ? dock.querySelector(`.aph-ws-pill[data-ws="${dest}"]`)
            : null;
      } catch (e) {
        pill = null;
      }
      // Fallback scan: test doubles stub querySelector to null, and a
      // hand-rolled lookup keeps the pulse working wherever the dock is
      // a plain children list.
      if (!pill && dock.children && typeof dock.children.length === "number") {
        try {
          for (const c of Array.from(dock.children)) {
            try {
              if (
                c &&
                typeof c.getAttribute === "function" &&
                c.getAttribute("data-ws") === dest
              ) {
                pill = c;
                break;
              }
            } catch (e) {}
          }
        } catch (e) {}
      }
      if (!pill || !pill.classList || typeof pill.classList.add !== "function") {
        return;
      }
      try {
        pill.classList.add("aph-ws-drop-pulse");
      } catch (e) {
        return;
      }
      try {
        if (dockPulseTimer) {
          clearTimeout(dockPulseTimer);
          dockPulseTimer = null;
        }
      } catch (e) {}
      try {
        dockPulseTimer = setTimeout(() => {
          dockPulseTimer = null;
          try {
            pill.classList.remove("aph-ws-drop-pulse");
          } catch (e) {}
        }, 120);
      } catch (e) {}
    } catch (e) {}
  }

  function flushDockPendingDrop() {
    let pending = null;
    try {
      pending = dockPendingDrop;
      dockPendingDrop = null;
    } catch (e) {
      pending = null;
    }
    if (!pending) {
      return false;
    }
    try {
      return executeDockDrop(pending.dest, pending.tabs, pending.wasGroup);
    } catch (e) {
      return false;
    }
  }

  function dockAnchor() {
    try {
      const sc = document.getElementById("sidebar-container");
      if (!sc || sc.hidden) {
        return null;
      }
      const box = document.getElementById("vertical-tabs");
      if (!box || box.hidden) {
        return null;
      }
      return box;
    } catch (e) {
      return null;
    }
  }

  function dockMenu() {
    try {
      const m = document.getElementById(DOCK_MENU_ID);
      return m || null;
    } catch (e) {
      return null;
    }
  }

  // Dock glyph: the workspace icon when set, else the bare number.
  // Names live in tooltips/titles and the indicator — never as pill
  // letters (first-grapheme letters read as text noise at 12px and
  // break the monochrome mark language).
  function dockGlyph(id) {
    try {
      const icon = getWsIcon(id);
      if (icon) {
        return { icon, text: "" };
      }
    } catch (e) {}
    return { icon: "", text: id };
  }

  function dockCounts() {
    const counts = Object.create(null);
    try {
      for (const t of Array.from(gBrowser.tabs || [])) {
        try {
          if (!t || t.closing || t.pinned) {
            continue;
          }
          // Restoring or not-yet-tagged tabs belong to no workspace yet
          // (getWs defaults tagless to "1"): counting them inflates WS1
          // mid-restore and lies in the pill titles and close labels
          // that read these counts.
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
            counts[w] = (counts[w] || 0) + 1;
          }
        } catch (e) {}
      }
    } catch (e) {}
    return counts;
  }

  function lowestInactiveId(active) {
    try {
      const seen = new Set(active || []);
      for (let i = 1; i <= 9; i++) {
        const id = String(i);
        if (!seen.has(id)) {
          return id;
        }
      }
    } catch (e) {}
    return null;
  }

  // Single creation path: switchTo funnels through finishWorkspaceSwitch
  // → reconcile, which opens (and selects) the bound tab for an empty
  // workspace. An explicit openBoundTab here used to race it into two
  // new tabs, cleaned up only by a later switch's prune.
  function plusToWorkspace() {
    try {
      const free = lowestInactiveId(getActiveIds());
      if (!free) {
        pulseWorkspaceIndicator();
        return null;
      }
      switchTo(free);
      try {
        const sel = gBrowser.selectedTab;
        return sel && getWs(sel) === free ? sel : null;
      } catch (e) {
        return null;
      }
    } catch (e) {
      return null;
    }
  }

  // Bulk-close safety net: at least this many doomed tabs auto-stash before
  // the close fires. Low enough that a real "clear this workspace" gesture
  // is always covered, high enough that closing two tabs doesn't litter
  // the stash with noise. Default only — the live value comes from the
  // stash controller (aph.stash.safetyMin, Settings-tunable).
  const SNAPSHOT_SAFETY_MIN = 3;

  // Live safety threshold: controller pref when available, default above
  // otherwise (tests, early init, missing controller all read the default).
  function snapshotSafetyMin() {
    try {
      const ctl = window.AphStash;
      if (ctl && typeof ctl.safetyThreshold === "function") {
        const n = Number(ctl.safetyThreshold());
        if (Number.isFinite(n) && n > 0) {
          return Math.floor(n);
        }
      }
    } catch (e) {}
    return SNAPSHOT_SAFETY_MIN;
  }

  // Close every unpinned tab tagged `id`. Current-workspace closes switch
  // to the nearest other active workspace first (never strand the window
  // tabless: sole-workspace closes abort with a pulse). Pinned tabs are
  // global and always survive. SessionStore-owned (restoring) tabs are
  // never touched: their tags are unsettled and getWs defaults tagless
  // to "1", so WS1 would otherwise absorb pages the user never saw.
  // Closes at the safety threshold or more auto-stash first (see above).
  function closeWorkspaceTabs(id) {
    try {
      if (!isValidId(id)) {
        return { closed: 0 };
      }
      let doomed = [];
      try {
        doomed = Array.from(gBrowser.tabs || []).filter((t) => {
          try {
            if (!t || t.closing || t.pinned || getWs(t) !== id) {
              return false;
            }
          } catch (e) {
            return false;
          }
          try {
            if (typeof isRestoringTab === "function" && isRestoringTab(t)) {
              return false;
            }
          } catch (e) {}
          // Tagless tabs default to "1" via getWs: without a real tag we
          // cannot know they belong to `id`, so fail closed (same rule as
          // dockCounts/getActiveIds). Tags are never deleted, so tagless
          // always means not-yet-tagged.
          try {
            if (typeof rawWs === "function" && !rawWs(t)) {
              return false;
            }
          } catch (e) {
            return false;
          }
          return true;
        });
      } catch (e) {
        return { closed: 0 };
      }
      if (!doomed.length) {
        return { closed: 0 };
      }
      // Safety stash: a bulk workspace close is the one bulk destructive
      // action Aph owns, so capture the doomed tabs first (append-only
      // restore means a regretted close is always undoable from the
      // Stash page). Skipped below the threshold (a stray close is not
      // worth a capture) and when the controller or the pref is off.
      try {
        if (doomed.length >= snapshotSafetyMin()) {
          const stashCtl = window.AphStash;
          if (stashCtl && typeof stashCtl.autoStashTabs === "function") {
            stashCtl.autoStashTabs(doomed, `Before closing WS ${id}`);
          }
        }
      } catch (e) {}
      if (id === current) {
        const others = getActiveIds()
          .filter((x) => x !== id)
          .sort((a, b) => Number(a) - Number(b));
        if (!others.length) {
          pulseWorkspaceIndicator();
          return { closed: 0, reason: "only" };
        }
        // Nearest by numeric distance, ties go up.
        const n = Number(id);
        let best = others[0];
        let bestDist = Math.abs(Number(best) - n);
        for (const cand of others) {
          const dist = Math.abs(Number(cand) - n);
          if (dist < bestDist || (dist === bestDist && Number(cand) > Number(best))) {
            best = cand;
            bestDist = dist;
          }
        }
        switchTo(best);
        try {
          doomed = doomed.filter((t) => t && !t.closing);
        } catch (e) {}
        if (!doomed.length) {
          return { closed: 0 };
        }
      }
      // Selection can never be doomed (doomed tabs are hidden when foreign,
      // and current-closes switch away first) — belt-and-braces anyway.
      try {
        const sel = gBrowser.selectedTab;
        if (sel && doomed.indexOf(sel) !== -1) {
          let survivor = null;
          try {
            const rest = Array.from(gBrowser.tabs || []).filter(
              (t) => t && !t.closing && doomed.indexOf(t) === -1
            );
            survivor =
              rest.find((t) => getWs(t) === current) || rest[0] || null;
          } catch (e) {}
          if (survivor) {
            gBrowser.selectedTab = survivor;
          } else {
            return { closed: 0, reason: "no-survivor" };
          }
        }
      } catch (e) {}
      let closed = 0;
      for (const t of doomed) {
        try {
          if (typeof aphTabsLog === "function") {
            aphTabsLog(`close-workspace ${id} closing ${aphTabDesc(t)}`);
          }
        } catch (e) {}
        try {
          gBrowser.removeTab(t);
          closed++;
        } catch (e) {}
      }
      try {
        renderDock();
      } catch (e) {}
      // Undo offer for the safety net above: the stash controller
      // remembers the capture and toasts with Undo when it just ran.
      // Absent controller (or no capture) stays silent; the close
      // result itself never changes.
      try {
        const stashCtl = window.AphStash;
        if (stashCtl && typeof stashCtl.confirmBulkClose === "function") {
          stashCtl.confirmBulkClose(id, closed);
        }
      } catch (e) {}
      return { closed };
    } catch (e) {
      return { closed: 0 };
    }
  }

  function makeDockPill(id, isCurrent, count, isEmpty) {
    let pill = null;
    try {
      // Native button (not div[role=button]): Enter/Space activate via the
      // platform, focus is a real tab stop, and screen readers announce
      // the label + current state. No manual keydown handler — it would
      // double-fire alongside the native click.
      pill = document.createElement("button");
      try {
        pill.setAttribute("type", "button");
      } catch (e) {}
      pill.className = "aph-ws-pill";
      pill.setAttribute("data-ws", id);
      // Per-WS accent override (32): stamp data-accent="M" when WS id
      // carries a hue override; absent means follow workspace. CSS
      // resolves it to var(--aph-ws-M) with no new hexes.
      try {
        const hue = typeof getWsAccent === "function" ? getWsAccent(id) : "";
        const hueOk =
          typeof isHueId === "function"
            ? isHueId(hue)
            : (typeof isValidId === "function" && isValidId(hue));
        if (hue && hueOk && hue !== id) {
          pill.setAttribute("data-accent", hue);
        }
      } catch (e) {}
      // Native button needs no role/tabindex: it is focusable and
      // announced by the platform. aria-current marks the readout.
      if (isCurrent) {
        pill.setAttribute("data-current", "1");
        try {
          pill.setAttribute("aria-current", "true");
        } catch (e) {}
      }
      if (isEmpty) {
        try {
          pill.setAttribute("data-empty", "1");
        } catch (e) {}
      }
      const glyph = dockGlyph(id);
      // Glyph is icon-only (number fallback): clear first (pooled hosts
      // would concatenate), then append the mark or the bare number.
      // Clicks land on the pill — the svg is aria-hidden paint.
      try {
        while (pill.firstChild) {
          pill.removeChild(pill.firstChild);
        }
      } catch (e) {}
      try {
        const mark = makeWsIconSvg(glyph.icon, 14);
        if (mark) {
          pill.appendChild(mark);
        } else {
          pill.appendChild(document.createTextNode(glyph.text));
        }
      } catch (e) {
        pill.textContent = glyph.text;
      }
      // Counts are per-window tab tags — this window's own set. Pills
      // stay clean (index/icon glyph only): the count rides the pill's
      // title/aria-label below, never as badge chrome.
      let title = `Workspace ${id}`;
      try {
        const name = getWsName(id);
        if (name) {
          title += `: ${name}`;
        }
      } catch (e) {}
      if (count > 0) {
        title += ` · ${count} tab${count === 1 ? "" : "s"}`;
      } else if (isEmpty) {
        title += " · empty";
      }
      // Bound container: tooltip name only, no color underline —
      // monochrome dock (pill-dot removal parity).
      try {
        const bid = getWsContainerId(id);
        if (bid) {
          const d = describeContainer(bid);
          if (d && d.name) {
            title += ` · ${d.name} container`;
          }
        }
      } catch (e) {}
      // During a tab drag the tooltip previews the move (group aware).
      try {
        if (dockDragActive) {
          if (id === current) {
            pill.title = `${title} — current workspace (drop does nothing)`;
          } else {
            let preview = null;
            try {
              preview = dockDropPreview();
            } catch (e) {}
            const what =
              preview && preview.count > 0
                ? `Drop to move ${preview.kind} here`
                : "Drop to move tab(s) here";
            pill.title = `${title} — ${what}`;
          }
        } else {
          pill.title = `${title} — click to switch, drag tabs here to move, right-click for actions`;
        }
      } catch (e) {
        pill.title = `${title} — click to switch, right-click for actions`;
      }
      try {
        pill.setAttribute("aria-label", pill.title || title);
      } catch (e) {}
      try {
        pill.addEventListener("click", () => {
          try {
            if (id === current) {
              pulseWorkspaceIndicator();
              return;
            }
            // Window-scoped: every pill switches locally. Same-id
            // workspaces in other windows are independent tab sets.
            switchTo(id);
          } catch (e) {}
        });
        // No keydown handler: a native button fires click on Enter/Space
        // by itself. A manual Enter/Space listener would switch twice.
      } catch (e) {}
      try {
        const menu = dockMenu();
        if (menu) {
          // Native path (honored for XUL hosts). Pills are HTML divs, so
          // also open explicitly — preventDefault suppresses the stock
          // toolbar-context-menu from #vertical-tabs either way.
          pill.setAttribute("contextmenu", DOCK_MENU_ID);
          pill.addEventListener("contextmenu", (e) => {
            try {
              e.preventDefault();
              if (typeof e.stopPropagation === "function") {
                e.stopPropagation();
              }
              const m = ensureDockMenu();
              if (!m) {
                return;
              }
              try {
                m.setAttribute("data-ws", id);
              } catch (err) {}
              if (typeof m.openPopupAtScreen === "function") {
                m.openPopupAtScreen(e.screenX, e.screenY, true);
              } else if (typeof m.openPopup === "function") {
                m.openPopup(pill, "after_start", 0, 0, true, false, e);
              }
            } catch (err) {}
          });
        }
      } catch (e) {}
      try {
        const armDrop = (e) => {
          try {
            // Current workspace is never a drop target (send would no-op).
            // Window-scoped: every other pill is local, always a target.
            if (id === current) {
              return false;
            }
            if (!isDockDropArmed(e)) {
              return false;
            }
            e.preventDefault();
            // The dock lives inside #vertical-tabs: without this the strip's
            // own tab-drag handler (handle_dragover, bubble phase) also sees
            // the event and starts its tab-shove animation underneath the
            // dock hover. Shield it so pills are the only drop UI in play.
            try {
              if (typeof e.stopPropagation === "function") {
                e.stopPropagation();
              }
            } catch (err) {}
            try {
              e.dataTransfer.dropEffect = "move";
            } catch (err) {}
            pill.classList.add("drop-target");
            return true;
          } catch (err) {
            return false;
          }
        };
        pill.addEventListener("dragenter", armDrop);
        pill.addEventListener("dragover", armDrop);
        pill.addEventListener("dragleave", () => {
          try {
            pill.classList.remove("drop-target");
          } catch (err) {}
        });
        pill.addEventListener("drop", (e) => {
          try {
            e.preventDefault();
            try {
              if (typeof e.stopPropagation === "function") {
                e.stopPropagation();
              }
            } catch (err) {}
            pill.classList.remove("drop-target");
            if (id === current) {
              try {
                pulseWorkspaceIndicator();
              } catch (err) {}
              return;
            }
            const wasGroup = !!dockDragGroup;
            let dragTabs = [];
            try {
              dragTabs = resolveDockDragTabs();
            } catch (err) {
              dragTabs = [];
            }
            // Tracker missed (e.g. dragstart outside our listener) but the
            // payload is a tab drag: fall back to the live selection so the
            // drop still moves something sensible instead of nothing.
            if (!dragTabs.length && dockTabDragType(e)) {
              try {
                dragTabs = resolveSendBase(null).slice();
              } catch (err) {
                dragTabs = [];
              }
            }
            if (!dragTabs.length) {
              return;
            }
            // Live tab drag: defer until dragend so the strip's session
            // cleanup runs first (see dockPendingDrop note above).
            if (isLiveTabDragSession(dragTabs)) {
              try {
                dockPendingDrop = { dest: id, tabs: dragTabs.slice(), wasGroup };
              } catch (err) {}
              return;
            }
            executeDockDrop(id, dragTabs, wasGroup);
          } catch (err) {}
        });
      } catch (e) {}
    } catch (e) {
      pill = null;
    }
    return pill;
  }

  function makeDockPlus(free) {
    let pill = null;
    try {
      pill = document.createElement("button");
      try {
        pill.setAttribute("type", "button");
      } catch (e) {}
      pill.className = "aph-ws-pill aph-ws-add";
      pill.textContent = "+";
      pill.title = free
        ? `Open workspace ${free} (click: switches here, opens a tab · drop: moves tab(s) here)`
        : "All 9 workspaces active";
      try {
        pill.setAttribute("aria-label", pill.title);
      } catch (e) {}
      try {
        pill.addEventListener("click", () => {
          try {
            plusToWorkspace();
          } catch (e) {}
        });
        // Native button: Enter/Space already fire click. No keydown.
      } catch (e) {}
      // The "+" pill is a drop target for a fresh workspace: dropping moves
      // to the lowest inactive ID (same destination a click would open).
      try {
        const armPlus = (e) => {
          try {
            if (!isDockDropArmed(e)) {
              return false;
            }
            if (!free) {
              return false;
            }
            e.preventDefault();
            try {
              if (typeof e.stopPropagation === "function") {
                e.stopPropagation();
              }
            } catch (err) {}
            try {
              e.dataTransfer.dropEffect = "move";
            } catch (err) {}
            pill.classList.add("drop-target");
            return true;
          } catch (err) {
            return false;
          }
        };
        pill.addEventListener("dragenter", armPlus);
        pill.addEventListener("dragover", armPlus);
        pill.addEventListener("dragleave", () => {
          try {
            pill.classList.remove("drop-target");
          } catch (err) {}
        });
        pill.addEventListener("drop", (e) => {
          try {
            e.preventDefault();
            try {
              if (typeof e.stopPropagation === "function") {
                e.stopPropagation();
              }
            } catch (err) {}
            pill.classList.remove("drop-target");
            const dest = lowestInactiveId(getActiveIds());
            if (!dest) {
              try {
                pulseWorkspaceIndicator();
              } catch (err) {}
              return;
            }
            const wasGroup = !!dockDragGroup;
            let dragTabs = [];
            try {
              dragTabs = resolveDockDragTabs();
            } catch (err) {
              dragTabs = [];
            }
            if (!dragTabs.length && dockTabDragType(e)) {
              try {
                dragTabs = resolveSendBase(null).slice();
              } catch (err) {
                dragTabs = [];
              }
            }
            if (!dragTabs.length) {
              return;
            }
            if (isLiveTabDragSession(dragTabs)) {
              try {
                dockPendingDrop = { dest, tabs: dragTabs.slice(), wasGroup };
              } catch (err) {}
              return;
            }
            executeDockDrop(dest, dragTabs, wasGroup);
          } catch (err) {}
        });
      } catch (e) {}
    } catch (e) {
      pill = null;
    }
    return pill;
  }

  // Aph key: persistent mouse entry point in Aph's own dock row (owns
  // its paint via theme.css — never fights Firefox's sidebar footer).
  // Left-click / Enter opens the Aph menu (palette is its first row);
  // right-click opens the dock menu for the current workspace. Distinct
  // `aph-dock-aph` class (never `aph-ws-pill`) so workspace-pill queries
  // and drop logic ignore it. Hidden during tab-drag mode so drop targets
  // stay clean.
  const APH_MENU_ID = "aph-aph-menu";

  function aphDockOpenPalette() {
    try {
      if (window.AphPalette) {
        if (typeof window.AphPalette.open === "function") {
          window.AphPalette.open();
          return;
        }
        if (typeof window.AphPalette.toggle === "function") {
          window.AphPalette.toggle();
          return;
        }
      }
    } catch (e) {}
  }

  function aphMenuCurrent() {
    try {
      if (typeof current !== "undefined" && typeof isValidId === "function" && isValidId(current)) {
        return current;
      }
    } catch (e) {}
    return "1";
  }

  function aphMenu() {
    try {
      const m = document.getElementById(APH_MENU_ID);
      return m || null;
    } catch (e) {
      return null;
    }
  }

  // Open-or-select a URL in the current workspace's bound container when
  // possible; plain trusted tab otherwise. Fail-silent house style.
  function aphOpenTab(url) {
    try {
      if (typeof openBoundTab === "function") {
        openBoundTab(url);
        return;
      }
    } catch (e) {}
    try {
      const t = gBrowser.addTrustedTab(url);
      try {
        gBrowser.selectedTab = t;
      } catch (_e) {}
    } catch (e) {}
  }

  function aphOpenStash() {
    try {
      const a = window.AphStash || null;
      if (a && typeof a.openStash === "function" && a.openStash()) {
        return;
      }
    } catch (e) {}
    try {
      aphOpenTab("chrome://browser/content/aph-stash.html");
    } catch (e) {}
  }

  // Reuse one settings tab per window instead of stacking duplicates.
  function aphOpenSettings() {
    try {
      const url = "chrome://browser/content/aph-settings.html";
      for (const t of Array.from((typeof gBrowser !== "undefined" && gBrowser.tabs) || [])) {
        try {
          const spec = t && t.linkedBrowser && t.linkedBrowser.currentURI && t.linkedBrowser.currentURI.spec;
          if (!t.closing && spec === url) {
            gBrowser.selectedTab = t;
            return;
          }
        } catch (e) {}
      }
    } catch (e) {}
    try {
      aphOpenTab("chrome://browser/content/aph-settings.html");
    } catch (e) {}
  }

  // Native Firefox Settings (about:preferences — themes live here, so
  // this is the room-switch path). Stock openPreferences first (native
  // pane/tab behavior); plain trusted tab fallback — never the bound
  // container path (userContextId on a privileged URL must not throw).
  // Fail-silent house style throughout.
  function aphOpenFirefoxSettings() {
    try {
      if (typeof window.openPreferences === "function") {
        window.openPreferences();
        return;
      }
    } catch (e) {}
    try {
      const t = gBrowser.addTrustedTab("about:preferences");
      try {
        gBrowser.selectedTab = t;
      } catch (_e) {}
    } catch (e) {}
  }

  function aphStashCurrent() {
    try {
      const a = window.AphStash || null;
      if (a && typeof a.stashCurrent === "function") {
        a.stashCurrent();
        return;
      }
    } catch (e) {}
  }

  function aphShowCustomizeSidebar() {
    try {
      if (window.SidebarController && typeof window.SidebarController.show === "function") {
        window.SidebarController.show("viewCustomizeSidebar");
        return;
      }
    } catch (e) {}
  }

  function clearAphMenu(menu) {
    try {
      while (menu.firstChild) {
        menu.removeChild(menu.firstChild);
      }
    } catch (e) {}
  }

  function onAphMenuShowing(e) {
    try {
      const menu = (e && (e.currentTarget || e.target)) || null;
      if (!menu || typeof menu.appendChild !== "function") {
        return;
      }
      // popupshowing BUBBLES: opening the nested Bind submenu re-fires this
      // listener with e.target = the submenu. Only rebuild on our own popup.
      try {
        if (!e || e.target !== menu) {
          return;
        }
      } catch (err) {
        return;
      }
      clearAphMenu(menu);
      const cur = aphMenuCurrent();
      let curName = "";
      try {
        curName = typeof getWsName === "function" ? getWsName(cur) || "" : "";
      } catch (err) {}
      const head = curName ? `${cur}: ${curName}` : `Workspace ${cur}`;
      const pal = makeDockMenuItem("aph-aph-palette", "Open Command Palette…", () => {
        try {
          aphDockOpenPalette();
        } catch (err) {}
      }, false, "palette");
      if (pal) {
        try {
          pal.setAttribute("shortcut", "Ctrl+K");
        } catch (err) {}
        try {
          menu.appendChild(pal);
        } catch (err) {}
      }
      // In-place new tab (current workspace, bound container): the stock
      // full-width strip row retired into the dock toolbar (§26e), so this
      // row is the mouse path that stays — no ellipsis, it acts at once.
      const newTab = makeDockMenuItem("aph-aph-new-tab", "New Tab", () => {
        try {
          aphOpenTab("about:newtab");
        } catch (err) {}
      }, false, "new-tab");
      if (newTab) {
        try {
          newTab.setAttribute("shortcut", "Ctrl+T");
        } catch (err) {}
        try {
          menu.appendChild(newTab);
        } catch (err) {}
      }
      try {
        const sep =
          typeof document.createXULElement === "function"
            ? document.createXULElement("menuseparator")
            : document.createElement("menuseparator");
        menu.appendChild(sep);
      } catch (err) {}
      const rename = makeDockMenuItem("aph-aph-rename", `Rename ${head}…`, () => {
        try {
          if (typeof promptDockRename === "function") {
            promptDockRename(cur);
          }
        } catch (err) {}
      }, false, "rename");
      if (rename) {
        try {
          menu.appendChild(rename);
        } catch (err) {}
      }
      // Same pair as the pill right-click menu (Rename above, Set Icon
      // here): the Aph key is the keyboard path (Enter opens this menu),
      // so the icon picker must live here too, not only on right-click.
      const setIcon = makeDockMenuItem("aph-aph-set-icon", `Set Icon for ${head}…`, () => {
        try {
          const api = window.AphPalette;
          if (api && typeof api.setWsIcon === "function") {
            api.setWsIcon(cur);
          }
        } catch (err) {}
      }, false, "set-icon");
      if (setIcon) {
        try {
          menu.appendChild(setIcon);
        } catch (err) {}
      }
      try {
        if (typeof isPrivateWindow === "function" ? !isPrivateWindow() : true) {
          const bindMenu =
            typeof document.createXULElement === "function"
              ? document.createXULElement("menu")
              : document.createElement("menu");
          bindMenu.setAttribute("label", `Bind ${head} to Container…`);
          bindMenu.id = "aph-aph-bind";
          try {
            if (bindMenu.classList && typeof bindMenu.classList.add === "function") {
              bindMenu.classList.add("menu-iconic");
            }
          } catch (err) {}
          const sub =
            typeof document.createXULElement === "function"
              ? document.createXULElement("menupopup")
              : document.createElement("menupopup");
          let bound = 0;
          try {
            bound = typeof getWsContainerId === "function" ? getWsContainerId(cur) : 0;
          } catch (err) {}
          const none = makeDockMenuItem("aph-aph-bind-none", "None (unbound)", () => {
            try {
              if (typeof setWsBinding === "function") {
                setWsBinding(cur, 0);
              }
              if (typeof renderDock === "function") {
                renderDock();
              }
            } catch (err) {}
          });
          if (none) {
            if (!bound) {
              try {
                none.setAttribute("checked", "true");
              } catch (err) {}
            }
            sub.appendChild(none);
          }
          try {
            const list = typeof listContainers === "function" ? listContainers() : [];
            for (const c of list || []) {
              const item = makeDockMenuItem(
                `aph-aph-bind-${c.userContextId}`,
                c.name || `Container ${c.userContextId}`,
                () => {
                  try {
                    if (typeof setWsBinding === "function") {
                      setWsBinding(cur, c.userContextId);
                    }
                    if (typeof renderDock === "function") {
                      renderDock();
                    }
                  } catch (err) {}
                }
              );
              if (item && bound === c.userContextId) {
                try {
                  item.setAttribute("checked", "true");
                } catch (err) {}
              }
              if (item) {
                sub.appendChild(item);
              }
            }
          } catch (err) {}
          bindMenu.appendChild(sub);
          menu.appendChild(bindMenu);
        }
      } catch (err) {}
      // Workspace section (merged single menu): accent picker + close
      // live here alongside rename/icon/bind above, all targeting the
      // current workspace. Unload stays pill-menu-only: it is disabled
      // for the current workspace by definition, so it would be a dead
      // row here.
      try {
        const accentMenu = buildAccentSubmenu(cur, "aph-aph");
        if (accentMenu) {
          try {
            accentMenu.id = "aph-aph-accent";
          } catch (err) {}
          menu.appendChild(accentMenu);
        }
      } catch (err) {}
      let curCount = 0;
      try {
        curCount = (typeof dockCounts === "function" ? dockCounts()[cur] : 0) || 0;
      } catch (err) {}
      const closeWs = makeDockMenuItem(
        "aph-aph-close",
        curCount > 0 ? `Close Workspace (${curCount} tab${curCount === 1 ? "" : "s"})` : "Close Workspace",
        () => {
          try {
            if (typeof closeWorkspaceTabs === "function") {
              closeWorkspaceTabs(cur);
            }
          } catch (err) {}
        },
        curCount === 0
      );
      if (closeWs) {
        try {
          menu.appendChild(closeWs);
        } catch (err) {}
      }
      let stashTitle = "Stash Current Tab";
      try {
        if (typeof stashCmdTitle === "function") {
          stashTitle = stashCmdTitle();
        }
      } catch (err) {}
      // Disabled with nothing archivable (pendingCount 0): the shared
      // skin dims the row in place. An absent controller fails open
      // (previous behavior) so tests and early init keep working.
      let stashDisabled = false;
      try {
        const stashCtl = window.AphStash;
        if (stashCtl && typeof stashCtl.pendingStashCount === "function") {
          stashDisabled = stashCtl.pendingStashCount() === 0;
        }
      } catch (err) {}
      const stashRow = makeDockMenuItem("aph-aph-stash", stashTitle, () => {
        try {
          aphStashCurrent();
        } catch (err) {}
      }, stashDisabled, "stash");
      if (stashRow) {
        try {
          menu.appendChild(stashRow);
        } catch (err) {}
      }
      const openStash = makeDockMenuItem("aph-aph-open-stash", "Open Stash", () => {
        try {
          aphOpenStash();
        } catch (err) {}
      }, false, "open-stash");
      if (openStash) {
        try {
          menu.appendChild(openStash);
        } catch (err) {}
      }
      try {
        const sep =
          typeof document.createXULElement === "function"
            ? document.createXULElement("menuseparator")
            : document.createElement("menuseparator");
        menu.appendChild(sep);
      } catch (err) {}
      const cust = makeDockMenuItem("aph-aph-customize", "Customize Sidebar…", () => {
        try {
          aphShowCustomizeSidebar();
        } catch (err) {}
      }, false, "customize");
      if (cust) {
        try {
          menu.appendChild(cust);
        } catch (err) {}
      }
      const prefs = makeDockMenuItem("aph-aph-settings", "Aph Settings…", () => {
        try {
          aphOpenSettings();
        } catch (err) {}
      }, false, "settings");
      if (prefs) {
        try {
          menu.appendChild(prefs);
        } catch (err) {}
      }
      const fxPrefs = makeDockMenuItem("aph-aph-firefox-settings", "Firefox Settings…", () => {
        try {
          aphOpenFirefoxSettings();
        } catch (err) {}
      }, false, "firefox-settings");
      if (fxPrefs) {
        try {
          menu.appendChild(fxPrefs);
        } catch (err) {}
      }
      // v2 hides the hamburger button (theme.css §29) — its panel stays
      // reachable here. PanelUI.show is the stock opener; missing API
      // fails silent (the row still renders for tests).
      const appMenu = makeDockMenuItem("aph-aph-appmenu", "Firefox Menu…", () => {
        try {
          if (window.PanelUI && typeof window.PanelUI.show === "function") {
            window.PanelUI.show();
          }
        } catch (err) {}
      }, false, "appmenu");
      if (appMenu) {
        try {
          menu.appendChild(appMenu);
        } catch (err) {}
      }
      const welcome = makeDockMenuItem("aph-aph-welcome", "Aph Welcome Tour", () => {
        try {
          aphOpenWelcome();
        } catch (err) {}
      }, false, "welcome");
      if (welcome) {
        try {
          menu.appendChild(welcome);
        } catch (err) {}
      }
      const about = makeDockMenuItem("aph-aph-about", "About Aph", () => {
        try {
          aphOpenTab("https://aph-browser.github.io/");
        } catch (err) {}
      }, false, "about");
      if (about) {
        try {
          menu.appendChild(about);
        } catch (err) {}
      }
    } catch (e) {}
  }

  function ensureAphMenu() {
    try {
      let menu = aphMenu();
      if (menu) {
        return menu;
      }
      const set =
        typeof document.getElementById === "function"
          ? document.getElementById("mainPopupSet")
          : null;
      if (!set || typeof set.appendChild !== "function") {
        return null;
      }
      menu =
        typeof document.createXULElement === "function"
          ? document.createXULElement("menupopup")
          : document.createElement("menupopup");
      menu.id = APH_MENU_ID;
      if (typeof menu.addEventListener === "function") {
        menu.addEventListener("popupshowing", onAphMenuShowing);
      }
      set.appendChild(menu);
      return menu;
    } catch (e) {
      return null;
    }
  }

  function openAphMenu(btn, e) {
    try {
      const menu = ensureAphMenu();
      if (!menu) {
        aphDockOpenPalette();
        return;
      }
      try {
        if (typeof menu.openPopupAtScreen === "function" && e && e.screenX != null) {
          menu.openPopupAtScreen(e.screenX, e.screenY, true);
          return;
        }
      } catch (_e) {}
      try {
        if (typeof menu.openPopup === "function") {
          if (btn) {
            menu.openPopup(btn, "after_end", 0, 0, true, false, e);
          } else {
            menu.openPopup(null, "", 0, 0, true, false, e);
          }
          return;
        }
      } catch (_e) {}
    } catch (e) {}
    try {
      aphDockOpenPalette();
    } catch (_e) {}
  }

  // Aph mark: the plain Inter Bold A from branding/aph.svg, scaled to
  // the dock's 16px slot. Same construction (real glyph + flat purple,
  // never a hand-drawn polygon) so the dock mark and the app icon are
  // one mark, not two. The letter wears flat #8e4ec6 at full strength;
  // the button wash behind it provides the surface (no tile here —
  // a tile inside the wash would double the surface). Logos don't dim.
  // Namespaced construction (never innerHTML) so the XUL/XHTML host
  // gets real SVG either way. NOTE: chrome SVGs don't get page
  // @font-face, so systems without Inter fall back to system bold —
  // still centered via text-anchor, same fallback as aph.svg.
  function makeDockAphMark() {
    try {
      const NS = "http://www.w3.org/2000/svg";
      const svg = document.createElementNS(NS, "svg");
      svg.setAttribute("viewBox", "0 0 16 16");
      svg.setAttribute("width", "16");
      svg.setAttribute("height", "16");
      svg.setAttribute("aria-hidden", "true");
      const letter = document.createElementNS(NS, "text");
      letter.setAttribute("x", "8");
      letter.setAttribute("y", "8.4");
      letter.setAttribute("text-anchor", "middle");
      letter.setAttribute("dominant-baseline", "central");
      letter.setAttribute("font-family", "Inter, system-ui, -apple-system, sans-serif");
      letter.setAttribute("font-size", "12");
      letter.setAttribute("font-weight", "700");
      letter.setAttribute("fill", "#8e4ec6");
      try {
        letter.textContent = "A";
      } catch (e) {}
      svg.appendChild(letter);
      return svg;
    } catch (e) {
      return null;
    }
  }

  function makeDockAph() {
    let btn = null;
    try {
      // Native button, inline with the pills (CSS sizes it 28px — no
      // full-width row). One menu for both buttons: left-click and
      // right-click open the same Aph menu, whose workspace section
      // targets the current workspace. No split-brain key.
      btn = document.createElement("button");
      try {
        btn.setAttribute("type", "button");
      } catch (e) {}
      btn.className = "aph-dock-aph";
      btn.setAttribute("aria-label", "Aph menu");
      try {
        const mark = makeDockAphMark();
        if (mark) {
          btn.appendChild(mark);
        }
      } catch (e) {}
      btn.title = "Aph menu — click for Aph actions";
      try {
        btn.addEventListener("click", (e) => {
          try {
            if (typeof e.stopPropagation === "function") {
              e.stopPropagation();
            }
          } catch (_e) {}
          try {
            if (typeof e.preventDefault === "function") {
              e.preventDefault();
            }
          } catch (_e) {}
          openAphMenu(btn, e);
        });
      } catch (e) {}
      // Native button: Enter/Space already fire click. No keydown.
      try {
        // Right-click opens the SAME Aph menu (merged — its workspace
        // section already targets the current workspace, so the old
        // separate dock-menu path is gone).
        btn.addEventListener("contextmenu", (e) => {
          try {
            if (typeof e.preventDefault === "function") {
              e.preventDefault();
            }
            if (typeof e.stopPropagation === "function") {
              e.stopPropagation();
            }
          } catch (_e) {}
          try {
            openAphMenu(btn, e);
          } catch (_e) {
            aphDockOpenPalette();
          }
        });
      } catch (e) {}
    } catch (e) {
      btn = null;
    }
    return btn;
  }

  // Nav-bar switcher: the horizontal-tabs fallback. dockAnchor() is null
  // when #vertical-tabs is hidden, which used to mean zero workspace
  // readout. This compact toolbarbutton lives at the head of the nav-bar
  // instead and shows the current workspace (number + name); click opens
  // the palette (the switcher), Alt+1..9 still switch directly. Hidden
  // whenever the strip dock is up — exactly one readout at a time.
  // XUL toolbarbutton in chrome (HTML button fallback for tests): listen
  // to both click and command — XUL activates via command, HTML via
  // click. aphDockOpenPalette is idempotent (open, not toggle), so a
  // double event cannot flip it shut.
  const NAV_SWITCHER_ID = "aph-ws-nav-switcher";
  let cachedNavSwitcher = null;

  function navSwitcherNode() {
    try {
      if (typeof document.getElementById === "function") {
        const found = document.getElementById(NAV_SWITCHER_ID);
        if (found) {
          return found;
        }
      }
    } catch (e) {}
    try {
      if (
        cachedNavSwitcher &&
        cachedNavSwitcher.isConnected !== false
      ) {
        return cachedNavSwitcher;
      }
    } catch (e) {}
    return null;
  }

  function ensureNavSwitcher() {
    try {
      const existing = navSwitcherNode();
      if (existing) {
        return existing;
      }
      let target = null;
      try {
        target =
          typeof document.getElementById === "function"
            ? document.getElementById("nav-bar-customization-target") ||
              document.getElementById("nav-bar")
            : null;
      } catch (e) {
        target = null;
      }
      if (!target) {
        return null;
      }
      const canInsert =
        target &&
        (typeof target.insertBefore === "function" ||
          typeof target.appendChild === "function" ||
          typeof target.prepend === "function");
      if (!canInsert) {
        return null;
      }
      let sw = null;
      try {
        sw =
          typeof document.createXULElement === "function"
            ? document.createXULElement("toolbarbutton")
            : document.createElement("button");
      } catch (e) {
        sw = null;
      }
      if (!sw) {
        return null;
      }
      try {
        sw.id = NAV_SWITCHER_ID;
      } catch (e) {}
      try {
        if (sw.classList && typeof sw.classList.add === "function") {
          sw.classList.add("aph-ws-nav-switcher");
        }
      } catch (e) {}
      const open = (e) => {
        try {
          if (e && typeof e.stopPropagation === "function") {
            e.stopPropagation();
          }
        } catch (_e) {}
        aphDockOpenPalette();
      };
      try {
        if (typeof sw.addEventListener === "function") {
          sw.addEventListener("click", open);
          sw.addEventListener("command", open);
        }
      } catch (e) {}
      try {
        if (typeof target.insertBefore === "function" && target.firstChild !== undefined) {
          target.insertBefore(sw, target.firstChild || null);
        } else if (typeof target.prepend === "function") {
          target.prepend(sw);
        } else if (typeof target.appendChild === "function") {
          target.appendChild(sw);
        } else {
          return null;
        }
      } catch (e) {
        return null;
      }
      try {
        cachedNavSwitcher = sw;
      } catch (e) {}
      return sw;
    } catch (e) {
      return null;
    }
  }

  function renderNavSwitcher() {
    try {
      const stripOn = !!dockAnchor();
      const sw = stripOn ? navSwitcherNode() : ensureNavSwitcher();
      if (!sw) {
        return;
      }
      const show = !stripOn;
      try {
        if (typeof sw.setAttribute === "function") {
          if (show) {
            sw.removeAttribute("hidden");
          } else {
            sw.setAttribute("hidden", "true");
          }
        }
      } catch (e) {}
      try {
        sw.hidden = !show;
      } catch (e) {}
      if (!show) {
        return;
      }
      const cur = typeof current !== "undefined" && isValidId(current) ? current : "1";
      let name = "";
      try {
        name = typeof getWsName === "function" ? getWsName(cur) || "" : "";
      } catch (e) {}
      let count = 0;
      try {
        count = (typeof dockCounts === "function" ? dockCounts()[cur] : 0) || 0;
      } catch (e) {}
      const short = name ? `WS ${cur} · ${name}` : `WS ${cur}`;
      const tip =
        `${name ? `Workspace ${cur}: ${name}` : `Workspace ${cur}`} · ` +
        `${count} tab${count === 1 ? "" : "s"} — click for palette · Alt+1..9 to switch`;
      try {
        if (typeof sw.setAttribute === "function") {
          sw.setAttribute("label", short);
          sw.setAttribute("tooltiptext", tip);
          sw.setAttribute("aria-label", tip);
        }
      } catch (e) {}
      try {
        sw.title = tip;
      } catch (e) {}
      try {
        sw.textContent = short;
      } catch (e) {}
    } catch (e) {}
  }

  function renderDock() {
    // The nav-bar fallback paints first: exactly one readout — strip
    // dock when anchored, nav switcher when horizontal.
    try {
      renderNavSwitcher();
    } catch (e) {}
    try {
      const anchor = dockAnchor();
      let dock = null;
      try {
        dock = document.getElementById(DOCK_ID);
      } catch (e) {}
      if (!anchor) {
        try {
          if (dock) {
            dock.hidden = true;
          }
        } catch (e) {}
        return;
      }
      if (!dock) {
        dock = ensureDock();
        if (!dock) {
          return;
        }
      }
      try {
        dock.hidden = false;
      } catch (e) {}
      try {
        while (dock.firstChild) {
          dock.removeChild(dock.firstChild);
        }
      } catch (e) {}
      // Drag-mode expands to all 9 workspaces so empty ones accept drops.
      // Normal mode shows active workspaces only (plus current).
      // Window-scoped: no remote pills — other windows' workspaces are
      // independent tab sets, never shown here.
      let ids = [];
      try {
        ids = getActiveIds();
      } catch (e) {
        ids = [];
      }
      const cur = isValidId(current) ? current : "1";
      const counts = dockCounts();
      if (dockDragActive) {
        try {
          dock.setAttribute("data-aph-dragging", "1");
        } catch (e) {}
        for (let i = 1; i <= 9; i++) {
          const id = String(i);
          try {
            const pill = makeDockPill(
              id,
              id === cur,
              counts[id] || 0,
              !ids.includes(id)
            );
            if (pill) {
              dock.appendChild(pill);
            }
          } catch (e) {}
        }
      } else {
        try {
          dock.removeAttribute("data-aph-dragging");
        } catch (e) {}
        for (const id of ids) {
          try {
            const pill = makeDockPill(id, id === cur, counts[id] || 0, false);
            if (pill) {
              dock.appendChild(pill);
            }
          } catch (e) {}
        }
      }
      try {
        const plus = makeDockPlus(lowestInactiveId(getActiveIds()));
        if (plus) {
          dock.appendChild(plus);
        }
      } catch (e) {}
      // Aph key last (far end of the row). Skipped in drag mode — pills +
      // plus are the only drop UI in play there.
      try {
        if (!dockDragActive) {
          const aph = makeDockAph();
          if (aph) {
            dock.appendChild(aph);
          }
        }
      } catch (e) {}
    } catch (e) {}
  }

  // Aph-menu glyphs live in theme.css (§20b) as --menuitem-icon vars:
  // stock 157 paints .menu-icon from that var (content: var), NOT the
  // classic image attribute — bare image attrs unhide an empty slot.
  // The iconKey below only flips the stock menuitem-iconic class (the
  // display trigger); art + context-fill ink come from CSS, so dark /
  // light / hover / disabled follow automatically. Dynamic or checked
  // rows (bind list) stay text-only by passing no key.
  function makeDockMenuItem(id, label, action, disabled, iconKey) {
    let item = null;
    try {
      // browser.xhtml is XHTML: createElement would build an
      // HTML-namespaced dud inside the XUL menupopup (pinreset pattern).
      item =
        typeof document.createXULElement === "function"
          ? document.createXULElement("menuitem")
          : document.createElement("menuitem");
      item.id = id;
      item.setAttribute("label", label);
      if (iconKey) {
        try {
          if (item.classList && typeof item.classList.add === "function") {
            item.classList.add("menuitem-iconic");
          }
        } catch (e) {}
      }
      if (disabled) {
        item.setAttribute("disabled", "true");
      }
      if (typeof item.addEventListener === "function") {
        item.addEventListener("command", action);
      }
    } catch (e) {
      item = null;
    }
    return item;
  }

  function promptDockRename(id) {
    const commit = (v) => {
      try {
        setWsName(id, String(v == null ? "" : v));
        renderDock();
      } catch (e) {}
    };
    try {
      if (window.AphPalette && typeof window.AphPalette.prompt === "function") {
        window.AphPalette.prompt({
          title: `Rename workspace ${id} — Enter saves, Esc cancels`,
          initial: getWsName(id) || "",
          onCommit: commit,
        });
        return;
      }
    } catch (e) {}
    try {
      if (typeof window.prompt === "function") {
        commit(window.prompt(`Rename workspace ${id}:`, getWsName(id) || ""));
      }
    } catch (e) {}
  }

  // Resolve the right-clicked pill: explicit data-ws stashed by our own
  // contextmenu opener first, then the pinreset pattern (triggerNode,
  // document.popupNode fallback).
  function dockMenuTargetWs(menu) {
    try {
      const direct =
        menu && typeof menu.getAttribute === "function" && menu.getAttribute("data-ws");
      if (isValidId(direct)) {
        return direct;
      }
    } catch (e) {}
    try {
      const node =
        (menu && menu.triggerNode) || (typeof document !== "undefined" && document.popupNode) || null;
      if (node && typeof node.closest === "function") {
        const pill = node.closest(".aph-ws-pill");
        if (pill && typeof pill.getAttribute === "function") {
          const ws = pill.getAttribute("data-ws");
          if (isValidId(ws)) {
            return ws;
          }
        }
      }
    } catch (e) {}
    return null;
  }

  function clearDockMenu(menu) {
    try {
      while (menu.firstChild) {
        menu.removeChild(menu.firstChild);
      }
    } catch (e) {}
  }

  function isPrivateWindow() {
    try {
      const pbu = window.PrivateBrowsingUtils;
      if (pbu && typeof pbu.isWindowPrivate === "function") {
        return !!pbu.isWindowPrivate(window);
      }
    } catch (e) {}
    return false;
  }

  // Shared accent picker submenu: the per-pill right-click menu and the
  // Aph menu's workspace section both offer it. idPrefix namespaces the
  // item ids per host menu (aph-dock-* vs aph-aph-*). Returns the <menu>
  // element (with its popup attached) or null. All 16 hues kept.
  function buildAccentSubmenu(id, idPrefix) {
    let accentMenu = null;
    try {
      accentMenu =
        typeof document.createXULElement === "function"
          ? document.createXULElement("menu")
          : document.createElement("menu");
      const head = (() => {
        try {
          const nm = typeof getWsName === "function" ? getWsName(id) || "" : "";
          return nm ? `${id}: ${nm}` : `Workspace ${id}`;
        } catch (err) {
          return `Workspace ${id}`;
        }
      })();
      accentMenu.setAttribute("label", `Accent for ${head}…`);
      const accentSub =
        typeof document.createXULElement === "function"
          ? document.createXULElement("menupopup")
          : document.createElement("menupopup");
      let curHue = "";
      try {
        curHue = typeof getWsAccent === "function" ? getWsAccent(id) : "";
      } catch (err) {}
      const follow = makeDockMenuItem(`${idPrefix}-accent-follow`, "Follow workspace", () => {
        try {
          if (typeof setWsAccent === "function") {
            setWsAccent(id, "");
          }
          renderDock();
        } catch (err) {}
      });
      if (follow) {
        if (!curHue) {
          try {
            follow.setAttribute("checked", "true");
          } catch (err) {}
        }
        accentSub.appendChild(follow);
      }
      try {
        for (let h = 1; h <= 16; h++) {
          const hs = String(h);
          const nm = WS_ACCENT_NAMES[hs] || `Hue ${hs}`;
          const item = makeDockMenuItem(`${idPrefix}-accent-${hs}`, nm, () => {
            try {
              if (typeof setWsAccent === "function") {
                setWsAccent(id, hs);
              }
              renderDock();
            } catch (err) {}
          });
          if (item && curHue === hs) {
            try {
              item.setAttribute("checked", "true");
            } catch (err) {}
          }
          if (item) {
            accentSub.appendChild(item);
          }
        }
      } catch (err) {}
      accentMenu.appendChild(accentSub);
    } catch (e) {
      accentMenu = null;
    }
    return accentMenu;
  }

  function onDockMenuShowing(e) {
    try {
      const menu = (e && (e.currentTarget || e.target)) || null;
      if (!menu || typeof menu.appendChild !== "function") {
        return;
      }
      // popupshowing BUBBLES: opening the nested Bind submenu re-fires this
      // listener with e.target = the submenu. Rebuilding here would rip the
      // submenu out mid-open (open/close flicker, submenu never stays up).
      // Only handle showings that originate on our own menupopup.
      try {
        if (!e || e.target !== menu) {
          return;
        }
      } catch (err) {
        return;
      }
      clearDockMenu(menu);
      const id = dockMenuTargetWs(menu);
      if (!id) {
        return;
      }
      // Window-scoped: every pill is local. Rename/bind stay (global
      // prefs); unload/close act on this window's tabs only.
      let name = "";
      try {
        name = getWsName(id) || "";
      } catch (err) {}
      const head = name ? `${id}: ${name}` : `Workspace ${id}`;
      let count = 0;
      try {
        count = dockCounts()[id] || 0;
      } catch (err) {}
      const rename = makeDockMenuItem(
        "aph-dock-rename",
        `Rename ${head}…`,
        () => {
          try {
            promptDockRename(id);
          } catch (err) {}
        }
      );
      if (rename) {
        try {
          menu.appendChild(rename);
        } catch (err) {}
      }
      const setIcon = makeDockMenuItem(
        "aph-dock-set-icon",
        `Set Icon for ${head}…`,
        () => {
          try {
            if (window.AphPalette && typeof window.AphPalette.setWsIcon === "function") {
              window.AphPalette.setWsIcon(id);
            }
          } catch (err) {}
        }
      );
      if (setIcon) {
        try {
          menu.appendChild(setIcon);
        } catch (err) {}
      }
      if (!isPrivateWindow()) {
        try {
          const bindMenu =
            typeof document.createXULElement === "function"
              ? document.createXULElement("menu")
              : document.createElement("menu");
          bindMenu.setAttribute("label", "Bind to Container…");
          const sub =
            typeof document.createXULElement === "function"
              ? document.createXULElement("menupopup")
              : document.createElement("menupopup");
          const bound = getWsContainerId(id);
          const none = makeDockMenuItem("aph-dock-bind-none", "None (unbound)", () => {
            try {
              setWsBinding(id, 0);
              renderDock();
            } catch (err) {}
          });
          if (none) {
            if (!bound) {
              try {
                none.setAttribute("checked", "true");
              } catch (err) {}
            }
            sub.appendChild(none);
          }
          try {
            for (const c of listContainers()) {
              const item = makeDockMenuItem(
                `aph-dock-bind-${c.userContextId}`,
                c.name || `Container ${c.userContextId}`,
                () => {
                  try {
                    setWsBinding(id, c.userContextId);
                    renderDock();
                  } catch (err) {}
                }
              );
              if (item && bound === c.userContextId) {
                try {
                  item.setAttribute("checked", "true");
                } catch (err) {}
              }
              if (item) {
                sub.appendChild(item);
              }
            }
          } catch (err) {}
          bindMenu.appendChild(sub);
          menu.appendChild(bindMenu);
        } catch (err) {}
      }
      try {
        const accentMenu = buildAccentSubmenu(id, "aph-dock");
        if (accentMenu) {
          menu.appendChild(accentMenu);
        }
      } catch (err) {}
      const unload = makeDockMenuItem(
        "aph-dock-unload",
        "Unload Inactive Tabs",
        () => {
          try {
            unloadEligibleTabs({ scope: "workspace", ws: id });
            renderDock();
          } catch (err) {}
        },
        id === current
      );
      if (unload) {
        try {
          menu.appendChild(unload);
        } catch (err) {}
      }
      try {
        const sep =
          typeof document.createXULElement === "function"
            ? document.createXULElement("menuseparator")
            : document.createElement("menuseparator");
        menu.appendChild(sep);
      } catch (err) {}
      const close = makeDockMenuItem(
        "aph-dock-close",
        count > 0 ? `Close Workspace (${count} tab${count === 1 ? "" : "s"})` : "Close Workspace",
        () => {
          try {
            closeWorkspaceTabs(id);
          } catch (err) {}
        },
        count === 0
      );
      if (close) {
        try {
          menu.appendChild(close);
        } catch (err) {}
      }
    } catch (e) {}
  }

  function ensureDockMenu() {
    try {
      let menu = dockMenu();
      if (menu) {
        return menu;
      }
      const set =
        typeof document.getElementById === "function"
          ? document.getElementById("mainPopupSet")
          : null;
      if (!set || typeof set.appendChild !== "function") {
        return null;
      }
      menu =
        typeof document.createXULElement === "function"
          ? document.createXULElement("menupopup")
          : document.createElement("menupopup");
      menu.id = DOCK_MENU_ID;
      if (typeof menu.addEventListener === "function") {
        menu.addEventListener("popupshowing", onDockMenuShowing);
      }
      set.appendChild(menu);
      return menu;
    } catch (e) {
      return null;
    }
  }

  // Wheel-to-cycle: scroll on the dock moves between workspaces.
  // No distinct "swipe" event exists in Firefox — a two-finger trackpad
  // swipe arrives as wheel with deltaX, so one dominant-axis handler
  // covers mouse wheel (deltaY), swipe (deltaX) and Shift+wheel alike.
  // Down/right cycles up, up/left cycles down; pinch-zoom (ctrlKey)
  // and tab-drag mode are never hijacked. Threshold + cooldown keep
  // smooth-scroll devices to one switch per gesture beat.
  let dockWheelAcc = 0;
  let dockWheelLast = 0;
  const DOCK_WHEEL_THRESHOLD = 60;
  const DOCK_WHEEL_COOLDOWN_MS = 250;

  function onDockWheel(e) {
    try {
      if (!e || dockDragActive) {
        return;
      }
      try {
        if (e.ctrlKey || e.metaKey) {
          return;
        }
      } catch (err) {}
      let dx = 0;
      let dy = 0;
      try {
        dx = Number(e.deltaX) || 0;
        dy = Number(e.deltaY) || 0;
        if (e.deltaMode === 1) {
          dx *= 40;
          dy *= 40;
        } else if (e.deltaMode === 2) {
          dx *= 400;
          dy *= 400;
        }
      } catch (err) {
        return;
      }
      const mag = Math.abs(dx) >= Math.abs(dy) ? dx : dy;
      if (!mag) {
        return;
      }
      // Direction flip starts a fresh gesture (no fighting the spring).
      try {
        if ((dockWheelAcc > 0) !== (mag > 0)) {
          dockWheelAcc = 0;
        }
      } catch (err) {}
      dockWheelAcc += mag;
      if (Math.abs(dockWheelAcc) < DOCK_WHEEL_THRESHOLD) {
        return;
      }
      let now = 0;
      try {
        now = Date.now();
      } catch (err) {}
      if (now - dockWheelLast < DOCK_WHEEL_COOLDOWN_MS) {
        return;
      }
      dockWheelLast = now;
      dockWheelAcc = 0;
      try {
        if (typeof e.preventDefault === "function") {
          e.preventDefault();
        }
      } catch (err) {}
      try {
        if (typeof e.stopPropagation === "function") {
          e.stopPropagation();
        }
      } catch (err) {}
      try {
        if (typeof cycleWorkspace === "function") {
          cycleWorkspace(mag > 0 ? 1 : -1);
        }
      } catch (err) {}
    } catch (e) {}
  }

  // Sidebar swipe: horizontal two-finger swipes anywhere on the vertical
  // tab strip cycle workspaces; vertical wheel passes through untouched
  // so the tab list keeps scrolling. Same threshold/cooldown shape as
  // the dock wheel (shared cooldown clock, separate gesture sum).
  // Wheel events from the dock bubble up here too — the dock handler
  // owns those (and stops them on switch), so dock-originated events
  // are ignored by target as well as by propagation.
  let stripSwipeAcc = 0;

  function onStripSwipe(e) {
    try {
      if (!e || dockDragActive) {
        return;
      }
      try {
        if (e.ctrlKey || e.metaKey) {
          return;
        }
      } catch (err) {}
      try {
        if (
          e.target &&
          typeof e.target.closest === "function" &&
          e.target.closest("#" + DOCK_ID)
        ) {
          return;
        }
      } catch (err) {}
      let dx = 0;
      let dy = 0;
      try {
        dx = Number(e.deltaX) || 0;
        dy = Number(e.deltaY) || 0;
        if (e.deltaMode === 1) {
          dx *= 40;
          dy *= 40;
        } else if (e.deltaMode === 2) {
          dx *= 400;
          dy *= 400;
        }
      } catch (err) {
        return;
      }
      // Horizontal-dominant only: vertical belongs to the tab list.
      if (!dx || Math.abs(dx) < Math.abs(dy)) {
        stripSwipeAcc = 0;
        return;
      }
      try {
        if ((stripSwipeAcc > 0) !== (dx > 0)) {
          stripSwipeAcc = 0;
        }
      } catch (err) {}
      stripSwipeAcc += dx;
      if (Math.abs(stripSwipeAcc) < DOCK_WHEEL_THRESHOLD) {
        return;
      }
      let now = 0;
      try {
        now = Date.now();
      } catch (err) {}
      if (now - dockWheelLast < DOCK_WHEEL_COOLDOWN_MS) {
        return;
      }
      dockWheelLast = now;
      stripSwipeAcc = 0;
      try {
        if (typeof e.preventDefault === "function") {
          e.preventDefault();
        }
      } catch (err) {}
      try {
        if (typeof cycleWorkspace === "function") {
          cycleWorkspace(dx > 0 ? 1 : -1);
        }
      } catch (err) {}
    } catch (e) {}
  }

  function ensureDock() {
    try {
      let dock = null;
      try {
        dock = document.getElementById(DOCK_ID);
      } catch (e) {}
      if (dock) {
        return dock;
      }
      const anchor = dockAnchor();
      if (!anchor || typeof anchor.appendChild !== "function") {
        return null;
      }
      dock = document.createElement("div");
      dock.id = DOCK_ID;
      dock.title = "Workspaces — click to switch · scroll or swipe to cycle";
      // Marker for Browser Console diagnosis (the listeners are
      // invisible otherwise): both gestures attach once, at creation.
      try {
        dock.setAttribute("data-aph-dock-wheel", "1");
      } catch (e) {}
      // Dock gaps (padding between pills) sit inside #vertical-tabs: a tab
      // drag hovering the gap would otherwise bubble to the strip's own
      // dragover and animate tab shoves with no pill in play. Swallow it.
      try {
        const shield = (e) => {
          try {
            if (!isDockDropArmed(e)) {
              return;
            }
            e.preventDefault();
            try {
              if (typeof e.stopPropagation === "function") {
                e.stopPropagation();
              }
            } catch (err) {}
          } catch (err) {}
        };
        dock.addEventListener("dragenter", shield);
        dock.addEventListener("dragover", shield);
      } catch (e) {}
      // Wheel-to-cycle must be non-passive: the strip's own wheel scroll
      // (tab list) would otherwise also run under the switch.
      try {
        dock.addEventListener("wheel", onDockWheel, { passive: false });
      } catch (e) {
        try {
          dock.addEventListener("wheel", onDockWheel);
        } catch (_e) {}
      }
      anchor.appendChild(dock);
      // Sidebar swipe lives on the strip itself (once per window: this
      // block only runs at dock creation). Vertical wheel is left alone
      // so the tab list keeps scrolling; horizontal swipes cycle.
      try {
        anchor.addEventListener("wheel", onStripSwipe, { passive: false });
      } catch (e) {
        try {
          anchor.addEventListener("wheel", onStripSwipe);
        } catch (_e) {}
      }
      try {
        anchor.setAttribute("data-aph-swipe", "1");
      } catch (e) {}
      // Shared right-click menu must exist before pills reference it.
      try {
        ensureDockMenu();
      } catch (e) {}
      return dock;
    } catch (e) {
      return null;
    }
  }

  function onDockDragStart(e) {
    try {
      dockDragTab = null;
      dockDragGroup = null;
      const t = e && e.target;
      try {
        const tab =
          t && typeof t.closest === "function" ? t.closest("tab") : null;
        if (tab && !tab.closing) {
          dockDragTab = tab;
          enterDockDragMode();
          return;
        }
      } catch (err) {}
      // No tab under the cursor: a group-header drag carries the whole
      // native group (stock strip behavior). Resolve members at drop time
      // so mid-drag closes don't strand stale refs.
      try {
        const grp =
          t && typeof t.closest === "function" ? t.closest("tab-group") : null;
        if (grp && !grp.closing) {
          dockDragGroup = grp;
          enterDockDragMode();
          return;
        }
      } catch (err) {
        dockDragGroup = null;
      }
      // Drag started but hit neither tab nor group (e.g. empty strip gap):
      // still enter drag-mode if the payload looks like tabs so empty
      // workspaces become visible drop targets.
      try {
        if (dockTabDragType(e)) {
          enterDockDragMode();
        }
      } catch (err) {}
    } catch (err) {
      dockDragTab = null;
      dockDragGroup = null;
    }
  }

  // Resolve what a dock drop should move. Group-header drags return the
  // group's live members (sendGroupTo keeps membership); tab drags return
  // the dragged tab itself, expanded to the live multiselection only when
  // the dragged tab belongs to it (stock strip-drag semantics). Reading
  // selection alone is wrong — the user can drag an unselected tab while
  // something else is selected. Whole groups stay joined via preservation.
  function resolveDockDragTabs() {
    try {
      if (dockDragGroup) {
        let members = [];
        try {
          if (typeof groupMembers === "function") {
            members = groupMembers(dockDragGroup);
          } else {
            members = Array.from(dockDragGroup.tabs || []);
          }
        } catch (e) {
          members = [];
        }
        try {
          const live = new Set(Array.from(gBrowser.tabs || []));
          members = (members || []).filter(
            (t) => t && !t.closing && live.has(t)
          );
        } catch (e) {}
        if (members.length) {
          return members;
        }
        // Stale group ref (closed mid-drag): fall through to tab logic.
      }
      if (!dockDragTab || dockDragTab.closing) {
        return [];
      }
      let live = [];
      try {
        live = Array.from(gBrowser.tabs || []);
      } catch (e) {
        return [];
      }
      if (!live.includes(dockDragTab)) {
        return [];
      }
      try {
        const multi =
          (gBrowser && (gBrowser.selectedTabs || gBrowser.multiselectedTabs)) || null;
        if (Array.isArray(multi) && multi.length > 1) {
          try {
            if (multi.includes(dockDragTab)) {
              const liveSet = new Set(live);
              const filtered = multi.filter((t) => t && !t.closing && liveSet.has(t));
              if (filtered.length) {
                return filtered;
              }
            }
          } catch (e) {}
        }
      } catch (e) {}
      return [dockDragTab];
    } catch (e) {
      return [];
    }
  }

  function onDockDragEnd(e) {
    // A drop during a live tab drag only records dockPendingDrop (strip
    // session still active). Now the session has unwound — execute the move
    // against a settled strip, then collapse the drag UI.
    try {
      flushDockPendingDrop();
    } catch (err) {}
    try {
      dockPendingDrop = null;
    } catch (err) {}
    try {
      dockDragTab = null;
      dockDragGroup = null;
      const dock = document.getElementById(DOCK_ID);
      if (dock && typeof dock.querySelectorAll === "function") {
        for (const p of Array.from(dock.querySelectorAll(".drop-target"))) {
          try {
            p.classList.remove("drop-target");
          } catch (err) {}
        }
      }
    } catch (e) {}
    // Collapse back to active-only pills after the drag (drop handlers run
    // before dragend; deferred sends complete in flush above).
    try {
      exitDockDragMode();
    } catch (e) {}
  }

  function cleanupDock() {
    try {
      dockDragTab = null;
      dockDragGroup = null;
      dockDragActive = false;
      dockPendingDrop = null;
    } catch (e) {}
    try {
      const sw = navSwitcherNode();
      if (sw) {
        if (sw.parentNode && typeof sw.parentNode.removeChild === "function") {
          sw.parentNode.removeChild(sw);
        } else if (typeof sw.remove === "function") {
          sw.remove();
        }
      }
    } catch (e) {}
    try {
      cachedNavSwitcher = null;
    } catch (e) {}
    try {
      const menu = dockMenu();
      if (menu) {
        if (typeof menu.removeEventListener === "function") {
          menu.removeEventListener("popupshowing", onDockMenuShowing);
        }
        if (menu.parentNode) {
          menu.parentNode.removeChild(menu);
        } else if (typeof menu.remove === "function") {
          menu.remove();
        }
      }
    } catch (e) {}
    try {
      const amenu = aphMenu();
      if (amenu) {
        if (typeof amenu.removeEventListener === "function") {
          amenu.removeEventListener("popupshowing", onAphMenuShowing);
        }
        if (amenu.parentNode) {
          amenu.parentNode.removeChild(amenu);
        } else if (typeof amenu.remove === "function") {
          amenu.remove();
        }
      }
    } catch (e) {}
    try {
      if (gBrowser && gBrowser.tabContainer) {
        gBrowser.tabContainer.removeEventListener("dragstart", onDockDragStart, true);
        gBrowser.tabContainer.removeEventListener("dragstart", onDockDragStart);
      }
    } catch (e) {}
    try {
      window.removeEventListener("dragstart", onDockDragStart, true);
    } catch (e) {}
    try {
      window.removeEventListener("dragend", onDockDragEnd);
    } catch (e) {}
  }

  function initDock() {
    try {
      renderDock();
    } catch (e) {}
    // Capture phase: the strip's own tab element handles dragstart with
    // capture=true and may stop propagation, which would starve a bubble
    // listener on the container (no tracking → no expansion, no indicator).
    // Ancestor capture fires first, so we always see the drag.
    try {
      if (gBrowser && gBrowser.tabContainer) {
        gBrowser.tabContainer.addEventListener("dragstart", onDockDragStart, true);
      }
    } catch (e) {}
    try {
      window.addEventListener("dragstart", onDockDragStart, true);
    } catch (e) {}
    try {
      window.addEventListener("dragend", onDockDragEnd);
    } catch (e) {}
    try {
      window.addEventListener("unload", cleanupDock, { once: true });
    } catch (e) {}
  }

  if (document.readyState === "complete") {
    initDock();
  } else {
    window.addEventListener("load", initDock, { once: true });
  }
