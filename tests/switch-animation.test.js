// Switch animation (workspaces/60-indicator-switch.js): the commit is
// synchronous, so the switch reads as two calm signals — a rim bloom on
// the card plus incoming tabs gliding 6px as one unified plane (no
// stagger, no fade). Pinned tabs never animate (they are global),
// hidden tabs stay out, the card never dips.
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

function makeLayer() {
  const classes = new Set();
  return {
    id: "",
    style: {},
    offsetWidth: 0,
    classList: {
      add: (c) => classes.add(c),
      remove: (c) => classes.delete(c),
      contains: (c) => classes.has(c),
    },
  };
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
    getBoundingClientRect: () => ({ left: 10, top: 20, width: 800, height: 600 }),
  };
  let bloomLayer = null;
  const prefStore = {};
  let sel = null;
  const sb = {
    // Real timers (see run()): this is the only suite asserting
    // timer-driven removals (glide release). No other suite is affected.
    __aphRealTimers: true,
    window: { addEventListener() {}, removeEventListener() {}, opener: null },
    navigator: { onLine: true },
    document: {
      readyState: "complete",
      getElementById: (id) => {
        if (id === "tabbrowser-tabbox") return tabboxEl;
        if (id === "aph-ws-bloom") return bloomLayer;
        return null;
      },
      documentElement: {
        _attrs: {},
        setAttribute(k, v) { this._attrs[k] = v; },
        getAttribute(k) { return this._attrs[k]; },
        hasAttribute(k) { return k in this._attrs; },
        appendChild(el) {
          if (el && el.id === "aph-ws-bloom") bloomLayer = el;
          return el;
        },
      },
      createElement: () => makeLayer(),
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
  return { api, tabs, addTab, doc: sb.document, tabboxEl, get sel() { return sel; }, bloom: () => bloomLayer };
}

describe("switch animation", () => {
  it("glides incoming unpinned tabs in, leaves the departed workspace out", () => {
    const { api, addTab } = makeEnv();
    const a = addTab("a", { ws: "1" });
    const b = addTab("b", { ws: "2" });
    api.switchTo("2");
    assert.ok(b.classList.contains("aph-ws-enter-up"), "incoming tab glides in");
    assert.ok(!a.classList.contains("aph-ws-enter-up"), "departed (now hidden) tab does not animate");
    assert.ok(!a.classList.contains("aph-ws-enter-down"), "departed tab carries no direction either");
    assert.ok(a.hidden, "departed tab still hides synchronously");
    api.switchTo("1");
    assert.ok(a.classList.contains("aph-ws-enter-down"), "return switch glides the other way");
    assert.ok(b.hidden, "departed tab still hides synchronously");
  });

  it("rises when ascending, sinks when descending", () => {
    const { api, addTab } = makeEnv();
    addTab("a", { ws: "1" });
    const c = addTab("c", { ws: "3" });
    api.switchTo("3");
    assert.ok(c.classList.contains("aph-ws-enter-up"), "1->3 rises from below");
    assert.ok(!c.classList.contains("aph-ws-enter-down"));
  });

  it("moves every arrival as one plane with no stagger", () => {
    const env = makeEnv();
    env.addTab("home", { ws: "1" });
    const incoming = [];
    for (let i = 0; i < 10; i++) {
      incoming.push(env.addTab(`t${i}`, { ws: "2" }));
    }
    env.api.switchTo("2");
    for (const t of incoming) {
      assert.ok(t.classList.contains("aph-ws-enter-up"), "every arrival shares one class");
      assert.ok(!t.classList.contains("aph-ws-enter-down"), "no tab takes the other direction");
    }
  });

  it("never animates pinned tabs (global, always visible)", () => {
    const { api, addTab } = makeEnv();
    const pin = addTab("pin", { ws: "1", pinned: true });
    addTab("other", { ws: "2" });
    api.switchTo("2");
    assert.ok(!pin.hidden, "pin stays visible");
    assert.ok(!pin.classList.contains("aph-ws-enter-up"), "pin does not glide");
    assert.ok(!pin.classList.contains("aph-ws-enter-down"), "pin takes no direction");
  });

  it("switchLocal animates too (same settle path)", () => {
    const { api, addTab } = makeEnv();
    addTab("a", { ws: "1" });
    const b = addTab("b", { ws: "2" });
    api.switchLocal("2");
    assert.ok(b.classList.contains("aph-ws-enter-up"), "incoming tab glides in");
  });

  it("strikes the bloom on the card rect and re-arms on respawn", () => {
    const { api, addTab, bloom } = makeEnv();
    addTab("a", { ws: "1" });
    addTab("b", { ws: "2" });
    api.switchTo("2");
    const layer = bloom();
    assert.ok(layer, "bloom layer created under documentElement");
    assert.equal(layer.style.left, "10px", "rect-locked to the card");
    assert.equal(layer.style.top, "20px");
    assert.equal(layer.style.width, "800px");
    assert.equal(layer.style.height, "600px");
    assert.ok(layer.classList.contains("on"), "bloom struck");
    api.switchTo("1");
    assert.ok(bloom().classList.contains("on"), "re-strike re-arms the same layer");
  });

  it("never dips the card (the dissolve is gone)", () => {
    const { api, addTab, tabboxEl } = makeEnv();
    addTab("a", { ws: "1" });
    addTab("b", { ws: "2" });
    api.switchTo("2");
    assert.ok(!tabboxEl.classList.contains("aph-ws-dip"), "no dip class ever lands");
  });

  it("clears glide classes after the fade", async () => {
    const env = makeEnv();
    env.addTab("home", { ws: "1" });
    const incoming = [];
    for (let i = 0; i < 9; i++) {
      incoming.push(env.addTab(`t${i}`, { ws: "2" }));
    }
    env.api.switchTo("2");
    assert.ok(incoming[0].classList.contains("aph-ws-enter-up"), "glide applied");
    await new Promise((r) => setTimeout(r, 300));
    for (const t of incoming) {
      assert.ok(!t.classList.contains("aph-ws-enter-up"), "class released");
      assert.ok(!t.classList.contains("aph-ws-enter-down"), "other direction clear too");
    }
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

  it("records a debugLastSwitch breadcrumb for console diagnosis", () => {
    const { api, addTab } = makeEnv();
    addTab("a", { ws: "1" });
    addTab("b", { ws: "3" });
    api.switchTo("3");
    assert.deepEqual(
      { from: api.debugLastSwitch().from, to: api.debugLastSwitch().to, dir: api.debugLastSwitch().dir },
      { from: "1", to: "3", dir: 1 }
    );
    assert.equal(typeof api.debugLastSwitch().at, "number", "timestamp present");
    api.switchTo("1");
    assert.equal(api.debugLastSwitch().dir, -1, "descending records -1");
    assert.equal(api.debugLastSwitch().to, "1");
  });

  it("no-ops without a style API (bare stubs never throw)", () => {
    const { api, addTab } = makeEnv();
    addTab("a", { ws: "1" });
    const b = addTab("b", { ws: "2" });
    assert.ok(!("style" in b) || !b.style.setProperty, "stub has no style API");
    api.switchTo("2");
    assert.ok(b.classList.contains("aph-ws-enter-up"), "class still applies");
  });
});
