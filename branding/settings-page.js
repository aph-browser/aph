/* Aph settings page — runs inside aph-settings.html (chrome:// page in a tab).
 *
 * System-principal chrome pages can use Services directly (same precedent
 * as about:config), so toggles read and write
 * the aph.* prefs here with default values from config/default-prefs.js.
 * Classic script, external file only (no inline scripts — chrome pages
 * may enforce script-src restrictions).
 *
 * Pure helpers live on window.AphSettingsLogic for node:vm tests;
 * the DOM controller below is fail-silent house style throughout.
 */
var AphSettingsLogic = (function () {
  const BOOL_DEFAULTS = {
    "aph.unload.autoEnabled": true,
    "aph.unload.onLowMemory": true,
    // Stock Firefox safety net (not Aph's): the native LRU + memory-weight
    // unloader under real memory pressure. Seeded on like stock; the row
    // below keeps it user-togglable so flips save natively to prefs.js.
    "browser.tabs.unloadOnLowMemory": true,
    "aph.pins.ctrlWUnloads": true,
    "aph.stars.ctrlWUnloads": true,
    "aph.sidebar.hideFooter": true,
    // Stock prefs (not aph.*): Sync/accounts and the password manager
    // ship OFF — the Settings toggles below are the on-ramp. Defaults
    // here must match config/user-overrides.js values.
    "identity.fxaccounts.enabled": false,
    "signon.rememberSignons": false,
  };

  // Automatic unloading staleness: minutes (pref aph.unload.staleMin, default 30).
  const UNLOAD_STALE_PREF = "aph.unload.staleMin";
  const UNLOAD_STALE_DEFAULT = 30;
  const UNLOAD_STALE_MIN = 0;
  const UNLOAD_STALE_MAX = 1440;

  // Staleness presets (Edge/Chrome tier shape, one pref underneath):
  // Relaxed keeps the work session, Balanced is today's default,
  // Aggressive stays above the 5-minute sweeper interval (no per-sweep
  // churn). The int row stays editable for exact values.
  const UNLOAD_STALE_PRESETS = [
    { label: "Relaxed", value: 60 },
    { label: "Balanced", value: 30 },
    { label: "Aggressive", value: 10 },
  ];

  const FRECENCY_PREF = "aph.palette.frecency";
  const NAMES_PREF = "aph.workspaces.names";
  const BINDINGS_PREF = "aph.workspaces.containerBindings";
  const ROUTES_PREF = "aph.workspaces.domainRoutes";
  const ACCENTS_PREF = "aph.workspaces.accents";

  // Appearance (color-scheme room): driven through Firefox's own built-in
  // themes, never an Aph override — every prefers-color-scheme consumer
  // (canvas faces, menu glyphs, palette light blocks) follows for
  // free. System = stock default theme = today's behavior exactly.
  const APPEARANCE_OPTIONS = ["system", "dark", "light"];
  const APPEARANCE_THEMES = {
    system: "default-theme@mozilla.org",
    dark: "firefox-compact-dark@mozilla.org",
    light: "firefox-compact-light@mozilla.org",
  };

  function themeIdForAppearance(sel) {
    try {
      const k = String(sel || "").trim().toLowerCase();
      if (k && APPEARANCE_THEMES[k]) {
        return APPEARANCE_THEMES[k];
      }
    } catch (e) {}
    return APPEARANCE_THEMES.system;
  }

  // Theme presets: frozen Aph rooms (tokens.css companion) picked below
  // the Appearance radios. Each preset pairs with the matching Firefox
  // built-in theme so scheme art (menu glyphs, palette slab) agrees with
  // the room — paper pins light, every other preset pins dark, auto
  // restores the system theme and unpins the room. Unknown values read
  // as auto (the chrome module allowlists the same way).
  const THEME_PRESET_PREF = "aph.theme.preset";
  const THEME_PRESET_OPTIONS = ["auto", "midnight", "paper", "nord", "mocha", "espresso"];
  const THEME_PRESET_SCHEME = {
    auto: "system",
    midnight: "dark",
    paper: "light",
    nord: "dark",
    mocha: "dark",
    espresso: "dark",
  };

  // Unknown active themes (Alpenglow, colorways, third-party) bucket to
  // System: Aph only promises its three rooms, never a stranger's.
  function appearanceForThemeId(id) {
    try {
      const v = String(id || "").trim();
      for (const k of APPEARANCE_OPTIONS) {
        if (APPEARANCE_THEMES[k] === v) {
          return k;
        }
      }
    } catch (e) {}
    return "system";
  }

  const GROUPS = [
    {
      name: "Workspaces",
      rows: [
        {
          kind: "bool",
          pref: "aph.unload.autoEnabled",
          title: "Auto-unload stale tabs",
          desc: "Every 5 minutes (and 15 s after you stop switching), discard tabs not viewed within the staleness below — hidden workspaces and idle current-workspace tabs alike. Starred, pinned, audible, loading and unsaved-form tabs never unload; click an unloaded tab to reload it.",
        },
        {
          kind: "int",
          pref: "aph.unload.staleMin",
          title: "Auto-unload staleness",
          desc: "Tabs viewed within this many minutes are spared when the sweep fires. Tabs with no recorded view time count as stale.",
        },
        {
          kind: "presets",
          pref: "aph.unload.staleMin",
          title: "Staleness presets",
          desc: "One-click tiers writing the staleness above. Aggressive stays above the 5-minute sweeper interval, so sweeps never churn.",
        },
        {
          kind: "bool",
          pref: "aph.unload.onLowMemory",
          title: "Unload on low memory",
          desc: "When Firefox reports memory pressure, immediately discard stale tabs (same guards as auto-unload). On by default — the guard set makes an extra sweep safe anywhere.",
        },
        {
          kind: "bool",
          pref: "browser.tabs.unloadOnLowMemory",
          title: "Firefox native low-memory unloading",
          desc: "Stock safety net: Firefox itself unloads least-recently-used tabs when system memory runs low. Workspace-blind (it can take starred tabs too) but click-to-reload. On matches stock; off leaves memory to Aph's sweeps alone.",
        },
      ],
    },
    {
      name: "Tabs",
      rows: [
        {
          kind: "bool",
          pref: "aph.pins.ctrlWUnloads",
          title: "Ctrl+W parks pinned tabs",
          desc: "A drifted pin resets to its pinned base URL in place; a pin already at base unloads. Second press closes. Off restores stock close-on-first-press.",
        },
        {
          kind: "bool",
          pref: "aph.stars.ctrlWUnloads",
          title: "Ctrl+W parks starred tabs",
          desc: "Mirrors pins for starred tabs: drifted stars reset in place, at-base stars unload, second press closes.",
        },
      ],
    },
    {
      name: "Sidebar",
      rows: [
        {
          kind: "bool",
          pref: "aph.sidebar.hideFooter",
          title: "Hide sidebar footer",
          desc: "Hide the sidebar settings gear to reclaim the strip. Customize Sidebar stays reachable via the Aph menu either way.",
        },
      ],
    },
    {
      name: "Accounts & Passwords",
      rows: [
        {
          kind: "bool",
          pref: "identity.fxaccounts.enabled",
          title: "Firefox Sync and Mozilla account",
          desc: "Show the account UI and allow signing in to Sync (bookmarks, history, passwords, tabs — end-to-end encrypted). Off by default; takes effect after a restart.",
        },
        {
          kind: "bool",
          pref: "signon.rememberSignons",
          title: "Save and fill passwords",
          desc: "Offer to save logins and fill them on sites. Off by default; already-saved logins stay stored until you delete them in Firefox Settings.",
        },
      ],
    },
  ];

  function clampStaleMin(v) {
    const n = Math.floor(Number(v));
    if (!Number.isFinite(n)) {
      return UNLOAD_STALE_DEFAULT;
    }
    if (n < UNLOAD_STALE_MIN) {
      return UNLOAD_STALE_MIN;
    }
    if (n > UNLOAD_STALE_MAX) {
      return UNLOAD_STALE_MAX;
    }
    return n;
  }

  // Per-pref clamp dispatcher for the generic int rows (read + write +
  // backup share it, so the page can never persist an out-of-range
  // value no matter which path writes).
  function clampIntPref(pref, v) {
    return clampStaleMin(v);
  }

  // Guarded JSON-object parse: malformed / non-object values become {}.
  function parseJsonObject(raw) {
    try {
      if (!raw) {
        return {};
      }
      const v = JSON.parse(raw);
      if (v && typeof v === "object" && !Array.isArray(v)) {
        return v;
      }
    } catch (e) {}
    return {};
  }

  function countKeys(o) {
    try {
      return Object.keys(o || {}).length;
    } catch (e) {
      return 0;
    }
  }

  // --- Backup / export -------------------------------------------------
  // File shape: { aphBackup: 1, exportedAt: <ISO>, prefs: { pref: value } }.
  // Values are parsed (objects stay objects), so files are readable and
  // diffable. Import writes only keys present in the file (merge, never
  // delete); unknown keys are ignored so newer files stay loadable.
  const BACKUP_VERSION = 1;
  const BACKUP_BOOL_PREFS = Object.keys(BOOL_DEFAULTS);
  const BACKUP_JSON_PREFS = [NAMES_PREF, BINDINGS_PREF, ROUTES_PREF, ACCENTS_PREF, FRECENCY_PREF];

  // read: { bool(pref, def), int(pref, def), json(pref) } — the DOM
  // controller binds these to Services; tests pass stubs.
  function buildBackup(read) {
    const out = {};
    try {
      for (const k of BACKUP_BOOL_PREFS) {
        out[k] = !!read.bool(k, BOOL_DEFAULTS[k]);
      }
      out[UNLOAD_STALE_PREF] = clampStaleMin(read.int(UNLOAD_STALE_PREF, UNLOAD_STALE_DEFAULT));
      for (const k of BACKUP_JSON_PREFS) {
        out[k] = read.json(k);
      }
    } catch (e) {}
    let exportedAt = "";
    try {
      exportedAt = new Date().toISOString();
    } catch (e) {}
    return { aphBackup: BACKUP_VERSION, exportedAt, prefs: out };
  }

  function isObject(v) {
    return !!v && typeof v === "object" && !Array.isArray(v);
  }

  // Strict on known-key types (a hand-edited file with a string where a
  // bool belongs is almost certainly a mistake); lenient on unknown keys
  // (ignored) and missing keys (import simply skips them).
  function parseBackup(text) {
    let root = null;
    try {
      root = JSON.parse(text);
    } catch (e) {
      return { ok: false, error: "Not valid JSON." };
    }
    if (!isObject(root) || !isObject(root.prefs)) {
      return { ok: false, error: "Not an Aph backup file." };
    }
    if (root.aphBackup !== BACKUP_VERSION) {
      return { ok: false, error: `Unsupported backup version ${String(root.aphBackup)}.` };
    }
    const prefs = {};
    for (const k of BACKUP_BOOL_PREFS) {
      if (k in root.prefs) {
        if (typeof root.prefs[k] !== "boolean") {
          return { ok: false, error: `${k} must be true or false.` };
        }
        prefs[k] = root.prefs[k];
      }
    }
    if (UNLOAD_STALE_PREF in root.prefs) {
      if (
        typeof root.prefs[UNLOAD_STALE_PREF] !== "number" ||
        !Number.isFinite(root.prefs[UNLOAD_STALE_PREF])
      ) {
        return { ok: false, error: `${UNLOAD_STALE_PREF} must be a number.` };
      }
      prefs[UNLOAD_STALE_PREF] = clampStaleMin(root.prefs[UNLOAD_STALE_PREF]);
    }
    // JSON prefs validate in BACKUP_JSON_PREFS order so an export →
    // import round-trip keeps stable key order (diffable files).
    for (const k of BACKUP_JSON_PREFS) {
      if (!(k in root.prefs)) {
        continue;
      }
      if (!isObject(root.prefs[k])) {
        return { ok: false, error: `${k} must be an object.` };
      }
      prefs[k] = root.prefs[k];
    }
    return { ok: true, prefs, exportedAt: typeof root.exportedAt === "string" ? root.exportedAt : "" };
  }

  // One-line summary for the import confirm dialog.
  function summarizeBackup(prefs) {
    const bits = [];
    try {
      const n = countKeys(prefs[NAMES_PREF]);
      if (n) {
        bits.push(`${n} workspace name${n === 1 ? "" : "s"}`);
      }
      const b = countKeys(prefs[BINDINGS_PREF]);
      if (b) {
        bits.push(`${b} binding${b === 1 ? "" : "s"}`);
      }
      const r = countKeys(prefs[ROUTES_PREF]);
      if (r) {
        bits.push(`${r} route${r === 1 ? "" : "s"}`);
      }
      const a = countKeys(prefs[ACCENTS_PREF]);
      if (a) {
        bits.push(`${a} accent${a === 1 ? "" : "s"}`);
      }
      let toggles = 0;
      for (const k of BACKUP_BOOL_PREFS) {
        if (k in prefs) {
          toggles++;
        }
      }
      if (UNLOAD_STALE_PREF in prefs) {
        toggles++;
      }
      if (toggles) {
        bits.push(`${toggles} setting${toggles === 1 ? "" : "s"}`);
      }
    } catch (e) {}
    return bits.length ? bits.join(", ") : "no Aph prefs";
  }

  return {
    BOOL_DEFAULTS,
    UNLOAD_STALE_PREF,
    UNLOAD_STALE_DEFAULT,
    UNLOAD_STALE_MIN,
    UNLOAD_STALE_MAX,
    UNLOAD_STALE_PRESETS,
    FRECENCY_PREF,
    NAMES_PREF,
    BINDINGS_PREF,
    ROUTES_PREF,
    ACCENTS_PREF,
    APPEARANCE_OPTIONS,
    APPEARANCE_THEMES,
    themeIdForAppearance,
    appearanceForThemeId,
    THEME_PRESET_PREF,
    THEME_PRESET_OPTIONS,
    THEME_PRESET_SCHEME,
    GROUPS,
    clampStaleMin,
    clampIntPref,
    parseJsonObject,
    countKeys,
    BACKUP_VERSION,
    BACKUP_BOOL_PREFS,
    BACKUP_JSON_PREFS,
    buildBackup,
    parseBackup,
    summarizeBackup,
  };
})();

