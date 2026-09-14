// Regression guards for automatic 2-level tab trees (workspaces bundle,
// 45-tree-tabs.js): opener parenting, L2 cap, placement, collapse/expand,
// selection safety, parent-close promotion, drag rules, workspace scope,
// manual indent/outdent repair, rail element injection.
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { run, makeTab } = require("./helpers");

// Minimal fake-DOM surface for syncTreeChrome/syncTreeRails: real tabs
// expose querySelector/appendChild; the plain mocks above deliberately
// don't (chrome injection no-ops on them). Only the selectors and node
// ops the bundle touches are implemented.
function fakeHasClass(node, cls) {
  try {
    return String(node.className || "").split(/\s+/).includes(cls);
  } catch (e) {
    return false;
  }
}

function fakeDescendants(node) {
  const out = [];
  (function walk(n) {
    for (const c of n.children || []) {
      out.push(c);
      walk(c);
    }
  })(node);
  return out;
}

function makeFakeEl(tag, cls) {
  const el = {
    tag: tag || "span",
    className: cls || "",
    children: [],
    parentNode: null,
    _attrs: {},
    setAttribute(k, v) { this._attrs[k] = String(v); },
    getAttribute(k) { return k in this._attrs ? this._attrs[k] : null; },
    removeAttribute(k) { delete this._attrs[k]; },
    addEventListener() {},
    removeEventListener() {},
    appendChild(c) { c.parentNode = this; this.children.push(c); return c; },
    prepend(c) { c.parentNode = this; this.children.unshift(c); return c; },
    removeChild(c) {
      const i = this.children.indexOf(c);
      if (i !== -1) this.children.splice(i, 1);
      c.parentNode = null;
      return c;
    },
    remove() {
      if (this.parentNode) this.parentNode.removeChild(this);
    },
    closest(sel) {
      if (sel === "tab") {
        let cur = this;
        while (cur) {
          if (cur.isTab) return cur;
          cur = cur.parentNode;
        }
      }
      return null;
    },
    querySelector(sel) {
      const m = String(sel).match(/\.([\w-]+)/);
      if (!m) return null;
      const pool = String(sel).includes(":scope")
        ? this.children || []
        : fakeDescendants(this);
      return pool.find((c) => fakeHasClass(c, m[1])) || null;
    },
  };
  return el;
}

function makeDomTab(tabVals, o) {
  const t = makeTab(tabVals, o);
  t.isTab = true;
  t.children = [];
  const content = makeFakeEl("div", "tab-content");
  content.parentNode = t;
  t.children.push(content);
  t.querySelector = makeFakeEl("x", "").querySelector;
  t.appendChild = function (c) { c.parentNode = this; this.children.push(c); return c; };
  t.prepend = function (c) { c.parentNode = this; this.children.unshift(c); return c; };
  t.removeChild = function (c) {
    const i = this.children.indexOf(c);
    if (i !== -1) this.children.splice(i, 1);
    c.parentNode = null;
    return c;
  };
  t.remove = function () {
    if (this.parentNode) this.parentNode.removeChild(this);
  };
  t.closest = function (sel) { return sel === "tab" ? this : null; };
  return t;
}

function railsOf(tab) {
  const out = [];
  for (const c of tab.children || []) {
    if (fakeHasClass(c, "aph-tree-rail")) out.push(c.className);
  }
  return out.sort();
}

