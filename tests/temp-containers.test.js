// Disposable temp containers (branding/src/workspaces/70-temp-keys.js,
// bundled into branding/workspaces.js): unique naming, shared persisted
// tracking, and reconcile sweeps that clear dead identities.
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { run, makeTab, makeSessionStore } = require("./helpers");

const HOOK =
  "window.__aphTempTest = { openTempTab, cleanupTempContainer, sweepTempContainers, " +
  "sweepOrphanTempNames, reconcileTempContainers, isTempContainerId, readTempIds, " +
  "initTempTracking, TEMP_IDS_PREF };";

function makeIdentity() {
  let nextId = 100;
  const names = new Map();
  const removed = [];
  return {
    names,
    removed,
    create(name) {
      const id = nextId++;
      names.set(id, name);
      return { userContextId: id };
    },
    remove(id) {
      removed.push(id);
      names.delete(id);
    },
    getPublicIdentityFromId(id) {
      return names.has(id) ? { userContextId: id, name: names.get(id) } : null;
    },
    getPublicIdentities() {
      return [...names.entries()].map(([userContextId, name]) => ({ userContextId, name }));
    },
  };
}

function makeEnv({ prefIds = null, identities = [], windows = null, realTimers = false } = {}) {
  const tabVals = new WeakMap();
  const store = {};
  if (prefIds !== null) {
    store["aph.tempContainers"] = JSON.stringify(prefIds);
  }
  const identity = makeIdentity();
  for (const [id, name] of identities) {
    identity.names.set(id, name);
  }
  const created = [];
  let selected = null;
  const mainGB = {
    tabs: [],
    get selectedTab() {
      return selected;
    },
    set selectedTab(t) {
      selected = t;
    },
    showTab() {},
    ungroupTab() {},
    addTrustedTab(url, opts) {
      const t = makeTab(tabVals, {
        label: "new",
        ws: "1",
        spec: url,
        cid: (opts && opts.userContextId) || 0,
      });
      created.push(t);
      mainGB.tabs.push(t);
      return t;
    },
  };
  const wmWindows = windows === null ? [{ closed: false, gBrowser: mainGB }] : windows;
  const sb = {
    __aphRealTimers: realTimers,
    window: { addEventListener() {}, opener: null },
    navigator: { onLine: true },
    document: {
      readyState: "loading",
      getElementById: () => null,
      addEventListener() {},
    },
    gBrowser: mainGB,
    SessionStore: makeSessionStore(tabVals),
    ChromeUtils: {
      importESModule: () => ({ ContextualIdentityService: identity }),
    },
    Services: {
      prefs: {
        getBoolPref: () => false,
        setBoolPref() {},
        getStringPref(k, d) {
          return k in store ? store[k] : d;
        },
        setStringPref(k, v) {
          store[k] = String(v);
        },
        addObserver() {},
        removeObserver() {},
      },
      obs: { addObserver() {}, removeObserver() {} },
      wm: {
        getEnumerator() {
          let i = 0;
          return {
            hasMoreElements: () => i < wmWindows.length,
            getNext: () => wmWindows[i++],
          };
        },
      },
    },
  };
  run(
    "workspaces.js",
    sb,
    'window.addEventListener("load", init, { once: true });',
    HOOK
  );
  const T = sb.window.__aphTempTest;
  assert.ok(T, "temp test hook missing");
  return { T, store, identity, created, mainGB, tabVals, sb };
}

function tabWithCid(tabVals, cid, closing = false) {
  const t = makeTab(tabVals, { label: "t", ws: "1", spec: "https://x.example/", cid });
  if (closing) {
    t.closing = true;
  }
  return t;
}

describe("temp container naming", () => {
  it("skips taken names instead of duplicating Tmp 1", () => {
    const { T, identity, store } = makeEnv({ identities: [[900, "Tmp 1"]] });
    T.openTempTab("https://a.example/");
    assert.equal(identity.names.get(101), undefined);
    const names = [...identity.names.values()];
    assert.ok(names.includes("Tmp 2"), names.join(","));
    assert.ok(!names.includes("Tmp 1 duplicate") && names.filter((n) => n === "Tmp 1").length === 1);
    const tracked = JSON.parse(store["aph.tempContainers"]);
    assert.ok(tracked.includes(100), JSON.stringify(tracked));
  });

  it("tracks new ids in the shared pref", () => {
    const { T, store } = makeEnv();
    T.openTempTab("https://a.example/");
    assert.deepEqual(JSON.parse(store["aph.tempContainers"]), [100]);
  });
});

