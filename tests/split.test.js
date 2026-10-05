// Regression guards for native dual split-view driving
// (branding/workspaces.js 78-split.js + palette rows): the Aph layer
// only calls stock entry points, picks same-workspace partners by
// recency, and dissolves splits before workspace switches/sends so a
// hidden tab can never keep painting. The real bundle runs in node:vm
// with Firefox globals mocked (same shape as tests/workspaces.test.js).
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { run, makeTab } = require("./helpers");

// specs: [label, ws, spec, opts]. Tabs exist before the bundle loads
// so startup init reconciles them instead of opening a fresh tab
// (which would pollute counts). The selected tab is picked by label
// (first ws-"1" tab when omitted).
function makeEnv(specs, selectedLabel) {
  const tabVals = new WeakMap();
  const prefStore = { "browser.tabs.splitView.enabled": true };
  const splitCalls = [];
  let pickerCalls = 0;
  let wsel = null;

  const tabs = (specs || []).map((s) =>
    makeTab(tabVals, Object.assign({ label: s[0], ws: s[1] || "1", spec: s[2] }, s[3]))
  );

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
      tabs,
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
      addTrustedTab(url) {
        const t = makeTab(tabVals, { label: "new", ws: "1", spec: url });
        sb.gBrowser.tabs.push(t);
        return t;
      },
      removeTab(t) {
        const i = sb.gBrowser.tabs.indexOf(t);
        if (i !== -1) sb.gBrowser.tabs.splice(i, 1);
      },
      addTabSplitView(tabs, opts) {
        splitCalls.push({ tabs: Array.from(tabs || []), opts });
      },
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
      isTabRestoring: () => false,
      getCustomWindowValue: () => undefined,
      setCustomWindowValue: () => {},
    },
    Services: {
      prefs: {
        getBoolPref: (k, d) => {
          if (k in prefStore && typeof prefStore[k] === "boolean") return prefStore[k];
          if (d !== undefined) return d;
          throw new Error(`no bool pref ${k}`);
        },
        setBoolPref: (k, v) => {
          prefStore[k] = !!v;
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
      importESModule: () => ({
        ContextualIdentityService: {
          getPublicIdentityFromId: () => null,
          create: () => {
            throw new Error("unused");
          },
          remove: () => {},
        },
      }),
    },
    Ci: {},
    BrowserCommands: {
      addTabSplitView() {
        pickerCalls++;
      },
    },
  };
  run("workspaces.js", sb);
  const api = sb.window.AphWorkspaces;
  const byLabel = {};
  for (const t of sb.gBrowser.tabs) {
    byLabel[t.label] = t;
  }
  function view(t, ms) {
    tabVals.get(t).aphLastViewed = ms;
  }
  function select(t) {
    sb.gBrowser.selectedTab = t;
  }
  if (selectedLabel !== null) {
    const pick =
      selectedLabel !== undefined
        ? byLabel[selectedLabel]
        : tabs.find((t) => (tabVals.get(t) || {}).aphWs === "1");
    if (pick) {
      select(pick);
    }
  }
  return {
    sb,
    api,
    tabVals,
    prefStore,
    splitCalls,
    byLabel,
    picker: () => pickerCalls,
    view,
    select,
  };
}

function wrapper() {
  const calls = [];
  return {
    calls,
    tabs: [],
    unsplitTabs(trigger) {
      calls.push(trigger);
    },
    reverseTabs(trigger) {
      calls.push(`reverse:${trigger}`);
    },
  };
}

