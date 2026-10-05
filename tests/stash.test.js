// Regression guards for the Stash (branding/stash-shared.js +
// branding/stash.js — "Stash" everywhere). Store tests mirror tests/workspaces.test.js: the
// real scripts run in node:vm with Firefox globals mocked.
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { run, makeTab } = require("./helpers");

// ---- shared logic (pure, no mocks needed) ----
const ssb = { window: {}, document: { readyState: "loading" } };
run("stash-shared.js", ssb);
const L = ssb.AphStashLogic;
// deepStrictEqual fails across the node:vm realm boundary (arrays built
// inside the sandbox carry the sandbox Array prototype), so compare the
// serialized form instead.
function assertJsonEqual(actual, expected) {
  assert.equal(JSON.stringify(actual), JSON.stringify(expected));
}


describe("stash urls", () => {
  it("accepts http(s), rejects internal and pseudo URLs", () => {
    assert.ok(L.isArchivableUrl("https://example.com/x"));
    assert.ok(L.isArchivableUrl("http://localhost:3000/"));
    assert.ok(!L.isArchivableUrl("about:newtab"));
    assert.ok(!L.isArchivableUrl("chrome://browser/content/x"));
    assert.ok(!L.isArchivableUrl("data:text/html,hi"));
    assert.ok(!L.isArchivableUrl("ftp://files.example.com/"));
    assert.ok(!L.isArchivableUrl(""));
    assert.ok(!L.isArchivableUrl(null));
  });

  it("extracts lowercase hosts, tolerating garbage", () => {
    assert.equal(L.hostOfUrl("https://GitHub.com/a?b=1"), "github.com");
    assert.equal(L.hostOfUrl("http://example.com./"), "example.com");
    assert.equal(L.hostOfUrl("not a url"), "");
    assert.equal(L.hostOfUrl(""), "");
  });
});

describe("stash sanitize + prune", () => {
  it("keeps valid entries, drops the rest, fills defaults", () => {
    const out = L.sanitizeEntries([
      { id: "a", url: "https://a.example/", title: "A", ws: "2", cid: 7, cname: "Work", ts: 5 },
      { url: "https://noid.example/" },
      { id: "b", url: "about:blank" },
      { id: "c", url: "https://c.example/" },
      null,
      "junk",
    ]);
    assert.equal(out.length, 2);
    assert.equal(out[0].host, "a.example");
    assert.equal(out[0].ws, "2");
    assert.equal(out[1].title, "https://c.example/");
    assert.equal(out[1].ws, "1");
    assert.equal(out[1].cid, 0);
  });

  it("caps newest-first at MAX_ENTRIES", () => {
    assert.equal(L.MAX_ENTRIES, 300);
    const big = Array.from({ length: 305 }, (_, i) => ({
      id: `e${i}`, url: `https://e${i}.example/`, ts: i,
    }));
    const pruned = L.pruneEntries(big);
    assert.equal(pruned.length, 300);
    assert.equal(pruned[0].id, "e0");
    assert.equal(pruned[299].id, "e299");
  });
});

describe("stash dates + filter", () => {
  const now = new Date(2026, 8, 8, 12, 0, 0).getTime(); // Sep 8 2026 noon local
  const H = 3600000;

  it("labels Today / Yesterday / Month day / Month day year", () => {
    assert.equal(L.dayLabel(now, now), "Today");
    assert.equal(L.dayLabel(now - 20 * H, now), "Yesterday");
    assert.equal(L.dayLabel(now - 5 * 24 * H, now), "Sep 3");
    assert.equal(
      L.dayLabel(new Date(2025, 0, 2).getTime(), now),
      "Jan 2, 2025"
    );
  });

  it("groups consecutive same-day runs, newest-first", () => {
    const groups = L.groupByDate(
      [
        { id: "a", ts: now },
        { id: "b", ts: now - H },
        { id: "c", ts: now - 30 * H },
      ],
      now
    );
    assert.equal(groups.length, 2);
    assert.equal(groups[0].label, "Today");
    assertJsonEqual(groups[0].items.map((e) => e.id), ["a", "b"]);
    assert.equal(groups[1].label, "Yesterday");
  });

  it("filters across title, host, workspace and container", () => {
    const entries = [
      { id: "a", title: "GitHub PRs", host: "github.com", url: "https://github.com/x", ws: "2", cname: "Work" },
      { id: "b", title: "Recipe blog", host: "food.example", url: "https://food.example/", ws: "1", cname: "" },
    ];
    const names = { 2: "Work" };
    assertJsonEqual(L.filterEntries(entries, "", names).map((e) => e.id), ["a", "b"]);
    assertJsonEqual(L.filterEntries(entries, "git", names).map((e) => e.id), ["a"]);
    assertJsonEqual(L.filterEntries(entries, "WS 2", names).map((e) => e.id), ["a"]);
    assertJsonEqual(L.filterEntries(entries, "workspace 1", names).map((e) => e.id), ["b"]);
    assertJsonEqual(L.filterEntries(entries, "github work", names).map((e) => e.id), ["a"]);
    assertJsonEqual(L.filterEntries(entries, "github recipe", names).map((e) => e.id), []);
  });
});

// ---- window controller (mocked chrome) ----
const tabVals = new WeakMap();
const prefStore = {};
const obsHandlers = {};
let unloadFn = null;

function makeSandbox() {
  const tabs = [];
  const wsOf = new Map();
  let sel = null;
  let cur = "1";
  const switched = [];
  const opened = [];
  const removedTabs = [];
  const menuHandlers = {};
  const menuKids = [];
  const xulCreated = [];
  const menu = {
    appendChild(el) { menuKids.push(el); },
    addEventListener(t, fn) { menuHandlers[t] = fn; },
    removeEventListener() {},
  };
  const sb = {
    window: {
      opener: null,
      addEventListener(t, fn) { if (t === "unload") unloadFn = fn; },
      AphWorkspaces: {
        getWs: (t) => wsOf.get(t) || "1",
        getCurrent: () => cur,
        switchTo: (w) => { switched.push(w); cur = w; },
        describeContainer: (id) =>
          id === 7 ? { name: "Work", color: "blue", icon: "briefcase" } : null,
        openInWorkspace: (url, w, cid) => {
          opened.push({ url, ws: w, cid });
          const t = makeTab(tabVals, { label: "restored", ws: w, spec: url, cid });
          tabs.push(t);
          wsOf.set(t, w);
          return t;
        },
      },
    },
    document: {
      readyState: "complete",
      getElementById: (id) => (id === "tabContextMenu" ? menu : null),
      createElement: () => ({
        attrs: {},
        setAttribute(k, v) { this.attrs[k] = v; },
        removeAttribute() {},
        classList: { add() {}, remove() {} },
        addEventListener(t, fn) { this[`on_${t}`] = fn; },
      }),
      // browser.xhtml is XHTML: menu items must be XUL elements, never HTML.
      createXULElement: (localName) => {
        xulCreated.push(localName);
        return {
          attrs: {},
          setAttribute(k, v) { this.attrs[k] = v; },
          removeAttribute() {},
          classList: { add() {}, remove() {} },
          addEventListener(t, fn) { this[`on_${t}`] = fn; },
        };
      },
      documentElement: { appendChild() {} },
    },
    gBrowser: {
      tabs,
      get selectedTab() { return sel; },
      set selectedTab(t) { sel = t; },
      selectedTabs: [],
      showTab() {},
      addTrustedTab(url) {
        const t = makeTab(tabVals, { label: "new", ws: "1", spec: url });
        tabs.push(t);
        wsOf.set(t, "1");
        return t;
      },
      removeTab(t) {
        removedTabs.push(t);
        const i = tabs.indexOf(t);
        if (i !== -1) tabs.splice(i, 1);
      },
      ungroupTab() {},
    },
    SessionStore: {
      getCustomTabValue: (t, k) => (tabVals.get(t) || {})[k],
    },
    Services: {
      prefs: {
        getStringPref: (k, d) => (k in prefStore ? prefStore[k] : d),
        setStringPref: (k, v) => { prefStore[k] = v; },
        addObserver() {},
        removeObserver() {},
      },
      obs: {
        addObserver(o, t) { obsHandlers[t] = o; },
        removeObserver(o, t) { delete obsHandlers[t]; },
        notifyObservers() {},
      },
      console: { logStringMessage() {} },
    },
    ChromeUtils: {
      importESModule: () => ({ PrivateBrowsingUtils: { isWindowPrivate: () => false } }),
    },
  };
  sb.window.window = sb.window;
  return { sb, tabs, wsOf, switched, opened, removedTabs, menu, menuHandlers, menuKids, xulCreated,
    setSel: (t) => { sel = t; }, getSel: () => sel, setCur: (w) => { cur = w; } };
}

