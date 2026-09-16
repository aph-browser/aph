// Regression guards for starred tabs (workspaces bundle,
// 76-starred.js): star capture, editable custom URL, reset action, the tab
// context menu, and pin/star mutual exclusion. Stars are per-workspace
// normal tabs; Ctrl+W park behavior lives in tests/star-park.test.js.
// The real bundle runs in node:vm with Firefox globals mocked (same shape
// as tests/pinreset.test.js); the AphStar API is exercised directly.
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
        // Prod keeps every listener; the mock must too (pinreset, starred,
        // and lifecycle all watch TabPinned; tree + pinreset + starred all
        // watch the tab context menu).
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
    addEventListener(t, fn) { (menuHandlers[t] ||= []).push(fn); },
    removeEventListener(t, fn) {
      menuHandlers[t] = (menuHandlers[t] || []).filter((f) => f !== fn);
    },
  };
  sb.window.window = sb.window;
  run("workspaces.js", sb);
  return {
    sb, tabs, containerHandlers, winHandlers, menuHandlers, menuKids,
    prompts, menu,
    api: sb.window.AphStar,
  };
}

function fireContainer(env, type, ev) {
  for (const fn of env.containerHandlers[type] || []) {
    fn(ev);
  }
}

function fireMenu(env, ev) {
  for (const fn of env.menuHandlers.popupshowing || []) {
    fn(ev);
  }
}

function starTab(env, spec) {
  const t = makeTab(tabVals, { label: "star", ws: "1", spec });
  t.linkedBrowser.fixupCalls = [];
  t.linkedBrowser.fixupAndLoadURIString = (url, params) => {
    t.linkedBrowser.fixupCalls.push({ url, params });
  };
  env.tabs.push(t);
  assert.equal(env.api.starTab(t), true);
  return t;
}

function popupEvent(env, tab) {
  return { currentTarget: env.menu, target: { triggerNode: { tab } } };
}

function starItems(env) {
  return env.menuKids.filter((k) =>
    String((k.attrs || {}).id || "").startsWith("aph-star-")
  );
}

