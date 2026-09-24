// Dock drag-to-workspace guards (65-dock.js): tab/tree/group drags expand
// the dock to all 9 workspaces, plus accepts drops to a fresh workspace,
// current workspace rejects, and native tab payloads fall back to selection.
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { run, makeTab, makeFakeNode: fakeNode, makeSessionStore, makeCi, makeChromeUtils } = require("./helpers");

const TAB_TYPE = "application/x-moz-tabbrowser-tab";

function makeEnv() {
  const tabVals = new WeakMap();
  const tabs = [];
  const containerHandlers = {};
  const windowHandlers = {};
  const prefStore = {};
  const identities = {
    getPublicIdentityFromId: () => null,
    getPublicIdentities: () => [],
    create: () => { throw new Error("unused"); },
    remove: () => {},
  };
  let sel = null;

  const anchor = fakeNode("box");
  const popupSet = fakeNode("popupset");
  const dockEl = { el: null };
  const doc = {
    readyState: "complete",
    popupNode: null,
    getElementById: (id) => {
      if (id === "vertical-tabs") return anchor;
      if (id === "sidebar-container") return { hidden: false };
      if (id === "mainPopupSet") return popupSet;
      if (id === "aph-ws-dock") return anchor.children.find((c) => c.id === "aph-ws-dock") || null;
      if (id === "aph-ws-dock-menu") return popupSet.children.find((c) => c.id === "aph-ws-dock-menu") || null;
      if (id === "navigator-toolbox") {
        return { querySelector: () => null, setAttribute() {}, removeAttribute() {} };
      }
      if (id === "nav-bar") {
        return { prepend() {}, querySelector: () => null, setAttribute() {}, removeAttribute() {} };
      }
      return null;
    },
    createElement: (tag) => fakeNode(tag),
    createXULElement: (localName) => fakeNode(localName),
    createEvent: () => ({ initEvent() {} }),
  };

  const sb = {
    URL,
    window: {
      opener: null,
      addEventListener(t, fn) { (windowHandlers[t] = windowHandlers[t] || []).push(fn); },
      removeEventListener() {},
      prompt() { return null; },
    },
    navigator: { onLine: true },
    document: doc,
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
      discardBrowser() {},
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
        _ws: {},
        setAttribute(k, v) { this._ws[k] = v; },
        getAttribute(k) { return this._ws[k]; },
        removeAttribute(k) { delete this._ws[k]; },
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
    ChromeUtils: makeChromeUtils(identities),
    Ci: makeCi(),
  };
  sb.window.window = sb.window;
  const seed = makeTab(tabVals, { label: "seedpin", ws: "1", spec: "https://seed.example/", pinned: true });
  tabs.push(seed);
  sel = seed;
  seed.selected = true;
  run("workspaces.js", sb);

  const dock = () => anchor.children.find((c) => c.id === "aph-ws-dock") || null;
  const pills = () => (dock() ? dock().children.filter((c) => (c.className || "").includes("aph-ws-pill") && !(c.className || "").includes("aph-ws-add")) : []);
  const plus = () => (dock() ? dock().children.find((c) => (c.className || "").includes("aph-ws-add")) || null : null);
  return {
    sb, tabs, tabVals, containerHandlers, windowHandlers, anchor, dock, pills, plus,
    api: sb.window.AphWorkspaces,
    select(t) { sb.gBrowser.selectedTab = t; },
    fireDragstart(target) {
      for (const fn of containerHandlers.dragstart || []) fn({ target, dataTransfer: {} });
    },
    fireDragend() {
      for (const fn of windowHandlers.dragend || []) fn({});
    },
  };
}

function addTab(env, o) {
  const t = makeTab(env.tabVals, Object.assign(
    { label: "t", ws: "1", spec: "https://example.com/" }, o || {}
  ));
  t._isTab = true;
  t.closest = (sel) => (sel === "tab" ? t : null);
  env.tabs.push(t);
  return t;
}

function pillWs(pill) {
  return pill.getAttribute("data-ws");
}

function makeGroup(tabs) {
  const g = { tabs: tabs.slice(), collapsed: false, hidden: false };
  for (const t of tabs) t.group = g;
  g.closest = (sel) => (sel === "tab-group" ? g : null);
  return g;
}