function loadStash(env) {
  run("stash-shared.js", env.sb);
  env.sb.window.AphStashLogic = env.sb.AphStashLogic;
  run("stash.js", env.sb);
  return env.sb.window.AphStash;
}

function seedEntries(n, tag) {
  const arr = Array.from({ length: n }, (_, i) => ({
    id: `${tag}${i}`, title: `T${i}`, url: `https://${tag}${i}.example/`,
    host: `${tag}${i}.example`, ws: "1", cid: 0, cname: "", favicon: "", ts: i,
  }));
  prefStore["aph.stash.tabs"] = JSON.stringify(arr);
}

describe("stash store", () => {
  it("stashes the current tab with context and closes it", () => {
    delete prefStore["aph.stash.tabs"];
    const env = makeSandbox();
    const api = loadStash(env);
    const t = makeTab(tabVals, { label: "GitHub", ws: "2", spec: "https://github.com/x", cid: 7 });
    env.tabs.push(t);
    env.sb.gBrowser.selectedTabs = [];
    env.setSel(t);
    env.wsOf.set(t, "2");
    assert.equal(api.stashCurrent(), 1);
    const saved = JSON.parse(prefStore["aph.stash.tabs"]);
    assert.equal(saved.length, 1);
    assert.equal(saved[0].title, "GitHub");
    assert.equal(saved[0].host, "github.com");
    assert.equal(saved[0].ws, "2");
    assert.equal(saved[0].cid, 7);
    assert.equal(saved[0].cname, "Work");
    assert.ok(!env.tabs.includes(t));
  });

  it("skips internal pages and closes nothing", () => {
    delete prefStore["aph.stash.tabs"];
    const env = makeSandbox();
    const api = loadStash(env);
    const t = makeTab(tabVals, { label: "n", ws: "1", spec: "about:newtab" });
    env.tabs.push(t);
    env.setSel(t);
    assert.equal(api.stashCurrent(), 0);
    assert.ok(env.tabs.includes(t));
    assert.ok(!("aph.stash.tabs" in prefStore));
  });

  it("enforces the cap newest-first", () => {
    seedEntries(300, "old");
    const env = makeSandbox();
    const api = loadStash(env);
    const t = makeTab(tabVals, { label: "Fresh", ws: "1", spec: "https://fresh.example/" });
    env.tabs.push(t);
    env.setSel(t);
    assert.equal(api.stashCurrent(), 1);
    const saved = JSON.parse(prefStore["aph.stash.tabs"]);
    assert.equal(saved.length, 300);
    assert.equal(saved[0].url, "https://fresh.example/");
  });

  it("stashes a multiselection together", () => {
    delete prefStore["aph.stash.tabs"];
    const env = makeSandbox();
    const api = loadStash(env);
    const a = makeTab(tabVals, { label: "A", ws: "1", spec: "https://a.example/" });
    const b = makeTab(tabVals, { label: "B", ws: "1", spec: "https://b.example/" });
    env.tabs.push(a, b);
    env.sb.gBrowser.selectedTabs = [a, b];
    env.setSel(a);
    assert.equal(api.stashTab(a), 2);
    assert.equal(JSON.parse(prefStore["aph.stash.tabs"]).length, 2);
    assert.equal(env.tabs.length, 0);
  });
});

