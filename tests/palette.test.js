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
  it("prioritizes Go to … first for URL-like input", () => {
    for (const q of ["github.com", "localhost:3000", "https://example.com/x"]) {
      const res = T.allItems(q);
      assert.ok(
        res[0] && res[0].title.startsWith("Go to "),
        `${q}: first row was ${res[0] && res[0].title}`
      );
    }
  });

  it("keeps the search fallback last for plain queries", () => {
    const res = T.allItems("copy");
    const last = res[res.length - 1];
    assert.ok(
      last && last.title.startsWith("Search DuckDuckGo"),
      last && last.title
    );
  });

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

describe("dock-parity bind rows", () => {
  function bindSandbox(opts) {
    const o = opts || {};
    const calls = [];
    const sb2 = {
      window: {
        addEventListener() {},
        AphWorkspaces: {
          getCurrent: () => "2",
          getWsName: () => "Work",
          getWsContainer: () => (o.bound === undefined ? 7 : o.bound),
          describeContainer: (id) =>
            id === 7 ? { name: "Personal" } : id === 8 ? { name: "Banking" } : null,
          listContainers: () => {
            if (o.noList) throw new Error("no api");
            return [
              { userContextId: 7, name: "Personal" },
              { userContextId: 8, name: "Banking" },
            ];
          },
          bindCurrentWs: () => { calls.push("bind-tab"); },
          clearWsBinding: (w) => { calls.push(`clear:${w}`); },
          setWsBinding: (w, c) => { calls.push(`set:${w}:${c}`); },
          getRoutes: () => ({}),
          setRoute: () => {},
          deleteRoute: () => {},
          getWs: () => "2",
          switchTo: () => {},
          sendTabTo: () => {},
          openBoundTab: () => {},
          openTempTab: () => {},
        },
      },
      document: { readyState: "loading" },
      gBrowser: {
        tabs: [],
        addTrustedTab: () => ({}),
        get selectedTab() {
          return {
            linkedBrowser: { currentURI: { spec: "about:newtab" } },
            userContextId: o.tabCid === undefined ? 8 : o.tabCid,
          };
        },
      },
      SessionStore: {},
    };
    if (o.private) {
      sb2.window.PrivateBrowsingUtils = { isWindowPrivate: () => true };
    }
    run(
      "command-palette.js",
      sb2,
      'window.addEventListener("keydown", onKey, true);',
      "window.__aphTest = { allItems };"
    );
    return { api: sb2.window.__aphTest, calls };
  }

  it("lists tab-source + per-container + none on 'bind'", () => {
    const { api } = bindSandbox({});
    const titles = api.allItems("bind").map((r) => r.title);
    assert.ok(
      titles.some((t) => t.includes("This Tab's Container (Banking)")),
      titles.join(" | ")
    );
    assert.ok(titles.some((t) => t === "Bind Workspace 2 (Work) · Personal to Personal"));
    assert.ok(titles.some((t) => t === "Bind Workspace 2 (Work) · Personal to Banking"));
    assert.ok(titles.some((t) => t === "Bind Workspace 2 (Work) · Personal to None (Unbound)"));
    assert.ok(titles.every((t) => !t.startsWith("Clear Current Workspace")));
  });

  it("dispatches set / clear / tab-source runs", () => {
    const { api, calls } = bindSandbox({});
    const res = api.allItems("bind");
    res.find((r) => r.title.endsWith("to Banking")).run();
    res.find((r) => r.title.endsWith("to None (Unbound)")).run();
    res.find((r) => r.title.includes("This Tab's Container")).run();
    assert.deepEqual(calls, ["set:2:8", "clear:2", "bind-tab"]);
  });

  it("states clear on containerless tabs and hides in private windows", () => {
    const { api } = bindSandbox({ tabCid: 0, bound: 0 });
    const row = api.allItems("bind").find((r) => r.title.includes("This Tab's Container"));
    assert.ok(row && row.sub.includes("containerless"), row && row.sub);
    const priv = bindSandbox({ private: true });
    assert.equal(
      priv.api.allItems("bind").filter((r) => r.title.startsWith("Bind")).length,
      0
    );
  });
});
