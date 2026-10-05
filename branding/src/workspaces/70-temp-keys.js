  // Disposable temp containers (Ctrl+Alt+T) — lifecycle:
  // tracked ids live in aph.tempContainers (JSON array pref: shared across
  // windows AND sessions). The old per-window-only set leaked on window
  // close, cross-window moves, and restarts — piling up duplicate "Tmp 1"s
  // when the emptied counter reset under a surviving identity. Creation
  // now skips taken names; reconcile sweeps (post-restore + window unload)
  // remove tracked ids with no live tabs plus untracked Tmp N orphans.
  const TEMP_IDS_PREF = "aph.tempContainers";
  const TEMP_NAME_PREFIX = "Tmp ";
  const TEMP_NAME_RE = /^Tmp \d+$/;

  function readTempIds() {
    try {
      const raw = Services.prefs.getStringPref(TEMP_IDS_PREF, "[]");
      const v = JSON.parse(raw);
      if (Array.isArray(v)) {
        return new Set(v.filter((n) => Number.isInteger(n) && n > 0));
      }
    } catch (e) {}
    return new Set();
  }

  function writeTempIds(set) {
    try {
      Services.prefs.setStringPref(TEMP_IDS_PREF, JSON.stringify([...set]));
    } catch (e) {}
  }

  function trackTempId(id) {
    try {
      tempContainers.add(id);
      const all = readTempIds();
      all.add(id);
      writeTempIds(all);
    } catch (e) {}
  }

  function untrackTempId(id) {
    try {
      tempContainers.delete(id);
      const all = readTempIds();
      if (all.delete(id)) {
        writeTempIds(all);
      }
    } catch (e) {}
  }

  // True for containers Aph created as disposable — local set first,
  // shared pref as fallback (covers ids born in another window/session).
  function isTempContainerId(id) {
    try {
      if (id && tempContainers.has(id)) {
        return true;
      }
    } catch (e) {}
    try {
      if (id && readTempIds().has(id)) {
        try {
          tempContainers.add(id);
        } catch (_e) {}
        return true;
      }
    } catch (e) {}
    return false;
  }

  function tempNameTaken(name) {
    try {
      if (IdentityService && typeof IdentityService.getPublicIdentities === "function") {
        for (const ident of Array.from(IdentityService.getPublicIdentities() || [])) {
          try {
            if (ident && ident.name === name) {
              return true;
            }
          } catch (_e) {}
        }
      }
    } catch (e) {}
    return false;
  }

  // Never reuse a live name: after a leak or a cross-window birth, "Tmp 1"
  // may already exist, so bump past every taken name (counter included).
  function nextTempName() {
    let n = tempCounter;
    try {
      while (tempNameTaken(`${TEMP_NAME_PREFIX}${n}`)) {
        n++;
      }
    } catch (e) {}
    tempCounter = n + 1;
    return `${TEMP_NAME_PREFIX}${n}`;
  }

  function initTempTracking() {
    try {
      for (const id of readTempIds()) {
        tempContainers.add(id);
      }
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
        focusUrlBar();
      } catch (e) {}
      return;
    }
    try {
      const identity = IdentityService.create(nextTempName(), "fingerprint", "purple");
      const tab = gBrowser.addTrustedTab(url, { userContextId: identity.userContextId });
      // insertAfterCurrent births tabs inside the selected tab's group — eject.
      try {
        gBrowser.ungroupTab(tab);
      } catch (e) {}
      trackTempId(identity.userContextId);
      setWs(tab, ws);
      aphShowTab(tab);
      gBrowser.selectedTab = tab;
      focusUrlBar();
    } catch (e) {}
  }

  // Live userContextIds across windows (null when blind — callers must
  // delete nothing then). excludeWindow skips a window whose tabs are
  // going away anyway (window unload).
  function liveTempUserIds(excludeWindow) {
    try {
      if (typeof Services === "undefined" || !Services.wm) {
        return null;
      }
      const live = new Set();
      const en = Services.wm.getEnumerator("navigator:browser");
      while (en.hasMoreElements()) {
        let w = null;
        try {
          w = en.getNext();
        } catch (_e) {}
        if (!w || w.closed || !w.gBrowser) {
          continue;
        }
        if (excludeWindow && w === excludeWindow) {
          continue;
        }
        let tabs = [];
        try {
          tabs = Array.from(w.gBrowser.tabs || []);
        } catch (_e) {}
        for (const t of tabs) {
          try {
            if (t && !t.closing && t.userContextId) {
              live.add(t.userContextId);
            }
          } catch (_e) {}
        }
      }
      return live;
    } catch (e) {
      return null;
    }
  }

  // Remove tracked temp containers with no live tabs. Fail-closed: when
  // the window list can't be enumerated, delete nothing. Returns count.
  function sweepTempContainers(excludeWindow) {
    let tracked;
    try {
      tracked = readTempIds();
    } catch (e) {
      return 0;
    }
    if (!tracked.size) {
      return 0;
    }
    const live = liveTempUserIds(excludeWindow);
    if (!live) {
      return 0;
    }
    let n = 0;
    for (const id of tracked) {
      if (live.has(id)) {
        continue;
      }
      try {
        if (IdentityService && typeof IdentityService.remove === "function") {
          IdentityService.remove(id);
        }
      } catch (e) {}
      untrackTempId(id);
      n++;
    }
    return n;
  }

  // Heal pre-fix accumulation: untracked "Tmp N" containers with no live
  // tabs (older builds leaked these on window close, moves, restarts).
  // Exact-pattern + empty only — a user's own non-empty container is never
  // touched even if named alike. Returns count.
  function sweepOrphanTempNames() {
    let idents = [];
    try {
      if (IdentityService && typeof IdentityService.getPublicIdentities === "function") {
        idents = Array.from(IdentityService.getPublicIdentities() || []);
      }
    } catch (e) {
      return 0;
    }
    if (!idents.length) {
      return 0;
    }
    let tracked;
    try {
      tracked = readTempIds();
    } catch (e) {
      tracked = new Set();
    }
    const live = liveTempUserIds(null);
    if (!live) {
      return 0;
    }
    let n = 0;
    for (const ident of idents) {
      let id = 0;
      let name = "";
      try {
        id = Number((ident && ident.userContextId) || 0) || 0;
        name = String((ident && ident.name) || "");
      } catch (e) {}
      if (!id || tracked.has(id) || live.has(id)) {
        continue;
      }
      if (!TEMP_NAME_RE.test(name)) {
        continue;
      }
      try {
        IdentityService.remove(id);
        n++;
      } catch (e) {}
    }
    return n;
  }

  function reconcileTempContainers() {
    try {
      sweepTempContainers(null);
    } catch (e) {}
    try {
      sweepOrphanTempNames();
    } catch (e) {}
  }

  // If a disposable container's last tab closed (any window), remove the
  // identity — remove() also wipes its cookies/storage/cache internally.
  // Deferred one tick so the closing tab settles out of the tab strip.
  function cleanupTempContainer(tab) {
    let id = null;
    try {
      id = tab.userContextId;
    } catch (e) {
      return;
    }
    if (!id || !IdentityService) {
      return;
    }
    if (!isTempContainerId(id)) {
      return;
    }
    setTimeout(() => {
      try {
        sweepTempContainers(null);
      } catch (e) {}
    }, 100);
  }

  // e.code, not e.key: Shift turns "1" into "!".
  function digitFromCode(code) {
    const m = code && code.match(/^(?:Digit|Numpad)([1-9])$/);
    return m ? m[1] : null;
  }

  // True while the command palette owns Alt+digit (its Nth-row quick-pick):
  // switching workspaces underneath it would double-fire. DOM-read per
  // press, so bundle load order never matters; absent overlay = closed.
  function paletteOpen() {
    try {
      const o =
        typeof document !== "undefined" && typeof document.getElementById === "function"
          ? document.getElementById("aph-palette-overlay")
          : null;
      return !!(o && !o.hidden);
    } catch (e) {
      return false;
    }
  }

  // True when the key event targets editable text (page inputs, urlbar).
  function isEditableTarget(t) {
    try {
      if (!t) {
        return false;
      }
      if (typeof t.closest === "function" && t.closest("input,textarea,select,[contenteditable]")) {
        return true;
      }
      const tn = String(t.tagName || t.localName || "").toLowerCase();
      if (tn === "input" || tn === "textarea" || tn === "select") {
        return true;
      }
      return t.isContentEditable === true;
    } catch (e) {
      return false;
    }
  }

  function onKey(e) {
    // Inline tab-rename editor owns its keystrokes: window capture fires
    // before the input's own handlers, so it cannot shield itself.
    try {
      if (e.target && e.target.id === "aph-tab-rename-input") {
        return;
      }
    } catch (err) {}
    if (e.repeat) {
      return;
    }
    // Windows international keyboards: AltGr arrives as Ctrl+Alt, so bare
    // modifier checks can't tell "AltGr+Q → @" (German) apart from a real
    // Ctrl+Alt hotkey. The OS flags genuine AltGr composition via the
    // AltGraph modifier state — when set, the user is typing a character,
    // never invoking a workspace hotkey (Ctrl+Alt+T/B/R/digits below).
    // Real Ctrl+Alt on layouts without AltGr reports AltGraph=false and is
    // unaffected. Guarded: getModifierState is absent in tests/contexts
    // without full KeyboardEvent support.
    try {
      if (typeof e.getModifierState === "function" && e.getModifierState("AltGraph")) {
        return;
      }
    } catch (err) {}
    // Ctrl/Cmd+W on a selected pinned or starred tab keeps it open
    // instead of closing — a drifted pin/star resets to its base URL in
    // place, one already at base parks (unload); the second press (now
    // pending), middle-click, and the context menu still close via stock.
    // Anything the parkers refuse (unpinned/unstarred, unsafe,
    // unparkable) falls through to stock close untouched.
    if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.code === "KeyW") {
      let parked = false;
      try {
        parked = parkSelectedPinnedTab().ok === true;
      } catch (err) {
        parked = false;
      }
      if (!parked) {
        try {
          parked =
            typeof parkSelectedStarredTab === "function" &&
            parkSelectedStarredTab().ok === true;
        } catch (err) {
          parked = false;
        }
      }
      if (parked) {
        e.preventDefault();
        e.stopPropagation();
      }
      return;
    }
    // Plain Ctrl+T opens in the workspace's bound container (if any).
    // Unbound workspaces fall through to stock Firefox behavior.
    if (e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey && e.code === "KeyT") {
      let bound = 0;
      try {
        bound = getWsContainerId(isValidId(current) ? current : "1");
      } catch (err) {}
      if (bound) {
        e.preventDefault();
        e.stopPropagation();
        try {
          openBoundTab();
        } catch (err) {}
      }
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
    // Ctrl+Alt+B binds the current workspace to the selected tab's
    // container (default tab = clear); Ctrl+Alt+Shift+B clears directly.
    if (e.ctrlKey && e.code === "KeyB") {
      e.preventDefault();
      e.stopPropagation();
      try {
        if (e.shiftKey) {
          clearWsBinding(isValidId(current) ? current : "1");
        } else {
          bindCurrentWsToSelectedTab();
        }
      } catch (err) {}
      return;
    }
    // Ctrl+Alt+F toggles focus mode (hide every chrome surface, page
    // only). Same bare shape as Ctrl+Alt+T above: no editable-target
    // skip (it types nothing in inputs), AltGraph guard above covers
    // real AltGr layouts.
    if (e.ctrlKey && !e.shiftKey && !e.metaKey && e.code === "KeyF") {
      e.preventDefault();
      e.stopPropagation();
      try {
        if (typeof toggleFocusMode === "function") {
          toggleFocusMode();
        }
      } catch (err) {}
      return;
    }
    // Ctrl+Alt+S toggles the star on the selected tab (starred tabs keep
    // a base URL: Ctrl+W resets drifted stars, parks at-base ones).
    // Skipped in editable text so typing stays safe.
    if (e.ctrlKey && e.altKey && !e.shiftKey && !e.metaKey && e.code === "KeyS") {
      if (isEditableTarget(e.target)) {
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      try {
        if (typeof toggleSelectedStar === "function") {
          toggleSelectedStar();
        } else if (window.AphStar && typeof window.AphStar.toggleSelectedStar === "function") {
          window.AphStar.toggleSelectedStar();
        }
      } catch (err) {}
      return;
    }
    // Ctrl+Alt+R quick-renames the current workspace via the palette.
    // Skipped in editable text so AltGr+R (®) keeps working while typing.
    if (e.ctrlKey && !e.shiftKey && e.code === "KeyR") {
      if (isEditableTarget(e.target)) {
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      try {
        if (window.AphPalette) {
          window.AphPalette.renameCurrent();
        }
      } catch (err) {}
      return;
    }
    // Ctrl+Alt+\ toggles the native dual split-view (Firefox 149+):
    // separate when the selected tab is split, else side-by-side with
    // the most-recently-viewed same-workspace tab (native tab picker
    // when there is no partner). The combo types nothing, so no
    // editable-target skip — the AltGraph guard above covers real
    // AltGr layouts (their key would report AltGraph=true).
    if (e.ctrlKey && e.altKey && !e.shiftKey && !e.metaKey && e.code === "Backslash") {
      e.preventDefault();
      e.stopPropagation();
      try {
        if (typeof splitToggle === "function") {
          splitToggle();
        }
      } catch (err) {}
      return;
    }
    // Alt+Shift cycling: brackets always, arrows outside editable text
    // (Alt+Shift+Left/Right selects words while typing), Tab toggles MRU.
    // e.code, not e.key: Shift turns "[" into "{".
    if (!e.ctrlKey && e.shiftKey && !e.metaKey) {
      if (e.code === "BracketRight") {
        e.preventDefault();
        e.stopPropagation();
        cycleWorkspace(1);
        return;
      }
      if (e.code === "BracketLeft") {
        e.preventDefault();
        e.stopPropagation();
        cycleWorkspace(-1);
        return;
      }
      if ((e.code === "ArrowRight" || e.code === "ArrowLeft") && !isEditableTarget(e.target)) {
        e.preventDefault();
        e.stopPropagation();
        cycleWorkspace(e.code === "ArrowRight" ? 1 : -1);
        return;
      }
      if (e.code === "Tab") {
        e.preventDefault();
        e.stopPropagation();
        toggleLastWorkspace();
        return;
      }
    }
    const d = digitFromCode(e.code);
    if (!d) {
      return;
    }
    if (e.ctrlKey) {
      // Ctrl+Alt+Shift+digit is unbound — fall
      // through to stock instead of preventing default.
      if (e.shiftKey) {
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      // Ctrl+Alt+digit moves the selection (preserving whole groups).
      try {
        sendTabTo(d);
      } catch (err) {}
    } else {
      // Alt+digit switches workspace (bare Alt, no Ctrl — Shift accepted
      // as a deprecated alias so old muscle memory keeps working).
      // Yields to the open palette, whose Alt+digit quick-picks rows.
      if (paletteOpen()) {
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      switchTo(d);
    }
  }

