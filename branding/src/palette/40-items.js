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
      return /^(Switch to |Send (Active|Group|\d+ Tabs)|Route |Bind |Rename |Set Icon )/i.test(
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
  function duplicateTabs(api) {
    const out = [];
    try {
      if (!api || typeof api.getCurrent !== "function" || typeof api.getWs !== "function") {
        return out;
      }
      const cur = api.getCurrent();
      if (!cur) {
        return out;
      }
      let tabs = [];
      try {
        tabs = Array.from((gBrowser && gBrowser.tabs) || []);
      } catch (e) {
        return out;
      }
      let selected = null;
      try {
        selected = (gBrowser && gBrowser.selectedTab) || null;
      } catch (e) {}
      const seen = new Map();
      for (const t of tabs) {
        try {
          if (!isDupeClosable(t, selected)) {
            continue;
          }
          let w = null;
          try {
            w = api.getWs(t);
          } catch (e) {
            continue;
          }
          if (w !== cur) {
            continue;
          }
          const spec = tabUrlSpec(t);
          if (seen.has(spec)) {
            out.push(t);
          } else {
            seen.set(spec, t);
          }
        } catch (e) {}
      }
    } catch (e) {}
    return out;
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
      const n = workspaceTabs(api).length;
      if (n > 0) {
        let label = "";
        try {
          label = wsFull(api, api.getCurrent());
        } catch (e) {}
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
      const dupes = duplicateTabs(api);
      if (!dupes.length) {
        return [];
      }
      let label = "";
      try {
        label = wsFull(api, api.getCurrent());
      } catch (e) {}
      return [
        {
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
        },
      ];
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

  function logUnloadCandidates(api) {
    try {
      const c =
        api && typeof api.unloadCandidates === "function"
          ? api.unloadCandidates(25)
          : { total: 0, list: [] };
      const lines = [`[AphUnload] ${c.total} tab(s) due for auto-unload:`];
      for (const e of c.list || []) {
        let age = "?";
        try {
          const mins = Math.max(0, Math.round((Date.now() - (e.lastViewed || 0)) / 60000));
          age = e.lastViewed ? `${mins}m ago` : "never tracked";
        } catch (_e) {}
        lines.push(`  ws=${e.ws || "?"} ${e.host || "(no host)"} — ${e.title || "(no title)"} [${age}]`);
      }
      if (c.total > (c.list || []).length) {
        lines.push(`  …and ${c.total - c.list.length} more`);
      }
      const msg = lines.join("\n");
      try {
        if (typeof Services !== "undefined" && Services && Services.console) {
          Services.console.logStringMessage(msg);
          return;
        }
      } catch (e) {}
      try {
        if (typeof console !== "undefined" && console.log) {
          console.log(msg);
        }
      } catch (e) {}
    } catch (e) {}
  }

  // Live counts for the Open Stash row (same dry-run-count idiom as
  // the unload row): "3 stashed tabs · 2 workspace stashes". Any
  // failure reads as the plain subtitle.
  function openStashSub() {
    const base = "Browse and restore stashed tabs + workspace stashes";
    try {
      const a = typeof arc === "function" ? arc() : null;
      if (!a) {
        return base;
      }
      let tabs = -1;
      let stashes = -1;
      try {
        if (typeof a.getStashEntries === "function") {
          const e = a.getStashEntries();
          tabs = Array.isArray(e) ? e.length : -1;
        }
      } catch (e) {}
      try {
        if (typeof a.listStashes === "function") {
          const s = a.listStashes();
          stashes = Array.isArray(s) ? s.length : -1;
        }
      } catch (e) {}
      if (tabs < 0 && stashes < 0) {
        return base;
      }
      const bits = [];
      if (tabs >= 0) {
        bits.push(`${tabs} stashed tab${tabs === 1 ? "" : "s"}`);
      }
      if (stashes >= 0) {
        bits.push(`${stashes} workspace stash${stashes === 1 ? "" : "es"}`);
      }
      return bits.length ? bits.join(" · ") : base;
    } catch (e) {}
    return base;
  }

  // One row per saved workspace stash, fuzzy-findable by name AND by
  // what it contains (member hosts ride the sub line, so the normal
  // title/sub scorer matches them). Kept out of the empty-query path
  // (see commands()'s "pool" mode below) so the home list stays curated
  // — they only surface once you type. Restore is append-only: it opens
  // alongside whatever you have now.
  // Host of one stashed URL for the restore-row sub line. Prefers the
  // URL constructor, falls back to a scheme://host grab (same shape as
  // the stash shared logic) — and never throws, so one junk URL can't
  // hide every restore row. `typeof URL` guards node:vm test sandboxes,
  // where the constructor doesn't exist.
  function hostOfTabUrl(url) {
    try {
      const spec = String(url || "");
      if (typeof URL === "function") {
        try {
          const h = (new URL(spec).hostname || "").toLowerCase().replace(/\.$/, "");
          if (h) {
            return h;
          }
        } catch (e) {}
      }
      const m = spec.match(/^[a-z]+:\/\/([^/:?#]+)/i);
      return m ? m[1].toLowerCase().replace(/\.$/, "") : "";
    } catch (e) {
      return "";
    }
  }

  function stashHosts(s) {
    const out = [];
    try {
      const seen = new Set();
      for (const t of (s && s.tabs) || []) {
        let h = "";
        try {
          h = hostOfTabUrl((t && t.url) || "");
        } catch (e) {}
        if (h && !seen.has(h)) {
          seen.add(h);
          out.push(h);
        }
        if (out.length >= 3) {
          break;
        }
      }
    } catch (e) {}
    return out;
  }

  function stashRestoreRows() {
    const out = [];
    try {
      const a = arc();
      if (!a || typeof a.listStashes !== "function") {
        return out;
      }
      const list = a.listStashes();
      if (!Array.isArray(list)) {
        return out;
      }
      for (const s of list.slice(0, 20)) {
        try {
          if (!s || !s.id || !Array.isArray(s.tabs) || !s.tabs.length) {
            continue;
          }
          const n = s.tabs.length;
          const hosts = stashHosts(s);
          out.push({
            title: `Restore ${s.name || "stash"}`,
            hint: "",
            sub: `WS ${s.ws || "1"} · ${n} tab${n === 1 ? "" : "s"}${hosts.length ? ` · ${hosts.join(" · ")}` : ""} · opens alongside current tabs`,
            run: () => {
              try {
                const c = arc();
                if (c && typeof c.restoreStash === "function") {
                  c.restoreStash(s.id);
                }
              } catch (e) {}
            },
          });
        } catch (e) {}
      }
    } catch (e) {}
    return out;
  }

  function commands() {
    const api = ws();
    const cmds = [];
    // Workspaces (custom name + bound container shown when present)
    for (let i = 1; i <= 9; i++) {
      const n = String(i);
      cmds.push({
        title: `Switch to ${wsFull(api, n)}`,
        hint: `Alt+${n}`,
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
      ...closeDupesRows(api),
      ...splitViewRows(api),
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
        title: "Show Unload Candidates",
        hint: "",
        sub: unloadCandidatesSub(api),
        run: () => {
          try {
            logUnloadCandidates(api);
          } catch (e) {}
        },
      },
      {
        title: stashCmdTitle(),
        hint: "",
        sub: "Saves workspace + container, closes the tab · restorable",
        run: () => {
          try {
            if (arc() && arc().stashCurrent) {
              arc().stashCurrent();
            }
          } catch (e) {}
        },
      },
      {
        title: "Stash Current Workspace…",
        hint: "",
        sub: "Saves every tab in this workspace as one named snapshot · nothing is closed",
        run: () => {
          try {
            const a = arc();
            if (a && typeof a.saveStash === "function") {
              const n = a.saveStash();
              if (!n) {
                return;
              }
            }
          } catch (e) {}
        },
      },
      ...stashRestoreRows(),
      {
        title: "Open Stash",
        hint: "",
        sub: openStashSub(),
        run: () => {
          try {
            if (arc() && arc().openStash && arc().openStash()) {
              return;
            }
          } catch (e) {}
          try {
            const t = gBrowser.addTrustedTab(
              "chrome://browser/content/aph-stash.html"
            );
            try {
              gBrowser.selectedTab = t;
            } catch (_e) {}
          } catch (e) {}
        },
      },
      {
        title: "Open Aph Settings",
        hint: "",
        sub: "Toggles for workspaces, stash, tabs and sidebar",
        run: () => {
          try {
            const url = "chrome://browser/content/aph-settings.html";
            for (const t of Array.from((gBrowser && gBrowser.tabs) || [])) {
              try {
                const spec =
                  t && t.linkedBrowser && t.linkedBrowser.currentURI && t.linkedBrowser.currentURI.spec;
                if (!t.closing && spec === url) {
                  gBrowser.selectedTab = t;
                  return;
                }
              } catch (_e) {}
            }
          } catch (e) {}
          try {
            const t = gBrowser.addTrustedTab(
              "chrome://browser/content/aph-settings.html"
            );
            try {
              gBrowser.selectedTab = t;
            } catch (_e) {}
          } catch (e) {}
        },
      },
      {
        title: "Open Aph Welcome",
        hint: "",
        sub: "First-run tour: workspaces, palette and tabs",
        run: () => {
          try {
            const url = "chrome://browser/content/aph-welcome.html";
            for (const t of Array.from((gBrowser && gBrowser.tabs) || [])) {
              try {
                const spec =
                  t && t.linkedBrowser && t.linkedBrowser.currentURI && t.linkedBrowser.currentURI.spec;
                if (!t.closing && spec === url) {
                  gBrowser.selectedTab = t;
                  return;
                }
              } catch (_e) {}
            }
          } catch (e) {}
          try {
            const t = gBrowser.addTrustedTab(
              "chrome://browser/content/aph-welcome.html"
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
        // Same ✓/○ convention as above; state reads live from the
        // window API (session-only, per-window — no pref behind it).
        // keepOpen + repaint, like the sibling toggle: the row flips
        // in place instead of looking dead.
        title: (() => {
          try {
            const w = ws();
            if (w && typeof w.getFocusMode === "function" && w.getFocusMode()) {
              return "✓ Focus Mode (On)";
            }
          } catch (e) {}
          return "○ Focus Mode (Off)";
        })(),
        hint: "Ctrl+Alt+F",
        sub: "Hide every chrome surface, page only · session-only, this window",
        keepOpen: true,
        run: () => {
          try {
            const w = ws();
            if (w && typeof w.toggleFocusMode === "function") {
              w.toggleFocusMode();
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
        } else if (r.hint === "Stash") {
          tag(r, "stash", "Stash");
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

    // Empty query: curated home per mode (stays clean, no places/stash).
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
      // bookmarks/history/stash with no query: nothing (needs 2+ chars).
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
    if (mode === "stash") {
      try {
        if (typeof aphStashPoolItems === "function") {
          const pool = tagPlacesRows(aphStashPoolItems(raw));
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
      if (typeof aphStashPoolItems === "function") {
        for (const r of aphStashPoolItems(raw)) {
          pool.push(tag(r, "stash", "Stash"));
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