describe("temp container sweep", () => {
  it("removes the identity and untracks when the last tab closes", () => {
    const { T, identity, store, mainGB, tabVals } = makeEnv();
    T.openTempTab("https://a.example/");
    const t = mainGB.tabs[mainGB.tabs.length - 1];
    assert.equal(t.userContextId, 100);
    mainGB.tabs.splice(mainGB.tabs.indexOf(t), 1);
    assert.equal(T.sweepTempContainers(null), 1);
    assert.deepEqual(identity.removed, [100]);
    assert.deepEqual(JSON.parse(store["aph.tempContainers"]), []);
  });

  it("keeps the identity while a sibling tab uses it", () => {
    const { T, identity, mainGB, tabVals } = makeEnv();
    T.openTempTab("https://a.example/");
    const a = mainGB.tabs[mainGB.tabs.length - 1];
    mainGB.tabs.push(tabWithCid(tabVals, a.userContextId));
    mainGB.tabs.splice(mainGB.tabs.indexOf(a), 1);
    assert.equal(T.sweepTempContainers(null), 0);
    assert.deepEqual(identity.removed, []);
  });

  it("keeps the identity while another window uses it", () => {
    const tabVals = new WeakMap();
    const otherGB = { tabs: [tabWithCid(tabVals, 100)] };
    const { T, identity } = makeEnv({
      prefIds: [100],
      identities: [[100, "Tmp 1"]],
      windows: [{ closed: false, gBrowser: { tabs: [] } }, { closed: false, gBrowser: otherGB }],
    });
    assert.equal(T.sweepTempContainers(null), 0);
    assert.deepEqual(identity.removed, []);
  });

  it("is fail-closed when windows cannot be enumerated", () => {
    const { T, identity, store, sb } = makeEnv({ prefIds: [100], identities: [[100, "Tmp 1"]] });
    sb.Services.wm = {
      getEnumerator() {
        throw new Error("blind");
      },
    };
    assert.equal(T.sweepTempContainers(null), 0);
    assert.equal(T.sweepOrphanTempNames(), 0);
    assert.deepEqual(identity.removed, []);
    assert.deepEqual(JSON.parse(store["aph.tempContainers"]), [100]);
  });

  it("cleanupTempContainer defers to the sweep for tracked ids", async () => {
    const { T, identity, mainGB } = makeEnv({ realTimers: true });
    T.openTempTab("https://a.example/");
    const t = mainGB.tabs[mainGB.tabs.length - 1];
    mainGB.tabs.splice(mainGB.tabs.indexOf(t), 1);
    T.cleanupTempContainer(t);
    await new Promise((r) => setTimeout(r, 250));
    assert.deepEqual(identity.removed, [100]);
  });

  it("cleanupTempContainer ignores untracked containers", async () => {
    const tabVals = new WeakMap();
    const { T, identity } = makeEnv({ realTimers: true, identities: [[50, "Work"]] });
    T.cleanupTempContainer(tabWithCid(tabVals, 50));
    await new Promise((r) => setTimeout(r, 250));
    assert.deepEqual(identity.removed, []);
  });
});

describe("orphan reconcile", () => {
  it("removes empty untracked Tmp names, keeps the rest", () => {
    const { T, identity } = makeEnv({
      identities: [
        [100, "Tmp 1"],
        [101, "Tmp 2"],
        [102, "Work"],
        [103, "Tmp 5"],
      ],
    });
    assert.equal(T.sweepOrphanTempNames(), 3);
    assert.deepEqual(identity.removed.sort(), [100, 101, 103]);
  });

  it("spares Tmp-named containers that still have tabs", () => {
    const tabVals = new WeakMap();
    const gb = { tabs: [tabWithCid(tabVals, 103)] };
    const { T, identity } = makeEnv({
      identities: [
        [103, "Tmp 5"],
        [104, "Tmp 6"],
      ],
      windows: [{ closed: false, gBrowser: gb }],
    });
    assert.equal(T.sweepOrphanTempNames(), 1);
    assert.deepEqual(identity.removed, [104]);
  });

  it("reconcile clears tracked empties and orphans together", () => {
    const { T, identity, store } = makeEnv({
      prefIds: [100],
      identities: [
        [100, "Tmp 1"],
        [101, "Tmp 2"],
      ],
    });
    T.reconcileTempContainers();
    assert.deepEqual(identity.removed.sort(), [100, 101]);
    assert.deepEqual(JSON.parse(store["aph.tempContainers"]), []);
  });

  it("isTempContainerId sees shared ids born elsewhere", () => {
    const { T } = makeEnv({ prefIds: [777] });
    assert.equal(T.isTempContainerId(777), true);
    assert.equal(T.isTempContainerId(778), false);
  });
});
