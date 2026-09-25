  // Tab context-menu "Move to Workspace" submenus: the mouse-first path for
  // moving tabs and native groups across workspaces. Two variants
  // share one target-resolution rule (clicked tab wins; its live
  // multiselection rides along when the click belongs to it):
  // - "Move Tab(s) to Workspace >" — always shown, calls sendTabTo (which
  //   preserves whole groups).
  // - "Move Group to Workspace >" — only when the clicked tab sits in a
  //   native group of 2+; calls sendGroupTo (whole group, membership kept).
  // Labels carry workspace names + bound-container suffixes (palette wsFull
  // pattern, reimplemented here — the palette bundle is a separate scope).
  // XUL hosts need createXULElement (HTML-namespaced duds never render);
  // everything fails silent so a missing tabContextMenu never breaks chrome.
  // popupshowing BUBBLES from nested menupopups: only handle showings that
  // originate on our own menupopup (dock-menu pattern).
  let moveMenuItems = [];

  function clearMoveMenu() {
    try {
      for (const it of moveMenuItems) {
        try {
          if (it && it.parentNode) {
            it.parentNode.removeChild(it);
          } else if (it && typeof it.remove === "function") {
            it.remove();
          }
        } catch (err) {}
      }
    } catch (err) {}
    moveMenuItems = [];
  }

  function moveMenuClickedTab(e) {
    try {
      const popup = e && (e.currentTarget || e.target);
      const node =
        (popup && popup.triggerNode) ||
        (typeof document !== "undefined" && document.popupNode) ||
        null;
      if (node) {
        try {
          const direct =
            node.tab ||
            (typeof node.closest === "function" ? node.closest("tab") : null);
          if (direct) {
            return direct;
          }
        } catch (err) {}
        // Group-label right-click (or any group chrome): resolve to the
        // group's first live member so the Group variant still surfaces.
        try {
          const grp =
            typeof node.closest === "function"
              ? node.closest("tab-group")
              : null;
          if (grp) {
            let ms = [];
            try {
              ms =
                typeof groupMembers === "function"
                  ? groupMembers(grp)
                  : grp.tabs || [];
            } catch (err) {
              ms = [];
            }
            for (const m of ms || []) {
              if (m && !m.closing) {
                return m;
              }
            }
          }
        } catch (err) {}
      }
      if (gBrowser && gBrowser.selectedTab) {
        return gBrowser.selectedTab;
      }
    } catch (err) {}
    return null;
  }

  function moveMenuSelectedTabs(clicked) {
    try {
      if (clicked) {
        try {
          let sel = [];
          try {
            const multi =
              (gBrowser &&
                (gBrowser.selectedTabs || gBrowser.multiselectedTabs)) ||
              null;
            if (Array.isArray(multi) && multi.length) {
              sel = multi.slice();
            } else if (gBrowser && gBrowser.selectedTab) {
              sel = [gBrowser.selectedTab];
            }
          } catch (e) {}
          if (sel.length > 1) {
            try {
              if (sel.includes(clicked)) {
                const live = new Set(Array.from(gBrowser.tabs || []));
                return sel.filter((t) => t && !t.closing && live.has(t));
              }
            } catch (e) {}
          }
        } catch (e) {}
        return [clicked];
      }
    } catch (e) {}
    return [];
  }

  function moveMenuWsLabel(id) {
    try {
      let s = `Workspace ${id}`;
      try {
        const name =
          typeof getWsName === "function" ? getWsName(id) : "";
        if (name) {
          s += ` (${name})`;
        }
      } catch (e) {}
      try {
        if (
          typeof getWsContainerId === "function" &&
          typeof describeContainer === "function"
        ) {
          const bid = getWsContainerId(id);
          if (bid) {
            const d = describeContainer(bid);
            if (d && d.name) {
              s += ` · ${d.name}`;
            }
          }
        }
      } catch (e) {}
      return s;
    } catch (e) {
      return `Workspace ${id}`;
    }
  }

  function makeMoveMenuNode(tag, id, label, disabled) {
    try {
      const el =
        typeof document.createXULElement === "function"
          ? document.createXULElement(tag)
          : document.createElement(tag);
      el.id = id;
      try {
        el.setAttribute("label", label);
      } catch (e) {}
      if (disabled) {
        try {
          el.setAttribute("disabled", "true");
        } catch (e) {}
      }
      return el;
    } catch (e) {
      return null;
    }
  }

  function moveMenuGroupOf(tab) {
    try {
      const g = (tab && tab.group) || null;
      if (!g) {
        return null;
      }
      let members = [];
      try {
        members =
          typeof groupMembers === "function" ? groupMembers(g) : g.tabs || [];
      } catch (e) {
        members = [];
      }
      members = (members || []).filter((t) => t && !t.closing);
      if (members.length < 2) {
        return null;
      }
      return { group: g, members };
    } catch (e) {
      return null;
    }
  }

  function appendMoveSubmenu(menu, topId, topLabel, targets, runner) {
    try {
      const sub = makeMoveMenuNode("menu", topId, topLabel, false);
      if (!sub) {
        return null;
      }
      const popup =
        typeof document.createXULElement === "function"
          ? document.createXULElement("menupopup")
          : document.createElement("menupopup");
      if (!popup || typeof popup.appendChild !== "function") {
        return null;
      }
      let cur = null;
      try {
        cur = isValidId(current) ? current : null;
      } catch (e) {}
      for (let i = 1; i <= 9; i++) {
        const id = String(i);
        const item = makeMoveMenuNode(
          "menuitem",
          `${topId}-${id}`,
          moveMenuWsLabel(id),
          cur ? id === cur : false
        );
        if (!item) {
          continue;
        }
        if (typeof item.addEventListener === "function") {
          item.addEventListener("command", () => {
            try {
              runner(id, targets);
            } catch (err) {}
          });
        }
        try {
          popup.appendChild(item);
        } catch (e) {}
      }
      try {
        sub.appendChild(popup);
      } catch (e) {
        return null;
      }
      try {
        menu.appendChild(sub);
        moveMenuItems.push(sub);
      } catch (e) {
        return null;
      }
      return sub;
    } catch (e) {
      return null;
    }
  }

  function onMoveMenuShowing(e) {
    try {
      const menu = (e && (e.currentTarget || e.target)) || null;
      if (!menu || typeof menu.appendChild !== "function") {
        return;
      }
      try {
        if (!e || e.target !== menu) {
          return;
        }
      } catch (err) {
        return;
      }
      clearMoveMenu();
      const clicked = moveMenuClickedTab(e);
      if (!clicked || clicked.closing) {
        return;
      }
      const targets = moveMenuSelectedTabs(clicked).filter(
        (t) => t && !t.closing
      );
      if (!targets.length) {
        return;
      }
      const n = targets.length;
      const tabLabel =
        n > 1 ? `Move ${n} Tabs to Workspace` : "Move Tab to Workspace";
      try {
        appendMoveSubmenu(menu, "aph-move-tab", tabLabel, targets.slice(), (id, ts) => {
          try {
            if (typeof sendTabTo === "function") {
              sendTabTo(id, ts.length === 1 ? ts[0] : ts.slice());
            }
          } catch (err) {}
        });
      } catch (err) {}
      // Group variant: only when the clicked tab sits in a real group.
      try {
        const info = moveMenuGroupOf(clicked);
        if (info) {
          const gLabel = `Move Group (${info.members.length} Tabs) to Workspace`;
          appendMoveSubmenu(menu, "aph-move-group", gLabel, [clicked], (id, ts) => {
            try {
              if (typeof sendGroupTo === "function") {
                sendGroupTo(id, ts[0]);
              } else if (typeof sendTabTo === "function") {
                sendTabTo(id, info.members.slice());
              }
            } catch (err) {}
          });
        }
      } catch (err) {}
      // Window variant: explicit cross-window move (window-scoped model —
      // the only path that touches another window). Arrivals join the
      // destination's current workspace.
      try {
        if (
          typeof listWindows === "function" &&
          typeof moveTabsToWindow === "function"
        ) {
          const others = listWindows();
          if (others && others.length) {
            const sub = makeMoveMenuNode(
              "menu",
              "aph-move-window",
              n > 1 ? `Move ${n} Tabs to Other Window` : "Move Tab to Other Window",
              false
            );
            if (sub) {
              const popup =
                typeof document.createXULElement === "function"
                  ? document.createXULElement("menupopup")
                  : document.createElement("menupopup");
              if (popup && typeof popup.appendChild === "function") {
                for (const o of others) {
                  try {
                    let wsLabel = "";
                    try {
                      wsLabel = o && isValidId(o.ws) ? o.ws : "?";
                      const nm =
                        typeof getWsName === "function" && isValidId(o.ws)
                          ? getWsName(o.ws)
                          : "";
                      if (nm) {
                        wsLabel += ` (${nm})`;
                      }
                    } catch (err) {}
                    const item = makeMoveMenuNode(
                      "menuitem",
                      "aph-move-window-ws",
                      `Workspace ${wsLabel}`,
                      false
                    );
                    if (!item) {
                      continue;
                    }
                    if (typeof item.addEventListener === "function") {
                      const dest = o.win;
                      const moving = targets.slice();
                      item.addEventListener("command", () => {
                        try {
                          moveTabsToWindow(dest, moving);
                        } catch (err) {}
                      });
                    }
                    try {
                      popup.appendChild(item);
                    } catch (err) {}
                  } catch (err) {}
                }
                try {
                  sub.appendChild(popup);
                } catch (err) {}
                try {
                  menu.appendChild(sub);
                  moveMenuItems.push(sub);
                } catch (err) {}
              }
            }
          }
        }
      } catch (err) {}
    } catch (err) {}
  }

  function cleanupMoveMenu() {
    try {
      clearMoveMenu();
    } catch (e) {}
    try {
      const menu = document.getElementById("tabContextMenu");
      if (menu) {
        menu.removeEventListener("popupshowing", onMoveMenuShowing);
      }
    } catch (e) {}
  }

  function initMoveMenu() {
    try {
      const menu = document.getElementById("tabContextMenu");
      if (menu && typeof menu.addEventListener === "function") {
        menu.addEventListener("popupshowing", onMoveMenuShowing);
      }
    } catch (e) {}
    try {
      window.addEventListener("unload", cleanupMoveMenu, { once: true });
    } catch (e) {}
  }

  if (document.readyState === "complete") {
    initMoveMenu();
  } else {
    window.addEventListener("load", initMoveMenu, { once: true });
  }
