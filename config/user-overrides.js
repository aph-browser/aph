// Aph Browser Settings
// Seed-once defaults: copied into a profile on first launch only, so user
// changes via about:config / Settings persist. Re-apply with: just sync-prefs

// 2. DRM Playback (Netflix / Spotify)
user_pref("media.eme.enabled", true);
user_pref("media.gmp-widevinecdm.enabled", true);
user_pref("media.gmp-provider.enabled", true);
user_pref("media.ffmpeg.vaapi.enabled", true); // GPU video decode (VA-API)

// 3. Vertical Tabs (default)
user_pref("sidebar.revamp", true);
user_pref("sidebar.verticalTabs", true);
user_pref("sidebar.visibility", "always-show");
user_pref("sidebar.main.tools", "none");

// 4. Pre-rendered New Tab cache: left at stock (enabled).
// browser.startup.homepage.abouthome_cache.enabled gates the about:home /
// about:newtab document Firefox caches in cache2. Its version check keys
// on appinfo.appBuildID only, so it does NOT notice Aph-side default
// changes — but Aph pins no wallpaper defaults anymore, and both mutation
// paths already purge (`just sync-prefs` / `just sync-chrome` wipe the
// caches; a rebrand forces a -purgecaches launch), so the stale-document
// hazard is covered and regular users keep the faster first paint.
// Deliberately no pref line: stock is enabled, and omitting it (rather
// than pinning true) leaves the setting user-changeable.

// 5. Keep window open when last tab is closed
user_pref("browser.tabs.closeWindowWithLastTab", false);

// 6. Open new tabs immediately after the current one
user_pref("browser.tabs.insertAfterCurrent", true);

// 7. Restore previous windows and tabs on launch
user_pref("browser.startup.page", 3);

// 8. Never show bookmarks toolbar
user_pref("browser.toolbars.bookmarks.visibility", "never");

// 9. Enable Chrome devtools (kept: the bug-report flow evaluates
// chrome-privileged JS in the Browser Console, which needs this).
user_pref("devtools.chrome.enabled", true);

// 10. Remote debugging: left at stock (disabled). Regular users gain
// nothing from the debugger server, so it stays off; developers can flip
// devtools.debugger.remote-enabled in about:config and it sticks.

// 11. Enable Nova
user_pref("browser.nova.enabled", true);

// 11b. No default theme. Aph paints its own canvas, and a lightweight theme
// leaked through three structural tokens: `tab_line` (drove the orange
// active-tab outline via --tab-selected-outline-color), `--card-border-color`
// (drove the content separators), and --toolbarbutton-background-color-hover
// (the old --aph-voice default — nova-sun set it to a brown
// rgba(178,97,0,0.25), warming every hover on an unstamped window). All three
// are claimed by Aph now (see branding/theme.css), so there is nothing to
// install and nothing left to leak.
//
// Deliberately no extensions.activeThemeID and no
// layout.css.prefers-color-scheme.content-override: the room is left to
// prefers-color-scheme and the OS, exactly as before. Removing the theme
// must not decide the room.

// 11c. Firefox native low-memory unloading (stock safety net, NOT Aph's):
// under real memory pressure Firefox itself unloads least-recently-used
// tabs (LRU + memory weight, about:unloads shows the ranking). It is
// workspace-blind — it can take starred or fresh tabs too — but everything
// reloads on click with workspace tags intact. On matches stock; off leaves
// memory management to Aph's sweeps alone. Togglable live in Aph Settings.
user_pref("browser.tabs.unloadOnLowMemory", true);

// 12. Workspace tab unloading: manual via palette ("Unload Inactive Tabs"
// sweeps hidden workspaces, "Unload Current Tab" / tab right-click unloads
// one tab).

// 12a. Automatic tab unloading (on by default): discards every stale tab —
// hidden workspaces and idle current-workspace tabs alike — every 5 min
// and 15 s after you stop switching. Starred, pinned, audible, loading
// and unsaved-form tabs never unload; click an unloaded tab to reload it.
user_pref("aph.unload.autoEnabled", true);

