// Spaces (77-spaces.js): named folders around tabs. Guards: registry CRUD
// + validation, plurality membership vote (menu/palette gating only),
// per-tab paint (ws gating, restore-guard bail, header host on the first
// member row or the leading group's label container, group quieting
// hook), unassign/delete cleanup. Mocks mirror tests/helpers.js shapes
// (tabbrowser tabs-listener convention); group doubles carry the
// attribute surface <tab-group> has.
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { run, makeTab, makeGroup, makeChromeUtils, nullIdentityService } = require("./helpers");

function attrGroup(tabs, o) {
  const g = makeGroup(tabs, o);
  g._attrs = {};
  g.setAttribute = function (k, v) { this._attrs[k] = String(v); };
  g.getAttribute = function (k) { return k in this._attrs ? this._attrs[k] : null; };
  g.removeAttribute = function (k) { delete this._attrs[k]; };
  g.hasAttribute = function (k) { return k in this._attrs; };
  // Head fake for drag-to-join: the stock label container hosts the
  // header (and thus the drop surface) when this group leads its folder.
  g.label = {
    _attrs: {},
    closest: () => g,
    setAttribute(k, v) { this._attrs[k] = String(v); },
    getAttribute(k) { return k in this._attrs ? this._attrs[k] : null; },
    removeAttribute(k) { delete this._attrs[k]; },
  };
  g.querySelector = (sel) => (sel === ".tab-group-label-container" ? g.label : null);
  return g;
}

// Pointer-target fakes mirror real closest() chains: probe the same
// selectors onSpaceDragOver asks (strip up: label container → tab).
const tabTap = (el) => ({
  closest: (sel) =>
    sel === ".tab-group-label-container"
      ? null
      : sel === "tab"
        ? el
        : null,
});
const labelTap = (g) => ({
  closest: (sel) =>
    sel === ".tab-group-label-container"
      ? g.label
      : sel === "tab"
        ? null
        : null,
});