function makeEnv() {
  const tabVals = new WeakMap();
  const tabs = [];
  const containerHandlers = {};
  const prefStore = {};
  const moves = [];
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
        // Strict mirror of stock tabbrowser.moveTabTo(element, { tabIndex }):
        // a bare numeric index is a bug (stock misroutes it to strip end).
        if (!opts || typeof opts !== "object" || !Number.isInteger(opts.tabIndex)) {
          throw new Error("moveTabTo requires { tabIndex }");
        }
        const idx = opts.tabIndex;
        const cur = tabs.indexOf(t);
        if (cur === -1) return;
        // Stock semantics: idx is the final index. Remove-then-insert.
        tabs.splice(cur, 1);
        tabs.splice(Math.max(0, Math.min(idx, tabs.length)), 0, t);
      },
      ungroupTab() {},
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
  sb.window.window = sb.window;
  const seed = makeTab(tabVals, { label: "seed", ws: "1", spec: "https://seed.example/" });
  tabs.push(seed);
  sel = seed;
  seed.selected = true;
  run("workspaces.js", sb);
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
  // Simulate a user drag: reorder without the programmatic ignore flag,
  // then dispatch TabMove like Firefox does.
  function userMove(tab, toIndex) {
    const cur = tabs.indexOf(tab);
    assert.ok(cur !== -1, "dragged tab in strip");
    tabs.splice(cur, 1);
    tabs.splice(Math.max(0, Math.min(toIndex, tabs.length)), 0, tab);
    fire("TabMove", tab);
  }
  const order = () => tabs.map((t) => t.label);
  const level = (t) => api.getTreeLevel(t);
  return { sb, api, tabs, tabVals, containerHandlers, moves, addTab, fire, userMove, order, level, seed,
    select(t) { sb.gBrowser.selectedTab = t; } };
}

describe("tree creation and placement", () => {
  it("links opener tabs as L1 children placed directly below the parent", () => {
    const env = makeEnv();
    const parent = env.addTab("parent");
    const unrelated = env.addTab("unrelated");
    const child = env.addTab("child");
    env.api.attachTreeChild(child, parent);
    assert.equal(env.level(child), 1);
    assert.equal(env.level(parent), 0);
    assert.deepEqual(env.order(), ["seed", "parent", "child", "unrelated"]);
    assert.equal(child.getAttribute("data-aph-level"), "1");
    assert.equal(parent.getAttribute("data-aph-has-kids"), "1");
  });

  it("places a second child below the parent's last existing child", () => {
    const env = makeEnv();
    const parent = env.addTab("parent");
    const c1 = env.addTab("c1");
    const tail = env.addTab("tail");
    env.api.attachTreeChild(c1, parent);
    const c2 = env.addTab("c2");
    env.api.attachTreeChild(c2, parent);
    assert.deepEqual(env.order(), ["seed", "parent", "c1", "c2", "tail"]);
  });

  it("caps depth at L2: children of L2 become L2 siblings", () => {
    const env = makeEnv();
    const root = env.addTab("root");
    const mid = env.addTab("mid");
    env.api.attachTreeChild(mid, root);
    assert.equal(env.level(mid), 1);
    const leaf = env.addTab("leaf");
    env.api.attachTreeChild(leaf, mid);
    assert.equal(env.level(leaf), 2);
    const over = env.addTab("over");
    env.api.attachTreeChild(over, leaf);
    assert.equal(env.level(over), 2);
    // Sibling under the same L1, not a deeper level.
    assert.equal(env.api.getTreeParent(over), env.api.getTreeParent(leaf));
    assert.deepEqual(env.order(), ["seed", "root", "mid", "leaf", "over"]);
  });

  it("manual tabs without an opener stay Level 0", () => {
    const env = makeEnv();
    const manual = env.addTab("manual");
    env.api.attachTreeChild(manual, null);
    assert.equal(env.level(manual), 0);
    assert.equal(manual.getAttribute("data-aph-level"), "0");
    assert.equal(manual.getAttribute("data-aph-has-kids"), null);
  });

  it("TabOpen with an opener parents; without stays a root", () => {
    const env = makeEnv();
    const parent = env.addTab("parent");
    env.select(parent);
    const linked = env.addTab("linked");
    linked.openerTab = parent;
    env.fire("TabOpen", linked);
    assert.equal(env.level(linked), 1);
    const manual = env.addTab("manual2");
    env.fire("TabOpen", manual);
    assert.equal(env.level(manual), 0);
  });

  it("pinned tabs are always Level 0 and never take a parent", () => {
    const env = makeEnv();
    const parent = env.addTab("parent");
    const pin = env.addTab("pin", { pinned: true });
    env.api.attachTreeChild(pin, parent);
    assert.equal(env.level(pin), 0);
    assert.equal(pin.getAttribute("data-aph-level"), "0");
  });
});

