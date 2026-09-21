// Regression guards for the addon first-run silencer (workspaces bundle,
// 90-routing.js): managed extensions without managed-storage support
// (e.g. SponsorBlock) open welcome/help tabs on install via tabs.create.
// Those tabs are closed pre-paint (cancel + remove) with a commit-stage
// backstop. Precision guards fail closed: kill-switch pref, moz-extension
// scheme, welcome-path pattern, young blank tab, no opener.
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { run, makeTab } = require("./helpers");

const HELP_SPEC = "moz-extension://11111111-2222-4333-8555-666677778888/help/index.html";
const OPT_SPEC = "moz-extension://11111111-2222-4333-8555-666677778888/options/options.html";

function makeEnv(silencePref) {
  const tabVals = new WeakMap();
  const tabs = [];
  const removed = [];
  const restoring = new Set();
  let progressListener = null;
  let sel = null;
  const prefStore = {};
  if (silencePref !== undefined) {
    prefStore["aph.addons.silenceFirstRun"] = silencePref;
  }

  const sb = {
    window: { addEventListener() {}, removeEventListener() {}, opener: null },
    navigator: { onLine: true },
    document: {
      readyState: "complete",
      getElementById: () => null,
      createElement: () => ({
        setAttribute() {}, removeAttribute() {}, addEventListener() {},
        style: {}, className: "",
      }),
      createEvent: () => ({ initEvent() {} }),
    },
    gBrowser: {
      tabs,
      tabGroups: [],
      get selectedTab() { return sel; },
      set selectedTab(t) {
        if (sel) sel.selected = false;
        sel = t;
        if (t) t.selected = true;
      },
      showTab(t) { t.removeAttribute("hidden"); },
      addTrustedTab(url, opts) {
        const t = makeTab(tabVals, {
          label: "new", ws: "1", spec: url, cid: (opts && opts.userContextId) || 0,
        });
        tabs.push(t);
        return t;
      },
      removeTab(t) {
        removed.push(t.label);
        const i = tabs.indexOf(t);
        if (i !== -1) tabs.splice(i, 1);
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
      ungroupTab() {},
      replaceInSuccession() {},
      setSuccessor() {},
      _updateMultiselectedTabCloseButtonTooltip() {},
      getTabForBrowser: (b) => (b && b.__tab) || null,
      addTabsProgressListener(l) { progressListener = l; },
      removeTabsProgressListener() {},
      tabContainer: {
        _attrs: {},
        setAttribute(k, v) { this._attrs[k] = String(v); },
        getAttribute(k) { return this._attrs[k]; },
        removeAttribute(k) { delete this._attrs[k]; },
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
      deleteCustomTabValue: (t, k) => {
        const o = tabVals.get(t) || {};
        delete o[k];
        tabVals.set(t, o);
      },
      isTabRestoring: (t) => restoring.has(t),
      getCustomWindowValue: () => undefined,
      setCustomWindowValue: () => {},
    },
    Services: {
      prefs: {
        getStringPref: (k, d) => (k in prefStore ? prefStore[k] : d),
        setStringPref: (k, v) => { prefStore[k] = v; },
        getBoolPref: (k) => {
          if (k in prefStore) return prefStore[k];
          if (k === "aph.addons.silenceFirstRun") return true;
          throw new Error(`unknown pref ${k}`);
        },
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
      importESModule: () => ({
        ContextualIdentityService: {
          getPublicIdentityFromId: () => null,
          getPublicIdentities: () => [],
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
  const seed = makeTab(tabVals, { label: "seed", ws: "1", spec: "https://seed.example/" });
  tabs.push(seed);
  sel = seed;
  seed.selected = true;
  run("workspaces.js", sb);

  // Fresh extension-install tab: born just now, still showing blank.
  function addInstallTab(label, spec) {
    const t = makeTab(tabVals, { label, ws: "1", spec: "about:blank" });
    t.__aphBirth = Date.now();
    t.__aphFresh = true;
    tabs.push(t);
    return t;
  }
  // Pre-dispatch STATE_START with a cancellable channel for `spec`.
  function fireStart(tab, spec) {
    const req = {
      URI: { scheme: "moz-extension", asciiHost: "uuid", spec },
      canceled: [],
      cancel(status) { this.canceled.push(status); },
    };
    progressListener.onStateChange(
      tab.__browser,
      { isTopLevel: true },
      req,
      1 | 0x20000,
      0
    );
    return req;
  }
  // Commit backstop without request (uncancellable).
  function fireCommit(tab, spec) {
    progressListener.onLocationChange(
      tab.__browser,
      { isTopLevel: true },
      null,
      { scheme: "moz-extension", asciiHost: "uuid", spec },
      0
    );
  }
  return { sb, tabs, removed, tabVals, restoring, addInstallTab, fireStart, fireCommit,
    listener: () => progressListener,
    api: sb.window.AphWorkspaces };
}

describe("addon first-run silencer", () => {
  it("closes a young blank tab pre-dispatch and cancels the channel", () => {
    const env = makeEnv();
    const t = env.addInstallTab("sb-help");
    const req = env.fireStart(t, HELP_SPEC);
    assert.deepEqual(req.canceled, [0x804b0002]);
    assert.ok(!env.tabs.includes(t), "tab removed");
    assert.deepEqual(env.removed, ["sb-help"]);
  });

  it("closes via the commit backstop when pre-dispatch is missed", () => {
    const env = makeEnv();
    const t = env.addInstallTab("sb-help");
    env.fireCommit(t, HELP_SPEC);
    assert.ok(!env.tabs.includes(t), "tab removed");
  });

  it("leaves non-welcome extension pages alone", () => {
    const env = makeEnv();
    const t = env.addInstallTab("sb-opts");
    const req = env.fireStart(t, OPT_SPEC);
    assert.deepEqual(req.canceled, []);
    assert.ok(env.tabs.includes(t), "tab kept");
    env.fireCommit(t, OPT_SPEC);
    assert.ok(env.tabs.includes(t), "tab kept");
  });

  it("leaves old tabs alone (age gate)", () => {
    const env = makeEnv();
    const t = env.addInstallTab("sb-help");
    t.__aphBirth = Date.now() - 60000;
    const req = env.fireStart(t, HELP_SPEC);
    assert.deepEqual(req.canceled, []);
    assert.ok(env.tabs.includes(t), "tab kept");
  });

  it("leaves tabs with prior content alone (first-content gate)", () => {
    const env = makeEnv();
    const t = env.addInstallTab("sb-help");
    t.linkedBrowser.currentURI.spec = "https://example.com/";
    const req = env.fireStart(t, HELP_SPEC);
    assert.deepEqual(req.canceled, []);
    assert.ok(env.tabs.includes(t), "tab kept");
  });

  it("leaves tabs without a birth stamp alone (fail closed)", () => {
    const env = makeEnv();
    const t = env.addInstallTab("sb-help");
    delete t.__aphBirth;
    const req = env.fireStart(t, HELP_SPEC);
    assert.deepEqual(req.canceled, []);
    assert.ok(env.tabs.includes(t), "tab kept");
  });

  it("leaves opener-linked tabs alone (followed link)", () => {
    const env = makeEnv();
    const o = makeTab(env.tabVals, { label: "op", ws: "1", spec: "https://o.example/" });
    env.tabs.push(o);
    const t = env.addInstallTab("sb-help");
    t.openerTab = o;
    const req = env.fireStart(t, HELP_SPEC);
    assert.deepEqual(req.canceled, []);
    assert.ok(env.tabs.includes(t), "tab kept");
  });

  it("respects the kill-switch pref", () => {
    const env = makeEnv(false);
    const t = env.addInstallTab("sb-help");
    const req = env.fireStart(t, HELP_SPEC);
    assert.deepEqual(req.canceled, []);
    assert.ok(env.tabs.includes(t), "tab kept");
  });

  it("ignores subframes and same-document commits", () => {    const env = makeEnv();
    const t = env.addInstallTab("sb-help");
    const req = {
      URI: { scheme: "moz-extension", asciiHost: "uuid", spec: HELP_SPEC },
      canceled: [],
      cancel(status) { this.canceled.push(status); },
    };
    // Subframe pre-dispatch.
    env.listener().onStateChange(
      t.__browser, { isTopLevel: false }, req, 1 | 0x20000, 0
    );
    // Same-document commit.
    env.listener().onLocationChange(
      t.__browser, { isTopLevel: true }, null,
      { scheme: "moz-extension", asciiHost: "uuid", spec: HELP_SPEC }, 2
    );
    assert.ok(env.tabs.includes(t), "tab kept");
    assert.deepEqual(req.canceled, []);
  });

  it("leaves session-restoring tabs alone at both stages", () => {
    const env = makeEnv();
    const t = env.addInstallTab("restore-help");
    env.restoring.add(t);
    const req = env.fireStart(t, HELP_SPEC);
    assert.deepEqual(req.canceled, [], "pre-dispatch untouched");
    assert.ok(env.tabs.includes(t), "tab kept");
    env.fireCommit(t, HELP_SPEC);
    assert.ok(env.tabs.includes(t), "tab kept at commit");
    env.restoring.delete(t);
  });
});
