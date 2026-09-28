// First-run welcome trigger (branding/src/workspaces/105-welcome.js,
// bundled into branding/workspaces.js): opens the tour once per profile
// after session restore settles, stays quiet otherwise.
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { run, makeTab } = require("./helpers");

const HOOK =
  'window.__aphWelcomeTest = { maybeShowWelcome, welcomeSeen, setWelcomeSeen, aphOpenWelcome, WELCOME_URL, WELCOME_SEEN_PREF };';

function makeEnv({ seen, isPrivate = false, windows = [{}], tabs = [] } = {}) {
  const tabVals = new WeakMap();
  const prefStore = {};
  if (seen !== undefined) {
    prefStore["aph.welcome.seen"] = seen;
  }
  const created = [];
  let selected = null;
  const writes = [];
  const sb = {
    window: {
      addEventListener() {},
      opener: null,
      PrivateBrowsingUtils: { isWindowPrivate: () => isPrivate },
    },
    navigator: { onLine: true },
    document: {
      readyState: "loading",
      getElementById: () => null,
      addEventListener() {},
    },
    gBrowser: {
      tabs: tabs.slice(),
      get selectedTab() {
        return selected;
      },
      set selectedTab(t) {
        selected = t;
      },
      showTab() {},
      ungroupTab() {},
      addTrustedTab(url) {
        const t = makeTab(tabVals, { label: "new", ws: "1", spec: url });
        created.push(t);
        sb.gBrowser.tabs.push(t);
        return t;
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
      setCustomWindowValue() {},
    },
    Services: {
      prefs: {
        getBoolPref(k, d) {
          if (k in prefStore) {
            return !!prefStore[k];
          }
          if (d !== undefined) {
            return !!d;
          }
          throw new Error(`undefined pref: ${k}`);
        },
        setBoolPref(k, v) {
          writes.push([k, !!v]);
          prefStore[k] = !!v;
        },
        addObserver() {},
        removeObserver() {},
      },
      obs: { addObserver() {}, removeObserver() {} },
      wm: {
        getEnumerator() {
          let i = 0;
          return {
            hasMoreElements: () => i < windows.length,
            getNext: () => windows[i++],
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
  const T = sb.window.__aphWelcomeTest;
  assert.ok(T, "welcome test hook missing");
  return { T, prefStore, created, writes, sb, getSelected: () => selected };
}

describe("welcome trigger", () => {
  it("opens the tour and marks seen on first run", () => {
    const { T, prefStore, created } = makeEnv();
    T.maybeShowWelcome();
    assert.equal(created.length, 1);
    assert.equal(
      created[0].linkedBrowser.currentURI.spec,
      "chrome://browser/content/aph-welcome.html"
    );
    assert.equal(prefStore["aph.welcome.seen"], true);
  });

  it("stays quiet when already seen", () => {
    const { T, created, writes } = makeEnv({ seen: true });
    T.maybeShowWelcome();
    assert.equal(created.length, 0);
    assert.equal(writes.length, 0);
  });

  it("stays quiet in private windows without marking seen", () => {
    const { T, created, prefStore } = makeEnv({ isPrivate: true });
    T.maybeShowWelcome();
    assert.equal(created.length, 0);
    assert.ok(!("aph.welcome.seen" in prefStore));
  });

  it("stays quiet in secondary windows without marking seen", () => {
    const { T, created, prefStore } = makeEnv({ windows: [{}, {}] });
    T.maybeShowWelcome();
    assert.equal(created.length, 0);
    assert.ok(!("aph.welcome.seen" in prefStore));
  });

  it("reuses an existing welcome tab instead of stacking", () => {
    const tabVals = new WeakMap();
    const existing = makeTab(tabVals, {
      label: "welcome",
      ws: "1",
      spec: "chrome://browser/content/aph-welcome.html",
    });
    const { T, created, prefStore, getSelected } = makeEnv({ tabs: [existing] });
    T.maybeShowWelcome();
    assert.equal(created.length, 0);
    assert.equal(getSelected(), existing);
    assert.equal(prefStore["aph.welcome.seen"], true);
  });

  it("fires only once per window", () => {
    const { T, created } = makeEnv();
    T.maybeShowWelcome();
    T.maybeShowWelcome();
    assert.equal(created.length, 1);
  });
});
