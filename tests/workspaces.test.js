// Regression guards for the domain-routing engine (branding/workspaces.js).
// Mocks mirror build/firefox/omni.ja: tabs listeners receive
// (browser, webProgress, request, location, flags).
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { run, makeTab } = require("./helpers");

const tabVals = new WeakMap();
const prefStore = {
  "aph.workspaces.domainRoutes": JSON.stringify({
    "github.com": "2",
    "amazon.com": "1",
    "aws.amazon.com": "2",
  }),
  "aph.workspaces.containerBindings": JSON.stringify({ "2": 7 }),
};
const created = [];
const removed = [];
const discarded = [];
let listener = null;

const home = makeTab(tabVals, {
  label: "home", ws: "1", selected: true, spec: "https://start.example.com/",
});
let wsel = home;

const sb = {
  window: { addEventListener() {}, opener: null },
  navigator: { onLine: true },
  document: {
    readyState: "complete",
    getElementById: () => null,
    createElement: () => ({ setAttribute() {}, removeAttribute() {}, style: {} }),
    createEvent: () => ({ initEvent() {} }),
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
    showTab(t) { t.removeAttribute("hidden"); },
    addTrustedTab(url, opts) {
      const t = makeTab(tabVals, {
        label: "new", ws: "1", spec: url, cid: (opts && opts.userContextId) || 0,
      });
      created.push(t);
      sb.gBrowser.tabs.push(t);
      return t;
    },
    removeTab(t) {
      removed.push(t.label);
      const i = sb.gBrowser.tabs.indexOf(t);
      if (i !== -1) sb.gBrowser.tabs.splice(i, 1);
    },
    discardBrowser(t) {
      discarded.push(t.label);
      t.setAttribute("pending", "");
    },
    ungroupTab() {},
    replaceInSuccession() {},
    setSuccessor() {},
    _updateMultiselectedTabCloseButtonTooltip() {},
    getTabForBrowser: (b) => (b && b.__tab) || null,
    addTabsProgressListener(l) { listener = l; },
    tabContainer: {
      setAttribute() {},
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
      getStringPref: (k, d) => (k in prefStore ? prefStore[k] : d),
      setStringPref: (k, v) => { prefStore[k] = v; },
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
        getPublicIdentityFromId: (id) =>
          id === 7 ? { name: "Work", color: "blue", icon: "briefcase" } : null,
        create: () => { throw new Error("unused"); },
        remove: () => {},
      },
    }),
  },
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
const api = sb.window.AphWorkspaces;
const wsOf = (t) => tabVals.get(t).aphWs;

function fireLoc(tab, host, o = {}) {
  listener.onLocationChange(
    tab.__browser,
    { isTopLevel: o.topLevel !== false },
    null,
    { scheme: o.scheme || "https", asciiHost: host },
    o.sameDoc ? 2 : 0
  );
}

// Document STATE_START with a channel-like request: { canceled: [] } after.
function fireStart(tab, host, o = {}) {
  const req = {
    URI: {
      scheme: o.scheme || "https",
      asciiHost: host,
      spec: o.spec || `https://${host}/`,
    },
  };
  if (!o.noCancel) {
    req.canceled = [];
    req.cancel = function (status) { this.canceled.push(status); };
  }
  let flags = 1 | 0x20000;
  if (o.nonDocument) flags = 1;
  if (o.stop) flags = 16 | 0x20000;
  listener.onStateChange(
    tab.__browser,
    { isTopLevel: o.topLevel !== false },
    o.noRequest ? null : req,
    flags,
    0
  );
  return req;
}

