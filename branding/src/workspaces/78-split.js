  // Native dual split-view (Firefox 149+ tab-split-view-wrapper engine).
  // Aph only drives stock entry points: creation through
  // gBrowser.addTabSplitView, teardown through wrapper.unsplitTabs, and
  // the native tab picker through BrowserCommands.addTabSplitView — the
  // same calls the tab context menu makes. Selected-tab guards mirror
  // BrowserCommands.addTabSplitView (unpinned, visible, unsplit).
  // Workspace contract: splits are same-workspace and session-scoped.
  // beginWorkspaceSwitch dissolves every split first (separateSplits),
  // so a tab hidden by the switch can never keep painting inside the
  // content card; both tabs stay open, each tagged to its own
  // workspace. Nothing here persists: stock session restore owns split
  // wrappers, Aph owns visibility. All guards fail closed — when in
  // doubt, no split. (Never name anything splitWorkspaceCommands: that
  // identifier is banned by tests_py/test_assets.py as dead code.)

  const SPLIT_PREF = "browser.tabs.splitView.enabled";
  // Last-viewed read for the split partner pick: SessionStore custom tab
  // value "aphLastViewed" (ms epoch, stamped by the workspaces bundle on
  // TabSelect/TabOpen — key duplicated here by design, same pattern as
  // "aphStarred" and stash.js). Missing reads as 0 (never viewed).
  const SPLIT_LAST_VIEWED_KEY = "aphLastViewed";

  function splitLog(msg) {
    try {
      Services.console.logStringMessage(`[AphSplit] ${msg}`);
    } catch (e) {}
  }

  // Stock entry point present (pinned Firefox 157 ships the engine).
  function nativeSplitAvailable() {
    try {
      return !!(gBrowser && typeof gBrowser.addTabSplitView === "function");
    } catch (e) {
      return false;
    }
  }

  // Stock default is on (pinned-build firefox.js); unreadable prefs read
  // as on — function presence above is the real gate.
  function splitPrefOn() {
    try {
      if (
        Services &&
        Services.prefs &&
        typeof Services.prefs.getBoolPref === "function"
      ) {
        return !!Services.prefs.getBoolPref(SPLIT_PREF, true);
      }
    } catch (e) {}
    return true;
  }

  function readSplitLastViewed(tab) {
    try {
      if (SessionStore && typeof SessionStore.getCustomTabValue === "function") {
        const v = SessionStore.getCustomTabValue(tab, SPLIT_LAST_VIEWED_KEY);
        const n = typeof v === "string" || typeof v === "number" ? Number(v) : NaN;
        if (Number.isFinite(n) && n > 0) {
          return n;
        }
      }
    } catch (e) {}
    return 0;
  }

  function selectedSplitView() {
    try {
      const sel =
        (gBrowser && gBrowser.selectedTab) || null;
      return (sel && sel.splitview) || null;
    } catch (e) {
      return null;
    }
  }

  // Every live split wrapper in this window (unique). Wrappers die with
  // their last tab (native MutationObserver), so this never goes stale.
  function collectSplitViews() {
    const out = [];
    try {
      const tabs = Array.from((gBrowser && gBrowser.tabs) || []);
      for (const t of tabs) {
        try {
          const w = t && t.splitview;
          if (w && out.indexOf(w) === -1) {
            out.push(w);
          }
        } catch (e) {}
      }
    } catch (e) {}
    return out;
  }

  function unsplitWrapper(wrapper, trigger) {
    try {
      if (wrapper && typeof wrapper.unsplitTabs === "function") {
        wrapper.unsplitTabs(trigger);
        return true;
      }
    } catch (e) {}
    return false;
  }

  // Dissolve every split in the window (both tabs stay open). Runs first
  // in beginWorkspaceSwitch so hidden tabs never paint; returns how many
  // dissolved (console callers can confirm what ran).
  function dissolveSplitsForSwitch() {
    let n = 0;
    try {
      for (const w of collectSplitViews()) {
        try {
          if (unsplitWrapper(w, "aph_switch")) {
            n++;
          }
        } catch (e) {}
      }
    } catch (e) {}
    return n;
  }

  // Dissolve only splits touching `tabs` (workspace-send path: a pair
  // must not straddle workspaces — the sent tab hides on reconcile).
  function separateSplitsOf(tabs) {
    let n = 0;
    try {
      const targets = new Set();
      try {
        for (const t of tabs || []) {
          if (t && !t.closing) {
            targets.add(t);
          }
        }
      } catch (e) {}
      if (!targets.size) {
        return 0;
      }
      const seen = [];
      try {
        const all = Array.from((gBrowser && gBrowser.tabs) || []);
        for (const t of all) {
          try {
            const w = t && t.splitview;
            if (w && seen.indexOf(w) === -1) {
              seen.push(w);
            }
          } catch (e) {}
        }
      } catch (e) {}
      for (const w of seen) {
        let touches = false;
        try {
          const members = (w.tabs || []).filter((t) => t);
          touches = members.some((t) => targets.has(t));
        } catch (e) {}
        if (touches) {
          try {
            if (unsplitWrapper(w, "aph_send")) {
              n++;
            }
          } catch (e) {}
        }
      }
    } catch (e) {}
    return n;
  }

  // Most-recently-viewed same-workspace partner for the selected tab:
  // visible, unpinned, unsplit, settled (no restoring/tagless tabs — same
  // fail-closed rule as bulk close), never about:opentabs pickers.
  // Highest aphLastViewed wins; strictly-greater keeps strip order on
  // ties; unviewed tabs sort last. Null when there is no partner.
  function splitCandidate() {
    try {
      if (!isValidId(current)) {
        return null;
      }
      let sel = null;
      try {
        sel = (gBrowser && gBrowser.selectedTab) || null;
      } catch (e) {
        return null;
      }
      if (!sel) {
        return null;
      }
      let tabs = [];
      try {
        tabs = Array.from((gBrowser && gBrowser.tabs) || []);
      } catch (e) {
        return null;
      }
      let best = null;
      let bestViewed = -1;
      for (const t of tabs) {
        try {
          if (!t || t.closing || t === sel || t.pinned || t.hidden) {
            continue;
          }
          if (t.splitview) {
            continue;
          }
          try {
            if (typeof isRestoringTab === "function" && isRestoringTab(t)) {
              continue;
            }
          } catch (e) {}
          let tag = null;
          try {
            tag = typeof rawWs === "function" ? rawWs(t) : null;
          } catch (e) {
            tag = null;
          }
          if (tag !== current) {
            continue;
          }
          let spec = "";
          try {
            spec =
              (t.linkedBrowser &&
                t.linkedBrowser.currentURI &&
                t.linkedBrowser.currentURI.spec) ||
              "";
          } catch (e) {
            spec = "";
          }
          if (!spec || spec === "about:opentabs") {
            continue;
          }
          const viewed = readSplitLastViewed(t);
          if (viewed > bestViewed) {
            bestViewed = viewed;
            best = t;
          }
        } catch (e) {}
      }
      return best;
    } catch (e) {
      return null;
    }
  }

  // Selected tab may anchor a split (mirrors stock addTabSplitView).
  function canSmartSplit() {
    try {
      if (!nativeSplitAvailable() || !splitPrefOn()) {
        return false;
      }
      let sel = null;
      try {
        sel = (gBrowser && gBrowser.selectedTab) || null;
      } catch (e) {
        return false;
      }
      if (!sel || sel.closing || sel.hidden || sel.pinned || sel.splitview) {
        return false;
      }
      return true;
    } catch (e) {
      return false;
    }
  }

  // Hotkey/palette toggle: separate when the selected tab is split,
  // else side-by-side with the MRU same-workspace tab, else the native
  // tab picker. Always returns an {action} object (noop carries reason).
  function splitToggle() {
    try {
      const active = selectedSplitView();
      if (active) {
        const ok = unsplitWrapper(active, "aph_hotkey");
        return { action: ok ? "separated" : "noop", reason: ok ? "" : "separate-failed" };
      }
      if (!canSmartSplit()) {
        return { action: "noop", reason: "not-splittable" };
      }
      let sel = null;
      try {
        sel = (gBrowser && gBrowser.selectedTab) || null;
      } catch (e) {
        return { action: "noop", reason: "no-selected" };
      }
      const partner = splitCandidate();
      if (partner) {
        try {
          gBrowser.addTabSplitView([sel, partner], {
            insertBefore: sel,
            trigger: "aph_hotkey",
          });
          try {
            splitLog(`split ws=${current} with=${readSplitLastViewed(partner)}`);
          } catch (_e) {}
          return { action: "split" };
        } catch (e) {
          return { action: "noop", reason: "split-failed" };
        }
      }
      try {
        if (
          typeof BrowserCommands !== "undefined" &&
          BrowserCommands &&
          typeof BrowserCommands.addTabSplitView === "function"
        ) {
          BrowserCommands.addTabSplitView();
          return { action: "picker" };
        }
      } catch (e) {}
      return { action: "noop", reason: "no-partner" };
    } catch (e) {
      return { action: "noop", reason: "error" };
    }
  }

  function separateActiveSplit() {
    try {
      return unsplitWrapper(selectedSplitView(), "aph_palette");
    } catch (e) {
      return false;
    }
  }

  function reverseActiveSplit() {
    try {
      const active = selectedSplitView();
      if (active && typeof active.reverseTabs === "function") {
        active.reverseTabs("aph_palette");
        return true;
      }
    } catch (e) {}
    return false;
  }

  // Palette row state (read-only): whether the selected tab is split,
  // whether a smart split is possible, and the partner title for the
  // "Split with Last Tab" row.
  function splitState() {
    try {
      const inSplit = !!selectedSplitView();
      const state = { inSplit, canSplit: false, candidateTitle: "", candidateUrl: "" };
      if (inSplit) {
        return state;
      }
      if (!canSmartSplit()) {
        return state;
      }
      state.canSplit = true;
      try {
        const partner = splitCandidate();
        if (partner) {
          let spec = "";
          try {
            spec =
              (partner.linkedBrowser &&
                partner.linkedBrowser.currentURI &&
                partner.linkedBrowser.currentURI.spec) ||
              "";
          } catch (e) {
            spec = "";
          }
          state.candidateUrl = spec;
          try {
            state.candidateTitle = partner.label || spec || "Untitled";
          } catch (e) {
            state.candidateTitle = spec || "Untitled";
          }
        }
      } catch (e) {}
      return state;
    } catch (e) {
      return { inSplit: false, canSplit: false, candidateTitle: "", candidateUrl: "" };
    }
  }
