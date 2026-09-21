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
      deleteCustomTabValue: (t, k) => {
        const o = tabVals.get(t) || {};
        delete o[k];
        tabVals.set(t, o);
      },
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

describe("tree indent/outdent hotkeys (Ctrl+Alt+Arrow)", () => {
  const api = sb.window.AphWorkspaces;
  const level = (t) => api.getTreeLevel(t);

  function addTab(label) {
    const t = makeTab(tabVals, { label, ws: "1", spec: `https://${label}.example/` });
    sb.gBrowser.tabs.push(t);
    return t;
  }

  it("Ctrl+Alt+Right indents the selected tab under the tab above", () => {
    const r1 = addTab("kr1");
    const r2 = addTab("kr2");
    sb.gBrowser.selectedTab = r2;
    const e = fireKey({ code: "ArrowRight", ctrlKey: true, altKey: true, altGraph: false });
    assert.equal(e._pd, true, "hotkey claimed");
    assert.equal(e._ps, true);
    assert.equal(api.getTreeParent(r2), r1);
    assert.equal(level(r2), 1);
    // Cleanup: outdent back so later tests start flat.
    sb.gBrowser.selectedTab = r2;
    fireKey({ code: "ArrowLeft", ctrlKey: true, altKey: true, altGraph: false });
    assert.equal(level(r2), 0);
    for (const t of [r1, r2]) {
      const i = sb.gBrowser.tabs.indexOf(t);
      if (i !== -1) sb.gBrowser.tabs.splice(i, 1);
    }
    sb.gBrowser.selectedTab = home;
  });

  it("Ctrl+Alt+Left outdents a child in place", () => {
    const r1 = addTab("ko1");
    const kid = addTab("ko-kid");
    api.attachTreeChild(kid, r1);
    assert.equal(level(kid), 1);
    const before = sb.gBrowser.tabs.slice();
    sb.gBrowser.selectedTab = kid;
    const e = fireKey({ code: "ArrowLeft", ctrlKey: true, altKey: true, altGraph: false });
    assert.equal(e._pd, true);
    assert.equal(level(kid), 0);
    assert.deepEqual(sb.gBrowser.tabs, before, "outdent keeps strip position");
    for (const t of [r1, kid]) {
      const i = sb.gBrowser.tabs.indexOf(t);
      if (i !== -1) sb.gBrowser.tabs.splice(i, 1);
    }
    sb.gBrowser.selectedTab = home;
  });

  it("indent is a no-op for the first tab; outdent for L0 roots", () => {
    sb.gBrowser.selectedTab = home;
    // home sits at strip index 0 (seed tab): nothing above to indent under.
    const e1 = fireKey({ code: "ArrowRight", ctrlKey: true, altKey: true, altGraph: false });
    assert.equal(e1._pd, true, "hotkey still claimed on no-op");
    assert.equal(level(home), 0);
    const lone = addTab("kn-lone");
    sb.gBrowser.selectedTab = lone;
    const e2 = fireKey({ code: "ArrowLeft", ctrlKey: true, altKey: true, altGraph: false });
    assert.equal(e2._pd, true);
    assert.equal(level(lone), 0);
    const i = sb.gBrowser.tabs.indexOf(lone);
    if (i !== -1) sb.gBrowser.tabs.splice(i, 1);
    sb.gBrowser.selectedTab = home;
  });

  it("multiselection indents as siblings via the hotkey", () => {
    const p = addTab("km-p");
    const a = addTab("km-a");
    const b = addTab("km-b");
    sb.gBrowser.selectedTab = a;
    sb.gBrowser.selectedTabs = [a, b];
    try {
      const e = fireKey({ code: "ArrowRight", ctrlKey: true, altKey: true, altGraph: false });
      assert.equal(e._pd, true);
      assert.equal(api.getTreeParent(a), p);
      assert.equal(api.getTreeParent(b), p);
    } finally {
      delete sb.gBrowser.selectedTabs;
    }
    for (const t of [p, a, b]) {
      const i = sb.gBrowser.tabs.indexOf(t);
      if (i !== -1) sb.gBrowser.tabs.splice(i, 1);
    }
    sb.gBrowser.selectedTab = home;
  });

  it("AltGr+Arrow passes through (no tree change)", () => {
    const r1 = addTab("kg1");
    const r2 = addTab("kg2");
    sb.gBrowser.selectedTab = r2;
    const e = fireKey({ code: "ArrowRight", ctrlKey: true, altKey: true, altGraph: true });
    assert.equal(e._pd, false, "must not claim AltGr composition");
    assert.equal(e._ps, false);
    assert.equal(level(r2), 0, "no parenting happened");
    for (const t of [r1, r2]) {
      const i = sb.gBrowser.tabs.indexOf(t);
      if (i !== -1) sb.gBrowser.tabs.splice(i, 1);
    }
    sb.gBrowser.selectedTab = home;
  });

  it("Shifted Ctrl+Alt+Arrow is not an indent (cycle layer owns Shift)", () => {
    const r1 = addTab("ks1");
    const r2 = addTab("ks2");
    sb.gBrowser.selectedTab = r2;
    const e = fireKey({ code: "ArrowRight", ctrlKey: true, altKey: true, shiftKey: true, altGraph: false });
    assert.equal(level(r2), 0, "Shift variant must not indent");
    for (const t of [r1, r2]) {
      const i = sb.gBrowser.tabs.indexOf(t);
      if (i !== -1) sb.gBrowser.tabs.splice(i, 1);
    }
    sb.gBrowser.selectedTab = home;
  });
});
