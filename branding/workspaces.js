/* Aph workspaces: dynamic IDs ("1"-"9"), zero UI, shortcut-driven.
 * Only shortcut: Alt+Shift+1..9 -> switch directly to that workspace.
 * Pinned tabs are global (never hidden). Workspace tags persist via
 * SessionStore custom tab values across restarts/session restore.
 * Active-tab memory ({ workspaceId: tab }) restores the exact tab left off on.
 * Injected into browser.xhtml via rebrand.py (chrome://browser/content/workspaces.js).
 */
(function () {
  const KEY = "aphWs";
  const WIN_KEY = "aphWsCurrent";
  let current = "1";
  // Active-tab memory: workspaceId -> last selected tab in that workspace.
  const lastSelected = Object.create(null);

  function isValidId(v) {
    return v === "1" || v === "2" || v === "3" || v === "4" || v === "5" ||
      v === "6" || v === "7" || v === "8" || v === "9";
  }

  function getWs(tab) {
    try {
      const v = SessionStore.getCustomTabValue(tab, KEY);
      return isValidId(v) ? v : "1";
    } catch (e) {
      return "1";
    }
  }

  function setWs(tab, ws) {
    try {
      SessionStore.setCustomTabValue(tab, KEY, ws);
    } catch (e) {}
  }

  function rememberCurrent(tabs) {
    if (!isValidId(current)) {
      return;
    }
    try {
      const sel = gBrowser.selectedTab;
      if (sel && !sel.pinned && !sel.closing && tabs.includes(sel)) {
        lastSelected[current] = sel;
      }
    } catch (e) {}
  }

  // Pick the tab to focus when entering `target`: remembered tab if it is
  // still alive and belongs to target, else the first target tab.
  function resolveTargetTab(target, tabs) {
    const mem = lastSelected[target];
    if (mem && !mem.closing && tabs.includes(mem) && getWs(mem) === target && !mem.pinned) {
      return mem;
    }
    for (const t of tabs) {
      if (!t.pinned && !t.closing && getWs(t) === target) {
        return t;
      }
    }
    return null;
  }

  // Single-pass state reconciliation: one loop shows target tabs and hides
  // everything else. Selection happens BEFORE the loop because hideTab()
  // refuses to hide the selected tab — but the focus tab MUST be unhidden
  // BEFORE selecting it. Selecting a still-hidden tab either blanks the
  // window or is ignored (stranding the old tab selected, so hideTab()
  // then refuses to hide it and the switch visibly "never happens").
  function reconcile(target, tabs) {
    let focus = resolveTargetTab(target, tabs);
    if (!focus) {
      // Empty-state safeguard: never leave a workspace with zero tabs.
      try {
        focus = gBrowser.addTrustedTab("about:newtab");
        setWs(focus, target);
        tabs = Array.from(gBrowser.tabs);
      } catch (e) {
        return;
      }
    }
    try {
      gBrowser.showTab(focus);
    } catch (e) {}
    try {
      const sel = gBrowser.selectedTab;
      if (!sel || sel.pinned || sel.closing || getWs(sel) !== target) {
        gBrowser.selectedTab = focus;
      }
      // Verify the selection landed; retry once if Gecko ignored it.
      if (gBrowser.selectedTab !== focus) {
        gBrowser.showTab(focus);
        gBrowser.selectedTab = focus;
      }
    } catch (e) {}
    for (const t of tabs) {
      if (t.pinned || t.closing) {
        continue;
      }
      try {
        if (getWs(t) === target) {
          gBrowser.showTab(t);
        } else {
          gBrowser.hideTab(t);
        }
      } catch (e) {}
    }
    // Record the tab we actually landed on, never a tab we failed to select.
    try {
      const sel = gBrowser.selectedTab;
      lastSelected[target] =
        sel && !sel.pinned && !sel.closing && getWs(sel) === target ? sel : focus;
    } catch (e) {
      lastSelected[target] = focus;
    }
  }

  function switchTo(target) {
    if (!isValidId(target) || target === current) {
      return;
    }
    const tabs = Array.from(gBrowser.tabs);
    rememberCurrent(tabs);
    current = target;
    try {
      SessionStore.setCustomWindowValue(window, WIN_KEY, target);
    } catch (e) {}
    reconcile(target, tabs);
  }

  // NOTE: e.code (not e.key) for digits — Shift alters e.key
  // ("1" becomes "!"), while e.code stays physical.
  function digitFromCode(code) {
    if (code && code.startsWith("Digit")) {
      const d = code.slice(5);
      if (d >= "1" && d <= "9") {
        return d;
      }
    }
    if (code && code.startsWith("Numpad")) {
      const d = code.slice(6);
      if (d >= "1" && d <= "9") {
        return d;
      }
    }
    return null;
  }

  // Sole shortcut: Alt+Shift+1..9 jumps directly to that workspace.
  function onKey(e) {
    if (!e.altKey || !e.shiftKey || e.ctrlKey || e.metaKey) {
      return;
    }
    const d = digitFromCode(e.code);
    if (d) {
      e.preventDefault();
      e.stopPropagation();
      switchTo(d);
    }
  }

  function onTabOpen(e) {
    const tab = e.target;
    if (!tab || tab.pinned) {
      return;
    }
    let existing = null;
    try {
      existing = SessionStore.getCustomTabValue(tab, KEY);
    } catch (ex) {
      existing = null;
    }
    // Only stamp fresh tabs; restored tabs keep their persisted tag.
    if (!isValidId(existing)) {
      setWs(tab, isValidId(current) ? current : "1");
    }
  }

  function onTabClose(e) {
    // Drop stale memory references to the closed tab.
    const tab = e.target;
    for (const id of Object.keys(lastSelected)) {
      if (lastSelected[id] === tab) {
        delete lastSelected[id];
      }
    }
  }

  function init() {
    // Restore current workspace for this window (survives restart).
    try {
      const w = SessionStore.getCustomWindowValue(window, WIN_KEY);
      if (isValidId(w)) {
        current = w;
      }
    } catch (e) {}

    // Stamp any untagged tabs with the default workspace.
    try {
      for (const t of gBrowser.tabs) {
        if (t.pinned) {
          continue;
        }
        let v = null;
        try {
          v = SessionStore.getCustomTabValue(t, KEY);
        } catch (ex) {
          v = null;
        }
        if (!isValidId(v)) {
          setWs(t, "1");
        }
      }
    } catch (e) {}

    // Enforce visibility for the restored workspace (session restore
    // does not always preserve hidden state). Force reconcile even when
    // current is already "1" by going through the switch path.
    try {
      const saved = isValidId(current) ? current : "1";
      current = saved === "1" ? "__force__" : "1"; // sentinel: never equals target
      switchTo(saved);
    } catch (e) {}

    gBrowser.tabContainer.addEventListener("TabOpen", onTabOpen);
    gBrowser.tabContainer.addEventListener("TabClose", onTabClose);
    window.addEventListener("keydown", onKey, true);
  }

  if (document.readyState === "complete") {
    init();
  } else {
    window.addEventListener("load", init, { once: true });
  }
})();
