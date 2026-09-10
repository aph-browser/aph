// Aph Browser Settings
// Seed-once defaults: copied into a profile on first launch only, so user
// changes via about:config / Settings persist. Re-apply with: just sync-prefs

// 1. Usability / Timezone / Dark mode
user_pref("privacy.resistFingerprinting", false);
user_pref("privacy.clearOnShutdown.cookies", false);

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

// 11. Enable Nova
user_pref("browser.nova.enabled", true);

// 11b. Nova "Sun" theme (radiant gold) as the default, user-switchable.
// Installed via ExtensionSettings policy (config/policies.json).
// NOTE: Sun requires Firefox >= 156 (min version on AMO); on older builds
// it stays dormant and the default theme applies until the next Firefox
// update. normal_installed (not locked) so it can be changed in about:addons.
user_pref("extensions.activeThemeID", "nova-sun@mozilla.org");

// 12. Workspace tab unloading: manual via palette ("Unload Inactive Tabs").
// Set true to also discard eligible hidden-workspace tabs after each switch.
user_pref("aph.workspaces.unloadOnSwitch", false);

// 13. Default New Tab wallpaper: Celestial "eclipse-time-lapse" (dark).
// NOTE: this pref stores the wallpaper *title*, not the record ID/UUID.
// (title eclipse-time-lapse; attachment main-workspace/newtab-wallpapers-v2/55b678ff-15c3-49d5-bdbc-40f8413cfb8a.avif;
// record ID 2868b784-19d5-4f9b-9f77-047917484b19. Ships in
// defaults/settings/main/newtab-wallpapers-v2.json so it resolves offline.)
user_pref("browser.newtabpage.activity-stream.newtabWallpapers.enabled", true);
user_pref("browser.newtabpage.activity-stream.newtabWallpapers.wallpaper", "eclipse-time-lapse");
user_pref("browser.newtabpage.activity-stream.newtabWallpapers.user.enabled", true);

/****************************************************************************
 * END: APH NATIVE OVERRIDES
****************************************************************************/