(function () {
  const L = function () {
    try {
      return window.AphSettingsLogic || null;
    } catch (e) {
      return null;
    }
  };

  const TOAST_MS = 2400;
  let toastTimer = null;
  let searchQuery = "";
  let modalOk = null;

  function $(id) {
    try {
      return document.getElementById(id);
    } catch (e) {
      return null;
    }
  }

  function prefs() {
    try {
      return Services && Services.prefs ? Services.prefs : null;
    } catch (e) {
      return null;
    }
  }

  function boolDefault(pref) {
    try {
      const l = L();
      if (l && l.BOOL_DEFAULTS && pref in l.BOOL_DEFAULTS) {
        return !!l.BOOL_DEFAULTS[pref];
      }
    } catch (e) {}
    return false;
  }

  function readBool(pref) {
    const d = boolDefault(pref);
    try {
      const p = prefs();
      if (!p || typeof p.getBoolPref !== "function") {
        return d;
      }
      try {
        // Two-arg form where supported; throws where not.
        return p.getBoolPref(pref, d);
      } catch (e) {
        try {
          return p.getBoolPref(pref);
        } catch (_e) {
          return d;
        }
      }
    } catch (e) {
      return d;
    }
  }

  function writeBool(pref, v) {
    try {
      const p = prefs();
      if (p && typeof p.setBoolPref === "function") {
        p.setBoolPref(pref, !!v);
        return true;
      }
    } catch (e) {}
    return false;
  }

  // Generic int-pref IO shared by every number row.
  function staleDefaultFor(pref) {
    try {
      const l = L();
      if (l && pref === l.UNLOAD_STALE_PREF) {
        return l.UNLOAD_STALE_DEFAULT || 30;
      }
    } catch (e) {}
    return 30;
  }

  function clampIntFor(pref, v) {
    try {
      const l = L();
      if (l && typeof l.clampIntPref === "function") {
        return l.clampIntPref(pref, v);
      }
      if (l && typeof l.clampStaleMin === "function") {
        return l.clampStaleMin(v);
      }
    } catch (e) {}
    return Math.floor(Number(v));
  }

  function readIntPref(pref) {
    const d = staleDefaultFor(pref);
    try {
      const l = L();
      const p = prefs();
      if (!p || typeof p.getIntPref !== "function") {
        return d;
      }
      let v = d;
      try {
        v = p.getIntPref(pref, d);
      } catch (e) {
        try {
          v = p.getIntPref(pref);
        } catch (_e) {
          v = d;
        }
      }
      return clampIntFor(pref, v);
    } catch (e) {
      return d;
    }
  }

  function writeIntPref(pref, v) {
    try {
      const clamped = clampIntFor(pref, v);
      const p = prefs();
      if (p && typeof p.setIntPref === "function") {
        p.setIntPref(pref, clamped);
        return clamped;
      }
      return clamped;
    } catch (e) {
      return null;
    }
  }

  function readString(pref) {
    try {
      const p = prefs();
      if (!p) {
        return "";
      }
      if (typeof p.getStringPref === "function") {
        let v = "";
        try {
          v = p.getStringPref(pref, "") || "";
        } catch (e) {
          try {
            v = p.getStringPref(pref) || "";
          } catch (_e) {
            v = "";
          }
        }
        return v || "";
      }
      if (typeof p.getCharPref === "function") {
        try {
          return p.getCharPref(pref, "");
        } catch (e) {
          try {
            return p.getCharPref(pref);
          } catch (_e) {
            return "";
          }
        }
      }
    } catch (e) {}
    return "";
  }

  function readJsonObject(pref) {
    try {
      const l = L();
      const raw = readString(pref);
      if (l) {
        return l.parseJsonObject(raw);
      }
      if (!raw) {
        return {};
      }
      const v = JSON.parse(raw);
      return v && typeof v === "object" && !Array.isArray(v) ? v : {};
    } catch (e) {
      return {};
    }
  }

  function writeJsonObject(pref, obj) {
    return writeString(pref, obj || {});
  }

  function writeString(pref, value) {
    let text = "";
    try {
      text = JSON.stringify(value);
    } catch (e) {
      return false;
    }
    // JSON prefs may legitimately stringify to undefined (functions can
    // never appear here, but a hostile backup object could smuggle one
    // past parse — refuse instead of writing the literal "undefined").
    if (typeof text !== "string") {
      return false;
    }
    try {
      const p = prefs();
      if (!p) {
        return false;
      }
      if (typeof p.setStringPref === "function") {
        p.setStringPref(pref, text);
        return true;
      }
      if (typeof p.setCharPref === "function") {
        p.setCharPref(pref, text);
        return true;
      }
    } catch (e) {}
    return false;
  }

  // Appearance bridge: Firefox's own theme manager drives the room
  // (System/Dark/Light), so every prefers-color-scheme consumer follows
  // with no Aph-side override to drift. Layered resolution — bare
  // global, window/globalThis globals, the AddonManager module (ESM,
  // then legacy JSM), then the lightweight-theme XPCOM service — all
  // fail-silent: no manager means the radio writes degrade to the
  // about:addons fallback below, never throw. diagLog records which
  // stage failed to the consoles (Browser Console included) so a
  // "unreachable manager" report carries its cause.
  function diagLog(msg) {
    try {
      const line = `[AphAppearance] ${msg}`;
      try {
        const svc = typeof Services !== "undefined" ? Services : null;
        if (svc && svc.console && typeof svc.console.logStringMessage === "function") {
          svc.console.logStringMessage(line);
          return;
        }
      } catch (_e) {}
      try {
        if (typeof console !== "undefined" && console && typeof console.error === "function") {
          console.error(line);
        }
      } catch (_e) {}
    } catch (e) {}
  }

  function pickAddonManager(m) {
    try {
      if (!m) {
        return null;
      }
      if (typeof m.getAddonByID === "function" && typeof m.getAddonsByTypes === "function") {
        return m;
      }
      // ESM namespace shape ({ AddonManager } or default-exported).
      const inner = m.AddonManager || m.default || null;
      if (inner && typeof inner.getAddonByID === "function") {
        return inner;
      }
    } catch (e) {}
    return null;
  }

  function getAddonManagerAsync() {
    try {
      let direct = null;
      try {
        if (typeof AddonManager !== "undefined" && AddonManager) {
          direct = AddonManager;
        }
      } catch (e) {}
      try {
        if (!direct && typeof window !== "undefined" && window && window.AddonManager) {
          direct = window.AddonManager;
        }
      } catch (e) {}
      try {
        if (!direct && typeof globalThis !== "undefined" && globalThis && globalThis.AddonManager) {
          direct = globalThis.AddonManager;
        }
      } catch (e) {}
      const picked = pickAddonManager(direct);
      if (picked) {
        return Promise.resolve(picked);
      }
    } catch (e) {}
    try {
      if (
        typeof ChromeUtils !== "undefined" &&
        ChromeUtils &&
        typeof ChromeUtils.importESModule === "function"
      ) {
        // importESModule returns the namespace SYNCHRONOUSLY (never a
        // promise) — calling .then on it throws and silently kills theme
        // pairing. Accept both shapes: a thenable (defensive) or the
        // namespace itself.
        let imported = null;
        try {
          imported =
            ChromeUtils.importESModule("resource://gre/modules/AddonManager.sys.mjs");
        } catch (e) {
          diagLog(`AddonManager.sys.mjs import failed: ${e && (e.message || e)}`);
          imported = null;
        }
        if (imported && typeof imported.then === "function") {
          return imported.then(
            (m) => pickAddonManager(m),
            (e) => {
              diagLog(`AddonManager.sys.mjs import failed: ${e && (e.message || e)}`);
              return null;
            }
          );
        }
        const picked = pickAddonManager(imported);
        if (picked) {
          return Promise.resolve(picked);
        }
        diagLog("AddonManager.sys.mjs namespace unusable");
        return Promise.resolve(null);
      }
      diagLog("ChromeUtils.importESModule unavailable");
    } catch (e) {
      diagLog(`module import threw: ${e && (e.message || e)}`);
    }
    try {
      return Promise.resolve(null);
    } catch (_e) {
      return null;
    }
  }

  function readAppearance() {
    try {
      const p = getAddonManagerAsync();
      if (!p || typeof p.then !== "function") {
        return Promise.resolve(null);
      }
      return p.then(
        (am) => {
          if (!am || typeof am.getAddonsByTypes !== "function") {
            return null;
          }
          try {
            return am.getAddonsByTypes(["theme"]).then(
              (list) => {
                try {
                  const l = L();
                  for (const a of list || []) {
                    if (a && a.isActive) {
                      return l && typeof l.appearanceForThemeId === "function"
                        ? l.appearanceForThemeId(a.id)
                        : "system";
                    }
                  }
                } catch (_e) {}
                return "system";
              },
              (e) => {
                diagLog(`theme list failed: ${e && (e.message || e)}`);
                return null;
              }
            );
          } catch (_e) {
            return null;
          }
        },
        () => null
      );
    } catch (e) {
      try {
        return Promise.resolve(null);
      } catch (_e) {
        return null;
      }
    }
  }

  // Last resort when no theme manager is reachable: deep-link the
  // built-in theme manager so the room switch stays one click away
  // instead of a dead toast. New window (never navigate this page).
  function openThemeManagerFallback() {
    try {
      if (typeof window !== "undefined" && window && typeof window.open === "function") {
        window.open("about:addons");
        return true;
      }
    } catch (e) {}
    return false;
  }

  function writeAppearance(sel) {
    try {
      const l = L();
      const id = l && typeof l.themeIdForAppearance === "function"
        ? l.themeIdForAppearance(sel)
        : "default-theme@mozilla.org";
      const p = getAddonManagerAsync();
      if (!p || typeof p.then !== "function") {
        diagLog("no async manager channel");
        if (openThemeManagerFallback()) {
          toast("Opening theme manager…");
        } else {
          toast("Settings unavailable");
        }
        return;
      }
      p.then(
        (am) => {
          if (!am || typeof am.getAddonByID !== "function") {
            diagLog("manager resolved without getAddonByID");
            if (openThemeManagerFallback()) {
              toast("Opening theme manager…");
            } else {
              toast("Settings unavailable");
            }
            return;
          }
          try {
            am.getAddonByID(id).then(
              (addon) => {
                if (!addon || typeof addon.enable !== "function") {
                  diagLog(`built-in theme missing: ${id}`);
                  toast("Theme unavailable");
                  return;
                }
                try {
                  Promise.resolve(addon.enable()).then(
                    () => toast("Saved"),
                    (e) => {
                      diagLog(`enable failed: ${e && (e.message || e)}`);
                      toast("Write failed");
                    }
                  );
                } catch (_e) {
                  toast("Write failed");
                }
              },
              (e) => {
                diagLog(`theme lookup failed: ${e && (e.message || e)}`);
                toast("Theme unavailable");
              }
            );
          } catch (_e) {
            toast("Theme unavailable");
          }
        },
        () => {
          if (openThemeManagerFallback()) {
            toast("Opening theme manager…");
          } else {
            toast("Settings unavailable");
          }
        }
      );
    } catch (e) {
      toast("Write failed");
    }
  }

  // First group on the page: System follows the OS, Dark/Light pin the
  // room regardless of OS. Native radios with an Aph accent wash
  // (accent-color) — no custom knob to drift from the toggle dialect.
  function makeAppearanceSection() {
    const section = document.createElement("section");
    section.className = "aph-settings-group";
    section.dataset.group = "Appearance";
    const h = document.createElement("h2");
    h.textContent = "Appearance";
    section.appendChild(h);
    const opts = [
      { value: "system", label: "System", desc: "Follow the OS appearance." },
      { value: "dark", label: "Dark", desc: "Always the dark room." },
      { value: "light", label: "Light", desc: "Always the paper room." },
    ];
    for (const o of opts) {
      const row = document.createElement("label");
      row.className = "aph-settings-row aph-settings-appearance";
      const radio = document.createElement("input");
      radio.type = "radio";
      radio.name = "aph-appearance";
      radio.value = o.value;
      radio.className = "aph-settings-radio";
      radio.setAttribute("aria-label", `Appearance: ${o.label}`);
      radio.addEventListener("change", () => {
        try {
          if (radio.checked) {
            writeAppearance(radio.value);
          }
        } catch (_e) {}
      });
      row.appendChild(radio);
      const main = document.createElement("div");
      main.className = "aph-settings-main";
      const lab = document.createElement("div");
      lab.className = "aph-settings-label";
      lab.textContent = o.label;
      main.appendChild(lab);
      const desc = document.createElement("div");
      desc.className = "aph-settings-desc";
      desc.textContent = o.desc;
      main.appendChild(desc);
      row.appendChild(main);
      section.appendChild(row);
    }
    const hint = document.createElement("div");
    hint.className = "aph-settings-hint";
    hint.textContent = "Themes live in Firefox Settings too (Aph menu → Firefox Settings…).";
    section.appendChild(hint);
    return section;
  }

  // Radios resolve async (theme query) after the sync render: stamp the
  // checked state in place, never a second full render (which would
  // clobber an in-progress edit elsewhere on the page). Null (manager
  // unreachable) stamps nothing — no radio claims a room it can't verify.
  function refreshAppearanceRadios() {
    try {
      const p = readAppearance();
      if (!p || typeof p.then !== "function") {
        return;
      }
      p.then(
        (sel) => {
          try {
            if (sel !== "system" && sel !== "dark" && sel !== "light") {
              return;
            }
            const inputs = document.querySelectorAll
              ? document.querySelectorAll('input[name="aph-appearance"]')
              : [];
            for (const r of Array.from(inputs || [])) {
              try {
                r.checked = r.value === sel;
              } catch (_e) {}
            }
          } catch (_e) {}
        },
        () => {}
      );
    } catch (e) {}
  }

  // NOTE: the THEME_PRESET_* consts live in the AphSettingsLogic IIFE
  // above — controller scope reaches them only through L(), the same
  // bridge every other controller path uses (direct reads throw
  // ReferenceError here and die silently in the surrounding try/catch).
  function presetLib() {
    try {
      const l = L();
      if (!l) {
        return null;
      }
      return {
        pref: l.THEME_PRESET_PREF || "aph.theme.preset",
        options: l.THEME_PRESET_OPTIONS || ["auto"],
        scheme: l.THEME_PRESET_SCHEME || { auto: "system" },
      };
    } catch (e) {
      return null;
    }
  }

  function readThemePreset() {
    try {
      const lib = presetLib();
      const opts = (lib && lib.options) || ["auto"];
      const pref = (lib && lib.pref) || "aph.theme.preset";
      const p = prefs();
      const raw = p && typeof p.getStringPref === "function"
        ? p.getStringPref(pref, "auto")
        : "auto";
      const v = String(raw || "").trim().toLowerCase();
      if (opts.indexOf(v) !== -1) {
        return v;
      }
    } catch (e) {}
    return "auto";
  }

  function writeThemePreset(sel) {
    let lib = null;
    try {
      lib = presetLib();
    } catch (e) {
      lib = null;
    }
    const opts = (lib && lib.options) || ["auto"];
    const pref = (lib && lib.pref) || "aph.theme.preset";
    const v = String(sel || "").trim().toLowerCase();
    if (opts.indexOf(v) === -1) {
      return;
    }
    try {
      const p = prefs();
      if (!p || typeof p.setStringPref !== "function") {
        toast("Settings unavailable");
        return;
      }
      p.setStringPref(pref, v);
    } catch (e) {
      toast("Write failed");
      return;
    }
    // Pair the scheme so art agrees with the room (preset comment above).
    // The room pref observer restamps every window live; the theme change
    // toasts Saved on its own path like the Appearance radios.
    try {
      const scheme = (lib && lib.scheme) || {};
      writeAppearance(scheme[v] || "system");
    } catch (_e) {}
  }

  // Second radio group under Appearance: frozen rooms, same native-radio
  // dialect (accent-color wash, no custom knob). Sync-reads the pref, so
  // the checked state stamps at build like the int rows — no second
  // render, no clobbered edits.
  function makePresetSection() {
    const section = document.createElement("section");
    section.className = "aph-settings-group";
    section.dataset.group = "Theme preset";
    const h = document.createElement("h2");
    h.textContent = "Theme preset";
    section.appendChild(h);
    const opts = [
      { value: "auto", label: "Auto", desc: "Follow the OS room (midnight or paper)." },
      { value: "midnight", label: "Midnight", desc: "Pin the dark room against the OS." },
      { value: "paper", label: "Paper", desc: "Pin the light room against the OS." },
      { value: "nord", label: "Nord", desc: "Cool desaturated dark with a steel voice." },
      { value: "mocha", label: "Mocha", desc: "Soothing pastel dark with a mauve voice." },
      { value: "espresso", label: "Espresso", desc: "Warm umber dark, never neutral grey." },
    ];
    let current = "auto";
    try {
      current = readThemePreset();
    } catch (_e) {}
    for (const o of opts) {
      const row = document.createElement("label");
      row.className = "aph-settings-row aph-settings-appearance";
      const radio = document.createElement("input");
      radio.type = "radio";
      radio.name = "aph-preset";
      radio.value = o.value;
      radio.className = "aph-settings-radio";
      radio.setAttribute("aria-label", `Theme preset: ${o.label}`);
      try {
        radio.checked = o.value === current;
      } catch (_e) {}
      radio.addEventListener("change", () => {
        try {
          if (radio.checked) {
            writeThemePreset(radio.value);
          }
        } catch (_e) {}
      });
      row.appendChild(radio);
      const main = document.createElement("div");
      main.className = "aph-settings-main";
      const lab = document.createElement("div");
      lab.className = "aph-settings-label";
      lab.textContent = o.label;
      main.appendChild(lab);
      const desc = document.createElement("div");
      desc.className = "aph-settings-desc";
      desc.textContent = o.desc;
      main.appendChild(desc);
      row.appendChild(main);
      section.appendChild(row);
    }
    return section;
  }

  function toast(msg) {
    try {
      const el = $("aph-settings-toast");
      if (!el) {
        return;
      }
      el.textContent = msg;
      el.classList.add("show");
      if (toastTimer) {
        clearTimeout(toastTimer);
      }
      toastTimer = setTimeout(() => {
        try {
          el.classList.remove("show");
        } catch (e) {}
        toastTimer = null;
      }, TOAST_MS);
    } catch (e) {}
  }

  // Modal confirm (replaces native confirm for import/reset). Falls back
  // to window.confirm when the modal DOM is absent (tests, minimal page).
  function showModal(opts) {
    const o = opts || {};
    try {
      const m = $("aph-settings-modal");
      const t = $("aph-settings-modal-title");
      const d = $("aph-settings-modal-desc");
      const ok = $("aph-settings-modal-ok");
      const cancel = $("aph-settings-modal-cancel");
      if (!m || !t || !d || !ok || !cancel) {
        let fallback = false;
        try {
          fallback = window.confirm(`${o.title || "Confirm"}\n${o.desc || ""}`);
        } catch (e) {
          fallback = false;
        }
        if (fallback && typeof o.onOk === "function") {
          o.onOk();
        }
        return;
      }
      t.textContent = o.title || "Confirm";
      d.textContent = o.desc || "";
      ok.textContent = o.okLabel || "Confirm";
      try {
        ok.classList.toggle("danger", !!o.danger);
      } catch (e) {}
      modalOk = typeof o.onOk === "function" ? o.onOk : null;
      m.hidden = false;
      try {
        ok.focus();
      } catch (e) {}
    } catch (e) {}
  }

  function hideModal() {
    try {
      const m = $("aph-settings-modal");
      if (m) {
        m.hidden = true;
      }
    } catch (e) {}
    modalOk = null;
  }

  function makeToggle(pref, current) {
    const b = document.createElement("button");
    b.className = "aph-settings-toggle";
    b.setAttribute("role", "switch");
    b.setAttribute("aria-checked", current ? "true" : "false");
    b.setAttribute("aria-label", pref);
    b.title = pref;
    b.addEventListener("click", (ev) => {
      try {
        ev.stopPropagation();
      } catch (e) {}
      const next = b.getAttribute("aria-checked") !== "true";
      if (writeBool(pref, next)) {
        b.setAttribute("aria-checked", next ? "true" : "false");
        toast(next ? "On" : "Off");
      } else {
        toast("Write failed");
      }
    });
    b.addEventListener("keydown", (ev) => {
      try {
        if (ev.key === "Enter" || ev.key === " ") {
          ev.preventDefault();
          b.click();
        }
      } catch (e) {}
    });
    return b;
  }

  function makeBoolRow(row) {
    const wrap = document.createElement("div");
    wrap.className = "aph-settings-row";
    wrap.setAttribute("role", "button");
    wrap.setAttribute("tabindex", "0");

    const main = document.createElement("div");
    main.className = "aph-settings-main";
    const label = document.createElement("div");
    label.className = "aph-settings-label";
    label.textContent = row.title;
    main.appendChild(label);
    if (row.desc) {
      const desc = document.createElement("div");
      desc.className = "aph-settings-desc";
      desc.textContent = row.desc;
      main.appendChild(desc);
    }
    const pref = document.createElement("div");
    pref.className = "aph-settings-pref";
    pref.textContent = row.pref;
    main.appendChild(pref);
    wrap.appendChild(main);

    const cur = readBool(row.pref);
    const toggle = makeToggle(row.pref, cur);
    wrap.appendChild(toggle);

    const flip = () => {
      try {
        toggle.click();
      } catch (e) {}
    };
    wrap.addEventListener("click", (ev) => {
      try {
        if (ev.target !== toggle) {
          flip();
        }
      } catch (e) {}
    });
    wrap.addEventListener("keydown", (ev) => {
      try {
        if ((ev.key === "Enter" || ev.key === " ") && ev.target === wrap) {
          ev.preventDefault();
          flip();
        }
      } catch (e) {}
    });
    return wrap;
  }

  function makeIntRow(row) {
    const wrap = document.createElement("div");
    wrap.className = "aph-settings-row";

    const main = document.createElement("div");
    main.className = "aph-settings-main";
    const label = document.createElement("div");
    label.className = "aph-settings-label";
    label.textContent = row.title;
    main.appendChild(label);
    if (row.desc) {
      const desc = document.createElement("div");
      desc.className = "aph-settings-desc";
      desc.textContent = row.desc;
      main.appendChild(desc);
    }
    const pref = document.createElement("div");
    pref.className = "aph-settings-pref";
    pref.textContent = row.pref + " · minutes";
    main.appendChild(pref);
    wrap.appendChild(main);

    const input = document.createElement("input");
    input.className = "aph-settings-number";
    input.type = "number";
    try {
      const l = L();
      input.min = String((l && l.UNLOAD_STALE_MIN) || 0);
      input.max = String((l && l.UNLOAD_STALE_MAX) || 1440);
    } catch (e) {}
    input.value = String(readIntPref(row.pref));
    input.setAttribute("aria-label", row.pref);
    input.addEventListener("change", () => {
      const v = writeIntPref(row.pref, input.value);
      if (v !== null && v !== undefined) {
        input.value = String(v);
        toast("Saved");
      } else {
        toast("Write failed");
      }
    });
    wrap.appendChild(input);
    return wrap;
  }

  // Tier buttons writing the same int pref as the row above (Chrome
  // Moderate/Balanced/Maximum shape, one source of truth). Active tier is
  // the exact match; custom values highlight nothing. Re-renders after a
  // pick so the int input and the active state stay in sync.
  function makePresetRow(row) {
    const wrap = document.createElement("div");
    wrap.className = "aph-settings-row";

    const main = document.createElement("div");
    main.className = "aph-settings-main";
    const label = document.createElement("div");
    label.className = "aph-settings-label";
    label.textContent = row.title;
    main.appendChild(label);
    if (row.desc) {
      const desc = document.createElement("div");
      desc.className = "aph-settings-desc";
      desc.textContent = row.desc;
      main.appendChild(desc);
    }
    const pref = document.createElement("div");
    pref.className = "aph-settings-pref";
    pref.textContent = row.pref;
    main.appendChild(pref);
    wrap.appendChild(main);

    const group = document.createElement("div");
    group.className = "aph-settings-presets";
    let options = [];
    try {
      const l = L();
      options = (l && l.UNLOAD_STALE_PRESETS) || [];
    } catch (e) {}
    let cur = null;
    try {
      cur = readIntPref(row.pref);
    } catch (e) {}
    for (const o of options) {
      const b = document.createElement("button");
      b.type = "button";
      const active = cur === o.value;
      b.className = "aph-settings-rowbtn" + (active ? " is-active" : "");
      b.textContent = `${o.label} (${o.value}m)`;
      b.setAttribute("aria-pressed", active ? "true" : "false");
      b.setAttribute("aria-label", `${o.label}: ${o.value} minutes`);
      b.addEventListener("click", () => {
        const v = writeIntPref(row.pref, o.value);
        if (v !== null && v !== undefined) {
          toast("Saved");
          refreshTables();
        } else {
          toast("Write failed");
        }
      });
      group.appendChild(b);
    }
    wrap.appendChild(group);
    return wrap;
  }

  function makeEditableTable(opts) {
    const o = opts || {};
    const section = document.createElement("section");
    section.className = "aph-settings-group";
    section.dataset.group = o.title || "";
    const h = document.createElement("h2");
    h.textContent = o.title || "";
    section.appendChild(h);

    const entries = o.entries || [];
    if (!entries.length) {
      const empty = document.createElement("div");
      empty.className = "aph-settings-empty";
      empty.textContent = o.emptyText || "Nothing here yet.";
      section.appendChild(empty);
    } else {
      const table = document.createElement("table");
      table.className = "aph-settings-table";
      const thead = document.createElement("thead");
      const hr = document.createElement("tr");
      for (const c of o.headers || []) {
        const th = document.createElement("th");
        th.textContent = c;
        th.setAttribute("scope", "col");
        hr.appendChild(th);
      }
      if (o.editable) {
        const th = document.createElement("th");
        th.textContent = "Edit";
        th.setAttribute("scope", "col");
        hr.appendChild(th);
      }
      thead.appendChild(hr);
      table.appendChild(thead);
      const tb = document.createElement("tbody");
      for (const e of entries) {
        const tr = document.createElement("tr");
        try {
          if (e.ws && /^[1-9]$/.test(e.ws)) {
            tr.setAttribute("data-ws", e.ws);
          }
          if (e._accent && /^(?:[1-9]|1[0-6])$/.test(e._accent)) {
            tr.setAttribute("data-accent", e._accent);
          }
        } catch (_e) {}
        if (o.editable && typeof o.renderEditor === "function") {
          for (const c of e.cells) {
            const td = document.createElement("td");
            td.textContent = c;
            tr.appendChild(td);
          }
          const tdEdit = document.createElement("td");
          try {
            const editor = o.renderEditor(e);
            if (editor) {
              tdEdit.appendChild(editor);
            }
          } catch (_e) {}
          // Delete button for bindings/routes/names.
          if (typeof o.onDelete === "function" && e.key) {
            try {
              const del = document.createElement("button");
              del.type = "button";
              del.className = "aph-settings-rowbtn danger";
              del.textContent = "Clear";
              del.setAttribute("aria-label", `Clear ${e.key}`);
              del.addEventListener("click", (ev) => {
                try {
                  ev.stopPropagation();
                } catch (_e) {}
                o.onDelete(e.key);
              });
              tdEdit.appendChild(document.createTextNode(" "));
              tdEdit.appendChild(del);
            } catch (_e) {}
          }
          tr.appendChild(tdEdit);
        } else {
          for (const c of e.cells) {
            const td = document.createElement("td");
            td.textContent = c;
            tr.appendChild(td);
          }
        }
        tb.appendChild(tr);
      }
      table.appendChild(tb);
      section.appendChild(table);
    }
    if (o.hint) {
      const hEl = document.createElement("div");
      hEl.className = "aph-settings-hint";
      hEl.textContent = o.hint;
      section.appendChild(hEl);
    }
    return section;
  }

  // Accent hue names for the workspace accents table editor. Full
  // 16-stop scale (theme.css §21). Default nine are the deep→bright
  // ramp (1 Purple → 9 Crimson); the rest are accent-only extras. Labels
  // only, never hexes.
  const WS_ACCENT_NAMES = {
    1: "Purple",
    2: "Indigo",
    3: "Blue",
    4: "Cyan",
    5: "Jade",
    6: "Grass",
    7: "Amber",
    8: "Orange",
    9: "Crimson",
    10: "Tomato",
    11: "Ruby",
    12: "Green",
    13: "Violet",
    14: "Pink",
    15: "Plum",
    16: "Slate",
  };

  function accentEditor(ws, currentHue) {
    const sel = document.createElement("select");
    sel.className = "aph-settings-edit";
    sel.setAttribute("aria-label", `Accent for workspace ${ws}`);
    try {
      const follow = document.createElement("option");
      follow.value = "";
      follow.textContent = "Follow workspace";
      sel.appendChild(follow);
      for (let h = 1; h <= 16; h++) {
        const hs = String(h);
        const opt = document.createElement("option");
        opt.value = hs;
        opt.textContent = WS_ACCENT_NAMES[hs] || `Hue ${hs}`;
        if (currentHue === hs) {
          opt.selected = true;
        }
        sel.appendChild(opt);
      }
      if (!currentHue) {
        sel.value = "";
      }
    } catch (_e) {}
    sel.addEventListener("change", () => {
      try {
        const l = L();
        const pref = l ? l.ACCENTS_PREF : "aph.workspaces.accents";
        const accents = readJsonObject(pref);
        const v = String(sel.value || "").trim();
        if (/^(?:[1-9]|1[0-6])$/.test(v)) {
          accents[ws] = v;
          if (writeJsonObject(pref, accents)) {
            toast("Accent saved");
            refreshTables();
          } else {
            toast("Write failed");
          }
        } else if (!v) {
          delete accents[ws];
          if (writeJsonObject(pref, accents)) {
            toast("Accent cleared");
            refreshTables();
          } else {
            toast("Write failed");
          }
        } else {
          toast("Pick a hue or Follow workspace");
          sel.value = currentHue || "";
        }
      } catch (e) {
        toast("Write failed");
      }
    });
    return sel;
  }

  function nameEditor(ws, current) {
    const input = document.createElement("input");
    input.className = "aph-settings-edit";
    input.type = "text";
    input.value = current || "";
    input.placeholder = `Workspace ${ws}`;
    input.maxLength = 40;
    input.setAttribute("aria-label", `Name for workspace ${ws}`);
    input.addEventListener("change", () => {
      try {
        const l = L();
        const pref = l ? l.NAMES_PREF : "aph.workspaces.names";
        const names = readJsonObject(pref);
        const v = String(input.value || "").trim().slice(0, 40);
        if (v) {
          names[ws] = v;
        } else {
          delete names[ws];
        }
        if (writeJsonObject(pref, names)) {
          toast(v ? "Name saved" : "Name cleared");
          refreshTables();
        } else {
          toast("Write failed");
        }
      } catch (e) {
        toast("Write failed");
      }
    });
    return input;
  }

  function routeEditor(host, currentWs) {
    const input = document.createElement("input");
    input.className = "aph-settings-edit";
    input.type = "text";
    input.value = currentWs || "";
    input.placeholder = "1–9";
    input.inputMode = "numeric";
    input.maxLength = 1;
    input.setAttribute("aria-label", `Workspace for ${host}`);
    input.addEventListener("change", () => {
      try {
        const l = L();
        const pref = l ? l.ROUTES_PREF : "aph.workspaces.domainRoutes";
        const routes = readJsonObject(pref);
        const v = String(input.value || "").trim();
        if (/^[1-9]$/.test(v)) {
          routes[host] = v;
          if (writeJsonObject(pref, routes)) {
            toast("Route saved");
            refreshTables();
          } else {
            toast("Write failed");
          }
        } else if (!v) {
          delete routes[host];
          if (writeJsonObject(pref, routes)) {
            toast("Route cleared");
            refreshTables();
          }
        } else {
          toast("Use 1–9");
          input.value = currentWs || "";
        }
      } catch (e) {
        toast("Write failed");
      }
    });
    return input;
  }

  function advancedSections() {
    const out = [];
    try {
      const l = L();
      const namesPref = l ? l.NAMES_PREF : "aph.workspaces.names";
      const bindPref = l ? l.BINDINGS_PREF : "aph.workspaces.containerBindings";
      const routesPref = l ? l.ROUTES_PREF : "aph.workspaces.domainRoutes";
      const accentsPref = l && l.ACCENTS_PREF ? l.ACCENTS_PREF : "aph.workspaces.accents";
      const names = readJsonObject(namesPref);
      const bindings = readJsonObject(bindPref);
      const routes = readJsonObject(routesPref);
      const accents = readJsonObject(accentsPref);

      const nameEntries = Object.keys(names || {})
        .filter((k) => /^[1-9]$/.test(k))
        .sort()
        .map((k) => ({ ws: k, key: k, cells: [`WS ${k}`, String(names[k])] }));
      // Always show all 9 slots so names are editable inline even when empty.
      const nameRows = [];
      for (let i = 1; i <= 9; i++) {
        const k = String(i);
        const cur = names[k] ? String(names[k]) : "";
        nameRows.push({
          ws: k,
          key: k,
          cells: [`WS ${k}`, cur || "—"],
          _cur: cur,
        });
      }
      out.push(
        makeEditableTable({
          title: "Workspace names",
          headers: ["Workspace", "Name"],
          entries: searchQuery ? nameEntries : nameRows,
          emptyText: "No custom names yet.",
          hint: "Edit inline — empty clears back to “Workspace N”. Also in palette (Ctrl+K → Rename).",
          editable: true,
          renderEditor: (e) => nameEditor(e.key, e._cur != null ? e._cur : String((names[e.key] || ""))),
          onDelete: (key) => {
            try {
              const cur = readJsonObject(namesPref);
              delete cur[key];
              if (writeJsonObject(namesPref, cur)) {
                toast("Name cleared");
                refreshTables();
              }
            } catch (_e) {}
          },
        })
      );

      // All 9 slots so accents are pickable inline even when unset.
      const accentRows = [];
      for (let i = 1; i <= 9; i++) {
        const k = String(i);
        const cur = /^(?:[1-9]|1[0-6])$/.test(accents[k] || "") ? String(accents[k]) : "";
        accentRows.push({
          ws: k,
          key: k,
          cells: [`WS ${k}`, cur ? WS_ACCENT_NAMES[cur] : "Follow workspace"],
          _cur: cur,
          _accent: cur,
        });
      }
      out.push(
        makeEditableTable({
          title: "Workspace accents",
          headers: ["Workspace", "Accent"],
          entries: accentRows,
          emptyText: "No accent overrides yet.",
          hint: "Pick a hue per workspace — empty follows the workspace default. Also in the dock (right-click a pill → Accent).",
          editable: true,
          renderEditor: (e) => accentEditor(e.key, e._cur != null ? e._cur : ""),
          onDelete: (key) => {
            try {
              const cur = readJsonObject(accentsPref);
              delete cur[key];
              if (writeJsonObject(accentsPref, cur)) {
                toast("Accent cleared");
                refreshTables();
              }
            } catch (_e) {}
          },
        })
      );

      const bindEntries = Object.keys(bindings || {})
        .filter((k) => /^[1-9]$/.test(k))
        .sort()
        .map((k) => ({ ws: k, key: k, cells: [`WS ${k}`, `Container ${bindings[k]}`] }));
      out.push(
        makeEditableTable({
          title: "Container bindings",
          headers: ["Workspace", "Binding"],
          entries: bindEntries,
          emptyText: "No bindings yet — new tabs open containerless.",
          hint: "Bind via the palette (Ctrl+K → Bind). Clear removes the binding here.",
          editable: true,
          renderEditor: () => null,
          onDelete: (key) => {
            try {
              const cur = readJsonObject(bindPref);
              delete cur[key];
              if (writeJsonObject(bindPref, cur)) {
                toast("Binding cleared");
                refreshTables();
              }
            } catch (_e) {}
          },
        })
      );

      const routeEntries = Object.keys(routes || {})
        .sort()
        .map((k) => ({ ws: String(routes[k] || ""), key: k, cells: [k, `WS ${routes[k]}`], _cur: String(routes[k] || "") }));
      out.push(
        makeEditableTable({
          title: "Domain routes",
          headers: ["Host", "Workspace"],
          entries: routeEntries,
          emptyText: "No domain routes yet.",
          hint: "Edit the workspace (1–9) inline or clear to remove. Route via palette on any http(s) tab.",
          editable: true,
          renderEditor: (e) => routeEditor(e.key, e._cur),
          onDelete: (key) => {
            try {
              const cur = readJsonObject(routesPref);
              delete cur[key];
              if (writeJsonObject(routesPref, cur)) {
                toast("Route cleared");
                refreshTables();
              }
            } catch (_e) {}
          },
        })
      );
    } catch (e) {}
    return out;
  }

  // Light refresh for pref-observer updates: re-render tables only when
  // the user isn't editing (avoids clobbering an in-progress input).
  function refreshTables() {
    try {
      const ae = document.activeElement;
      if (ae && ae.className === "aph-settings-edit") {
        return;
      }
    } catch (e) {}
    render();
  }

  function matchesSearch(text) {
    try {
      const q = String(searchQuery || "").trim().toLowerCase();
      if (!q) {
        return true;
      }
      return String(text || "").toLowerCase().includes(q);
    } catch (e) {
      return true;
    }
  }

  function render() {
    const list = $("aph-settings-list");
    if (!list) {
      return;
    }
    while (list.firstChild) {
      list.removeChild(list.firstChild);
    }
    try {
      if (!searchQuery || matchesSearch("Appearance System Dark Light theme room OS color scheme")) {
        try {
          list.appendChild(makeAppearanceSection());
        } catch (_e) {}
      }
      if (!searchQuery || matchesSearch("Theme preset auto midnight paper nord espresso room")) {
        try {
          list.appendChild(makePresetSection());
        } catch (_e) {}
      }
      const l = L();
      const groups = (l && l.GROUPS) || [];
      for (const g of groups) {
        const rows = (g.rows || []).filter((r) => {
          if (!matchesSearch(`${r.title || ""} ${r.desc || ""} ${r.pref || ""} ${g.name || ""}`)) {
            return false;
          }
          return true;
        });
        if (searchQuery && !rows.length) {
          continue;
        }
        const section = document.createElement("section");
        section.className = "aph-settings-group";
        section.dataset.group = g.name || "";
        const h = document.createElement("h2");
        h.textContent = g.name;
        section.appendChild(h);
        for (const row of rows) {
          try {
            section.appendChild(
              row.kind === "int"
                ? makeIntRow(row)
                : row.kind === "presets"
                  ? makePresetRow(row)
                  : makeBoolRow(row)
            );
          } catch (_e) {}
        }
        list.appendChild(section);
      }
      const adv = document.createElement("section");
      adv.className = "aph-settings-group";
      adv.dataset.group = "Advanced";
      const ah = document.createElement("h2");
      ah.textContent = "Advanced";
      adv.appendChild(ah);
      const note = document.createElement("div");
      note.className = "aph-settings-hint";
      note.textContent = "Workspace names, accents and routes edit inline below; bindings clear here (set them from the palette).";
      adv.appendChild(note);
      list.appendChild(adv);
      for (const s of advancedSections()) {
        // Search filters tables row-wise via text match on the section.
        if (searchQuery) {
          try {
            const txt = s.textContent || "";
            if (!matchesSearch(txt)) {
              continue;
            }
          } catch (_e) {}
        }
        list.appendChild(s);
      }
      // Async theme query stamps the radio state in place (never a
      // second render — see refreshAppearanceRadios).
      refreshAppearanceRadios();
    } catch (e) {}
  }

  function resetFrecency() {
    showModal({
      title: "Reset command frecency?",
      desc: "Clears the palette's learned ranking. Commands return to default order.",
      okLabel: "Reset",
      danger: true,
      onOk: () => {
        try {
          const l = L();
          const p = prefs();
          const key = (l && l.FRECENCY_PREF) || "aph.palette.frecency";
          if (p) {
            try {
              if (typeof p.clearUserPref === "function") {
                p.clearUserPref(key);
                toast("Frecency reset");
                return;
              }
            } catch (e) {}
            try {
              if (typeof p.setStringPref === "function") {
                p.setStringPref(key, "{}");
                toast("Frecency reset");
                return;
              }
              if (typeof p.setCharPref === "function") {
                p.setCharPref(key, "{}");
                toast("Frecency reset");
                return;
              }
            } catch (e) {}
          }
          toast("Reset failed");
        } catch (e) {
          toast("Reset failed");
        }
      },
    });
  }

  // Writes only keys present in the backup (merge, never delete).
  // Returns the number of prefs written.
  function writeBackupPrefs(p) {
    let n = 0;
    try {
      const l = L();
      for (const k of (l && l.BACKUP_BOOL_PREFS) || []) {
        if (p && k in p && writeBool(k, !!p[k])) {
          n++;
        }
      }
      const stalePrefs = [l && l.UNLOAD_STALE_PREF ? l.UNLOAD_STALE_PREF : "aph.unload.staleMin"];
      for (const sp of stalePrefs) {
        if (p && sp in p) {
          const v = writeIntPref(sp, p[sp]);
          if (v !== null && v !== undefined) {
            n++;
          }
        }
      }
      for (const k of (l && l.BACKUP_JSON_PREFS) || []) {
        if (p && k in p && writeString(k, p[k])) {
          n++;
        }
      }
    } catch (e) {}
    return n;
  }

  function exportBackup() {
    try {
      const l = L();
      if (!l || typeof l.buildBackup !== "function") {
        toast("Export failed");
        return;
      }
      const data = l.buildBackup({
        bool: (k) => readBool(k),
        int: (pref, d) => readIntPref(pref || (l && l.UNLOAD_STALE_PREF) || "aph.unload.staleMin"),
        json: (k) => readJsonObject(k),
      });
      const text = JSON.stringify(data, null, 2);
      const blob = new Blob([text], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      let day = "";
      try {
        day = new Date().toISOString().slice(0, 10);
      } catch (e) {}
      const a = document.createElement("a");
      a.href = url;
      a.download = `aph-backup-${day || "settings"}.json`;
      try {
        (document.body || document.documentElement).appendChild(a);
      } catch (e) {}
      try {
        a.click();
      } catch (e) {}
      try {
        a.remove();
      } catch (e) {}
      setTimeout(() => {
        try {
          URL.revokeObjectURL(url);
        } catch (e) {}
      }, 5000);
      toast("Backup exported");
    } catch (e) {
      toast("Export failed");
    }
  }

  function importBackupFile(file) {
    if (!file) {
      return;
    }
    let reader = null;
    try {
      reader = new FileReader();
    } catch (e) {
      toast("Import failed");
      return;
    }
    reader.onload = () => {
      try {
        const l = L();
        const r = l && typeof l.parseBackup === "function" ? l.parseBackup(reader.result) : null;
        if (!r || !r.ok) {
          toast((r && r.error) || "Import failed");
          return;
        }
        const summary = l.summarizeBackup(r.prefs);
        const when = r.exportedAt ? ` from ${r.exportedAt.slice(0, 10)}` : "";
        const commit = () => {
          const n = writeBackupPrefs(r.prefs);
          render();
          toast(n > 0 ? "Backup imported" : "Nothing to import");
        };
        // Modal first; window.confirm fallback lives inside showModal.
        showModal({
          title: `Import Aph backup${when}?`,
          desc: `Replaces: ${summary}. Missing keys are left alone (merge, never delete).`,
          okLabel: "Import",
          danger: false,
          onOk: commit,
        });
      } catch (e) {
        toast("Import failed");
      }
    };
    reader.onerror = () => toast("Import failed");
    try {
      reader.readAsText(file);
    } catch (e) {
      toast("Import failed");
    }
  }

  function initSearch() {
    try {
      const s = $("aph-settings-search");
      if (!s) {
        return;
      }
      s.addEventListener("input", () => {
        try {
          searchQuery = s.value || "";
        } catch (e) {
          searchQuery = "";
        }
        // Targeted: re-render list only, keep focus in the search field.
        render();
        try {
          s.focus();
        } catch (e) {}
      });
      document.addEventListener("keydown", (ev) => {
        try {
          if (ev.key === "/" && document.activeElement !== s &&
              (!document.activeElement || !/INPUT|TEXTAREA/.test(document.activeElement.tagName || ""))) {
            ev.preventDefault();
            s.focus();
          }
        } catch (e) {}
      });
    } catch (e) {}
  }

  function initModal() {
    try {
      const cancel = $("aph-settings-modal-cancel");
      const ok = $("aph-settings-modal-ok");
      const m = $("aph-settings-modal");
      if (cancel) {
        cancel.addEventListener("click", hideModal);
      }
      if (ok) {
        ok.addEventListener("click", () => {
          const fn = modalOk;
          hideModal();
          if (fn) {
            try {
              fn();
            } catch (e) {}
          }
        });
      }
      if (m) {
        m.addEventListener("mousedown", (ev) => {
          try {
            if (ev.target === m) {
              hideModal();
            }
          } catch (e) {}
        });
      }
      document.addEventListener("keydown", (ev) => {
        try {
          if (ev.key === "Escape" && m && !m.hidden) {
            hideModal();
          }
        } catch (e) {}
      });
    } catch (e) {}
  }

  function init() {
    render();
    initSearch();
    initModal();
    try {
      const btn = $("aph-settings-reset-frecency");
      if (btn) {
        btn.addEventListener("click", resetFrecency);
      }
    } catch (e) {}
    try {
      const exp = $("aph-settings-export");
      if (exp) {
        exp.addEventListener("click", exportBackup);
      }
    } catch (e) {}
    try {
      const imp = $("aph-settings-import");
      const picker = $("aph-settings-import-file");
      if (imp && picker) {
        imp.addEventListener("click", () => {
          try {
            picker.click();
          } catch (e) {}
        });
        picker.addEventListener("change", () => {
          try {
            const f = picker.files && picker.files[0];
            // Reset so picking the same file twice still fires change.
            try {
              picker.value = "";
            } catch (_e) {}
            importBackupFile(f);
          } catch (e) {}
        });
      }
    } catch (e) {}
    // Live re-render when another window (or about:config) flips a pref.
    try {
      const p = prefs();
      const l = L();
      if (p && typeof p.addObserver === "function") {
        const watched = [];
        try {
          for (const g of (l && l.GROUPS) || []) {
            for (const r of g.rows || []) {
              if (r && r.pref) {
                watched.push(r.pref);
              }
            }
          }
          watched.push(l ? l.NAMES_PREF : "aph.workspaces.names");
          watched.push(l ? l.BINDINGS_PREF : "aph.workspaces.containerBindings");
          watched.push(l ? l.ROUTES_PREF : "aph.workspaces.domainRoutes");
          watched.push(l && l.ACCENTS_PREF ? l.ACCENTS_PREF : "aph.workspaces.accents");
        } catch (e) {}
        const obs = {
          observe(subj, topic, data) {
            try {
              if (!data || watched.indexOf(data) !== -1) {
                // Targeted update: keep focus where the user is typing
                // across re-renders (search, number, inline editors).
                const ae = document.activeElement;
                let selStart = -1;
                let selEnd = -1;
                try {
                  if (ae && (ae.id === "aph-settings-search" || ae.className === "aph-settings-edit" || ae.className === "aph-settings-number") && typeof ae.selectionStart === "number") {
                    selStart = ae.selectionStart;
                    selEnd = ae.selectionEnd;
                  }
                } catch (_e) {}
                const aeId = ae && ae.id ? ae.id : "";
                const aeLabel = ae && ae.getAttribute ? ae.getAttribute("aria-label") : "";
                render();
                try {
                  let back = null;
                  if (aeId) {
                    back = document.getElementById(aeId);
                  }
                  if (!back && aeLabel) {
                    back = document.querySelector(`[aria-label="${aeLabel}"]`);
                  }
                  if (back && back.focus) {
                    back.focus();
                    if (selStart >= 0 && typeof back.setSelectionRange === "function") {
                      try {
                        back.setSelectionRange(selStart, selEnd);
                      } catch (_e) {}
                    }
                  }
                } catch (_e) {}
              }
            } catch (e) {}
          },
        };
        for (const k of watched) {
          try {
            p.addObserver(k, obs, false);
          } catch (e) {}
        }
      }
    } catch (e) {}
    try {
      document.addEventListener("visibilitychange", () => {
        try {
          if (!document.hidden) {
            render();
          }
        } catch (e) {}
      });
    } catch (e) {}
  }

  if (document.readyState === "complete" || document.readyState === "interactive") {
    init();
  } else {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  }
})();
