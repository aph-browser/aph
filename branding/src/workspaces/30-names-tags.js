  // Workspace names ("2" -> "💼 Work"). Persisted as JSON in a plain pref.
  // Empty/blank clears back to the default "Workspace N". Cross-window
  // sync via the pref observer registered in init().
  const WS_NAMES_PREF = "aph.workspaces.names";
  const WS_NAME_MAX = 40;
  let wsNames = null; // lazy-loaded {wsId: name}

  function loadWsNames() {
    if (wsNames) {
      return wsNames;
    }
    wsNames = Object.create(null);
    try {
      let raw = "";
      try {
        raw = Services.prefs.getStringPref(WS_NAMES_PREF, "");
      } catch (e) {}
      if (raw) {
        const obj = JSON.parse(raw);
        for (const k of Object.keys(obj || {})) {
          const v = String(obj[k] || "").trim();
          if (isValidId(k) && v) {
            wsNames[k] = v.slice(0, WS_NAME_MAX);
          }
        }
      }
    } catch (e) {}
    return wsNames;
  }

  function saveWsNames() {
    try {
      const plain = {};
      const map = loadWsNames();
      for (const k of Object.keys(map)) {
        plain[k] = map[k];
      }
      Services.prefs.setStringPref(WS_NAMES_PREF, JSON.stringify(plain));
    } catch (e) {}
  }

  function getWsName(wsId) {
    try {
      return loadWsNames()[wsId] || "";
    } catch (e) {
      return "";
    }
  }

  function setWsName(wsId, name) {
    if (!isValidId(wsId)) {
      return false;
    }
    const trimmed = String(name || "").trim().slice(0, WS_NAME_MAX);
    try {
      if (trimmed) {
        loadWsNames()[wsId] = trimmed;
      } else {
        delete loadWsNames()[wsId];
      }
      saveWsNames();
    } catch (e) {
      return false;
    }
    updateIndicator();
    return true;
  }

  function isValidId(v) {
    return v >= "1" && v <= "9" && v.length === 1;
  }

  function rawWs(tab) {
    try {
      const v = SessionStore.getCustomTabValue(tab, KEY);
      return isValidId(v) ? v : null;
    } catch (e) {
      return null;
    }
  }

  function getWs(tab) {
    return rawWs(tab) || "1";
  }

  function setWs(tab, ws) {
    try {
      SessionStore.setCustomTabValue(tab, KEY, ws);
    } catch (e) {}
    // Containers are immutable per tab, so the only thing that changes a
    // tab's match state is its workspace tag (binding changes go through
    // syncAllTabChrome). Sync here to cover every retag path:
    // stamp, send, route, adopt, anchor, openBoundTab.
    syncTabChrome(tab);
  }

  // Last-viewed stamp for auto-archive staleness: SessionStore custom tab
  // value LAST_VIEWED_KEY, ms epoch as a string (same persistence as
  // workspace tags, so stamps survive restarts and restored tabs keep
  // their pre-restart viewed time). Stamped on TabSelect (45) and TabOpen
  // (80); never on SSTabRestored (restore must not look like viewing).
  // archive.js reads it at sweep time (key duplicated there by design —
  // same pattern as "aphStarred" in 50/76).
  const LAST_VIEWED_KEY = "aphLastViewed";

  function stampLastViewed(tab) {
    try {
      if (!tab) {
        return;
      }
      SessionStore.setCustomTabValue(tab, LAST_VIEWED_KEY, String(Date.now()));
    } catch (e) {}
  }

  // Central per-tab chrome sync (the choke point): every lifecycle entry
  // that births, retags, restores, pins, or reveals a tab funnels marker
  // state through here, so no marker depends on remembering every path.
  // Covers the bound-container match (10) and the star marker + close
  // tooltip (76). Tree levels and visibility stay bulk (renderTree /
  // reconcile) and are called alongside at the same entries.
  function syncTabChrome(tab) {
    try {
      if (typeof syncTabBindingMatch === "function") {
        syncTabBindingMatch(tab);
      }
    } catch (e) {}
    try {
      if (typeof syncStarTabChrome === "function") {
        syncStarTabChrome(tab);
      }
    } catch (e) {}
  }

  function syncAllTabChrome() {
    try {
      const tabs = gBrowser ? gBrowser.tabs : null;
      if (!tabs) {
        return;
      }
      for (const t of Array.from(tabs)) {
        try {
          syncTabChrome(t);
        } catch (e) {}
      }
    } catch (e) {}
  }

