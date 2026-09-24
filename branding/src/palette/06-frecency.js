  // --- Command frecency (sync, best-effort) ------------------------------
  // Frequently + recently used commands float up. Persisted as JSON in a
  // pref so it survives restarts; in-memory only when Services is absent
  // (tests). recordFrecency() is called from choose(); frecBoost() is
  // added to the fuzzy score in allItems().
  function loadFrecency() {
    if (frecMap) {
      return frecMap;
    }
    frecMap = {};
    try {
      if (
        typeof Services !== "undefined" &&
        Services &&
        Services.prefs &&
        typeof Services.prefs.getCharPref === "function"
      ) {
        let raw = "";
        try {
          raw = Services.prefs.getCharPref(APH_FRECENCY_PREF);
        } catch (e) {
          raw = "";
        }
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed && typeof parsed === "object") {
            frecMap = parsed;
          }
        }
      }
    } catch (e) {
      frecMap = frecMap || {};
    }
    return frecMap;
  }

  function saveFrecency() {
    try {
      if (
        typeof Services === "undefined" ||
        !Services ||
        !Services.prefs ||
        typeof Services.prefs.setCharPref !== "function"
      ) {
        return;
      }
      const map = frecMap || {};
      const keys = Object.keys(map);
      // Cap: keep most-recently used.
      if (keys.length > APH_FRECENCY_MAX) {
        keys
          .sort((a, b) => (map[a].last || 0) - (map[b].last || 0))
          .slice(0, keys.length - APH_FRECENCY_MAX)
          .forEach((k) => {
            delete map[k];
          });
      }
      try {
        Services.prefs.setCharPref(APH_FRECENCY_PREF, JSON.stringify(map));
      } catch (e) {}
    } catch (e) {}
  }

  function frecIdFor(it) {
    try {
      // Stable enough: command titles are static except counts
      // ("Archive N Tabs" normalizes to "Archive Tab").
      const t = String((it && it.title) || "");
      return t.replace(/\b\d+ Tabs\b/, "Tab").replace(/\b\d+\b/g, "#");
    } catch (e) {
      return "";
    }
  }

  // +0..150: 5 points per use (cap 100) + recency decay (50 max, halves
  // after ~3 days). Tabs/places/archive get at most the usage part — the
  // recency kick is commands-only so MRU tabs keep their own order.
  function frecBoost(it) {
    try {
      const map = loadFrecency();
      const id = frecIdFor(it);
      if (!id || !map[id]) {
        return 0;
      }
      const e = map[id];
      const uses = Math.min(100, (e.uses || 0) * 5);
      let recency = 0;
      try {
        const age = Date.now() - (e.last || 0);
        if (age < 0) {
          recency = 0;
        } else if (age < 86400000) {
          recency = 50;
        } else if (age < 3 * 86400000) {
          recency = 25;
        } else if (age < 7 * 86400000) {
          recency = 10;
        }
      } catch (_e) {}
      const isCmd = it && (it.kind === "command" || it.section === "Commands" || it.section === "Workspaces");
      return uses + (isCmd ? recency : 0);
    } catch (e) {
      return 0;
    }
  }

  function recordFrecency(it) {
    try {
      const id = frecIdFor(it);
      if (!id) {
        return;
      }
      const map = loadFrecency();
      const prev = map[id] || { uses: 0, last: 0 };
      map[id] = { uses: (prev.uses || 0) + 1, last: Date.now() };
      saveFrecency();
    } catch (e) {}
  }