describe("domain routing", () => {
  it("registers the progress listener", () => {
    assert.ok(listener);
  });

  it("routes a background fresh tab silently with container swap", () => {
    const t = makeTab(tabVals, {
      label: "t1", ws: "1", fresh: true, spec: "https://github.com/",
    });
    sb.gBrowser.tabs.push(t);
    fireLoc(t, "github.com");
    const rep = created[created.length - 1];
    assert.ok(!sb.gBrowser.tabs.includes(t), "original removed");
    assert.equal(rep.userContextId, 7);
    assert.equal(wsOf(rep), "2");
    assert.equal(rep.hidden, true);
    assert.equal(api.getCurrent(), "1");
    assert.equal(wsel, home);
    assert.equal(rep.__aphFresh, false, "replacement born settled");
    const n = created.length;
    fireLoc(rep, "github.com");
    assert.equal(created.length, n, "no routing loop");
  });

  it("ignores settled tabs (SSO trap)", () => {
    const n = created.length;
    const s = makeTab(tabVals, {
      label: "s", ws: "1", fresh: false, spec: "https://jira.example.com/",
    });
    sb.gBrowser.tabs.push(s);
    fireLoc(s, "github.com");
    assert.equal(created.length, n);
    assert.equal(wsOf(s), "1");
  });

  it("matches longest suffix first", () => {
    assert.equal(api.matchRoute("aws.amazon.com").ws, "2");
    assert.equal(api.matchRoute("aws.amazon.com").pattern, "aws.amazon.com");
    assert.equal(api.matchRoute("www.amazon.com").ws, "1");
    assert.equal(api.matchRoute("unknown.example.org"), null);
  });

  it("pulls the window along for foreground tabs", () => {
    const t = makeTab(tabVals, {
      label: "t4", ws: "1", fresh: true, spec: "https://github.com/co/repo",
    });
    sb.gBrowser.tabs.push(t);
    sb.gBrowser.selectedTab = t;
    fireLoc(t, "github.com");
    const rep = created[created.length - 1];
    assert.equal(api.getCurrent(), "2");
    assert.equal(wsel, rep);
    assert.equal(wsOf(rep), "2");
  });

  it("ignores the old shifted arg order (regression guard)", () => {    const n = created.length;
    const t = makeTab(tabVals, {
      label: "t6", ws: "1", fresh: true, spec: "https://github.com/",
    });
    sb.gBrowser.tabs.push(t);
    listener.onLocationChange(
      { isTopLevel: true },
      t.__browser,
      null,
      { scheme: "https", asciiHost: "github.com" },
      0
    );
    assert.equal(created.length, n);
    assert.ok(!removed.includes("t6"));
  });

  it("cancels pre-dispatch and reopens bound on document START", () => {
    // Privacy core: the channel is cancelled before DNS/TLS/cookies, and
    // the reopen carries the channel URI (the tab still shows about:newtab).
    const prevCurrent = api.getCurrent();
    const prevSel = sb.gBrowser.selectedTab;
    const t = makeTab(tabVals, {
      label: "pre", ws: "1", fresh: true, spec: "about:newtab",
    });
    sb.gBrowser.tabs.push(t);
    sb.gBrowser.selectedTab = home;
    api.switchTo("1");
    try {
      const req = fireStart(t, "github.com");
      assert.deepEqual(req.canceled, [0x804b0002], "cancelled pre-dispatch");
      assert.ok(!sb.gBrowser.tabs.includes(t), "original removed");
      const rep = created[created.length - 1];
      assert.equal(rep.userContextId, 7);
      assert.equal(wsOf(rep), "2");
      assert.equal(rep.linkedBrowser.currentURI.spec, "https://github.com/");
      assert.equal(rep.__aphFresh, false, "replacement born settled");
      assert.equal(rep.hidden, true, "background stays silent");
      assert.equal(api.getCurrent(), "1");
      // Settled replacement never re-routes, on either stage.
      const n = created.length;
      fireLoc(rep, "github.com");
      fireStart(rep, "github.com");
      assert.equal(created.length, n, "no routing loop");
    } finally {
      sb.gBrowser.selectedTab = prevSel;
      if (api.getCurrent() !== prevCurrent) api.switchTo(prevCurrent);
    }
  });

  it("START without a rule leaves the tab fresh for the commit stage", () => {
    const prevCurrent = api.getCurrent();
    const prevSel = sb.gBrowser.selectedTab;
    const t = makeTab(tabVals, {
      label: "nomatch", ws: "1", fresh: true, spec: "about:newtab",
    });
    sb.gBrowser.tabs.push(t);
    sb.gBrowser.selectedTab = home;
    api.switchTo("1");
    try {
      const req = fireStart(t, "example.com");
      assert.deepEqual(req.canceled, [], "nothing dispatched to cancel");
      assert.ok(sb.gBrowser.tabs.includes(t), "tab untouched");
      // Still fresh: a later ruled commit still routes (redirect chains).
      fireLoc(t, "github.com");
      const rep = created[created.length - 1];
      assert.equal(rep.userContextId, 7);
      assert.equal(wsOf(rep), "2");
    } finally {
      const i = sb.gBrowser.tabs.indexOf(t);
      if (i !== -1) sb.gBrowser.tabs.splice(i, 1);
      sb.gBrowser.selectedTab = prevSel;
      if (api.getCurrent() !== prevCurrent) api.switchTo(prevCurrent);
    }
  });

  it("START ignores settled tabs, subframes and non-documents", () => {
    const n = created.length;
    const s = makeTab(tabVals, {
      label: "ss", ws: "1", fresh: false, spec: "https://jira.example.com/",
    });
    const f = makeTab(tabVals, {
      label: "ff", ws: "1", fresh: true, spec: "about:newtab",
    });
    sb.gBrowser.tabs.push(s, f);
    try {
      assert.deepEqual(fireStart(s, "github.com").canceled, []);
      assert.deepEqual(fireStart(f, "github.com", { topLevel: false }).canceled, []);
      assert.deepEqual(fireStart(f, "github.com", { nonDocument: true }).canceled, []);
      assert.deepEqual(fireStart(f, "github.com", { stop: true }).canceled, []);
      assert.equal(created.length, n);
    } finally {
      for (const t of [s, f]) {
        const i = sb.gBrowser.tabs.indexOf(t);
        if (i !== -1) sb.gBrowser.tabs.splice(i, 1);
      }
    }
  });

  it("START still migrates when cancel is unavailable", () => {
    // Defense in depth: without a cancellable channel the tab still lands
    // in the right workspace/container via reopen (with the old leak).
    const prevCurrent = api.getCurrent();
    const prevSel = sb.gBrowser.selectedTab;
    const t = makeTab(tabVals, {
      label: "nocancel", ws: "1", fresh: true, spec: "about:newtab",
    });
    sb.gBrowser.tabs.push(t);
    sb.gBrowser.selectedTab = home;
    api.switchTo("1");
    try {
      const req = fireStart(t, "github.com", { noCancel: true });
      assert.ok(!("canceled" in req) || req.canceled.length === 0);
      assert.ok(!sb.gBrowser.tabs.includes(t), "original removed");
      const rep = created[created.length - 1];
      assert.equal(rep.userContextId, 7);
      assert.equal(wsOf(rep), "2");
    } finally {
      sb.gBrowser.selectedTab = prevSel;
      if (api.getCurrent() !== prevCurrent) api.switchTo(prevCurrent);
    }
  });

  it("stores workspace names (trim, cap, clear, reject)", () => {
    assert.equal(api.setWsName("2", "  💼 Work  "), true);
    assert.equal(api.getWsName("2"), "💼 Work");
    assert.equal(
      prefStore["aph.workspaces.names"],
      JSON.stringify({ 2: "💼 Work" })
    );
    assert.equal(api.setWsName("10", "x"), false);
    assert.equal(api.setWsName("2", "   "), true);
    assert.equal(api.getWsName("2"), "");
  });
});