describe("collapse and expand", () => {
  it("collapsing hides descendants and sets badge attrs; expanding restores", () => {
    const env = makeEnv();
    const parent = env.addTab("parent");
    const c1 = env.addTab("c1");
    const c2 = env.addTab("c2");
    env.api.attachTreeChild(c1, parent);
    env.api.attachTreeChild(c2, parent);
    env.select(parent);
    assert.equal(env.api.setTreeCollapsed(parent, true), true);
    assert.equal(c1.hidden, true);
    assert.equal(c2.hidden, true);
    assert.equal(parent.getAttribute("data-aph-collapsed"), "1");
    assert.equal(parent.getAttribute("data-aph-collapsed-count"), "2");
    env.api.setTreeCollapsed(parent, false);
    assert.equal(c1.hidden, false);
    assert.equal(c2.hidden, false);
    assert.equal(parent.getAttribute("data-aph-collapsed"), null);
  });

  it("collapsing a parent holding the selection moves selection to the parent", () => {
    const env = makeEnv();
    const parent = env.addTab("parent");
    const kid = env.addTab("kid");
    env.api.attachTreeChild(kid, parent);
    env.select(kid);
    env.api.setTreeCollapsed(parent, true);
    assert.equal(env.sb.gBrowser.selectedTab, parent);
    assert.equal(parent.hidden, false);
    assert.equal(kid.hidden, true);
  });

  it("selecting a hidden child auto-expands its ancestors", () => {
    const env = makeEnv();
    const parent = env.addTab("parent");
    const kid = env.addTab("kid");
    env.api.attachTreeChild(kid, parent);
    env.select(parent);
    env.api.setTreeCollapsed(parent, true);
    assert.equal(kid.hidden, true);
    env.select(kid);
    env.fire("TabSelect", kid);
    // Auto-expand unhides without stealing selection.
    assert.equal(env.api.isTreeCollapsed(parent), false);
    assert.equal(kid.hidden, false);
    assert.equal(env.sb.gBrowser.selectedTab, kid);
  });

  it("childless tabs refuse collapse (no chevron)", () => {
    const env = makeEnv();
    const lone = env.addTab("lone");
    assert.equal(env.api.setTreeCollapsed(lone, true), false);
    assert.equal(lone.getAttribute("data-aph-collapsed"), null);
  });
});

describe("tab closure promotion", () => {
  it("closing a parent promotes children in place, grandchildren shift left", () => {
    const env = makeEnv();
    const root = env.addTab("root");
    const tail = env.addTab("tail");
    // Build root -> mid -> leaf, then move tail after the subtree.
    const mid = env.addTab("mid");
    env.api.attachTreeChild(mid, root);
    const leaf = env.addTab("leaf");
    env.api.attachTreeChild(leaf, mid);
    env.tabs.splice(env.tabs.indexOf(tail), 1);
    env.tabs.push(tail);
    assert.deepEqual(env.order(), ["seed", "root", "mid", "leaf", "tail"]);
    // Simulate TabClose for root (still in strip at event time).
    env.fire("TabClose", root);
    env.sb.gBrowser.removeTab(root);
    env.api.renderTree();
    assert.equal(env.level(mid), 0);
    assert.equal(env.level(leaf), 1);
    assert.deepEqual(env.order(), ["seed", "mid", "leaf", "tail"]);
  });

  it("closing the last child clears the parent chevron", () => {
    const env = makeEnv();
    const parent = env.addTab("parent");
    const kid = env.addTab("kid");
    env.api.attachTreeChild(kid, parent);
    assert.equal(parent.getAttribute("data-aph-has-kids"), "1");
    env.fire("TabClose", kid);
    env.sb.gBrowser.removeTab(kid);
    env.api.renderTree();
    assert.equal(parent.getAttribute("data-aph-has-kids"), null);
    assert.equal(env.api.getTreeChildren(parent).length, 0);
  });
});

