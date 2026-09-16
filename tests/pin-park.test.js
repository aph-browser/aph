// Ctrl/Cmd+W keeps the selected pinned tab open (branding/workspaces.js).
// Pins are app anchors: a drifted pin first resets to its pinned base URL
// in place (stay selected, no unload); a pin already at base parks
// (unloads) instead of closing; a second press (now pending) falls through
// to stock close, as do middle-click and the context menu. Anything unsafe
// or unparkable (unpinned, unsaved work, internal pages, sole visible tab,
// multiselection, pref off) must pass through untouched — except a drifted
// sole pin, which can still reset in place with no neighbor.
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { run, makeTab } = require("./helpers");

function makeEnv() {
  const tabVals = new WeakMap();
  const boolPrefs = { "aph.pins.ctrlWUnloads": true };
  const strPrefs = {
    "aph.workspaces.domainRoutes": JSON.stringify({}),
    "aph.workspaces.containerBindings": JSON.stringify({}),
  };
  const discarded = [];
  const env = { refuseDiscard: false };
  const keyHandlers = [];
  let wsel = null;

  const sb = {
    window: {
      addEventListener(type, fn) { if (type === "keydown") keyHandlers.push(fn); },
      opener: null,
    },
    navigator: { onLine: true },
    document: {
      readyState: "complete",
      getElementById: () => null,
      createElement: () => ({ setAttribute() {}, removeAttribute() {}, style: {} }),
      createEvent: () => ({ initEvent() {} }),
    },
    gBrowser: {
      tabs: [],
      tabGroups: [],
      get selectedTab() { return wsel; },
      set selectedTab(t) {
        if (wsel) wsel.selected = false;
        wsel = t;
        if (t) t.selected = true;
      },
      showTab(t) { t.removeAttribute("hidden"); },
      addTrustedTab(url, opts) {
        const t = makeTab(tabVals, {
          label: "new", ws: "1", spec: url, cid: (opts && opts.userContextId) || 0,
        });
        sb.gBrowser.tabs.push(t);
        return t;
      },
      removeTab(t) {
        const i = sb.gBrowser.tabs.indexOf(t);
        if (i !== -1) sb.gBrowser.tabs.splice(i, 1);
      },
      discardBrowser(t) {
        discarded.push(t);
        if (env.refuseDiscard) return false;
        return undefined;
      },
      ungroupTab() {},
      replaceInSuccession() {},
      setSuccessor() {},
      _updateMultiselectedTabCloseButtonTooltip() {},
      getTabForBrowser: (b) => (b && b.__tab) || null,
      addTabsProgressListener() {},
      tabContainer: {
        setAttribute() {},
        removeAttribute() {},
        addEventListener() {},
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
      getCustomWindowValue: () => undefined,
      setCustomWindowValue: () => {},
    },
    Services: {
      prefs: {
        getStringPref: (k, d) => (k in strPrefs ? strPrefs[k] : d),
        setStringPref: (k, v) => { strPrefs[k] = v; },
        getBoolPref: (k) => {
          if (k in boolPrefs) return boolPrefs[k];
          throw new Error(`unset pref ${k}`);
        },
        setBoolPref: (k, v) => { boolPrefs[k] = v; },
        addObserver() {},
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
      importESModule: () => ({
        ContextualIdentityService: {
          getPublicIdentityFromId: () => null,
          getPublicIdentities: () => [],
          create: () => ({ userContextId: 99 }),
          remove: () => {},
        },
      }),
    },
    Ci: {
      nsIWebProgressListener: { LOCATION_CHANGE_SAME_DOCUMENT: 2 },
      nsIWebProgress: { NOTIFY_LOCATION: 1 },
    },
  };
  sb.window.window = sb.window;
  run("workspaces.js", sb);
  assert.equal(keyHandlers.length, 1, "expected one window keydown handler");
  // Bundle init births a scratch new-tab via addTrustedTab; tests start
  // from an empty strip so neighbor math is exact.
  sb.gBrowser.selectedTab = null;
  sb.gBrowser.tabs.length = 0;

  function addTab(o) {
    const t = makeTab(tabVals, Object.assign({ ws: "1" }, o));
    sb.gBrowser.tabs.push(t);
    return t;
  }
  function select(t) { sb.gBrowser.selectedTab = t; }
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
      preventDefault() { this._pd = true; },
      stopPropagation() { this._ps = true; },
      getModifierState: () => false,
    };
    keyHandlers[0](e);
    return e;
  }
  const ctrlW = (extra) => fireKey(Object.assign({ code: "KeyW", ctrlKey: true }, extra));
  return { sb, tabVals, boolPrefs, discarded, env, addTab, select, fireKey, ctrlW };
}

