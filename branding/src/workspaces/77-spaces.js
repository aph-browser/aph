  // Spaces: named folders holding tabs inside one workspace. One look for
  // every member: the box (hue wash + edges, stylesheet §27b) plus the
  // folder name on the head row. A tab inside a native group paints
  // exactly like a loose one, and native groups are never touched — no
  // attrs, no hue, no styling hooks on the group element: a Space and a
  // group are unrelated marks that can overlap. No collapse of its own,
  // no accent/atmosphere (the window voice stays per-workspace via
  // stampWindowWs; multiple spaces share the strip). Membership UI:
  // palette rows, the tab context menu (62-move-menu.js), and drag-to-join
  // on a folder head — where listener phase matters (see onSpaceDrop).
  //
  // Model: registry {spaceId: {ws, name}} persists in pref aph.spaces (same
  // JSON-string-pref idiom as names/icons/accents); membership rides a
  // per-tab SessionStore value aphSpace (same mechanism as workspace tags
  // and aphStarred, so it survives session restore free — key duplicated in
  // stash.js by design, aphStarred precedent). A group still resolves to
  // one space by plurality of its members' values (anchorGroup precedent
  // in 40) for menu/palette gating — but paint is strictly per-tab: stock
  // gives groups no stable id, and stash restores recreate group objects
  // from scratch, so no group-id dependency exists anywhere.
  //
  // Paint is attribute-only (no new DOM, no strip order assumptions):
  // every member tab paints data-aph-space-tab + data-aph-space + hue on
  // itself, loose or grouped alike; the head (earliest member row)
  // additionally carries name + first, and the last member carries the
  // bottom-air flag. Untagged tabs (and tabs whose folder belongs to
  // another workspace) never match and render exactly as before.
  // Cross-workspace sends keep the value (containers are immutable, tags
  // are cheap); paint is registry-ws-gated, so a moved group simply falls
  // out of its old folder until reassigned — same dormancy as pins.
  const SPACES_PREF = "aph.spaces";
  const SPACE_TAB_KEY = "aphSpace";
  const SPACE_NAME_MAX = 40;
  const SPACE_ID_RE = /^[A-Za-z0-9_-]{1,40}$/;
  let aphSpaces = null; // lazy-loaded {spaceId: {ws, name}}

  function loadSpaces() {
    if (aphSpaces) {
      return aphSpaces;
    }
    aphSpaces = Object.create(null);
    try {
      let raw = "";
      try {
        raw = Services.prefs.getStringPref(SPACES_PREF, "");
      } catch (e) {}
      if (raw) {
        const obj = JSON.parse(raw);
        for (const k of Object.keys(obj || {})) {
          try {
            const entry = obj[k] || {};
            const name = String(entry.name || "").trim().slice(0, SPACE_NAME_MAX);
            if (SPACE_ID_RE.test(k) && isValidId(entry.ws) && name) {
              aphSpaces[k] = { ws: entry.ws, name };
            }
          } catch (e) {}
        }
      }
    } catch (e) {}
    return aphSpaces;
  }

  function saveSpaces() {
    try {
      const plain = {};
      const map = loadSpaces();
      for (const k of Object.keys(map)) {
        plain[k] = { ws: map[k].ws, name: map[k].name };
      }
      Services.prefs.setStringPref(SPACES_PREF, JSON.stringify(plain));
    } catch (e) {}
  }

  // Palette command rows cache space membership per window (40-items
  // getCachedCommands). Palette-driven mutations invalidate themselves;
  // context-menu and drag-to-join paths land here, so every successful
  // membership change drops the cache through the public API (the two
  // bundles are separate scopes — window.AphPalette is the seam).
  function invalidateSpacePalette() {
    try {
      if (
        window.AphPalette &&
        typeof window.AphPalette.invalidate === "function"
      ) {
        window.AphPalette.invalidate();
      }
    } catch (e) {}
  }

  function getSpace(id) {
    try {
      const entry = loadSpaces()[id] || null;
      if (!entry) {
        return null;
      }
      return { ws: entry.ws, name: entry.name };
    } catch (e) {
      return null;
    }
  }

  // Every space, or only one workspace's, in registry (insertion) order.
  function listSpaces(wsArg) {
    const out = [];
    try {
      const map = loadSpaces();
      for (const k of Object.keys(map)) {
        try {
          if (wsArg && map[k].ws !== wsArg) {
            continue;
          }
          out.push({ id: k, ws: map[k].ws, name: map[k].name });
        } catch (e) {}
      }
    } catch (e) {}
    return out;
  }

  function makeSpaceId() {
    try {
      const map = loadSpaces();
      for (let attempt = 0; attempt < 8; attempt++) {
        const id =
          "sp" +
          Date.now().toString(36) +
          Math.floor(Math.random() * 0xffffff).toString(36);
        if (SPACE_ID_RE.test(id) && !Object.hasOwn(map, id)) {
          return id;
        }
      }
    } catch (e) {}
    return "";
  }

  // Returns the new id, or "" when the name/ws is unusable.
  function createSpace(name, wsArg) {
    const ws = isValidId(wsArg) ? wsArg : isValidId(current) ? current : "1";
    const trimmed = String(name || "").trim().slice(0, SPACE_NAME_MAX);
    if (!trimmed) {
      return "";
    }
    const id = makeSpaceId();
    if (!id) {
      return "";
    }
    try {
      loadSpaces()[id] = { ws, name: trimmed };
      saveSpaces();
    } catch (e) {
      return "";
    }
    return id;
  }

  function renameSpace(id, name) {
    try {
      const entry = loadSpaces()[id];
      if (!entry) {
        return false;
      }
      const trimmed = String(name || "").trim().slice(0, SPACE_NAME_MAX);
      if (!trimmed) {
        return false;
      }
      entry.name = trimmed;
      saveSpaces();
    } catch (e) {
      return false;
    }
    try {
      if (isValidId(current)) {
        syncSpaces(current);
      }
    } catch (e) {}
    return true;
  }

  // The folder goes, the groups stay (ungrouped visually, tabs untouched).
  function deleteSpace(id) {
    if (!id) {
      return false;
    }
    try {
      if (!Object.hasOwn(loadSpaces(), id)) {
        return false;
      }
      delete loadSpaces()[id];
      saveSpaces();
    } catch (e) {
      return false;
    }
    try {
      for (const t of Array.from((gBrowser && gBrowser.tabs) || [])) {
        try {
          if (t && !t.closing && rawSpace(t) === id) {
            clearSpace(t);
          }
        } catch (e) {}
      }
    } catch (e) {}
    try {
      if (isValidId(current)) {
        syncSpaces(current);
      }
    } catch (e) {}
    return true;
  }

  // Plausible membership value (registry-checked at paint, not here, so a
  // cross-window registry lag never disenfranchises a vote mid-restore).
  function rawSpace(tab) {
    try {
      const v = SessionStore.getCustomTabValue(tab, SPACE_TAB_KEY);
      return typeof v === "string" && SPACE_ID_RE.test(v) ? v : "";
    } catch (e) {
      return "";
    }
  }

  function setSpace(tab, id) {
    try {
      SessionStore.setCustomTabValue(tab, SPACE_TAB_KEY, id);
    } catch (e) {}
  }

  function clearSpace(tab) {
    try {
      if (!tab) {
        return;
      }
      if (SessionStore && typeof SessionStore.deleteCustomTabValue === "function") {
        SessionStore.deleteCustomTabValue(tab, SPACE_TAB_KEY);
      } else {
        SessionStore.setCustomTabValue(tab, SPACE_TAB_KEY, "");
      }
    } catch (e) {}
  }

  // A group resolves to at most one space: plurality of members' values,
  // ties to the earliest member in strip order. "" means unassigned (or
  // unknown ids). Paint is per-tab and never consults this — it exists
  // for menu/palette gating ("which folder is this group in").
  function spaceOfGroup(group) {
    try {
      const members = groupMembers(group).filter((t) => !t.pinned);
      if (!members.length) {
        return "";
      }
      const votes = Object.create(null);
      const firstIdx = Object.create(null);
      members.forEach((m, i) => {
        let s = "";
        try {
          s = rawSpace(m);
        } catch (e) {}
        if (!s) {
          return;
        }
        votes[s] = (votes[s] || 0) + 1;
        if (!(s in firstIdx)) {
          firstIdx[s] = i;
        }
      });
      let best = "";
      for (const s of Object.keys(votes)) {
        if (
          !best ||
          votes[s] > votes[best] ||
          (votes[s] === votes[best] && firstIdx[s] < firstIdx[best])
        ) {
          best = s;
        }
      }
      return best;
    } catch (e) {
      return "";
    }
  }

  // A group's workspace by the same plurality rule (anchorGroup precedent,
  // read-only here — healing stays in 40). "" while any member is
  // tagless/restoring, so assignGroupToSpace never writes a folder across
  // windows off a half-restored group's votes.
  function spaceGroupWs(group) {
    try {
      const members = groupMembers(group).filter((t) => !t.pinned);
      if (!members.length) {
        return "";
      }
      for (const m of members) {
        try {
          if (!rawWs(m)) {
            return "";
          }
          if (typeof isRestoringTab === "function" && isRestoringTab(m)) {
            return "";
          }
        } catch (e) {
          return "";
        }
      }
      const votes = Object.create(null);
      for (const m of members) {
        const w = rawWs(m);
        if (w) {
          votes[w] = (votes[w] || 0) + 1;
        }
      }
      let best = "";
      for (const w of Object.keys(votes).sort()) {
        if (!best || votes[w] > votes[best]) {
          best = w;
        }
      }
      return best;
    } catch (e) {
      return "";
    }
  }

  // Folder hue: stable per space id (polynomial hash mod 360) so a
  // folder keeps its color across restarts and windows. Painted as an
  // inline custom property — CSS attr() can't carry numbers into colors,
  // and hue utilities live above JS anyway. Insight: tabs' harness mocks
  // often lack .style; the guard makes hue painting best-effort there,
  // CSS falls back to its default (260).
  function spaceHue(sid) {
    try {
      let h = 0;
      for (let i = 0; i < String(sid).length; i++) {
        h = (h * 31 + String(sid).charCodeAt(i)) % 360;
      }
      return h;
    } catch (e) {
      return 260;
    }
  }

  function setSpaceHue(el, sid) {
    try {
      if (!el || !el.style || typeof el.style.setProperty !== "function") {
        return;
      }
      const h = String(spaceHue(sid));
      if (
        typeof el.style.getPropertyValue === "function" &&
        el.style.getPropertyValue("--aph-space-hue") === h
      ) {
        return;
      }
      el.style.setProperty("--aph-space-hue", h);
    } catch (e) {}
  }

  // Attribute writes are value-guarded: syncSpaces runs on every header
  // pass (group events, workspace switches, focus), and on a ~150-tab
  // strip the unconditional set/remove churn was the dominant cost —
  // most passes repaint the same values. Reads first, mutate only on
  // change; CSS only ever sees the settled state either way.
  function setSpaceAttr(el, k, v) {
    try {
      if (!el || typeof el.setAttribute !== "function") {
        return;
      }
      const sv = String(v);
      if (typeof el.getAttribute === "function" && el.getAttribute(k) === sv) {
        return;
      }
      el.setAttribute(k, sv);
    } catch (e) {}
  }

  function clearSpaceAttr(el, k) {
    try {
      if (!el || typeof el.removeAttribute !== "function") {
        return;
      }
      if (typeof el.getAttribute === "function" && el.getAttribute(k) === null) {
        return;
      }
      el.removeAttribute(k);
    } catch (e) {}
  }

  function clearSpaceHue(el) {
    try {
      if (el && el.style && typeof el.style.removeProperty === "function") {
        el.style.removeProperty("--aph-space-hue");
      }
    } catch (e) {}
  }

  // Membership paint lives on tab elements and, for the header, on the
  // group's label container; clearing wipes the full attr set. A still-
  // assigned member re-stamps idempotently right after in the same pass.
  function clearTabSpace(tab) {
    clearSpaceAttr(tab, "data-aph-space");
    clearSpaceAttr(tab, "data-aph-space-tab");
    clearSpaceAttr(tab, "data-aph-space-name");
    clearSpaceAttr(tab, "data-aph-space-first");
  }

  // Stamp folder attributes for one workspace's strip pass. Every member
  // tab paints on itself — loose or grouped is the same treatment, and
  // native tab groups are never touched (no attrs, no hue, no styling
  // hooks on the group element: a Space and a group are unrelated marks).
  // The header (name + first flag) goes to the earliest member row in
  // strip order.
  function stampSpaceHeader(el, sid, name) {
    setSpaceAttr(el, "data-aph-space", sid);
    setSpaceAttr(el, "data-aph-space-name", name);
    setSpaceAttr(el, "data-aph-space-first", "1");
    setSpaceHue(el, sid);
  }

  function syncSpaces(target) {
    try {
      if (!isValidId(target)) {
        return;
      }
      let tabs = [];
      try {
        tabs = Array.from(gBrowser.tabs);
      } catch (e) {
        return;
      }
      const seen = Object.create(null);
      const lastMemberBySpace = new Map(); // sid -> last painted member
      for (const t of tabs) {
        try {
          if (!t || t.closing) {
            continue;
          }
          const sid = rawSpace(t);
          const reg = sid ? getSpace(sid) : null;
          if (reg && reg.ws === target) {
            setSpaceAttr(t, "data-aph-space-tab", "1");
            setSpaceAttr(t, "data-aph-space", sid);
            setSpaceHue(t, sid);
            if (!seen[sid]) {
              seen[sid] = true;
              stampSpaceHeader(t, sid, reg.name);
            } else {
              clearSpaceAttr(t, "data-aph-space-first");
              clearSpaceAttr(t, "data-aph-space-name");
            }
            lastMemberBySpace.set(sid, t);
          } else {
            clearTabSpace(t);
          }
        } catch (e) {
          try {
            clearTabSpace(t);
          } catch (_e) {}
        }
      }
      // Last member per space gets the bottom spacer («air after the
      // folder»). The current holder keeps its flag untouched — clearing
      // first would be a remove + re-set pair every pass even when the
      // strip did not move. Only a displaced flag is cleared (a reorder
      // can move the last member mid-strip), then the holder is stamped.
      try {
        for (const t of tabs) {
          try {
            if (
              !t ||
              t.closing ||
              typeof t.getAttribute !== "function" ||
              t.getAttribute("data-aph-space-last") !== "1"
            ) {
              continue;
            }
            const sid = t.getAttribute("data-aph-space") || "";
            if (sid && lastMemberBySpace.get(sid) === t) {
              continue;
            }
            clearSpaceAttr(t, "data-aph-space-last");
          } catch (e) {}
        }
        for (const t of lastMemberBySpace.values()) {
          try {
            setSpaceAttr(t, "data-aph-space-last", "1");
          } catch (e) {}
        }
      } catch (e) {}
    } catch (e) {}
  }

  // Whole-group assignment: every live member carries the folder, so the
  // plurality vote survives member churn and session restore. Refuses
  // cross-workspace folders (paint would drop them anyway — fail loud at
  // the API instead of silently unpainted).
  function assignGroupToSpace(group, sid) {
    try {
      const reg = getSpace(sid);
      if (!reg) {
        return false;
      }
      const members = groupMembers(group).filter((t) => t && !t.closing);
      if (!members.length) {
        return false;
      }
      if (spaceGroupWs(group) && spaceGroupWs(group) !== reg.ws) {
        return false;
      }
      for (const m of members) {
        setSpace(m, sid);
      }
    } catch (e) {
      return false;
    }
    try {
      if (isValidId(current)) {
        syncSpaces(current);
      }
    } catch (e) {}
    invalidateSpacePalette();
    return true;
  }

  function unassignGroup(group) {
    let had = false;
    try {
      for (const m of groupMembers(group)) {
        try {
          if (m && !m.closing && rawSpace(m)) {
            had = true;
            clearSpace(m);
          }
        } catch (e) {}
      }
    } catch (e) {}
    try {
      if (isValidId(current)) {
        syncSpaces(current);
      }
    } catch (e) {}
    if (had) {
      invalidateSpacePalette();
    }
    return had;
  }

  // The tab's own membership value (not registry-checked): palette rows
  // gate "Remove … from Space" visibility on it, same raw read as
  // spaceOfGroup's votes.
  function getTabSpace(tab) {
    try {
      return rawSpace(tab) || "";
    } catch (e) {
      return "";
    }
  }

  // Single-tab assignment for loose members (spaces hold plain tabs): same
  // rules as the group path — cross-workspace folders refused (paint would
  // drop them anyway; fail loud at the API), pinned tabs refused (they are
  // global like stash targets), tagless/new tabs allowed (paint gates them
  // later). Grouped tabs accept too: the value is a member vote, and the
  // row paints like any other — same semantics as half-selecting a group.
  function assignTabToSpace(tab, sid) {
    try {
      const reg = getSpace(sid);
      if (!reg || !tab || tab.closing || tab.pinned) {
        return false;
      }
      const w = rawWs(tab);
      if (w && w !== reg.ws) {
        return false;
      }
      setSpace(tab, sid);
    } catch (e) {
      return false;
    }
    try {
      if (isValidId(current)) {
        syncSpaces(current);
      }
    } catch (e) {}
    invalidateSpacePalette();
    return true;
  }

  function unassignTabFromSpace(tab) {
    let had = false;
    try {
      if (tab && !tab.closing && rawSpace(tab)) {
        had = true;
        clearSpace(tab);
      }
    } catch (e) {
      return had;
    }
    try {
      if (isValidId(current)) {
        syncSpaces(current);
      }
    } catch (e) {}
    if (had) {
      invalidateSpacePalette();
    }
    return had;
  }

  // Drag-to-join (65-dock.js tracker precedent): the stock strip keeps its
  // own drop ride (move/reorder under the cursor); we ADD assignment —
  // dropping a dragged tab (or multiselection, or a dragged group header's
  // whole group) ON a folder HEAD joins that folder (user call: row drops
  // are reorder-only, so ordinary drags never surprise-join). Payload
  // tracking is pattern-copied from onDockDragStart/closest resolution;
  // data flavors are never parsed (a tracked null just means "not ours").
  //
  // Listener phase is load-bearing. Stock's drop handler (tabs.mjs ->
  // drag-and-drop.js handle_drop) sits on this same gBrowser.tabContainer
  // node, bubble phase, registered at element construction — before this
  // bundle. It computes _getDropIndex from LIVE getBoundingClientRect()
  // and moves tabs synchronously (or kicks an animated deferred move).
  // Our repaint changes layout (spacer borders, header line), so a CAPTURE
  // handler here would mutate the strip before stock measures it and the
  // dropped tab could land a row off from the indicator. Registering drop
  // WITHOUT capture puts us after stock on the same node (listener order =
  // registration order), i.e. after placement is decided. dragover stays
  // capture: the hover ring is box-shadow only, layout-neutral.
  let spaceDragTab = null;
  let spaceDragGroup = null;
  let spaceHoverEl = null;

  function resolveSpaceDragTabs() {
    try {
      if (spaceDragGroup) {
        let members = [];
        try {
          members =
            typeof groupMembers === "function"
              ? groupMembers(spaceDragGroup)
              : Array.from(spaceDragGroup.tabs || []);
        } catch (e) {
          members = [];
        }
        let live = [];
        try {
          live = Array.from((gBrowser && gBrowser.tabs) || []);
        } catch (e) {}
        const liveSet = new Set(live);
        try {
          members = members.filter((t) => t && !t.closing && liveSet.has(t));
        } catch (e) {}
        if (members.length) {
          return members;
        }
        // Stale group ref (closed mid-drag): fall through to tab logic.
      }
      if (!spaceDragTab || spaceDragTab.closing) {
        return [];
      }
      let live = [];
      try {
        live = Array.from((gBrowser && gBrowser.tabs) || []);
      } catch (e) {
        return [];
      }
      if (!live.includes(spaceDragTab)) {
        return [];
      }
      // Same multiselection rule as the dock (resolveDockDragTabs): a
      // dragged tab that is part of the live selection drags its peers.
      try {
        const multi = (gBrowser && (gBrowser.selectedTabs || gBrowser.multiselectedTabs)) || null;
        if (Array.isArray(multi) && multi.length > 1) {
          try {
            if (multi.includes(spaceDragTab)) {
              const liveSet = new Set(live);
              const filtered = multi.filter(
                (t) => t && !t.closing && liveSet.has(t)
              );
              if (filtered.length) {
                return filtered;
              }
            }
          } catch (e) {}
        }
      } catch (e) {}
      return [spaceDragTab];
    } catch (e) {
      return [];
    }
  }

  function clearSpaceHover() {
    try {
      if (spaceHoverEl && typeof spaceHoverEl.removeAttribute === "function") {
        spaceHoverEl.removeAttribute("data-aph-space-hover");
      }
    } catch (e) {}
    spaceHoverEl = null;
  }

  // Drop heads are the ONLY join targets: a dragged tab joins a folder by
  // dropping on that folder's head — its first member row. Everything
  // else (plain member rows, unowned tabs, strip gaps) is pure stock
  // reorder territory, so ordinary drags keep stock behavior untouched.
  // Returns [headEl, sid] or [null, ""].
  function spaceTargetUnderPointer(e) {
    try {
      const t = e && e.target;
      let tabEl = null;
      try {
        tabEl = t && typeof t.closest === "function" ? t.closest("tab") : null;
      } catch (err) {
        tabEl = null;
      }
      if (tabEl && tabEl.getAttribute) {
        const sid = tabEl.getAttribute("data-aph-space") || "";
        if (sid && tabEl.getAttribute("data-aph-space-first") === "1") {
          return [tabEl, sid];
        }
      }
    } catch (err) {}
    return [null, ""];
  }

  function onSpaceDragStart(e) {
    try {
      spaceDragTab = null;
      spaceDragGroup = null;
      const t = e && e.target;
      let tabEl = null;
      try {
        tabEl = t && typeof t.closest === "function" ? t.closest("tab") : null;
      } catch (e) {
        tabEl = null;
      }
      if (tabEl && !tabEl.closing) {
        spaceDragTab = tabEl;
        return;
      }
      let grpEl = null;
      try {
        grpEl = t && typeof t.closest === "function" ? t.closest("tab-group") : null;
      } catch (e) {
        grpEl = null;
      }
      if (grpEl) {
        spaceDragGroup = grpEl;
      }
    } catch (e) {}
  }

  function onSpaceDragOver(e) {
    // Tracked tab drags only: other drag sources (links, text) never paint.
    if (!spaceDragTab && !spaceDragGroup) {
      return;
    }
    try {
      const pair = spaceTargetUnderPointer(e);
      const el = pair[0];
      if (el !== spaceHoverEl) {
        clearSpaceHover();
        if (el) {
          try {
            el.setAttribute("data-aph-space-hover", "1");
          } catch (e) {}
          spaceHoverEl = el;
        }
      }
    } catch (e) {}
  }

  function onSpaceDrop(e) {
    let el = null;
    let sid = "";
    try {
      const pair = spaceTargetUnderPointer(e);
      el = pair[0];
      sid = pair[1];
    } catch (e) {}
    try {
      if (el && sid) {
        const tabs = resolveSpaceDragTabs();
        for (const t of tabs) {
          try {
            // Same-space drop is a plain strip reorder (stock handles it).
            if (rawSpace(t) === sid) {
              continue;
            }
            if (spaceDragGroup && t.group) {
              // Whole-group drag: every member joins (the folder keeps its
              // one-space rule via the plurality vote).
              assignGroupToSpace(assertGroup(t.group), sid);
              break;
            }
            assignTabToSpace(t, sid);
          } catch (err) {}
        }
      }
    } catch (e) {}
  }

  function assertGroup(g) {
    try {
      if (g && typeof g.tabs !== "undefined") {
        return g;
      }
    } catch (e) {}
    return null;
  }

  function onSpaceDragEnd() {
    try {
      clearSpaceHover();
    } catch (e) {}
    spaceDragTab = null;
    spaceDragGroup = null;
  }

  function cleanupSpaces() {
    try {
      clearSpaceHover();
    } catch (e) {}
    spaceDragTab = null;
    spaceDragGroup = null;
  }

  function initSpaces() {
    try {
      const tc = gBrowser && gBrowser.tabContainer;
      if (tc && typeof tc.addEventListener === "function") {
        try {
          tc.addEventListener("dragstart", onSpaceDragStart, true);
        } catch (e) {}
        try {
          tc.addEventListener("dragover", onSpaceDragOver, true);
        } catch (e) {}
        try {
          // Bubble phase on purpose: stock's drop handler is on this same
          // node and must decide the landing index before we repaint.
          tc.addEventListener("drop", onSpaceDrop, false);
        } catch (e) {}
        try {
          tc.addEventListener("dragleave", clearSpaceHover, true);
        } catch (e) {}
      }
      try {
        window.addEventListener("dragstart", onSpaceDragStart, true);
      } catch (e) {}
      try {
        window.addEventListener("dragend", onSpaceDragEnd);
      } catch (e) {}
      try {
        window.addEventListener("unload", cleanupSpaces, { once: true });
      } catch (e) {}
    } catch (e) {}
  }

  // Same eager/lazy shape as initDock(): chrome runs the bundle before
  // the document settles, so the strip listener may not exist yet.
  if (typeof document !== "undefined" && document.readyState === "complete") {
    initSpaces();
  } else {
    try {
      window.addEventListener("load", initSpaces, { once: true });
    } catch (e) {}
  }
