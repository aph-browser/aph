  // --- Saved stash search -----------------------------------------------
  // Stashed tabs join non-empty queries as fuzzy-pool items (newest-first,
  // capped), so they rank alongside commands and open tabs with match
  // highlighting handled by the normal scoring path. Restoring re-opens
  // with the saved workspace + container (restoreStashEntry owns the workspace
  // switch); Alt+Enter restores without consuming the entry (keep).
  // Hidden in private windows (bind parity): entries are non-private
  // pages whose restore retags into normal workspaces.
  // Test seam: window.AphStash = { getStashEntries() → [{id, title, url,
  // ws, cname}], restoreStashEntry(id, opts?) } — the real controller shape.
  var APH_STASH_MIN_QUERY = 2;
  var APH_STASH_POOL_LIMIT = 50;

  function aphStashIsPrivate() {
    try {
      if (typeof isPrivatePaletteWindow === "function") {
        return !!isPrivatePaletteWindow();
      }
    } catch (e) {}
    return false;
  }

  function aphStashEntries() {
    try {
      const a = typeof arc === "function" ? arc() : null;
      if (a && typeof a.getStashEntries === "function") {
        const r = a.getStashEntries();
        if (Array.isArray(r)) {
          return r;
        }
      }
    } catch (e) {}
    return [];
  }

  function aphStashPoolItems(raw) {
    const out = [];
    try {
      const q = (raw || "").trim();
      if (q.length < APH_STASH_MIN_QUERY) {
        return out;
      }
      if (aphStashIsPrivate()) {
        return out;
      }
      let openUrls = null;
      try {
        openUrls =
          typeof aphPlacesOpenTabUrls === "function" ? aphPlacesOpenTabUrls() : new Set();
      } catch (e) {
        openUrls = new Set();
      }
      let n = 0;
      for (const e of aphStashEntries()) {
        if (n >= APH_STASH_POOL_LIMIT) {
          break;
        }
        let url = "";
        let title = "";
        let id = "";
        let ws = "";
        let cname = "";
        try {
          url = (e && e.url) || "";
          title = (e && e.title) || url;
          id = (e && e.id) || "";
          ws = (e && e.ws) || "";
          cname = (e && e.cname) || "";
        } catch (err) {}
        if (!url || !id || !/^https?:\/\//i.test(url)) {
          continue;
        }
        // Restoring an already-open URL opens a duplicate — the open-tab
        // row already switches there (same rule as places rows).
        try {
          if (openUrls.has(url)) {
            continue;
          }
        } catch (err) {}
        const sub = `${url}${ws ? ` · WS ${ws}` : ""}${cname ? ` · ${cname}` : ""}`;
        out.push({
          title: String(title),
          sub,
          hint: "Stash",
          run: () => {
            try {
              const a = typeof arc === "function" ? arc() : null;
              if (a && typeof a.restoreStashEntry === "function") {
                a.restoreStashEntry(id);
              }
            } catch (err) {}
          },
          runInTemp: () => {
            try {
              const a = typeof arc === "function" ? arc() : null;
              if (a && typeof a.restoreStashEntry === "function") {
                a.restoreStashEntry(id, { keep: true });
              }
            } catch (err) {}
          },
        });
        n++;
      }
    } catch (e) {}
    return out;
  }
