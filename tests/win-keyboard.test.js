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
    ungroupTab(t) { if (t) t.group = null; },
    addTabGroup(tabs, opts) {
      const live = (tabs || []).filter((t) => t && !t.closing);
      if (live.length < 2) return null;
      const ng = { tabs: live.slice(), label: "", color: "", collapsed: false };
      for (const t of live) t.group = ng;
      sb.gBrowser.tabGroups.push(ng);
      return ng;
    },
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

describe("Alt+digit workspace switching", () => {
  const api = () => sb.window.AphWorkspaces;
  function reset() {
    tabVals.get(home).aphWs = "1";
    sb.gBrowser.selectedTab = home;
    if (api().getCurrent() !== "1") api().switchTo("1");
    sb.document.getElementById = () => null;
  }

  it("Alt+2 switches to workspace 2", () => {
    reset();
    const e = fireKey({ code: "Digit2", altKey: true, altGraph: false });
    assert.equal(e._pd, true, "Alt+digit must be claimed");
    assert.equal(e._ps, true);
    assert.equal(api().getCurrent(), "2");
  });

  it("Alt+Shift+2 still switches (deprecated alias)", () => {
    reset();
    const e = fireKey({ code: "Digit2", altKey: true, shiftKey: true, altGraph: false });
    assert.equal(e._pd, true);
    assert.equal(api().getCurrent(), "2");
  });

  it("Alt+digit yields to the open palette (quick-pick owns it)", () => {
    reset();
    sb.document.getElementById = (id) =>
      id === "aph-palette-overlay" ? { hidden: false } : null;
    const e = fireKey({ code: "Digit2", altKey: true, altGraph: false });
    assert.equal(e._pd, false, "must not claim while palette handles quick-pick");
    assert.equal(e._ps, false);
    assert.equal(api().getCurrent(), "1");
    sb.document.getElementById = () => null;
  });

  it("Alt+digit switches without moving the tab", () => {
    reset();
    fireKey({ code: "Digit3", altKey: true, altGraph: false });
    assert.equal(tabVals.get(home).aphWs, "1", "switch must retag nothing");
    assert.equal(api().getCurrent(), "3");
  });
});

describe("tab mru keybinding (Ctrl+` walks tabs workspace-safe)", () => {
  const api = () => sb.window.AphWorkspaces;
  function reset() {
    tabVals.get(home).aphWs = "1";
    sb.gBrowser.selectedTab = home;
    if (api().getCurrent() !== "1") api().switchTo("1");
    sb.document.getElementById = () => null;
  }
  function stamp(t, n) {
    const o = tabVals.get(t) || {};
    o.aphLastViewed = String(n);
    tabVals.set(t, o);
  }

  it("Ctrl+` selects the last-viewed tab", () => {
    reset();
    const a = makeTab(tabVals, { label: "tk-a", ws: "1", spec: "https://a.example/" });
    const b = makeTab(tabVals, { label: "tk-b", ws: "1", spec: "https://b.example/" });
    sb.gBrowser.tabs.push(a, b);
    try {
      sb.gBrowser.selectedTab = b;
      stamp(b, 1000);
      stamp(a, 3000);
      stamp(home, 2000);
      const e = fireKey({ code: "Backquote", ctrlKey: true, altGraph: false });
      assert.equal(e._pd, true, "Ctrl+` must be claimed");
      assert.equal(e._ps, true);
      assert.equal(sb.gBrowser.selectedTab, a);
    } finally {
      for (const t of [a, b]) {
        const i = sb.gBrowser.tabs.indexOf(t);
        if (i !== -1) sb.gBrowser.tabs.splice(i, 1);
      }
      reset();
    }
  });

  it("repeated presses walk deeper, Ctrl+Shift+` reverses", () => {
    reset();
    const a = makeTab(tabVals, { label: "tk-c", ws: "1", spec: "https://c.example/" });
    const b = makeTab(tabVals, { label: "tk-d", ws: "1", spec: "https://d.example/" });
    sb.gBrowser.tabs.push(a, b);
    try {
      sb.gBrowser.selectedTab = home;
      stamp(home, 1000);
      stamp(a, 3000);
      stamp(b, 2000);
      // order: [home, a, b] -> walk -> a -> b
      fireKey({ code: "Backquote", ctrlKey: true, altGraph: false });
      assert.equal(sb.gBrowser.selectedTab, a);
      fireKey({ code: "Backquote", ctrlKey: true, altGraph: false });
      assert.equal(sb.gBrowser.selectedTab, b);
      const e = fireKey({ code: "Backquote", ctrlKey: true, shiftKey: true, altGraph: false });
      assert.equal(e._pd, true);
      assert.equal(sb.gBrowser.selectedTab, a);
    } finally {
      for (const t of [a, b]) {
        const i = sb.gBrowser.tabs.indexOf(t);
        if (i !== -1) sb.gBrowser.tabs.splice(i, 1);
      }
      reset();
    }
  });

  it("landing on another workspace's tab switches there first", () => {
    reset();
    const far = makeTab(tabVals, { label: "tk-far", ws: "2", spec: "https://far.example/" });
    sb.gBrowser.tabs.push(far);
    try {
      sb.gBrowser.selectedTab = home;
      stamp(home, 1000);
      stamp(far, 5000);
      fireKey({ code: "Backquote", ctrlKey: true, altGraph: false });
      assert.equal(sb.gBrowser.selectedTab, far);
      assert.equal(api().getCurrent(), "2");
    } finally {
      const i = sb.gBrowser.tabs.indexOf(far);
      if (i !== -1) sb.gBrowser.tabs.splice(i, 1);
      reset();
    }
  });

  it("Alt+Shift+Tab still passes through unclaimed", () => {
    reset();
    const cur = api().getCurrent();
    const sel = sb.gBrowser.selectedTab;
    const e = fireKey({ code: "Tab", altKey: true, shiftKey: true, altGraph: false });
    assert.equal(e._pd, false, "old binding must pass through");
    assert.equal(e._ps, false);
    assert.equal(api().getCurrent(), cur);
    assert.equal(sb.gBrowser.selectedTab, sel);
  });
});

