// Regression guards for the Native Bookmark Archiver (branding/workspaces/52-archive.js).
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  run,
  makeTab,
  makeFakeNode: fakeNode,
  makeSessionStore,
  makeCi,
  makeChromeUtils,
  makeGroup,
} = require("./helpers");

function makeMockPlaces() {
  let nextGuid = 1;
  const folders = new Map();
  const bookmarks = new Map();

  folders.set("unfiled_____", {
    guid: "unfiled_____",
    parentGuid: "root________",
    title: "Other Bookmarks",
    type: 2,
    children: [],
  });

  return {
    unfiledGuid: "unfiled_____",
    TYPE_FOLDER: 2,
    TYPE_BOOKMARK: 1,
    folders,
    bookmarks,
    failInsertTree: false,
    insertTreeCalls: [],
    async fetch({ parentGuid }, onResult) {
      const parent = folders.get(parentGuid);
      if (!parent) return null;
      for (const childGuid of parent.children) {
        const item = folders.get(childGuid) || bookmarks.get(childGuid);
        if (item && onResult) {
          onResult(item);
        }
      }
      return null;
    },
    async insert({ parentGuid, type, title, url }) {
      const guid = `guid_${nextGuid++}`;
      const item = { guid, parentGuid, type, title, url };
      if (type === 2) {
        item.children = [];
        folders.set(guid, item);
      } else {
        bookmarks.set(guid, item);
      }
      const parent = folders.get(parentGuid);
      if (parent) {
        parent.children.push(guid);
      }
      return item;
    },
    async insertTree({ guid, children }) {
      if (this.failInsertTree) {
        throw new Error("Simulated insertTree failure");
      }
      this.insertTreeCalls.push({ guid, children });
      const parent = folders.get(guid);
      if (!parent) throw new Error("Parent folder not found");
      for (const c of children) {
        const childGuid = `guid_${nextGuid++}`;
        const item = {
          guid: childGuid,
          parentGuid: guid,
          type: 1,
          title: c.title,
          url: c.url,
        };
        bookmarks.set(childGuid, item);
        parent.children.push(childGuid);
      }
      return { guid };
    },
  };
}

function makeEnv(prefs, customMockPlaces) {
  const tabVals = new WeakMap();
  const prefStore = Object.assign(
    {
      "aph.archive.autoDays": 0,
    },
    prefs || {}
  );
  const mockPlaces = customMockPlaces || makeMockPlaces();
  const prefObservers = {};
  const removedTabs = [];
  let sel = null;

  const anchor = fakeNode("box");
  const popupSet = fakeNode("popupset");
  const rootEl = fakeNode("html");
  const doc = {
    readyState: "complete",
    documentElement: rootEl,
    getElementById: (id) => {
      if (id === "vertical-tabs") return anchor;
      if (id === "mainPopupSet") return popupSet;
      return null;
    },
    createElement: () => fakeNode("div"),
    createXULElement: (tag) => fakeNode(tag),
    querySelectorAll: () => [],
    querySelector: () => null,
  };

  const gBrowser = {
    tabs: [],
    tabGroups: [],
    tabContainer: {
      setAttribute() {},
      getAttribute() {},
      removeAttribute() {},
      addEventListener() {},
      removeEventListener() {},
      _invalidateCachedVisibleTabs() {},
      _updateCloseButtons() {},
    },
    get selectedTab() {
      return sel;
    },
    set selectedTab(t) {
      if (sel) sel.selected = false;
      sel = t;
      if (t) t.selected = true;
    },
    removeTab(t) {
      removedTabs.push(t);
      const idx = gBrowser.tabs.indexOf(t);
      if (idx !== -1) {
        gBrowser.tabs.splice(idx, 1);
      }
    },
    showTab(t) {
      t.removeAttribute("hidden");
    },
  };

  const sandbox = {
    window: {
      addEventListener() {},
      removeEventListener() {},
      AphArchivePlaces: mockPlaces,
    },
    document: doc,
    gBrowser,
    SessionStore: makeSessionStore(tabVals),
    Services: {
      prefs: {
        getIntPref: (k) => (k in prefStore ? prefStore[k] : 0),
        getBoolPref: (k) => (k in prefStore ? !!prefStore[k] : false),
        getStringPref: (k) => (k in prefStore ? String(prefStore[k]) : ""),
        addObserver: (k, obs) => {
          (prefObservers[k] = prefObservers[k] || []).push(obs);
        },
        removeObserver: (k, obs) => {
          prefObservers[k] = (prefObservers[k] || []).filter((o) => o !== obs);
        },
      },
      console: {
        logStringMessage: () => {},
      },
      obs: {
        addObserver() {},
        removeObserver() {},
      },
    },
    Ci: makeCi(),
    ChromeUtils: makeChromeUtils(),
    tabVals,
    mockPlaces,
    removedTabs,
  };

  run(
    "workspaces.js",
    sandbox,
    'window.addEventListener("unload", cleanupWindowObservers, { once: true });',
    "window.__aphArchiveTest = { canArchiveTab, effectiveLastViewed, ensureBookmarkFolder, getBookmarkChildren, executeArchive, localDateString };"
  );

  return sandbox;
}