describe("bound container match", () => {
  it("marks tabs whose container equals their workspace binding", () => {
    // prefStore binds WS "2" -> cid 7 (see top of file).
    const match = makeTab(tabVals, { label: "m", ws: "2", cid: 7 });
    const mismatch = makeTab(tabVals, { label: "x", ws: "2", cid: 99 });
    const unbound = makeTab(tabVals, { label: "u", ws: "1", cid: 7 });
    const plain = makeTab(tabVals, { label: "p", ws: "2", cid: 0 });
    for (const t of [match, mismatch, unbound, plain]) {
      sb.gBrowser.tabs.push(t);
    }
    try {
      assert.equal(api.isTabMatchingBinding(match), true);
      assert.equal(api.isTabMatchingBinding(mismatch), false);
      assert.equal(api.isTabMatchingBinding(unbound), false);
      assert.equal(api.isTabMatchingBinding(plain), false);

      api.syncTabBindingMatch(match);
      assert.equal(match.getAttribute("data-aph-bound-match"), "1");
      api.syncTabBindingMatch(mismatch);
      assert.equal(mismatch.getAttribute("data-aph-bound-match"), null);

      api.syncAllTabBindingMatches();
      assert.equal(match.getAttribute("data-aph-bound-match"), "1");
      assert.equal(mismatch.getAttribute("data-aph-bound-match"), null);
      assert.equal(unbound.getAttribute("data-aph-bound-match"), null);
      assert.equal(plain.getAttribute("data-aph-bound-match"), null);
    } finally {
      for (const t of [match, mismatch, unbound, plain]) {
        const i = sb.gBrowser.tabs.indexOf(t);
        if (i !== -1) sb.gBrowser.tabs.splice(i, 1);
      }
    }
  });

  it("clears the mark when the binding is removed", () => {
    const t = makeTab(tabVals, { label: "c", ws: "2", cid: 7 });
    sb.gBrowser.tabs.push(t);
    try {
      api.syncTabBindingMatch(t);
      assert.equal(t.getAttribute("data-aph-bound-match"), "1");
      api.clearWsBinding("2");
      assert.equal(t.getAttribute("data-aph-bound-match"), null);
    } finally {
      const i = sb.gBrowser.tabs.indexOf(t);
      if (i !== -1) sb.gBrowser.tabs.splice(i, 1);
      // Restore binding for other tests / isolation.
      prefStore["aph.workspaces.containerBindings"] = JSON.stringify({ 2: 7 });
      api.syncAllTabBindingMatches();
    }
  });
});

