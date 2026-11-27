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

  // Search engine: use Firefox's configured default (private default in
  // private windows), not a hardcoded provider. Services.search was only
  // removed from some test sandboxes, so the DuckDuckGo fallback is the
  // seam that keeps navFallback deterministic there.
  const FALLBACK_SEARCH_NAME = "DuckDuckGo";

  function defaultSearchEngine() {
    try {
      if (typeof Services === "undefined" || !Services || !Services.search) {
        return null;
      }
      let engine = null;
      try {
        if (
          typeof isPrivatePaletteWindow === "function" &&
          isPrivatePaletteWindow() &&
          Services.search.defaultPrivateEngine
        ) {
          engine = Services.search.defaultPrivateEngine;
        }
      } catch (e) {}
      if (!engine) {
        try {
          engine = Services.search.defaultEngine || null;
        } catch (e) {}
      }
      if (engine && typeof engine.getSubmission === "function") {
        return engine;
      }
    } catch (e) {}
    return null;
  }

  function searchEngineName() {
    try {
      const engine = defaultSearchEngine();
      if (engine && engine.name) {
        return String(engine.name);
      }
    } catch (e) {}
    return FALLBACK_SEARCH_NAME;
  }

  function searchURL(q, engine) {
    try {
      const e = engine === undefined ? defaultSearchEngine() : engine;
      if (e && typeof e.getSubmission === "function") {
        let charset = null;
        try {
          charset = e.queryCharset || null;
        } catch (_e) {}
        const submission = e.getSubmission(q, charset);
        if (submission && submission.uri && submission.uri.spec) {
          return submission.uri.spec;
        }
      }
    } catch (e) {}
    return `https://duckduckgo.com/?q=${encodeURIComponent(q)}`;
  }

  // Container-aware launch: bound container of the current workspace wins
  // (openBoundTab), temp forces a disposable container. A URL matching a
  // domain route opens directly in the routed workspace, so the router
  // doesn't have to close + reopen it a moment later (no double-hop).
  // Falls back to a plain selected tab when the workspaces API is missing.
  function navigateCurrentTab(url) {
    const api = ws();
    try {
      const dest = routedWs(api, url);
      if (dest && api && api.getCurrent && dest !== api.getCurrent()) {
        openURL(url, false);
        return;
      }
      if (typeof window !== "undefined" && typeof window.openTrustedLinkIn === "function") {
        window.openTrustedLinkIn(url, "current");
        return;
      }
      if (
        typeof gBrowser !== "undefined" &&
        gBrowser?.selectedBrowser &&
        typeof gBrowser.selectedBrowser.loadURI === "function" &&
        typeof Services !== "undefined" &&
        Services?.io?.newURI
      ) {
        const principal = Services.scriptSecurityManager?.getSystemPrincipal?.();
        gBrowser.selectedBrowser.loadURI(Services.io.newURI(url), { triggeringPrincipal: principal });
        return;
      }
    } catch (_e) {}
    openURL(url, false);
  }

  function openURL(url, temp) {
    const api = ws();
    try {
      if (temp && api && api.openTempTab) {
        api.openTempTab(url);
        return;
      }
      if (!temp && api && api.openBoundTab) {
        const dest = routedWs(api, url);
        if (dest && api.switchTo && api.getCurrent && dest !== api.getCurrent()) {
          api.switchTo(dest);
        }
        api.openBoundTab(url, dest);
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

  // Display-only URL cleanup for row subs: "host › clean path". Drops the
  // protocol, www., tracking query junk and trailing slash; over-long
  // paths truncate. Presentation only — navigation, clipboard and the
  // matcher's raw sub data are untouched (see configureRow, which only
  // uses this when no sub-highlight needs to align).
  function displayURL(url) {
    const input = String(url || "");
    if (!input) {
      return "";
    }
    const t = input.trim();
    if (!/^https?:\/\//i.test(t)) {
      return t.length > 72 ? `${t.slice(0, 72)}…` : t;
    }
    let host = "";
    let path = "";
    let suffix = "";
    try {
      const u = new URL(t);
      host = (u.hostname || "").toLowerCase().replace(/^www\./, "");
      path = String(u.pathname || "");
      if (u.search && u.search.length > 1) {
        suffix += " …";
      }
      if (u.hash && u.hash.length > 1) {
        suffix += " #";
      }
    } catch (e) {
      // No URL global (tests) or unparseable: manual parse, same shape
      // as hostOfURL()'s fallback below.
      try {
        const m = t.match(/^https?:\/\/([^/:?#]+)([^?#]*)(\?[^#]*)?(#.*)?$/i);
        if (m) {
          host = (m[1] || "").toLowerCase().replace(/^www\./, "");
          path = m[2] || "";
          if (m[3] && m[3].length > 1) {
            suffix += " …";
          }
          if (m[4] && m[4].length > 1) {
            suffix += " #";
          }
        }
      } catch (_e) {}
    }
    if (!host) {
      return t.length > 72 ? `${t.slice(0, 72)}…` : t;
    }
    if (path === "/" || !path) {
      path = "";
    } else {
      if (path.endsWith("/")) {
        path = path.slice(0, -1);
      }
      try {
        path = decodeURIComponent(path);
      } catch (e) {}
      if (path.startsWith("/")) {
        path = path.slice(1);
      }
    }
    let out = host + (path ? ` › ${path}` : "") + suffix;
    if (out.length > 72) {
      out = `${out.slice(0, 72)}…`;
    }
    return out;
  }

  // Always present for non-empty input so Enter never dead-ends: a "Go to"
  // entry for URL-like input (surfaced first by allItems), else a search
  // through the configured default engine (surfaced last).
  function navFallback(raw) {
    const q = (raw || "").trim();
    if (!q) {
      return null;
    }
    const inPlace = typeof editCurrentTab !== "undefined" && editCurrentTab;
    const note = `${boundContainerNote()} · Alt+Enter opens temp`;
    if (isLikelyURL(q)) {
      const url = normalizeURL(q);
      const dest = routedWs(ws(), url);
      return {
        title: `Go to ${url}`,
        sub: `${url}${dest ? ` · auto-routes to WS ${dest}` : note}`,
        hint: "Enter",
        run: () => (inPlace ? navigateCurrentTab(url) : openURL(url, false)),
        runInTemp: () => openURL(url, true),
      };
    }
    const shown = q.length > 60 ? `${q.slice(0, 60)}…` : q;
    const engine = defaultSearchEngine();
    const url = searchURL(q, engine);
    const name = (engine && engine.name) || FALLBACK_SEARCH_NAME;
    return {
      title: `Search ${name} for: "${shown}"`,
      sub: `${url}${note}`,
      hint: "Enter",
      run: () => (inPlace ? navigateCurrentTab(url) : openURL(url, false)),
      runInTemp: () => openURL(url, true),
    };
  }

