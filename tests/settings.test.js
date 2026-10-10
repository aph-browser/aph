// Aph settings page logic (branding/settings-page.js): defaults match the
// seed-once prefs, staleness clamps, and malformed JSON never throws.
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { run, makeFakeNode } = require("./helpers");

const sb = {
  window: {},
  document: {
    readyState: "complete",
    getElementById: () => null,
    addEventListener() {},
  },
  Services: { prefs: {}, obs: {} },
};
run("settings-page.js", sb);
const L = sb.AphSettingsLogic;
assert.ok(L, "AphSettingsLogic global missing");
// deepStrictEqual fails across the node:vm realm boundary (objects built
// inside the sandbox carry the sandbox Object prototype), so compare the
// serialized form instead (same as stash.test.js).
function assertJsonEqual(actual, expected) {
  assert.equal(JSON.stringify(actual), JSON.stringify(expected));
}

describe("bool defaults match user-overrides.js", () => {
  it("has the ten toggles with seed-once defaults", () => {
    assertJsonEqual(L.BOOL_DEFAULTS, {
      "aph.unload.autoEnabled": true,
      "aph.unload.onLowMemory": true,
      "browser.tabs.unloadOnLowMemory": true,
      "aph.stash.autoEnabled": false,
      "aph.stash.snapshots.autoEnabled": true,
      "aph.pins.ctrlWUnloads": true,
      "aph.stars.ctrlWUnloads": true,
      "aph.sidebar.hideFooter": true,
      "identity.fxaccounts.enabled": false,
      "signon.rememberSignons": false,
    });
  });

  it("every toggle is rendered exactly once via GROUPS", () => {
    const rendered = [];
    for (const g of L.GROUPS) {
      for (const r of g.rows || []) {
        if (r.kind === "bool") {
          rendered.push(r.pref);
        }
      }
    }
    assertJsonEqual(rendered.sort(), Object.keys(L.BOOL_DEFAULTS).sort());
  });
});

describe("user.js write-through line surgery", () => {
  it("replaces an existing pref line in place", () => {
    const src =
      '// comment\nuser_pref("identity.fxaccounts.enabled", false);\nuser_pref("a.b", true);\n';
    assert.equal(
      L.patchUserJsLine(src, "identity.fxaccounts.enabled", true),
      '// comment\nuser_pref("identity.fxaccounts.enabled", true);\nuser_pref("a.b", true);\n'
    );
  });

  it("appends a missing pref, with or without trailing newline", () => {
    assert.equal(
      L.patchUserJsLine('user_pref("a.b", true);\n', "c.d", false),
      'user_pref("a.b", true);\nuser_pref("c.d", false);\n'
    );
    assert.equal(
      L.patchUserJsLine('user_pref("a.b", true);', "c.d", true),
      'user_pref("a.b", true);\nuser_pref("c.d", true);\n'
    );
    assert.equal(L.patchUserJsLine("", "c.d", true), 'user_pref("c.d", true);\n');
  });

  it("matches the exact pref, never a prefix sibling", () => {
    const src = 'user_pref("signon.rememberSignons", false);\nuser_pref("signon.rememberSignons.test", true);\n';
    assert.equal(
      L.patchUserJsLine(src, "signon.rememberSignons", true),
      'user_pref("signon.rememberSignons", true);\nuser_pref("signon.rememberSignons.test", true);\n'
    );
  });

  it("writes ints for the staleness row", () => {
    assert.equal(
      L.patchUserJsLine('user_pref("aph.stash.autoStaleMin", 5);\n', "aph.stash.autoStaleMin", 12),
      'user_pref("aph.stash.autoStaleMin", 12);\n'
    );
  });

  it("never throws on garbage input", () => {
    assert.equal(L.patchUserJsLine(null, "a.b", true), 'user_pref("a.b", true);\n');
    assert.equal(L.patchUserJsLine(undefined, "a.b", false), 'user_pref("a.b", false);\n');
  });
});