function boot(seedPrefs, opts) {
  const tabVals = new WeakMap();
  const prefStore = Object.assign({}, seedPrefs);
  const tabs = [];
  const groups = [];
  const observers = {};
  const winHandlers = {};
  const stripListeners = [];
  let sel = null;
  const sb = {
    window: {
      addEventListener(k, fn) {
        (winHandlers[k] = winHandlers[k] || []).push(fn);
      },
      removeEventListener(k, fn) {
        const l = winHandlers[k] || [];
        const i = l.indexOf(fn);
        if (i !== -1) l.splice(i, 1);
      },
      opener: null,
    },
    dragstart: (ev) => {
      for (const fn of [...(winHandlers.dragstart || [])]) fn(ev);
    },
    dragend: () => {
      for (const fn of [...(winHandlers.dragend || [])]) fn({ target: null });
    },
    emit: (kind, ev) => {
      for (const fn of [...(winHandlers[kind] || [])]) fn(ev);
    },
    navigator: { onLine: true },
    document: {
      readyState: "complete",
      documentElement: {
        setAttribute() {},
        removeAttribute() {},
      },
      getElementById: () => null,
      createElement: () => ({
        setAttribute() {}, removeAttribute() {}, addEventListener() {},
        appendChild(c) { return c; }, style: {}, className: "",
      }),
      createEvent: () => ({ initEvent() {} }),
    },
    gBrowser: {
      tabs,
      tabGroups: groups,
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
        const i = tabs.indexOf(t);
        if (i !== -1) tabs.splice(i, 1);
      },
      ungroupTab(t) {
        if (!t || !t.group) return;
        const g = t.group;
        t.group = null;
        const i = (g.tabs || []).indexOf(t);
        if (i !== -1) g.tabs.splice(i, 1);
      },
      addTabGroup(tbs) {
        const live = (tbs || []).filter((t) => t && !t.closing);
        if (live.length < 2) return null;
        const ng = attrGroup(live, {});
        groups.push(ng);
        return ng;
      },
      replaceInSuccession() {},
      setSuccessor() {},
      _updateMultiselectedTabCloseButtonTooltip() {},
      getTabForBrowser: (b) => (b && b.__tab) || null,
      addTabsProgressListener() {},
      removeTabsProgressListener() {},
      tabContainer: {
        _attrs: {},
        setAttribute(k, v) { this._attrs[k] = String(v); },
        getAttribute(k) { return this._attrs[k]; },
        removeAttribute(k) { delete this._attrs[k]; },
        addEventListener(k, fn, capture) {
          stripListeners.push({ type: k, fn, capture: !!capture });
          (winHandlers[k] = winHandlers[k] || []).push(fn);
        },
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
      isTabRestoring: () => false,
      getCustomWindowValue: () => undefined,
      setCustomWindowValue: () => {},
    },
    Services: {
      prefs: {
        getStringPref: (k, d) => (k in prefStore ? prefStore[k] : d),
        setStringPref: (k, v) => { prefStore[k] = v; },
        getBoolPref: (k, d) => {
          if (k in prefStore && typeof prefStore[k] === "boolean") return prefStore[k];
          if (d !== undefined) return d;
          throw new Error(`no bool pref ${k}`);
        },
        setBoolPref: (k, v) => { prefStore[k] = !!v; },
        getIntPref: (k, d) => {
          if (k in prefStore && typeof prefStore[k] === "number") return prefStore[k];
          if (d !== undefined) return d;
          throw new Error(`no int pref ${k}`);
        },
        setIntPref: (k, v) => { prefStore[k] = Math.floor(Number(v)); },
        addObserver: (k, o) => { observers[k] = o; },
        removeObserver: (k) => { delete observers[k]; },
      },
      console: { logStringMessage() {} },
      wm: {
        getMostRecentWindow: () => null,
        getEnumerator: () => ({ hasMoreElements: () => false }),
      },
      obs: { addObserver() {}, removeObserver() {} },
    },
    ChromeUtils: makeChromeUtils(nullIdentityService),
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
  // Pre-bundle strip listeners stand in for stock Firefox's own handlers
  // (registered at tabContainer construction, before the bundle); the
  // shared winHandlers map keeps emit() order = registration order.
  if (opts && typeof opts.stockDrop === "function") {
    stripListeners.push({ type: "drop", fn: opts.stockDrop, capture: false });
    (winHandlers.drop = winHandlers.drop || []).push(opts.stockDrop);
  }
  run("workspaces.js", sb);
  const tab = (label, ws) => {
    const t = makeTab(tabVals, { label, ws, spec: `https://${label}.example/` });
    tabs.push(t);
    return t;
  };
  return { api: sb.window.AphWorkspaces, tab, tabs, groups, prefStore, observers, tabVals, stripListeners, sb };
}

describe("spaces registry", () => {
  it("creates, lists per workspace, and persists to the pref", () => {
    const { api, prefStore } = boot({});
    const id = api.createSpace("🎓 Academics", "1");
    assert.ok(id, "returns an id");
    assert.equal(api.getSpace(id).name, "🎓 Academics");
    assert.equal(api.getSpace(id).ws, "1");
    assert.equal(api.listSpaces("1").length, 1);
    assert.equal(api.listSpaces("2").length, 0);
    assert.equal(api.listSpaces().length, 1);
    const saved = JSON.parse(prefStore["aph.spaces"]);
    assert.equal(saved[id].name, "🎓 Academics");
  });

  it("refuses blank names and defaults to the current workspace", () => {
    const { api } = boot({});
    assert.equal(api.createSpace("   ", "1"), "");
    assert.equal(api.createSpace("", "1"), "");
    const id = api.createSpace("Treaulab");
    assert.ok(id);
    assert.equal(api.getSpace(id).ws, "1");
  });

  it("renames, rejects empty/unknown, and deletes", () => {
    const { api } = boot({});
    assert.equal(api.renameSpace("nope", "X"), false);
    const id = api.createSpace("Old", "1");
    assert.equal(api.renameSpace(id, "   "), false);
    assert.equal(api.renameSpace(id, "New"), true);
    assert.equal(api.getSpace(id).name, "New");
    assert.equal(api.deleteSpace("nope"), false);
    assert.equal(api.deleteSpace(id), true);
    assert.equal(api.getSpace(id), null);
    assert.equal(api.listSpaces("1").length, 0);
  });

  it("ignores malformed registry entries on load", () => {
    const { api } = boot({
      "aph.spaces": JSON.stringify({
        good: { ws: "1", name: "Kept" },
        badws: { ws: "12", name: "Nope" },
        noname: { ws: "1", name: "   " },
        "bad id!": { ws: "1", name: "Nope" },
      }),
    });
    const all = api.listSpaces();
    assert.equal(all.length, 1);
    assert.equal(all[0].name, "Kept");
  });

  it("registers a pref observer for cross-window sync", () => {
    const { observers } = boot({});
    assert.ok(observers["aph.spaces"], "observes the spaces pref");
  });
});

describe("spaces paint", () => {
  it("paints every member row; the first folder's label hosts the header", () => {
    const { api, tab, groups } = boot({});
    const a1 = tab("a1", "1");
    const a2 = tab("a2", "1");
    const b1 = tab("b1", "1");
    const b2 = tab("b2", "1");
    const g1 = attrGroup([a1, a2], {});
    const g2 = attrGroup([b1, b2], {});
    groups.push(g1, g2);
    const id = api.createSpace("🎓 Academics", "1");
    assert.equal(api.assignGroupToSpace(g1, id), true);
    assert.equal(api.assignGroupToSpace(g2, id), true);
    // Loose or grouped is the same treatment: every member row paints.
    for (const t of [a1, a2, b1, b2]) {
      assert.equal(t.getAttribute("data-aph-space-tab"), "1");
      assert.equal(t.getAttribute("data-aph-space"), id);
      assert.equal(t.getAttribute("data-aph-space-name"), null, "name is header-only");
    }
    // Both groups get the quieting hook; only the first folder's label
    // carries the header.
    assert.equal(g1.getAttribute("data-aph-space"), "1");
    assert.equal(g2.getAttribute("data-aph-space"), "1");
    assert.equal(g1.label.getAttribute("data-aph-space"), id);
    assert.equal(g1.label.getAttribute("data-aph-space-first"), "1");
    assert.equal(g1.label.getAttribute("data-aph-space-name"), "🎓 Academics");
    assert.equal(g2.label.getAttribute("data-aph-space-first"), null);
    assert.equal(g2.label.getAttribute("data-aph-space"), null);
    // Rename repaints the header without reassigning.
    api.renameSpace(id, "School");
    assert.equal(g1.label.getAttribute("data-aph-space-name"), "School");
  });

  it("leaves unassigned groups unpainted", () => {
    const { api, tab, groups } = boot({});
    api.createSpace("Solo", "1");
    const g = attrGroup([tab("u1", "1"), tab("u2", "1")], {});
    groups.push(g);
    api.syncSpaces("1");
    assert.equal(g.getAttribute("data-aph-space"), null);
    assert.equal(g.label.getAttribute("data-aph-space"), null);
    for (const t of g.tabs) {
      assert.equal(t.getAttribute("data-aph-space-tab"), null);
    }
  });

  it("refuses cross-workspace folders and never paints foreign groups", () => {
    const { api, tab, groups } = boot({});
    const id = api.createSpace("WS1 Only", "1");
    const g = attrGroup([tab("w1", "2"), tab("w2", "2")], {});
    groups.push(g);
    assert.equal(api.assignGroupToSpace(g, id), false);
    api.syncSpaces("2");
    assert.equal(g.getAttribute("data-aph-space"), null);
    for (const t of g.tabs) {
      assert.equal(t.getAttribute("data-aph-space-tab"), null);
    }
  });

  it("resolves membership by member plurality, ties to earliest", () => {
    const { api, tab, groups, tabVals } = boot({});
    const s1 = api.createSpace("One", "1");
    const s2 = api.createSpace("Two", "1");
    const m1 = tab("m1", "1");
    const m2 = tab("m2", "1");
    const m3 = tab("m3", "1");
    const g = attrGroup([m1, m2, m3], {});
    groups.push(g);
    const set = (t, v) => {
      const o = tabVals.get(t) || {};
      o.aphSpace = v;
      tabVals.set(t, o);
    };
    set(m1, s1);
    set(m2, s2);
    set(m3, s1);
    assert.equal(api.spaceOfGroup(g), s1);
    set(m3, s2);
    // 1-1 tie between s1 (m1) and s2 (m2): earliest member wins.
    const g2 = attrGroup([m1, m2], {});
    assert.equal(api.spaceOfGroup(g2), s1);
  });

  it("drops unknown ids and bails on tagless members", () => {
    const { api, tab, groups, tabVals } = boot({});
    const g = attrGroup([tab("k1", "1"), tab("k2", "1")], {});
    groups.push(g);
    for (const m of g.tabs) {
      const o = tabVals.get(m) || {};
      o.aphSpace = "sp-ghost";
      tabVals.set(m, o);
    }
    api.syncSpaces("1");
    assert.equal(g.getAttribute("data-aph-space"), null);
    for (const m of g.tabs) {
      assert.equal(m.getAttribute("data-aph-space-tab"), null);
    }
    // Tagless (restoring-shape) members fail closed: no folder flash.
    const r1 = makeTab(tabVals, { label: "r1", spec: "https://r1.example/" });
    const r2 = makeTab(tabVals, { label: "r2", spec: "https://r2.example/" });
    const gr = attrGroup([r1, r2], {});
    groups.push(gr);
    api.syncSpaces("1");
    assert.equal(gr.getAttribute("data-aph-space"), null);
    assert.equal(gr.label.getAttribute("data-aph-space-first"), null);
  });

  it("unassign and delete clear values and paint", () => {
    const { api, tab, groups, tabVals } = boot({});
    const id = api.createSpace("Temp", "1");
    const g = attrGroup([tab("t1", "1"), tab("t2", "1")], {});
    groups.push(g);
    api.assignGroupToSpace(g, id);
    assert.equal(g.getAttribute("data-aph-space"), "1");
    assert.equal(g.label.getAttribute("data-aph-space-first"), "1");
    assert.equal(api.unassignGroup(g), true);
    assert.equal(api.unassignGroup(g), false);
    assert.equal(g.getAttribute("data-aph-space"), null);
    assert.equal(g.label.getAttribute("data-aph-space-first"), null);
    assert.equal(g.label.getAttribute("data-aph-space"), null);
    assert.equal(tabVals.get(g.tabs[0]).aphSpace, undefined);
    for (const t of g.tabs) {
      assert.equal(t.getAttribute("data-aph-space-tab"), null);
    }
    api.assignGroupToSpace(g, id);
    assert.equal(api.deleteSpace(id), true);
    assert.equal(g.getAttribute("data-aph-space"), null);
    assert.equal(g.label.getAttribute("data-aph-space-first"), null);
    assert.equal(tabVals.get(g.tabs[0]).aphSpace, undefined);
  });
});

describe("spaces repaint cost", () => {
  function countWrites(els) {
    let writes = 0;
    for (const el of els) {
      for (const m of ["setAttribute", "removeAttribute"]) {
        const orig = el[m];
        el[m] = function (...a) {
          writes++;
          return orig.apply(this, a);
        };
      }
    }
    return () => writes;
  }

  it("steady-state repaint is write-free (no O(n) attribute churn)", () => {
    const { api, tab, groups } = boot({});
    const id = api.createSpace("Perf", "1");
    const loose1 = tab("loose1", "1");
    const loose2 = tab("loose2", "1");
    const g = attrGroup([tab("p1", "1"), tab("p2", "1")], {});
    groups.push(g);
    api.assignTabToSpace(loose1, id);
    api.assignTabToSpace(loose2, id);
    api.assignGroupToSpace(g, id);
    const reads = countWrites([loose1, loose2, ...g.tabs, g, g.label]);
    api.syncSpaces("1");
    assert.equal(reads(), 0, "second identical pass must not touch attributes");
  });

  it("a real change repaints once, then settles write-free again", () => {
    const { api, tab } = boot({});
    const id = api.createSpace("Old", "1");
    const t = tab("n1", "1");
    const reads = countWrites([t]);
    api.assignTabToSpace(t, id);
    assert.ok(reads() > 0, "initial paint wrote");
    const baseline = reads();
    api.syncSpaces("1");
    assert.equal(reads(), baseline, "no new writes without a change");
    api.renameSpace(id, "New");
    assert.ok(reads() > baseline, "rename repainted the header");
    const afterRename = reads();
    api.syncSpaces("1");
    assert.equal(reads(), afterRename, "rename settles write-free too");
  });
});

describe("spaces drag-to-join listener phase", () => {
  it("drop is bubble-phase (stock placement first), hover stays capture", () => {
    const { stripListeners } = boot({});
    const drops = stripListeners.filter((l) => l.type === "drop");
    assert.equal(drops.length, 1, "one drop listener");
    assert.equal(drops[0].capture, false, "drop must run after stock's handler");
    const overs = stripListeners.filter((l) => l.type === "dragover");
    assert.ok(overs.length >= 1);
    for (const l of overs) {
      assert.equal(l.capture, true, "hover ring is layout-neutral: capture ok");
    }
    const starts = stripListeners.filter((l) => l.type === "dragstart");
    assert.ok(starts.length >= 1);
    for (const l of starts) {
      assert.equal(l.capture, true);
    }
  });

  it("stock's drop handler observes the pre-join value (assignment lands after)", () => {
    const observed = [];
    const env = boot({}, {
      stockDrop() {
        observed.push(env.api.getTabSpace(env.dragged));
      },
    });
    const { api, tab, sb } = env;
    const id = api.createSpace("Late", "1");
    const member = tab("late-member", "1");
    api.assignTabToSpace(member, id);
    const dragged = tab("late-dragged", "1");
    env.dragged = dragged;
    api.syncSpaces("1");
    const over = { target: tabTap(member) };
    sb.dragstart({ target: tabTap(dragged) });
    sb.emit("drop", over);
    assert.equal(
      observed[observed.length - 1],
      "",
      "stock handler saw the tab before the join"
    );
    assert.equal(api.getTabSpace(dragged), id, "join still applied afterwards");
    sb.dragend();
  });
});

describe("spaces drag-to-join", () => {
  function dragEnv() {
    const env = boot({});
    const { sb, api, tab } = env;
    const id = api.createSpace("Hit", "1");
    const member = tab("member", "1");
    api.assignTabToSpace(member, id);
    const dragged = tab("dragged", "1");
    api.syncSpaces("1");
    return { ...env, id, member, dragged };
  }

  it("drop on a loose folder's head (first row) assigns the dragged tab", () => {
    const { sb, api, id, member, dragged } = dragEnv();
    assert.equal(api.getTabSpace(dragged), "", "starts unassigned");
    const over = { target: tabTap(member) };
    sb.dragstart({ target: tabTap(dragged) });
    // tabContainer listeners share the boot handler map (window + strip
    // both registered; double-fire is idempotent).
    sb.emit("dragover", over);
    assert.equal(
      member.getAttribute("data-aph-space-hover"),
      "1",
      "head row rings on hover"
    );
    sb.emit("drop", over);
    assert.equal(
      api.getTabSpace(dragged),
      id,
      "dropped tab joins the space"
    );
    sb.dragend();
    assert.equal(
      member.getAttribute("data-aph-space-hover"),
      null,
      "hover ring cleared on dragend"
    );
  });

  it("non-head member rows are reorder territory: no ring, no join", () => {
    const { sb, api, tab, id } = dragEnv();
    const later = tab("later", "1");
    api.assignTabToSpace(later, id);
    api.syncSpaces("1");
    const dragged = tab("loose", "1");
    const over = { target: tabTap(later) };
    sb.dragstart({ target: tabTap(dragged) });
    sb.emit("dragover", over);
    assert.equal(later.getAttribute("data-aph-space-hover"), null, "no head, no ring");
    sb.emit("drop", over);
    assert.equal(api.getTabSpace(dragged), "", "row drop never joins");
    sb.dragend();
  });

  it("drop on a grouped folder's label-container head joins that folder", () => {
    const { sb, api, tab, groups } = dragEnv();
    const m1 = tab("m1", "1");
    const m2 = tab("m2", "1");
    const g = attrGroup([m1, m2], {});
    groups.push(g);
    const cid = api.createSpace("Grouped", "1");
    api.assignGroupToSpace(g, cid);
    api.syncSpaces("1");
    const dragged = tab("loosecard", "1");
    const over = { target: labelTap(g) };
    sb.dragstart({ target: tabTap(dragged) });
    sb.emit("dragover", over);
    assert.equal(
      g.label.getAttribute("data-aph-space-hover"),
      "1",
      "label head rings on hover"
    );
    sb.emit("drop", over);
    assert.equal(api.getTabSpace(dragged), cid, "head drop joins the group's folder");
    sb.dragend();
    assert.equal(g.label.getAttribute("data-aph-space-hover"), null);
  });

  it("same-space head drop stays a stock reorder (no reassign), untracked drops do nothing", () => {
    const { sb, api, id, member } = dragEnv();
    // No dragstart: un-tracked drop (strip gap / unrelated payload).
    const over = { target: tabTap(member) };
    sb.emit("drop", over);
    assert.equal(api.getTabSpace(member), id, "own-space drop is a no-op");
    assert.equal(member.getAttribute("data-aph-space-hover"), null);
    sb.dragend();
  });
});

describe("spaces hold loose tabs", () => {
  it("stamps the enclosure on loose members, header on the first only", () => {
    const { api, tab } = boot({});
    const id = api.createSpace("🎓 Academics", "1");
    const m1 = tab("m1", "1");
    const m2 = tab("m2", "1");
    const m3 = tab("m3", "1");
    assert.equal(api.assignTabToSpace(m1, id), true);
    assert.equal(api.assignTabToSpace(m2, id), true);
    api.syncSpaces("1");
    for (const t of [m1, m2]) {
      assert.equal(t.getAttribute("data-aph-space-tab"), "1");
      assert.equal(t.getAttribute("data-aph-space"), id);
    }
    assert.equal(m1.getAttribute("data-aph-space-first"), "1");
    assert.equal(m1.getAttribute("data-aph-space-name"), "🎓 Academics");
    assert.equal(m2.getAttribute("data-aph-space-first"), null);
    assert.equal(m2.getAttribute("data-aph-space-name"), null, "name is header-only");
    assert.equal(m3.getAttribute("data-aph-space-tab"), null, "untagged tab stays clean");
  });

  it("grouped members paint like loose rows; the label hosts the header", () => {
    const { api, tab, groups } = boot({});
    const id = api.createSpace("Grouped", "1");
    const m1 = tab("m1", "1");
    const m2 = tab("m2", "1");
    const g = attrGroup([m1, m2], {});
    groups.push(g);
    api.assignGroupToSpace(g, id);
    assert.equal(g.getAttribute("data-aph-space"), "1", "quieting hook only");
    for (const m of [m1, m2]) {
      assert.equal(m.getAttribute("data-aph-space-tab"), "1", "rows paint");
      assert.equal(m.getAttribute("data-aph-space"), id);
      assert.equal(m.getAttribute("data-aph-space-name"), null);
    }
    assert.equal(g.label.getAttribute("data-aph-space-first"), "1");
    assert.equal(g.label.getAttribute("data-aph-space-name"), "Grouped");
    // Loose member of the same space later in the strip: the label already
    // led (earliest element wins), so the loose row stays nameless.
    const loose = tab("loose", "1");
    api.assignTabToSpace(loose, id);
    assert.equal(loose.getAttribute("data-aph-space-tab"), "1");
    assert.equal(loose.getAttribute("data-aph-space-first"), null);
    assert.equal(loose.getAttribute("data-aph-space-name"), null);
  });

  it("loose tab claims the header when it precedes the group", () => {
    const { api, tab, groups } = boot({});
    const id = api.createSpace("Mixed", "1");
    const loose = tab("loose", "1");
    const gm = tab("gm", "1");
    const g = attrGroup([gm], {});
    groups.push(g);
    api.assignTabToSpace(loose, id);
    api.assignGroupToSpace(g, id);
    assert.equal(loose.getAttribute("data-aph-space-first"), "1");
    assert.equal(loose.getAttribute("data-aph-space-name"), "Mixed");
    assert.equal(g.getAttribute("data-aph-space"), "1", "group still quieted");
    assert.equal(g.label.getAttribute("data-aph-space-first"), null);
    assert.equal(g.label.getAttribute("data-aph-space"), null);
  });

  it("a head that loses the lead is wiped", () => {
    const { api, tab } = boot({});
    const id = api.createSpace("Move", "1");
    const early = tab("early", "1");
    const late = tab("late", "1");
    api.assignTabToSpace(late, id);
    assert.equal(late.getAttribute("data-aph-space-first"), "1");
    assert.equal(late.getAttribute("data-aph-space-name"), "Move");
    api.assignTabToSpace(early, id);
    assert.equal(early.getAttribute("data-aph-space-first"), "1");
    assert.equal(early.getAttribute("data-aph-space-name"), "Move");
    assert.equal(late.getAttribute("data-aph-space-first"), null, "displaced head wiped");
    assert.equal(late.getAttribute("data-aph-space-name"), null);
    assert.equal(late.getAttribute("data-aph-space-tab"), "1", "still a member");
  });

  it("a label-container head gives way to an earlier loose member", () => {
    const { api, tab, groups } = boot({});
    const id = api.createSpace("Lead", "1");
    const loose = tab("loose", "1");
    const gm = tab("gm", "1");
    const g = attrGroup([gm], {});
    groups.push(g);
    api.assignGroupToSpace(g, id);
    assert.equal(g.label.getAttribute("data-aph-space-first"), "1");
    api.assignTabToSpace(loose, id);
    assert.equal(loose.getAttribute("data-aph-space-first"), "1");
    assert.equal(loose.getAttribute("data-aph-space-name"), "Lead");
    assert.equal(g.label.getAttribute("data-aph-space-first"), null, "label head wiped");
    assert.equal(g.label.getAttribute("data-aph-space"), null, "drop head released");
    assert.equal(g.getAttribute("data-aph-space"), "1", "group stays quieted");
  });

  it("assignment gates: unknown folder, pinned, cross-workspace", () => {
    const { api, tab } = boot({});
    const id = api.createSpace("WS1", "1");
    assert.equal(api.assignTabToSpace(tab("x", "1"), ""), false, "no id");
    assert.equal(api.assignTabToSpace(tab("x", "1"), "sp-ghost"), false, "unknown id");
    const pinned = tab("pin", "1");
    pinned.pinned = true;
    assert.equal(api.assignTabToSpace(pinned, id), false);
    assert.equal(api.assignTabToSpace(tab("w2", "2"), id), false);
  });

  it("unassign clears and reports, deletions catch valuless strays", () => {
    const { api, tab, tabVals } = boot({});
    const id = api.createSpace("Gone", "1");
    const t = tab("solo", "1");
    assert.equal(api.unassignTabFromSpace(t), false);
    api.assignTabToSpace(t, id);
    assert.equal(api.unassignTabFromSpace(t), true);
    assert.equal(api.unassignTabFromSpace(t), false);
    assert.ok(!tabVals.get(t).aphSpace);
    assert.equal(api.deleteSpace(id), true);
  });

  it("rename repaints the header without reassigning", () => {
    const { api, tab, groups } = boot({});
    const id = api.createSpace("Hued", "1");
    const loose = tab("hue", "1");
    const props = {};
    loose.style = { setProperty(k, v) { props[k] = v; } };
    api.assignTabToSpace(loose, id);
    assert.ok(props["--aph-space-hue"], "hue inline var stamped");
    const h = Number(props["--aph-space-hue"]);
    assert.ok(Number.isInteger(h) && h >= 0 && h < 360);
    delete loose.style;
    api.syncSpaces("1"); // styleless tab: guard skips, paint still on
    assert.equal(loose.getAttribute("data-aph-space-tab"), "1");
  });

  it("getTabSpace exposes the raw membership value", () => {
    const { api, tab, tabVals } = boot({});
    const id = api.createSpace("Read", "1");
    const t = tab("r", "1");
    assert.equal(api.getTabSpace(t), "");
    api.assignTabToSpace(t, id);
    assert.equal(api.getTabSpace(t), id);
  });
});
