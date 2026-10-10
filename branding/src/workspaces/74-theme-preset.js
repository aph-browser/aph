  // Theme presets: aph.theme.preset pins a frozen Aph room
  // (midnight/paper/nord/espresso, tokens.css companion) against the OS
  // scheme; auto (or anything unknown) removes the pin so the
  // prefers-color-scheme faces own the room again. Rendering is CSS-only
  // via :root[data-aph-preset] — no paint logic here. Session-only and
  // per-window like workspaces themselves (the attribute dies with the
  // window); the pref is the cross-window truth, carried live by the
  // observer below. House style: fail-silent everywhere.
  const THEME_PRESET_PREF = "aph.theme.preset";
  const THEME_PRESET_ATTR = "data-aph-preset";
  const THEME_PRESETS = ["midnight", "paper", "nord", "mocha", "espresso"];

  function getThemePreset() {
    try {
      let raw = "";
      try {
        raw = Services.prefs.getStringPref(THEME_PRESET_PREF, "auto");
      } catch (e) {}
      const v = String(raw || "").trim().toLowerCase();
      if (THEME_PRESETS.indexOf(v) !== -1) {
        return v;
      }
    } catch (e) {}
    return "";
  }

  function applyThemePreset() {
    let preset = "";
    try {
      preset = getThemePreset();
    } catch (e) {
      preset = "";
    }
    try {
      const root = document.documentElement;
      if (!root) {
        return preset;
      }
      if (preset) {
        root.setAttribute(THEME_PRESET_ATTR, preset);
      } else {
        root.removeAttribute(THEME_PRESET_ATTR);
      }
    } catch (e) {}
    return preset;
  }

  function setThemePreset(preset) {
    const v = String(preset || "").trim().toLowerCase();
    try {
      if (v && THEME_PRESETS.indexOf(v) === -1 && v !== "auto") {
        return false;
      }
      Services.prefs.setStringPref(THEME_PRESET_PREF, v || "auto");
    } catch (e) {
      return false;
    }
    // The pref observer restamps every window (this one included) —
    // no direct stamp here, one path paints them all.
    return true;
  }

  function onThemePresetPref() {
    try {
      applyThemePreset();
    } catch (e) {}
  }

  function cleanupThemePreset() {
    try {
      if (typeof themePresetObserver !== "undefined" && themePresetObserver) {
        Services.prefs.removeObserver(THEME_PRESET_PREF, themePresetObserver);
      }
    } catch (e) {}
    try {
      themePresetObserver = null;
    } catch (e) {}
    try {
      const root = document.documentElement;
      if (root && typeof root.removeAttribute === "function") {
        root.removeAttribute(THEME_PRESET_ATTR);
      }
    } catch (e) {}
  }

  function initThemePreset() {
    try {
      applyThemePreset();
    } catch (e) {}
    try {
      themePresetObserver = { observe: onThemePresetPref };
      Services.prefs.addObserver(THEME_PRESET_PREF, themePresetObserver);
    } catch (e) {
      try {
        themePresetObserver = null;
      } catch (_e) {}
    }
    try {
      window.addEventListener("unload", cleanupThemePreset, { once: true });
    } catch (e) {}
    // Own namespace (AphStar precedent): this module initializes before
    // 110-chrome-init builds window.AphWorkspaces, so there is nothing
    // to attach to yet.
    try {
      window.AphThemePreset = {
        getThemePreset,
        setThemePreset,
        applyThemePreset,
      };
    } catch (e) {}
  }

  if (document.readyState === "complete") {
    initThemePreset();
  } else {
    window.addEventListener("load", initThemePreset, { once: true });
  }
