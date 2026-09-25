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
  const dipClasses = new Set();
  const tabboxEl = {
    classList: {
      add: (c) => dipClasses.add(c),
      remove: (c) => dipClasses.delete(c),
      contains: (c) => dipClasses.has(c),
    },
  };
  const prefStore = {};
  let sel = null;
  const sb = {
    // Real timers (see run()): this is the only suite asserting
    // timer-driven removals (dip release). No other suite is affected.
    __aphRealTimers: true,
    window: { addEventListener() {}, removeEventListener() {}, opener: null },
    navigator: { onLine: true },
    document: {
      readyState: "complete",
      getElementById: (id) => (id === "tabbrowser-tabbox" ? tabboxEl : null),
      documentElement: {
        _attrs: {},
        setAttribute(k, v) { this._attrs[k] = v; },
        getAttribute(k) { return this._attrs[k]; },
      },
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
  return { api, tabs, addTab, doc: sb.document, tabboxEl, get sel() { return sel; } };
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

  it("dips the card on switch (§24 dissolve) and releases it", async () => {
    const { api, addTab, tabboxEl } = makeEnv();
    addTab("a", { ws: "1" });
    addTab("b", { ws: "2" });
    api.switchTo("2");
    assert.ok(tabboxEl.classList.contains("aph-ws-dip"), "card dips at the swap");
    await new Promise((r) => setTimeout(r, 200));
    assert.ok(!tabboxEl.classList.contains("aph-ws-dip"), "dip releases for the glide back");
  });

  it("stamps the live workspace on documentElement for the CSS tint (§21)", () => {
    const { api, addTab, doc } = makeEnv();
    addTab("a", { ws: "1" });
    addTab("b", { ws: "2" });
    api.switchTo("2");
    assert.equal(doc.documentElement.getAttribute("data-aph-ws"), "2");
    api.switchLocal("1");
    assert.equal(doc.documentElement.getAttribute("data-aph-ws"), "1");
  });
});
