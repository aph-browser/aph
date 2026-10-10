// Theme presets (branding/src/workspaces/74-theme-preset.js): the pref
// is the cross-window truth, the root attribute is the per-window stamp.
// The real bundle runs in node:vm with Firefox globals mocked (same
// shape as tests/focus.test.js, with an observer-firing prefs mock).
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { run, makeTab, makeFakeNode: fakeNode } = require("./helpers");

const tabVals = new WeakMap();

function makeEnv(initialPreset) {
  const home = makeTab(tabVals, {
    label: "home", ws: "1", selected: true, spec: "https://start.example.com/",
  });
  const prefStore = {};
  if (initialPreset !== undefined) {
    prefStore["aph.theme.preset"] = initialPreset;
  }
  const prefObservers = {};
  const rootAttrs = {};
  const winHandlers = {};
  const tabContainer = fakeNode("tabs");
  tabContainer.setAttribute = () => {};
  tabContainer.getAttribute = () => null;
  tabContainer.removeAttribute = () => {};
  tabContainer._invalidateCachedVisibleTabs = () => {};
  tabContainer._updateCloseButtons = () => {};
  const sb = {
    window: {
      addEventListener(type, fn) { (winHandlers[type] = winHandlers[type] || []).push(fn); },
      removeEventListener() {},
      opener: null,
    },
    navigator: { onLine: true },
    document: {
      readyState: "complete",
      getElementById: () => null,
      createElement: (tag) => fakeNode(tag),
      createEvent: () => ({ initEvent() {} }),
      documentElement: {
        setAttribute(k, v) { rootAttrs[k] = String(v); },
        getAttribute(k) { return k in rootAttrs ? rootAttrs[k] : null; },
        removeAttribute(k) { delete rootAttrs[k]; },
        hasAttribute(k) { return k in rootAttrs; },
      },
    },
    gBrowser: {
      tabs: [home],
      tabGroups: [],
      get selectedTab() { return home; },
      set selectedTab(_t) {},
      get selectedBrowser() { return { focus() {} }; },
      showTab(t) { t.removeAttribute("hidden"); },
      addTrustedTab(url) {
        const t = makeTab(tabVals, { label: "new", ws: "1", spec: url });
        sb.gBrowser.tabs.push(t);
        return t;
      },
      removeTab(t) {
        const i = sb.gBrowser.tabs.indexOf(t);
        if (i !== -1) sb.gBrowser.tabs.splice(i, 1);
      },
      discardBrowser() {},
      ungroupTab() {},
      replaceInSuccession() {},
      setSuccessor() {},
      _updateMultiselectedTabCloseButtonTooltip() {},
      getTabForBrowser: (b) => (b && b.__tab) || null,
      addTabsProgressListener() {},
      removeTabsProgressListener() {},
      tabContainer,
    },
    SessionStore: {
      getCustomTabValue: (t, k) => (tabVals.get(t) || {})[k],
      setCustomTabValue: (t, k, v) => {
        const o = tabVals.get(t) || {};
        o[k] = v;
        tabVals.set(t, o);
      },
      deleteCustomTabValue: () => {},
      isTabRestoring: () => false,
      getCustomWindowValue: () => undefined,
      setCustomWindowValue: () => {},
    },
    Services: {
      prefs: {
        getStringPref: (k, d) => (k in prefStore ? prefStore[k] : d),
        setStringPref(k, v) {
          prefStore[k] = String(v);
          for (const o of prefObservers[k] || []) {
            try {
              o.observe(null, "", k);
            } catch (e) {}
          }
        },
        getBoolPref: (k, d) => { if (d !== undefined) return !!d; throw new Error("no pref"); },
        setBoolPref() {},
        getIntPref: (k, d) => { if (d !== undefined) return d; throw new Error("no pref"); },
        addObserver(k, o) { (prefObservers[k] = prefObservers[k] || []).push(o); },
        removeObserver(k, o) {
          prefObservers[k] = (prefObservers[k] || []).filter((x) => x !== o);
        },
      },
      console: { logStringMessage() {} },
      wm: {
        getMostRecentWindow: () => null,
        getEnumerator: () => ({ hasMoreElements: () => false }),
      },
      obs: { addObserver() {}, removeObserver() {} },
    },
    ChromeUtils: {
      generateQI: () => () => {},
      importESModule: () => ({ ContextualIdentityService: null }),
    },
    Ci: {
      nsIWebProgressListener: { LOCATION_CHANGE_SAME_DOCUMENT: 2 },
      nsIWebProgress: { NOTIFY_LOCATION: 1 },
    },
  };
  sb.window.window = sb.window;
  run("workspaces.js", sb);
  const api = sb.window.AphThemePreset;
  assert.ok(api && typeof api.setThemePreset === "function", "preset API exposed");
  return {
    api, prefStore, rootAttrs,
    attr: () => ("data-aph-preset" in rootAttrs ? rootAttrs["data-aph-preset"] : null),
    setPrefDirect: (v) => sb.Services.prefs.setStringPref("aph.theme.preset", v),
    fireUnload: () => {
      for (const fn of winHandlers.unload || []) fn({});
    },
  };
}

describe("theme presets", () => {
  it("auto (and missing pref) stamps nothing", () => {
    assert.equal(makeEnv().attr(), null);
    assert.equal(makeEnv("auto").attr(), null);
  });

  it("unknown values read as auto", () => {
    assert.equal(makeEnv("neon").attr(), null);
    assert.equal(makeEnv("").attr(), null);
  });

  it("every pinned preset stamps at birth", () => {
    for (const preset of ["midnight", "paper", "nord", "mocha", "espresso"]) {
      assert.equal(makeEnv(preset).attr(), preset, `${preset} must stamp`);
    }
  });

  it("set writes the pref and the observer restamps live", () => {
    const env = makeEnv();
    assert.equal(env.api.setThemePreset("paper"), true);
    assert.equal(env.prefStore["aph.theme.preset"], "paper");
    assert.equal(env.attr(), "paper");
    assert.equal(env.api.getThemePreset(), "paper");
  });

  it("set back to auto clears the stamp", () => {
    const env = makeEnv("nord");
    assert.equal(env.attr(), "nord");
    assert.equal(env.api.setThemePreset("auto"), true);
    assert.equal(env.attr(), null);
  });

  it("rejects junk without touching the pref", () => {
    const env = makeEnv();
    assert.equal(env.api.setThemePreset("neon"), false);
    assert.ok(!("aph.theme.preset" in env.prefStore));
    assert.equal(env.attr(), null);
  });

  it("direct pref writes restamp (cross-window path)", () => {
    const env = makeEnv();
    env.setPrefDirect("espresso");
    assert.equal(env.attr(), "espresso");
    env.setPrefDirect("system");
    assert.equal(env.attr(), null, "unknown restamps to auto");
  });

  it("unload removes the stamp and the observer", () => {
    const env = makeEnv("nord");
    assert.equal(env.attr(), "nord");
    env.fireUnload();
    assert.equal(env.attr(), null, "no stamp lingers past the window");
    env.setPrefDirect("paper");
    assert.equal(env.attr(), null, "dead observer never restamps");
  });
});