describe("auto stash sweep", () => {
  function autoEnv(enabled) {
    const env = makeSandbox();
    env.sb.Services.prefs.getBoolPref = (k) =>
      k === "aph.stash.autoEnabled" ? enabled : false;
    return env;
  }

  function hiddenTab(env, o) {
    const t = makeTab(tabVals, Object.assign(
      { label: "bg", ws: "2", spec: "https://bg.example/" }, o || {}
    ));
    env.tabs.push(t);
    env.wsOf.set(t, "2");
    return t;
  }

  it("is off by default: closes nothing without the pref", () => {
    delete prefStore["aph.stash.tabs"];
    const env = makeSandbox(); // no getBoolPref backend at all
    const api = loadStash(env);
    hiddenTab(env);
    assert.equal(api.autoStashSweep(), 0);
    assert.equal(env.tabs.length, 1);
    assert.ok(!("aph.stash.tabs" in prefStore));
  });

  it("is off when the pref is false", () => {
    delete prefStore["aph.stash.tabs"];
    const env = autoEnv(false);
    const api = loadStash(env);
    hiddenTab(env);
    assert.equal(api.autoStashSweep(), 0);
    assert.equal(env.tabs.length, 1);
  });

  it("stashes eligible hidden tabs with context, keeps the rest", () => {
    delete prefStore["aph.stash.tabs"];
    const env = autoEnv(true);
    const api = loadStash(env);
    const good = hiddenTab(env, { label: "good", spec: "https://good.example/page" });
    const cur = makeTab(tabVals, { label: "cur", ws: "1", spec: "https://cur.example/" });
    env.tabs.push(cur); // wsOf defaults to "1" = current
    env.setSel(cur);
    assert.equal(api.autoStashSweep(), 1);
    assert.ok(!env.tabs.includes(good), "eligible hidden tab closed");
    assert.ok(env.tabs.includes(cur), "current-workspace tab kept");
    const saved = JSON.parse(prefStore["aph.stash.tabs"]);
    assert.equal(saved.length, 1);
    assert.equal(saved[0].url, "https://good.example/page");
    assert.equal(saved[0].ws, "2");
  });

  it("never auto-closes guarded tabs", () => {
    delete prefStore["aph.stash.tabs"];
    const env = autoEnv(true);
    const api = loadStash(env);
    const sel = hiddenTab(env, { label: "sel" });
    env.setSel(sel);
    const pin = hiddenTab(env, { label: "pin", pinned: true });
    const star = hiddenTab(env, { label: "star" });
    star.setAttribute("data-aph-starred", "1");
    const snd = hiddenTab(env, { label: "snd", soundPlaying: true });
    const aud = hiddenTab(env, { label: "aud", audible: true });
    const busy = hiddenTab(env, { label: "busy", busy: true });
    const dirty = hiddenTab(env, { label: "dirty", beforeUnload: true });
    const internal = hiddenTab(env, { label: "internal", spec: "about:newtab" });
    assert.equal(api.autoStashSweep(), 0);
    for (const t of [sel, pin, star, snd, aud, busy, dirty, internal]) {
      assert.ok(env.tabs.includes(t), `${t.label} survives`);
    }
    assert.ok(!("aph.stash.tabs" in prefStore));
  });

  it("never auto-closes restoring or pending tabs mid-restore", () => {
    delete prefStore["aph.stash.tabs"];
    const env = autoEnv(true);
    // SessionStore-owned tabs have unsettled tags (getWs defaults tagless
    // to "1"): without the guard the sweep absorbs other workspaces' pages.
    env.sb.SessionStore.isTabRestoring = (t) => t === env._restoring;
    const api = loadStash(env);
    const restoring = hiddenTab(env, { label: "restoring", spec: "https://restoring.example/" });
    env._restoring = restoring;
    const pending = hiddenTab(env, { label: "pending", spec: "https://pending.example/" });
    pending.setAttribute("pending", "");
    assert.equal(api.autoStashSweep(), 0);
    assert.ok(env.tabs.includes(restoring), "restoring survives");
    assert.ok(env.tabs.includes(pending), "pending survives");
    assert.ok(!("aph.stash.tabs" in prefStore));
  });

  it("fails closed without the workspaces API", () => {
    delete prefStore["aph.stash.tabs"];
    const env = autoEnv(true);
    delete env.sb.window.AphWorkspaces;
    const api = loadStash(env);
    hiddenTab(env);
    assert.equal(api.autoStashSweep(), 0);
    assert.equal(env.tabs.length, 1);
  });

  // ---- settle timer (the time-based foundation) ----
  // Installed AFTER loadStash: run() stamps default timer mocks at load.
  function armTimers(env) {
    const armed = [];
    const cleared = [];
    let nextId = 1;
    env.sb.setTimeout = (fn, ms) => {
      const id = nextId++;
      armed.push({ id, fn, ms });
      return id;
    };
    env.sb.clearTimeout = (id) => { cleared.push(id); };
    return { armed, cleared };
  }

  it("arms a 15s settle timer; firing it sweeps", () => {
    delete prefStore["aph.stash.tabs"];
    const env = autoEnv(true);
    const api = loadStash(env);
    const { armed } = armTimers(env);
    const good = hiddenTab(env, { label: "good", spec: "https://good.example/page" });
    const cur = makeTab(tabVals, { label: "cur", ws: "1", spec: "https://cur.example/" });
    env.tabs.push(cur);
    env.setSel(cur);
    assert.equal(api.scheduleAutoStashSweep(), true);
    assert.equal(armed.length, 1);
    assert.equal(armed[0].ms, 15000);
    assert.ok(env.tabs.includes(good), "nothing stashed before the timer fires");
    armed[0].fn();
    assert.ok(!env.tabs.includes(good), "timer fire sweeps");
    assert.equal(JSON.parse(prefStore["aph.stash.tabs"]).length, 1);
  });

  it("re-arming clears the previous timer so only one sweep is pending", () => {
    delete prefStore["aph.stash.tabs"];
    const env = autoEnv(true);
    const api = loadStash(env);
    const { armed, cleared } = armTimers(env);
    hiddenTab(env);
    assert.equal(api.scheduleAutoStashSweep(), true);
    assert.equal(api.scheduleAutoStashSweep(), true);
    assert.equal(armed.length, 2);
    assertJsonEqual(cleared, [armed[0].id]);
    armed[1].fn();
    assert.equal(JSON.parse(prefStore["aph.stash.tabs"]).length, 1);
  });

  it("scheduling while disabled arms nothing and disarms pending", () => {
    delete prefStore["aph.stash.tabs"];
    const env = autoEnv(true);
    const api = loadStash(env);
    const { armed, cleared } = armTimers(env);
    hiddenTab(env);
    assert.equal(api.scheduleAutoStashSweep(), true);
    // Flip the pref off, then schedule again: pending timer dies, none armed.
    env.sb.Services.prefs.getBoolPref = () => false;
    assert.equal(api.scheduleAutoStashSweep(), false);
    assertJsonEqual(cleared, [armed[0].id]);
    assert.equal(armed.length, 1);
  });

  it("a stale timer never closes a tab you came back to", () => {
    delete prefStore["aph.stash.tabs"];
    const env = autoEnv(true);
    const api = loadStash(env);
    const { armed } = armTimers(env);
    const t = hiddenTab(env, { label: "back" });
    assert.equal(api.scheduleAutoStashSweep(), true);
    env.setCur("2"); // came back before the timer fired
    env.setSel(t);
    armed[0].fn();
    assert.ok(env.tabs.includes(t), "returned-to tab survives");
    assert.ok(!("aph.stash.tabs" in prefStore));
  });

  it("unload disarms a pending sweep", () => {
    delete prefStore["aph.stash.tabs"];
    const env = autoEnv(true);
    const api = loadStash(env);
    const { armed, cleared } = armTimers(env);
    hiddenTab(env);
    assert.equal(api.scheduleAutoStashSweep(), true);
    assert.ok(typeof unloadFn === "function");
    unloadFn();
    assertJsonEqual(cleared, [armed[0].id]);
  });

  // ---- staleness (last-viewed threshold) ----
  const MIN = 60000;

  function stampViewed(t, ageMs) {
    tabVals.get(t).aphLastViewed = String(Date.now() - ageMs);
  }

  function staleEnv(staleMin) {
    const env = autoEnv(true);
    if (staleMin !== undefined) {
      env.sb.Services.prefs.getIntPref = (k) =>
        k === "aph.stash.autoStaleMin" ? staleMin : 5;
    }
    return env;
  }

  it("spares tabs viewed within the threshold", () => {
    delete prefStore["aph.stash.tabs"];
    const env = staleEnv();
    const api = loadStash(env);
    const fresh = hiddenTab(env, { label: "fresh" });
    stampViewed(fresh, 1 * MIN);
    assert.equal(api.autoStashSweep(), 0);
    assert.ok(env.tabs.includes(fresh));
    assert.ok(!("aph.stash.tabs" in prefStore));
  });

  it("stashes tabs viewed beyond the threshold", () => {
    delete prefStore["aph.stash.tabs"];
    const env = staleEnv();
    const api = loadStash(env);
    const old = hiddenTab(env, { label: "old", spec: "https://old.example/" });
    stampViewed(old, 10 * MIN);
    assert.equal(api.autoStashSweep(), 1);
    assert.ok(!env.tabs.includes(old));
  });

  it("treats missing and malformed stamps as stale", () => {
    delete prefStore["aph.stash.tabs"];
    const env = staleEnv();
    const api = loadStash(env);
    const missing = hiddenTab(env, { label: "missing", spec: "https://m.example/" });
    const junk = hiddenTab(env, { label: "junk", spec: "https://j.example/" });
    tabVals.get(junk).aphLastViewed = "not-a-time";
    assert.equal(api.autoStashSweep(), 2);
    assert.ok(!env.tabs.includes(missing) && !env.tabs.includes(junk));
  });

  it("honors a custom threshold read live", () => {
    delete prefStore["aph.stash.tabs"];
    const env = staleEnv(60);
    const api = loadStash(env);
    const t = hiddenTab(env, { label: "hour", spec: "https://hour.example/" });
    stampViewed(t, 10 * MIN);
    assert.equal(api.autoStashSweep(), 0, "10 min < 60 min threshold");
    stampViewed(t, 70 * MIN);
    assert.equal(api.autoStashSweep(), 1, "70 min > 60 min threshold");
  });
});

