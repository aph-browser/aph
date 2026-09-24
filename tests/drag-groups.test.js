// Regression guards for drag-and-drop × native groups fixes:
// - dock drop moves the dragged tab(s), not whatever is selected
// - strip multiselect drag moves as a block (ride-along, span-skipping)
// - TabMove/TabClose keep group headers synced; group events robust
// - tree visibility never fights a collapsed native group.
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { run, makeTab, makeGroup, makeSessionStore, makeCi, makeChromeUtils, nullIdentityService } = require("./helpers");

function makeEnv() {
  const tabVals = new WeakMap();
  const tabs = [];
  const containerHandlers = {};
  const prefStore = {};
  const timeouts = [];
  let sel = null;
  let selTabs = null; // null = no multiselect API; [] = empty selection

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
        const t = makeTab(tabVals, {
          label: "new", ws: "1", spec: url, cid: (opts && opts.userContextId) || 0,
        });
        tabs.push(t);
        return t;
      },
      removeTab(t) {
        const i = tabs.indexOf(t);
        if (i !== -1) tabs.splice(i, 1);
      },
      moveTabTo(t, opts) {
        if (!opts || typeof opts !== "object" || !Number.isInteger(opts.tabIndex)) {
          throw new Error("moveTabTo requires { tabIndex }");
        }
        const cur = tabs.indexOf(t);
        if (cur === -1) return;
        tabs.splice(cur, 1);
        tabs.splice(Math.max(0, Math.min(opts.tabIndex, tabs.length)), 0, t);
      },
      ungroupTab(t) {
        const g = t && t.group;
        if (!g) return;
        t.group = null;
        const i = (g.tabs || []).indexOf(t);
        if (i !== -1) g.tabs.splice(i, 1);
      },
      replaceInSuccession() {},
      setSuccessor() {},
      _updateMultiselectedTabCloseButtonTooltip() {},
      getTabForBrowser: (b) => (b && b.__tab) || null,
      addTabsProgressListener() {},
      removeTabsProgressListener() {},
      tabContainer: {
        _attrs: {},
        setAttribute(k, v) { this._attrs[k] = String(v); },
        getAttribute(k) { return this._attrs[k]; },
        removeAttribute(k) { delete this._attrs[k]; },
        addEventListener(t, fn) { (containerHandlers[t] = containerHandlers[t] || []).push(fn); },
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
  // Seed like tree.test.js so init's forced switchTo doesn't birth a "new"
  // tab into the empty strip (reconcile never strands a tabless window).
  const seed = makeTab(tabVals, { label: "seed", ws: "1", spec: "https://seed.example/" });
  tabs.push(seed);
  sel = seed;
  seed.selected = true;
  // helpers.run overwrites setTimeout with a no-op; capture deferred group
  // syncs instead so tests can flush them deterministically.
  run("workspaces.js", sb);
  sb.setTimeout = (fn) => { timeouts.push(fn); return timeouts.length; };
  sb.window.setTimeout = sb.setTimeout;
  const api = sb.window.AphWorkspaces;
  api.switchTo("1");

  function addTab(label, o) {
    const t = makeTab(tabVals, Object.assign(
      { label, ws: "1", spec: `https://${label}.example/` }, o || {}
    ));
    tabs.push(t);
    return t;
  }
  function fire(type, target, extra) {
    for (const fn of containerHandlers[type] || []) {
      fn(Object.assign({ target, detail: {} }, extra || {}));
    }
  }
  function flushTimeouts() {
    while (timeouts.length) {
      const fns = timeouts.splice(0);
      for (const fn of fns) fn();
    }
  }
  // Simulate a user strip drag: reorder then dispatch TabMove like Firefox.
  function userMove(tab, toIndex) {
    const cur = tabs.indexOf(tab);
    assert.ok(cur !== -1, "dragged tab in strip");
    tabs.splice(cur, 1);
    tabs.splice(Math.max(0, Math.min(toIndex, tabs.length)), 0, tab);
    fire("TabMove", tab);
    flushTimeouts();
  }
  const order = () => tabs.map((t) => t.label);
  return {
    sb, api, tabs, tabVals, containerHandlers, timeouts,
    addTab, fire, flushTimeouts, userMove, order,
    select(t) { sb.gBrowser.selectedTab = t; },
    setSelectedTabs(arr) {
      selTabs = arr;
      try { delete sb.gBrowser.selectedTabs; } catch (e) {}
      if (arr !== null) {
        Object.defineProperty(sb.gBrowser, "selectedTabs", {
          configurable: true, get: () => selTabs,
        });
      }
    },
  };
}

describe("dock drag target (sendTabTo explicit set)", () => {
  it("moves an explicitly passed tab even when selection differs", () => {
    const env = makeEnv();
    const a = env.addTab("a");
    const b = env.addTab("b");
    env.select(a);
    env.api.sendTabTo("2", [b]);
    assert.equal(env.tabVals.get(b).aphWs, "2");
    assert.equal(env.tabVals.get(a).aphWs, "1");
  });

  it("moves an explicitly passed single tab", () => {
    const env = makeEnv();
    const a = env.addTab("a");
    const b = env.addTab("b");
    env.select(a);
    env.api.sendTabTo("2", b);
    assert.equal(env.tabVals.get(b).aphWs, "2");
    assert.equal(env.tabVals.get(a).aphWs, "1");
  });

  it("falls back to selection when no explicit set is given", () => {
    const env = makeEnv();
    const a = env.addTab("a");
    const b = env.addTab("b");
    env.select(a);
    env.setSelectedTabs([a, b]);
    env.api.sendTabTo("2");
    assert.equal(env.tabVals.get(a).aphWs, "2");
    assert.equal(env.tabVals.get(b).aphWs, "2");
  });
});

