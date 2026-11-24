// GENERATED — do not edit by hand. Edit config/user-overrides.js, then run: just update-prefs
// Bundled default preferences injected into browser/omni.ja defaults/preferences/firefox.js.

//
/* You may copy+paste this file and use it as it is.
 *
 * If you make changes to your about:config while the program is running, the
 * changes will be overwritten by the user.js when the application restarts.
 *
 * To make lasting changes to preferences, you will have to edit the user.js.
 */

/****************************************************************************
 * Betterfox                                                                *
 * "Ad meliora"                                                             *
 * version: 154                                                             *
 * url: https://github.com/yokoffing/Betterfox                              *
****************************************************************************/

/****************************************************************************
 * SECTION: FASTFOX                                                         *
****************************************************************************/
/** GENERAL ***/
pref("gfx.content.skia-font-cache-size", 20);
pref("content.notify.interval", 100000);

/** GFX ***/
pref("gfx.canvas.accelerated.cache-size", 512);

/** MEDIA CACHE ***/
pref("media.cache_readahead_limit", 3600);
pref("media.cache_resume_threshold", 1800);

/** IMAGE CACHE ***/
pref("image.mem.decode_bytes_at_a_time", 32768);

/** NETWORKING ***/
pref("network.buffer.cache.size", 65535);
pref("network.buffer.cache.count", 48);
pref("network.http.max-connections", 1800);
pref("network.http.max-persistent-connections-per-server", 10);
pref("network.http.max-urgent-start-excessive-connections-per-host", 5);
pref("network.http.request.max-start-delay", 5);
pref("network.dnsCacheExpiration", 3600);

/****************************************************************************
 * SECTION: SECUREFOX                                                       *
****************************************************************************/
/** TRACKING PROTECTION ***/
pref("browser.download.start_downloads_in_tmp_dir", true);
pref("browser.uitour.enabled", false);
pref("privacy.globalprivacycontrol.enabled", true);

/** OCSP & CERTS / HPKP ***/
pref("security.OCSP.enabled", 0);
pref("privacy.antitracking.isolateContentScriptResources", true);
pref("security.csp.reporting.enabled", false);

/** SSL / TLS ***/
pref("security.ssl.treat_unsafe_negotiation_as_broken", true);
pref("browser.xul.error_pages.expert_bad_cert", true);
pref("security.tls.enable_0rtt_data", false);

/** DISK AVOIDANCE ***/
pref("browser.privatebrowsing.forceMediaMemoryCache", true);
pref("media.memory_cache_max_size", 65536);
pref("browser.sessionstore.interval", 60000);

/** SHUTDOWN & SANITIZING ***/
pref("privacy.history.custom", true);

/** SPECULATIVE LOADING ***/
pref("network.http.speculative-parallel-limit", 0);
pref("network.dns.disablePrefetch", true);
pref("network.dns.disablePrefetchFromHTTPS", true);
pref("browser.urlbar.speculativeConnect.enabled", false);
pref("browser.places.speculativeConnect.enabled", false);
pref("network.prefetch-next", false);

/** SEARCH / URL BAR ***/
pref("browser.urlbar.trimHttps", true);
pref("browser.urlbar.untrimOnUserInteraction.featureGate", true);
pref("browser.search.separatePrivateDefault.ui.enabled", true);
pref("browser.search.suggest.enabled", false);
pref("browser.urlbar.quicksuggest.enabled", false);
pref("browser.urlbar.groupLabels.enabled", false);
pref("browser.formfill.enable", false);
pref("network.IDN_show_punycode", true);

/** HTTPS-ONLY MODE ***/
pref("dom.security.https_only_mode", true);
pref("dom.security.https_only_mode_error_page_user_suggestions", true);

/** PASSWORDS ***/
pref("signon.formlessCapture.enabled", false);
pref("signon.privateBrowsingCapture.enabled", false);
pref("network.auth.subresource-http-auth-allow", 1);
pref("editor.truncate_user_pastes", false);

/** EXTENSIONS ***/
pref("extensions.enabledScopes", 5);

/** HEADERS / REFERERS ***/
pref("network.http.referer.XOriginTrimmingPolicy", 2);

/** VARIOUS ***/
pref("pdfjs.enableScripting", false);

/** SAFE BROWSING ***/
pref("browser.safebrowsing.downloads.remote.enabled", false);

/** MOZILLA ***/
pref("permissions.default.desktop-notification", 2);
pref("permissions.default.geo", 2);
pref("geo.provider.network.url", "https://beacondb.net/v1/geolocate");
pref("browser.search.update", false);
pref("permissions.manager.defaultsUrl", "");
pref("extensions.getAddons.cache.enabled", false);

