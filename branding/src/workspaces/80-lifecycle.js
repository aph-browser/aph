  // Stamp fresh tabs (restored keep theirs); inherit a
  // grouped sibling's tag. Tabs armed for container repair are skipped —
  // the deferred repair either swaps them (still empty) or stamps them
  // (navigated away). Pinned tabs keep a dormant tag for eventual unpin,
  // but visibility ignores it (pins are global).
  function stampTab(tab) {
    if (!tab || rawWs(tab)) {
      return false;
    }
    try {
      if (tab.__aphRepairArmed) {
        return false;
      }
    } catch (ex) {}
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
    // Birth stamp for the addon first-run silencer (age gate). Every live
    // tab passes here; restored tabs (SSTabRestored) deliberately get none
    // so a kept-open page is never mistaken for an install tab (adopted
    // tabs arrive with live content, which the first-content gate covers).
    try {
      if (tab) {
        tab.__aphBirth = Date.now();
      }
    } catch (err) {}
    // Cross-window drag (TabOpen detail.adoptedTab, Bug 1244496): join the
    // destination's visible workspace. SessionStore preserves the source tag
    // across adopt, so without this a WS2 group dropped on a WS1 window
    // keeps WS2 and hides / migrates wrong on next switch.
    if (e.detail && e.detail.adoptedTab && tab && isValidId(current)) {
      setWs(tab, current);
      try {
        adoptedTabs.add(tab);
      } catch (err) {}
      // Adopted tabs land as Level 0 roots (workspace-scoped trees never
      // span windows); former children left behind heal to roots/parents.
      try {
        if (typeof clearTreeParent === "function") {
          clearTreeParent(tab);
        }
      } catch (err) {}
      try {
        if (typeof ensureTreeId === "function") {
          ensureTreeId(tab);
        }
      } catch (err) {}
      // Adopted tabs arrive with a live page — settled, never auto-route.
      try {
        tab.__aphFresh = false;
      } catch (err) {}
      try {
        if (getWs(tab) === current) {
          aphShowTab(tab);
        }
      } catch (err) {}
      try {
        if (tab.group) {
          setTimeout(() => unifyGroup(tab.group), 0);
        }
      } catch (err) {}
      syncGroupHeaders(current);
      try {
        renderDock();
      } catch (err) {}
      try {
        if (typeof renderTree === "function") {
          renderTree();
        }
      } catch (err) {}
      return;
    }
    // Fresh until its first real commit — the progress router may claim it.
    try {
      tab.__aphFresh = true;
    } catch (err) {}
    // Non-BrowserOpenTab births in a bound workspace: arm the container
    // repair (deferred swap); everything else stamps immediately.
    if (armContainerRepair(tab)) {
      return;
    }
    stampTab(tab);
    // Automatic tree: opener-linked tabs become children (placed after the
    // parent's last descendant); manual tabs (no opener) stay Level 0.
    try {
      if (typeof treeAttachFromOpener === "function") {
        treeAttachFromOpener(tab, e);
      }
    } catch (err) {}
    try {
      if (typeof renderTree === "function") {
        renderTree();
      }
    } catch (err) {}
    try {
      renderDock();
    } catch (err) {}
  }

  // Restored tabs arrive after load, past init and TabOpen.
  // Pinned tabs are global: always shown (never hidden for another WS).
  function onTabRestored(e) {
    const tab = e.target;
    if (!tab) {
      return;
    }
    // Restored tabs resume a live page — settled, never auto-route.
    try {
      tab.__aphFresh = false;
    } catch (err) {}
    stampTab(tab);
    // Restored tabs keep their persisted tree links; heal dangling edges
    // (missing/cross-WS parents) and ensure every tab owns a tree id.
    try {
      if (typeof ensureTreeId === "function") {
        ensureTreeId(tab);
      }
    } catch (err) {}
    try {
      if (typeof healTreeLinks === "function") {
        healTreeLinks();
      }
    } catch (err) {}
    try {
      if (typeof renderTree === "function") {
        renderTree();
      }
    } catch (err) {}
    try {
      if (tab.pinned) {
        if (tab.hidden) {
          aphShowTab(tab);
        }
      } else if (isValidId(current) && getWs(tab) !== current && !tab.hidden) {
        try {
          if (gBrowser.selectedTab !== tab) {
            aphHideTab(tab);
          }
        } catch (err) {}
      }
    } catch (err) {}
    try {
      if (tab.group) {
        setTimeout(() => unifyGroup(tab.group), 0);
      }
    } catch (err) {}
    if (isValidId(current)) {
      syncGroupHeaders(current);
    }
    try {
      renderDock();
    } catch (err) {}
  }

  function onTabClose(e) {
    const tab = e.target;
    // Promote, don't delete: children slide up one level in place.
    try {
      if (typeof promoteTreeChildrenOnClose === "function") {
        promoteTreeChildrenOnClose(tab);
      }
    } catch (err) {}
    for (const id of Object.keys(lastSelected)) {
      if (lastSelected[id] === tab) {
        delete lastSelected[id];
      }
    }
    cleanupTempContainer(tab);
    try {
      if (typeof renderTree === "function") {
        renderTree();
      }
    } catch (err) {}
    try {
      if (typeof applyTreeVisibility === "function") {
        applyTreeVisibility();
      }
    } catch (err) {}
    try {
      renderDock();
    } catch (err) {}
  }

  // Pin/unpin keeps the tab's workspace tag as dormant state (used when
  // eventually unpinned). Pins are global: pinning unhides, unpinning
  // re-applies workspace visibility. Stock pinTab() unconditionally unhides.
  // Pins are always Level 0 roots: pinning detaches the tab and promotes
  // its children (same rule as closing, without deleting anyone).
  function onTabPinned(e) {
    const tab = e.target;
    if (!tab) {
      return;
    }
    try {
      if (!rawWs(tab) && isValidId(current)) {
        setWs(tab, current);
      }
    } catch (err) {}
    try {
      if (tab.pinned) {
        if (typeof promoteTreeChildrenOnClose === "function") {
          promoteTreeChildrenOnClose(tab);
        }
      }
    } catch (err) {}
    try {
      if (tab.pinned && typeof clearTreeParent === "function") {
        clearTreeParent(tab);
      }
    } catch (err) {}
    try {
      if (typeof ensureTreeId === "function") {
        ensureTreeId(tab);
      }
    } catch (err) {}
    try {
      if (!isValidId(current)) {
        try {
          if (typeof renderTree === "function") {
            renderTree();
          }
        } catch (_e) {}
        return;
      }
      if (tab.pinned) {
        if (tab.hidden) {
          aphShowTab(tab);
        }
        try {
          if (typeof renderTree === "function") {
            renderTree();
          }
        } catch (_e) {}
        try {
          renderDock();
        } catch (_e) {}
        return;
      }
      if (getWs(tab) !== current) {
        if (gBrowser.selectedTab !== tab && !tab.hidden) {
          aphHideTab(tab);
        }
      } else if (tab.hidden) {
        aphShowTab(tab);
      }
    } catch (err) {}
    try {
      if (typeof renderTree === "function") {
        renderTree();
      }
    } catch (err) {}
    try {
      if (typeof applyTreeVisibility === "function") {
        applyTreeVisibility();
      }
    } catch (err) {}
    try {
      renderDock();
    } catch (err) {}
  }

