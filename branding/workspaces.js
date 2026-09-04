/* Aph workspaces: IDs "1"-"9", zero UI. Alt+Shift+1..9 jumps to a workspace,
 * Ctrl+Alt+1..9 sends the active tab there (stay here, focus next).
 * Tags persist via SessionStore; pinned tabs are global; native tab groups
 * live inside workspaces (one shared tag, header synced, collapsed kept).
 * Injected into browser.xhtml via rebrand.py (chrome://browser/content/workspaces.js).
 */
(function () {
  const KEY = "aphWs";
  const WIN_KEY = "aphWsCurrent";
  let current = "1";
  const lastSelected = Object.create(null); // workspaceId -> last tab
  // Tabs that arrived via cross-window drag (TabOpen detail.adoptedTab).
  // They join the destination's visible workspace; anchorGroup lets them
  // drag the whole group instead of being healed back to the source tag.
  const adoptedTabs = new WeakSet();

  // Disposable container tabs (Ctrl+Alt+T). Stock path first, this build's
  // packaged path second — wrapped so the shortcut never dies if both fail.
  let IdentityService = null;
  try {
    ({ ContextualIdentityService: IdentityService } = ChromeUtils.importESModule(
      "resource://gre/modules/ContextualIdentityService.sys.mjs"
    ));
  } catch (e) {
    try {
      ({ ContextualIdentityService: IdentityService } = ChromeUtils.importESModule(
        "moz-src:///toolkit/components/contextualidentity/ContextualIdentityService.sys.mjs"
      ));
    } catch (e2) {}
  }
  let tempCounter = 1;
  const tempContainers = new Set(); // userContextIds created here

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
  }

  function groupMembers(group) {
    try {
      return Array.from(group.tabs || []).filter((t) => !t.closing);
    } catch (e) {
      return [];
    }
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

  // First visible candidate wins; first collapsed one is the fallback.
  // Single pass over [remembered, ...tabs] — order-preserving.
  function resolveTargetTab(target, tabs) {
    const candidates = [lastSelected[target], ...tabs];
    let fallback = null;
    for (const t of candidates) {
      if (t && !t.pinned && !t.closing && tabs.includes(t) && getWs(t) === target) {
        if (!t.group?.collapsed || t.selected) {
          return t;
        }
        if (!fallback) {
          fallback = t;
        }
      }
    }
    return fallback;
  }

  // A <tab-group> renders its label regardless of member visibility, so hide
  // the element itself when it holds no target tabs. Collapse is group-level
  // CSS, untouched here, so groups never expand as a side effect.
  function syncGroupHeaders(target) {
    let groups = [];
    try {
      groups = gBrowser.tabGroups || [];
    } catch (e) {
      return;
    }
    for (const group of groups) {
      const members = groupMembers(group);
      if (members.length) {
        try {
          group.hidden = !members.some((t) => !t.pinned && getWs(t) === target);
        } catch (e) {}
      }
    }
  }

  // A group lives in exactly one workspace: majority of real tags wins (never
  // DOM position — a lone mistag must heal, not migrate the group). Ties go
  // to current, else lowest. Idempotent: unanimous groups are a no-op.
  function anchorGroup(group) {
    const members = groupMembers(group).filter((t) => !t.pinned);
    if (members.length < 2) {
      return;
    }
    // Cross-window drop wins over majority: a freshly adopted member drags
    // the whole group to the destination's visible workspace. Without this,
    // SessionStore's preserved tag (Bug 2002643) keeps the source WS and the
    // majority vote heals the adopted tab back instead of migrating the group.
    if (isValidId(current)) {
      for (const m of members) {
        if (adoptedTabs.has(m)) {
          for (const o of members) {
            setWs(o, current);
          }
          return;
        }
      }
    }
    const votes = Object.create(null);
    for (const m of members) {
      const v = rawWs(m);
      if (v) {
        votes[v] = (votes[v] || 0) + 1;
      }
    }
    const ids = Object.keys(votes).sort();
    let anchor = isValidId(current) ? current : "1";
    if (ids.length) {
      anchor = ids[0];
      for (const id of ids) {
        if (votes[id] > votes[anchor] || (votes[id] === votes[anchor] && id === current)) {
          anchor = id;
        }
      }
    }
    for (const m of members) {
      setWs(m, anchor);
    }
  }

  function anchorAllGroups() {
    let groups = [];
    try {
      groups = gBrowser.tabGroups || [];
    } catch (e) {
      return;
    }
    for (const group of groups) {
      anchorGroup(group);
    }
  }

  // Heal a membership change now: anchor, hide strays (never selected), sync.
  function unifyGroup(group) {
    anchorGroup(group);
    if (!isValidId(current)) {
      return;
    }
    let selectedTab = null;
    try {
      selectedTab = gBrowser.selectedTab;
    } catch (e) {}
    for (const m of groupMembers(group).filter((t) => !t.pinned)) {
      if (getWs(m) !== current && m !== selectedTab && !m.hidden) {
        try {
          gBrowser.hideTab(m);
        } catch (e) {}
      }
    }
    syncGroupHeaders(current);
  }

  // One loop shows target tabs and hides the rest. The focus tab is unhidden
  // (and its group unhidden + expanded if needed) BEFORE selecting, because
  // hideTab refuses the selected tab and hidden tabs may not select.
  function reconcile(target, tabs) {
    let focus = resolveTargetTab(target, tabs);
    if (!focus) {
      try {
        focus = gBrowser.addTrustedTab("about:newtab");
        // insertAfterCurrent births tabs inside the selected tab's group —
        // eject before tagging, or the stray drags the group cross-workspace.
        try {
          gBrowser.ungroupTab(focus);
        } catch (e) {}
        setWs(focus, target);
        tabs = Array.from(gBrowser.tabs);
      } catch (e) {
        return;
      }
    }
    try {
      if (focus && focus.group?.collapsed && !focus.selected) {
        focus.group.collapsed = false;
      }
    } catch (e) {}
    syncGroupHeaders(target);
    try {
      gBrowser.showTab(focus);
    } catch (e) {}
    try {
      const sel = gBrowser.selectedTab;
      if (!sel || sel.pinned || sel.closing || getWs(sel) !== target) {
        gBrowser.selectedTab = focus;
      }
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
    try {
      const sel = gBrowser.selectedTab;
      lastSelected[target] =
        sel && !sel.pinned && !sel.closing && getWs(sel) === target ? sel : focus;
    } catch (e) {
      lastSelected[target] = focus;
    }
  }

  // Crimson pulse timer for the workspace indicator (200ms flash).
  let wsPulseTimer = null;
  function pulseWorkspaceIndicator() {
    try {
      const el = gBrowser.tabContainer;
      el.setAttribute("data-aph-ws-pulse", "1");
      if (wsPulseTimer) {
        clearTimeout(wsPulseTimer);
      }
      wsPulseTimer = setTimeout(() => {
        try {
          el.removeAttribute("data-aph-ws-pulse");
        } catch (e) {}
        wsPulseTimer = null;
      }, 200);
    } catch (e) {}
  }

  function switchTo(target) {
    if (!isValidId(target) || target === current) {
      return;
    }
    const tabs = Array.from(gBrowser.tabs);
    rememberCurrent(tabs);
    current = target;
    try {
      gBrowser.tabContainer.setAttribute("data-aph-ws", target);
    } catch (e) {}
    pulseWorkspaceIndicator();
    try {
      SessionStore.setCustomWindowValue(window, WIN_KEY, target);
    } catch (e) {}
    anchorAllGroups();
    reconcile(target, tabs);
  }

  // Send active tab to WS N and stay: eject from group (groups are
  // single-WS), retag, reconcile to focus next + hide sent tab (hideTab
  // refuses the selected tab, so selection must move first — reconcile does).
  function sendTabTo(target) {
    if (!isValidId(target) || target === current) {
      return;
    }
    let tab = null;
    try {
      tab = gBrowser.selectedTab;
    } catch (e) {
      return;
    }
    if (!tab || tab.pinned || tab.closing) {
      return;
    }
    try {
      if (tab.group) {
        gBrowser.ungroupTab(tab);
      }
    } catch (e) {}
    setWs(tab, target);
    anchorAllGroups();
    try {
      reconcile(current, Array.from(gBrowser.tabs));
    } catch (e) {}
  }

  // Open a clean disposable container tab in the current workspace. Falls
  // back to a normal tab if the identity service is unavailable.
  function openTempTab(url = "about:newtab") {
    const ws = isValidId(current) ? current : "1";
    if (!IdentityService) {
      try {
        const t = gBrowser.addTrustedTab(url);
        setWs(t, ws);
        gBrowser.selectedTab = t;
      } catch (e) {}
      return;
    }
    try {
      const identity = IdentityService.create(`Tmp ${tempCounter++}`, "fingerprint", "purple");
      const tab = gBrowser.addTrustedTab(url, { userContextId: identity.userContextId });
      // insertAfterCurrent births tabs inside the selected tab's group — eject.
      try {
        gBrowser.ungroupTab(tab);
      } catch (e) {}
      tempContainers.add(identity.userContextId);
      setWs(tab, ws);
      try {
        gBrowser.showTab(tab);
      } catch (e) {}
      gBrowser.selectedTab = tab;
    } catch (e) {}
  }

  // If a disposable container's last tab closed (any window), remove the
  // identity — remove() also wipes its cookies/storage/cache internally.
  function cleanupTempContainer(tab) {
    let id = null;
    try {
      id = tab.userContextId;
    } catch (e) {
      return;
    }
    if (!id || !IdentityService || !tempContainers.has(id)) {
      return;
    }
    setTimeout(() => {
      try {
        const en = Services.wm.getEnumerator("navigator:browser");
        while (en.hasMoreElements()) {
          const w = en.getNext();
          if (!w || w.closed || !w.gBrowser) {
            continue;
          }
          for (const t of w.gBrowser.tabs) {
            if (!t.closing && t.userContextId === id) {
              return; // still in use
            }
          }
        }
        tempContainers.delete(id);
        IdentityService.remove(id);
        if (tempContainers.size === 0) {
          tempCounter = 1; // Clean slate: next round starts at Tmp 1
        }
      } catch (e) {}
    }, 100);
  }

  // e.code, not e.key: Shift turns "1" into "!".
  function digitFromCode(code) {
    const m = code && code.match(/^(?:Digit|Numpad)([1-9])$/);
    return m ? m[1] : null;
  }

  function onKey(e) {
    if (e.repeat) {
      return;
    }
    if (!e.altKey || e.metaKey) {
      return;
    }
    if (e.ctrlKey && !e.shiftKey && e.code === "KeyT") {
      e.preventDefault();
      e.stopPropagation();
      openTempTab();
      return;
    }
    const d = digitFromCode(e.code);
    if (!d) {
      return;
    }
    if (e.ctrlKey) {
      e.preventDefault();
      e.stopPropagation();
      sendTabTo(d);
    } else if (e.shiftKey) {
      e.preventDefault();
      e.stopPropagation();
      switchTo(d);
    }
  }

  // Stamp fresh tabs (restored keep theirs); inherit a grouped sibling's tag.
  function stampTab(tab) {
    if (!tab || tab.pinned || rawWs(tab)) {
      return false;
    }
    let ws = isValidId(current) ? current : "1";
    try {
      const g = tab.group;
      if (g) {
        for (const s of groupMembers(g)) {
          if (s !== tab) {
            const sw = rawWs(s);
            if (sw) {
              ws = sw;
              break;
            }
          }
        }
      }
    } catch (ex) {}
    setWs(tab, ws);
    return true;
  }

  function onTabOpen(e) {
    const tab = e.target;
    // Cross-window drag (TabOpen detail.adoptedTab, Bug 1244496): join the
    // destination's visible workspace. SessionStore preserves the source tag
    // across adopt, so without this a WS2 group dropped on a WS1 window
    // keeps WS2 and hides / migrates wrong on next switch.
    if (e.detail && e.detail.adoptedTab && tab && !tab.pinned && isValidId(current)) {
      setWs(tab, current);
      try {
        adoptedTabs.add(tab);
      } catch (err) {}
      try {
        if (getWs(tab) === current) {
          gBrowser.showTab(tab);
        }
      } catch (err) {}
      try {
        if (tab.group) {
          setTimeout(() => unifyGroup(tab.group), 0);
        }
      } catch (err) {}
      syncGroupHeaders(current);
      return;
    }
    stampTab(tab);
  }

  // Restored tabs arrive after load, past init and TabOpen.
  function onTabRestored(e) {
    const tab = e.target;
    if (!tab || tab.pinned) {
      return;
    }
    stampTab(tab);
    try {
      if (tab.group) {
        setTimeout(() => unifyGroup(tab.group), 0);
      }
    } catch (err) {}
    if (isValidId(current)) {
      syncGroupHeaders(current);
    }
  }

  function onTabClose(e) {
    const tab = e.target;
    for (const id of Object.keys(lastSelected)) {
      if (lastSelected[id] === tab) {
        delete lastSelected[id];
      }
    }
    cleanupTempContainer(tab);
  }

  // TabGroupCreate fires before members are adopted — defer past the settle.
  function onGroupChange(e) {
    const group = e.target && e.target.closest ? e.target.closest("tab-group") : null;
    if (!group) {
      return;
    }
    try {
      setTimeout(() => unifyGroup(group), 0);
    } catch (err) {
      unifyGroup(group);
    }
  }

  // New windows (Ctrl+N) inherit the source window's workspace instead of
  // falling back to "1". Stored value wins (session restore); else opener,
  // else most-recent / any open browser window; else "1".
  function initialWorkspace() {
    try {
      const w = SessionStore.getCustomWindowValue(window, WIN_KEY);
      if (isValidId(w)) {
        return w;
      }
    } catch (e) {}
    try {
      const op = window.opener;
      if (op && op !== window && !op.closed) {
        const ow = SessionStore.getCustomWindowValue(op, WIN_KEY);
        if (isValidId(ow)) {
          return ow;
        }
      }
    } catch (e) {}
    try {
      if (typeof Services !== "undefined" && Services.wm) {
        const recent = Services.wm.getMostRecentWindow("navigator:browser");
        if (recent && recent !== window && !recent.closed) {
          const rw = SessionStore.getCustomWindowValue(recent, WIN_KEY);
          if (isValidId(rw)) {
            return rw;
          }
        }
        const en = Services.wm.getEnumerator("navigator:browser");
        while (en.hasMoreElements()) {
          const w = en.getNext();
          if (!w || w === window || w.closed) {
            continue;
          }
          try {
            const v = SessionStore.getCustomWindowValue(w, WIN_KEY);
            if (isValidId(v)) {
              return v;
            }
          } catch (_e) {}
        }
      }
    } catch (e) {}
    return "1";
  }

  function init() {
    current = initialWorkspace();
    // Aph Zinc & Crimson theme + workspace indicator. Same <style> id is
    // reused so re-rebrands upgrade the stylesheet in place (idempotent).
    try {
      const css = [
        ":root {",
        "  --aph-bg-deep: #09090b;",
        "  --aph-bg-sidebar: #121215;",
        "  --aph-bg-elevated: #18181c;",
        "  --aph-border: rgba(255, 255, 255, 0.07);",
        "  --aph-text: #f4f4f5;",
        "  --aph-text-muted: #71717a;",
        "  --aph-crimson: #e11d48;",
        "  --aph-crimson-tint: rgba(225, 29, 72, 0.15);",
        "}",
        "#nav-bar {",
        "  background-color: var(--aph-bg-deep) !important;",
        "  border-bottom: 1px solid var(--aph-border) !important;",
        "  box-shadow: none !important;",
        "}",
        "#urlbar-background {",
        "  background-color: var(--aph-bg-elevated) !important;",
        "  border: 1px solid var(--aph-border) !important;",
        "  border-radius: 8px !important;",
        "  box-shadow: none !important;",
        "  transition: border-color 0.15s ease, box-shadow 0.15s ease !important;",
        "}",
        '#urlbar[focused="true"] #urlbar-background,',
        '#urlbar[focused] #urlbar-background,',
        '#urlbar[open="true"] #urlbar-background,',
        '#urlbar[open] #urlbar-background {',
        "  border-color: rgba(225, 29, 72, 0.5) !important;",
        "  box-shadow: 0 0 0 3px var(--aph-crimson-tint) !important;",
        "}",
        "#tabbrowser-tabs {",
        "  background-color: var(--aph-bg-sidebar) !important;",
        "  border-right: 1px solid var(--aph-border) !important;",
        "}",
        "tab.tabbrowser-tab {",
        "  border-radius: 6px !important;",
        "  margin: 1px 8px !important;",
        "}",
        "/* Firefox paints the visible tab fill on the inner .tab-background,",
        "   which fully covers the parent <tab>: hover/selected state is painted",
        '   on .tab-background itself. Both [selected] and [selected="true"] are',
        "   matched: XUL sets the attr either way across versions. */",
        "tab.tabbrowser-tab .tab-background {",
        "  background: transparent !important;",
        "  border: none !important;",
        "  box-shadow: none !important;",
        "  outline: none !important;",
        "}",
        'tab.tabbrowser-tab:hover:not([selected]):not([selected="true"]) .tab-background {',
        "  background-color: rgba(255, 255, 255, 0.04) !important;",
        "  border-radius: 6px !important;",
        "}",
        'tab.tabbrowser-tab[selected] .tab-background,',
        'tab.tabbrowser-tab[selected="true"] .tab-background {',
        "  background-color: rgba(255, 255, 255, 0.08) !important;",
        "  border-radius: 6px !important;",
        "  box-shadow: inset 2px 0 0 var(--aph-crimson) !important;",
        "}",
        'tab.tabbrowser-tab[selected] .tab-label,',
        'tab.tabbrowser-tab[selected="true"] .tab-label {',
        "  color: var(--aph-text) !important;",
        "  font-weight: 500 !important;",
        "}",
        'tab.tabbrowser-tab:not([selected]):not([selected="true"]) .tab-label {',
        "  color: var(--aph-text-muted) !important;",
        "}",
        "#tabbrowser-tabs::before {",
        "  content: attr(data-aph-ws);",
        "  display: block;",
        "  padding: 8px 0 4px 14px;",
        "  font: 700 11px monospace;",
        "  color: var(--aph-text-muted);",
        "  letter-spacing: 0.5px;",
        "  pointer-events: none;",
        "  transition: color 0.2s ease;",
        "}",
        '#tabbrowser-tabs[data-aph-ws-pulse="1"]::before {',
        "  color: var(--aph-crimson) !important;",
        "}",
      ].join("\n");
      let style = document.getElementById("aph-ws-indicator-style");
      if (!style) {
        style = document.createElement("style");
        style.id = "aph-ws-indicator-style";
        document.head.appendChild(style);
      }
      if (style.textContent !== css) {
        style.textContent = css;
      }
      if (isValidId(current)) {
        gBrowser.tabContainer.setAttribute("data-aph-ws", current);
      }
    } catch (e) {}
    try {
      for (const t of gBrowser.tabs) {
        if (!t.pinned && !rawWs(t)) {
          setWs(t, isValidId(current) ? current : "1");
        }
      }
    } catch (e) {}
    // Session restore may not preserve hidden state; force a full pass.
    try {
      const saved = isValidId(current) ? current : "1";
      current = saved === "1" ? "__force__" : "1";
      switchTo(saved);
    } catch (e) {}
    gBrowser.tabContainer.addEventListener("TabOpen", onTabOpen);
    gBrowser.tabContainer.addEventListener("TabClose", onTabClose);
    gBrowser.tabContainer.addEventListener("SSTabRestored", onTabRestored);
    gBrowser.tabContainer.addEventListener("TabGroupCreate", onGroupChange);
    gBrowser.tabContainer.addEventListener("TabGroupUpdate", onGroupChange);
    window.addEventListener("keydown", onKey, true);
  }

  if (document.readyState === "complete") {
    init();
  } else {
    window.addEventListener("load", init, { once: true });
  }
})();