describe("manual drag rules", () => {
  it("dragging a parent carries its subtree block with it", () => {
    const env = makeEnv();
    const p = env.addTab("p");
    const c1 = env.addTab("c1");
    const c2 = env.addTab("c2");
    const tail = env.addTab("tail");
    env.api.attachTreeChild(c1, p);
    env.api.attachTreeChild(c2, p);
    assert.deepEqual(env.order(), ["seed", "p", "c1", "c2", "tail"]);
    env.userMove(p, env.tabs.length); // drag parent to the end
    assert.deepEqual(env.order(), ["seed", "tail", "p", "c1", "c2"]);
    assert.equal(env.level(c1), 1);
    assert.equal(env.level(c2), 1);
  });

  it("dragging a child outside its block detaches to Level 0", () => {
    const env = makeEnv();
    const p = env.addTab("p");
    const c1 = env.addTab("c1");
    const c2 = env.addTab("c2");
    const other = env.addTab("other");
    env.api.attachTreeChild(c1, p);
    env.api.attachTreeChild(c2, p);
    env.userMove(c1, env.tabs.indexOf(other) + 1); // drop past an outsider
    assert.equal(env.level(c1), 0);
    assert.equal(env.level(c2), 1);
  });

  it("reordering a child inside its block keeps the link", () => {
    const env = makeEnv();
    const p = env.addTab("p");
    const c1 = env.addTab("c1");
    const c2 = env.addTab("c2");
    env.api.attachTreeChild(c1, p);
    env.api.attachTreeChild(c2, p);
    // Swap c1/c2 positions (both stay inside the parent block).
    env.userMove(c2, env.tabs.indexOf(p) + 1);
    assert.equal(env.level(c1), 1);
    assert.equal(env.level(c2), 1);
    assert.equal(env.api.getTreeParent(c2), p);
  });
});

describe("workspace scope and persistence", () => {
  it("children follow the opener workspace tag", () => {
    const env = makeEnv();
    env.api.switchTo("1");
    const parent = env.addTab("parent");
    env.api.switchTo("2");
    // Parent lives on WS1; a link opened from it joins WS1, not WS2.
    const child = env.addTab("child");
    env.api.attachTreeChild(child, parent);
    assert.equal(env.tabVals.get(child).aphWs, "1");
  });

  it("sending a tab to another workspace detaches it to Level 0", () => {
    const env = makeEnv();
    const parent = env.addTab("parent");
    const kid = env.addTab("kid");
    env.api.attachTreeChild(kid, parent);
    env.select(kid);
    env.api.sendTabTo("2");
    assert.equal(env.tabVals.get(kid).aphWs, "2");
    assert.equal(env.level(kid), 0);
    assert.equal(env.api.getTreeChildren(parent).length, 0);
  });

  it("tree links persist in SessionStore; cross-workspace edges heal", () => {
    const env = makeEnv();
    const parent = env.addTab("parent");
    const kid = env.addTab("kid");
    env.api.attachTreeChild(kid, parent);
    assert.ok(env.tabVals.get(kid).aphTreeParent, "parent link stored");
    assert.ok(env.tabVals.get(parent).aphTreeId, "parent id stored");
    // Corrupt the edge across workspaces; heal drops it to Level 0.
    env.tabVals.get(kid).aphWs = "2";
    env.api.healTreeLinks();
    env.api.renderTree();
    assert.equal(env.level(kid), 0);
  });

  it("workspace switch never selects a tree-collapsed descendant", () => {
    const env = makeEnv();
    const parent = env.addTab("parent");
    const kid = env.addTab("kid");
    const other = env.addTab("other", { ws: "2" });
    env.api.attachTreeChild(kid, parent);
    env.select(parent);
    env.api.setTreeCollapsed(parent, true);
    env.api.switchTo("2");
    env.api.switchTo("1");
    assert.equal(env.sb.gBrowser.selectedTab, parent);
    assert.ok(!other.selected);
  });
});

