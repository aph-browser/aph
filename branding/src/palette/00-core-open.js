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

