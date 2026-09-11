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
    // Cross-window drag (TabOpen detail.adoptedTab, Bug 1244496): join the
    // destination's visible workspace. SessionStore preserves the source tag
    // across adopt, so without this a WS2 group dropped on a WS1 window
    // keeps WS2 and hides / migrates wrong on next switch.
    if (e.detail && e.detail.adoptedTab && tab && isValidId(current)) {
      setWs(tab, current);
      try {
        adoptedTabs.add(tab);
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

  // Pin/unpin keeps the tab's workspace tag as dormant state (used when
  // eventually unpinned). Pins are global: pinning unhides, unpinning
  // re-applies workspace visibility. Stock pinTab() unconditionally unhides.
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
      if (!isValidId(current)) {
        return;
      }
      if (tab.pinned) {
        if (tab.hidden) {
          aphShowTab(tab);
        }
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
  }

