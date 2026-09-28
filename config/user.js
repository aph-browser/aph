// GENERATED — do not edit by hand. Edit config/user-overrides.js, then run: just update-prefs
// Seed-once defaults: copied into a profile on first launch only; user edits persist. Re-apply with: just sync-prefs

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
user_pref("gfx.content.skia-font-cache-size", 20);
user_pref("content.notify.interval", 100000);

/** GFX ***/
user_pref("gfx.canvas.accelerated.cache-size", 512);

/** MEDIA CACHE ***/
user_pref("media.cache_readahead_limit", 3600);
user_pref("media.cache_resume_threshold", 1800);

/** IMAGE CACHE ***/
user_pref("image.mem.decode_bytes_at_a_time", 32768);

/** NETWORKING ***/
user_pref("network.buffer.cache.size", 65535);
user_pref("network.buffer.cache.count", 48);
user_pref("network.http.max-connections", 1800);
user_pref("network.http.max-persistent-connections-per-server", 10);
user_pref("network.http.max-urgent-start-excessive-connections-per-host", 5);
user_pref("network.http.request.max-start-delay", 5);
user_pref("network.dnsCacheExpiration", 3600);

/****************************************************************************
 * SECTION: SECUREFOX                                                       *
****************************************************************************/
/** TRACKING PROTECTION ***/
user_pref("browser.download.start_downloads_in_tmp_dir", true);
user_pref("browser.uitour.enabled", false);
user_pref("privacy.globalprivacycontrol.enabled", true);

/** OCSP & CERTS / HPKP ***/
user_pref("security.OCSP.enabled", 0);
user_pref("privacy.antitracking.isolateContentScriptResources", true);
user_pref("security.csp.reporting.enabled", false);

/** SSL / TLS ***/
user_pref("security.ssl.treat_unsafe_negotiation_as_broken", true);
user_pref("browser.xul.error_pages.expert_bad_cert", true);
user_pref("security.tls.enable_0rtt_data", false);

/** DISK AVOIDANCE ***/
user_pref("browser.privatebrowsing.forceMediaMemoryCache", true);
user_pref("media.memory_cache_max_size", 65536);
user_pref("browser.sessionstore.interval", 60000);

/** SHUTDOWN & SANITIZING ***/
user_pref("privacy.history.custom", true);

/** SPECULATIVE LOADING ***/
user_pref("network.http.speculative-parallel-limit", 0);
user_pref("network.dns.disablePrefetch", true);
user_pref("network.dns.disablePrefetchFromHTTPS", true);
user_pref("browser.urlbar.speculativeConnect.enabled", false);
user_pref("browser.places.speculativeConnect.enabled", false);
user_pref("network.prefetch-next", false);

/** SEARCH / URL BAR ***/
user_pref("browser.urlbar.trimHttps", true);
user_pref("browser.urlbar.untrimOnUserInteraction.featureGate", true);
user_pref("browser.search.separatePrivateDefault.ui.enabled", true);
user_pref("browser.search.suggest.enabled", false);
user_pref("browser.urlbar.quicksuggest.enabled", false);
user_pref("browser.urlbar.groupLabels.enabled", false);
user_pref("browser.formfill.enable", false);
user_pref("network.IDN_show_punycode", true);

/** HTTPS-ONLY MODE ***/
user_pref("dom.security.https_only_mode", true);
user_pref("dom.security.https_only_mode_error_page_user_suggestions", true);

/** PASSWORDS ***/
user_pref("signon.formlessCapture.enabled", false);
user_pref("signon.privateBrowsingCapture.enabled", false);
user_pref("network.auth.subresource-http-auth-allow", 1);
user_pref("editor.truncate_user_pastes", false);

/** EXTENSIONS ***/
user_pref("extensions.enabledScopes", 5);

/** HEADERS / REFERERS ***/
user_pref("network.http.referer.XOriginTrimmingPolicy", 2);

/** VARIOUS ***/
user_pref("pdfjs.enableScripting", false);

/** SAFE BROWSING ***/
user_pref("browser.safebrowsing.downloads.remote.enabled", false);

/** MOZILLA ***/
user_pref("permissions.default.desktop-notification", 2);
user_pref("permissions.default.geo", 2);
user_pref("geo.provider.network.url", "https://beacondb.net/v1/geolocate");
user_pref("browser.search.update", false);
user_pref("permissions.manager.defaultsUrl", "");
user_pref("extensions.getAddons.cache.enabled", false);