describe("staleMin clamp", () => {
  it("floors fractions, clamps to 0..1440, falls back to 5", () => {
    assert.equal(L.clampStaleMin(5.9), 5);
    assert.equal(L.clampStaleMin(-3), 0);
    assert.equal(L.clampStaleMin(99999), 1440);
    assert.equal(L.clampStaleMin("nope"), L.STALE_DEFAULT);
    assert.equal(L.clampStaleMin(undefined), L.STALE_DEFAULT);
    assert.equal(L.STALE_DEFAULT, 5);
  });

  it("exposes the separate unload staleness pref (default 30)", () => {
    assert.equal(L.UNLOAD_STALE_PREF, "aph.unload.staleMin");
    assert.equal(L.UNLOAD_STALE_DEFAULT, 30);
  });

  it("clamps the snapshot cadence and safety threshold per pref", () => {
    assert.equal(L.SNAP_INTERVAL_PREF, "aph.stash.snapshots.intervalMin");
    assert.equal(L.SNAP_INTERVAL_DEFAULT, 30);
    assert.equal(L.clampSnapIntervalMin(2), 5);
    assert.equal(L.clampSnapIntervalMin(45.9), 45);
    assert.equal(L.clampSnapIntervalMin(999), 240);
    assert.equal(L.clampSnapIntervalMin("nope"), 30);
    assert.equal(L.SAFETY_PREF, "aph.stash.safetyMin");
    assert.equal(L.SAFETY_DEFAULT, 3);
    assert.equal(L.clampSafetyMin(0), 1);
    assert.equal(L.clampSafetyMin(99), 9);
    assert.equal(L.clampSafetyMin("nope"), 3);
    assert.equal(L.clampIntPref(L.SNAP_INTERVAL_PREF, 2), 5);
    assert.equal(L.clampIntPref(L.SAFETY_PREF, 99), 9);
    assert.equal(L.clampIntPref(L.STALE_PREF, 99999), 1440);
  });

  it("clamps tiered retention prefs per pref", () => {
    assert.equal(L.SNAP_MAX_AUTO_PREF, "aph.stash.snapshots.maxAuto");
    assert.equal(L.SNAP_MAX_AUTO_DEFAULT, 10);
    assert.equal(L.clampMaxAuto(0), 1);
    assert.equal(L.clampMaxAuto(10.9), 10);
    assert.equal(L.clampMaxAuto(999), 50);
    assert.equal(L.clampMaxAuto("nope"), 10);
    assert.equal(L.SNAP_DAILIES_PREF, "aph.stash.snapshots.keepDailies");
    assert.equal(L.SNAP_DAILIES_DEFAULT, 7);
    assert.equal(L.clampKeepDailies(-1), 0);
    assert.equal(L.clampKeepDailies(7.9), 7);
    assert.equal(L.clampKeepDailies(999), 30);
    assert.equal(L.clampKeepDailies("nope"), 7);
    assert.equal(L.clampIntPref(L.SNAP_MAX_AUTO_PREF, 0), 1);
    assert.equal(L.clampIntPref(L.SNAP_DAILIES_PREF, 999), 30);
  });
});

describe("JSON guards", () => {
  it("parses objects, rejects arrays/primals/garbage", () => {
    assertJsonEqual(L.parseJsonObject('{"2":"Work"}'), { 2: "Work" });
    assertJsonEqual(L.parseJsonObject(""), {});
    assertJsonEqual(L.parseJsonObject("["), {});
    assertJsonEqual(L.parseJsonObject("[1,2]"), {});
    assertJsonEqual(L.parseJsonObject("42"), {});
    assertJsonEqual(L.parseJsonObject(null), {});
  });

  it("exposes every read-only pref key", () => {
    assert.equal(L.NAMES_PREF, "aph.workspaces.names");
    assert.equal(L.BINDINGS_PREF, "aph.workspaces.containerBindings");
    assert.equal(L.ROUTES_PREF, "aph.workspaces.domainRoutes");
    assert.equal(L.ACCENTS_PREF, "aph.workspaces.accents");
    assert.equal(L.STASH_PREF, "aph.stash.tabs");
    assert.equal(L.SNAPSHOTS_PREF, "aph.stash.snapshots");
    assert.equal(L.FRECENCY_PREF, "aph.palette.frecency");
  });
});

