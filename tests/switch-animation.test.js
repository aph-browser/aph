// Switch animation (workspaces/60-indicator-switch.js animateIncomingTabs):
// after a switch, visible unpinned tabs carry .aph-ws-enter (CSS fades them
// in); pinned tabs never animate (they are global), hidden tabs stay out.
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { run, makeTab, makeSessionStore, makeCi, makeChromeUtils, nullIdentityService } = require("./helpers");

function classedTab(tabVals, o) {
  const t = makeTab(tabVals, o);
  const classes = new Set();
  t.classList = {
    add: (c) => classes.add(c),
    remove: (c) => classes.delete(c),
    contains: (c) => classes.has(c),
  };
  return t;
}

function makeEnv() {
  const tabVals = new WeakMap();
  const tabs = [];
  const prefStore = {};
  let sel = null;
  const sb = {
    window: { addEventListener() {}, removeEventListener() {}, opener: null },
    navigator: { onLine: true },
    document: {
      readyState: "complete",
      getElementById: () => null,
      createElement: () => ({
        setAttribute() {}, removeAttribute() {}, addEventListener() {},
        style: {}, className: "",
      }),
      createEvent: () => ({ initEvent() {} }),
    },
    gBrowser: {
      tabs,
      tabGroups: [],
      get selectedTab() { return sel; },
      set selectedTab(t) {
        if (sel) sel.selected = false;
        sel = t;
        if (t) t.selected = true;
      },
      showTab(t) { t.removeAttribute("hidden"); },
      addTrustedTab(url, opts) {
        const t = classedTab(tabVals, {
          label: "new", ws: "1", spec: url, cid: (opts && opts.userContextId) || 0,
        });
        tabs.push(t);
        return t;
      },
      removeTab(t) {
        const i = tabs.indexOf(t);
        if (i !== -1) tabs.splice(i, 1);
      },
      moveTabTo() {},
      ungroupTab() {},
      replaceInSuccession() {},
      setSuccessor() {},
      _updateMultiselectedTabCloseButtonTooltip() {},
      getTabForBrowser: (b) => (b && b.__tab) || null,
      addTabsProgressListener() {},
      removeTabsProgressListener() {},
      tabContainer: {
        setAttribute() {},
        addEventListener() {},
        removeEventListener() {},
        _invalidateCachedVisibleTabs() {},
        _updateCloseButtons() {},
      },
    },
    SessionStore: makeSessionStore(tabVals),
    Services: {
      prefs: {
        getStringPref: (k, d) => (k in prefStore ? prefStore[k] : d),
        setStringPref: (k, v) => { prefStore[k] = v; },
        getBoolPref: () => false,
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
    ChromeUtils: makeChromeUtils(nullIdentityService),
    Ci: makeCi(),
  };
  sb.window.window = sb.window;
  run("workspaces.js", sb);
  const api = sb.window.AphWorkspaces;
  function addTab(label, o) {
    const t = classedTab(tabVals, Object.assign({ label, spec: `https://${label}.example/` }, o));
    tabs.push(t);
    return t;
  }
  return { api, tabs, addTab, get sel() { return sel; } };
}

describe("switch animation", () => {
  it("fades incoming unpinned tabs in, leaves the departed workspace out", () => {
    const { api, addTab } = makeEnv();
    const a = addTab("a", { ws: "1" });
    const b = addTab("b", { ws: "2" });
    api.switchTo("2");
    assert.ok(b.classList.contains("aph-ws-enter"), "incoming tab fades in");
    assert.ok(!a.classList.contains("aph-ws-enter"), "departed (now hidden) tab does not animate");
    assert.ok(a.hidden, "departed tab still hides synchronously");
    api.switchTo("1");
    assert.ok(a.classList.contains("aph-ws-enter"), "return switch fades in too");
    assert.ok(b.hidden, "departed tab still hides synchronously");
  });

  it("never animates pinned tabs (global, always visible)", () => {
    const { api, addTab } = makeEnv();
    const pin = addTab("pin", { ws: "1", pinned: true });
    addTab("other", { ws: "2" });
    api.switchTo("2");
    assert.ok(!pin.hidden, "pin stays visible");
    assert.ok(!pin.classList.contains("aph-ws-enter"), "pin does not animate");
  });

  it("switchLocal animates too (same settle path)", () => {
    const { api, addTab } = makeEnv();
    addTab("a", { ws: "1" });
    const b = addTab("b", { ws: "2" });
    api.switchLocal("2");
    assert.ok(b.classList.contains("aph-ws-enter"), "incoming tab fades in");
  });
});