describe("Ctrl+W parks pinned tabs", () => {
  it("parks the selected pinned tab and moves selection next", () => {
    const e = makeEnv();
    const pin = e.addTab({ label: "mail", pinned: true, spec: "https://mail.example.com/" });
    const next = e.addTab({ label: "docs", spec: "https://docs.example.com/" });
    e.select(pin);
    const ev = e.ctrlW();
    assert.equal(ev._pd, true, "parked press must be claimed");
    assert.equal(ev._ps, true);
    assert.deepEqual(e.discarded, [pin], "pin must be discarded");
    assert.equal(e.sb.gBrowser.selectedTab, next, "selection moves like a close");
    assert.ok(e.sb.gBrowser.tabs.includes(pin), "parked pin stays in the strip");
    assert.equal(pin.__aphFresh, false, "reload must not retrigger routing");
  });

  it("Cmd+W parks too (macOS close gesture)", () => {
    const e = makeEnv();
    const pin = e.addTab({ label: "mail", pinned: true, spec: "https://mail.example.com/" });
    const next = e.addTab({ label: "docs", spec: "https://docs.example.com/" });
    e.select(pin);
    const ev = e.fireKey({ code: "KeyW", metaKey: true });
    assert.equal(ev._pd, true);
    assert.deepEqual(e.discarded, [pin]);
    assert.equal(e.sb.gBrowser.selectedTab, next);
  });

  it("falls back to the previous tab when nothing follows", () => {
    const e = makeEnv();
    const prev = e.addTab({ label: "docs", spec: "https://docs.example.com/" });
    const pin = e.addTab({ label: "mail", pinned: true, spec: "https://mail.example.com/" });
    e.select(pin);
    const ev = e.ctrlW();
    assert.equal(ev._pd, true);
    assert.equal(e.sb.gBrowser.selectedTab, prev);
  });

  it("unpinned tabs pass through to stock close", () => {
    const e = makeEnv();
    const pin = e.addTab({ label: "mail", pinned: true, spec: "https://mail.example.com/" });
    const plain = e.addTab({ label: "docs", spec: "https://docs.example.com/" });
    e.select(plain);
    const ev = e.ctrlW();
    assert.equal(ev._pd, false, "must not claim stock close");
    assert.equal(ev._ps, false);
    assert.equal(e.discarded.length, 0);
    assert.ok(pin.selected === false && plain.selected === true);
  });

  it("already-pending pins pass through (second press closes)", () => {
    const e = makeEnv();
    const pin = e.addTab({
      label: "mail", pinned: true, pending: true, spec: "https://mail.example.com/",
    });
    const next = e.addTab({ label: "docs", spec: "https://docs.example.com/" });
    e.select(pin);
    const ev = e.ctrlW();
    assert.equal(ev._pd, false, "parked pin must close via stock");
    assert.equal(ev._ps, false);
    assert.equal(e.discarded.length, 0);
    assert.equal(e.sb.gBrowser.selectedTab, pin, "selection untouched");
    assert.ok(next);
  });

  it("unsaved work passes through so stock prompts", () => {
    const e = makeEnv();
    const pin = e.addTab({
      label: "mail", pinned: true, beforeUnload: true, spec: "https://mail.example.com/",
    });
    const next = e.addTab({ label: "docs", spec: "https://docs.example.com/" });
    e.select(pin);
    const ev = e.ctrlW();
    assert.equal(ev._pd, false);
    assert.equal(ev._ps, false);
    assert.equal(e.discarded.length, 0);
    assert.equal(e.sb.gBrowser.selectedTab, pin);
    assert.ok(next);
  });

  it("internal pages pass through", () => {
    const e = makeEnv();
    const pin = e.addTab({ label: "ntp", pinned: true, spec: "about:newtab" });
    e.addTab({ label: "docs", spec: "https://docs.example.com/" });
    e.select(pin);
    const ev = e.ctrlW();
    assert.equal(ev._pd, false);
    assert.equal(e.discarded.length, 0);
  });

  it("pref off passes through", () => {
    const e = makeEnv();
    e.boolPrefs["aph.pins.ctrlWUnloads"] = false;
    const pin = e.addTab({ label: "mail", pinned: true, spec: "https://mail.example.com/" });
    e.addTab({ label: "docs", spec: "https://docs.example.com/" });
    e.select(pin);
    const ev = e.ctrlW();
    assert.equal(ev._pd, false);
    assert.equal(e.discarded.length, 0);
  });

  it("Ctrl+Shift+W (close window) passes through even on pins", () => {
    const e = makeEnv();
    const pin = e.addTab({ label: "mail", pinned: true, spec: "https://mail.example.com/" });
    e.addTab({ label: "docs", spec: "https://docs.example.com/" });
    e.select(pin);
    const ev = e.ctrlW({ shiftKey: true });
    assert.equal(ev._pd, false);
    assert.equal(e.discarded.length, 0);
  });

  it("sole visible tab passes through (nothing to park onto)", () => {
    const e = makeEnv();
    const pin = e.addTab({ label: "mail", pinned: true, spec: "https://mail.example.com/" });
    // Foreign-workspace tabs stay hidden (current-WS tabs are shown on init).
    e.addTab({ label: "hidden", ws: "2", hidden: true, spec: "https://docs.example.com/" });
    e.select(pin);
    const ev = e.ctrlW();
    assert.equal(ev._pd, false);
    assert.equal(e.discarded.length, 0);
    assert.equal(e.sb.gBrowser.selectedTab, pin);
  });

  it("multiselection passes through as a unit", () => {
    const e = makeEnv();
    const pin = e.addTab({ label: "mail", pinned: true, spec: "https://mail.example.com/" });
    const next = e.addTab({ label: "docs", spec: "https://docs.example.com/" });
    e.select(pin);
    e.sb.gBrowser.selectedTabs = [pin, next];
    try {
      const ev = e.ctrlW();
      assert.equal(ev._pd, false);
      assert.equal(e.discarded.length, 0);
    } finally {
      delete e.sb.gBrowser.selectedTabs;
    }
  });

  it("discard refusal restores selection and passes through", () => {
    const e = makeEnv();
    e.env.refuseDiscard = true;
    const pin = e.addTab({ label: "mail", pinned: true, spec: "https://mail.example.com/" });
    const next = e.addTab({ label: "docs", spec: "https://docs.example.com/" });
    e.select(pin);
    const ev = e.ctrlW();
    assert.equal(ev._pd, false, "refusal must not swallow the close");
    assert.equal(e.sb.gBrowser.selectedTab, pin, "selection restored");
    assert.ok(next);
  });
});

