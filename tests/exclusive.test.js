// Exclusive workspaces (tiling-WM model): mutual exclusion across windows.
// Dormant pulls adopt tabs; owned-elsewhere switches focus-jump (no steal);
// close merges unpinned tabs into a survivor (pins die with the window).
//
// Harness runs the bundle LIVE in every window (shared SessionStore +
// Services, per-window gBrowser/document), and adoptTab mirrors the real
// swap semantics from Tabbrowser.sys.mjs: adoptTab(aTab, {tabIndex,
// selectTab}) creates a NEW tab element in the destination, fires TabOpen
// with detail.adoptedTab there, and closes the source tab.
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { run, makeTab } = require("./helpers");

function makeLiveWorld({ breakWindowValues = false } = {}) {
  const tabVals = new WeakMap();
  const winVals = new Map();
  const closedByWin = new Map();
  const notified = [];
  const obsListeners = [];
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

  const throwingWindowValues = () => {
    throw Components_ExceptionWindowNotTracked();
  };
  function Components_ExceptionWindowNotTracked() {
    const e = new Error("Window is not tracked");
    e.result = 0x80070057;
    return e;
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
    // breakWindowValues simulates production windows SessionStore hasn't
    // tracked (get/set throw "Window is not tracked"): live ownership must
    // survive on the expando alone.
    getCustomWindowValue: (w, k) => {
      if (breakWindowValues && k === "aphWsCurrent") throwingWindowValues();
      return k === "aphWsCurrent" ? winVals.get(w) : undefined;
    },
    setCustomWindowValue: (w, k, v) => {
      if (breakWindowValues && k === "aphWsCurrent") throwingWindowValues();
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
      addObserver(o) { obsListeners.push(o); },
      removeObserver(o) {
        const i = obsListeners.indexOf(o);
        if (i !== -1) obsListeners.splice(i, 1);
      },
      notifyObservers(s, t, d) {
        notified.push({ topic: t, data: d });
        for (const o of obsListeners.slice()) {
          o.observe(s, t, d);
        }
      },
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
        showTab(t) { t.removeAttribute("hidden"); },
        // Native group adoption: members move in order with id/label/color
        // intact (mirrors adoptTabGroup + addTabGroup(isAdoptingGroup)).
        adoptTabGroup(group, opts) {
          let src = null;
          for (const w of live) {
            if (w.sb.gBrowser.tabGroups.includes(group)) { src = w; break; }
          }
          const members = (group.tabs || []).slice();
          const newTabs = [];
          for (const m of members) {
            newTabs.push(sb.gBrowser.adoptTab(m, {}));
          }
          if (src) {
            const gi = src.sb.gBrowser.tabGroups.indexOf(group);
            if (gi !== -1) src.sb.gBrowser.tabGroups.splice(gi, 1);
          }
          const ng = {
            tabs: newTabs,
            label: group.label || "",
            color: group.color || "",
            collapsed: false,
          };
          for (const t of newTabs) t.group = ng;
          sb.gBrowser.tabGroups.push(ng);
          for (const fn of listeners.TabGroupCreate || []) fn({ target: ng });
          return ng;
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
          const o = tabVals.get(tab) || {};
          const nt = makeTab(tabVals, {
            label: tab.label, pinned: !!tab.pinned, selected: false,
            spec: (o.specHint || tab.linkedBrowser?.currentURI?.spec || "about:blank"),
            cid: tab.userContextId || 0,
          });
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
  function quitApp() {
    services.obs.notifyObservers(null, "quit-application-granted", "");
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
  return { spawn, live, notified, tabVals, winVals, tagOf, sessionStore, makeGroup, quitApp, seedClosed, closedOf };
}

describe("exclusive workspaces", () => {
  it("pulls dormant tabs keeping their workspace tag (no teleport)", () => {
    const w = makeLiveWorld();
    const win1 = w.spawn({
      ws: "2",
      tabs: [
        { label: "a", ws: "2", selected: true, spec: "https://a.example.com/" },
        { label: "b", ws: "3", hidden: true, spec: "https://b.example.com/" },
      ],
    });
    const win2 = w.spawn({
      ws: "1",
      tabs: [{ label: "home", ws: "1", selected: true, spec: "https://home.example.com/" }],
    });
    assert.equal(win2.api.switchTo("3"), "switched");
    assert.equal(win2.api.getCurrent(), "3");
    assert.equal(win1.api.getCurrent(), "2");
    assert.equal(win1.sb.gBrowser.tabs.length, 1);
    assert.equal(win1.sb.gBrowser.tabs[0].label, "a");
    const moved = win2.sb.gBrowser.tabs.find((t) => t.label === "b");
    assert.ok(moved, "pulled tab lands in requesting window");
    assert.equal(w.tagOf(moved), "3", "keeps its workspace tag");
    assert.equal(moved.hidden, false);
    const sw = w.notified.filter((n) => n.topic === "aph-workspace-switched");
    assert.ok(sw.length >= 1);
    assert.equal(JSON.parse(sw[sw.length - 1].data).ws, "3");
  });

  it("focus-jumps when the workspace is live elsewhere (no steal, no move)", () => {
    const w = makeLiveWorld();
    const win1 = w.spawn({
      ws: "2",
      tabs: [{ label: "w2", ws: "2", selected: true, spec: "https://w2.example.com/" }],
    });
    const win2 = w.spawn({
      ws: "1",
      tabs: [{ label: "home", ws: "1", selected: true, spec: "https://home.example.com/" }],
    });
    assert.equal(win2.api.switchTo("2"), "focused");
    assert.equal(win2.api.getCurrent(), "1", "stays put");
    assert.equal(win1.sb.window.focused, true, "owner focused");
    assert.equal(win1.sb.gBrowser.tabs.length, 1);
    assert.equal(win2.sb.gBrowser.tabs.length, 1);
    assert.ok(win2.api.isWsOwnedElsewhere("2"));
    assert.ok(!win2.api.isWsOwnedElsewhere("9"));
    assert.deepEqual(Object.keys(win2.api.getRemoteWorkspaces()).sort(), ["2"]);
  });

  it("merge-back preserves workspace tags and leaves pins behind", () => {
    const w = makeLiveWorld();
    const win1 = w.spawn({
      ws: "2",
      tabs: [{ label: "a", ws: "2", selected: true, spec: "https://a.example.com/" }],
    });
    const win2 = w.spawn({
      ws: "3",
      tabs: [
        { label: "m3", ws: "3", selected: true, spec: "https://m3.example.com/" },
        { label: "m4", ws: "4", hidden: true, spec: "https://m4.example.com/" },
        { label: "p", ws: "3", pinned: true, spec: "https://pin.example.com/" },
      ],
    });
    const res = win2.api.mergeTabsIntoSurvivor();
    assert.equal(res.merged, 2);
    const tags = win1.sb.gBrowser.tabs.map((t) => w.tagOf(t)).sort();
    assert.deepEqual(tags, ["2", "3", "4"], "merged tabs keep their tags");
    assert.ok(win2.sb.gBrowser.tabs.some((t) => t.label === "p"), "pin stays");
    assert.ok(!win1.sb.gBrowser.tabs.some((t) => t.label === "p"), "pin not duplicated");
  });

  it("merge-back is a no-op with no survivor", () => {
    const w = makeLiveWorld();
    const win1 = w.spawn({
      ws: "1",
      tabs: [{ label: "home", ws: "1", selected: true, spec: "https://home.example.com/" }],
    });
    // Only window in the world: listAphWindows finds just itself.
    const res = win1.api.mergeTabsIntoSurvivor();
    assert.equal(res.merged, 0);
    assert.equal(win1.sb.gBrowser.tabs.length, 1);
  });

  it("never crosses the private boundary", () => {
    const w = makeLiveWorld();
    const win1 = w.spawn({
      ws: "2",
      tabs: [{ label: "w2", ws: "2", selected: true, spec: "https://w2.example.com/" }],
    });
    const priv = w.spawn({
      ws: "1",
      tabs: [{ label: "phome", ws: "1", selected: true, spec: "https://p.example.com/" }],
      isPrivate: true,
    });
    assert.ok(!priv.api.isWsOwnedElsewhere("2"), "private sees no owners");
    assert.equal(priv.api.switchTo("2"), "local", "private switches locally");
    assert.equal(priv.api.getCurrent(), "2", "private switches locally");
    assert.equal(win1.sb.window.focused, false);
    const res = priv.api.mergeTabsIntoSurvivor();
    assert.equal(res.merged, 0, "private never merges into normal survivor");
    assert.equal(win1.sb.gBrowser.tabs.length, 1);
  });

  it("lowestUnownedWorkspace skips live windows", () => {
    const w = makeLiveWorld();
    const mk = (ws) => ({
      ws,
      tabs: [{ label: `t${ws}`, ws, selected: true, spec: `https://${ws}.example.com/` }],
    });
    w.spawn(mk("1"));
    w.spawn(mk("2"));
    w.spawn(mk("3"));
    const win4 = w.spawn(mk("9"));
    // Other windows own 1..3 (self excluded) -> lowest free is 4.
    assert.equal(win4.api.lowestUnownedWorkspace(), "4");
  });

  it("focus-jumps even when SessionStore window values throw (untracked)", () => {
    const w = makeLiveWorld({ breakWindowValues: true });
    const win1 = w.spawn({
      tabs: [{ label: "a", ws: "1", selected: true, spec: "https://a.example.com/" }],
    });
    win1.api.switchTo("2");
    assert.equal(win1.api.getCurrent(), "2");
    const win2 = w.spawn({
      tabs: [{ label: "home", ws: "1", selected: true, spec: "https://home.example.com/" }],
    });
    // Sanity: window values really throw in this world.
    assert.throws(() => w.sessionStore.getCustomWindowValue(win1.sb.window, "aphWsCurrent"));
    const before = win2.sb.gBrowser.tabs.length;
    assert.equal(win2.api.switchTo("2"), "focused");
    assert.equal(win2.api.getCurrent(), "1", "stays put");
    assert.equal(win1.sb.window.focused, true, "owner focused via expando registry");
    assert.equal(win2.sb.gBrowser.tabs.length, before, "nothing moved");
  });

  it("restores a minimized owner before focusing", () => {
    const w = makeLiveWorld();
    const win1 = w.spawn({
      ws: "2",
      tabs: [{ label: "w2", ws: "2", selected: true, spec: "https://w2.example.com/" }],
    });
    const win2 = w.spawn({
      ws: "1",
      tabs: [{ label: "home", ws: "1", selected: true, spec: "https://home.example.com/" }],
    });
    let restored = false;
    win1.sb.window.windowState = 7;
    win1.sb.window.STATE_MINIMIZED = 7;
    win1.sb.window.restore = () => { restored = true; };
    win2.api.switchTo("2");
    assert.equal(restored, true);
    assert.equal(win1.sb.window.focused, true);
    assert.equal(win2.api.getCurrent(), "1");
  });

  it("debugExclusive reports live ownership", () => {
    const w = makeLiveWorld();
    const win1 = w.spawn({
      ws: "2",
      tabs: [{ label: "w2", ws: "2", selected: true, spec: "https://w2.example.com/" }],
    });
    const dbg = win1.api.debugExclusive();
    assert.equal(dbg.current, "2");
    // Cross-realm array: compare structurally, not by prototype.
    assert.deepEqual([...dbg.remote], []);
    assert.ok([...dbg.windows].some((x) => x.self && x.ws === "2"));
  });

  it("opening a window never pulls or flattens the old window", () => {
    const w = makeLiveWorld();
    const win1 = w.spawn({
      ws: "2",
      tabs: [
        { label: "home", ws: "2", selected: true, spec: "https://home.example.com/" },
        { label: "a", ws: "2", spec: "https://a.example.com/" },
        { label: "b", ws: "2", spec: "https://b.example.com/" },
        { label: "d1", ws: "1", hidden: true, spec: "https://d1.example.com/" },
        { label: "d2", ws: "1", hidden: true, spec: "https://d2.example.com/" },
      ],
    });
    const [home, a, b, d1, d2] = win1.sb.gBrowser.tabs;
    w.makeGroup(win1, { label: "Pair", color: "blue", members: [a, b] });
    w.makeGroup(win1, { label: "Sleepers", color: "green", members: [d1, d2] });
    // Ctrl+N: lands WS1 (lowest unowned) but must not touch WS1's sleepers.
    const win2 = w.spawn({
      tabs: [{ label: "fresh", ws: "1", selected: true, spec: "about:newtab" }],
    });
    assert.equal(win2.api.getCurrent(), "1");
    assert.equal(win2.sb.gBrowser.tabs.length, 1, "new window starts empty, pulls nothing");
    assert.equal(win1.sb.gBrowser.tabs.length, 5, "old window untouched");
    assert.equal(a.group && a.group.label, "Pair");
    assert.equal(a.group.tabs.length, 2);
    assert.equal(d1.group && d1.group.label, "Sleepers");
  });

  it("summoning a workspace preserves groups", () => {
    const w = makeLiveWorld();
    const win1 = w.spawn({
      ws: "2",
      tabs: [
        { label: "home", ws: "2", selected: true, spec: "https://home.example.com/" },
        { label: "a", ws: "3", hidden: true, spec: "https://a.example.com/" },
        { label: "b", ws: "3", hidden: true, spec: "https://b.example.com/" },
        { label: "c", ws: "3", hidden: true, spec: "https://c.example.com/" },
        { label: "d", ws: "3", hidden: true, spec: "https://d.example.com/" },
      ],
    });
    const [, a, b, c, d] = win1.sb.gBrowser.tabs;
    const g = w.makeGroup(win1, { label: "Work", color: "blue", collapsed: true, members: [c, d] });
    g.collapsed = true;
    const win2 = w.spawn({
      ws: "1",
      tabs: [{ label: "h2", ws: "1", selected: true, spec: "https://h2.example.com/" }],
    });
    w.seedClosed(win1, "userclosed");
    assert.equal(win2.api.switchTo("3"), "switched");
    assert.deepEqual(w.closedOf(win1), ["userclosed"], "group adoption ghosts scrubbed");
    assert.equal(win1.sb.gBrowser.tabs.length, 1, "source keeps only its own");
    const byLabel = (win, l) => win.sb.gBrowser.tabs.find((t) => t.label === l);
    const na = byLabel(win2, "a");
    const nb = byLabel(win2, "b");
    const nc = byLabel(win2, "c");
    const nd = byLabel(win2, "d");
    assert.ok(na && nb && nc && nd, "all members arrive");
    // Ungrouped tabs arrive ungrouped.
    assert.equal(na.group, null);
    assert.equal(nb.group, null);
    // Grouped pair survives with chrome intact (focus lands on `a`, so the
    // Work group is never the focused one and keeps its collapse).
    assert.ok(nc.group && nc.group === nd.group, "group preserved");
    assert.equal(nc.group.label, "Work");
    assert.equal(nc.group.collapsed, true, "collapse preserved");
    for (const t of [na, nb, nc, nd]) {
      assert.equal(w.tagOf(t), "3");
      assert.equal(t.hidden, false);
    }
  });

  it("summoning rebuilds the group when adoptTabGroup is unavailable", () => {    const w = makeLiveWorld();
    const win1 = w.spawn({
      ws: "2",
      tabs: [
        { label: "home", ws: "2", selected: true, spec: "https://home.example.com/" },
        { label: "a", ws: "3", hidden: true, spec: "https://a.example.com/" },
        { label: "b", ws: "3", hidden: true, spec: "https://b.example.com/" },
      ],
    });
    const [, a, b] = win1.sb.gBrowser.tabs;
    w.makeGroup(win1, { label: "Work", color: "red", members: [a, b] });
    const win2 = w.spawn({
      ws: "1",
      tabs: [{ label: "h2", ws: "1", selected: true, spec: "https://h2.example.com/" }],
    });
    delete win2.sb.gBrowser.adoptTabGroup;
    assert.equal(win2.api.switchTo("3"), "switched");
    const na = win2.sb.gBrowser.tabs.find((t) => t.label === "a");
    const nb = win2.sb.gBrowser.tabs.find((t) => t.label === "b");
    assert.ok(na && nb);
    assert.ok(na.group && na.group === nb.group, "group rebuilt");
    assert.equal(na.group.label, "Work");
  });

  it("sending to a remote workspace forwards into the owner", () => {
    const w = makeLiveWorld();
    const win1 = w.spawn({
      ws: "2",
      tabs: [{ label: "home", ws: "2", selected: true, spec: "https://home.example.com/" }],
    });
    const win2 = w.spawn({
      ws: "1",
      tabs: [
        { label: "a", ws: "1", selected: true, spec: "https://a.example.com/" },
        { label: "b", ws: "1", spec: "https://b.example.com/" },
      ],
    });
    const a = win2.sb.gBrowser.tabs.find((t) => t.label === "a");
    win2.api.sendTabTo("2", [a]);
    // Owner shows it live...
    const arrived = win1.sb.gBrowser.tabs.find((t) => t.label === "a");
    assert.ok(arrived, "tab forwarded into the owning window");
    assert.equal(w.tagOf(arrived), "2");
    assert.equal(arrived.hidden, false);
    // ...and the sender heals with nothing stranded.
    assert.equal(win2.api.getCurrent(), "1");
    assert.ok(!win2.sb.gBrowser.tabs.includes(a), "source tab gone");
    assert.equal(win2.sb.gBrowser.tabs.length, 1);
    const b = win2.sb.gBrowser.tabs[0];
    assert.equal(b.label, "b");
    assert.equal(b.hidden, false);
    assert.equal(win2.sb.gBrowser.selectedTab, b, "selection healed");
  });

  it("sending to a private-owned workspace refuses without moving", () => {    const w = makeLiveWorld();
    const winPriv = w.spawn({
      ws: "2",
      tabs: [{ label: "s", ws: "2", selected: true, spec: "https://s.example.com/" }],
      isPrivate: true,
    });
    const win2 = w.spawn({
      ws: "1",
      tabs: [{ label: "a", ws: "1", selected: true, spec: "https://a.example.com/" }],
    });
    const a = win2.sb.gBrowser.tabs[0];
    win2.api.sendTabTo("2", [a]);
    assert.equal(w.tagOf(a), "1", "tag untouched");
    assert.equal(a.hidden, false);
    assert.ok(win2.sb.gBrowser.tabs.includes(a), "tab stays");
    assert.equal(winPriv.sb.gBrowser.tabs.length, 1, "nothing crosses the boundary");
  });

  it("merge-back stands down during application shutdown", () => {    const w = makeLiveWorld();
    w.spawn({
      ws: "2",
      tabs: [{ label: "a", ws: "2", selected: true, spec: "https://a.example.com/" }],
    });
    const win2 = w.spawn({
      ws: "3",
      tabs: [{ label: "m", ws: "3", selected: true, spec: "https://m.example.com/" }],
    });
    w.quitApp();
    const res = win2.api.mergeTabsIntoSurvivor();
    assert.equal(res.merged, 0);
    assert.equal(res.reason, "shutdown");
    assert.equal(win2.sb.gBrowser.tabs.length, 1, "dying windows keep their tabs for the snapshot");
  });

  it("debugSession dumps every window with tab tags and flags", () => {    const w = makeLiveWorld();
    w.spawn({
      ws: "2",
      tabs: [{ label: "a", ws: "2", selected: true, spec: "https://a.example.com/" }],
    });
    const win2 = w.spawn({
      ws: "1",
      tabs: [{ label: "b", ws: "1", selected: true, spec: "https://b.example.com/" }],
    });
    const dump = win2.api.debugSession();
    assert.equal(dump.length, 2);
    const self = dump.find((x) => x.self);
    const other = dump.find((x) => !x.self);
    assert.equal(self.ws, "1");
    assert.equal(other.ws, "2");
    assert.equal(self.tabs.length, 1);
    assert.equal(self.tabs[0].label, "b");
    assert.equal(self.tabs[0].ws, "1");
    assert.equal(self.tabs[0].selected, true);
    assert.equal(other.tabs[0].label, "a");
  });

  it("finds pool-wide duplicates and closes only hidden copies", () => {    const w = makeLiveWorld();
    const win1 = w.spawn({
      ws: "2",
      tabs: [
        { label: "a", ws: "2", selected: true, spec: "https://dupe.example.com/" },
        { label: "solo", ws: "2", spec: "https://solo.example.com/" },
        { label: "nt1", ws: "2", spec: "about:home" },
      ],
    });
    const win2 = w.spawn({
      ws: "1",
      tabs: [
        { label: "h", ws: "1", selected: true, spec: "https://h.example.com/" },
        { label: "a-copy", ws: "2", hidden: true, spec: "https://dupe.example.com/" },
        { label: "nt2", ws: "1", spec: "about:home" },
      ],
    });
    const groups = win2.api.findDuplicateTabs();
    assert.equal(groups.length, 1, "only the real dupe group (about: pages ignored)");
    assert.equal(groups[0].spec, "https://dupe.example.com/");
    assert.equal(groups[0].count, 2);
    const dry = win2.api.closeDuplicateTabs({ dryRun: true });
    assert.equal(dry.doomed.length, 1);
    assert.equal(win2.sb.gBrowser.tabs.length, 3, "dry run closes nothing");
    const done = win2.api.closeDuplicateTabs({ dryRun: false });
    assert.equal(done.closed, 1);
    assert.ok(!win2.sb.gBrowser.tabs.some((t) => t.label === "a-copy"), "hidden copy gone");
    assert.ok(win1.sb.gBrowser.tabs.some((t) => t.label === "a"), "visible keeper intact");
    assert.equal(win1.sb.gBrowser.tabs.length, 3);
  });

  it("pull scrubs the adoption ghost but keeps genuine undo entries", () => {
    const w = makeLiveWorld();
    const win1 = w.spawn({
      ws: "2",
      tabs: [
        { label: "a", ws: "2", selected: true, spec: "https://a.example.com/" },
        { label: "b", ws: "3", hidden: true, spec: "https://b.example.com/" },
      ],
    });
    w.seedClosed(win1, "userclosed");
    const win2 = w.spawn({
      ws: "1",
      tabs: [{ label: "home", ws: "1", selected: true, spec: "https://home.example.com/" }],
    });
    win2.api.switchTo("3");
    assert.ok(win2.sb.gBrowser.tabs.some((t) => t.label === "b"), "pulled");
    assert.deepEqual(w.closedOf(win1), ["userclosed"], "ghost scrubbed, undo kept");
  });

  it("merge scrubs adoption ghosts", () => {
    const w = makeLiveWorld();
    w.spawn({
      ws: "2",
      tabs: [{ label: "a", ws: "2", selected: true, spec: "https://a.example.com/" }],
    });
    const win2 = w.spawn({
      ws: "3",
      tabs: [
        { label: "m1", ws: "3", selected: true, spec: "https://m1.example.com/" },
        { label: "m2", ws: "3", hidden: true, spec: "https://m2.example.com/" },
      ],
    });
    w.seedClosed(win2, "userclosed");
    const res = win2.api.mergeTabsIntoSurvivor();
    assert.equal(res.merged, 2);
    assert.deepEqual(w.closedOf(win2), ["userclosed"], "both ghosts scrubbed");
  });

  it("forward scrubs the adoption ghost", () => {
    const w = makeLiveWorld();
    w.spawn({
      ws: "2",
      tabs: [{ label: "home", ws: "2", selected: true, spec: "https://home.example.com/" }],
    });
    const win2 = w.spawn({
      ws: "1",
      tabs: [{ label: "a", ws: "1", selected: true, spec: "https://a.example.com/" }],
    });
    w.seedClosed(win2, "userclosed");
    win2.api.sendTabTo("2", win2.sb.gBrowser.tabs.filter((t) => t.label === "a"));
    assert.deepEqual(w.closedOf(win2), ["userclosed"], "ghost scrubbed");
  });

  it("blank adoptions never eat a genuine undo entry", () => {
    const w = makeLiveWorld();
    const win1 = w.spawn({
      ws: "2",
      tabs: [
        { label: "a", ws: "2", selected: true, spec: "https://a.example.com/" },
        { label: "n", ws: "3", hidden: true, spec: "about:newtab" },
      ],
    });
    w.seedClosed(win1, "userclosed");
    const win2 = w.spawn({
      ws: "1",
      tabs: [{ label: "home", ws: "1", selected: true, spec: "https://home.example.com/" }],
    });
    win2.api.switchTo("3");
    assert.deepEqual(w.closedOf(win1), ["userclosed"], "no ghost existed, nothing scrubbed");
  });
});