describe("split toggle", () => {
  it("separates when the selected tab is split, keeping both tabs", () => {
    const e = makeEnv(
      [
        ["A", "1", "https://a.example/"],
        ["B", "1", "https://b.example/"],
      ],
      "A"
    );
    const { A, B } = e.byLabel;
    const w = wrapper();
    A.splitview = w;
    B.splitview = w;
    w.tabs = [A, B];
    const r = e.api.splitToggle();
    assert.equal(r.action, "separated");
    assert.deepEqual(w.calls, ["aph_hotkey"]);
    assert.ok(e.sb.gBrowser.tabs.includes(A) && e.sb.gBrowser.tabs.includes(B));
  });

  it("splits the selected tab with the most-recently-viewed same-workspace tab", () => {
    const e = makeEnv(
      [
        ["sel", "1", "https://sel.example/"],
        ["old", "1", "https://old.example/"],
        ["mru", "1", "https://mru.example/"],
        ["other", "2", "https://other.example/"],
      ],
      "sel"
    );
    const { sel, old, mru, other } = e.byLabel;
    e.view(old, 100);
    e.view(mru, 300);
    e.view(other, 9999);
    const r = e.api.splitToggle();
    assert.equal(r.action, "split");
    assert.equal(e.splitCalls.length, 1);
    assert.deepEqual(e.splitCalls[0].tabs, [sel, mru]);
  });

  it("skips pinned, hidden, in-split and untagged tabs when picking", () => {
    const e = makeEnv(
      [
        ["sel", "1", "https://sel.example/"],
        ["pinned", "1", "https://pinned.example/", { pinned: true }],
        ["hidden", "1", "https://hidden.example/"],
        ["split", "1", "https://split.example/"],
        ["tagless", "1", "https://tagless.example/"],
        ["good", "1", "https://good.example/"],
      ],
      "sel"
    );
    const { sel, pinned, hidden, split, tagless, good } = e.byLabel;
    hidden.setAttribute("hidden", "true");
    split.splitview = wrapper();
    e.tabVals.get(tagless).aphWs = undefined;
    e.view(pinned, 900);
    e.view(hidden, 800);
    e.view(split, 700);
    e.view(tagless, 600);
    e.view(good, 100);
    const r = e.api.splitToggle();
    assert.equal(r.action, "split");
    assert.deepEqual(e.splitCalls[0].tabs, [sel, good]);
  });

  it("falls back to the native picker with no partner", () => {
    const e = makeEnv([["lonely", "1", "https://lonely.example/"]], "lonely");
    const r = e.api.splitToggle();
    assert.equal(r.action, "picker");
    assert.equal(e.picker(), 1);
    assert.equal(e.splitCalls.length, 0);
  });

  it("no-ops without the native engine", () => {
    const e = makeEnv(
      [
        ["sel", "1", "https://sel.example/"],
        ["other", "1", "https://other.example/"],
      ],
      "sel"
    );
    e.sb.gBrowser.addTabSplitView = undefined;
    const r = e.api.splitToggle();
    assert.equal(r.action, "noop");
  });

  it("reverses the active split", () => {
    const e = makeEnv([["A", "1", "https://a.example/"]], "A");
    const w = wrapper();
    e.byLabel.A.splitview = w;
    assert.equal(e.api.reverseSplit(), true);
    assert.deepEqual(w.calls, ["reverse:aph_palette"]);
  });
});

describe("split workspace guards", () => {
  it("dissolves splits on workspace switch, keeping every tab", () => {
    const e = makeEnv(
      [
        ["A", "1", "https://a.example/"],
        ["B", "1", "https://b.example/"],
        ["C", "2", "https://c.example/"],
      ],
      "A"
    );
    const { A, B, C } = e.byLabel;
    const w = wrapper();
    A.splitview = w;
    B.splitview = w;
    w.tabs = [A, B];
    assert.equal(e.api.switchTo("2"), "switched");
    assert.deepEqual(w.calls, ["aph_switch"]);
    assert.equal(e.sb.gBrowser.tabs.length, 3);
    assert.ok(e.sb.gBrowser.tabs.includes(C));
  });

  it("separates a split before sending one of its tabs away", () => {
    const e = makeEnv(
      [
        ["A", "1", "https://a.example/"],
        ["B", "1", "https://b.example/"],
      ],
      "A"
    );
    const { A, B } = e.byLabel;
    const w = wrapper();
    A.splitview = w;
    B.splitview = w;
    w.tabs = [A, B];
    e.api.sendTabTo("2");
    assert.deepEqual(w.calls, ["aph_send"]);
    assert.equal(e.tabVals.get(A).aphWs, "2");
    assert.equal(e.tabVals.get(B).aphWs, "1");
    assert.ok(e.sb.gBrowser.tabs.includes(A) && e.sb.gBrowser.tabs.includes(B));
  });
});

