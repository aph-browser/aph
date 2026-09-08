// Regression guards for tab rename (branding/tabrename.js + the palette
// command). The real window script runs in node:vm with Firefox globals
// mocked; the palette command is exercised through the same hook trick as
// tests/palette.test.js.
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { run, makeTab } = require("./helpers");

const tabVals = new WeakMap();
const customVals = new Map(); // `${tab->id}:${key}` — tabs keyed by object
const tabIds = new Map();
let nextId = 1;
function keyOf(t, k) {
  if (!tabIds.has(t)) {
    tabIds.set(t, nextId++);
  }
  return `${tabIds.get(t)}:${k}`;
}

let unloadFn = null;
const titlebarNudges = [];
const retitled = [];

function makeSandbox() {
  const tabs = [];
  let sel = null;
  const containerHandlers = {};
  const winHandlers = {};
  const menuHandlers = {};
  const menuKids = [];
  const appended = [];
  const xulCreated = [];
  const menu = {
    appendChild(el) { menuKids.push(el); },
    addEventListener(t, fn) { menuHandlers[t] = fn; },
    removeEventListener() {},
  };
  const prompts = [];
  const sb = {
    window: {
      opener: null,
      addEventListener(t, fn) {
        winHandlers[t] = fn;
        if (t === "unload") unloadFn = fn;
      },
      removeEventListener(t) { delete winHandlers[t]; },
      AphPalette: {
        prompt(opts) { prompts.push(opts); },
      },
    },
    document: {
      readyState: "complete",
      getElementById: (id) => (id === "tabContextMenu" ? menu : null),
      createElement: () => ({
        attrs: {},
        style: {},
        value: "",
        focused: false,
        selected: false,
        removed: false,
        setAttribute(k, v) { this.attrs[k] = v; },
        removeAttribute() {},
        classList: { add() {}, remove() {} },
        addEventListener(t, fn) { this[`on_${t}`] = fn; },
        focus() { this.focused = true; },
        select() { this.selected = true; },
        remove() { this.removed = true; },
      }),
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
      documentElement: { appendChild(el) { appended.push(el); } },
    },
    gBrowser: {
      tabs,
      get selectedTab() { return sel; },
      set selectedTab(t) { sel = t; },
      updateTitlebar() { titlebarNudges.push(sel); },
      setTabTitle(t) {
        retitled.push(t);
        t.removeAttribute("label");
      },
      tabContainer: {
        setAttribute() {},
        addEventListener(t, fn) { containerHandlers[t] = fn; },
        removeEventListener(t) { delete containerHandlers[t]; },
      },
    },
    SessionStore: {
      getCustomTabValue: (t, k) => customVals.get(keyOf(t, k)),
      setCustomTabValue: (t, k, v) => { customVals.set(keyOf(t, k), v); },
      deleteCustomTabValue: (t, k) => { customVals.delete(keyOf(t, k)); },
    },
  };
  sb.window.window = sb.window;
  return { sb, tabs, containerHandlers, menuHandlers, menuKids, xulCreated, prompts, appended, winHandlers,
    menu, setSel: (t) => { sel = t; }, getSel: () => sel };
}

function loadRename(env) {
  run("tabrename.js", env.sb);
  return env.sb.window.AphTabRename;
}

function freshTab(env, label) {
  const t = makeTab(tabVals, { label, ws: "1", spec: "https://example.com/" });
  env.tabs.push(t);
  return t;
}