describe("stash restore + delete", () => {
  it("restores with workspace + container, removes the entry, switches", () => {
    seedEntries(0);
    prefStore["aph.stash.tabs"] = JSON.stringify([{
      id: "r1", title: "PR", url: "https://github.com/pr", host: "github.com",
      ws: "2", cid: 7, cname: "Work", favicon: "", ts: 1,
    }]);
    const env = makeSandbox();
    const api = loadStash(env);
    const r = api.restoreStashEntry("r1", {});
    assert.equal(r.ok, true);
    assertJsonEqual(env.opened[0], { url: "https://github.com/pr", ws: "2", cid: 7 });
    assertJsonEqual(env.switched, ["2"]);
    assert.equal(api.getStashEntries().length, 0);
    assert.equal(env.getSel().label, "restored");
  });

  it("falls back to unbound when the container is gone, keeps with Shift", () => {
    prefStore["aph.stash.tabs"] = JSON.stringify([{
      id: "r2", title: "Old", url: "https://old.example/", host: "old.example",
      ws: "1", cid: 99, cname: "Gone", favicon: "", ts: 1,
    }]);
    const env = makeSandbox();
    const api = loadStash(env);
    const r = api.restoreStashEntry("r2", { keep: true });
    assert.equal(r.ok, true);
    assert.equal(env.opened[0].cid, 0);
    assert.equal(api.getStashEntries().length, 1);
  });

  it("reports missing ids and deletes explicitly", () => {
    seedEntries(1, "k");
    const env = makeSandbox();
    const api = loadStash(env);
    assert.equal(api.restoreStashEntry("nope", {}).ok, false);
    assert.equal(api.deleteStashEntry("nope"), false);
    assert.equal(api.deleteStashEntry("k0"), true);
    assert.equal(api.getStashEntries().length, 0);
  });

  it("routes page restore requests only to the owning window", () => {
    seedEntries(0);
    prefStore["aph.stash.tabs"] = JSON.stringify([{
      id: "r3", title: "P", url: "https://p.example/", host: "p.example",
      ws: "1", cid: 0, cname: "", favicon: "", ts: 1,
    }]);
    const env = makeSandbox();
    const api = loadStash(env);
    const t = makeTab(tabVals, { label: "stash", ws: "1", spec: "chrome://browser/content/aph-stash.html" });
    t.linkedBrowser.browsingContext = { id: 4242 };
    env.tabs.push(t);
    const h = obsHandlers["aph-stash-restore"];
    assert.ok(h);
    h.observe(null, "aph-stash-restore", JSON.stringify({ contextId: 1111, id: "r3" }));
    assert.equal(api.getStashEntries().length, 1); // stranger's request ignored
    h.observe(null, "aph-stash-restore", JSON.stringify({ contextId: 4242, id: "r3" }));
    assert.equal(api.getStashEntries().length, 0); // owner restored + removed
    assert.equal(env.opened[0].url, "https://p.example/");
  });

  it("routes single-tab snapshot restores without consuming the snapshot", () => {
    delete prefStore["aph.stash.snapshots"];
    prefStore["aph.stash.snapshots"] = JSON.stringify([{
      id: "s9", name: "Sprint", ws: "2", ts: 1, auto: false,
      tabs: [{ title: "a", url: "https://a.example/", cid: 0 }],
    }]);
    const env = makeSandbox();
    const api = loadStash(env);
    const t = makeTab(tabVals, { label: "stash", ws: "1", spec: "chrome://browser/content/aph-stash.html" });
    t.linkedBrowser.browsingContext = { id: 4242 };
    env.tabs.push(t);
    const h = obsHandlers["aph-stash-restore"];
    assert.ok(h);
    const notified = [];
    env.sb.Services.obs.notifyObservers = (s, topic, data) => notified.push(JSON.parse(data));
    h.observe(null, "aph-stash-restore", JSON.stringify({ contextId: 4242, id: "s9", kind: "stash-tab", url: "https://a.example/" }));
    assert.equal(env.opened[env.opened.length - 1].url, "https://a.example/");
    assert.equal(api.listStashes().length, 1, "snapshot kept");
    assert.equal(notified[notified.length - 1].kind, "stash-tab");
    assert.equal(notified[notified.length - 1].ok, true);
    delete prefStore["aph.stash.snapshots"];
  });

  it("routes snapshot updates and reports the new count", () => {
    delete prefStore["aph.stash.snapshots"];
    prefStore["aph.stash.snapshots"] = JSON.stringify([{
      id: "s8", name: "Sprint", ws: "2", ts: 1, auto: false,
      tabs: [{ title: "a", url: "https://a.example/", cid: 0 }],
    }]);
    const env = makeSandbox();
    const api = loadStash(env);
    for (const [label, spec] of [["a", "https://a.example/"], ["b", "https://b.example/"]]) {
      const live = makeTab(tabVals, { label, ws: "2", spec });
      env.tabs.push(live);
      env.wsOf.set(live, "2");
    }
    const t = makeTab(tabVals, { label: "stash", ws: "1", spec: "chrome://browser/content/aph-stash.html" });
    t.linkedBrowser.browsingContext = { id: 4242 };
    env.tabs.push(t);
    const h = obsHandlers["aph-stash-restore"];
    const notified = [];
    env.sb.Services.obs.notifyObservers = (s, topic, data) => notified.push(JSON.parse(data));
    h.observe(null, "aph-stash-restore", JSON.stringify({ contextId: 4242, id: "s8", kind: "stash-update" }));
    assert.equal(api.listStashes().find((s) => s.id === "s8").tabs.length, 2);
    assert.equal(notified[notified.length - 1].kind, "stash-update");
    assert.equal(notified[notified.length - 1].count, 2);
    delete prefStore["aph.stash.snapshots"];
  });

  it("opens the stash once per window", () => {
    delete prefStore["aph.stash.tabs"];
    const env = makeSandbox();
    const api = loadStash(env);
    assert.equal(api.openStash(), true);
    assert.equal(env.tabs.length, 1);
    assert.equal(env.getSel(), env.tabs[0]);
    assert.equal(api.openStash(), true);
    assert.equal(env.tabs.length, 1); // reused, not duplicated
  });

  it("cleans up observers on unload", () => {
    delete prefStore["aph.stash.tabs"];
    const env = makeSandbox();
    const seen = [];
    env.sb.Services.prefs.removeObserver = () => seen.push("prefs");
    env.sb.Services.obs.removeObserver = () => seen.push("obs");
    loadStash(env);
    assert.ok(typeof unloadFn === "function");
    unloadFn();
    assert.ok(seen.includes("prefs") && seen.includes("obs"));
  });
});

describe("stash context menu", () => {
  it("offers Stash Tab for the right-clicked tab and stashes on command", () => {
    delete prefStore["aph.stash.tabs"];
    const env = makeSandbox();
    const api = loadStash(env);
    const t = makeTab(tabVals, { label: "Ctx", ws: "3", spec: "https://ctx.example/" });
    env.tabs.push(t);
    env.wsOf.set(t, "3");
    env.setSel(t);
    const show = env.menuHandlers["popupshowing"];
    assert.ok(show);
    const node = { closest: (s) => (s === "tab" ? t : null) };
    show({ currentTarget: env.menu, target: { triggerNode: node } });
    assertJsonEqual(env.xulCreated, ["menuitem"]);
    assert.equal(env.menuKids.length, 1);
    const item = env.menuKids[0];
    assert.equal(item.attrs.label, "Stash Tab");
    item[`on_command`]();
    assert.equal(JSON.parse(prefStore["aph.stash.tabs"])[0].ws, "3");
    void api;
  });

  it("resolves the tab from triggerNode.tab as stock does", () => {
    delete prefStore["aph.stash.tabs"];
    const env = makeSandbox();
    loadStash(env);
    const t = makeTab(tabVals, { label: "Direct", ws: "1", spec: "https://direct.example/" });
    env.tabs.push(t);
    env.setSel(t);
    env.menuHandlers["popupshowing"]({ currentTarget: env.menu, target: { triggerNode: { tab: t } } });
    assert.equal(env.menuKids.length, 1);
    assert.equal(env.menuKids[0].attrs.label, "Stash Tab");
  });
});