describe("split hotkey", () => {
  it("ctrl+alt+backslash drives the toggle", () => {
    const seen = [];
    const sb = {
      window: {
        addEventListener(t, fn) {
          seen.push([t, fn]);
        },
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
        selectedTab: null,
        addTabSplitView(tabs) {
          seen.push(["split", Array.from(tabs || [])]);
        },
        tabContainer: {
          setAttribute() {},
          addEventListener() {},
          _invalidateCachedVisibleTabs() {},
          _updateCloseButtons() {},
        },
      },
      SessionStore: {
        getCustomTabValue: () => undefined,
        setCustomTabValue: () => {},
        deleteCustomTabValue: () => {},
        isTabRestoring: () => false,
        getCustomWindowValue: () => undefined,
        setCustomWindowValue: () => {},
      },
      Services: {
        prefs: {
          getBoolPref: (k, d) => (d !== undefined ? d : true),
          setBoolPref: () => {},
        },
        console: { logStringMessage() {} },
        wm: { getMostRecentWindow: () => null },
        obs: { addObserver() {}, removeObserver() {} },
      },
      ChromeUtils: {
        generateQI: () => () => {},
        importESModule: () => ({
          ContextualIdentityService: {
            getPublicIdentityFromId: () => null,
            create: () => {
              throw new Error("unused");
            },
            remove: () => {},
          },
        }),
      },
      Ci: {},
    };
    run("workspaces.js", sb);
    const keys = seen.filter(([t]) => t === "keydown").map(([, fn]) => fn);
    assert.ok(keys.length > 0, "no window keydown listener registered");
    const prevented = [];
    const ev = {
      code: "Backslash",
      ctrlKey: true,
      altKey: true,
      shiftKey: false,
      metaKey: false,
      repeat: false,
      target: {},
      preventDefault: () => prevented.push("pd"),
      stopPropagation: () => prevented.push("sp"),
      getModifierState: () => false,
    };
    for (const fn of keys) {
      try {
        fn(ev);
      } catch (err) {}
    }
    // No splittable selection in this shell: the toggle must still run
    // guarded (preventDefault) without throwing or splitting.
    assert.ok(prevented.includes("pd"), "hotkey did not claim the event");
  });
});

describe("split palette rows", () => {
  function palEnv(split) {
    const calls = [];
    const sb = {
      window: {
        addEventListener() {},
        AphWorkspaces: {
          getCurrent: () => "1",
          getWsName: () => "",
          getRoutes: () => ({}),
          matchRoute: () => null,
          setRoute: () => {},
          deleteRoute: () => {},
          getWsContainer: () => 0,
          describeContainer: () => null,
          getWs: () => "1",
          switchTo: () => {},
          sendTabTo: () => {},
          openBoundTab: () => {},
          openTempTab: () => {},
          splitState: () => split.state,
          splitToggle: () => {
            calls.push("toggle");
            return { action: "split" };
          },
          separateSplit: () => {
            calls.push("separate");
            return true;
          },
          reverseSplit: () => {
            calls.push("reverse");
            return true;
          },
        },
      },
      document: { readyState: "loading" },
      gBrowser: {
        tabs: [],
        addTrustedTab: () => {
          throw new Error("should route via api");
        },
        get selectedTab() {
          return { linkedBrowser: { currentURI: { spec: "about:newtab" } } };
        },
      },
      SessionStore: {},
    };
    run(
      "command-palette.js",
      sb,
      'window.addEventListener("keydown", onKey, true);',
      "window.__aphSplitTest = { allItems };"
    );
    return { T: sb.window.__aphSplitTest, calls };
  }

  const TITLES = [
    "Separate Split Tabs",
    "Reverse Split Panes",
    "Split with Last Tab",
    "Split View (Pick Tab…)",
  ];
  function titles(T, q) {
    return T.allItems(q).map((r) => r.title);
  }

  it("offers separate + reverse inside a split", () => {
    const { T, calls } = palEnv({ state: { inSplit: true, canSplit: false } });
    const found = titles(T, "split");
    assert.ok(found.includes("Separate Split Tabs"), found.join(" | "));
    assert.ok(found.includes("Reverse Split Panes"), found.join(" | "));
    const sep = T.allItems("separate").find((r) => r.title === "Separate Split Tabs");
    assert.ok(sep);
    sep.run();
    assert.deepEqual(calls, ["separate"]);
  });

  it("offers split-with-last-tab naming the partner", () => {
    const { T, calls } = palEnv({
      state: { inSplit: false, canSplit: true, candidateTitle: "Docs", candidateUrl: "https://d.example/" },
    });
    const found = titles(T, "split");
    assert.ok(found.includes("Split with Last Tab"), found.join(" | "));
    const row = T.allItems("split with").find((r) => r.title === "Split with Last Tab");
    assert.ok(row && row.sub.includes("Docs"), row && row.sub);
    row.run();
    assert.deepEqual(calls, ["toggle"]);
  });

  it("offers the picker when no partner exists, nothing when unsplittable", () => {
    const pick = palEnv({ state: { inSplit: false, canSplit: true } });
    assert.ok(
      titles(pick.T, "split").includes("Split View (Pick Tab…)"),
      titles(pick.T, "split").join(" | ")
    );
    const bare = palEnv({ state: { inSplit: false, canSplit: false } });
    const found = titles(bare.T, "split");
    assert.ok(
      TITLES.every((t) => !found.includes(t)),
      found.join(" | ")
    );
  });
});
