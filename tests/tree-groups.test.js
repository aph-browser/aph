// Regression guards for native-group × tree nesting (workspaces bundle):
// trees live inside groups — edges only join same-group-state tabs,
// opener children inherit the parent's group, indent/adopt never cross
// group edges, legacy crossings read as absent and heal to Level 0.
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { run, makeTab } = require("./helpers");

function makeGroup(tabs, o) {
  const g = {
    tabs: tabs.slice(),
    collapsed: !!(o && o.collapsed),
    hidden: false,
  };
  for (const t of tabs) {
    t.group = g;
  }
  g.closest = (sel) => (sel === "tab-group" ? g : null);
  // Stock tabgroup.js addTabs fallback (append to group end).
  g.addTabs = (arr) => {
    for (const t of arr || []) {
      if (!t || t.pinned) continue;
      t.group = g;
      if (!g.tabs.includes(t)) g.tabs.push(t);
    }
  };
  return g;
}

function makeEnv() {
  const tabVals = new WeakMap();
  const tabs = [];
  const containerHandlers = {};
  const prefStore = {};
  const timeouts = [];
  const moves = [];
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
        moves.push(opts);
        if (!opts || typeof opts !== "object" || !Number.isInteger(opts.tabIndex)) {
          throw new Error("moveTabTo requires { tabIndex }");
        }
        const cur = tabs.indexOf(t);
        if (cur === -1) return;
        tabs.splice(cur, 1);
        tabs.splice(Math.max(0, Math.min(opts.tabIndex, tabs.length)), 0, t);
      },
      // Stock Tabbrowser.sys.mjs moveTabToExistingGroup: appends to the
      // group end and dispatches TabMove synchronously via #handleTabMove.
      moveTabToExistingGroup(t, group) {
        if (!t || t.pinned || !group) return;
        if (t.group === group) return;
        moves.push({ toGroup: true });
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
        for (const fn of containerHandlers.TabMove || []) {
          fn({ target: t, detail: {} });
        }
      },
      ungroupTab(t) {
        const g = t && t.group;
        if (!g) return;
        t.group = null;
        const i = (g.tabs || []).indexOf(t);
        if (i !== -1) g.tabs.splice(i, 1);
        for (const fn of containerHandlers.TabMove || []) {
          fn({ target: t, detail: {} });
        }
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
    ChromeUtils: {
      generateQI: () => () => {},
      importESModule: () => ({
        ContextualIdentityService: {
          getPublicIdentityFromId: () => null,
          getPublicIdentities: () => [],
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
  const seed = makeTab(tabVals, { label: "seed", ws: "1", spec: "https://seed.example/" });
  tabs.push(seed);
  sel = seed;
  seed.selected = true;
  run("workspaces.js", sb);
  // helpers.run stubs setTimeout to a no-op; capture deferred syncs so
  // tests can flush them deterministically.
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
    sb, api, tabs, tabVals, containerHandlers, timeouts, moves, seed,
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

describe("auto-join on attach (birth path)", () => {
  it("opener children inherit the parent group", () => {
    const env = makeEnv();
    const p = env.addTab("p");
    const g = makeGroup([p]);
    env.sb.gBrowser.tabGroups.push(g);
    const x = env.addTab("x");
    assert.equal(x.group, null);
    env.api.attachTreeChild(x, p);
    assert.equal(x.group, g);
    assert.ok(g.tabs.includes(x));
    assert.equal(env.api.getTreeParent(x), p);
    assert.equal(env.api.getTreeLevel(x), 1);
    assert.deepEqual(env.order(), ["seed", "p", "x"]);
  });

  it("keeps the link when the stock join appends past the parent span", () => {
    // Group tail holds a non-family member: the join appends x to the
    // group end (past the parent span), and the synchronous TabMove from
    // the join must not detach it (join-guard regression).
    const env = makeEnv();
    const p = env.addTab("p");
    const c1 = env.addTab("c1");
    env.api.attachTreeChild(c1, p);
    const r2 = env.addTab("r2");
    const g = makeGroup([p, c1, r2]);
    env.sb.gBrowser.tabGroups.push(g);
    const x = env.addTab("x");
    env.api.attachTreeChild(x, p);
    assert.equal(x.group, g);
    assert.equal(env.api.getTreeParent(x), p);
    assert.equal(env.api.getTreeLevel(x), 1);
    assert.deepEqual(env.order(), ["seed", "p", "c1", "r2", "x"]);
  });

  it("ejects a grouped child when the parent is ungrouped", () => {
    const env = makeEnv();
    const p = env.addTab("p");
    const x = env.addTab("x");
    const g2 = makeGroup([x]);
    env.sb.gBrowser.tabGroups.push(g2);
    env.api.attachTreeChild(x, p);
    assert.equal(x.group, null);
    assert.ok(!g2.tabs.includes(x));
    assert.equal(env.api.getTreeParent(x), p);
    assert.equal(env.api.getTreeLevel(x), 1);
  });

  it("re-attach of an already-grouped link is a no-op", () => {
    const env = makeEnv();
    const p = env.addTab("p");
    const g = makeGroup([p]);
    env.sb.gBrowser.tabGroups.push(g);
    const x = env.addTab("x");
    env.api.attachTreeChild(x, p);
    const before = env.order().slice();
    env.api.attachTreeChild(x, p);
    assert.equal(x.group, g);
    assert.equal(env.api.getTreeParent(x), p);
    assert.deepEqual(env.order(), before);
  });
});

describe("indent never crosses group edges", () => {
  it("skips grouped predecessors for an earlier same-group tab", () => {
    const env = makeEnv();
    const p = env.addTab("p");
    makeGroup([p]);
    const r = env.addTab("r");
    // seed is the only preceding ungrouped tab: r indents under seed,
    // never under the grouped p.
    assert.equal(env.api.indentTreeTab(r), true);
    assert.equal(env.api.getTreeParent(r), env.seed);
    assert.equal(env.api.getTreeLevel(r), 1);
  });

  it("refuses when no same-group predecessor exists", () => {
    const env = makeEnv();
    const p = env.addTab("p");
    makeGroup([env.seed, p]);
    const r = env.addTab("r");
    assert.equal(env.api.indentTreeTab(r), false);
    assert.equal(env.api.getTreeLevel(r), 0);
    assert.equal(env.api.getTreeParent(r), null);
  });

  it("refuses to indent a grouped tab under an ungrouped predecessor", () => {
    const env = makeEnv();
    const p = env.addTab("p");
    const r = env.addTab("r");
    makeGroup([r]);
    assert.equal(env.api.indentTreeTab(r), false);
    assert.equal(env.api.getTreeLevel(r), 0);
  });

  it("indents within the same group", () => {
    const env = makeEnv();
    const p = env.addTab("p");
    const r = env.addTab("r");
    const g = makeGroup([p, r]);
    env.sb.gBrowser.tabGroups.push(g);
    assert.equal(env.api.indentTreeTab(r), true);
    assert.equal(env.api.getTreeParent(r), p);
    assert.equal(r.group, g);
  });
});

describe("drop adoption never crosses group edges", () => {
  it("an outsider dropped inside a grouped block stays Level 0", () => {
    const env = makeEnv();
    const p = env.addTab("p");
    const c1 = env.addTab("c1");
    env.api.attachTreeChild(c1, p);
    const g = makeGroup([p, c1]);
    env.sb.gBrowser.tabGroups.push(g);
    const x = env.addTab("x");
    env.userMove(x, env.tabs.indexOf(c1));
    assert.deepEqual(env.order(), ["seed", "p", "x", "c1"]);
    assert.equal(env.api.getTreeLevel(x), 0);
    assert.equal(x.group, null, "drops never change group membership");
  });

  it("a grouped tab dropped inside its own family adopts", () => {
    const env = makeEnv();
    const p = env.addTab("p");
    const c1 = env.addTab("c1");
    env.api.attachTreeChild(c1, p);
    const x = env.addTab("x");
    const g = makeGroup([p, c1, x]);
    env.sb.gBrowser.tabGroups.push(g);
    env.userMove(x, env.tabs.indexOf(c1));
    assert.equal(env.api.getTreeParent(x), p);
    assert.equal(env.api.getTreeLevel(x), 1);
  });
});

describe("legacy cross-group edges read absent and heal", () => {
  it("reports no parent, no level, no children until healed", () => {
    const env = makeEnv();
    const p = env.addTab("p");
    const g = makeGroup([p]);
    env.sb.gBrowser.tabGroups.push(g);
    const x = env.addTab("x");
    env.api.attachTreeChild(x, p);
    assert.equal(x.group, g);
    // Simulate a legacy crossing: membership left, link stayed.
    env.sb.gBrowser.ungroupTab(x);
    env.flushTimeouts();
    assert.equal(x.group, null);
    assert.equal(env.api.getTreeParent(x), null);
    assert.equal(env.api.getTreeLevel(x), 0);
    // Length check (not array equality): the bundle runs in node:vm,
    // so its arrays live in another realm and strict deep-equality on
    // prototypes fails across the boundary.
    assert.equal(env.api.getTreeChildren(p).length, 0);
  });

  it("healTreeLinks clears cross-group parent links", () => {
    const env = makeEnv();
    const p = env.addTab("p");
    const g = makeGroup([p]);
    env.sb.gBrowser.tabGroups.push(g);
    const x = env.addTab("x");
    env.api.attachTreeChild(x, p);
    env.sb.gBrowser.ungroupTab(x);
    env.flushTimeouts();
    env.api.healTreeLinks();
    const stored = env.tabVals.get(x).aphTreeParent;
    assert.ok(!stored, `parent link cleared, got ${stored}`);
    env.api.renderTree();
    assert.equal(x.getAttribute("data-aph-level"), "0");
  });
});

describe("carry keeps families grouped", () => {
  it("dragging a grouped parent carries grouped children along", () => {
    const env = makeEnv();
    const p = env.addTab("p");
    const c1 = env.addTab("c1");
    env.api.attachTreeChild(c1, p);
    const tail = env.addTab("tail");
    const g = makeGroup([p, c1]);
    env.sb.gBrowser.tabGroups.push(g);
    env.userMove(p, env.tabs.length);
    assert.deepEqual(env.order(), ["seed", "tail", "p", "c1"]);
    assert.equal(env.api.getTreeParent(c1), p);
    assert.equal(p.group, g);
    assert.equal(c1.group, g);
  });
});

describe("subtree follows the parent across group edges", () => {
  // The harness userMove only reorders (stock's implicit membership
  // changes don't exist in mocks), so tests apply the stock half of the
  // drop explicitly (silent membership set ~ auto-join/ungroup) and let
  // the TabMove handler do the Aph half (align + carry).
  it("dragging a parent into a group brings its children in", () => {
    const env = makeEnv();
    const p = env.addTab("p");
    const c1 = env.addTab("c1");
    env.api.attachTreeChild(c1, p);
    const gx = env.addTab("gx");
    const tail = env.addTab("tail");
    const g = makeGroup([gx]);
    env.sb.gBrowser.tabGroups.push(g);
    // Stock drop: p lands next to gx and auto-joins.
    env.tabs.splice(env.tabs.indexOf(p), 1);
    env.tabs.splice(env.tabs.indexOf(gx) + 1, 0, p);
    p.group = g;
    g.tabs.push(p);
    env.fire("TabMove", p);
    env.flushTimeouts();
    assert.equal(c1.group, g);
    assert.equal(env.api.getTreeParent(c1), p);
    assert.equal(env.api.getTreeLevel(c1), 1);
    assert.deepEqual(env.order(), ["seed", "gx", "p", "c1", "tail"]);
  });

  it("dragging a parent out ejects its children with it", () => {
    const env = makeEnv();
    const p = env.addTab("p");
    const c1 = env.addTab("c1");
    env.api.attachTreeChild(c1, p);
    const tail = env.addTab("tail");
    const g = makeGroup([p, c1]);
    env.sb.gBrowser.tabGroups.push(g);
    // Stock drop out: p leaves to the end and ungroups (the mock
    // ungroupTab fires TabMove synchronously, like stock #handleTabMove,
    // so the eject-guard path is exercised for real).
    env.tabs.splice(env.tabs.indexOf(p), 1);
    env.tabs.push(p);
    env.sb.gBrowser.ungroupTab(p);
    env.flushTimeouts();
    assert.equal(p.group, null);
    assert.equal(c1.group, null);
    assert.equal(env.api.getTreeParent(c1), p);
    assert.equal(env.api.getTreeLevel(c1), 1);
    assert.deepEqual(env.order(), ["seed", "tail", "p", "c1"]);
  });

  it("a positional move that keeps membership only carries", () => {
    // Convergence case: stock moved p out without changing membership
    // (no implicit ungroup) — no mismatch, so carry alone runs and the
    // grouped family stays whole.
    const env = makeEnv();
    const p = env.addTab("p");
    const c1 = env.addTab("c1");
    env.api.attachTreeChild(c1, p);
    const tail = env.addTab("tail");
    const g = makeGroup([p, c1]);
    env.sb.gBrowser.tabGroups.push(g);
    env.userMove(p, env.tabs.length);
    assert.deepEqual(env.order(), ["seed", "tail", "p", "c1"]);
    assert.equal(p.group, g);
    assert.equal(c1.group, g);
    assert.equal(env.api.getTreeParent(c1), p);
  });

  it("a whole three-level subtree follows into the group", () => {
    const env = makeEnv();
    const root = env.addTab("root");
    const mid = env.addTab("mid");
    env.api.attachTreeChild(mid, root);
    const leaf = env.addTab("leaf");
    env.api.attachTreeChild(leaf, mid);
    const gx = env.addTab("gx");
    const g = makeGroup([gx]);
    env.sb.gBrowser.tabGroups.push(g);
    env.tabs.splice(env.tabs.indexOf(root), 1);
    env.tabs.splice(env.tabs.indexOf(gx) + 1, 0, root);
    root.group = g;
    g.tabs.push(root);
    env.fire("TabMove", root);
    env.flushTimeouts();
    assert.equal(mid.group, g);
    assert.equal(leaf.group, g);
    assert.equal(env.api.getTreeLevel(mid), 1);
    assert.equal(env.api.getTreeLevel(leaf), 2);
    assert.deepEqual(env.order(), ["seed", "gx", "root", "mid", "leaf"]);
  });

  it("multiselect drag into a group keeps selected family linked", () => {
    const env = makeEnv();
    const p = env.addTab("p");
    const c1 = env.addTab("c1");
    env.api.attachTreeChild(c1, p);
    const gx = env.addTab("gx");
    const g = makeGroup([gx]);
    env.sb.gBrowser.tabGroups.push(g);
    // Stock joins the whole moving set (verified addTabs(movingTabs)).
    env.tabs.splice(env.tabs.indexOf(p), 1);
    env.tabs.splice(env.tabs.indexOf(c1), 1);
    env.tabs.splice(env.tabs.indexOf(gx) + 1, 0, p, c1);
    for (const t of [p, c1]) {
      t.group = g;
      g.tabs.push(t);
    }
    env.setSelectedTabs([p, c1]);
    env.fire("TabMove", p);
    env.fire("TabMove", c1);
    env.flushTimeouts();
    assert.equal(p.group, g);
    assert.equal(c1.group, g);
    assert.equal(env.api.getTreeParent(c1), p);
    assert.equal(env.api.getTreeLevel(c1), 1);
  });
});

describe("move-handler depth accounting", () => {
  // Every early return inside onTreeTabMove must balance its depth
  // increment (finally-guaranteed). A leaked counter climbs past the
  // re-entrancy cap and the top guard then disables ALL drag handling
  // permanently — parents drag alone, children never carried. Each test
  // below wedges a leaking implementation (>8 leaked) and passes fixed.
  it("stray unresolvable TabMoves do not wedge later drags", () => {
    const env = makeEnv();
    const p = env.addTab("p");
    const c1 = env.addTab("c1");
    env.api.attachTreeChild(c1, p);
    const tail = env.addTab("tail");
    for (let i = 0; i < 20; i++) {
      // No tab in target or detail and no tab duck-type: resolveMovedTab
      // returns null (early return inside the guarded region).
      env.fire("TabMove", {});
    }
    env.flushTimeouts();
    env.userMove(p, env.tabs.length);
    assert.deepEqual(env.order(), ["seed", "tail", "p", "c1"]);
    assert.equal(env.api.getTreeParent(c1), p);
  });

  it("guarded programmatic joins do not wedge later drags", () => {
    const env = makeEnv();
    const p = env.addTab("p");
    const tail = env.addTab("tail");
    const g = makeGroup([p]);
    env.sb.gBrowser.tabGroups.push(g);
    // Each birth-join dispatches a synchronous nested TabMove that the
    // group-op guard skips (early return inside the guarded region).
    for (let i = 1; i <= 10; i++) {
      const k = env.addTab(`k${i}`);
      env.api.attachTreeChild(k, p);
    }
    env.flushTimeouts();
    env.userMove(p, env.tabs.length);
    assert.deepEqual(env.order(), [
      "seed", "tail", "p",
      "k1", "k2", "k3", "k4", "k5", "k6", "k7", "k8", "k9", "k10",
    ]);
    assert.equal(env.api.getTreeChildren(p).length, 10);
  });

  it("repeated parent drags keep carrying (no slow leak)", () => {
    const env = makeEnv();
    const p = env.addTab("p");
    const c1 = env.addTab("c1");
    env.api.attachTreeChild(c1, p);
    env.addTab("tail");
    // Each finished carry used to leak one level via its early return.
    for (let i = 0; i < 5; i++) {
      env.userMove(p, env.tabs.length);
      env.userMove(p, 1);
    }
    assert.deepEqual(env.order(), ["seed", "p", "c1", "tail"]);
    assert.equal(env.api.getTreeParent(c1), p);
    assert.equal(env.api.getTreeLevel(c1), 1);
    // And one more drag past the old cap still carries.
    env.userMove(p, env.tabs.length);
    assert.deepEqual(env.order(), ["seed", "tail", "p", "c1"]);
  });
});

describe("group move events", () => {
  it("registers TabGroupMoved alongside create/update/remove", () => {
    const env = makeEnv();
    for (const t of ["TabGroupCreate", "TabGroupUpdate", "TabGroupRemoved", "TabGroupMoved"]) {
      assert.ok(
        (env.containerHandlers[t] || []).length >= 1,
        `${t} listener registered`
      );
    }
  });
});