describe("drag robustness (live-browser shapes)", () => {
  // Firefox-like mover: splices AND synchronously dispatches TabMove, so
  // every programmatic placement/carry re-enters the handler. Must
  // terminate with the block correctly ordered (no ignore-flags involved).
  function armSyncMoves(env) {
    const orig = env.sb.gBrowser.moveTabTo;
    env.sb.gBrowser.moveTabTo = (t, idx) => {
      orig(t, idx);
      for (const fn of env.containerHandlers.TabMove || []) {
        fn({ target: t, detail: {} });
      }
    };
  }

  it("attach + carry converge under synchronous TabMove dispatch", () => {
    const env = makeEnv();
    armSyncMoves(env);
    const p = env.addTab("p");
    const c1 = env.addTab("c1");
    const c2 = env.addTab("c2");
    const tail = env.addTab("tail");
    env.api.attachTreeChild(c1, p);
    env.api.attachTreeChild(c2, p);
    assert.deepEqual(env.order(), ["seed", "p", "c1", "c2", "tail"]);
    // User drags the parent to the end via the stock mover (fires TabMove).
    env.sb.gBrowser.moveTabTo(p, { tabIndex: env.tabs.length - 1 });
    for (const fn of env.containerHandlers.TabMove || []) {
      fn({ target: p, detail: {} });
    }
    assert.deepEqual(env.order(), ["seed", "tail", "p", "c1", "c2"]);
    assert.equal(env.level(c1), 1);
    assert.equal(env.level(c2), 1);
  });

  it("detach still works when the move event arrives synchronously", () => {
    const env = makeEnv();
    armSyncMoves(env);
    const p = env.addTab("p");
    const c1 = env.addTab("c1");
    const other = env.addTab("other");
    env.api.attachTreeChild(c1, p);
    env.sb.gBrowser.moveTabTo(c1, { tabIndex: env.tabs.indexOf(other) + 1 });
    for (const fn of env.containerHandlers.TabMove || []) {
      fn({ target: c1, detail: {} });
    }
    assert.equal(env.level(c1), 0);
  });

  it("drives the stock mover with { tabIndex } object form", () => {
    // Regression guard for the real bug: a bare numeric index makes stock
    // moveTabTo misroute the tab to the strip end (verified in omni.ja).
    const env = makeEnv();
    const p = env.addTab("p");
    env.addTab("tail");
    const c1 = env.addTab("c1");
    env.api.attachTreeChild(c1, p);
    assert.deepEqual(env.order(), ["seed", "p", "c1", "tail"]);
    assert.ok(env.moves.length > 0, "placement used the stock mover");
    for (const m of env.moves) {
      assert.equal(typeof m, "object");
      assert.ok(Number.isInteger(m.tabIndex), `integer tabIndex, got ${JSON.stringify(m)}`);
    }
  });

  it("falls back to splice order when no stock mover exists", () => {
    const env = makeEnv();
    delete env.sb.gBrowser.moveTabTo;
    delete env.sb.gBrowser.moveTab;
    const p = env.addTab("p");
    const c1 = env.addTab("c1");
    const tail = env.addTab("tail");
    env.api.attachTreeChild(c1, p);
    assert.deepEqual(env.order(), ["seed", "p", "c1", "tail"]);
    env.userMove(p, env.tabs.length);
    assert.deepEqual(env.order(), ["seed", "tail", "p", "c1"]);
  });

  it("resolves the moved tab from event detail when target is the container", () => {
    const env = makeEnv();
    const p = env.addTab("p");
    const c1 = env.addTab("c1");
    const c2 = env.addTab("c2");
    const tail = env.addTab("tail");
    env.api.attachTreeChild(c1, p);
    env.api.attachTreeChild(c2, p);
    // Drag the parent to the end; deliver TabMove addressed at the
    // container with the tab carried in detail.
    const cur = env.tabs.indexOf(p);
    env.tabs.splice(cur, 1);
    env.tabs.push(p);
    env.fire("TabMove", env.sb.gBrowser.tabContainer, { detail: { tab: p } });
    assert.deepEqual(env.order(), ["seed", "tail", "p", "c1", "c2"]);
  });
});

