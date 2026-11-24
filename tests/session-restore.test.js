// Startup restore vs. empty-workspace placeholders (branding/workspaces.js).
// While SessionStore is still populating the window, every workspace looks
// empty. A user tour through them must not invent about:newtab tabs: on a
// quick quit those placeholders become the session that overwrites the one
// the user was trying to restore. Regression guard for 2026-10-19.
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { run, makeTab } = require("./helpers");

function makeWorld() {
  const tabVals = new WeakMap();
  const winVals = new Map();
  const timeoutQueue = [];
  const obsObservers = [];
  const removedMarkers = [];
  const prefStore = { "aph.welcome.seen": true };
  const sel = makeTab(tabVals, {
    label: "sel",
    ws: "1",
    selected: true,
    spec: "https://start.example.com/",
  });
  let wsel = sel;

  const sessionStore = {
    canRestoreLastSession: true,
    getWindowState: () => ({ windows: [{ tabs: [] }] }),
    getCustomTabValue: (t, k) => (tabVals.get(t) || {})[k],
    setCustomTabValue: (t, k, v) => {
      const o = tabVals.get(t) || {};
      o[k] = v;
      tabVals.set(t, o);
    },
    deleteCustomTabValue: (t, k) => {
      const o = tabVals.get(t);
      if (o) delete o[k];
    },
    isTabRestoring: () => false,
    getCustomWindowValue: (w, k) =>
      k === "aphWsCurrent" ? winVals.get(w) : undefined,
    setCustomWindowValue: (w, k, v) => {
      if (k === "aphWsCurrent") winVals.set(w, v);
    },
  };

  const sb = {
    window: {
      addEventListener() {},
      opener: null,
      __SSi: "test-window",
      close() {
        this.__closed = true;
      },
    },
    navigator: { onLine: true },
    document: {
      readyState: "complete",
      getElementById: () => null,
      createElement: () => ({
        setAttribute() {},
        removeAttribute() {},
        style: {},
      }),
      createEvent: () => ({ initEvent() {} }),
    },
    gBrowser: {
      tabs: [sel],
      tabGroups: [],
      get selectedTab() {
        return wsel;
      },
      set selectedTab(t) {
        if (wsel) wsel.selected = false;
        wsel = t;
        if (t) t.selected = true;
      },
      showTab(t) {
        t.removeAttribute("hidden");
      },
      addTrustedTab(url, opts) {
        const t = makeTab(tabVals, {
          label: "new",
          ws: undefined,
          spec: url,
          cid: (opts && opts.userContextId) || 0,
        });
        tabVals.get(t).aphWs = undefined;
        sb.gBrowser.tabs.push(t);
        return t;
      },
      removeTab(t) {
        const i = sb.gBrowser.tabs.indexOf(t);
        if (i !== -1) sb.gBrowser.tabs.splice(i, 1);
      },
      ungroupTab() {},
      replaceInSuccession() {},
      setSuccessor() {},
      _updateMultiselectedTabCloseButtonTooltip() {},
      getTabForBrowser: (b) => (b && b.__tab) || null,
      addTabsProgressListener() {},
      tabContainer: {
        setAttribute() {},
        addEventListener() {},
        removeEventListener() {},
        _invalidateCachedVisibleTabs() {},
        _updateCloseButtons() {},
      },
    },
    SessionStore: sessionStore,
    PathUtils: {
      profileDir: "/tmp/aph-test-profile",
      join: (...parts) => parts.join("/"),
    },
    IOUtils: {
      remove(path) {
        removedMarkers.push(path);
        return Promise.resolve();
      },
    },
    Services: {
      prefs: {
        getStringPref: (k, d) => (k in prefStore ? prefStore[k] : d),
        setStringPref: (k, v) => {
          prefStore[k] = v;
        },
        getBoolPref: (k, d) => (k in prefStore ? prefStore[k] : d),
        setBoolPref: (k, v) => {
          prefStore[k] = v;
        },
        addObserver() {},
        removeObserver() {},
      },
      console: { logStringMessage() {} },
      wm: {
        getMostRecentWindow: () => null,
        getEnumerator: () => ({ hasMoreElements: () => false }),
      },
      obs: {
        addObserver(o, t) {
          obsObservers.push([o, t]);
        },
        removeObserver() {},
        notifyObservers() {},
      },
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

  // helpers.run() pins setTimeout to a no-op; replace with a flushable
  // queue so the observer's deferred settle can be driven on demand.
  sb.setTimeout = (fn) => {
    timeoutQueue.push(fn);
    return timeoutQueue.length;
  };
  const flushTimeouts = () => {
    while (timeoutQueue.length) timeoutQueue.shift()();
  };
  const observe = (topic, subject = null) => {
    for (const [o, t] of obsObservers.slice()) {
      if (t === topic && typeof o.observe === "function") o.observe(subject, topic, null);
    }
  };
  const wsOf = (t) => (tabVals.get(t) || {}).aphWs;

  return {
    sb,
    api: sb.window.AphWorkspaces,
    flushTimeouts,
    observe,
    removedMarkers,
    wsOf,
    get sel() {
      return sel;
    },
  };
}

describe("startup restore empty-workspace guard", () => {
  it("does not create placeholders until the restore settles", () => {
    const w = makeWorld();
    const before = w.sb.gBrowser.tabs.length;

    assert.equal(w.api.switchTo("2"), "switched");
    assert.equal(w.api.getCurrent(), "2");
    assert.equal(
      w.sb.gBrowser.tabs.length,
      before,
      "a switch during restore must not invent a newtab"
    );
    assert.equal(w.wsOf(w.sel), "1", "restored tab keeps its tag");

    // SessionStore fires its restore-complete notification. From here an
    // empty workspace is genuinely empty and gets its landing tab.
    w.sb.SessionStore.canRestoreLastSession = false;
    w.observe("sessionstore-windows-restored");
    w.flushTimeouts();

    assert.equal(w.sb.gBrowser.tabs.length, before + 1);
    const landed = w.sb.gBrowser.tabs[w.sb.gBrowser.tabs.length - 1];
    assert.equal(w.wsOf(landed), "2", "landing tab joins the claimed workspace");

    // Normal behavior resumes for later switches.
    assert.equal(w.api.switchTo("3"), "switched");
    assert.equal(w.sb.gBrowser.tabs.length, before + 2);
  });
});

describe("restore health handshake", () => {
  it("clears the launcher marker after a healthy restore", () => {
    const w = makeWorld();

    w.observe("sessionstore-windows-restored");
    w.flushTimeouts();

    assert.ok(w.removedMarkers.length > 0);
    assert.equal(
      w.removedMarkers[0],
      "/tmp/aph-test-profile/.aph-session-restore-pending"
    );
  });

  it("clears the marker when multiple restored tabs are New Tab across workspaces", () => {
    const w = makeWorld();
    w.sel.label = "New Tab";
    const other = w.sb.gBrowser.addTrustedTab("https://start.example.com/");
    other.label = "New Tab";

    w.observe("sessionstore-windows-restored");
    w.flushTimeouts();

    assert.ok(w.removedMarkers.length > 0);
  });

  it("keeps the marker when the restored tab has no title", () => {
    const w = makeWorld();
    w.sel.label = "";

    w.observe("sessionstore-windows-restored");
    w.flushTimeouts();

    assert.equal(w.removedMarkers.length, 0);
  });

  it("focuses a titled tab when the saved selected tab is blank", () => {
    const w = makeWorld();
    const other = w.sb.gBrowser.addTrustedTab("https://real.example/");
    w.sel.label = "";

    w.observe("sessionstore-windows-restored");
    w.flushTimeouts();

    assert.equal(w.sb.gBrowser.selectedTab, other);
  });

  it("keeps the marker when the selected tab is still about:blank", () => {
    const w = makeWorld();
    w.sb.gBrowser.addTrustedTab("https://real.example/");
    w.sel.linkedBrowser.currentURI.spec = "about:blank";

    w.observe("sessionstore-windows-restored");
    w.flushTimeouts();

    assert.equal(w.removedMarkers.length, 0);
  });
});

describe("quit guard during restore", () => {
  it("holds the first quit, then closes once restore settles", () => {
    const w = makeWorld();
    const first = { data: false };

    w.observe("quit-application-requested", first);
    assert.equal(first.data, true, "first quit is cancelled while restoring");

    const second = { data: false };
    w.observe("quit-application-requested", second);
    assert.equal(second.data, false, "a second quit is always allowed");

    w.observe("sessionstore-windows-restored");
    w.flushTimeouts();
    assert.equal(w.sb.window.__closed, true, "the held quit resumes after settle");
  });
});
