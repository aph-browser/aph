  // --- URL / search fallback -------------------------------------------
  // Direct navigation: "github.com", "localhost:3000", "https://…".
  // Anything with whitespace is a search, never a URL.
  function isLikelyURL(str) {
    const s = (str || "").trim();
    if (!s || /\s/.test(s)) {
      return false;
    }
    if (/^https?:\/\//i.test(s)) {
      return true;
    }
    if (/^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(:\d+)?(\/.*)?$/i.test(s)) {
      return true;
    }
    // Dotted hostnames where the final label contains a letter
    // ("github.com", "file.txt") — pure numerics ("v1.2.3", "1.2")
    // are versions, not hosts, and fall through to search.
    if (/^[a-zA-Z0-9-]+(\.[a-zA-Z0-9-]+)*(\.[a-zA-Z0-9-]*[a-zA-Z][a-zA-Z0-9-]*)(:\d+)?(\/.*)?$/.test(s)) {
      return true;
    }
    // IPv4 (plain or LAN) with optional port/path.
    if (/^\d{1,3}(\.\d{1,3}){3}(:\d+)?(\/.*)?$/.test(s)) {
      return true;
    }
    // Bare host with an explicit port/path, e.g. mybox:8080/status.
    if (/^[a-zA-Z0-9-]+(:\d+)(\/.*)?$/.test(s)) {
      return true;
    }
    return false;
  }

  function normalizeURL(str) {
    const s = (str || "").trim();
    if (/^https?:\/\//i.test(s)) {
      return s;
    }
    // Local / LAN hosts rarely serve TLS — plain http avoids a cert error.
    if (/^(localhost|127\.|0\.0\.0\.0|\[::1\]|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/i.test(s)) {
      return `http://${s}`;
    }
    return `https://${s}`;
  }

  function searchURL(q) {
    return `https://duckduckgo.com/?q=${encodeURIComponent(q)}`;
  }

  // Container-aware launch: bound container of the current workspace wins
  // (openBoundTab), temp forces a disposable container. A URL matching a
  // domain route opens directly in the routed workspace, so the router
  // doesn't have to close + reopen it a moment later (no double-hop).
  // Falls back to a plain selected tab when the workspaces API is missing.
  function openURL(url, temp) {
    const api = ws();
    try {
      if (temp && api && api.openTempTab) {
        api.openTempTab(url);
        return;
      }
      if (!temp && api && api.openBoundTab) {
        api.openBoundTab(url, routedWs(api, url));
        return;
      }
    } catch (e) {}
    try {
      const t = gBrowser.addTrustedTab(url);
      try {
        gBrowser.selectedTab = t;
      } catch (_e) {}
    } catch (e) {}
  }

  function hostOfURL(url) {
    try {
      return (new URL(url).hostname || "").toLowerCase().replace(/\.$/, "");
    } catch (e) {
      try {
        const m = String(url || "").match(/^[a-z]+:\/\/([^/:?#]+)/i);
        return m ? m[1].toLowerCase().replace(/\.$/, "") : "";
      } catch (_e) {
        return "";
      }
    }
  }

  // Workspace a URL would route to ("" when none). Temp tabs ignore this
  // on purpose — Alt+Enter is an explicit disposable choice.
  function routedWs(api, url) {
    try {
      if (api && api.matchRoute) {
        const m = api.matchRoute(hostOfURL(url));
        if (m && m.ws) {
          return m.ws;
        }
      }
    } catch (e) {}
    return "";
  }

  function boundContainerNote() {
    try {
      const api = ws();
      if (api && api.getCurrent && api.getWsContainer && api.describeContainer) {
        const id = api.getWsContainer(api.getCurrent());
        if (id) {
          const d = api.describeContainer(id);
          if (d && d.name) {
            return ` · opens in ${d.name}`;
          }
        }
      }
    } catch (e) {}
    return "";
  }

  // Always present for non-empty input so Enter never dead-ends: a "Go to"
  // entry for URL-like input (surfaced first by allItems), else a
  // DuckDuckGo search (surfaced last).
  function navFallback(raw) {
    const q = (raw || "").trim();
    if (!q) {
      return null;
    }
    const note = `${boundContainerNote()} · Alt+Enter opens temp`;
    if (isLikelyURL(q)) {
      const url = normalizeURL(q);
      const dest = routedWs(ws(), url);
      return {
        title: `Go to ${url}`,
        sub: `${url}${dest ? ` · auto-routes to WS ${dest}` : note}`,
        hint: "Enter",
        run: () => openURL(url, false),
        runInTemp: () => openURL(url, true),
      };
    }
    const shown = q.length > 60 ? `${q.slice(0, 60)}…` : q;
    const url = searchURL(q);
    return {
      title: `Search DuckDuckGo for: "${shown}"`,
      sub: `${url}${note}`,
      hint: "Enter",
      run: () => openURL(url, false),
      runInTemp: () => openURL(url, true),
    };
  }

