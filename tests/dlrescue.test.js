// Regression guards for the downloads-button rescue (workspaces bundle,
// 115-dl-rescue.js): fresh profiles that pre-seed sidebar.verticalTabs lose
// the removable navbar defaults, banishing downloads-button to the
// customization palette. The rescue re-places it once per profile.
// The real bundle runs in node:vm with Firefox globals mocked (same shape
// as tests/pinreset.test.js); init() runs the rescue on load, so each case
// builds a fresh env and asserts on the recorded CustomizableUI calls.
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { run, makeTab } = require("./helpers");

const tabVals = new WeakMap();
const MARKER = "aph.toolbar.downloadsRescued";

function makeEnv(opts) {
  const o = opts || {};
  const tabs = [];
  const containerHandlers = {};
  const winHandlers = {};
  const boolStore = Object.assign({}, o.boolPrefs);
  const placements = Object.assign({}, o.placements);
  const added = [];
  const cui = o.noWindowCUI
    ? undefined
    : {
        AREA_NAVBAR: "nav-bar",
        getPlacementOfWidget: (id) => placements[id] || null,
        addWidgetToArea: (id, area, pos) => {
          added.push({ id, area, pos: pos === undefined ? null : pos });
          placements[id] = { area, position: pos === undefined || pos === null ? 99 : pos };
        },
      };
  const importCUI = o.importCUI;
  const sb = {
    URL,
    window: {
      opener: null,
      addEventListener(t, fn) { winHandlers[t] = fn; },
      removeEventListener(t) { delete winHandlers[t]; },
    },
    navigator: { onLine: true },
    document: {
      readyState: "complete",
      getElementById: () => null,
      createElement: () => ({ setAttribute() {}, removeAttribute() {}, style: {} }),
      createEvent: () => ({ initEvent() {} }),
    },
    gBrowser: {
      tabs,
      tabGroups: [],
      get selectedTab() { return sel; },
      set selectedTab(t) { sel = t; },
      showTab() {},
      addTrustedTab(url, opts2) {
        const t = makeTab(tabVals, { label: "new", ws: "1", spec: url, cid: (opts2 && opts2.userContextId) || 0 });
        tabs.push(t);
        return t;
      },
      removeTab() {},
      ungroupTab() {},
      tabContainer: {
        setAttribute() {},
        addEventListener(t, fn) { (containerHandlers[t] ||= []).push(fn); },
        removeEventListener() {},
      },
    },
    SessionStore: {
      getCustomTabValue: (t, k) => (tabVals.get(t) || {})[k],
      setCustomTabValue: (t, k, v) => {
        const m = tabVals.get(t) || {};
        m[k] = v;
        tabVals.set(t, m);
      },
      deleteCustomTabValue: () => {},
      getCustomWindowValue: () => undefined,
      setCustomWindowValue: () => {},
    },
    Services: {
      io: { newURI: (spec) => ({ spec }) },
      prefs: {
        getStringPref: (k, d) => d,
        setStringPref: () => {},
        getBoolPref: (k) => {
          if (!(k in boolStore)) {
            throw new Error(`unset pref ${k}`);
          }
          return boolStore[k];
        },
        setBoolPref: (k, v) => { boolStore[k] = v; },
        addObserver() {},
        removeObserver() {},
      },
      scriptSecurityManager: { getSystemPrincipal: () => ({ system: true }) },
      wm: {
        getMostRecentWindow: () => null,
        getEnumerator: () => ({ hasMoreElements: () => false }),
      },
      obs: { addObserver() {}, removeObserver() {} },
    },
    ChromeUtils: {
      generateQI: () => () => {},
      importESModule: () => (importCUI || {}),
    },
    Ci: {
      nsIWebProgressListener: { LOCATION_CHANGE_SAME_DOCUMENT: 2 },
      nsIWebProgress: { NOTIFY_LOCATION: 1 },
    },
  };
  if (cui) {
    sb.window.CustomizableUI = cui;
  }
  sb.window.window = sb.window;
  let sel = null;
  run("workspaces.js", sb);
  return { sb, added, boolStore, placements };
}

const NAVBAR_URLBAR = { area: "nav-bar", position: 4 };

describe("downloads-button rescue", () => {
  it("re-places a missing button at the stock position and sets the marker", () => {
    const env = makeEnv({ placements: { "urlbar-container": NAVBAR_URLBAR } });
    assert.deepEqual(env.added, [{ id: "downloads-button", area: "nav-bar", pos: 6 }]);
    assert.equal(env.boolStore[MARKER], true);
  });

  it("appends when the urlbar anchor is unavailable", () => {
    const env = makeEnv({ placements: {} });
    assert.deepEqual(env.added, [{ id: "downloads-button", area: "nav-bar", pos: null }]);
    assert.equal(env.boolStore[MARKER], true);
  });

  it("leaves a placed button alone but still records the marker", () => {
    const env = makeEnv({
      placements: {
        "urlbar-container": NAVBAR_URLBAR,
        "downloads-button": { area: "nav-bar", position: 6 },
      },
    });
    assert.deepEqual(env.added, []);
    assert.equal(env.boolStore[MARKER], true);
  });

  it("never fights the user: marker set + missing means hands off", () => {
    const env = makeEnv({
      placements: { "urlbar-container": NAVBAR_URLBAR },
      boolPrefs: { [MARKER]: true },
    });
    assert.deepEqual(env.added, []);
    assert.equal(env.boolStore[MARKER], true);
  });

  it("uses the importESModule fallback when no window global exists", () => {
    const added = [];
    const fallback = {
      AREA_NAVBAR: "nav-bar",
      getPlacementOfWidget: (id) => (id === "urlbar-container" ? NAVBAR_URLBAR : null),
      addWidgetToArea: (id, area, pos) => { added.push({ id, area, pos }); },
    };
    const env = makeEnv({ noWindowCUI: true, importCUI: { CustomizableUI: fallback } });
    assert.deepEqual(added, [{ id: "downloads-button", area: "nav-bar", pos: 6 }]);
    assert.equal(env.boolStore[MARKER], true);
  });

  it("no-ops silently when CustomizableUI is unavailable anywhere", () => {
    const env = makeEnv({ noWindowCUI: true, importCUI: {} });
    assert.deepEqual(env.added, []);
    assert.ok(!(MARKER in env.boolStore));
  });
});
