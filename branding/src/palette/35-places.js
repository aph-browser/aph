  // --- Bookmarks / history search ---------------------------------------
  // Palette doubles as launcher: typed queries also match Places bookmarks
  // and history (frecency-ordered, like the urlbar). Sync path via the
  // classic history service (Cc/Ci, still the query entry point —
  // PlacesUtils.history is the async fetch API and has no executeQuery),
  // so allItems() stays synchronous and the empty view stays clean
  // (places only join non-empty queries, like domain routes).
  // Private windows hide history (urlbar parity) but keep bookmarks.
  // Test seam: window.AphPlaces = { searchBookmarks(q, limit),
  // searchHistory(q, limit) } (each returns [{title, url|uri}]).
  var APH_PLACES_MIN_QUERY = 2;
  var APH_PLACES_BOOKMARK_LIMIT = 8;
  var APH_PLACES_HISTORY_LIMIT = 8;

  function aphPlacesIsPrivate() {
    try {
      if (typeof isPrivatePaletteWindow === "function") {
        return !!isPrivatePaletteWindow();
      }
    } catch (e) {}
    try {
      const pbu = window.PrivateBrowsingUtils;
      if (pbu && typeof pbu.isWindowPrivate === "function") {
        return !!pbu.isWindowPrivate(window);
      }
    } catch (e) {}
    return false;
  }

  function aphPlacesSeam() {
    try {
      return window.AphPlaces || null;
    } catch (e) {
      return null;
    }
  }

  function aphPlacesNormalizeSeamRows(rows) {
    const out = [];
    try {
      if (!Array.isArray(rows)) {
        return out;
      }
      for (const r of rows) {
        try {
          const url = (r && (r.url || r.uri)) || "";
          if (!url || /^place:/i.test(url)) {
            continue;
          }
          const title = (r && r.title) || url;
          out.push({ title: String(title), url: String(url) });
        } catch (e) {}
      }
    } catch (e) {}
    return out;
  }

  // Array when the seam answers (possibly empty), null when there is no
  // seam for this kind (fall back to the history service).
  function aphPlacesSeamSearch(kind, query, limit) {
    try {
      const seam = aphPlacesSeam();
      if (!seam) {
        return null;
      }
      let fn = null;
      try {
        if (kind === "bookmark") {
          fn = seam.searchBookmarks || seam.searchBookmark || null;
        } else {
          fn = seam.searchHistory || seam.searchHist || null;
        }
      } catch (e) {}
      if (typeof fn === "function") {
        try {
          return aphPlacesNormalizeSeamRows(fn.call(seam, query, limit));
        } catch (e) {
          return [];
        }
      }
      try {
        if (typeof seam.query === "function") {
          const r = seam.query.call(seam, kind, query, limit);
          if (Array.isArray(r)) {
            return aphPlacesNormalizeSeamRows(r);
          }
          // Seam present but async (promise) — sync path can't await it.
          if (r && typeof r.then === "function") {
            return [];
          }
        }
      } catch (e) {}
      // Seam exists but doesn't implement this kind — let the caller fall
      // back to the history service rather than claiming zero results.
      return null;
    } catch (e) {}
    return null;
  }

  function aphPlacesHistorySvc() {
    try {
      if (typeof Cc !== "undefined" && typeof Ci !== "undefined" && Cc && Ci) {
        try {
          const svc = Cc["@mozilla.org/browser/nav-history-service;1"].getService(
            Ci.nsINavHistoryService
          );
          if (svc && typeof svc.getNewQuery === "function") {
            return svc;
          }
        } catch (e) {}
      }
    } catch (e) {}
    try {
      if (
        typeof PlacesUtils !== "undefined" &&
        PlacesUtils &&
        PlacesUtils.history &&
        typeof PlacesUtils.history.getNewQuery === "function"
      ) {
        return PlacesUtils.history;
      }
    } catch (e) {}
    return null;
  }

  function aphPlacesQuerySync(svc, searchTerms, wantBookmarks, maxResults) {
    const out = [];
    try {
      if (!svc || !searchTerms) {
        return out;
      }
      let q = null;
      let opts = null;
      try {
        q = svc.getNewQuery();
        opts = svc.getNewQueryOptions();
      } catch (e) {
        return out;
      }
      if (!q || !opts) {
        return out;
      }
      try {
        q.searchTerms = searchTerms;
      } catch (e) {
        return out;
      }
      try {
        if (wantBookmarks) {
          opts.queryType =
            opts.QUERY_TYPE_BOOKMARKS !== undefined ? opts.QUERY_TYPE_BOOKMARKS : 1;
        } else {
          opts.queryType =
            opts.QUERY_TYPE_HISTORY !== undefined ? opts.QUERY_TYPE_HISTORY : 0;
        }
      } catch (e) {}
      try {
        if (opts.SORT_BY_FRECENCY_DESCENDING !== undefined) {
          opts.sortingMode = opts.SORT_BY_FRECENCY_DESCENDING;
        } else if (opts.SORT_BY_VISITCOUNT_DESCENDING !== undefined) {
          opts.sortingMode = opts.SORT_BY_VISITCOUNT_DESCENDING;
        } else if (opts.SORT_BY_DATE_DESCENDING !== undefined) {
          opts.sortingMode = opts.SORT_BY_DATE_DESCENDING;
        }
      } catch (e) {}
      try {
        opts.maxResults = maxResults;
      } catch (e) {}
      try {
        if ("excludeQueries" in opts) {
          opts.excludeQueries = true;
        }
      } catch (e) {}
      let res = null;
      try {
        res = svc.executeQuery(q, opts);
      } catch (e) {
        return out;
      }
      if (!res || !res.root) {
        return out;
      }
      const root = res.root;
      try {
        root.containerOpen = true;
      } catch (e) {
        return out;
      }
      try {
        let n = 0;
        try {
          n = Math.min(root.childCount || 0, maxResults);
        } catch (e) {}
        for (let i = 0; i < n; i++) {
          let node = null;
          try {
            node = root.getChild(i);
          } catch (e) {
            continue;
          }
          if (!node) {
            continue;
          }
          let uri = "";
          let title = "";
          try {
            uri = node.uri || "";
          } catch (e) {}
          try {
            title = node.title || "";
          } catch (e) {}
          if (!uri || /^place:/i.test(uri)) {
            continue;
          }
          out.push({ title: title || uri, url: uri });
        }
      } finally {
        try {
          root.containerOpen = false;
        } catch (e) {}
      }
    } catch (e) {}
    return out;
  }

  function aphPlacesServiceSearch(query, wantBookmarks, maxResults) {
    try {
      const svc = aphPlacesHistorySvc();
      if (!svc) {
        return [];
      }
      return aphPlacesQuerySync(svc, query, wantBookmarks, maxResults);
    } catch (e) {
      return [];
    }
  }

  function aphPlacesOpenTabUrls() {
    const set = new Set();
    try {
      const tabs = (typeof gBrowser !== "undefined" && gBrowser && gBrowser.tabs) || [];
      for (const t of Array.from(tabs)) {
        try {
          const spec = t && t.linkedBrowser && t.linkedBrowser.currentURI && t.linkedBrowser.currentURI.spec;
          if (spec) {
            set.add(spec);
          }
        } catch (e) {}
      }
    } catch (e) {}
    return set;
  }

  function aphPlacesToItem(entry, kind, q) {
    const url = (entry && entry.url) || "";
    if (!url) {
      return null;
    }
    const title = (entry && entry.title) || url;
    const label = kind === "bookmark" ? "Bookmark" : "History";
    const it = {
      title: String(title),
      sub: String(url),
      hint: label,
      run: () => {
        try {
          if (typeof openURL === "function") {
            openURL(url, false);
          }
        } catch (e) {}
      },
      runInTemp: () => {
        try {
          if (typeof openURL === "function") {
            openURL(url, true);
          }
        } catch (e) {}
      },
    };
    // Highlight when the fuzzy matcher agrees; Places hits stay visible
    // even when it doesn't (tag matches, multi-term queries).
    try {
      if (q && typeof matchItem === "function") {
        const m = matchItem(it, q);
        if (m) {
          it._hl = { t: new Set(m.ti), s: new Set(m.si), h: new Set(m.hi) };
        }
      }
    } catch (e) {}
    return it;
  }

  // Bookmarks first (user-curated), then history. Dedupes by URL
  // (bookmark wins) and skips URLs already open as tabs (the tab row
  // switches; a duplicate "open again" row only invites accidents).
  function aphPlacesRowsForQuery(raw) {
    const trimmed = (raw || "").trim();
    if (trimmed.length < APH_PLACES_MIN_QUERY) {
      return [];
    }
    const isPrivate = aphPlacesIsPrivate();
    let bm = null;
    let hist = null;
    try {
      bm = aphPlacesSeamSearch("bookmark", trimmed, APH_PLACES_BOOKMARK_LIMIT);
    } catch (e) {
      bm = null;
    }
    try {
      hist = isPrivate
        ? []
        : aphPlacesSeamSearch("history", trimmed, APH_PLACES_HISTORY_LIMIT);
    } catch (e) {
      hist = isPrivate ? [] : null;
    }
    if (bm === null) {
      bm = aphPlacesServiceSearch(trimmed, true, APH_PLACES_BOOKMARK_LIMIT);
    }
    if (hist === null) {
      hist = isPrivate
        ? []
        : aphPlacesServiceSearch(trimmed, false, APH_PLACES_HISTORY_LIMIT);
    }
    const q = trimmed.toLowerCase();
    const seen = new Set();
    const openUrls = aphPlacesOpenTabUrls();
    const out = [];
    const pushAll = (rows, kind, limit) => {
      let added = 0;
      for (const entry of rows || []) {
        if (added >= limit) {
          break;
        }
        const url = (entry && entry.url) || "";
        if (!url || seen.has(url) || openUrls.has(url)) {
          continue;
        }
        const it = aphPlacesToItem(entry, kind, q);
        if (!it) {
          continue;
        }
        seen.add(url);
        out.push(it);
        added++;
      }
    };
    pushAll(bm, "bookmark", APH_PLACES_BOOKMARK_LIMIT);
    if (!isPrivate) {
      pushAll(hist, "history", APH_PLACES_HISTORY_LIMIT);
    }
    return out;
  }
