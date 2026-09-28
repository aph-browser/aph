// Aph settings page logic (branding/settings-page.js): defaults match the
// seed-once prefs, staleness clamps, and malformed JSON never throws.
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { run } = require("./helpers");

const sb = {
  window: {},
  document: {
    readyState: "complete",
    getElementById: () => null,
    addEventListener() {},
  },
  Services: { prefs: {}, obs: {} },
};
run("settings-page.js", sb);
const L = sb.AphSettingsLogic;
assert.ok(L, "AphSettingsLogic global missing");
// deepStrictEqual fails across the node:vm realm boundary (objects built
// inside the sandbox carry the sandbox Object prototype), so compare the
// serialized form instead (same as archive.test.js).
function assertJsonEqual(actual, expected) {
  assert.equal(JSON.stringify(actual), JSON.stringify(expected));
}

describe("bool defaults match user-overrides.js", () => {
  it("has the six behavior toggles with seed-once defaults", () => {
    assertJsonEqual(L.BOOL_DEFAULTS, {
      "aph.workspaces.unloadOnSwitch": false,
      "aph.archive.autoEnabled": false,
      "aph.addons.silenceFirstRun": true,
      "aph.pins.ctrlWUnloads": true,
      "aph.stars.ctrlWUnloads": true,
      "aph.sidebar.hideFooter": true,
    });
  });

  it("every toggle is rendered exactly once via GROUPS", () => {
    const rendered = [];
    for (const g of L.GROUPS) {
      for (const r of g.rows || []) {
        if (r.kind === "bool") {
          rendered.push(r.pref);
        }
      }
    }
    assertJsonEqual(rendered.sort(), Object.keys(L.BOOL_DEFAULTS).sort());
  });
});

describe("staleMin clamp", () => {
  it("floors fractions, clamps to 0..1440, falls back to 5", () => {
    assert.equal(L.clampStaleMin(5.9), 5);
    assert.equal(L.clampStaleMin(-3), 0);
    assert.equal(L.clampStaleMin(99999), 1440);
    assert.equal(L.clampStaleMin("nope"), L.STALE_DEFAULT);
    assert.equal(L.clampStaleMin(undefined), L.STALE_DEFAULT);
    assert.equal(L.STALE_DEFAULT, 5);
  });
});

describe("JSON guards", () => {
  it("parses objects, rejects arrays/primals/garbage", () => {
    assertJsonEqual(L.parseJsonObject('{"2":"Work"}'), { 2: "Work" });
    assertJsonEqual(L.parseJsonObject(""), {});
    assertJsonEqual(L.parseJsonObject("["), {});
    assertJsonEqual(L.parseJsonObject("[1,2]"), {});
    assertJsonEqual(L.parseJsonObject("42"), {});
    assertJsonEqual(L.parseJsonObject(null), {});
  });

  it("exposes every read-only pref key", () => {
    assert.equal(L.NAMES_PREF, "aph.workspaces.names");
    assert.equal(L.BINDINGS_PREF, "aph.workspaces.containerBindings");
    assert.equal(L.ROUTES_PREF, "aph.workspaces.domainRoutes");
    assert.equal(L.ARCHIVE_PREF, "aph.archive.tabs");
    assert.equal(L.FRECENCY_PREF, "aph.palette.frecency");
  });
});