describe("backup round-trip", () => {
  const reader = {
    bool: (k, d) => {
      const fixed = {
        "aph.unload.autoEnabled": true,
        "aph.unload.onLowMemory": false,
        "browser.tabs.unloadOnLowMemory": false,
        "aph.stash.autoEnabled": false,
        "aph.pins.ctrlWUnloads": true,
        "aph.stars.ctrlWUnloads": false,
        "aph.sidebar.hideFooter": true,
        "identity.fxaccounts.enabled": true,
        "signon.rememberSignons": false,
      };
      return k in fixed ? fixed[k] : d;
    },
    int: (pref) => (pref === L.UNLOAD_STALE_PREF ? 30 : 12),
    json: (k) => {
      if (k === L.STASH_PREF) {
        return [{ id: "a", url: "https://a.example/", title: "A" }];
      }
      if (k === L.SNAPSHOTS_PREF) {
        return [{ id: "s1", name: "S", ws: "2", tabs: [{ url: "https://s.example/" }] }];
      }
      return { "2": "Work" };
    },
  };

  it("builds a versioned backup covering every pref", () => {
    const b = L.buildBackup(reader);
    assert.equal(b.aphBackup, 1);
    assert.equal(typeof b.exportedAt, "string");
    assert.equal(b.prefs["aph.unload.autoEnabled"], true);
    assert.equal(b.prefs["aph.unload.onLowMemory"], false);
    assert.equal(b.prefs["browser.tabs.unloadOnLowMemory"], false);
    assert.equal(b.prefs["aph.stars.ctrlWUnloads"], false);
    assert.equal(b.prefs["aph.stash.autoStaleMin"], 12);
    assert.equal(b.prefs[L.UNLOAD_STALE_PREF], 30);
    assert.equal(b.prefs[L.SNAP_INTERVAL_PREF], 12);
    assert.equal(b.prefs[L.SAFETY_PREF], 9);
    assert.equal(b.prefs[L.SNAP_MAX_AUTO_PREF], 12);
    assert.equal(b.prefs[L.SNAP_DAILIES_PREF], 12);
    assertJsonEqual(b.prefs[L.STASH_PREF], [
      { id: "a", url: "https://a.example/", title: "A" },
    ]);
    assertJsonEqual(b.prefs[L.NAMES_PREF], { 2: "Work" });
  });

  it("survives a stringify/parse round-trip", () => {
    const r = L.parseBackup(JSON.stringify(L.buildBackup(reader)));
    assert.equal(r.ok, true);
    assertJsonEqual(r.prefs, L.buildBackup(reader).prefs);
  });

  it("rejects garbage, wrong versions and mistyped keys", () => {
    assert.equal(L.parseBackup("nope").ok, false);
    assert.equal(L.parseBackup("[1,2]").ok, false);
    assert.equal(L.parseBackup('{"a":1}').ok, false);
    assert.equal(
      L.parseBackup('{"aphBackup":2,"prefs":{}}').ok,
      false
    );
    assert.equal(
      L.parseBackup('{"aphBackup":1,"prefs":{"aph.pins.ctrlWUnloads":"yes"}}').ok,
      false
    );
    assert.equal(
      L.parseBackup('{"aphBackup":1,"prefs":{"aph.stash.autoStaleMin":"soon"}}').ok,
      false
    );
    assert.equal(
      L.parseBackup('{"aphBackup":1,"prefs":{"aph.unload.staleMin":"soon"}}').ok,
      false
    );
    assert.equal(
      L.parseBackup('{"aphBackup":1,"prefs":{"aph.workspaces.names":[]}}').ok,
      false
    );
    assert.equal(
      L.parseBackup('{"aphBackup":1,"prefs":{"aph.stash.tabs":{}}}').ok,
      false
    );
    assert.equal(
      L.parseBackup('{"aphBackup":1,"prefs":{"aph.stash.snapshots.maxAuto":"many"}}').ok,
      false
    );
    assert.equal(
      L.parseBackup('{"aphBackup":1,"prefs":{"aph.stash.snapshots.keepDailies":"many"}}').ok,
      false
    );
  });

  it("ignores unknown keys and tolerates missing ones", () => {
    const r = L.parseBackup(
      '{"aphBackup":1,"prefs":{"aph.pins.ctrlWUnloads":false,"future.pref":42}}'
    );
    assert.equal(r.ok, true);
    assertJsonEqual(r.prefs, { "aph.pins.ctrlWUnloads": false });
  });

  it("drops junk stash entries instead of rejecting the file", () => {
    const r = L.parseBackup(
      '{"aphBackup":1,"prefs":{"aph.stash.tabs":[' +
        '{"id":"a","url":"https://a.example/"},' +
        '{"id":"b"},null,"junk"]}}'
    );
    assert.equal(r.ok, true);
    assertJsonEqual(r.prefs[L.STASH_PREF], [{ id: "a", url: "https://a.example/" }]);
  });

  it("summarizes imports for the confirm dialog", () => {
    const s = L.summarizeBackup({
      "aph.workspaces.names": { 1: "A", 2: "B" },
      "aph.workspaces.containerBindings": {},
      "aph.workspaces.domainRoutes": { "github.com": "2" },
      "aph.stash.tabs": [{}, {}],
      "aph.pins.ctrlWUnloads": true,
      "aph.stash.autoStaleMin": 5,
      "aph.unload.staleMin": 30,
      "aph.stash.snapshots.intervalMin": 30,
      "aph.stash.safetyMin": 3,
      "aph.stash.snapshots.maxAuto": 10,
      "aph.stash.snapshots.keepDailies": 7,
    });
    assert.ok(s.includes("2 workspace names"), s);
    assert.ok(s.includes("1 route"), s);
    assert.ok(s.includes("2 stashed tabs"), s);
    assert.ok(s.includes("7 settings"), s);
    assert.equal(L.summarizeBackup({}), "no Aph prefs");
  });
});

