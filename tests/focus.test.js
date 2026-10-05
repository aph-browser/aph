// Focus mode (branding/src/workspaces/72-focus.js): per-window,
// session-only hiding of every chrome surface (Ctrl+Alt+F + palette).
// The real bundle runs in node:vm with Firefox globals mocked (same
// shape as tests/win-keyboard.test.js).
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { run, makeTab } = require("./helpers");

const tabVals = new WeakMap();

function makeEnv() {
  const home = makeTab(tabVals, {
    label: "home", ws: "1", selected: true, spec: "https://start.example.com/",
  });
  let wsel = home;
  const keyHandlers = [];
  const rootAttrs = {};
  let browserFocused = false;
  const sb = {
    window: {
      addEventListener(type, fn) { if (type === "keydown") keyHandlers.push(fn); },
      opener: null,
    },
    navigator: { onLine: true },
    document: {
      readyState: "complete",
      getElementById: () => null,
      createElement: () => ({ setAttribute() {}, removeAttribute() {}, style: {} }),
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
      get selectedTab() { return wsel; },
      set selectedTab(t) {
        if (wsel) wsel.selected = false;
        wsel = t;
        if (t) t.selected = true;
      },
      get selectedBrowser() {
        return { focus() { browserFocused = true; } };
      },
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
      tabContainer: {
        setAttribute() {},
        getAttribute() { return null; },
        removeAttribute() {},
        addEventListener() {},
        removeEventListener() {},
        _invalidateCachedVisibleTabs() {},
        _updateCloseButtons() {},
      },
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
        getStringPref: (k, d) => d,
        setStringPref() {},
        getBoolPref: (k, d) => { if (d !== undefined) return !!d; throw new Error("no pref"); },
        setBoolPref() {},
        getIntPref: (k, d) => { if (d !== undefined) return d; throw new Error("no pref"); },
        addObserver() {},
        removeObserver() {},
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
  assert.equal(keyHandlers.length, 1, "expected one window keydown handler");
  const api = sb.window.AphWorkspaces;
  assert.ok(api && typeof api.toggleFocusMode === "function", "focus API exposed");
  function fireKey(o) {
    const e = {
      code: o.code,
      key: o.key || "",
      ctrlKey: !!o.ctrlKey,
      altKey: !!o.altKey,
      shiftKey: !!o.shiftKey,
      metaKey: !!o.metaKey,
      repeat: false,
      target: { id: "", closest: () => null, tagName: "DIV", isContentEditable: false },
      _pd: false,
      _ps: false,
      preventDefault() { e._pd = true; },
      stopPropagation() { e._ps = true; },
    };
    if (!o.noGMS) {
      const altGraph = !!o.altGraph;
      e.getModifierState = (m) => (m === "AltGraph" ? altGraph : false);
    }
    keyHandlers[0](e);
    return e;
  }
  return {
    api, fireKey, rootAttrs,
    wasBrowserFocused: () => browserFocused,
    home,
  };
}

describe("focus mode", () => {
  it("toggle flips state and stamps the root attribute", () => {
    const env = makeEnv();
    assert.equal(env.api.getFocusMode(), false);
    assert.equal(env.api.toggleFocusMode(), true);
    assert.equal(env.rootAttrs["data-aph-focus"], "1");
    assert.equal(env.api.getFocusMode(), true);
    assert.equal(env.api.toggleFocusMode(), false);
    assert.ok(!("data-aph-focus" in env.rootAttrs));
  });

  it("set is idempotent and focuses the page on enter", () => {
    const env = makeEnv();
    assert.equal(env.api.setFocusMode(true), true);
    assert.equal(env.api.setFocusMode(true), true);
    assert.ok(env.wasBrowserFocused(), "page claims focus when chrome hides");
    assert.equal(env.api.setFocusMode(false), false);
  });

  it("state is per-window: a second window starts off", () => {
    const env1 = makeEnv();
    env1.api.setFocusMode(true);
    const env2 = makeEnv();
    assert.equal(env2.api.getFocusMode(), false, "no global bleed into the new window");
    assert.equal(env1.api.getFocusMode(), true, "first window keeps its mode");
  });

  it("Ctrl+Alt+F toggles via the window key handler", () => {
    const env = makeEnv();
    const e1 = env.fireKey({ code: "KeyF", ctrlKey: true, altKey: true });
    assert.equal(e1._pd, true, "hotkey is claimed");
    assert.equal(e1._ps, true);
    assert.equal(env.api.getFocusMode(), true);
    const e2 = env.fireKey({ code: "KeyF", ctrlKey: true, altKey: true });
    assert.equal(env.api.getFocusMode(), false);
    assert.equal(e2._pd, true);
  });

  it("AltGr+F passes through (no focus toggle while typing)", () => {
    const env = makeEnv();
    const e = env.fireKey({ code: "KeyF", ctrlKey: true, altKey: true, altGraph: true });
    assert.equal(e._pd, false, "must not claim AltGr composition");
    assert.equal(env.api.getFocusMode(), false);
  });

  it("Ctrl+Alt+Shift+F falls through to stock", () => {
    const env = makeEnv();
    const e = env.fireKey({ code: "KeyF", ctrlKey: true, altKey: true, shiftKey: true });
    assert.equal(e._pd, false, "shifted chord is unbound");
    assert.equal(env.api.getFocusMode(), false);
  });
});
