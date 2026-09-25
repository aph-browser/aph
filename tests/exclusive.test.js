// Window-scoped workspaces (Vivaldi/Zen model): every window owns its own
// workspaces 1-9 with independent tab sets. Same-id workspaces coexist in
// two windows with zero interaction: switches never pull, closes never
// merge (native SessionStore undo), and cross-window moves happen only via
// the explicit moveTabsToWindow (adopt + retag to the destination's
// current workspace).
//
// Harness runs the bundle LIVE in every window (shared SessionStore +
// Services, per-window gBrowser/document), and adoptTab mirrors the real
// swap semantics from Tabbrowser.sys.mjs: adoptTab(aTab, {tabIndex,
// selectTab}) creates a NEW tab element in the destination, fires TabOpen
// with detail.adoptedTab there, and closes the source tab.
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { run, makeTab } = require("./helpers");

function makeLiveWorld() {
  const tabVals = new WeakMap();
  const winVals = new Map();
  const closedByWin = new Map();
  const live = [];
  const prefStore = {};

  function saveableSpec(tab) {
    try {
      const s = String(tab.linkedBrowser?.currentURI?.spec || "");
      return /^(https?|file):/i.test(s);
    } catch (e) {
      return false;
    }
  }

  function recordGhost(srcWin, tab) {
    try {
      if (!saveableSpec(tab)) {
        return;
      }
      if (!closedByWin.has(srcWin)) {
        closedByWin.set(srcWin, []);
      }
      closedByWin.get(srcWin).unshift(tab.label);
    } catch (e) {}
  }

  const sessionStore = {
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
    // Closed-tab undo stack per window (mirrors SessionStore._closedTabs,
    // newest first). recordGhost simulates #onTabClose recording for an
    // adopted-away tab; forgetClosedTab mirrors the real API (throws when
    // the index is missing). Only saveable specs record — blank/newtab
    // closes never enter the undo stack (mirrors #shouldSaveTabState).
    forgetClosedTab: (w, i) => {
      const arr = closedByWin.get(w) || [];
      if (!(i in arr)) {
        const e = new Error("Invalid index: not in the closed tabs");
        e.result = 0x80070057;
        throw e;
      }
      arr.splice(i, 1);
    },
    getCustomWindowValue: (w, k) => (k === "aphWsCurrent" ? winVals.get(w) : undefined),
    setCustomWindowValue: (w, k, v) => {
      if (k === "aphWsCurrent") winVals.set(w, v);
    },
  };

  const services = {
    prefs: {
      getStringPref: (k, d) => (k in prefStore ? prefStore[k] : d),
      setStringPref: (k, v) => { prefStore[k] = v; },
      getBoolPref: () => { throw new Error("no bool pref"); },
      addObserver() {},
      removeObserver() {},
    },
    console: { logStringMessage() {} },
    wm: {
      getMostRecentWindow: () => null,
      getEnumerator: () => {
        let i = 0;
        return {
          hasMoreElements: () => i < live.length,
          getNext: () => live[i++].sb.window,
        };
      },
    },
    obs: {
      addObserver() {},
      removeObserver() {},
      notifyObservers() {},
    },
  };

  function findOwner(tab) {
    for (const w of live) {
      if (w.sb.gBrowser.tabs.includes(tab)) return w;
    }
    return null;
  }

  function spawn({ ws = "1", tabs = [], isPrivate = false } = {}) {
    const listeners = {};
    let wsel = null;
    const ctx = {};
    const sb = {
      window: {
        addEventListener() {},
        opener: null,
        focused: false,
        focus() { sb.window.focused = true; },
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
        addTabGroup(tabs, opts) {
          const ng = {
            tabs: (tabs || []).slice(),
            label: (opts && opts.label) || "",
            color: (opts && opts.color) || "",
            collapsed: false,
          };
          for (const t of ng.tabs) t.group = ng;
          sb.gBrowser.tabGroups.push(ng);
          for (const fn of listeners.TabGroupCreate || []) fn({ target: ng });
          return ng;
        },
        // Real swap semantics: NEW element in dest, TabOpen w/ adoptedTab,
        // source tab closed. Tag starts blank (fresh element).
        adoptTab(tab, opts) {
          const src = findOwner(tab);
          const nt = makeTab(tabVals, {
            label: tab.label, pinned: !!tab.pinned, selected: false,
            spec: (tab.linkedBrowser?.currentURI?.spec || "about:blank"),
            cid: tab.userContextId || 0,
          });
          tabVals.get(nt).aphWs = undefined;
          if (src) {
            const i = src.sb.gBrowser.tabs.indexOf(tab);
            if (i !== -1) src.sb.gBrowser.tabs.splice(i, 1);
            if (src.sb.gBrowser.selectedTab === tab) {
              src.sb.gBrowser.selectedTab = src.sb.gBrowser.tabs[0] || null;
            }
            // SessionStore records the adoption-close as undoable...
            recordGhost(src.sb.window, tab);
            tab.closing = true;
          }
          sb.gBrowser.tabs.push(nt);
          if (opts && opts.selectTab) sb.gBrowser.selectedTab = nt;
          for (const fn of listeners.TabOpen || []) {
            fn({ target: nt, detail: { adoptedTab: tab } });
          }
          return nt;
        },
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
        discardBrowser(t) { t.setAttribute("pending", ""); },
        ungroupTab() {},
        replaceInSuccession() {},
        setSuccessor() {},
        _updateMultiselectedTabCloseButtonTooltip() {},
        getTabForBrowser: (b) => (b && b.__tab) || null,
        addTabsProgressListener() {},
        tabContainer: {
          setAttribute() {},
          addEventListener(type, fn) {
            (listeners[type] = listeners[type] || []).push(fn);
          },
          removeEventListener() {},
          _invalidateCachedVisibleTabs() {},
          _updateCloseButtons() {},
        },
      },
      SessionStore: sessionStore,
      Services: services,
      ChromeUtils: {
        generateQI: () => () => {},
        importESModule: () => ({ ContextualIdentityService: null }),
      },
      Ci: { nsIWebProgressListener: {}, nsIWebProgress: {} },
    };
    if (isPrivate) {
      sb.window.PrivateBrowsingUtils = {
        isWindowPrivate: (t) => (t || sb.window) === sb.window,
      };
    }
    // Production shape: the chrome window itself carries gBrowser
    // (enumerator yields windows, and listAphWindows reads w.gBrowser).
    sb.window.gBrowser = sb.gBrowser;
    Object.assign(ctx, { sb, listeners, getSel: () => wsel, setSel: (t) => { wsel = t; } });
    live.push(ctx);

    for (const o of tabs) {
      const t = makeTab(tabVals, { hidden: false, ...o });
      // Stash spec for the swap mock (makeTab keeps it on linkedBrowser).
      sb.gBrowser.tabs.push(t);
      if (o.selected) wsel = t;
    }
    winVals.set(sb.window, ws);
    sb.window.window = sb.window;
    run("workspaces.js", sb);
    ctx.api = sb.window.AphWorkspaces;
    return ctx;
  }

  const tagOf = (t) => (tabVals.get(t) || {}).aphWs;
  // Native close: the window drops out of the pool untouched — no merge,
  // no adoption. SessionStore records it as-is for Recently Closed.
  function closeWindow(ctx) {
    const i = live.indexOf(ctx);
    if (i !== -1) live.splice(i, 1);
    winVals.delete(ctx.sb.window);
  }
  // Seed a genuine undo entry (older than any ghost): appended at the end,
  // mirroring closedAt-descending order.
  function seedClosed(ctx, label) {
    if (!closedByWin.has(ctx.sb.window)) {
      closedByWin.set(ctx.sb.window, []);
    }
    closedByWin.get(ctx.sb.window).push(label);
  }
  function closedOf(ctx) {
    return (closedByWin.get(ctx.sb.window) || []).slice();
  }
  function makeGroup(ctx, { label = "", color = "", collapsed = false, members = [] } = {}) {
    const g = { tabs: members.slice(), label, color, collapsed };
    for (const t of members) t.group = g;
    ctx.sb.gBrowser.tabGroups.push(g);
    return g;
  }
  return { spawn, live, tabVals, winVals, tagOf, sessionStore, makeGroup, closeWindow, seedClosed, closedOf };
}

