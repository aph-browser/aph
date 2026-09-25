  // Window-scoped workspaces (Vivaldi/Zen model): every window has its own
  // workspaces 1-9, and tabs belong to the window they live in. The same
  // workspace id may show in two windows at once — each window renders only
  // the tabs physically in its own strip whose tag (aphWs) matches its
  // current workspace (WIN_KEY). Windows never touch each other's tabs:
  // no pulls, no focus-jumps, no close-time merging. SessionStore saves
  // each window independently, so session restore just works natively.
  // Moving tabs across windows is always explicit ("Move Tab to Other
  // Window" in the palette / tab context menu), retagging arrivals to the
  // destination's current workspace.
  function aphWinId() {
    try {
      if (!window.__aphWinId) {
        window.__aphWinId =
          Math.random().toString(36).slice(2) + Date.now().toString(36);
      }
      return window.__aphWinId;
    } catch (e) {
      return "win";
    }
  }

  // Private windows never join the pool (no shared moves).
  function aphIsPrivateWindow(win) {
    try {
      const target = win || window;
      const pbu = target.PrivateBrowsingUtils || window.PrivateBrowsingUtils;
      if (pbu && typeof pbu.isWindowPrivate === "function") {
        return !!pbu.isWindowPrivate(target);
      }
    } catch (e) {}
    return false;
  }

  function listAphWindows() {
    const out = [];
    try {
      if (typeof Services === "undefined" || !Services.wm) {
        return [window];
      }
      const en = Services.wm.getEnumerator("navigator:browser");
      while (en && typeof en.hasMoreElements === "function" && en.hasMoreElements()) {
        let w = null;
        try {
          w = en.getNext();
        } catch (e) {}
        try {
          if (w && !w.closed && w.gBrowser) {
            out.push(w);
          }
        } catch (e) {}
      }
    } catch (e) {}
    try {
      if (!out.includes(window)) {
        out.push(window);
      }
    } catch (e) {}
    return out;
  }

  // This window's workspace claim: a direct expando on the chrome window is
  // the primary store — synchronous, no SessionStore tracking dependency,
  // and readable from any same-privilege window the moment it is set.
  // SessionStore remains as persistence + restore fallback (extData
  // survives restarts; expandos don't).
  function setWindowWs(target) {
    if (!isValidId(target)) {
      return;
    }
    try {
      window.__aphWsCurrent = target;
    } catch (e) {}
    try {
      SessionStore.setCustomWindowValue(window, WIN_KEY, target);
    } catch (e) {}
  }

  function getWindowWs(win) {
    try {
      const live = win && win.__aphWsCurrent;
      if (isValidId(live)) {
        return live;
      }
    } catch (e) {}
    try {
      const v = SessionStore.getCustomWindowValue(win, WIN_KEY);
      return isValidId(v) ? v : null;
    } catch (e) {
      return null;
    }
  }

  // Candidate destinations for "Move Tab to Other Window": every live
  // window except this one, never across the private boundary.
  // Returns [{ win, ws }] with ws possibly null when the other window's
  // claim is unreadable (callers fall back to its live tab tags then).
  function listWindows() {
    const out = [];
    let selfPrivate = false;
    try {
      selfPrivate = aphIsPrivateWindow(window);
    } catch (e) {}
    let wins = [];
    try {
      wins = listAphWindows();
    } catch (e) {
      return out;
    }
    for (const w of wins) {
      try {
        if (!w || w === window || w.closed || !w.gBrowser) {
          continue;
        }
        try {
          if (!!aphIsPrivateWindow(w) !== !!selfPrivate) {
            continue;
          }
        } catch (e) {}
        let ws = null;
        try {
          ws = getWindowWs(w);
        } catch (e) {}
        out.push({ win: w, ws: isValidId(ws) ? ws : null });
      } catch (e) {}
    }
    return out;
  }

  function readRemoteTabWs(tab) {
    try {
      const v = SessionStore.getCustomTabValue(tab, KEY);
      return isValidId(v) ? v : null;
    } catch (e) {
      return null;
    }
  }

  // Adoption-ghost scrub: closing a tab by adoption records it in the
  // source window's closed-tab list (SessionStore has no adoption
  // exemption), so Ctrl+Shift+T would resurrect a duplicate of the live
  // adopted tab. Immediately after a successful adoption, forget the
  // freshest closed entry — synchronous, so nothing else can interleave.
  // Only for tabs SessionStore would actually record (real, non-internal
  // URLs — blank/newtab closes record nothing, and scrubbing then would
  // eat the user's genuine undo entry). Throws are stop-signals, never
  // retried: an untracked window or empty list means no ghost exists.
  function scrubAdoptionGhost(ownerWin, oldTab) {
    try {
      if (!ownerWin || !oldTab) {
        return;
      }
      try {
        const spec = tabSpec(oldTab);
        if (!spec || isInternalSpec(spec)) {
          return;
        }
      } catch (e) {
        return;
      }
      if (
        !SessionStore ||
        typeof SessionStore.forgetClosedTab !== "function"
      ) {
        return;
      }
      SessionStore.forgetClosedTab(ownerWin, 0);
    } catch (e) {}
  }

  function findTabOwnerWindow(tab) {
    try {
      if (!tab) {
        return null;
      }
      for (const w of listAphWindows()) {
        try {
          if (w && !w.closed && w.gBrowser && w.gBrowser.tabs && w.gBrowser.tabs.includes(tab)) {
            return w;
          }
        } catch (e) {}
      }
    } catch (e) {}
    return null;
  }

  // Adoption swaps in a NEW tab element in the destination
  // (Tabbrowser.sys.mjs: adoptTab(aTab, {tabIndex, selectTab}) fires
  // TabOpen with detail.adoptedTab there and closes the source tab).
  // Returns the new tab, or null. Callers must work with the returned
  // element — never the (now closed) source.
  function adoptOneTab(tab, destBrowser) {
    try {
      if (!tab || tab.closing || tab.pinned) {
        return null;
      }
      const gb = destBrowser || gBrowser;
      if (!gb || typeof gb.adoptTab !== "function") {
        return null;
      }
      let ownerWin = null;
      try {
        ownerWin = findTabOwnerWindow(tab);
      } catch (e) {}
      let index = 0;
      try {
        index = (gb.tabs && gb.tabs.length) || 0;
      } catch (e) {}
      let nt = null;
      try {
        nt = gb.adoptTab(tab, { tabIndex: index }) || null;
      } catch (e) {}
      if (!nt) {
        try {
          nt = gb.adoptTab(tab) || null;
        } catch (_e) {}
      }
      if (nt && ownerWin) {
        scrubAdoptionGhost(ownerWin, tab);
      }
      return nt;
    } catch (e) {
      return null;
    }
  }

  // Lowest workspace no live window (other than this one) claims. Only a
  // new-window placement hint now — windows no longer de-dupe, so any
  // collision is harmless (independent tab sets).
  function lowestUnownedWorkspace() {
    try {
      const owned = new Set();
      if (!aphIsPrivateWindow(window)) {
        for (const w of listAphWindows()) {
          try {
            if (!w || w.closed || aphIsPrivateWindow(w)) {
              continue;
            }
            const ws = w === window ? null : getWindowWs(w);
            if (isValidId(ws)) {
              owned.add(ws);
            }
          } catch (e) {}
        }
      }
      for (let i = 1; i <= 9; i++) {
        const id = String(i);
        if (!owned.has(id)) {
          return id;
        }
      }
    } catch (e) {}
    return null;
  }

  // Browser-Console diagnosis (Ctrl+Shift+J):
  //   Services.wm.getMostRecentWindow("navigator:browser").AphWorkspaces.debugExclusive()
  // Shows this window's claim (restore fallback included).
  function debugExclusive() {
    const out = { winId: null, current: null };
    try {
      out.winId = aphWinId();
    } catch (e) {}
    try {
      out.current = isValidId(current) ? current : null;
    } catch (e) {}
    return out;
  }

  // Session forensics (Browser Console, Ctrl+Shift+J):
  //   Services.wm.getMostRecentWindow("navigator:browser").AphWorkspaces.debugSession()
  // Run BEFORE closing windows and AFTER restore, then diff: this window
  // with its workspace claim and per-tab tag/visibility/pinned/pending
  // state. Answers "was it snapshotted?" vs "did restore drop it?".
  // (Pool-wide enumeration is gone with exclusive ownership; use one
  // capture per window.)
  function debugSession() {
    const out = [];
    try {
      const rec = { ws: null, self: true, tabs: [] };
      try {
        rec.ws = getWindowWs(window);
      } catch (e) {}
      let tabs = [];
      try {
        tabs = Array.from(gBrowser.tabs || []);
      } catch (e) {}
      for (const t of tabs) {
        const r = {};
        try {
          r.label = String(t.label || "").slice(0, 60);
        } catch (e) {
          r.label = "?";
        }
        try {
          r.spec = String(
            (t.linkedBrowser && t.linkedBrowser.currentURI && t.linkedBrowser.currentURI.spec) || "?"
          ).slice(0, 80);
        } catch (e) {
          r.spec = "?";
        }
        try {
          r.ws = readRemoteTabWs(t);
        } catch (e) {
          r.ws = null;
        }
        for (const k of ["hidden", "pinned", "selected", "closing"]) {
          try {
            r[k] = !!t[k];
          } catch (e) {}
        }
        try {
          r.pending = !!(t.hasAttribute && t.hasAttribute("pending"));
        } catch (e) {}
        rec.tabs.push(r);
      }
      out.push(rec);
    } catch (e) {}
    return out;
  }

  function tabSpec(t) {
    try {
      const s = t && t.linkedBrowser && t.linkedBrowser.currentURI && t.linkedBrowser.currentURI.spec;
      return typeof s === "string" ? s : "";
    } catch (e) {
      return "";
    }
  }

  function isInternalSpec(spec) {
    try {
      const s = String(spec || "").toLowerCase();
      return (
        s.startsWith("about:") ||
        s.startsWith("chrome:") ||
        s.startsWith("resource:")
      );
    } catch (e) {
      return true;
    }
  }
