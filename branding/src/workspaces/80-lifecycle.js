  // Stamp fresh tabs (restored keep theirs); inherit a
  // grouped sibling's tag. Tabs armed for container repair are skipped —
  // the deferred repair either swaps them (still empty) or stamps them
  // (navigated away). Pinned tabs keep a dormant tag for eventual unpin,
  // but visibility ignores it (pins are global).
  function stampTab(tab) {
    if (!tab || rawWs(tab)) {
      return false;
    }
    // Restoring tabs own no tag yet — their extData arrives around
    // SSTabRestored. Stamping now would freeze them to the current
    // workspace (3->2 scramble); onTabRestored stamps once settled.
    try {
      if (typeof isRestoringTab === "function" && isRestoringTab(tab)) {
        return false;
      }
    } catch (ex) {}
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
    if (!tab) {
      return;
    }
    // Session restore owns this tab until SSTabRestored: extData (aphWs,
    // tree links) has not been applied yet, so every write below — birth
    // age, last-viewed, fresh flag, container repair, stamp, tree attach —
    // would race the restore and freeze a tagless WS3 tab to the current
    // workspace. Let onTabRestored settle it.
    try {
      if (typeof isRestoringTab === "function" && isRestoringTab(tab)) {
        return;
      }
    } catch (err) {}
    // Birth stamp for the addon first-run silencer (age gate). Every live
    // tab passes here; restored tabs (SSTabRestored) deliberately get none
    // so a kept-open page is never mistaken for an install tab (adopted
    // tabs arrive with live content, which the first-content gate covers).
    try {
      if (tab) {
        tab.__aphBirth = Date.now();
      }
    } catch (err) {}
    // Birth counts as viewed for auto-archive staleness.
    try {
      if (typeof stampLastViewed === "function") {
        stampLastViewed(tab);
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
    // Bulk restore can still be applying the tag when SSTabRestored fires
    // (tagless at event time, extData lands a tick later). Stamping now
    // would freeze a WS3 tab to the current workspace, so tagless tabs
    // stamp only once settled: now when ready, otherwise one tick later
    // (which also covers a still-restoring tab). Tagged tabs skip both —
    // stampTab is a no-op for them.
    if (!rawWs(tab)) {
      let settled = false;
      try {
        settled =
          typeof isRestoringTab !== "function" || !isRestoringTab(tab);
      } catch (err) {
        settled = true;
      }
      if (settled) {
        stampTab(tab);
      } else {
        try {
          setTimeout(() => {
            try {
              if (!tab.closing) {
                stampTab(tab);
              }
            } catch (err) {}
          }, 0);
        } catch (err) {}
      }
    }
    // Restored tabs keep their tag, so stampTab above is a no-op for them
    // (no setWs, hence no per-tab sync) — sync markers explicitly or
    // restored tabs keep stale chrome until the next binding change.
    // Sync twice: now (attributes are usually ready) and one tick later
    // (bulk restore can still be applying the tag/container when
    // SSTabRestored fires — the tick re-checks once it settles; guards
    // re-verify the tab is still alive).
    try {
      if (typeof syncTabChrome === "function") {
        syncTabChrome(tab);
        setTimeout(() => {
          try {
            if (!tab.closing) {
              syncTabChrome(tab);
            }
          } catch (err) {}
        }, 0);
      }
    } catch (err) {}
    // Restored tabs keep their persisted tree links; heal dangling edges
    // (missing/cross-WS parents) and ensure every tab owns a tree id.
    // Both wait when the tab is still restoring: ensureTreeId would mint
    // a fresh id over the persisted one, and heal would read the
    // not-yet-applied workspace tag (defaulting to "1") as a cross-WS
    // edge and clear a valid link. The tick above stamps first; heal and
    // ensure re-run there once settled.
    let restoreSettled = true;
    try {
      restoreSettled =
        typeof isRestoringTab !== "function" || !isRestoringTab(tab);
    } catch (err) {}
    try {
      if (typeof ensureTreeId === "function" && restoreSettled) {
        ensureTreeId(tab);
      }
    } catch (err) {}
    try {
      if (typeof healTreeLinks === "function" && restoreSettled) {
        healTreeLinks();
      }
    } catch (err) {}
    if (!restoreSettled) {
      try {
        setTimeout(() => {
          try {
            if (tab.closing) {
              return;
            }
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
          // Visibility was skipped below (no tag yet) — settle it now
          // that extData has landed, mirroring the synchronous rule.
          try {
            if (!tab.pinned && isValidId(current) && rawWs(tab) && getWs(tab) !== current && !tab.hidden) {
              if (gBrowser.selectedTab !== tab) {
                aphHideTab(tab);
              }
            }
          } catch (err) {}
        }, 0);
      } catch (err) {}
    }
    try {
      if (typeof renderTree === "function") {
        renderTree();
      }
    } catch (err) {}
    // A tagless still-restoring tab has no workspace yet (getWs defaults
    // to "1") — hiding/showing now would act on the wrong workspace.
    // The tick above settles visibility once extData lands.
    try {
      if (!restoreSettled && !rawWs(tab)) {
        // Skip visibility until the tick.
      } else if (tab.pinned) {
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
    // Closing can empty or singleton-ize a native group: re-sync headers
    // (deferred unify would touch a half-removed group; headers are safe
    // synchronously and removal events get their own listener).
    try {
      if (isValidId(current) && typeof syncGroupHeaders === "function") {
        syncGroupHeaders(current);
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
    // Pin/unpin flips the viewed workspace a global tab is matched
    // against (pins match the current workspace, not their dormant tag),
    // so re-sync markers here, not just on retag.
    try {
      if (typeof syncTabChrome === "function") {
        syncTabChrome(tab);
      }
    } catch (err) {}
    try {
      if (!rawWs(tab) && isValidId(current)) {
        try {
          if (typeof isRestoringTab === "function" && isRestoringTab(tab)) {
            // Restoring tag arrives via extData — never stamp it here.
          } else {
            setWs(tab, current);
          }
        } catch (_e) {}
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

