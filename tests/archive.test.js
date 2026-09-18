// Regression guards for the tab archive (branding/archive-shared.js +
// branding/archive.js). Store tests mirror tests/workspaces.test.js: the
// real scripts run in node:vm with Firefox globals mocked.
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { run, makeTab } = require("./helpers");

// ---- shared logic (pure, no mocks needed) ----
const ssb = { window: {}, document: { readyState: "loading" } };
run("archive-shared.js", ssb);
const L = ssb.AphArchiveLogic;
// deepStrictEqual fails across the node:vm realm boundary (arrays built
// inside the sandbox carry the sandbox Array prototype), so compare the
// serialized form instead.
function assertJsonEqual(actual, expected) {
  assert.equal(JSON.stringify(actual), JSON.stringify(expected));
}


describe("archive urls", () => {
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

describe("archive sanitize + prune", () => {
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

describe("archive dates + filter", () => {
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

function loadArchive(env) {
  run("archive-shared.js", env.sb);
  env.sb.window.AphArchiveLogic = env.sb.AphArchiveLogic;
  run("archive.js", env.sb);
  return env.sb.window.AphArchive;
}

function seedEntries(n, tag) {
  const arr = Array.from({ length: n }, (_, i) => ({
    id: `${tag}${i}`, title: `T${i}`, url: `https://${tag}${i}.example/`,
    host: `${tag}${i}.example`, ws: "1", cid: 0, cname: "", favicon: "", ts: i,
  }));
  prefStore["aph.archive.tabs"] = JSON.stringify(arr);
}

describe("archive store", () => {
  it("archives the current tab with context and closes it", () => {
    delete prefStore["aph.archive.tabs"];
    const env = makeSandbox();
    const api = loadArchive(env);
    const t = makeTab(tabVals, { label: "GitHub", ws: "2", spec: "https://github.com/x", cid: 7 });
    env.tabs.push(t);
    env.sb.gBrowser.selectedTabs = [];
    env.setSel(t);
    env.wsOf.set(t, "2");
    assert.equal(api.archiveCurrent(), 1);
    const saved = JSON.parse(prefStore["aph.archive.tabs"]);
    assert.equal(saved.length, 1);
    assert.equal(saved[0].title, "GitHub");
    assert.equal(saved[0].host, "github.com");
    assert.equal(saved[0].ws, "2");
    assert.equal(saved[0].cid, 7);
    assert.equal(saved[0].cname, "Work");
    assert.ok(!env.tabs.includes(t));
  });

  it("skips internal pages and closes nothing", () => {
    delete prefStore["aph.archive.tabs"];
    const env = makeSandbox();
    const api = loadArchive(env);
    const t = makeTab(tabVals, { label: "n", ws: "1", spec: "about:newtab" });
    env.tabs.push(t);
    env.setSel(t);
    assert.equal(api.archiveCurrent(), 0);
    assert.ok(env.tabs.includes(t));
    assert.ok(!("aph.archive.tabs" in prefStore));
  });

  it("enforces the cap newest-first", () => {
    seedEntries(300, "old");
    const env = makeSandbox();
    const api = loadArchive(env);
    const t = makeTab(tabVals, { label: "Fresh", ws: "1", spec: "https://fresh.example/" });
    env.tabs.push(t);
    env.setSel(t);
    assert.equal(api.archiveCurrent(), 1);
    const saved = JSON.parse(prefStore["aph.archive.tabs"]);
    assert.equal(saved.length, 300);
    assert.equal(saved[0].url, "https://fresh.example/");
  });

  it("archives a multiselection together", () => {
    delete prefStore["aph.archive.tabs"];
    const env = makeSandbox();
    const api = loadArchive(env);
    const a = makeTab(tabVals, { label: "A", ws: "1", spec: "https://a.example/" });
    const b = makeTab(tabVals, { label: "B", ws: "1", spec: "https://b.example/" });
    env.tabs.push(a, b);
    env.sb.gBrowser.selectedTabs = [a, b];
    env.setSel(a);
    assert.equal(api.archiveTab(a), 2);
    assert.equal(JSON.parse(prefStore["aph.archive.tabs"]).length, 2);
    assert.equal(env.tabs.length, 0);
  });
});

describe("auto archive sweep", () => {
  function autoEnv(enabled) {
    const env = makeSandbox();
    env.sb.Services.prefs.getBoolPref = (k) =>
      k === "aph.archive.autoEnabled" ? enabled : false;
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
    delete prefStore["aph.archive.tabs"];
    const env = makeSandbox(); // no getBoolPref backend at all
    const api = loadArchive(env);
    hiddenTab(env);
    assert.equal(api.autoSweep(), 0);
    assert.equal(env.tabs.length, 1);
    assert.ok(!("aph.archive.tabs" in prefStore));
  });

  it("is off when the pref is false", () => {
    delete prefStore["aph.archive.tabs"];
    const env = autoEnv(false);
    const api = loadArchive(env);
    hiddenTab(env);
    assert.equal(api.autoSweep(), 0);
    assert.equal(env.tabs.length, 1);
  });

  it("archives eligible hidden tabs with context, keeps the rest", () => {
    delete prefStore["aph.archive.tabs"];
    const env = autoEnv(true);
    const api = loadArchive(env);
    const good = hiddenTab(env, { label: "good", spec: "https://good.example/page" });
    const cur = makeTab(tabVals, { label: "cur", ws: "1", spec: "https://cur.example/" });
    env.tabs.push(cur); // wsOf defaults to "1" = current
    env.setSel(cur);
    assert.equal(api.autoSweep(), 1);
    assert.ok(!env.tabs.includes(good), "eligible hidden tab closed");
    assert.ok(env.tabs.includes(cur), "current-workspace tab kept");
    const saved = JSON.parse(prefStore["aph.archive.tabs"]);
    assert.equal(saved.length, 1);
    assert.equal(saved[0].url, "https://good.example/page");
    assert.equal(saved[0].ws, "2");
  });

  it("never auto-closes guarded tabs", () => {
    delete prefStore["aph.archive.tabs"];
    const env = autoEnv(true);
    const api = loadArchive(env);
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
    assert.equal(api.autoSweep(), 0);
    for (const t of [sel, pin, star, snd, aud, busy, dirty, internal]) {
      assert.ok(env.tabs.includes(t), `${t.label} survives`);
    }
    assert.ok(!("aph.archive.tabs" in prefStore));
  });

  it("fails closed without the workspaces API", () => {
    delete prefStore["aph.archive.tabs"];
    const env = autoEnv(true);
    delete env.sb.window.AphWorkspaces;
    const api = loadArchive(env);
    hiddenTab(env);
    assert.equal(api.autoSweep(), 0);
    assert.equal(env.tabs.length, 1);
  });

  // ---- settle timer (the time-based foundation) ----
  // Installed AFTER loadArchive: run() stamps default timer mocks at load.
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
    delete prefStore["aph.archive.tabs"];
    const env = autoEnv(true);
    const api = loadArchive(env);
    const { armed } = armTimers(env);
    const good = hiddenTab(env, { label: "good", spec: "https://good.example/page" });
    const cur = makeTab(tabVals, { label: "cur", ws: "1", spec: "https://cur.example/" });
    env.tabs.push(cur);
    env.setSel(cur);
    assert.equal(api.scheduleAutoSweep(), true);
    assert.equal(armed.length, 1);
    assert.equal(armed[0].ms, 15000);
    assert.ok(env.tabs.includes(good), "nothing archived before the timer fires");
    armed[0].fn();
    assert.ok(!env.tabs.includes(good), "timer fire sweeps");
    assert.equal(JSON.parse(prefStore["aph.archive.tabs"]).length, 1);
  });

  it("re-arming clears the previous timer so only one sweep is pending", () => {
    delete prefStore["aph.archive.tabs"];
    const env = autoEnv(true);
    const api = loadArchive(env);
    const { armed, cleared } = armTimers(env);
    hiddenTab(env);
    assert.equal(api.scheduleAutoSweep(), true);
    assert.equal(api.scheduleAutoSweep(), true);
    assert.equal(armed.length, 2);
    assertJsonEqual(cleared, [armed[0].id]);
    armed[1].fn();
    assert.equal(JSON.parse(prefStore["aph.archive.tabs"]).length, 1);
  });

  it("scheduling while disabled arms nothing and disarms pending", () => {
    delete prefStore["aph.archive.tabs"];
    const env = autoEnv(true);
    const api = loadArchive(env);
    const { armed, cleared } = armTimers(env);
    hiddenTab(env);
    assert.equal(api.scheduleAutoSweep(), true);
    // Flip the pref off, then schedule again: pending timer dies, none armed.
    env.sb.Services.prefs.getBoolPref = () => false;
    assert.equal(api.scheduleAutoSweep(), false);
    assertJsonEqual(cleared, [armed[0].id]);
    assert.equal(armed.length, 1);
  });

  it("a stale timer never closes a tab you came back to", () => {
    delete prefStore["aph.archive.tabs"];
    const env = autoEnv(true);
    const api = loadArchive(env);
    const { armed } = armTimers(env);
    const t = hiddenTab(env, { label: "back" });
    assert.equal(api.scheduleAutoSweep(), true);
    env.setCur("2"); // came back before the timer fired
    env.setSel(t);
    armed[0].fn();
    assert.ok(env.tabs.includes(t), "returned-to tab survives");
    assert.ok(!("aph.archive.tabs" in prefStore));
  });

  it("unload disarms a pending sweep", () => {
    delete prefStore["aph.archive.tabs"];
    const env = autoEnv(true);
    const api = loadArchive(env);
    const { armed, cleared } = armTimers(env);
    hiddenTab(env);
    assert.equal(api.scheduleAutoSweep(), true);
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
        k === "aph.archive.autoStaleMin" ? staleMin : 5;
    }
    return env;
  }

  it("spares tabs viewed within the threshold", () => {
    delete prefStore["aph.archive.tabs"];
    const env = staleEnv();
    const api = loadArchive(env);
    const fresh = hiddenTab(env, { label: "fresh" });
    stampViewed(fresh, 1 * MIN);
    assert.equal(api.autoSweep(), 0);
    assert.ok(env.tabs.includes(fresh));
    assert.ok(!("aph.archive.tabs" in prefStore));
  });

  it("archives tabs viewed beyond the threshold", () => {
    delete prefStore["aph.archive.tabs"];
    const env = staleEnv();
    const api = loadArchive(env);
    const old = hiddenTab(env, { label: "old", spec: "https://old.example/" });
    stampViewed(old, 10 * MIN);
    assert.equal(api.autoSweep(), 1);
    assert.ok(!env.tabs.includes(old));
  });

  it("treats missing and malformed stamps as stale", () => {
    delete prefStore["aph.archive.tabs"];
    const env = staleEnv();
    const api = loadArchive(env);
    const missing = hiddenTab(env, { label: "missing", spec: "https://m.example/" });
    const junk = hiddenTab(env, { label: "junk", spec: "https://j.example/" });
    tabVals.get(junk).aphLastViewed = "not-a-time";
    assert.equal(api.autoSweep(), 2);
    assert.ok(!env.tabs.includes(missing) && !env.tabs.includes(junk));
  });

  it("honors a custom threshold read live", () => {
    delete prefStore["aph.archive.tabs"];
    const env = staleEnv(60);
    const api = loadArchive(env);
    const t = hiddenTab(env, { label: "hour", spec: "https://hour.example/" });
    stampViewed(t, 10 * MIN);
    assert.equal(api.autoSweep(), 0, "10 min < 60 min threshold");
    stampViewed(t, 70 * MIN);
    assert.equal(api.autoSweep(), 1, "70 min > 60 min threshold");
  });
});

describe("archive restore + delete", () => {
  it("restores with workspace + container, removes the entry, switches", () => {
    seedEntries(0);
    prefStore["aph.archive.tabs"] = JSON.stringify([{
      id: "r1", title: "PR", url: "https://github.com/pr", host: "github.com",
      ws: "2", cid: 7, cname: "Work", favicon: "", ts: 1,
    }]);
    const env = makeSandbox();
    const api = loadArchive(env);
    const r = api.restoreEntry("r1", {});
    assert.equal(r.ok, true);
    assertJsonEqual(env.opened[0], { url: "https://github.com/pr", ws: "2", cid: 7 });
    assertJsonEqual(env.switched, ["2"]);
    assert.equal(api.getEntries().length, 0);
    assert.equal(env.getSel().label, "restored");
  });

  it("falls back to unbound when the container is gone, keeps with Shift", () => {
    prefStore["aph.archive.tabs"] = JSON.stringify([{
      id: "r2", title: "Old", url: "https://old.example/", host: "old.example",
      ws: "1", cid: 99, cname: "Gone", favicon: "", ts: 1,
    }]);
    const env = makeSandbox();
    const api = loadArchive(env);
    const r = api.restoreEntry("r2", { keep: true });
    assert.equal(r.ok, true);
    assert.equal(env.opened[0].cid, 0);
    assert.equal(api.getEntries().length, 1);
  });

  it("reports missing ids and deletes explicitly", () => {
    seedEntries(1, "k");
    const env = makeSandbox();
    const api = loadArchive(env);
    assert.equal(api.restoreEntry("nope", {}).ok, false);
    assert.equal(api.deleteEntry("nope"), false);
    assert.equal(api.deleteEntry("k0"), true);
    assert.equal(api.getEntries().length, 0);
  });

  it("routes page restore requests only to the owning window", () => {
    seedEntries(0);
    prefStore["aph.archive.tabs"] = JSON.stringify([{
      id: "r3", title: "P", url: "https://p.example/", host: "p.example",
      ws: "1", cid: 0, cname: "", favicon: "", ts: 1,
    }]);
    const env = makeSandbox();
    const api = loadArchive(env);
    const t = makeTab(tabVals, { label: "archive", ws: "1", spec: "chrome://browser/content/aph-archive.html" });
    t.linkedBrowser.browsingContext = { id: 4242 };
    env.tabs.push(t);
    const h = obsHandlers["aph-archive-restore"];
    assert.ok(h);
    h.observe(null, "aph-archive-restore", JSON.stringify({ contextId: 1111, id: "r3" }));
    assert.equal(api.getEntries().length, 1); // stranger's request ignored
    h.observe(null, "aph-archive-restore", JSON.stringify({ contextId: 4242, id: "r3" }));
    assert.equal(api.getEntries().length, 0); // owner restored + removed
    assert.equal(env.opened[0].url, "https://p.example/");
  });

  it("opens the archive once per window", () => {
    delete prefStore["aph.archive.tabs"];
    const env = makeSandbox();
    const api = loadArchive(env);
    assert.equal(api.openArchive(), true);
    assert.equal(env.tabs.length, 1);
    assert.equal(env.getSel(), env.tabs[0]);
    assert.equal(api.openArchive(), true);
    assert.equal(env.tabs.length, 1); // reused, not duplicated
  });

  it("cleans up observers on unload", () => {
    delete prefStore["aph.archive.tabs"];
    const env = makeSandbox();
    const seen = [];
    env.sb.Services.prefs.removeObserver = () => seen.push("prefs");
    env.sb.Services.obs.removeObserver = () => seen.push("obs");
    loadArchive(env);
    assert.ok(typeof unloadFn === "function");
    unloadFn();
    assert.ok(seen.includes("prefs") && seen.includes("obs"));
  });
});

describe("archive context menu", () => {
  it("offers Archive Tab for the right-clicked tab and archives on command", () => {
    delete prefStore["aph.archive.tabs"];
    const env = makeSandbox();
    const api = loadArchive(env);
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
    assert.equal(item.attrs.label, "Archive Tab");
    item[`on_command`]();
    assert.equal(JSON.parse(prefStore["aph.archive.tabs"])[0].ws, "3");
    void api;
  });

  it("resolves the tab from triggerNode.tab as stock does", () => {
    delete prefStore["aph.archive.tabs"];
    const env = makeSandbox();
    loadArchive(env);
    const t = makeTab(tabVals, { label: "Direct", ws: "1", spec: "https://direct.example/" });
    env.tabs.push(t);
    env.setSel(t);
    env.menuHandlers["popupshowing"]({ currentTarget: env.menu, target: { triggerNode: { tab: t } } });
    assert.equal(env.menuKids.length, 1);
    assert.equal(env.menuKids[0].attrs.label, "Archive Tab");
  });
});

// ---- palette integration ----
describe("archive palette commands", () => {
  const psb = {
    window: {
      addEventListener() {},
      AphWorkspaces: {
        getCurrent: () => "1", getWsName: () => "", getRoutes: () => ({}),
        getWsContainer: () => 0, describeContainer: () => null, getWs: () => "1",
      },
      AphArchive: {
        calls: [],
        pendingCount: () => 2,
        archiveCurrent() { this.calls.push("archive"); },
        openArchive() { this.calls.push("open"); return true; },
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

  it("lists Archive commands with a multiselect-aware title", () => {
    const rows = T.allItems("archive");
    const titles = rows.map((r) => r.title);
    assert.ok(titles.includes("Archive 2 Tabs"), titles.join(" | "));
    assert.ok(titles.includes("Open Archive"), titles.join(" | "));
  });

  it("routes runs through the archive controller", () => {
    const rows = T.allItems("archive");
    rows.find((r) => r.title === "Open Archive").run();
    rows.find((r) => r.title.startsWith("Archive")).run();
    assertJsonEqual(psb.window.AphArchive.calls, ["open", "archive"]);
  });
});
