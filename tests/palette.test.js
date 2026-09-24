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

describe("bookmarks + history search", () => {
  function placesSandbox(opts) {
    const o = opts || {};
    const opened = [];
    const sb2 = {
      window: {
        addEventListener() {},
        AphWorkspaces: {
          getCurrent: () => "1",
          getWsName: () => "",
          getWsContainer: () => 0,
          describeContainer: () => null,
          getRoutes: () => ({}),
          setRoute: () => {},
          deleteRoute: () => {},
          getWs: () => "1",
          switchTo: () => {},
          sendTabTo: () => {},
          openBoundTab: (u, w) => { opened.push([u, w || ""]); },
          openTempTab: (u) => { opened.push([u, "temp"]); },
        },
      },
      document: { readyState: "loading" },
      gBrowser: {
        tabs: o.tabs || [],
        addTrustedTab: () => ({}),
        get selectedTab() {
          return { linkedBrowser: { currentURI: { spec: "about:newtab" } } };
        },
      },
      SessionStore: {},
    };
    if (o.places !== undefined) {
      sb2.window.AphPlaces = o.places;
    }
    if (o.private) {
      sb2.window.PrivateBrowsingUtils = { isWindowPrivate: () => true };
    }
    if (o.historySvc) {
      const svc = o.historySvc;
      sb2.Cc = {
        "@mozilla.org/browser/nav-history-service;1": { getService: () => svc },
      };
      sb2.Ci = { nsINavHistoryService: {} };
    }
    run(
      "command-palette.js",
      sb2,
      'window.addEventListener("keydown", onKey, true);',
      "window.__aphTest = { allItems, aphPlacesRowsForQuery };"
    );
    return { api: sb2.window.__aphTest, opened };
  }

  const demoPlaces = {
    searchBookmarks: (q) =>
      String(q).toLowerCase().includes("git")
        ? [{ title: "GitHub", url: "https://github.com/" }]
        : [],
    searchHistory: (q) =>
      String(q).toLowerCase().includes("git")
        ? [{ title: "GitHub Docs", url: "https://docs.github.com/" }]
        : [],
  };

  it("shows bookmarks first, then history, above the search fallback", () => {
    const { api } = placesSandbox({ places: demoPlaces });
    const res2 = api.allItems("git");
    const bm2 = res2.findIndex((r) => r.hint === "Bookmark");
    const hist2 = res2.findIndex((r) => r.hint === "History");
    const search2 = res2.findIndex((r) => r.title.startsWith("Search DuckDuckGo"));
    assert.ok(bm2 !== -1 && hist2 !== -1, res2.map((r) => `${r.title}[${r.hint}]`).join(" | "));
    assert.ok(bm2 < hist2, "bookmarks before history");
    assert.ok(hist2 < search2, "places before search fallback");
    assert.equal(res2[bm2].sub, "https://github.com/");
    assert.equal(res2[hist2].sub, "https://docs.github.com/");
  });

  it("requires 2+ chars and skips place: URIs", () => {
    const { api } = placesSandbox({
      places: {
        searchBookmarks: () => [
          { title: "Saved search", url: "place:queryType=1&sort=8" },
          { title: "OK", url: "https://example.com/" },
        ],
        searchHistory: () => [{ title: "H", url: "https://h.example/" }],
      },
    });
    assert.equal(api.aphPlacesRowsForQuery("a").length, 0);
    assert.equal(api.aphPlacesRowsForQuery("").length, 0);
    const rows = api.aphPlacesRowsForQuery("ex");
    assert.ok(rows.every((r) => !String(r.sub).startsWith("place:")), JSON.stringify(rows));
    assert.ok(rows.some((r) => r.sub === "https://example.com/"));
  });

  it("dedupes bookmark-over-history and skips open-tab URLs", () => {
    const openTab = {
      label: "GitHub",
      linkedBrowser: { currentURI: { spec: "https://github.com/" } },
    };
    const { api } = placesSandbox({
      tabs: [openTab],
      places: {
        searchBookmarks: () => [{ title: "GitHub", url: "https://github.com/" }],
        searchHistory: () => [
          { title: "GitHub", url: "https://github.com/" },
          { title: "Docs", url: "https://docs.github.com/" },
        ],
      },
    });
    const rows = api.aphPlacesRowsForQuery("git");
    const urls = rows.map((r) => r.sub);
    // Open-tab URL excluded entirely (switch via the tab row instead).
    assert.ok(!urls.includes("https://github.com/"), urls.join(","));
    assert.ok(urls.includes("https://docs.github.com/"));
  });

  it("dedupes same-URL bookmark/history to the bookmark row", () => {
    const { api } = placesSandbox({
      places: {
        searchBookmarks: () => [{ title: "Same", url: "https://dup.example/" }],
        searchHistory: () => [{ title: "Same", url: "https://dup.example/" }],
      },
    });
    const rows = api.aphPlacesRowsForQuery("dup");
    assert.equal(rows.length, 1);
    assert.equal(rows[0].hint, "Bookmark");
  });

  it("hides history in private windows but keeps bookmarks", () => {
    const { api } = placesSandbox({ places: demoPlaces, private: true });
    const rows = api.aphPlacesRowsForQuery("git");
    assert.ok(rows.some((r) => r.hint === "Bookmark"), JSON.stringify(rows));
    assert.ok(!rows.some((r) => r.hint === "History"), JSON.stringify(rows));
  });

  it("opens places via bound container, Alt+Enter via temp", () => {
    const { api, opened } = placesSandbox({ places: demoPlaces });
    const res = api.allItems("git");
    const bm = res.find((r) => r.hint === "Bookmark");
    bm.run();
    assert.deepEqual(opened[opened.length - 1], ["https://github.com/", ""]);
    bm.runInTemp();
    assert.deepEqual(opened[opened.length - 1], ["https://github.com/", "temp"]);
  });

  it("keeps Go to first for URL-like input with places after", () => {
    const { api } = placesSandbox({
      places: {
        searchBookmarks: () => [{ title: "GitHub", url: "https://github.com/" }],
        searchHistory: () => [],
      },
    });
    const res = api.allItems("github.com");
    assert.ok(res[0] && res[0].title.startsWith("Go to "), res[0] && res[0].title);
    assert.ok(res.some((r) => r.hint === "Bookmark"), res.map((r) => r.title).join(" | "));
  });

  it("queries the history service when no seam is present", () => {
    function fakeSvc() {
      const calls = [];
      const data = {
        1: [{ title: "BM Title", uri: "https://bm.example/" }],
        0: [
          { title: "Hist Title", uri: "https://hist.example/" },
          { title: "Saved", uri: "place:queryType=0" },
        ],
      };
      return {
        calls,
        getNewQuery: () => ({ searchTerms: "", setFolders() {} }),
        getNewQueryOptions: () => ({
          QUERY_TYPE_BOOKMARKS: 1,
          QUERY_TYPE_HISTORY: 0,
          SORT_BY_FRECENCY_DESCENDING: 8,
          queryType: 0,
          sortingMode: 0,
          maxResults: 0,
        }),
        executeQuery: (q, opts) => {
          calls.push([q.searchTerms, opts.queryType]);
          const rows = data[opts.queryType] || [];
          const limited = rows.slice(0, opts.maxResults || rows.length);
          return {
            root: {
              containerOpen: false,
              childCount: limited.length,
              getChild: (i) => limited[i],
            },
          };
        },
      };
    }
    const svc = fakeSvc();
    const { api } = placesSandbox({ historySvc: svc });
    const rows = api.aphPlacesRowsForQuery("he");
    assert.ok(rows.some((r) => r.sub === "https://bm.example/" && r.hint === "Bookmark"));
    assert.ok(rows.some((r) => r.sub === "https://hist.example/" && r.hint === "History"));
    assert.ok(!rows.some((r) => String(r.sub).startsWith("place:")));
    assert.ok(svc.calls.some((c) => c[1] === 1 && c[0] === "he"));
    assert.ok(svc.calls.some((c) => c[1] === 0 && c[0] === "he"));
  });

  it("returns no places without a seam or service", () => {
    const { api } = placesSandbox({});
    assert.equal(api.aphPlacesRowsForQuery("github").length, 0);
    // Commands still work — places absence never breaks the palette.
    assert.ok(api.allItems("new tab").some((r) => r.title === "New Tab"));
  });
});

