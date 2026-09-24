  // Workspace dock: mouse-first pills pinned to the bottom of the
  // vertical tab strip. The nav-bar #aph-ws-indicator auto-hides with the
  // top bar, so mouse users get this instead: active workspaces + current
  // + a "+" jump-to-next-empty pill, with container underlines, drag-and-
  // drop retagging, and a right-click menu (rename / bind / unload /
  // close). Zero new prefs; all state reuses tags, names and bindings.
  // Anchor: #vertical-tabs (light-DOM box projected into sidebar-main's
  // tabstrip slot, above the tools area). Horizontal-tabs mode leaves
  // #sidebar-container hidden, so the dock skips itself and the nav-bar
  // indicator remains the only badge. Everything fails silent (house
  // style) so a missing anchor never breaks chrome.
  const DOCK_ID = "aph-ws-dock";
  const DOCK_MENU_ID = "aph-ws-dock-menu";
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

  // What will a drop move? Base tabs from resolveDockDragTabs plus linked
  // tree descendants (sendTabTo auto-carry). Used for drop tooltips.
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
      try {
        for (const t of Array.from(seen)) {
          let kids = [];
          try {
            kids =
              typeof getTreeDescendants === "function"
                ? getTreeDescendants(t)
                : [];
          } catch (e) {
            kids = [];
          }
          for (const k of kids || []) {
            if (k && !k.closing) {
              seen.add(k);
            }
          }
        }
      } catch (e) {}
      const count = seen.size;
      let kind = base.length > 1 ? `${base.length} tabs` : "tab";
      if (wasGroup) {
        kind = `group (${count} tab${count === 1 ? "" : "s"})`;
      } else if (count > base.length) {
        kind = `tree (${count} tabs)`;
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

  function enterDockDragMode() {
    try {
      if (!dockDragActive) {
        dockDragActive = true;
        renderDock();
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
      return true;
    } catch (e) {
      return false;
    }
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

  function dockGlyph(id) {
    try {
      const name = getWsName(id);
      if (name) {
        const first = Array.from(String(name))[0];
        if (first) {
          return first;
        }
      }
    } catch (e) {}
    return id;
  }

  function dockCounts() {
    const counts = Object.create(null);
    try {
      for (const t of Array.from(gBrowser.tabs || [])) {
        try {
          if (!t || t.closing || t.pinned) {
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

  function plusToWorkspace() {
    try {
      const free = lowestInactiveId(getActiveIds());
      if (!free) {
        pulseWorkspaceIndicator();
        return null;
      }
      switchTo(free);
      return openBoundTab("about:newtab", free);
    } catch (e) {
      return null;
    }
  }

  // Close every unpinned tab tagged `id`. Current-workspace closes switch
  // to the nearest other active workspace first (never strand the window
  // tabless: sole-workspace closes abort with a pulse). Pinned tabs are
  // global and always survive.
  function closeWorkspaceTabs(id) {
    try {
      if (!isValidId(id)) {
        return { closed: 0 };
      }
      let doomed = [];
      try {
        doomed = Array.from(gBrowser.tabs || []).filter(
          (t) => t && !t.closing && !t.pinned && getWs(t) === id
        );
      } catch (e) {
        return { closed: 0 };
      }
      if (!doomed.length) {
        return { closed: 0 };
      }
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
          gBrowser.removeTab(t);
          closed++;
        } catch (e) {}
      }
      try {
        renderDock();
      } catch (e) {}
      return { closed };
    } catch (e) {
      return { closed: 0 };
    }
  }

  function makeDockPill(id, isCurrent, count, isEmpty, isRemote) {
    let pill = null;
    try {
      pill = document.createElement("div");
      pill.className = "aph-ws-pill";
      pill.setAttribute("data-ws", id);
      pill.setAttribute("role", "button");
      if (isCurrent) {
        pill.setAttribute("data-current", "1");
      }
      if (isRemote && !isCurrent) {
        try {
          pill.setAttribute("data-remote", "1");
        } catch (e) {}
      }
      if (isEmpty) {
        try {
          pill.setAttribute("data-empty", "1");
        } catch (e) {}
      }
      const glyph = dockGlyph(id);
      pill.textContent = glyph;
      // Remote pills show a dot, never a local count (counts are per-window
      // adoption state — a number here would mislead).
      if (isRemote && !isCurrent) {
        try {
          const dot = document.createElement("span");
          dot.className = "aph-ws-count";
          dot.textContent = "•";
          pill.appendChild(dot);
        } catch (e) {}
      } else if (count > 0) {
        try {
          const badge = document.createElement("span");
          badge.className = "aph-ws-count";
          badge.textContent = String(count);
          pill.appendChild(badge);
        } catch (e) {}
      }
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
      try {
        const bid = getWsContainerId(id);
        if (bid) {
          const d = describeContainer(bid);
          if (d && d.name) {
            title += ` · ${d.name} container`;
          }
          if (d && d.color && CONTAINER_HEX[d.color]) {
            pill.style.boxShadow = `inset 0 -2px 0 ${CONTAINER_HEX[d.color]}`;
          }
        }
      } catch (e) {}
      // During a tab drag the tooltip previews the move (tree/group aware).
      try {
        if (isRemote && !isCurrent && !dockDragActive) {
          pill.title = `${title} — open on another window (click to focus)`;
        } else if (dockDragActive) {
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
        pill.addEventListener("click", () => {
          try {
            if (id === current) {
              pulseWorkspaceIndicator();
              return;
            }
            // Remote pill: focus-jump to the owning window (V1 has no
            // steal — switchTo would do the same, but resolve the owner
            // here so a stale render never mistriggers a pull).
            if (isRemote) {
              try {
                const owner =
                  typeof findWsOwner === "function" ? findWsOwner(id) : null;
                if (owner && owner !== window) {
                  if (typeof focusWsOwner === "function") {
                    focusWsOwner(owner);
                  } else if (typeof owner.focus === "function") {
                    owner.focus();
                  }
                  try {
                    pulseWorkspaceIndicator();
                  } catch (_e) {}
                  return;
                }
              } catch (_e) {}
            }
            switchTo(id);
          } catch (e) {}
        });
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
            if (id === current) {
              return false;
            }
            // Remote workspaces live elsewhere: drops would retag locally
            // into a hidden state the owner can't see. Not a target in V1.
            try {
              if (typeof getRemoteOwners === "function" && getRemoteOwners()[id]) {
                return false;
              }
            } catch (err) {}
            if (isRemote) {
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
            // Remote workspaces live elsewhere (see armDrop): never accept
            // drops in V1, even if the render went stale mid-drag.
            try {
              if (isRemote) {
                pulseWorkspaceIndicator();
                return;
              }
              if (typeof getRemoteOwners === "function" && getRemoteOwners()[id]) {
                pulseWorkspaceIndicator();
                return;
              }
            } catch (err) {}
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
      pill = document.createElement("div");
      pill.className = "aph-ws-pill aph-ws-add";
      pill.textContent = "+";
      pill.title = free
        ? `New workspace ${free} (click: switches here, opens a tab · drop: moves tab(s) here)`
        : "All 9 workspaces active";
      try {
        pill.addEventListener("click", () => {
          try {
            plusToWorkspace();
          } catch (e) {}
        });
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

  function aphOpenArchive() {
    try {
      const a = window.AphArchive || null;
      if (a && typeof a.openArchive === "function" && a.openArchive()) {
        return;
      }
    } catch (e) {}
    try {
      aphOpenTab("chrome://browser/content/aph-archive.html");
    } catch (e) {}
  }

  function aphArchiveCurrent() {
    try {
      const a = window.AphArchive || null;
      if (a && typeof a.archiveCurrent === "function") {
        a.archiveCurrent();
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
      });
      if (pal) {
        try {
          pal.setAttribute("shortcut", "Ctrl+K");
        } catch (err) {}
        try {
          menu.appendChild(pal);
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
      });
      if (rename) {
        try {
          menu.appendChild(rename);
        } catch (err) {}
      }
      try {
        if (typeof isPrivateWindow === "function" ? !isPrivateWindow() : true) {
          const bindMenu =
            typeof document.createXULElement === "function"
              ? document.createXULElement("menu")
              : document.createElement("menu");
          bindMenu.setAttribute("label", `Bind ${head} to Container…`);
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
      let archTitle = "Archive Current Tab";
      try {
        if (typeof archiveCmdTitle === "function") {
          archTitle = archiveCmdTitle();
        }
      } catch (err) {}
      const arch = makeDockMenuItem("aph-aph-archive", archTitle, () => {
        try {
          aphArchiveCurrent();
        } catch (err) {}
      });
      if (arch) {
        try {
          menu.appendChild(arch);
        } catch (err) {}
      }
      const openArch = makeDockMenuItem("aph-aph-open-archive", "Open Archive", () => {
        try {
          aphOpenArchive();
        } catch (err) {}
      });
      if (openArch) {
        try {
          menu.appendChild(openArch);
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
      });
      if (cust) {
        try {
          menu.appendChild(cust);
        } catch (err) {}
      }
      const prefs = makeDockMenuItem("aph-aph-settings", "Aph Settings…", () => {
        try {
          aphOpenTab("about:config?filter=aph");
        } catch (err) {}
      });
      if (prefs) {
        try {
          menu.appendChild(prefs);
        } catch (err) {}
      }
      const about = makeDockMenuItem("aph-aph-about", "About Aph", () => {
        try {
          aphOpenTab("https://aph-browser.github.io/");
        } catch (err) {}
      });
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

  function makeDockAph() {
    let btn = null;
    try {
      btn = document.createElement("div");
      btn.className = "aph-dock-aph";
      btn.setAttribute("role", "button");
      btn.setAttribute("tabindex", "0");
      btn.textContent = "Aph";
      btn.title = "Aph — menu · click for Aph actions · right-click for workspace actions";
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
      try {
        btn.addEventListener("keydown", (e) => {
          try {
            if (e && (e.key === "Enter" || e.key === " ")) {
              if (typeof e.preventDefault === "function") {
                e.preventDefault();
              }
              openAphMenu(btn, null);
            }
          } catch (_e) {}
        });
      } catch (e) {}
      try {
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
            const menu = typeof ensureDockMenu === "function" ? ensureDockMenu() : null;
            const id =
              typeof current !== "undefined" && typeof isValidId === "function" && isValidId(current)
                ? current
                : "1";
            if (menu) {
              try {
                menu.setAttribute("data-ws", id);
              } catch (_e) {}
              if (typeof menu.openPopupAtScreen === "function" && e) {
                menu.openPopupAtScreen(e.screenX, e.screenY, true);
                return;
              }
              if (typeof menu.openPopup === "function") {
                menu.openPopup(btn, "after_start", 0, 0, true, false, e);
                return;
              }
            }
          } catch (_e) {}
          aphDockOpenPalette();
        });
      } catch (e) {}
    } catch (e) {
      btn = null;
    }
    return btn;
  }

  function renderDock() {
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
      // Normal mode shows active workspaces only (plus current) UNION
      // remote-owned workspaces (zero local tabs, but the user must see
      // where their tabs live to focus-jump back).
      let ids = [];
      try {
        ids = getActiveIds();
      } catch (e) {
        ids = [];
      }
      const cur = isValidId(current) ? current : "1";
      const counts = dockCounts();
      let remote = null;
      try {
        remote = typeof getRemoteOwners === "function" ? getRemoteOwners() : null;
      } catch (e) {
        remote = null;
      }
      const isRemoteId = (id) => {
        try {
          return !!(remote && remote[id] && id !== cur);
        } catch (e) {
          return false;
        }
      };
      if (!dockDragActive && remote) {
        try {
          const union = new Set(ids);
          for (const k of Object.keys(remote)) {
            if (isValidId(k)) {
              union.add(k);
            }
          }
          ids = [...union].sort();
        } catch (e) {}
      }
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
              !ids.includes(id),
              isRemoteId(id)
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
            const pill = makeDockPill(id, id === cur, counts[id] || 0, false, isRemoteId(id));
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

  function makeDockMenuItem(id, label, action, disabled) {
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
      // Remote workspaces live elsewhere: local unload/close would act on
      // zero local tabs and mislead. Rename/bind stay (global prefs).
      let isRemoteWs = false;
      try {
        isRemoteWs =
          id !== current &&
          typeof getRemoteOwners === "function" &&
          !!getRemoteOwners()[id];
      } catch (err) {
        isRemoteWs = false;
      }
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
      const unload = makeDockMenuItem(
        "aph-dock-unload",
        isRemoteWs ? "Unload Inactive Tabs (open on another window)" : "Unload Inactive Tabs",
        () => {
          try {
            unloadEligibleTabs({ scope: "workspace", ws: id });
            renderDock();
          } catch (err) {}
        },
        id === current || isRemoteWs
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
        isRemoteWs
          ? "Close Workspace (open on another window)"
          : count > 0 ? `Close Workspace (${count} tab${count === 1 ? "" : "s"})` : "Close Workspace",
        () => {
          try {
            closeWorkspaceTabs(id);
          } catch (err) {}
        },
        count === 0 || isRemoteWs
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
      anchor.appendChild(dock);
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
  // something else is selected. Trees ride along via sendTabTo's
  // auto-carry; whole groups stay joined via preservation.
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