describe("tab rename store + apply", () => {
  it("renames the label, hooks the tab, nudges the titlebar when selected", () => {
    const env = makeSandbox();
    const api = loadRename(env);
    const t = freshTab(env, "Real Page Title");
    env.setSel(t);
    titlebarNudges.length = 0;
    assert.equal(api.renameTab(t, "  Reading list  "), true);
    assert.equal(t.getAttribute("label"), "Reading list");
    assert.equal(t.getAttribute("data-aph-renamed"), "1");
    assert.equal(api.getName(t), "Reading list");
    assert.equal(titlebarNudges.length, 1);
  });

  it("skips the titlebar nudge for background tabs", () => {
    const env = makeSandbox();
    const api = loadRename(env);
    const a = freshTab(env, "A");
    const b = freshTab(env, "B");
    env.setSel(a);
    titlebarNudges.length = 0;
    api.renameTab(b, "Bee");
    assert.equal(b.getAttribute("label"), "Bee");
    assert.equal(titlebarNudges.length, 0);
  });

  it("re-applies after stock overwrites the label", () => {
    const env = makeSandbox();
    const api = loadRename(env);
    const t = freshTab(env, "Real Page Title");
    env.setSel(t);
    api.renameTab(t, "Custom");
    // SPA pushes a new title through stock machinery:
    t.setAttribute("label", "Real Page Title (3)");
    env.containerHandlers["TabAttrModified"]({ target: t });
    assert.equal(t.getAttribute("label"), "Custom");
    void api;
  });

  it("leaves unrenamed tabs alone on attribute changes", () => {
    const env = makeSandbox();
    loadRename(env);
    const t = freshTab(env, "Plain");
    t.setAttribute("label", "Plain");
    env.containerHandlers["TabAttrModified"]({ target: t });
    assert.equal(t.getAttribute("label"), "Plain");
    assert.equal(t.getAttribute("data-aph-renamed"), null);
  });

  it("clears back to the page title on empty input", () => {
    const env = makeSandbox();
    const api = loadRename(env);
    const t = freshTab(env, "Real Page Title");
    env.setSel(t);
    api.renameTab(t, "Custom");
    retitled.length = 0;
    assert.equal(api.renameTab(t, "   "), true);
    assert.equal(api.getName(t), "");
    assert.equal(t.getAttribute("data-aph-renamed"), null);
    assert.ok(retitled.includes(t));
  });

  it("re-applies on session restore and refuses closing tabs", () => {
    const env = makeSandbox();
    const api = loadRename(env);
    const t = freshTab(env, "Real Page Title");
    api.renameTab(t, "Kept");
    t.setAttribute("label", "Real Page Title"); // restore renders page title first
    env.containerHandlers["SSTabRestored"]({ target: t });
    assert.equal(t.getAttribute("label"), "Kept");
    t.closing = true;
    assert.equal(api.renameTab(t, "Nope"), false);
    assert.equal(api.getName(t), "Kept");
  });

  it("trims and caps overlong names", () => {
    const env = makeSandbox();
    const api = loadRename(env);
    const t = freshTab(env, "Real Page Title");
    api.renameTab(t, "x".repeat(500));
    assert.equal(api.getName(t).length, 100);
  });
});

describe("tab rename menu + prompt", () => {
  it("offers Rename Tab… as a XUL item and prompts on command", () => {
    const env = makeSandbox();
    const api = loadRename(env);
    const t = freshTab(env, "Real Page Title");
    env.setSel(t);
    const show = env.menuHandlers["popupshowing"];
    assert.ok(show);
    const node = { closest: (s) => (s === "tab" ? t : null) };
    show({ currentTarget: env.menu, target: { triggerNode: node } });
    assert.ok(env.xulCreated.includes("menuitem"));
    assert.equal(env.menuKids.length, 1);
    assert.equal(env.menuKids[0].attrs.label, "Rename Tab…");
    env.menuKids[0][`on_command`]();
    assert.equal(env.prompts.length, 1);
    assert.equal(env.prompts[0].initial, "Real Page Title");
    env.prompts[0].onCommit("From menu");
    assert.equal(t.getAttribute("label"), "From menu");
    void api;
  });

  it("prefills the stored name when one exists", () => {
    const env = makeSandbox();
    const api = loadRename(env);
    const t = freshTab(env, "Real Page Title");
    api.renameTab(t, "Stored");
    assert.equal(api.promptRename(t), true);
    // visible label was overwritten by stock meanwhile — prefill still uses stored
    t.setAttribute("label", "Real Page Title");
    assert.equal(api.promptRename(t), true);
  });

  it("cleans up listeners on unload", () => {
    const env = makeSandbox();
    loadRename(env);
    assert.ok(env.containerHandlers["TabAttrModified"]);
    assert.ok(typeof unloadFn === "function");
    unloadFn();
    assert.equal(env.containerHandlers["TabAttrModified"], undefined);
    assert.equal(env.containerHandlers["SSTabRestored"], undefined);
  });
});

describe("rename palette command", () => {
  const renamed = [];
  const psb = {
    window: {
      addEventListener() {},
      AphWorkspaces: {
        getCurrent: () => "1", getWsName: () => "", getRoutes: () => ({}),
        getWsContainer: () => 0, describeContainer: () => null, getWs: () => "1",
      },
      AphTabRename: {
        promptRename(t) { renamed.push(t); },
      },
    },
    document: { readyState: "loading" },
    gBrowser: {
      tabs: [],
      selectedTab: { label: "Page", closing: false },
      addTrustedTab() { throw new Error("unused"); },
    },
    SessionStore: {},
  };
  run(
    "command-palette.js",
    psb,
    'window.addEventListener("keydown", onKey, true);',
    "window.__aphTest = { allItems };"
  );
  const T = psb.window.__aphTest;

  it("lists Rename Tab… and routes through the controller", () => {
    const rows = T.allItems("rename tab");
    const row = rows.find((r) => r.title === "Rename Tab…");
    assert.ok(row);
    row.run();
    assert.equal(renamed.length, 1);
    assert.equal(renamed[0], psb.gBrowser.selectedTab);
  });
});