// 12b. Auto-unload staleness: tabs viewed within this many minutes are
// spared when the sweep fires (default 30). Read live — about:config flips
// apply to the next sweep. Tabs with no recorded view time count as stale.
// Keep this below aph.stash.autoStaleMin so tabs discard before they close.
user_pref("aph.unload.staleMin", 30);

// 12c. Unload on low memory: when Firefox reports memory pressure,
// immediately discard stale tabs (same guards as auto-unload, oldest first,
// max 25 per sweep). On by default — the guard set makes an extra sweep
// safe anywhere.
user_pref("aph.unload.onLowMemory", true);

// 12d. Automatic tab stashing: set true to stash (close + store in the
// tab stash) every eligible hidden-workspace tab — 15 s after you stop
// switching (each switch re-arms the settle timer; sitting still fires it).
// Selected, pinned, starred, audible, loading and unsaved-form tabs never
// auto-close.
user_pref("aph.stash.autoEnabled", false);

// 12e. Auto-stash staleness: tabs viewed within this many minutes are
// spared when the sweep fires (default 5). Read live — about:config flips
// apply to the next sweep. Tabs with no recorded view time count as stale.
user_pref("aph.stash.autoStaleMin", 5);

// 12f. Workspace snapshots: periodic + safety auto-stash of workspaces
// whose tabs changed (snapshots = workspace stashes). Toggle, cadence
// and bulk-close threshold live in Aph Settings under Stash.
user_pref("aph.stash.snapshots.autoEnabled", true);
user_pref("aph.stash.snapshots.intervalMin", 30);
user_pref("aph.stash.safetyMin", 3);

// 15. Ctrl/Cmd+W on a selected pinned tab keeps it open instead of
// closing — a drifted pin resets to its pinned base URL in place, a pin
// already at base parks (unloads); a second press (now pending) closes via
// stock, as do middle-click and the tab context menu. Set false for stock
// close-on-first-press.
user_pref("aph.pins.ctrlWUnloads", true);

// 16. Ctrl/Cmd+W on a selected starred tab mirrors pins — a drifted star
// resets to its starred base URL in place, a star already at base parks
// (unloads); a second press (now pending) closes via stock. Set false for
// stock close-on-first-press.
user_pref("aph.stars.ctrlWUnloads", true);

// 17. Sidebar footer (settings gear): hidden by default to reclaim the
// strip. The palette's Show/Hide Sidebar Footer command flips it live;
// Customize Sidebar stays reachable via the Aph menu either way.
user_pref("aph.sidebar.hideFooter", true);

// 18. Accounts & passwords: both OFF by default (privacy-first seed).
// Toggled live in Aph Settings ("Accounts & Passwords", backed by
// BOOL_DEFAULTS there — keep the defaults in sync). The Sync toggle
// needs a restart to fully apply. Neither is policy-locked (see
// config/policies.json), so user choice sticks.
user_pref("identity.fxaccounts.enabled", false);
user_pref("signon.rememberSignons", false);
// 13. New Tab look: Aph's own desk, no forced wallpaper.
// branding/userContent.css paints the designed gradient on html with body
// forced transparent, so Activity Stream's wallpaper (body
// background-image) covers the desk naturally when set. We deliberately
// set NO
// newtabWallpapers.* pref: pinning one (it used to be "eclipse-time-lapse")
// forced a photo on every launch and overwrote any wallpaper the user
// picked. Leaving the prefs absent means stock default (no wallpaper), so
// the desk shows — and the wallpaper picker still works if you want a
// photo, in which case the body image covers the desk.
// One stale-cache caveat, handled by tooling rather than by disabling
// features: Mozilla's messaging can set newtabWallpapers.initialWallpaper
// at runtime, and the cached about:newtab document (see item 4) can carry
// that baked-in body style past the pref change. `just sync-prefs` and
// `just sync-chrome` wipe the caches, so a changed default is never
// shadowed by a stale document.

/****************************************************************************
 * END: APH NATIVE OVERRIDES
****************************************************************************/