describe("effectiveLastViewed", () => {
  it("uses aphLastViewed from SessionStore if positive", () => {
    const env = makeEnv();
    const { effectiveLastViewed } = env.window.__aphArchiveTest;
    const tab = makeTab(env.tabVals, { ws: "1", spec: "https://example.com" });
    env.tabVals.set(tab, { aphWs: "1", aphLastViewed: 1700000000000 });
    tab.lastAccessed = 1600000000000;

    assert.equal(effectiveLastViewed(tab), 1700000000000);
  });

  it("falls back to tab.lastAccessed when aphLastViewed is absent or non-positive", () => {
    const env = makeEnv();
    const { effectiveLastViewed } = env.window.__aphArchiveTest;
    const tab = makeTab(env.tabVals, { ws: "1", spec: "https://example.com" });
    tab.lastAccessed = 1650000000000;

    assert.equal(effectiveLastViewed(tab), 1650000000000);
  });

  it("returns 0 if both timestamps are missing or invalid", () => {
    const env = makeEnv();
    const { effectiveLastViewed } = env.window.__aphArchiveTest;
    const tab = makeTab(env.tabVals, { ws: "1", spec: "https://example.com" });
    tab.lastAccessed = 0;

    assert.equal(effectiveLastViewed(tab), 0);
  });
});

