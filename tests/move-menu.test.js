// Space rows in the tab context menu (workspaces bundle, 62-move-menu.js):
// current-workspace listing, tab assignment (single / multiselection /
// grouped member vote), group assignment (whole native group), disabled
// current folder, remove path, pinned gating, and rebuild-on-show cleanup.
// Runs the real bundle in node:vm with the same mock shapes as
// tests/spaces.test.js, plus a XUL-capable document (pinreset pattern).
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { run, makeTab, makeGroup, makeChromeUtils, nullIdentityService } = require("./helpers");

// XUL stand-in: attribute surface, child tree with parentNode bookkeeping
// (clearMoveMenu detaches through parentNode.removeChild), command
// handlers, and the id property XUL reflects.
function fakeXul(localName) {
  const n = {
    localName,
    children: [],
    attrs: {},
    handlers: {},
    id: "",
    parentNode: null,
    appendChild(c) {
      c.parentNode = n;
      n.children.push(c);
      return c;
    },
    removeChild(c) {
      const i = n.children.indexOf(c);
      if (i !== -1) {
        n.children.splice(i, 1);
      }
      c.parentNode = null;
      return c;
    },
    setAttribute(k, v) {
      n.attrs[k] = String(v);
    },
    getAttribute(k) {
      return k in n.attrs ? n.attrs[k] : null;
    },
    removeAttribute(k) {
      delete n.attrs[k];
    },
    addEventListener(t, fn) {
      (n.handlers[t] = n.handlers[t] || []).push(fn);
    },
    removeEventListener(t, fn) {
      n.handlers[t] = (n.handlers[t] || []).filter((f) => f !== fn);
    },
    fire(t, ev) {
      for (const fn of [...(n.handlers[t] || [])]) {
        fn(ev || {});
      }
    },
  };
  return n;
}

