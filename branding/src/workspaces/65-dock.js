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
  // ref, so track dragstart on the shared tab container instead).
  let dockDragTab = null;

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

  function makeDockPill(id, isCurrent, count) {
    let pill = null;
    try {
      pill = document.createElement("div");
      pill.className = "aph-ws-pill";
      pill.setAttribute("data-ws", id);
      pill.setAttribute("role", "button");
      if (isCurrent) {
        pill.setAttribute("data-current", "1");
      }
      const glyph = dockGlyph(id);
      pill.textContent = glyph;
      if (count > 0) {
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
      pill.title = `${title} — click to switch, right-click for actions`;
      try {
        pill.addEventListener("click", () => {
          try {
            if (id === current) {
              pulseWorkspaceIndicator();
              return;
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
        pill.addEventListener("dragover", (e) => {
          try {
            if (!dockDragTab) {
              return;
            }
            e.preventDefault();
            try {
              e.dataTransfer.dropEffect = "move";
            } catch (err) {}
            pill.classList.add("drop-target");
          } catch (err) {}
        });
        pill.addEventListener("dragleave", () => {
          try {
            pill.classList.remove("drop-target");
          } catch (err) {}
        });
        pill.addEventListener("drop", (e) => {
          try {
            e.preventDefault();
            pill.classList.remove("drop-target");
            if (dockDragTab) {
              sendTabTo(id);
            }
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
        ? `New workspace ${free} (switches here, opens a tab)`
        : "All 9 workspaces active";
      try {
        pill.addEventListener("click", () => {
          try {
            plusToWorkspace();
          } catch (e) {}
        });
      } catch (e) {}
    } catch (e) {
      pill = null;
    }
    return pill;
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
      const ids = getActiveIds();
      const cur = isValidId(current) ? current : "1";
      const counts = dockCounts();
      for (const id of ids) {
        try {
          const pill = makeDockPill(id, id === cur, counts[id] || 0);
          if (pill) {
            dock.appendChild(pill);
          }
        } catch (e) {}
      }
      try {
        const plus = makeDockPlus(lowestInactiveId(ids));
        if (plus) {
          dock.appendChild(plus);
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
      const t = e && e.target;
      const tab =
        t && typeof t.closest === "function" ? t.closest("tab") : null;
      if (tab && !tab.closing) {
        dockDragTab = tab;
      }
    } catch (err) {
      dockDragTab = null;
    }
  }

  function onDockDragEnd() {
    try {
      dockDragTab = null;
      const dock = document.getElementById(DOCK_ID);
      if (dock && typeof dock.querySelectorAll === "function") {
        for (const p of Array.from(dock.querySelectorAll(".drop-target"))) {
          try {
            p.classList.remove("drop-target");
          } catch (err) {}
        }
      }
    } catch (e) {}
  }

  function cleanupDock() {
    try {
      dockDragTab = null;
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
      if (gBrowser && gBrowser.tabContainer) {
        gBrowser.tabContainer.removeEventListener("dragstart", onDockDragStart);
      }
    } catch (e) {}
    try {
      window.removeEventListener("dragend", onDockDragEnd);
    } catch (e) {}
  }

  function initDock() {
    try {
      renderDock();
    } catch (e) {}
    try {
      if (gBrowser && gBrowser.tabContainer) {
        gBrowser.tabContainer.addEventListener("dragstart", onDockDragStart);
      }
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
