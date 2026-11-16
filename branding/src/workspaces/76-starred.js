  // Starred tabs: normal per-workspace tabs with an Essentials-style base
  // URL (captured at star time, editable). Right-click offers Star/Unstar
  // + "Reset to Starred Page" + "Set Starred Page…"; Ctrl/Cmd+W mirrors
  // pins (drifted resets in place, at-base parks via 50-unload.js).
  // State persists via SessionStore custom tab values (same mechanism as
  // workspace tags and 75-pinreset.js), so it survives session restore
  // free; `data-aph-starred="1"` is the CSS-only marker (theme.css).
  // Mutually exclusive with pins: starring a pinned tab is refused, and
  // pinning a starred tab unstars it (one base URL owns Ctrl+W).
  const STAR_FLAG_KEY = "aphStarred";
  const STAR_URL_KEY = "aphStarURL";
  const STAR_ATTR = "data-aph-starred";
  const STAR_FIRST_ATTR = "data-aph-starred-first";
  const STAR_LAST_ATTR = "data-aph-starred-last";
  const STAR_DRIFT_ATTR = "data-aph-starred-drift";
  // The tab close button shows a star instead of the X on starred tabs
  // (theme.css §18 swaps the glyph); activating it unstars (below).
  const STAR_CLOSE_SELECTOR = ".tab-close-button";
  const STAR_CLOSE_TIP = "Unstar tab";
  const STAR_DRIFT_TIP = "Starred tab (drifted · Ctrl+W to reset, click to unstar)";

  // Last failure code for Browser-Console diagnosis (AphStar.debug()).
  // House style stays silent in prod; this keeps the silence debuggable.
  let starLastError = "";

  function starNoteErr(code) {
    try {
      starLastError = code;
    } catch (err) {}
  }

  function isStarredTab(tab) {
    try {
      if (!tab) {
        return false;
      }
      let v = null;
      try {
        v = SessionStore.getCustomTabValue(tab, STAR_FLAG_KEY);
      } catch (e) {
        v = null;
      }
      if (v === "1") {
        return true;
      }
      if (v === "0" || v === "") {
        return false;
      }
      try {
        if (typeof tab.getAttribute === "function") {
          return tab.getAttribute(STAR_ATTR) === "1";
        }
      } catch (e) {}
      return false;
    } catch (e) {
      return false;
    }
  }

  function getStarURL(tab) {
    return getStoredURL(tab, STAR_URL_KEY);
  }

  // Returns true when stored. Invalid URLs are rejected (previous value
  // kept) so a typo in the edit dialog can never brick the reset target.
  function setStarURL(tab, url) {
    return setStoredURL(tab, STAR_URL_KEY, url, starNoteErr);
  }

  // Starred tabs without a stored value (flag restored, URL lost) fall
  // back to the live URL so reset/menu never dead-end on them.
  function effectiveStarURL(tab) {
    try {
      return getStarURL(tab) || tabSpec(tab);
    } catch (e) {
      return "";
    }
  }

  // Returns true when a starred tab has navigated away from its stored base URL.
  function isStarDrifted(tab) {
    try {
      if (!tab || !isStarredTab(tab) || tab.pinned) {
        return false;
      }
      const base = effectiveStarURL(tab);
      if (!base) {
        return false;
      }
      const cur = tabSpec(tab);
      if (!cur || cur === "about:blank") {
        return false;
      }
      if (cur === base) {
        return false;
      }
      const bNorm = base.endsWith("/") ? base.slice(0, -1) : base;
      const cNorm = cur.endsWith("/") ? cur.slice(0, -1) : cur;
      return bNorm !== cNorm;
    } catch (e) {
      return false;
    }
  }

  function applyStarAttribute(tab) {
    try {
      if (!tab) {
        return;
      }
      const on = isStarredTab(tab);
      const drifted = on && isStarDrifted(tab);
      try {
        if (on) {
          if (typeof tab.setAttribute === "function") {
            tab.setAttribute(STAR_ATTR, "1");
            if (drifted) {
              tab.setAttribute(STAR_DRIFT_ATTR, "1");
            } else if (typeof tab.removeAttribute === "function") {
              tab.removeAttribute(STAR_DRIFT_ATTR);
            }
          }
        } else if (typeof tab.removeAttribute === "function") {
          tab.removeAttribute(STAR_ATTR);
          tab.removeAttribute(STAR_DRIFT_ATTR);
          tab.removeAttribute(STAR_FIRST_ATTR);
          tab.removeAttribute(STAR_LAST_ATTR);
        }
      } catch (e) {}
    } catch (e) {}
  }

  function clearStar(tab) {
    try {
      if (!tab) {
        return;
      }
      try {
        if (SessionStore && typeof SessionStore.deleteCustomTabValue === "function") {
          SessionStore.deleteCustomTabValue(tab, STAR_FLAG_KEY);
          SessionStore.deleteCustomTabValue(tab, STAR_URL_KEY);
        } else {
          SessionStore.setCustomTabValue(tab, STAR_FLAG_KEY, "");
          SessionStore.setCustomTabValue(tab, STAR_URL_KEY, "");
        }
      } catch (e) {}
      try {
        if (typeof tab.removeAttribute === "function") {
          tab.removeAttribute(STAR_ATTR);
          tab.removeAttribute(STAR_DRIFT_ATTR);
          tab.removeAttribute(STAR_FIRST_ATTR);
          tab.removeAttribute(STAR_LAST_ATTR);
        }
      } catch (e) {}
      try {
        syncStarCloseTooltip(tab);
      } catch (e) {}
    } catch (e) {}
  }

  // Returns true when navigation was kicked off.
  function resetStarTab(tab) {
    try {
      if (!tab || !isStarredTab(tab)) {
        return false;
      }
      if (tab.pinned) {
        return false;
      }
      const url = effectiveStarURL(tab);
      if (!url) {
        try {
          starLastError = "no-url";
        } catch (err) {}
        return false;
      }
      const browser = tab.linkedBrowser;
      if (!browser) {
        try {
          starLastError = "no-browser";
        } catch (err) {}
        return false;
      }
      return loadBaseURL(browser, url, starNoteErr);
    } catch (e) {
      try {
        starLastError = "reset-threw";
      } catch (err) {}
      return false;
    }
  }

  // Star captures the live page as the default base URL (a custom value
  // wins — re-starring never clobbers an edited URL). Pinned tabs refuse:
  // pins own their own base URL via 75-pinreset.js.
  function starTab(tab) {
    try {
      if (!tab || tab.pinned) {
        return false;
      }
      try {
        SessionStore.setCustomTabValue(tab, STAR_FLAG_KEY, "1");
      } catch (e) {
        return false;
      }
      if (!getStarURL(tab)) {
        const spec = tabSpec(tab);
        if (spec) {
          try {
            SessionStore.setCustomTabValue(tab, STAR_URL_KEY, spec);
          } catch (e) {}
        }
      }
      applyStarAttribute(tab);
      try {
        syncStarCloseTooltip(tab);
      } catch (e) {}
      try {
        promoteStarredTab(tab);
      } catch (e) {}
      try {
        syncStarredBoundaries();
      } catch (e) {}
      return true;
    } catch (e) {
      return false;
    }
  }

  let starMovingTab = false;

  // Target index for a newly starred tab:
  // - If inside a native tab group: forced to the top of that group (before
  //   the first unstarred tab in that group).
  // - If ungrouped: forced to the top of the workspace (before the first
  //   unstarred tab or tab group in that workspace).
  // Guaranteed to only promote upwards towards the top, never downwards.
  function targetStarIndex(tab) {
    try {
      if (!gBrowser || !gBrowser.tabs || !tab) {
        return -1;
      }
      const allTabs = Array.from(gBrowser.tabs);
      const curIdx = allTabs.indexOf(tab);
      if (curIdx === -1) {
        return -1;
      }

      // Case 1: Inside a native tab group -> top of the group.
      if (tab.group) {
        const groupTabs = allTabs.filter((t) => t.group === tab.group && !t.closing);
        if (groupTabs.length <= 1) {
          return curIdx;
        }
        // First member of the group that is not starred (excluding tab).
        const boundary = groupTabs.find((t) => t !== tab && !isStarredTab(t));
        if (!boundary) {
          return curIdx;
        }
        const targetIdx = allTabs.indexOf(boundary);
        return targetIdx !== -1 && curIdx > targetIdx ? targetIdx : curIdx;
      }

      // Case 2: Ungrouped workspace tab -> top of the workspace.
      const ws = typeof getWs === "function" ? getWs(tab) : "1";
      const wsTabs = allTabs.filter(
        (t) =>
          !t.closing &&
          !t.pinned &&
          (typeof getWs === "function" ? getWs(t) : "1") === ws
      );
      if (wsTabs.length <= 1) {
        return curIdx;
      }

      // First tab in workspace that is NOT an ungrouped star (excluding tab itself).
      // This is either the first unstarred tab or the first tab belonging to a group.
      const boundary = wsTabs.find((t) => t !== tab && (!isStarredTab(t) || t.group));
      if (!boundary) {
        return curIdx;
      }

      const boundaryIdx = allTabs.indexOf(boundary);
      if (boundaryIdx === -1) {
        return curIdx;
      }

      const numPinned =
        typeof gBrowser._numPinnedTabs === "number"
          ? gBrowser._numPinnedTabs
          : allTabs.filter((t) => t.pinned).length;

      const targetIdx = Math.max(numPinned, boundaryIdx);
      return curIdx > targetIdx ? targetIdx : curIdx;
    } catch (e) {
      return -1;
    }
  }

  function promoteStarredTab(tab) {
    try {
      if (!tab || tab.pinned || tab.closing) {
        return false;
      }
      if (!gBrowser || typeof gBrowser.moveTabTo !== "function") {
        return false;
      }
      const curIdx = Array.from(gBrowser.tabs || []).indexOf(tab);
      const targetIdx = targetStarIndex(tab);
      if (targetIdx === -1 || curIdx <= targetIdx) {
        return false;
      }

      if (tab.group && Array.isArray(tab.group.tabs)) {
        try {
          const gi = tab.group.tabs.indexOf(tab);
          if (gi !== -1) {
            tab.group.tabs.splice(gi, 1);
            const boundaryGroup = tab.group.tabs.find((t) => !isStarredTab(t));
            const targetGroupIdx = boundaryGroup
              ? tab.group.tabs.indexOf(boundaryGroup)
              : tab.group.tabs.length;
            tab.group.tabs.splice(targetGroupIdx, 0, tab);
          }
        } catch (err) {}
      }

      const opts = { tabIndex: targetIdx };
      if (!tab.group) {
        opts.forceUngrouped = true;
      }

      try {
        starMovingTab = true;
        gBrowser.moveTabTo(tab, opts);
      } catch (e) {
        try {
          gBrowser.moveTabTo(tab, targetIdx);
        } catch (err) {}
      } finally {
        starMovingTab = false;
      }

      try {
        syncStarredBoundaries();
      } catch (err) {}
      return true;
    } catch (e) {
      return false;
    }
  }

  // When an existing starred tab is unstarred, keep it in place.
  // We do not auto-demote tabs on unstar.
  function demoteUnstarredTab(tab) {
    try {
      syncStarredBoundaries();
      return true;
    } catch (e) {
      return false;
    }
  }

  // Enforces Invariant 4: New tabs strictly spawn below the starred zone.
  function ensureTabBelowStarred(tab) {
    try {
      if (!tab || tab.pinned || tab.closing) {
        return false;
      }
      if (isStarredTab(tab)) {
        return false;
      }
      if (!gBrowser || typeof gBrowser.moveTabTo !== "function") {
        return false;
      }
      const allTabs = Array.from(gBrowser.tabs || []);
      const curIdx = allTabs.indexOf(tab);
      if (curIdx === -1) {
        return false;
      }

      // Case 1: In a tab group
      if (tab.group) {
        const groupTabs = allTabs.filter((t) => t.group === tab.group && !t.closing);
        const groupStars = groupTabs.filter((t) => isStarredTab(t));
        if (!groupStars.length) {
          return false;
        }
        const lastStar = groupStars[groupStars.length - 1];
        const lastStarIdx = allTabs.indexOf(lastStar);
        if (lastStarIdx !== -1 && curIdx <= lastStarIdx) {
          if (Array.isArray(tab.group.tabs)) {
            try {
              const gi = tab.group.tabs.indexOf(tab);
              if (gi !== -1) {
                tab.group.tabs.splice(gi, 1);
                const lastStarGroupIdx = tab.group.tabs.indexOf(lastStar);
                tab.group.tabs.splice(lastStarGroupIdx + 1, 0, tab);
              }
            } catch (err) {}
          }
          try {
            starMovingTab = true;
            gBrowser.moveTabTo(tab, { tabIndex: lastStarIdx });
          } catch (e) {
            try { gBrowser.moveTabTo(tab, lastStarIdx); } catch (err) {}
          } finally {
            starMovingTab = false;
          }
          try {
            syncStarredBoundaries();
          } catch (err) {}
          return true;
        }
        return false;
      }

      // Case 2: Ungrouped tab
      const ws = typeof getWs === "function" ? getWs(tab) : "1";
      const wsTabs = allTabs.filter(
        (t) =>
          !t.closing &&
          !t.pinned &&
          (typeof getWs === "function" ? getWs(t) : "1") === ws
      );
      const wsStars = wsTabs.filter((t) => !t.group && isStarredTab(t));
      if (!wsStars.length) {
        return false;
      }
      const lastStar = wsStars[wsStars.length - 1];
      const lastStarIdx = allTabs.indexOf(lastStar);
      if (lastStarIdx !== -1 && curIdx <= lastStarIdx) {
        try {
          starMovingTab = true;
          gBrowser.moveTabTo(tab, { tabIndex: lastStarIdx, forceUngrouped: true });
        } catch (e) {
          try { gBrowser.moveTabTo(tab, lastStarIdx); } catch (err) {}
        } finally {
          starMovingTab = false;
        }
        return true;
      }
      return false;
    } catch (e) {
      return false;
    }
  }

  // Handle tab movements: Auto-star when dropped into a starred zone,
  // auto-unstar when dropped below it into regular stream tabs (Arc/Zen model).
  function handleTabMoveZone(tab) {
    try {
      if (!tab || tab.pinned || tab.closing || !gBrowser || !gBrowser.tabs) {
        return;
      }
      const allTabs = Array.from(gBrowser.tabs);
      const curIdx = allTabs.indexOf(tab);
      if (curIdx === -1) {
        return;
      }

      // Case 1: Inside a native tab group
      if (tab.group) {
        const groupTabs = allTabs.filter(
          (t) => t.group === tab.group && !t.closing && !t.pinned
        );
        const otherStars = groupTabs.filter((t) => t !== tab && isStarredTab(t));
        const otherUnstars = groupTabs.filter((t) => t !== tab && !isStarredTab(t));

        if (!isStarredTab(tab)) {
          if (otherStars.length > 0) {
            const lastStar = otherStars[otherStars.length - 1];
            if (curIdx <= allTabs.indexOf(lastStar)) {
              starTab(tab);
            }
          }
        } else if (otherUnstars.length > 0) {
          const firstUnstar = otherUnstars[0];
          if (curIdx >= allTabs.indexOf(firstUnstar)) {
            unstarTab(tab);
          }
        }
        return;
      }

      // Case 2: Ungrouped workspace tab
      const ws = typeof getWs === "function" ? getWs(tab) : "1";
      const allWsTabs = allTabs.filter(
        (t) =>
          !t.closing &&
          !t.pinned &&
          (typeof getWs === "function" ? getWs(t) : "1") === ws
      );
      const otherStars = allWsTabs.filter(
        (t) => t !== tab && !t.group && isStarredTab(t)
      );
      const otherNonStars = allWsTabs.filter(
        (t) => t !== tab && (t.group || !isStarredTab(t))
      );

      if (!isStarredTab(tab)) {
        if (otherStars.length > 0) {
          const lastStar = otherStars[otherStars.length - 1];
          if (curIdx <= allTabs.indexOf(lastStar)) {
            starTab(tab);
          }
        }
      } else if (otherNonStars.length > 0) {
        const firstNonStar = otherNonStars[0];
        if (curIdx >= allTabs.indexOf(firstNonStar)) {
          unstarTab(tab);
        }
      }
    } catch (err) {}
  }

  // Stamping data-aph-starred-last="1" on the final starred tab in each
  // contiguous starred zone (both ungrouped workspace stars and group stars).
  // Theme rules use this marker to paint a subtle hairline divider separating
  // the starred essentials from unstarred stream tabs.
  function syncStarredBoundaries() {
    try {
      if (!gBrowser || !gBrowser.tabs) {
        return;
      }
      const allTabs = Array.from(gBrowser.tabs);

      const wsTabsMap = new Map();
      const groupTabsMap = new Map();

      for (const t of allTabs) {
        if (!t || t.closing || t.pinned) {
          try {
            if (t && typeof t.removeAttribute === "function") {
              t.removeAttribute(STAR_FIRST_ATTR);
              t.removeAttribute(STAR_LAST_ATTR);
            }
          } catch (_e) {}
          continue;
        }

        if (t.group) {
          if (!groupTabsMap.has(t.group)) {
            groupTabsMap.set(t.group, []);
          }
          groupTabsMap.get(t.group).push(t);
        } else {
          const ws = typeof getWs === "function" ? getWs(t) : "1";
          if (!wsTabsMap.has(ws)) {
            wsTabsMap.set(ws, []);
          }
          wsTabsMap.get(ws).push(t);
        }
      }

      for (const [, tabs] of wsTabsMap) {
        const stars = tabs.filter((t) => isStarredTab(t));
        const firstStar = stars.length ? stars[0] : null;
        const lastStar = stars.length ? stars[stars.length - 1] : null;
        for (const t of tabs) {
          try {
            if (t === firstStar) {
              if (typeof t.setAttribute === "function") {
                t.setAttribute(STAR_FIRST_ATTR, "1");
              }
            } else if (typeof t.removeAttribute === "function") {
              t.removeAttribute(STAR_FIRST_ATTR);
            }
            if (t === lastStar) {
              if (typeof t.setAttribute === "function") {
                t.setAttribute(STAR_LAST_ATTR, "1");
              }
            } else if (typeof t.removeAttribute === "function") {
              t.removeAttribute(STAR_LAST_ATTR);
            }
          } catch (_e) {}
        }
      }

      for (const [, tabs] of groupTabsMap) {
        const stars = tabs.filter((t) => isStarredTab(t));
        const firstStar = stars.length ? stars[0] : null;
        const lastStar = stars.length ? stars[stars.length - 1] : null;
        for (const t of tabs) {
          try {
            if (t === firstStar) {
              if (typeof t.setAttribute === "function") {
                t.setAttribute(STAR_FIRST_ATTR, "1");
              }
            } else if (typeof t.removeAttribute === "function") {
              t.removeAttribute(STAR_FIRST_ATTR);
            }
            if (t === lastStar) {
              if (typeof t.setAttribute === "function") {
                t.setAttribute(STAR_LAST_ATTR, "1");
              }
            } else if (typeof t.removeAttribute === "function") {
              t.removeAttribute(STAR_LAST_ATTR);
            }
          } catch (_e) {}
        }
      }
    } catch (e) {}
  }

  function onStarTabMove(e) {
    if (starMovingTab) {
      return;
    }
    const tab = e && e.target;
    if (tab) {
      try {
        starMovingTab = true;
        handleTabMoveZone(tab);
      } finally {
        starMovingTab = false;
      }
    }
    try {
      syncStarredBoundaries();
    } catch (err) {}
  }

  function unstarTab(tab) {
    try {
      if (!tab || !isStarredTab(tab)) {
        return false;
      }
      clearStar(tab);
      try {
        syncStarredBoundaries();
      } catch (e) {}
      return true;
    } catch (e) {
      return false;
    }
  }

  function toggleStarTab(tab) {
    try {
      if (!tab) {
        return false;
      }
      if (isStarredTab(tab)) {
        return unstarTab(tab);
      }
      return starTab(tab);
    } catch (e) {
      return false;
    }
  }

  function toggleSelectedStar() {
    try {
      if (gBrowser && gBrowser.selectedTab) {
        return toggleStarTab(gBrowser.selectedTab);
      }
    } catch (e) {}
    return false;
  }

  // Pinning wins: a pinned tab keeps the pin base URL only.
  function onStarTabPinned(e) {
    let tab = null;
    try {
      tab = e && e.target;
    } catch (err) {}
    try {
      if (tab && tab.pinned && isStarredTab(tab)) {
        clearStar(tab);
      }
    } catch (err) {}
  }

  // Restored tabs keep SessionStore values; re-apply the CSS marker.
  function onStarTabRestored(e) {
    let tab = null;
    try {
      tab = e && e.target;
    } catch (err) {}
    if (!tab) {
      return;
    }
    try {
      syncStarTabChrome(tab);
    } catch (err) {}
  }

  // Resolve the right-clicked tab (shared resolver: triggerNode may
  // carry the tab directly (.tab) or contain it; falls back to selected).
  let starMenuItems = [];

  function clearStarMenu() {
    starMenuItems = takeDownMenuItems(starMenuItems);
  }

  function promptStarURL(tab, initial) {
    promptBaseURL(
      tab,
      initial,
      "Set Starred Page — Enter saves, Esc cancels",
      "Set Starred Page URL:",
      setStarURL
    );
  }

  function onStarMenuShowing(e) {
    try {
      const menu = (e && (e.currentTarget || e.target)) || null;
      if (!menu || typeof menu.appendChild !== "function") {
        return;
      }
      clearStarMenu();
      const tab = contextClickedTab(e);
      if (!tab || tab.pinned) {
        return;
      }
      const starred = isStarredTab(tab);
      const toggle = makeDockMenuItem(
        "aph-star-toggle",
        starred ? "Unstar Tab" : "Star Tab",
        () => {
          try {
            toggleStarTab(tab);
          } catch (err) {}
        }
      );
      if (toggle) {
        try {
          menu.appendChild(toggle);
          starMenuItems.push(toggle);
        } catch (err) {}
      }
      if (!starred) {
        return;
      }
      const stored = effectiveStarURL(tab);
      const reset = makeDockMenuItem("aph-star-reset", "Reset to Starred Page", () => {
        try {
          resetStarTab(tab);
        } catch (err) {}
      });
      if (reset) {
        // Grey out when already there — nothing to do.
        try {
          if (stored && stored === tabSpec(tab)) {
            reset.setAttribute("disabled", "true");
          }
        } catch (err) {}
        try {
          menu.appendChild(reset);
          starMenuItems.push(reset);
        } catch (err) {}
      }
      const edit = makeDockMenuItem("aph-star-set", "Set Starred Page…", () => {
        try {
          // Live-first: Enter alone re-stars the current page (the common
          // "make this the base" case); stored is the fallback.
          promptStarURL(tab, tabSpec(tab) || stored);
        } catch (err) {}
      });
      if (edit) {
        try {
          menu.appendChild(edit);
          starMenuItems.push(edit);
        } catch (err) {}
      }
    } catch (err) {}
  }

  function closeButtonOf(tab) {
    try {
      if (tab && typeof tab.querySelector === "function") {
        return tab.querySelector(STAR_CLOSE_SELECTOR);
      }
    } catch (err) {}
    return null;
  }

  // Best-effort tooltip: the star button unstars, so "Close tab" would
  // lie. Stock may overwrite it on hover; the glyph (theme.css §18)
  // remains the source of truth.
  function syncStarCloseTooltip(tab) {
    let btn = null;
    try {
      btn = closeButtonOf(tab);
    } catch (err) {}
    if (!btn) {
      return;
    }
    try {
      if (isStarredTab(tab) && !(tab && tab.pinned)) {
        if (typeof btn.setAttribute === "function") {
          btn.setAttribute(
            "tooltiptext",
            isStarDrifted(tab) ? STAR_DRIFT_TIP : STAR_CLOSE_TIP
          );
        }
      } else if (typeof btn.removeAttribute === "function") {
        btn.removeAttribute("tooltiptext");
      }
    } catch (err) {}
  }

  // Central per-tab star sync (the visual half of syncTabChrome in
  // 30-names-tags.js): marker + close tooltip always reflect state,
  // setting or removing as needed.
  function syncStarTabChrome(tab) {
    try {
      applyStarAttribute(tab);
    } catch (err) {}
    try {
      syncStarCloseTooltip(tab);
    } catch (err) {}
  }

  // Owner tab when the event targets a starred tab's close (star)
  // button; null otherwise. Pinned tabs are excluded — pins own X.
  function starCloseOwner(e) {
    try {
      const t = e && e.target;
      const btn =
        t && typeof t.closest === "function" ? t.closest(STAR_CLOSE_SELECTOR) : null;
      if (!btn) {
        return null;
      }
      const tab =
        typeof btn.closest === "function" ? btn.closest("tab") : null;
      if (tab && !tab.pinned && isStarredTab(tab)) {
        return tab;
      }
    } catch (err) {}
    return null;
  }

  // The star button unstars instead of closing. Capture on the tab
  // container (ancestor — fires before the button's own stock handler),
  // so the swallowed activation can never leak through to a close.
  // Listens to both `click` (mouse/touch) and `command` (keyboard
  // activation via Space/Enter on a focused button, which bypasses
  // click). mousedown is deliberately untouched (no stock close acts
  // on it; selection side effects are harmless).
  function onStarCloseEvent(e) {
    let tab = null;
    try {
      tab = starCloseOwner(e);
    } catch (err) {}
    if (!tab) {
      return;
    }
    try {
      if (e) {
        if (typeof e.preventDefault === "function") {
          e.preventDefault();
        }
        if (typeof e.stopPropagation === "function") {
          e.stopPropagation();
        }
      }
    } catch (err) {}
    try {
      unstarTab(tab);
    } catch (err) {}
  }

  function syncAllStarAttributes() {
    try {
      if (!gBrowser || !gBrowser.tabs) {
        return;
      }
      for (const t of gBrowser.tabs) {
        try {
          // Single spelling for the per-tab sync (same outcome as the
          // inline version: the attribute backstop in isStarredTab keeps
          // a marker that SessionStore hasn't contradicted yet).
          syncStarTabChrome(t);
        } catch (e) {}
      }
      try {
        syncStarredBoundaries();
      } catch (e) {}
    } catch (e) {}
  }

  function onStarTabAttrModified(e) {
    try {
      const tab = e && e.target;
      if (tab && isStarredTab(tab)) {
        syncStarTabChrome(tab);
      }
    } catch (err) {}
  }

  function onStarTabSelect(e) {
    try {
      const tab = e && e.target;
      if (tab && isStarredTab(tab)) {
        syncStarTabChrome(tab);
      }
    } catch (err) {}
  }

  const starProgressListener = {
    onLocationChange(browser, webProgress, request, locationURI, flags) {
      try {
        if (!browser) {
          return;
        }
        const tab =
          typeof gBrowser !== "undefined" && gBrowser && typeof gBrowser.getTabForBrowser === "function"
            ? gBrowser.getTabForBrowser(browser)
            : ((browser && browser.__tab) || null);
        if (tab && isStarredTab(tab)) {
          syncStarTabChrome(tab);
        }
      } catch (e) {}
    },
  };

  function cleanupStar() {
    try {
      clearStarMenu();
    } catch (e) {}
    try {
      if (gBrowser && gBrowser.tabContainer) {
        gBrowser.tabContainer.removeEventListener("TabPinned", onStarTabPinned);
        gBrowser.tabContainer.removeEventListener("SSTabRestored", onStarTabRestored);
        gBrowser.tabContainer.removeEventListener("TabMove", onStarTabMove);
        gBrowser.tabContainer.removeEventListener("TabAttrModified", onStarTabAttrModified);
        gBrowser.tabContainer.removeEventListener("TabSelect", onStarTabSelect);
        gBrowser.tabContainer.removeEventListener("click", onStarCloseEvent, true);
        gBrowser.tabContainer.removeEventListener("command", onStarCloseEvent, true);
      }
    } catch (e) {}
    try {
      if (gBrowser && typeof gBrowser.removeTabsProgressListener === "function") {
        gBrowser.removeTabsProgressListener(starProgressListener);
      }
    } catch (e) {}
    try {
      const menu = document.getElementById("tabContextMenu");
      if (menu) {
        menu.removeEventListener("popupshowing", onStarMenuShowing);
      }
    } catch (e) {}
  }

  function initStar() {
    try {
      syncAllStarAttributes();
    } catch (e) {}
    try {
      if (gBrowser && gBrowser.tabContainer) {
        gBrowser.tabContainer.addEventListener("TabPinned", onStarTabPinned);
        gBrowser.tabContainer.addEventListener("SSTabRestored", onStarTabRestored);
        gBrowser.tabContainer.addEventListener("TabMove", onStarTabMove);
        gBrowser.tabContainer.addEventListener("TabAttrModified", onStarTabAttrModified);
        gBrowser.tabContainer.addEventListener("TabSelect", onStarTabSelect);
        gBrowser.tabContainer.addEventListener("click", onStarCloseEvent, true);
        gBrowser.tabContainer.addEventListener("command", onStarCloseEvent, true);
      }
    } catch (e) {}
    try {
      if (gBrowser && typeof gBrowser.addTabsProgressListener === "function") {
        gBrowser.addTabsProgressListener(starProgressListener);
      }
    } catch (e) {}
    try {
      const menu = document.getElementById("tabContextMenu");
      if (menu && typeof menu.addEventListener === "function") {
        menu.addEventListener("popupshowing", onStarMenuShowing);
      }
    } catch (e) {}
    try {
      window.addEventListener("unload", cleanupStar, { once: true });
    } catch (e) {}
    try {
      window.AphStar = {
        isStarred: isStarredTab,
        isDrifted: isStarDrifted,
        getStarURL,
        setStarURL,
        starTab,
        unstarTab,
        toggleStarTab,
        toggleSelectedStar,
        resetStarTab,
        promptStarURL,
        promoteStarredTab,
        demoteUnstarredTab,
        ensureTabBelowStarred,
        handleTabMoveZone,
        onStarTabMove,
        syncStarredBoundaries,
        STAR_FLAG_KEY,
        STAR_URL_KEY,
        STAR_ATTR,
        STAR_FIRST_ATTR,
        STAR_LAST_ATTR,
        STAR_DRIFT_ATTR,
        debug: () => {
          try {
            return { lastError: starLastError || null };
          } catch (err) {
            return { lastError: "debug-threw" };
          }
        },
      };
    } catch (e) {}
  }

  if (document.readyState === "complete") {
    initStar();
  } else {
    window.addEventListener("load", initStar, { once: true });
  }
