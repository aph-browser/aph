// Load rings (branding/src/workspaces/73-loadrings.js): the storm gate.
// Below the threshold busy-tile rings breathe (CSS pulse); past it the
// module stamps data-aph-load-storm so every ring renders static.
// The real bundle runs in node:vm with Firefox globals mocked (same
// shape as tests/focus.test.js, with a recording tabContainer).
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { run, makeTab, makeFakeNode } = require("./helpers");

const tabVals = new WeakMap();

function makeEnv() {
  const tabs = [
    makeTab(tabVals, { label: "a", ws: "1", selected: true, spec: "https://a.example.com/" }),
    makeTab(tabVals, { label: "b", ws: "1", spec: "https://b.example.com/" }),
    makeTab(tabVals, { label: "c", ws: "1", spec: "https://c.example.com/" }),
    makeTab(tabVals, { label: "d", ws: "1", spec: "https://d.example.com/" }),
    makeTab(tabVals, { label: "e", ws: "1", spec: "https://e.example.com/" }),
  ];
  const rootAttrs = {};
  const winHandlers = {};
  const tabContainer = makeFakeNode("tabs");
  tabContainer.setAttribute = () => {};
  tabContainer.getAttribute = () => null;
  tabContainer.removeAttribute = () => {};
  tabContainer._invalidateCachedVisibleTabs = () => {};
  tabContainer._updateCloseButtons = () => {};
  const sb = {
    window: {
      addEventListener(type, fn) { (winHandlers[type] = winHandlers[type] || []).push(fn); },
      removeEventListener() {},
      opener: null,
    },
    navigator: { onLine: true },
    document: {
      readyState: "complete",
      getElementById: () => null,
      createElement: (tag) => makeFakeNode(tag),
      createEvent: () => ({ initEvent() {} }),
      documentElement: {
        setAttribute(k, v) { rootAttrs[k] = String(v); },
        getAttribute(k) { return k in rootAttrs ? rootAttrs[k] : null; },
        removeAttribute(k) { delete rootAttrs[k]; },
        hasAttribute(k) { return k in rootAttrs; },
      },
    },
    gBrowser: {
      tabs,
      tabGroups: [],
      get selectedTab() { return tabs.find((t) => t.selected) || tabs[0]; },
      set selectedTab(t) {
        for (const x of tabs) x.selected = false;
        if (t) t.selected = true;
      },
      get selectedBrowser() { return { focus() {} }; },
      showTab(t) { t.removeAttribute("hidden"); },
      addTrustedTab(url) {
        const t = makeTab(tabVals, { label: "new", ws: "1", spec: url });
        tabs.push(t);
        return t;
      },
      removeTab(t) {
        const i = tabs.indexOf(t);
        if (i !== -1) tabs.splice(i, 1);
      },
      discardBrowser() {},
      ungroupTab() {},
      replaceInSuccession() {},
      setSuccessor() {},
      _updateMultiselectedTabCloseButtonTooltip() {},
      getTabForBrowser: (b) => (b && b.__tab) || null,
      addTabsProgressListener() {},
      removeTabsProgressListener() {},
      tabContainer,
    },
    SessionStore: {
      getCustomTabValue: (t, k) => (tabVals.get(t) || {})[k],
      setCustomTabValue: (t, k, v) => {
        const o = tabVals.get(t) || {};
        o[k] = v;
        tabVals.set(t, o);
      },
      deleteCustomTabValue: () => {},
      isTabRestoring: () => false,
      getCustomWindowValue: () => undefined,
      setCustomWindowValue: () => {},
    },
    Services: {
      prefs: {
        getStringPref: (k, d) => d,
        setStringPref() {},
        getBoolPref: (k, d) => { if (d !== undefined) return !!d; throw new Error("no pref"); },
        setBoolPref() {},
        getIntPref: (k, d) => { if (d !== undefined) return d; throw new Error("no pref"); },
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
      importESModule: () => ({ ContextualIdentityService: null }),
    },
    Ci: {
      nsIWebProgressListener: { LOCATION_CHANGE_SAME_DOCUMENT: 2 },
      nsIWebProgress: { NOTIFY_LOCATION: 1 },
    },
  };
  sb.window.window = sb.window;
  run("workspaces.js", sb);
  return {
    tabs, tabContainer, rootAttrs,
    storm: () => ("data-aph-load-storm" in rootAttrs ? rootAttrs["data-aph-load-storm"] : null),
    setBusy: (t, on) => {
      if (on) t.setAttribute("busy", "");
      else t.removeAttribute("busy");
      tabContainer.fire("TabAttrModified", { target: t });
    },
    fireUnload: () => {
      for (const fn of winHandlers.unload || []) fn({});
    },
  };
}

describe("load rings storm gate", () => {
  it("starts calm with no busy tabs", () => {
    const env = makeEnv();
    assert.equal(env.storm(), null);
  });

  it("stays calm at and below the threshold", () => {
    const env = makeEnv();
    env.setBusy(env.tabs[0], true);
    env.setBusy(env.tabs[1], true);
    env.setBusy(env.tabs[2], true);
    assert.equal(env.storm(), null, "three busy tabs still breathe");
  });

  it("stamps the storm past the threshold and clears on settle", () => {
    const env = makeEnv();
    for (const t of env.tabs.slice(0, 4)) env.setBusy(t, true);
    assert.equal(env.storm(), "1", "four busy tabs go static");
    env.setBusy(env.tabs[3], false);
    assert.equal(env.storm(), null, "settling back to three resumes the pulse");
  });

  it("TabClose of a busy tab recomputes the count", () => {
    const env = makeEnv();
    for (const t of env.tabs.slice(0, 4)) env.setBusy(t, true);
    assert.equal(env.storm(), "1");
    const doomed = env.tabs[0];
    env.tabs.splice(env.tabs.indexOf(doomed), 1);
    env.tabContainer.fire("TabClose", { target: doomed });
    assert.equal(env.storm(), null, "three survivors breathe again");
  });

  it("unload removes the stamp", () => {
    const env = makeEnv();
    for (const t of env.tabs.slice(0, 4)) env.setBusy(t, true);
    assert.equal(env.storm(), "1");
    env.fireUnload();
    assert.equal(env.storm(), null, "no storm stamp lingers past the window");
  });
});