describe("drop adoption (outsider lands inside a block)", () => {
  it("adopts an unrelated tab dropped between parent and child", () => {
    const env = makeEnv();
    const p = env.addTab("p");
    const c1 = env.addTab("c1");
    env.addTab("tail");
    env.api.attachTreeChild(c1, p);
    const x = env.addTab("x");
    assert.deepEqual(env.order(), ["seed", "p", "c1", "tail", "x"]);
    env.userMove(x, env.tabs.indexOf(c1)); // wedge between p and c1
    assert.deepEqual(env.order(), ["seed", "p", "x", "c1", "tail"]);
    assert.equal(env.level(x), 1);
    assert.equal(env.api.getTreeParent(x), p);
  });

  it("adopts between grandparent levels as a sibling (L2)", () => {
    const env = makeEnv();
    const root = env.addTab("root");
    const mid = env.addTab("mid");
    env.api.attachTreeChild(mid, root);
    const leaf = env.addTab("leaf");
    env.api.attachTreeChild(leaf, mid);
    const x = env.addTab("x");
    env.userMove(x, env.tabs.indexOf(leaf)); // between mid (L1) and leaf (L2)
    assert.equal(env.level(x), 2);
    assert.equal(env.api.getTreeParent(x), mid);
  });

  it("joins the preceding family when dropped directly below its last child", () => {
    const env = makeEnv();
    const p = env.addTab("p");
    const c1 = env.addTab("c1");
    env.api.attachTreeChild(c1, p);
    const r2 = env.addTab("r2");
    const x = env.addTab("x");
    env.userMove(x, env.tabs.indexOf(r2)); // between c1 and r2
    assert.deepEqual(env.order(), ["seed", "p", "c1", "x", "r2"]);
    assert.equal(env.api.getTreeParent(x), p);
  });

  it("stays Level 0 between two roots and at the very top", () => {
    const env = makeEnv();
    const r1 = env.addTab("r1");
    const r2 = env.addTab("r2");
    const x = env.addTab("x");
    env.userMove(x, env.tabs.indexOf(r2)); // between r1 and r2
    assert.equal(env.level(x), 0);
    env.userMove(x, 0); // very top of the strip
    assert.deepEqual(env.order()[0], "x");
    assert.equal(env.level(x), 0);
  });

  it("re-parents a child dragged into another family", () => {
    const env = makeEnv();
    const p1 = env.addTab("p1");
    const c1 = env.addTab("c1");
    env.api.attachTreeChild(c1, p1);
    const p2 = env.addTab("p2");
    const c2 = env.addTab("c2");
    env.api.attachTreeChild(c2, p2);
    env.userMove(c1, env.tabs.indexOf(c2)); // between p2 and c2
    assert.equal(env.api.getTreeParent(c1), p2);
    assert.equal(env.level(c1), 1);
    assert.equal(env.api.getTreeChildren(p1).length, 0);
    assert.equal(p1.getAttribute("data-aph-has-kids"), null);
  });
});