// ---- palette integration ----
describe("stash palette commands", () => {
  const psb = {
    window: {
      addEventListener() {},
      AphWorkspaces: {
        getCurrent: () => "1", getWsName: () => "", getRoutes: () => ({}),
        getWsContainer: () => 0, describeContainer: () => null, getWs: () => "1",
      },
      AphStash: {
        calls: [],
        pendingStashCount: () => 2,
        stashCurrent() { this.calls.push("stash"); },
        openStash() { this.calls.push("open"); return true; },
        saveStash() { this.calls.push("save"); return 3; },
        listStashes() {
          return [
            { id: "s1", name: "Sprint", ws: "2", ts: 1, auto: false,
              tabs: [{ title: "a", url: "https://a.example/", cid: 0 },
                     { title: "b", url: "https://b.example/", cid: 0 },
                     { title: "c", url: "https://c.example/", cid: 0 }] },
            { id: "s2", name: "Reading", ws: "4", ts: 2, auto: true,
              tabs: [{ title: "d", url: "https://d.example/", cid: 0 }] },
          ];
        },
        restoreStash(id) { this.calls.push(`restore:${id}`); return { ok: true }; },
      },
    },
    document: { readyState: "loading" },
    gBrowser: { tabs: [], selectedTab: null, addTrustedTab() { throw new Error("unused"); } },
    SessionStore: {},
  };
  run(
    "command-palette.js",
    psb,
    'window.addEventListener("keydown", onKey, true);',
    "window.__aphTest = { allItems };"
  );
  const T = psb.window.__aphTest;

  it("lists Stash commands with a multiselect-aware title", () => {
    const rows = T.allItems("stash");
    const titles = rows.map((r) => r.title);
    assert.ok(titles.includes("Stash 2 Tabs"), titles.join(" | "));
    assert.ok(titles.includes("Stash Current Workspace…"), titles.join(" | "));
    assert.ok(titles.includes("Open Stash"), titles.join(" | "));
  });

  it("routes runs through the stash controller", () => {
    const rows = T.allItems("stash");
    rows.find((r) => r.title === "Open Stash").run();
    rows.find((r) => r.title.startsWith("Stash ")).run();
    rows.find((r) => r.title === "Stash Current Workspace…").run();
    assertJsonEqual(psb.window.AphStash.calls, ["open", "stash", "save"]);
  });

  // Fuzzy matching is per-word: "restore stash" does not reach "Restore
  // Sprint" (no "stash" token in it), so search by the stash name.
  it("lists one restore row per saved workspace stash", () => {
    const rows = T.allItems("restore sprint");
    const row = rows.find((r) => r.title === "Restore Sprint");
    assert.ok(row, rows.map((r) => r.title).join(" | "));
    assert.ok(row.sub.includes("WS 2"), row.sub);
    assert.ok(row.sub.includes("3 tabs"), row.sub);
    assert.ok(row.sub.includes("alongside"), row.sub);
    row.run();
    assertJsonEqual(psb.window.AphStash.calls, ["open", "stash", "save", "restore:s1"]);
  });

  it("finds restore rows by member site, not just the stash name", () => {
    const rows = T.allItems("b.example");
    const row = rows.find((r) => r.title === "Restore Sprint");
    assert.ok(row, rows.map((r) => r.title).join(" | "));
    assert.ok(row.sub.includes("b.example"), row.sub);
  });

  it("counts the stash contents on the Open Stash row", () => {
    const row = T.allItems("open stash").find((r) => r.title === "Open Stash");
    assert.ok(row);
    assert.ok(row.sub.includes("2 workspace stashes"), row.sub);
  });

  it("restore rows stay out of the empty-query home", () => {
    assert.ok(!T.allItems("").some((r) => r.title.startsWith("Restore Sprint")),
      "empty query must stay curated");
  });
});

