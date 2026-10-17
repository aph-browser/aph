  // Tab context-menu "Move to Workspace" submenus: the mouse-first path for
  // moving tabs and native groups across workspaces. Two variants
  // share one target-resolution rule (clicked tab wins; its live
  // multiselection rides along when the click belongs to it):
  // - "Move Tab(s) to Workspace >" — always shown, calls sendTabTo (which
  //   preserves whole groups).
  // - "Move Group to Workspace >" — only when the clicked tab sits in a
  //   native group of 2+; calls sendGroupTo (whole group, membership kept).
  // Space variants ("Move Tab(s)/Group to Space >", 77-spaces.js folders)
  // follow the same rule: rows are the CURRENT workspace's spaces; grouped
  // targets tag every member (the group's folder resolves by plurality),
  // and a group click rewrites all members. Current folder rows render
  // disabled, "Remove from Space" clears values (folders and groups stay).
  // Pinned tabs never join (assign refuses), so the tab submenu hides for
  // a pinned click.
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

  // Spaces of the current workspace as menu rows. showRemove is resolved
  // by the caller from the RAW value (a stale id has no registry row, so
  // the remove path must not depend on one). Returns rows appended to one
  // submenu: each space (current one disabled), then a separator + remove.
  function appendSpaceSubmenu(
    menu,
    topId,
    topLabel,
    spaces,
    currentSid,
    onAssign,
    onRemove,
    showRemove
  ) {
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
      for (const s of spaces) {
        if (!s || !s.id) {
          continue;
        }
        const item = makeMoveMenuNode(
          "menuitem",
          `${topId}-${s.id}`,
          s.name || s.id,
          s.id === currentSid
        );
        if (!item) {
          continue;
        }
        if (typeof item.addEventListener === "function") {
          const sid = s.id;
          item.addEventListener("command", () => {
            try {
              onAssign(sid);
            } catch (err) {}
          });
        }
        try {
          popup.appendChild(item);
        } catch (e) {}
      }
      if (showRemove && typeof onRemove === "function") {
        const sep = makeMoveMenuNode("menuseparator", `${topId}-sep`, "", false);
        if (sep) {
          try {
            popup.appendChild(sep);
          } catch (e) {}
        }
        const rm = makeMoveMenuNode(
          "menuitem",
          `${topId}-remove`,
          "Remove from Space",
          false
        );
        if (rm) {
          if (typeof rm.addEventListener === "function") {
            rm.addEventListener("command", () => {
              try {
                onRemove();
              } catch (err) {}
            });
          }
          try {
            popup.appendChild(rm);
          } catch (e) {}
        }
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

  // Current-workspace space rows, or null when the runtime has no spaces
  // (older bundle shapes / tests). Registry reads only; assignment gates
  // live in 77.
  function moveMenuSpaces() {
    try {
      if (typeof listSpaces !== "function" || !isValidId(current)) {
        return null;
      }
      const spaces = listSpaces(current) || [];
      return spaces.length ? spaces : null;
    } catch (e) {
      return null;
    }
  }

  // A group's folder for menu purposes: the plurality pick, else any
  // member's raw value (a stale id still gets a remove row).
  function moveMenuGroupSpace(group) {
    try {
      if (typeof spaceOfGroup === "function") {
        const sid = spaceOfGroup(group) || "";
        if (sid) {
          return sid;
        }
      }
      if (typeof getTabSpace === "function") {
        let members = [];
        try {
          members =
            typeof groupMembers === "function"
              ? groupMembers(group)
              : (group && group.tabs) || [];
        } catch (e) {
          members = [];
        }
        for (const m of members || []) {
          try {
            const sid = getTabSpace(m);
            if (sid) {
              return sid;
            }
          } catch (e) {}
        }
      }
    } catch (e) {}
    return "";
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
      // Space variants (77-spaces.js folders inside the current
      // workspace): tab first, then group — same layering as the
      // workspace pair above. Rows list current-workspace spaces only;
      // cross-workspace folders are refused by the assign APIs anyway.
      try {
        const spaces = moveMenuSpaces();
        let showRemove = false;
        if (typeof getTabSpace === "function") {
          for (const t of targets) {
            try {
              if (getTabSpace(t)) {
                showRemove = true;
                break;
              }
            } catch (err) {}
          }
        }
        if (!clicked.pinned && (spaces || showRemove)) {
          const rows = (spaces || []).slice();
          let curSid = "";
          try {
            if (typeof getTabSpace === "function") {
              curSid = getTabSpace(clicked) || "";
            }
          } catch (err) {}
          appendSpaceSubmenu(
            menu,
            "aph-move-space-tab",
            n > 1 ? `Move ${n} Tabs to Space` : "Move Tab to Space",
            rows,
            curSid,
            (sid) => {
              if (typeof assignTabToSpace !== "function") {
                return;
              }
              for (const t of targets) {
                try {
                  assignTabToSpace(t, sid);
                } catch (err) {}
              }
            },
            () => {
              if (typeof unassignTabFromSpace !== "function") {
                return;
              }
              for (const t of targets) {
                try {
                  unassignTabFromSpace(t);
                } catch (err) {}
              }
            },
            showRemove
          );
        }
      } catch (err) {}
      try {
        const ginfo = moveMenuGroupOf(clicked);
        const spaces = moveMenuSpaces();
        if (ginfo) {
          const curSid = moveMenuGroupSpace(ginfo.group);
          const showRemove = !!curSid;
          if (spaces || showRemove) {
            appendSpaceSubmenu(
              menu,
              "aph-move-space-group",
              `Move Group (${ginfo.members.length} Tabs) to Space`,
              (spaces || []).slice(),
              curSid,
              (sid) => {
                if (typeof assignGroupToSpace !== "function") {
                  return;
                }
                try {
                  assignGroupToSpace(ginfo.group, sid);
                } catch (err) {}
              },
              () => {
                if (typeof unassignGroup !== "function") {
                  return;
                }
                try {
                  unassignGroup(ginfo.group);
                } catch (err) {}
              },
              showRemove
            );
          }
        }
      } catch (err) {}
      // Unload variant (Firefox 140 parity): discard the clicked tab via
      // unloadSingleTab (selected tabs move selection to a neighbor first —
      // stock refuses selected-tab discard). Guarded tabs render disabled
      // rather than vanishing, so the row is a stable landmark. The probe
      // discounts "selected" (the unload path moves selection first) but
      // never discounts pinned — app anchors always read disabled.
      try {
        if (typeof unloadSingleTab === "function") {
          let unloadable = false;
          try {
            if (typeof canUnloadTab === "function") {
              const c = canUnloadTab(clicked);
              if (c.ok) {
                unloadable = true;
              } else if (
                c.reason === "selected" &&
                !clicked.pinned &&
                typeof findParkNeighbor === "function" &&
                !!findParkNeighbor(clicked)
              ) {
                unloadable = true;
              }
            }
          } catch (err) {
            unloadable = false;
          }
          const uitem = makeMoveMenuNode(
            "menuitem",
            "aph-unload-tab",
            n > 1 ? `Unload ${n} Tabs` : "Unload Tab",
            !unloadable
          );
          if (uitem) {
            if (typeof uitem.addEventListener === "function") {
              const unl = targets.slice();
              uitem.addEventListener("command", () => {
                try {
                  for (const t of unl) {
                    try {
                      unloadSingleTab(t);
                    } catch (_e) {}
                  }
                  if (typeof renderDock === "function") {
                    renderDock();
                  }
                } catch (err) {}
              });
            }
            try {
              menu.appendChild(uitem);
              moveMenuItems.push(uitem);
            } catch (err) {}
          }
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
