// Restore-time tag safety (branding/workspaces.js): a tab whose SessionStore
// extData hasn't landed yet (isTabRestoring, tagless) must never be stamped
// or retagged to the current workspace — that freeze is the 3->2 restore
// scramble. Covers TabOpen, group anchoring, init, and the
// deferred SSTabRestored stamp.
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { run, makeTab } = require("./helpers");

function makeWorld() {
  const tabVals = new WeakMap();
  const restoring = new Set();
  const containerHandlers = {};
  const timeoutQueue = [];
  const prefStore = {};
  const sel = makeTab(tabVals, {
    label: "sel", ws: "1", selected: true, spec: "https://start.example.com/",
  });
  let wsel = sel;
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
      tabs: [sel],
      tabGroups: [],
      get selectedTab() { return wsel; },
      set selectedTab(t) { wsel = t; },
      showTab(t) { t.removeAttribute("hidden"); },
      addTrustedTab(url, opts) {
        const t = makeTab(tabVals, {
          label: "new", ws: undefined, spec: url, cid: (opts && opts.userContextId) || 0,
        });
        // addTrustedTab births carry no ws yet in this harness (real
        // openers stamp afterwards); keep tagless like a fresh TabOpen.
        tabVals.get(t).aphWs = undefined;
        sb.gBrowser.tabs.push(t);
        return t;
      },
      removeTab(t) {
        const i = sb.gBrowser.tabs.indexOf(t);
        if (i !== -1) sb.gBrowser.tabs.splice(i, 1);
      },
      ungroupTab() {},
      replaceInSuccession() {},
      setSuccessor() {},
      _updateMultiselectedTabCloseButtonTooltip() {},
      getTabForBrowser: (b) => (b && b.__tab) || null,
      addTabsProgressListener() {},
      tabContainer: {
        setAttribute() {},
        addEventListener(type, fn) {
          (containerHandlers[type] ||= []).push(fn);
        },
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
      deleteCustomTabValue: (t, k) => {
        const o = tabVals.get(t);
        if (o) delete o[k];
      },
      isTabRestoring: (t) => restoring.has(t),
      getCustomWindowValue: () => undefined,
      setCustomWindowValue: () => {},
    },
    Services: {
      prefs: {
        getStringPref: (k, d) => (k in prefStore ? prefStore[k] : d),
        setStringPref: (k, v) => { prefStore[k] = v; },
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
  // helpers.run() pins setTimeout to a no-op; replace with a flushable
  // queue so deferred restore ticks can be driven deterministically.
  sb.setTimeout = (fn) => { timeoutQueue.push(fn); return timeoutQueue.length; };
  const api = sb.window.AphWorkspaces;
  const fire = (type, target, extra) => {
    for (const fn of containerHandlers[type] || []) fn({ target, ...extra });
  };
  const flushTimeouts = () => {
    while (timeoutQueue.length) timeoutQueue.shift()();
  };
  const wsOf = (t) => (tabVals.get(t) || {}).aphWs;
  return { sb, api, tabVals, restoring, containerHandlers, fire, flushTimeouts, wsOf, get sel() { return sel; } };
}

describe("restore tag safety (3->2 scramble)", () => {
  it("TabOpen on a restoring tab stamps nothing (no tag, no birth, no fresh)", () => {
    const w = makeWorld();
    const t = makeTab(w.tabVals, { label: "rs", ws: undefined, spec: "https://ws3.example.com/" });
    w.tabVals.get(t).aphWs = undefined;
    w.sb.gBrowser.tabs.push(t);
    w.restoring.add(t);
    w.fire("TabOpen", t);
    assert.equal(w.wsOf(t), undefined, "restoring TabOpen must not stamp a tag");
    assert.equal(t.__aphBirth, undefined, "restoring TabOpen must not age-gate birth");
    assert.ok(!t.__aphFresh, "restoring TabOpen must not mark fresh (router fuel)");
  });

  it("TabOpen on a settled tagless tab still stamps to current", () => {
    const w = makeWorld();
    const t = makeTab(w.tabVals, { label: "fresh", ws: undefined, spec: "https://x.example/" });
    w.tabVals.get(t).aphWs = undefined;
    w.sb.gBrowser.tabs.push(t);
    w.fire("TabOpen", t);
    assert.equal(w.wsOf(t), "1", "settled fresh tabs keep the old stamp behavior");
  });

  it("group anchor aborts on a tagless/restoring member (no majority retag)", () => {
    const w = makeWorld();
    const a = makeTab(w.tabVals, { label: "a", ws: "2", spec: "https://a.example/" });
    const b = makeTab(w.tabVals, { label: "b", ws: "2", spec: "https://b.example/" });
    // WS3 tab whose extData hasn't landed yet: tagless + restoring.
    const c = makeTab(w.tabVals, { label: "c", ws: undefined, spec: "https://c.example/" });
    w.tabVals.get(c).aphWs = undefined;
    w.sb.gBrowser.tabs.push(a, b, c);
    w.restoring.add(c);
    const g = { tabs: [a, b, c], label: "", color: "", collapsed: false };
    for (const t of [a, b, c]) t.group = g;
    w.sb.gBrowser.tabGroups.push(g);
    // Switch claims WS2 and runs the synchronous anchor pass.
    w.api.switchTo("2");
    assert.equal(w.wsOf(a), "2");
    assert.equal(w.wsOf(b), "2");
    assert.equal(w.wsOf(c), undefined, "tagless restoring member must not be majority-retagged");
    // ExtData lands, restore settles: the deferred unify keeps WS3.
    w.restoring.delete(c);
    w.tabVals.get(c).aphWs = "3";
    w.flushTimeouts();
    assert.equal(w.wsOf(c), "3", "settled WS3 tag survives the deferred unify");
  });

  it("init never stamps pre-existing restoring tabs", () => {
    const tabVals = new WeakMap();
    const restoring = new Set();
    const containerHandlers = {};
    const gone = makeTab(tabVals, { label: "gone", ws: undefined, spec: "https://gone.example/" });
    tabVals.get(gone).aphWs = undefined;
    restoring.add(gone);
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
        tabs: [gone],
        tabGroups: [],
        get selectedTab() { return gone; },
        set selectedTab(t) {},
        showTab(t) { t.removeAttribute("hidden"); },
        addTrustedTab() { throw new Error("unused"); },
        removeTab() {},
        ungroupTab() {},
        replaceInSuccession() {},
        setSuccessor() {},
        _updateMultiselectedTabCloseButtonTooltip() {},
        getTabForBrowser: (b) => (b && b.__tab) || null,
        addTabsProgressListener() {},
        tabContainer: {
          setAttribute() {},
          addEventListener(type, fn) { (containerHandlers[type] ||= []).push(fn); },
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
        isTabRestoring: (t) => restoring.has(t),
        getCustomWindowValue: () => undefined,
        setCustomWindowValue: () => {},
      },
      Services: {
        prefs: {
          getStringPref: (k, d) => d,
          setStringPref() {},
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
      Ci: { nsIWebProgressListener: {}, nsIWebProgress: {} },
    };
    sb.window.window = sb.window;
    run("workspaces.js", sb);
    assert.equal(
      (tabVals.get(gone) || {}).aphWs,
      undefined,
      "init must leave restoring tabs tagless for SSTabRestored"
    );
  });

  it("SSTabRestored never stamps a still-restoring tab synchronously", () => {
    const w = makeWorld();
    const t = makeTab(w.tabVals, { label: "rs", ws: undefined, spec: "https://ws3.example.com/" });
    w.tabVals.get(t).aphWs = undefined;
    w.sb.gBrowser.tabs.push(t);
    w.restoring.add(t);
    w.fire("SSTabRestored", t);
    assert.equal(w.wsOf(t), undefined, "no synchronous stamp while restoring");
    // Restore settles with the real tag before the tick runs: kept.
    w.restoring.delete(t);
    w.tabVals.get(t).aphWs = "3";
    w.flushTimeouts();
    assert.equal(w.wsOf(t), "3", "settled WS3 tag survives the deferred tick");
  });

  it("unifyGroup never hides tagless members (restore race re-shows)", () => {
    const w = makeWorld();
    w.api.switchTo("2");
    const a = makeTab(w.tabVals, { label: "ga", ws: undefined, spec: "https://ga.example/" });
    const b = makeTab(w.tabVals, { label: "gb", ws: undefined, spec: "https://gb.example/" });
    w.tabVals.get(a).aphWs = undefined;
    w.tabVals.get(b).aphWs = undefined;
    w.sb.gBrowser.tabs.push(a, b);
    const g = { tabs: [a, b], label: "", color: "", collapsed: false };
    a.group = g;
    b.group = g;
    w.sb.gBrowser.tabGroups.push(g);
    // Group event mid-restore (extData not landed): members are tagless.
    w.fire("TabGroupCreate", a);
    w.flushTimeouts();
    assert.equal(a.hidden, false, "tagless group member must not hide early");
    assert.equal(b.hidden, false, "tagless group member must not hide early");
    // ExtData lands + settle: tags intact, still visible.
    w.tabVals.get(a).aphWs = "2";
    w.tabVals.get(b).aphWs = "2";
    w.fire("SSTabRestored", a);
    w.fire("SSTabRestored", b);
    w.flushTimeouts();
    assert.equal(w.wsOf(a), "2");
    assert.equal(w.wsOf(b), "2");
    assert.equal(a.hidden, false, "settled current-workspace tab must show");
    assert.equal(b.hidden, false, "settled current-workspace tab must show");
  });

  it("switching never hides a tagless tab (settle path owns it)", () => {
    const w = makeWorld();
    const t = makeTab(w.tabVals, { label: "fresh", ws: undefined, spec: "https://fresh.example/" });
    w.tabVals.get(t).aphWs = undefined;
    w.sb.gBrowser.tabs.push(t);
    w.api.switchTo("2");
    assert.equal(t.hidden, false, "tagless tab must stay visible until its tag lands");
    assert.equal(w.wsOf(t), undefined, "switch must not stamp the tagless tab either");
  });
});
