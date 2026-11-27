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
  "window.__aphTest = { isLikelyURL, navFallback, allItems, fuzzyScore, iconRows, ctrlKBlockedByFocus };"
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

  it("ranks #w2 -> Switch and nt -> New Tab first", () => {
    const w2 = T.allItems("#w2");
    assert.ok(
      w2[0] && w2[0].title.startsWith("Switch to Workspace 2"),
      w2[0] && w2[0].title
    );
    const nt = T.allItems("nt");
    assert.ok(nt[0] && nt[0].title === "New Tab", nt[0] && nt[0].title);
  });

  it("finds copy commands on 'copy'", () => {
    const res = T.allItems("copy");
    assert.ok(
      res[0] && res[0].title.startsWith("Copy"),
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

  it("lists tab-source + per-container + none on '#bind' and drill-down on 'bind'", () => {
    const { api } = bindSandbox({});
    const rootTitles = api.allItems("bind").map((r) => r.title);
    assert.ok(rootTitles.includes("Bind Workspace to Container…"), rootTitles.join(" | "));
    const titles = api.allItems("#bind").map((r) => r.title);
    assert.ok(
      titles.some((t) => t.includes("This Tab's Container (Banking)")),
      titles.join(" | ")
    );
    assert.ok(titles.some((t) => t === "Bind Work (2) · Personal to Personal"));
    assert.ok(titles.some((t) => t === "Bind Work (2) · Personal to Banking"));
    assert.ok(titles.some((t) => t === "Bind Work (2) · Personal to None (Unbound)"));
    assert.ok(titles.every((t) => !t.startsWith("Clear Current Workspace")));
  });

  it("dispatches set / clear / tab-source runs", () => {
    const { api, calls } = bindSandbox({});
    const res = api.allItems("#bind");
    res.find((r) => r.title.endsWith("to Banking")).run();
    res.find((r) => r.title.endsWith("to None (Unbound)")).run();
    res.find((r) => r.title.includes("This Tab's Container")).run();
    assert.deepEqual(calls, ["set:2:8", "clear:2", "bind-tab"]);
  });

  it("states clear on containerless tabs and hides in private windows", () => {
    const { api } = bindSandbox({ tabCid: 0, bound: 0 });
    const row = api.allItems("#bind").find((r) => r.title.includes("This Tab's Container"));
    assert.ok(row && row.sub.includes("containerless"), row && row.sub);
    const priv = bindSandbox({ private: true });
    assert.equal(
      priv.api.allItems("#bind").filter((r) => r.title.startsWith("Bind")).length,
      0
    );
    assert.ok(!priv.api.allItems("bind").some((r) => r.title === "Bind Workspace to Container…"));
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
          getWsIcon: () => "",
          setWsIcon: () => true,
          wsIconKeys: () => [],
          wsIconLabel: (k) => k,
          wsIconSvg: () => null,
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
    if (o.searchEngine) {
      sb2.Services = { search: { defaultEngine: o.searchEngine } };
    }
    run(
      "command-palette.js",
      sb2,
      'window.addEventListener("keydown", onKey, true);',
      "window.__aphTest = { allItems, aphPlacesRowsForQuery, navFallback };"
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

  it("uses the configured default search engine for the fallback", () => {
    const engine = {
      name: "Kagi",
      queryCharset: "UTF-8",
      getSubmission(q) {
        return { uri: { spec: `https://kagi.com/search?q=${encodeURIComponent(q)}` } };
      },
    };
    const { api } = placesSandbox({ searchEngine: engine });
    const fb = api.navFallback("privacy browser");
    assert.equal(fb.title, 'Search Kagi for: "privacy browser"');
    assert.ok(
      fb.sub.startsWith("https://kagi.com/search?q=privacy%20browser"),
      fb.sub
    );
    const res = api.allItems("privacy browser");
    const last = res[res.length - 1];
    assert.ok(last && last.title.startsWith("Search Kagi"), last && last.title);
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
      assert.ok(
        r.section === "Commands" || r.section === "Workspaces",
        `${r.title}[${r.section}]`
      );
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

describe("terminal history", () => {
  function domSandbox() {
    const created = [];
    const iconCommits = [];
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
          getWsIcon: () => "",
          setWsIcon: (n, k) => { iconCommits.push([n, k]); return true; },
          wsIconKeys: () => ["briefcase", "mail"],
          wsIconLabel: (k) => (k === "mail" ? "Mail" : "Briefcase"),
          wsIconSvg: () => null,
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
      "window.__aphTest = { open, close, render, startIconPick };"
    );
    // build() runs lazily on open(); index created elements after that.
    // build() order: overlay, box, input, list, footer.
    return { api: sb2.window.__aphTest, created, winHandlers, iconCommits };
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

  it("redundant open keeps the typed query instead of replaying", () => {
    const { api, created } = domSandbox();
    api.open();
    const input = created[2];
    input.value = "mail";
    api.render("mail");
    api.open();
    assert.equal(input.value, "mail", "second open must not wipe the query");
  });

describe("workspace icon picker", () => {
  function itemRows(list) {
    return list.children.filter((c) => String(c.className || "").startsWith("aph-palette-item"));
  }

  it("opens the mark grid with a None row", () => {
    const { api, created } = domSandbox();
    api.open();
    api.startIconPick("2");
    const list = created.find((e) => e.id === "aph-palette-list");
    const rows = itemRows(list);
    assert.equal(rows.length, 3, "2 marks + None");
  });

  it("filters by key and label as you type", () => {
    const { api, created } = domSandbox();
    api.open();
    api.startIconPick("2");
    const input = created.find((e) => e.id === "aph-palette-input");
    const list = created.find((e) => e.id === "aph-palette-list");
    input.value = "mail";
    api.render("mail");
    assert.equal(itemRows(list).length, 1);
    input.value = "zzz";
    api.render("zzz");
    assert.equal(itemRows(list).length, 0);
    input.value = "none";
    api.render("none");
    assert.equal(itemRows(list).length, 1);
  });

  it("commits the highlighted mark on Enter", () => {
    const { api, created, iconCommits } = domSandbox();
    api.open();
    api.startIconPick("2");
    const input = created[2];
    input.value = "mail";
    api.render("mail");
    input._h.keydown(key("Enter"));
    assert.deepEqual(iconCommits, [["2", "mail"]]);
  });

  it("clears back to the number from the None row", () => {
    const { api, created, iconCommits } = domSandbox();
    api.open();
    api.startIconPick("2");
    const input = created[2];
    input.value = "none";
    api.render("none");
    input._h.keydown(key("Enter"));
    assert.deepEqual(iconCommits, [["2", ""]]);
  });

  it("cancels on Escape without committing", () => {
    const { api, created, iconCommits } = domSandbox();
    api.open();
    api.startIconPick("2");
    const input = created[2];
    input._h.keydown(key("Escape"));
    assert.deepEqual(iconCommits, []);
  });

  it("lists a Set Icon command for the current workspace", () => {
    const rows = T.allItems("set icon");
    assert.ok(
      rows.some((r) => r.title.startsWith("Set Icon for Workspace 1")),
      rows.map((r) => r.title).join(" | ")
    );
  });

  it("exposes icon rows with mark keys", () => {
    const api = {
      wsIconKeys: () => ["briefcase", "mail"],
      wsIconLabel: (k) => k,
      getWsIcon: () => "mail",
    };
    const rows = T.iconRows(api, "2", "");
    assert.equal(rows.length, 3);
    assert.equal(rows[0].iconKey, "briefcase");
    assert.equal(rows[1].hint, "Current");
    assert.equal(rows[2].title, "None");
  });

  it("matches search aliases like home for house", () => {
    const api = {
      wsIconKeys: () => ["house", "mail"],
      wsIconLabel: (k) => (k === "house" ? "Home" : "Mail"),
      wsIconSearch: (k) => (k === "house" ? "home" : ""),
      getWsIcon: () => "",
    };
    const rows = T.iconRows(api, "1", "home");
    assert.equal(rows.length, 1);
    assert.equal(rows[0].iconKey, "house");
  });
});
});

describe("duplicate tabs + workspace markdown", () => {
  function dupTab(label, spec, o) {
    return {
      label,
      closing: false,
      pinned: !!(o && o.pinned),
      soundPlaying: !!(o && o.soundPlaying),
      audible: !!(o && o.audible),
      _ws: (o && o.ws) || "1",
      linkedBrowser: { currentURI: { spec } },
    };
  }

  function dupSandbox(tabs, selected) {
    const copied = [];
    const removed = [];
    const sb2 = {
      window: {
        addEventListener() {},
        AphWorkspaces: {
          getCurrent: () => "1",
          getWsName: () => "",
          getWs: (t) => (t && t._ws) || "1",
          getWsContainer: () => 0,
          describeContainer: () => null,
        },
      },
      document: { readyState: "loading" },
      gBrowser: {
        tabs,
        selectedTab: selected,
        removeTab(t) {
          removed.push(t);
          t.closing = true;
        },
      },
      SessionStore: {},
      Cc: {
        "@mozilla.org/widget/clipboardhelper;1": {
          getService() {
            return {
              copyString(s) {
                copied.push(s);
              },
            };
          },
        },
      },
      Ci: { nsIClipboardHelper: {} },
    };
    run(
      "command-palette.js",
      sb2,
      'window.addEventListener("keydown", onKey, true);',
      "window.__aphTest2 = { allItems };"
    );
    return { T2: sb2.window.__aphTest2, copied, removed };
  }

  it("closes only the extra exact-URL copies in the workspace", () => {
    const t1 = dupTab("A", "https://example.com/a");
    const t2 = dupTab("A copy", "https://example.com/a");
    const t3 = dupTab("B", "https://example.com/b");
    const t4 = dupTab("A pinned", "https://example.com/a", { pinned: true });
    const t5 = dupTab("A elsewhere", "https://example.com/a", { ws: "2" });
    const t6 = dupTab("A live", "https://example.com/a", { audible: true });
    const t7 = dupTab("A again", "https://example.com/a");
    const { T2, removed } = dupSandbox([t1, t2, t3, t4, t5, t6, t7], t3);
    const rows = T2.allItems("close duplicate");
    const cmd = rows.find((r) => r.title.startsWith("Close Duplicate Tabs"));
    assert.ok(cmd, rows.map((r) => r.title).join(" | "));
    assert.equal(cmd.title, "Close Duplicate Tabs (2)");
    cmd.run();
    assert.deepEqual(removed, [t2, t7]);
  });

  it("offers Close Duplicate Tabs Across All Workspaces when duplicates span workspaces", () => {
    const t1 = dupTab("A", "https://example.com/a", { ws: "1" });
    const t2 = dupTab("B", "https://example.com/b", { ws: "1" });
    const t3 = dupTab("A ws2", "https://example.com/a", { ws: "2" });
    const { T2, removed } = dupSandbox([t1, t2, t3], t1);
    const rows = T2.allItems("close duplicate");
    const cmd = rows.find((r) => r.title.includes("All Workspaces"));
    assert.ok(cmd, "command found");
    assert.equal(cmd.title, "Close Duplicate Tabs Across All Workspaces (1)");
    cmd.run();
    assert.deepEqual(removed, [t3]);
  });

  it("copies workspace tabs as one markdown link per line", () => {
    const t1 = dupTab("A", "https://example.com/a");
    const t2 = dupTab("A copy", "https://example.com/a");
    const t3 = dupTab("B", "https://example.com/b");
    const t4 = dupTab("A pinned", "https://example.com/a", { pinned: true });
    const t5 = dupTab("A elsewhere", "https://example.com/a", { ws: "2" });
    const { T2, copied } = dupSandbox([t1, t2, t3, t4, t5], t1);
    const rows = T2.allItems("markdown");
    const cmd = rows.find((r) => r.title === "Copy Workspace Tabs as Markdown");
    assert.ok(cmd, rows.map((r) => r.title).join(" | "));
    assert.ok(cmd.sub.includes("4 tabs"), cmd.sub);
    cmd.run();
    assert.equal(copied.length, 1);
    assert.equal(
      copied[0],
      [
        "- [A](https://example.com/a)",
        "- [A copy](https://example.com/a)",
        "- [B](https://example.com/b)",
        "- [A pinned](https://example.com/a)",
      ].join("\n")
    );
  });

  it("hides Close Duplicate Tabs when nothing repeats", () => {
    const t1 = dupTab("A", "https://example.com/a");
    const t3 = dupTab("B", "https://example.com/b");
    const { T2 } = dupSandbox([t1, t3], t1);
    const rows = T2.allItems("close duplicate");
    assert.ok(
      !rows.some((r) => r.title.startsWith("Close Duplicate Tabs")),
      rows.map((r) => r.title).join(" | ")
    );
  });
});

describe("ctrl+k focus gate", () => {
  it("never surrenders ctrl+k from the urlbar or searchbar", () => {
    // Fresh tabs focus the urlbar: the stock search-focus binding lives
    // there, and hijacking it is the toggle's job.
    sb.document.activeElement = {
      tagName: "INPUT",
      isContentEditable: false,
      closest: (sel) => (String(sel).includes("#urlbar") ? {} : null),
    };
    assert.equal(T.ctrlKBlockedByFocus(), false);
    sb.document.activeElement = {
      tagName: "INPUT",
      isContentEditable: false,
      closest: (sel) => (String(sel).includes("#searchbar") ? {} : null),
    };
    assert.equal(T.ctrlKBlockedByFocus(), false);
    delete sb.document.activeElement;
  });

  it("still guards page inputs and keeps working unfocused", () => {
    sb.document.activeElement = {
      tagName: "TEXTAREA",
      isContentEditable: false,
      closest: () => null,
    };
    assert.equal(T.ctrlKBlockedByFocus(), true);
    sb.document.activeElement = {
      tagName: "BODY",
      isContentEditable: false,
      closest: () => null,
    };
    assert.equal(T.ctrlKBlockedByFocus(), false);
    delete sb.document.activeElement;
    assert.equal(T.ctrlKBlockedByFocus(), false);
  });
});

describe("phase 1: search-over-weak-fuzzy, drill-down stack, and ws dots", () => {
  it("puts web search first for multi-word / long non-matching queries", () => {
    const res1 = T.allItems("how to center a div");
    assert.equal(res1[0].kind, "search", res1[0] && res1[0].title);
    const res2 = T.allItems("weather");
    assert.equal(res2[0].kind, "search", res2[0] && res2[0].title);
  });

  it("drills into Switch Theme…, live-previews on arrow, and reverts on Escape", () => {
    let curPreset = "midnight";
    const calls = [];
    const keyHandlers = [];
    const input = {
      value: "",
      attrs: {},
      setAttribute(k, v) { this.attrs[k] = v; },
      focus() {},
      addEventListener() {},
    };
    const sbTheme = {
      window: {
        opener: null,
        AphWorkspaces: {
          getCurrent: () => "1",
          getWs: () => "1",
          getWsName: () => "Work",
          getWsIcon: () => "",
        },
        AphThemePreset: {
          getThemePreset: () => curPreset,
          setThemePreset: (p) => { curPreset = p; calls.push(p); },
        },
        addEventListener(t, fn) { if (t === "keydown") keyHandlers.push(fn); },
        removeEventListener() {},
      },
      document: {
        readyState: "complete",
        activeElement: null,
        createElement: (tag) => {
          if (tag === "input") return input;
          return {
            tag,
            className: "",
            hidden: false,
            children: [],
            style: {},
            attrs: {},
            setAttribute(k, v) { this.attrs[k] = v; },
            removeAttribute(k) { delete this.attrs[k]; },
            appendChild(c) { this.children.push(c); },
            removeChild() {},
            addEventListener() {},
            querySelector: () => null,
            classList: { add() {}, remove() {} },
            scrollIntoView() {},
          };
        },
        documentElement: { appendChild() {} },
      },
      gBrowser: { tabs: [], selectedTab: null },
    };
    run(
      "command-palette.js",
      sbTheme,
      'window.addEventListener("keydown", onKey, true);',
      "window.__aphTest = { allItems, getItems: () => items, getStack: () => viewStack };"
    );
    const api = sbTheme.window.__aphTest;
    const themeCmd = api.allItems("switch theme").find((r) => r.title === "Switch Theme…");
    assert.ok(themeCmd, "Switch Theme… command exists");
    themeCmd.run();
    assert.equal(api.getStack().length, 1, "pushed theme view onto stack");
    assert.ok(api.getItems().some((r) => r.title.includes("Midnight")));
    const onKey = keyHandlers[0];
    onKey({ key: "ArrowDown", preventDefault() {}, stopPropagation() {} });
    assert.ok(calls.length > 0, "live preview updated preset on ArrowDown");
    onKey({ key: "Escape", preventDefault() {}, stopPropagation() {} });
    assert.equal(api.getStack().length, 0, "popped theme view on Escape");
    assert.equal(curPreset, "midnight", "reverted theme preset on Escape");
  });

  it("caps typed All mode to <=5 tabs while keeping @ mode uncapped", () => {
    const manyTabs = [];
    for (let i = 0; i < 12; i++) {
      manyTabs.push({
        label: `Project Issue ${i}`,
        hidden: false,
        pinned: false,
        lastAccessed: 1000 - i,
        linkedBrowser: { currentURI: { spec: `https://example.com/${i}` } },
      });
    }
    const sbCap = {
      window: {
        opener: null,
        addEventListener() {},
        removeEventListener() {},
      },
      document: {
        readyState: "loading",
        createElement: () => ({ setAttribute() {}, addEventListener() {}, appendChild() {} }),
      },
      gBrowser: { tabs: manyTabs, selectedTab: null },
    };
    run(
      "command-palette.js",
      sbCap,
      'window.addEventListener("keydown", onKey, true);',
      "window.__aphTest = { allItems };"
    );
    const allRes = sbCap.window.__aphTest.allItems("project");
    const allTabs = allRes.filter((r) => r.kind === "tab");
    assert.ok(allTabs.length <= 5, `expected <=5 tabs in All mode, got ${allTabs.length}`);
    const atRes = sbCap.window.__aphTest.allItems("@project");
    assert.equal(atRes.length, 12, "dedicated @ mode keeps all 12 matching tabs");
  });

  it("Ctrl+L opens omnibox with current URL and navigates in place on Enter", () => {
    const navCalls = [];
    const keyHandlers = [];
    const input = {
      value: "",
      attrs: {},
      selected: false,
      setAttribute(k, v) { this.attrs[k] = v; },
      focus() {},
      select() { this.selected = true; },
      addEventListener() {},
    };
    const sbEdit = {
      window: {
        opener: null,
        openTrustedLinkIn: (url, where) => navCalls.push([url, where]),
        addEventListener(t, fn) { if (t === "keydown") keyHandlers.push(fn); },
        removeEventListener() {},
      },
      document: {
        readyState: "complete",
        activeElement: null,
        createElement: (tag) => {
          if (tag === "input") return input;
          return {
            tag,
            className: "",
            hidden: false,
            children: [],
            style: {},
            attrs: {},
            setAttribute(k, v) { this.attrs[k] = v; },
            removeAttribute(k) { delete this.attrs[k]; },
            appendChild(c) { this.children.push(c); },
            removeChild() {},
            addEventListener() {},
            querySelector: () => null,
            classList: { add() {}, remove() {} },
            scrollIntoView() {},
          };
        },
        documentElement: { appendChild() {} },
      },
      gBrowser: {
        tabs: [],
        selectedTab: null,
        selectedBrowser: { currentURI: { spec: "https://example.com/start" } },
      },
    };
    run(
      "command-palette.js",
      sbEdit,
      'window.addEventListener("keydown", onKey, true);',
      "window.__aphTest = { allItems, choose };"
    );
    const onKey = keyHandlers[0];
    onKey({ ctrlKey: true, code: "KeyL", preventDefault() {}, stopPropagation() {} });
    assert.equal(input.value, "https://example.com/start");
    input.value = "linear.app";
    const goItem = sbEdit.window.__aphTest.allItems("linear.app")[0];
    goItem.run();
    assert.deepEqual(navCalls, [["https://linear.app", "current"]]);
  });

  it("surfaces Aph Settings… and cycles/toggles key preferences", () => {
    const prefInts = new Map([
      ["aph.archive.autoDays", 0],
      ["aph.unload.staleMin", 30],
    ]);
    const prefBools = new Map([
      ["aph.unload.autoEnabled", false],
      ["aph.pins.ctrlWUnloads", true],
      ["aph.sidebar.autohide", false],
      ["aph.sidebar.hideFooter", true],
    ]);

    const mockServices = {
      prefs: {
        getIntPref: (k) => (prefInts.has(k) ? prefInts.get(k) : 0),
        setIntPref: (k, v) => prefInts.set(k, Number(v)),
        getBoolPref: (k, def) => (prefBools.has(k) ? prefBools.get(k) : def),
        setBoolPref: (k, v) => prefBools.set(k, !!v),
      },
    };

    const views = sb.window.__aphViews;
    assert.ok(views, "__aphViews is exported");
    assert.ok(typeof views.aphSettingsView === "function", "aphSettingsView exists");

    const settingsCmd = T.allItems(">aph settings").find((r) => r.title === "Aph Settings…");
    assert.ok(settingsCmd, "Aph Settings… command exists in palette");
    assert.equal(settingsCmd.hint, "Settings");
    assert.equal(settingsCmd.keepOpen, true);

    const savedGlobalServices = globalThis.Services;
    const savedSbServices = sb.Services;
    globalThis.Services = mockServices;
    sb.Services = mockServices;

    try {
      const settingsView = views.aphSettingsView();
      let items = settingsView.items();
      assert.equal(items.length, 6, "Settings view has 6 rows");

      // 1. Auto-Archive: 0 -> 3 -> 7 -> 14 -> 30 -> 0
      const archiveRow = items.find((r) => r.title.includes("Auto-Archive"));
      assert.ok(archiveRow, "Auto-Archive row exists");
      assert.equal(archiveRow.title, "○ Auto-Archive: Off");
      archiveRow.run();
      assert.equal(prefInts.get("aph.archive.autoDays"), 3);
      items = settingsView.items();
      assert.equal(items.find((r) => r.title.includes("Auto-Archive")).title, "✓ Auto-Archive: 3 days");
      items.find((r) => r.title.includes("Auto-Archive")).run();
      assert.equal(prefInts.get("aph.archive.autoDays"), 7);
      items = settingsView.items();
      items.find((r) => r.title.includes("Auto-Archive")).run();
      assert.equal(prefInts.get("aph.archive.autoDays"), 14);
      items = settingsView.items();
      items.find((r) => r.title.includes("Auto-Archive")).run();
      assert.equal(prefInts.get("aph.archive.autoDays"), 30);
      items = settingsView.items();
      items.find((r) => r.title.includes("Auto-Archive")).run();
      assert.equal(prefInts.get("aph.archive.autoDays"), 0);

      // 2. Auto-Unload: Off -> 15m -> 30m -> 60m -> Off
      const unloadRow = items.find((r) => r.title.includes("Auto-Unload"));
      assert.ok(unloadRow, "Auto-Unload row exists");
      assert.equal(unloadRow.title, "○ Auto-Unload: Off");
      unloadRow.run();
      assert.equal(prefBools.get("aph.unload.autoEnabled"), true);
      assert.equal(prefInts.get("aph.unload.staleMin"), 15);
      items = settingsView.items();
      assert.equal(items.find((r) => r.title.includes("Auto-Unload")).title, "✓ Auto-Unload: 15m");
      items.find((r) => r.title.includes("Auto-Unload")).run();
      assert.equal(prefBools.get("aph.unload.autoEnabled"), true);
      assert.equal(prefInts.get("aph.unload.staleMin"), 30);
      items = settingsView.items();
      items.find((r) => r.title.includes("Auto-Unload")).run();
      assert.equal(prefBools.get("aph.unload.autoEnabled"), true);
      assert.equal(prefInts.get("aph.unload.staleMin"), 60);
      items = settingsView.items();
      items.find((r) => r.title.includes("Auto-Unload")).run();
      assert.equal(prefBools.get("aph.unload.autoEnabled"), false);

      // 3. Ctrl+W Parks Pins
      const pinsRow = items.find((r) => r.title.includes("Ctrl+W Parks"));
      assert.ok(pinsRow, "Pins row exists");
      assert.equal(pinsRow.title, "✓ Ctrl+W Parks Pinned Tabs");
      pinsRow.run();
      assert.equal(prefBools.get("aph.pins.ctrlWUnloads"), false);
      items = settingsView.items();
      assert.equal(items.find((r) => r.title.includes("Ctrl+W Parks")).title, "○ Ctrl+W Parks Pinned Tabs");
      items.find((r) => r.title.includes("Ctrl+W Parks")).run();
      assert.equal(prefBools.get("aph.pins.ctrlWUnloads"), true);

      // 4. Auto-Hide Sidebar
      const sidebarRow = items.find((r) => r.title.includes("Auto-Hide Sidebar"));
      assert.ok(sidebarRow, "Sidebar autohide row exists");
      assert.equal(sidebarRow.title, "○ Auto-Hide Sidebar: Disabled");
      sidebarRow.run();
      assert.equal(prefBools.get("aph.sidebar.autohide"), true);
      items = settingsView.items();
      assert.equal(items.find((r) => r.title.includes("Auto-Hide Sidebar")).title, "✓ Auto-Hide Sidebar: Enabled");

      // 5. Sidebar Footer
      const footerRow = items.find((r) => r.title.includes("Sidebar Settings Footer"));
      assert.ok(footerRow, "Sidebar footer row exists");
      assert.equal(footerRow.title, "○ Sidebar Settings Footer: Hidden");
      footerRow.run();
      assert.equal(prefBools.get("aph.sidebar.hideFooter"), false);
      items = settingsView.items();
      assert.equal(items.find((r) => r.title.includes("Sidebar Settings Footer")).title, "✓ Sidebar Settings Footer: Visible");

      // 6. Theme Preset item exists
      const themeRow = items.find((r) => r.title.includes("Theme Preset"));
      assert.ok(themeRow, "Theme Preset row exists");
      assert.equal(themeRow.keepOpen, true);
    } finally {
      globalThis.Services = savedGlobalServices;
      sb.Services = savedSbServices;
    }
  });

  it("surfaces Manage Domain Routes… and manages routes cleanly", () => {
    const routes = { "github.com": "2" };
    const mockApi = {
      getCurrent: () => "1",
      getRoutes: () => routes,
      setRoute: (h, n) => { routes[h] = n; return true; },
      deleteRoute: (h) => { delete routes[h]; return true; },
      getWsName: (n) => (n === "2" ? "Code" : ""),
    };

    const routesCmd = T.allItems("manage domain routes").find((r) => r.title === "Manage Domain Routes…");
    assert.ok(routesCmd, "Manage Domain Routes… command exists");
    assert.equal(routesCmd.keepOpen, true);

    const views = sb.window.__aphViews;
    assert.ok(views.manageRoutesView, "manageRoutesView is exported");
    assert.ok(views.routeDomainWorkspaceView, "routeDomainWorkspaceView is exported");

    const manageView = views.manageRoutesView(mockApi);
    assert.equal(manageView.rawItems, true, "uses rawItems for direct filtering");

    // Empty query: lists existing rule for github.com
    let items = manageView.items("");
    const delRule = items.find((r) => r.title.includes("github.com"));
    assert.ok(delRule, "lists github.com rule");
    assert.equal(delRule.hint, "Enter deletes");
    assert.equal(delRule.keepOpen, true);

    // Enter deletes the rule
    delRule.run();
    assert.equal(routes["github.com"], undefined, "github.com rule was removed");
    items = manageView.items("");
    assert.ok(!items.some((r) => r.title.includes("Remove: github.com")), "rule no longer in list");

    // Type a domain: "internal.corp"
    items = manageView.items("internal.corp");
    const routeAction = items.find((r) => r.title.includes('Route "internal.corp" to Workspace…'));
    assert.ok(routeAction, "offers to route typed domain to workspace");
    assert.equal(routeAction.keepOpen, true);

    // Pick workspace 3 via routeDomainWorkspaceView
    const pickView = views.routeDomainWorkspaceView(mockApi, "internal.corp");
    const wsItems = pickView.items();
    assert.equal(wsItems.length, 9, "9 workspaces listed");
    const ws3 = wsItems.find((r) => r.wsId === "3");
    assert.ok(ws3, "Workspace 3 exists");
    ws3.run();
    assert.equal(routes["internal.corp"], "3", "internal.corp routed to Workspace 3");

    // Test URL sanitization in cleanDomainInput
    assert.equal(views.cleanDomainInput("https://gitlab.com/repo/issues"), "gitlab.com");
    assert.equal(views.cleanDomainInput("*.company.com:8443"), "*.company.com");
    assert.equal(views.cleanDomainInput("LOCALHOST:3000"), "localhost");
  });

  it("pushes Settings and Routes views via palette command execution", () => {
    const makeFakeEl = (tag) => ({
      tag,
      className: "",
      hidden: false,
      children: [],
      style: {},
      attrs: {},
      setAttribute(k, v) { this.attrs[k] = v; },
      removeAttribute(k) { delete this.attrs[k]; },
      appendChild(c) { this.children.push(c); },
      removeChild() {},
      addEventListener() {},
      querySelector: () => null,
      classList: { add() {}, remove() {}, contains: () => false },
      scrollIntoView() {},
      focus() {},
    });

    const sbViews = {
      window: {
        addEventListener() {},
        removeEventListener() {},
        AphWorkspaces: {
          getCurrent: () => "1",
          getRoutes: () => ({}),
          setRoute: () => {},
          deleteRoute: () => {},
          getWsName: () => "",
        },
      },
      document: {
        readyState: "loading",
        activeElement: null,
        createElement: (tag) => makeFakeEl(tag),
        documentElement: { appendChild() {} },
      },
      gBrowser: { tabs: [], selectedTab: null },
    };
    run(
      "command-palette.js",
      sbViews,
      'window.addEventListener("keydown", onKey, true);',
      "window.__aphTest = { allItems, getStack: () => viewStack };"
    );
    const testApi = sbViews.window.__aphTest;
    const settingsCmd = testApi.allItems("aph settings").find((r) => r.title === "Aph Settings…");
    assert.ok(settingsCmd, "Aph Settings command found");
    settingsCmd.run();
    assert.equal(testApi.getStack().length, 1, "pushed Settings view");
    assert.ok(testApi.getStack()[0].placeholder.includes("Aph Settings"));

    const routesCmd = testApi.allItems("manage domain routes").find((r) => r.title === "Manage Domain Routes…");
    assert.ok(routesCmd, "Manage Domain Routes command found");
    routesCmd.run();
    assert.equal(testApi.getStack().length, 2, "pushed Routes view");
    assert.ok(testApi.getStack()[1].placeholder.includes("Type domain"));
  });
});