describe("archive search", () => {
  function archiveSandbox(opts) {
    const o = opts || {};
    const restored = [];
    const sb2 = {
      window: {
        addEventListener() {},
        AphWorkspaces: {
          getCurrent: () => "1",
          getWsName: () => "",
          getWsContainer: () => 0,
          describeContainer: () => null,
          getRoutes: () => ({}),
          setRoute: () => {},
          deleteRoute: () => {},
          getWs: () => "1",
          switchTo: () => {},
          sendTabTo: () => {},
          openBoundTab: () => ({}),
          openTempTab: () => ({}),
        },
      },
      document: { readyState: "loading" },
      gBrowser: {
        tabs: o.tabs || [],
        addTrustedTab: () => ({}),
        get selectedTab() {
          return { linkedBrowser: { currentURI: { spec: "about:newtab" } } };
        },
      },
      SessionStore: {},
    };
    if (o.archive !== undefined) {
      sb2.window.AphArchive = o.archive;
    }
    if (o.private) {
      sb2.window.PrivateBrowsingUtils = { isWindowPrivate: () => true };
    }
    run(
      "command-palette.js",
      sb2,
      'window.addEventListener("keydown", onKey, true);',
      "window.__aphTest = { allItems, aphArchivePoolItems };"
    );
    return { api: sb2.window.__aphTest, restored };
  }

  function demoArchive(restored) {
    return {
      getEntries: () => [
        { id: "a1", title: "Quarterly Report", url: "https://docs.example.com/q3", ws: "2", cname: "Work" },
        { id: "a2", title: "Dentist booking", url: "https://dentist.example.net/", ws: "1", cname: "" },
      ],
      restoreEntry: (id, opts) => {
        restored.push([id, !!(opts && opts.keep)]);
        return { ok: true };
      },
    };
  }

  it("shows matching archive rows above the search fallback", () => {
    const restored = [];
    const { api } = archiveSandbox({ archive: demoArchive(restored) });
    const res = api.allItems("quarterly");
    const row = res.find((r) => r.hint === "Archive");
    assert.ok(row, res.map((r) => `${r.title}[${r.hint}]`).join(" | "));
    assert.equal(row.title, "Quarterly Report");
    assert.ok(row.sub.includes("https://docs.example.com/q3"), row.sub);
    assert.ok(row.sub.includes("WS 2") && row.sub.includes("Work"), row.sub);
    const search = res.findIndex((r) => r.title.startsWith("Search DuckDuckGo"));
    assert.ok(res.indexOf(row) < search, "archive before search fallback");
  });

  it("restores by id, Alt+Enter restores without consuming", () => {
    const restored = [];
    const { api } = archiveSandbox({ archive: demoArchive(restored) });
    const row = api.allItems("quarterly").find((r) => r.hint === "Archive");
    row.run();
    assert.deepEqual(restored[restored.length - 1], ["a1", false]);
    row.runInTemp();
    assert.deepEqual(restored[restored.length - 1], ["a1", true]);
  });

  it("stays out of the empty view and needs 2+ chars, skips junk", () => {
    const restored = [];
    const { api } = archiveSandbox({
      archive: {
        getEntries: () => [
          { id: "x1", title: "No URL", url: "", ws: "1", cname: "" },
          { id: "", title: "No id", url: "https://noid.example/", ws: "1", cname: "" },
          { id: "x3", title: "About page", url: "about:newtab", ws: "1", cname: "" },
          { id: "x4", title: "Good", url: "https://good.example/", ws: "1", cname: "" },
        ],
        restoreEntry: () => ({ ok: true }),
      },
    });
    assert.ok(!api.allItems("").some((r) => r.hint === "Archive"));
    assert.equal(api.aphArchivePoolItems("g").length, 0);
    assert.equal(api.aphArchivePoolItems("").length, 0);
    const rows = api.aphArchivePoolItems("go");
    assert.equal(rows.length, 1);
    assert.equal(rows[0].sub.split(" ")[0], "https://good.example/");
  });

  it("hides in private windows and skips open-tab URLs", () => {
    const openTab = {
      label: "Quarterly Report",
      linkedBrowser: { currentURI: { spec: "https://docs.example.com/q3" } },
    };
    const restored = [];
    const priv = archiveSandbox({ archive: demoArchive(restored), private: true });
    assert.equal(priv.api.aphArchivePoolItems("qu").length, 0);
    assert.ok(!priv.api.allItems("quarterly").some((r) => r.hint === "Archive"));
    const { api } = archiveSandbox({ archive: demoArchive(restored), tabs: [openTab] });
    assert.ok(!api.allItems("quarterly").some((r) => r.hint === "Archive"));
  });

  it("returns no archive rows without the controller", () => {
    const { api } = archiveSandbox({});
    assert.equal(api.aphArchivePoolItems("quarterly").length, 0);
    assert.ok(api.allItems("new tab").some((r) => r.title === "New Tab"));
  });
});

