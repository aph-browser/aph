/* Aph workspaces: IDs "1"-"9", zero UI. Alt+Shift+1..9 jumps to a workspace.
 * Tags persist via SessionStore; pinned tabs are global; native tab groups
 * live inside workspaces (one shared tag, header synced, collapsed kept).
 * Injected into browser.xhtml via rebrand.py (chrome://browser/content/workspaces.js).
 */
(function () {
  const KEY = "aphWs";
  const WIN_KEY = "aphWsCurrent";
  let current = "1";
  const lastSelected = Object.create(null); // workspaceId -> last tab

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
    anchorAllGroups();
    reconcile(target, tabs);
  }

  // e.code, not e.key: Shift turns "1" into "!".
  function digitFromCode(code) {
    const m = code && code.match(/^(?:Digit|Numpad)([1-9])$/);
    return m ? m[1] : null;
  }

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
    stampTab(e.target);
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

  function init() {
    try {
      const w = SessionStore.getCustomWindowValue(window, WIN_KEY);
      if (isValidId(w)) {
        current = w;
      }
    } catch (e) {}
    try {
      for (const t of gBrowser.tabs) {
        if (!t.pinned && !rawWs(t)) {
          setWs(t, "1");
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
