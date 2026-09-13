  // Automatic 2-level tab tree (MVP): tabs opened from an existing tab
  // become indented children underneath that tab; parents get a chevron
  // to collapse descendants. Zero config — hierarchy forms from link
  // clicks (openerTab). Manual tabs (Ctrl+T, + button, palette opens)
  // have no opener and stay Level 0 roots.
  // Model: per-tab SessionStore IDs (aphTreeId, aphTreeParent) so links
  // survive restart; collapsed state is memory-only (resets to expanded
  // on restart, never strand a restore behind a hidden parent).
  // Workspace-scoped: parent and child always share aphWs; cross-workspace
  // edges heal to Level 0. Pinned tabs are always Level 0 (never a child,
  // never hidden by collapse). Vertical strip only — horizontal untouched.
  const TREE_ID_KEY = "aphTreeId";
  const TREE_PARENT_KEY = "aphTreeParent";
  const TREE_MAX_LEVEL = 2;
  const collapsedTreeParents = new Set();
  // Re-entrancy depth for TabMove handling. Stock movers dispatch TabMove
  // for programmatic moves too, so carrying a block re-enters this handler
  // via nested events; nested runs are idempotent (already-placed tabs are
  // no-ops) and converge in ~2 levels — the cap is belt-and-braces against
  // pathological event loops. Deliberately NOT an ignore-set: a flag that
  // is never consumed (mover fires no event) would swallow the next genuine
  // user drag of the same tab.
  let treeMoveDepth = 0;
  let aphTreeSeq = 0;

  function rawTreeId(tab) {
    try {
      const v = SessionStore.getCustomTabValue(tab, TREE_ID_KEY);
      return typeof v === "string" && v ? v : null;
    } catch (e) {
      return null;
    }
  }

  function rawTreeParentId(tab) {
    try {
      const v = SessionStore.getCustomTabValue(tab, TREE_PARENT_KEY);
      return typeof v === "string" && v ? v : null;
    } catch (e) {
      return null;
    }
  }

  function ensureTreeId(tab) {
    try {
      if (!tab) {
        return null;
      }
      const existing = rawTreeId(tab);
      if (existing) {
        return existing;
      }
      let id = null;
      try {
        aphTreeSeq += 1;
        let rnd = "";
        try {
          rnd = Math.random().toString(36).slice(2, 8);
        } catch (e) {}
        id = `t${Date.now().toString(36)}-${aphTreeSeq.toString(36)}${rnd}`;
      } catch (e) {
        aphTreeSeq += 1;
        id = `t${aphTreeSeq}`;
      }
      try {
        SessionStore.setCustomTabValue(tab, TREE_ID_KEY, id);
      } catch (e) {}
      return id;
    } catch (e) {
      return null;
    }
  }

  function clearTreeParent(tab) {
    try {
      if (!tab) {
        return;
      }
      try {
        if (SessionStore && typeof SessionStore.deleteCustomTabValue === "function") {
          SessionStore.deleteCustomTabValue(tab, TREE_PARENT_KEY);
        } else {
          SessionStore.setCustomTabValue(tab, TREE_PARENT_KEY, "");
        }
      } catch (e) {
        try {
          SessionStore.setCustomTabValue(tab, TREE_PARENT_KEY, "");
        } catch (_e) {}
      }
    } catch (e) {}
  }

  function setTreeParent(tab, parentId) {
    try {
      if (!tab || !parentId) {
        return;
      }
      SessionStore.setCustomTabValue(tab, TREE_PARENT_KEY, parentId);
    } catch (e) {}
  }

  function findTabByTreeId(id) {
    try {
      if (!id) {
        return null;
      }
      const tabs = Array.from(gBrowser.tabs || []);
      for (const t of tabs) {
        try {
          if (!t || t.closing) {
            continue;
          }
          if (rawTreeId(t) === id) {
            return t;
          }
        } catch (e) {}
      }
    } catch (e) {}
    return null;
  }

  // Resolve the stored parent to a live tab. Invalid edges (missing tab,
  // self-parent, pinned child, cross-workspace) read as "no parent" so
  // the tab renders Level 0; healTreeLinks clears them lazily.
  function getTreeParentTab(tab) {
    try {
      if (!tab) {
        return null;
      }
      try {
        if (tab.pinned) {
          return null;
        }
      } catch (e) {}
      const pid = rawTreeParentId(tab);
      if (!pid) {
        return null;
      }
      try {
        if (rawTreeId(tab) === pid) {
          return null;
        }
      } catch (e) {}
      const found = findTabByTreeId(pid);
      if (!found || found === tab) {
        return null;
      }
      try {
        if (found.closing) {
          return null;
        }
      } catch (e) {}
      try {
        if (getWs(found) !== getWs(tab)) {
          return null;
        }
      } catch (e) {
        return null;
      }
      return found;
    } catch (e) {
      return null;
    }
  }

  // Derived level, capped at 2. Cycle-guarded; unknown parents stop the walk.
  function getTreeLevel(tab) {
    try {
      if (!tab || tab.closing) {
        return 0;
      }
      try {
        if (tab.pinned) {
          return 0;
        }
      } catch (e) {}
      let level = 0;
      let cur = tab;
      const seen = new Set();
      try {
        const self = rawTreeId(cur);
        if (self) {
          seen.add(self);
        }
      } catch (e) {}
      let guard = 0;
      while (guard++ < 6) {
        let parent = null;
        try {
          parent = getTreeParentTab(cur);
        } catch (e) {
          break;
        }
        if (!parent) {
          break;
        }
        let pid = null;
        try {
          pid = rawTreeId(parent);
        } catch (e) {}
        if (pid) {
          if (seen.has(pid)) {
            break;
          }
          seen.add(pid);
        }
        level += 1;
        if (level >= TREE_MAX_LEVEL) {
          return TREE_MAX_LEVEL;
        }
        cur = parent;
      }
      return level;
    } catch (e) {
      return 0;
    }
  }

  function getTreeChildren(parentTab) {
    const out = [];
    try {
      if (!parentTab || parentTab.closing) {
        return out;
      }
      let pid = null;
      try {
        pid = rawTreeId(parentTab);
      } catch (e) {}
      if (!pid) {
        return out;
      }
      const tabs = Array.from(gBrowser.tabs || []);
      for (const t of tabs) {
        try {
          if (!t || t === parentTab || t.closing) {
            continue;
          }
          try {
            if (t.pinned) {
              continue;
            }
          } catch (e) {}
          if (rawTreeParentId(t) !== pid) {
            continue;
          }
          // Same-workspace only (cross-WS edges read as detached).
          try {
            if (getWs(t) !== getWs(parentTab)) {
              continue;
            }
          } catch (e) {
            continue;
          }
          out.push(t);
        } catch (e) {}
      }
    } catch (e) {}
    return out;
  }

  function getTreeDescendants(parentTab) {
    const out = [];
    try {
      if (!parentTab) {
        return out;
      }
      const queue = getTreeChildren(parentTab).slice();
      const seen = new Set();
      try {
        seen.add(parentTab);
      } catch (e) {}
      let guard = 0;
      while (queue.length && guard++ < 500) {
        const cur = queue.shift();
        try {
          if (!cur || seen.has(cur)) {
            continue;
          }
          seen.add(cur);
          out.push(cur);
          for (const kid of getTreeChildren(cur)) {
            if (!seen.has(kid)) {
              queue.push(kid);
            }
          }
        } catch (e) {}
      }
    } catch (e) {}
    return out;
  }

  function countTreeDescendants(parentTab) {
    try {
      return getTreeDescendants(parentTab).length;
    } catch (e) {
      return 0;
    }
  }

  function isTreeCollapsed(parentTab) {
    try {
      if (!parentTab) {
        return false;
      }
      const pid = rawTreeId(parentTab);
      if (!pid || !collapsedTreeParents.has(pid)) {
        return false;
      }
      return getTreeChildren(parentTab).length > 0;
    } catch (e) {
      return false;
    }
  }

  // True when any ancestor is collapsed (selection safety uses this).
  function isTreeHiddenByCollapse(tab) {
    try {
      if (!tab || tab.pinned) {
        return false;
      }
      let cur = tab;
      let guard = 0;
      while (cur && guard++ < 6) {
        let parent = null;
        try {
          parent = getTreeParentTab(cur);
        } catch (e) {
          break;
        }
        if (!parent) {
          return false;
        }
        let pid = null;
        try {
          pid = rawTreeId(parent);
        } catch (e) {}
        if (pid && collapsedTreeParents.has(pid)) {
          return true;
        }
        cur = parent;
      }
      return false;
    } catch (e) {
      return false;
    }
  }

  // Last index (in gBrowser.tabs order) occupied by parent or any of its
  // descendants. New children are inserted directly after it.
  function lastTreeDescendantIndex(parentTab) {
    try {
      const tabs = Array.from(gBrowser.tabs || []);
      let best = tabs.indexOf(parentTab);
      if (best === -1) {
        return -1;
      }
      for (const d of getTreeDescendants(parentTab)) {
        try {
          const i = tabs.indexOf(d);
          if (i > best) {
            best = i;
          }
        } catch (e) {}
      }
      return best;
    } catch (e) {
      return -1;
    }
  }

  // Move `tab` to final index `toIndex` (clamped) via the verified stock
  // mover: tabbrowser.moveTabTo(element, { tabIndex }) where tabIndex is
  // the desired FINAL index within gBrowser.tabs (Firefox 155 omni.ja,
  // tabbrowser.js — numeric second args silently misroute to the strip
  // end, so never pass a bare number). Falls back to an array splice only
  // when no stock mover exists at all: gBrowser.tabs is a cached snapshot
  // in chrome, so the splice path is tests-only (mock tabs arrays are the
  // live store there). Nested TabMove events from programmatic moves
  // re-enter onTreeTabMove, which is idempotent, so no ignore-flags needed.
  function moveTreeTabTo(tab, toIndex) {
    try {
      if (!tab) {
        return false;
      }
      let live = null;
      try {
        live = gBrowser.tabs;
      } catch (e) {
        return false;
      }
      if (!live || typeof live.indexOf !== "function") {
        return false;
      }
      const cur = live.indexOf(tab);
      if (cur === -1) {
        return false;
      }
      // `toIndex` is in pre-move coordinates (e.g. best+1 including the
      // tab itself). Convert to the final index: a forward move shifts
      // left by one once the tab is removed.
      const raw = Number(toIndex) || 0;
      const wantPre = Math.max(0, Math.min(raw, live.length));
      const finalIdx = cur < wantPre ? wantPre - 1 : wantPre;
      const clampedFinal = Math.max(0, Math.min(finalIdx, live.length - 1));
      if (cur === clampedFinal) {
        return true;
      }
      if (typeof gBrowser.moveTabTo === "function") {
        try {
          gBrowser.moveTabTo(tab, { tabIndex: clampedFinal });
          return true;
        } catch (e) {}
      }
      // No stock mover (node tests only — see note above).
      try {
        live.splice(cur, 1);
        const at = Math.max(0, Math.min(clampedFinal, live.length));
        live.splice(at, 0, tab);
        try {
          gBrowser.tabContainer._invalidateCachedVisibleTabs();
        } catch (e) {}
        return true;
      } catch (e) {
        return false;
      }
    } catch (e) {
      return false;
    }
  }

  // Resolve the moved tab from a TabMove event. Stock dispatches the event
  // on the tab itself (bubbling to the container), but never trust a single
  // shape: fall back to detail-carried refs, then to quacks-like-a-tab.
  function resolveMovedTab(e) {
    try {
      if (!e) {
        return null;
      }
      try {
        const tabs = gBrowser.tabs || [];
        if (e.target && Array.prototype.includes.call(tabs, e.target)) {
          return e.target;
        }
      } catch (err) {}
      const cands = [];
      try {
        const d = e.detail;
        if (d) {
          if (d.tab) {
            cands.push(d.tab);
          }
          if (d.movedTab) {
            cands.push(d.movedTab);
          }
          if (d.target && d.target !== e.target) {
            cands.push(d.target);
          }
        }
      } catch (err) {}
      try {
        if (e.movedTab) {
          cands.push(e.movedTab);
        }
      } catch (err) {}
      try {
        const tabs = gBrowser.tabs || [];
        for (const c of cands) {
          try {
            if (c && !c.closing && Array.prototype.includes.call(tabs, c)) {
              return c;
            }
          } catch (err) {}
        }
      } catch (err) {}
      try {
        const t = e.target;
        if (
          t &&
          !t.closing &&
          typeof t.setAttribute === "function" &&
          (t.localName === "tab" || typeof t.linkedBrowser !== "undefined")
        ) {
          return t;
        }
      } catch (err) {}
      return null;
    } catch (err) {
      return null;
    }
  }

  // Explicit opener sources only — never fall back to the selected tab,
  // or manual tabs (Ctrl+T, + button) would wrongly parent. Covers stock
  // (tab.openerTab), older ownerTab shapes, gBrowser helpers, TabOpen
  // detail, and a __aphOpener test hook.
  function resolveTreeOpener(child, evt) {
    try {
      if (!child) {
        return null;
      }
      try {
        if (child.__aphOpener && child.__aphOpener !== child && !child.__aphOpener.closing) {
          return child.__aphOpener;
        }
      } catch (e) {}
      try {
        const d = evt && evt.detail;
        if (d) {
          if (d.adoptedTab) {
            return null;
          }
          if (d.openerTab && d.openerTab !== child && !d.openerTab.closing) {
            return d.openerTab;
          }
          if (d.opener && d.opener !== child && !d.opener.closing) {
            return d.opener;
          }
        }
      } catch (e) {}
      const candidates = [];
      try {
        if (child.openerTab) {
          candidates.push(child.openerTab);
        }
      } catch (e) {}
      try {
        if (child.ownerTab) {
          candidates.push(child.ownerTab);
        }
      } catch (e) {}
      try {
        if (child._openerTab) {
          candidates.push(child._openerTab);
        }
      } catch (e) {}
      try {
        if (child.opener && child.opener !== window) {
          candidates.push(child.opener);
        }
      } catch (e) {}
      try {
        if (gBrowser.getOpenerTab && typeof gBrowser.getOpenerTab === "function") {
          candidates.push(gBrowser.getOpenerTab(child));
        }
      } catch (e) {}
      try {
        if (gBrowser.getOpener && typeof gBrowser.getOpener === "function") {
          candidates.push(gBrowser.getOpener(child));
        }
      } catch (e) {}
      try {
        const tabs = gBrowser.tabs || [];
        for (const c of candidates) {
          try {
            if (c && c !== child && !c.closing && Array.prototype.includes.call(tabs, c)) {
              return c;
            }
          } catch (e) {}
        }
      } catch (e) {}
      return null;
    } catch (e) {
      return null;
    }
  }

  // Core attach: link `child` under `opener`, retag to the opener's
  // workspace, cap depth at 2 (children of L2 become siblings under the
  // same L1), and place after the parent's last descendant. Returns the
  // child's level (0 when it stays a root).
  function attachTreeChild(child, opener) {
    try {
      if (!child || child.closing) {
        return 0;
      }
      ensureTreeId(child);
      try {
        if (child.pinned) {
          clearTreeParent(child);
          try {
            renderTree();
          } catch (_e) {}
          return 0;
        }
      } catch (e) {}
      if (!opener || opener === child || opener.closing) {
        clearTreeParent(child);
        try {
          renderTree();
        } catch (e) {}
        return 0;
      }
      let tabs = [];
      try {
        tabs = Array.from(gBrowser.tabs || []);
      } catch (e) {
        return 0;
      }
      if (!tabs.includes(opener) || !tabs.includes(child)) {
        clearTreeParent(child);
        return 0;
      }
      let pws = null;
      try {
        pws = getWs(opener);
      } catch (e) {}
      if (!isValidId(pws)) {
        clearTreeParent(child);
        return 0;
      }
      try {
        setWs(child, pws);
      } catch (e) {}
      let parentTab = opener;
      try {
        const plvl = getTreeLevel(opener);
        if (plvl >= TREE_MAX_LEVEL) {
          const gp = getTreeParentTab(opener);
          if (gp && !gp.closing && tabs.includes(gp)) {
            parentTab = gp;
          } else {
            parentTab = opener;
          }
        }
      } catch (e) {
        parentTab = opener;
      }
      let pid = null;
      try {
        pid = rawTreeId(parentTab);
        if (!pid) {
          pid = ensureTreeId(parentTab);
        }
      } catch (e) {}
      if (!pid) {
        clearTreeParent(child);
        return 0;
      }
      try {
        if (rawTreeId(child) === pid) {
          return getTreeLevel(child);
        }
      } catch (e) {}
      // Cycle guard: the child must not already contain the parent.
      try {
        const mine = rawTreeId(child);
        if (mine) {
          let cur = parentTab;
          let guard = 0;
          while (cur && guard++ < 8) {
            let cid = null;
            try {
              cid = rawTreeId(cur);
            } catch (e) {}
            if (cid === mine) {
              clearTreeParent(child);
              return 0;
            }
            cur = getTreeParentTab(cur);
          }
        }
      } catch (e) {}
      try {
        setTreeParent(child, pid);
      } catch (e) {}
      try {
        let best = tabs.indexOf(parentTab);
        for (const d of getTreeDescendants(parentTab)) {
          try {
            if (d === child) {
              continue;
            }
            const i = Array.from(gBrowser.tabs || []).indexOf(d);
            if (i > best) {
              best = i;
            }
          } catch (e) {}
        }
        moveTreeTabTo(child, best + 1);
      } catch (e) {}
      try {
        renderTree();
      } catch (e) {}
      try {
        applyTreeVisibility();
      } catch (e) {}
      try {
        return getTreeLevel(child);
      } catch (e) {
        return 0;
      }
    } catch (e) {
      return 0;
    }
  }

  function treeAttachFromOpener(tab, evt) {
    try {
      if (!tab || tab.closing) {
        return 0;
      }
      try {
        if (tab.pinned) {
          clearTreeParent(tab);
          return 0;
        }
      } catch (e) {}
      const opener = resolveTreeOpener(tab, evt);
      return attachTreeChild(tab, opener);
    } catch (e) {
      return 0;
    }
  }

  // Swapped-in replacements (container repair, domain-route reopen) keep
  // the original's tree slot: same parent, same workspace, same position.
  function inheritTreeLink(replacement, original) {
    try {
      if (!replacement || !original || replacement === original) {
        return;
      }
      ensureTreeId(replacement);
      let ws = null;
      try {
        ws = getWs(original);
      } catch (e) {}
      if (isValidId(ws)) {
        try {
          setWs(replacement, ws);
        } catch (e) {}
      }
      let pid = null;
      try {
        pid = rawTreeParentId(original);
      } catch (e) {}
      if (pid) {
        const parentTab = findTabByTreeId(pid);
        if (parentTab && parentTab !== replacement && !parentTab.closing) {
          try {
            setTreeParent(replacement, pid);
          } catch (e) {}
        } else {
          clearTreeParent(replacement);
        }
      } else {
        clearTreeParent(replacement);
      }
      try {
        const tabs = Array.from(gBrowser.tabs || []);
        const at = tabs.indexOf(original);
        if (at !== -1) {
          moveTreeTabTo(replacement, at);
        }
      } catch (e) {}
    } catch (e) {}
  }

  // Closing a parent promotes direct children up one level in place
  // (L1→L0, L2→L1 via the grandparent). Never deletes children, so no
  // confirmation dialog is needed. Stale collapse flags are dropped.
  function promoteTreeChildrenOnClose(closed) {
    try {
      if (!closed) {
        return;
      }
      const closedId = rawTreeId(closed);
      if (!closedId) {
        return;
      }
      let grandparentId = null;
      try {
        const gp = rawTreeParentId(closed);
        if (gp) {
          const gpTab = findTabByTreeId(gp);
          if (gpTab && gpTab !== closed && !gpTab.closing) {
            try {
              if (getWs(gpTab) === getWs(closed)) {
                grandparentId = gp;
              }
            } catch (e) {}
          }
        }
      } catch (e) {}
      let tabs = [];
      try {
        tabs = Array.from(gBrowser.tabs || []);
      } catch (e) {
        return;
      }
      for (const t of tabs) {
        try {
          if (!t || t === closed || t.closing) {
            continue;
          }
          if (rawTreeParentId(t) !== closedId) {
            continue;
          }
          if (grandparentId) {
            setTreeParent(t, grandparentId);
          } else {
            clearTreeParent(t);
          }
          ensureTreeId(t);
        } catch (e) {}
      }
      try {
        collapsedTreeParents.delete(closedId);
      } catch (e) {}
    } catch (e) {}
  }

  // Sending tabs across workspaces detaches them (workspace-scoped trees):
  // promoted children stay behind, sent tabs land as Level 0 roots.
  function detachTreeForWorkspaceSend(tab) {
    try {
      if (!tab) {
        return;
      }
      const myId = rawTreeId(tab);
      if (myId) {
        let tabs = [];
        try {
          tabs = Array.from(gBrowser.tabs || []);
        } catch (e) {}
        let myParent = null;
        try {
          myParent = rawTreeParentId(tab);
        } catch (e) {}
        for (const t of tabs) {
          try {
            if (!t || t === tab || t.closing) {
              continue;
            }
            if (rawTreeParentId(t) !== myId) {
              continue;
            }
            if (myParent && findTabByTreeId(myParent)) {
              setTreeParent(t, myParent);
            } else {
              clearTreeParent(t);
            }
          } catch (e) {}
        }
      }
      clearTreeParent(tab);
      ensureTreeId(tab);
      try {
        collapsedTreeParents.delete(myId);
      } catch (e) {}
    } catch (e) {}
  }

  // Clear dangling edges (missing parent, self-parent, pinned child,
  // cross-workspace, duplicate IDs). Cheap full pass on init/restore.
  function healTreeLinks() {
    try {
      let tabs = [];
      try {
        tabs = Array.from(gBrowser.tabs || []);
      } catch (e) {
        return;
      }
      const seenIds = new Set();
      for (const t of tabs) {
        try {
          if (!t) {
            continue;
          }
          let id = rawTreeId(t);
          if (!id) {
            continue;
          }
          if (seenIds.has(id)) {
            let fresh = null;
            try {
              aphTreeSeq += 1;
              fresh = `t${Date.now().toString(36)}-${aphTreeSeq.toString(36)}dup`;
              SessionStore.setCustomTabValue(t, TREE_ID_KEY, fresh);
              id = fresh;
            } catch (e) {}
          }
          seenIds.add(id);
        } catch (e) {}
      }
      for (const t of tabs) {
        try {
          if (!t) {
            continue;
          }
          const pid = rawTreeParentId(t);
          if (!pid) {
            continue;
          }
          let bad = false;
          try {
            if (t.pinned) {
              bad = true;
            }
          } catch (e) {}
          try {
            if (!bad && rawTreeId(t) === pid) {
              bad = true;
            }
          } catch (e) {}
          if (!bad) {
            const parent = findTabByTreeId(pid);
            if (!parent || parent === t) {
              bad = true;
            } else {
              try {
                if (parent.closing) {
                  bad = true;
                }
              } catch (e) {}
              try {
                if (!bad && getWs(parent) !== getWs(t)) {
                  bad = true;
                }
              } catch (e) {}
            }
          }
          if (bad) {
            clearTreeParent(t);
          }
        } catch (e) {}
      }
      try {
        pruneCollapsedTreeSet(tabs);
      } catch (e) {}
    } catch (e) {}
  }

  function pruneCollapsedTreeSet(tabs) {
    try {
      const list = tabs || Array.from(gBrowser.tabs || []);
      const live = new Set();
      const withKids = new Set();
      for (const t of list) {
        try {
          const id = rawTreeId(t);
          if (id) {
            live.add(id);
            if (getTreeChildren(t).length > 0) {
              withKids.add(id);
            }
          }
        } catch (e) {}
      }
      for (const id of Array.from(collapsedTreeParents)) {
        if (!live.has(id) || !withKids.has(id)) {
          collapsedTreeParents.delete(id);
        }
      }
    } catch (e) {}
  }

  // Workspace visibility runs first (reconcile shows the whole workspace);
  // this re-hides descendants of collapsed parents in the current WS, and
  // unhides previously tree-hidden tabs once expanded. Foreign workspaces
  // and pinned tabs are never touched here.
  function applyTreeVisibility() {
    try {
      if (!isValidId(current)) {
        return;
      }
      let tabs = [];
      try {
        tabs = Array.from(gBrowser.tabs || []);
      } catch (e) {
        return;
      }
      let sel = null;
      try {
        sel = gBrowser.selectedTab;
      } catch (e) {}
      for (const t of tabs) {
        try {
          if (!t || t.closing || t.pinned) {
            continue;
          }
          try {
            if (getWs(t) !== current) {
              continue;
            }
          } catch (e) {
            continue;
          }
          // The selected tab must always be visible (no invisible active
          // tabs): selecting a folded child expands its ancestors via
          // TabSelect, and the stale `hidden` flag is cleared here.
          if (t === sel) {
            if (t.hidden) {
              try {
                aphShowTab(t);
              } catch (_e) {
                try {
                  t.removeAttribute("hidden");
                } catch (__e) {}
              }
            }
            continue;
          }
          let hiddenByCollapse = false;
          try {
            hiddenByCollapse = isTreeHiddenByCollapse(t);
          } catch (e) {}
          if (hiddenByCollapse) {
            if (!t.hidden) {
              aphHideTab(t, "tree");
            }
          } else if (t.hidden) {
            aphShowTab(t);
            try {
              let hb = null;
              try {
                hb = SessionStore.getCustomTabValue(t, "hiddenBy");
              } catch (e) {}
              if (hb === "tree" && SessionStore && typeof SessionStore.deleteCustomTabValue === "function") {
                SessionStore.deleteCustomTabValue(t, "hiddenBy");
              }
            } catch (e) {}
          }
        } catch (e) {}
      }
    } catch (e) {}
  }

  function setTreeCollapsed(parentTab, collapse) {
    try {
      if (!parentTab || parentTab.closing) {
        return false;
      }
      ensureTreeId(parentTab);
      const kids = getTreeChildren(parentTab);
      const pid = rawTreeId(parentTab);
      if (!pid) {
        return false;
      }
      if (collapse) {
        if (!kids.length) {
          return false;
        }
        // Selection safety: collapsing must never hide the active tab.
        try {
          const sel = gBrowser.selectedTab;
          if (sel && sel !== parentTab && !sel.closing) {
            let cur = sel;
            let guard = 0;
            let inside = false;
            while (cur && guard++ < 6) {
              const p = getTreeParentTab(cur);
              if (!p) {
                break;
              }
              if (p === parentTab) {
                inside = true;
                break;
              }
              cur = p;
            }
            if (inside) {
              try {
                aphShowTab(parentTab);
              } catch (e) {}
              try {
                gBrowser.selectedTab = parentTab;
              } catch (e) {}
            }
          }
        } catch (e) {}
        collapsedTreeParents.add(pid);
      } else {
        collapsedTreeParents.delete(pid);
      }
      try {
        applyTreeVisibility();
      } catch (e) {}
      try {
        renderTree();
      } catch (e) {}
      return true;
    } catch (e) {
      return false;
    }
  }

  function toggleTreeCollapsed(parentTab) {
    try {
      if (!parentTab) {
        return false;
      }
      return setTreeCollapsed(parentTab, !isTreeCollapsed(parentTab));
    } catch (e) {
      return false;
    }
  }

  // No invisible active tabs: selecting (via Ctrl+Tab, palette, shortcut)
  // a hidden descendant expands every ancestor first.
  function expandTreeAncestors(tab) {
    try {
      if (!tab) {
        return false;
      }
      let changed = false;
      let cur = tab;
      let guard = 0;
      while (cur && guard++ < 6) {
        let parent = null;
        try {
          parent = getTreeParentTab(cur);
        } catch (e) {
          break;
        }
        if (!parent) {
          break;
        }
        try {
          const pid = rawTreeId(parent);
          if (pid && collapsedTreeParents.has(pid)) {
            collapsedTreeParents.delete(pid);
            changed = true;
          }
        } catch (e) {}
        cur = parent;
      }
      if (changed) {
        try {
          applyTreeVisibility();
        } catch (e) {}
        try {
          renderTree();
        } catch (e) {}
      }
      return changed;
    } catch (e) {
      return false;
    }
  }

  function onTreeTabSelect(e) {
    try {
      const tab = (e && e.target) || gBrowser.selectedTab;
      if (!tab) {
        return;
      }
      expandTreeAncestors(tab);
      try {
        renderTree();
      } catch (err) {}
    } catch (e) {}
  }

  // Find the tree block the dropped leaf tab landed inside, if any. A block
  // span runs from a parent through its last descendant (same workspace,
  // the tab itself excluded); the strip position right below a family's
  // last descendant counts as inside, mirroring creation placement. Nested
  // spans resolve to the innermost (latest-starting) parent, depth-capped
  // like attachTreeChild. Returns the parent to adopt (link only — the tab
  // keeps its drop position), or null when the spot belongs to no family.
  function findEnclosingTreeParent(tab) {
    try {
      if (!tab || tab.closing) {
        return null;
      }
      try {
        if (tab.pinned) {
          return null;
        }
      } catch (e) {}
      let tabs = [];
      try {
        tabs = Array.from(gBrowser.tabs || []);
      } catch (e) {
        return null;
      }
      const at = tabs.indexOf(tab);
      if (at === -1) {
        return null;
      }
      let ws = null;
      try {
        ws = getWs(tab);
      } catch (e) {}
      if (!isValidId(ws)) {
        return null;
      }
      let best = null;
      let bestStart = -1;
      for (const cand of tabs) {
        try {
          if (!cand || cand === tab || cand.closing) {
            continue;
          }
          try {
            if (cand.pinned || getWs(cand) !== ws) {
              continue;
            }
          } catch (e) {
            continue;
          }
          if (!getTreeChildren(cand).length) {
            continue;
          }
          const cIdx = tabs.indexOf(cand);
          if (cIdx === -1 || cIdx >= at) {
            continue;
          }
          let end = cIdx;
          for (const d of getTreeDescendants(cand)) {
            try {
              if (d === tab) {
                continue;
              }
              const i = tabs.indexOf(d);
              if (i > end) {
                end = i;
              }
            } catch (e) {}
          }
          if (at <= end + 1 && cIdx > bestStart) {
            best = cand;
            bestStart = cIdx;
          }
        } catch (e) {}
      }
      if (!best) {
        return null;
      }
      // Depth cap, mirroring attachTreeChild: drops inside an L2 span join
      // as siblings under the same L1.
      try {
        if (getTreeLevel(best) >= TREE_MAX_LEVEL) {
          const gp = getTreeParentTab(best);
          if (gp && !gp.closing) {
            return gp;
          }
        }
      } catch (e) {}
      return best;
    } catch (e) {
      return null;
    }
  }

  // Manual drags: a moved parent carries its whole subtree block with it;
  // a child dropped outside its parent's block detaches to Level 0;
  // a child moved inside keeps its link (sibling reorder, level kept).
  // Re-entrant: stock movers dispatch TabMove for our own carry moves, so
  // nested runs must be (and are) idempotent no-ops once placed.
  function onTreeTabMove(e) {
    if (treeMoveDepth > 8) {
      return;
    }
    treeMoveDepth += 1;
    try {
      const tab = resolveMovedTab(e);
      if (!tab || tab.closing) {
        return;
      }
      try {
        if (tab.pinned) {
          return;
        }
      } catch (err) {}
      let tabs = [];
      try {
        tabs = Array.from(gBrowser.tabs || []);
      } catch (err) {
        return;
      }
      if (!tabs.includes(tab)) {
        return;
      }
      const descendants = getTreeDescendants(tab);
      if (descendants.length) {
        // Carry the whole block after the parent, preserving sibling
        // order. Sequential moves recompute the parent base each time so
        // end-of-strip drags stay exact.
        try {
          descendants.sort((a, b) => tabs.indexOf(a) - tabs.indexOf(b));
          for (let i = 0; i < descendants.length; i++) {
            const d = descendants[i];
            try {
              if (!d || d.closing) {
                continue;
              }
              const live = Array.from(gBrowser.tabs || []);
              if (!live.includes(d)) {
                continue;
              }
              const base = live.indexOf(tab);
              if (base === -1) {
                break;
              }
              moveTreeTabTo(d, base + 1 + i);
            } catch (err) {}
          }
        } catch (err) {}
        try {
          renderTree();
        } catch (err) {}
        try {
          applyTreeVisibility();
        } catch (err) {}
        return;
      }
      // Leaves: the drop position wins. Inside (or directly below) a
      // same-workspace block the tab joins that family — re-parenting
      // dragged children included — and keeps its exact drop spot;
      // anywhere else it flattens to Level 0.
      try {
        const host = findEnclosingTreeParent(tab);
        if (host) {
          let pid = null;
          try {
            pid = rawTreeId(host);
            if (!pid) {
              pid = ensureTreeId(host);
            }
          } catch (err) {}
          if (pid && rawTreeParentId(tab) !== pid) {
            try {
              setTreeParent(tab, pid);
            } catch (err) {}
          }
          try {
            ensureTreeId(tab);
          } catch (err) {}
        } else {
          clearTreeParent(tab);
        }
        try {
          renderTree();
        } catch (err) {}
        try {
          applyTreeVisibility();
        } catch (err) {}
      } catch (err) {}
    } catch (e) {}
    try {
      treeMoveDepth = Math.max(0, treeMoveDepth - 1);
    } catch (err) {}
  }

  // Chevron + count badge injection (vertical strip only via CSS; the
  // elements stay hidden elsewhere). Idempotent: reuses existing nodes,
  // never double-binds listeners, no-ops on mock tabs without DOM.
  function syncTreeChrome(tab) {
    try {
      if (!tab || tab.closing) {
        return;
      }
      if (typeof tab.querySelector !== "function") {
        return;
      }
      if (typeof document === "undefined" || !document) {
        return;
      }
      let pinned = false;
      try {
        pinned = !!tab.pinned;
      } catch (e) {}
      const kids = pinned ? [] : getTreeChildren(tab);
      const hasKids = kids.length > 0;
      const collapsed = hasKids && isTreeCollapsed(tab);
      let host = null;
      try {
        host =
          tab.querySelector(".tab-content") ||
          tab.querySelector(".tab-stack") ||
          null;
      } catch (e) {
        host = null;
      }
      if (!host || typeof host.querySelector !== "function") {
        return;
      }
      // Twisty (parents only).
      let twisty = null;
      try {
        twisty = host.querySelector(":scope > .aph-tree-twisty");
      } catch (e) {
        try {
          twisty = host.querySelector(".aph-tree-twisty");
        } catch (_e) {
          twisty = null;
        }
      }
      if (hasKids) {
        if (!twisty) {
          try {
            twisty =
              typeof document.createXULElement === "function"
                ? document.createXULElement("label")
                : document.createElement("span");
            twisty.className = "aph-tree-twisty";
            if (typeof host.prepend === "function") {
              host.prepend(twisty);
            } else if (typeof host.appendChild === "function") {
              host.appendChild(twisty);
            }
          } catch (e) {
            twisty = null;
          }
        }
        if (twisty) {
          try {
            twisty.textContent = collapsed ? "▸" : "▾";
          } catch (e) {}
          try {
            twisty.setAttribute("data-aph-collapsed", collapsed ? "1" : "0");
          } catch (e) {}
          try {
            twisty.title = collapsed ? "Expand child tabs" : "Collapse child tabs";
          } catch (e) {}
          try {
            if (!twisty.__aphTreeBound) {
              twisty.__aphTreeBound = true;
              twisty.addEventListener("click", (ev) => {
                try {
                  if (ev) {
                    if (typeof ev.stopPropagation === "function") {
                      ev.stopPropagation();
                    }
                    if (typeof ev.preventDefault === "function") {
                      ev.preventDefault();
                    }
                  }
                  let owner = null;
                  try {
                    const n = ev && (ev.currentTarget || ev.target);
                    if (n && typeof n.closest === "function") {
                      owner = n.closest("tab");
                    }
                  } catch (err) {}
                  try {
                    toggleTreeCollapsed(owner || tab);
                  } catch (err) {}
                } catch (err) {}
              });
              // mousedown fires before tab selection: stop it so toggling
              // never also selects the parent as a side effect.
              twisty.addEventListener("mousedown", (ev) => {
                try {
                  if (ev) {
                    if (typeof ev.stopPropagation === "function") {
                      ev.stopPropagation();
                    }
                    if (typeof ev.preventDefault === "function") {
                      ev.preventDefault();
                    }
                  }
                } catch (err) {}
              });
            }
          } catch (e) {}
        }
      } else if (twisty) {
        try {
          if (typeof twisty.remove === "function") {
            twisty.remove();
          } else if (twisty.parentNode) {
            twisty.parentNode.removeChild(twisty);
          }
        } catch (e) {}
        twisty = null;
      }
      // Count badge (collapsed parents only).
      let badge = null;
      try {
        badge = host.querySelector(":scope > .aph-tree-count");
      } catch (e) {
        try {
          badge = host.querySelector(".aph-tree-count");
        } catch (_e) {
          badge = null;
        }
      }
      if (collapsed) {
        let count = 0;
        try {
          count = countTreeDescendants(tab);
        } catch (e) {}
        if (count > 0) {
          if (!badge) {
            try {
              badge =
                typeof document.createXULElement === "function"
                  ? document.createXULElement("label")
                  : document.createElement("span");
              badge.className = "aph-tree-count";
              if (typeof host.appendChild === "function") {
                host.appendChild(badge);
              }
            } catch (e) {
              badge = null;
            }
          }
          if (badge) {
            try {
              badge.textContent = String(count);
            } catch (e) {}
            try {
              badge.title = `${count} hidden tab${count === 1 ? "" : "s"}`;
            } catch (e) {}
          }
        } else if (badge) {
          try {
            if (typeof badge.remove === "function") {
              badge.remove();
            } else if (badge.parentNode) {
              badge.parentNode.removeChild(badge);
            }
          } catch (e) {}
        }
      } else if (badge) {
        try {
          if (typeof badge.remove === "function") {
            badge.remove();
          } else if (badge.parentNode) {
            badge.parentNode.removeChild(badge);
          }
        } catch (e) {}
      }
    } catch (e) {}
  }

  function renderTree() {
    try {
      let tabs = [];
      try {
        tabs = Array.from(gBrowser.tabs || []);
      } catch (e) {
        return;
      }
      for (const t of tabs) {
        try {
          if (!t || t.closing) {
            continue;
          }
          let level = 0;
          try {
            level = getTreeLevel(t);
          } catch (e) {
            level = 0;
          }
          try {
            if (t.pinned) {
              level = 0;
            }
          } catch (e) {}
          try {
            if (typeof t.setAttribute === "function") {
              t.setAttribute("data-aph-level", String(level));
              const kids = getTreeChildren(t);
              if (kids.length) {
                t.setAttribute("data-aph-has-kids", "1");
              } else {
                try {
                  t.removeAttribute("data-aph-has-kids");
                } catch (e) {}
              }
              if (isTreeCollapsed(t)) {
                t.setAttribute("data-aph-collapsed", "1");
                let count = 0;
                try {
                  count = countTreeDescendants(t);
                } catch (e) {}
                if (count > 0) {
                  t.setAttribute("data-aph-collapsed-count", String(count));
                } else {
                  try {
                    t.removeAttribute("data-aph-collapsed-count");
                  } catch (e) {}
                }
              } else {
                try {
                  t.removeAttribute("data-aph-collapsed");
                } catch (e) {}
                try {
                  t.removeAttribute("data-aph-collapsed-count");
                } catch (e) {}
              }
            }
          } catch (e) {}
          try {
            syncTreeChrome(t);
          } catch (e) {}
        } catch (e) {}
      }
      try {
        pruneCollapsedTreeSet(tabs);
      } catch (e) {}
    } catch (e) {}
  }