describe("manual indent / outdent repair", () => {
  it("indent makes an L0 root a child of the tab above", () => {
    const env = makeEnv();
    const r1 = env.addTab("r1");
    const r2 = env.addTab("r2");
    assert.equal(env.api.indentTreeTab(r2), true);
    assert.equal(env.level(r2), 1);
    assert.equal(env.api.getTreeParent(r2), r1);
    assert.deepEqual(env.order(), ["seed", "r1", "r2"]);
  });

  it("indent defaults to the selected tab and skips closing predecessors", () => {
    const env = makeEnv();
    const p1 = env.addTab("p1");
    const closing = env.addTab("closing");
    const x = env.addTab("x");
    closing.closing = true;
    env.select(x);
    assert.equal(env.api.indentTreeTab(), true);
    assert.equal(env.api.getTreeParent(x), p1);
    assert.equal(env.level(x), 1);
  });

  it("indent is a no-op for the first tab, pinned tabs, and same-parent repeats", () => {
    const env = makeEnv();
    assert.equal(env.api.indentTreeTab(env.seed), false);
    const p = env.addTab("p");
    const pin = env.addTab("pin", { pinned: true });
    assert.equal(env.api.indentTreeTab(pin), false);
    const c = env.addTab("c");
    env.api.attachTreeChild(c, p);
    // Predecessor of c is p itself (already its parent) — no change.
    assert.equal(env.api.indentTreeTab(c), false);
    assert.equal(env.api.getTreeParent(c), p);
  });

  it("indent caps depth at L2 like attachTreeChild", () => {
    const env = makeEnv();
    const root = env.addTab("root");
    const mid = env.addTab("mid");
    env.api.attachTreeChild(mid, root);
    const leaf = env.addTab("leaf");
    env.api.attachTreeChild(leaf, mid);
    const x = env.addTab("x");
    assert.equal(env.api.indentTreeTab(x), true);
    assert.equal(env.level(x), 2);
    // Sibling under the same L1, not a deeper level.
    assert.equal(env.api.getTreeParent(x), mid);
  });

  it("indent carries the tab's subtree block with it", () => {
    const env = makeEnv();
    const p = env.addTab("p");
    const t = env.addTab("t");
    const x = env.addTab("x");
    const k = env.addTab("k");
    env.api.attachTreeChild(k, x);
    assert.equal(env.api.indentTreeTab(x), true);
    assert.equal(env.api.getTreeParent(x), t);
    assert.equal(env.api.getTreeParent(k), x);
    assert.equal(env.order().indexOf("k"), env.order().indexOf("x") + 1);
    void p;
  });

  it("outdent promotes L2→L1→L0 in place", () => {
    const env = makeEnv();
    const root = env.addTab("root");
    const mid = env.addTab("mid");
    env.api.attachTreeChild(mid, root);
    const leaf = env.addTab("leaf");
    env.api.attachTreeChild(leaf, mid);
    const before = env.order().slice();
    assert.equal(env.api.outdentTreeTab(leaf), true);
    assert.equal(env.level(leaf), 1);
    assert.equal(env.api.getTreeParent(leaf), root);
    assert.deepEqual(env.order(), before, "outdent keeps strip position");
    assert.equal(env.api.outdentTreeTab(leaf), true);
    assert.equal(env.level(leaf), 0);
    assert.equal(env.api.getTreeParent(leaf), null);
    assert.deepEqual(env.order(), before);
  });

  it("outdent is a no-op for L0 roots and pinned tabs; promote aliases outdent", () => {
    const env = makeEnv();
    const root = env.addTab("root");
    assert.equal(env.api.outdentTreeTab(root), false);
    const pin = env.addTab("pin", { pinned: true });
    assert.equal(env.api.outdentTreeTab(pin), false);
    const parent = env.addTab("parent");
    const kid = env.addTab("kid");
    env.api.attachTreeChild(kid, parent);
    assert.equal(env.api.promoteTreeTab(kid), true);
    assert.equal(env.level(kid), 0);
  });

  it("indenting an array indents a contiguous block as siblings", () => {
    const env = makeEnv();
    const p = env.addTab("p");
    const a = env.addTab("a");
    const b = env.addTab("b");
    const c = env.addTab("c");
    assert.equal(env.api.indentTreeTab([a, b, c]), true);
    assert.equal(env.api.getTreeParent(a), p);
    assert.equal(env.api.getTreeParent(b), p);
    assert.equal(env.api.getTreeParent(c), p);
    assert.deepEqual(env.order(), ["seed", "p", "a", "b", "c"]);
  });

  it("indent with no arg uses the live multiselection", () => {
    const env = makeEnv();
    const p = env.addTab("p");
    const a = env.addTab("a");
    const b = env.addTab("b");
    env.sb.gBrowser.selectedTabs = [a, b];
    assert.equal(env.api.indentTreeTab(), true);
    assert.equal(env.api.getTreeParent(a), p);
    assert.equal(env.api.getTreeParent(b), p);
  });

  it("explicit single-tab indent stays single even with a multiselection", () => {
    const env = makeEnv();
    const q = env.addTab("q");
    const m1 = env.addTab("m1");
    const m2 = env.addTab("m2");
    env.sb.gBrowser.selectedTabs = [m1, m2];
    assert.equal(env.api.indentTreeTab(m1), true);
    assert.equal(env.api.getTreeParent(m1), q);
    assert.equal(env.level(m2), 0);
  });

  it("multi indent/outdent lets selected descendants ride with their parent", () => {
    const env = makeEnv();
    const rp = env.addTab("rp");
    const pa = env.addTab("pa");
    const ch = env.addTab("ch");
    env.api.attachTreeChild(ch, pa);
    assert.equal(env.api.indentTreeTab([pa, ch]), true);
    assert.equal(env.api.getTreeParent(pa), rp);
    assert.equal(env.api.getTreeParent(ch), pa);
    assert.equal(env.level(ch), 2);

    const env2 = makeEnv();
    const r = env2.addTab("r");
    const p = env2.addTab("p");
    const k = env2.addTab("k");
    env2.api.attachTreeChild(p, r);
    env2.api.attachTreeChild(k, p);
    assert.equal(env2.api.outdentTreeTab([p, k]), true);
    assert.equal(env2.level(p), 0);
    assert.equal(env2.api.getTreeParent(k), p);
    assert.equal(env2.level(k), 1);
  });

  it("outdenting an array of siblings promotes each in place", () => {
    const env = makeEnv();
    const pp = env.addTab("pp");
    const x = env.addTab("x");
    const y = env.addTab("y");
    env.api.attachTreeChild(x, pp);
    env.api.attachTreeChild(y, pp);
    const before = env.order().slice();
    assert.equal(env.api.outdentTreeTab([x, y]), true);
    assert.equal(env.level(x), 0);
    assert.equal(env.level(y), 0);
    assert.deepEqual(env.order(), before);
  });
});