describe("sidebar footer toggle", () => {
  function footerSandbox(prefHidden) {
    const writes = [];
    const sb2 = {
      window: {
        addEventListener() {},
        AphWorkspaces: {
          getCurrent: () => "1",
          getWsName: () => "",
          getWsContainer: () => 0,
          describeContainer: () => null,
          getRoutes: () => ({}),
          setRoute: () => {},
          deleteRoute: () => {},
          getWs: () => "1",
          switchTo: () => {},
          sendTabTo: () => {},
          openBoundTab: () => ({}),
          openTempTab: () => ({}),
        },
      },
      document: { readyState: "loading" },
      gBrowser: {
        tabs: [],
        addTrustedTab: () => ({}),
        get selectedTab() {
          return { linkedBrowser: { currentURI: { spec: "about:newtab" } } };
        },
      },
      SessionStore: {},
      Services: {
        prefs: {
          getBoolPref: () => !!prefHidden,
          setBoolPref: (k, v) => { writes.push([k, !!v]); },
          setCharPref: (k, v) => { writes.push([k, String(v)]); },
        },
      },
    };
    run(
      "command-palette.js",
      sb2,
      'window.addEventListener("keydown", onKey, true);',
      "window.__aphTest = { allItems };"
    );
    return { api: sb2.window.__aphTest, writes };
  }

  it("hides by default (no Services means Show command)", () => {
    const row = T.allItems("sidebar footer").find((r) => r.title.endsWith("Sidebar Footer (Off)"));
    assert.ok(row, "footer toggle command exists");
    assert.equal(row.title, "○ Sidebar Footer (Off)");
    assert.equal(row.keepOpen, true);
  });

  it("titles follow the pref and running flips it", () => {
    const shown = footerSandbox(false);
    const hideRow = shown.api.allItems("sidebar footer").find((r) => r.title.endsWith("Sidebar Footer (On)"));
    assert.equal(hideRow.title, "✓ Sidebar Footer (On)");
    assert.doesNotThrow(() => hideRow.run());
    assert.deepEqual(shown.writes, [["aph.sidebar.hideFooter", true]]);

    const hidden = footerSandbox(true);
    const showRow = hidden.api.allItems("sidebar footer").find((r) => r.title.endsWith("Sidebar Footer (Off)"));
    assert.equal(showRow.title, "○ Sidebar Footer (Off)");
    assert.doesNotThrow(() => showRow.run());
    assert.deepEqual(hidden.writes, [["aph.sidebar.hideFooter", false]]);
  });

  it("offers blind sidebar recovery (exit hover mode)", () => {
    const row = T.allItems("exit hover").find((r) => r.title === "Show Sidebar (Exit Hover Mode)");
    assert.ok(row, "recovery command exists");
    const w = footerSandbox(true);
    const live = w.api.allItems("exit hover").find((r) => r.title === "Show Sidebar (Exit Hover Mode)");
    assert.doesNotThrow(() => live.run());
    assert.deepEqual(w.writes, [["sidebar.visibility", "always-show"]]);
  });
});