function dragOver(pill) {
  let prevented = false;
  pill.fire("dragover", {
    preventDefault() { prevented = true; },
    dataTransfer: { dropEffect: "", types: [] },
  });
  return prevented;
}

describe("dock drop indicator + strip shielding", () => {
  it("pill dragover stops propagation so the strip never shove-animates", () => {
    const env = makeEnv();
    const a = addTab(env, { label: "a", ws: "1" });
    addTab(env, { label: "c", ws: "2" });
    env.select(a);
    env.api.renderDock();
    env.fireDragstart(a);
    const pill2 = env.pills().find((p) => pillWs(p) === "2");
    let prevented = false;
    let stopped = false;
    pill2.fire("dragover", {
      preventDefault() { prevented = true; },
      stopPropagation() { stopped = true; },
      dataTransfer: { dropEffect: "", types: [] },
    });
    assert.ok(prevented, "dragover allows the drop");
    assert.ok(stopped, "dragover shields the tab strip");
    assert.ok(pill2.classList.contains("drop-target"), "highlight shows");
  });

  it("chrome tab payload (mozTypesAt) arms the drop with no tracker", () => {
    const env = makeEnv();
    const a = addTab(env, { label: "a", ws: "1" });
    addTab(env, { label: "c", ws: "2" });
    env.select(a);
    env.api.renderDock();
    // No dragstart fired: stock dragstart was swallowed before our listener.
    const pill2 = env.pills().find((p) => pillWs(p) === "2");
    let prevented = false;
    let stopped = false;
    pill2.fire("dragover", {
      preventDefault() { prevented = true; },
      stopPropagation() { stopped = true; },
      dataTransfer: {
        dropEffect: "",
        mozItemCount: 1,
        mozTypesAt: () => ["application/x-moz-tabbrowser-tab"],
        types: [],
      },
    });
    assert.ok(prevented, "chrome payload arms dragover");
    assert.ok(stopped, "shield applies to fallback path too");
  });
});

describe("dock deferred move (live tab-drag session)", () => {
  it("drop during a live drag defers the move until dragend", () => {
    const env = makeEnv();
    const a = addTab(env, { label: "a", ws: "1" });
    addTab(env, { label: "c", ws: "2" });
    env.select(a);
    // Live Firefox session marker (startTabDrag sets this; dragend deletes).
    a._dragData = { movingTabs: [a] };
    env.api.renderDock();
    env.fireDragstart(a);
    const pill5 = env.pills().find((p) => pillWs(p) === "5");
    let stopped = false;
    pill5.fire("drop", {
      preventDefault() {},
      stopPropagation() { stopped = true; },
      dataTransfer: {},
    });
    assert.ok(stopped, "drop shields the strip");
    assert.equal(
      (env.tabVals.get(a) || {}).aphWs,
      "1",
      "no retag mid-drag: strip session still active"
    );
    delete a._dragData;
    env.fireDragend();
    assert.equal((env.tabVals.get(a) || {}).aphWs, "5", "move lands after dragend");
    assert.deepEqual(env.pills().map(pillWs).sort(), ["1", "2", "5"]);
  });

  it("plus drop during a live drag defers to the fresh workspace", () => {
    const env = makeEnv();
    const a = addTab(env, { label: "a", ws: "1" });
    addTab(env, { label: "c", ws: "2" });
    env.select(a);
    a._dragData = { movingTabs: [a] };
    env.api.renderDock();
    env.fireDragstart(a);
    const plus = env.plus();
    plus.fire("drop", {
      preventDefault() {},
      stopPropagation() {},
      dataTransfer: {},
    });
    assert.equal((env.tabVals.get(a) || {}).aphWs, "1", "still deferred");
    delete a._dragData;
    env.fireDragend();
    assert.equal((env.tabVals.get(a) || {}).aphWs, "3");
  });
});