describe("global pins", () => {
  it("never hides pinned tabs on workspace switch", () => {
    const pin = makeTab(tabVals, {
      label: "pin-ws2", ws: "2", pinned: true, spec: "https://example.com/",
    });
    const plain = makeTab(tabVals, {
      label: "plain-ws2", ws: "2", spec: "https://example.com/other",
    });
    sb.gBrowser.tabs.push(pin, plain);
    try {
      api.switchTo("1");
      assert.equal(pin.hidden, false, "pinned WS2 tab stays visible on WS1");
      assert.equal(plain.hidden, true, "unpinned WS2 tab hides on WS1 (control)");
      api.switchTo("2");
      assert.equal(pin.hidden, false, "pinned tab stays visible on WS2 too");
    } finally {
      for (const t of [pin, plain]) {
        const i = sb.gBrowser.tabs.indexOf(t);
        if (i !== -1) sb.gBrowser.tabs.splice(i, 1);
      }
    }
  });
});

describe("tab unloading", () => {
  it("is opt-in off when the pref backend is absent", () => {
    assert.equal(api.getUnloadOnSwitch(), false);
  });

  it("blocks every never-unload guard", () => {
    const prev = sb.gBrowser.selectedTab;
    const cases = [
      [{ label: "g-pin", ws: "1", spec: "https://example.com/", pinned: true }, "pinned"],
      [{ label: "g-sound", ws: "1", spec: "https://example.com/", soundPlaying: true }, "audio"],
      [{ label: "g-aud", ws: "1", spec: "https://example.com/", audible: true }, "audio"],
      [{ label: "g-busy", ws: "1", spec: "https://example.com/", busy: true }, "loading"],
      [{ label: "g-rtc", ws: "1", spec: "https://example.com/", sharing: true }, "sharing"],
      [{ label: "g-pend", ws: "1", spec: "https://example.com/", pending: true }, "pending"],
      [{ label: "g-dirty", ws: "1", spec: "https://example.com/", beforeUnload: true }, "beforeunload"],
      [{ label: "g-about", ws: "1", spec: "about:newtab" }, "internal"],
      [{ label: "g-throw", ws: "1", spec: "https://example.com/", throwURI: true }, "unknown-url"],
      [{ label: "g-nouri", ws: "1" }, "unknown-url"],
    ];
    const tabs = cases.map(([o]) => makeTab(tabVals, o));
    try {
      // Selected guard via real selection (covers both selected checks).
      sb.gBrowser.selectedTab = tabs[0];
      assert.equal(api.canUnloadTab(tabs[0]).ok, false, "selected blocks");
      sb.gBrowser.selectedTab = prev;
      for (let i = 1; i < tabs.length; i++) {
        const r = api.canUnloadTab(tabs[i]);
        assert.equal(r.ok, false, `${tabs[i].label} blocks`);
      }
      // Pinned guard on an unselected pin.
      const pin = makeTab(tabVals, { label: "g-pin2", ws: "1", spec: "https://example.com/", pinned: true });
      try {
        assert.equal(api.canUnloadTab(pin).ok, false, "pinned blocks");
      } finally {
        const li = tabs.indexOf(pin);
        if (li !== -1) tabs.splice(li, 1);
      }
    } finally {
      sb.gBrowser.selectedTab = prev;
    }
  });

  it("passes an eligible hidden foreign tab and sweeps only it", () => {
    // Prior suites leave current on "2", so WS "1" tabs are foreign.
    if (api.getCurrent() !== "2") api.switchTo("2");
    const elig = makeTab(tabVals, {
      label: "u-elig", ws: "1", spec: "https://example.com/page",
    });
    const sameWs = makeTab(tabVals, {
      label: "u-samews", ws: "2", spec: "https://example.com/other",
    });
    const guarded = makeTab(tabVals, {
      label: "u-pin", ws: "1", spec: "https://example.com/", pinned: true,
    });
    sb.gBrowser.tabs.push(elig, sameWs, guarded);
    try {
      assert.equal(api.canUnloadTab(elig).ok, true, "eligible tab passes");
      discarded.length = 0;
      const r = api.unloadEligibleTabs({ scope: "foreign" });
      assert.ok(discarded.includes("u-elig"), "eligible foreign tab discarded");
      assert.ok(!discarded.includes("u-samews"), "current-WS tab untouched");
      assert.ok(!discarded.includes("u-pin"), "pinned tab untouched");
      assert.equal(r.reason, undefined);
      assert.equal(tabVals.get(elig).aphWs, "1", "workspace tag survives discard");
      assert.equal(elig.__aphFresh, false, "replacement reload never re-routes");
      assert.equal(elig.hasAttribute("pending"), true);
    } finally {
      for (const t of [elig, sameWs, guarded]) {
        const i = sb.gBrowser.tabs.indexOf(t);
        if (i !== -1) sb.gBrowser.tabs.splice(i, 1);
      }
    }
  });

  it("dry-run counts without discarding", () => {
    if (api.getCurrent() !== "2") api.switchTo("2");
    const elig = makeTab(tabVals, {
      label: "u-dry", ws: "1", spec: "https://example.com/dry",
    });
    sb.gBrowser.tabs.push(elig);
    try {
      discarded.length = 0;
      const r = api.unloadEligibleTabs({ scope: "foreign", dryRun: true });
      assert.ok(r.unloaded >= 1);
      assert.ok(!discarded.includes("u-dry"), "dry run discards nothing");
      assert.equal(elig.hasAttribute("pending"), false);
    } finally {
      const i = sb.gBrowser.tabs.indexOf(elig);
      if (i !== -1) sb.gBrowser.tabs.splice(i, 1);
    }
  });

  it("offline aborts the whole sweep", () => {
    sb.navigator.onLine = false;
    try {
      discarded.length = 0;
      const r = api.unloadEligibleTabs({ scope: "foreign" });
      assert.equal(r.unloaded, 0);
      assert.equal(r.reason, "offline");
      assert.equal(discarded.length, 0);
    } finally {
      sb.navigator.onLine = true;
    }
  });

  it("no-ops cleanly without the discard API", () => {
    const d = sb.gBrowser.discardBrowser;
    delete sb.gBrowser.discardBrowser;
    try {
      const r = api.unloadEligibleTabs({ scope: "foreign" });
      assert.equal(r.unloaded, 0);
      assert.equal(r.reason, "no-api");
    } finally {
      sb.gBrowser.discardBrowser = d;
    }
  });
});

