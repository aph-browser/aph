  // Dock-parity bind rows (flat — the palette has no nested menus).
  // Titles start with "Bind" so typing `bind` lists them all inline
  // (same pattern as routeCommands below). Private windows hide all
  // rows (dock parity: containers don't exist there). Fully guarded:
  // the workspaces API may be absent or partial (tests).
  function isPrivatePaletteWindow() {
    try {
      const pbu = window.PrivateBrowsingUtils;
      if (pbu && typeof pbu.isWindowPrivate === "function") {
        return !!pbu.isWindowPrivate(window);
      }
    } catch (e) {}
    return false;
  }

  // --- Sections / tagging / per-open cache -------------------------------
  function tag(it, kind, section) {
    try {
      if (it && !it.kind) {
        it.kind = kind;
      }
      if (it && !it.section) {
        it.section = section;
      }
      if (it && !it.icon) {
        try {
          it.icon = (typeof KIND_ICONS !== "undefined" && KIND_ICONS[kind]) || "";
        } catch (_e) {}
      }
    } catch (e) {}
    return it;
  }

  function tagPool(pool, kind, section) {
    try {
      for (const it of pool || []) {
        tag(it, kind, section);
      }
    } catch (e) {}
    return pool;
  }

  function isWorkspaceCommandTitle(title) {
    try {
      return /^(Switch to |Send (Active|Group|\d+ Tabs)|Route |Bind |Rename )/i.test(
        String(title || "")
      );
    } catch (e) {
      return false;
    }
  }

  function splitWorkspaceCommands(cmds) {
    const ws = [];
    const rest = [];
    try {
      for (const c of cmds || []) {
        if (isWorkspaceCommandTitle(c && c.title)) {
          tag(c, "workspace", "Workspaces");
          ws.push(c);
        } else {
          tag(c, "command", "Commands");
          rest.push(c);
        }
      }
    } catch (e) {}
    return { ws, rest };
  }

  function getCachedCommands() {
    try {
      if (!cachedCommands) {
        const base = commands() || [];
        let extra = [];
        try {
          extra = tabActions() || [];
        } catch (e) {}
        cachedCommands = [...base, ...extra];
        tagPool(cachedCommands, "command", "Commands");
        // tabActions() already tagged action/Commands — restore that tag.
        try {
          for (const it of extra) {
            it.kind = "action";
            it.section = "Commands";
            if (!it.icon) {
              it.icon = KIND_ICONS.action;
            }
          }
        } catch (e) {}
      }
      return cachedCommands;
    } catch (e) {
      return [];
    }
  }

  function getCachedTabs() {
    try {
      if (!cachedTabs) {
        cachedTabs = openTabs() || [];
        tagPool(cachedTabs, "tab", "Tabs");
      }
      return cachedTabs;
    } catch (e) {
      return [];
    }
  }

  function invalidatePaletteCache() {
    try {
      cachedCommands = null;
      cachedTabs = null;
    } catch (e) {}
  }

  // --- Clipboard + URL helpers (Copy URL / Markdown / Clean) --------------
  function copyStringToClipboard(str) {
    const s = String(str == null ? "" : str);
    if (!s) {
      return false;
    }
    try {
      if (typeof Cc !== "undefined" && typeof Ci !== "undefined" && Cc && Ci) {
        try {
          const helper = Cc["@mozilla.org/widget/clipboardhelper;1"].getService(
            Ci.nsIClipboardHelper
          );
          if (helper && typeof helper.copyString === "function") {
            helper.copyString(s);
            return true;
          }
        } catch (e) {}
      }
    } catch (e) {}
    try {
      if (
        window &&
        window.navigator &&
        window.navigator.clipboard &&
        typeof window.navigator.clipboard.writeText === "function"
      ) {
        window.navigator.clipboard.writeText(s);
        return true;
      }
    } catch (e) {}
    try {
      const ta = document.createElement("textarea");
      ta.value = s;
      (document.body || document.documentElement).appendChild(ta);
      try {
        ta.select();
      } catch (_e) {}
      let ok = false;
      try {
        ok = document.execCommand("copy");
      } catch (_e) {}
      try {
        ta.remove();
      } catch (_e) {}
      if (ok) {
        return true;
      }
    } catch (e) {}
    return false;
  }

  function currentTabURL() {
    try {
      return gBrowser.selectedTab?.linkedBrowser?.currentURI?.spec || "";
    } catch (e) {
      return "";
    }
  }

  function currentTabTitle() {
    try {
      return (
        (gBrowser.selectedTab && gBrowser.selectedTab.label) ||
        currentTabURL() ||
        "Untitled"
      );
    } catch (e) {
      return "Untitled";
    }
  }

  // Strip tracking garbage: utm_*, fbclid, gclid/gclsrc, dclid, msclkid,
  // mc_* (mailchimp), _hs* (hubspot), igshid, si, ref/ref_*, sc_*. Keeps
  // the rest of the query + hash intact. Never throws; returns input.
  function cleanURLForCopy(url) {
    const input = String(url || "");
    if (!input) {
      return input;
    }
    try {
      const u = new URL(input);
      const drop = (k) => {
        const key = String(k || "");
        if (!key) {
          return false;
        }
        if (/^utm_/i.test(key)) {
          return true;
        }
        if (/^(fbclid|gclid|gclsrc|dclid|msclkid|igshid|si)$/i.test(key)) {
          return true;
        }
        if (/^(mc_|_hs|ref_|sc_)/i.test(key)) {
          return true;
        }
        if (/^ref$/i.test(key)) {
          return true;
        }
        return false;
      };
      try {
        const keys = [];
        u.searchParams.forEach((_, k) => keys.push(k));
        for (const k of keys) {
          if (drop(k)) {
            u.searchParams.delete(k);
          }
        }
      } catch (e) {}
      let out = u.toString();
      // Tidy "?&" leftovers (URL keeps "?" when empty — drop it).
      out = out.replace(/\?$/, "");
      return out;
    } catch (e) {
      // Non-absolute URL fallback: strip query manually.
      try {
        const qi = input.indexOf("?");
        if (qi === -1) {
          return input;
        }
        const base = input.slice(0, qi);
        const hashIdx = input.indexOf("#");
        const hash = hashIdx !== -1 ? input.slice(hashIdx) : "";
        const qs = input.slice(qi + 1, hashIdx !== -1 ? hashIdx : undefined);
        const kept = qs.split("&").filter((p) => {
          const k = String(p || "").split("=")[0] || "";
          return !/^utm_/i.test(k) && !/^(fbclid|gclid|ref)$/i.test(k);
        });
        return base + (kept.length ? `?${kept.join("&")}` : "") + hash;
      } catch (_e) {
        return input;
      }
    }
  }

  function markdownForTab(title, url) {
    try {
      const t = String(title || "Untitled").replace(/[\[\]]/g, (c) => `\\${c}`);
      return `[${t}](${String(url || "")})`;
    } catch (e) {
      return String(url || "");
    }
  }

  // Extra tab ops for the current tab (surfaced alongside commands).
  // Guarded everywhere: absent gBrowser APIs just hide the row.
  function tabActions() {
    const out = [];
    try {
      let tab = null;
      try {
        tab = (gBrowser && gBrowser.selectedTab) || null;
      } catch (e) {}
      if (!tab) {
        return out;
      }
      const url = currentTabURL();
      const title = currentTabTitle();
      if (url && /^https?:\/\//i.test(url)) {
        out.push({
          title: "Copy URL",
          hint: "",
          sub: url,
          run: () => copyStringToClipboard(url),
        });
        out.push({
          title: "Copy URL as Markdown",
          hint: "",
          sub: markdownForTab(title, url),
          run: () => copyStringToClipboard(markdownForTab(title, url)),
        });
        out.push({
          title: "Clean URL",
          hint: "",
          sub: "Strips utm_*, fbclid, gclid + tracking junk, then copies",
          run: () => copyStringToClipboard(cleanURLForCopy(url)),
        });
      }
      let pinned = false;
      try {
        pinned = !!tab.pinned;
      } catch (e) {}
      out.push({
        title: pinned ? "Unpin Tab" : "Pin Tab",
        hint: "",
        sub: pinned ? "Returns the tab to the normal strip" : "Pins are global across workspaces",
        run: () => {
          try {
            if (pinned) {
              if (gBrowser.unpinTab) {
                gBrowser.unpinTab(tab);
              } else if (gBrowser.unpinSelectedTabs) {
                gBrowser.unpinSelectedTabs();
              }
            } else if (gBrowser.pinTab) {
              gBrowser.pinTab(tab);
            }
          } catch (e) {}
          invalidatePaletteCache();
        },
      });
      let muted = false;
      try {
        muted =
          !!(tab.linkedBrowser && tab.linkedBrowser.audioMuted) ||
          !!tab.muted ||
          !!(tab.linkedBrowser && tab.linkedBrowser.muted);
      } catch (e) {}
      out.push({
        title: muted ? "Unmute Tab" : "Mute Tab",
        hint: "",
        sub: muted ? "Restores audio for this tab" : "Silences this tab",
        run: () => {
          try {
            if (typeof tab.toggleMuteAudio === "function") {
              tab.toggleMuteAudio();
            } else if (gBrowser.toggleMuteAudioOnTab) {
              gBrowser.toggleMuteAudioOnTab(tab);
            } else if (gBrowser.toggleMuteAudio) {
              gBrowser.toggleMuteAudio();
            } else if (tab.linkedBrowser && typeof tab.linkedBrowser.mute === "function") {
              muted ? tab.linkedBrowser.unmute() : tab.linkedBrowser.mute();
            }
          } catch (e) {}
          invalidatePaletteCache();
        },
      });
      try {
        const tabs = (gBrowser && gBrowser.tabs) || [];
        const others = Array.from(tabs).filter((t) => t && t !== tab && !t.closing && !t.pinned);
        if (others.length) {
          out.push({
            title: `Close Other Tabs (${others.length})`,
            hint: "",
            sub: "Keeps the current + pinned tabs",
            run: () => {
              try {
                for (const t of others) {
                  try {
                    if (gBrowser.removeTab) {
                      gBrowser.removeTab(t, { animate: false });
                    }
                  } catch (_e) {}
                }
              } catch (e) {}
              invalidatePaletteCache();
            },
          });
        }
      } catch (e) {}
      out.push({
        title: "Unload Current Tab",
        hint: "",
        sub: "Discards the tab to save memory · click reloads",
        run: () => {
          try {
            if (gBrowser.discardBrowser) {
              gBrowser.discardBrowser(tab);
            }
          } catch (e) {}
          invalidatePaletteCache();
        },
      });
    } catch (e) {}
    return tagPool(out, "action", "Commands");
  }

  function bindCommands(api) {
    const out = [];
    try {
      if (!api || !api.getCurrent) {
        return out;
      }
      if (isPrivatePaletteWindow()) {
        return out;
      }
      const cur = api.getCurrent();
      if (!cur) {
        return out;
      }
      const label = wsFull(api, cur);
      let bound = 0;
      try {
        bound = (api.getWsContainer && api.getWsContainer(cur)) || 0;
      } catch (e) {}
      let boundName = "";
      try {
        if (bound && api.describeContainer) {
          const d = api.describeContainer(bound);
          if (d && d.name) {
            boundName = d.name;
          }
        }
      } catch (e) {}
      // Current tab as source (keeps the Ctrl+Alt+B muscle memory).
      // Default tab clears (bindCurrentWsToSelectedTab contract); temp
      // containers refuse silently, so the sub states both upfront.
      let tabName = "";
      try {
        const cid = (gBrowser && gBrowser.selectedTab && gBrowser.selectedTab.userContextId) || 0;
        if (cid && api.describeContainer) {
          const d = api.describeContainer(cid);
          if (d && d.name) {
            tabName = d.name;
          }
        }
      } catch (e) {}
      if (api.bindCurrentWs) {
        out.push({
          title: tabName
            ? `Bind ${label} to This Tab's Container (${tabName})`
            : `Bind ${label} to This Tab's Container`,
          hint: "Ctrl+Alt+B",
          sub: tabName
            ? `This tab uses ${tabName} · ${
                boundName ? `currently ${boundName} · Enter rebinds` : "Enter binds"
              } · default tab clears · temp never binds`
            : `Current tab is containerless · ${
                boundName ? `currently ${boundName} · Enter clears` : "already unbound"
              } · temp never binds`,
          run: () => api && api.bindCurrentWs && api.bindCurrentWs(),
        });
      }
      let containers = [];
      try {
        if (api.listContainers) {
          containers = api.listContainers() || [];
        }
      } catch (e) {}
      for (const c of containers) {
        let cid = 0;
        let name = "";
        try {
          cid = Number((c && c.userContextId) || 0) || 0;
          name = (c && c.name) || "";
        } catch (e) {}
        if (!cid) {
          continue;
        }
        const canRun = api.setWsBinding ? true : false;
        out.push({
          title: `Bind ${label} to ${name || `Container ${cid}`}`,
          hint: "",
          sub:
            bound === cid
              ? "Currently bound · Enter keeps · future Ctrl+T opens here"
              : `Currently ${boundName || "unbound"} · Enter rebinds · future Ctrl+T opens here`,
          run: canRun
            ? () => {
                try {
                  api.setWsBinding(cur, cid);
                } catch (e) {}
              }
            : () => {},
        });
      }
      if (api.clearWsBinding) {
        out.push({
          title: `Bind ${label} to None (Unbound)`,
          hint: "",
          sub: boundName
            ? `Currently ${boundName} · Enter clears · new tabs open containerless`
            : "Already unbound · new tabs open containerless",
          run: () => {
            try {
              api.clearWsBinding(cur);
            } catch (e) {}
          },
        });
      }
    } catch (e) {}
    return out;
  }

  // Starred-tab rows (flat — the palette has no nested menus). Fully
  // guarded: the star controller may be absent (tests, minimal chrome).
  function starCtl() {
    try {
      return window.AphStar || null;
    } catch (e) {
      return null;
    }
  }

  function starSelectedTab() {
    try {
      return (gBrowser && gBrowser.selectedTab) || null;
    } catch (e) {
      return null;
    }
  }

  function starCommands() {
    const out = [];
    try {
      const ctl = starCtl();
      if (!ctl) {
        return out;
      }
      const tab = starSelectedTab();
      if (!tab) {
        return out;
      }
      let starred = false;
      try {
        starred = !!(ctl.isStarred && ctl.isStarred(tab));
      } catch (e) {}
      let pinned = false;
      try {
        pinned = !!tab.pinned;
      } catch (e) {}
      if (!pinned) {
        out.push({
          title: starred ? "Unstar Current Tab" : "Star Current Tab",
          hint: "Ctrl+Alt+S",
          sub: starred
            ? "Removes the starred base URL · Ctrl+W returns to stock close"
            : "Keeps a base URL · Ctrl+W resets drifted stars, parks at-base ones",
          run: () => {
            try {
              if (ctl.toggleStarTab) {
                ctl.toggleStarTab(tab);
              }
            } catch (e) {}
          },
        });
      }
      if (starred && !pinned) {
        out.push({
          title: "Reset Starred Tab to Base Page",
          hint: "",
          sub: "Navigates the current tab back to its starred URL",
          run: () => {
            try {
              if (ctl.resetStarTab) {
                ctl.resetStarTab(tab);
              }
            } catch (e) {}
          },
        });
        out.push({
          title: "Set Starred Page…",
          hint: "",
          sub: "Edits the starred base URL · empty cancels",
          keepOpen: true,
          run: () => {
            try {
              let initial = "";
              try {
                // Live-first: Enter alone re-stars the current page;
                // stored is the fallback (e.g. unreachable live URL).
                initial =
                  tab.linkedBrowser.currentURI.spec ||
                  (ctl.getStarURL && ctl.getStarURL(tab)) ||
                  "";
              } catch (_e) {}
              if (ctl.promptStarURL) {
                ctl.promptStarURL(tab, initial);
              }
            } catch (e) {}
          },
        });
      }
    } catch (e) {}
    return out;
  }

  // Sidebar footer (gear) toggle: pref aph.sidebar.hideFooter, hidden
  // by default (an absent pref counts as hidden). The workspaces bundle
  // observes the pref and hides sidebar-main's .buttons-wrapper live, so
  // this command only flips the pref and repaints for the fresh title.
  var SIDEBAR_FOOTER_PREF = "aph.sidebar.hideFooter";

  function sidebarFooterHidden() {
    try {
      if (
        typeof Services !== "undefined" &&
        Services &&
        Services.prefs &&
        typeof Services.prefs.getBoolPref === "function"
      ) {
        return !!Services.prefs.getBoolPref(SIDEBAR_FOOTER_PREF);
      }
    } catch (e) {}
    return true;
  }

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
        sub: "Moves the selection · whole groups stay joined",
        run: () => api && api.sendTabTo(n),
      });
    }
    // Group moves only surface when the selection owns that
    // structure (keeps the empty-query list clean; fuzzy queries still
    // match them like every other command row).
    try {
      const gsize = sendGroupSize();
      if (gsize > 1 && api && (api.sendGroupTo || api.sendTabTo)) {
        for (let i = 1; i <= 9; i++) {
          const n = String(i);
          cmds.push({
            title: sendGroupTitle(api, n, gsize),
            hint: "",
            sub: "Moves every tab in the native group together · membership kept",
            run: () => {
              try {
                if (api.sendGroupTo) {
                  api.sendGroupTo(n);
                } else {
                  api.sendTabTo(n);
                }
              } catch (e) {}
            },
          });
        }
      }
    } catch (e) {}
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
      ...bindCommands(api),
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
      ...starCommands(),
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
      },
      {
        // Toggle state prefix convention (✓/○): state visible without
        // running anything. Applies to every Show/Hide toggle row.
        title:
          typeof sidebarFooterHidden === "function" && !sidebarFooterHidden()
            ? "✓ Sidebar Footer (On)"
            : "○ Sidebar Footer (Off)",
        hint: "",
        sub: "Sidebar settings gear · hidden by default · flips aph.sidebar.hideFooter",
        keepOpen: true,
        run: () => {
          try {
            if (
              typeof Services !== "undefined" &&
              Services &&
              Services.prefs &&
              typeof Services.prefs.setBoolPref === "function"
            ) {
              let cur = true;
              try {
                if (typeof sidebarFooterHidden === "function") {
                  cur = sidebarFooterHidden();
                }
              } catch (e) {}
              Services.prefs.setBoolPref(SIDEBAR_FOOTER_PREF, !cur);
            }
          } catch (e) {}
          // Repaint so the row title flips Show ↔ Hide (otherwise the
          // toggle looks dead: palette stays open with a stale title).
          try {
            if (typeof render === "function" && input) {
              render(input.value);
            }
          } catch (e) {}
        },
      },
      {
        // Blind recovery: works from Ctrl+K with no sidebar visible.
        // Closes the palette so the restored strip is seen immediately.
        title: "Show Sidebar (Exit Hover Mode)",
        hint: "",
        sub: "Recovery when the strip won't expand · sets sidebar.visibility to always-show",
        run: () => {
          try {
            if (
              typeof Services !== "undefined" &&
              Services &&
              Services.prefs &&
              typeof Services.prefs.setCharPref === "function"
            ) {
              Services.prefs.setCharPref("sidebar.visibility", "always-show");
            }
          } catch (e) {}
          try {
            const sc = window.SidebarController;
            if (sc && typeof sc.updateToolbarButton === "function") {
              sc.updateToolbarButton();
            }
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
      try {
        let starred = false;
        try {
          if (window.AphStar && typeof window.AphStar.isStarred === "function") {
            starred = !!window.AphStar.isStarred(t);
          }
        } catch (_e) {}
        if (!starred) {
          try {
            starred =
              (typeof t.hasAttribute === "function" && t.hasAttribute("data-aph-starred")) ||
              (typeof t.getAttribute === "function" && t.getAttribute("data-aph-starred") === "1");
          } catch (_e) {}
        }
        if (starred) {
          badge.push("starred");
        }
      } catch (e) {}
      try {
        let muted = false;
        let playing = false;
        try {
          muted =
            !!(t.linkedBrowser && (t.linkedBrowser.audioMuted || t.linkedBrowser.muted)) ||
            !!t.muted;
        } catch (_e) {}
        try {
          playing = !!(t.soundPlaying || t.audible);
        } catch (_e) {}
        if (muted) {
          badge.push("muted");
        } else if (playing) {
          badge.push("🔊 playing");
        }
      } catch (e) {}
      let url = "";
      try {
        url = t.linkedBrowser.currentURI.spec || "";
      } catch (e) {}
      let iconURL = "";
      try {
        iconURL =
          (t.image && String(t.image)) ||
          (typeof t.getAttribute === "function" && (t.getAttribute("image") || "")) ||
          "";
      } catch (e) {}
      return {
        title: label,
        sub: url,
        hint: badge.join(" · "),
        kind: "tab",
        section: "Tabs",
        icon: (typeof KIND_ICONS !== "undefined" && KIND_ICONS.tab) || "",
        iconURL,
        tabRef: t,
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

  // Kind weight: keeps short tab-action rows ("Copy URL") from outranking
  // real commands ("Copy Text From Page…") on prefix ties.
  function kindWeight(it) {
    try {
      if (it && it.kind === "action") {
        return -30;
      }
    } catch (e) {}
    return 0;
  }

  function sectionRank(section) {
    try {
      const i = SECTION_ORDER.indexOf(section);
      return i === -1 ? 99 : i;
    } catch (e) {
      return 99;
    }
  }

  // Score a pool with multi-token matching + frecency, then group by
  // section (SECTION_ORDER) with per-section caps. Stable within sections.
  function scoreAndGroup(pool, q) {
    const ql = (q || "").toLowerCase();
    const scored = [];
    (pool || []).forEach((it, i) => {
      let m = null;
      try {
        m = typeof matchTokens === "function" ? matchTokens(it, ql) : matchItem(it, ql);
      } catch (e) {}
      if (m) {
        let boost = 0;
        try {
          boost = typeof frecBoost === "function" ? frecBoost(it) : 0;
        } catch (e) {}
        scored.push({
          it,
          score: m.score + kindWeight(it) + boost,
          order: i,
          ti: m.ti,
          si: m.si,
          hi: m.hi,
        });
      }
    });
    // Exact-prefix lock (muscle memory invariant): when the query is an
    // exact prefix of the title ("yo" on "YouTube"), that row outranks
    // every non-prefix row in its section no matter what frecency says.
    // Previously this held only by score arithmetic (1000-tier vs boosts)
    // and could tie on very long titles — now it is structural. Frecency
    // still orders rows *within* the prefix / non-prefix partitions.
    const isPrefixHit = (s) => {
      try {
        if (!ql) {
          return false;
        }
        return String((s.it && s.it.title) || "").toLowerCase().startsWith(ql);
      } catch (e) {
        return false;
      }
    };
    // Group by section, sort within each group, concat in SECTION_ORDER.
    const bySection = new Map();
    for (const s of scored) {
      const sec = (s.it && s.it.section) || "Commands";
      if (!bySection.has(sec)) {
        bySection.set(sec, []);
      }
      bySection.get(sec).push(s);
    }
    for (const arr of bySection.values()) {
      arr.sort((a, b) => {
        const pa = isPrefixHit(a) ? 0 : 1;
        const pb = isPrefixHit(b) ? 0 : 1;
        if (pa !== pb) {
          return pa - pb;
        }
        return b.score - a.score || a.order - b.order;
      });
    }
    const orderedSections = [...bySection.keys()].sort(
      (a, b) => sectionRank(a) - sectionRank(b)
    );
    const out = [];
    for (const sec of orderedSections) {
      const arr = bySection.get(sec).slice(0, SECTION_CAP);
      for (const s of arr) {
        s.it._hl = { t: new Set(s.ti), s: new Set(s.si), h: new Set(s.hi) };
        out.push(s.it);
        if (out.length >= TOTAL_CAP) {
          break;
        }
      }
      if (out.length >= TOTAL_CAP) {
        break;
      }
    }
    return out;
  }

  function tagPlacesRows(rows) {
    try {
      for (const r of rows || []) {
        if (!r) {
          continue;
        }
        if (r.hint === "Bookmark") {
          tag(r, "bookmark", "Bookmarks");
        } else if (r.hint === "History") {
          tag(r, "history", "History");
        } else if (r.hint === "Archive") {
          tag(r, "archive", "Archive");
        }
        if (!r.icon) {
          try {
            r.icon = KIND_ICONS[r.kind] || "";
          } catch (_e) {}
        }
      }
    } catch (e) {}
    return rows;
  }

  function workspacePool(cmds, api, q) {
    const out = [];
    try {
      for (const c of cmds || []) {
        if (isWorkspaceCommandTitle(c && c.title)) {
          out.push(c);
        }
      }
      if (api && api.getRoutes && q) {
        for (const r of ruleRows(api)) {
          out.push(tag(r, "workspace", "Workspaces"));
        }
        if (api.setRoute) {
          const host = currentHost();
          if (host) {
            for (const c of routeCommands(api, host)) {
              out.push(tag(c, "workspace", "Workspaces"));
            }
          }
        }
      } else if (api && api.getRoutes && !q) {
        for (const r of ruleRows(api)) {
          out.push(tag(r, "workspace", "Workspaces"));
        }
      }
    } catch (e) {}
    return out;
  }

  function allItems(filter) {
    const parsed = typeof parseMode === "function" ? parseMode(filter) : { mode: "all", q: (filter || "").trim() };
    const mode = parsed.mode || "all";
    const raw = parsed.q || "";
    const q = raw.toLowerCase();
    const api = ws();
    const cmds = getCachedCommands();
    const tabs = getCachedTabs();

    // Help mode: static cheat-sheet, filterable.
    if (mode === "help") {
      const all = typeof helpItems === "function" ? helpItems() : [];
      if (!q) {
        return all;
      }
      return scoreAndGroup(all, q);
    }

    // Empty query: curated home per mode (stays clean, no places/archive).
    // Commands float by frecency so the home view learns your habits;
    // tabs stay MRU-first from openTabs().
    if (!raw) {
      if (mode === "all") {
        let top = [];
        try {
          top = [...cmds]
            .map((it, i) => ({
              it,
              i,
              b: typeof frecBoost === "function" ? frecBoost(it) : 0,
            }))
            .sort((a, b) => b.b - a.b || a.i - b.i)
            .slice(0, 20)
            .map((s) => s.it);
        } catch (e) {
          top = cmds.slice(0, 20);
        }
        const home = [...tabs.slice(0, 12), ...top].slice(0, 30);
        for (const it of home) {
          it._hl = { t: new Set(), s: new Set(), h: new Set() };
        }
        return home;
      }
      if (mode === "commands") {
        const out = cmds.slice(0, 30);
        for (const it of out) {
          it._hl = { t: new Set(), s: new Set(), h: new Set() };
        }
        return out;
      }
      if (mode === "tabs") {
        const out = tabs.slice(0, 30);
        for (const it of out) {
          it._hl = { t: new Set(), s: new Set(), h: new Set() };
        }
        return out;
      }
      if (mode === "workspaces") {
        const pool = workspacePool(cmds, api, "");
        const out = pool.slice(0, 30);
        for (const it of out) {
          it._hl = { t: new Set(), s: new Set(), h: new Set() };
        }
        return out;
      }
      // bookmarks/history/archive with no query: nothing (needs 2+ chars).
      return [];
    }

    // Non-empty: mode-scoped pools.
    if (mode === "tabs") {
      return scoreAndGroup(tabs, q);
    }
    if (mode === "commands") {
      return scoreAndGroup(cmds, q);
    }
    if (mode === "workspaces") {
      return scoreAndGroup(workspacePool(cmds, api, raw), q);
    }
    if (mode === "bookmarks" || mode === "history") {
      try {
        if (typeof aphPlacesRowsForQuery === "function") {
          const rows = tagPlacesRows(aphPlacesRowsForQuery(raw));
          const want = mode === "bookmarks" ? "Bookmark" : "History";
          return rows.filter((r) => r && r.hint === want).slice(0, 20);
        }
      } catch (e) {}
      return [];
    }
    if (mode === "archive") {
      try {
        if (typeof aphArchivePoolItems === "function") {
          const pool = tagPlacesRows(aphArchivePoolItems(raw));
          return scoreAndGroup(pool, q);
        }
      } catch (e) {}
      return [];
    }

    // mode === "all": unified pool (legacy behavior, now section-grouped).
    const pool = [...cmds, ...tabs];
    try {
      if (api && api.getRoutes) {
        for (const r of ruleRows(api)) {
          pool.push(tag(r, "workspace", "Workspaces"));
        }
        if (api.setRoute) {
          const host = currentHost();
          if (host) {
            for (const c of routeCommands(api, host)) {
              pool.push(tag(c, "workspace", "Workspaces"));
            }
          }
        }
      }
    } catch (e) {}
    try {
      if (typeof aphArchivePoolItems === "function") {
        for (const r of aphArchivePoolItems(raw)) {
          pool.push(tag(r, "archive", "Archive"));
        }
      }
    } catch (e) {}
    const out = scoreAndGroup(pool, q);
    // Places bookmarks/history join after fuzzy matches (already filtered
    // by Places searchTerms, frecency-ordered). Above the search fallback.
    try {
      if (typeof aphPlacesRowsForQuery === "function") {
        for (const r of tagPlacesRows(aphPlacesRowsForQuery(raw))) {
          out.push(r);
          if (out.length >= TOTAL_CAP) {
            break;
          }
        }
      }
    } catch (e) {}
    try {
      const fb = navFallback(raw);
      if (fb) {
        if (isLikelyURL(raw)) {
          out.unshift(tag(fb, "go", "Go"));
        } else {
          out.push(tag(fb, "search", "Search"));
        }
      }
    } catch (e) {}
    return out;
  }

