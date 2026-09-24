// Regression guards for workspace family moves (branding/workspaces.js):
// - sendTabTo auto-carries linked tree descendants (hierarchy preserved)
// - sending a leaf still detaches to Level 0 (legacy rule)
// - whole native groups stay joined; partial moves eject
// - sendTreeTo / sendGroupTo explicit paths (+ withTree:false opt-out)
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
  let selTabs = null;

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
      moveTabToExistingGroup(t, group) {
        if (!t || t.pinned || !group) return;
        if (t.group === group) return;
        const cur = tabs.indexOf(t);
        if (cur !== -1) tabs.splice(cur, 1);
        let at = -1;
        for (const m of group.tabs || []) {
          if (m === t) continue;
          const i = tabs.indexOf(m);
          if (i > at) at = i;
        }
        tabs.splice(at + 1, 0, t);
        t.group = group;
        if (!group.tabs.includes(t)) group.tabs.push(t);
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
  const seed = makeTab(tabVals, { label: "seed", ws: "1", spec: "https://seed.example/" });
  tabs.push(seed);
  sel = seed;
  seed.selected = true;
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
  function flushTimeouts() {
    while (timeouts.length) {
      const fns = timeouts.splice(0);
      for (const fn of fns) fn();
    }
  }
  const wsOf = (t) => tabVals.get(t).aphWs;
  return {
    sb, api, tabs, tabVals, containerHandlers, timeouts, seed,
    addTab, flushTimeouts, wsOf,
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

describe("family moves: trees ride along", () => {
  it("sendTabTo carries descendants preserving hierarchy", () => {
    const env = makeEnv();
    const p = env.addTab("p");
    const c1 = env.addTab("c1");
    const c2 = env.addTab("c2");
    const tail = env.addTab("tail");
    env.api.attachTreeChild(c1, p);
    env.api.attachTreeChild(c2, p);
    env.select(p);
    env.setSelectedTabs(null);
    env.api.sendTabTo("2");
    assert.equal(env.wsOf(p), "2");
    assert.equal(env.wsOf(c1), "2");
    assert.equal(env.wsOf(c2), "2");
    assert.equal(env.wsOf(tail), "1");
    assert.equal(env.api.getTreeParent(c1), p);
    assert.equal(env.api.getTreeParent(c2), p);
    assert.equal(env.api.getTreeLevel(c1), 1);
    assert.equal(p.hidden, true, "sent parent hides on WS1");
    assert.equal(c1.hidden, true);
  });

  it("sending a leaf still detaches to Level 0", () => {
    const env = makeEnv();
    const p = env.addTab("p");
    const kid = env.addTab("kid");
    env.api.attachTreeChild(kid, p);
    env.select(kid);
    env.setSelectedTabs(null);
    env.api.sendTabTo("2");
    assert.equal(env.wsOf(kid), "2");
    assert.equal(env.api.getTreeLevel(kid), 0);
    assert.equal(env.api.getTreeChildren(p).length, 0);
  });

  it("withTree:false opts out back to detach (children stay + promote)", () => {
    const env = makeEnv();
    const p = env.addTab("p");
    const c1 = env.addTab("c1");
    env.api.attachTreeChild(c1, p);
    env.select(p);
    env.setSelectedTabs(null);
    env.api.sendTabTo("2", null, { withTree: false });
    assert.equal(env.wsOf(p), "2");
    assert.equal(env.wsOf(c1), "1", "child stays behind");
    assert.equal(env.api.getTreeLevel(p), 0);
    assert.equal(env.api.getTreeLevel(c1), 0, "straggler promotes to root");
  });

  it("sendTreeTo moves an explicit tree even when selection differs", () => {
    const env = makeEnv();
    const p = env.addTab("p");
    const c1 = env.addTab("c1");
    env.api.attachTreeChild(c1, p);
    const other = env.addTab("other");
    env.select(other);
    env.setSelectedTabs(null);
    assert.equal(typeof env.api.sendTreeTo, "function");
    env.api.sendTreeTo("2", p);
    assert.equal(env.wsOf(p), "2");
    assert.equal(env.wsOf(c1), "2");
    assert.equal(env.wsOf(other), "1");
    assert.equal(env.api.getTreeParent(c1), p);
  });
});

describe("family moves: native groups stay joined", () => {
  it("moving the whole group preserves membership", () => {
    const env = makeEnv();
    const g1 = env.addTab("g1");
    const g2 = env.addTab("g2");
    const outsider = env.addTab("outsider");
    const g = makeGroup([g1, g2]);
    env.sb.gBrowser.tabGroups.push(g);
    env.select(g1);
    env.setSelectedTabs([g1, g2]);
    env.api.sendTabTo("2");
    assert.equal(env.wsOf(g1), "2");
    assert.equal(env.wsOf(g2), "2");
    assert.equal(env.wsOf(outsider), "1");
    assert.equal(g1.group, g, "membership preserved");
    assert.equal(g2.group, g);
    assert.ok(g.tabs.includes(g1) && g.tabs.includes(g2));
  });

  it("moving a single grouped tab ejects (partial move)", () => {
    const env = makeEnv();
    const g1 = env.addTab("g1");
    const g2 = env.addTab("g2");
    const g = makeGroup([g1, g2]);
    env.sb.gBrowser.tabGroups.push(g);
    env.select(g1);
    env.setSelectedTabs(null);
    env.api.sendTabTo("2");
    assert.equal(env.wsOf(g1), "2");
    assert.equal(env.wsOf(g2), "1");
    assert.equal(g1.group, null, "moved tab ejects");
    assert.equal(g2.group, g, "stayer keeps the group");
  });

  it("sendGroupTo moves the whole group from a single tab", () => {
    const env = makeEnv();
    const g1 = env.addTab("g1");
    const g2 = env.addTab("g2");
    const outsider = env.addTab("outsider");
    const g = makeGroup([g1, g2]);
    env.sb.gBrowser.tabGroups.push(g);
    env.select(g1);
    env.setSelectedTabs(null);
    assert.equal(typeof env.api.sendGroupTo, "function");
    env.api.sendGroupTo("2", g1);
    assert.equal(env.wsOf(g1), "2");
    assert.equal(env.wsOf(g2), "2");
    assert.equal(env.wsOf(outsider), "1");
    assert.equal(g1.group, g);
    assert.equal(g2.group, g);
  });

  it("sendGroupTo on ungrouped tabs falls back to a tree move", () => {
    const env = makeEnv();
    const p = env.addTab("p");
    const c1 = env.addTab("c1");
    env.api.attachTreeChild(c1, p);
    env.select(p);
    env.setSelectedTabs(null);
    env.api.sendGroupTo("2", p);
    assert.equal(env.wsOf(p), "2");
    assert.equal(env.wsOf(c1), "2");
    assert.equal(env.api.getTreeParent(c1), p);
  });

  it("grouped trees move together preserving both structures", () => {
    const env = makeEnv();
    const p = env.addTab("p");
    const c1 = env.addTab("c1");
    env.api.attachTreeChild(c1, p);
    const g = makeGroup([p, c1]);
    env.sb.gBrowser.tabGroups.push(g);
    env.select(p);
    env.setSelectedTabs(null);
    // Single-tab send auto-carries the grouped child, completing the
    // group, so preservation kicks in.
    env.api.sendTabTo("2");
    assert.equal(env.wsOf(p), "2");
    assert.equal(env.wsOf(c1), "2");
    assert.equal(p.group, g);
    assert.equal(c1.group, g);
    assert.equal(env.api.getTreeParent(c1), p);
  });
});