describe("appearance maps to Firefox built-in themes", () => {
  it("offers system, dark, light in order", () => {
    assertJsonEqual(L.APPEARANCE_OPTIONS, ["system", "dark", "light"]);
  });

  it("resolves each selection to a stable built-in theme id", () => {
    assert.equal(L.themeIdForAppearance("system"), "default-theme@mozilla.org");
    assert.equal(L.themeIdForAppearance("dark"), "firefox-compact-dark@mozilla.org");
    assert.equal(L.themeIdForAppearance("light"), "firefox-compact-light@mozilla.org");
  });

  it("falls back to the system theme for junk input", () => {
    assert.equal(L.themeIdForAppearance(""), "default-theme@mozilla.org");
    assert.equal(L.themeIdForAppearance("alpenglow"), "default-theme@mozilla.org");
    assert.equal(L.themeIdForAppearance(null), "default-theme@mozilla.org");
  });

  it("reads the active theme back, bucketing strangers to system", () => {
    assert.equal(L.appearanceForThemeId("default-theme@mozilla.org"), "system");
    assert.equal(L.appearanceForThemeId("firefox-compact-dark@mozilla.org"), "dark");
    assert.equal(L.appearanceForThemeId("firefox-compact-light@mozilla.org"), "light");
    assert.equal(L.appearanceForThemeId("firefox-alpenglow@mozilla.org"), "system");
    assert.equal(L.appearanceForThemeId("some-third-party-theme@x"), "system");
    assert.equal(L.appearanceForThemeId(""), "system");
  });

  it("round-trips all three rooms", () => {
    for (const sel of L.APPEARANCE_OPTIONS) {
      assert.equal(L.appearanceForThemeId(L.themeIdForAppearance(sel)), sel);
    }
  });
});