describe("dock drag-to-workspace", () => {
  it("dragstart expands to all 9 workspaces with empties marked", () => {
    const env = makeEnv();
    const a = addTab(env, { label: "a", ws: "1" });
    addTab(env, { label: "c", ws: "2" });
    env.select(a);
    env.api.renderDock();
    assert.deepEqual(env.pills().map(pillWs).sort(), ["1", "2"]);
    env.fireDragstart(a);
    const ids = env.pills().map(pillWs).sort();
    assert.deepEqual(ids, ["1", "2", "3", "4", "5", "6", "7", "8", "9"]);
    const pill5 = env.pills().find((p) => pillWs(p) === "5");
    assert.equal(pill5.getAttribute("data-empty"), "1");
    assert.equal(env.dock().getAttribute("data-aph-dragging"), "1");
    env.fireDragend();
    assert.deepEqual(env.pills().map(pillWs).sort(), ["1", "2"]);
  });

  it("drop on an empty workspace pill moves the tab there", () => {
    const env = makeEnv();
    const a = addTab(env, { label: "a", ws: "1" });
    addTab(env, { label: "c", ws: "2" });
    env.select(a);
    env.api.renderDock();
    env.fireDragstart(a);
    const pill5 = env.pills().find((p) => pillWs(p) === "5");
    assert.ok(dragOver(pill5), "empty pill allows dragover");
    pill5.fire("drop", { preventDefault() {}, dataTransfer: {} });
    assert.equal((env.tabVals.get(a) || {}).aphWs, "5");
  });

  it("drop on the current workspace is a no-op", () => {
    const env = makeEnv();
    const a = addTab(env, { label: "a", ws: "1" });
    env.select(a);
    env.api.renderDock();
    env.fireDragstart(a);
    const pill1 = env.pills().find((p) => pillWs(p) === "1");
    assert.equal(dragOver(pill1), false, "current pill rejects dragover");
    pill1.fire("drop", { preventDefault() {}, dataTransfer: {} });
    assert.equal((env.tabVals.get(a) || {}).aphWs, "1");
  });

  it("drop on plus moves to the lowest inactive workspace", () => {
    const env = makeEnv();
    const a = addTab(env, { label: "a", ws: "1" });
    addTab(env, { label: "c", ws: "2" });
    env.select(a);
    env.api.renderDock();
    env.fireDragstart(a);
    const plus = env.plus();
    assert.ok(plus, "plus exists during drag");
    let prevented = false;
    plus.fire("dragover", {
      preventDefault() { prevented = true; },
      dataTransfer: { dropEffect: "", types: [] },
    });
    assert.ok(prevented, "plus allows dragover");
    plus.fire("drop", { preventDefault() {}, dataTransfer: {} });
    assert.equal((env.tabVals.get(a) || {}).aphWs, "3");
  });

  it("group-header drag moves the whole group", () => {
    const env = makeEnv();
    const g1 = addTab(env, { label: "g1", ws: "1" });
    const g2 = addTab(env, { label: "g2", ws: "1" });
    const g = makeGroup([g1, g2]);
    env.sb.gBrowser.tabGroups.push(g);
    env.select(g1);
    env.api.renderDock();
    // Header element: closest("tab") misses, closest("tab-group") hits.
    const header = {
      closest: (sel) => (sel === "tab-group" ? g : null),
    };
    env.fireDragstart(header);
    const pill2 = env.pills().find((p) => pillWs(p) === "2");
    // WS2 is empty but visible in drag-mode (all 9 shown).
    assert.ok(pill2 || env.pills().length === 9, "drag-mode shows WS2");
    const target = env.pills().find((p) => pillWs(p) === "2");
    target.fire("drop", { preventDefault() {}, dataTransfer: {} });
    assert.equal((env.tabVals.get(g1) || {}).aphWs, "2");
    assert.equal((env.tabVals.get(g2) || {}).aphWs, "2");
    assert.equal(g1.group, g);
    assert.equal(g2.group, g);
  });

  it("native tab payload without tracker falls back to selection", () => {
    const env = makeEnv();
    const a = addTab(env, { label: "a", ws: "1" });
    addTab(env, { label: "c", ws: "2" });
    env.select(a);
    env.api.renderDock();
    // No dragstart: dragover carries the Firefox tab type directly.
    const pill2 = env.pills().find((p) => pillWs(p) === "2");
    let prevented = false;
    pill2.fire("dragover", {
      preventDefault() { prevented = true; },
      dataTransfer: { dropEffect: "", types: [TAB_TYPE] },
    });
    assert.ok(prevented, "tab-type dragover arms the drop");
    pill2.fire("drop", {
      preventDefault() {},
      dataTransfer: { types: [TAB_TYPE] },
    });
    assert.equal((env.tabVals.get(a) || {}).aphWs, "2");
  });
});
