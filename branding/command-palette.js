/* GENERATED — do not edit by hand. Edit branding/src/, then run: python scripts/build_assets.py */
/* Aph command palette: Ctrl+K / Cmd+K toggles a filterable overlay.
 * Commands + open tabs in one list, scored fuzzy matching with match
 * highlighting. Typed queries also search Places bookmarks and history
 * (frecency-ordered, history hidden in private windows) and saved
 * archive entries (restoring re-opens with workspace + container).
 * Doubles as navigation: URL-like input offers "Go to …"
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
  let footer = null;
  let items = [];
  let selected = 0;
  // Rename prompt mode: {title, initial, onCommit} — the input becomes a
  // text field and Enter commits instead of running a row.
  let prompt = null;
  // Pending close-animation timer (cancelled when the palette reopens).
  let closeTimer = null;
  // Sacred return-of-focus: element that held focus before open() stole it
  // (page input, editor, video player). Restored on hide so Esc never dumps
  // focus to <body> or the urlbar. Cleared after restore.
  let returnFocusTo = null;
  // Last committed query (choose() via Enter). Empty-ArrowUp recalls it,
  // terminal-history style. Session-only, never persisted.
  let lastCommittedQuery = "";
  // DOM recycling pools: rows/headers/empty-state are created once and
  // reconfigured in place per paint() — no per-keystroke teardown, no GC
  // spikes. Detached (not destroyed) between paints via list child moves.
  let rowPool = [];
  let headerPool = [];
  let emptyEl = null;
  const PLACEHOLDER = "Type a command, tab, bookmark, history, archive, URL, or search…";
  // Per-open caches: commands()/openTabs() are rebuilt once per open() so
  // per-keystroke work is scoring only (<50ms on huge sessions).
  let cachedCommands = null;
  let cachedTabs = null;
  // Command frecency: {title: {uses, last}} — in-memory + persisted to a
  // pref as JSON (capped). Sync only, best-effort, never breaks the palette.
  var APH_FRECENCY_PREF = "aph.palette.frecency";
  var APH_FRECENCY_MAX = 100;
  let frecMap = null;
  // Section order for grouped rendering (Go first, Search last — matches
  // the old unshift/push navFallback contract).
  const SECTION_ORDER = ["Go", "Tabs", "Commands", "Workspaces", "Bookmarks", "History", "Archive", "Help", "Search"];
  const SECTION_CAP = 12;
  const TOTAL_CAP = 80;
  // Kind -> icon glyph (text, no external assets in chrome context).
  const KIND_ICONS = {
    go: "→",
    tab: "◐",
    command: "⌘",
    workspace: "⛁",
    bookmark: "★",
    history: "🕘",
    archive: "▣",
    help: "?",
    search: "⌕",
    action: "⚡",
  };
  const MODE_PLACEHOLDERS = {
    all: PLACEHOLDER,
    commands: "Type a command…  (Esc clears, ? lists modes)",
    tabs: "Type a tab title or URL…  (@ tabs only)",
    workspaces: "Type a workspace, route, or bind…  (# workspaces only)",
    bookmarks: "Search bookmarks…  (b: prefix)",
    history: "Search history…  (h: prefix)",
    archive: "Search archived tabs…  (a: prefix)",
    help: "Pick a mode to learn…",
  };

  // --- Prefix modes (VSCode/Raycast style) -------------------------------
  // ">" commands · "@" tabs · "#" workspaces/routes/binds · "?" help ·
  // "b:" bookmarks · "h:" history · "a:" archive. Bare text = unified
  // search across everything. Single-char modes only trigger on the very
  // first character so normal queries ("apple", "history of…") never break.
  // Returns {mode, q} where q is the de-prefixed query (trimmed).
  function parseMode(raw) {
    const s = (raw || "").trim();
    if (!s) {
      return { mode: "all", q: "" };
    }
    const first = s[0];
    if (first === ">" || first === "@" || first === "#" || first === "?") {
      return { mode: modeForPrefix(first), q: s.slice(1).trim() };
    }
    // Extended "x:" modes — only when a colon follows a short key.
    const m = s.match(/^([a-zA-Z])\s*:\s*(.*)$/);
    if (m) {
      const k = m[1].toLowerCase();
      if (k === "b") {
        return { mode: "bookmarks", q: (m[2] || "").trim() };
      }
      if (k === "h") {
        return { mode: "history", q: (m[2] || "").trim() };
      }
      if (k === "a") {
        return { mode: "archive", q: (m[2] || "").trim() };
      }
    }
    return { mode: "all", q: s };
  }

  function modeForPrefix(p) {
    if (p === ">") {
      return "commands";
    }
    if (p === "@") {
      return "tabs";
    }
    if (p === "#") {
      return "workspaces";
    }
    return "help";
  }

  function modePrefix(mode) {
    if (mode === "commands") {
      return ">";
    }
    if (mode === "tabs") {
      return "@";
    }
    if (mode === "workspaces") {
      return "#";
    }
    if (mode === "bookmarks") {
      return "b:";
    }
    if (mode === "history") {
      return "h:";
    }
    if (mode === "archive") {
      return "a:";
    }
    if (mode === "help") {
      return "?";
    }
    return "";
  }

  function placeholderFor(mode) {
    try {
      return MODE_PLACEHOLDERS[mode] || PLACEHOLDER;
    } catch (e) {
      return PLACEHOLDER;
    }
  }

  // Static help rows — the "?" mode. keepOpen so users can read then type.
  function helpItems() {
    const rows = [
      [">", "Commands", "All palette commands · e.g. >bind, >new tab"],
      ["@", "Tabs", "Open tabs only · e.g. @github · Ctrl+W closes highlighted tab"],
      ["#", "Workspaces", "Switch / send / routes / binds · e.g. #work, #route"],
      ["b:", "Bookmarks", "Bookmark search only · e.g. b:github"],
      ["h:", "History", "History search only · e.g. h:docs"],
      ["a:", "Archive", "Archived tabs only · e.g. a:report · Enter restores"],
      ["?", "Help", "This cheat-sheet"],
      ["Tab", "Autocomplete", "Fills the selected row title into the input"],
      ["Alt+1–9", "Quick pick", "Runs the Nth visible row"],
      ["Alt+Enter", "Temp container", "Opens URLs / restores archive without consuming"],
      ["Ctrl+N/P", "Navigate", "Move selection up/down without arrow keys"],
      ["Ctrl+W", "Close tab", "Closes the highlighted tab · palette stays open"],
      ["Shift+Enter", "Temp alias", "Same as Alt+Enter"],
    ];
    return rows.map(([key, title, sub]) => ({
      title: `${key}  ${title}`,
      sub,
      hint: "Help",
      kind: "help",
      section: "Help",
      icon: KIND_ICONS.help,
      run: () => {
        try {
          if (input) {
            input.value = key.length <= 2 ? key : "";
            render(input.value);
            try {
              input.focus();
            } catch (_e) {}
          }
        } catch (e) {}
      },
      keepOpen: true,
    }));
  }

  // Footer hint per mode (rendered in #aph-palette-footer).
  function footerHintFor(mode, count) {
    const n = `${count} result${count === 1 ? "" : "s"}`;
    switch (mode) {
      case "tabs":
        return `${n} · ↑↓/Ctrl+N/P · Enter switch · Ctrl+W close · Esc clear`;
      case "commands":
        return `${n} · ↑↓ navigate · Enter run · Tab complete · Esc clear`;
      case "workspaces":
        return `${n} · Enter switch / send / apply route · Esc clear`;
      case "bookmarks":
      case "history":
      case "archive":
        return `${n} · Enter open / restore · Alt+Enter temp · Esc clear`;
      case "help":
        return `Enter inserts prefix · Esc closes`;
      default:
        return `${n} · ↑↓ navigate · Enter open · Alt+Enter temp · ? modes`;
    }
  }
  // --- Command frecency (sync, best-effort) ------------------------------
  // Frequently + recently used commands float up. Persisted as JSON in a
  // pref so it survives restarts; in-memory only when Services is absent
  // (tests). recordFrecency() is called from choose(); frecBoost() is
  // added to the fuzzy score in allItems().
  function loadFrecency() {
    if (frecMap) {
      return frecMap;
    }
    frecMap = {};
    try {
      if (
        typeof Services !== "undefined" &&
        Services &&
        Services.prefs &&
        typeof Services.prefs.getCharPref === "function"
      ) {
        let raw = "";
        try {
          raw = Services.prefs.getCharPref(APH_FRECENCY_PREF);
        } catch (e) {
          raw = "";
        }
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed && typeof parsed === "object") {
            frecMap = parsed;
          }
        }
      }
    } catch (e) {
      frecMap = frecMap || {};
    }
    return frecMap;
  }

  function saveFrecency() {
    try {
      if (
        typeof Services === "undefined" ||
        !Services ||
        !Services.prefs ||
        typeof Services.prefs.setCharPref !== "function"
      ) {
        return;
      }
      const map = frecMap || {};
      const keys = Object.keys(map);
      // Cap: keep most-recently used.
      if (keys.length > APH_FRECENCY_MAX) {
        keys
          .sort((a, b) => (map[a].last || 0) - (map[b].last || 0))
          .slice(0, keys.length - APH_FRECENCY_MAX)
          .forEach((k) => {
            delete map[k];
          });
      }
      try {
        Services.prefs.setCharPref(APH_FRECENCY_PREF, JSON.stringify(map));
      } catch (e) {}
    } catch (e) {}
  }

  function frecIdFor(it) {
    try {
      // Stable enough: command titles are static except counts
      // ("Archive N Tabs" normalizes to "Archive Tab").
      const t = String((it && it.title) || "");
      return t.replace(/\b\d+ Tabs\b/, "Tab").replace(/\b\d+\b/g, "#");
    } catch (e) {
      return "";
    }
  }

  // +0..150: 5 points per use (cap 100) + recency decay (50 max, halves
  // after ~3 days). Tabs/places/archive get at most the usage part — the
  // recency kick is commands-only so MRU tabs keep their own order.
  function frecBoost(it) {
    try {
      const map = loadFrecency();
      const id = frecIdFor(it);
      if (!id || !map[id]) {
        return 0;
      }
      const e = map[id];
      const uses = Math.min(100, (e.uses || 0) * 5);
      let recency = 0;
      try {
        const age = Date.now() - (e.last || 0);
        if (age < 0) {
          recency = 0;
        } else if (age < 86400000) {
          recency = 50;
        } else if (age < 3 * 86400000) {
          recency = 25;
        } else if (age < 7 * 86400000) {
          recency = 10;
        }
      } catch (_e) {}
      const isCmd = it && (it.kind === "command" || it.section === "Commands" || it.section === "Workspaces");
      return uses + (isCmd ? recency : 0);
    } catch (e) {
      return 0;
    }
  }

  function recordFrecency(it) {
    try {
      const id = frecIdFor(it);
      if (!id) {
        return;
      }
      const map = loadFrecency();
      const prev = map[id] || { uses: 0, last: 0 };
      map[id] = { uses: (prev.uses || 0) + 1, last: Date.now() };
      saveFrecency();
    } catch (e) {}
  }
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
  // pending (sendTabTo moves the whole selection, preserving whole
  // native groups).
  function sendTabTitle(api, n) {
    try {
      const m = (gBrowser.selectedTabs || gBrowser.multiselectedTabs || []).length;
      if (m > 1) {
        return `Send ${m} Tabs to ${wsFull(api, n)}`;
      }
    } catch (e) {}
    return `Send Active Tab to ${wsFull(api, n)}`;
  }

  function sendGroupSize() {
    try {
      const sel = gBrowser && gBrowser.selectedTab;
      const g = sel && sel.group;
      if (!g) {
        return 0;
      }
      const ms = Array.from(g.tabs || []).filter((t) => t && !t.closing);
      return ms.length >= 2 ? ms.length : 0;
    } catch (e) {
      return 0;
    }
  }

  function sendGroupTitle(api, n, size) {
    try {
      const s = size || sendGroupSize();
      if (s > 1) {
        return `Send Group (${s} Tabs) to ${wsFull(api, n)}`;
      }
    } catch (e) {}
    return `Send Group to ${wsFull(api, n)}`;
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

  // Display-only URL cleanup for row subs: "host › clean path". Drops the
  // protocol, www., tracking query junk and trailing slash; over-long
  // paths truncate. Presentation only — navigation, clipboard and the
  // matcher's raw sub data are untouched (see configureRow, which only
  // uses this when no sub-highlight needs to align).
  function displayURL(url) {
    const input = String(url || "");
    if (!input) {
      return "";
    }
    const t = input.trim();
    if (!/^https?:\/\//i.test(t)) {
      return t.length > 72 ? `${t.slice(0, 72)}…` : t;
    }
    let host = "";
    let path = "";
    let suffix = "";
    try {
      const u = new URL(t);
      host = (u.hostname || "").toLowerCase().replace(/^www\./, "");
      path = String(u.pathname || "");
      if (u.search && u.search.length > 1) {
        suffix += " …";
      }
      if (u.hash && u.hash.length > 1) {
        suffix += " #";
      }
    } catch (e) {
      // No URL global (tests) or unparseable: manual parse, same shape
      // as hostOfURL()'s fallback below.
      try {
        const m = t.match(/^https?:\/\/([^/:?#]+)([^?#]*)(\?[^#]*)?(#.*)?$/i);
        if (m) {
          host = (m[1] || "").toLowerCase().replace(/^www\./, "");
          path = m[2] || "";
          if (m[3] && m[3].length > 1) {
            suffix += " …";
          }
          if (m[4] && m[4].length > 1) {
            suffix += " #";
          }
        }
      } catch (_e) {}
    }
    if (!host) {
      return t.length > 72 ? `${t.slice(0, 72)}…` : t;
    }
    if (path === "/" || !path) {
      path = "";
    } else {
      if (path.endsWith("/")) {
        path = path.slice(0, -1);
      }
      try {
        path = decodeURIComponent(path);
      } catch (e) {}
      if (path.startsWith("/")) {
        path = path.slice(1);
      }
    }
    let out = host + (path ? ` › ${path}` : "") + suffix;
    if (out.length > 72) {
      out = `${out.slice(0, 72)}…`;
    }
    return out;
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

  // Highlight discipline: only "clean" hits get marks — a contiguous run
  // (prefix / substring) or every hit on a word start (acronym "nt" →
  // "New Tab"). Scattered subsequence matches still rank and select, but
  // render as plain text instead of visual static, so the highlight always
  // answers "why did this row appear?".
  function isCleanHit(indices, text) {
    try {
      if (!indices || !indices.length) {
        return false;
      }
      if (indices.length === 1) {
        return true;
      }
      let contiguous = true;
      for (let k = 1; k < indices.length; k++) {
        if (indices[k] !== indices[0] + k) {
          contiguous = false;
          break;
        }
      }
      if (contiguous) {
        return true;
      }
      const lower = String(text || "").toLowerCase();
      const isB = (i) => i === 0 || /[^a-z0-9]/.test(lower[i - 1] || "");
      return indices.every(isB);
    } catch (e) {
      return false;
    }
  }

  // Best of title / sub / hint (sub and hint count slightly less, so a
  // title hit outranks metadata); keeps all index sets so paint() can
  // highlight each field that matched.
  function matchItem(it, q) {
    const tm = fuzzyScoreTypo(q, it.title || "");
    const sm = it.sub ? fuzzyScoreTypo(q, it.sub) : null;
    const hm = it.hint ? fuzzyScoreTypo(q, it.hint) : null;
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
      ti: tm && isCleanHit(tm.indices, it.title) ? tm.indices : [],
      si: sm && isCleanHit(sm.indices, it.sub) ? sm.indices : [],
      hi: hm && isCleanHit(hm.indices, it.hint) ? hm.indices : [],
    };
  }

  // Typo-tolerant wrapper: direct fuzzyScore first; on miss with q>=4,
  // retry single adjacent transpositions ("nwe" -> "new") with a -120
  // penalty. Sync, bounded (n-1 variants), no DP blowup.
  function fuzzyScoreTypo(query, text) {
    const direct = fuzzyScore(query, text);
    if (direct) {
      return direct;
    }
    try {
      const q = (query || "").toLowerCase();
      if (q.length < 3 || q.length > 40) {
        return null;
      }
      if (/\s/.test(q)) {
        return null;
      }
      let best = null;
      for (let i = 0; i < q.length - 1; i++) {
        if (q[i] === q[i + 1]) {
          continue;
        }
        const swapped = q.slice(0, i) + q[i + 1] + q[i] + q.slice(i + 2);
        const m = fuzzyScore(swapped, text);
        if (m && (!best || m.score > best.score)) {
          best = m;
        }
      }
      if (best) {
        return { score: best.score - 120, indices: best.indices };
      }
    } catch (e) {}
    return null;
  }

  // Multi-word: every whitespace-separated token must match (AND); scores
  // sum, highlight index sets union. Single-token queries use matchItem
  // directly so existing tier ordering is untouched.
  function matchTokens(it, q) {
    const raw = (q || "").toLowerCase().trim();
    if (!raw) {
      return { score: 0, ti: [], si: [], hi: [] };
    }
    const tokens = raw.split(/\s+/).filter(Boolean);
    if (tokens.length <= 1) {
      return matchItem(it, raw);
    }
    let total = 0;
    const ti = [];
    const si = [];
    const hi = [];
    for (const tok of tokens) {
      const m = matchItem(it, tok);
      if (!m) {
        return null;
      }
      total += m.score;
      for (const i of m.ti) {
        ti.push(i);
      }
      for (const i of m.si) {
        si.push(i);
      }
      for (const i of m.hi) {
        hi.push(i);
      }
    }
    // Slight bonus for matching more tokens (exact multi-word intent).
    total += tokens.length * 5;
    return { score: total, ti, si, hi };
  }

  // --- Bookmarks / history search ---------------------------------------
  // Palette doubles as launcher: typed queries also match Places bookmarks
  // and history (frecency-ordered, like the urlbar). Sync path via the
  // classic history service (Cc/Ci, still the query entry point —
  // PlacesUtils.history is the async fetch API and has no executeQuery),
  // so allItems() stays synchronous and the empty view stays clean
  // (places only join non-empty queries, like domain routes).
  // Private windows hide history (urlbar parity) but keep bookmarks.
  // Test seam: window.AphPlaces = { searchBookmarks(q, limit),
  // searchHistory(q, limit) } (each returns [{title, url|uri}]).
  var APH_PLACES_MIN_QUERY = 2;
  var APH_PLACES_BOOKMARK_LIMIT = 8;
  var APH_PLACES_HISTORY_LIMIT = 8;

  function aphPlacesIsPrivate() {
    try {
      if (typeof isPrivatePaletteWindow === "function") {
        return !!isPrivatePaletteWindow();
      }
    } catch (e) {}
    try {
      const pbu = window.PrivateBrowsingUtils;
      if (pbu && typeof pbu.isWindowPrivate === "function") {
        return !!pbu.isWindowPrivate(window);
      }
    } catch (e) {}
    return false;
  }

  function aphPlacesSeam() {
    try {
      return window.AphPlaces || null;
    } catch (e) {
      return null;
    }
  }

  function aphPlacesNormalizeSeamRows(rows) {
    const out = [];
    try {
      if (!Array.isArray(rows)) {
        return out;
      }
      for (const r of rows) {
        try {
          const url = (r && (r.url || r.uri)) || "";
          if (!url || /^place:/i.test(url)) {
            continue;
          }
          const title = (r && r.title) || url;
          out.push({ title: String(title), url: String(url) });
        } catch (e) {}
      }
    } catch (e) {}
    return out;
  }

  // Array when the seam answers (possibly empty), null when there is no
  // seam for this kind (fall back to the history service).
  function aphPlacesSeamSearch(kind, query, limit) {
    try {
      const seam = aphPlacesSeam();
      if (!seam) {
        return null;
      }
      let fn = null;
      try {
        if (kind === "bookmark") {
          fn = seam.searchBookmarks || seam.searchBookmark || null;
        } else {
          fn = seam.searchHistory || seam.searchHist || null;
        }
      } catch (e) {}
      if (typeof fn === "function") {
        try {
          return aphPlacesNormalizeSeamRows(fn.call(seam, query, limit));
        } catch (e) {
          return [];
        }
      }
      try {
        if (typeof seam.query === "function") {
          const r = seam.query.call(seam, kind, query, limit);
          if (Array.isArray(r)) {
            return aphPlacesNormalizeSeamRows(r);
          }
          // Seam present but async (promise) — sync path can't await it.
          if (r && typeof r.then === "function") {
            return [];
          }
        }
      } catch (e) {}
      // Seam exists but doesn't implement this kind — let the caller fall
      // back to the history service rather than claiming zero results.
      return null;
    } catch (e) {}
    return null;
  }

  function aphPlacesHistorySvc() {
    try {
      if (typeof Cc !== "undefined" && typeof Ci !== "undefined" && Cc && Ci) {
        try {
          const svc = Cc["@mozilla.org/browser/nav-history-service;1"].getService(
            Ci.nsINavHistoryService
          );
          if (svc && typeof svc.getNewQuery === "function") {
            return svc;
          }
        } catch (e) {}
      }
    } catch (e) {}
    try {
      if (
        typeof PlacesUtils !== "undefined" &&
        PlacesUtils &&
        PlacesUtils.history &&
        typeof PlacesUtils.history.getNewQuery === "function"
      ) {
        return PlacesUtils.history;
      }
    } catch (e) {}
    return null;
  }

  function aphPlacesQuerySync(svc, searchTerms, wantBookmarks, maxResults) {
    const out = [];
    try {
      if (!svc || !searchTerms) {
        return out;
      }
      let q = null;
      let opts = null;
      try {
        q = svc.getNewQuery();
        opts = svc.getNewQueryOptions();
      } catch (e) {
        return out;
      }
      if (!q || !opts) {
        return out;
      }
      try {
        q.searchTerms = searchTerms;
      } catch (e) {
        return out;
      }
      try {
        if (wantBookmarks) {
          opts.queryType =
            opts.QUERY_TYPE_BOOKMARKS !== undefined ? opts.QUERY_TYPE_BOOKMARKS : 1;
        } else {
          opts.queryType =
            opts.QUERY_TYPE_HISTORY !== undefined ? opts.QUERY_TYPE_HISTORY : 0;
        }
      } catch (e) {}
      try {
        if (opts.SORT_BY_FRECENCY_DESCENDING !== undefined) {
          opts.sortingMode = opts.SORT_BY_FRECENCY_DESCENDING;
        } else if (opts.SORT_BY_VISITCOUNT_DESCENDING !== undefined) {
          opts.sortingMode = opts.SORT_BY_VISITCOUNT_DESCENDING;
        } else if (opts.SORT_BY_DATE_DESCENDING !== undefined) {
          opts.sortingMode = opts.SORT_BY_DATE_DESCENDING;
        }
      } catch (e) {}
      try {
        opts.maxResults = maxResults;
      } catch (e) {}
      try {
        if ("excludeQueries" in opts) {
          opts.excludeQueries = true;
        }
      } catch (e) {}
      let res = null;
      try {
        res = svc.executeQuery(q, opts);
      } catch (e) {
        return out;
      }
      if (!res || !res.root) {
        return out;
      }
      const root = res.root;
      try {
        root.containerOpen = true;
      } catch (e) {
        return out;
      }
      try {
        let n = 0;
        try {
          n = Math.min(root.childCount || 0, maxResults);
        } catch (e) {}
        for (let i = 0; i < n; i++) {
          let node = null;
          try {
            node = root.getChild(i);
          } catch (e) {
            continue;
          }
          if (!node) {
            continue;
          }
          let uri = "";
          let title = "";
          try {
            uri = node.uri || "";
          } catch (e) {}
          try {
            title = node.title || "";
          } catch (e) {}
          if (!uri || /^place:/i.test(uri)) {
            continue;
          }
          out.push({ title: title || uri, url: uri });
        }
      } finally {
        try {
          root.containerOpen = false;
        } catch (e) {}
      }
    } catch (e) {}
    return out;
  }

  function aphPlacesServiceSearch(query, wantBookmarks, maxResults) {
    try {
      const svc = aphPlacesHistorySvc();
      if (!svc) {
        return [];
      }
      return aphPlacesQuerySync(svc, query, wantBookmarks, maxResults);
    } catch (e) {
      return [];
    }
  }

  function aphPlacesOpenTabUrls() {
    const set = new Set();
    try {
      const tabs = (typeof gBrowser !== "undefined" && gBrowser && gBrowser.tabs) || [];
      for (const t of Array.from(tabs)) {
        try {
          const spec = t && t.linkedBrowser && t.linkedBrowser.currentURI && t.linkedBrowser.currentURI.spec;
          if (spec) {
            set.add(spec);
          }
        } catch (e) {}
      }
    } catch (e) {}
    return set;
  }

  function aphPlacesToItem(entry, kind, q) {
    const url = (entry && entry.url) || "";
    if (!url) {
      return null;
    }
    const title = (entry && entry.title) || url;
    const label = kind === "bookmark" ? "Bookmark" : "History";
    const it = {
      title: String(title),
      sub: String(url),
      hint: label,
      run: () => {
        try {
          if (typeof openURL === "function") {
            openURL(url, false);
          }
        } catch (e) {}
      },
      runInTemp: () => {
        try {
          if (typeof openURL === "function") {
            openURL(url, true);
          }
        } catch (e) {}
      },
    };
    // Highlight when the fuzzy matcher agrees; Places hits stay visible
    // even when it doesn't (tag matches, multi-term queries).
    try {
      if (q && typeof matchItem === "function") {
        const m = matchItem(it, q);
        if (m) {
          it._hl = { t: new Set(m.ti), s: new Set(m.si), h: new Set(m.hi) };
        }
      }
    } catch (e) {}
    return it;
  }

  // Bookmarks first (user-curated), then history. Dedupes by URL
  // (bookmark wins) and skips URLs already open as tabs (the tab row
  // switches; a duplicate "open again" row only invites accidents).
  function aphPlacesRowsForQuery(raw) {
    const trimmed = (raw || "").trim();
    if (trimmed.length < APH_PLACES_MIN_QUERY) {
      return [];
    }
    const isPrivate = aphPlacesIsPrivate();
    let bm = null;
    let hist = null;
    try {
      bm = aphPlacesSeamSearch("bookmark", trimmed, APH_PLACES_BOOKMARK_LIMIT);
    } catch (e) {
      bm = null;
    }
    try {
      hist = isPrivate
        ? []
        : aphPlacesSeamSearch("history", trimmed, APH_PLACES_HISTORY_LIMIT);
    } catch (e) {
      hist = isPrivate ? [] : null;
    }
    if (bm === null) {
      bm = aphPlacesServiceSearch(trimmed, true, APH_PLACES_BOOKMARK_LIMIT);
    }
    if (hist === null) {
      hist = isPrivate
        ? []
        : aphPlacesServiceSearch(trimmed, false, APH_PLACES_HISTORY_LIMIT);
    }
    const q = trimmed.toLowerCase();
    const seen = new Set();
    const openUrls = aphPlacesOpenTabUrls();
    const out = [];
    const pushAll = (rows, kind, limit) => {
      let added = 0;
      for (const entry of rows || []) {
        if (added >= limit) {
          break;
        }
        const url = (entry && entry.url) || "";
        if (!url || seen.has(url) || openUrls.has(url)) {
          continue;
        }
        const it = aphPlacesToItem(entry, kind, q);
        if (!it) {
          continue;
        }
        seen.add(url);
        out.push(it);
        added++;
      }
    };
    pushAll(bm, "bookmark", APH_PLACES_BOOKMARK_LIMIT);
    if (!isPrivate) {
      pushAll(hist, "history", APH_PLACES_HISTORY_LIMIT);
    }
    return out;
  }
  // --- Saved archive search ---------------------------------------------
  // Archived tabs join non-empty queries as fuzzy-pool items (newest-first,
  // capped), so they rank alongside commands and open tabs with match
  // highlighting handled by the normal scoring path. Restoring re-opens
  // with the saved workspace + container (restoreEntry owns the workspace
  // switch); Alt+Enter restores without consuming the entry (keep).
  // Hidden in private windows (bind parity): entries are non-private
  // pages whose restore retags into normal workspaces.
  // Test seam: window.AphArchive = { getEntries() → [{id, title, url,
  // ws, cname}], restoreEntry(id, opts?) } — the real controller shape.
  var APH_ARCHIVE_MIN_QUERY = 2;
  var APH_ARCHIVE_POOL_LIMIT = 50;

  function aphArchiveIsPrivate() {
    try {
      if (typeof isPrivatePaletteWindow === "function") {
        return !!isPrivatePaletteWindow();
      }
    } catch (e) {}
    return false;
  }

  function aphArchiveEntries() {
    try {
      const a = typeof arc === "function" ? arc() : null;
      if (a && typeof a.getEntries === "function") {
        const r = a.getEntries();
        if (Array.isArray(r)) {
          return r;
        }
      }
    } catch (e) {}
    return [];
  }

  function aphArchivePoolItems(raw) {
    const out = [];
    try {
      const q = (raw || "").trim();
      if (q.length < APH_ARCHIVE_MIN_QUERY) {
        return out;
      }
      if (aphArchiveIsPrivate()) {
        return out;
      }
      let openUrls = null;
      try {
        openUrls =
          typeof aphPlacesOpenTabUrls === "function" ? aphPlacesOpenTabUrls() : new Set();
      } catch (e) {
        openUrls = new Set();
      }
      let n = 0;
      for (const e of aphArchiveEntries()) {
        if (n >= APH_ARCHIVE_POOL_LIMIT) {
          break;
        }
        let url = "";
        let title = "";
        let id = "";
        let ws = "";
        let cname = "";
        try {
          url = (e && e.url) || "";
          title = (e && e.title) || url;
          id = (e && e.id) || "";
          ws = (e && e.ws) || "";
          cname = (e && e.cname) || "";
        } catch (err) {}
        if (!url || !id || !/^https?:\/\//i.test(url)) {
          continue;
        }
        // Restoring an already-open URL opens a duplicate — the open-tab
        // row already switches there (same rule as places rows).
        try {
          if (openUrls.has(url)) {
            continue;
          }
        } catch (err) {}
        const sub = `${url}${ws ? ` · WS ${ws}` : ""}${cname ? ` · ${cname}` : ""}`;
        out.push({
          title: String(title),
          sub,
          hint: "Archive",
          run: () => {
            try {
              const a = typeof arc === "function" ? arc() : null;
              if (a && typeof a.restoreEntry === "function") {
                a.restoreEntry(id);
              }
            } catch (err) {}
          },
          runInTemp: () => {
            try {
              const a = typeof arc === "function" ? arc() : null;
              if (a && typeof a.restoreEntry === "function") {
                a.restoreEntry(id, { keep: true });
              }
            } catch (err) {}
          },
        });
        n++;
      }
    } catch (e) {}
    return out;
  }
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

  function build() {
    overlay = document.createElement("div");
    overlay.id = "aph-palette-overlay";
    overlay.hidden = true;

    const box = document.createElement("div");
    box.id = "aph-palette";
    box.setAttribute("role", "dialog");
    box.setAttribute("aria-label", "Aph command palette");

    input = document.createElement("input");
    input.id = "aph-palette-input";
    input.setAttribute("placeholder", PLACEHOLDER);
    input.setAttribute("autocomplete", "off");
    input.setAttribute("spellcheck", "false");
    input.setAttribute("role", "combobox");
    input.setAttribute("aria-expanded", "true");
    input.setAttribute("aria-controls", "aph-palette-list");
    input.setAttribute("aria-autocomplete", "list");
    input.addEventListener("input", () => render(input.value));
    input.addEventListener("keydown", onListKey, true);

    list = document.createElement("div");
    list.id = "aph-palette-list";
    list.setAttribute("role", "listbox");
    list.setAttribute("aria-label", "Results");

    footer = document.createElement("div");
    footer.id = "aph-palette-footer";

    box.appendChild(input);
    box.appendChild(list);
    box.appendChild(footer);
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

  function emptyMessage(mode, q) {
    if (mode === "tabs") {
      return q ? `No tabs match “${q}”` : "No open tabs";
    }
    if (mode === "commands") {
      return `No commands match “${q}” — try @ for tabs, ? for modes`;
    }
    if (mode === "workspaces") {
      return `No workspace rows match “${q}”`;
    }
    if (mode === "bookmarks") {
      return q.length < 2 ? "Type 2+ characters to search bookmarks" : `No bookmarks match “${q}”`;
    }
    if (mode === "history") {
      return q.length < 2 ? "Type 2+ characters to search history" : `No history matches “${q}”`;
    }
    if (mode === "archive") {
      return q.length < 2 ? "Type 2+ characters to search the archive" : `Nothing archived matches “${q}”`;
    }
    return `No results for “${q}” — Enter searches DuckDuckGo`;
  }

  // Letter avatar for tabs without a favicon: first alnum character of
  // the title, tinted by a stable hash so each site is recognizable.
  function avatarLetter(it) {
    try {
      const s = String((it && it.title) || "").trim();
      for (const ch of s) {
        if (/[a-zA-Z0-9]/.test(ch)) {
          return ch.toUpperCase();
        }
      }
      const u = String((it && it.sub) || "");
      const m = u.match(/:\/\/([^/:?#.]+)/);
      if (m && m[1]) {
        return m[1][0].toUpperCase();
      }
    } catch (e) {}
    return "";
  }

  function avatarHue(it) {
    try {
      const s = String((it && it.sub) || it.title || "");
      let h = 0;
      for (let i = 0; i < s.length; i++) {
        h = (h * 31 + s.charCodeAt(i)) % 360;
      }
      return h;
    } catch (e) {
      return 210;
    }
  }

  // Pooled row: fixed children created once, reconfigured per paint.
  // Listeners attach once and read row._aph.index (updated per render).
  function makeRow() {
    const row = document.createElement("div");
    row.className = "aph-palette-item";
    row.setAttribute("role", "option");
    row.setAttribute("aria-selected", "false");
    const img = document.createElement("img");
    img.className = "aph-palette-icon-img";
    img.setAttribute("alt", "");
    img.setAttribute("draggable", "false");
    const ic = document.createElement("span");
    ic.className = "aph-palette-icon";
    const body = document.createElement("div");
    body.className = "aph-palette-body";
    const main = document.createElement("span");
    main.className = "aph-palette-title";
    const hint = document.createElement("span");
    hint.className = "aph-palette-hint";
    const sub = document.createElement("div");
    sub.className = "aph-palette-sub";
    const key = document.createElement("span");
    key.className = "aph-palette-key";
    body.appendChild(main);
    body.appendChild(hint);
    body.appendChild(sub);
    row.appendChild(img);
    row.appendChild(ic);
    row.appendChild(body);
    row.appendChild(key);
    row._aph = { img, ic, main, hint, sub, key, index: -1 };
    row.addEventListener("mousedown", (e) => {
      e.preventDefault();
      selected = row._aph.index;
      choose();
    });
    row.addEventListener("mousemove", () => {
      if (selected !== row._aph.index) {
        selected = row._aph.index;
        paint();
      }
    });
    return row;
  }

  function configureRow(row, it, i) {
    const R = row._aph;
    R.index = i;
    const sel = i === selected;
    row.id = `aph-palette-row-${i}`;
    row.className = "aph-palette-item" + (sel ? " selected" : "");
    row.setAttribute("aria-selected", sel ? "true" : "false");
    // Icon slot: favicon img wins, else tab letter avatar, else glyph.
    try {
      if (it && it.iconURL) {
        R.img.setAttribute("src", it.iconURL);
        R.img.hidden = false;
        R.ic.hidden = true;
      } else {
        R.img.hidden = true;
        let glyph = "";
        let avatar = false;
        try {
          if (it && it.kind === "tab") {
            const letter = avatarLetter(it);
            if (letter) {
              glyph = letter;
              avatar = true;
            }
          }
          if (!glyph) {
            glyph = (it && it.icon) || "";
          }
        } catch (_e) {}
        if (glyph) {
          R.ic.hidden = false;
          R.ic.textContent = glyph;
          R.ic.className = "aph-palette-icon" + (avatar ? " aph-palette-avatar" : "");
          try {
            R.ic.style.background = avatar ? `hsl(${avatarHue(it)} 45% 35% / 0.55)` : "";
          } catch (_e) {}
        } else {
          R.ic.hidden = true;
        }
      }
    } catch (e) {}
    try {
      paintText(R.main, it.title, it._hl && it._hl.t);
    } catch (e) {}
    try {
      if (it.hint) {
        R.hint.hidden = false;
        paintText(R.hint, it.hint, it._hl && it._hl.h);
      } else {
        R.hint.hidden = true;
        R.hint.textContent = "";
      }
    } catch (e) {}
    try {
      if (it.sub) {
        R.sub.hidden = false;
        // Clean display for bare-URL subs (tabs, bookmarks, copy rows) —
        // but only when no sub-highlight is active, so fuzzy marks always
        // align with the raw text they were computed on.
        const hl = it._hl && it._hl.s;
        const hasHl = !!(hl && hl.size);
        if (
          !hasHl &&
          typeof displayURL === "function" &&
          /^https?:\/\//i.test(String(it.sub).trim()) &&
          !/\s/.test(String(it.sub).trim())
        ) {
          paintText(R.sub, displayURL(it.sub), new Set());
        } else {
          paintText(R.sub, it.sub, hl);
        }
      } else {
        R.sub.hidden = true;
        R.sub.textContent = "";
      }
    } catch (e) {}
    // Alt+1–9 quick-pick badge on the first nine rows (right anchor).
    try {
      if (i < 9 && items.length > 1) {
        R.key.hidden = false;
        R.key.textContent = `⌥${i + 1}`;
      } else {
        R.key.hidden = true;
      }
    } catch (e) {}
  }

  function paint() {
    // Detach current children without destroying them — pooled rows and
    // headers are re-appended below, so no element is recreated.
    while (list.firstChild) {
      list.removeChild(list.firstChild);
    }
    let mode = "all";
    let q = "";
    try {
      const v = (input && input.value) || "";
      if (typeof parseMode === "function") {
        const p = parseMode(v);
        mode = p.mode || "all";
        q = p.q || "";
      } else {
        q = (v || "").trim();
      }
    } catch (e) {}
    // Per-mode placeholder so ">", "@", "#" teach themselves.
    try {
      if (input && typeof placeholderFor === "function") {
        input.setAttribute("placeholder", placeholderFor(mode));
      }
    } catch (e) {}
    // Grow pools (never shrink); excess rows simply aren't re-appended.
    try {
      while (rowPool.length < items.length) {
        rowPool.push(makeRow());
      }
    } catch (e) {}
    if (!items.length) {
      try {
        if (!emptyEl) {
          emptyEl = document.createElement("div");
          emptyEl.className = "aph-palette-empty";
        }
        emptyEl.textContent = emptyMessage(mode, q || "");
        list.appendChild(emptyEl);
      } catch (e) {}
    } else {
      const frag = document.createDocumentFragment
        ? document.createDocumentFragment()
        : null;
      const target = frag || list;
      // Count sections first so the header pool is exactly sized.
      let sections = 0;
      let prev = null;
      for (const it of items) {
        const sec = (it && it.section) || "";
        if (sec && sec !== prev) {
          prev = sec;
          sections++;
        }
      }
      try {
        while (headerPool.length < sections) {
          const h = document.createElement("div");
          h.className = "aph-palette-section";
          headerPool.push(h);
        }
      } catch (e) {}
      let lastSection = null;
      let hi = 0;
      let selEl = null;
      items.forEach((it, i) => {
        const sec = (it && it.section) || "";
        if (sec && sec !== lastSection) {
          lastSection = sec;
          try {
            const h = headerPool[hi++];
            h.textContent = sec;
            target.appendChild(h);
          } catch (e) {}
        }
        try {
          const row = rowPool[i];
          configureRow(row, it, i);
          target.appendChild(row);
          if (i === selected) {
            selEl = row;
          }
        } catch (e) {}
      });
      if (frag) {
        list.appendChild(frag);
      }
      if (selEl) {
        try {
          selEl.scrollIntoView({ block: "nearest" });
        } catch (e) {}
      }
    }
    try {
      if (input) {
        input.setAttribute("aria-activedescendant", `aph-palette-row-${selected}`);
      }
    } catch (e) {}
    try {
      if (footer && typeof footerHintFor === "function") {
        const base = footerHintFor(mode, items.length);
        // Live preview of the highlighted row: full destination/action
        // without truncation surprises before hitting Enter.
        const cur = items[selected];
        if (cur && (cur.sub || cur.hint)) {
          const detail = String(cur.sub || cur.hint || "");
          const shown = detail.length > 90 ? `${detail.slice(0, 90)}…` : detail;
          footer.textContent = `${base} · ▶ ${cur.title} — ${shown}`;
          try {
            footer.setAttribute("title", detail);
          } catch (_e) {}
        } else if (cur) {
          footer.textContent = `${base} · ▶ ${cur.title}`;
          try {
            footer.removeAttribute("title");
          } catch (_e) {}
        } else {
          footer.textContent = base;
          try {
            footer.removeAttribute("title");
          } catch (_e) {}
        }
      }
    } catch (e) {}
  }

  function cancelCloseTimer() {
    try {
      if (closeTimer) {
        clearTimeout(closeTimer);
        closeTimer = null;
      }
    } catch (e) {
      closeTimer = null;
    }
    try {
      if (overlay && overlay.classList) {
        overlay.classList.remove("aph-palette-closing");
      }
    } catch (e) {}
    try {
      const box = overlay && overlay.querySelector && overlay.querySelector("#aph-palette");
      if (box && box.classList) {
        box.classList.remove("aph-palette-closing");
      }
    } catch (e) {}
  }

  // Sacred return-of-focus: remember who had focus before the palette
  // stole it (page input, editor, video player). Skips our own input and
  // anything already inside the overlay so reopen-during-close keeps the
  // original element.
  function captureFocus() {
    try {
      const ae = document.activeElement;
      if (!ae || ae === input) {
        return;
      }
      try {
        if (overlay && overlay.contains && overlay.contains(ae)) {
          return;
        }
      } catch (e) {}
      returnFocusTo = ae;
    } catch (e) {}
  }

  // Restored synchronously in close() — before it.run() executes — so a
  // tab switch afterwards owns focus naturally instead of being yanked
  // back to the old tab. No-op when the element is gone.
  function restoreFocus() {
    const el = returnFocusTo;
    returnFocusTo = null;
    try {
      if (!el || typeof el.focus !== "function") {
        return;
      }
      try {
        if (typeof el.isConnected === "boolean" && !el.isConnected) {
          return;
        }
        if (document.contains && !document.contains(el)) {
          return;
        }
      } catch (e) {}
      el.focus();
    } catch (e) {}
  }

  function open() {
    if (!overlay) {
      build();
    }
    captureFocus();
    prompt = null;
    try {
      if (typeof invalidatePaletteCache === "function") {
        invalidatePaletteCache();
      }
    } catch (e) {}
    cancelCloseTimer();
    overlay.hidden = false;
    // Pop-in animation: re-trigger on every open.
    try {
      overlay.classList.remove("aph-palette-anim");
      const box = overlay.querySelector && overlay.querySelector("#aph-palette");
      if (box) {
        box.classList.remove("aph-palette-anim");
        void box.offsetWidth;
        box.classList.add("aph-palette-anim");
      }
    } catch (e) {}
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
    cancelCloseTimer();
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
    try {
      if (typeof invalidatePaletteCache === "function") {
        invalidatePaletteCache();
      }
    } catch (e) {}
    if (!overlay || overlay.hidden) {
      cancelCloseTimer();
      return;
    }
    // Already transitioning open→closed past this point, so returning
    // focus is safe exactly once (early-return above never restores).
    restoreFocus();
    // Reduced-motion (or no timer support in tests): hide instantly.
    let reduce = false;
    try {
      reduce = !!(
        window.matchMedia &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches
      );
    } catch (e) {}
    if (reduce || typeof setTimeout !== "function") {
      cancelCloseTimer();
      overlay.hidden = true;
      return;
    }
    // Animated exit: fade the backdrop, sink + shrink the panel, then
    // hide. Reopening cancels the timer (see open/cancelCloseTimer).
    cancelCloseTimer();
    try {
      overlay.classList.add("aph-palette-closing");
    } catch (e) {}
    try {
      const box = overlay.querySelector && overlay.querySelector("#aph-palette");
      if (box) {
        box.classList.remove("aph-palette-anim");
        box.classList.add("aph-palette-closing");
      }
    } catch (e) {}
    try {
      closeTimer = setTimeout(() => {
        closeTimer = null;
        try {
          if (overlay) {
            overlay.hidden = true;
            overlay.classList.remove("aph-palette-closing");
            const box =
              overlay.querySelector && overlay.querySelector("#aph-palette");
            if (box) {
              box.classList.remove("aph-palette-closing", "aph-palette-anim");
            }
          }
        } catch (e) {}
      }, 130);
    } catch (e) {
      try {
        overlay.hidden = true;
      } catch (_e) {}
    }
  }

  // Ctrl+W on a tab row: closes that tab, keeps the palette open.
  function closeRowTab(it) {
    try {
      const t = (it && it.tabRef) || null;
      if (!t || t.closing) {
        return false;
      }
      if (typeof gBrowser !== "undefined" && gBrowser && typeof gBrowser.removeTab === "function") {
        gBrowser.removeTab(t, { animate: false });
      } else if (typeof gBrowser !== "undefined" && gBrowser && typeof gBrowser.removeCurrentTab === "function") {
        // Fallback when removeTab is absent (tests): only when it's current.
        try {
          if (gBrowser.selectedTab === t) {
            gBrowser.removeCurrentTab();
          } else {
            return false;
          }
        } catch (e) {
          return false;
        }
      } else {
        return false;
      }
      if (typeof invalidatePaletteCache === "function") {
        invalidatePaletteCache();
      }
      try {
        render(input ? input.value : "");
      } catch (e) {}
      return true;
    } catch (e) {
      return false;
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

  // Alt+Enter (or Shift+Enter) forces the disposable temp container when
  // the entry supports it (URL / search fallback); plain Enter uses run().
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
    // Terminal-history recall: remember the committed query so an empty
    // ArrowUp can bring it back (see onListKey).
    try {
      const qv = input && input.value ? String(input.value).trim() : "";
      if (qv) {
        lastCommittedQuery = qv;
      }
    } catch (e) {}
    try {
      if (typeof recordFrecency === "function") {
        recordFrecency(it);
      }
    } catch (e) {}
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
    // keepOpen rows mutate live state (bind/pin/mute) — drop the cache so
    // the repainted list (e.g. sidebar-footer toggle) reflects fresh titles.
    try {
      if (it.keepOpen && typeof invalidatePaletteCache === "function") {
        invalidatePaletteCache();
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

  function moveSelection(delta) {
    if (!items.length) {
      return;
    }
    selected = (selected + delta + items.length) % items.length;
    paint();
  }

  // Live modifier peeking: holding bare Alt/Ctrl morphs the footer in
  // real time to show what Enter (or Ctrl+W) would do — no commit needed.
  // Release restores the normal footer via the keyup handler below.
  function peekBaseAction(it) {
    try {
      if (!it) {
        return "Run";
      }
      if (it.kind === "tab") {
        return "Switch to tab";
      }
      if (it.kind === "help") {
        return "Insert prefix";
      }
      if (it.kind === "archive") {
        return "Restore entry";
      }
      if (it.kind === "go" || it.kind === "bookmark" || it.kind === "history") {
        return "Open";
      }
      if (it.kind === "search") {
        return "Search";
      }
      return "Run command";
    } catch (e) {
      return "Run";
    }
  }

  function peekText(it, alt, ctrlMod) {
    try {
      if (ctrlMod && it && (it.kind === "tab" || it.tabRef)) {
        return "⌃W Close tab — palette stays open · release to cancel";
      }
      if (alt && it && it.runInTemp) {
        return "⌥↵ Open in temp container · release to cancel";
      }
      return `↵ ${peekBaseAction(it)} · hold ⌥/⌃ to peek alternatives`;
    } catch (e) {
      return "";
    }
  }

  // True when e is a bare modifier press handled as a footer peek.
  function modifierPeek(e) {
    try {
      const k = e.key || "";
      const bareAlt = k === "Alt" && !e.ctrlKey && !e.metaKey && !e.shiftKey;
      const bareCtrl =
        (k === "Control" || k === "Meta") && !e.altKey && !e.shiftKey;
      if (!bareAlt && !bareCtrl) {
        return false;
      }
      // Swallow so bare Alt can't yank focus to the Firefox menu bar.
      e.preventDefault();
      e.stopPropagation();
      if (footer) {
        const t = peekText(items[selected], bareAlt, bareCtrl);
        if (t) {
          footer.textContent = t;
        }
      }
      return true;
    } catch (e) {
      return false;
    }
  }

  function onListKey(e) {
    if (modifierPeek(e)) {
      return;
    }
    const ctrl = !!(e.ctrlKey || e.metaKey);
    // Ctrl+N/P + Ctrl+J navigation (Ctrl+K stays the toggle — never hijack).
    if (ctrl && !e.altKey && !e.shiftKey && (e.key === "n" || e.key === "N" || e.key === "j" || e.key === "J")) {
      e.preventDefault();
      e.stopPropagation();
      moveSelection(1);
      return;
    }
    if (ctrl && !e.altKey && !e.shiftKey && (e.key === "p" || e.key === "P")) {
      e.preventDefault();
      e.stopPropagation();
      moveSelection(-1);
      return;
    }
    // Ctrl+W on a tab row closes that tab, keeps the palette open.
    if (ctrl && !e.altKey && !e.shiftKey && (e.key === "w" || e.key === "W")) {
      const it = items[selected];
      if (it && (it.kind === "tab" || it.tabRef)) {
        e.preventDefault();
        e.stopPropagation();
        try {
          if (typeof closeRowTab === "function" && closeRowTab(it)) {
            return;
          }
        } catch (_e) {}
      }
      return;
    }
    // Alt/ctrl + 1–9 quick-pick.
    if ((e.altKey || ctrl) && /^[1-9]$/.test(e.key || "")) {
      const idx = Number(e.key) - 1;
      if (idx < items.length) {
        e.preventDefault();
        e.stopPropagation();
        selected = idx;
        choose(!!e.shiftKey);
      }
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      e.stopPropagation();
      moveSelection(e.ctrlKey ? 10 : 1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      e.stopPropagation();
      // Terminal-history recall: empty input + Up restores the last
      // committed query instead of moving selection.
      try {
        const v = input && input.value ? String(input.value) : "";
        if (!v.trim() && lastCommittedQuery) {
          input.value = lastCommittedQuery;
          render(input.value);
          try {
            input.focus();
          } catch (_e) {}
          return;
        }
      } catch (_e) {}
      moveSelection(e.ctrlKey ? -10 : -1);
    } else if (e.key === "PageDown") {
      e.preventDefault();
      e.stopPropagation();
      moveSelection(10);
    } else if (e.key === "PageUp") {
      e.preventDefault();
      e.stopPropagation();
      moveSelection(-10);
    } else if (e.key === "Home") {
      e.preventDefault();
      e.stopPropagation();
      if (items.length) {
        selected = 0;
        paint();
      }
    } else if (e.key === "End") {
      e.preventDefault();
      e.stopPropagation();
      if (items.length) {
        selected = items.length - 1;
        paint();
      }
    } else if (e.key === "Tab") {
      // Autocomplete the highlighted row title into the input.
      const it = items[selected];
      if (it && input) {
        e.preventDefault();
        e.stopPropagation();
        try {
          input.value = it.title || "";
          render(input.value);
          try {
            input.focus();
          } catch (_e) {}
        } catch (_e2) {}
      }
    } else if (e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      choose(!!(e.altKey || e.shiftKey));
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      // First Esc with a mode prefix + query clears to the prefix;
      // second Esc closes.
      try {
        const v = (input && input.value) || "";
        if (v.length > 1 && /^[>@#?]/.test(v)) {
          input.value = v[0];
          render(input.value);
          return;
        }
        if (/^[a-zA-Z]\s*:\s*\S/.test(v.trim())) {
          const m = v.match(/^([a-zA-Z]\s*:)/);
          if (m) {
            input.value = m[1] + " ";
            render(input.value);
            return;
          }
        }
      } catch (_e) {}
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
    if (
      e.key === "Escape" ||
      e.key === "ArrowDown" ||
      e.key === "ArrowUp" ||
      e.key === "Enter" ||
      e.key === "PageDown" ||
      e.key === "PageUp" ||
      e.key === "Home" ||
      e.key === "End" ||
      e.key === "Tab" ||
      e.key === "Alt" ||
      e.key === "Control" ||
      e.key === "Meta"
    ) {
      // Input-level handler covers these when focused; this is the fallback.
      onListKey(e);
    }
  }

  window.addEventListener("keydown", onKey, true);

  // Releasing a peeked modifier restores the normal footer (repaint is
  // cheap with pooled rows). Swallows bare Alt release so the Firefox
  // menu bar never steals focus from an open palette.
  window.addEventListener(
    "keyup",
    (e) => {
      try {
        if (!isOpen()) {
          return;
        }
        const k = e.key || "";
        if (k === "Alt" || k === "Control" || k === "Meta") {
          e.preventDefault();
          e.stopPropagation();
          paint();
        }
      } catch (_e) {}
    },
    true
  );

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