describe("rail element injection (fake DOM)", () => {
  function makeDomEnv() {
    const env = makeEnv();
    // Route element creation through the fake DOM so chrome injection runs.
    env.sb.document.createElement = (tag) => makeFakeEl(tag, "");
    function addDomTab(label, o) {
      const t = makeDomTab(env.tabVals, Object.assign(
        { label, ws: "1", spec: `https://${label}.example/` }, o || {}
      ));
      env.tabs.push(t);
      return t;
    }
    return { ...env, addDomTab };
  }

  it("L1 tabs get one inner rail, L0 roots and parents get none", () => {
    const env = makeDomEnv();
    const parent = env.addDomTab("parent");
    const child = env.addDomTab("child");
    env.api.attachTreeChild(child, parent);
    assert.deepEqual(railsOf(child), ["aph-tree-rail aph-tree-rail--inner"]);
    assert.deepEqual(railsOf(parent), []);
    assert.equal(env.sb.gBrowser.tabs.includes(child), true);
  });

  it("L2 tabs get inner + outer rails; outdent to L0 removes them", () => {
    const env = makeDomEnv();
    const root = env.addDomTab("root");
    const mid = env.addDomTab("mid");
    env.api.attachTreeChild(mid, root);
    const leaf = env.addDomTab("leaf");
    env.api.attachTreeChild(leaf, mid);
    assert.equal(env.level(leaf), 2);
    assert.deepEqual(railsOf(leaf), [
      "aph-tree-rail aph-tree-rail--inner",
      "aph-tree-rail aph-tree-rail--outer",
    ]);
    env.api.outdentTreeTab(leaf);
    env.api.outdentTreeTab(leaf);
    assert.equal(env.level(leaf), 0);
    assert.deepEqual(railsOf(leaf), []);
  });

  it("rails are idempotent across renders and never attach to pins", () => {
    const env = makeDomEnv();
    const parent = env.addDomTab("parent");
    const child = env.addDomTab("child");
    env.api.attachTreeChild(child, parent);
    env.api.renderTree();
    env.api.renderTree();
    env.api.renderTree();
    assert.deepEqual(railsOf(child), ["aph-tree-rail aph-tree-rail--inner"]);
    const pin = env.addDomTab("pin", { pinned: true });
    env.api.renderTree();
    assert.deepEqual(railsOf(pin), []);
  });

  it("debugTree snapshots levels, rails, and theme linkage", () => {
    const env = makeDomEnv();
    const root = env.addDomTab("root");
    const mid = env.addDomTab("mid");
    env.api.attachTreeChild(mid, root);
    const leaf = env.addDomTab("leaf");
    env.api.attachTreeChild(leaf, mid);
    const snap = env.api.debugTree();
    assert.equal(typeof snap, "object");
    assert.equal(snap.tabs.length, env.tabs.length);
    const byLabel = Object.fromEntries(snap.tabs.map((t) => [t.label, t]));
    assert.equal(byLabel.leaf.level, 2);
    assert.equal(byLabel.leaf.rails, 2);
    assert.equal(byLabel.mid.rails, 1);
    assert.equal(byLabel.root.rails, 0);
    assert.equal(byLabel.seed.level, 0);
  });
});