describe("canArchiveTab eligibility", () => {
  it("rejects closing tabs", () => {
    const env = makeEnv();
    const { canArchiveTab } = env.window.__aphArchiveTest;
    const tab = makeTab(env.tabVals, { ws: "1", spec: "https://example.com" });
    tab.closing = true;
    tab.lastAccessed = 1000;

    const res = canArchiveTab(tab, 2000, 3000);
    assert.equal(res.ok, false);
    assert.equal(res.reason, "closing");
  });

  it("rejects selected tabs (active in window)", () => {
    const env = makeEnv();
    const { canArchiveTab } = env.window.__aphArchiveTest;
    const tab = makeTab(env.tabVals, { ws: "1", spec: "https://example.com", selected: true });
    env.gBrowser.selectedTab = tab;
    tab.lastAccessed = 1000;

    const res = canArchiveTab(tab, 2000, 3000);
    assert.equal(res.ok, false);
    assert.equal(res.reason, "selected");
  });

  it("rejects pinned tabs", () => {
    const env = makeEnv();
    const { canArchiveTab } = env.window.__aphArchiveTest;
    const tab = makeTab(env.tabVals, { ws: "1", spec: "https://example.com", pinned: true });
    tab.lastAccessed = 1000;

    const res = canArchiveTab(tab, 2000, 3000);
    assert.equal(res.ok, false);
    assert.equal(res.reason, "pinned");
  });

  it("rejects audible and soundPlaying tabs", () => {
    const env = makeEnv();
    const { canArchiveTab } = env.window.__aphArchiveTest;
    const tab1 = makeTab(env.tabVals, { ws: "1", spec: "https://example.com", soundPlaying: true });
    tab1.lastAccessed = 1000;
    assert.equal(canArchiveTab(tab1, 2000, 3000).reason, "audio");

    const tab2 = makeTab(env.tabVals, { ws: "1", spec: "https://example.com", audible: true });
    tab2.lastAccessed = 1000;
    assert.equal(canArchiveTab(tab2, 2000, 3000).reason, "audio");
  });

  it("rejects busy/loading tabs", () => {
    const env = makeEnv();
    const { canArchiveTab } = env.window.__aphArchiveTest;
    const tab = makeTab(env.tabVals, { ws: "1", spec: "https://example.com", busy: true });
    tab.lastAccessed = 1000;

    const res = canArchiveTab(tab, 2000, 3000);
    assert.equal(res.ok, false);
    assert.equal(res.reason, "loading");
  });

  it("rejects tabs with unsettled workspace tags", () => {
    const env = makeEnv();
    const { canArchiveTab } = env.window.__aphArchiveTest;
    const tab = makeTab(env.tabVals, { spec: "https://example.com" });
    tab.lastAccessed = 1000;
    // No ws set in tabVals

    const res = canArchiveTab(tab, 2000, 3000);
    assert.equal(res.ok, false);
    assert.equal(res.reason, "unsettled");
  });

  it("rejects starred tabs", () => {
    const env = makeEnv();
    const { canArchiveTab } = env.window.__aphArchiveTest;
    const tab = makeTab(env.tabVals, { ws: "1", spec: "https://example.com" });
    tab.lastAccessed = 1000;
    makeGroup([tab], { label: "Starred" });

    const res = canArchiveTab(tab, 2000, 3000);
    assert.equal(res.ok, false);
    assert.equal(res.reason, "starred");
  });

  it("rejects sharing and beforeunload tabs", () => {
    const env = makeEnv();
    const { canArchiveTab } = env.window.__aphArchiveTest;
    const tabSharing = makeTab(env.tabVals, { ws: "1", spec: "https://example.com", sharing: true });
    tabSharing.lastAccessed = 1000;
    assert.equal(canArchiveTab(tabSharing, 2000, 3000).reason, "sharing");

    const tabBefore = makeTab(env.tabVals, { ws: "1", spec: "https://example.com", beforeUnload: true });
    tabBefore.lastAccessed = 1000;
    assert.equal(canArchiveTab(tabBefore, 2000, 3000).reason, "beforeunload");
  });

  it("rejects non-http URLs (about:blank, chrome:, file:)", () => {
    const env = makeEnv();
    const { canArchiveTab } = env.window.__aphArchiveTest;
    const tabAbout = makeTab(env.tabVals, { ws: "1", spec: "about:newtab" });
    tabAbout.lastAccessed = 1000;
    assert.equal(canArchiveTab(tabAbout, 2000, 3000).reason, "non-http");

    const tabFile = makeTab(env.tabVals, { ws: "1", spec: "file:///home/user/test.html" });
    tabFile.lastAccessed = 1000;
    assert.equal(canArchiveTab(tabFile, 2000, 3000).reason, "non-http");
  });

  it("rejects fresh tabs whose lastViewed is greater than cutoff", () => {
    const env = makeEnv();
    const { canArchiveTab } = env.window.__aphArchiveTest;
    const tab = makeTab(env.tabVals, { ws: "1", spec: "https://example.com" });
    tab.lastAccessed = 5000;

    const res = canArchiveTab(tab, 4000, 6000); // cutoff 4000
    assert.equal(res.ok, false);
    assert.equal(res.reason, "fresh");
  });

  it("accepts eligible stale tabs", () => {
    const env = makeEnv();
    const { canArchiveTab } = env.window.__aphArchiveTest;
    const tab = makeTab(env.tabVals, { ws: "1", spec: "https://example.com/stale", label: "Example Stale" });
    tab.lastAccessed = 2000;

    const res = canArchiveTab(tab, 4000, 6000); // cutoff 4000
    assert.equal(res.ok, true);
    assert.equal(res.spec, "https://example.com/stale");
    assert.equal(res.title, "Example Stale");
    assert.equal(res.ws, "1");
  });

  it("accepts pending (unloaded) stale tabs", () => {
    const env = makeEnv();
    const { canArchiveTab } = env.window.__aphArchiveTest;
    const tab = makeTab(env.tabVals, { ws: "2", spec: "https://example.com/pending", pending: true });
    tab.lastAccessed = 1000;

    const res = canArchiveTab(tab, 4000, 6000);
    assert.equal(res.ok, true);
    assert.equal(res.ws, "2");
  });
});