describe("workspace cycling", () => {
  it("lists active workspaces, skipping empties and dormant pins", () => {
    api.switchTo("1");
    const extra = makeTab(tabVals, {
      label: "cy-4", ws: "4", spec: "https://example.com/cy4",
    });
    const pin = makeTab(tabVals, {
      label: "cy-pin5", ws: "5", pinned: true, spec: "https://example.com/",
    });
    sb.gBrowser.tabs.push(extra, pin);
    try {
      const ids = api.getActiveWorkspaces();
      assert.ok(ids.includes("1"), `WS1 active, got ${ids}`);
      assert.ok(ids.includes("4"), `WS4 active, got ${ids}`);
      assert.ok(!ids.includes("3"), `empty WS3 skipped, got ${ids}`);
      assert.ok(!ids.includes("5"), `dormant pin tag ignored, got ${ids}`);
      assert.equal([...ids].join(","), [...ids].sort().join(","), "sorted for deterministic wrap");
    } finally {
      for (const t of [extra, pin]) {
        const i = sb.gBrowser.tabs.indexOf(t);
        if (i !== -1) sb.gBrowser.tabs.splice(i, 1);
      }
    }
  });

  it("cycles next/prev over active workspaces only, wrapping", () => {
    const extra = makeTab(tabVals, {
      label: "cy-4b", ws: "4", spec: "https://example.com/cy4b",
    });
    sb.gBrowser.tabs.push(extra);
    try {
      api.switchTo("1");
      const ids = api.getActiveWorkspaces();
      assert.ok(ids.length >= 3 && ids.includes("4"), `setup, got ${ids}`);
      const first = ids[0];
      const last = ids[ids.length - 1];
      assert.equal(first, "1");
      // Next from 1 -> second entry (proves empty WS skipped by landing
      // on a real workspace, not "2"-hardcoded beyond the known fixture).
      api.cycleWorkspace(1);
      assert.equal(api.getCurrent(), ids[1]);
      // Walk to the end, then wrap to first.
      for (let i = 1; i < ids.length - 1; i++) {
        api.cycleWorkspace(1);
      }
      assert.equal(api.getCurrent(), last);
      api.cycleWorkspace(1);
      assert.equal(api.getCurrent(), first);
      // Prev from first wraps to last.
      api.cycleWorkspace(-1);
      assert.equal(api.getCurrent(), last);
      api.cycleWorkspace(-1);
      assert.equal(api.getCurrent(), ids[ids.length - 2]);
    } finally {
      const i = sb.gBrowser.tabs.indexOf(extra);
      if (i !== -1) sb.gBrowser.tabs.splice(i, 1);
    }
  });

  it("toggles back and forth between the last two used workspaces", () => {
    const extra = makeTab(tabVals, {
      label: "cy-4c", ws: "4", spec: "https://example.com/cy4c",
    });
    sb.gBrowser.tabs.push(extra);
    try {
      api.switchTo("1");
      api.switchTo("4");
      assert.equal(api.getLastWorkspace(), "1");
      api.toggleLastWorkspace();
      assert.equal(api.getCurrent(), "1");
      api.toggleLastWorkspace();
      assert.equal(api.getCurrent(), "4");
      // Same-workspace switch is a no-op: history keeps pointing at "1".
      api.switchTo("4");
      assert.equal(api.getLastWorkspace(), "1");
    } finally {
      const i = sb.gBrowser.tabs.indexOf(extra);
      if (i !== -1) sb.gBrowser.tabs.splice(i, 1);
    }
  });
});

