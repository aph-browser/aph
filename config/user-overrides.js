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

// 12. Workspace tab unloading: manual via palette ("Unload Inactive Tabs").
// Set true to also discard eligible hidden-workspace tabs after each switch.
user_pref("aph.workspaces.unloadOnSwitch", false);

// 12b. Automatic tab archiving: set true to archive (close + store in the
// tab archive) every eligible hidden-workspace tab — 15 s after you stop
// switching (each switch re-arms the settle timer; sitting still fires it).
// Selected, pinned, starred, audible, loading and unsaved-form tabs never
// auto-close.
user_pref("aph.archive.autoEnabled", false);

// 12c. Auto-archive staleness: tabs viewed within this many minutes are
// spared when the sweep fires (default 5). Read live — about:config flips
// apply to the next sweep. Tabs with no recorded view time count as stale.
user_pref("aph.archive.autoStaleMin", 5);

// 14. Silence extension first-run/welcome tabs (e.g. SponsorBlock help page).
// Managed extensions can't take 3rdparty policy, so noisy install tabs are
// closed pre-paint instead. Set false to keep them.
user_pref("aph.addons.silenceFirstRun", true);

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
