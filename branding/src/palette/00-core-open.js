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

