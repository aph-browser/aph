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

  function aphHideTab(tab) {
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
    } catch (e) {}
  }

  function groupMembers(group) {
    try {
      return Array.from(group.tabs || []).filter((t) => !t.closing);
    } catch (e) {
      return [];
    }
  }

  // Group the live multiselection via stock addTabGroup (Ctrl+Alt+G):
  // selectedTabs/multiselectedTabs when present, else the selected tab.
  // Pinned tabs are excluded (Firefox forbids grouping pins); needs 2+
  // groupable tabs, otherwise pulses instead of acting. Already-one-group
  // is a no-op pulse. Tag healing rides the existing TabGroupCreate ->
  // unifyGroup path; headers sync here for immediate paint. Fail-silent.
  function groupSelectedTabs() {
    let set = [];
    try {
      if (typeof resolveSendBase === "function") {
        set = resolveSendBase(null) || [];
      }
    } catch (e) {
      set = [];
    }
    if (!set.length) {
      try {
        const sel = gBrowser.selectedTab;
        if (sel && !sel.closing) {
          set = [sel];
        }
      } catch (e) {}
    }
    const seen = new Set();
    const tabs = [];
    try {
      for (const t of set) {
        try {
          if (t && !t.closing && !t.pinned && !seen.has(t)) {
            seen.add(t);
            tabs.push(t);
          }
        } catch (e) {}
      }
    } catch (e) {}
    if (tabs.length < 2) {
      try {
        pulseWorkspaceIndicator();
      } catch (e) {}
      return false;
    }
    try {
      const first = tabs[0] && tabs[0].group;
      if (first) {
        let same = true;
        try {
          for (const t of tabs) {
            if (t.group !== first) {
              same = false;
              break;
            }
          }
        } catch (e) {
          same = false;
        }
        if (same) {
          try {
            pulseWorkspaceIndicator();
          } catch (e) {}
          return false;
        }
      }
    } catch (e) {}
    let grouped = false;
    try {
      if (gBrowser && typeof gBrowser.addTabGroup === "function") {
        const g = gBrowser.addTabGroup(tabs, { insertBefore: tabs[0] });
        grouped = !!g;
      }
    } catch (e) {
      grouped = false;
    }
    if (!grouped) {
      try {
        pulseWorkspaceIndicator();
      } catch (e) {}
      return false;
    }
    try {
      if (typeof syncGroupHeaders === "function" && isValidId(current)) {
        syncGroupHeaders(current);
      }
    } catch (e) {}
    return true;
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
  // Space folders (77) repaint on the same pass: every entry that converges
  // group headers converges folder headers too, so no new listener exists.
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
    try {
      if (typeof syncSpaces === "function" && isValidId(target)) {
        syncSpaces(target);
      }
    } catch (e) {}
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
    // Incomplete restore data must never vote: a tagless or still-
    // restoring member has no workspace yet, and majority-voting it now
    // would permanently retag a WS3 tab to WS2. Abort and let the
    // SSTabRestored unify re-run once extData lands.
    for (const m of members) {
      try {
        if (typeof isRestoringTab === "function" && isRestoringTab(m)) {
          return;
        }
      } catch (e) {}
      try {
        if (!rawWs(m)) {
          return;
        }
      } catch (e) {}
    }
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
    // Incomplete restore data must never hide: tagless/restoring members
    // have no workspace yet (getWs defaults "1") and an early hide sticks
    // (nothing re-shows until tagged). Bail like anchorGroup does; the
    // settle path re-runs unify once extData lands.
    try {
      for (const m of groupMembers(group).filter((t) => !t.pinned)) {
        let tag = null;
        try {
          tag = rawWs(m);
        } catch (e) {
          tag = null;
        }
        if (!tag) {
          return;
        }
        try {
          if (typeof isRestoringTab === "function" && isRestoringTab(m)) {
            return;
          }
        } catch (e) {}
      }
    } catch (e) {}
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
      // Assignment can silently not take (a hidden tab refuses selection),
      // so retry once shown — but ONLY when the live selection is still
      // outside the target. Never yank a valid selection to `focus`: a tab
      // opened + selected after the last switch (first-run welcome, routed
      // foreground tab) must keep focus.
      try {
        const now = gBrowser.selectedTab;
        if (now !== focus && (!now || now.closing || getWs(now) !== target)) {
          aphShowTab(focus);
          gBrowser.selectedTab = focus;
        }
      } catch (e) {}
    } catch (e) {}
    for (const t of tabs) {
      if (t.closing) {
        continue;
      }
      // Restoring/tagless tabs have no workspace yet (getWs defaults "1"):
      // hiding now sticks (nothing re-shows until tagged), so leave them
      // visible — the settle path (stamp/SSTabRestored) converges them.
      // Tags are never deleted, so tagless always means not-yet-tagged.
      let tagged = false;
      try {
        tagged = !!rawWs(t);
      } catch (e) {
        tagged = false;
      }
      if (!tagged) {
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
    // Spaces repaint late (second converging pass): during session restore
    // the early pass can hit a half-populated strip and the fail-closed
    // candidate resolution clears valid folder paint; by this point the
    // selection has settled, so the strip is the ground truth. Also covers
    // startup (reconcile runs there without any group event to lean on).
    try {
      if (typeof syncSpaces === "function" && isValidId(target)) {
        syncSpaces(target);
      }
    } catch (e) {}
  }

  // Close unused new tabs in `target`, never the active tab.
  // Keeps at most 1 new tab total (preferring the selected one).
  // Shared with the unload guards (never unload a newtab).
  function isNewTab(tab) {
    try {
      const uri = tab.linkedBrowser?.currentURI?.spec;
      if (uri === "about:newtab" || uri === "about:blank" || uri === "about:home") {
        return true;
      }
    } catch (e) {}
    return false;
  }