describe("new-tab urlbar focus", () => {
  it("focuses the urlbar when opening a tab (bound Ctrl+T path)", () => {
    // prefStore binds WS "2" -> container 7: openBoundTab is exactly what
    // the Ctrl+T interceptor calls there. gURLBar is attached late on
    // purpose — every earlier suite ran without it, proving the guard.
    sb.gURLBar = { focused: 0, focus() { this.focused++; } };
    let t = null;
    let binder = null;
    try {
      api.switchTo("2");
      // An earlier suite cleared the WS2->cid7 binding through the API
      // (module cache), so re-bind via the API to restore fixture state.
      binder = makeTab(tabVals, {
        label: "binder", ws: "2", cid: 7, spec: "https://example.com/",
      });
      sb.gBrowser.tabs.push(binder);
      sb.gBrowser.selectedTab = binder;
      assert.equal(api.bindCurrentWs().ok, true, "rebound WS2 to cid 7");
      const before = sb.gURLBar.focused;
      t = api.openBoundTab();
      assert.ok(t, "tab opened");
      assert.equal(t.userContextId, 7, "bound container used");
      assert.equal(sb.gBrowser.selectedTab, t, "new tab selected");
      assert.equal(sb.gURLBar.focused, before + 1, "urlbar focused once");
    } finally {
      delete sb.gURLBar;
      for (const tab of [t, binder]) {
        if (tab) {
          const i = sb.gBrowser.tabs.indexOf(tab);
          if (i !== -1) sb.gBrowser.tabs.splice(i, 1);
        }
      }
    }
  });
});

