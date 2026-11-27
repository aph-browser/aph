// Aph Archive: native bookmark archiver into Firefox Bookmarks
// (Other Bookmarks / Aph Archive / Workspace N / YYYY-MM-DD).
// Zero custom database, instant Ctrl+K searchability, atomic bookmark-before-close.

const ARCHIVE_AUTO_DAYS_PREF = "aph.archive.autoDays";
const ARCHIVE_INTERVAL_MS = 60 * 60 * 1000;
const ARCHIVE_STARTUP_DELAY_MS = 30 * 1000;
const ARCHIVE_CHUNK_SIZE = 100;

let archiveInFlight = false;
let archiveIntervalId = null;
let archiveStartupTimer = null;

function archiveLog(msg) {
  try {
    Services.console.logStringMessage(`[AphArchive] ${msg}`);
  } catch (e) {}
}

function getArchiveAutoDays() {
  try {
    if (Services.prefs && typeof Services.prefs.getIntPref === "function") {
      const d = Services.prefs.getIntPref(ARCHIVE_AUTO_DAYS_PREF);
      return Number.isFinite(d) ? Math.max(0, d) : 0;
    }
  } catch (e) {}
  return 0;
}

function getPlacesBookmarks() {
  try {
    if (typeof window !== "undefined" && window.AphArchivePlaces) {
      return window.AphArchivePlaces;
    }
    if (typeof globalThis !== "undefined" && globalThis.PlacesUtils?.bookmarks) {
      return globalThis.PlacesUtils.bookmarks;
    }
    if (typeof ChromeUtils !== "undefined" && typeof ChromeUtils.importESModule === "function") {
      const mod = ChromeUtils.importESModule("resource://gre/modules/PlacesUtils.sys.mjs");
      return mod?.PlacesUtils?.bookmarks || null;
    }
  } catch (e) {}
  return null;
}

// Effective last-viewed timestamp (ms epoch):
// 1. aphLastViewed (readUnloadLastViewed)
// 2. tab.lastAccessed (Firefox native tab timestamp, survives restarts)
// Missing or non-positive reads as 0 (fails closed in canArchiveTab).
function effectiveLastViewed(tab) {
  try {
    const lv = typeof readUnloadLastViewed === "function" ? readUnloadLastViewed(tab) : 0;
    if (Number.isFinite(lv) && lv > 0) {
      return lv;
    }
  } catch (e) {}
  try {
    const la = Number(tab?.lastAccessed);
    if (Number.isFinite(la) && la > 0) {
      return la;
    }
  } catch (e) {}
  return 0;
}

// Eligibility check for archiving:
// Never archive: closing, restoring, tagless/unsettled, selected/active, pinned,
// starred, audible/soundPlaying, busy/loading, sharing, beforeunload, or non-http(s).
// DO archive: pending (unloaded) tabs!
function canArchiveTab(tab, cutoffMs, nowMs) {
  if (!tab) {
    return { ok: false, reason: "no-tab" };
  }
  if (tab.closing) {
    return { ok: false, reason: "closing" };
  }
  if (tab.selected || gBrowser?.selectedTab === tab) {
    return { ok: false, reason: "selected" };
  }
  if (tab.pinned) {
    return { ok: false, reason: "pinned" };
  }
  if (tab.soundPlaying || tab.audible) {
    return { ok: false, reason: "audio" };
  }
  if (tab.busy) {
    return { ok: false, reason: "loading" };
  }
  if (typeof isRestoringTab === "function" && isRestoringTab(tab)) {
    return { ok: false, reason: "restoring" };
  }
  if (typeof rawWs === "function" && !rawWs(tab)) {
    return { ok: false, reason: "unsettled" };
  }
  if (typeof isTabStarred === "function" && isTabStarred(tab)) {
    return { ok: false, reason: "starred" };
  }
  if (tab.group) {
    return { ok: false, reason: "grouped" };
  }
  if (tab.linkedBrowser?._sharingState?.webRTC?.sharing) {
    return { ok: false, reason: "sharing" };
  }
  if (tab.linkedBrowser?.frameLoader?.tabParent?.hasBeforeUnload) {
    return { ok: false, reason: "beforeunload" };
  }

  const spec = tab.linkedBrowser?.currentURI?.spec;
  if (typeof spec !== "string" || !spec || spec.length > 65536) {
    return { ok: false, reason: "invalid-url" };
  }
  if (!/^https?:\/\//i.test(spec)) {
    return { ok: false, reason: "non-http" };
  }

  const lv = effectiveLastViewed(tab);
  if (lv <= 0) {
    return { ok: false, reason: "untracked" };
  }

  const now = Number.isFinite(nowMs) ? nowMs : Date.now();
  const cutoff = Number.isFinite(cutoffMs) ? cutoffMs : now;
  if (lv > cutoff) {
    return { ok: false, reason: "fresh" };
  }

  const ws = typeof getWs === "function" ? getWs(tab) : "1";
  const title = String(tab.label || spec);
  return { ok: true, spec, title, ws, lastViewed: lv };
}

