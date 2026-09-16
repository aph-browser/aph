// Ctrl/Cmd+W keeps the selected starred tab open (branding/workspaces.js).
// Stars mirror pins: a drifted star first resets to its starred base URL
// in place (stay selected, no unload); a star already at base parks
// (unloads) instead of closing; a second press (now pending) falls through
// to stock close, as do middle-click and the context menu. Anything unsafe
// or unparkable (unstarred, unsaved work, internal pages, sole visible tab,
// multiselection, pref off) must pass through untouched — except a drifted
// sole star, which can still reset in place with no neighbor.
// Ctrl+Alt+S toggles the star on the selected tab.
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { run, makeTab } = require("./helpers");

function makeEnv() {
  const tabVals = new WeakMap();
  const boolPrefs = {
    "aph.pins.ctrlWUnloads": true,
    "aph.stars.ctrlWUnloads": true,
  };
  const strPrefs = {
    "aph.workspaces.domainRoutes": JSON.stringify({}),
    "aph.workspaces.containerBindings": JSON.stringify({}),
  };
  const discarded = [];
  const env = { refuseDiscard: false };
  const keyHandlers = [];
  let wsel = null;

  const sb = {
    // Real chrome windows provide the WHATWG URL global; node:vm does not.
    URL,
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
      deleteCustomTabValue: (t, k) => {
        const o = tabVals.get(t) || {};
        delete o[k];
        tabVals.set(t, o);
      },
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
  function star(t, base) {
    assert.equal(sb.window.AphStar.starTab(t), true);
    if (base) {
      assert.equal(sb.window.AphStar.setStarURL(t, base), true);
    }
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
      target: o.target || { id: "", closest: () => null, tagName: "DIV", isContentEditable: false },
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
  const starToggle = (extra) => fireKey(Object.assign({ code: "KeyS", ctrlKey: true, altKey: true }, extra));
  return { sb, tabVals, boolPrefs, discarded, env, addTab, star, select, fireKey, ctrlW, starToggle };
}

describe("Ctrl+W parks starred tabs", () => {
  it("parks the selected starred tab and moves selection next", () => {
    const e = makeEnv();
    const tab = e.star(e.addTab({ label: "mail", spec: "https://mail.example.com/" }));
    const next = e.addTab({ label: "docs", spec: "https://docs.example.com/" });
    e.select(tab);
    const ev = e.ctrlW();
    assert.equal(ev._pd, true, "parked press must be claimed");
    assert.equal(ev._ps, true);
    assert.deepEqual(e.discarded, [tab], "star must be discarded");
    assert.equal(e.sb.gBrowser.selectedTab, next, "selection moves like a close");
    assert.ok(e.sb.gBrowser.tabs.includes(tab), "parked star stays in the strip");
    assert.equal(tab.__aphFresh, false, "reload must not retrigger routing");
  });

  it("Cmd+W parks too (macOS close gesture)", () => {
    const e = makeEnv();
    const tab = e.star(e.addTab({ label: "mail", spec: "https://mail.example.com/" }));
    const next = e.addTab({ label: "docs", spec: "https://docs.example.com/" });
    e.select(tab);
    const ev = e.fireKey({ code: "KeyW", metaKey: true });
    assert.equal(ev._pd, true);
    assert.deepEqual(e.discarded, [tab]);
    assert.equal(e.sb.gBrowser.selectedTab, next);
  });

  it("falls back to the previous tab when nothing follows", () => {
    const e = makeEnv();
    const prev = e.addTab({ label: "docs", spec: "https://docs.example.com/" });
    const tab = e.star(e.addTab({ label: "mail", spec: "https://mail.example.com/" }));
    e.select(tab);
    const ev = e.ctrlW();
    assert.equal(ev._pd, true);
    assert.equal(e.sb.gBrowser.selectedTab, prev);
  });

  it("unstarred tabs pass through to stock close", () => {
    const e = makeEnv();
    const tab = e.star(e.addTab({ label: "mail", spec: "https://mail.example.com/" }));
    const plain = e.addTab({ label: "docs", spec: "https://docs.example.com/" });
    e.select(plain);
    const ev = e.ctrlW();
    assert.equal(ev._pd, false, "must not claim stock close");
    assert.equal(ev._ps, false);
    assert.equal(e.discarded.length, 0);
    assert.ok(tab.selected === false && plain.selected === true);
  });

  it("already-pending stars pass through (second press closes)", () => {
    const e = makeEnv();
    const tab = e.star(e.addTab({
      label: "mail", pending: true, spec: "https://mail.example.com/",
    }));
    const next = e.addTab({ label: "docs", spec: "https://docs.example.com/" });
    e.select(tab);
    const ev = e.ctrlW();
    assert.equal(ev._pd, false, "parked star must close via stock");
    assert.equal(ev._ps, false);
    assert.equal(e.discarded.length, 0);
    assert.equal(e.sb.gBrowser.selectedTab, tab, "selection untouched");
    assert.ok(next);
  });

  it("unsaved work passes through so stock prompts", () => {
    const e = makeEnv();
    const tab = e.star(e.addTab({
      label: "mail", beforeUnload: true, spec: "https://mail.example.com/",
    }));
    const next = e.addTab({ label: "docs", spec: "https://docs.example.com/" });
    e.select(tab);
    const ev = e.ctrlW();
    assert.equal(ev._pd, false);
    assert.equal(ev._ps, false);
    assert.equal(e.discarded.length, 0);
    assert.equal(e.sb.gBrowser.selectedTab, tab);
    assert.ok(next);
  });

  it("internal pages pass through", () => {
    const e = makeEnv();
    const tab = e.star(e.addTab({ label: "ntp", spec: "about:newtab" }));
    // about: URLs are not starrable bases, but the flag may exist from a
    // drifted http(s) page; the park guards must still refuse internals.
    e.addTab({ label: "docs", spec: "https://docs.example.com/" });
    e.select(tab);
    const ev = e.ctrlW();
    assert.equal(ev._pd, false);
    assert.equal(e.discarded.length, 0);
  });

  it("pref off passes through", () => {
    const e = makeEnv();
    e.boolPrefs["aph.stars.ctrlWUnloads"] = false;
    const tab = e.star(e.addTab({ label: "mail", spec: "https://mail.example.com/" }));
    e.addTab({ label: "docs", spec: "https://docs.example.com/" });
    e.select(tab);
    const ev = e.ctrlW();
    assert.equal(ev._pd, false);
    assert.equal(e.discarded.length, 0);
  });

  it("pin pref off does not disable star parking", () => {
    const e = makeEnv();
    e.boolPrefs["aph.pins.ctrlWUnloads"] = false;
    const tab = e.star(e.addTab({ label: "mail", spec: "https://mail.example.com/" }));
    const next = e.addTab({ label: "docs", spec: "https://docs.example.com/" });
    e.select(tab);
    const ev = e.ctrlW();
    assert.equal(ev._pd, true);
    assert.deepEqual(e.discarded, [tab]);
    assert.equal(e.sb.gBrowser.selectedTab, next);
  });

  it("Ctrl+Shift+W (close window) passes through even on stars", () => {
    const e = makeEnv();
    const tab = e.star(e.addTab({ label: "mail", spec: "https://mail.example.com/" }));
    e.addTab({ label: "docs", spec: "https://docs.example.com/" });
    e.select(tab);
    const ev = e.ctrlW({ shiftKey: true });
    assert.equal(ev._pd, false);
    assert.equal(e.discarded.length, 0);
  });

  it("sole visible tab passes through (nothing to park onto)", () => {
    const e = makeEnv();
    const tab = e.star(e.addTab({ label: "mail", spec: "https://mail.example.com/" }));
    // Foreign-workspace tabs stay hidden (current-WS tabs are shown on init).
    e.addTab({ label: "hidden", ws: "2", hidden: true, spec: "https://docs.example.com/" });
    e.select(tab);
    const ev = e.ctrlW();
    assert.equal(ev._pd, false);
    assert.equal(e.discarded.length, 0);
    assert.equal(e.sb.gBrowser.selectedTab, tab);
  });

  it("multiselection passes through as a unit", () => {
    const e = makeEnv();
    const tab = e.star(e.addTab({ label: "mail", spec: "https://mail.example.com/" }));
    const next = e.addTab({ label: "docs", spec: "https://docs.example.com/" });
    e.select(tab);
    e.sb.gBrowser.selectedTabs = [tab, next];
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
    const tab = e.star(e.addTab({ label: "mail", spec: "https://mail.example.com/" }));
    const next = e.addTab({ label: "docs", spec: "https://docs.example.com/" });
    e.select(tab);
    const ev = e.ctrlW();
    assert.equal(ev._pd, false, "refusal must not swallow the close");
    assert.equal(e.sb.gBrowser.selectedTab, tab, "selection restored");
    assert.ok(next);
  });
});

describe("Ctrl+W resets drifted starred tabs to base URL", () => {
  function watchLoads(tab) {
    const loads = [];
    tab.linkedBrowser.fixupAndLoadURIString = (url, params) => {
      loads.push({ url, params });
    };
    return loads;
  }

  it("resets a drifted star in place (stays selected, no unload)", () => {
    const e = makeEnv();
    const tab = e.star(
      e.addTab({ label: "mail", spec: "https://mail.example.com/thread/123" }),
      "https://mail.example.com/inbox"
    );
    const next = e.addTab({ label: "docs", spec: "https://docs.example.com/" });
    const loads = watchLoads(tab);
    e.select(tab);
    const ev = e.ctrlW();
    assert.equal(ev._pd, true, "reset press must be claimed");
    assert.equal(ev._ps, true);
    assert.deepEqual(loads.map((c) => c.url), ["https://mail.example.com/inbox"]);
    assert.equal(e.discarded.length, 0, "reset does not unload");
    assert.equal(e.sb.gBrowser.selectedTab, tab, "selection stays on the star");
    assert.ok(e.sb.gBrowser.tabs.includes(tab), "reset star stays in the strip");
    assert.equal(tab.__aphFresh, false, "reset must not retrigger routing");
    assert.ok(next);
  });

  it("parks when already at the starred base URL (reset is a no-op)", () => {
    const e = makeEnv();
    const tab = e.star(
      e.addTab({ label: "mail", spec: "https://mail.example.com/inbox" }),
      "https://mail.example.com/inbox"
    );
    const next = e.addTab({ label: "docs", spec: "https://docs.example.com/" });
    const loads = watchLoads(tab);
    e.select(tab);
    const ev = e.ctrlW();
    assert.equal(ev._pd, true);
    assert.deepEqual(loads, [], "no navigation when already at base");
    assert.deepEqual(e.discarded, [tab], "at-base star parks");
    assert.equal(e.sb.gBrowser.selectedTab, next);
  });

  it("resets a drifted sole star with no neighbor (park impossible)", () => {
    const e = makeEnv();
    const tab = e.star(
      e.addTab({ label: "mail", spec: "https://mail.example.com/thread/123" }),
      "https://mail.example.com/inbox"
    );
    const loads = watchLoads(tab);
    e.select(tab);
    const ev = e.ctrlW();
    assert.equal(ev._pd, true, "reset needs no neighbor");
    assert.equal(ev._ps, true);
    assert.deepEqual(loads.map((c) => c.url), ["https://mail.example.com/inbox"]);
    assert.equal(e.discarded.length, 0);
    assert.equal(e.sb.gBrowser.selectedTab, tab);
  });

  it("drifted star with unsaved work passes through (no reset, stock prompts)", () => {
    const e = makeEnv();
    const tab = e.star(
      e.addTab({
        label: "mail", beforeUnload: true, spec: "https://mail.example.com/thread/123",
      }),
      "https://mail.example.com/inbox"
    );
    const next = e.addTab({ label: "docs", spec: "https://docs.example.com/" });
    const loads = watchLoads(tab);
    e.select(tab);
    const ev = e.ctrlW();
    assert.equal(ev._pd, false);
    assert.equal(ev._ps, false);
    assert.deepEqual(loads, [], "must not navigate away from unsaved work");
    assert.equal(e.discarded.length, 0);
    assert.equal(e.sb.gBrowser.selectedTab, tab);
    assert.ok(next);
  });

  it("pref off disables reset too (passes through)", () => {
    const e = makeEnv();
    e.boolPrefs["aph.stars.ctrlWUnloads"] = false;
    const tab = e.star(
      e.addTab({ label: "mail", spec: "https://mail.example.com/thread/123" }),
      "https://mail.example.com/inbox"
    );
    e.addTab({ label: "docs", spec: "https://docs.example.com/" });
    const loads = watchLoads(tab);
    e.select(tab);
    const ev = e.ctrlW();
    assert.equal(ev._pd, false);
    assert.deepEqual(loads, []);
    assert.equal(e.discarded.length, 0);
  });
});

describe("Ctrl+Alt+S toggles the star", () => {
  it("stars and unstars the selected tab", () => {
    const e = makeEnv();
    const tab = e.addTab({ label: "mail", spec: "https://mail.example.com/" });
    e.select(tab);
    let ev = e.starToggle();
    assert.equal(ev._pd, true, "toggle must be claimed");
    assert.equal(ev._ps, true);
    assert.equal(e.sb.window.AphStar.isStarred(tab), true);
    assert.equal(e.sb.window.AphStar.getStarURL(tab), "https://mail.example.com/");
    ev = e.starToggle();
    assert.equal(ev._pd, true);
    assert.equal(e.sb.window.AphStar.isStarred(tab), false);
  });

  it("refuses pinned tabs", () => {
    const e = makeEnv();
    const pin = e.addTab({ label: "mail", pinned: true, spec: "https://mail.example.com/" });
    e.select(pin);
    const ev = e.starToggle();
    assert.equal(ev._pd, true, "keystroke is still claimed");
    assert.equal(e.sb.window.AphStar.isStarred(pin), false);
  });

  it("does not fire inside the tab-rename editor", () => {
    const e = makeEnv();
    const tab = e.addTab({ label: "mail", spec: "https://mail.example.com/" });
    e.select(tab);
    const ev = e.starToggle({
      target: { id: "aph-tab-rename-input", closest: () => null, tagName: "INPUT", isContentEditable: false },
    });
    assert.equal(ev._pd, false, "editor owns its keystrokes");
    assert.equal(e.sb.window.AphStar.isStarred(tab), false);
  });
});
