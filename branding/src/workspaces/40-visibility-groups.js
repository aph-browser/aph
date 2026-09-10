  // Per-workspace pinned tabs: stock gBrowser.hideTab() refuses pinned tabs
  // (`aTab.pinned` early-return), so pinned could only ever be global. These
  // helpers mirror stock show/hide semantics but work for pinned tabs too
  // (direct `hidden` attribute + cache invalidation + TabShow/TabHide).
  // All workspace visibility changes go through these — never stock hideTab.
  // NOTE: pins are GLOBAL — aphHideTab refuses pinned tabs (mirroring stock).
  // Hiding pinned tabs breaks vertical-tab drag/drop (drop-index math assumes
  // pins are contiguous + visible at index 0). Pinned tabs keep their aphWs
  // tag as dormant state for eventual unpin, but visibility ignores it.
  function aphShowTab(tab) {
    try {
      gBrowser.showTab(tab);
    } catch (e) {
      try {
        if (tab && tab.hidden) {
          tab.removeAttribute("hidden");
        }
      } catch (_e) {}
    }
  }

  function aphHideTab(tab, source) {
    try {
      if (!tab || tab.hidden || tab.closing) {
        return;
      }
      try {
        if (tab.pinned) {
          return;
        }
      } catch (e) {}
      try {
        if (tab.selected) {
          return;
        }
      } catch (e) {}
      try {
        if (gBrowser.selectedTab === tab) {
          return;
        }
      } catch (e) {}
      try {
        if (tab.linkedBrowser?._sharingState?.webRTC?.sharing) {
          return;
        }
      } catch (e) {}
      tab.setAttribute("hidden", "true");
      try {
        gBrowser.tabContainer._invalidateCachedVisibleTabs();
      } catch (e) {}
      try {
        gBrowser.tabContainer._updateCloseButtons();
      } catch (e) {}
      try {
        if (tab.multiselected) {
          gBrowser._updateMultiselectedTabCloseButtonTooltip();
        }
      } catch (e) {}
      try {
        gBrowser.replaceInSuccession(tab, tab.successor);
      } catch (e) {}
      try {
        gBrowser.setSuccessor(tab, null);
      } catch (e) {}
      try {
        const event = document.createEvent("Events");
        event.initEvent("TabHide", true, false);
        tab.dispatchEvent(event);
      } catch (e) {}
      if (source) {
        try {
          SessionStore.setCustomTabValue(tab, "hiddenBy", source);
        } catch (e) {}
      }
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
      if (sel && !sel.closing && tabs.includes(sel) && getWs(sel) === current) {
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
      if (t && !t.closing && tabs.includes(t) && getWs(t) === target) {
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
  // (Pinned tabs are excluded below only because Firefox forbids grouping
  // pinned tabs — not a workspace rule; pinned tabs are per-workspace too.)
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
          // Consume the flag so future anchorGroup calls don't re-drag the
          // group into whatever workspace happens to be active at the time.
          for (const o of members) {
            adoptedTabs.delete(o);
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
        aphHideTab(m);
      }
    }
    syncGroupHeaders(current);
  }

  // One loop shows target tabs and hides the rest. The focus tab is unhidden
  // (and its group unhidden + expanded if needed) BEFORE selecting, because
  // hiding refuses the selected tab and hidden tabs may not select.
  // Pinned tabs are global: always shown regardless of tag.
  function reconcile(target, tabs) {
    let focus = resolveTargetTab(target, tabs);
    if (!focus) {
      // Empty workspace: route through openBoundTab so a bound container
      // applies (raw addTrustedTab would spawn an unbound tab here).
      focus = openBoundTab("about:newtab", target);
      if (!focus) {
        return;
      }
      tabs = Array.from(gBrowser.tabs);
    }
    try {
      if (focus && focus.group?.collapsed && !focus.selected) {
        focus.group.collapsed = false;
      }
    } catch (e) {}
    syncGroupHeaders(target);
    aphShowTab(focus);
    try {
      const sel = gBrowser.selectedTab;
      if (!sel || sel.closing || getWs(sel) !== target) {
        gBrowser.selectedTab = focus;
      }
      if (gBrowser.selectedTab !== focus) {
        aphShowTab(focus);
        gBrowser.selectedTab = focus;
      }
    } catch (e) {}
    for (const t of tabs) {
      if (t.closing) {
        continue;
      }
      try {
        if (t.pinned || getWs(t) === target) {
          aphShowTab(t);
        } else {
          aphHideTab(t);
        }
      } catch (e) {}
    }
    try {
      const sel = gBrowser.selectedTab;
      lastSelected[target] =
        sel && !sel.closing && getWs(sel) === target ? sel : focus;
    } catch (e) {
      lastSelected[target] = focus;
    }
  }

  // Close unused new tabs in `target`, never the active tab.
  // Keeps at most 1 new tab total (preferring the selected one).
  function isNewTab(tab) {
    try {
      const uri = tab.linkedBrowser?.currentURI?.spec;
      if (uri === "about:newtab" || uri === "about:blank" || uri === "about:home") {
        return true;
      }
    } catch (e) {}
    return false;
  }

  function pruneExtraNewTabs(target) {
    if (!isValidId(target)) {
      return;
    }
    let sel = null;
    try {
      sel = gBrowser.selectedTab;
    } catch (e) {}
    const selIsNew = !!(sel && sel !== undefined && isNewTab(sel) && getWs(sel) === target);
    let keep = selIsNew ? 0 : 1; // inactive spares allowed beyond selected
    let tabs = [];
    try {
      tabs = Array.from(gBrowser.tabs);
    } catch (e) {
      return;
    }
    for (const t of tabs) {
      // Pinned tabs are never auto-closed, even empty ones.
      if (t.pinned || t.closing || t === sel) {
        continue;
      }
      if (getWs(t) !== target) {
        continue;
      }
      if (!isNewTab(t)) {
        continue;
      }
      if (keep > 0) {
        keep--;
        continue;
      }
      try {
        gBrowser.removeTab(t, { animate: false });
      } catch (e) {
        try {
          gBrowser.removeTab(t);
        } catch (_e) {}
      }
    }
  }

