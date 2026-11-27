  // Window-scoped workspaces: every window has its own workspaces 1-9.
  function isPrivateWindow(win) {
    try {
      const target = win || window;
      const pbu = target?.PrivateBrowsingUtils || window?.PrivateBrowsingUtils;
      return !!pbu?.isWindowPrivate?.(target);
    } catch (e) {
      return false;
    }
  }
  const aphIsPrivateWindow = isPrivateWindow;

  function listAphWindows() {
    const out = [];
    try {
      if (typeof Services === "undefined" || !Services.wm) {
        return [window];
      }
      const en = Services.wm.getEnumerator("navigator:browser");
      while (en?.hasMoreElements?.()) {
        const w = en.getNext();
        if (w && !w.closed && w.gBrowser) {
          out.push(w);
        }
      }
    } catch (e) {}
    if (!out.includes(window)) {
      out.push(window);
    }
    return out;
  }

  function setWindowWs(target) {
    if (!isValidId(target)) return;
    try {
      window.__aphWsCurrent = target;
      SessionStore?.setCustomWindowValue?.(window, WIN_KEY, target);
    } catch (e) {}
  }

  function getWindowWs(win) {
    try {
      const live = win?.__aphWsCurrent;
      if (isValidId(live)) return live;
      const v = SessionStore?.getCustomWindowValue?.(win, WIN_KEY);
      return isValidId(v) ? v : null;
    } catch (e) {
      return null;
    }
  }

  // Candidate destinations for "Move Tab to Other Window"
  function listWindows() {
    const out = [];
    const selfPrivate = isPrivateWindow(window);
    for (const w of listAphWindows()) {
      try {
        if (!w || w === window || w.closed || !w.gBrowser) continue;
        if (!!isPrivateWindow(w) !== !!selfPrivate) continue;
        const ws = getWindowWs(w);
        out.push({ win: w, ws: isValidId(ws) ? ws : null });
      } catch (e) {}
    }
    return out;
  }

  function scrubAdoptionGhost(ownerWin, oldTab) {
    try {
      if (!ownerWin || !oldTab) return;
      const spec = tabSpec(oldTab);
      if (!spec || isInternalSpec(spec)) return;
      SessionStore?.forgetClosedTab?.(ownerWin, 0);
    } catch (e) {}
  }

  function lowestUnownedWorkspace() {
    try {
      const owned = new Set();
      if (!isPrivateWindow(window)) {
        for (const w of listAphWindows()) {
          if (!w || w.closed || isPrivateWindow(w)) continue;
          const ws = w === window ? null : getWindowWs(w);
          if (isValidId(ws)) owned.add(ws);
        }
      }
      for (let i = 1; i <= 9; i++) {
        const id = String(i);
        if (!owned.has(id)) return id;
      }
    } catch (e) {}
    return null;
  }

  function debugSession() {
    const out = [];
    try {
      const rec = { ws: getWindowWs(window), self: true, tabs: [] };
      const tabs = Array.from(gBrowser?.tabs || []);
      for (const t of tabs) {
        const r = {
          label: String(t?.label || "").slice(0, 60),
          spec: String(t?.linkedBrowser?.currentURI?.spec || "?").slice(0, 80),
          ws: typeof rawWs === "function" ? rawWs(t) : SessionStore?.getCustomTabValue?.(t, KEY),
        };
        for (const k of ["hidden", "pinned", "selected", "closing"]) {
          r[k] = !!t?.[k];
        }
        r.pending = !!t?.hasAttribute?.("pending");
        rec.tabs.push(r);
      }
      out.push(rec);
    } catch (e) {}
    return out;
  }

  function tabSpec(t) {
    return typeof t?.linkedBrowser?.currentURI?.spec === "string" ? t.linkedBrowser.currentURI.spec : "";
  }

  function isInternalSpec(spec) {
    const s = String(spec || "").toLowerCase();
    return s.startsWith("about:") || s.startsWith("chrome:") || s.startsWith("resource:");
  }