describe("starred tabs", () => {
  it("captures the live URL as default on star", () => {
    const env = makeEnv();
    const t = starTab(env, "https://example.com/a");
    assert.equal(env.api.isStarred(t), true);
    assert.equal(env.api.getStarURL(t), "https://example.com/a");
    assert.equal(t.getAttribute("data-aph-starred"), "1");
  });

  it("keeps a custom URL across re-star and clears on unstar", () => {
    const env = makeEnv();
    const t = starTab(env, "https://example.com/a");
    assert.equal(env.api.setStarURL(t, "https://example.com/sub"), true);
    assert.equal(env.api.unstarTab(t), true);
    assert.equal(env.api.isStarred(t), false);
    assert.equal(env.api.getStarURL(t), "");
    assert.equal(t.getAttribute("data-aph-starred"), null);
    // Re-star captures fresh (no stale custom value survives unstar).
    assert.equal(env.api.starTab(t), true);
    assert.equal(env.api.getStarURL(t), "https://example.com/a");
  });

  it("toggle flips both ways", () => {
    const env = makeEnv();
    const t = makeTab(tabVals, { label: "plain", ws: "1", spec: "https://example.com/" });
    env.tabs.push(t);
    assert.equal(env.api.toggleStarTab(t), true);
    assert.equal(env.api.isStarred(t), true);
    assert.equal(env.api.toggleStarTab(t), true);
    assert.equal(env.api.isStarred(t), false);
  });

  it("rejects javascript: and garbage URLs, keeping the previous value", () => {
    const env = makeEnv();
    const t = starTab(env, "https://example.com/a");
    assert.equal(env.api.setStarURL(t, "javascript:alert(1)"), false);
    assert.equal(env.api.setStarURL(t, "not a url at all %%"), false);
    assert.equal(env.api.getStarURL(t), "https://example.com/a");
  });

  it("reset navigates a drifted star back with a system principal", () => {
    const env = makeEnv();
    const t = starTab(env, "https://example.com/a");
    t.linkedBrowser.currentURI.spec = "https://example.com/drifted";
    assert.equal(env.api.resetStarTab(t), true);
    assert.deepEqual(
      t.linkedBrowser.fixupCalls.map((c) => c.url),
      ["https://example.com/a"]
    );
    assert.ok(t.linkedBrowser.fixupCalls[0].params.triggeringPrincipal);
  });

  it("reset falls back to the live URL when no value was stored", () => {
    const env = makeEnv();
    const t = makeTab(tabVals, { label: "legacy", ws: "1", spec: "https://legacy.example/" });
    t.linkedBrowser.fixupCalls = [];
    t.linkedBrowser.fixupAndLoadURIString = (url) => { t.linkedBrowser.fixupCalls.push(url); };
    env.tabs.push(t);
    // Flag restored without a URL (e.g. value lost): still starred.
    env.sb.SessionStore.setCustomTabValue(t, "aphStarred", "1");
    assert.equal(env.api.isStarred(t), true);
    assert.equal(env.api.getStarURL(t), "");
    assert.equal(env.api.resetStarTab(t), true);
    assert.deepEqual(t.linkedBrowser.fixupCalls, ["https://legacy.example/"]);
  });

  it("reset refuses unstarred tabs", () => {
    const env = makeEnv();
    const t = makeTab(tabVals, { label: "plain", ws: "1", spec: "https://example.com/" });
    let called = false;
    t.linkedBrowser.fixupAndLoadURIString = () => { called = true; };
    env.tabs.push(t);
    assert.equal(env.api.resetStarTab(t), false);
    assert.equal(called, false);
  });

  it("reset refuses pinned tabs", () => {
    const env = makeEnv();
    const t = makeTab(tabVals, { label: "pin", ws: "1", spec: "https://example.com/", pinned: true });
    let called = false;
    t.linkedBrowser.fixupAndLoadURIString = () => { called = true; };
    env.tabs.push(t);
    env.sb.SessionStore.setCustomTabValue(t, "aphStarred", "1");
    assert.equal(env.api.resetStarTab(t), false);
    assert.equal(called, false);
  });

  it("starring a pinned tab is refused", () => {
    const env = makeEnv();
    const t = makeTab(tabVals, { label: "pin", ws: "1", spec: "https://example.com/", pinned: true });
    env.tabs.push(t);
    assert.equal(env.api.starTab(t), false);
    assert.equal(env.api.isStarred(t), false);
  });

  it("pinning a starred tab unstars it", () => {
    const env = makeEnv();
    const t = starTab(env, "https://example.com/a");
    t.pinned = true;
    fireContainer(env, "TabPinned", { target: t });
    assert.equal(env.api.isStarred(t), false);
    assert.equal(env.api.getStarURL(t), "");
    assert.equal(t.getAttribute("data-aph-starred"), null);
  });

  it("restored starred tabs regain the CSS marker", () => {
    const env = makeEnv();
    const t = makeTab(tabVals, { label: "restored", ws: "1", spec: "https://example.com/" });
    env.tabs.push(t);
    env.sb.SessionStore.setCustomTabValue(t, "aphStarred", "1");
    env.sb.SessionStore.setCustomTabValue(t, "aphStarURL", "https://example.com/");
    fireContainer(env, "SSTabRestored", { target: t });
    assert.equal(t.getAttribute("data-aph-starred"), "1");
  });

  it("reset falls back to loadURI when fixup is unavailable", () => {
    const env = makeEnv();
    const t = starTab(env, "https://example.com/a");
    const loads = [];
    t.linkedBrowser.fixupAndLoadURIString = () => { throw new Error("no fixup"); };
    t.linkedBrowser.loadURI = (uri, params) => { loads.push({ uri, params }); };
    assert.equal(env.api.resetStarTab(t), true);
    assert.equal(loads.length, 1);
    assert.equal(loads[0].uri.spec, "https://example.com/a");
    assert.ok(loads[0].params.triggeringPrincipal);
  });

  it("debug() reports the last failure for the Browser Console", () => {
    const env = makeEnv();
    const t = makeTab(tabVals, { label: "broken", ws: "1", spec: "https://example.com/" });
    env.tabs.push(t);
    assert.equal(env.api.starTab(t), true);
    assert.equal(env.api.setStarURL(t, "https://example.com/starred"), true);
    delete t.linkedBrowser;
    assert.equal(env.api.resetStarTab(t), false);
    assert.equal(env.api.debug().lastError, "no-browser");
  });

  it("context menu shows toggle for plain tabs, all three for stars, none for pins", () => {
    const env = makeEnv();
    const plain = makeTab(tabVals, { label: "plain", ws: "1", spec: "https://example.com/" });
    env.tabs.push(plain);
    const pinned = makeTab(tabVals, { label: "pin", ws: "1", spec: "https://example.com/", pinned: true });
    env.tabs.push(pinned);
    const starred = starTab(env, "https://example.com/a");

    const n0 = env.menuKids.length;
    fireMenu(env, popupEvent(env, plain));
    let fresh = env.menuKids
      .slice(n0)
      .filter((k) => String((k.attrs || {}).id || "").startsWith("aph-star-"));
    assert.deepEqual(fresh.map((k) => k.attrs.id), ["aph-star-toggle"]);
    assert.ok(fresh[0].attrs.label.startsWith("Star"));

    const n1 = env.menuKids.length;
    fireMenu(env, popupEvent(env, starred));
    fresh = env.menuKids
      .slice(n1)
      .filter((k) => String((k.attrs || {}).id || "").startsWith("aph-star-"));
    assert.deepEqual(fresh.map((k) => k.attrs.id), [
      "aph-star-toggle",
      "aph-star-reset",
      "aph-star-set",
    ]);
    assert.ok(fresh[0].attrs.label.startsWith("Unstar"));
    assert.ok(createdXUL.includes("menuitem"));

    const n2 = env.menuKids.length;
    fireMenu(env, popupEvent(env, pinned));
    fresh = env.menuKids
      .slice(n2)
      .filter((k) => String((k.attrs || {}).id || "").startsWith("aph-star-"));
    assert.equal(fresh.length, 0);
  });

  it("reset item is disabled when already at the starred URL", () => {
    const env = makeEnv();
    const t = starTab(env, "https://example.com/a");
    const resetItem = () =>
      env.menuKids.find((k) => (k.attrs || {}).id === "aph-star-reset");
    fireMenu(env, popupEvent(env, t));
    assert.equal(resetItem().attrs.disabled, "true");
    t.linkedBrowser.currentURI.spec = "https://example.com/elsewhere";
    fireMenu(env, popupEvent(env, t));
    const latest = env.menuKids.filter((k) => (k.attrs || {}).id === "aph-star-reset").pop();
    assert.equal(latest.attrs.disabled, undefined);
  });

  it("edit dialog commits through the palette prompt", () => {
    const env = makeEnv();
    const t = starTab(env, "https://example.com/a");
    fireMenu(env, popupEvent(env, t));
    const edit = env.menuKids.find((k) => (k.attrs || {}).id === "aph-star-set");
    assert.equal(env.prompts.length, 0);
    edit.on_command();
    assert.equal(env.prompts.length, 1);
    assert.equal(env.prompts[0].initial, "https://example.com/a");
    env.prompts[0].onCommit("https://example.com/edited");
    assert.equal(env.api.getStarURL(t), "https://example.com/edited");
  });
});