describe("appearance bridge degrades without a theme manager", () => {
  function makeDomEnv(extraWindow) {
    const list = makeFakeNode("main");
    const opened = [];
    const findInputs = (root) => {
      const out = [];
      (function walk(n) {
        if (!n) return;
        if (n.localName === "input") out.push(n);
        for (const c of n.children || []) walk(c);
      })(root);
      return out;
    };
    const doc = {
      readyState: "complete",
      activeElement: null,
      hidden: false,
      createElement: (t) => makeFakeNode(t),
      createTextNode: () => makeFakeNode("#text"),
      getElementById: (id) => (id === "aph-settings-list" ? list : null),
      querySelectorAll: (sel) => (
        String(sel || "").includes('name="aph-appearance"')
          ? findInputs(list).filter((i) => i.name === "aph-appearance")
          : []
      ),
      querySelector: () => null,
      addEventListener(t, fn) {
        (this._handlers[t] = this._handlers[t] || []).push(fn);
      },
      fire(t, ev) {
        for (const fn of this._handlers[t] || []) fn(ev || {});
      },
      body: makeFakeNode("body"),
      documentElement: makeFakeNode("html"),
    };
    doc._handlers = {};
    const sb2 = {
      window: Object.assign(
        { open: (url) => { opened.push(url); } },
        extraWindow || {}
      ),
      document: doc,
      Services: {
        prefs: {
          getBoolPref: (k, d) => (typeof d === "boolean" ? d : false),
          getIntPref: (k, d) => (typeof d === "number" ? d : 0),
          getStringPref: () => "",
        },
      },
    };
    sb2.window.window = sb2.window;
    run("settings-page.js", sb2);
    // A real page exposes top-level vars on window; node:vm puts them
    // on the sandbox global instead — mirror the browser, then
    // re-render (visibility path) so refresh sees AphSettingsLogic.
    sb2.window.AphSettingsLogic = sb2.AphSettingsLogic;
    doc.fire("visibilitychange", {});
    return { sb: sb2, list, opened, doc };
  }

  function collectInputs(root) {
    const out = [];
    (function walk(n) {
      if (!n) return;
      if (n.localName === "input") out.push(n);
      for (const c of n.children || []) walk(c);
    })(root);
    return out;
  }

  const tick = () => new Promise((r) => setImmediate(r));

  it("renders the radio trio with nothing checked and no throw", async () => {
    const env = makeDomEnv();
    await tick();
    const section = env.list.children.find(
      (c) => c.dataset && c.dataset.group === "Appearance"
    );
    assert.ok(section, "Appearance section rendered first");
    assert.equal(env.list.children[0], section, "Appearance leads the page");
    const radios = collectInputs(section).filter((i) => i.name === "aph-appearance");
    assert.deepEqual(
      radios.map((r) => r.value),
      ["system", "dark", "light"]
    );
    assert.ok(radios.every((r) => !r.checked), "unverifiable room claims nothing");
  });

  it("falls back to about:addons when no manager is reachable", async () => {
    const env = makeDomEnv();
    await tick();
    const radios = collectInputs(env.list).filter((i) => i.name === "aph-appearance");
    const dark = radios.find((r) => r.value === "dark");
    dark.checked = true;
    dark.fire("change", {});
    await tick();
    assert.deepEqual(env.opened, ["about:addons"]);
  });

  it("reads and writes through a real manager when present", async () => {
    const enabled = [];
    const seen = [];
    const env = makeDomEnv({
      AddonManager: {
        getAddonsByTypes: async () => {
          seen.push("list");
          return [{ id: "firefox-compact-dark@mozilla.org", isActive: true }];
        },
        getAddonByID: async (id) => {
          seen.push(id);
          return { enable: async () => { enabled.push(id); } };
        },
      },
    });
    await tick();
    await tick();
    const radios = collectInputs(env.list).filter((i) => i.name === "aph-appearance");
    const dark = radios.find((r) => r.value === "dark");
    assert.equal(dark.checked, true, "active theme stamps the radio");
    const light = radios.find((r) => r.value === "light");
    light.checked = true;
    light.fire("change", {});
    await tick();
    assert.ok(seen.includes("firefox-compact-light@mozilla.org"), "write targets the light theme");
    assert.ok(enabled.includes("firefox-compact-light@mozilla.org"), "theme enabled");
    assert.deepEqual(env.opened, [], "no fallback tab on the manager path");
  });
});

