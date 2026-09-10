  // Domain → workspace routing: each host may be bound to one workspace
  // ("github.com" -> "2", managed from the command palette). Persisted as
  // JSON in a plain pref (survives restarts); entries pointing at invalid
  // workspace IDs are ignored on read. Cross-window sync via the pref
  // observer registered in init().
  const WS_ROUTES_PREF = "aph.workspaces.domainRoutes";
  let wsRoutes = null; // lazy-loaded {host: wsId}

  function normalizeHost(host) {
    try {
      return String(host || "").toLowerCase().replace(/\.$/, "");
    } catch (e) {
      return "";
    }
  }

  function loadRoutes() {
    if (wsRoutes) {
      return wsRoutes;
    }
    wsRoutes = Object.create(null);
    try {
      let raw = "";
      try {
        raw = Services.prefs.getStringPref(WS_ROUTES_PREF, "");
      } catch (e) {}
      if (raw) {
        const obj = JSON.parse(raw);
        for (const k of Object.keys(obj || {})) {
          const h = normalizeHost(k);
          if (h && isValidId(obj[k])) {
            wsRoutes[h] = obj[k];
          }
        }
      }
    } catch (e) {}
    return wsRoutes;
  }

  function saveRoutes() {
    try {
      const plain = {};
      const map = loadRoutes();
      for (const k of Object.keys(map)) {
        plain[k] = map[k];
      }
      Services.prefs.setStringPref(WS_ROUTES_PREF, JSON.stringify(plain));
    } catch (e) {}
  }

  // Longest-suffix wins: "aws.amazon.com" beats "amazon.com", which beats
  // nothing. Single-label hosts (localhost) only match exactly.
  function matchRoute(host) {
    const start = normalizeHost(host);
    if (!start) {
      return null;
    }
    const rules = loadRoutes();
    let h = start;
    for (;;) {
      if (Object.hasOwn(rules, h)) {
        const v = rules[h];
        if (isValidId(v)) {
          return { pattern: h, ws: v };
        }
      }
      const dot = h.indexOf(".");
      if (dot === -1) {
        return null;
      }
      h = h.slice(dot + 1);
    }
  }

  function setRoute(host, wsId) {
    const h = normalizeHost(host);
    if (!h || !isValidId(wsId)) {
      return false;
    }
    loadRoutes()[h] = wsId;
    saveRoutes();
    return true;
  }

  function deleteRoute(host) {
    const h = normalizeHost(host);
    if (!h) {
      return false;
    }
    try {
      if (!Object.hasOwn(loadRoutes(), h)) {
        return false;
      }
      delete loadRoutes()[h];
      saveRoutes();
      return true;
    } catch (e) {
      return false;
    }
  }

  function getAllRoutes() {
    const out = Object.create(null);
    try {
      const map = loadRoutes();
      for (const k of Object.keys(map)) {
        out[k] = map[k];
      }
    } catch (e) {}
    return out;
  }