describe("exact-prefix lock", () => {
  // Tab A matches "yo" as an exact prefix but has a very long title
  // (prefix score ~598); tab B matches as an acronym (~700) without any
  // frecency. Without a structural lock, B outranks A.
  function prefixSandbox() {
    const sb2 = {
      window: {
        addEventListener() {},
        AphWorkspaces: {
          getCurrent: () => "1",
          getWsName: () => "",
          getWsContainer: () => 0,
          describeContainer: () => null,
          getRoutes: () => ({}),
          setRoute: () => {},
          deleteRoute: () => {},
          getWs: () => "1",
          switchTo: () => {},
          sendTabTo: () => {},
          openBoundTab: () => ({}),
          openTempTab: () => ({}),
        },
      },
      document: { readyState: "loading" },
      gBrowser: {
        tabs: [
          {
            label: "yo" + "x".repeat(400),
            linkedBrowser: { currentURI: { spec: "https://long.example/" } },
            lastAccessed: 2,
          },
          {
            label: "Yaks Oink",
            linkedBrowser: { currentURI: { spec: "https://yak.example/" } },
            lastAccessed: 1,
          },
        ],
        addTrustedTab: () => ({}),
        get selectedTab() {
          return { linkedBrowser: { currentURI: { spec: "about:newtab" } } };
        },
      },
      SessionStore: {},
      Services: { prefs: { getCharPref: () => "", setCharPref: () => {} } },
    };
    run(
      "command-palette.js",
      sb2,
      'window.addEventListener("keydown", onKey, true);',
      "window.__aphTest = { allItems, recordFrecency };"
    );
    return sb2.window.__aphTest;
  }

  function tabRows(api, q) {
    return api.allItems(q).filter((r) => r.section === "Tabs");
  }

  it("keeps an exact-prefix row first when a fuzzy rival scores higher", () => {
    const api = prefixSandbox();
    const res = tabRows(api, "yo");
    assert.ok(res.length >= 2, JSON.stringify(res.map((r) => r.title.slice(0, 12))));
    assert.ok(res[0].title.startsWith("yoxxx"), res[0].title.slice(0, 12));
  });

  it("holds the lock under maxed frecency on the rival", () => {
    const api = prefixSandbox();
    for (let i = 0; i < 40; i++) {
      api.recordFrecency({ title: "Yaks Oink", section: "Tabs", kind: "tab" });
    }
    const res = tabRows(api, "yo");
    assert.ok(res[0].title.startsWith("yoxxx"), res[0].title.slice(0, 12));
  });
});

