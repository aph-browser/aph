// Regression guards for the toolbar-button rescue (workspaces bundle,
// 110-chrome-init.js): fresh profiles that pre-seed sidebar.verticalTabs
// lose the removable navbar defaults. The rescue adds downloads-button
// (after urlbar) and stop-reload-button (after the back/forward pair) once
// per profile, and migrates buttons stuck at older rescues' spots — manual
// arrangements are left alone.
// The real bundle runs in node:vm with Firefox globals mocked (same shape
// as tests/pinreset.test.js); init() runs the rescue on load. The mock
// CustomizableUI keeps a real order array so index math is exercised.
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { run, makeTab } = require("./helpers");

const tabVals = new WeakMap();
const MARKER = "aph.toolbar.widgetsOrdered";

function makeCUI(order, log) {
  const list = order.slice();
  return {
    AREA_NAVBAR: "nav-bar",
    _list: list,
    getPlacementOfWidget: (id) => {
      const i = list.indexOf(id);
      return i === -1 ? null : { area: "nav-bar", position: i };
    },
    addWidgetToArea: (id, area, pos) => {
      log.push({ op: "add", id, area, pos: pos === undefined ? null : pos });
      if (list.includes(id)) {
        return;
      }
      const p = typeof pos === "number" ? Math.min(Math.max(pos, 0), list.length) : list.length;
      list.splice(p, 0, id);
    },
    moveWidgetWithinArea: (id, pos) => {
      log.push({ op: "move", id, pos });
      const i = list.indexOf(id);
      if (i === -1) {
        return;
      }
      const p = typeof pos === "number" ? Math.min(Math.max(pos, 0), list.length) : list.length;
      if (p === i) {
        return;
      }
      list.splice(i, 1);
      list.splice(Math.min(p, list.length), 0, id);
    },
  };
}

function makeEnv(opts) {
  const o = opts || {};
  const tabs = [];
  const containerHandlers = {};
  const winHandlers = {};
  const boolStore = Object.assign({}, o.boolPrefs);
  const log = [];
  const cui = o.noWindowCUI ? undefined : makeCUI(o.order || [], log);
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
  return { sb, log, boolStore, list: cui ? cui._list : null };
}

const SPARSE = [
  "alltabs-button", "ai-window-toggle", "reset-pbm-toolbar-button",
  "unified-extensions-button", "urlbar-container", "vertical-spacer",
  "forward-button", "back-button", "ublock0_raymondhill_net-browser-action",
];
// The user's actual post-v1/v2 state: downloads glued into the arrow
// cluster (urlbar + 2), reload splitting forward/back (forward + 1).
const OLD_SPOTS = [
  "alltabs-button", "ai-window-toggle", "reset-pbm-toolbar-button",
  "unified-extensions-button", "urlbar-container", "vertical-spacer",
  "downloads-button", "forward-button", "stop-reload-button", "back-button",
  "ublock0_raymondhill_net-browser-action",
];

describe("toolbar-button rescue", () => {
  it("fresh inverted bar: downloads after urlbar, reload after the pair", () => {
    const env = makeEnv({ order: SPARSE });
    assert.deepEqual(env.log, [
      { op: "add", id: "downloads-button", area: "nav-bar", pos: 5 },
      { op: "add", id: "stop-reload-button", area: "nav-bar", pos: 9 },
    ]);
    assert.deepEqual(env.list, [
      "alltabs-button", "ai-window-toggle", "reset-pbm-toolbar-button",
      "unified-extensions-button", "urlbar-container", "downloads-button",
      "vertical-spacer", "forward-button", "back-button",
      "stop-reload-button", "ublock0_raymondhill_net-browser-action",
    ]);
    assert.equal(env.boolStore[MARKER], true);
  });

  it("stock-order bar: reload lands exactly after forward (stock trio)", () => {
    const env = makeEnv({
      order: ["back-button", "forward-button", "urlbar-container"],
    });
    assert.deepEqual(env.log, [
      { op: "add", id: "downloads-button", area: "nav-bar", pos: 3 },
      { op: "add", id: "stop-reload-button", area: "nav-bar", pos: 2 },
    ]);
    assert.deepEqual(env.list.slice(0, 5), [
      "back-button", "forward-button", "stop-reload-button",
      "urlbar-container", "downloads-button",
    ]);
    assert.equal(env.boolStore[MARKER], true);
  });

  it("migrates buttons stuck at older rescues' spots", () => {
    const env = makeEnv({ order: OLD_SPOTS });
    // stop-reload targets pair-end (10); the move itself shifts indices so
    // it lands after uBO — pair intact, reload out from between the arrows.
    assert.deepEqual(env.log, [
      { op: "move", id: "downloads-button", pos: 5 },
      { op: "move", id: "stop-reload-button", pos: 10 },
    ]);
    assert.deepEqual(env.list, [
      "alltabs-button", "ai-window-toggle", "reset-pbm-toolbar-button",
      "unified-extensions-button", "urlbar-container", "downloads-button",
      "vertical-spacer", "forward-button", "back-button",
      "ublock0_raymondhill_net-browser-action", "stop-reload-button",
    ]);
    assert.equal(env.boolStore[MARKER], true);
  });

  it("leaves manual arrangements alone but still records the marker", () => {
    const env = makeEnv({
      order: [
        "downloads-button", "stop-reload-button", "urlbar-container",
        "forward-button", "back-button",
      ],
    });
    assert.deepEqual(env.log, []);
    assert.equal(env.boolStore[MARKER], true);
  });

  it("heals only what's missing", () => {
    const env = makeEnv({
      order: [
        "urlbar-container", "downloads-button", "forward-button",
        "back-button",
      ],
    });
    assert.deepEqual(env.log, [
      { op: "add", id: "stop-reload-button", area: "nav-bar", pos: 4 },
    ]);
    assert.equal(env.boolStore[MARKER], true);
  });

  it("never fights the user: marker set means hands off, even at old spots", () => {
    const env = makeEnv({
      order: OLD_SPOTS,
      boolPrefs: { [MARKER]: true },
    });
    assert.deepEqual(env.log, []);
    assert.equal(env.boolStore[MARKER], true);
  });

  it("uses the importESModule fallback when no window global exists", () => {
    const log = [];
    const fallback = makeCUI(SPARSE, log);
    const env = makeEnv({ noWindowCUI: true, importCUI: { CustomizableUI: fallback } });
    assert.equal(log.length, 2);
    assert.equal(log[0].id, "downloads-button");
    assert.equal(log[1].id, "stop-reload-button");
    assert.equal(env.boolStore[MARKER], true);
  });

  it("no-ops silently when CustomizableUI is unavailable anywhere", () => {
    const env = makeEnv({ noWindowCUI: true, importCUI: {} });
    assert.deepEqual(env.log, []);
    assert.ok(!(MARKER in env.boolStore));
  });
});
