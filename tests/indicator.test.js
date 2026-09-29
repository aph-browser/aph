// Nav indicator pill (branding/src/workspaces/60-indicator-switch.js,
// bundled into branding/workspaces.js): name-only readout, with the
// workspace address preserved in the tooltip.
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { run } = require("./helpers");

const HOOK = "window.__aphIndicatorTest = { updateIndicator };";

function makeEnv(names) {
  const pill = { textContent: "", title: "" };
  const store = {};
  if (names !== null) {
    store["aph.workspaces.names"] = JSON.stringify(names);
  }
  const sb = {
    window: { addEventListener() {}, opener: null },
    navigator: { onLine: true },
    document: {
      readyState: "loading",
      getElementById: (id) => (id === "aph-ws-indicator" ? pill : null),
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
  return { T, pill };
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
});
