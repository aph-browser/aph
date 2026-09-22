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

  // Native-group nesting invariant: trees live inside groups. A tree edge
  // is only valid between two tabs in the same group state (both
  // ungrouped, or members of the same <tab-group>). Unnested helpers
  // below enforce this at every edge-creation point (attach joins,
  // indent/adopt refuse to cross, reads/heals treat crossings as absent).
  function treeGroupOf(tab) {
    try {
      return (tab && tab.group) || null;
    } catch (e) {
      return null;
    }
  }

  function sameTreeGroup(a, b) {
    try {
      const ga = treeGroupOf(a);
      const gb = treeGroupOf(b);
      if (!ga && !gb) {
        return true;
      }
      if (!ga || !gb) {
        return false;
      }
      try {
        if (ga === gb) {
          return true;
        }
      } catch (e) {}
      // Identity can differ across wrappers/mocks for the same logical
      // group — fall back to id comparison when both sides carry one.
      try {
        return !!(ga.id && gb.id && ga.id === gb.id);
      } catch (e) {
        return false;
      }
    } catch (e) {
      return false;
    }
  }

  // Tabs we are programmatically (un)grouping right now. Stock joins
  // (moveTabToExistingGroup / group.addTabs) append to the group end and
  // stock ejects reposition after the old group; both dispatch TabMove
  // synchronously. Without this guard the nested onTreeTabMove would
  // re-derive the just-placed tab (group-end can sit past the parent span
  // when trailing non-family members exist; a just-ejected tab looks like
  // a fresh drop) and detach or re-parent it mid-operation. Entries live
  // only for the synchronous stock call, so a missed event can never
  // swallow a later genuine user drag (unlike a persistent ignore-flag).
  const aphGroupOpGuard = new Set();

  // Best-effort group join: stock `moveTabToExistingGroup` first (verified
  // in omni.ja Tabbrowser.sys.mjs — appends to the group, no-ops when
  // already grouped or pinned), `group.addTabs` fallback (same effect via
  // tabgroup.js). Returns true when membership is (now) correct.
  function joinTreeGroup(tab, group) {
    try {
      if (!tab || tab.closing || !group) {
        return false;
      }
      try {
        if (tab.pinned) {
          return false;
        }
      } catch (e) {
        return false;
      }
      try {
        if (tab.group === group) {
          return true;
        }
        const mine = tab.group && tab.group.id;
        if (mine && group.id && mine === group.id) {
          return true;
        }
      } catch (e) {}
      aphGroupOpGuard.add(tab);
      try {
        try {
          if (gBrowser && typeof gBrowser.moveTabToExistingGroup === "function") {
            gBrowser.moveTabToExistingGroup(tab, group);
            return true;
          }
        } catch (e) {}
        try {
          if (typeof group.addTabs === "function") {
            group.addTabs([tab]);
            return true;
          }
        } catch (e) {}
      } finally {
        try {
          aphGroupOpGuard.delete(tab);
        } catch (e) {}
      }
    } catch (e) {}
    return false;
  }

  // Best-effort group eject (symmetric counterpart to joinTreeGroup):
  // guarded so the synchronous TabMove from stock ungroupTab doesn't
  // re-derive the tab mid-operation. Pinned tabs never reach here (stock
  // forbids grouping them); already-ungrouped is success.
  function ejectTreeTabFromGroup(tab) {
    try {
      if (!tab || tab.closing) {
        return false;
      }
      try {
        if (!treeGroupOf(tab)) {
          return true;
        }
      } catch (e) {}
      aphGroupOpGuard.add(tab);
      try {
        try {
          if (gBrowser && typeof gBrowser.ungroupTab === "function") {
            gBrowser.ungroupTab(tab);
          }
        } catch (e) {}
      } finally {
        try {
          aphGroupOpGuard.delete(tab);
        } catch (e) {}
      }
      try {
        return !treeGroupOf(tab);
      } catch (e) {
        return false;
      }
    } catch (e) {}
    return false;
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
  // self-parent, pinned child, cross-workspace, cross-group) read as "no
  // parent" so the tab renders Level 0; healTreeLinks clears them lazily.
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
      // Trees live inside groups: a parent in another group state reads
      // as absent (healTreeLinks clears the stored edge lazily).
      try {
        if (!sameTreeGroup(found, tab)) {
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
          // Same group state only (cross-group edges read as detached).
          try {
            if (!sameTreeGroup(t, parentTab)) {
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

  // Group-agnostic children walk: same stored-link + workspace rules as
  // getTreeChildren, but IGNORING group state. Used only by strip-drag
  // family alignment, which must see the whole stored family (including
  // members stranded across group edges by the very drop being handled)
  // in order to regroup them. Everywhere else the filtered view applies.
  function getTreeChildrenAnyGroup(parentTab) {
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

  function getTreeDescendantsAnyGroup(parentTab) {
    const out = [];
    try {
      if (!parentTab) {
        return out;
      }
      const queue = getTreeChildrenAnyGroup(parentTab).slice();
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
          for (const kid of getTreeChildrenAnyGroup(cur)) {
            if (!seen.has(kid)) {
              queue.push(kid);
            }
          }
        } catch (e) {}
      }
    } catch (e) {}
    return out;
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
  // workspace, match the parent's group state (grouped parents adopt the
  // child via the stock join; ungrouped parents eject it — trees live
  // inside groups), cap depth at 2 (children of L2 become siblings under
  // the same L1), and place after the parent's last descendant. Returns
  // the child's level (0 when it stays a root).
  function attachTreeChild(child, opener) {
    try {
      if (!child || child.closing) {
        return 0;
      }
      // Restoring children own no tag yet — retagging to the opener's
      // workspace would scramble a WS3 restore into WS2. The restore
      // path keeps persisted links via healTreeLinks instead.
      try {
        if (typeof isRestoringTab === "function" && isRestoringTab(child)) {
          return 0;
        }
      } catch (e) {}
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
          // Already linked: still enforce the nesting invariant (a
          // legacy cross-group edge keeps its link here but reads as
          // Level 0 until healTreeLinks clears it).
          try {
            if (sameTreeGroup(child, parentTab)) {
              return getTreeLevel(child);
            }
          } catch (e) {
            return getTreeLevel(child);
          }
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
      // Nesting invariant, parent-ungrouped side: a grouped child joining
      // an ungrouped parent leaves its group first (eject, never retag).
      // The reverse direction (join) happens after placement below, since
      // stock joins append to the group end (position-then-join, mirroring
      // stock drag-and-drop.js: move to the drop index, then addTabs).
      try {
        if (!treeGroupOf(parentTab) && treeGroupOf(child)) {
          try {
            if (gBrowser && typeof gBrowser.ungroupTab === "function") {
              gBrowser.ungroupTab(child);
            }
          } catch (e) {}
        }
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
        setTreeParent(child, pid);
      } catch (e) {}
      // Nesting invariant, parent-grouped side: opener children inherit
      // the parent's group (birth path). Guarded: the synchronous TabMove
      // from the stock append must not re-derive (and detach) the tab.
      try {
        const pg = treeGroupOf(parentTab);
        if (pg && !sameTreeGroup(child, parentTab)) {
          joinTreeGroup(child, pg);
        }
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

  // Resolve the action target: explicit tab wins, otherwise the selected tab
  // (palette / keyboard path).
  function resolveTreeActionTab(tab) {
    try {
      if (tab && !tab.closing) {
        return tab;
      }
    } catch (e) {}
    try {
      const sel = gBrowser && gBrowser.selectedTab;
      if (sel && !sel.closing) {
        return sel;
      }
    } catch (e) {}
    return null;
  }

  // Manual repair: link opening sometimes lands without an opener, or an
  // external app opens a related tab that lands as an L0 root. Indent makes
  // the tab a child of the tab above it in strip order: the preceding
  // non-closing tab, then attachTreeChild(tab, prevTab). Same-workspace
  // and same-group-state only (indent never retags across workspaces and
  // never crosses native-group edges); pinned tabs and the first tab in
  // the strip cannot indent. The tab's own subtree block is carried along
  // so children are never stranded. Returns true on change.
  // Live multiselection (Ctrl+click), strip-order agnostic. Falls back to
  // [selectedTab] so palette/no-arg callers work with or without multi.
  function getTreeSelectedTabs() {
    try {
      const live = Array.from(gBrowser.tabs || []);
      const liveSet = new Set(live);
      try {
        const multi =
          (gBrowser && (gBrowser.selectedTabs || gBrowser.multiselectedTabs)) || null;
        if (Array.isArray(multi) && multi.length) {
          const filtered = multi.filter((t) => t && liveSet.has(t));
          if (filtered.length) {
            return filtered;
          }
        }
      } catch (e) {}
      try {
        const sel = gBrowser && gBrowser.selectedTab;
        if (sel && liveSet.has(sel)) {
          return [sel];
        }
      } catch (e) {}
    } catch (e) {}
    return [];
  }

  // Normalize action input: array passes through, single tab wraps to one,
  // null/undefined resolves to the live selection (multi when present).
  function resolveTreeActionTargets(input) {
    try {
      if (Array.isArray(input)) {
        return input.filter((t) => !!t);
      }
      if (input) {
        return [input];
      }
    } catch (e) {}
    try {
      const sel = getTreeSelectedTabs();
      if (sel.length) {
        return sel;
      }
    } catch (e) {}
    try {
      const single = resolveTreeActionTab(null);
      return single ? [single] : [];
    } catch (e) {
      return [];
    }
  }

  // True when any ancestor of `tab` is in `selSet` (multi-op ride-along:
  // descendants move with their selected ancestor via block carry / level
  // shift, so they must not be processed independently).
  function hasSelectedTreeAncestor(tab, selSet) {
    try {
      if (!tab || !selSet || selSet.size === 0) {
        return false;
      }
      let cur = null;
      try {
        cur = getTreeParentTab(tab);
      } catch (e) {
        return false;
      }
      let guard = 0;
      while (cur && guard++ < 8) {
        try {
          if (selSet.has(cur)) {
            return true;
          }
        } catch (e) {}
        try {
          cur = getTreeParentTab(cur);
        } catch (e) {
          break;
        }
      }
    } catch (e) {}
    return false;
  }

  // Preceding non-closing same-workspace, same-group-state candidate for
  // `target`. Indent never crosses native-group edges (trees live inside
  // groups — use drag or regroup first); it never retags workspaces
  // either. When `skipSet` is given, members are skipped so a contiguous
  // block indents as siblings under the same unselected parent instead of
  // staircasing.
  function findIndentPrev(target, ws, skipSet) {
    try {
      let tabs = [];
      try {
        tabs = Array.from(gBrowser.tabs || []);
      } catch (e) {
        return null;
      }
      const at = tabs.indexOf(target);
      if (at <= 0) {
        return null;
      }
      for (let i = at - 1; i >= 0; i--) {
        const cand = tabs[i];
        try {
          if (!cand || cand === target || cand.closing) {
            continue;
          }
          try {
            if (cand.pinned) {
              continue;
            }
          } catch (e) {}
          try {
            if (skipSet && skipSet.has(cand)) {
              continue;
            }
          } catch (e) {}
          try {
            if (getWs(cand) !== ws) {
              continue;
            }
          } catch (e) {
            continue;
          }
          try {
            if (!sameTreeGroup(cand, target)) {
              continue;
            }
          } catch (e) {
            continue;
          }
          // Cycle guard: never indent under one of our own descendants.
          let isDesc = false;
          try {
            let cur = cand;
            let guard = 0;
            while (cur && guard++ < 8) {
              if (cur === target) {
                isDesc = true;
                break;
              }
              try {
                cur = getTreeParentTab(cur);
              } catch (_e) {
                break;
              }
              if (!cur) {
                break;
              }
            }
          } catch (e) {}
          if (isDesc) {
            continue;
          }
          return cand;
        } catch (e) {}
      }
    } catch (e) {}
    return null;
  }

  // Single indent without render (caller batches). Returns true on change.
  function indentOneNoRender(target, skipSet) {
    try {
      if (!target || target.closing) {
        return false;
      }
      try {
        if (target.pinned) {
          return false;
        }
      } catch (e) {}
      let tabs = [];
      try {
        tabs = Array.from(gBrowser.tabs || []);
      } catch (e) {
        return false;
      }
      if (!tabs.includes(target)) {
        return false;
      }
      let ws = null;
      try {
        ws = getWs(target);
      } catch (e) {}
      if (!isValidId(ws)) {
        return false;
      }
      let parentBefore = null;
      try {
        parentBefore = getTreeParentTab(target);
      } catch (e) {}
      const prev = findIndentPrev(target, ws, skipSet || null);
      if (!prev) {
        return false;
      }
      try {
        if (getTreeParentTab(target) === prev) {
          return false;
        }
      } catch (e) {}
      // Snapshot the subtree block first: attachTreeChild moves only the
      // tab itself, so re-hang descendants after it to keep the block whole.
      let block = [];
      try {
        block = getTreeDescendants(target).slice();
      } catch (e) {
        block = [];
      }
      try {
        block.sort((a, b) => tabs.indexOf(a) - tabs.indexOf(b));
      } catch (e) {}
      attachTreeChild(target, prev);
      try {
        for (let i = 0; i < block.length; i++) {
          const d = block[i];
          try {
            if (!d || d.closing) {
              continue;
            }
            const live = Array.from(gBrowser.tabs || []);
            if (!live.includes(d)) {
              continue;
            }
            const base = live.indexOf(target);
            if (base === -1) {
              break;
            }
            moveTreeTabTo(d, base + 1 + i);
          } catch (e) {}
        }
      } catch (e) {}
      try {
        return getTreeParentTab(target) !== null && getTreeParentTab(target) !== parentBefore;
      } catch (e) {
        return false;
      }
    } catch (e) {
      return false;
    }
  }

  function indentTreeTargets(targets) {
    try {
      const list = (targets || []).filter((t) => !!t);
      if (!list.length) {
        return false;
      }
      let tabs = [];
      try {
        tabs = Array.from(gBrowser.tabs || []);
      } catch (e) {
        return false;
      }
      const order = new Map();
      try {
        tabs.forEach((t, i) => order.set(t, i));
      } catch (e) {}
      const sorted = list.slice().sort(
        (a, b) => (order.has(a) ? order.get(a) : 1e9) - (order.has(b) ? order.get(b) : 1e9)
      );
      const selSet = new Set(sorted);
      let changed = false;
      for (const target of sorted) {
        try {
          if (!target || target.closing) {
            continue;
          }
          try {
            if (target.pinned) {
              continue;
            }
          } catch (e) {}
          if (hasSelectedTreeAncestor(target, selSet)) {
            continue;
          }
          if (indentOneNoRender(target, selSet)) {
            changed = true;
          }
        } catch (e) {}
      }
      if (changed) {
        try {
          renderTree();
        } catch (e) {}
        try {
          applyTreeVisibility();
        } catch (e) {}
      }
      return changed;
    } catch (e) {
      return false;
    }
  }

  // Manual repair: link opening sometimes lands without an opener, or an
  // external app opens a related tab that lands as an L0 root. Indent makes
  // the tab a child of the tab above it in strip order: the preceding
  // non-closing tab, then attachTreeChild(tab, prevTab). Same-workspace
  // only (indent never retags across workspaces); pinned tabs and the
  // first tab in the strip cannot indent. The tab's own subtree block is
  // carried along so children are never stranded. Accepts a single tab,
  // an array (multiselection), or nothing (live selection). Returns true
  // when any tab changed.
  function indentTreeTab(tab) {
    try {
      if (Array.isArray(tab)) {
        if (tab.length === 1) {
          const single = resolveTreeActionTab(tab[0]);
          if (!single) {
            return false;
          }
          const ok = indentOneNoRender(single, null);
          if (ok) {
            try {
              renderTree();
            } catch (e) {}
            try {
              applyTreeVisibility();
            } catch (e) {}
          }
          return ok;
        }
        return indentTreeTargets(tab);
      }
      if (tab) {
        const target = resolveTreeActionTab(tab);
        if (!target) {
          return false;
        }
        const ok = indentOneNoRender(target, null);
        if (ok) {
          try {
            renderTree();
          } catch (e) {}
          try {
            applyTreeVisibility();
          } catch (e) {}
        }
        return ok;
      }
      const targets = resolveTreeActionTargets(null);
      if (targets.length === 1) {
        const ok = indentOneNoRender(targets[0], null);
        if (ok) {
          try {
            renderTree();
          } catch (e) {}
          try {
            applyTreeVisibility();
          } catch (e) {}
        }
        return ok;
      }
      return indentTreeTargets(targets);
    } catch (e) {
      return false;
    }
  }

  // Single outdent without render (caller batches). Returns true on change.
  function outdentOneNoRender(target) {
    try {
      if (!target || target.closing) {
        return false;
      }
      try {
        if (target.pinned) {
          return false;
        }
      } catch (e) {}
      let parent = null;
      try {
        parent = getTreeParentTab(target);
      } catch (e) {
        return false;
      }
      if (!parent) {
        return false;
      }
      let gp = null;
      try {
        gp = getTreeParentTab(parent);
      } catch (e) {
        gp = null;
      }
      try {
        if (gp) {
          let gid = null;
          try {
            gid = rawTreeId(gp);
          } catch (e) {}
          if (!gid) {
            return false;
          }
          try {
            if (rawTreeId(target) === gid) {
              return false;
            }
          } catch (e) {}
          setTreeParent(target, gid);
        } else {
          clearTreeParent(target);
        }
      } catch (e) {
        return false;
      }
      try {
        ensureTreeId(target);
      } catch (e) {}
      return true;
    } catch (e) {
      return false;
    }
  }

  function outdentTreeTargets(targets) {
    try {
      const list = (targets || []).filter((t) => !!t);
      if (!list.length) {
        return false;
      }
      let tabs = [];
      try {
        tabs = Array.from(gBrowser.tabs || []);
      } catch (e) {
        return false;
      }
      const order = new Map();
      try {
        tabs.forEach((t, i) => order.set(t, i));
      } catch (e) {}
      const sorted = list.slice().sort(
        (a, b) => (order.has(a) ? order.get(a) : 1e9) - (order.has(b) ? order.get(b) : 1e9)
      );
      const selSet = new Set(sorted);
      let changed = false;
      for (const target of sorted) {
        try {
          if (!target || target.closing) {
            continue;
          }
          try {
            if (target.pinned) {
              continue;
            }
          } catch (e) {}
          if (hasSelectedTreeAncestor(target, selSet)) {
            continue;
          }
          if (outdentOneNoRender(target)) {
            changed = true;
          }
        } catch (e) {}
      }
      if (changed) {
        try {
          renderTree();
        } catch (e) {}
        try {
          applyTreeVisibility();
        } catch (e) {}
      }
      return changed;
    } catch (e) {
      return false;
    }
  }

  // Manual repair counterpart: set the tab's parent to its grandparent
  // (L2→L1, or L1→L0). Already-L0 roots and pinned tabs are no-ops. The
  // tab keeps its strip position (in place), mirroring close-promotion and
  // drag-detach; descendants stay with it (levels shift automatically).
  // Accepts a single tab, an array (multiselection), or nothing (live
  // selection). Returns true when any tab changed.
  function outdentTreeTab(tab) {
    try {
      if (Array.isArray(tab)) {
        if (tab.length === 1) {
          const single = resolveTreeActionTab(tab[0]);
          if (!single) {
            return false;
          }
          const ok = outdentOneNoRender(single);
          if (ok) {
            try {
              renderTree();
            } catch (e) {}
            try {
              applyTreeVisibility();
            } catch (e) {}
          }
          return ok;
        }
        return outdentTreeTargets(tab);
      }
      if (tab) {
        const target = resolveTreeActionTab(tab);
        if (!target) {
          return false;
        }
        const ok = outdentOneNoRender(target);
        if (ok) {
          try {
            renderTree();
          } catch (e) {}
          try {
            applyTreeVisibility();
          } catch (e) {}
        }
        return ok;
      }
      const targets = resolveTreeActionTargets(null);
      if (targets.length === 1) {
        const ok = outdentOneNoRender(targets[0]);
        if (ok) {
          try {
            renderTree();
          } catch (e) {}
          try {
            applyTreeVisibility();
          } catch (e) {}
        }
        return ok;
      }
      return outdentTreeTargets(targets);
    } catch (e) {
      return false;
    }
  }

  // "Promote" is the historical name for outdent (parent → grandparent).
  function promoteTreeTab(tab) {
    try {
      return outdentTreeTab(tab);
    } catch (e) {
      return false;
    }
  }

  // One-shot snapshot for the Browser Console (Ctrl+Shift+J, parent
  // process): levels, injected rail counts, and whether aph-theme.css
  // is linked. Same house pattern as AphPinReset.debug() — silent in
  // prod, inspectable when visuals go missing.
  function debugTree() {
    try {
      const out = { current: null, theme: false, tabs: [] };
      try {
        out.current = isValidId(current) ? current : String(current);
      } catch (e) {}
      try {
        out.theme = !!(
          document &&
          typeof document.querySelector === "function" &&
          document.querySelector('link[href*="aph-theme"]')
        );
      } catch (e) {}
      let tabs = [];
      try {
        tabs = Array.from(gBrowser.tabs || []);
      } catch (e) {}
      for (const t of tabs) {
        try {
          let label = "";
          try {
            label = t.label || "";
          } catch (e) {}
          let level = 0;
          try {
            level = getTreeLevel(t);
          } catch (e) {}
          let rails = 0;
          try {
            if (t && typeof t.querySelectorAll === "function") {
              rails = t.querySelectorAll(":scope > .aph-tree-rail").length;
            } else if (t && typeof t.querySelector === "function") {
              rails =
                (t.querySelector(".aph-tree-rail--inner") ? 1 : 0) +
                (t.querySelector(".aph-tree-rail--outer") ? 1 : 0);
            }
          } catch (e) {}
          out.tabs.push({ label, level, rails });
        } catch (e) {}
      }
      return out;
    } catch (e) {
      return { error: "debug-threw" };
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
  // cross-workspace, cross-group, duplicate IDs). Cheap full pass on
  // init/restore.
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
          // Restore in flight for either end: workspace tags (and the
          // parent id itself) may not be applied yet. Clearing now would
          // destroy a valid persisted edge on a tag-default ("1") mirage.
          try {
            if (
              typeof isRestoringTab === "function" &&
              (isRestoringTab(t) || isRestoringTab(findTabByTreeId(pid)))
            ) {
              continue;
            }
          } catch (e) {}
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
                  // Tagless ends have no workspace yet (getWs defaults to
                  // "1") — never clear on that mirage; the SSTabRestored
                  // pass re-heals once extData lands.
                  let untagged = false;
                  try {
                    untagged = !rawWs(parent) || !rawWs(t);
                  } catch (_e) {}
                  if (!untagged) {
                    bad = true;
                  }
                }
              } catch (e) {}
              // Trees live inside groups: edges spanning group states
              // heal to Level 0 like cross-workspace edges.
              try {
                if (!bad && !sameTreeGroup(parent, t)) {
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
            // Never fight a collapsed native group: Firefox owns hiding
            // there (selected member stays visible via the early-continue
            // above). Unhiding here would pop collapsed-group tabs open
            // on every tree render/switch.
            try {
              if (t.group && t.group.collapsed) {
                continue;
              }
            } catch (e) {}
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
      // Last-viewed stamp first: nothing below may skip it.
      try {
        if (typeof stampLastViewed === "function") {
          stampLastViewed(tab);
        }
      } catch (err) {}
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
  // Fellow dragged tabs (multiselect strip drag) travel with `tab`, so
  // they are neither candidate parents nor settled block members when
  // computing spans. Without this, dragging [c1,c2] together lets each
  // sibling masquerade as the other's host block and detach/adopt wrong.
  function findEnclosingTreeParent(tab, skipSet) {
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
            if (skipSet && skipSet.has(cand)) {
              continue;
            }
          } catch (e) {}
          try {
            if (cand.pinned || getWs(cand) !== ws) {
              continue;
            }
          } catch (e) {
            continue;
          }
          // Drops never cross native-group edges (trees live inside
          // groups): a tab landing in another group state flattens to
          // Level 0 instead of adopting.
          try {
            if (!sameTreeGroup(cand, tab)) {
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
              try {
                if (skipSet && skipSet.has(d)) {
                  continue;
                }
              } catch (e) {}
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

  // Fellow dragged tabs for a strip move: the live multiselection, but
  // only when the moved tab belongs to it (stock drags a selected tab as
  // a block; dragging an unselected tab moves just it). Returns null for
  // single-tab moves so callers keep the fast path. Pinned tabs are kept
  // in the set for span-skipping even though tree logic ignores them.
  function getTreeDragSet(movedTab, liveTabs) {
    try {
      if (!movedTab) {
        return null;
      }
      const multi =
        (gBrowser && (gBrowser.selectedTabs || gBrowser.multiselectedTabs)) || null;
      if (!Array.isArray(multi) || multi.length < 2) {
        return null;
      }
      let includes = false;
      try {
        includes = multi.includes(movedTab);
      } catch (e) {
        includes = false;
      }
      if (!includes) {
        return null;
      }
      const liveSet = new Set(liveTabs || []);
      const out = new Set();
      for (const t of multi) {
        try {
          if (t && !t.closing && liveSet.has(t)) {
            out.add(t);
          }
        } catch (e) {}
      }
      return out.size > 1 ? out : null;
    } catch (e) {
      return null;
    }
  }

  // Strip moves can split or join native groups (tree carry pulls a tab
  // out of its group; a drop lands inside another). Tree code never
  // retags workspaces, so anchoring is a no-op for intact groups — but
  // headers go stale (empty/singleton groups, moved spans). Defer past
  // the settle like onGroupChange; idempotent so double-unify with a
  // TabGroupUpdate is harmless.
  function scheduleGroupSyncAfterStripMove(involved) {
    try {
      const groups = new Set();
      try {
        for (const t of involved || []) {
          try {
            if (t && t.group) {
              groups.add(t.group);
            }
          } catch (e) {}
        }
      } catch (e) {}
      const run = () => {
        try {
          for (const g of groups) {
            try {
              if (typeof unifyGroup === "function") {
                unifyGroup(g);
              }
            } catch (e) {}
          }
        } catch (e) {}
        try {
          if (typeof syncGroupHeaders === "function" && isValidId(current)) {
            syncGroupHeaders(current);
          }
        } catch (e) {}
      };
      try {
        setTimeout(run, 0);
      } catch (e) {
        run();
      }
    } catch (e) {}
  }

  // Manual drags: a moved parent carries its whole subtree block with it
  // (positions and group state — the family follows the parent across
  // native-group edges in both directions, so trees stay nested);
  // a child dropped outside its parent's block detaches to Level 0;
  // a child moved inside keeps its link (sibling reorder, level kept).
  // Multiselect: fellow selected tabs move as a block (ride-along
  // descendants skip independent handling; unselected descendants are
  // still carried; stock owns the drag set's own group joins).
  // Re-entrant: stock movers dispatch TabMove for our own carry moves, so
  // nested runs must be (and are) idempotent no-ops once placed. Depth
  // accounting is finally-guaranteed: early returns must never leak the
  // counter past the cap, or the top guard wedges the handler for good.
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
      // Programmatic group joins (attachTreeChild) dispatch TabMove
      // synchronously: the link is already exactly as desired, so never
      // re-derive it here (the group-end slot can sit past the parent
      // span when trailing non-family members exist).
      try {
        if (aphGroupOpGuard.has(tab)) {
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
      // Multiselect block: fellow selected tabs travel with the moved tab
      // (stock moves them together). Descendants inside the set ride along
      // via the strip move itself — they must not be carried again or
      // re-parented independently.
      let dragSet = null;
      try {
        dragSet = getTreeDragSet(tab, tabs);
      } catch (err) {
        dragSet = null;
      }
      try {
        if (dragSet && hasSelectedTreeAncestor(tab, dragSet)) {
          return;
        }
      } catch (err) {}
      // Whole stored family, group-agnostic: members stranded across a
      // group edge by this very drop must be visible here to be regrouped
      // (the filtered getTreeDescendants would hide them). Selected
      // descendants ride stock's own move (and stock joins the drag set
      // itself), so they are excluded from both carrying and alignment.
      let descendants = [];
      try {
        descendants = getTreeDescendantsAnyGroup(tab);
      } catch (err) {
        descendants = [];
      }
      if (dragSet) {
        try {
          descendants = descendants.filter((d) => d && !dragSet.has(d));
        } catch (err) {}
      }
      // Align the family's group state to the parent's post-drop state
      // (symmetric: joins on the way in, ejects on the way out). Guarded:
      // stock (un)grouping dispatches TabMove synchronously. Runs before
      // carrying so the block is positioned after membership settles.
      const alignFamilyGroups = () => {
        let pg = null;
        try {
          pg = treeGroupOf(tab);
        } catch (err) {
          pg = null;
        }
        for (const d of descendants) {
          try {
            if (!d || d.closing) {
              continue;
            }
            if (pg) {
              if (!sameTreeGroup(d, tab)) {
                joinTreeGroup(d, pg);
              }
            } else if (treeGroupOf(d)) {
              ejectTreeTabFromGroup(d);
            }
          } catch (err) {}
        }
      };
      if (descendants.length) {
        try {
          alignFamilyGroups();
        } catch (err) {}
        // Carry the whole block after the parent, preserving sibling
        // order. Sequential moves recompute the parent base each time so
        // end-of-strip drags stay exact.
        try {
          // Re-snapshot: alignment joins/ejects repositioned tabs, so the
          // branch-start order is stale for sibling sorting.
          try {
            tabs = Array.from(gBrowser.tabs || []);
          } catch (err) {}
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
        // Verify pass: carry moves shouldn't disturb membership (stock
        // in-group reorder proves the path), but converge anyway — a
        // mismatch here means the block scattered, and membership wins.
        try {
          alignFamilyGroups();
        } catch (err) {}
        try {
          renderTree();
        } catch (err) {}
        try {
          applyTreeVisibility();
        } catch (err) {}
        try {
          scheduleGroupSyncAfterStripMove(dragSet ? [tab, ...dragSet] : [tab, ...descendants]);
        } catch (err) {}
        return;
      }
      // Leaves: the drop position wins. Inside (or directly below) a
      // same-workspace block the tab joins that family — re-parenting
      // dragged children included — and keeps its exact drop spot;
      // anywhere else it flattens to Level 0.
      try {
        const host = findEnclosingTreeParent(tab, dragSet);
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
        try {
          scheduleGroupSyncAfterStripMove(dragSet ? [tab, ...dragSet] : [tab]);
        } catch (err) {}
      } catch (err) {}
    } catch (e) {
    } finally {
      // Guaranteed accounting: every early return above (unresolvable or
      // pinned tab, guarded programmatic move, ride-along descendant,
      // finished carry) must still balance the increment. A missed
      // decrement strands the counter above the re-entrancy cap and the
      // top guard then disables ALL drag handling permanently (it returns
      // before incrementing, so it can never count back down).
      try {
        treeMoveDepth = Math.max(0, treeMoveDepth - 1);
      } catch (err) {}
    }
  }

  // Chevron + count badge + indent rails injection (vertical strip only
  // via CSS; the elements stay hidden elsewhere). Idempotent: reuses
  // existing nodes, never double-binds listeners, no-ops on mock tabs
  // without DOM.
  function syncTreeRails(tab) {
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
      let level = 0;
      try {
        level = getTreeLevel(tab);
      } catch (e) {
        level = 0;
      }
      try {
        if (tab.pinned) {
          level = 0;
        }
      } catch (e) {}
      const wantInner = level >= 1;
      const wantOuter = level >= 2;
      const findRail = (cls) => {
        try {
          const scoped = tab.querySelector(":scope > ." + cls);
          if (scoped) {
            return scoped;
          }
        } catch (e) {}
        try {
          return tab.querySelector("." + cls);
        } catch (e) {
          return null;
        }
      };
      const ensureRail = (cls) => {
        let node = null;
        try {
          node = findRail(cls);
        } catch (e) {}
        if (node) {
          return node;
        }
        try {
          node =
            typeof document.createXULElement === "function"
              ? document.createXULElement("label")
              : document.createElement("span");
          node.className = "aph-tree-rail " + cls;
          if (typeof tab.appendChild === "function") {
            tab.appendChild(node);
          }
        } catch (e) {
          node = null;
        }
        return node;
      };
      const dropRail = (cls) => {
        let node = null;
        try {
          node = findRail(cls);
        } catch (e) {}
        if (!node) {
          return;
        }
        try {
          if (typeof node.remove === "function") {
            node.remove();
          } else if (node.parentNode) {
            node.parentNode.removeChild(node);
          }
        } catch (e) {}
      };
      if (wantInner) {
        ensureRail("aph-tree-rail--inner");
      } else {
        dropRail("aph-tree-rail--inner");
      }
      if (wantOuter) {
        ensureRail("aph-tree-rail--outer");
      } else {
        dropRail("aph-tree-rail--outer");
      }
    } catch (e) {}
  }

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
      // Rails anchor to the tab itself (margin gutter), independent of
      // the inner content structure the twisty needs below.
      try {
        syncTreeRails(tab);
      } catch (e) {}
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

  // Tab context menu: manual tree repair next to the stock items. Pinned
  // tabs are always Level 0 roots, so they get no tree entries. Otherwise
  // both actions always show (discoverable), disabled when not applicable:
  // indent needs a preceding same-workspace tab, outdent needs a parent.
  function treeClickedTab(e) {
    try {
      const popup = e && (e.currentTarget || e.target);
      const node = (popup && popup.triggerNode) || document.popupNode || null;
      if (node) {
        try {
          const direct =
            node.tab ||
            (typeof node.closest === "function" ? node.closest("tab") : null);
          if (direct) {
            return direct;
          }
        } catch (err) {}
      }
      if (gBrowser && gBrowser.selectedTab) {
        return gBrowser.selectedTab;
      }
    } catch (err) {}
    return null;
  }

  function canIndentTreeTab(tab) {
    try {
      if (!tab || tab.closing) {
        return false;
      }
      try {
        if (tab.pinned) {
          return false;
        }
      } catch (e) {}
      let tabs = [];
      try {
        tabs = Array.from(gBrowser.tabs || []);
      } catch (e) {
        return false;
      }
      const at = tabs.indexOf(tab);
      if (at <= 0) {
        return false;
      }
      let ws = null;
      try {
        ws = getWs(tab);
      } catch (e) {}
      if (!isValidId(ws)) {
        return false;
      }
      for (let i = at - 1; i >= 0; i--) {
        const cand = tabs[i];
        try {
          if (!cand || cand === tab || cand.closing) {
            continue;
          }
          try {
            if (cand.pinned) {
              continue;
            }
          } catch (e) {}
          try {
            if (getWs(cand) !== ws) {
              continue;
            }
          } catch (e) {
            continue;
          }
          // Trees live inside groups: indent needs a same-group
          // predecessor (mirrors findIndentPrev).
          try {
            if (!sameTreeGroup(cand, tab)) {
              continue;
            }
          } catch (e) {
            continue;
          }
          let isDesc = false;
          try {
            let cur = cand;
            let guard = 0;
            while (cur && guard++ < 8) {
              if (cur === tab) {
                isDesc = true;
                break;
              }
              try {
                cur = getTreeParentTab(cur);
              } catch (_e) {
                break;
              }
              if (!cur) {
                break;
              }
            }
          } catch (e) {}
          if (isDesc) {
            continue;
          }
          try {
            if (getTreeParentTab(tab) === cand) {
              return false;
            }
          } catch (e) {}
          return true;
        } catch (e) {}
      }
      return false;
    } catch (e) {
      return false;
    }
  }

  function canOutdentTreeTab(tab) {
    try {
      if (!tab || tab.closing) {
        return false;
      }
      try {
        if (tab.pinned) {
          return false;
        }
      } catch (e) {}
      try {
        return !!getTreeParentTab(tab);
      } catch (e) {
        return false;
      }
    } catch (e) {
      return false;
    }
  }

  function makeTreeMenuItem(id, label, action, disabled) {
    let item = null;
    try {
      item =
        typeof document.createXULElement === "function"
          ? document.createXULElement("menuitem")
          : document.createElement("menuitem");
      item.id = id;
      item.setAttribute("label", label);
      if (disabled) {
        try {
          item.setAttribute("disabled", "true");
        } catch (e) {}
      }
      if (typeof item.addEventListener === "function") {
        item.addEventListener("command", action);
      }
    } catch (err) {
      item = null;
    }
    return item;
  }

  let treeMenuItems = [];

  function clearTreeMenu() {
    try {
      for (const it of treeMenuItems) {
        try {
          if (it && it.parentNode) {
            it.parentNode.removeChild(it);
          } else if (it && typeof it.remove === "function") {
            it.remove();
          }
        } catch (err) {}
      }
    } catch (err) {}
    treeMenuItems = [];
  }

  // Menu targets: clicked tab wins; when it belongs to a multiselection
  // the whole selection goes (archive.js pattern). Null falls back to the
  // live selection so palette/no-arg callers share the same resolution.
  function resolveTreeMenuTargets(clicked) {
    try {
      if (clicked) {
        try {
          const sel = getTreeSelectedTabs();
          if (sel.length > 1) {
            try {
              if (sel.includes(clicked)) {
                return sel.filter((t) => t && !t.closing);
              }
            } catch (e) {}
          }
        } catch (e) {}
        return [clicked];
      }
    } catch (e) {}
    try {
      return getTreeSelectedTabs();
    } catch (e) {
      return [];
    }
  }

  function onTreeMenuShowing(e) {
    try {
      const menu = (e && (e.currentTarget || e.target)) || null;
      if (!menu || typeof menu.appendChild !== "function") {
        return;
      }
      clearTreeMenu();
      const clicked = treeClickedTab(e);
      if (!clicked) {
        return;
      }
      try {
        if (clicked.pinned) {
          return;
        }
      } catch (err) {}
      const targets = resolveTreeMenuTargets(clicked);
      if (!targets.length) {
        return;
      }
      let usable = [];
      try {
        usable = targets.filter((t) => {
          try {
            return t && !t.pinned;
          } catch (err) {
            return false;
          }
        });
      } catch (err) {
        usable = [];
      }
      if (!usable.length) {
        return;
      }
      const n = usable.length;
      const indent = makeTreeMenuItem(
        "aph-tree-indent",
        n > 1 ? `Indent ${n} Tabs` : "Indent Tab",
        () => {
          try {
            indentTreeTab(usable.length === 1 ? usable[0] : usable.slice());
          } catch (err) {}
        },
        !usable.some((t) => canIndentTreeTab(t))
      );
      if (indent) {
        try {
          menu.appendChild(indent);
          treeMenuItems.push(indent);
        } catch (err) {}
      }
      const outdent = makeTreeMenuItem(
        "aph-tree-outdent",
        n > 1 ? `Outdent ${n} Tabs` : "Outdent Tab",
        () => {
          try {
            outdentTreeTab(usable.length === 1 ? usable[0] : usable.slice());
          } catch (err) {}
        },
        !usable.some((t) => canOutdentTreeTab(t))
      );
      if (outdent) {
        try {
          menu.appendChild(outdent);
          treeMenuItems.push(outdent);
        } catch (err) {}
      }
    } catch (err) {}
  }

  function cleanupTreeMenu() {
    try {
      clearTreeMenu();
    } catch (e) {}
    try {
      const menu = document.getElementById("tabContextMenu");
      if (menu) {
        menu.removeEventListener("popupshowing", onTreeMenuShowing);
      }
    } catch (e) {}
  }

  function initTreeMenu() {
    try {
      const menu = document.getElementById("tabContextMenu");
      if (menu && typeof menu.addEventListener === "function") {
        menu.addEventListener("popupshowing", onTreeMenuShowing);
      }
    } catch (e) {}
    try {
      window.addEventListener("unload", cleanupTreeMenu, { once: true });
    } catch (e) {}
  }

  if (document.readyState === "complete") {
    initTreeMenu();
  } else {
    window.addEventListener("load", initTreeMenu, { once: true });
  }