describe("countArchivableTabs", () => {
  it("counts eligible tabs without closing or creating bookmarks", () => {
    const env = makeEnv();
    const now = Date.now();
    const t1 = makeTab(env.tabVals, { ws: "1", spec: "https://example.com/1" });
    t1.lastAccessed = now - 100000; // stale
    const t2 = makeTab(env.tabVals, { ws: "1", spec: "https://example.com/2", pinned: true });
    t2.lastAccessed = now - 100000; // pinned (ineligible)
    const t3 = makeTab(env.tabVals, { ws: "2", spec: "https://example.com/3" });
    t3.lastAccessed = now - 100000; // stale in ws 2

    env.gBrowser.tabs = [t1, t2, t3];

    // All stale tabs (maxAgeMs: 50000)
    const countAll = env.window.AphWorkspaces.countArchivableTabs({ maxAgeMs: 50000 });
    assert.equal(countAll, 2);

    // Scoped to workspace 1
    const countWs1 = env.window.AphWorkspaces.countArchivableTabs({ ws: "1", maxAgeMs: 50000 });
    assert.equal(countWs1, 1);

    // No bookmarks created and no tabs removed
    assert.equal(env.mockPlaces.bookmarks.size, 0);
    assert.equal(env.removedTabs.length, 0);
  });
});

describe("executeArchive & folder hierarchy", () => {
  it("creates Aph Archive -> Workspace N -> Date folders and inserts bookmarks atomically", async () => {
    const env = makeEnv();
    const now = Date.now();
    const t1 = makeTab(env.tabVals, { ws: "1", spec: "https://example.com/a", label: "Alpha" });
    t1.lastAccessed = now - 50000;
    const t2 = makeTab(env.tabVals, { ws: "2", spec: "https://example.com/b", label: "Beta" });
    t2.lastAccessed = now - 50000;
    env.gBrowser.tabs = [t1, t2];

    const result = await env.window.AphWorkspaces.archiveStaleTabs({ maxAgeMs: 10000 });
    assert.equal(result.archived, 2);
    assert.equal(env.removedTabs.length, 2);
    assert.equal(env.gBrowser.tabs.length, 0);

    // Verify folder hierarchy:
    // Root: Aph Archive
    const rootFolder = Array.from(env.mockPlaces.folders.values()).find(
      (f) => f.title === "Aph Archive" && f.parentGuid === "unfiled_____"
    );
    assert.ok(rootFolder, "Aph Archive folder should exist");

    // Subfolders: Workspace 1, Workspace 2
    const ws1Folder = Array.from(env.mockPlaces.folders.values()).find(
      (f) => f.parentGuid === rootFolder.guid && f.title.startsWith("Workspace 1")
    );
    const ws2Folder = Array.from(env.mockPlaces.folders.values()).find(
      (f) => f.parentGuid === rootFolder.guid && f.title.startsWith("Workspace 2")
    );
    assert.ok(ws1Folder, "Workspace 1 folder should exist");
    assert.ok(ws2Folder, "Workspace 2 folder should exist");

    // Bookmarks inserted
    const b1 = Array.from(env.mockPlaces.bookmarks.values()).find((b) => b.url === "https://example.com/a");
    const b2 = Array.from(env.mockPlaces.bookmarks.values()).find((b) => b.url === "https://example.com/b");
    assert.ok(b1, "Bookmark Alpha should be created");
    assert.equal(b1.title, "Alpha");
    assert.ok(b2, "Bookmark Beta should be created");
    assert.equal(b2.title, "Beta");
  });

  it("archiveWorkspaceTabs archives only unpinned tabs in that workspace", async () => {
    const env = makeEnv();
    const now = Date.now();
    const t1 = makeTab(env.tabVals, { ws: "1", spec: "https://example.com/ws1", label: "WS1 Tab" });
    t1.lastAccessed = now;
    const t2 = makeTab(env.tabVals, { ws: "1", spec: "https://example.com/ws1-pinned", pinned: true });
    t2.lastAccessed = now;
    const t3 = makeTab(env.tabVals, { ws: "2", spec: "https://example.com/ws2", label: "WS2 Tab" });
    t3.lastAccessed = now;
    env.gBrowser.tabs = [t1, t2, t3];

    const result = await env.window.AphWorkspaces.archiveWorkspaceTabs("1");
    assert.equal(result.archived, 1);
    assert.equal(env.removedTabs.length, 1);
    assert.equal(env.removedTabs[0], t1);
    assert.equal(env.gBrowser.tabs.length, 2);
    assert.ok(env.gBrowser.tabs.includes(t2));
    assert.ok(env.gBrowser.tabs.includes(t3));
  });
});