describe("theme presets pair rooms with schemes", () => {
  it("offers auto plus four frozen rooms in order", () => {
    assertJsonEqual(L.THEME_PRESET_OPTIONS, ["auto", "midnight", "paper", "nord", "mocha", "espresso"]);
  });

  it("pairs paper with light, every other pin with dark, auto with system", () => {
    assertJsonEqual(L.THEME_PRESET_SCHEME, {
      auto: "system",
      midnight: "dark",
      paper: "light",
      nord: "dark",
      mocha: "dark",
      espresso: "dark",
    });
  });

  it("names the preset pref", () => {
    assert.equal(L.THEME_PRESET_PREF, "aph.theme.preset");
  });
});

describe("theme preset radios persist through re-render", () => {
  function makePresetEnv(seed) {
    const store = Object.assign({}, seed || {});
    const writes = [];
    const list = makeFakeNode("main");
    const doc = {
      readyState: "complete",
      activeElement: null,
      hidden: false,
      createElement: (t) => makeFakeNode(t),
      createTextNode: () => makeFakeNode("#text"),
      getElementById: (id) => (id === "aph-settings-list" ? list : null),
      querySelectorAll: () => [],
      querySelector: () => null,
      addEventListener(t, fn) {
        (this._handlers[t] = this._handlers[t] || []).push(fn);
      },
      fire(t, ev) {
        for (const fn of this._handlers[t] || []) fn(ev || {});
      },
      body: makeFakeNode("body"),
      documentElement: makeFakeNode("html"),
    };
    doc._handlers = {};
    const sb2 = {
      window: { open: () => {} },
      document: doc,
      Services: { prefs: {
        getBoolPref: (k, d) => (typeof d === "boolean" ? d : false),
        getIntPref: (k, d) => (typeof d === "number" ? d : 0),
        getStringPref: (k, d) => (k in store ? store[k] : d),
        setStringPref: (k, v) => { writes.push([k, v]); store[k] = String(v); },
        addObserver() {},
        removeObserver() {},
      } },
    };
    sb2.window.window = sb2.window;
    run("settings-page.js", sb2);
    sb2.window.AphSettingsLogic = sb2.AphSettingsLogic;
    doc.fire("visibilitychange", {});
    const collect = (root) => {
      const out = [];
      (function walk(n) {
        if (!n) return;
        if (n.localName === "input") out.push(n);
        for (const c of n.children || []) walk(c);
      })(root);
      return out;
    };
    return {
      sb: sb2, list, store, writes, doc,
      radios: () => collect(list).filter((i) => i.name === "aph-preset"),
    };
  }

  it("renders five preset radios with auto checked by default", () => {
    const env = makePresetEnv();
    assert.deepEqual(
      env.radios().map((r) => r.value),
      ["auto", "midnight", "paper", "nord", "mocha", "espresso"]
    );
    assert.ok(env.radios().find((r) => r.value === "auto").checked);
  });

  it("clicking a preset writes the pref (no silent no-op)", () => {
    const env = makePresetEnv();
    const nord = env.radios().find((r) => r.value === "nord");
    nord.checked = true;
    nord.fire("change", {});
    assert.deepEqual(env.writes, [["aph.theme.preset", "nord"]]);
    assert.equal(env.store["aph.theme.preset"], "nord");
  });

  it("a re-render keeps the pick instead of resetting to auto", () => {
    const env = makePresetEnv();
    const get = (v) => env.radios().find((r) => r.value === v);
    // The reported bug: the click wrote nothing, so the tab-switch
    // re-render (visibility path, rebuilt from the pref) snapped back.
    get("nord").checked = true;
    get("nord").fire("change", {});
    assert.equal(env.store["aph.theme.preset"], "nord");
    env.doc.fire("visibilitychange", {});
    assert.ok(
      env.radios().find((r) => r.value === "nord").checked,
      "rebuilt radios still honor the stored pref"
    );
  });
});

