// Regression guards for palette matching + navigation (branding/command-palette.js).
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { run } = require("./helpers");

const opened = [];
const sb = {
  window: {
    addEventListener() {},
    AphWorkspaces: {
      getCurrent: () => "1",
      getWsName: () => "",
      setWsName: () => true,
      getRoutes: () => ({ "github.com": "2" }),
      matchRoute: (h) =>
        h === "github.com" || h.endsWith(".github.com")
          ? { pattern: "github.com", ws: "2" }
          : null,
      setRoute: () => {},
      deleteRoute: () => {},
      getWsContainer: () => 0,
      describeContainer: () => null,
      getWs: () => "1",
      switchTo: () => {},
      sendTabTo: () => {},
      openBoundTab: (u, w) => { opened.push([u, w]); },
      openTempTab: (u) => { opened.push([u, "temp"]); },
    },
  },
  document: { readyState: "loading" },
  gBrowser: {
    tabs: [],
    addTrustedTab: () => { throw new Error("should route via api"); },
    get selectedTab() {
      return { linkedBrowser: { currentURI: { spec: "about:newtab" } } };
    },
  },
  SessionStore: {},
};
run(
  "command-palette.js",
  sb,
  'window.addEventListener("keydown", onKey, true);',
  "window.__aphTest = { isLikelyURL, navFallback, allItems, fuzzyScore };"
);
const T = sb.window.__aphTest;

describe("fuzzy tiers", () => {
  it("orders prefix > acronym > mid-word substring > plain subsequence", () => {
    const pre = T.fuzzyScore("new", "New Tab").score;
    const acr = T.fuzzyScore("nt", "New Tab").score;
    const mid = T.fuzzyScore("new", "Renew certs").score;
    const seq = T.fuzzyScore("nwt", "New Tab").score;
    assert.ok(pre > acr && acr > mid && mid > seq, `${pre} > ${acr} > ${mid} > ${seq}`);
  });

  it("ranks w2 -> Switch and nt -> New Tab first", () => {
    const w2 = T.allItems("w2");
    assert.ok(
      w2[0] && w2[0].title.startsWith("Switch to Workspace 2"),
      w2[0] && w2[0].title
    );
    const nt = T.allItems("nt");
    assert.ok(nt[0] && nt[0].title === "New Tab", nt[0] && nt[0].title);
  });

  it("finds the text picker on 'copy'", () => {
    const res = T.allItems("copy");
    assert.ok(
      res[0] && res[0].title.startsWith("Copy Text From Page"),
      res[0] && res[0].title
    );
  });
});

describe("URL detection", () => {
  it("accepts hosts and LAN IPs, rejects versions", () => {
    assert.equal(T.isLikelyURL("github.com"), true);
    assert.equal(T.isLikelyURL("localhost:3000"), true);
    assert.equal(T.isLikelyURL("192.168.1.1"), true);
    assert.equal(T.isLikelyURL("v1.2.3"), false);
    assert.equal(T.isLikelyURL("1.2"), false);
    assert.equal(T.isLikelyURL("how do i center a div"), false);
  });
});

describe("direct-to-route navigation", () => {
  it("opens bound hosts directly in the routed workspace", () => {
    const fb = T.navFallback("github.com");
    assert.ok(fb.sub.includes("auto-routes to WS 2"), fb.sub);
    fb.run();
    assert.deepEqual(opened[opened.length - 1], ["https://github.com", "2"]);
  });

  it("leaves temp tabs and unrouted hosts alone", () => {
    const fb = T.navFallback("github.com");
    fb.runInTemp();
    assert.deepEqual(opened[opened.length - 1], ["https://github.com", "temp"]);
    const plain = T.navFallback("example.com");
    plain.run();
    assert.equal(opened[opened.length - 1][0], "https://example.com");
    assert.ok(!opened[opened.length - 1][1]);
  });
});