describe("deduplication semantics", () => {
  it("closes redundant tab without creating duplicate bookmark when URL already exists today", async () => {
    const env = makeEnv();
    const now = Date.now();
    const t1 = makeTab(env.tabVals, { ws: "1", spec: "https://example.com/dupe", label: "First Copy" });
    t1.lastAccessed = now - 50000;
    const t2 = makeTab(env.tabVals, { ws: "1", spec: "https://example.com/dupe", label: "Second Copy" });
    t2.lastAccessed = now - 50000;
    env.gBrowser.tabs = [t1, t2];

    const result = await env.window.AphWorkspaces.archiveStaleTabs({ maxAgeMs: 10000 });
    assert.equal(result.archived, 2);

    // Only one bookmark was created for the duplicate URL
    const matchingBookmarks = Array.from(env.mockPlaces.bookmarks.values()).filter(
      (b) => b.url === "https://example.com/dupe"
    );
    assert.equal(matchingBookmarks.length, 1);
    // But BOTH tabs were closed
    assert.equal(env.removedTabs.length, 2);
  });

  it("deduplicates against existing URL objects from Places fetch", async () => {
    const mockPlaces = makeMockPlaces();
    // Simulate real PlacesUtils.bookmarks where item.url is a WHATWG URL object
    mockPlaces.fetch = async ({ parentGuid }, onResult) => {
      const parent = mockPlaces.folders.get(parentGuid);
      if (!parent) return null;
      for (const childGuid of parent.children) {
        const item = mockPlaces.folders.get(childGuid) || mockPlaces.bookmarks.get(childGuid);
        if (item && onResult) {
          // Pass item with a URL object instance for bookmarks, exactly like Firefox Bookmarks.sys.mjs
          onResult({
            ...item,
            url: item.url ? new URL(typeof item.url === "string" ? item.url : item.url.href) : undefined,
          });
        }
      }
      return null;
    };

    const env = makeEnv({}, mockPlaces);
    const now = Date.now();
    // First run creates the bookmark
    const t1 = makeTab(env.tabVals, { ws: "1", spec: "https://example.com/object-url", label: "Run 1" });
    t1.lastAccessed = now - 50000;
    env.gBrowser.tabs = [t1];
    await env.window.AphWorkspaces.archiveStaleTabs({ maxAgeMs: 10000 });

    // Second run with the same URL should recognize existing URL object and not duplicate bookmark
    const t2 = makeTab(env.tabVals, { ws: "1", spec: "https://example.com/object-url", label: "Run 2" });
    t2.lastAccessed = now - 50000;
    env.gBrowser.tabs = [t2];
    const result2 = await env.window.AphWorkspaces.archiveStaleTabs({ maxAgeMs: 10000 });

    assert.equal(result2.archived, 1);
    const count = Array.from(mockPlaces.bookmarks.values()).filter(
      (b) => b.url === "https://example.com/object-url"
    ).length;
    assert.equal(count, 1, "must not duplicate bookmark when existing item.url is a URL object");
  });

  it("does not close tab if tab became selected or pinned while archiving", async () => {
    const mockPlaces = makeMockPlaces();
    const env = makeEnv({}, mockPlaces);
    const now = Date.now();
    const t = makeTab(env.tabVals, { ws: "1", spec: "https://example.com/busy-tab", label: "Race Tab" });
    t.lastAccessed = now - 50000;
    env.gBrowser.tabs = [t];

    // Intercept insertTree to simulate user clicking or pinning the tab during Places write
    const origInsertTree = mockPlaces.insertTree.bind(mockPlaces);
    mockPlaces.insertTree = async (args) => {
      t.selected = true; // user switched to tab while Places was writing
      return origInsertTree(args);
    };

    const res = await env.window.AphWorkspaces.archiveStaleTabs({ maxAgeMs: 10000 });
    assert.equal(res.archived, 0);
    assert.ok(env.gBrowser.tabs.includes(t), "tab selected during write must not be closed");
  });
});