describe("appearance bridge resolves a sync ESM namespace", () => {
  // Regression: ChromeUtils.importESModule returns the namespace
  // SYNCHRONOUSLY (never a promise). Calling .then on it threw, theme
  // pairing silently died, and every pick fell back to about:addons.
  function makeSyncManagerEnv() {
    const list = makeFakeNode("main");
    const opened = [];
    const enabled = [];
    const fakeManager = {
      getAddonByID: (id) => Promise.resolve({
        enable: () => { enabled.push(id); return Promise.resolve(); },
      }),
      getAddonsByTypes: () => Promise.resolve([]),
    };
    const doc = {
      readyState: "complete",
      activeElement: null,
      hidden: false,
      createElement: (t) => makeFakeNode(t),
      createTextNode: () => makeFakeNode("#text"),
      getElementById: (id) => (id === "aph-settings-list" ? list : null),
      querySelectorAll: () => [],
      querySelector: () => null,
      addEventListener(t, fn) {
        (this._handlers[t] = this._handlers[t] || []).push(fn);
      },
      fire(t, ev) {
        for (const fn of this._handlers[t] || []) fn(ev || {});
      },
      body: makeFakeNode("body"),
      documentElement: makeFakeNode("html"),
    };
    doc._handlers = {};
    const sb2 = {
      window: { open: (url) => { opened.push(url); } },
      document: doc,
      ChromeUtils: { importESModule: () => ({ AddonManager: fakeManager }) },
      Services: { prefs: {
        getBoolPref: (k, d) => (typeof d === "boolean" ? d : false),
        getIntPref: (k, d) => (typeof d === "number" ? d : 0),
        getStringPref: (k, d) => (k in {} ? "" : d),
        setStringPref() {},
        addObserver() {},
        removeObserver() {},
      } },
    };
    sb2.window.window = sb2.window;
    run("settings-page.js", sb2);
    sb2.window.AphSettingsLogic = sb2.AphSettingsLogic;
    doc.fire("visibilitychange", {});
    const collect = (root) => {
      const out = [];
      (function walk(n) {
        if (!n) return;
        if (n.localName === "input") out.push(n);
        for (const c of n.children || []) walk(c);
      })(root);
      return out;
    };
    return { sb: sb2, list, opened, enabled, collect };
  }

  it("clicking Dark enables compact-dark instead of opening about:addons", async () => {
    const env = makeSyncManagerEnv();
    const dark = env.collect(env.list).filter((i) => i.name === "aph-appearance")
      .find((r) => r.value === "dark");
    assert.ok(dark, "appearance radios rendered");
    dark.checked = true;
    dark.fire("change", {});
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    assert.deepEqual(env.enabled, ["firefox-compact-dark@mozilla.org"]);
    assert.deepEqual(env.opened, []);
  });

  it("picking Paper pairs the light theme (preset scheme path)", async () => {
    const env = makeSyncManagerEnv();
    const paper = env.collect(env.list).filter((i) => i.name === "aph-preset")
      .find((r) => r.value === "paper");
    assert.ok(paper, "preset radios rendered");
    paper.checked = true;
    paper.fire("change", {});
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    assert.deepEqual(env.enabled, ["firefox-compact-light@mozilla.org"]);
    assert.deepEqual(env.opened, []);
  });
});
