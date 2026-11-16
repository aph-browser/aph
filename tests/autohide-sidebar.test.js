// Auto-hide sidebar / Peek mode (branding/src/workspaces/73-autohide-sidebar.js):
// Collapses sidebar off-screen to 0px at rest (Ctrl+\), peeking on left edge hover.
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { run, makeTab, makeFakeNode: fakeNode } = require("./helpers");

const tabVals = new WeakMap();

function makeEnv(opts = {}) {
  const home = makeTab(tabVals, {
    label: "home", ws: "1", selected: true, spec: "https://start.example.com/",
  });
  let wsel = home;
  const keyHandlers = [];
  const pointerHandlers = [];
  const rootAttrs = {};
  const rootChildren = [];
  const prefs = new Map([
    ["aph.sidebar.autohide", !!opts.initialPref],
  ]);
  const observers = new Map();

  const sb = {
    window: {
      innerHeight: 800,
      addEventListener(type, fn, capture) {
        if (type === "keydown") {
          keyHandlers.push(fn);
        } else if (type === "pointermove") {
          pointerHandlers.push({ fn, capture });
        }
      },
      removeEventListener(type, fn) {
        if (type === "keydown") {
          const idx = keyHandlers.indexOf(fn);
          if (idx !== -1) keyHandlers.splice(idx, 1);
        } else if (type === "pointermove") {
          const idx = pointerHandlers.findIndex((h) => h.fn === fn);
          if (idx !== -1) pointerHandlers.splice(idx, 1);
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
        return { focus() {} };
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
        getBoolPref: (k, d) => {
          if (prefs.has(k)) return prefs.get(k);
          if (d !== undefined) return !!d;
          throw new Error("no pref " + k);
        },
        setBoolPref: (k, v) => {
          prefs.set(k, !!v);
          const obsList = observers.get(k) || [];
          for (const obs of obsList) {
            try { obs.observe(null, "nsPref:changed", k); } catch (e) {}
          }
        },
        getIntPref: (k, d) => { if (d !== undefined) return d; throw new Error("no pref"); },
        addObserver: (k, obs) => {
          if (!observers.has(k)) observers.set(k, []);
          observers.get(k).push(obs);
        },
        removeObserver: (k, obs) => {
          const list = observers.get(k) || [];
          const idx = list.indexOf(obs);
          if (idx !== -1) list.splice(idx, 1);
        },
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

  const api = sb.window.AphWorkspaces;

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
    for (const h of keyHandlers) {
      h(e);
      if (e._ps) break;
    }
    return e;
  }

  function firePointer(clientX) {
    const e = { clientX, pointerType: "mouse" };
    for (const h of [...pointerHandlers]) {
      h.fn(e);
    }
  }

  return {
    api,
    fireKey,
    firePointer,
    rootAttrs,
    pointerHandlers,
    window: sb.window,
  };
}

describe("autohide sidebar", () => {
  it("exposes autohide API on AphWorkspaces and window", () => {
    const env = makeEnv();
    assert.equal(typeof env.api.toggleAutohideSidebar, "function");
    assert.equal(typeof env.api.getAutohideSidebar, "function");
    assert.equal(typeof env.api.setAutohideSidebar, "function");
    assert.equal(typeof env.window.toggleAutohideSidebar, "function");
  });

  it("toggles autohide state and stamps data-aph-autohide-sidebar on root", () => {
    const env = makeEnv();
    assert.equal(env.api.getAutohideSidebar(), false);
    assert.equal(env.rootAttrs["data-aph-autohide-sidebar"], undefined);

    const on = env.api.toggleAutohideSidebar();
    assert.equal(on, true);
    assert.equal(env.api.getAutohideSidebar(), true);
    assert.equal(env.rootAttrs["data-aph-autohide-sidebar"], "1");

    const off = env.api.toggleAutohideSidebar();
    assert.equal(off, false);
    assert.equal(env.api.getAutohideSidebar(), false);
    assert.equal(env.rootAttrs["data-aph-autohide-sidebar"], undefined);
  });

  it("toggles via Ctrl+\\ hotkey", () => {
    const env = makeEnv();
    assert.equal(env.api.getAutohideSidebar(), false);

    const ev = env.fireKey({ ctrlKey: true, code: "Backslash" });
    assert.equal(ev._pd, true, "preventDefault called");
    assert.equal(ev._ps, true, "stopPropagation called");
    assert.equal(env.api.getAutohideSidebar(), true);
    assert.equal(env.rootAttrs["data-aph-autohide-sidebar"], "1");

    const ev2 = env.fireKey({ ctrlKey: true, code: "Backslash" });
    assert.equal(ev2._pd, true);
    assert.equal(env.api.getAutohideSidebar(), false);
    assert.equal(env.rootAttrs["data-aph-autohide-sidebar"], undefined);
  });

  it("toggles via Cmd+\\ on macOS", () => {
    const env = makeEnv();
    const ev = env.fireKey({ metaKey: true, code: "Backslash" });
    assert.equal(ev._pd, true);
    assert.equal(env.api.getAutohideSidebar(), true);
    assert.equal(env.rootAttrs["data-aph-autohide-sidebar"], "1");
  });

  it("arms pointer proximity when enabled and sets peek on left edge hover", () => {
    const env = makeEnv();
    assert.equal(env.pointerHandlers.length, 0, "no pointer handler when disabled");

    env.api.setAutohideSidebar(true);
    assert.equal(env.pointerHandlers.length, 1, "pointer handler armed");

    // Pointer at x=10 (within 14px of left edge) -> peek activates
    env.firePointer(10);
    assert.equal(env.rootAttrs["data-aph-sidebar-peek"], "1");

    // Pointer at x=100 (inside 240px sidebar) -> peek stays active
    env.firePointer(100);
    assert.equal(env.rootAttrs["data-aph-sidebar-peek"], "1");

    // Pointer leaves beyond 260px into web page -> peek deactivates
    env.firePointer(270);
    assert.equal(env.rootAttrs["data-aph-sidebar-peek"], undefined);
  });

  it("disarms pointer listeners and clears peek attribute when disabled", () => {
    const env = makeEnv();
    env.api.setAutohideSidebar(true);
    env.firePointer(5);
    assert.equal(env.rootAttrs["data-aph-sidebar-peek"], "1");

    env.api.setAutohideSidebar(false);
    assert.equal(env.pointerHandlers.length, 0, "pointer handler disarmed");
    assert.equal(env.rootAttrs["data-aph-sidebar-peek"], undefined);
    assert.equal(env.rootAttrs["data-aph-autohide-sidebar"], undefined);
  });
});