// Local date string YYYY-MM-DD
function localDateString(d = new Date()) {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

// Helper: fetch all child bookmarks/folders of parentGuid
async function getBookmarkChildren(bm, parentGuid) {
  const children = [];
  try {
    await bm.fetch({ parentGuid }, (item) => {
      if (item) {
        children.push(item);
      }
    });
  } catch (e) {}
  return children;
}

// Helper: get or create folder under parentGuid
async function ensureBookmarkFolder(bm, parentGuid, title) {
  const children = await getBookmarkChildren(bm, parentGuid);
  const typeFolder = bm.TYPE_FOLDER || 2;
  const existing = children.find((c) => c.type === typeFolder && c.title === title);
  if (existing) {
    return existing.guid;
  }
  const created = await bm.insert({
    parentGuid,
    type: typeFolder,
    title,
  });
  return created.guid;
}

// Count archivable tabs (synchronous dry-run for UI/palette):
// opts: { maxAgeMs, ws }
function countArchivableTabs(opts) {
  try {
    const tabs = Array.from(gBrowser?.tabs || []);
    const maxAgeMs = opts?.maxAgeMs ?? 0;
    const now = Date.now();
    const cutoff = maxAgeMs > 0 ? now - maxAgeMs : now;
    const targetWs = opts?.ws;

    let count = 0;
    for (const t of tabs) {
      if (targetWs && typeof getWs === "function" && getWs(t) !== targetWs) {
        continue;
      }
      const c = canArchiveTab(t, cutoff, now);
      if (c.ok) {
        count++;
      }
    }
    return count;
  } catch (e) {
    return 0;
  }
}

// Core archiver: saves bookmarks in Places and removes tabs atomically.
// opts: { maxAgeMs, ws }
async function executeArchive(opts) {
  if (archiveInFlight) {
    return { archived: 0, reason: "busy" };
  }
  archiveInFlight = true;
  try {
    const bm = getPlacesBookmarks();
    if (!bm) {
      return { archived: 0, reason: "no-places" };
    }

    const tabs = Array.from(gBrowser?.tabs || []);
    const maxAgeMs = opts?.maxAgeMs ?? 0;
    const now = Date.now();
    const cutoff = maxAgeMs > 0 ? now - maxAgeMs : now;
    const targetWs = opts?.ws;

    // Group eligible tabs by workspace
    const wsGroups = new Map();
    for (const t of tabs) {
      if (targetWs && typeof getWs === "function" && getWs(t) !== targetWs) {
        continue;
      }
      const c = canArchiveTab(t, cutoff, now);
      if (c.ok) {
        const list = wsGroups.get(c.ws) || [];
        list.push({ tab: t, spec: c.spec, title: c.title });
        wsGroups.set(c.ws, list);
      }
    }

    if (wsGroups.size === 0) {
      return { archived: 0, reason: "empty" };
    }

    // Root folder: "Aph Archive" under unfiledGuid
    const unfiledGuid = bm.unfiledGuid || "unfiled_____";
    const archiveRootGuid = await ensureBookmarkFolder(bm, unfiledGuid, "Aph Archive");
    const dateStr = localDateString(new Date(now));

    let totalArchived = 0;

    for (const [wsId, items] of wsGroups.entries()) {
      let wsTitle = `Workspace ${wsId}`;
      try {
        if (typeof getWsName === "function") {
          const nm = getWsName(wsId);
          if (nm && nm !== wsTitle) {
            wsTitle = `Workspace ${wsId} (${nm})`;
          }
        }
      } catch (e) {}

      const wsFolderGuid = await ensureBookmarkFolder(bm, archiveRootGuid, wsTitle);
      const dateFolderGuid = await ensureBookmarkFolder(bm, wsFolderGuid, dateStr);

      // Check existing URLs in dateFolder to prevent duplicates.
      // In real Firefox Places, item.url is a URL object; in mocks/legacy, it may be a string.
      const existingChildren = await getBookmarkChildren(bm, dateFolderGuid);
      const seenUrls = new Set(
        existingChildren
          .map((c) => (c.url?.href || (typeof c.url === "string" ? c.url : "")).trim())
          .filter(Boolean)
      );

      // Separate items to insert vs items whose URL is already in today's folder
      const toInsert = [];
      const tabsToClose = [];

      for (const item of items) {
        if (!seenUrls.has(item.spec)) {
          seenUrls.add(item.spec);
          toInsert.push({ url: item.spec, title: item.title, tab: item.tab });
        } else {
          // Already bookmarked today; still close the redundant tab
          tabsToClose.push(item.tab);
        }
      }

      // Chunked insertion via insertTree
      if (toInsert.length > 0) {
        for (let i = 0; i < toInsert.length; i += ARCHIVE_CHUNK_SIZE) {
          const chunk = toInsert.slice(i, i + ARCHIVE_CHUNK_SIZE);
          const treeChildren = chunk.map((c) => ({ url: c.url, title: c.title }));
          await bm.insertTree({
            guid: dateFolderGuid,
            children: treeChildren,
          });
          // Close tabs ONLY after insertTree resolves cleanly
          for (const c of chunk) {
            tabsToClose.push(c.tab);
          }
        }
      }

      // Close all verified tabs, re-checking live guards in case state
      // changed during async Places operations.
      for (const t of tabsToClose) {
        try {
          if (
            t &&
            !t.closing &&
            !t.selected &&
            !t.pinned &&
            !t.busy &&
            gBrowser?.selectedTab !== t &&
            !t.linkedBrowser?.frameLoader?.tabParent?.hasBeforeUnload &&
            gBrowser?.removeTab
          ) {
            gBrowser.removeTab(t, { animate: false });
            totalArchived++;
          }
        } catch (e) {}
      }
    }

    if (totalArchived > 0) {
      archiveLog(`archived ${totalArchived} tab(s) into Places`);
    }
    return { archived: totalArchived };
  } catch (err) {
    archiveLog(`error during archive: ${err}`);
    return { archived: 0, reason: "error" };
  } finally {
    archiveInFlight = false;
  }
}

// Public API
function archiveStaleTabs(opts) {
  return executeArchive(opts);
}

function archiveWorkspaceTabs(ws) {
  const targetWs = typeof isValidId === "function" && isValidId(ws)
    ? ws
    : (typeof current !== "undefined" ? current : "1");
  return executeArchive({ ws: targetWs, maxAgeMs: 0 });
}

function isArchiveLeaderWindow() {
  try {
    if (typeof Services !== "undefined" && Services?.wm?.getMostRecentWindow) {
      return Services.wm.getMostRecentWindow("navigator:browser") === window;
    }
  } catch (e) {}
  return true;
}

function startArchiveSweeper() {
  if (archiveIntervalId) {
    return;
  }
  const days = getArchiveAutoDays();
  if (days <= 0) {
    return;
  }

  archiveIntervalId = setInterval(() => {
    try {
      if (!isArchiveLeaderWindow()) {
        return;
      }
      const d = getArchiveAutoDays();
      if (d > 0) {
        archiveStaleTabs({ maxAgeMs: d * 86400000 });
      }
    } catch (e) {}
  }, ARCHIVE_INTERVAL_MS);
}

function stopArchiveSweeper() {
  if (archiveStartupTimer) {
    clearTimeout(archiveStartupTimer);
    archiveStartupTimer = null;
  }
  if (archiveIntervalId) {
    clearInterval(archiveIntervalId);
    archiveIntervalId = null;
  }
}

function scheduleStartupArchive() {
  if (archiveStartupTimer) {
    clearTimeout(archiveStartupTimer);
    archiveStartupTimer = null;
  }
  const days = getArchiveAutoDays();
  if (days <= 0) {
    return;
  }

  archiveStartupTimer = setTimeout(() => {
    archiveStartupTimer = null;
    try {
      if (!isArchiveLeaderWindow()) {
        return;
      }
      if (typeof sessionRestorePending !== "undefined" && sessionRestorePending) {
        return;
      }
      const d = getArchiveAutoDays();
      if (d > 0) {
        archiveStaleTabs({ maxAgeMs: d * 86400000 });
      }
    } catch (e) {}
  }, ARCHIVE_STARTUP_DELAY_MS);
}
