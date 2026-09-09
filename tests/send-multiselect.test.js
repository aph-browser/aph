// Multiselect "send tab to workspace" guards (branding/workspaces.js).
// Ctrl+clicking tabs then Ctrl+Alt+N (or the palette row) must move the
// whole selection; with no multiselection only the active tab moves.
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { run, makeTab } = require("./helpers");

const tabVals = new WeakMap();
const prefStore = {
  "aph.workspaces.domainRoutes": JSON.stringify({}),
  "aph.workspaces.containerBindings": JSON.stringify({}),
};

const home = makeTab(tabVals, {
  label: "home", ws: "1", selected: true, spec: "https://home.example.com/",
});
const t1 = makeTab(tabVals, {
  label: "t1", ws: "1", spec: "https://a.example.com/",
});
const t2 = makeTab(tabVals, {
  label: "t2", ws: "1", spec: "https://b.example.com/",
});
let wsel = home;
let selTabs = [];

const sb = {
  window: { addEventListener() {}, opener: null },
  navigator: { onLine: true },
  document: {
    readyState: "complete",
    getElementById: () => null,
    createElement: () => ({ setAttribute() {}, removeAttribute() {}, style: {} }),
    createEvent: () => ({ initEvent() {} }),
  },
  gBrowser: {
    tabs: [home, t1, t2],
    tabGroups: [],
    get selectedTab() { return wsel; },
    set selectedTab(t) {
      if (wsel) wsel.selected = false;
      wsel = t;
      if (t) t.selected = true;
    },
    get selectedTabs() { return selTabs; },
    showTab(t) { t.removeAttribute("hidden"); },
    addTrustedTab(url, opts) {
      const t = makeTab(tabVals, {
        label: "new", ws: "1", spec: url, cid: (opts && opts.userContextId) || 0,
      });
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
        getPublicIdentityFromId: () => null,
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
const tag = (t, ws) => { tabVals.get(t).aphWs = ws; };
function reset() {
  tag(home, "1"); tag(t1, "1"); tag(t2, "1");
  for (const t of [home, t1, t2]) {
    t.closing = false;
    t.removeAttribute("hidden");
  }
  sb.gBrowser.selectedTab = home;
  selTabs = [];
}

describe("sendTabTo multiselection", () => {
  it("moves the whole multiselection, selection stays behind", () => {
    reset();
    sb.gBrowser.selectedTab = t1;
    selTabs = [t1, t2];
    api.sendTabTo("2");
    assert.equal(wsOf(t1), "2");
    assert.equal(wsOf(t2), "2");
    assert.equal(wsOf(home), "1");
    assert.equal(sb.gBrowser.selectedTab, home);
    assert.equal(t1.hidden, true);
    assert.equal(t2.hidden, true);
    assert.equal(home.hidden, false);
  });

  it("falls back to the active tab with no multiselection", () => {
    reset();
    sb.gBrowser.selectedTab = t1;
    selTabs = [];
    api.sendTabTo("2");
    assert.equal(wsOf(t1), "2");
    assert.equal(wsOf(t2), "1");
    assert.equal(wsOf(home), "1");
  });

  it("sending to the current workspace is a no-op", () => {
    reset();
    sb.gBrowser.selectedTab = t1;
    selTabs = [t1, t2];
    const n = sb.gBrowser.tabs.length;
    api.sendTabTo("1");
    assert.equal(wsOf(t1), "1");
    assert.equal(wsOf(t2), "1");
    assert.equal(sb.gBrowser.tabs.length, n);
  });

  it("closing tabs in the selection are skipped", () => {
    reset();
    sb.gBrowser.selectedTab = t1;
    t1.closing = true;
    selTabs = [t1, t2];
    api.sendTabTo("2");
    assert.equal(wsOf(t1), "1");
    assert.equal(wsOf(t2), "2");
  });
});