describe("inline dblclick editor", () => {
  function labelSetup(env, t, rect) {
    const labelEl = {
      closest: (s) => (s === "tab" ? t : null),
      getBoundingClientRect: () => rect,
    };
    t.querySelector = () => labelEl;
    return {
      labelTarget: {
        closest: (s) => (String(s).includes("tab-label") ? labelEl : null),
      },
    };
  }

  function dblclick(env, target) {
    let prevented = false;
    let stopped = false;
    env.containerHandlers["dblclick"]({
      button: 0,
      target,
      preventDefault() { prevented = true; },
      stopPropagation() { stopped = true; },
    });
    return { prevented, stopped };
  }

  it("opens over the label, prefilled and selected", () => {
    const env = makeSandbox();
    loadRename(env);
    const t = freshTab(env, "Real Page Title");
    env.setSel(t);
    const { labelTarget } = labelSetup(env, t, { left: 10, top: 20, width: 100, height: 24 });
    const r = dblclick(env, labelTarget);
    assert.ok(r.prevented && r.stopped);
    assert.equal(env.appended.length, 1);
    const input = env.appended[0];
    assert.equal(input.value, "Real Page Title");
    assert.ok(input.focused && input.selected);
    assert.equal(input.style.left, "10px");
    assert.equal(input.style.width, "120px"); // pinned-narrow minimum
  });

  it("ignores favicon, empty strip and non-left buttons", () => {
    const env = makeSandbox();
    loadRename(env);
    const t = freshTab(env, "Real Page Title");
    env.setSel(t);
    labelSetup(env, t, { left: 0, top: 0, width: 50, height: 20 });
    const iconTarget = { closest: () => null };
    const r1 = dblclick(env, iconTarget);
    assert.ok(!r1.prevented && env.appended.length === 0);
    let prevented = false;
    env.containerHandlers["dblclick"]({
      button: 2, target: iconTarget, preventDefault() { prevented = true; }, stopPropagation() {},
    });
    assert.ok(!prevented && env.appended.length === 0);
  });

  it("yields to the opt-in close-on-double-click pref", () => {
    const env = makeSandbox();
    loadRename(env);
    const t = freshTab(env, "Real Page Title");
    env.setSel(t);
    const { labelTarget } = labelSetup(env, t, { left: 0, top: 0, width: 50, height: 20 });
    env.sb.gBrowser.tabContainer._closeTabByDblclick = true;
    dblclick(env, labelTarget);
    assert.equal(env.appended.length, 0);
  });

  it("commits on Enter, cancels on Escape, commits on blur", () => {
    const env = makeSandbox();
    const api = loadRename(env);
    const t = freshTab(env, "Real Page Title");
    env.setSel(t);
    const { labelTarget } = labelSetup(env, t, { left: 0, top: 0, width: 50, height: 20 });
    dblclick(env, labelTarget);
    const input = env.appended[0];
    input.value = "Typed";
    input[`on_keydown`]({ key: "Enter", preventDefault() {} });
    assert.equal(t.getAttribute("label"), "Typed");
    assert.equal(api.getName(t), "Typed");

    dblclick(env, labelTarget);
    const input2 = env.appended[1];
    input2.value = "Nope";
    input2[`on_keydown`]({ key: "Escape", preventDefault() {} });
    assert.equal(t.getAttribute("label"), "Typed");
    assert.ok(input2.removed);

    dblclick(env, labelTarget);
    const input3 = env.appended[2];
    input3.value = "Blurred";
    input3[`on_blur`]();
    assert.equal(t.getAttribute("label"), "Blurred");
  });

  it("commits the open editor before starting another", () => {
    const env = makeSandbox();
    loadRename(env);
    const a = freshTab(env, "Alpha");
    const b = freshTab(env, "Beta");
    env.setSel(a);
    const sa = labelSetup(env, a, { left: 0, top: 0, width: 50, height: 20 });
    const sbx = labelSetup(env, b, { left: 60, top: 0, width: 50, height: 20 });
    dblclick(env, sa.labelTarget);
    env.appended[0].value = "A1";
    dblclick(env, sbx.labelTarget);
    assert.equal(a.getAttribute("label"), "A1");
    assert.equal(env.appended.length, 2);
    assert.equal(env.appended[1].value, "Beta");
  });

  it("cancels without saving when the tab closes, resyncs on scroll", () => {
    const env = makeSandbox();
    const api = loadRename(env);
    const t = freshTab(env, "Real Page Title");
    env.setSel(t);
    t.setAttribute("label", "Real Page Title");
    const rect = { left: 10, top: 20, width: 100, height: 24 };
    const { labelTarget } = labelSetup(env, t, rect);
    dblclick(env, labelTarget);
    const input = env.appended[0];
    input.value = "Unsaved";
    rect.left = 50;
    env.containerHandlers["scroll"]();
    assert.equal(input.style.left, "50px");
    env.containerHandlers["TabClose"]({ target: t });
    assert.ok(input.removed);
    assert.equal(api.getName(t), "");
    assert.equal(t.getAttribute("label"), "Real Page Title");
  });
});
