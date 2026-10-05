// Regression guards for the workspace dock (workspaces bundle,
// 65-dock.js): pill set/labels, click switch, "+" jump, per-workspace
// close/unload, binding helpers, the right-click menu, and the Aph key
// menu. The real
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
  const rootEl = fakeNode("html");
  const prefObservers = {};
  const doc = {
    readyState: "complete",
    popupNode: null,
    documentElement: rootEl,
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
        addObserver(k, o) { prefObservers[k] = o; },
        removeObserver(k) { delete prefObservers[k]; },
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
    sb, tabs, containerHandlers, prompts, prefStore, prefObservers, anchor, popupSet,
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

  it("shows the bare number for named workspaces without icons, and shows counts", () => {
    const env = makeEnv({ "aph.workspaces.names": JSON.stringify({ 2: "💼 Work" }) });
    const a = addTab(env, { label: "a", ws: "1" });
    addTab(env, { label: "a2", ws: "1" });
    addTab(env, { label: "c", ws: "2" });
    env.select(a);
    env.api.renderDock();
    const byWs = {};
    for (const p of env.pills()) byWs[pillWs(p)] = p;
    // Letters retired: names live in tooltips/titles and the indicator.
    assert.equal(byWs["2"].textContent, "2");
    const count = byWs["1"].children.find((c) => c.className === "aph-ws-count");
    assert.equal(count && count.textContent, "2");
  });

  it("renders the icon mark when set, number otherwise", () => {
    const env = makeEnv({
      "aph.workspaces.names": JSON.stringify({ 2: "Work" }),
      "aph.workspaces.icons": JSON.stringify({ 2: "mail" }),
    });
    const a = addTab(env, { label: "a", ws: "1" });
    addTab(env, { label: "c", ws: "2" });
    env.select(a);
    env.api.renderDock();
    const byWs = {};
    for (const p of env.pills()) byWs[pillWs(p)] = p;
    assert.equal(byWs["1"].textContent, "1");
    const marked = byWs["2"];
    assert.equal(marked.textContent, "");
    const svg = marked.children.find((c) => c.localName === "svg");
    assert.ok(svg, "icon mark present");
    assert.equal(svg.getAttribute("viewBox"), "0 0 24 24");
    assert.equal(svg.getAttribute("stroke"), "currentColor");
    assert.equal(svg.getAttribute("aria-hidden"), "true");
    const shapes = svg.children.filter((c) => ["path", "rect", "circle"].includes(c.localName));
    assert.ok(shapes.length >= 2, "lucide shapes present");
  });

  it("validates icon keys on write and read", () => {
    const env = makeEnv();
    assert.equal(env.api.setWsIcon("2", "mail"), true);
    assert.equal(env.api.getWsIcon("2"), "mail");
    assert.equal(env.api.setWsIcon("3", "nope"), false);
    assert.equal(env.api.getWsIcon("3"), "");
    assert.equal(env.api.setWsIcon("x", "mail"), false);
    assert.equal(env.api.setWsIcon("10", "mail"), false);
    assert.equal(env.api.setWsIcon("2", ""), true);
    assert.equal(env.api.getWsIcon("2"), "");
  });

  it("ignores unknown icon keys persisted in the pref", () => {
    const env = makeEnv({
      "aph.workspaces.icons": JSON.stringify({ 2: "nope", 3: "mail" }),
    });
    assert.equal(env.api.getWsIcon("2"), "");
    assert.equal(env.api.getWsIcon("3"), "mail");
  });

  it("exposes the full vendored mark set", () => {
    const env = makeEnv();
    const keys = env.api.wsIconKeys();
    // No hardcoded count (the set grows over time): every key must carry
    // a label and render a non-empty mark.
    assert.ok(keys.length > 0, "icon set present");
    assert.equal(new Set(keys).size, keys.length, "icon keys unique");
    for (const k of keys) {
      assert.ok(env.api.wsIconLabel(k), k);
      const svg = env.api.wsIconSvg(k, 14);
      assert.ok(svg && svg.localName === "svg", k);
      assert.ok(svg.children.length > 0, k);
    }
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
    assert.equal(svg.getAttribute("width"), "16");
    assert.equal(svg.getAttribute("height"), "16");
    const rects = svg.children.filter((c) => c.localName === "rect");
    assert.equal(rects.length, 4);
    assert.equal(rects[0].getAttribute("fill"), "#4682b4");
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

  it("pill Enter/Space switch workspace like click", () => {
    const env = makeEnv();
    const a = addTab(env, { label: "a", ws: "1" });
    addTab(env, { label: "c", ws: "2" });
    addTab(env, { label: "d", ws: "3" });
    env.select(a);
    env.api.renderDock();
    const byWs = {};
    for (const p of env.pills()) byWs[pillWs(p)] = p;
    assert.equal(byWs["2"].getAttribute("tabindex"), "0");
    firePill(byWs["2"], "keydown", { key: "Enter", preventDefault() {} });
    assert.equal(env.api.getCurrent(), "2");
    const fresh = {};
    for (const p of env.pills()) fresh[pillWs(p)] = p;
    firePill(fresh["3"], "keydown", { key: " ", preventDefault() {} });
    assert.equal(env.api.getCurrent(), "3");
  });

  function openAphMenu(env) {
    const key = env.dock().children.find((c) => c.className === "aph-dock-aph");
    assert.ok(key, "Aph key present");
    key.fire("click", {});
    const m = env.popupSet.children.find((c) => c.id === "aph-aph-menu");
    assert.ok(m, "Aph menu created");
    m.fire("popupshowing", { currentTarget: m, target: m });
    return m;
  }

  it("Aph key Enter opens the menu", () => {
    const env = makeEnv();
    const a = addTab(env, { label: "a", ws: "1" });
    env.select(a);
    env.api.renderDock();
    const key = env.dock().children.find((c) => c.className === "aph-dock-aph");
    key.fire("keydown", { key: "Enter", preventDefault() {} });
    assert.ok(env.popupSet.children.find((c) => c.id === "aph-aph-menu"), "menu opened via keyboard");
  });

  it("Aph menu lists grouped rows with icons in order", () => {
    const env = makeEnv();
    const a = addTab(env, { label: "a", ws: "1" });
    env.select(a);
    env.api.renderDock();
    const m = openAphMenu(env);
    assert.deepEqual(menuLabels(m), [
      "Open Command Palette…",
      null,
      "Rename Workspace 1…",
      "Set Icon for Workspace 1…",
      "Bind Workspace 1 to Container…",
      "Stash Current Tab",
      "Open Stash",
      null,
      "Customize Sidebar…",
      "Aph Settings…",
      "Firefox Settings…",
      "Aph Welcome Tour",
      "About Aph",
    ]);
    assert.equal(m.children[0].getAttribute("shortcut"), "Ctrl+K");
    // Icon slots: stock 157 paints .menu-icon from the --menuitem-icon
    // var (theme.css §20b) — the classic image attribute alone renders
    // nothing. JS only flips the stock display-trigger classes; art
    // lives in CSS with context-fill ink.
    for (const c of m.children) {
      if (c.localName === "menuitem") {
        assert.ok(c.classList.contains("menuitem-iconic"), `${c.getAttribute("label")} iconic`);
        assert.equal(c.getAttribute("image"), null, "no dead image attr");
      }
    }
    const bind = m.children.find((c) => c.localName === "menu");
    assert.equal(bind.id, "aph-aph-bind");
    assert.ok(bind.classList.contains("menu-iconic"), "bind menu icon");
  });

  it("Firefox Settings row prefers native openPreferences, falls back to about:preferences", () => {
    const env = makeEnv();
    const a = addTab(env, { label: "a", ws: "1" });
    env.select(a);
    env.api.renderDock();
    let native = 0;
    env.sb.window.openPreferences = () => { native++; };
    const before = env.tabs.length;
    let m = openAphMenu(env);
    const row = m.children.find((c) => c.id === "aph-aph-firefox-settings");
    assert.ok(row, "firefox-settings row present");
    row.fire("command", {});
    assert.equal(native, 1, "native openPreferences used");
    assert.equal(env.tabs.length, before, "no fallback tab on native path");
    delete env.sb.window.openPreferences;
    m = openAphMenu(env);
    m.children.find((c) => c.id === "aph-aph-firefox-settings").fire("command", {});
    const opened = env.tabs.filter(
      (t) => t.linkedBrowser && t.linkedBrowser.currentURI && t.linkedBrowser.currentURI.spec === "about:preferences"
    );
    assert.equal(opened.length, 1, "fallback opens about:preferences");
    assert.equal(env.sb.gBrowser.selectedTab, opened[0], "fallback tab selected");
  });

  it("Aph menu Set Icon row opens the picker for the current workspace", () => {
    const env = makeEnv();
    const a = addTab(env, { label: "a", ws: "1" });
    env.select(a);
    env.api.renderDock();
    let picked = null;
    env.sb.window.AphPalette.setWsIcon = (id) => { picked = id; };
    const m = openAphMenu(env);
    const row = m.children.find((c) => c.id === "aph-aph-set-icon");
    assert.ok(row, "set-icon row present");
    row.fire("command", {});
    assert.equal(picked, "1", "picker opens for current workspace");
  });

  it("Stash row disables when nothing is stashable", () => {
    const env = makeEnv();
    const a = addTab(env, { label: "a", ws: "1" });
    env.select(a);
    env.api.renderDock();
    env.sb.window.AphStash = { pendingStashCount: () => 0 };
    let m = openAphMenu(env);
    assert.equal(m.children.find((c) => c.id === "aph-aph-stash").getAttribute("disabled"), "true");
    env.sb.window.AphStash = { pendingStashCount: () => 3 };
    m.fire("popupshowing", { currentTarget: m, target: m });
    assert.equal(m.children.find((c) => c.id === "aph-aph-stash").getAttribute("disabled"), null);
  });

  it("plus jumps to the lowest inactive workspace and opens exactly one tab", () => {
    const env = makeEnv();
    const a = addTab(env, { label: "a", ws: "1" });
    addTab(env, { label: "c", ws: "2" });
    env.select(a);
    env.api.renderDock();
    const before = env.tabs.length;
    firePill(env.plus(), "click", {});
    assert.equal(env.api.getCurrent(), "3");
    assert.ok(env.tabs.some((t) => (tabVals.get(t) || {}).aphWs === "3"), "new tab tagged 3");
    assert.equal(env.tabs.length, before + 1, "single creation path (no reconcile race)");
  });

  it("restoring and untagged tabs stay out of counts and close", () => {
    const env = makeEnv();
    const a = addTab(env, { label: "a", ws: "1" });
    const r = addTab(env, { label: "r", ws: "2" });
    const u = addTab(env, { label: "u", ws: "1", spec: "https://example.com/" });
    tabVals.set(u, {});
    env.select(a);
    env.sb.SessionStore.isTabRestoring = (t) => t === r;
    env.api.renderDock();
    const byWs = {};
    for (const p of env.pills()) byWs[pillWs(p)] = p;
    assert.ok(/· 1 tab[^s]/.test(byWs["1"].title), `settled count only, got: ${byWs["1"].title}`);
    // A workspace with only restoring/tagless tabs is not active: no pill
    // until its tags settle (getWs defaults tagless to "1", so counting it
    // would inflate WS1 mid-restore).
    assert.ok(!byWs["2"], `restoring-only WS has no pill, got: ${byWs["2"] && byWs["2"].title}`);
    const res = env.api.closeWorkspaceTabs("2");
    assert.equal(res.closed, 0, "restoring tab survives close");
    assert.ok(env.tabs.includes(r), "restoring tab still present");
    // Untagged settled tabs fail closed on a foreign WS1 close too (no real
    // tag): settle elsewhere so the close proceeds, then only `a` goes.
    const c = addTab(env, { label: "c", ws: "3" });
    env.api.switchTo("3");
    env.select(c);
    const res1 = env.api.closeWorkspaceTabs("1");
    assert.equal(res1.closed, 1, "only the tagged WS1 tab closes");
    assert.ok(!env.tabs.includes(a), "settled WS1 tab closed");
    assert.ok(env.tabs.includes(u), "untagged tab survives WS1 close");
    assert.ok(env.tabs.includes(r), "restoring tab survives WS1 close");
  });

  function wheelEnv() {
    const env = makeEnv();
    const a = addTab(env, { label: "a", ws: "1" });
    addTab(env, { label: "b", ws: "2" });
    addTab(env, { label: "c", ws: "3" });
    env.select(a);
    env.api.renderDock();
    return env;
  }

  function fireWheel(env, ev) {
    let prevented = false;
    env.dock().fire("wheel", Object.assign({
      deltaX: 0,
      deltaY: 0,
      deltaMode: 0,
      preventDefault() { prevented = true; },
    }, ev || {}));
    return prevented;
  }

  it("wheel down cycles up, wheel up cycles down", () => {
    const env = wheelEnv();
    fireWheel(env, { deltaY: 120 });
    assert.equal(env.api.getCurrent(), "2");
    const env2 = wheelEnv();
    fireWheel(env2, { deltaY: -120 });
    assert.equal(env2.api.getCurrent(), "3");
  });

  it("horizontal swipe (deltaX) cycles workspaces", () => {
    const env = wheelEnv();
    const prevented = fireWheel(env, { deltaX: 120 });
    assert.equal(env.api.getCurrent(), "2");
    assert.ok(prevented, "strip scroll suppressed on switch");
  });

  it("small deltas stay below threshold and pinch-zoom never switches", () => {
    const env = wheelEnv();
    fireWheel(env, { deltaY: 10 });
    assert.equal(env.api.getCurrent(), "1");
    fireWheel(env, { deltaY: 120, ctrlKey: true });
    assert.equal(env.api.getCurrent(), "1");
    fireWheel(env, { deltaY: 120, metaKey: true });
    assert.equal(env.api.getCurrent(), "1");
  });

  it("line-mode deltas scale and cooldown gates bursts", () => {
    const env = wheelEnv();
    fireWheel(env, { deltaY: 3, deltaMode: 1 });
    assert.equal(env.api.getCurrent(), "2");
    fireWheel(env, { deltaY: 120 });
    assert.equal(env.api.getCurrent(), "2", "burst inside cooldown holds");
  });

  it("cycling a lone workspace pulses instead of dying silent", () => {
    const env = makeEnv();
    const a = addTab(env, { label: "a", ws: "1" });
    env.select(a);
    env.api.renderDock();
    fireWheel(env, { deltaY: 120 });
    assert.equal(env.api.getCurrent(), "1", "nowhere to go");
    const tc = env.sb.gBrowser.tabContainer;
    assert.equal(tc.getAttribute("data-aph-ws-pulse"), "1", "no-op signals");
  });

  it("sidebar horizontal swipe cycles workspaces", () => {
    const env = wheelEnv();
    let prevented = false;
    env.anchor.fire("wheel", {
      deltaX: 120, deltaY: 0, deltaMode: 0, preventDefault() { prevented = true; },
    });
    assert.equal(env.api.getCurrent(), "2");
    assert.ok(prevented, "history swipe suppressed on switch");
  });

  it("sidebar vertical wheel never switches (tab list keeps scrolling)", () => {
    const env = wheelEnv();
    let prevented = false;
    env.anchor.fire("wheel", {
      deltaX: 0, deltaY: 120, deltaMode: 0, preventDefault() { prevented = true; },
    });
    assert.equal(env.api.getCurrent(), "1");
    assert.equal(prevented, false, "list scroll untouched");
  });

  it("sidebar ignores dock-bubbled events and pinch-zoom", () => {
    const env = wheelEnv();
    const dockChild = { closest: (sel) => (sel === "#aph-ws-dock" ? {} : null) };
    env.anchor.fire("wheel", {
      deltaX: 120, deltaY: 0, deltaMode: 0, target: dockChild, preventDefault() {},
    });
    assert.equal(env.api.getCurrent(), "1", "dock owns its events");
    env.anchor.fire("wheel", {
      deltaX: 120, deltaY: 0, deltaMode: 0, ctrlKey: true, preventDefault() {},
    });
    assert.equal(env.api.getCurrent(), "1", "pinch-zoom never switches");
  });

  it("dock and strip expose gesture markers for console diagnosis", () => {
    const env = wheelEnv();
    assert.equal(env.dock().getAttribute("data-aph-dock-wheel"), "1");
    assert.equal(env.anchor.getAttribute("data-aph-swipe"), "1");
  });

  it("plus with all 9 active pulses instead of switching", () => {    const env = makeEnv();
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

  it("drop on a pill pulses it as an ingestion confirm", () => {
    const env = makeEnv();
    const a = addTab(env, { label: "a", ws: "1" });
    addTab(env, { label: "c", ws: "2" });
    env.select(a);
    env.api.renderDock();
    env.containerHandlers.dragstart.forEach((fn) => fn({ target: a }));
    const pill2 = env.pills().find((p) => pillWs(p) === "2");
    firePill(pill2, "drop", { preventDefault() {}, dataTransfer: {} });
    // The send re-renders the dock mid-drop, so re-query: the pre-drop
    // pill object is stale by the time the pulse lands.
    const fresh = env.pills().find((p) => pillWs(p) === "2");
    assert.ok(fresh.classList.contains("aph-ws-drop-pulse"), "destination pill dips");
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

  // Safety net: a bulk close is the one bulk destructive action Aph owns,
  // so >=3 doomed tabs are captured first (append-only restore makes a
  // regretted close undoable from the Stash page).
  it("close auto-stashes at the threshold and not below it", () => {
    const env = makeEnv();
    const calls = [];
    env.sb.window.AphStash = {
      autoStashTabs(tabs, name) {
        calls.push({ n: tabs.length, name });
        return tabs.length;
      },
    };
    const a = addTab(env, { label: "a", ws: "1" });
    env.select(a);
    addTab(env, { label: "c1", ws: "2" });
    addTab(env, { label: "c2", ws: "2" });
    assert.equal(env.api.closeWorkspaceTabs("2").closed, 2);
    assert.equal(calls.length, 0, "two tabs is not a bulk close");

    addTab(env, { label: "d1", ws: "3" });
    addTab(env, { label: "d2", ws: "3" });
    addTab(env, { label: "d3", ws: "3" });
    assert.equal(env.api.closeWorkspaceTabs("3").closed, 3);
    assert.equal(calls.length, 1, "three tabs auto-stash first");
    assert.equal(calls[0].n, 3);
    assert.equal(calls[0].name, "Before closing WS 3");
  });

  it("close proceeds quietly with no stash controller", () => {
    const env = makeEnv();
    const a = addTab(env, { label: "a", ws: "1" });
    env.select(a);
    for (const n of ["c1", "c2", "c3"]) addTab(env, { label: n, ws: "2" });
    delete env.sb.window.AphStash;
    const res = env.api.closeWorkspaceTabs("2");
    assert.equal(res.closed, 3, "close still works without the stash controller");
  });

  it("close honors a custom safety threshold", () => {
    const env = makeEnv();
    const calls = [];
    env.sb.window.AphStash = {
      autoStashTabs(tabs, name) {
        calls.push({ n: tabs.length, name });
        return tabs.length;
      },
      safetyThreshold: () => 5,
    };
    const a = addTab(env, { label: "a", ws: "1" });
    env.select(a);
    for (const n of ["c1", "c2", "c3"]) addTab(env, { label: n, ws: "2" });
    assert.equal(env.api.closeWorkspaceTabs("2").closed, 3);
    assert.equal(calls.length, 0, "three tabs below a threshold of five");
    for (const n of ["d1", "d2", "d3", "d4", "d5"]) addTab(env, { label: n, ws: "3" });
    assert.equal(env.api.closeWorkspaceTabs("3").closed, 5);
    assert.equal(calls.length, 1, "five tabs reach the custom threshold");
  });

  it("close offers the safety-net undo after a bulk close", () => {
    const env = makeEnv();
    const confirmCalls = [];
    env.sb.window.AphStash = {
      autoStashTabs() { return 3; },
      confirmBulkClose(id, closed) {
        confirmCalls.push([id, closed]);
        return true;
      },
    };
    const a = addTab(env, { label: "a", ws: "1" });
    env.select(a);
    for (const n of ["c1", "c2", "c3"]) addTab(env, { label: n, ws: "2" });
    const res = env.api.closeWorkspaceTabs("2");
    assert.equal(res.closed, 3);
    assert.deepEqual(confirmCalls, [["2", 3]], "undo offered for the landed close");
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

  it("accent submenu applies the chosen hue and follows workspace on clear", () => {
    const env = makeEnv();
    const a = addTab(env, { label: "a", ws: "1" });
    env.select(a);
    env.api.renderDock();
    const pill1 = env.pills().find((p) => pillWs(p) === "1");
    const m = openMenuFor(env, pill1);
    const accent = m.children.find((c) => (c.getAttribute("label") || "").startsWith("Accent for"));
    assert.ok(accent, "accent submenu present");
    const sub = accent.children.find((c) => c.localName === "menupopup");
    const names = sub.children.map((c) => c.getAttribute("label"));
    assert.ok(names.includes("Follow workspace"), `follow present: ${names}`);
    assert.ok(names.includes("Ruby") && names.includes("Crimson"), `sixteen hues: ${names}`);
    assert.equal(names.filter((n) => n !== "Follow workspace").length, 16);
    const crimson = sub.children.find((c) => c.getAttribute("label") === "Crimson");
    crimson.fire("command", {});
    assert.deepEqual(
      JSON.parse(env.prefStore["aph.workspaces.accents"] || "{}"), { 1: "16" }
    );
    const stamped = env.pills().find((p) => pillWs(p) === "1");
    assert.equal(stamped.getAttribute("data-accent"), "16");
    const m2 = openMenuFor(env, stamped);
    const accent2 = m2.children.find((c) => (c.getAttribute("label") || "").startsWith("Accent for"));
    const sub2 = accent2.children.find((c) => c.localName === "menupopup");
    const follow = sub2.children.find((c) => c.getAttribute("label") === "Follow workspace");
    follow.fire("command", {});
    assert.deepEqual(JSON.parse(env.prefStore["aph.workspaces.accents"] || "{}"), {});
  });

  it("accent pick restamps the room immediately, no switch needed", () => {
    const env = makeEnv();
    const a = addTab(env, { label: "a", ws: "1" });
    env.select(a);
    env.api.renderDock();
    const pill1 = env.pills().find((p) => pillWs(p) === "1");
    const m = openMenuFor(env, pill1);
    const accent = m.children.find((c) => (c.getAttribute("label") || "").startsWith("Accent for"));
    const sub = accent.children.find((c) => c.localName === "menupopup");
    const violet = sub.children.find((c) => c.getAttribute("label") === "Violet");
    violet.fire("command", {});
    const root = env.sb.document.documentElement;
    assert.equal(root.getAttribute("data-aph-accent"), "14", "window retuned at once");
    const stamped = env.pills().find((p) => pillWs(p) === "1");
    assert.equal(stamped.getAttribute("data-accent"), "14", "pill retuned at once");
  });

  it("accents pref observer applies external writes immediately", () => {
    const env = makeEnv();
    const a = addTab(env, { label: "a", ws: "1" });
    env.select(a);
    env.api.renderDock();
    const obs = env.prefObservers["aph.workspaces.accents"];
    assert.ok(obs, "accents pref observed");
    // Settings-page-shaped write: pref lands without touching chrome.
    env.prefStore["aph.workspaces.accents"] = JSON.stringify({ 1: "15" });
    obs.observe(null, "", "aph.workspaces.accents");
    const root = env.sb.document.documentElement;
    assert.equal(root.getAttribute("data-aph-accent"), "15", "room follows the pref");
    const stamped = env.pills().find((p) => pillWs(p) === "1");
    assert.equal(stamped.getAttribute("data-accent"), "15", "dock follows the pref");
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
