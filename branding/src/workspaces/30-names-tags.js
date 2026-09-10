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
    // syncAllTabBindingMatches). Sync here to cover every retag path:
    // stamp, send, route, adopt, anchor, openBoundTab.
    syncTabBindingMatch(tab);
  }