describe("mode gating (zero leakage)", () => {
  it("never leaks non-tab rows into @ results", () => {
    const res = T.allItems("@new tab");
    for (const r of res) {
      assert.equal(r.section, "Tabs", r.title);
    }
  });

  it("never leaks tabs/places/nav into > results", () => {
    const res = T.allItems(">bind");
    assert.ok(res.length > 0, "bind commands exist");
    for (const r of res) {
      assert.equal(r.section, "Commands", `${r.title}[${r.section}]`);
    }
  });

  it("? lists only help rows", () => {
    const res = T.allItems("?");
    assert.ok(res.length > 0, "help rows exist");
    for (const r of res) {
      assert.equal(r.section, "Help", r.title);
    }
  });
});

describe("return-of-focus", () => {
  function focusSandbox(pageEl) {
    let created = 0;
    const order = [];
    function stubEl() {
      return {
        children: [],
        attrs: {},
        value: "",
        textContent: "",
        className: "",
        id: "",
        hidden: false,
        style: {},
        setAttribute(k, v) { this.attrs[k] = String(v); },
        removeAttribute(k) { delete this.attrs[k]; },
        appendChild(c) { this.children.push(c); return c; },
        removeChild(c) {
          const i = this.children.indexOf(c);
          if (i !== -1) this.children.splice(i, 1);
          return c;
        },
        get firstChild() { return this.children[0] || null; },
        addEventListener() {},
        querySelector() { return null; },
        scrollIntoView() {},
        focus() {},
        select() {},
        contains() { return false; },
        classList: { add() {}, remove() {}, contains() { return false; } },
      };
    }
    const sb2 = {
      window: {
        addEventListener() {},
        AphWorkspaces: {
          getCurrent: () => "1",
          getWsName: () => "",
          getWsContainer: () => 0,
          describeContainer: () => null,
          getRoutes: () => ({}),
          setRoute: () => {},
          deleteRoute: () => {},
          getWs: () => "1",
          switchTo: () => {},
          sendTabTo: () => {},
          openBoundTab: () => ({}),
          openTempTab: () => ({}),
        },
      },
      document: {
        readyState: "loading",
        activeElement: pageEl,
        contains: () => true,
        createElement: () => { created++; order.push(created); return stubEl(); },
        createTextNode: (t) => ({ text: String(t) }),
        body: { appendChild() {} },
      },
      gBrowser: {
        tabs: [],
        addTrustedTab: () => ({}),
        get selectedTab() {
          return { linkedBrowser: { currentURI: { spec: "about:newtab" } } };
        },
      },
      SessionStore: {},
    };
    run(
      "command-palette.js",
      sb2,
      'window.addEventListener("keydown", onKey, true);',
      "window.__aphTest = { open, close, isOpen };"
    );
    return sb2.window.__aphTest;
  }

  it("restores focus to the previously focused element on close", () => {
    let focused = null;
    const api = focusSandbox({ focus() { focused = "page"; }, isConnected: true });
    api.open();
    api.close();
    assert.equal(focused, "page");
  });

  it("never restores to a disconnected element", () => {
    let focused = null;
    const api = focusSandbox({ focus() { focused = "gone"; }, isConnected: false });
    api.open();
    assert.doesNotThrow(() => api.close());
    assert.equal(focused, null);
  });
});

