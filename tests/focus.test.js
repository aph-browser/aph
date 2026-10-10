// Focus mode (branding/src/workspaces/72-focus.js): per-window,
// session-only hiding of every chrome surface (Ctrl+Alt+F + palette).
// The real bundle runs in node:vm with Firefox globals mocked (same
// shape as tests/win-keyboard.test.js).
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { run, makeTab, makeFakeNode: fakeNode } = require("./helpers");

const tabVals = new WeakMap();

function makeEnv(opts) {
  const home = makeTab(tabVals, {
    label: "home", ws: "1", selected: true, spec: "https://start.example.com/",
  });
  let wsel = home;
  const keyHandlers = [];
  const pokeHandlers = [];
  const rootAttrs = {};
  const rootChildren = [];
  let browserFocused = false;
  const sb = {
    window: {
      addEventListener(type, fn) {
        // The window key handler registers first (bundle init); the focus
        // poke listeners arm later, on entry — keep them separate so the
        // hotkey driver always hits the real handler at index 0.
        if (type === "keydown" && keyHandlers.length === 0) {
          keyHandlers.push(fn);
        } else {
          pokeHandlers.push({ type, fn });
        }
      },
      removeEventListener(type, fn) {
        for (const arr of [keyHandlers, pokeHandlers]) {
          const i = arr.findIndex((h) => (h.fn || h) === fn);
          if (i !== -1) arr.splice(i, 1);
        }
      },
      opener: null,
    },
    navigator: { onLine: true },
    document: {
      readyState: "complete",
      getElementById: (id) => rootChildren.find((c) => c.id === id) || null,
      createElement: (tag) => fakeNode(tag),
      createEvent: () => ({ initEvent() {} }),
      documentElement: {
        children: rootChildren,
        appendChild(c) { c.parentNode = this; rootChildren.push(c); return c; },
        removeChild(c) {
          const i = rootChildren.indexOf(c);
          if (i !== -1) rootChildren.splice(i, 1);
          c.parentNode = null;
          return c;
        },
        setAttribute(k, v) { rootAttrs[k] = String(v); },
        getAttribute(k) { return k in rootAttrs ? rootAttrs[k] : null; },
        removeAttribute(k) { delete rootAttrs[k]; },
        hasAttribute(k) { return k in rootAttrs; },
      },
    },
    gBrowser: {
      tabs: [home],
      tabGroups: [],
      get selectedTab() { return wsel; },
      set selectedTab(t) {
        if (wsel) wsel.selected = false;
        wsel = t;
        if (t) t.selected = true;
      },
      get selectedBrowser() {
        return { focus() { browserFocused = true; } };
      },
      showTab(t) { t.removeAttribute("hidden"); },
      addTrustedTab(url) {
        const t = makeTab(tabVals, { label: "new", ws: "1", spec: url });
        sb.gBrowser.tabs.push(t);
        return t;
      },
      removeTab(t) {
        const i = sb.gBrowser.tabs.indexOf(t);
        if (i !== -1) sb.gBrowser.tabs.splice(i, 1);
      },
      discardBrowser() {},
      ungroupTab() {},
      replaceInSuccession() {},
      setSuccessor() {},
      _updateMultiselectedTabCloseButtonTooltip() {},
      getTabForBrowser: (b) => (b && b.__tab) || null,
      addTabsProgressListener() {},
      removeTabsProgressListener() {},
      tabContainer: {
        setAttribute() {},
        getAttribute() { return null; },
        removeAttribute() {},
        addEventListener() {},
        removeEventListener() {},
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
  if (opts && typeof opts.idleMs === "number") {
    sb.window.__aphFocusExitIdleMs = opts.idleMs;
    // helpers.run() pins setTimeout to a no-op by default (deterministic
    // suites); the idle-fade tests need the real clock.
    sb.__aphRealTimers = true;
  }
  run("workspaces.js", sb);
  assert.equal(keyHandlers.length, 1, "expected one window keydown handler");
  const api = sb.window.AphWorkspaces;
  assert.ok(api && typeof api.toggleFocusMode === "function", "focus API exposed");
  function fireKey(o) {
    const e = {
      code: o.code,
      key: o.key || "",
      ctrlKey: !!o.ctrlKey,
      altKey: !!o.altKey,
      shiftKey: !!o.shiftKey,
      metaKey: !!o.metaKey,
      repeat: false,
      target: { id: "", closest: () => null, tagName: "DIV", isContentEditable: false },
      _pd: false,
      _ps: false,
      preventDefault() { e._pd = true; },
      stopPropagation() { e._ps = true; },
    };
    if (!o.noGMS) {
      const altGraph = !!o.altGraph;
      e.getModifierState = (m) => (m === "AltGraph" ? altGraph : false);
    }
    keyHandlers[0](e);
    return e;
  }
  return {
    api, fireKey, rootAttrs,
    wasBrowserFocused: () => browserFocused,
    exitPill: () => rootChildren.find((c) => c.id === "aph-focus-exit") || null,
    isIdle: () => rootAttrs["data-aph-focus-idle"] === "1",
    // Only the focus module pokes on window pointer events — the keydown
    // poke shares its type with the window hotkey handler, so arming is
    // tracked through the two pointer registrations.
    pokeCount: () => pokeHandlers.filter((h) => h.type === "pointermove" || h.type === "pointerdown").length,
    firePoke: (type) => {
      for (const h of pokeHandlers.filter((h) => h.type === type)) h.fn({});
    },
    // Plant a stray pill node (desync harness): the resync tests verify
    // a redundant disable still removes it and a redundant enable still
    // restores a missing one.
    plantStrayPill: () => {
      const n = fakeNode("button");
      n.id = "aph-focus-exit";
      // Wire a real parent link like appendChild does: the resync path
      // removes through parentNode, with btn.remove() as fallback.
      n.parentNode = {
        removeChild(c) {
          const i = rootChildren.indexOf(c);
          if (i !== -1) rootChildren.splice(i, 1);
          c.parentNode = null;
          return c;
        },
      };
      rootChildren.push(n);
      return n;
    },
    home,
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

describe("focus mode", () => {
  it("toggle flips state and stamps the root attribute", () => {
    const env = makeEnv();
    assert.equal(env.api.getFocusMode(), false);
    assert.equal(env.api.toggleFocusMode(), true);
    assert.equal(env.rootAttrs["data-aph-focus"], "1");
    assert.equal(env.api.getFocusMode(), true);
    assert.equal(env.api.toggleFocusMode(), false);
    assert.ok(!("data-aph-focus" in env.rootAttrs));
  });

  it("set is idempotent and focuses the page on enter", () => {
    const env = makeEnv();
    assert.equal(env.api.setFocusMode(true), true);
    assert.equal(env.api.setFocusMode(true), true);
    assert.ok(env.wasBrowserFocused(), "page claims focus when chrome hides");
    assert.equal(env.api.setFocusMode(false), false);
  });

  it("state is per-window: a second window starts off", () => {
    const env1 = makeEnv();
    env1.api.setFocusMode(true);
    const env2 = makeEnv();
    assert.equal(env2.api.getFocusMode(), false, "no global bleed into the new window");
    assert.equal(env1.api.getFocusMode(), true, "first window keeps its mode");
  });

  it("Ctrl+Alt+F toggles via the window key handler", () => {
    const env = makeEnv();
    const e1 = env.fireKey({ code: "KeyF", ctrlKey: true, altKey: true });
    assert.equal(e1._pd, true, "hotkey is claimed");
    assert.equal(e1._ps, true);
    assert.equal(env.api.getFocusMode(), true);
    const e2 = env.fireKey({ code: "KeyF", ctrlKey: true, altKey: true });
    assert.equal(env.api.getFocusMode(), false);
    assert.equal(e2._pd, true);
  });

  it("AltGr+F passes through (no focus toggle while typing)", () => {
    const env = makeEnv();
    const e = env.fireKey({ code: "KeyF", ctrlKey: true, altKey: true, altGraph: true });
    assert.equal(e._pd, false, "must not claim AltGr composition");
    assert.equal(env.api.getFocusMode(), false);
  });

  it("Ctrl+Alt+Shift+F falls through to stock", () => {
    const env = makeEnv();
    const e = env.fireKey({ code: "KeyF", ctrlKey: true, altKey: true, shiftKey: true });
    assert.equal(e._pd, false, "shifted chord is unbound");
    assert.equal(env.api.getFocusMode(), false);
  });

  it("enter mounts the exit pill, exit removes it", () => {
    const env = makeEnv();
    assert.equal(env.exitPill(), null);
    env.api.setFocusMode(true);
    const pill = env.exitPill();
    assert.ok(pill, "pill mounted on enter");
    assert.equal(pill.localName, "button");
    assert.equal(pill.textContent, "Exit focus · Ctrl+Alt+F");
    assert.equal(pill.getAttribute("aria-label"), "Exit focus mode (Ctrl+Alt+F)");
    env.api.setFocusMode(true);
    assert.equal(env.exitPill(), pill, "re-enter reuses the pill");
    env.api.setFocusMode(false);
    assert.equal(env.exitPill(), null, "pill removed on exit");
  });

  it("exit pill click exits focus mode", () => {
    const env = makeEnv();
    env.api.setFocusMode(true);
    assert.equal(env.api.getFocusMode(), true);
    env.exitPill().fire("click", {});
    assert.equal(env.api.getFocusMode(), false, "mouse users can always leave");
    assert.equal(env.exitPill(), null);
  });

  it("exit hint fades after idle, poke restores it", async () => {
    const env = makeEnv({ idleMs: 20 });
    env.api.setFocusMode(true);
    assert.ok(env.exitPill(), "pill mounted on enter");
    assert.equal(env.isIdle(), false, "hint starts visible");
    assert.ok(env.pokeCount() > 0, "poke listeners armed while focused");
    await sleep(60);
    assert.equal(env.isIdle(), true, "hint fades after idle seconds");
    assert.ok(env.exitPill(), "faded pill keeps its node (and its click)");
    env.firePoke("pointermove");
    assert.equal(env.isIdle(), false, "activity restores the hint");
    assert.ok(env.exitPill(), "pill survives the poke");
    await sleep(60);
    assert.equal(env.isIdle(), true, "hint fades again when quiet returns");
    env.api.setFocusMode(false);
    assert.equal(env.exitPill(), null);
  });

  it("exit clears the idle marker and disarms pokes", async () => {
    const env = makeEnv({ idleMs: 20 });
    env.api.setFocusMode(true);
    await sleep(60);
    assert.equal(env.isIdle(), true);
    env.api.setFocusMode(false);
    assert.ok(!("data-aph-focus-idle" in env.rootAttrs), "no stale idle marker");
    assert.equal(env.exitPill(), null);
    assert.equal(env.pokeCount(), 0, "poke listeners removed on exit");
  });

  it("redundant enable re-arms a faded hint", async () => {
    const env = makeEnv({ idleMs: 20 });
    env.api.setFocusMode(true);
    await sleep(60);
    assert.equal(env.isIdle(), true);
    const pill = env.exitPill();
    env.api.setFocusMode(true);
    assert.equal(env.exitPill(), pill, "re-enter reuses the pill");
    assert.equal(env.isIdle(), false, "re-enter reshows the hint");
    env.api.setFocusMode(false);
  });

  it("redundant disable removes a stray pill", () => {
    const env = makeEnv();
    const stray = env.plantStrayPill();
    assert.ok(env.exitPill(), "stray node present");
    env.api.setFocusMode(false);
    assert.equal(env.exitPill(), null, "stray pill cannot outlive the mode");
  });

  it("redundant enable restores a missing pill", () => {
    const env = makeEnv();
    env.api.setFocusMode(true);
    const pill = env.exitPill();
    assert.ok(pill);
    // Simulate an externally removed node: the mode still claims focus.
    pill.parentNode.removeChild(pill);
    assert.equal(env.exitPill(), null, "pill externally gone");
    env.api.setFocusMode(true);
    assert.ok(env.exitPill(), "re-entry remounts the missing pill");
    env.api.setFocusMode(false);
  });
});