// ---- workspace stashes (snapshots) -------------------------------------
describe("stash snapshots", () => {
  function snapSandbox(opts) {
    const o = opts || {};
    const env = makeSandbox();
    if (o.auto !== undefined) {
      env.sb.Services.prefs.getBoolPref = (k, d) =>
        k === "aph.stash.snapshots.autoEnabled" ? o.auto : (d !== undefined ? d : false);
    }
    const api = loadStash(env);
    return { env, api };
  }

  function liveTab(env, o) {
    const t = makeTab(tabVals, Object.assign(
      { label: "t", ws: "1", spec: "https://example.com/" }, o || {}
    ));
    env.tabs.push(t);
    env.wsOf.set(t, (o && o.ws) || "1");
    return t;
  }

  it("saveStash captures the workspace, keeping pins and internal pages out", () => {
    delete prefStore["aph.stash.snapshots"];
    const { env, api } = snapSandbox();
    liveTab(env, { label: "one", ws: "2", spec: "https://one.example/" });
    liveTab(env, { label: "two", ws: "2", spec: "https://two.example/", cid: 7 });
    const pin = liveTab(env, { label: "pin", ws: "2", pinned: true, spec: "https://pin.example/" });
    const sel = liveTab(env, { label: "sel", ws: "1" });
    env.setSel(sel);
    env.setCur("2");
    assert.equal(api.saveStash("Sprint", "2"), 2, "pins excluded, internal pages not counted");
    const snaps = JSON.parse(prefStore["aph.stash.snapshots"]);
    assert.equal(snaps.length, 1);
    assert.equal(snaps[0].name, "Sprint");
    assert.equal(snaps[0].ws, "2");
    assert.equal(snaps[0].auto, false);
    assert.deepEqual(snaps[0].tabs.map((t) => t.url).sort(),
      ["https://one.example/", "https://two.example/"]);
    // Pinned tab in the source window is untouched: capture never closes.
    assert.ok(env.tabs.includes(pin), "capture must never close tabs");
  });

  it("saveStash with nothing stashable stores nothing", () => {
    delete prefStore["aph.stash.snapshots"];
    const { env, api } = snapSandbox();
    const sel = liveTab(env, { label: "newtab", ws: "1", spec: "about:newtab" });
    env.setSel(sel);
    assert.equal(api.saveStash("empty", "1"), 0);
    assert.ok(!("aph.stash.snapshots" in prefStore));
  });

  it("default name carries the workspace and a timestamp", () => {
    delete prefStore["aph.stash.snapshots"];
    const { env, api } = snapSandbox();
    liveTab(env, { label: "x", ws: "3", spec: "https://x.example/" });
    api.saveStash(null, "3");
    const snaps = JSON.parse(prefStore["aph.stash.snapshots"]);
    assert.ok(snaps[0].name.includes("WS 3"), snaps[0].name);
    assert.ok(/\d/.test(snaps[0].name), snaps[0].name);
  });

  it("restoreStash appends and never closes", () => {
    const { env, api } = snapSandbox();
    liveTab(env, { label: "keep", ws: "1", spec: "https://keep.example/" });
    const doomed = liveTab(env, { label: "one", ws: "2", spec: "https://one.example/" });
    api.saveStash("Sprint", "2");
    // The workspace was closed after the capture (the undo flow): the
    // URL is no longer open, so the restore appends it back.
    env.tabs.splice(env.tabs.indexOf(doomed), 1);
    const before = env.tabs.length;
    env.setCur("1");
    const snap = JSON.parse(prefStore["aph.stash.snapshots"])[0];
    const r = api.restoreStash(snap.id);
    assert.equal(r.ok, true);
    assert.equal(r.opened, 1, "one tab in the snapshot");
    assert.equal(r.skipped, 0);
    assert.equal(env.tabs.length, before + 1, "appended, nothing removed");
    assert.equal(env.switched[env.switched.length - 1], "2", "lands on the snapshot workspace");
    assert.ok(env.removedTabs.length === 0, "restore closes nothing");
  });

  it("restoreStash skips URLs already open instead of duplicating", () => {
    const { env, api } = snapSandbox();
    liveTab(env, { label: "one", ws: "2", spec: "https://one.example/" });
    api.saveStash("Sprint", "2");
    const snap = JSON.parse(prefStore["aph.stash.snapshots"])[0];
    const before = env.tabs.length;
    const r = api.restoreStash(snap.id);
    assert.equal(r.ok, true);
    assert.equal(r.opened, 0, "nothing new to open");
    assert.equal(r.skipped, 1, "already-open URL counted, not duplicated");
    assert.equal(env.tabs.length, before, "no duplicate tab");
  });

  it("restoreStash survives a missing id", () => {
    const { api } = snapSandbox();
    const r = api.restoreStash("nope");
    assert.equal(r.ok, false);
    assert.equal(r.reason, "missing");
  });

  it("restoreStash keeps a live container and falls back for a gone one", () => {
    const { env, api } = snapSandbox();
    const work = liveTab(env, { label: "work", ws: "2", spec: "https://work.example/", cid: 7 });
    const gone = liveTab(env, { label: "gone", ws: "2", spec: "https://gone.example/", cid: 999 });
    api.saveStash("Sprint", "2");
    const snap = JSON.parse(prefStore["aph.stash.snapshots"])[0];
    // Close the source tabs first: restoring onto open copies would
    // duplicate-skip them and hide the container assertions below.
    for (const t of [work, gone]) {
      env.tabs.splice(env.tabs.indexOf(t), 1);
    }
    env.opened.length = 0;
    const r = api.restoreStash(snap.id);
    assert.equal(r.ok, true);
    assert.equal(r.opened, 2);
    assert.equal(r.unbound, 1, "gone container counted");
    const byUrl = Object.fromEntries(env.opened.map((o) => [o.url, o.cid]));
    assert.equal(byUrl["https://work.example/"], 7, "existing container preserved");
    assert.equal(byUrl["https://gone.example/"], 0, "gone container falls back to default");
  });

  it("restoreStashTab opens one tab and leaves the snapshot alone", () => {
    const { env, api } = snapSandbox();
    const a = liveTab(env, { label: "a", ws: "2", spec: "https://a.example/" });
    const b = liveTab(env, { label: "b", ws: "2", spec: "https://b.example/" });
    api.saveStash("Sprint", "2");
    const snap = JSON.parse(prefStore["aph.stash.snapshots"])[0];
    for (const t of [a, b]) {
      env.tabs.splice(env.tabs.indexOf(t), 1);
    }
    env.setCur("1");
    const before = env.tabs.length;
    const r = api.restoreStashTab(snap.id, "https://b.example/");
    assert.equal(r.ok, true);
    assert.equal(env.tabs.length, before + 1, "only one tab opened");
    assert.equal(env.opened[env.opened.length - 1].url, "https://b.example/");
    assert.equal(env.switched[env.switched.length - 1], "2");
    assert.ok(api.listStashes().some((s) => s.id === snap.id), "snapshot kept");
    assert.equal(api.restoreStashTab(snap.id, "https://nope.example/").ok, false);
    assert.equal(api.restoreStashTab("nope", "https://b.example/").ok, false);
  });

  it("confirmBulkClose offers undo once, then goes quiet", () => {
    delete prefStore["aph.stash.snapshots"];
    const { env, api } = snapSandbox({ auto: true });
    const doomed = [
      liveTab(env, { label: "a", ws: "2", spec: "https://a.example/" }),
      liveTab(env, { label: "b", ws: "2", spec: "https://b.example/" }),
      liveTab(env, { label: "c", ws: "2", spec: "https://c.example/" }),
    ];
    assert.equal(api.autoStashTabs(doomed, "Before closing WS 2"), 3);
    // Tabs are gone (the close landed); undo restores them.
    for (const t of doomed) {
      env.tabs.splice(env.tabs.indexOf(t), 1);
    }
    const before = env.tabs.length;
    assert.equal(api.confirmBulkClose("2", 3), true, "undo offered");
    const u = api.undoSafetyStash();
    assert.equal(u.ok, true);
    assert.equal(env.tabs.length, before + 3, "undo appends the stash back");
    assert.equal(api.undoSafetyStash().ok, false, "undo is one-shot");
    assert.equal(api.confirmBulkClose("2", 3), false, "one-shot offer");
  });

  it("confirmBulkClose stays silent with no safety net", () => {
    const { api } = snapSandbox({ auto: true });
    assert.equal(api.confirmBulkClose("2", 0), false);
  });

  it("renameStash renames in place and rejects blanks and misses", () => {
    delete prefStore["aph.stash.snapshots"];
    const { env, api } = snapSandbox();
    liveTab(env, { label: "one", ws: "2", spec: "https://one.example/" });
    api.saveStash("Sprint", "2");
    const snap = JSON.parse(prefStore["aph.stash.snapshots"])[0];
    assert.equal(api.renameStash(snap.id, "  Q4 review  "), true);
    const after = api.listStashes().find((s) => s.id === snap.id);
    assert.equal(after.name, "Q4 review");
    assert.equal(after.tabs.length, 1, "tabs untouched");
    assert.equal(api.renameStash(snap.id, "Q4 review"), false, "unchanged");
    assert.equal(api.renameStash(snap.id, "   "), false, "blank rejected");
    assert.equal(api.listStashes().find((s) => s.id === snap.id).name, "Q4 review");
    assert.equal(api.renameStash("nope", "X"), false);
    delete prefStore["aph.stash.snapshots"];
  });

  it("deleteStash removes by id and reports misses", () => {
    delete prefStore["aph.stash.snapshots"];
    const { env, api } = snapSandbox();
    liveTab(env, { label: "one", ws: "2", spec: "https://one.example/" });
    api.saveStash("Sprint", "2");
    const snap = JSON.parse(prefStore["aph.stash.snapshots"])[0];
    assert.equal(api.deleteStash(snap.id), true);
    assert.equal(JSON.parse(prefStore["aph.stash.snapshots"]).length, 0);
    assert.equal(api.deleteStash(snap.id), false);
  });

  it("autoStashTabs captures the doomed tabs as an auto stash", () => {
    delete prefStore["aph.stash.snapshots"];
    const { env, api } = snapSandbox({ auto: true });
    const doomed = [
      liveTab(env, { label: "a", ws: "2", spec: "https://a.example/" }),
      liveTab(env, { label: "b", ws: "2", spec: "https://b.example/" }),
    ];
    assert.equal(api.autoStashTabs(doomed, "Before closing WS 2"), 2);
    const snaps = JSON.parse(prefStore["aph.stash.snapshots"]);
    assert.equal(snaps.length, 1);
    assert.equal(snaps[0].auto, true);
    assert.equal(snaps[0].name, "Before closing WS 2");
    assert.equal(snaps[0].ws, "2", "workspace read off the doomed tabs");
    assert.equal(env.tabs.length, 2, "capture does not close");
  });

  it("autoStashTabs obeys the pref", () => {
    delete prefStore["aph.stash.snapshots"];
    const { env, api } = snapSandbox({ auto: false });
    const doomed = [liveTab(env, { label: "a", ws: "2", spec: "https://a.example/" })];
    assert.equal(api.autoStashTabs(doomed, "nope"), 0);
    assert.ok(!("aph.stash.snapshots" in prefStore));
  });

  it("periodic sweep captures once, then skips an unchanged workspace", () => {
    delete prefStore["aph.stash.snapshots"];
    const { env, api } = snapSandbox({ auto: true });
    const sel = liveTab(env, { label: "one", ws: "2", spec: "https://one.example/" });
    env.setSel(sel);
    env.setCur("2");
    assert.equal(api.autoStashSweepNow(), 1, "first sweep captures");
    assert.equal(api.autoStashSweepNow(), 0, "unchanged set is skipped");
    liveTab(env, { label: "two", ws: "2", spec: "https://two.example/" });
    assert.equal(api.autoStashSweepNow(), 1, "a new tab is a change");
    assert.equal(JSON.parse(prefStore["aph.stash.snapshots"]).length, 2);
  });

  it("periodic sweep respects the pref and skips an empty workspace", () => {
    delete prefStore["aph.stash.snapshots"];
    const off = snapSandbox({ auto: false });
    const sel = liveTab(off.env, { label: "one", ws: "1", spec: "https://one.example/" });
    off.env.setSel(sel);
    assert.equal(off.api.autoStashSweepNow(), 0);
    assert.ok(!("aph.stash.snapshots" in prefStore));

    const on = snapSandbox({ auto: true });
    const sel2 = liveTab(on.env, { label: "newtab", ws: "1", spec: "about:newtab" });
    on.env.setSel(sel2);
    assert.equal(on.api.autoStashSweepNow(), 0, "nothing stashable in the workspace");
  });

  it("safetyThreshold reads the pref with a default", () => {
    const plain = snapSandbox();
    assert.equal(plain.api.safetyThreshold(), 3, "absent pref reads the default");
    const { env, api } = snapSandbox();
    env.sb.Services.prefs.getIntPref = (k) =>
      k === "aph.stash.safetyMin" ? 5 : 3;
    assert.equal(api.safetyThreshold(), 5);
    env.sb.Services.prefs.getIntPref = () => 99;
    assert.equal(api.safetyThreshold(), 9, "clamped to the max");
  });

  it("tick captures idle workspaces too, each due-gated", () => {
    delete prefStore["aph.stash.snapshots"];
    const { env, api } = snapSandbox({ auto: true });
    env.sb.window.AphWorkspaces.getActiveWorkspaces = () => ["1", "2"];
    liveTab(env, { label: "one", ws: "1", spec: "https://one.example/" });
    liveTab(env, { label: "two", ws: "2", spec: "https://two.example/" });
    env.setCur("1");
    assert.equal(api.autoStashTick(), 2, "current + idle both captured");
    assert.equal(api.autoStashTick(), 0, "fresh captures are not due again");
    assert.equal(JSON.parse(prefStore["aph.stash.snapshots"]).length, 2);
  });

  it("quit capture ignores cadence but still needs a change", () => {
    delete prefStore["aph.stash.snapshots"];
    const { env, api } = snapSandbox({ auto: true });
    env.sb.window.AphWorkspaces.getActiveWorkspaces = () => ["1", "2"];
    liveTab(env, { label: "one", ws: "1", spec: "https://one.example/" });
    liveTab(env, { label: "two", ws: "2", spec: "https://two.example/" });
    env.setCur("1");
    assert.equal(api.autoStashTick(), 2);
    liveTab(env, { label: "three", ws: "2", spec: "https://three.example/" });
    assert.equal(api.captureChangedWorkspaces(), 1, "only the changed workspace");
    assert.equal(api.captureChangedWorkspaces(), 0, "quiet when nothing moved");
  });

  it("updateStash re-captures into the same entry", () => {
    delete prefStore["aph.stash.snapshots"];
    const { env, api } = snapSandbox();
    const a = liveTab(env, { label: "a", ws: "2", spec: "https://a.example/" });
    api.saveStash("Sprint", "2");
    const snap = JSON.parse(prefStore["aph.stash.snapshots"])[0];
    liveTab(env, { label: "b", ws: "2", spec: "https://b.example/" });
    const r = api.updateStash(snap.id);
    assert.equal(r.ok, true);
    assert.equal(r.count, 2);
    const after = api.listStashes().find((s) => s.id === snap.id);
    assert.equal(after.name, "Sprint", "name kept");
    assert.equal(after.tabs.length, 2, "tabs refreshed");
    assert.equal(env.removedTabs.length, 0, "update closes nothing");
    for (const t of env.tabs.slice()) {
      if (env.wsOf.get(t) === "2") {
        env.tabs.splice(env.tabs.indexOf(t), 1);
      }
    }
    assert.equal(api.updateStash(snap.id).reason, "empty", "bare workspace refuses");
    assert.equal(api.updateStash("nope").reason, "missing");
    delete prefStore["aph.stash.snapshots"];
  });
});