/** TELEMETRY ***/
pref("datareporting.policy.dataSubmissionEnabled", false);
pref("datareporting.healthreport.uploadEnabled", false);
pref("toolkit.telemetry.unified", false);
pref("toolkit.telemetry.enabled", false);
pref("toolkit.telemetry.server", "data:,");
pref("toolkit.telemetry.archive.enabled", false);
pref("toolkit.telemetry.newProfilePing.enabled", false);
pref("toolkit.telemetry.shutdownPingSender.enabled", false);
pref("toolkit.telemetry.updatePing.enabled", false);
pref("toolkit.telemetry.bhrPing.enabled", false);
pref("toolkit.telemetry.firstShutdownPing.enabled", false);
pref("toolkit.telemetry.coverage.opt-out", true);
pref("toolkit.coverage.opt-out", true);
pref("toolkit.coverage.endpoint.base", "");
pref("browser.newtabpage.activity-stream.feeds.telemetry", false);
pref("browser.newtabpage.activity-stream.telemetry", false);
pref("datareporting.usage.uploadEnabled", false);

/** EXPERIMENTS ***/
pref("app.shield.optoutstudies.enabled", false);
pref("app.normandy.enabled", false);
pref("app.normandy.api_url", "");
pref("nimbus.rollouts.enabled", false);

/** CRASH REPORTS ***/
pref("breakpad.reportURL", "");
pref("browser.tabs.crashReporting.sendReport", false);
pref("browser.crashReports.unsubmittedCheck.enabled", false);

/****************************************************************************
 * SECTION: PESKYFOX                                                        *
****************************************************************************/
/** MOZILLA UI ***/
pref("extensions.getAddons.showPane", false);
pref("extensions.htmlaboutaddons.recommendations.enabled", false);
pref("browser.discovery.enabled", false);
pref("browser.newtabpage.activity-stream.asrouter.userprefs.cfr.addons", false);
pref("browser.newtabpage.activity-stream.asrouter.userprefs.cfr.features", false);
pref("browser.preferences.moreFromMozilla", false);
pref("browser.aboutConfig.showWarning", false);
pref("browser.profiles.enabled", true);

/** THEME ADJUSTMENTS ***/
pref("toolkit.legacyUserProfileCustomizations.stylesheets", true);
pref("browser.compactmode.show", true);
pref("browser.privateWindowSeparation.enabled", false); // WINDOWS

/** AI ***/
pref("browser.ai.control.default", "blocked");
pref("browser.ml.enable", false);
pref("browser.ml.chat.enabled", false);
pref("browser.ml.chat.menu", false);
pref("browser.tabs.groups.smart.enabled", false);
pref("browser.ml.linkPreview.enabled", false);

/** FULLSCREEN NOTICE ***/
pref("full-screen-api.transition-duration.enter", "0 0");
pref("full-screen-api.transition-duration.leave", "0 0");
pref("full-screen-api.warning.timeout", 0);

/** URL BAR ***/
pref("browser.urlbar.trending.featureGate", false);

/** NEW TAB PAGE ***/
pref("browser.newtabpage.activity-stream.default.sites", "");
pref("browser.newtabpage.activity-stream.showSponsoredTopSites", false);
pref("browser.newtabpage.activity-stream.feeds.section.topstories", false);
pref("browser.newtabpage.activity-stream.showSponsored", false);
pref("browser.newtabpage.activity-stream.showSponsoredCheckboxes", false);

/** DOWNLOADS ***/
pref("browser.download.manager.addToRecentDocs", false);

/** PDF ***/
pref("browser.download.open_pdf_attachments_inline", true);

/** TAB BEHAVIOR ***/
pref("browser.bookmarks.openInTabClosesMenu", false);
pref("findbar.highlightAll", true);

/****************************************************************************
 * SECTION: SMOOTHFOX                                                       *
****************************************************************************/
// visit https://github.com/yokoffing/Betterfox/blob/main/Smoothfox.js
// Enter your scrolling overrides below this line:


/****************************************************************************
 * START: MY OVERRIDES                                                      *
****************************************************************************/
// visit https://github.com/yokoffing/Betterfox/wiki/Common-Overrides
// visit https://github.com/yokoffing/Betterfox/wiki/Optional-Hardening
// Enter your personal overrides below this line:


/****************************************************************************
 * END: BETTERFOX                                                           *
****************************************************************************/

// Aph Browser Settings
// Bundled defaults: loaded natively via defaults/preferences/firefox.js in omni.ja,
// so user changes via about:config / Settings persist in prefs.js automatically.

// 1. Nova UI baseline
pref("browser.nova.enabled", true);

// 2. DRM Playback (Netflix / Spotify)
pref("media.eme.enabled", true);
pref("media.gmp-widevinecdm.enabled", true);
pref("media.gmp-provider.enabled", true);
pref("media.ffmpeg.vaapi.enabled", true); // GPU video decode (VA-API)

// 3. Vertical Tabs (default)
pref("sidebar.revamp", true);
pref("sidebar.verticalTabs", true);
pref("sidebar.visibility", "always-show");
pref("sidebar.main.tools", "none");

// 4. Pre-rendered New Tab cache: left at stock (enabled).
// browser.startup.homepage.abouthome_cache.enabled gates the about:home /
// about:newtab document Firefox caches in cache2. Its version check keys
// on appinfo.appBuildID only, so it does NOT notice Aph-side default
// changes — but Aph pins no wallpaper defaults anymore, and a rebrand
// forces a -purgecaches launch, so the stale-document hazard is covered
// and regular users keep the faster first paint.
// Deliberately no pref line: stock is enabled, and omitting it (rather
// than pinning true) leaves the setting user-changeable.

