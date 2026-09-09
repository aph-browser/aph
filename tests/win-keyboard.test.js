// Windows AltGr regression guards (branding/workspaces.js).
// On international Windows keyboards AltGr arrives as Ctrl+Alt, so without
// the AltGraph early-return, typing e.g. AltGr+8 ("[" on German layouts)
// would send the tab to workspace 8, and AltGr+T would open a temp tab.
// Genuine Ctrl+Alt hotkeys (AltGraph=false, or no getModifierState at all)
// must keep working.
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { run, makeTab } = require("./helpers");

const tabVals = new WeakMap();
const prefStore = {
  "aph.workspaces.domainRoutes": JSON.stringify({}),
  "aph.workspaces.containerBindings": JSON.stringify({ "1": 7 }),
};
const created = [];

const home = makeTab(tabVals, {
  label: "home", ws: "1", selected: true, spec: "https://start.example.com/",
});
let wsel = home;
const keyHandlers = [];

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
    showTab(t) { t.removeAttribute("hidden"); },
    addTrustedTab(url, opts) {
      const t = makeTab(tabVals, {
        label: "new", ws: "1", spec: url, cid: (opts && opts.userContextId) || 0,
      });
      created.push(t);
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
    tabContainer: {
      setAttribute() {},
      removeAttribute() {},
      addEventListener() {},
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
    getCustomWindowValue: () => undefined,
    setCustomWindowValue: () => {},
  },
  Services: {
    prefs: {
      getStringPref: (k, d) => (k in prefStore ? prefStore[k] : d),
      setStringPref: (k, v) => { prefStore[k] = v; },
      addObserver() {},
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
    importESModule: () => ({
      ContextualIdentityService: {
        getPublicIdentityFromId: (id) =>
          id === 7 ? { name: "Work", color: "blue", icon: "briefcase" } : null,
        create: () => ({ userContextId: 99 }),
        remove: () => {},
      },
    }),
  },
  Ci: {
    nsIWebProgressListener: { LOCATION_CHANGE_SAME_DOCUMENT: 2 },
    nsIWebProgress: { NOTIFY_LOCATION: 1 },
  },
};
sb.window.window = sb.window;
run("workspaces.js", sb);
assert.equal(keyHandlers.length, 1, "expected one window keydown handler");
const onKey = keyHandlers[0];

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
    preventDefault() { this._pd = true; },
    stopPropagation() { this._ps = true; },
  };
  if (!o.noGMS) {
    const altGraph = !!o.altGraph;
    e.getModifierState = (m) => (m === "AltGraph" ? altGraph : false);
  }
  onKey(e);
  return e;
}

describe("AltGr (Windows international keyboards)", () => {
  it("AltGr+8 passes through (no send-to-workspace)", () => {
    const wsBefore = tabVals.get(home).aphWs;
    const e = fireKey({ code: "Digit8", ctrlKey: true, altKey: true, altGraph: true });
    assert.equal(e._pd, false, "must not preventDefault AltGr character composition");
    assert.equal(e._ps, false);
    assert.equal(tabVals.get(home).aphWs, wsBefore, "tab must keep its workspace");
    assert.equal(created.length, 0, "no tab may be created");
  });

  it("genuine Ctrl+Alt+8 still sends the tab to workspace 8", () => {
    const e = fireKey({ code: "Digit8", ctrlKey: true, altKey: true, altGraph: false });
    assert.equal(e._pd, true, "real Ctrl+Alt hotkey must still be claimed");
    assert.equal(tabVals.get(home).aphWs, "8");
  });

  it("AltGr+T passes through (no temp tab)", () => {
    const n = created.length;
    const e = fireKey({ code: "KeyT", ctrlKey: true, altKey: true, altGraph: true });
    assert.equal(e._pd, false);
    assert.equal(e._ps, false);
    assert.equal(created.length, n, "no temp tab may be created");
  });

  it("genuine Ctrl+Alt+T still opens a temp tab", () => {
    const n = created.length;
    const e = fireKey({ code: "KeyT", ctrlKey: true, altKey: true, altGraph: false });
    assert.equal(e._pd, true);
    assert.equal(created.length, n + 1);
    assert.equal(created[created.length - 1].userContextId, 99);
  });

  it("Ctrl+Alt+T without getModifierState still works (older contexts)", () => {
    const n = created.length;
    const e = fireKey({ code: "KeyT", ctrlKey: true, altKey: true, noGMS: true });
    assert.equal(e._pd, true);
    assert.equal(created.length, n + 1);
  });

  it("AltGr+B passes through (no workspace bind)", () => {
    const bindingsBefore = prefStore["aph.workspaces.containerBindings"];
    const e = fireKey({ code: "KeyB", ctrlKey: true, altKey: true, altGraph: true });
    assert.equal(e._pd, false);
    assert.equal(prefStore["aph.workspaces.containerBindings"], bindingsBefore);
  });

  it("plain Ctrl+T in a bound workspace still opens a bound tab", () => {
    const n = created.length;
    const e = fireKey({ code: "KeyT", ctrlKey: true, altGraph: false });
    assert.equal(e._pd, true);
    assert.equal(created.length, n + 1);
    assert.equal(created[created.length - 1].userContextId, 7);
  });
});
