// Regression guards for the workspace dock (workspaces bundle,
// 65-dock.js): pill set/labels, click switch, "+" jump, per-workspace
// close/unload, binding helpers, and the right-click menu. The real
// bundle runs in node:vm with Firefox globals mocked (same shape as
// tests/workspaces.test.js and tests/pinreset.test.js).
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { run, makeTab, makeFakeNode: fakeNode, makeSessionStore, makeCi, makeChromeUtils } = require("./helpers");

const tabVals = new WeakMap();

function makeEnv(prefs, identityService) {
  const tabs = [];
  const containerHandlers = {};
  const prompts = [];
  const prefStore = Object.assign({}, prefs || {});
  const identities = identityService || {
    getPublicIdentityFromId: (id) =>
      id === 7 ? { name: "Work", color: "blue", icon: "briefcase" } : null,
    getPublicIdentities: () => ([
      { userContextId: 1, name: "Personal", color: "green", icon: "user" },
      { userContextId: 7, name: "Work", color: "blue", icon: "briefcase" },
    ]),
    create: () => { throw new Error("unused"); },
    remove: () => {},
  };
  let sel = null;

  const anchor = fakeNode("box");
  const popupSet = fakeNode("popupset");
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
    createElementNS: (ns, tag) => fakeNode(tag),
    createXULElement: (localName) => fakeNode(localName),
    createEvent: () => ({ initEvent() {} }),
  };

  const sb = {
    URL,
    window: {
      opener: null,
      addEventListener() {},
      removeEventListener() {},
      AphPalette: { prompt(opts) { prompts.push(opts); } },
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
      discardBrowser(t) {
        t.discarded = true;
        t.setAttribute("pending", "");
      },
      ungroupTab() {},
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
  // Seed one pinned tab before load: init's forced switchTo would open a
  // fresh newtab for a tabless window (reconcile never strands tabless).
  // Pinned tabs are invisible to pills/counts/close/unload.
  const seed = makeTab(tabVals, { label: "seedpin", ws: "1", spec: "https://seed.example/", pinned: true });
  tabs.push(seed);
  sel = seed;
  seed.selected = true;
  run("workspaces.js", sb);

  const dock = () => anchor.children.find((c) => c.id === "aph-ws-dock") || null;
  const menu = () => popupSet.children.find((c) => c.id === "aph-ws-dock-menu") || null;
  const pills = () => (dock() ? dock().children.filter((c) => (c.className || "").includes("aph-ws-pill") && !(c.className || "").includes("aph-ws-add")) : []);
  const plus = () => (dock() ? dock().children.find((c) => (c.className || "").includes("aph-ws-add")) || null : null);
  return {
    sb, tabs, containerHandlers, prompts, prefStore, anchor, popupSet,
    dock, menu, pills, plus,
    api: sb.window.AphWorkspaces,
    select(t) { sb.gBrowser.selectedTab = t; },
  };
}

function addTab(env, o) {
  const t = makeTab(tabVals, Object.assign(
    { label: "t", ws: "1", spec: "https://example.com/" }, o || {}
  ));
  // Tabs resolve their triggerNode-style lookup in DnD via closest("tab").
  t._isTab = true;
  t.closest = (sel) => (sel === "tab" ? t : null);
  env.tabs.push(t);
  return t;
}

function pillWs(pill) {
  return pill.getAttribute("data-ws");
}

function firePill(pill, type, ev) {
  pill.fire(type, ev);
}

function openMenuFor(env, pill) {
  const m = env.menu();
  assert.ok(m, "dock menu exists");
  env.sb.document.popupNode = pill;
  m.fire("popupshowing", { currentTarget: m, target: m });
  return m;
}

function menuLabels(m) {
  return m.children.map((c) => c.getAttribute("label"));
}

describe("workspace dock", () => {
  it("renders pills for active workspaces plus current plus [+]", () => {
    const env = makeEnv();
    const a = addTab(env, { label: "a", ws: "1" });
    addTab(env, { label: "b", ws: "1" });
    addTab(env, { label: "c", ws: "2" });
    env.select(a);
    env.api.renderDock();
    assert.deepEqual(env.pills().map(pillWs), ["1", "2"]);
    assert.ok(env.plus(), "plus pill present");
  });

  it("labels named workspaces with the first grapheme and shows counts", () => {
    const env = makeEnv({ "aph.workspaces.names": JSON.stringify({ 2: "💼 Work" }) });
    const a = addTab(env, { label: "a", ws: "1" });
    addTab(env, { label: "a2", ws: "1" });
    addTab(env, { label: "c", ws: "2" });
    env.select(a);
    env.api.renderDock();
    const byWs = {};
    for (const p of env.pills()) byWs[pillWs(p)] = p;
    assert.equal(byWs["2"].textContent, "💼");
    const count = byWs["1"].children.find((c) => c.className === "aph-ws-count");
    assert.equal(count && count.textContent, "2");
  });

  it("Aph key renders a geometric mark, not text", () => {
    const env = makeEnv();
    const a = addTab(env, { label: "a", ws: "1" });
    env.select(a);
    env.api.renderDock();
    const key = env.dock().children.find((c) => c.className === "aph-dock-aph");
    assert.ok(key, "Aph key present");
    assert.equal(key.textContent, "");
    assert.equal(key.getAttribute("aria-label"), "Aph menu");
    const svg = key.children.find((c) => c.localName === "svg");
    assert.ok(svg, "mark present");
    assert.equal(svg.getAttribute("viewBox"), "0 0 14 14");
    const rects = svg.children.filter((c) => c.localName === "rect");
    assert.equal(rects.length, 4);
    assert.equal(rects[0].getAttribute("fill"), "currentColor");
    for (const r of rects.slice(1)) {
      assert.equal(r.getAttribute("fill"), "none");
      assert.equal(r.getAttribute("stroke"), "currentColor");
    }
  });

  it("clicking a pill switches workspace", () => {
    const env = makeEnv();
    const a = addTab(env, { label: "a", ws: "1" });
    addTab(env, { label: "c", ws: "2" });
    env.select(a);
    env.api.renderDock();
    const pill2 = env.pills().find((p) => pillWs(p) === "2");
    firePill(pill2, "click", {});
    assert.equal(env.api.getCurrent(), "2");
  });

  it("plus jumps to the lowest inactive workspace and opens a tab", () => {
    const env = makeEnv();
    const a = addTab(env, { label: "a", ws: "1" });
    addTab(env, { label: "c", ws: "2" });
    env.select(a);
    env.api.renderDock();
    firePill(env.plus(), "click", {});
    assert.equal(env.api.getCurrent(), "3");
    assert.ok(env.tabs.some((t) => (tabVals.get(t) || {}).aphWs === "3"), "new tab tagged 3");
  });

  it("plus with all 9 active pulses instead of switching", () => {
    const env = makeEnv();
    let first = null;
    for (let i = 1; i <= 9; i++) {
      const t = addTab(env, { label: `w${i}`, ws: String(i) });
      if (i === 1) first = t;
    }
    env.select(first);
    env.api.renderDock();
    assert.deepEqual(env.pills().map(pillWs).sort(), ["1", "2", "3", "4", "5", "6", "7", "8", "9"]);
    firePill(env.plus(), "click", {});
    assert.equal(env.api.getCurrent(), "1");
    assert.equal(env.tabs.length, 10, "no tab opened (9 + seed)");
  });

  it("drop on a pill retags the dragged tab", () => {
    const env = makeEnv();
    const a = addTab(env, { label: "a", ws: "1" });
    addTab(env, { label: "c", ws: "2" });
    env.select(a);
    env.api.renderDock();
    env.containerHandlers.dragstart.forEach((fn) => fn({ target: a }));
    const pill2 = env.pills().find((p) => pillWs(p) === "2");
    firePill(pill2, "dragover", { preventDefault() {}, dataTransfer: {} });
    assert.ok(pill2.classList.contains("drop-target"));
    firePill(pill2, "drop", { preventDefault() {}, dataTransfer: {} });
    assert.equal((tabVals.get(a) || {}).aphWs, "2");
  });

  it("close removes unpinned workspace tabs and skips pins", () => {
    const env = makeEnv();
    const a = addTab(env, { label: "a", ws: "1" });
    addTab(env, { label: "c1", ws: "2" });
    addTab(env, { label: "c2", ws: "2" });
    addTab(env, { label: "pin", ws: "2", pinned: true });
    env.select(a);
    const res = env.api.closeWorkspaceTabs("2");
    assert.equal(res.closed, 2);
    assert.deepEqual(env.tabs.map((t) => t.label).sort(), ["a", "pin", "seedpin"]);
  });

  it("close of the current workspace switches to a neighbor first", () => {
    const env = makeEnv();
    const a = addTab(env, { label: "a", ws: "1" });
    const c = addTab(env, { label: "c", ws: "2" });
    env.select(c);
    assert.equal(env.api.getCurrent(), "1", "starts on 1 (tags do not switch)");
    env.api.switchTo("2");
    const res = env.api.closeWorkspaceTabs("2");
    assert.equal(res.closed, 1);
    assert.equal(env.api.getCurrent(), "1");
    assert.ok(!env.tabs.includes(c));
    assert.ok(env.tabs.includes(a));
  });

  it("close of the sole workspace aborts", () => {
    const env = makeEnv();
    const a = addTab(env, { label: "a", ws: "1" });
    env.select(a);
    const res = env.api.closeWorkspaceTabs("1");
    assert.equal(res.closed, 0);
    assert.equal(env.api.getCurrent(), "1");
    assert.ok(env.tabs.includes(a));
  });

  it("workspace-scoped unload only discards that workspace", () => {
    const env = makeEnv();
    const a = addTab(env, { label: "a", ws: "1", spec: "https://a.example/" });
    const b = addTab(env, { label: "b", ws: "2", spec: "https://b.example/" });
    const c = addTab(env, { label: "c", ws: "2", spec: "https://c.example/" });
    addTab(env, { label: "pin", ws: "2", pinned: true, spec: "https://p.example/" });
    env.select(a);
    const res = env.api.unloadEligibleTabs({ scope: "workspace", ws: "2" });
    assert.equal(res.unloaded, 2);
    assert.ok(b.discarded && c.discarded);
    assert.ok(!a.discarded);
  });

  it("binding helpers validate, list, and clear", () => {
    const env = makeEnv();
    assert.equal(env.api.setWsBinding("2", 999).ok, false);
    assert.equal(env.api.setWsBinding("2", 7).ok, true);
    assert.deepEqual(
      JSON.parse(env.prefStore["aph.workspaces.containerBindings"] || "{}"), { 2: 7 }
    );
    assert.equal(env.api.listContainers().length, 2);
    assert.equal(env.api.setWsBinding("2", 0).ok, true);
    assert.deepEqual(
      JSON.parse(env.prefStore["aph.workspaces.containerBindings"] || "{}"), {}
    );
  });

  it("right-click menu offers rename/unload/close with guards", () => {
    const env = makeEnv();
    const a = addTab(env, { label: "a", ws: "1" });
    addTab(env, { label: "c", ws: "2" });
    env.select(a);
    env.api.renderDock();
    const pill2 = env.pills().find((p) => pillWs(p) === "2");
    const m = openMenuFor(env, pill2);
    const labels = menuLabels(m);
    assert.ok(labels.some((l) => l && l.startsWith("Rename")), `rename present: ${labels}`);
    assert.ok(labels.includes("Unload Inactive Tabs"));
    assert.ok(labels.some((l) => l && l.startsWith("Close Workspace")));
    // Unload is disabled on the current workspace.
    const pill1 = env.pills().find((p) => pillWs(p) === "1");
    const m1 = openMenuFor(env, pill1);
    const unload = m1.children.find((c) => c.getAttribute("label") === "Unload Inactive Tabs");
    assert.equal(unload.getAttribute("disabled"), "true");
  });

  it("rename commits through the palette prompt", () => {
    const env = makeEnv();
    const a = addTab(env, { label: "a", ws: "1" });
    env.select(a);
    env.api.renderDock();
    const pill1 = env.pills().find((p) => pillWs(p) === "1");
    const m = openMenuFor(env, pill1);
    const rename = m.children.find((c) => (c.getAttribute("label") || "").startsWith("Rename"));
    rename.fire("command", {});
    assert.equal(env.prompts.length, 1);
    env.prompts[0].onCommit("Ops");
    assert.equal(JSON.parse(env.prefStore["aph.workspaces.names"] || "{}")["1"], "Ops");
  });

  it("bind submenu applies the chosen container", () => {
    const env = makeEnv();
    const a = addTab(env, { label: "a", ws: "1" });
    env.select(a);
    env.api.renderDock();
    const pill1 = env.pills().find((p) => pillWs(p) === "1");
    const m = openMenuFor(env, pill1);
    const bind = m.children.find((c) => c.localName === "menu");
    assert.ok(bind, "bind submenu present");
    const sub = bind.children.find((c) => c.localName === "menupopup");
    const work = sub.children.find((c) => c.getAttribute("label") === "Work");
    assert.ok(work, "Work container listed");
    work.fire("command", {});
    assert.deepEqual(
      JSON.parse(env.prefStore["aph.workspaces.containerBindings"] || "{}"), { 1: 7 }
    );
  });

  it("nested submenu showing does not rebuild the parent menu", () => {
    const env = makeEnv();
    const a = addTab(env, { label: "a", ws: "1" });
    env.select(a);
    env.api.renderDock();
    const pill1 = env.pills().find((p) => pillWs(p) === "1");
    const m = openMenuFor(env, pill1);
    const before = m.children.slice();
    const bind = m.children.find((c) => c.localName === "menu");
    const sub = bind.children.find((c) => c.localName === "menupopup");
    // The submenu's popupshowing bubbles to the parent listener: it must
    // be ignored or the bind menu is ripped out mid-open (flicker loop).
    m.fire("popupshowing", { currentTarget: m, target: sub });
    assert.deepEqual(m.children, before, "parent menu untouched by nested showing");
    assert.ok(m.children.includes(bind), "bind submenu survives");
  });

  it("resolves stock l10n-only containers to names, not Container N", () => {
    // Stock Firefox defaults carry l10nId instead of name.
    const stock = {
      getPublicIdentityFromId: (id) =>
        id === 1
          ? { userContextId: 1, color: "blue", icon: "fingerprint", l10nId: "user-context-personal" }
          : id === 2
            ? { userContextId: 2, color: "orange", icon: "briefcase", l10nId: "user-context-work" }
            : null,
      getPublicIdentities: () => ([
        { userContextId: 1, color: "blue", icon: "fingerprint", l10nId: "user-context-personal" },
        { userContextId: 2, color: "orange", icon: "briefcase", l10nId: "user-context-work" },
      ]),
      getUserContextLabel: (id) => (id === 1 ? "Personal" : id === 2 ? "Work" : ""),
      create: () => { throw new Error("unused"); },
      remove: () => {},
    };
    const env = makeEnv(undefined, stock);
    assert.equal(env.api.describeContainer(1).name, "Personal");
    assert.equal(env.api.describeContainer(2).name, "Work");
    assert.equal(
      [...env.api.listContainers()].map((c) => c.name).join("|"),
      "Personal|Work"
    );
    // Without getUserContextLabel the static l10n map still resolves.
    const noLabel = Object.assign({}, stock);
    delete noLabel.getUserContextLabel;
    const env2 = makeEnv(undefined, noLabel);
    assert.equal(env2.api.describeContainer(1).name, "Personal");
  });
});