describe("atomic failure safety", () => {
  it("never closes tabs if bookmark insertion fails", async () => {
    const mockPlaces = makeMockPlaces();
    mockPlaces.failInsertTree = true; // force error

    const env = makeEnv({}, mockPlaces);
    const now = Date.now();
    const t = makeTab(env.tabVals, { ws: "1", spec: "https://example.com/fail", label: "Safe Tab" });
    t.lastAccessed = now - 50000;
    env.gBrowser.tabs = [t];

    const result = await env.window.AphWorkspaces.archiveStaleTabs({ maxAgeMs: 10000 });
    assert.equal(result.archived, 0);
    assert.equal(result.reason, "error");

    // Zero tabs closed! Tab remains safely intact
    assert.equal(env.removedTabs.length, 0);
    assert.equal(env.gBrowser.tabs.length, 1);
    assert.equal(env.gBrowser.tabs[0], t);
  });
});

describe("palette archive commands", () => {
  it("surfaces archive commands with live counts in the palette", () => {
    let staleCalls = 0;
    let wsCalls = 0;
    const sb = {
      window: {
        addEventListener() {},
        AphWorkspaces: {
          getCurrent: () => "1",
          getWsName: () => "Main",
          countArchivableTabs: (opts) => {
            if (opts?.maxAgeMs === 7 * 86400000) return 4;
            if (opts?.maxAgeMs === 86400000) return 2;
            if (opts?.ws === "1") return 8;
            return 0;
          },
          archiveStaleTabs: () => {
            staleCalls++;
          },
          archiveWorkspaceTabs: () => {
            wsCalls++;
          },
        },
      },
      document: { readyState: "loading" },
      gBrowser: {
        tabs: [],
        get selectedTab() {
          return { linkedBrowser: { currentURI: { spec: "https://example.com" } } };
        },
      },
      SessionStore: {},
    };

    run(
      "command-palette.js",
      sb,
      'window.addEventListener("keydown", onKey, true);',
      "window.__aphTest = { allItems, archiveCommands };"
    );

    const rootItems = sb.window.__aphTest.allItems("archive");
    const parentCmd = rootItems.find((it) => it.title === "Archive Stale Tabs…");
    assert.ok(parentCmd, "Archive Stale Tabs… drill-down command should exist");

    const items = sb.window.__aphTest.archiveCommands(sb.window.AphWorkspaces);
    assert.ok(items.length >= 3, `Expected at least 3 archive commands, got ${items.length}`);

    const cmd7d = items.find((it) => it.title === "Archive Stale Tabs (>7 Days)");
    assert.ok(cmd7d, "Archive Stale Tabs (>7 Days) command should exist");
    assert.match(cmd7d.sub, /Saves 4 tab\(s\)/);

    const cmd24h = items.find((it) => it.title === "Archive Stale Tabs (>24 Hours)");
    assert.ok(cmd24h, "Archive Stale Tabs (>24 Hours) command should exist");
    assert.match(cmd24h.sub, /Saves 2 tab\(s\)/);

    const cmdWs = items.find((it) => it.title === "Archive Current Workspace Tabs");
    assert.ok(cmdWs, "Archive Current Workspace Tabs command should exist");
    assert.match(cmdWs.sub, /Saves 8 tab\(s\)/);

    // Test execution
    cmd7d.run();
    assert.equal(staleCalls, 1);
    cmdWs.run();
    assert.equal(wsCalls, 1);
  });
});