function boot() {
  const tabVals = new WeakMap();
  const prefStore = {};
  const tabs = [];
  const groups = [];
  const menuHandlers = {};
  const winHandlers = {};
  let sel = null;
  let selectedTabs = [];
  const menu = fakeXul("menupopup");
  menu.id = "tabContextMenu";
  menu.triggerNode = null;
  menu.addEventListener = (t, fn) => {
    (menuHandlers[t] = menuHandlers[t] || []).push(fn);
  };
  menu.removeEventListener = () => {};

  const sb = {
    window: {
      addEventListener(k, fn) {
        (winHandlers[k] = winHandlers[k] || []).push(fn);
      },
      removeEventListener() {},
      opener: null,
    },
    navigator: { onLine: true },
    document: {
      readyState: "complete",
      popupNode: null,
      documentElement: { setAttribute() {}, removeAttribute() {} },
      getElementById: (id) => (id === "tabContextMenu" ? menu : null),
      createElement: () => ({
        setAttribute() {}, removeAttribute() {}, addEventListener() {},
        appendChild(c) { return c; }, style: {}, className: "",
      }),
      createXULElement: (localName) => fakeXul(localName),
      createEvent: () => ({ initEvent() {} }),
    },
    gBrowser: {
      tabs,
      tabGroups: groups,
      get selectedTab() {
        return sel;
      },
      set selectedTab(t) {
        sel = t;
        if (t) {
          t.selected = true;
        }
      },
      get selectedTabs() {
        return selectedTabs;
      },
      set selectedTabs(v) {
        selectedTabs = v;
      },
      showTab(t) { t.removeAttribute("hidden"); },
      removeTab() {},
      ungroupTab() {},
      addTabGroup() { return null; },
      replaceInSuccession() {},
      setSuccessor() {},
      _updateMultiselectedTabCloseButtonTooltip() {},
      getTabForBrowser: () => null,
      addTabsProgressListener() {},
      removeTabsProgressListener() {},
      tabContainer: {
        addEventListener() {},
        removeEventListener() {},
        setAttribute() {},
        removeAttribute() {},
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
      isTabRestoring: () => false,
      getCustomWindowValue: () => undefined,
      setCustomWindowValue: () => {},
    },
    Services: {
      prefs: {
        getStringPref: (k, d) => (k in prefStore ? prefStore[k] : d),
        setStringPref: (k, v) => { prefStore[k] = v; },
        getBoolPref: (k, d) => (k in prefStore ? !!prefStore[k] : d),
        setBoolPref: (k, v) => { prefStore[k] = !!v; },
        getIntPref: (k, d) => (k in prefStore ? prefStore[k] : d),
        setIntPref: (k, v) => { prefStore[k] = v; },
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
    Ci: {
      nsIWebProgressListener: {
        LOCATION_CHANGE_SAME_DOCUMENT: 2,
        STATE_START: 1,
        STATE_IS_DOCUMENT: 0x20000,
      },
      nsIWebProgress: { NOTIFY_LOCATION: 1 },
    },
  };
  sb.window.window = sb.window;
  run("workspaces.js", sb);
  const tab = (label, ws) => {
    const t = makeTab(tabVals, { label, ws, spec: `https://${label}.example/` });
    tabs.push(t);
    return t;
  };
  return { api: sb.window.AphWorkspaces, sb, tab, tabs, groups, tabVals, menu, menuHandlers };
}

function show(env, clicked) {
  env.menu.triggerNode = clicked ? { tab: clicked } : null;
  for (const fn of [...(env.menuHandlers.popupshowing || [])]) {
    fn({ currentTarget: env.menu, target: env.menu });
  }
}

function subById(env, id) {
  return env.menu.children.find((c) => c.id === id) || null;
}

function rowsOf(sub) {
  const popup = sub && sub.children[0];
  return (popup && popup.children) || [];
}

function labels(rows) {
  return rows
    .filter((r) => r.localName === "menuitem")
    .map((r) => r.attrs.label);
}

describe("move-to-space context menu", () => {
  it("lists only current-workspace spaces and assigns the clicked tab", () => {
    const env = boot();
    const s1 = env.api.createSpace("Read", "1");
    env.api.createSpace("Work", "2");
    const t = env.tab("menu-tab", "1");
    let invalidations = 0;
    env.sb.window.AphPalette = {
      invalidate() {
        invalidations++;
      },
    };
    show(env, t);
    const sub = subById(env, "aph-move-space-tab");
    assert.ok(sub, "tab space submenu exists");
    assert.equal(sub.attrs.label, "Move Tab to Space");
    const rows = rowsOf(sub);
    assert.deepEqual(labels(rows), ["Read"], "ws2 folder is not listed");
    rows[0].fire("command");
    assert.equal(env.api.getTabSpace(t), s1, "menu assignment wrote the value");
    assert.equal(invalidations, 1, "palette cache dropped through the API");
  });

  it("disables the current folder and offers Remove from Space", () => {
    const env = boot();
    const s1 = env.api.createSpace("Read", "1");
    const s2 = env.api.createSpace("Later", "1");
    const t = env.tab("member", "1");
    env.api.assignTabToSpace(t, s1);
    show(env, t);
    const rows = rowsOf(subById(env, "aph-move-space-tab"));
    const byLabel = Object.fromEntries(rows.map((r) => [r.attrs.label, r]));
    assert.equal(byLabel.Read.attrs.disabled, "true", "current folder disabled");
    assert.equal(byLabel.Later.attrs.disabled, undefined);
    const remove = rowsOf(subById(env, "aph-move-space-tab")).find(
      (r) => r.id === "aph-move-space-tab-remove"
    );
    assert.ok(remove, "remove row present");
    remove.fire("command");
    assert.equal(env.api.getTabSpace(t), "", "remove cleared the value");
  });

  it("multiselection moves every selected tab", () => {
    const env = boot();
    const s1 = env.api.createSpace("Batch", "1");
    const a = env.tab("a", "1");
    const b = env.tab("b", "1");
    const c = env.tab("c", "1");
    env.sb.gBrowser.selectedTabs = [a, b];
    show(env, a);
    const sub = subById(env, "aph-move-space-tab");
    assert.equal(sub.attrs.label, "Move 2 Tabs to Space");
    rowsOf(sub)[0].fire("command");
    assert.equal(env.api.getTabSpace(a), s1);
    assert.equal(env.api.getTabSpace(b), s1);
    assert.equal(env.api.getTabSpace(c), "", "unselected tab untouched");
  });

  it("group variant assigns the whole native group and can remove it", () => {
    const env = boot();
    const s1 = env.api.createSpace("Carded", "1");
    const m1 = env.tab("m1", "1");
    const m2 = env.tab("m2", "1");
    const g = makeGroup([m1, m2], {});
    env.groups.push(g);
    show(env, m1);
    const sub = subById(env, "aph-move-space-group");
    assert.ok(sub, "group space submenu exists");
    assert.equal(sub.attrs.label, "Move Group (2 Tabs) to Space");
    rowsOf(sub)[0].fire("command");
    assert.equal(env.api.getTabSpace(m1), s1);
    assert.equal(env.api.getTabSpace(m2), s1);
    show(env, m1);
    const remove = rowsOf(subById(env, "aph-move-space-group")).find(
      (r) => r.id === "aph-move-space-group-remove"
    );
    assert.ok(remove, "group remove row present");
    remove.fire("command");
    assert.equal(env.api.getTabSpace(m1), "");
    assert.equal(env.api.getTabSpace(m2), "");
  });

  it("hides the tab submenu for pinned clicks", () => {
    const env = boot();
    env.api.createSpace("Read", "1");
    const t = env.tab("pin", "1");
    t.pinned = true;
    show(env, t);
    assert.equal(subById(env, "aph-move-space-tab"), null, "no pins in folders");
  });

  it("shows nothing when the workspace has no spaces", () => {
    const env = boot();
    const t = env.tab("plain", "1");
    show(env, t);
    assert.equal(subById(env, "aph-move-space-tab"), null);
    assert.equal(subById(env, "aph-move-space-group"), null);
  });

  it("rebuilds rows on every showing (no duplicates)", () => {
    const env = boot();
    env.api.createSpace("Read", "1");
    const t = env.tab("dup", "1");
    show(env, t);
    show(env, t);
    const subs = env.menu.children.filter((c) => c.id === "aph-move-space-tab");
    assert.equal(subs.length, 1, "one rebuilt submenu, not two");
  });
});
