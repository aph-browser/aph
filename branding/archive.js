/* Aph tab archive — window-side controller (chrome window).
 *
 * A lightweight sweep-away for tabs you are done with right now: archiving
 * closes the tab(s) and stores title, URL, workspace, container and time in
 * a capped JSON pref (newest-first, FIFO at 300). The archive page
 * (chrome://browser/content/aph-archive.html) browses/restores them with
 * full context (workspace + container).
 *
 * Entry points: tab context menu ("Archive Tab(s)") and the command
 * palette ("Archive Current Tab" / "Open Archive"). Restore removes the
 * entry (Shift+click keeps it); delete drops it without opening.
 *
 * Page bridge: the archive page runs in a content process, so it reads the
 * pref directly (Services is available to system-principal chrome pages)
 * and asks for restores via the "aph-archive-restore" observer topic with
 * {contextId, id, keep}. Only the window owning that browsing context acts
 * (matched by linkedBrowser.browsingContext.id); it answers on
 * "aph-archive-result" so the page can confirm. Observer registrations are
 * released on unload (same discipline as workspaces.js cleanupWindowObservers).
 *
 * Injected into browser.xhtml via rebrand.py (after archive-shared.js).
 */
(function () {
  if (window.__aphArchiveLoaded) {
    return;
  }
  window.__aphArchiveLoaded = true;

  const PREF = "aph.archive.tabs";
  const OBS_RESTORE = "aph-archive-restore";
  const OBS_RESULT = "aph-archive-result";
  const ARCHIVE_URL = "chrome://browser/content/aph-archive.html";
  const TOAST_MS = 2400;

  let toastTimer = null;
  let cache = null; // null = not yet read (or invalidated by pref observer)
  let menuItem = null;
  let prefsObserver = null;

  function ws() {
    try {
      return window.AphWorkspaces || null;
    } catch (e) {
      return null;
    }
  }

  function logic() {
    try {
      return window.AphArchiveLogic || null;
    } catch (e) {
      return null;
    }
  }

  // Private windows never archive (fail open when the service is missing —
  // archiving is the safe direction; the page/rstore path re-checks nothing).
  let PB = null;
  try {
    ({ PrivateBrowsingUtils: PB } = ChromeUtils.importESModule(
      "resource://gre/modules/PrivateBrowsingUtils.sys.mjs"
    ));
  } catch (e) {}

  function isPrivateWindow() {
    try {
      return !!(PB && PB.isWindowPrivate(window));
    } catch (e) {
      return false;
    }
  }

  function loadEntries() {
    if (cache) {
      return cache;
    }
    cache = [];
    try {
      const raw = Services.prefs.getStringPref(PREF, "");
      if (raw) {
        const arr = JSON.parse(raw);
        const L = logic();
        cache = L ? L.sanitizeEntries(arr) : [];
      }
    } catch (e) {
      cache = [];
    }
    return cache;
  }

  function saveEntries(list) {
    const L = logic();
    const pruned = L ? L.pruneEntries(list) : (list || []).slice(0, 300);
    cache = pruned;
    try {
      Services.prefs.setStringPref(PREF, JSON.stringify(pruned));
    } catch (e) {}
  }

  function tabUrl(tab) {
    try {
      return tab.linkedBrowser?.currentURI?.spec || "";
    } catch (e) {
      return "";
    }
  }

  function isArchivable(tab) {
    try {
      if (!tab || tab.closing) {
        return false;
      }
      if (isPrivateWindow()) {
        return false;
      }
      const url = tabUrl(tab);
      const L = logic();
      return L ? L.isArchivableUrl(url) : /^https?:\/\//i.test(url);
    } catch (e) {
      return false;
    }
  }

  function normalizeEntry(tab) {
    try {
      const w = ws();
      const url = tabUrl(tab);
      if (!url) {
        return null;
      }
      let wsId = "1";
      try {
        if (w && w.getWs) {
          const g = w.getWs(tab);
          if (typeof g === "string" && /^[1-9]$/.test(g)) {
            wsId = g;
          }
        }
      } catch (e) {}
      let cid = 0;
      try {
        cid = tab.userContextId || 0;
      } catch (e) {}
      let cname = "";
      try {
        if (w && cid && w.describeContainer) {
          const d = w.describeContainer(cid);
          if (d && d.name) {
            cname = d.name;
          }
        }
      } catch (e) {}
      let title = "";
      try {
        title = tab.label || "";
      } catch (e) {}
      let favicon = "";
      try {
        if (typeof tab.image === "string" && tab.image.length <= 8192) {
          favicon = tab.image;
        }
      } catch (e) {}
      const L = logic();
      return {
        id: `${Date.now().toString(36)}-${Math.floor(Math.random() * 0xffffff).toString(36)}`,
        title: title || url,
        url,
        host: L ? L.hostOfUrl(url) : "",
        ws: wsId,
        cid,
        cname,
        favicon,
        ts: Date.now(),
      };
    } catch (e) {
      return null;
    }
  }

  // Clicked tab wins; when it belongs to a multiselection the whole
  // selection goes. Null (palette path) archives the current selection.
  function resolveTargets(clicked) {
    let tabs = [];
    try {
      const multi = gBrowser.selectedTabs || gBrowser.multiselectedTabs || [];
      if (clicked) {
        tabs = multi.includes(clicked) && multi.length > 1 ? [...multi] : [clicked];
      } else if (multi.length) {
        tabs = [...multi];
      } else if (gBrowser.selectedTab) {
        tabs = [gBrowser.selectedTab];
      }
    } catch (e) {
      tabs = [];
    }
    return tabs.filter((t) => t && !t.closing);
  }

  function archiveTabs(tabs) {
    let list = [];
    try {
      list = (tabs || []).filter(isArchivable);
    } catch (e) {
      list = [];
    }
    if (!list.length) {
      toast("Nothing archivable here");
      return 0;
    }
    const entries = list.map(normalizeEntry).filter((e) => e && e.url);
    if (!entries.length) {
      return 0;
    }
    saveEntries([...entries, ...loadEntries()]);
    // Close unselected tabs first so the selection (and its workspace
    // bookkeeping) stays sane while the sweep runs.
    let sel = null;
    try {
      sel = gBrowser.selectedTab;
    } catch (e) {}
    const ordered = [...list].sort((a, b) => (a === sel ? 1 : b === sel ? -1 : 0));
    for (const t of ordered) {
      try {
        gBrowser.removeTab(t, { animate: false });
      } catch (e) {
        try {
          gBrowser.removeTab(t);
        } catch (_e) {}
      }
    }
    toast(`Archived ${entries.length} tab${entries.length === 1 ? "" : "s"}`);
    return entries.length;
  }

  function archiveTab(tab) {
    return archiveTabs(resolveTargets(tab || null));
  }

  function archiveCurrent() {
    return archiveTabs(resolveTargets(null));
  }

  // Palette label helper: "Archive Current Tab" or "Archive N Tabs".
  function pendingCount() {
    try {
      return resolveTargets(null).filter(isArchivable).length;
    } catch (e) {
      return 0;
    }
  }

  // Stored container may be gone (deleted, or a temp container cleaned up
  // after its last tab closed) — fall back to unbound rather than failing.
  function validCid(cid) {
    try {
      const w = ws();
      if (!cid || !w || !w.describeContainer) {
        return 0;
      }
      return w.describeContainer(cid) ? cid : 0;
    } catch (e) {
      return 0;
    }
  }

  function restoreEntry(id, opts) {
    const keep = !!(opts && opts.keep);
    try {
      const entries = loadEntries();
      const i = entries.findIndex((e) => e && e.id === id);
      if (i === -1) {
        return { ok: false, reason: "missing" };
      }
      const entry = entries[i];
      const w = ws();
      const target =
        typeof entry.ws === "string" && /^[1-9]$/.test(entry.ws) ? entry.ws : null;
      const cid = validCid(entry.cid);
      let tab = null;
      try {
        if (w && w.openInWorkspace) {
          tab = w.openInWorkspace(entry.url, target, cid);
        } else {
          tab = gBrowser.addTrustedTab(entry.url);
        }
      } catch (e) {
        tab = null;
      }
      if (!tab) {
        return { ok: false, reason: "open-failed" };
      }
      if (!keep) {
        entries.splice(i, 1);
        saveEntries(entries);
      }
      // Pull the window along when the entry belongs elsewhere, then land
      // selection on the restored tab (switchTo alone focuses MRU/first).
      try {
        if (w && w.getCurrent && w.switchTo && target && target !== w.getCurrent()) {
          w.switchTo(target);
        }
      } catch (e) {}
      try {
        gBrowser.showTab(tab);
      } catch (e) {}
      try {
        gBrowser.selectedTab = tab;
      } catch (e) {}
      return { ok: true };
    } catch (e) {
      return { ok: false, reason: "error" };
    }
  }

  function deleteEntry(id) {
    try {
      const entries = loadEntries();
      const i = entries.findIndex((e) => e && e.id === id);
      if (i === -1) {
        return false;
      }
      entries.splice(i, 1);
      saveEntries(entries);
      return true;
    } catch (e) {
      return false;
    }
  }

  function getEntries() {
    try {
      return loadEntries().slice();
    } catch (e) {
      return [];
    }
  }

  // Reuse one archive tab per window instead of stacking duplicates.
  function openArchive() {
    try {
      for (const t of Array.from(gBrowser.tabs || [])) {
        try {
          if (!t.closing && tabUrl(t) === ARCHIVE_URL) {
            gBrowser.selectedTab = t;
            return true;
          }
        } catch (e) {}
      }
    } catch (e) {}
    try {
      const t = gBrowser.addTrustedTab(ARCHIVE_URL);
      gBrowser.selectedTab = t;
      return true;
    } catch (e) {
      return false;
    }
  }

  function contextIdOf(tab) {
    try {
      return tab.linkedBrowser?.browsingContext?.id || 0;
    } catch (e) {
      return 0;
    }
  }

  // Restore requests from archive pages (any process): only the window
  // that owns the requesting browsing context acts.
  const restoreObserver = {
    observe(subj, topic, data) {
      try {
        if (topic !== OBS_RESTORE) {
          return;
        }
        let msg = null;
        try {
          msg = JSON.parse(data);
        } catch (e) {
          return;
        }
        if (!msg || !msg.id || !msg.contextId) {
          return;
        }
        let owns = false;
        try {
          for (const t of Array.from(gBrowser.tabs || [])) {
            if (!t.closing && contextIdOf(t) === msg.contextId) {
              owns = true;
              break;
            }
          }
        } catch (e) {}
        if (!owns) {
          return;
        }
        const r = restoreEntry(msg.id, { keep: !!msg.keep });
        try {
          Services.obs.notifyObservers(
            null,
            OBS_RESULT,
            JSON.stringify({
              contextId: msg.contextId,
              id: msg.id,
              ok: !!r.ok,
              reason: r.reason || "",
            })
          );
        } catch (e) {}
      } catch (e) {}
    },
  };

  function onTabMenuShowing(e) {
    try {
      const menu = e.currentTarget || e.target;
      if (!menu || typeof menu.appendChild !== "function") {
        return;
      }
      try {
        if (menuItem && menuItem.parentNode) {
          menuItem.remove();
        }
      } catch (err) {}
      menuItem = null;
      let node = null;
      try {
        const popup = e.target;
        node = (popup && popup.triggerNode) || document.popupNode || null;
      } catch (err) {}
      // Mirror stock tab-context-menu.js: triggerNode may carry the tab
      // directly (.tab) or contain it; fall back to the selected tab.
      let clicked = null;
      try {
        if (node) {
          clicked =
            node.tab ||
            (typeof node.closest === "function" ? node.closest("tab") : null);
        }
        if (!clicked && gBrowser.selectedTab) {
          clicked = gBrowser.selectedTab;
        }
      } catch (err) {
        clicked = null;
      }
      const targets = resolveTargets(clicked).filter(isArchivable);
      if (!targets.length) {
        return;
      }
      // browser.xhtml is an XHTML document: document.createElement would
      // build an HTML-namespaced dud that never renders inside the XUL
      // menupopup. Stock code uses createXULElement (see _createTabGroupMenuItem).
      const item =
        typeof document.createXULElement === "function"
          ? document.createXULElement("menuitem")
          : document.createElement("menuitem");
      try {
        item.id = "aph-archive-tab";
        item.setAttribute(
          "label",
          targets.length > 1 ? `Archive ${targets.length} Tabs` : "Archive Tab"
        );
      } catch (err) {}
      item.addEventListener("command", () => {
        try {
          archiveTabs(targets);
        } catch (err) {}
      });
      menu.appendChild(item);
      menuItem = item;
    } catch (e) {}
  }

  function ensureToast() {
    try {
      let el = document.getElementById("aph-toast");
      if (el) {
        return el;
      }
      el = document.createElement("div");
      el.id = "aph-toast";
      (document.body || document.documentElement).appendChild(el);
      return el;
    } catch (e) {
      return null;
    }
  }

  function toast(msg) {
    try {
      const el = ensureToast();
      if (!el) {
        return;
      }
      el.textContent = msg;
      el.classList.add("show");
      if (toastTimer) {
        clearTimeout(toastTimer);
      }
      toastTimer = setTimeout(() => {
        try {
          el.classList.remove("show");
        } catch (e) {}
        toastTimer = null;
      }, TOAST_MS);
    } catch (e) {}
  }

  function cleanup() {
    try {
      if (prefsObserver) {
        Services.prefs.removeObserver(PREF, prefsObserver);
      }
    } catch (e) {}
    prefsObserver = null;
    try {
      Services.obs.removeObserver(restoreObserver, OBS_RESTORE);
    } catch (e) {}
    try {
      const menu = document.getElementById("tabContextMenu");
      if (menu) {
        menu.removeEventListener("popupshowing", onTabMenuShowing);
      }
    } catch (e) {}
    try {
      if (menuItem && menuItem.parentNode) {
        menuItem.remove();
      }
    } catch (e) {}
    menuItem = null;
    try {
      if (toastTimer) {
        clearTimeout(toastTimer);
        toastTimer = null;
      }
    } catch (e) {}
  }

  function init() {
    try {
      window.AphArchive = {
        archiveTabs,
        archiveTab,
        archiveCurrent,
        pendingCount,
        getEntries,
        restoreEntry,
        deleteEntry,
        openArchive,
        isArchivable,
      };
    } catch (e) {}
    try {
      prefsObserver = {
        observe() {
          try {
            cache = null;
          } catch (e) {}
        },
      };
      Services.prefs.addObserver(PREF, prefsObserver);
    } catch (e) {
      prefsObserver = null;
    }
    try {
      Services.obs.addObserver(restoreObserver, OBS_RESTORE, false);
    } catch (e) {}
    try {
      const menu = document.getElementById("tabContextMenu");
      if (menu && typeof menu.addEventListener === "function") {
        menu.addEventListener("popupshowing", onTabMenuShowing);
      }
    } catch (e) {}
    try {
      window.addEventListener("unload", cleanup, { once: true });
    } catch (e) {}
  }

  if (document.readyState === "complete") {
    init();
  } else {
    window.addEventListener("load", init, { once: true });
  }
})();