describe("Ctrl+Alt+G group selected tabs", () => {
  const api = () => sb.window.AphWorkspaces;
  function reset() {
    tabVals.get(home).aphWs = "1";
    sb.gBrowser.selectedTab = home;
    if (api().getCurrent() !== "1") api().switchTo("1");
    sb.document.getElementById = () => null;
    delete sb.gBrowser.selectedTabs;
  }

  it("groups the multiselection", () => {
    reset();
    const a = makeTab(tabVals, { label: "grp-a", ws: "1", spec: "https://ga.example/" });
    const b = makeTab(tabVals, { label: "grp-b", ws: "1", spec: "https://gb.example/" });
    sb.gBrowser.tabs.push(a, b);
    sb.gBrowser.selectedTabs = [a, b];
    try {
      const e = fireKey({ code: "KeyG", ctrlKey: true, altKey: true, altGraph: false });
      assert.equal(e._pd, true, "Ctrl+Alt+G must be claimed");
      assert.equal(e._ps, true);
      assert.ok(a.group && a.group === b.group, "both tabs share one group");
    } finally {
      for (const t of [a, b]) {
        const i = sb.gBrowser.tabs.indexOf(t);
        if (i !== -1) sb.gBrowser.tabs.splice(i, 1);
        t.group = null;
      }
      for (let i = sb.gBrowser.tabGroups.length - 1; i >= 0; i--) {
        const g = sb.gBrowser.tabGroups[i];
        if (g.tabs.includes(a) || g.tabs.includes(b)) {
          sb.gBrowser.tabGroups.splice(i, 1);
        }
      }
      reset();
    }
  });

  it("single tab pulses without grouping (still claimed)", () => {
    reset();
    const nBefore = sb.gBrowser.tabGroups.length;
    const e = fireKey({ code: "KeyG", ctrlKey: true, altKey: true, altGraph: false });
    assert.equal(e._pd, true);
    assert.equal(sb.gBrowser.tabGroups.length, nBefore, "no group for a single tab");
    reset();
  });

  it("AltGr+G passes through, Shift variant stays unclaimed", () => {
    reset();
    const nBefore = sb.gBrowser.tabGroups.length;
    const e1 = fireKey({ code: "KeyG", ctrlKey: true, altKey: true, altGraph: true });
    assert.equal(e1._pd, false, "must not claim AltGr composition");
    assert.equal(e1._ps, false);
    const e2 = fireKey({ code: "KeyG", ctrlKey: true, altKey: true, shiftKey: true, altGraph: false });
    assert.equal(e2._pd, false, "Shift variant must stay unclaimed");
    assert.equal(sb.gBrowser.tabGroups.length, nBefore);
    reset();
  });
});

describe("unbound Ctrl+Alt+Arrow keys", () => {
  it("Ctrl+Alt+Right passes through unclaimed", () => {
    sb.gBrowser.selectedTab = home;
    const wsBefore = tabVals.get(home).aphWs;
    const e = fireKey({ code: "ArrowRight", ctrlKey: true, altKey: true, altGraph: false });
    assert.equal(e._pd, false, "removed hotkey must not claim the press");
    assert.equal(e._ps, false);
    assert.equal(tabVals.get(home).aphWs, wsBefore, "tab must keep its workspace");
  });

  it("Ctrl+Alt+Left passes through unclaimed", () => {
    sb.gBrowser.selectedTab = home;
    const wsBefore = tabVals.get(home).aphWs;
    const e = fireKey({ code: "ArrowLeft", ctrlKey: true, altKey: true, altGraph: false });
    assert.equal(e._pd, false, "removed hotkey must not claim the press");
    assert.equal(e._ps, false);
    assert.equal(tabVals.get(home).aphWs, wsBefore, "tab must keep its workspace");
  });

  it("AltGr+Arrow passes through", () => {
    sb.gBrowser.selectedTab = home;
    const e = fireKey({ code: "ArrowRight", ctrlKey: true, altKey: true, altGraph: true });
    assert.equal(e._pd, false, "must not claim AltGr composition");
    assert.equal(e._ps, false);
  });

  it("Shifted Ctrl+Alt+Arrow stays unclaimed (Shift-digit sends unbound)", () => {
    sb.gBrowser.selectedTab = home;
    const wsBefore = tabVals.get(home).aphWs;
    const e = fireKey({ code: "ArrowRight", ctrlKey: true, altKey: true, shiftKey: true, altGraph: false });
    assert.equal(e._pd, false, "Shift variant must stay unclaimed");
    assert.equal(e._ps, false);
    assert.equal(tabVals.get(home).aphWs, wsBefore, "tab must keep its workspace");
  });
});