// 5. Keep window open when last tab is closed
pref("browser.tabs.closeWindowWithLastTab", false);

// 6. Insert at Top: manual new tabs spawn at the top of the workspace
// stack (beneath pins & stars), while child links open next to their parent.
pref("browser.tabs.insertAfterCurrent", false);

// 7. Restore previous windows and tabs on launch
pref("browser.startup.page", 3);

// 8. Never show bookmarks toolbar
pref("browser.toolbars.bookmarks.visibility", "never");

// 8b. Alt does not focus the menu bar (stock true). Aph keeps the menu
// bar hidden; tapping Alt alone should not pull focus into chrome.
pref("ui.key.menuAccessKeyFocuses", false);

// 9. Enable Chrome devtools (kept: the bug-report flow evaluates
// chrome-privileged JS in the Browser Console, which needs this).
pref("devtools.chrome.enabled", true);

// 10. Remote debugging: left at stock (disabled). Regular users gain
// nothing from the debugger server, so it stays off; developers can flip
// devtools.debugger.remote-enabled in about:config and it sticks.

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
// workspace-blind — it can take fresh tabs too — but everything
// reloads on click with workspace tags intact. On matches stock; off leaves
// memory management to Aph's sweeps alone.
pref("browser.tabs.unloadOnLowMemory", true);

// 12. Workspace tab unloading: manual via palette ("Unload Inactive Tabs"
// sweeps hidden workspaces, "Unload Current Tab" / tab right-click unloads
// one tab).

// 12a. Automatic tab unloading (on by default): discards every stale tab —
// hidden workspaces and idle current-workspace tabs alike — every 5 min
// and 15 s after you stop switching. Pinned, audible, loading
// and unsaved-form tabs never unload; click an unloaded tab to reload it.
pref("aph.unload.autoEnabled", true);

// 12b. Auto-unload staleness: tabs viewed within this many minutes are
// spared when the sweep fires (default 30). Read live — about:config flips
// apply to the next sweep. Tabs with no recorded view time count as stale.
pref("aph.unload.staleMin", 30);

// 12c. Unload on low memory: when Firefox reports memory pressure,
// immediately discard stale tabs (same guards as auto-unload, oldest first,
// max 25 per sweep). On by default — the guard set makes an extra sweep
// safe anywhere.
pref("aph.unload.onLowMemory", true);

// 12d. Native Bookmark Archiver: automatically archive stale unpinned tabs
// into Places Bookmarks (Other Bookmarks / Aph Archive / Workspace N / YYYY-MM-DD).
// Default 0 = manual only via Ctrl+K commands; set to e.g. 7 for weekly cleanup.
pref("aph.archive.autoDays", 0);

// 15. Ctrl/Cmd+W on a selected pinned tab keeps it open instead of
// closing — a drifted pin resets to its pinned base URL in place, a pin
// already at base parks (unloads); a second press (now pending) closes via
// stock, as do middle-click and the tab context menu. Set false for stock
// close-on-first-press.
pref("aph.pins.ctrlWUnloads", true);

// 17. Sidebar footer (settings gear): hidden by default to reclaim the
// strip. The palette's Show/Hide Sidebar Footer command flips it live;
// Customize Sidebar stays reachable via the Aph menu either way.
pref("aph.sidebar.hideFooter", true);
pref("aph.sidebar.autohide", false);

// 18. Accounts & passwords: both OFF by default (privacy-first seed).
// The Sync toggle needs a restart to fully apply. Neither is policy-locked
// (see config/policies.json), so user choice sticks.
pref("identity.fxaccounts.enabled", false);
pref("signon.rememberSignons", false);

// 19. Theme preset: auto follows the OS room (midnight/paper faces);
// midnight/paper pin those rooms against the OS, nord cools the room
// with a steel voice, espresso warms it umber. Unknown values read as auto.
pref("aph.theme.preset", "auto");

// 20. Daily comfort: speculative connections and DNS prefetching
pref("network.http.speculative-parallel-limit", 6);
pref("network.dns.disablePrefetch", false);
pref("network.dns.disablePrefetchFromHTTPS", false);
pref("browser.urlbar.speculativeConnect.enabled", true);
pref("browser.places.speculativeConnect.enabled", true);
pref("network.prefetch-next", false);
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
// that baked-in body style past the pref change. A rebrand forces a
// -purgecaches launch, so a changed default is never shadowed by a stale document.

// 21. Cap SessionStore JSON bloat & BTRFS CoW write churn
pref("browser.sessionstore.interval", 60000);           // 60s (Betterfox baseline, crash safety)
pref("browser.sessionstore.max_serialize_forward", 2);  // stock -1 (unbounded forward history churns megabytes)
pref("browser.sessionstore.max_tabs_undo", 10);         // stock 25

/****************************************************************************
 * END: APH NATIVE OVERRIDES
****************************************************************************/