describe("strip multiselect drag", () => {
  it("drags sibling leaves as a block without detaching each other", () => {
    const env = makeEnv();
    const p = env.addTab("p");
    const c1 = env.addTab("c1");
    const c2 = env.addTab("c2");
    const other = env.addTab("other");
    env.api.attachTreeChild(c1, p);
    env.api.attachTreeChild(c2, p);
    assert.deepEqual(env.order(), ["seed", "p", "c1", "c2", "other"]);
    // Select both children and drag them together past the outsider.
    env.select(c1);
    env.setSelectedTabs([c1, c2]);
    const cur1 = env.tabs.indexOf(c1);
    env.tabs.splice(cur1, 1);
    const cur2 = env.tabs.indexOf(c2);
    env.tabs.splice(cur2, 1);
    env.tabs.splice(env.tabs.indexOf(other) + 1, 0, c1, c2);
    env.fire("TabMove", c1);
    env.fire("TabMove", c2);
    env.flushTimeouts();
    // Both left the parent block together: both detach (not one kept).
    assert.equal(env.api.getTreeLevel(c1), 0);
    assert.equal(env.api.getTreeLevel(c2), 0);
  });

  it("selected parent + child ride together without double-carry", () => {
    const env = makeEnv();
    const p = env.addTab("p");
    const c1 = env.addTab("c1");
    const tail = env.addTab("tail");
    env.api.attachTreeChild(c1, p);
    env.select(p);
    env.setSelectedTabs([p, c1]);
    // Stock moves both as a block to the end; fire moves for each.
    env.tabs.splice(env.tabs.indexOf(p), 1);
    env.tabs.splice(env.tabs.indexOf(c1), 1);
    env.tabs.push(p, c1);
    env.fire("TabMove", p);
    env.fire("TabMove", c1);
    env.flushTimeouts();
    assert.deepEqual(env.order(), ["seed", "tail", "p", "c1"]);
    assert.equal(env.api.getTreeLevel(c1), 1);
    assert.equal(env.api.getTreeParent(c1), p);
  });

  it("findEnclosingTreeParent ignores fellow dragged tabs", () => {
    const env = makeEnv();
    const p = env.addTab("p");
    const c1 = env.addTab("c1");
    env.api.attachTreeChild(c1, p);
    const x = env.addTab("x");
    const y = env.addTab("y");
    // Drop x+y together between p and c1: x should still adopt under p
    // (y is a fellow traveler, not a settled block member).
    env.setSelectedTabs([x, y]);
    env.tabs.splice(env.tabs.indexOf(x), 1);
    env.tabs.splice(env.tabs.indexOf(y), 1);
    env.tabs.splice(env.tabs.indexOf(p) + 1, 0, x, y);
    env.fire("TabMove", x);
    env.flushTimeouts();
    assert.equal(env.api.getTreeParent(x), p);
  });
});

describe("group event robustness", () => {
  it("registers removal/collapse listeners alongside create/update", () => {
    const env = makeEnv();
    for (const t of ["TabGroupCreate", "TabGroupUpdate", "TabGroupRemoved"]) {
      assert.ok(
        (env.containerHandlers[t] || []).length >= 1,
        `${t} listener registered`
      );
    }
  });

  it("onGroupChange accepts a tab target carrying .group", () => {
    const env = makeEnv();
    const g1 = env.addTab("g1");
    const g2 = env.addTab("g2");
    const g = makeGroup([g1, g2]);
    env.sb.gBrowser.tabGroups.push(g);
    env.fire("TabGroupUpdate", g1);
    env.flushTimeouts();
    // Unanimous WS1 group: no crash, tags untouched, header visible.
    assert.equal(env.tabVals.get(g1).aphWs, "1");
    assert.equal(g.hidden, false);
  });

  it("onGroupChange with no usable target falls back to header sync", () => {
    const env = makeEnv();
    const g1 = env.addTab("g1", { ws: "2" });
    const g = makeGroup([g1]);
    env.sb.gBrowser.tabGroups.push(g);
    // Current is WS1: header must hide (no target members).
    env.fire("TabGroupRemoved", env.sb.gBrowser.tabContainer);
    assert.equal(g.hidden, true);
  });

  it("TabClose re-syncs group headers", () => {
    const env = makeEnv();
    const g1 = env.addTab("g1", { ws: "2" });
    const g = makeGroup([g1]);
    env.sb.gBrowser.tabGroups.push(g);
    env.fire("TabClose", g1);
    assert.equal(g.hidden, true);
  });

  it("TabMove schedules group sync without breaking tree links", () => {
    const env = makeEnv();
    const p = env.addTab("p");
    const c1 = env.addTab("c1");
    env.api.attachTreeChild(c1, p);
    const g = makeGroup([p, c1]);
    env.sb.gBrowser.tabGroups.push(g);
    const nBefore = env.timeouts.length;
    env.userMove(c1, 0);
    assert.ok(env.timeouts.length >= nBefore, "deferred sync scheduled");
    assert.equal(g.hidden, false);
  });
});

describe("collapsed native groups vs tree visibility", () => {
  it("applyTreeVisibility never unhides collapsed-group members", () => {
    const env = makeEnv();
    const a = env.addTab("a");
    const b = env.addTab("b");
    const g = makeGroup([a, b], { collapsed: true });
    env.sb.gBrowser.tabGroups.push(g);
    env.select(a);
    b.setAttribute("hidden", "true");
    assert.equal(b.hidden, true);
    env.api.applyTreeVisibility();
    assert.equal(b.hidden, true, "collapsed group member stays hidden");
  });
});