describe("star close button", () => {
  // Stock close-button stand-in: closest() resolves the button and its
  // owner tab the way XUL DOM does.
  function wireCloseButton(t) {
    const btn = {
      _attrs: {},
      setAttribute(k, v) { this._attrs[k] = String(v); },
      getAttribute(k) { return k in this._attrs ? this._attrs[k] : null; },
      removeAttribute(k) { delete this._attrs[k]; },
      closest(sel) {
        if (sel === ".tab-close-button") return btn;
        if (sel === "tab") return t;
        return null;
      },
    };
    t.querySelector = (sel) => (sel === ".tab-close-button" ? btn : null);
    return btn;
  }

  function fireOnContainer(env, type, target) {
    const ev = {
      target,
      _pd: false,
      _ps: false,
      preventDefault() { this._pd = true; },
      stopPropagation() { this._ps = true; },
    };
    fireContainer(env, type, ev);
    return ev;
  }

  it("clicking the star unstars instead of closing (event swallowed)", () => {
    const env = makeEnv();
    const t = starTab(env, "https://example.com/a");
    const btn = wireCloseButton(t);
    // Tooltip sync runs at star time, before the button mock existed.
    env.api.starTab(t);
    assert.equal(btn.getAttribute("tooltiptext"), "Unstar tab");
    const ev = fireOnContainer(env, "click", btn);
    assert.equal(ev._pd, true, "stock close must never see the click");
    assert.equal(ev._ps, true);
    assert.equal(env.api.isStarred(t), false, "star is removed");
    assert.equal(btn.getAttribute("tooltiptext"), null, "tooltip reverts with the X");
    assert.ok(env.tabs.includes(t), "tab stays open");
  });

  it("keyboard activation (command event) unstars too", () => {
    const env = makeEnv();
    const t = starTab(env, "https://example.com/a");
    wireCloseButton(t);
    const inner = {
      closest(sel) {
        if (sel === ".tab-close-button") return t.querySelector(".tab-close-button");
        return null;
      },
    };
    const ev = fireOnContainer(env, "command", inner);
    assert.equal(ev._pd, true);
    assert.equal(ev._ps, true);
    assert.equal(env.api.isStarred(t), false);
    assert.ok(env.tabs.includes(t), "tab stays open");
  });

  it("plain-tab close buttons pass through untouched", () => {
    const env = makeEnv();
    const t = makeTab(tabVals, { label: "plain", ws: "1", spec: "https://example.com/" });
    env.tabs.push(t);
    const btn = wireCloseButton(t);
    const ev = fireOnContainer(env, "click", btn);
    assert.equal(ev._pd, false, "stock close must proceed");
    assert.equal(ev._ps, false);
    assert.equal(env.api.isStarred(t), false);
    assert.equal(btn.getAttribute("tooltiptext"), null, "no tooltip on plain tabs");
  });

  it("pinned-tab close buttons pass through (pins own their X)", () => {
    const env = makeEnv();
    const t = makeTab(tabVals, { label: "pin", ws: "1", spec: "https://example.com/", pinned: true });
    env.tabs.push(t);
    const btn = wireCloseButton(t);
    const ev = fireOnContainer(env, "click", btn);
    assert.equal(ev._pd, false);
    assert.equal(ev._ps, false);
  });

  it("clicks elsewhere in the tab are ignored", () => {
    const env = makeEnv();
    const t = starTab(env, "https://example.com/a");
    wireCloseButton(t);
    const label = { closest: () => t };
    const ev = fireOnContainer(env, "click", label);
    assert.equal(ev._pd, false);
    assert.equal(ev._ps, false);
    assert.equal(env.api.isStarred(t), true, "star survives");
  });
});
