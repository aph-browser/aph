// Regression guards for starred tabs (workspaces bundle,
// 76-starred.js): star capture, editable custom URL, reset action, the tab
// context menu, and pin/star mutual exclusion. Stars are per-workspace
// normal tabs; Ctrl+W park behavior lives in tests/star-park.test.js.
// The real bundle runs in node:vm with Firefox globals mocked (same shape
// as tests/pinreset.test.js); the AphStar API is exercised directly.
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { run, makeTab, makeGroup } = require("./helpers");

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
      ungroupTab(t) {
        if (!t) return;
        const g = t.group;
        if (g && Array.isArray(g.tabs)) {
          const i = g.tabs.indexOf(t);
          if (i !== -1) g.tabs.splice(i, 1);
        }
        t.group = null;
      },
      moveTabTo(t, opts) {
        if (!opts || typeof opts !== "object" || !Number.isInteger(opts.tabIndex)) {
          throw new Error("moveTabTo requires { tabIndex }");
        }
        const cur = tabs.indexOf(t);
        if (cur === -1) return;
        tabs.splice(cur, 1);
        tabs.splice(Math.max(0, Math.min(opts.tabIndex, tabs.length)), 0, t);
      },
      tabContainer: {
        setAttribute() {},
        // Prod keeps every listener; the mock must too (pinreset, starred,
        // and lifecycle all watch TabPinned; pinreset + starred all
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

describe("starred tab positioning", () => {
  it("forces an ungrouped tab to the top of the workspace", () => {
    const env = makeEnv();
    env.tabs.length = 0;
    const t1 = makeTab(tabVals, { label: "t1", ws: "1", spec: "https://example.com/1" });
    const t2 = makeTab(tabVals, { label: "t2", ws: "1", spec: "https://example.com/2" });
    const t3 = makeTab(tabVals, { label: "t3", ws: "1", spec: "https://example.com/3" });
    env.tabs.push(t1, t2, t3);

    // Star t3 -> moves to index 0 (top of workspace 1)
    assert.equal(env.api.starTab(t3), true);
    assert.deepEqual(env.tabs.map((t) => t.label), ["t3", "t1", "t2"]);
  });

  it("maintains insertion order among multiple workspace stars", () => {
    const env = makeEnv();
    env.tabs.length = 0;
    const t1 = makeTab(tabVals, { label: "t1", ws: "1", spec: "https://example.com/1" });
    const t2 = makeTab(tabVals, { label: "t2", ws: "1", spec: "https://example.com/2" });
    const t3 = makeTab(tabVals, { label: "t3", ws: "1", spec: "https://example.com/3" });
    env.tabs.push(t1, t2, t3);

    env.api.starTab(t3); // ["t3", "t1", "t2"]
    env.api.starTab(t2); // moves after t3 -> ["t3", "t2", "t1"]
    assert.deepEqual(env.tabs.map((t) => t.label), ["t3", "t2", "t1"]);

    env.api.starTab(t1); // already immediately after t2 -> ["t3", "t2", "t1"]
    assert.deepEqual(env.tabs.map((t) => t.label), ["t3", "t2", "t1"]);
  });

  it("never displaces global pinned tabs", () => {
    const env = makeEnv();
    env.tabs.length = 0;
    const pin = makeTab(tabVals, { label: "pin", ws: "1", spec: "https://pin.example/", pinned: true });
    const t1 = makeTab(tabVals, { label: "t1", ws: "1", spec: "https://example.com/1" });
    const t2 = makeTab(tabVals, { label: "t2", ws: "1", spec: "https://example.com/2" });
    env.tabs.push(pin, t1, t2);

    env.api.starTab(t2); // moves to index 1 (after pin)
    assert.deepEqual(env.tabs.map((t) => t.label), ["pin", "t2", "t1"]);
  });

  it("forces a tab inside a tab group to the top of that group only", () => {
    const env = makeEnv();
    env.tabs.length = 0;
    const outBefore = makeTab(tabVals, { label: "out1", ws: "1", spec: "https://out1.example/" });
    const g1 = makeTab(tabVals, { label: "g1", ws: "1", spec: "https://g1.example/" });
    const g2 = makeTab(tabVals, { label: "g2", ws: "1", spec: "https://g2.example/" });
    const g3 = makeTab(tabVals, { label: "g3", ws: "1", spec: "https://g3.example/" });
    const outAfter = makeTab(tabVals, { label: "out2", ws: "1", spec: "https://out2.example/" });

    makeGroup([g1, g2, g3], { label: "Project Alpha" });
    env.tabs.push(outBefore, g1, g2, g3, outAfter);

    // Star g3 -> moves to top of group (index 1), NOT top of workspace (index 0)
    assert.equal(env.api.starTab(g3), true);
    assert.deepEqual(env.tabs.map((t) => t.label), ["out1", "g3", "g1", "g2", "out2"]);
    assert.ok(g3.group, "remains inside the group");
  });

  it("maintains insertion order among multiple stars in a group", () => {
    const env = makeEnv();
    env.tabs.length = 0;
    const g1 = makeTab(tabVals, { label: "g1", ws: "1", spec: "https://g1.example/" });
    const g2 = makeTab(tabVals, { label: "g2", ws: "1", spec: "https://g2.example/" });
    const g3 = makeTab(tabVals, { label: "g3", ws: "1", spec: "https://g3.example/" });
    makeGroup([g1, g2, g3], { label: "Project Alpha" });
    env.tabs.push(g1, g2, g3);

    env.api.starTab(g3); // ["g3", "g1", "g2"]
    env.api.starTab(g2); // moves after g3 -> ["g3", "g2", "g1"]
    assert.deepEqual(env.tabs.map((t) => t.label), ["g3", "g2", "g1"]);
  });

  it("places ungrouped stars above groups in the same workspace", () => {
    const env = makeEnv();
    env.tabs.length = 0;
    const g1 = makeTab(tabVals, { label: "g1", ws: "1", spec: "https://g1.example/" });
    const g2 = makeTab(tabVals, { label: "g2", ws: "1", spec: "https://g2.example/" });
    makeGroup([g1, g2], { label: "Project Alpha" });
    const ungrouped = makeTab(tabVals, { label: "ungrouped", ws: "1", spec: "https://ungrouped.example/" });
    env.tabs.push(g1, g2, ungrouped);

    // Star ungrouped -> moves to index 0, above group
    env.api.starTab(ungrouped);
    assert.deepEqual(env.tabs.map((t) => t.label), ["ungrouped", "g1", "g2"]);
    assert.equal(ungrouped.group, null, "ungrouped tab stays outside group");

    // Star g2 inside group -> moves to top of group (index 1)
    env.api.starTab(g2);
    assert.deepEqual(env.tabs.map((t) => t.label), ["ungrouped", "g2", "g1"]);
  });

  it("keeps tabs from other workspaces undisturbed", () => {
    const env = makeEnv();
    env.tabs.length = 0;
    const w1_a = makeTab(tabVals, { label: "w1_a", ws: "1", spec: "https://w1a.example/" });
    const w1_b = makeTab(tabVals, { label: "w1_b", ws: "1", spec: "https://w1b.example/" });
    const w2_a = makeTab(tabVals, { label: "w2_a", ws: "2", spec: "https://w2a.example/" });
    const w2_b = makeTab(tabVals, { label: "w2_b", ws: "2", spec: "https://w2b.example/" });
    env.tabs.push(w1_a, w1_b, w2_a, w2_b);

    // Star w2_b -> moves to index 2 (top of WS2), not index 0 (WS1)
    env.api.starTab(w2_b);
    assert.deepEqual(env.tabs.map((t) => t.label), ["w1_a", "w1_b", "w2_b", "w2_a"]);
  });

  it("unstarTab does not reposition the tab when it is already at the boundary", () => {
    const env = makeEnv();
    env.tabs.length = 0;
    const t1 = makeTab(tabVals, { label: "t1", ws: "1", spec: "https://example.com/1" });
    const t2 = makeTab(tabVals, { label: "t2", ws: "1", spec: "https://example.com/2" });
    env.tabs.push(t1, t2);

    env.api.starTab(t2); // ["t2", "t1"]
    assert.deepEqual(env.tabs.map((t) => t.label), ["t2", "t1"]);

    env.api.unstarTab(t2);
    assert.deepEqual(env.tabs.map((t) => t.label), ["t2", "t1"], "remains in place on unstar");
  });

  it("unstarring a middle starred tab keeps it in place without moving", () => {
    const env = makeEnv();
    env.tabs.length = 0;
    const s1 = makeTab(tabVals, { label: "s1", ws: "1", spec: "https://example.com/1" });
    const s2 = makeTab(tabVals, { label: "s2", ws: "1", spec: "https://example.com/2" });
    const s3 = makeTab(tabVals, { label: "s3", ws: "1", spec: "https://example.com/3" });
    const u1 = makeTab(tabVals, { label: "u1", ws: "1", spec: "https://example.com/u1" });
    env.tabs.push(s1, s2, s3, u1);

    env.api.starTab(s1);
    env.api.starTab(s2);
    env.api.starTab(s3);
    assert.deepEqual(env.tabs.map((t) => t.label), ["s1", "s2", "s3", "u1"]);

    // Unstar s2 (the middle star): tab remains in place, never zaps down
    assert.equal(env.api.unstarTab(s2), true);
    assert.deepEqual(env.tabs.map((t) => t.label), ["s1", "s2", "s3", "u1"]);
    assert.equal(env.api.isStarred(s1), true);
    assert.equal(env.api.isStarred(s3), true);
    assert.equal(env.api.isStarred(s2), false);
  });

  it("dragging an unstarred tab into the starred zone auto-stars it", () => {
    const env = makeEnv();
    env.tabs.length = 0;
    const s1 = makeTab(tabVals, { label: "s1", ws: "1", spec: "https://example.com/1" });
    const s2 = makeTab(tabVals, { label: "s2", ws: "1", spec: "https://example.com/2" });
    const u1 = makeTab(tabVals, { label: "u1", ws: "1", spec: "https://example.com/u1" });
    env.tabs.push(s1, s2, u1);

    env.api.starTab(s1);
    env.api.starTab(s2);
    assert.equal(env.api.isStarred(u1), false);

    // Simulate drag: user moves u1 between s1 and s2
    env.tabs.splice(2, 1);
    env.tabs.splice(1, 0, u1);
    fireContainer(env, "TabMove", { target: u1 });

    assert.equal(env.api.isStarred(u1), true, "dragging into starred zone auto-stars");
    assert.equal(env.api.getStarURL(u1), "https://example.com/u1");
    assert.deepEqual(env.tabs.map((t) => t.label), ["s1", "u1", "s2"]);
  });

  it("dragging a starred tab down below unstarred tabs auto-unstars it", () => {
    const env = makeEnv();
    env.tabs.length = 0;
    const s1 = makeTab(tabVals, { label: "s1", ws: "1", spec: "https://example.com/1" });
    const s2 = makeTab(tabVals, { label: "s2", ws: "1", spec: "https://example.com/2" });
    const u1 = makeTab(tabVals, { label: "u1", ws: "1", spec: "https://example.com/u1" });
    env.tabs.push(s1, s2, u1);

    env.api.starTab(s1);
    env.api.starTab(s2);

    // Simulate drag: user moves s1 below u1
    env.tabs.splice(0, 1);
    env.tabs.splice(2, 0, s1);
    fireContainer(env, "TabMove", { target: s1 });

    assert.equal(env.api.isStarred(s1), false, "dragging below unstarred tabs auto-unstars");
    assert.deepEqual(env.tabs.map((t) => t.label), ["s2", "u1", "s1"]);
    assert.equal(env.api.isStarred(s2), true);
  });

  it("reordering unstarred tabs when no starred tabs exist never auto-stars", () => {
    const env = makeEnv();
    env.tabs.length = 0;
    const u1 = makeTab(tabVals, { label: "u1", ws: "1", spec: "https://example.com/u1" });
    const u2 = makeTab(tabVals, { label: "u2", ws: "1", spec: "https://example.com/u2" });
    env.tabs.push(u1, u2);

    // Drag u2 to index 0
    env.tabs.splice(1, 1);
    env.tabs.splice(0, 0, u2);
    fireContainer(env, "TabMove", { target: u2 });

    assert.equal(env.api.isStarred(u2), false, "no auto-star when no starred zone exists");
  });

  it("free reordering within the starred zone preserves star status", () => {
    const env = makeEnv();
    env.tabs.length = 0;
    const s1 = makeTab(tabVals, { label: "s1", ws: "1", spec: "https://example.com/1" });
    const s2 = makeTab(tabVals, { label: "s2", ws: "1", spec: "https://example.com/2" });
    const u1 = makeTab(tabVals, { label: "u1", ws: "1", spec: "https://example.com/u1" });
    env.tabs.push(s1, s2, u1);

    env.api.starTab(s1);
    env.api.starTab(s2);

    // Simulate drag: user moves s2 before s1
    env.tabs.splice(1, 1);
    env.tabs.splice(0, 0, s2);
    fireContainer(env, "TabMove", { target: s2 });

    assert.deepEqual(env.tabs.map((t) => t.label), ["s2", "s1", "u1"]);
    assert.equal(env.api.isStarred(s1), true);
    assert.equal(env.api.isStarred(s2), true);
  });

  it("inside a tab group: drag into group starred zone auto-stars and drag down auto-unstars", () => {
    const env = makeEnv();
    env.tabs.length = 0;
    const g1 = makeTab(tabVals, { label: "g1", ws: "1", spec: "https://g1.example/" });
    const g2 = makeTab(tabVals, { label: "g2", ws: "1", spec: "https://g2.example/" });
    const g3 = makeTab(tabVals, { label: "g3", ws: "1", spec: "https://g3.example/" });
    makeGroup([g1, g2, g3], { label: "Project Alpha" });
    env.tabs.push(g1, g2, g3);

    env.api.starTab(g1);
    assert.equal(env.api.isStarred(g1), true);
    assert.equal(env.api.isStarred(g3), false);

    // Drag g3 above g1 in the group -> auto-stars
    env.tabs.splice(2, 1);
    env.tabs.splice(0, 0, g3);
    g3.group.tabs = [g3, g1, g2];
    fireContainer(env, "TabMove", { target: g3 });
    assert.equal(env.api.isStarred(g3), true, "g3 auto-stars in group");

    // Drag g1 below g2 in the group -> auto-unstars
    env.tabs.splice(1, 1);
    env.tabs.splice(2, 0, g1);
    g1.group.tabs = [g3, g2, g1];
    fireContainer(env, "TabMove", { target: g1 });
    assert.equal(env.api.isStarred(g1), false, "g1 auto-unstars when dragged down in group");
  });

  it("new tabs spawn strictly below the starred zone", () => {
    const env = makeEnv();
    env.tabs.length = 0;
    const s1 = makeTab(tabVals, { label: "s1", ws: "1", spec: "https://example.com/1" });
    const s2 = makeTab(tabVals, { label: "s2", ws: "1", spec: "https://example.com/2" });
    env.tabs.push(s1, s2);

    env.api.starTab(s1);
    env.api.starTab(s2);
    env.sb.gBrowser.selectedTab = s1; // Focus is on top star

    // Open new tab in bound workspace
    const newTab = env.sb.window.AphWorkspaces
      ? env.sb.window.AphWorkspaces.openBoundTab("about:newtab", "1")
      : null;

    if (newTab) {
      const idx = env.tabs.indexOf(newTab);
      const s1Idx = env.tabs.indexOf(s1);
      const s2Idx = env.tabs.indexOf(s2);
      assert.ok(idx > s1Idx && idx > s2Idx, "new tab must be placed below all starred tabs");
    }
  });

  it("manual new tabs spawn at the top of the working list in LIFO order", () => {
    const env = makeEnv();
    env.tabs.length = 0;
    const pin = makeTab(tabVals, { label: "pin", ws: "1", spec: "https://pin.example/", pinned: true });
    const s1 = makeTab(tabVals, { label: "s1", ws: "1", spec: "https://example.com/1" });
    const s2 = makeTab(tabVals, { label: "s2", ws: "1", spec: "https://example.com/2" });
    const oldTab = makeTab(tabVals, { label: "oldTab", ws: "1", spec: "https://example.com/old" });
    env.tabs.push(pin, s1, s2, oldTab);

    env.api.starTab(s1);
    env.api.starTab(s2);
    assert.deepEqual(env.tabs.map((t) => t.label), ["pin", "s1", "s2", "oldTab"]);

    // Spawn first new tab: targets index 3 (immediately below s2)
    const t1 = env.sb.window.AphWorkspaces.openBoundTab("about:newtab", "1");
    t1.label = "t1";
    assert.deepEqual(env.tabs.map((t) => t.label), ["pin", "s1", "s2", "t1", "oldTab"]);

    // Spawn second new tab: targets index 3 (pushes t1 and oldTab down)
    const t2 = env.sb.window.AphWorkspaces.openBoundTab("about:newtab", "1");
    t2.label = "t2";
    assert.deepEqual(env.tabs.map((t) => t.label), ["pin", "s1", "s2", "t2", "t1", "oldTab"]);
  });

  it("stamps data-aph-starred-first and data-aph-starred-last on the boundary tabs in workspace and groups", () => {
    const env = makeEnv();
    env.tabs.length = 0;
    const s1 = makeTab(tabVals, { label: "s1", ws: "1", spec: "https://example.com/1" });
    const s2 = makeTab(tabVals, { label: "s2", ws: "1", spec: "https://example.com/2" });
    const u1 = makeTab(tabVals, { label: "u1", ws: "1", spec: "https://example.com/u1" });
    env.tabs.push(s1, s2, u1);

    env.api.starTab(s1);
    env.api.starTab(s2);

    assert.equal(s1.getAttribute(env.api.STAR_FIRST_ATTR), "1", "s1 is first star and marked");
    assert.equal(s1.hasAttribute(env.api.STAR_LAST_ATTR), false, "s1 is not last star");
    assert.equal(s2.hasAttribute(env.api.STAR_FIRST_ATTR), false, "s2 is not first star");
    assert.equal(s2.getAttribute(env.api.STAR_LAST_ATTR), "1", "s2 is last star and marked");

    // Unstar s2 -> s1 becomes both first and last star
    env.api.unstarTab(s2);
    assert.equal(s1.getAttribute(env.api.STAR_FIRST_ATTR), "1", "s1 is first star");
    assert.equal(s1.getAttribute(env.api.STAR_LAST_ATTR), "1", "s1 now becomes last star");
    assert.equal(s2.hasAttribute(env.api.STAR_FIRST_ATTR), false, "s2 unstarred");
    assert.equal(s2.hasAttribute(env.api.STAR_LAST_ATTR), false, "s2 unstarred, no marker");

    // Group-scoped check:
    const g1 = makeTab(tabVals, { label: "g1", ws: "1", spec: "https://g1.example/" });
    const g2 = makeTab(tabVals, { label: "g2", ws: "1", spec: "https://g2.example/" });
    const g3 = makeTab(tabVals, { label: "g3", ws: "1", spec: "https://g3.example/" });
    makeGroup([g1, g2, g3], { label: "Team" });
    env.tabs.push(g1, g2, g3);

    env.api.starTab(g1);
    env.api.starTab(g2);
    assert.equal(g1.getAttribute(env.api.STAR_FIRST_ATTR), "1", "g1 is first star in group and marked");
    assert.equal(g1.hasAttribute(env.api.STAR_LAST_ATTR), false, "g1 is not last star in group");
    assert.equal(g2.hasAttribute(env.api.STAR_FIRST_ATTR), false, "g2 is not first star in group");
    assert.equal(g2.getAttribute(env.api.STAR_LAST_ATTR), "1", "g2 is last star in group and marked");
  });

  it("stamps data-aph-starred-drift when navigated away from base URL and clears on match", () => {
    const env = makeEnv();
    env.tabs.length = 0;
    const s1 = makeTab(tabVals, { label: "s1", ws: "1", spec: "https://example.com/home" });
    env.tabs.push(s1);

    env.api.starTab(s1);
    assert.equal(s1.hasAttribute(env.api.STAR_DRIFT_ATTR), false, "at base URL, no drift");
    assert.equal(env.api.isDrifted(s1), false);

    // Navigate to subpage
    s1.linkedBrowser.currentURI.spec = "https://example.com/home/subpage";
    env.api.starTab(s1); // Re-apply sync
    assert.equal(s1.getAttribute(env.api.STAR_DRIFT_ATTR), "1", "drifted, marked with drift attr");
    assert.equal(env.api.isDrifted(s1), true);

    // Navigate back to base
    s1.linkedBrowser.currentURI.spec = "https://example.com/home";
    env.api.starTab(s1);
    assert.equal(s1.hasAttribute(env.api.STAR_DRIFT_ATTR), false, "returned to base, drift cleared");
    assert.equal(env.api.isDrifted(s1), false);
  });
});