describe("terminal history + modifier peek", () => {
  function domSandbox() {
    const created = [];
    const winHandlers = {};
    function stubEl() {
      const el = {
        children: [],
        attrs: {},
        value: "",
        textContent: "",
        className: "",
        id: "",
        hidden: false,
        style: {},
        setAttribute(k, v) { this.attrs[k] = String(v); },
        removeAttribute(k) { delete this.attrs[k]; },
        appendChild(c) { this.children.push(c); return c; },
        removeChild(c) {
          const i = this.children.indexOf(c);
          if (i !== -1) this.children.splice(i, 1);
          return c;
        },
        get firstChild() { return this.children[0] || null; },
        addEventListener(t, fn) { (this._h = this._h || {})[t] = fn; },
        querySelector() { return null; },
        scrollIntoView() {},
        focus() {},
        select() {},
        contains() { return false; },
        classList: { add() {}, remove() {}, contains() { return false; } },
      };
      created.push(el);
      return el;
    }
    const sb2 = {
      window: {
        addEventListener(t, fn) { (winHandlers[t] = winHandlers[t] || []).push(fn); },
        AphWorkspaces: {
          getCurrent: () => "1",
          getWsName: () => "",
          getWsContainer: () => 0,
          describeContainer: () => null,
          getRoutes: () => ({}),
          setRoute: () => {},
          deleteRoute: () => {},
          getWs: () => "1",
          switchTo: () => {},
          sendTabTo: () => {},
          openBoundTab: () => ({}),
          openTempTab: () => ({}),
        },
      },
      document: {
        readyState: "loading",
        activeElement: null,
        contains: () => false,
        createElement: () => stubEl(),
        createTextNode: (t) => ({ text: String(t) }),
        body: { appendChild() {} },
      },
      gBrowser: {
        tabs: [],
        addTrustedTab: () => ({}),
        get selectedTab() {
          return {
            label: "T",
            pinned: false,
            linkedBrowser: { currentURI: { spec: "https://x.example/" } },
            toggleMuteAudio() {},
          };
        },
      },
      SessionStore: {},
    };
    run(
      "command-palette.js",
      sb2,
      'window.addEventListener("keydown", onKey, true);',
      "window.__aphTest = { open, close, render };"
    );
    // build() runs lazily on open(); index created elements after that.
    // build() order: overlay, box, input, list, footer.
    return { api: sb2.window.__aphTest, created, winHandlers };
  }

  function key(k, extra) {
    return Object.assign(
      { key: k, preventDefault() {}, stopPropagation() {}, altKey: false, shiftKey: false, ctrlKey: false, metaKey: false },
      extra || {}
    );
  }

  it("recalls the last committed query on empty ArrowUp", () => {
    const { api, created } = domSandbox();
    api.open();
    const input = created[2];
    input.value = "mute";
    api.render("mute");
    input._h.keydown(key("Enter"));
    assert.ok(input.value === "mute", "commit keeps the query in the field");
    api.open();
    assert.equal(input.value, "");
    input._h.keydown(key("ArrowUp"));
    assert.equal(input.value, "mute");
  });

  it("morphs the footer while Alt is held and restores on release", () => {
    const { api, created, winHandlers } = domSandbox();
    api.open();
    const input = created[2];
    const footer = created[4];
    const base = String(footer.textContent || "");
    assert.ok(base.length > 0, "footer has a mode hint");
    input._h.keydown(key("Alt"));
    const peeked = String(footer.textContent || "");
    assert.ok(peeked !== base, `footer peeked: ${peeked}`);
    assert.ok(/↵/.test(peeked), `peek shows Enter action: ${peeked}`);
    for (const fn of winHandlers.keyup || []) {
      fn(key("Alt"));
    }
    assert.equal(String(footer.textContent || ""), base);
  });
});