describe("stash snapshot sanitizing + capping", () => {
  it("keeps well-formed snapshots and drops the rest", () => {
    const out = L.sanitizeSnapshots([
      { id: "s1", name: "Sprint", ws: "3", ts: 5, auto: false,
        tabs: [{ title: "A", url: "https://a.example/", cid: 7 },
               { title: "dup", url: "https://a.example/", cid: 0 },
               { url: "about:newtab" },
               { url: "" }] },
      { id: "s2", name: "  ", ws: "9", ts: 6, tabs: [{ url: "https://b.example/" }] },
      { id: "", tabs: [{ url: "https://c.example/" }] },
      { id: "s4", name: "empty", tabs: [] },
      null,
      "junk",
    ]);
    assert.equal(out.length, 2);
    assert.equal(out[0].tabs.length, 1, "duplicate urls collapse");
    assert.equal(out[0].ws, "3");
    assert.equal(out[0].tabs[0].cid, 7);
    assert.equal(out[1].name, "Snapshot", "blank name falls back");
    assert.equal(out[1].tabs[0].title, "https://b.example/", "missing title falls back to url");
    assert.equal(out[1].ws, "9");
  });

  it("prunes auto before manual so manual stashes survive", () => {
    const many = (n, auto) =>
      Array.from({ length: n }, (_, i) => ({
        id: `${auto ? "a" : "m"}${i}`, name: `${auto ? "A" : "M"}${i}`,
        ws: "1", ts: i + 1, auto,
        tabs: [{ url: `https://${auto ? "a" : "m"}${i}.example/` }],
      }));
    const out = L.pruneSnapshots([...many(25, false), ...many(12, true)]);
    const auto = out.filter((s) => s.auto);
    const manual = out.filter((s) => !s.auto);
    assert.equal(manual.length, L.SNAP_MAX_MANUAL, "manual capped");
    assert.equal(auto.length, L.SNAP_MAX_AUTO, "auto capped separately");
    // Auto prunes first: the newest autos and the newest manuals survive.
    assert.ok(auto.every((s) => Number(s.id.slice(1)) >= 12 - L.SNAP_MAX_AUTO),
      "oldest autos dropped first");
    assert.ok(manual.every((s) => Number(s.id.slice(1)) >= 25 - L.SNAP_MAX_MANUAL),
      "manual only trims past its own cap");
    // Newest-first ordering.
    const ts = out.map((s) => s.ts);
    assert.deepEqual(ts, ts.slice().sort((a, b) => b - a));
  });

  it("accepts explicit caps for tests and tolerates junk", () => {
    const list = Array.from({ length: 6 }, (_, i) => ({
      id: `x${i}`, name: "X", ws: "1", ts: i + 1, auto: i % 2 === 0,
      tabs: [{ url: `https://x${i}.example/` }],
    }));
    const out = L.pruneSnapshots(list, 1, 1);
    assert.equal(out.length, 2, "one manual + one auto");
    assert.equal(L.pruneSnapshots(null).length, 0);
    assert.equal(L.pruneSnapshots("junk", 0, 0).length, 0);
  });

  it("searches snapshots by name, workspace and member content", () => {
    const snaps = [
      { id: "s1", name: "Sprint", ws: "2", ts: 1, auto: false,
        tabs: [{ title: "PR list", url: "https://github.com/prs", cid: 0 }] },
      { id: "s2", name: "Reading", ws: "4", ts: 2, auto: true,
        tabs: [{ title: "Recipe", url: "https://food.example/cake", cid: 0 }] },
    ];
    const ids = (q) => L.fuzzyStashFilter(snaps, q).map((r) => r.snap.id);
    assertJsonEqual(ids(""), ["s1", "s2"]);
    assertJsonEqual(ids("sprint"), ["s1"]);
    assertJsonEqual(ids("github"), ["s1"], "member host matches");
    assertJsonEqual(ids("food cake"), ["s2"], "multi-word AND across tabs");
    assertJsonEqual(ids("ws 4"), ["s2"]);
    assert.equal(L.fuzzyStashFilter(snaps, "auto")[0].snap.id, "s2", "auto ranks first");
    assertJsonEqual(ids("zzz"), []);
    assert.ok(L.fuzzyStashFilter(snaps, "sprint")[0].score > 0);
  });

  it("sorts snapshots newest, oldest and by name", () => {
    const snaps = [
      { id: "b", name: "Banana", ws: "1", ts: 2, auto: false, tabs: [] },
      { id: "a", name: "Apple", ws: "1", ts: 3, auto: false, tabs: [] },
      { id: "c", name: "Cherry", ws: "1", ts: 1, auto: false, tabs: [] },
    ];
    const ids = (list) => list.map((s) => s.id);
    assertJsonEqual(ids(L.sortStashes(snaps)), ["a", "b", "c"]);
    assertJsonEqual(ids(L.sortStashes(snaps, "oldest")), ["c", "b", "a"]);
    assertJsonEqual(ids(L.sortStashes(snaps, "name")), ["a", "b", "c"]);
    assertJsonEqual(ids(L.sortStashes(snaps, "site")), ["a", "b", "c"], "site maps to name");
  });

  it("gates captures on the tunable cadence", () => {
    assert.equal(L.SNAP_INTERVAL_DEFAULT_MIN, 30);
    assert.equal(L.clampSnapIntervalMin(2), 5);
    assert.equal(L.clampSnapIntervalMin(45.9), 45);
    assert.equal(L.clampSnapIntervalMin(999), 240);
    assert.equal(L.clampSnapIntervalMin("nope"), 30);
    const now = 1_000_000_000;
    assert.equal(L.snapshotDue(0, now, 30), true, "never captured is due");
    assert.equal(L.snapshotDue(now - 29 * 60000, now, 30), false);
    assert.equal(L.snapshotDue(now - 30 * 60000, now, 30), true, "boundary is due");
    assert.equal(L.snapshotDue(now - 6 * 60000, now, 5), true, "custom cadence");
    assert.equal(L.snapshotDue(now - 1, "junk", 30), false);
  });
});

