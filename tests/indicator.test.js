// Nav indicator pill (branding/src/workspaces/60-indicator-switch.js,
// bundled into branding/workspaces.js): name-only readout, with the
// workspace address preserved in the tooltip.
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { run } = require("./helpers");

const HOOK = "window.__aphIndicatorTest = { updateIndicator };";

function makeEnv(names, o) {
  o = o || {};
  const pill = { textContent: "", title: "" };
  const store = {};
  if (names !== null) {
    store["aph.workspaces.names"] = JSON.stringify(names);
  }
  // Creation branch: when `existing` is false the pill is built by
  // ensureIndicator (nav-bar prepend + click/contextmenu wiring), and
  // later lookups resolve the built element so updateIndicator paints it.
  let created = null;
  function fakeEl() {
    return {
      children: [],
      textContent: "",
      title: "",
      listeners: {},
      setAttribute() {},
      removeAttribute() {},
      appendChild(c) { this.children.push(c); return c; },
      removeChild(c) {
        const i = this.children.indexOf(c);
        if (i !== -1) this.children.splice(i, 1);
        return c;
      },
      addEventListener(t, fn) {
        (this.listeners[t] = this.listeners[t] || []).push(fn);
      },
      fire(t, ev) {
        for (const fn of this.listeners[t] || []) fn(ev || {});
      },
    };
  }
  const navBar = {
    prepend(c) { created = c; },
  };
  const paletteCalls = { rename: 0, icon: [] };
  const sb = {
    window: {
      addEventListener() {},
      opener: null,
      AphPalette: {
        renameCurrent() { paletteCalls.rename++; },
        setWsIcon(n) { paletteCalls.icon.push(n); },
      },
    },
    navigator: { onLine: true },
    document: {
      readyState: "loading",
      getElementById: (id) => {
        if (id === "aph-ws-indicator") {
          return created || (o.existing === false ? null : pill);
        }
        if (id === "nav-bar") {
          return navBar;
        }
        return null;
      },
      createElement: () => fakeEl(),
      createTextNode: (s) => ({ text: String(s) }),
      addEventListener() {},
    },
    gBrowser: { tabs: [] },
    SessionStore: {
      getCustomTabValue: () => undefined,
      setCustomTabValue() {},
      deleteCustomTabValue() {},
      getCustomWindowValue: () => undefined,
      setCustomWindowValue() {},
    },
    Services: {
      prefs: {
        getBoolPref: () => false,
        setBoolPref() {},
        getStringPref(k, d) {
          return k in store ? store[k] : d;
        },
        setStringPref() {},
        addObserver() {},
        removeObserver() {},
      },
      obs: { addObserver() {}, removeObserver() {} },
    },
  };
  run(
    "workspaces.js",
    sb,
    'window.addEventListener("load", init, { once: true });',
    HOOK
  );
  const T = sb.window.__aphIndicatorTest;
  assert.ok(T, "indicator test hook missing");
  return { T, pill, paletteCalls, created: () => created };
}

describe("indicator pill", () => {
  it("shows just the name when the workspace is named", () => {
    const { T, pill } = makeEnv({ 1: "Work" });
    T.updateIndicator();
    assert.equal(pill.textContent, "Work");
  });

  it("keeps the number and shortcuts in the tooltip", () => {
    const { T, pill } = makeEnv({ 1: "Work" });
    T.updateIndicator();
    assert.ok(pill.title.startsWith("Workspace 1: Work"), pill.title);
    assert.ok(pill.title.includes("Alt+1..9"), pill.title);
  });

  it("falls back to the bare number when unnamed", () => {
    const { T, pill } = makeEnv({});
    T.updateIndicator();
    assert.equal(pill.textContent, "1");
    assert.ok(pill.title.startsWith("Workspace 1"), pill.title);
  });

  it("advertises both identity actions in the tooltip", () => {
    const { T, pill } = makeEnv({ 1: "Work" });
    T.updateIndicator();
    assert.ok(pill.title.includes("click to rename"), pill.title);
    assert.ok(pill.title.includes("right-click for icon"), pill.title);
  });

  it("left-click renames, right-click opens the icon picker", () => {
    const env = makeEnv({}, { existing: false });
    env.T.updateIndicator();
    const el = env.created();
    assert.ok(el, "indicator built by ensureIndicator");
    el.fire("click", {});
    assert.equal(env.paletteCalls.rename, 1);
    assert.equal(env.paletteCalls.icon.length, 0);
    let prevented = false;
    let stopped = false;
    el.fire("contextmenu", {
      preventDefault() { prevented = true; },
      stopPropagation() { stopped = true; },
    });
    assert.ok(prevented, "stock nav-bar menu suppressed on the pill");
    assert.ok(stopped, "event kept off the bar");
    assert.deepEqual(env.paletteCalls.icon, ["1"]);
    assert.equal(env.paletteCalls.rename, 1, "rename untouched by right-click");
  });

  it("right-click is fail-silent without listeners or palette", () => {
    const { T, pill } = makeEnv({});
    // Stub pill has no addEventListener and no fire: creation branch
    // never runs, updateIndicator just paints — never throws.
    T.updateIndicator();
    assert.ok(pill.title.includes("right-click for icon"), pill.title);
  });
});
