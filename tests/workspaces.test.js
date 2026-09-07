// Regression guards for the domain-routing engine (branding/workspaces.js).
// Mocks mirror build/firefox/omni.ja: tabs listeners receive
// (browser, webProgress, request, location, flags).
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { run, makeTab } = require("./helpers");

const tabVals = new WeakMap();
const prefStore = {
  "aph.workspaces.domainRoutes": JSON.stringify({
    "github.com": "2",
    "amazon.com": "1",
    "aws.amazon.com": "2",
  }),
  "aph.workspaces.containerBindings": JSON.stringify({ "2": 7 }),
};
const created = [];
const removed = [];
let listener = null;

const home = makeTab(tabVals, {
  label: "home", ws: "1", selected: true, spec: "https://start.example.com/",
});
let wsel = home;

const sb = {
  window: { addEventListener() {}, opener: null },
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
      removed.push(t.label);
      const i = sb.gBrowser.tabs.indexOf(t);
      if (i !== -1) sb.gBrowser.tabs.splice(i, 1);
    },
    ungroupTab() {},
    replaceInSuccession() {},
    setSuccessor() {},
    _updateMultiselectedTabCloseButtonTooltip() {},
    getTabForBrowser: (b) => (b && b.__tab) || null,
    addTabsProgressListener(l) { listener = l; },
    tabContainer: {
      setAttribute() {},
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
        create: () => { throw new Error("unused"); },
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
const api = sb.window.AphWorkspaces;
const wsOf = (t) => tabVals.get(t).aphWs;

function fireLoc(tab, host, o = {}) {
  listener.onLocationChange(
    tab.__browser,
    { isTopLevel: o.topLevel !== false },
    null,
    { scheme: o.scheme || "https", asciiHost: host },
    o.sameDoc ? 2 : 0
  );
}

describe("domain routing", () => {
  it("registers the progress listener", () => {
    assert.ok(listener);
  });

  it("routes a background fresh tab silently with container swap", () => {
    const t = makeTab(tabVals, {
      label: "t1", ws: "1", fresh: true, spec: "https://github.com/",
    });
    sb.gBrowser.tabs.push(t);
    fireLoc(t, "github.com");
    const rep = created[created.length - 1];
    assert.ok(!sb.gBrowser.tabs.includes(t), "original removed");
    assert.equal(rep.userContextId, 7);
    assert.equal(wsOf(rep), "2");
    assert.equal(rep.hidden, true);
    assert.equal(api.getCurrent(), "1");
    assert.equal(wsel, home);
    assert.equal(rep.__aphFresh, false, "replacement born settled");
    const n = created.length;
    fireLoc(rep, "github.com");
    assert.equal(created.length, n, "no routing loop");
  });

  it("ignores settled tabs (SSO trap)", () => {
    const n = created.length;
    const s = makeTab(tabVals, {
      label: "s", ws: "1", fresh: false, spec: "https://jira.example.com/",
    });
    sb.gBrowser.tabs.push(s);
    fireLoc(s, "github.com");
    assert.equal(created.length, n);
    assert.equal(wsOf(s), "1");
  });

  it("matches longest suffix first", () => {
    assert.equal(api.matchRoute("aws.amazon.com").ws, "2");
    assert.equal(api.matchRoute("aws.amazon.com").pattern, "aws.amazon.com");
    assert.equal(api.matchRoute("www.amazon.com").ws, "1");
    assert.equal(api.matchRoute("unknown.example.org"), null);
  });

  it("pulls the window along for foreground tabs", () => {
    const t = makeTab(tabVals, {
      label: "t4", ws: "1", fresh: true, spec: "https://github.com/co/repo",
    });
    sb.gBrowser.tabs.push(t);
    sb.gBrowser.selectedTab = t;
    fireLoc(t, "github.com");
    const rep = created[created.length - 1];
    assert.equal(api.getCurrent(), "2");
    assert.equal(wsel, rep);
    assert.equal(wsOf(rep), "2");
  });

  it("ignores the old shifted arg order (regression guard)", () => {
    const n = created.length;
    const t = makeTab(tabVals, {
      label: "t6", ws: "1", fresh: true, spec: "https://github.com/",
    });
    sb.gBrowser.tabs.push(t);
    listener.onLocationChange(
      { isTopLevel: true },
      t.__browser,
      null,
      { scheme: "https", asciiHost: "github.com" },
      0
    );
    assert.equal(created.length, n);
    assert.ok(!removed.includes("t6"));
  });

  it("stores workspace names (trim, cap, clear, reject)", () => {
    assert.equal(api.setWsName("2", "  💼 Work  "), true);
    assert.equal(api.getWsName("2"), "💼 Work");
    assert.equal(
      prefStore["aph.workspaces.names"],
      JSON.stringify({ 2: "💼 Work" })
    );
    assert.equal(api.setWsName("10", "x"), false);
    assert.equal(api.setWsName("2", "   "), true);
    assert.equal(api.getWsName("2"), "");
  });
});