// ---- pre-rename migration (aph.archive.* / aph.snapshots -> aph.stash.*) --
describe("stash pre-rename migration", () => {
  function migratedSandbox() {
    const env = makeSandbox();
    env.sb.Services.prefs.clearUserPref = (k) => { delete prefStore[k]; };
    return env;
  }

  it("adopts stashed tabs from aph.archive.tabs forward", () => {
    delete prefStore["aph.stash.tabs"];
    prefStore["aph.archive.tabs"] = JSON.stringify([{
      id: "m1", title: "Old", url: "https://old.example/", host: "old.example",
      ws: "2", cid: 0, cname: "", favicon: "", ts: 1,
    }]);
    const env = migratedSandbox();
    const api = loadStash(env);
    assert.equal(api.getStashEntries().length, 1);
    assert.equal(api.getStashEntries()[0].url, "https://old.example/");
    assert.ok("aph.stash.tabs" in prefStore, "adopted to the new key");
    assert.ok(!("aph.archive.tabs" in prefStore), "old key cleared");
  });

  it("prefers the new key when both exist and leaves the old one alone", () => {
    prefStore["aph.stash.tabs"] = JSON.stringify([{
      id: "n1", title: "New", url: "https://new.example/", host: "new.example",
      ws: "1", cid: 0, cname: "", favicon: "", ts: 2,
    }]);
    prefStore["aph.archive.tabs"] = JSON.stringify([{
      id: "o1", title: "Old", url: "https://old.example/", host: "old.example",
      ws: "1", cid: 0, cname: "", favicon: "", ts: 1,
    }]);
    const env = migratedSandbox();
    const api = loadStash(env);
    assertJsonEqual(api.getStashEntries().map((e) => e.id), ["n1"]);
    assert.ok("aph.archive.tabs" in prefStore, "old key untouched when new wins");
    delete prefStore["aph.archive.tabs"];
    delete prefStore["aph.stash.tabs"];
  });

  it("adopts workspace stashes from aph.snapshots forward", () => {
    delete prefStore["aph.stash.snapshots"];
    prefStore["aph.snapshots"] = JSON.stringify([{
      id: "s1", name: "Old stash", ws: "2", ts: 1, auto: false,
      tabs: [{ title: "a", url: "https://a.example/", cid: 0 }],
    }]);
    const env = migratedSandbox();
    const api = loadStash(env);
    assert.equal(api.listStashes().length, 1);
    assert.equal(api.listStashes()[0].name, "Old stash");
    assert.ok("aph.stash.snapshots" in prefStore, "adopted to the new key");
    assert.ok(!("aph.snapshots" in prefStore), "old key cleared");
    delete prefStore["aph.stash.snapshots"];
  });

  it("reads the autoEnabled prefs from the old keys", () => {
    delete prefStore["aph.stash.tabs"];
    const env = makeSandbox();
    // New keys absent (throw, like real prefs); old keys carry the values.
    env.sb.Services.prefs.getBoolPref = (k) => {
      if (k === "aph.archive.autoEnabled") {
        return true;
      }
      throw new Error("missing pref");
    };
    const api = loadStash(env);
    const t = makeTab(tabVals, { label: "bg", ws: "2", spec: "https://bg.example/" });
    env.tabs.push(t);
    env.wsOf.set(t, "2");
    assert.equal(api.autoStashSweep(), 1, "legacy autoEnabled honored");
  });

  it("reads the staleness threshold from the old key", () => {
    delete prefStore["aph.stash.tabs"];
    const env = makeSandbox();
    env.sb.Services.prefs.getBoolPref = () => true;
    env.sb.Services.prefs.getIntPref = (k) => {
      if (k === "aph.archive.autoStaleMin") {
        return 60;
      }
      throw new Error("missing pref");
    };
    const api = loadStash(env);
    const t = makeTab(tabVals, { label: "bg", ws: "2", spec: "https://bg.example/" });
    env.tabs.push(t);
    env.wsOf.set(t, "2");
    tabVals.get(t).aphLastViewed = String(Date.now() - 10 * 60000);
    assert.equal(api.autoStashSweep(), 0, "10 min < legacy 60 min threshold");
  });

  it("reads the snapshot auto pref from the old key", () => {
    delete prefStore["aph.stash.snapshots"];
    const env = makeSandbox();
    env.sb.Services.prefs.getBoolPref = (k, d) => {
      if (k === "aph.snapshots.autoEnabled") {
        return true;
      }
      throw new Error("missing pref");
    };
    const api = loadStash(env);
    const t = makeTab(tabVals, { label: "a", ws: "2", spec: "https://a.example/" });
    env.tabs.push(t);
    env.wsOf.set(t, "2");
    assert.equal(api.autoStashTabs([t], "legacy"), 1, "legacy snapshot auto pref honored");
    delete prefStore["aph.stash.snapshots"];
  });
});