/** TELEMETRY ***/
user_pref("datareporting.policy.dataSubmissionEnabled", false);
user_pref("datareporting.healthreport.uploadEnabled", false);
user_pref("toolkit.telemetry.unified", false);
user_pref("toolkit.telemetry.enabled", false);
user_pref("toolkit.telemetry.server", "data:,");
user_pref("toolkit.telemetry.archive.enabled", false);
user_pref("toolkit.telemetry.newProfilePing.enabled", false);
user_pref("toolkit.telemetry.shutdownPingSender.enabled", false);
user_pref("toolkit.telemetry.updatePing.enabled", false);
user_pref("toolkit.telemetry.bhrPing.enabled", false);
user_pref("toolkit.telemetry.firstShutdownPing.enabled", false);
user_pref("toolkit.telemetry.coverage.opt-out", true);
user_pref("toolkit.coverage.opt-out", true);
user_pref("toolkit.coverage.endpoint.base", "");
user_pref("browser.newtabpage.activity-stream.feeds.telemetry", false);
user_pref("browser.newtabpage.activity-stream.telemetry", false);
user_pref("datareporting.usage.uploadEnabled", false);

/** EXPERIMENTS ***/
user_pref("app.shield.optoutstudies.enabled", false);
user_pref("app.normandy.enabled", false);
user_pref("app.normandy.api_url", "");
user_pref("nimbus.rollouts.enabled", false);

/** CRASH REPORTS ***/
user_pref("breakpad.reportURL", "");
user_pref("browser.tabs.crashReporting.sendReport", false);
user_pref("browser.crashReports.unsubmittedCheck.enabled", false);

/****************************************************************************
 * SECTION: PESKYFOX                                                        *
****************************************************************************/
/** MOZILLA UI ***/
user_pref("extensions.getAddons.showPane", false);
user_pref("extensions.htmlaboutaddons.recommendations.enabled", false);
user_pref("browser.discovery.enabled", false);
user_pref("browser.shell.checkDefaultBrowser", false);
user_pref("browser.newtabpage.activity-stream.asrouter.userprefs.cfr.addons", false);
user_pref("browser.newtabpage.activity-stream.asrouter.userprefs.cfr.features", false);
user_pref("browser.preferences.moreFromMozilla", false);
user_pref("browser.aboutConfig.showWarning", false);
user_pref("browser.startup.homepage_override.mstone", "ignore");
user_pref("browser.aboutwelcome.enabled", false);
user_pref("browser.profiles.enabled", true);

/** THEME ADJUSTMENTS ***/
user_pref("toolkit.legacyUserProfileCustomizations.stylesheets", true);
user_pref("browser.compactmode.show", true);
user_pref("browser.privateWindowSeparation.enabled", false); // WINDOWS

/** AI ***/
user_pref("browser.ai.control.default", "blocked");
user_pref("browser.ml.enable", false);
user_pref("browser.ml.chat.enabled", false);
user_pref("browser.ml.chat.menu", false);
user_pref("browser.tabs.groups.smart.enabled", false);
user_pref("browser.ml.linkPreview.enabled", false);

/** FULLSCREEN NOTICE ***/
user_pref("full-screen-api.transition-duration.enter", "0 0");
user_pref("full-screen-api.transition-duration.leave", "0 0");
user_pref("full-screen-api.warning.timeout", 0);

/** URL BAR ***/
user_pref("browser.urlbar.trending.featureGate", false);

/** NEW TAB PAGE ***/
user_pref("browser.newtabpage.activity-stream.default.sites", "");
user_pref("browser.newtabpage.activity-stream.showSponsoredTopSites", false);
user_pref("browser.newtabpage.activity-stream.feeds.section.topstories", false);
user_pref("browser.newtabpage.activity-stream.showSponsored", false);
user_pref("browser.newtabpage.activity-stream.showSponsoredCheckboxes", false);

/** DOWNLOADS ***/
user_pref("browser.download.manager.addToRecentDocs", false);

/** PDF ***/
user_pref("browser.download.open_pdf_attachments_inline", true);

/** TAB BEHAVIOR ***/
user_pref("browser.bookmarks.openInTabClosesMenu", false);
user_pref("findbar.highlightAll", true);

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
