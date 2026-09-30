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
  it("has the eight behavior toggles with seed-once defaults", () => {
    assertJsonEqual(L.BOOL_DEFAULTS, {
      "aph.workspaces.unloadOnSwitch": false,
      "aph.archive.autoEnabled": false,
      "aph.addons.silenceFirstRun": true,
      "aph.pins.ctrlWUnloads": true,
      "aph.stars.ctrlWUnloads": true,
      "aph.sidebar.hideFooter": true,
      "identity.fxaccounts.enabled": false,
      "signon.rememberSignons": false,
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

describe("backup round-trip", () => {
  const reader = {
    bool: (k, d) => {
      const fixed = {
        "aph.workspaces.unloadOnSwitch": true,
        "aph.archive.autoEnabled": false,
        "aph.addons.silenceFirstRun": true,
        "aph.pins.ctrlWUnloads": true,
        "aph.stars.ctrlWUnloads": false,
        "aph.sidebar.hideFooter": true,
        "identity.fxaccounts.enabled": true,
        "signon.rememberSignons": false,
      };
      return k in fixed ? fixed[k] : d;
    },
    int: () => 12,
    json: (k) =>
      k === L.ARCHIVE_PREF
        ? [{ id: "a", url: "https://a.example/", title: "A" }]
        : { "2": "Work" },
  };

  it("builds a versioned backup covering every pref", () => {
    const b = L.buildBackup(reader);
    assert.equal(b.aphBackup, 1);
    assert.equal(typeof b.exportedAt, "string");
    assert.equal(b.prefs["aph.workspaces.unloadOnSwitch"], true);
    assert.equal(b.prefs["aph.stars.ctrlWUnloads"], false);
    assert.equal(b.prefs["aph.archive.autoStaleMin"], 12);
    assertJsonEqual(b.prefs[L.ARCHIVE_PREF], [
      { id: "a", url: "https://a.example/", title: "A" },
    ]);
    assertJsonEqual(b.prefs[L.NAMES_PREF], { 2: "Work" });
  });

  it("survives a stringify/parse round-trip", () => {
    const r = L.parseBackup(JSON.stringify(L.buildBackup(reader)));
    assert.equal(r.ok, true);
    assertJsonEqual(r.prefs, L.buildBackup(reader).prefs);
  });

  it("rejects garbage, wrong versions and mistyped keys", () => {
    assert.equal(L.parseBackup("nope").ok, false);
    assert.equal(L.parseBackup("[1,2]").ok, false);
    assert.equal(L.parseBackup('{"a":1}').ok, false);
    assert.equal(
      L.parseBackup('{"aphBackup":2,"prefs":{}}').ok,
      false
    );
    assert.equal(
      L.parseBackup('{"aphBackup":1,"prefs":{"aph.pins.ctrlWUnloads":"yes"}}').ok,
      false
    );
    assert.equal(
      L.parseBackup('{"aphBackup":1,"prefs":{"aph.archive.autoStaleMin":"soon"}}').ok,
      false
    );
    assert.equal(
      L.parseBackup('{"aphBackup":1,"prefs":{"aph.workspaces.names":[]}}').ok,
      false
    );
    assert.equal(
      L.parseBackup('{"aphBackup":1,"prefs":{"aph.archive.tabs":{}}}').ok,
      false
    );
  });

  it("ignores unknown keys and tolerates missing ones", () => {
    const r = L.parseBackup(
      '{"aphBackup":1,"prefs":{"aph.pins.ctrlWUnloads":false,"future.pref":42}}'
    );
    assert.equal(r.ok, true);
    assertJsonEqual(r.prefs, { "aph.pins.ctrlWUnloads": false });
  });

  it("drops junk archive entries instead of rejecting the file", () => {
    const r = L.parseBackup(
      '{"aphBackup":1,"prefs":{"aph.archive.tabs":[' +
        '{"id":"a","url":"https://a.example/"},' +
        '{"id":"b"},null,"junk"]}}'
    );
    assert.equal(r.ok, true);
    assertJsonEqual(r.prefs[L.ARCHIVE_PREF], [{ id: "a", url: "https://a.example/" }]);
  });

  it("summarizes imports for the confirm dialog", () => {
    const s = L.summarizeBackup({
      "aph.workspaces.names": { 1: "A", 2: "B" },
      "aph.workspaces.containerBindings": {},
      "aph.workspaces.domainRoutes": { "github.com": "2" },
      "aph.archive.tabs": [{}, {}],
      "aph.pins.ctrlWUnloads": true,
      "aph.archive.autoStaleMin": 5,
    });
    assert.ok(s.includes("2 workspace names"), s);
    assert.ok(s.includes("1 route"), s);
    assert.ok(s.includes("2 archived tabs"), s);
    assert.ok(s.includes("2 settings"), s);
    assert.equal(L.summarizeBackup({}), "no Aph prefs");
  });
});
