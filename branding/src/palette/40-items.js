  // Dock-parity bind rows (flat — the palette has no nested menus).
  // Titles start with "Bind" so typing `bind` lists them all inline
  // (same pattern as routeCommands below). Private windows hide all
  // rows (dock parity: containers don't exist there). Fully guarded:
  // the workspaces API may be absent or partial (tests).
  function checkTabStarred(t) {
    try {
      if (typeof window.isTabStarred === "function") return window.isTabStarred(t);
      if (window.AphWorkspaces?.isTabStarred) return window.AphWorkspaces.isTabStarred(t);
      return !!(t?.group && (t.group.label === "Starred" || t.group.name === "Starred"));
    } catch (e) {
      return false;
    }
  }

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
      return /^(Switch to |Send (Active|Group|\d+ Tabs)|Route |Bind |Rename |Set Icon |Manage Domain Routes)/i.test(
        String(title || "")
      );
    } catch (e) {
      return false;
    }
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
      const t = String(title || "Untitled").replace(/[[\]]/g, (c) => `\\${c}`);
      return `[${t}](${String(url || "")})`;
    } catch (e) {
      return String(url || "");
    }
  }

  function tabUrlSpec(tab) {
    try {
      const spec =
        tab && tab.linkedBrowser && tab.linkedBrowser.currentURI && tab.linkedBrowser.currentURI.spec;
      return typeof spec === "string" ? spec : "";
    } catch (e) {
      return "";
    }
  }

  function tabDisplayTitle(tab, url) {
    try {
      return (tab && tab.label) || url || "Untitled";
    } catch (e) {
      return url || "Untitled";
    }
  }

  function isDupeRestoring(tab) {
    try {
      if (
        typeof SessionStore !== "undefined" &&
        SessionStore &&
        typeof SessionStore.isTabRestoring === "function"
      ) {
        return !!SessionStore.isTabRestoring(tab);
      }
    } catch (e) {}
    return false;
  }

  // Tabs in the current workspace in strip order (pinned tabs are
  // global, hence visible in every workspace, so they ride along).
  // Closing tabs and URL-less tabs never list. Read-only.
  function workspaceTabs(api) {
    const out = [];
    try {
      if (!api || typeof api.getCurrent !== "function") {
        return out;
      }
      const cur = api.getCurrent();
      if (!cur) {
        return out;
      }
      const useWs = typeof api.getWs === "function";
      let tabs = [];
      try {
        tabs = Array.from((gBrowser && gBrowser.tabs) || []);
      } catch (e) {
        return out;
      }
      for (const t of tabs) {
        try {
          if (!t || t.closing) {
            continue;
          }
          const spec = tabUrlSpec(t);
          if (!spec) {
            continue;
          }
          if (useWs) {
            let w = null;
            try {
              w = api.getWs(t);
            } catch (e) {
              continue;
            }
            let pinned = false;
            try {
              pinned = !!t.pinned;
            } catch (e) {}
            if (w !== cur && !pinned) {
              continue;
            }
          }
          out.push({ tab: t, url: spec, title: tabDisplayTitle(t, spec) });
        } catch (e) {}
      }
    } catch (e) {}
    return out;
  }


  // A tab that may be closed as a duplicate copy: exact-URL repeats
  // inside the current workspace. Never pinned (global), never the
  // selected tab, never restoring / audible / sharing / beforeunload
  // tabs. about:/chrome: pages count — a spare blank is still a spare.
  function isDupeClosable(tab, selected) {
    try {
      if (!tab || tab.closing || tab === selected) {
        return false;
      }
    } catch (e) {
      return false;
    }
    try {
      if (tab.pinned) {
        return false;
      }
    } catch (e) {}
    try {
      if (tab.soundPlaying || tab.audible) {
        return false;
      }
    } catch (e) {}
    try {
      const parent =
        tab.linkedBrowser &&
        tab.linkedBrowser.frameLoader &&
        tab.linkedBrowser.frameLoader.tabParent;
      if (parent && parent.hasBeforeUnload) {
        return false;
      }
    } catch (e) {}
    try {
      if (isDupeRestoring(tab)) {
        return false;
      }
    } catch (e) {}
    return !!tabUrlSpec(tab);
  }

  // Extra copies beyond the first of each exact URL in the current
  // workspace (strip order keeps the oldest). Read-only; the command
  // below closes the returned tabs.
  function findDuplicateTabs(api) {
    const dupes = [];
    const allDupes = [];
    try {
      if (!api) {
        return { dupes, allDupes };
      }
      const cur = typeof api.getCurrent === "function" ? api.getCurrent() : null;
      const useWs = cur && typeof api.getWs === "function";
      let tabs = [];
      try {
        tabs = Array.from((gBrowser && gBrowser.tabs) || []);
      } catch (e) {
        return { dupes, allDupes };
      }
      let selected = null;
      try {
        selected = (gBrowser && gBrowser.selectedTab) || null;
      } catch (e) {}
      const seenWs = new Map();
      const seenAll = new Map();
      for (const t of tabs) {
        try {
          if (!t || t.closing) {
            continue;
          }
          const spec = tabUrlSpec(t);
          if (!spec) {
            continue;
          }
          if (seenAll.has(spec)) {
            if (isDupeClosable(t, selected)) {
              allDupes.push(t);
            }
          } else {
            seenAll.set(spec, t);
          }
          if (useWs) {
            let w = null;
            try {
              w = api.getWs(t);
            } catch (e) {}
            if (w === cur) {
              if (seenWs.has(spec)) {
                if (isDupeClosable(t, selected)) {
                  dupes.push(t);
                }
              } else {
                seenWs.set(spec, t);
              }
            }
          }
        } catch (e) {}
      }
    } catch (e) {}
    return { dupes, allDupes };
  }

  function workspaceMarkdownLines(api) {
    try {
      return workspaceTabs(api).map((e) => `- ${markdownForTab(e.title, e.url)}`);
    } catch (e) {
      return [];
    }
  }

  function workspaceMarkdownSub(api) {
    const base = "One - [title](url) per line, in tab order";
    try {
      const n = (workspaceTabs(api) || []).length;
      if (n > 0) {
        const label = wsFull(api, api?.getCurrent?.()) || "";
        return `${n} tab${n === 1 ? "" : "s"}${label ? ` from ${label}` : ""} · ${base}`;
      }
    } catch (e) {}
    return base;
  }

  // Rendered only when duplicates exist (same convention as
  // "Close Other Tabs"): a bulk close that would no-op stays out of
  // the list. Closed tabs remain undoable via Reopen Closed Tab.
  function closeDupesRows(api) {
    try {
      const rows = [];
      const { dupes, allDupes } = findDuplicateTabs(api);
      if (dupes.length) {
        let label = "";
        try {
          label = wsFull(api, api.getCurrent());
        } catch (e) {}
        rows.push({
          title: `Close Duplicate Tabs (${dupes.length})`,
          hint: "",
          sub: `Keeps the first copy of each URL${label ? ` in ${label}` : ""} · current + pinned tabs never close`,
          run: () => {
            try {
              for (const t of dupes) {
                try {
                  if (t && !t.closing && gBrowser.removeTab) {
                    gBrowser.removeTab(t, { animate: false });
                  }
                } catch (_e) {}
              }
            } catch (e) {}
            invalidatePaletteCache();
          },
        });
      }
      if (allDupes.length && (!dupes.length || allDupes.length > dupes.length)) {
        rows.push({
          title: `Close Duplicate Tabs Across All Workspaces (${allDupes.length})`,
          hint: "",
          sub: "Keeps the oldest copy of each URL across all workspaces · active + pinned tabs never close",
          run: () => {
            try {
              for (const t of allDupes) {
                try {
                  if (t && !t.closing && gBrowser.removeTab) {
                    gBrowser.removeTab(t, { animate: false });
                  }
                } catch (_e) {}
              }
            } catch (e) {}
            invalidatePaletteCache();
          },
        });
      }
      return rows;
    } catch (e) {
      return [];
    }
  }

  // Native dual split-view rows (Firefox 149+ engine, Aph guards in
  // 78-split.js). Raw rows (global tagging happens in
  // getCachedCommands); the workspaces API may be absent or partial.
  function splitViewRows(api) {
    const out = [];
    try {
      if (!api || typeof api.splitState !== "function") {
        return out;
      }
      let st = null;
      try {
        st = api.splitState() || null;
      } catch (e) {
        return out;
      }
      if (!st) {
        return out;
      }
      if (st.inSplit) {
        out.push({
          title: "Separate Split Tabs",
          hint: "",
          sub: "Breaks the pair apart · both tabs stay open",
          run: () => {
            try {
              if (api.separateSplit) {
                api.separateSplit();
              }
            } catch (e) {}
            invalidatePaletteCache();
          },
        });
        out.push({
          title: "Reverse Split Panes",
          hint: "",
          sub: "Swaps the left and right panes",
          run: () => {
            try {
              if (api.reverseSplit) {
                api.reverseSplit();
              }
            } catch (e) {}
            invalidatePaletteCache();
          },
        });
        return out;
      }
      if (!st.canSplit) {
        return out;
      }
      if (st.candidateTitle) {
        out.push({
          title: "Split with Last Tab",
          hint: "Ctrl+Alt+\\",
          sub: `Side-by-side with "${st.candidateTitle}" · same workspace`,
          run: () => {
            try {
              if (api.splitToggle) {
                api.splitToggle();
              }
            } catch (e) {}
            invalidatePaletteCache();
          },
        });
      } else {
        out.push({
          title: "Split View (Pick Tab…)",
          hint: "Ctrl+Alt+\\",
          sub: "Opens the tab picker in the right pane",
          run: () => {
            try {
              if (api.splitToggle) {
                api.splitToggle();
              }
            } catch (e) {}
            invalidatePaletteCache();
          },
        });
      }
    } catch (e) {}
    return out;
  }


  function archiveCommands(api) {
    const out = [];
    try {
      const curWs =
        api && typeof api.getCurrent === "function" ? api.getCurrent() : "1";
      const countFn =
        api && typeof api.countArchivableTabs === "function"
          ? (opts) => api.countArchivableTabs(opts)
          : null;

      const tiers = [
        { days: 30, label: ">30 Days" },
        { days: 14, label: ">14 Days" },
        { days: 7, label: ">7 Days" },
        { days: 3, label: ">3 Days" },
        { days: 1, label: ">24 Hours" },
      ];

      for (const tier of tiers) {
        const ms = tier.days * 86400000;
        const count = countFn ? countFn({ maxAgeMs: ms }) : 0;
        out.push({
          title: `Archive Stale Tabs (${tier.label})`,
          hint: "",
          sub:
            count > 0
              ? `Saves ${count} tab(s) into Bookmarks (Aph Archive) and closes them`
              : `No tabs older than ${tier.days === 1 ? "24 hours" : `${tier.days} days`} to archive`,
          run: () => {
            try {
              if (api && typeof api.archiveStaleTabs === "function") {
                api.archiveStaleTabs({ maxAgeMs: ms });
              }
            } catch (e) {}
            invalidatePaletteCache();
          },
        });
      }

      const cWs = countFn ? countFn({ ws: curWs, maxAgeMs: 0 }) : 0;
      const wsLabel = api ? wsFull(api, curWs) : `Workspace ${curWs}`;
      out.push({
        title: "Archive Current Workspace Tabs",
        hint: "",
        sub:
          cWs > 0
            ? `Saves ${cWs} tab(s) in ${wsLabel} into Bookmarks and closes them`
            : `No unpinned tabs in ${wsLabel} to archive`,
        run: () => {
          try {
            if (api && typeof api.archiveWorkspaceTabs === "function") {
              api.archiveWorkspaceTabs(curWs);
            }
          } catch (e) {}
          invalidatePaletteCache();
        },
      });
    } catch (e) {}
    return out;
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
      if (!pinned) {
        const isStarred = checkTabStarred(tab);
        out.push({
          title: isStarred ? "Unstar Tab" : "Star Tab",
          hint: "Ctrl+Alt+S",
          sub: isStarred
            ? "Removes the tab from the Starred group"
            : "Adds the tab to the Starred group at the top of this workspace",
          run: () => {
            try {
              if (window.AphWorkspaces && typeof window.AphWorkspaces.toggleStarTab === "function") {
                window.AphWorkspaces.toggleStarTab(tab);
              }
            } catch (e) {}
            invalidatePaletteCache();
          },
        });
      }
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
            const wapi = typeof ws === "function" ? ws() : null;
            if (wapi && typeof wapi.unloadSingleTab === "function") {
              // Stock refuses the selected tab, so the helper moves
              // selection to a visible neighbor first (same as parking).
              wapi.unloadSingleTab(tab);
            } else if (gBrowser.discardBrowser) {
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

  // Unload palette subtitle with a live dry-run count: "Discards N
  // hidden-workspace tabs…". Dry-run discards nothing; any failure reads
  // as the plain subtitle (fail-silent house style).
  function unloadInactiveSub(api) {
    const base = "Discards hidden-workspace tabs to save memory · click reloads";
    try {
      if (api && typeof api.unloadEligibleTabs === "function") {
        const r = api.unloadEligibleTabs({ scope: "foreign", dryRun: true });
        if (r && typeof r.unloaded === "number" && r.unloaded > 0) {
          return `Discards ${r.unloaded} hidden-workspace tab${r.unloaded === 1 ? "" : "s"} to save memory · click reloads`;
        }
      }
    } catch (e) {}
    return base;
  }


  // about:unloads-lite subtitle: "N tabs due · oldest: host". Read-only
  // (unloadCandidates never discards); failures read as the plain base.
  function unloadCandidatesSub(api) {
    const base = "Previews what the next auto-unload sweep would discard";
    try {
      if (api && typeof api.unloadCandidates === "function") {
        const c = api.unloadCandidates(5);
        if (c && typeof c.total === "number" && c.total > 0) {
          const oldest =
            c.list && c.list.length && c.list[0].host ? ` · oldest: ${c.list[0].host}` : "";
          return `${c.total} tab${c.total === 1 ? "" : "s"} due for auto-unload${oldest}`;
        }
        return "Nothing due for auto-unload right now";
      }
    } catch (e) {}
    return base;
  }

  function switchWorkspaceView(api) {
    return {
      placeholder: "Switch to workspace…  (Esc goes back)",
      items: () => {
        const cur = api && api.getCurrent ? api.getCurrent() : "";
        const out = [];
        for (let i = 1; i <= 9; i++) {
          const n = String(i);
          let iconSVG = "";
          try {
            iconSVG = api && api.getWsIcon ? api.getWsIcon(n) : "";
          } catch (_e) {}
          out.push({
            section: "Workspaces",
            kind: "workspace",
            wsId: n,
            iconSVG,
            title: wsFull(api, n),
            hint: n === cur ? "Current" : `Alt+${n}`,
            sub: n === cur ? "Currently active workspace" : "Enter switches here",
            run: () => api && api.switchTo && api.switchTo(n),
          });
        }
        return out;
      },
    };
  }

  function moveTabWorkspaceView(api) {
    return {
      placeholder: "Move tab to workspace…  (Esc goes back)",
      items: () => {
        const cur = api && api.getCurrent ? api.getCurrent() : "";
        const gsize = sendGroupSize();
        const out = [];
        for (let i = 1; i <= 9; i++) {
          const n = String(i);
          if (n === cur) {
            continue;
          }
          let iconSVG = "";
          try {
            iconSVG = api && api.getWsIcon ? api.getWsIcon(n) : "";
          } catch (_e) {}
          out.push({
            section: "Workspaces",
            kind: "workspace",
            wsId: n,
            iconSVG,
            title: gsize > 1 ? sendGroupTitle(api, n, gsize) : sendTabTitle(api, n),
            hint: gsize > 1 ? "" : `Ctrl+Alt+${n}`,
            sub: gsize > 1
              ? "Moves every tab in the native group together"
              : "Moves the selection · whole groups stay joined",
            run: () => {
              if (!api) {
                return;
              }
              if (gsize > 1 && api.sendGroupTo) {
                api.sendGroupTo(n);
              } else if (api.sendTabTo) {
                api.sendTabTo(n);
              }
            },
          });
        }
        return out;
      },
    };
  }

  function switchThemeView() {
    const tp = typeof window !== "undefined" ? window.AphThemePreset : null;
    const prev = tp && typeof tp.getThemePreset === "function" ? tp.getThemePreset() : "";
    const presets = [
      ["", "Auto (Follow OS)", "Follows OS prefers-color-scheme"],
      ["midnight", "Midnight", "Pinned dark charcoal room"],
      ["paper", "Paper", "Pinned warm cream room"],
      ["nord", "Nord", "Cool desaturated arctic dark"],
      ["mocha", "Mocha", "Catppuccin Mocha dark"],
      ["espresso", "Espresso", "Warm umber dark"],
    ];
    return {
      placeholder: "Switch theme preset…  (live preview · Esc reverts)",
      items: () => {
        const active = tp && typeof tp.getThemePreset === "function" ? tp.getThemePreset() : "";
        return presets.map(([key, label, desc]) => ({
          presetKey: key || "auto",
          title: `${active === key ? "✓ " : "○ "}${label}`,
          hint: active === key ? "Active" : "",
          sub: desc,
          run: () => tp && tp.setThemePreset && tp.setThemePreset(key || "auto"),
        }));
      },
      onPreview: (it) => {
        if (tp && tp.setThemePreset && it && it.presetKey) {
          tp.setThemePreset(it.presetKey);
        }
      },
      onSelect: (it) => {
        if (tp && tp.setThemePreset && it && it.presetKey) {
          tp.setThemePreset(it.presetKey);
        }
      },
      onCancel: () => {
        if (tp && tp.setThemePreset) {
          tp.setThemePreset(prev || "auto");
        }
      },
    };
  }

  function unloadCandidatesView(api) {
    return {
      placeholder: "Browse unload candidates…  (Enter jumps to tab · Esc goes back)",
      items: () => {
        const c =
          api && typeof api.unloadCandidates === "function"
            ? api.unloadCandidates(25)
            : { total: 0, list: [] };
        return (c.list || []).map((e) => {
          let age = "never tracked";
          if (e.lastViewed) {
            const mins = Math.max(0, Math.round((Date.now() - e.lastViewed) / 60000));
            age = `${mins}m ago`;
          }
          return {
            section: "Tabs",
            kind: "tab",
            wsId: e.ws || "",
            title: e.title || e.host || "(untitled)",
            hint: e.ws ? `WS ${e.ws}` : "",
            sub: `${e.host || "(no host)"} · last viewed ${age}`,
            run: () => {
              if (e.tab && api && api.switchTo && e.ws) {
                api.switchTo(e.ws);
                gBrowser.selectedTab = e.tab;
              }
            },
          };
        });
      },
    };
  }

  function cleanDomainInput(raw) {
    try {
      let s = String(raw || "").trim().toLowerCase();
      s = s.replace(/^[a-z]+:\/\//, "");
      s = s.split(/[/?#]/)[0];
      s = s.replace(/:\d+$/, "").replace(/\.$/, "");
      if (s && !/\s/.test(s)) {
        return s;
      }
    } catch (e) {}
    return "";
  }

  function routeDomainWorkspaceView(api, domain) {
    const host = cleanDomainInput(domain) || String(domain || "").trim().toLowerCase();
    let curWs = "";
    try {
      curWs = (api && api.getRoutes && api.getRoutes()[host]) || "";
    } catch (e) {}

    return {
      placeholder: `Route "${host}" to workspace 1–9…  (Esc cancels)`,
      items: () => {
        const list = [];
        for (let i = 1; i <= 9; i++) {
          const n = String(i);
          const isCur = curWs === n;
          list.push({
            section: "Workspaces",
            kind: "workspace",
            wsId: n,
            title: wsFull(api, n),
            hint: isCur ? `Current (Alt+${n})` : `Alt+${n}`,
            sub: isCur
              ? `Already routed to Workspace ${n} · Enter rebinds`
              : `Route future tabs on "${host}" to Workspace ${n}`,
            run: () => {
              try {
                if (api && api.setRoute) {
                  api.setRoute(host, n);
                }
              } catch (e) {}
            },
          });
        }
        return list;
      },
    };
  }

  function manageRoutesView(api) {
    return {
      rawItems: true,
      placeholder: "Type domain (e.g. github.com) or select rule to remove…",
      items: (q) => {
        const out = [];
        const query = (q || "").trim();
        const targetDomain = cleanDomainInput(query);
        const routes = (api && api.getRoutes && api.getRoutes()) || {};
        const hosts = Object.keys(routes).sort();

        if (targetDomain) {
          const existingWs = routes[targetDomain];
          out.push({
            section: "Routes",
            kind: "workspace",
            title: `Route "${targetDomain}" to Workspace…`,
            hint: existingWs ? `WS ${existingWs}` : "Pick 1–9",
            sub: existingWs
              ? `Currently routes to ${wsFull(api, existingWs)} · Enter to change destination workspace`
              : `Set destination workspace 1–9 for future tabs on ${targetDomain}`,
            keepOpen: true,
            run: () => typeof pushView === "function" && pushView(routeDomainWorkspaceView(api, targetDomain)),
          });
        } else {
          const currentSite = currentHost();
          if (currentSite) {
            const curWs = routes[currentSite];
            out.push({
              section: "Routes",
              kind: "workspace",
              title: `Route Current Site (${currentSite}) to Workspace…`,
              hint: curWs ? `WS ${curWs}` : "Current Site",
              sub: curWs
                ? `Currently routes to ${wsFull(api, curWs)} · Enter to change destination workspace`
                : `Set destination workspace 1–9 for future tabs on ${currentSite}`,
              keepOpen: true,
              run: () => typeof pushView === "function" && pushView(routeDomainWorkspaceView(api, currentSite)),
            });
          }
        }

        const matchingHosts = query
          ? hosts.filter((h) => h.includes(targetDomain || query.toLowerCase()))
          : hosts;

        for (const host of matchingHosts) {
          const wsId = routes[host];
          let note = "";
          try {
            if (api && api.getWsContainer && api.describeContainer) {
              const id = api.getWsContainer(wsId);
              if (id) {
                const d = api.describeContainer(id);
                if (d && d.name) note = ` · ${d.name} container`;
              }
            }
          } catch (e) {}
          out.push({
            section: "Active Rules",
            kind: "workspace",
            title: `Remove: ${host} → ${wsFull(api, wsId)}`,
            hint: "Enter deletes",
            sub: `Active domain route${note} · Enter removes rule`,
            keepOpen: true,
            run: () => {
              try {
                if (api && api.deleteRoute) {
                  api.deleteRoute(host);
                }
              } catch (e) {}
            },
          });
        }

        if (out.length === 0) {
          out.push({
            section: "Routes",
            kind: "action",
            title: "No active domain routes",
            hint: "",
            sub: "Type a domain above (e.g. github.com) to route it to a workspace",
            keepOpen: true,
            run: () => {},
          });
        }

        return out;
      },
    };
  }

  function aphSettingsView(_api) {
    const ARCHIVE_OPTIONS = [0, 3, 7, 14, 30];
    const UNLOAD_OPTIONS = [0, 15, 30, 60];

    return {
      placeholder: "Aph Settings… (Enter cycles/toggles · Esc back)",
      items: () => {
        const out = [];

        // 1. Auto-Archive: Cycle Off / 3d / 7d / 14d / 30d
        let archiveDays = 0;
        try {
          if (typeof Services !== "undefined" && Services?.prefs?.getIntPref) {
            const d = Services.prefs.getIntPref("aph.archive.autoDays");
            archiveDays = Number.isFinite(d) ? Math.max(0, d) : 0;
          }
        } catch (e) {}
        const curArchiveIdx = ARCHIVE_OPTIONS.indexOf(archiveDays);
        const nextArchiveDays = ARCHIVE_OPTIONS[(curArchiveIdx + 1) % ARCHIVE_OPTIONS.length] ?? 0;
        out.push({
          section: "Settings",
          kind: "action",
          title: archiveDays === 0 ? "○ Auto-Archive: Off" : `✓ Auto-Archive: ${archiveDays} days`,
          hint: archiveDays === 0 ? "Off" : `${archiveDays}d`,
          sub: archiveDays === 0
            ? "Archive idle tabs to Bookmarks · Off (Enter cycles: 3d / 7d / 14d / 30d)"
            : `Archive idle tabs to Bookmarks after ${archiveDays} days (Enter cycles: Off / 3d / 7d / 14d / 30d)`,
          keepOpen: true,
          run: () => {
            try {
              if (typeof Services !== "undefined" && Services?.prefs?.setIntPref) {
                Services.prefs.setIntPref("aph.archive.autoDays", nextArchiveDays);
              }
            } catch (e) {}
          },
        });

        // 2. Auto-Unload: Cycle Off / 15m / 30m / 60m
        let unloadEnabled = false;
        let unloadStaleMin = 30;
        try {
          if (typeof Services !== "undefined" && Services?.prefs) {
            if (Services.prefs.getBoolPref) {
              unloadEnabled = !!Services.prefs.getBoolPref("aph.unload.autoEnabled");
            }
            if (Services.prefs.getIntPref) {
              unloadStaleMin = Services.prefs.getIntPref("aph.unload.staleMin");
            }
          }
        } catch (e) {}
        const curUnloadVal = !unloadEnabled ? 0 : ([15, 30, 60].includes(unloadStaleMin) ? unloadStaleMin : 30);
        const curUnloadIdx = UNLOAD_OPTIONS.indexOf(curUnloadVal);
        const nextUnloadVal = UNLOAD_OPTIONS[(curUnloadIdx + 1) % UNLOAD_OPTIONS.length] ?? 0;
        out.push({
          section: "Settings",
          kind: "action",
          title: curUnloadVal === 0 ? "○ Auto-Unload: Off" : `✓ Auto-Unload: ${curUnloadVal}m`,
          hint: curUnloadVal === 0 ? "Off" : `${curUnloadVal}m`,
          sub: curUnloadVal === 0
            ? "Automatically discard idle tabs · Off (Enter cycles: 15m / 30m / 60m)"
            : `Automatically discard idle tabs after ${curUnloadVal} min (Enter cycles: 15m / 30m / 60m / Off)`,
          keepOpen: true,
          run: () => {
            try {
              if (typeof Services !== "undefined" && Services?.prefs) {
                if (nextUnloadVal === 0) {
                  Services.prefs.setBoolPref?.("aph.unload.autoEnabled", false);
                } else {
                  Services.prefs.setBoolPref?.("aph.unload.autoEnabled", true);
                  Services.prefs.setIntPref?.("aph.unload.staleMin", nextUnloadVal);
                }
              }
            } catch (e) {}
          },
        });

        // 3. Ctrl+W Parks Pins
        let pinsPark = true;
        try {
          if (typeof Services !== "undefined" && Services?.prefs?.getBoolPref) {
            pinsPark = Services.prefs.getBoolPref("aph.pins.ctrlWUnloads", true);
          }
        } catch (e) {}
        out.push({
          section: "Settings",
          kind: "action",
          title: pinsPark ? "✓ Ctrl+W Parks Pinned Tabs" : "○ Ctrl+W Parks Pinned Tabs",
          hint: pinsPark ? "Enabled" : "Disabled",
          sub: pinsPark
            ? "Closing a pinned tab resets and unloads it instead of closing (Enter toggles)"
            : "Closing a pinned tab closes it normally (Enter toggles)",
          keepOpen: true,
          run: () => {
            try {
              if (typeof Services !== "undefined" && Services?.prefs?.setBoolPref) {
                Services.prefs.setBoolPref("aph.pins.ctrlWUnloads", !pinsPark);
              }
            } catch (e) {}
          },
        });

        // 4. Auto-Hide Sidebar
        let autohideSidebar = false;
        try {
          if (typeof window !== "undefined" && window.AphWorkspaces?.isAutohideSidebar) {
            autohideSidebar = !!window.AphWorkspaces.isAutohideSidebar();
          } else if (typeof Services !== "undefined" && Services?.prefs?.getBoolPref) {
            autohideSidebar = !!Services.prefs.getBoolPref("aph.sidebar.autohide", false);
          }
        } catch (e) {}
        out.push({
          section: "Settings",
          kind: "action",
          title: autohideSidebar ? "✓ Auto-Hide Sidebar: Enabled" : "○ Auto-Hide Sidebar: Disabled",
          hint: autohideSidebar ? "Hover Peek" : "Always Visible",
          sub: autohideSidebar
            ? "Sidebar collapses off-screen to 0px; hover left edge reveals (Enter toggles)"
            : "Sidebar remains visible (Enter toggles hover peek mode)",
          keepOpen: true,
          run: () => {
            try {
              if (typeof window !== "undefined" && window.AphWorkspaces?.toggleAutohideSidebar) {
                window.AphWorkspaces.toggleAutohideSidebar();
              } else if (typeof Services !== "undefined" && Services?.prefs?.setBoolPref) {
                Services.prefs.setBoolPref("aph.sidebar.autohide", !autohideSidebar);
              }
            } catch (e) {}
          },
        });

        // 5. Sidebar Footer
        let footerHidden = true;
        try {
          if (typeof sidebarFooterHidden === "function") {
            footerHidden = sidebarFooterHidden();
          } else if (typeof Services !== "undefined" && Services?.prefs?.getBoolPref) {
            footerHidden = Services.prefs.getBoolPref("aph.sidebar.hideFooter", true);
          }
        } catch (e) {}
        out.push({
          section: "Settings",
          kind: "action",
          title: !footerHidden ? "✓ Sidebar Settings Footer: Visible" : "○ Sidebar Settings Footer: Hidden",
          hint: !footerHidden ? "Visible" : "Hidden",
          sub: !footerHidden
            ? "Settings gear shown at bottom of sidebar (Enter hides)"
            : "Settings gear hidden for maximum tab strip height (Enter shows)",
          keepOpen: true,
          run: () => {
            try {
              if (typeof Services !== "undefined" && Services?.prefs?.setBoolPref) {
                Services.prefs.setBoolPref("aph.sidebar.hideFooter", !footerHidden);
              }
            } catch (e) {}
          },
        });

        // 6. Theme Preset
        let currentTheme = "Auto";
        try {
          const tp = typeof window !== "undefined" ? window.AphThemePreset : null;
          if (tp && typeof tp.getThemePreset === "function") {
            const key = tp.getThemePreset() || "";
            const nameMap = {
              "": "Auto",
              auto: "Auto",
              midnight: "Midnight",
              paper: "Paper",
              nord: "Nord",
              mocha: "Mocha",
              espresso: "Espresso",
            };
            currentTheme = nameMap[key.toLowerCase()] || key;
          }
        } catch (e) {}
        out.push({
          section: "Settings",
          kind: "action",
          title: `Theme Preset: ${currentTheme}…`,
          hint: currentTheme,
          sub: "Auto, Midnight, Paper, Nord, Mocha, Espresso (Enter opens picker)",
          keepOpen: true,
          run: () => typeof pushView === "function" && pushView(switchThemeView()),
        });

        return out;
      },
    };
  }

  if (typeof window !== "undefined") {
    window.__aphViews = {
      cleanDomainInput,
      aphSettingsView,
      manageRoutesView,
      routeDomainWorkspaceView,
    };
  }

  function commands() {
    const api = ws();
    const cmds = [];
    // Workspaces: parent drill-down commands keep the root list clean.
    cmds.push(
      {
        section: "Workspaces",
        title: "Switch to Last Workspace",
        hint: "Alt+`",
        sub: "Bounce back to your previous workspace",
        run: () => api && api.switchToLastWorkspace && api.switchToLastWorkspace(),
      },
      {
        section: "Workspaces",
        title: "Switch Workspace…",
        hint: "Alt+1–9",
        sub: "Jump to any workspace by name or icon",
        keepOpen: true,
        run: () => typeof pushView === "function" && pushView(switchWorkspaceView(api)),
      },
      {
        section: "Workspaces",
        title: "Manage Domain Routes…",
        hint: "Routes",
        sub: "Route websites to workspaces or remove routing rules",
        keepOpen: true,
        run: () => typeof pushView === "function" && pushView(manageRoutesView(api)),
      },
      {
        section: "Workspaces",
        title: sendGroupSize() > 1 ? "Move Group to Workspace…" : "Move Tab to Workspace…",
        hint: "Ctrl+Alt+1–9",
        sub: "Send the active tab or group to another workspace",
        keepOpen: true,
        run: () => typeof pushView === "function" && pushView(moveTabWorkspaceView(api)),
      }
    );
    // Cross-window moves (window-scoped model — the only path that
    // touches another window). Arrivals join the destination's current
    // workspace. Listed per live window; hidden when alone.
    try {
      if (api && typeof api.listWindows === "function" && typeof api.moveTabsToWindow === "function") {
        const others = api.listWindows() || [];
        for (const o of others) {
          try {
            let wsLabel = "";
            try {
              wsLabel = o && o.ws ? wsFull(api, o.ws) : "other window";
            } catch (e) {
              wsLabel = "other window";
            }
            const dest = o && o.win;
            cmds.push({
              title: `Move Tab to Other Window (${wsLabel})`,
              hint: "",
              sub: "Moves the selection · arrives in that window's current workspace",
              run: () => {
                try {
                  api.moveTabsToWindow(dest);
                } catch (e) {}
              },
            });
          } catch (e) {}
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
        cmds.push({
          title: `Set Icon for ${wsFull(api, cur)}…`,
          hint: "",
          sub: "Lucide mark grid · typing filters · Enter sets",
          keepOpen: true,
          run: () => startIconPick(cur),
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
        run: () =>
          api && typeof api.openBoundTab === "function"
            ? api.openBoundTab("about:newtab")
            : gBrowser.addTrustedTab("about:newtab"),
      },
      {
        title: "New Temp Container Tab",
        hint: "Ctrl+Alt+T",
        run: () => api && api.openTempTab(),
      },
      ...(api && !isPrivatePaletteWindow()
        ? [
            {
              section: "Workspaces",
              title: "Bind Workspace to Container…",
              hint: "Ctrl+Alt+B",
              sub: "Assign a Firefox container to the current workspace",
              keepOpen: true,
              run: () =>
                typeof pushView === "function" &&
                pushView({
                  placeholder: "Bind workspace to container…  (Esc goes back)",
                  items: () => bindCommands(api),
                }),
            },
          ]
        : []),
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
      ...closeDupesRows(api),
      ...splitViewRows(api),
      {
        section: "Commands",
        title: "Aph Settings…",
        hint: "Settings",
        sub: "Configure auto-archive, auto-unload, pins, sidebar, and theme",
        keepOpen: true,
        run: () => typeof pushView === "function" && pushView(aphSettingsView(api)),
      },
      {
        title: "Archive Stale Tabs…",
        hint: "",
        sub: "Save idle tabs into Places Bookmarks by age or workspace",
        keepOpen: true,
        run: () =>
          typeof pushView === "function" &&
          pushView({
            placeholder: "Archive stale tabs…  (Esc goes back)",
            items: () => archiveCommands(api),
          }),
      },
      {
        title: "Unload Inactive Tabs",
        hint: "",
        sub: unloadInactiveSub(api),
        run: () => {
          try {
            if (api && api.unloadEligibleTabs) {
              api.unloadEligibleTabs({ scope: "foreign" });
            }
          } catch (e) {}
        },
      },
      {
        title: "Browse Unload Candidates…",
        hint: "",
        sub: unloadCandidatesSub(api),
        keepOpen: true,
        run: () =>
          typeof pushView === "function" &&
          pushView(unloadCandidatesView(api)),
      },
      ...(typeof window !== "undefined" &&
      window.AphThemePreset &&
      typeof window.AphThemePreset.setThemePreset === "function"
        ? [
            {
              title: "Switch Theme…",
              hint: "",
              sub: "Auto, Midnight, Paper, Nord, Mocha, Espresso (live preview)",
              keepOpen: true,
              run: () =>
                typeof pushView === "function" && pushView(switchThemeView()),
            },
          ]
        : []),
      {
        title: "Copy Workspace Tabs as Markdown",
        hint: "",
        sub: workspaceMarkdownSub(api),
        run: () => {
          try {
            const lines = workspaceMarkdownLines(api);
            if (lines.length) {
              copyStringToClipboard(lines.join("\n"));
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
        title: (() => {
          try {
            const w = ws();
            if (w && typeof w.getAutohideSidebar === "function" && w.getAutohideSidebar()) {
              return "✓ Auto-Hide Sidebar (On)";
            }
          } catch (e) {}
          return "○ Auto-Hide Sidebar (Off)";
        })(),
        hint: "Ctrl+\\",
        sub: "Collapse sidebar off-screen until hovered · Peek on left edge",
        keepOpen: true,
        run: () => {
          try {
            const w = ws();
            if (w && typeof w.toggleAutohideSidebar === "function") {
              w.toggleAutohideSidebar();
            }
          } catch (e) {}
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
      let wsId = "";
      try {
        if (api) {
          wsId = String(api.getWs(t) || "");
          const wsName = api.getWsName && api.getWsName(wsId);
          badge.push(wsName || `WS ${wsId}`);
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
      if (checkTabStarred(t)) {
        badge.push("starred");
      }
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
          badge.push("playing");
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
        wsId,
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

  // Icon grid rows for icon-pick mode (one workspace): the vendored
  // Lucide marks plus a None row clearing back to the number. Substring
  // match on key + label — thirty rows need no fuzzy scoring. run
  // commits directly so click, Enter, and Alt+number share one commit.
  function iconRows(api, wsId, q) {
    const out = [];
    try {
      const keys = (api && api.wsIconKeys && api.wsIconKeys()) || [];
      const labelOf = (k) => {
        try {
          return (api && api.wsIconLabel && api.wsIconLabel(k)) || k;
        } catch (e) {
          return k;
        }
      };
      const needle = String(q || "").toLowerCase();
      let cur = "";
      try {
        cur = (api && api.getWsIcon && api.getWsIcon(wsId)) || "";
      } catch (e) {}
      const push = (key, title, sub, hint) => {
        out.push(
          tag(
            {
              title,
              sub,
              hint: hint || "",
              section: "Workspace icons",
              kind: "wsicon",
              icon: "",
              iconSVG: key,
              iconKey: key,
              run: () => commitIconKey(wsId, key),
            },
            "wsicon",
            "Workspace icons"
          )
        );
      };
      for (const k of keys) {
        const label = labelOf(k);
        let extra = "";
        try {
          extra = (api && api.wsIconSearch && api.wsIconSearch(k)) || "";
        } catch (e) {}
        if (needle && String(`${k} ${label} ${extra}`).toLowerCase().indexOf(needle) === -1) {
          continue;
        }
        push(k, label, `Icon for Workspace ${wsId} · ${k}`, k === cur ? "Current" : "Enter");
      }
      if (!needle || "none".indexOf(needle) !== -1 || "number".indexOf(needle) !== -1) {
        push("", "None", `Back to the bare number for Workspace ${wsId}`, cur ? "Enter" : "Current");
      }
    } catch (e) {}
    return out;
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
  function scoreAndGroup(pool, q, opts) {
    const ql = (q || "").toLowerCase();
    const strict = !!(opts && opts.strict);
    const sectionCaps = (opts && opts.sectionCaps) || null;
    const defaultSecCap = (opts && opts.sectionCap) || SECTION_CAP;
    const maxTotal = (opts && opts.totalCap) || TOTAL_CAP;
    const scored = [];
    (pool || []).forEach((it, i) => {
      let m = null;
      try {
        m = typeof matchTokens === "function" ? matchTokens(it, ql) : matchItem(it, ql);
      } catch (e) {}
      if (m) {
        if (strict && m.weak) {
          return;
        }
        let boost = 0;
        try {
          boost = typeof frecBoost === "function" ? frecBoost(it) : 0;
        } catch (e) {}
        scored.push({
          it,
          rawScore: m.score,
          weak: !!m.weak,
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
      const cap = (sectionCaps && sectionCaps[sec]) || defaultSecCap;
      const arr = bySection.get(sec).slice(0, cap);
      for (const s of arr) {
        s.it._hl = { t: new Set(s.ti), s: new Set(s.si), h: new Set(s.hi) };
        s.it._rawScore = s.rawScore;
        s.it._weak = !!s.weak;
        out.push(s.it);
        if (out.length >= maxTotal) {
          break;
        }
      }
      if (out.length >= maxTotal) {
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
      for (let i = 1; i <= 9; i++) {
        const n = String(i);
        out.push(
          tag(
            {
              title: `Switch to ${wsFull(api, n)}`,
              hint: `Alt+${n}`,
              run: () => api && api.switchTo && api.switchTo(n),
            },
            "workspace",
            "Workspaces"
          )
        );
      }
      for (const b of bindCommands(api)) {
        out.push(tag(b, "workspace", "Workspaces"));
      }
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

    // Empty query: curated home per mode (stays clean, no places).
    // Commands float by frecency so the home view learns your habits;
    // tabs stay MRU-first from openTabs().
    if (!raw) {
      if (mode === "all") {
        // Curated zero-query home: 4 MRU tabs + 4 quick actions + active workspaces.
        let top = [];
        try {
          top = [...cmds]
            .map((it, i) => ({
              it,
              i,
              b: typeof frecBoost === "function" ? frecBoost(it) : 0,
            }))
            .sort((a, b) => b.b - a.b || a.i - b.i)
            .slice(0, 4)
            .map((s) => s.it);
        } catch (e) {
          top = cmds.slice(0, 4);
        }
        const wsQuick = [];
        try {
          if (api && api.getCurrent) {
            const cur = api.getCurrent();
            for (let i = 1; i <= 9; i++) {
              const n = String(i);
              if (n === cur) {
                continue;
              }
              const hasTabs = tabs.some((t) => t.wsId === n);
              if (!hasTabs) {
                continue;
              }
              let iconSVG = "";
              try {
                iconSVG = api.getWsIcon ? api.getWsIcon(n) : "";
              } catch (_e) {}
              wsQuick.push(
                tag(
                  {
                    wsId: n,
                    iconSVG,
                    title: wsFull(api, n),
                    hint: `Alt+${n}`,
                    sub: "Jump to active workspace",
                    run: () => api.switchTo && api.switchTo(n),
                  },
                  "workspace",
                  "Workspaces"
                )
              );
              if (wsQuick.length >= 4) {
                break;
              }
            }
          }
        } catch (_e) {}
        const home = [...tabs.slice(0, 4), ...top, ...wsQuick];
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
      // bookmarks/history with no query: nothing (needs 2+ chars).
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
    const out = scoreAndGroup(pool, q, {
      strict: /\s/.test(raw) || raw.length > 4,
      totalCap: 16,
      sectionCaps: { Tabs: 5, Commands: 5, Workspaces: 5 },
    });
    const hasStrongFuzzy = out.some((it) => !it._weak);
    // Places bookmarks/history join after fuzzy matches (capped to 3 each in All mode).
    let hasPlaces = false;
    let bmCount = 0;
    let histCount = 0;
    try {
      if (typeof aphPlacesRowsForQuery === "function") {
        for (const r of tagPlacesRows(aphPlacesRowsForQuery(raw))) {
          if (r.section === "Bookmarks") {
            if (bmCount >= 3) continue;
            bmCount++;
          } else if (r.section === "History") {
            if (histCount >= 3) continue;
            histCount++;
          }
          hasPlaces = true;
          out.push(r);
          if (out.length >= 20) {
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
        } else if (!hasStrongFuzzy && !hasPlaces) {
          out.unshift(tag(fb, "search", "Search"));
        } else {
          out.push(tag(fb, "search", "Search"));
        }
      }
    } catch (e) {}
    return out;
  }

  function rowActionsView(it) {
    const api = ws();
    return {
      placeholder: `Actions for “${String((it && it.title) || "").slice(0, 40)}”…  (Esc goes back)`,
      items: () => {
        const out = [];
        if (!it) {
          return out;
        }
        if (it.kind === "tab" && it.tabRef) {
          const t = it.tabRef;
          const url = it.sub || "";
          out.push(
            {
              title: "Switch to Tab",
              hint: "Enter",
              run: () => it.run && it.run(),
            },
            {
              title: "Close Tab",
              hint: "Ctrl+W",
              run: () => {
                if (typeof gBrowser !== "undefined" && gBrowser && gBrowser.removeTab) {
                  gBrowser.removeTab(t, { animate: false });
                }
              },
            },
            {
              title: t.pinned ? "Unpin Tab" : "Pin Tab",
              run: () => {
                if (typeof gBrowser !== "undefined" && gBrowser) {
                  if (t.pinned && gBrowser.unpinTab) gBrowser.unpinTab(t);
                  else if (!t.pinned && gBrowser.pinTab) gBrowser.pinTab(t);
                }
              },
            },
            {
              title: t.muted ? "Unmute Tab" : "Mute Tab",
              run: () => t.toggleMuteAudio && t.toggleMuteAudio(),
            }
          );
          if (api && api.unloadSingleTab) {
            out.push({
              title: "Unload Tab",
              run: () => api.unloadSingleTab(t),
            });
          }
          if (url) {
            out.push({
              title: "Copy URL",
              run: () => copyStringToClipboard(url),
            });
          }
          if (api && api.sendTabTo) {
            out.push({
              title: "Move to Workspace…",
              keepOpen: true,
              run: () => {
                if (typeof pushView === "function") {
                  pushView({
                    placeholder: "Move tab to workspace…",
                    items: () => {
                      const list = [];
                      for (let i = 1; i <= 9; i++) {
                        const n = String(i);
                        list.push({
                          section: "Workspaces",
                          wsId: n,
                          title: wsFull(api, n),
                          run: () => api.sendTabTo(n, [t]),
                        });
                      }
                      return list;
                    },
                  });
                }
              },
            });
          }
          return out;
        }
        const url = it.sub || "";
        out.push({
          title: "Open",
          hint: "Enter",
          run: () => it.run && it.run(),
        });
        if (it.runInTemp) {
          out.push({
            title: "Open in Temp Container",
            hint: "Alt+Enter",
            run: () => it.runInTemp(),
          });
        }
        if (url && /^https?:\/\//i.test(url)) {
          out.push({
            title: "Copy URL",
            run: () => copyStringToClipboard(url),
          });
        }
        return out;
      },
    };
  }