describe("window-scoped workspaces", () => {
  it("same workspace id in two windows is independent", () => {
    const w = makeLiveWorld();
    const win1 = w.spawn({
      ws: "2",
      tabs: [
        { label: "a", ws: "2", selected: true, spec: "https://a.example.com/" },
        { label: "b", ws: "2", spec: "https://b.example.com/" },
      ],
    });
    const win2 = w.spawn({
      ws: "2",
      tabs: [{ label: "c", ws: "2", selected: true, spec: "https://c.example.com/" }],
    });
    assert.equal(win1.api.switchTo("3"), "switched");
    assert.equal(win1.api.getCurrent(), "3");
    // win2 never notices: same id, own set, still showing.
    assert.equal(win2.api.getCurrent(), "2");
    assert.equal(win2.sb.gBrowser.tabs.length, 1);
    assert.equal(win2.sb.gBrowser.tabs[0].label, "c");
    assert.equal(win2.sb.gBrowser.tabs[0].hidden, false);
    // And back the other way.
    assert.equal(win2.api.switchTo("3"), "switched");
    assert.equal(win2.api.getCurrent(), "3");
    assert.equal(win1.api.getCurrent(), "3");
    assert.equal(win1.sb.gBrowser.tabs.length, 3); // a, b + WS3 newtab
  });

  it("summoning never pulls from other windows", () => {
    const w = makeLiveWorld();
    const win1 = w.spawn({
      ws: "1",
      tabs: [{ label: "home", ws: "1", selected: true, spec: "https://home.example.com/" }],
    });
    const win2 = w.spawn({
      ws: "2",
      tabs: [
        { label: "h2", ws: "2", selected: true, spec: "https://h2.example.com/" },
        { label: "x", ws: "3", hidden: true, spec: "https://x.example.com/" },
        { label: "y", ws: "3", hidden: true, spec: "https://y.example.com/" },
      ],
    });
    assert.equal(win1.api.switchTo("3"), "switched");
    assert.equal(win1.sb.gBrowser.tabs.length, 2, "home + fresh WS3 newtab, nothing pulled");
    assert.ok(!win1.sb.gBrowser.tabs.some((t) => t.label === "x"));
    // Source window byte-identical: nothing adopted away.
    assert.equal(win2.sb.gBrowser.tabs.length, 3);
    assert.ok(win2.sb.gBrowser.tabs.some((t) => t.label === "x"));
    assert.ok(win2.sb.gBrowser.tabs.some((t) => t.label === "y"));
    assert.equal(w.tagOf(win2.sb.gBrowser.tabs.find((t) => t.label === "x")), "3");
  });

  it("closing a window touches nothing (native close)", () => {
    const w = makeLiveWorld();
    const win1 = w.spawn({
      ws: "1",
      tabs: [
        { label: "a", ws: "1", selected: true, spec: "https://a.example.com/" },
        { label: "b", ws: "2", hidden: true, spec: "https://b.example.com/" },
      ],
    });
    const win2 = w.spawn({
      ws: "2",
      tabs: [{ label: "c", ws: "2", selected: true, spec: "https://c.example.com/" }],
    });
    w.closeWindow(win1);
    assert.equal(w.live.length, 1);
    assert.equal(win2.api.getCurrent(), "2");
    assert.equal(win2.sb.gBrowser.tabs.length, 1);
    assert.equal(win2.sb.gBrowser.tabs[0].label, "c");
    assert.equal(w.tagOf(win2.sb.gBrowser.tabs[0]), "2");
    assert.equal(win2.sb.gBrowser.tabs[0].hidden, false);
  });

  it("sends stay local when both windows share the id", () => {
    const w = makeLiveWorld();
    const win1 = w.spawn({
      ws: "2",
      tabs: [
        { label: "a", ws: "2", selected: true, spec: "https://a.example.com/" },
        { label: "b", ws: "2", spec: "https://b.example.com/" },
      ],
    });
    const win2 = w.spawn({
      ws: "2",
      tabs: [{ label: "c", ws: "2", selected: true, spec: "https://c.example.com/" }],
    });
    const a = win1.sb.gBrowser.tabs.find((t) => t.label === "a");
    win1.api.sendTabTo("1", [a]);
    assert.equal(w.tagOf(a), "1", "retagged locally");
    assert.equal(a.hidden, true, "hidden as foreign in win1");
    // Other window's same-id set is never touched.
    assert.equal(win2.sb.gBrowser.tabs.length, 1);
    assert.equal(win2.sb.gBrowser.tabs[0].label, "c");
    assert.equal(w.tagOf(win2.sb.gBrowser.tabs[0]), "2");
    assert.equal(win2.sb.gBrowser.tabs[0].hidden, false);
  });

  it("moveTabsToWindow adopts and retags to the destination current", () => {
    const w = makeLiveWorld();
    const win1 = w.spawn({
      ws: "1",
      tabs: [
        { label: "a", ws: "1", selected: true, spec: "https://a.example.com/" },
        { label: "b", ws: "1", spec: "https://b.example.com/" },
      ],
    });
    const win2 = w.spawn({
      ws: "2",
      tabs: [{ label: "home", ws: "2", selected: true, spec: "https://home.example.com/" }],
    });
    w.seedClosed(win1, "userclosed");
    const a = win1.sb.gBrowser.tabs.find((t) => t.label === "a");
    const moved = win1.api.moveTabsToWindow(win2.sb.window, [a]);
    assert.equal(moved, 1);
    const arrived = win2.sb.gBrowser.tabs.find((t) => t.label === "a");
    assert.ok(arrived, "tab adopted into the destination window");
    assert.equal(w.tagOf(arrived), "2", "retag to the destination current");
    assert.equal(arrived.hidden, false);
    // Source heals with nothing stranded.
    assert.ok(!win1.sb.gBrowser.tabs.includes(a), "source tab gone");
    assert.equal(win1.sb.gBrowser.tabs.length, 1);
    assert.equal(win1.sb.gBrowser.tabs[0].label, "b");
    assert.equal(win1.sb.gBrowser.selectedTab.label, "b");
    assert.deepEqual(w.closedOf(win1), ["userclosed"], "adoption ghost scrubbed");
  });

  it("move resolves the live selection with no explicit set", () => {
    const w = makeLiveWorld();
    const win1 = w.spawn({
      ws: "1",
      tabs: [{ label: "a", ws: "1", selected: true, spec: "https://a.example.com/" }],
    });
    const win2 = w.spawn({
      ws: "2",
      tabs: [{ label: "home", ws: "2", selected: true, spec: "https://home.example.com/" }],
    });
    const moved = win1.api.moveTabsToWindow(win2.sb.window);
    assert.equal(moved, 1, "palette path moves the selection");
    assert.ok(win2.sb.gBrowser.tabs.some((t) => t.label === "a"));
  });

  it("move refuses pinned tabs and the private boundary", () => {
    const w = makeLiveWorld();
    const win1 = w.spawn({
      ws: "1",
      tabs: [{ label: "p", ws: "1", pinned: true, selected: true, spec: "https://pin.example.com/" }],
    });
    const win2 = w.spawn({
      ws: "2",
      tabs: [{ label: "home", ws: "2", selected: true, spec: "https://home.example.com/" }],
    });
    assert.equal(win1.api.moveTabsToWindow(win2.sb.window), 0, "pins never move");
    assert.ok(win1.sb.gBrowser.tabs.some((t) => t.label === "p"));
    const priv = w.spawn({
      ws: "1",
      tabs: [{ label: "s", ws: "1", selected: true, spec: "https://s.example.com/" }],
      isPrivate: true,
    });
    assert.equal(priv.api.moveTabsToWindow(win2.sb.window), 0, "private never crosses");
    assert.equal(win2.sb.gBrowser.tabs.length, 1);
  });

  it("opening a window pulls nothing and preserves groups", () => {
    const w = makeLiveWorld();
    const win1 = w.spawn({
      ws: "2",
      tabs: [
        { label: "home", ws: "2", selected: true, spec: "https://home.example.com/" },
        { label: "a", ws: "2", spec: "https://a.example.com/" },
        { label: "b", ws: "2", spec: "https://b.example.com/" },
      ],
    });
    const [, a, b] = win1.sb.gBrowser.tabs;
    w.makeGroup(win1, { label: "Pair", color: "blue", members: [a, b] });
    // Fresh window lands on the lowest unowned id and touches nothing.
    const win2 = w.spawn({
      tabs: [{ label: "fresh", ws: "1", selected: true, spec: "about:newtab" }],
    });
    assert.equal(win2.api.getCurrent(), "1");
    assert.equal(win2.sb.gBrowser.tabs.length, 1);
    assert.equal(win1.sb.gBrowser.tabs.length, 3);
    assert.equal(a.group && a.group.label, "Pair");
  });

  it("multi-window switch + close in either order loses nothing", () => {
    // Fragmented shape (hidden foreign tabs in both windows) → both
    // windows switch locally → close in either order natively. Every tab
    // stays exactly where it was with tags intact — no moves, no merges.
    for (const closeFirst of ["A", "B"]) {
      const w = makeLiveWorld();
      const winA = w.spawn({
        ws: "1",
        tabs: [
          { label: "A1", ws: "1", selected: true, spec: "https://a1.example.com/" },
          { label: "A2", ws: "1", spec: "https://a2.example.com/" },
          { label: "X1", ws: "2", hidden: true, spec: "https://x1.example.com/" },
        ],
      });
      const winB = w.spawn({
        ws: "2",
        tabs: [
          { label: "B1", ws: "2", selected: true, spec: "https://b1.example.com/" },
          { label: "Y1", ws: "1", hidden: true, spec: "https://y1.example.com/" },
        ],
      });
      assert.equal(winA.api.switchTo("3"), "switched");
      assert.equal(winB.api.switchTo("4"), "switched");
      const first = closeFirst === "A" ? winA : winB;
      w.closeWindow(first);
      assert.equal(w.live.length, 1, `one survivor (closeFirst=${closeFirst})`);
      const surv = w.live[0];
      const expect = first === winA
        ? ["B1", "Y1", "new"]
        : ["A1", "A2", "X1", "new"];
      assert.deepEqual(
        surv.sb.gBrowser.tabs.map((t) => (t.label === "new" ? "new" : t.label)),
        expect
      );
      // Survivor visibility coherent for its own claim.
      const cur = surv.api.getCurrent();
      for (const t of surv.sb.gBrowser.tabs) {
        if (t.pinned || t.closing) continue;
        const tw = w.tagOf(t);
        if (tw === cur) {
          assert.equal(t.hidden, false, `${t.label} visible on WS${cur}`);
        } else {
          assert.equal(t.hidden, true, `${t.label} hidden on WS${cur}`);
        }
      }
    }
  });

  it("move scrubs the adoption ghost but keeps genuine undo entries", () => {
    const w = makeLiveWorld();
    const win1 = w.spawn({
      ws: "1",
      tabs: [{ label: "a", ws: "1", selected: true, spec: "https://a.example.com/" }],
    });
    w.seedClosed(win1, "userclosed");
    const win2 = w.spawn({
      ws: "2",
      tabs: [{ label: "home", ws: "2", selected: true, spec: "https://home.example.com/" }],
    });
    const a = win1.sb.gBrowser.tabs.find((t) => t.label === "a");
    win1.api.moveTabsToWindow(win2.sb.window, [a]);
    assert.deepEqual(w.closedOf(win1), ["userclosed"], "ghost scrubbed, undo kept");
  });

  it("blank moves never eat a genuine undo entry", () => {
    const w = makeLiveWorld();
    const win1 = w.spawn({
      ws: "1",
      tabs: [{ label: "n", ws: "1", selected: true, spec: "about:newtab" }],
    });
    w.seedClosed(win1, "userclosed");
    const win2 = w.spawn({
      ws: "2",
      tabs: [{ label: "home", ws: "2", selected: true, spec: "https://home.example.com/" }],
    });
    const n = win1.sb.gBrowser.tabs.find((t) => t.label === "n");
    win1.api.moveTabsToWindow(win2.sb.window, [n]);
    assert.deepEqual(w.closedOf(win1), ["userclosed"], "no ghost existed, nothing scrubbed");
  });

  it("debugExclusive reports the local claim", () => {
    const w = makeLiveWorld();
    const win1 = w.spawn({
      ws: "2",
      tabs: [{ label: "w2", ws: "2", selected: true, spec: "https://w2.example.com/" }],
    });
    const dbg = win1.api.debugExclusive();
    assert.equal(dbg.current, "2");
    assert.ok(dbg.winId);
  });

  it("debugSession dumps this window with tab tags and flags", () => {
    const w = makeLiveWorld();
    w.spawn({
      ws: "2",
      tabs: [{ label: "a", ws: "2", selected: true, spec: "https://a.example.com/" }],
    });
    const win2 = w.spawn({
      ws: "1",
      tabs: [{ label: "b", ws: "1", selected: true, spec: "https://b.example.com/" }],
    });
    const dump = win2.api.debugSession();
    assert.equal(dump.length, 1);
    assert.equal(dump[0].self, true);
    assert.equal(dump[0].ws, "1");
    assert.equal(dump[0].tabs.length, 1);
    assert.equal(dump[0].tabs[0].label, "b");
    assert.equal(dump[0].tabs[0].ws, "1");
    assert.equal(dump[0].tabs[0].selected, true);
  });
});
