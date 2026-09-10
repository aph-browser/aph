/* GENERATED — do not edit by hand. Edit branding/src/, then run: python scripts/build_assets.py */
/* Aph command palette: Ctrl+K / Cmd+K toggles a filterable overlay.
 * Commands + open tabs in one list, scored fuzzy matching with match
 * highlighting. Doubles as navigation: URL-like input offers "Go to …"
 * (opened in the current workspace's bound container), anything else falls
 * back to a DuckDuckGo search. Enter opens, Alt+Enter opens in a new
 * disposable temp container. Up/Down + Enter to run, Esc to close.
 * Injected into browser.xhtml via rebrand.py (chrome://browser/content/command-palette.js).
 */
(function () {
  if (window.__aphPaletteLoaded) {
    return;
  }
  window.__aphPaletteLoaded = true;

  let overlay = null;
  let input = null;
  let list = null;
  let items = [];
  let selected = 0;
  // Rename prompt mode: {title, initial, onCommit} — the input becomes a
  // text field and Enter commits instead of running a row.
  let prompt = null;
  const PLACEHOLDER = "Type a command, tab, URL, or search…";

  function ws() {
    return window.AphWorkspaces || null;
  }

  function wsContainerSuffix(api, n) {
    try {
      if (api && api.getWsContainer && api.describeContainer) {
        const id = api.getWsContainer(n);
        if (id) {
          const d = api.describeContainer(id);
          if (d && d.name) {
            return ` · ${d.name}`;
          }
        }
      }
    } catch (e) {}
    return "";
  }

  function wsName(api, n) {
    try {
      if (api && api.getWsName) {
        return api.getWsName(n) || "";
      }
    } catch (e) {}
    return "";
  }

  // "Workspace 2 (💼 Work) · Work" — number first so fuzzy prefixes and
  // existing muscle memory keep working; name/suffix only refine it.
  function wsFull(api, n) {
    const name = wsName(api, n);
    return `Workspace ${n}${name ? ` (${name})` : ""}${wsContainerSuffix(api, n)}`;
  }

  function arc() {
    try {
      return window.AphArchive || null;
    } catch (e) {
      return null;
    }
  }

  // "Archive Current Tab", or "Archive N Tabs" when a multiselection is
  // pending. Fully guarded: the archive controller may be absent (tests).
  function archiveCmdTitle() {
    try {
      const a = arc();
      if (a && typeof a.pendingCount === "function" && a.pendingCount() > 1) {
        return `Archive ${a.pendingCount()} Tabs`;
      }
    } catch (e) {}
    try {
      const n = (gBrowser.selectedTabs || gBrowser.multiselectedTabs || []).length;
      if (n > 1) {
        return `Archive ${n} Tabs`;
      }
    } catch (e) {}
    return "Archive Current Tab";
  }

  // "Send Active Tab to …", or "Send N Tabs to …" when a multiselection is
  // pending (sendTabTo moves the whole selection).
  function sendTabTitle(api, n) {
    try {
      const m = (gBrowser.selectedTabs || gBrowser.multiselectedTabs || []).length;
      if (m > 1) {
        return `Send ${m} Tabs to ${wsFull(api, n)}`;
      }
    } catch (e) {}
    return `Send Active Tab to ${wsFull(api, n)}`;
  }

  // --- URL / search fallback -------------------------------------------
  // Direct navigation: "github.com", "localhost:3000", "https://…".
  // Anything with whitespace is a search, never a URL.
  function isLikelyURL(str) {
    const s = (str || "").trim();
    if (!s || /\s/.test(s)) {
      return false;
    }
    if (/^https?:\/\//i.test(s)) {
      return true;
    }
    if (/^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(:\d+)?(\/.*)?$/i.test(s)) {
      return true;
    }
    // Dotted hostnames where the final label contains a letter
    // ("github.com", "file.txt") — pure numerics ("v1.2.3", "1.2")
    // are versions, not hosts, and fall through to search.
    if (/^[a-zA-Z0-9-]+(\.[a-zA-Z0-9-]+)*(\.[a-zA-Z0-9-]*[a-zA-Z][a-zA-Z0-9-]*)(:\d+)?(\/.*)?$/.test(s)) {
      return true;
    }
    // IPv4 (plain or LAN) with optional port/path.
    if (/^\d{1,3}(\.\d{1,3}){3}(:\d+)?(\/.*)?$/.test(s)) {
      return true;
    }
    // Bare host with an explicit port/path, e.g. mybox:8080/status.
    if (/^[a-zA-Z0-9-]+(:\d+)(\/.*)?$/.test(s)) {
      return true;
    }
    return false;
  }

  function normalizeURL(str) {
    const s = (str || "").trim();
    if (/^https?:\/\//i.test(s)) {
      return s;
    }
    // Local / LAN hosts rarely serve TLS — plain http avoids a cert error.
    if (/^(localhost|127\.|0\.0\.0\.0|\[::1\]|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/i.test(s)) {
      return `http://${s}`;
    }
    return `https://${s}`;
  }

  function searchURL(q) {
    return `https://duckduckgo.com/?q=${encodeURIComponent(q)}`;
  }

  // Container-aware launch: bound container of the current workspace wins
  // (openBoundTab), temp forces a disposable container. A URL matching a
  // domain route opens directly in the routed workspace, so the router
  // doesn't have to close + reopen it a moment later (no double-hop).
  // Falls back to a plain selected tab when the workspaces API is missing.
  function openURL(url, temp) {
    const api = ws();
    try {
      if (temp && api && api.openTempTab) {
        api.openTempTab(url);
        return;
      }
      if (!temp && api && api.openBoundTab) {
        api.openBoundTab(url, routedWs(api, url));
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

  function hostOfURL(url) {
    try {
      return (new URL(url).hostname || "").toLowerCase().replace(/\.$/, "");
    } catch (e) {
      try {
        const m = String(url || "").match(/^[a-z]+:\/\/([^/:?#]+)/i);
        return m ? m[1].toLowerCase().replace(/\.$/, "") : "";
      } catch (_e) {
        return "";
      }
    }
  }

  // Workspace a URL would route to ("" when none). Temp tabs ignore this
  // on purpose — Alt+Enter is an explicit disposable choice.
  function routedWs(api, url) {
    try {
      if (api && api.matchRoute) {
        const m = api.matchRoute(hostOfURL(url));
        if (m && m.ws) {
          return m.ws;
        }
      }
    } catch (e) {}
    return "";
  }

  function boundContainerNote() {
    try {
      const api = ws();
      if (api && api.getCurrent && api.getWsContainer && api.describeContainer) {
        const id = api.getWsContainer(api.getCurrent());
        if (id) {
          const d = api.describeContainer(id);
          if (d && d.name) {
            return ` · opens in ${d.name}`;
          }
        }
      }
    } catch (e) {}
    return "";
  }

  // Always present for non-empty input so Enter never dead-ends: a "Go to"
  // entry for URL-like input (surfaced first by allItems), else a
  // DuckDuckGo search (surfaced last).
  function navFallback(raw) {
    const q = (raw || "").trim();
    if (!q) {
      return null;
    }
    const note = `${boundContainerNote()} · Alt+Enter opens temp`;
    if (isLikelyURL(q)) {
      const url = normalizeURL(q);
      const dest = routedWs(ws(), url);
      return {
        title: `Go to ${url}`,
        sub: `${url}${dest ? ` · auto-routes to WS ${dest}` : note}`,
        hint: "Enter",
        run: () => openURL(url, false),
        runInTemp: () => openURL(url, true),
      };
    }
    const shown = q.length > 60 ? `${q.slice(0, 60)}…` : q;
    const url = searchURL(q);
    return {
      title: `Search DuckDuckGo for: "${shown}"`,
      sub: `${url}${note}`,
      hint: "Enter",
      run: () => openURL(url, false),
      runInTemp: () => openURL(url, true),
    };
  }

  // --- Scored fuzzy matching --------------------------------------------
  // Tiers: exact prefix (1000s) > word-boundary substring (800s) >
  // plain substring (600s) > subsequence (400s baseline with
  // consecutive/word-start bonuses, gap penalties). An all-word-start
  // acronym match (+300, e.g. "nt" → "New Tab") outranks mid-word
  // substrings ("curreNT") but stays below word-boundary substrings and
  // prefixes. Returns null on no match.
  function fuzzyScore(query, text) {
    const needle = (query || "").toLowerCase();
    const hay = (text || "").toLowerCase();
    const n = needle.length;
    if (!n || !hay) {
      return n ? null : { score: 0, indices: [] };
    }
    const isBoundary = (i) => i === 0 || /[^a-z0-9]/.test(hay[i - 1]);
    if (hay.startsWith(needle)) {
      const indices = [];
      for (let i = 0; i < n; i++) {
        indices.push(i);
      }
      return { score: 1000 - hay.length, indices };
    }
    const at = hay.indexOf(needle);
    if (at !== -1) {
      const indices = [];
      for (let i = 0; i < n; i++) {
        indices.push(at + i);
      }
      return { score: (isBoundary(at) ? 800 : 600) - at, indices };
    }
    // Subsequence: best of earliest and word-start-preferring alignments.
    const a = subseqAlign(needle, hay, isBoundary, false);
    const b = subseqAlign(needle, hay, isBoundary, true);
    if (a && b) {
      return b.score >= a.score ? b : a;
    }
    return a || b;
  }

  // One subsequence alignment pass. With preferBoundary, each query char
  // lands on the earliest word-start at/after the cursor when one exists
  // (so "w2" aligns to "Workspace 2", not the "w" in "switch"); otherwise
  // the earliest occurrence. Returns null when the query isn't a
  // subsequence of the text.
  function subseqAlign(needle, hay, isBoundary, preferBoundary) {
    const n = needle.length;
    const indices = [];
    let ti = 0;
    let first = -1;
    let gaps = 0;
    let consec = 0;
    let bounds = 0;
    let prev = -2;
    for (let qi = 0; qi < n; qi++) {
      const c = needle[qi];
      let f = -1;
      let fb = -1;
      for (let j = ti; j < hay.length; j++) {
        if (hay[j] === c) {
          if (f === -1) {
            f = j;
          }
          if (isBoundary(j)) {
            fb = j;
            break;
          }
        }
      }
      if (f === -1) {
        return null;
      }
      if (preferBoundary && fb !== -1) {
        f = fb;
      }
      if (first === -1) {
        first = f;
      }
      if (f === prev + 1) {
        consec++;
      } else {
        gaps += f - prev - 1;
      }
      if (isBoundary(f)) {
        bounds++;
      }
      indices.push(f);
      prev = f;
      ti = f + 1;
    }
    let score = 400 + consec * 10 + bounds * 8 - gaps * 4 - first;
    // Acronym: every query char lands on a word start ("nt" → "New Tab").
    // Beats mid-word substrings ("curreNT") but stays below real substrings
    // at word boundaries and prefixes.
    if (bounds === n) {
      score += 300;
    }
    return { score, indices };
  }

  // Best of title / sub / hint (sub and hint count slightly less, so a
  // title hit outranks metadata); keeps all index sets so paint() can
  // highlight each field that matched.
  function matchItem(it, q) {
    const tm = fuzzyScore(q, it.title || "");
    const sm = it.sub ? fuzzyScore(q, it.sub) : null;
    const hm = it.hint ? fuzzyScore(q, it.hint) : null;
    if (!tm && !sm && !hm) {
      return null;
    }
    const score = Math.max(
      tm ? tm.score : -Infinity,
      sm ? sm.score - 50 : -Infinity,
      hm ? hm.score - 100 : -Infinity
    );
    return {
      score,
      ti: tm ? tm.indices : [],
      si: sm ? sm.indices : [],
      hi: hm ? hm.indices : [],
    };
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

  function build() {
    overlay = document.createElement("div");
    overlay.id = "aph-palette-overlay";
    overlay.hidden = true;

    const box = document.createElement("div");
    box.id = "aph-palette";

    input = document.createElement("input");
    input.id = "aph-palette-input";
    input.setAttribute("placeholder", PLACEHOLDER);
    input.setAttribute("autocomplete", "off");
    input.setAttribute("spellcheck", "false");
    input.addEventListener("input", () => render(input.value));
    input.addEventListener("keydown", onListKey, true);

    list = document.createElement("div");
    list.id = "aph-palette-list";

    box.appendChild(input);
    box.appendChild(list);
    overlay.appendChild(box);
    overlay.addEventListener("mousedown", (e) => {
      if (e.target === overlay) {
        close();
      }
    });
    // Chrome document root (browser.xhtml): body may not exist yet.
    (document.body || document.documentElement).appendChild(overlay);
  }

  function render(filter) {
    if (prompt) {
      items = [
        {
          title: prompt.title,
          sub: "Empty clears back to “Workspace N”",
          hint: "Enter saves · Esc cancels",
        },
      ];
      selected = 0;
      paint();
      return;
    }
    items = allItems(filter);
    selected = 0;
    paint();
  }

  // Highlight matched characters (fuzzy index sets); plain text otherwise.
  function paintText(el, text, set) {
    try {
      if (!set || set.size === 0) {
        el.textContent = text;
        return;
      }
      let buf = "";
      let cur = null;
      const flush = () => {
        if (!buf) {
          return;
        }
        if (cur) {
          const mark = document.createElement("span");
          mark.className = "aph-palette-mark";
          mark.textContent = buf;
          el.appendChild(mark);
        } else {
          el.appendChild(document.createTextNode(buf));
        }
        buf = "";
      };
      for (let i = 0; i < text.length; i++) {
        const m = set.has(i);
        if (cur === null) {
          cur = m;
        } else if (m !== cur) {
          flush();
          cur = m;
        }
        buf += text[i];
      }
      flush();
    } catch (e) {
      try {
        el.textContent = text;
      } catch (_e) {}
    }
  }

  function paint() {
    while (list.firstChild) {
      list.removeChild(list.firstChild);
    }
    items.forEach((it, i) => {
      const row = document.createElement("div");
      row.className = "aph-palette-item" + (i === selected ? " selected" : "");
      const main = document.createElement("span");
      main.className = "aph-palette-title";
      paintText(main, it.title, it._hl && it._hl.t);
      row.appendChild(main);
      if (it.hint) {
        const h = document.createElement("span");
        h.className = "aph-palette-hint";
        paintText(h, it.hint, it._hl && it._hl.h);
        row.appendChild(h);
      }
      if (it.sub) {
        const s = document.createElement("div");
        s.className = "aph-palette-sub";
        paintText(s, it.sub, it._hl && it._hl.s);
        row.appendChild(s);
      }
      row.addEventListener("mousedown", (e) => {
        e.preventDefault();
        selected = i;
        choose();
      });
      row.addEventListener("mousemove", () => {
        if (selected !== i) {
          selected = i;
          paint();
        }
      });
      list.appendChild(row);
    });
    const sel = list.querySelector(".aph-palette-item.selected");
    if (sel) {
      try {
        sel.scrollIntoView({ block: "nearest" });
      } catch (e) {}
    }
  }

  function open() {
    if (!overlay) {
      build();
    }
    prompt = null;
    overlay.hidden = false;
    input.value = "";
    try {
      input.setAttribute("placeholder", PLACEHOLDER);
    } catch (e) {}
    render("");
    setTimeout(() => {
      try {
        input.focus();
      } catch (e) {}
    }, 0);
  }

  // Rename prompt: replaces the list with a single commit row; typing
  // filters nothing, Enter commits, Esc cancels (via close).
  function startPrompt(opts) {
    if (!overlay) {
      build();
    }
    if (!overlay || !input) {
      return;
    }
    prompt = opts;
    overlay.hidden = false;
    try {
      input.setAttribute("placeholder", opts.title);
    } catch (e) {}
    try {
      input.value = opts.initial || "";
    } catch (e) {}
    render("");
    setTimeout(() => {
      try {
        input.focus();
      } catch (e) {}
      try {
        if (input.select) {
          input.select();
        }
      } catch (e) {}
    }, 0);
  }

  function renameCurrent() {
    const api = ws();
    if (!api || !api.getCurrent || !api.setWsName) {
      return;
    }
    let n = "1";
    try {
      n = api.getCurrent() || "1";
    } catch (e) {}
    let cur = "";
    try {
      cur = (api.getWsName && api.getWsName(n)) || "";
    } catch (e) {}
    startPrompt({
      title: `Rename Workspace ${n} — Enter saves, Esc cancels`,
      initial: cur,
      onCommit: (v) => {
        try {
          api.setWsName(n, v);
        } catch (e) {}
      },
    });
  }

  // Tab rename entry point: prompts for the selected tab via the tab-rename
  // controller (branding/tabrename.js). No-ops when it is absent (tests).
  function renameCurrentTab() {
    let api = null;
    try {
      api = window.AphTabRename || null;
    } catch (e) {}
    if (!api || typeof api.promptRename !== "function") {
      return;
    }
    let tab = null;
    try {
      tab = gBrowser.selectedTab;
    } catch (e) {}
    if (!tab) {
      return;
    }
    try {
      api.promptRename(tab);
    } catch (e) {}
  }

  function close() {
    prompt = null;
    if (overlay) {
      overlay.hidden = true;
    }
  }

  function isOpen() {
    return overlay && !overlay.hidden;
  }

  function toggle() {
    if (isOpen()) {
      close();
    } else {
      open();
    }
  }

  // Alt+Enter forces the disposable temp container when the entry
  // supports it (URL / search fallback); plain Enter uses run().
  // In rename-prompt mode Enter commits the input instead. Rows marked
  // keepOpen (e.g. Rename) run without closing first.
  function choose(useTemp) {
    if (prompt) {
      const cb = prompt.onCommit;
      let v = "";
      try {
        v = input.value;
      } catch (e) {}
      prompt = null;
      close();
      if (!cb) {
        return;
      }
      try {
        cb(v);
      } catch (e) {}
      return;
    }
    const it = items[selected];
    if (!it) {
      close();
      return;
    }
    if (!it.keepOpen) {
      close();
    }
    try {
      if (useTemp && it.runInTemp) {
        it.runInTemp();
      } else {
        it.run();
      }
    } catch (e) {}
  }

  // True when keyboard focus sits in editable text that isn't our own
  // input — urlbar, inputs, textareas, contenteditable editors. Same
  // shape as isEditableTarget() in workspaces.js, rooted at the active
  // element instead of the event target.
  function isEditableFocused() {
    try {
      const ae = document.activeElement;
      if (!ae || ae === input) {
        return false;
      }
      const tn = String(ae.tagName || ae.localName || "").toLowerCase();
      if (tn === "input" || tn === "textarea" || tn === "select") {
        return true;
      }
      if (ae.isContentEditable) {
        return true;
      }
      if (typeof ae.closest === "function" && ae.closest("[contenteditable],#urlbar,#searchbar")) {
        return true;
      }
      return false;
    } catch (e) {
      return false;
    }
  }

  function onListKey(e) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      e.stopPropagation();
      if (items.length) {
        selected = (selected + 1) % items.length;
        paint();
      }
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      e.stopPropagation();
      if (items.length) {
        selected = (selected - 1 + items.length) % items.length;
        paint();
      }
    } else if (e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      choose(!!e.altKey);
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close();
    }
  }

  function onKey(e) {
    if (e.repeat) {
      return;
    }
    const mod = e.ctrlKey || e.metaKey;
    // Toggle on Ctrl/⌘+K (hijack Firefox's search-focus binding).
    if (mod && !e.altKey && !e.shiftKey && e.code === "KeyK") {
      // Never steal keystrokes from editable text (urlbar, sidebar
      // inputs, devtools, page editors). Our own field is exempt so
      // Ctrl+K still closes an open palette.
      if (!isOpen() && isEditableFocused()) {
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      toggle();
      return;
    }
    if (!isOpen()) {
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close();
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter") {
      // Input-level handler covers these when focused; this is the fallback.
      onListKey(e);
    }
  }

  window.addEventListener("keydown", onKey, true);

  // Public API for the workspace badge / shortcuts / tab rename.
  try {
    window.AphPalette = { open, toggle, renameCurrent, prompt: startPrompt };
  } catch (e) {}

  if (document.readyState === "complete") {
    build();
  } else {
    window.addEventListener("load", build, { once: true });
  }
})();
