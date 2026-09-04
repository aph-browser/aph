// Aph Browser Settings

// 1. Usability / Timezone / Dark mode
user_pref("privacy.resistFingerprinting", false);
user_pref("privacy.clearOnShutdown.cookies", false);

// 2. DRM Playback (Netflix / Spotify)
user_pref("media.eme.enabled", true);
user_pref("media.gmp-widevinecdm.enabled", true);
user_pref("media.gmp-provider.enabled", true);

// 3. Force Vertical Tabs
user_pref("sidebar.revamp", true);
user_pref("sidebar.verticalTabs", true);
user_pref("sidebar.visibility", "always-show");
user_pref("sidebar.main.tools", "");

// 4. Disable pre-rendered New Tab cache during development
user_pref("browser.startup.homepage.abouthome_cache.enabled", false);

// 5. Keep window open when last tab is closed
user_pref("browser.tabs.closeWindowWithLastTab", false);

// 6. Open new tabs immediately after the current one
user_pref("browser.tabs.insertAfterCurrent", true);

// 7. Restore previous windows and tabs on launch
user_pref("browser.startup.page", 3);

// 8. Never show bookmarks toolbar
user_pref("browser.toolbars.bookmarks.visibility", "never");

// 9. Enable Chrome devtools
user_pref("devtools.chrome.enabled", true);

// 10. Enable remote debugging
user_pref("devtools.debugger.remote-enabled", true);
