// Aph welcome page logic (branding/welcome-page.js): tour content covers
// the core shortcuts and the seen-flag helper never throws on odd input.
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
run("welcome-page.js", sb);
const L = sb.AphWelcomeLogic;
assert.ok(L, "AphWelcomeLogic global missing");
// deepStrictEqual fails across the node:vm realm boundary (objects built
// inside the sandbox carry the sandbox Object prototype), so compare the
// serialized form instead (same as stash.test.js).
function assertJsonEqual(actual, expected) {
  assert.equal(JSON.stringify(actual), JSON.stringify(expected));
}

describe("seen flag", () => {
  it("points at aph.welcome.seen with the chrome URL", () => {
    assert.equal(L.SEEN_PREF, "aph.welcome.seen");
    assert.equal(L.WELCOME_URL, "chrome://browser/content/aph-welcome.html");
  });

  it("shows on absent/false, hides once dismissed", () => {
    assert.equal(L.shouldShow(undefined), true);
    assert.equal(L.shouldShow(false), true);
    assert.equal(L.shouldShow(true), false);
    assert.equal(L.shouldShow(0), true);
    assert.equal(L.shouldShow("yes"), true);
  });
});

describe("tour content", () => {
  it("has workspaces, palette and tabs sections with cards", () => {
    const names = L.SECTIONS.map((g) => g.name);
    assertJsonEqual(names, ["Workspaces", "Command palette", "Tabs"]);
    for (const g of L.SECTIONS) {
      assert.ok(g.cards.length > 0, `${g.name} must not be empty`);
      for (const c of g.cards) {
        assert.ok(c.title, "every card needs a title");
      }
    }
  });

  it("teaches the core shortcuts", () => {
    const hay = JSON.stringify(L.SECTIONS);
    for (const keys of ["Alt+1", "Alt+Shift+Tab", "Ctrl+K", "?", "Ctrl+Alt+T", "Ctrl+W"]) {
      assert.ok(hay.includes(keys), `tour never teaches ${keys}`);
    }
  });
});
