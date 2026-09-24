// Send-to-workspace visual refresh (branding/workspaces.js): after
// Ctrl+Alt+digit the move must be visible in the same pass — sent tabs
// hidden, selection in the current workspace, dock pills recounting,
// group headers re-synced. Any uncaught throw mid-send freezes the UI
// with tags already moved (visible desync), so these tests fail on throw.
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { run, makeTab, makeFakeNode: fakeNode, makeSessionStore, makeCi, makeChromeUtils } = require("./helpers");

const tabVals = new WeakMap();

function makeEnv() {
  const tabs = [];
  const groups = [];
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
      if (id === "navigator-toolbox") return { querySelector: () => null, setAttribute() {}, removeAttribute() {} };
      if (id === "nav-bar") return { prepend() {}, querySelector: () => null, setAttribute() {}, removeAttribute() {} };
      return null;
    },
    createElement: (tag) => fakeNode(tag),
    createXULElement: (localName) => fakeNode(localName),
    createEvent: () => ({ initEvent() {} }),
  };
  const sb = {
    URL,
    window: { opener: null, addEventListener() {}, removeEventListener() {} },
    navigator: { onLine: true },
    document: doc,
    gBrowser: {
      tabs,
      tabGroups: groups,
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
      discardBrowser(t) { t.setAttribute("pending", ""); },
      ungroupTab(t) {
        if (t && t.group) {
          const g = t.group;
          t.group = null;
          const i = g.tabs.indexOf(t);
          if (i !== -1) g.tabs.splice(i, 1);
        }
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
        addEventListener() {},
        removeEventListener() {},
        _invalidateCachedVisibleTabs() {},
        _updateCloseButtons() {},
      },
    },
    SessionStore: makeSessionStore(tabVals),
    Services: {
      prefs: {
        getStringPref: (k, d) => d,
        setStringPref: () => {},
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
    ChromeUtils: makeChromeUtils(null),
    Ci: makeCi(),
  };
  sb.window.window = sb.window;
  return { sb, tabs, groups, getSel: () => sel, setSel: (t) => { sb.gBrowser.selectedTab = t; } };
}

function addTab(env, o) {
  const t = makeTab(tabVals, { hidden: false, ...o });
  env.tabs.push(t);
  if (o.selected) env.setSel(t);
  return t;
}

function makeGroup(env, members) {
  const g = { tabs: members.slice(), hidden: false, collapsed: false };
  for (const t of members) t.group = g;
  env.groups.push(g);
  return g;
}

const wsOf = (t) => (tabVals.get(t) || {}).aphWs;
const dockPills = (env) => {
  const dock = env.sb.document.getElementById("aph-ws-dock");
  if (!dock) return [];
  return dock.children
    .filter((c) => (c.className || "").includes("aph-ws-pill") && !(c.className || "").includes("aph-ws-add"))
    .map((c) => c.getAttribute("data-ws"));
};

describe("send visual refresh", () => {
  it("sending the selected tab hides it, moves selection, recounts pills", () => {
    const env = makeEnv();
    const a = addTab(env, { label: "a", ws: "1", selected: true, spec: "https://a.example.com/" });
    const b = addTab(env, { label: "b", ws: "1", spec: "https://b.example.com/" });
    run("workspaces.js", env.sb);
    const api = env.sb.window.AphWorkspaces;
    assert.equal(api.getCurrent(), "1");
    api.sendTabTo("2", [a]);
    assert.equal(wsOf(a), "2", "tag moved");
    assert.equal(a.hidden, true, "sent tab hidden");
    assert.equal(b.hidden, false, "stayer visible");
    assert.equal(env.getSel(), b, "selection follows to a current tab");
    assert.deepEqual(dockPills(env).sort(), ["1", "2"], "both pills render");
  });

  it("sending a grouped tab re-syncs headers and pills", () => {
    const env = makeEnv();
    const a = addTab(env, { label: "a", ws: "1", selected: true, spec: "https://a.example.com/" });
    const g1 = addTab(env, { label: "g1", ws: "1", spec: "https://g1.example.com/" });
    const g2 = addTab(env, { label: "g2", ws: "1", spec: "https://g2.example.com/" });
    const grp = makeGroup(env, [g1, g2]);
    run("workspaces.js", env.sb);
    const api = env.sb.window.AphWorkspaces;
    api.sendTabTo("2", [g1]);
    assert.equal(wsOf(g1), "2");
    assert.equal(g1.hidden, true, "partial move hides the mover");
    // Partial move ejects from the group; the header stays for the remainder.
    assert.equal(g1.group, null);
    assert.equal(grp.hidden, false, "header stays for the remaining member");
    assert.ok(dockPills(env).includes("2"), "target pill appears");
  });

  it("sending a tree carries descendants and refreshes the strip", () => {
    const env = makeEnv();
    const p = addTab(env, { label: "p", ws: "1", selected: true, spec: "https://p.example.com/" });
    const k = addTab(env, { label: "k", ws: "1", spec: "https://k.example.com/" });
    run("workspaces.js", env.sb);
    const api = env.sb.window.AphWorkspaces;
    // Link k under p via stored ids (same mechanism as the tree module).
    env.sb.SessionStore.setCustomTabValue(p, "aphTreeId", "sv-p");
    env.sb.SessionStore.setCustomTabValue(k, "aphTreeId", "sv-k");
    env.sb.SessionStore.setCustomTabValue(k, "aphTreeParent", "sv-p");
    api.sendTabTo("3", [p]);
    assert.equal(wsOf(p), "3");
    assert.equal(wsOf(k), "3", "descendant carried");
    assert.equal(p.hidden, true);
    assert.equal(k.hidden, true);
    assert.ok(dockPills(env).includes("3"));
  });
});
