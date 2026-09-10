/* Aph workspaces: IDs "1"-"9", zero UI. Alt+Shift+1..9 jumps to a workspace,
 * Alt+Shift+]/Right cycles next active, Alt+Shift+[/Left cycles previous,
 * Alt+Shift+Tab toggles the last two used (MRU),
 * Ctrl+Alt+1..9 sends the active tab there (stay here, focus next).
 * Tags persist via SessionStore; pinned tabs are global (never hidden —
 * stock Firefox assumes hidden pinned tabs never exist and vertical-tab
 * drag/drop breaks when they do); native tab groups
 * live inside workspaces (one shared tag, header synced, collapsed kept).
 * Container bindings: each workspace may be bound to one Firefox container
 * (Ctrl+Alt+B binds current WS to the selected tab's container,
 * Ctrl+Alt+Shift+B clears). Bound workspaces open new tabs (Ctrl+T,
 * + button) in that container; Ctrl+Alt+T stays disposable-temp always.
 * Bound-match dimming: a tab whose container equals its workspace's binding
 * gets `data-aph-bound-match="1"` (theme.css hides the native
 * `.tab-context-line`); mismatches and unbound workspaces keep the line.
 * Domain routes: a host may be bound to a workspace ("github.com" -> "2",
 * managed from the command palette). Fresh top-level navigations matching
 * a rule are retagged pre-paint and reopened in the target workspace's
 * bound container; settled tabs never route (no OAuth/SSO hijack).
 * Workspace names ("2" -> "💼 Work", pref aph.workspaces.names): badge
 * pill, palette titles and tooltip; rename via badge click, Ctrl+Alt+R,
 * or the palette rename command.
 * Tab unloading (memory): eligible hidden-workspace tabs are discarded via
 * gBrowser.discardBrowser (V1: manual palette command + optional
 * unload-on-switch behind aph.workspaces.unloadOnSwitch, default off).
 * Never unloads selected/pinned/audible/sharing/pending/about:/offline tabs.
 * Injected into browser.xhtml via rebrand.py (chrome://browser/content/workspaces.js).
 */
(function () {
  const KEY = "aphWs";
  const WIN_KEY = "aphWsCurrent";
  let current = "1";
  const lastSelected = Object.create(null); // workspaceId -> last tab
  let lastUsed = null; // MRU workspace for Alt+Shift+Tab toggle
  // Tabs that arrived via cross-window drag (TabOpen detail.adoptedTab).
  // They join the destination's visible workspace; anchorGroup lets them
  // drag the whole group instead of being healed back to the source tag.
  const adoptedTabs = new WeakSet();

  // Disposable container tabs (Ctrl+Alt+T). moz-src path first: it is the
  // canonical URI in packaged builds (every internal importer uses it, and
  // resource://gre/modules/... does not exist in omni.ja — importing it
  // first throws a "Missing chrome or resource URL" console error on every
  // launch on every OS). gre/modules kept as fallback for older layouts.
  // Wrapped so the shortcut never dies if both fail.
  let IdentityService = null;
  try {
    ({ ContextualIdentityService: IdentityService } = ChromeUtils.importESModule(
      "moz-src:///toolkit/components/contextualidentity/ContextualIdentityService.sys.mjs"
    ));
  } catch (e) {
    try {
      ({ ContextualIdentityService: IdentityService } = ChromeUtils.importESModule(
        "resource://gre/modules/ContextualIdentityService.sys.mjs"
      ));
    } catch (e2) {}
  }
  let tempCounter = 1;
  const tempContainers = new Set(); // userContextIds created here