describe("Ctrl+W resets drifted pinned tabs to base URL", () => {
  // Stored pinned base (SessionStore aphPinURL) differs from the live page.
  function drift(pin, tabVals, base) {
    Object.assign(tabVals.get(pin), { aphPinURL: base });
  }
  function watchLoads(pin) {
    const loads = [];
    pin.linkedBrowser.fixupAndLoadURIString = (url, params) => {
      loads.push({ url, params });
    };
    return loads;
  }

  it("resets a drifted pin in place (stays selected, no unload)", () => {
    const e = makeEnv();
    const pin = e.addTab({ label: "mail", pinned: true, spec: "https://mail.example.com/thread/123" });
    const next = e.addTab({ label: "docs", spec: "https://docs.example.com/" });
    drift(pin, e.tabVals, "https://mail.example.com/inbox");
    const loads = watchLoads(pin);
    e.select(pin);
    const ev = e.ctrlW();
    assert.equal(ev._pd, true, "reset press must be claimed");
    assert.equal(ev._ps, true);
    assert.deepEqual(loads.map((c) => c.url), ["https://mail.example.com/inbox"]);
    assert.equal(e.discarded.length, 0, "reset does not unload");
    assert.equal(e.sb.gBrowser.selectedTab, pin, "selection stays on the pin");
    assert.ok(e.sb.gBrowser.tabs.includes(pin), "reset pin stays in the strip");
    assert.equal(pin.__aphFresh, false, "reset must not retrigger routing");
    assert.ok(next);
  });

  it("parks when already at the pinned base URL (reset is a no-op)", () => {
    const e = makeEnv();
    const pin = e.addTab({ label: "mail", pinned: true, spec: "https://mail.example.com/inbox" });
    const next = e.addTab({ label: "docs", spec: "https://docs.example.com/" });
    drift(pin, e.tabVals, "https://mail.example.com/inbox");
    const loads = watchLoads(pin);
    e.select(pin);
    const ev = e.ctrlW();
    assert.equal(ev._pd, true);
    assert.deepEqual(loads, [], "no navigation when already at base");
    assert.deepEqual(e.discarded, [pin], "at-base pin parks");
    assert.equal(e.sb.gBrowser.selectedTab, next);
  });

  it("resets a drifted sole pin with no neighbor (park impossible)", () => {
    const e = makeEnv();
    const pin = e.addTab({ label: "mail", pinned: true, spec: "https://mail.example.com/thread/123" });
    drift(pin, e.tabVals, "https://mail.example.com/inbox");
    const loads = watchLoads(pin);
    e.select(pin);
    const ev = e.ctrlW();
    assert.equal(ev._pd, true, "reset needs no neighbor");
    assert.equal(ev._ps, true);
    assert.deepEqual(loads.map((c) => c.url), ["https://mail.example.com/inbox"]);
    assert.equal(e.discarded.length, 0);
    assert.equal(e.sb.gBrowser.selectedTab, pin);
  });

  it("drifted pin with unsaved work passes through (no reset, stock prompts)", () => {
    const e = makeEnv();
    const pin = e.addTab({
      label: "mail", pinned: true, beforeUnload: true, spec: "https://mail.example.com/thread/123",
    });
    const next = e.addTab({ label: "docs", spec: "https://docs.example.com/" });
    drift(pin, e.tabVals, "https://mail.example.com/inbox");
    const loads = watchLoads(pin);
    e.select(pin);
    const ev = e.ctrlW();
    assert.equal(ev._pd, false);
    assert.equal(ev._ps, false);
    assert.deepEqual(loads, [], "must not navigate away from unsaved work");
    assert.equal(e.discarded.length, 0);
    assert.equal(e.sb.gBrowser.selectedTab, pin);
    assert.ok(next);
  });

  it("pref off disables reset too (passes through)", () => {
    const e = makeEnv();
    e.boolPrefs["aph.pins.ctrlWUnloads"] = false;
    const pin = e.addTab({ label: "mail", pinned: true, spec: "https://mail.example.com/thread/123" });
    e.addTab({ label: "docs", spec: "https://docs.example.com/" });
    drift(pin, e.tabVals, "https://mail.example.com/inbox");
    const loads = watchLoads(pin);
    e.select(pin);
    const ev = e.ctrlW();
    assert.equal(ev._pd, false);
    assert.deepEqual(loads, []);
    assert.equal(e.discarded.length, 0);
  });
});