describe("bound new-tab interception (BrowserOpenTab wrap)", () => {
  function rebindWs2() {
    api.switchTo("2");
    const binder = makeTab(tabVals, {
      label: "binder", ws: "2", cid: 7, spec: "https://example.com/",
    });
    sb.gBrowser.tabs.push(binder);
    sb.gBrowser.selectedTab = binder;
    assert.equal(api.bindCurrentWs().ok, true, "rebound WS2 to cid 7");
    return binder;
  }
  function dropTabs(tabs) {
    for (const tab of tabs) {
      if (tab) {
        const i = sb.gBrowser.tabs.indexOf(tab);
        if (i !== -1) sb.gBrowser.tabs.splice(i, 1);
      }
    }
  }

  it("births the tab containered with no phantom kill", () => {
    // + button / menu path: the tab must be born in the bound container
    // (create-then-kill repair would push into `removed` instead).
    let binder = null;
    let t = null;
    try {
      binder = rebindWs2();
      const removedBefore = removed.length;
      t = sb.window.BrowserOpenTab();
      assert.ok(t, "tab opened");
      assert.equal(t.userContextId, 7, "born in the bound container");
      assert.equal(sb.gBrowser.selectedTab, t, "new tab selected");
      assert.equal(removed.length, removedBefore, "no phantom tab killed");
    } finally {
      dropTabs([t, binder]);
      api.switchTo("1");
    }
  });

  it("falls through to a plain tab on unbound workspaces", () => {
    let t = null;
    try {
      api.switchTo("1");
      t = sb.window.BrowserOpenTab();
      assert.ok(t, "tab opened");
      assert.equal(t.userContextId, 0, "default container");
    } finally {
      dropTabs([t]);
    }
  });

  it("never containers a tab in private windows", () => {
    let binder = null;
    const tabsBefore = sb.gBrowser.tabs.length;
    sb.window.PrivateBrowsingUtils = { isWindowPrivate: () => true };
    try {
      binder = rebindWs2();
      // No stock opener in this harness, so the wrapper must decline
      // (null) rather than birth a container tab in a private window.
      assert.equal(sb.window.BrowserOpenTab(), null);
      assert.equal(sb.gBrowser.tabs.length, tabsBefore + 1, "only the binder");
    } finally {
      delete sb.window.PrivateBrowsingUtils;
      dropTabs([binder]);
      api.switchTo("1");
    }
  });
});
