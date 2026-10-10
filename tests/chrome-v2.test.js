// Regression guards for the v2 chrome controller
// (branding/src/workspaces/115-chrome-v2.js + theme.css §29).
// Always on: the attribute is stamped unconditionally, reload + stop
// move to the urlbar slot. No pref, no toggle.
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { run } = require("./helpers");

function makeStyle() {
  const props = {};
  return {
    props,
    setProperty(k, v) { props[k] = String(v); },
    removeProperty(k) { delete props[k]; },
    getPropertyValue(k) { return props[k] || ""; },
  };
}

function makeEnv(querySlot = true) {
  const rootAttrs = {};
  const docEl = {
    setAttribute(k, v) { rootAttrs[k] = String(v); },
    removeAttribute(k) { delete rootAttrs[k]; },
    hasAttribute(k) { return k in rootAttrs; },
    getAttribute(k) { return k in rootAttrs ? rootAttrs[k] : null; },
    appendChild() {},
  };
  // Birth seats: reload/stop live in the bar cluster; the urlbar slot
  // starts empty.
  const barKids = [];
  const reload = {
    id: "reload-button", parentNode: null, nextSibling: null, style: makeStyle(),
  };
  const stop = {
    id: "stop-button", parentNode: null, nextSibling: null, style: makeStyle(),
  };
  const bar = {
    appendChild(el) { el.parentNode = bar; barKids.push(el); },
    insertBefore(el, ref) {
      el.parentNode = bar;
      const i = ref ? barKids.indexOf(ref) : -1;
      if (i === -1) barKids.push(el);
      else barKids.splice(i, 0, el);
    },
  };
  const slot = {
    appendChild(el) { el.parentNode = slot; },
  };
  bar.appendChild(reload);
  bar.appendChild(stop);
  const sb = {
    window: {
      addEventListener() {},
      removeEventListener() {},
    },
    document: {
      readyState: "complete",
      documentElement: docEl,
      getElementById: (id) => {
        if (id === "reload-button") return reload;
        if (id === "stop-button") return stop;
        return null;
      },
      querySelector: (sel) => (sel === ".urlbar-input-container" && querySlot ? slot : null),
      createElement: () => ({ setAttribute() {}, style: makeStyle() }),
    },
    gBrowser: {
      tabs: [],
      tabContainer: {
        addEventListener() {},
        removeEventListener() {},
        setAttribute() {},
      },
    },
    SessionStore: {
      getCustomTabValue: () => undefined,
      setCustomTabValue() {},
      deleteCustomTabValue() {},
    },
    Services: {
      prefs: {
        getBoolPref: (k, d) => d,
        addObserver() {},
        removeObserver() {},
      },
      obs: { addObserver() {}, removeObserver() {} },
    },
  };
  sb.window.window = sb.window;
  run("workspaces.js", sb);
  return { sb, bar, reload, stop, rootAttrs };
}

describe("chrome v2 controller", () => {
  it("stamps unconditionally and moves reload+stop to the urlbar", () => {
    const env = makeEnv();
    assert.equal(env.rootAttrs["data-aph-chrome-v2"], "1");
    const slot = env.sb.document.querySelector(".urlbar-input-container");
    assert.equal(env.reload.parentNode, slot);
    assert.equal(env.stop.parentNode, slot);
  });

  it("fails open with missing anchors", () => {
    // No urlbar slot: load must not throw and the buttons stay home.
    const env = makeEnv(false);
    assert.equal(env.rootAttrs["data-aph-chrome-v2"], "1");
    assert.equal(env.reload.parentNode, env.bar);
    assert.equal(env.stop.parentNode, env.bar);
  });
});
