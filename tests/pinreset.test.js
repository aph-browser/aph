// Regression guards for Zen-style pinned-tab URLs (workspaces bundle,
// 75-pinreset.js): default capture on pin, editable custom URL, reset
// action, and the tab context menu. Pins close normally (no interception).
// The real bundle runs in node:vm with Firefox globals mocked (same shape
// as tests/workspaces.test.js); the AphPinReset API is exercised directly.
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { run, makeTab } = require("./helpers");

const tabVals = new WeakMap();
const prefStore = {};
const createdXUL = [];

function makeEnv() {
  const tabs = [];
  const containerHandlers = {};
  const winHandlers = {};
  const menuHandlers = {};
  const menuKids = [];
  const prompts = [];
    const sb = {
    // Real chrome windows provide the WHATWG URL global; node:vm does not.
    URL,
    window: {
      opener: null,
      addEventListener(t, fn) { winHandlers[t] = fn; },
      removeEventListener(t) { delete winHandlers[t]; },
      AphPalette: {
        prompt(opts) { prompts.push(opts); },
      },
      prompt() { return null; },
    },
    navigator: { onLine: true },
    document: {
      readyState: "complete",
      popupNode: null,
      getElementById: (id) => (id === "tabContextMenu" ? menu : null),
      createElement: () => ({ setAttribute() {}, removeAttribute() {}, style: {} }),
      createXULElement: (localName) => {
        createdXUL.push(localName);
        return {
          attrs: {},
          // Real XUL elements reflect .id to the attribute.
          get id() { return this.attrs.id; },
          set id(v) { this.attrs.id = v; },
          setAttribute(k, v) { this.attrs[k] = v; },
          getAttribute(k) { return this.attrs[k]; },
          removeAttribute() {},
          classList: { add() {}, remove() {} },
          addEventListener(t, fn) { this[`on_${t}`] = fn; },
          remove() { this.removed = true; },
        };
      },
      createEvent: () => ({ initEvent() {} }),
    },
    gBrowser: {
      tabs,
      tabGroups: [],
      get selectedTab() { return sel; },
      set selectedTab(t) { sel = t; },
      showTab() {},
      addTrustedTab(url, opts) {
        const t = makeTab(tabVals, { label: "new", ws: "1", spec: url, cid: (opts && opts.userContextId) || 0 });
        tabs.push(t);
        return t;
      },
      removeTab() {},
      ungroupTab() {},
      tabContainer: {
        setAttribute() {},
        // Prod keeps every listener; the mock must too (the bundle
        // registers TabPinned in both 75-pinreset and 80-lifecycle).
        addEventListener(t, fn) { (containerHandlers[t] ||= []).push(fn); },
        removeEventListener(t, fn) {
          containerHandlers[t] = (containerHandlers[t] || []).filter((f) => f !== fn);
        },
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
      io: { newURI: (spec) => ({ spec }) },
      prefs: {
        getStringPref: (k, d) => (k in prefStore ? prefStore[k] : d),
        setStringPref: (k, v) => { prefStore[k] = v; },
        addObserver() {},
        removeObserver() {},
      },
      scriptSecurityManager: { getSystemPrincipal: () => ({ system: true }) },
      startup: { shuttingDown: false },
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
  let sel = null;
  const menu = {
    appendChild(el) { menuKids.push(el); },
    addEventListener(t, fn) { menuHandlers[t] = fn; },
    removeEventListener() {},
  };
  sb.window.window = sb.window;
  run("workspaces.js", sb);
  return {
    sb, tabs, containerHandlers, winHandlers, menuHandlers, menuKids,
    prompts, menu,
    api: sb.window.AphPinReset,
  };
}

function fireContainer(env, type, ev) {
  for (const fn of env.containerHandlers[type] || []) {
    fn(ev);
  }
}

function pinTab(env, spec) {
  const t = makeTab(tabVals, { label: "pin", ws: "1", spec, pinned: true });
  t.linkedBrowser.fixupCalls = [];
  t.linkedBrowser.fixupAndLoadURIString = (url, params) => {
    t.linkedBrowser.fixupCalls.push({ url, params });
  };
  env.tabs.push(t);
  fireContainer(env, "TabPinned", { target: t });
  return t;
}

function closeEvent(tab, detail) {
  return { target: tab, detail: detail || {} };
}

function popupEvent(env, tab) {
  return { currentTarget: env.menu, target: { triggerNode: { tab } } };
}

describe("pinned-tab URLs", () => {
  it("captures the live URL as default on pin", () => {
    const env = makeEnv();
    const t = pinTab(env, "https://example.com/a");
    assert.equal(env.api.getPinURL(t), "https://example.com/a");
  });

  it("keeps a custom URL across re-pin and clears on unpin", () => {
    const env = makeEnv();
    const t = pinTab(env, "https://example.com/a");
    assert.equal(env.api.setPinURL(t, "https://example.com/sub"), true);
    fireContainer(env, "TabPinned", { target: t });
    assert.equal(env.api.getPinURL(t), "https://example.com/sub");
    t.pinned = false;
    fireContainer(env, "TabUnpinned", { target: t });
    assert.equal(env.api.getPinURL(t), "");
  });

  it("rejects javascript: and garbage URLs, keeping the previous value", () => {
    const env = makeEnv();
    const t = pinTab(env, "https://example.com/a");
    assert.equal(env.api.setPinURL(t, "javascript:alert(1)"), false);
    assert.equal(env.api.setPinURL(t, "not a url at all %%"), false);
    assert.equal(env.api.getPinURL(t), "https://example.com/a");
  });

  it("reset navigates a drifted pin back with a system principal", () => {
    const env = makeEnv();
    const t = pinTab(env, "https://example.com/a");
    t.linkedBrowser.currentURI.spec = "https://example.com/drifted";
    assert.equal(env.api.resetPinTab(t), true);
    assert.deepEqual(
      t.linkedBrowser.fixupCalls.map((c) => c.url),
      ["https://example.com/a"]
    );
    assert.ok(t.linkedBrowser.fixupCalls[0].params.triggeringPrincipal);
  });

  it("reset falls back to the live URL for legacy pins without a value", () => {
    const env = makeEnv();
    const t = makeTab(tabVals, { label: "legacy", ws: "1", spec: "https://legacy.example/", pinned: true });
    t.linkedBrowser.fixupCalls = [];
    t.linkedBrowser.fixupAndLoadURIString = (url) => { t.linkedBrowser.fixupCalls.push(url); };
    env.tabs.push(t);
    // Never pinned through the handler, so no stored value exists.
    assert.equal(env.api.getPinURL(t), "");
    assert.equal(env.api.resetPinTab(t), true);
    assert.deepEqual(t.linkedBrowser.fixupCalls, ["https://legacy.example/"]);
  });

  it("reset refuses unpinned tabs", () => {
    const env = makeEnv();
    const t = makeTab(tabVals, { label: "plain", ws: "1", spec: "https://example.com/" });
    let called = false;
    t.linkedBrowser.fixupAndLoadURIString = () => { called = true; };
    env.tabs.push(t);
    assert.equal(env.api.resetPinTab(t), false);
    assert.equal(called, false);
  });

  it("TabClose passes through untouched (pins close normally)", () => {
    const env = makeEnv();
    const t = pinTab(env, "https://example.com/a");
    const plain = makeTab(tabVals, { label: "plain", ws: "1", spec: "https://example.com/" });
    env.tabs.push(plain);
    const before = env.tabs.length;
    // No interception: firing TabClose adds and forgets nothing.
    fireContainer(env, "TabClose", closeEvent(t));
    fireContainer(env, "TabClose", closeEvent(plain));
    assert.equal(env.tabs.length, before);
  });

  it("reset falls back to loadURI when fixup is unavailable", () => {
    const env = makeEnv();
    const t = pinTab(env, "https://example.com/a");
    const loads = [];
    t.linkedBrowser.fixupAndLoadURIString = () => { throw new Error("no fixup"); };
    t.linkedBrowser.loadURI = (uri, params) => { loads.push({ uri, params }); };
    assert.equal(env.api.resetPinTab(t), true);
    assert.equal(loads.length, 1);
    assert.equal(loads[0].uri.spec, "https://example.com/a");
    assert.ok(loads[0].params.triggeringPrincipal);
  });

  it("debug() reports the last failure for the Browser Console", () => {
    const env = makeEnv();
    const t = makeTab(tabVals, { label: "broken", ws: "1", spec: "https://example.com/", pinned: true });
    env.tabs.push(t);
    assert.equal(env.api.setPinURL(t, "https://example.com/pinned"), true);
    delete t.linkedBrowser;
    assert.equal(env.api.resetPinTab(t), false);
    assert.equal(env.api.debug().lastError, "no-browser");
  });

  it("context menu shows both items for pins, none otherwise", () => {
    const env = makeEnv();
    const pinned = pinTab(env, "https://example.com/a");
    const plain = makeTab(tabVals, { label: "plain", ws: "1", spec: "https://example.com/" });
    env.tabs.push(plain);
    env.menuHandlers.popupshowing(popupEvent(env, plain));
    assert.equal(env.menuKids.length, 0);
    env.menuHandlers.popupshowing(popupEvent(env, pinned));
    assert.equal(env.menuKids.length, 2);
    assert.equal(env.menuKids[0].attrs.id, "aph-pinreset-reset");
    assert.equal(env.menuKids[0].attrs.label, "Reset to Pinned Page");
    assert.equal(env.menuKids[1].attrs.id, "aph-pinreset-set");
    assert.ok(createdXUL.includes("menuitem"));
  });

  it("reset item is disabled when already at the pinned URL", () => {
    const env = makeEnv();
    const t = pinTab(env, "https://example.com/a");
    env.menuHandlers.popupshowing(popupEvent(env, t));
    assert.equal(env.menuKids[0].attrs.disabled, "true");
    t.linkedBrowser.currentURI.spec = "https://example.com/elsewhere";
    env.menuHandlers.popupshowing(popupEvent(env, t));
    const latest = env.menuKids[env.menuKids.length - 2];
    assert.equal(latest.attrs.disabled, undefined);
  });

  it("edit dialog commits through the palette prompt", () => {
    const env = makeEnv();
    const t = pinTab(env, "https://example.com/a");
    env.menuHandlers.popupshowing(popupEvent(env, t));
    const edit = env.menuKids[env.menuKids.length - 1];
    assert.equal(env.prompts.length, 0);
    edit.on_command();
    assert.equal(env.prompts.length, 1);
    assert.equal(env.prompts[0].initial, "https://example.com/a");
    env.prompts[0].onCommit("https://example.com/edited");
    assert.equal(env.api.getPinURL(t), "https://example.com/edited");
  });
});
