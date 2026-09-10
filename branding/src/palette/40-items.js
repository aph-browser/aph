  function commands() {
    const api = ws();
    const cmds = [];
    // Workspaces (custom name + bound container shown when present)
    for (let i = 1; i <= 9; i++) {
      const n = String(i);
      cmds.push({
        title: `Switch to ${wsFull(api, n)}`,
        hint: `Alt+Shift+${n}`,
        run: () => api && api.switchTo(n),
      });
    }
    for (let i = 1; i <= 9; i++) {
      const n = String(i);
      cmds.push({
        title: sendTabTitle(api, n),
        hint: `Ctrl+Alt+${n}`,
        run: () => api && api.sendTabTo(n),
      });
    }
    try {
      if (api && api.getCurrent) {
        const cur = api.getCurrent();
        cmds.push({
          title: `Rename ${wsFull(api, cur)}…`,
          hint: "Ctrl+Alt+R",
          keepOpen: true,
          run: () => renameCurrent(),
        });
      }
    } catch (e) {}
    cmds.push({
      title: "Rename Tab…",
      hint: "",
      sub: "Custom label for the current tab · empty clears",
      keepOpen: true,
      run: () => renameCurrentTab(),
    });
    // Tabs / windows
    cmds.push(
      {
        title: "New Tab",
        hint: "Ctrl+T",
        run: () => gBrowser.addTrustedTab("about:newtab"),
      },
      {
        title: "New Temp Container Tab",
        hint: "Ctrl+Alt+T",
        run: () => api && api.openTempTab(),
      },
      {
        title: "Open Bound Container Tab",
        hint: "Ctrl+T in bound WS",
        run: () => api && api.openBoundTab && api.openBoundTab(),
      },
      {
        title: "Bind Current Workspace to This Tab's Container",
        hint: "Ctrl+Alt+B",
        run: () => api && api.bindCurrentWs && api.bindCurrentWs(),
      },
      {
        title: "Clear Current Workspace Container Binding",
        hint: "",
        run: () => {
          try {
            if (api && api.clearWsBinding && api.getCurrent) {
              api.clearWsBinding(api.getCurrent());
            }
          } catch (e) {}
        },
      },
      {
        title: "Close Current Tab",
        hint: "Ctrl+W",
        run: () => gBrowser.removeCurrentTab(),
      },
      {
        title: "Reopen Closed Tab",
        hint: "Ctrl+Shift+T",
        run: () => {
          try {
            SessionStore.undoCloseTab(window, 0);
          } catch (e) {}
        },
      },
      {
        title: "Unload Inactive Tabs",
        hint: "",
        sub: "Discards hidden-workspace tabs to save memory · click reloads",
        run: () => {
          try {
            if (api && api.unloadEligibleTabs) {
              api.unloadEligibleTabs({ scope: "foreign" });
            }
          } catch (e) {}
        },
      },
      {
        title: archiveCmdTitle(),
        hint: "",
        sub: "Saves workspace + container, closes the tab · restorable",
        run: () => {
          try {
            if (arc() && arc().archiveCurrent) {
              arc().archiveCurrent();
            }
          } catch (e) {}
        },
      },
      {
        title: "Open Archive",
        hint: "",
        sub: "Browse and restore archived tabs with full context",
        run: () => {
          try {
            if (arc() && arc().openArchive && arc().openArchive()) {
              return;
            }
          } catch (e) {}
          try {
            const t = gBrowser.addTrustedTab(
              "chrome://browser/content/aph-archive.html"
            );
            try {
              gBrowser.selectedTab = t;
            } catch (_e) {}
          } catch (e) {}
        },
      },
      {
        title: "Copy Text From Page…",
        hint: "Ctrl+Alt+C",
        sub: "Hover to highlight a block · click copies · ↑/↓ adjust · Esc cancels",
        run: () => {
          try {
            if (window.AphTextPick) {
              window.AphTextPick.arm();
            }
          } catch (e) {}
        },
      },
      {
        title: "Duplicate Current Tab",
        hint: "",
        run: () => {
          try {
            gBrowser.duplicateTab(gBrowser.selectedTab);
          } catch (e) {}
        },
      },
      {
        title: "Reload",
        hint: "Ctrl+R",
        run: () => {
          try {
            gBrowser.reload();
          } catch (e) {}
        },
      },
      {
        title: "Go Back",
        hint: "Alt+Left",
        run: () => {
          try {
            gBrowser.goBack();
          } catch (e) {}
        },
      },
      {
        title: "Go Forward",
        hint: "Alt+Right",
        run: () => {
          try {
            gBrowser.goForward();
          } catch (e) {}
        },
      },
      {
        title: "New Window",
        hint: "Ctrl+N",
        run: () => {
          try {
            window.OpenBrowserWindow();
          } catch (e) {}
        },
      },
      {
        title: "Focus Address Bar",
        hint: "Ctrl+L",
        run: () => {
          try {
            gURLBar.focus();
          } catch (e) {}
        },
      }
    );
    return cmds;
  }

  function openTabs() {
    let tabs = [];
    try {
      tabs = Array.from(gBrowser.tabs).filter((t) => !t.closing);
    } catch (e) {
      return [];
    }
    const api = ws();
    // MRU first — DOM order buries the tab you used 30 seconds ago.
    // The active tab is excluded: no reason to switch to where you are.
    try {
      const sel = gBrowser.selectedTab;
      tabs = tabs.filter((t) => t !== sel);
    } catch (e) {}
    tabs.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0));
    return tabs.map((t) => {
      let label = "Untitled";
      try {
        label = t.label || label;
      } catch (e) {}
      // Right-aligned badge (WS · container · pinned); the URL gets the
      // sub line so titles stay scannable without a "Go to Tab:" prefix.
      const badge = [];
      try {
        if (api) {
          badge.push(`WS ${api.getWs(t)}`);
        } else if (t.hidden) {
          badge.push("hidden");
        }
      } catch (e) {}
      try {
        const cid = t.userContextId || 0;
        if (cid && api && api.describeContainer) {
          const d = api.describeContainer(cid);
          if (d && d.name) {
            badge.push(d.name);
          }
        }
      } catch (e) {}
      try {
        if (t.pinned) {
          badge.push("pinned");
        }
      } catch (e) {}
      let url = "";
      try {
        url = t.linkedBrowser.currentURI.spec || "";
      } catch (e) {}
      return {
        title: label,
        sub: url,
        hint: badge.join(" · "),
        run: () => {
          try {
            // Workspace-safe: a tab from another workspace must pull us
            // there via switchTo (which reconciles visibility + indicator).
            // Bare showTab+select would strand the foreign tab in the
            // current workspace and desync everything.
            if (api && api.getWs && api.getCurrent && api.switchTo) {
              let target = null;
              let cur = null;
              try {
                target = api.getWs(t);
              } catch (_e) {}
              try {
                cur = api.getCurrent();
              } catch (_e) {}
              if (target && cur && target !== cur) {
                api.switchTo(target);
              }
            }
          } catch (e) {}
          try {
            // A tab inside a collapsed group stays hidden even when
            // selected — expand first so it is actually visible.
            // Same pattern as reconcile() in workspaces.js.
            if (t.group && t.group.collapsed) {
              t.group.collapsed = false;
            }
            if (t.hidden) {
              gBrowser.showTab(t);
            }
            gBrowser.selectedTab = t;
          } catch (e) {}
        },
      };
    });
  }

  // Host of the active tab ("" unless it's a real http(s) page).
  function currentHost() {
    try {
      const spec = gBrowser.selectedTab?.linkedBrowser?.currentURI?.spec || "";
      if (!/^https?:\/\//i.test(spec)) {
        return "";
      }
      try {
        return (new URL(spec).hostname || "").toLowerCase().replace(/\.$/, "");
      } catch (e) {
        const m = spec.match(/^https?:\/\/([^/:?#]+)/i);
        return m ? m[1].toLowerCase().replace(/\.$/, "") : "";
      }
    } catch (e) {
      return "";
    }
  }

  // "Route github.com to Workspace N" × 9 for the active site. Titles
  // start with "Route" so typing `route` lists them all inline.
  function routeCommands(api, host) {
    let cur = "";
    try {
      cur = (api.getRoutes() || {})[host] || "";
    } catch (e) {}
    const out = [];
    for (let i = 1; i <= 9; i++) {
      const n = String(i);
      out.push({
        title: `Route ${host} to ${wsFull(api, n)}`,
        sub: cur
          ? `Currently routes to Workspace ${cur} · Enter rebinds to ${n}`
          : "New domain route · future tabs on this host open there",
        hint: "Enter",
        run: () => {
          try {
            api.setRoute(host, n);
          } catch (e) {}
        },
      });
    }
    return out;
  }

  // One row per active rule; Enter deletes it. Titles start with "Route"
  // so typing `route`/`routes` surfaces the whole list.
  function ruleRows(api) {
    let rules = {};
    try {
      rules = api.getRoutes() || {};
    } catch (e) {
      return [];
    }
    return Object.keys(rules)
      .sort()
      .map((host) => {
        const n = rules[host];
        let note = "";
        try {
          if (api.getWsContainer && api.describeContainer) {
            const id = api.getWsContainer(n);
            if (id) {
              const d = api.describeContainer(id);
              if (d && d.name) {
                note = ` · ${d.name} container`;
              }
            }
          }
        } catch (e) {}
      return {
        title: `Route ${host} → ${wsFull(api, n)}`,
        sub: `Active domain route${note} · applies to freshly opened tabs`,
        hint: "Enter removes",
        run: () => {
          try {
            api.deleteRoute(host);
          } catch (e) {}
        },
      };
      });
  }

  function allItems(filter) {
    const raw = (filter || "").trim();
    const pool = [...commands(), ...openTabs()];
    if (!raw) {
      return pool.slice(0, 50);
    }
    // Domain routes live outside the default view (empty query stays
    // clean) but join the pool for any real query.
    try {
      const api = ws();
      if (api && api.getRoutes) {
        for (const r of ruleRows(api)) {
          pool.push(r);
        }
        if (api.setRoute) {
          const host = currentHost();
          if (host) {
            for (const c of routeCommands(api, host)) {
              pool.push(c);
            }
          }
        }
      }
    } catch (e) {}
    const q = raw.toLowerCase();
    const scored = [];
    pool.forEach((it, i) => {
      const m = matchItem(it, q);
      if (m) {
        scored.push({ it, score: m.score, order: i, ti: m.ti, si: m.si, hi: m.hi });
      }
    });
    // Stable: higher score first, pool order breaks ties.
    scored.sort((a, b) => b.score - a.score || a.order - b.order);
    const out = scored.slice(0, 50).map((s) => {
      s.it._hl = { t: new Set(s.ti), s: new Set(s.si), h: new Set(s.hi) };
      return s.it;
    });
    const fb = navFallback(raw);
    if (fb) {
      // Direct URL navigation wins over fuzzy matches: typing "github.com"
      // means Go to, not a command that happens to fuzzy-match. Search
      // fallbacks stay at the bottom — they're the last resort.
      if (isLikelyURL(raw)) {
        out.unshift(fb);
      } else {
        out.push(fb);
      }
    }
    return out;
  }

