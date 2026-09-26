/* GENERATED — do not edit by hand. Edit branding/src/, then run: python scripts/build_assets.py */
/* Aph workspaces: IDs "1"-"9", zero UI. Alt+Shift+1..9 jumps to a workspace,
 * Alt+Shift+]/Right cycles next active, Alt+Shift+[/Left cycles previous,
 * Alt+Shift+Tab toggles the last two used (MRU),
 * Window-scoped model (Vivaldi/Zen): every window has its own workspaces
 * 1-9 and tabs belong to the window they live in. The same workspace id
 * may show in two windows at once — independent tab sets, never shared.
 * Windows never touch each other's tabs (no pulls, no steals); moving
 * tabs across windows is always explicit ("Move Tab to Other Window",
 * arrivals join the destination's current workspace). Closing a window
 * is native (SessionStore undo); session restore is per-window native.
 * Ctrl+Alt+1..9 sends the selection there (stay here, focus next —
 * whole native groups stay joined).
 * Tab context menu offers Move Tab(s) / Move Group to Workspace
 * submenus plus Move to Other Window; the dock accepts tab and
 * group-header drops the same way.
 * Tags persist via SessionStore; pinned tabs are global (never hidden —
 * stock Firefox assumes hidden pinned tabs never exist and vertical-tab
 * drag/drop breaks when they do); native tab groups
 * live inside workspaces (one shared tag, header synced, collapsed kept).
 * Container bindings: each workspace may be bound to one Firefox container
 * (Ctrl+Alt+B binds current WS to the selected tab's container,
 * Ctrl+Alt+Shift+B clears). Bound workspaces open new tabs (Ctrl+T,
 * + button) in that container; Ctrl+Alt+T stays disposable-temp always.
 * Bound-match dimming: a tab whose container equals its workspace's binding
 * gets `data-aph-bound-match="1"` (theme.css hides the native
 * `.tab-context-line`); mismatches and unbound workspaces keep the line.
 * Global pinned tabs match the viewed workspace, not their dormant tag.
 * All per-tab markers sync through syncTabChrome (bound match + star);
 * every lifecycle entry (birth, retag, restore, pin, switch, startup)
 * funnels through it or the bulk syncAllTabChrome.
 * Domain routes: a host may be bound to a workspace ("github.com" -> "2",
 * managed from the command palette). Fresh top-level navigations matching
 * a rule are retagged pre-paint and reopened in the target workspace's
 * bound container; settled tabs never route (no OAuth/SSO hijack).
 * Workspace names ("2" -> "💼 Work", pref aph.workspaces.names): badge
 * pill, palette titles and tooltip; rename via badge click, Ctrl+Alt+R,
 * or the palette rename command.
 * Tab unloading (memory): eligible hidden-workspace tabs are discarded via
 * gBrowser.discardBrowser (V1: manual palette command + optional
 * unload-on-switch behind aph.workspaces.unloadOnSwitch, default off).
 * Never unloads selected/pinned/audible/sharing/pending/about:/offline tabs.
 * Addon first-run silencer: managed extensions that open welcome/help tabs
 * on install (no 3rdparty policy support — e.g. SponsorBlock help page)
 * are closed pre-paint (pref aph.addons.silenceFirstRun, default on).
 * Injected into browser.xhtml via rebrand.py (chrome://browser/content/workspaces.js).
 */
(function () {
  const KEY = "aphWs";
  const WIN_KEY = "aphWsCurrent";
  let current = "1";
  const lastSelected = Object.create(null); // workspaceId -> last tab
  let lastUsed = null; // MRU workspace for Alt+Shift+Tab toggle
  // Tabs that arrived via cross-window drag (TabOpen detail.adoptedTab).
  // They join the destination's visible workspace; anchorGroup lets them
  // drag the whole group instead of being healed back to the source tag.
  const adoptedTabs = new WeakSet();

  // Diagnostic lifeline for vanishing-tab reports: one console line per
  // tab Aph itself closes, moves across windows/workspaces, or merges —
  // stock closes (Ctrl+W etc.) never pass here. Fail-silent house style;
  // only fires on actual action, so an idle browser stays quiet.
  function aphTabsLog(msg) {
    try {
      Services.console.logStringMessage(`[AphTabs] ${msg}`);
    } catch (e) {}
  }

  function aphTabDesc(tab) {
    let label = "?";
    let spec = "?";
    let ws = "?";
    try {
      label = String(tab.label || "?").slice(0, 60);
    } catch (e) {}
    try {
      spec = String(
        (tab.linkedBrowser && tab.linkedBrowser.currentURI && tab.linkedBrowser.currentURI.spec) || "?"
      ).slice(0, 80);
    } catch (e) {}
    try {
      ws = getWs(tab);
    } catch (e) {}
    return `"${label}" ${spec} ws=${ws}`;
  }


  // Disposable container tabs (Ctrl+Alt+T). moz-src path first: it is the
  // canonical URI in packaged builds (every internal importer uses it, and
  // resource://gre/modules/... does not exist in omni.ja — importing it
  // first throws a "Missing chrome or resource URL" console error on every
  // launch on every OS). gre/modules kept as fallback for older layouts.
  // Wrapped so the shortcut never dies if both fail.
  let IdentityService = null;
  try {
    ({ ContextualIdentityService: IdentityService } = ChromeUtils.importESModule(
      "moz-src:///toolkit/components/contextualidentity/ContextualIdentityService.sys.mjs"
    ));
  } catch (e) {
    try {
      ({ ContextualIdentityService: IdentityService } = ChromeUtils.importESModule(
        "resource://gre/modules/ContextualIdentityService.sys.mjs"
      ));
    } catch (e2) {}
  }
  let tempCounter = 1;
  const tempContainers = new Set(); // userContextIds created here

  // Workspace ↔ container bindings: each workspace may be bound to one
  // Firefox container (userContextId). New tabs in a bound workspace land
  // in that container. Persisted as JSON in a plain pref (survives
  // restarts); bindings whose container vanished are pruned lazily on
  // read. Disposable temp containers can never be bound.
  const WS_CONTAINER_PREF = "aph.workspaces.containerBindings";
  let wsBindings = null; // lazy-loaded {wsId: userContextId}
  const CONTAINER_HEX = {
    blue: "#37adff", turquoise: "#00c79a", green: "#51cf66",
    yellow: "#e8d44d", orange: "#ff8a36", red: "#ff375f",
    pink: "#ff7ab2", purple: "#af51f5",
  };

  function loadBindings() {
    if (wsBindings) {
      return wsBindings;
    }
    wsBindings = Object.create(null);
    try {
      let raw = "";
      try {
        raw = Services.prefs.getStringPref(WS_CONTAINER_PREF, "");
      } catch (e) {}
      if (raw) {
        const obj = JSON.parse(raw);
        for (const k of Object.keys(obj || {})) {
          const id = Number(obj[k]);
          if (isValidId(k) && Number.isInteger(id) && id > 0) {
            wsBindings[k] = id;
          }
        }
      }
    } catch (e) {}
    return wsBindings;
  }

  function saveBindings() {
    try {
      const plain = {};
      const map = loadBindings();
      for (const k of Object.keys(map)) {
        plain[k] = map[k];
      }
      Services.prefs.setStringPref(WS_CONTAINER_PREF, JSON.stringify(plain));
    } catch (e) {}
  }

  // Stock Firefox ships four default containers WITHOUT a `name` — only
  // an `l10nId` (user-context-personal/work/banking/shopping). Reading
  // `ident.name` alone renders them as "Container 1..4". The service's own
  // `getUserContextLabel(id)` resolves name-first, l10n-second, so prefer
  // it; the static map covers contexts where it is unavailable (tests,
  // older layouts). User-created containers always carry `name`.
  const CONTAINER_L10N_FALLBACK = {
    "user-context-personal": "Personal",
    "user-context-work": "Work",
    "user-context-banking": "Banking",
    "user-context-shopping": "Shopping",
  };

  function containerLabel(nid, ident) {
    try {
      if (ident && ident.name) {
        return ident.name;
      }
    } catch (e) {}
    try {
      if (
        IdentityService &&
        typeof IdentityService.getUserContextLabel === "function"
      ) {
        const label = IdentityService.getUserContextLabel(nid);
        if (label) {
          return label;
        }
      }
    } catch (e) {}
    try {
      const l10n = ident && (ident.l10nId || ident.l10nID);
      if (l10n && CONTAINER_L10N_FALLBACK[l10n]) {
        return CONTAINER_L10N_FALLBACK[l10n];
      }
    } catch (e) {}
    return "";
  }

  function describeContainer(id) {
    try {
      const nid = Number(id) || 0;
      if (!nid || !IdentityService) {
        return null;
      }
      const ident = IdentityService.getPublicIdentityFromId(nid);
      if (!ident) {
        return null;
      }
      return {
        name: containerLabel(nid, ident),
        color: ident.color || "",
        icon: ident.icon || "",
      };
    } catch (e) {
      return null;
    }
  }

  // Validated binding for `ws` (0 = none). Prunes stale entries.
  function getWsContainerId(ws) {
    if (!isValidId(ws) || !IdentityService) {
      return 0;
    }
    const map = loadBindings();
    const id = Number(map[ws]) || 0;
    if (!id) {
      return 0;
    }
    let ok = false;
    try {
      ok = !tempContainers.has(id) && !!IdentityService.getPublicIdentityFromId(id);
    } catch (e) {
      ok = false;
    }
    if (!ok) {
      try {
        delete map[ws];
        saveBindings();
      } catch (e) {}
      return 0;
    }
    return id;
  }

  // Per-tab container-line dimming: when a tab's container equals its
  // workspace's bound container, the native `.tab-context-line` is redundant
  // (the WS badge in updateIndicator already shows the binding). Matching
  // tabs get `data-aph-bound-match="1"`; theme.css hides the line for those.
  // Mismatches, unbound workspaces, and default (cid 0) tabs never match,
  // so their lines stay visible. Temp containers can never be bound, so they
  // always show.
  // Pins are global (visible in every workspace) with only a dormant tag:
  // they match against the viewed (current) workspace, not that tag — a
  // pinned Work-container tab hides its line exactly in Work-bound
  // workspaces. Unpinned tabs match against their own tag.
  function isTabMatchingBinding(tab) {
    try {
      if (!tab || tab.closing) {
        return false;
      }
      let cid = 0;
      try {
        cid = tab.userContextId || 0;
      } catch (e) {
        return false;
      }
      if (!cid) {
        return false;
      }
      let ws = null;
      try {
        let pinned = false;
        try {
          pinned = !!tab.pinned;
        } catch (e) {}
        ws = pinned && isValidId(current) ? current : getWs(tab);
      } catch (e) {
        return false;
      }
      if (!isValidId(ws)) {
        return false;
      }
      let bound = 0;
      try {
        bound = getWsContainerId(ws);
      } catch (e) {
        return false;
      }
      return !!bound && bound === cid;
    } catch (e) {
      return false;
    }
  }

  function syncTabBindingMatch(tab) {
    try {
      if (!tab) {
        return;
      }
      if (typeof tab.setAttribute !== "function" || typeof tab.removeAttribute !== "function") {
        return;
      }
      if (isTabMatchingBinding(tab)) {
        try {
          tab.setAttribute("data-aph-bound-match", "1");
        } catch (e) {}
      } else {
        try {
          tab.removeAttribute("data-aph-bound-match");
        } catch (e) {}
      }
    } catch (e) {}
  }

  function syncAllTabBindingMatches() {
    try {
      const tabs = gBrowser ? gBrowser.tabs : null;
      if (!tabs) {
        return;
      }
      for (const t of Array.from(tabs)) {
        syncTabBindingMatch(t);
      }
    } catch (e) {}
  }

  // Bind the current workspace to the selected tab's container.
  // On a default (containerless) tab this clears the binding instead.
  // Refuses disposable temp containers (they are deleted on last close).
  function bindCurrentWsToSelectedTab() {
    if (!isValidId(current)) {
      return { ok: false, reason: "no-workspace" };
    }
    let tab = null;
    try {
      tab = gBrowser.selectedTab;
    } catch (e) {}
    if (!tab) {
      return { ok: false, reason: "no-tab" };
    }
    let id = 0;
    try {
      id = tab.userContextId || 0;
    } catch (e) {}
    if (!id) {
      clearWsBinding(current);
      return { ok: true, cleared: true };
    }
    try {
      if (tempContainers.has(id)) {
        return { ok: false, reason: "temp" };
      }
    } catch (e) {}
    const ident = describeContainer(id);
    if (!ident) {
      return { ok: false, reason: "unknown" };
    }
    loadBindings()[current] = id;
    saveBindings();
    updateIndicator();
    syncAllTabBindingMatches();
    pulseWorkspaceIndicator();
    return { ok: true, userContextId: id, name: ident.name };
  }

  function clearWsBinding(ws) {
    const target = isValidId(ws) ? ws : isValidId(current) ? current : null;
    if (!target) {
      return;
    }
    try {
      delete loadBindings()[target];
      saveBindings();
    } catch (e) {}
    updateIndicator();
    syncAllTabBindingMatches();
  }

  // Bind any workspace (not just current) to a container id. 0 clears.
  // Same guards as bindCurrentWsToSelectedTab: unknown ids and disposable
  // temp containers refuse. Used by the dock's Bind submenu.
  function setWsBinding(ws, id) {
    if (!isValidId(ws)) {
      return { ok: false, reason: "bad-workspace" };
    }
    const nid = Number(id) || 0;
    if (!nid) {
      clearWsBinding(ws);
      return { ok: true, cleared: true };
    }
    try {
      if (tempContainers.has(nid)) {
        return { ok: false, reason: "temp" };
      }
    } catch (e) {}
    const ident = describeContainer(nid);
    if (!ident) {
      return { ok: false, reason: "unknown" };
    }
    loadBindings()[ws] = nid;
    saveBindings();
    updateIndicator();
    syncAllTabBindingMatches();
    pulseWorkspaceIndicator();
    return { ok: true, userContextId: nid, name: ident.name };
  }

  // All bindable containers for the dock's Bind submenu. Temp containers
  // excluded (deleted on last close — can never be bound).
  function listContainers() {
    const out = [];
    try {
      const svc = IdentityService;
      if (svc && typeof svc.getPublicIdentities === "function") {
        for (const ident of Array.from(svc.getPublicIdentities() || [])) {
          const nid = Number(ident && ident.userContextId) || 0;
          if (!nid) {
            continue;
          }
          try {
            if (tempContainers.has(nid)) {
              continue;
            }
          } catch (e) {}
          out.push({
            userContextId: nid,
            name: containerLabel(nid, ident),
            color: (ident && ident.color) || "",
            icon: (ident && ident.icon) || "",
          });
        }
      }
    } catch (e) {}
    return out;
  }

  // New tab in `ws` using its bound container (plain tab when unbound).
  // Manual birth (Ctrl+T, + button): always a Level 0 root, never a child.
  function openBoundTab(url = "about:newtab", wsArg) {
    const ws = isValidId(wsArg) ? wsArg : isValidId(current) ? current : "1";
    const bound = getWsContainerId(ws);
    try {
      const t = bound
        ? gBrowser.addTrustedTab(url, { userContextId: bound })
        : gBrowser.addTrustedTab(url);
      // insertAfterCurrent births tabs inside the selected tab's group — eject.
      try {
        gBrowser.ungroupTab(t);
      } catch (e) {}
      setWs(t, ws);
      aphShowTab(t);
      gBrowser.selectedTab = t;
      focusUrlBar();
      return t;
    } catch (e) {
      return null;
    }
  }

  // Open `url` tagged into `ws` with an explicit container (0 = default).
  // Unlike openBoundTab (which uses the workspace's bound container), the
  // container is chosen by the caller — used by the tab archive to restore
  // full context (workspace + container). Returns the tab, unselected.
  function openInWorkspace(url, wsArg, userContextId) {
    const target = isValidId(wsArg) ? wsArg : isValidId(current) ? current : "1";
    try {
      const t = userContextId
        ? gBrowser.addTrustedTab(url, { userContextId })
        : gBrowser.addTrustedTab(url);
      // insertAfterCurrent births tabs inside the selected tab's group — eject.
      try {
        gBrowser.ungroupTab(t);
      } catch (e) {}
      setWs(t, target);
      return t;
    } catch (e) {
      return null;
    }
  }

  // Stock BrowserOpenTab focuses the urlbar after selecting the new tab.
  // Our programmatic opens (bound Ctrl+T, temp tab, container-repair swap)
  // select tabs without that step, so typing would go nowhere. Guarded:
  // no-ops in contexts without a urlbar (tests, popups).
  function focusUrlBar() {
    try {
      if (typeof gURLBar !== "undefined" && gURLBar && typeof gURLBar.focus === "function") {
        gURLBar.focus();
      }
    } catch (e) {}
  }

  // Fallback for empty-tab births that bypass the BrowserOpenTab wrapper
  // (window.open, extensions, restore paths): the container is immutable
  // after TabOpen, so repair selected, still-empty newtab pages one tick
  // later by swapping in a correctly-containered tab.
  // ONLY about:newtab/about:home — never about:blank — so window.open
  // popups and in-flight link loads (blank at TabOpen) are never touched.
  function armContainerRepair(tab) {
    try {
      if (!tab || rawWs(tab) || !isValidId(current)) {
        return false;
      }
      // Restoring tabs must never be armed: the deferred swap would race
      // extData (and onTabOpen now returns early for them anyway — this
      // is belt-and-braces for direct callers).
      try {
        if (typeof isRestoringTab === "function" && isRestoringTab(tab)) {
          return false;
        }
      } catch (e) {}
      const bound = getWsContainerId(current);
      if (!bound) {
        return false;
      }
      if ((tab.userContextId || 0) !== 0) {
        return false;
      }
      // NOTE: selection is NOT checked here — at TabOpen time the opener
      // often hasn't selected the tab yet (+ button selects right after).
      // Selection is verified in the deferred callback instead.
      tab.__aphRepairArmed = bound;
      setTimeout(() => {
        let armed = 0;
        try {
          armed = tab.__aphRepairArmed || 0;
          delete tab.__aphRepairArmed;
        } catch (e) {}
        try {
          if (!armed || tab.closing || !gBrowser.tabs.includes(tab)) {
            return;
          }
          // Session restore in flight for this tab: never swap — and
          // never stamp either (its tag arrives via extData/SSTabRestored;
          // stamping now would freeze it to the current workspace).
          // Hands off entirely; onTabRestored settles it.
          try {
            if (
              (typeof isRestoringTab === "function" && isRestoringTab(tab)) ||
              (SessionStore &&
                typeof SessionStore.isTabRestoring === "function" &&
                SessionStore.isTabRestoring(tab))
            ) {
              return;
            }
          } catch (e) {}
          if (gBrowser.selectedTab !== tab) {
            // Background tab — leave it alone, tag normally.
            stampTab(tab);
            return;
          }
          if (rawWs(tab) || (tab.userContextId || 0) !== 0) {
            return;
          }
          const uri = tab.linkedBrowser?.currentURI?.spec;
          if (uri !== "about:newtab" && uri !== "about:home") {
            // Navigated away meanwhile (link load, popup) — tag normally.
            stampTab(tab);
            return;
          }
          if (!isValidId(current) || getWsContainerId(current) !== armed) {
            stampTab(tab);
            return;
          }
          const replacement = gBrowser.addTrustedTab("about:newtab", { userContextId: armed });
          try {
            gBrowser.ungroupTab(replacement);
          } catch (e) {}
          setWs(replacement, current);
          aphShowTab(replacement);
          try {
            gBrowser.selectedTab = replacement;
          } catch (e) {}
          // Stock focused the urlbar for the original tab; the swap moves
          // selection, so re-focus or typing lands in the page.
          focusUrlBar();
          try {
            if (typeof aphTabsLog === "function") {
              aphTabsLog(`container-repair closing ${aphTabDesc(tab)}`);
            }
          } catch (e) {}
          try {
            gBrowser.removeTab(tab, { animate: false });
          } catch (e) {
            try {
              gBrowser.removeTab(tab);
            } catch (_e) {}
          }
          // Scrub the swap ghost: undo must not resurrect the
          // wrong-container original as a duplicate of the replacement.
          try {
            if (typeof scrubAdoptionGhost === "function") {
              scrubAdoptionGhost(window, tab);
            }
          } catch (e) {}
        } catch (e) {}
      }, 0);
      return true;
    } catch (e) {
      return false;
    }
  }

  // Domain → workspace routing: each host may be bound to one workspace
  // ("github.com" -> "2", managed from the command palette). Persisted as
  // JSON in a plain pref (survives restarts); entries pointing at invalid
  // workspace IDs are ignored on read. Cross-window sync via the pref
  // observer registered in init().
  const WS_ROUTES_PREF = "aph.workspaces.domainRoutes";
  let wsRoutes = null; // lazy-loaded {host: wsId}

  function normalizeHost(host) {
    try {
      return String(host || "").toLowerCase().replace(/\.$/, "");
    } catch (e) {
      return "";
    }
  }

  function loadRoutes() {
    if (wsRoutes) {
      return wsRoutes;
    }
    wsRoutes = Object.create(null);
    try {
      let raw = "";
      try {
        raw = Services.prefs.getStringPref(WS_ROUTES_PREF, "");
      } catch (e) {}
      if (raw) {
        const obj = JSON.parse(raw);
        for (const k of Object.keys(obj || {})) {
          const h = normalizeHost(k);
          if (h && isValidId(obj[k])) {
            wsRoutes[h] = obj[k];
          }
        }
      }
    } catch (e) {}
    return wsRoutes;
  }

  function saveRoutes() {
    try {
      const plain = {};
      const map = loadRoutes();
      for (const k of Object.keys(map)) {
        plain[k] = map[k];
      }
      Services.prefs.setStringPref(WS_ROUTES_PREF, JSON.stringify(plain));
    } catch (e) {}
  }

  // Longest-suffix wins: "aws.amazon.com" beats "amazon.com", which beats
  // nothing. Single-label hosts (localhost) only match exactly.
  function matchRoute(host) {
    const start = normalizeHost(host);
    if (!start) {
      return null;
    }
    const rules = loadRoutes();
    let h = start;
    for (;;) {
      if (Object.hasOwn(rules, h)) {
        const v = rules[h];
        if (isValidId(v)) {
          return { pattern: h, ws: v };
        }
      }
      const dot = h.indexOf(".");
      if (dot === -1) {
        return null;
      }
      h = h.slice(dot + 1);
    }
  }

  function setRoute(host, wsId) {
    const h = normalizeHost(host);
    if (!h || !isValidId(wsId)) {
      return false;
    }
    loadRoutes()[h] = wsId;
    saveRoutes();
    return true;
  }

  function deleteRoute(host) {
    const h = normalizeHost(host);
    if (!h) {
      return false;
    }
    try {
      if (!Object.hasOwn(loadRoutes(), h)) {
        return false;
      }
      delete loadRoutes()[h];
      saveRoutes();
      return true;
    } catch (e) {
      return false;
    }
  }

  function getAllRoutes() {
    const out = Object.create(null);
    try {
      const map = loadRoutes();
      for (const k of Object.keys(map)) {
        out[k] = map[k];
      }
    } catch (e) {}
    return out;
  }

  // Workspace names ("2" -> "💼 Work"). Persisted as JSON in a plain pref.
  // Empty/blank clears back to the default "Workspace N". Cross-window
  // sync via the pref observer registered in init().
  const WS_NAMES_PREF = "aph.workspaces.names";
  const WS_NAME_MAX = 40;
  let wsNames = null; // lazy-loaded {wsId: name}

  function loadWsNames() {
    if (wsNames) {
      return wsNames;
    }
    wsNames = Object.create(null);
    try {
      let raw = "";
      try {
        raw = Services.prefs.getStringPref(WS_NAMES_PREF, "");
      } catch (e) {}
      if (raw) {
        const obj = JSON.parse(raw);
        for (const k of Object.keys(obj || {})) {
          const v = String(obj[k] || "").trim();
          if (isValidId(k) && v) {
            wsNames[k] = v.slice(0, WS_NAME_MAX);
          }
        }
      }
    } catch (e) {}
    return wsNames;
  }

  function saveWsNames() {
    try {
      const plain = {};
      const map = loadWsNames();
      for (const k of Object.keys(map)) {
        plain[k] = map[k];
      }
      Services.prefs.setStringPref(WS_NAMES_PREF, JSON.stringify(plain));
    } catch (e) {}
  }

  function getWsName(wsId) {
    try {
      return loadWsNames()[wsId] || "";
    } catch (e) {
      return "";
    }
  }

  function setWsName(wsId, name) {
    if (!isValidId(wsId)) {
      return false;
    }
    const trimmed = String(name || "").trim().slice(0, WS_NAME_MAX);
    try {
      if (trimmed) {
        loadWsNames()[wsId] = trimmed;
      } else {
        delete loadWsNames()[wsId];
      }
      saveWsNames();
    } catch (e) {
      return false;
    }
    updateIndicator();
    return true;
  }

  function isValidId(v) {
    return v >= "1" && v <= "9" && v.length === 1;
  }

  function rawWs(tab) {
    try {
      const v = SessionStore.getCustomTabValue(tab, KEY);
      return isValidId(v) ? v : null;
    } catch (e) {
      return null;
    }
  }

  function getWs(tab) {
    return rawWs(tab) || "1";
  }

  // True while SessionStore still owns the tab (bulk restore in flight).
  // Custom tab values (aphWs) arrive via extData around
  // SSTabRestored — any stamp/retag before this clears must
  // wait, or a tagless restored tab is permanently stamped to whatever
  // workspace happens to be current (the 3->2 restore scramble). All
  // restore-unsafe writers funnel through this guard.
  function isRestoringTab(tab) {
    try {
      if (!tab) {
        return false;
      }
      if (
        typeof SessionStore !== "undefined" &&
        SessionStore &&
        typeof SessionStore.isTabRestoring === "function" &&
        SessionStore.isTabRestoring(tab)
      ) {
        return true;
      }
    } catch (e) {}
    return false;
  }

  function setWs(tab, ws) {
    try {
      SessionStore.setCustomTabValue(tab, KEY, ws);
    } catch (e) {}
    // Containers are immutable per tab, so the only thing that changes a
    // tab's match state is its workspace tag (binding changes go through
    // syncAllTabChrome). Sync here to cover every retag path:
    // stamp, send, route, adopt, anchor, openBoundTab.
    syncTabChrome(tab);
  }

  // Last-viewed stamp for auto-archive staleness: SessionStore custom tab
  // value LAST_VIEWED_KEY, ms epoch as a string (same persistence as
  // workspace tags, so stamps survive restarts and restored tabs keep
  // their pre-restart viewed time). Stamped on TabSelect and TabOpen
  // (80); never on SSTabRestored (restore must not look like viewing).
  // archive.js reads it at sweep time (key duplicated there by design —
  // same pattern as "aphStarred" in 50/76).
  const LAST_VIEWED_KEY = "aphLastViewed";

  function stampLastViewed(tab) {
    try {
      if (!tab) {
        return;
      }
      SessionStore.setCustomTabValue(tab, LAST_VIEWED_KEY, String(Date.now()));
    } catch (e) {}
  }

  // Central per-tab chrome sync (the choke point): every lifecycle entry
  // that births, retags, restores, pins, or reveals a tab funnels marker
  // state through here, so no marker depends on remembering every path.
  // Covers the bound-container match (10) and the star marker + close
  // tooltip (76). Visibility stays bulk (reconcile) and is called
  // alongside at the same entries.
  function syncTabChrome(tab) {
    try {
      if (typeof syncTabBindingMatch === "function") {
        syncTabBindingMatch(tab);
      }
    } catch (e) {}
    try {
      if (typeof syncStarTabChrome === "function") {
        syncStarTabChrome(tab);
      }
    } catch (e) {}
  }

  function syncAllTabChrome() {
    try {
      const tabs = gBrowser ? gBrowser.tabs : null;
      if (!tabs) {
        return;
      }
      for (const t of Array.from(tabs)) {
        try {
          syncTabChrome(t);
        } catch (e) {}
      }
    } catch (e) {}
  }

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
      if (gBrowser.selectedTab !== focus) {
        aphShowTab(focus);
        gBrowser.selectedTab = focus;
      }
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
    const selIsNew = !!(sel && isNewTab(sel) && getWs(sel) === target);
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
      // Restoring tabs are owned by SessionStore — never prune a tab
      // whose URL/tag hasn't settled (its newtab face may be transient).
      try {
        if (typeof isRestoringTab === "function" && isRestoringTab(t)) {
          continue;
        }
      } catch (e) {}
      // Unloaded/pending tabs haven't committed a URL yet either (lazy
      // restore, discard): their blank face may be transient, and closing
      // them destroys unloaded state. Same rule as the unload guards.
      try {
        if (typeof t.hasAttribute === "function" && t.hasAttribute("pending")) {
          continue;
        }
      } catch (e) {}
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
        if (typeof aphTabsLog === "function") {
          aphTabsLog(`prune ws=${target} closing ${aphTabDesc(t)}`);
        }
      } catch (e) {}
      try {
        gBrowser.removeTab(t, { animate: false });
      } catch (e) {
        try {
          gBrowser.removeTab(t);
        } catch (_e) {}
      }
    }
  }

  // Tab unloading (memory): discard eligible tabs via gBrowser.discardBrowser
  // (tab element + aphWs tag survive; selecting reloads). V1 scope is hidden
  // foreign-workspace tabs only; current-WS idle timers are deferred to V2.
  // All guards fail closed — when in doubt, keep the tab loaded.
  const WS_UNLOAD_PREF = "aph.workspaces.unloadOnSwitch";

  function unloadLog(msg) {
    try {
      Services.console.logStringMessage(`[AphUnload] ${msg}`);
    } catch (e) {}
  }

  function getUnloadOnSwitch() {
    try {
      if (!Services.prefs || typeof Services.prefs.getBoolPref !== "function") {
        return false;
      }
      return !!Services.prefs.getBoolPref(WS_UNLOAD_PREF);
    } catch (e) {
      return false;
    }
  }

  // Never unload if any guard holds: selected (visible page), pinned (app
  // anchor), audible media, active load, WebRTC sharing, already pending,
  // unsaved work (beforeunload), internal pages, or unreadable URL.
  function canUnloadTab(tab) {
    try {
      if (!tab) {
        return { ok: false, reason: "no-tab" };
      }
      try {
        if (tab.closing) {
          return { ok: false, reason: "closing" };
        }
      } catch (e) {}
      try {
        if (tab.selected) {
          return { ok: false, reason: "selected" };
        }
      } catch (e) {}
      try {
        if (gBrowser.selectedTab === tab) {
          return { ok: false, reason: "selected" };
        }
      } catch (e) {}
      try {
        if (tab.pinned) {
          return { ok: false, reason: "pinned" };
        }
      } catch (e) {}
      try {
        if (tab.soundPlaying || tab.audible) {
          return { ok: false, reason: "audio" };
        }
      } catch (e) {}
      try {
        if (tab.busy) {
          return { ok: false, reason: "loading" };
        }
      } catch (e) {}
      try {
        if (tab.linkedBrowser?._sharingState?.webRTC?.sharing) {
          return { ok: false, reason: "sharing" };
        }
      } catch (e) {}
      try {
        if (typeof tab.hasAttribute === "function" && tab.hasAttribute("pending")) {
          return { ok: false, reason: "pending" };
        }
      } catch (e) {}
      try {
        if (tab.linkedBrowser?.frameLoader?.tabParent?.hasBeforeUnload) {
          return { ok: false, reason: "beforeunload" };
        }
      } catch (e) {}
      let spec;
      try {
        spec = tab.linkedBrowser?.currentURI?.spec;
      } catch (e) {
        return { ok: false, reason: "unknown-url" };
      }
      if (typeof spec !== "string" || !spec) {
        return { ok: false, reason: "unknown-url" };
      }
      if (spec.startsWith("about:") || spec.startsWith("chrome:") || spec.startsWith("resource:")) {
        return { ok: false, reason: "internal" };
      }
      try {
        if (isNewTab(tab)) {
          return { ok: false, reason: "newtab" };
        }
      } catch (e) {}
      return { ok: true };
    } catch (e) {
      return { ok: false, reason: "error" };
    }
  }

  // Discard every eligible tab in scope ("foreign" = hidden workspaces only).
  // Synchronous loop: discardBrowser itself is cheap (teardown is async in
  // Gecko), so counts are exact on return. One failure never aborts the sweep.
  function unloadEligibleTabs(opts) {
    const scope = (opts && opts.scope) || "foreign";
    const dryRun = !!(opts && opts.dryRun);
    try {
      if (typeof navigator !== "undefined" && navigator.onLine === false) {
        return { unloaded: 0, skipped: 0, reason: "offline" };
      }
    } catch (e) {}
    if (typeof gBrowser.discardBrowser !== "function") {
      return { unloaded: 0, skipped: 0, reason: "no-api" };
    }
    let tabs = [];
    try {
      tabs = Array.from(gBrowser.tabs);
    } catch (e) {
      return { unloaded: 0, skipped: 0, reason: "no-tabs" };
    }
    let unloaded = 0;
    let skipped = 0;
    for (const t of tabs) {
      try {
        if (scope === "foreign" && getWs(t) === current) {
          continue;
        }
        // Dock "Unload Inactive Tabs": one workspace only. Unknown or
        // missing ws fails closed (nothing unloads).
        if (scope === "workspace") {
          const only = opts && opts.ws;
          if (!isValidId(only) || getWs(t) !== only) {
            continue;
          }
        }
        const c = canUnloadTab(t);
        if (!c.ok) {
          skipped++;
          continue;
        }
        if (dryRun) {
          unloaded++;
          continue;
        }
        gBrowser.discardBrowser(t);
        // Discarded reload must not re-trigger domain routing.
        try {
          t.__aphFresh = false;
        } catch (e) {}
        unloaded++;
      } catch (e) {
        skipped++;
      }
    }
    if (unloaded > 0 && !dryRun) {
      unloadLog(`sweep scope=${scope}: ${unloaded} unloaded, ${skipped} guarded`);
    }
    return { unloaded, skipped };
  }

  // Ctrl/Cmd+W on a selected pinned tab keeps it open (pref
  // aph.pins.ctrlWUnloads, default on — same default-true shape as
  // silenceFirstRun): pins are app anchors. A drifted pin first resets to
  // its pinned base URL in place (stay selected, no unload — next press,
  // now at base, parks); a pin already at base parks (unloads) instead of
  // closing; a second press (now pending) falls through to stock close, as
  // do middle-click and the context menu. Stock refuses to discard the
  // SELECTED tab even forced (tabbrowser.js _mayDiscardBrowser), so parking
  // moves selection to a visible neighbor first — the focus jump mirrors a
  // close. Anything where a discard would silently lose state or no-op
  // falls through to stock (which prompts or closes): unsaved work,
  // already-pending, internal pages, sole-visible-tab windows,
  // multiselections.
  const PIN_PARK_PREF = "aph.pins.ctrlWUnloads";

  function getCtrlWParksPinned() {
    try {
      if (Services.prefs && typeof Services.prefs.getBoolPref === "function") {
        return Services.prefs.getBoolPref(PIN_PARK_PREF);
      }
    } catch (e) {}
    return true;
  }

  // Next visible tab after `tab` in strip order, else the nearest visible
  // tab before it. Hidden (foreign-workspace), closing,
  // and the tab itself never qualify. Null when nothing else is visible.
  function findParkNeighbor(tab) {
    try {
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
      const visible = (t) => {
        try {
          if (!t || t === tab || t.closing) {
            return false;
          }
        } catch (e) {
          return false;
        }
        try {
          if (t.hidden) {
            return false;
          }
        } catch (e) {}
        try {
          if (typeof t.hasAttribute === "function" && t.hasAttribute("hidden")) {
            return false;
          }
        } catch (e) {}
        return true;
      };
      for (let i = at + 1; i < tabs.length; i++) {
        try {
          if (visible(tabs[i])) {
            return tabs[i];
          }
        } catch (e) {}
      }
      for (let i = at - 1; i >= 0; i--) {
        try {
          if (visible(tabs[i])) {
            return tabs[i];
          }
        } catch (e) {}
      }
    } catch (e) {}
    return null;
  }

  // Ctrl/Cmd+W on a selected STARRED tab mirrors pins (pref
  // aph.stars.ctrlWUnloads, default on): starred tabs are normal
  // per-workspace tabs with a base URL owned by 76-starred.js. A drifted
  // star first resets to its starred base URL in place (stay selected, no
  // unload — next press, now at base, parks); a star already at base parks
  // (unloads) instead of closing; a second press (now pending) falls
  // through to stock close. Same guards as pins: unsaved work,
  // already-pending, internal pages, sole-visible-tab windows,
  // multiselections. Pinned tabs never reach here (pin park runs first).
  const STAR_PARK_PREF = "aph.stars.ctrlWUnloads";

  function getCtrlWParksStarred() {
    try {
      if (Services.prefs && typeof Services.prefs.getBoolPref === "function") {
        return Services.prefs.getBoolPref(STAR_PARK_PREF);
      }
    } catch (e) {}
    return true;
  }

  // 76-starred.js loads after this file in the bundle; resolve through
  // typeof guards so a missing star module fails closed to stock close.
  function isStarredForPark(tab) {
    try {
      if (typeof isStarredTab === "function") {
        return !!isStarredTab(tab);
      }
    } catch (e) {}
    try {
      if (SessionStore && typeof SessionStore.getCustomTabValue === "function") {
        if (SessionStore.getCustomTabValue(tab, "aphStarred") === "1") {
          return true;
        }
      }
    } catch (e) {}
    try {
      if (tab && typeof tab.hasAttribute === "function" && tab.hasAttribute("data-aph-starred")) {
        return true;
      }
    } catch (e) {}
    return false;
  }

  // Shared Ctrl+W park for owned-base-URL tabs (pins + stars): guards,
  // drift-reset-in-place, then neighbor-select + discard. checkOwned(sel)
  // returns a reason string when the tab isn't eligible, null when it is
  // (each kind keeps its own check order); getTarget/doReset carry the
  // kind's base-URL accessors with the usual typeof guards (50 loads
  // before 75/76).
  function parkSelectedOwnedTab(prefOn, checkOwned, getTarget, doReset) {
    try {
      if (!prefOn()) {
        return { ok: false, reason: "disabled" };
      }
      let sel = null;
      try {
        sel = gBrowser.selectedTab;
      } catch (e) {}
      if (!sel) {
        return { ok: false, reason: "no-tab" };
      }
      try {
        if (sel.closing) {
          return { ok: false, reason: "closing" };
        }
      } catch (e) {}
      const notOwned = checkOwned(sel);
      if (notOwned) {
        return { ok: false, reason: notOwned };
      }
      // Multiselection closes as a unit in stock — never half-park it.
      try {
        const multi = gBrowser.selectedTabs || gBrowser.multiselectedTabs || null;
        if (Array.isArray(multi) && multi.length > 1) {
          return { ok: false, reason: "multi" };
        }
      } catch (e) {}
      // Already parked: let stock close (second press closes).
      try {
        if (typeof sel.hasAttribute === "function" && sel.hasAttribute("pending")) {
          return { ok: false, reason: "pending" };
        }
      } catch (e) {}
      // Unsaved work: non-force discard would not prompt, so fall through
      // to stock close, which does.
      try {
        if (sel.linkedBrowser?.frameLoader?.tabParent?.hasBeforeUnload) {
          return { ok: false, reason: "beforeunload" };
        }
      } catch (e) {}
      let spec = null;
      try {
        spec = sel.linkedBrowser?.currentURI?.spec;
      } catch (e) {}
      if (typeof spec !== "string" || !spec) {
        return { ok: false, reason: "unknown-url" };
      }
      if (
        spec.startsWith("about:") ||
        spec.startsWith("chrome:") ||
        spec.startsWith("resource:")
      ) {
        return { ok: false, reason: "internal" };
      }
      try {
        if (isNewTab(sel)) {
          return { ok: false, reason: "newtab" };
        }
      } catch (e) {}
      // Drifted base: reset to the base URL in place (stay selected, no
      // unload) and claim the keystroke. Runs after the guards above so
      // unsaved work still falls through to stock (which prompts) and
      // internal pages never navigate; runs before the neighbor check so
      // a sole-tab owned tab can still reset. Reset-then-discard in one
      // press is deliberately avoided: the fresh navigation would race
      // the discard (which tears down the load), so park happens on the
      // next press, once at base.
      try {
        const target = getTarget(sel);
        if (target && spec && target !== spec) {
          try {
            doReset(sel);
          } catch (_e) {}
          // Reset navigation must not re-trigger domain routing.
          try {
            sel.__aphFresh = false;
          } catch (_e) {}
          return { ok: true, reset: true };
        }
      } catch (e) {}
      const next = findParkNeighbor(sel);
      if (!next) {
        return { ok: false, reason: "only-tab" };
      }
      if (typeof gBrowser.discardBrowser !== "function") {
        return { ok: false, reason: "no-api" };
      }
      try {
        gBrowser.selectedTab = next;
      } catch (e) {
        return { ok: false, reason: "no-select" };
      }
      let discarded = false;
      try {
        // Stock returns false on refusal, undefined on success.
        discarded = gBrowser.discardBrowser(sel) !== false;
      } catch (e) {
        discarded = false;
      }
      if (!discarded) {
        try {
          gBrowser.selectedTab = sel;
        } catch (_e) {}
        return { ok: false, reason: "discard-refused" };
      }
      // Discarded reload must not re-trigger domain routing.
      try {
        sel.__aphFresh = false;
      } catch (e) {}
      return { ok: true };
    } catch (e) {
      return { ok: false, reason: "error" };
    }
  }

  function parkSelectedStarredTab() {
    return parkSelectedOwnedTab(
      getCtrlWParksStarred,
      (sel) => {
        try {
          if (sel.pinned) {
            return "pinned";
          }
        } catch (e) {}
        if (!isStarredForPark(sel)) {
          return "not-starred";
        }
        return null;
      },
      (sel) => (typeof effectiveStarURL === "function" ? effectiveStarURL(sel) : ""),
      (sel) => {
        if (typeof resetStarTab === "function") {
          resetStarTab(sel);
        }
      }
    );
  }

  function parkSelectedPinnedTab() {
    return parkSelectedOwnedTab(
      getCtrlWParksPinned,
      (sel) => {
        try {
          if (!sel.pinned) {
            return "not-pinned";
          }
        } catch (e) {
          return "not-pinned";
        }
        return null;
      },
      (sel) => (typeof effectivePinURL === "function" ? effectivePinURL(sel) : ""),
      (sel) => {
        if (typeof resetPinTab === "function") {
          resetPinTab(sel);
        }
      }
    );
  }

  // Window-scoped workspaces (Vivaldi/Zen model): every window has its own
  // workspaces 1-9, and tabs belong to the window they live in. The same
  // workspace id may show in two windows at once — each window renders only
  // the tabs physically in its own strip whose tag (aphWs) matches its
  // current workspace (WIN_KEY). Windows never touch each other's tabs:
  // no pulls, no focus-jumps, no close-time merging. SessionStore saves
  // each window independently, so session restore just works natively.
  // Moving tabs across windows is always explicit ("Move Tab to Other
  // Window" in the palette / tab context menu), retagging arrivals to the
  // destination's current workspace.
  function aphWinId() {
    try {
      if (!window.__aphWinId) {
        window.__aphWinId =
          Math.random().toString(36).slice(2) + Date.now().toString(36);
      }
      return window.__aphWinId;
    } catch (e) {
      return "win";
    }
  }

  // Private windows never join the pool (no shared moves).
  function aphIsPrivateWindow(win) {
    try {
      const target = win || window;
      const pbu = target.PrivateBrowsingUtils || window.PrivateBrowsingUtils;
      if (pbu && typeof pbu.isWindowPrivate === "function") {
        return !!pbu.isWindowPrivate(target);
      }
    } catch (e) {}
    return false;
  }

  function listAphWindows() {
    const out = [];
    try {
      if (typeof Services === "undefined" || !Services.wm) {
        return [window];
      }
      const en = Services.wm.getEnumerator("navigator:browser");
      while (en && typeof en.hasMoreElements === "function" && en.hasMoreElements()) {
        let w = null;
        try {
          w = en.getNext();
        } catch (e) {}
        try {
          if (w && !w.closed && w.gBrowser) {
            out.push(w);
          }
        } catch (e) {}
      }
    } catch (e) {}
    try {
      if (!out.includes(window)) {
        out.push(window);
      }
    } catch (e) {}
    return out;
  }

  // This window's workspace claim: a direct expando on the chrome window is
  // the primary store — synchronous, no SessionStore tracking dependency,
  // and readable from any same-privilege window the moment it is set.
  // SessionStore remains as persistence + restore fallback (extData
  // survives restarts; expandos don't).
  function setWindowWs(target) {
    if (!isValidId(target)) {
      return;
    }
    try {
      window.__aphWsCurrent = target;
    } catch (e) {}
    try {
      SessionStore.setCustomWindowValue(window, WIN_KEY, target);
    } catch (e) {}
  }

  function getWindowWs(win) {
    try {
      const live = win && win.__aphWsCurrent;
      if (isValidId(live)) {
        return live;
      }
    } catch (e) {}
    try {
      const v = SessionStore.getCustomWindowValue(win, WIN_KEY);
      return isValidId(v) ? v : null;
    } catch (e) {
      return null;
    }
  }

  // Candidate destinations for "Move Tab to Other Window": every live
  // window except this one, never across the private boundary.
  // Returns [{ win, ws }] with ws possibly null when the other window's
  // claim is unreadable (callers fall back to its live tab tags then).
  function listWindows() {
    const out = [];
    let selfPrivate = false;
    try {
      selfPrivate = aphIsPrivateWindow(window);
    } catch (e) {}
    let wins = [];
    try {
      wins = listAphWindows();
    } catch (e) {
      return out;
    }
    for (const w of wins) {
      try {
        if (!w || w === window || w.closed || !w.gBrowser) {
          continue;
        }
        try {
          if (!!aphIsPrivateWindow(w) !== !!selfPrivate) {
            continue;
          }
        } catch (e) {}
        let ws = null;
        try {
          ws = getWindowWs(w);
        } catch (e) {}
        out.push({ win: w, ws: isValidId(ws) ? ws : null });
      } catch (e) {}
    }
    return out;
  }

  function readRemoteTabWs(tab) {
    try {
      const v = SessionStore.getCustomTabValue(tab, KEY);
      return isValidId(v) ? v : null;
    } catch (e) {
      return null;
    }
  }

  // Adoption-ghost scrub: closing a tab by adoption records it in the
  // source window's closed-tab list (SessionStore has no adoption
  // exemption), so Ctrl+Shift+T would resurrect a duplicate of the live
  // adopted tab. Immediately after a successful adoption, forget the
  // freshest closed entry — synchronous, so nothing else can interleave.
  // Only for tabs SessionStore would actually record (real, non-internal
  // URLs — blank/newtab closes record nothing, and scrubbing then would
  // eat the user's genuine undo entry). Throws are stop-signals, never
  // retried: an untracked window or empty list means no ghost exists.
  function scrubAdoptionGhost(ownerWin, oldTab) {
    try {
      if (!ownerWin || !oldTab) {
        return;
      }
      try {
        const spec = tabSpec(oldTab);
        if (!spec || isInternalSpec(spec)) {
          return;
        }
      } catch (e) {
        return;
      }
      if (
        !SessionStore ||
        typeof SessionStore.forgetClosedTab !== "function"
      ) {
        return;
      }
      SessionStore.forgetClosedTab(ownerWin, 0);
    } catch (e) {}
  }

  function findTabOwnerWindow(tab) {
    try {
      if (!tab) {
        return null;
      }
      for (const w of listAphWindows()) {
        try {
          if (w && !w.closed && w.gBrowser && w.gBrowser.tabs && w.gBrowser.tabs.includes(tab)) {
            return w;
          }
        } catch (e) {}
      }
    } catch (e) {}
    return null;
  }

  // Adoption swaps in a NEW tab element in the destination
  // (Tabbrowser.sys.mjs: adoptTab(aTab, {tabIndex, selectTab}) fires
  // TabOpen with detail.adoptedTab there and closes the source tab).
  // Returns the new tab, or null. Callers must work with the returned
  // element — never the (now closed) source.
  function adoptOneTab(tab, destBrowser) {
    try {
      if (!tab || tab.closing || tab.pinned) {
        return null;
      }
      const gb = destBrowser || gBrowser;
      if (!gb || typeof gb.adoptTab !== "function") {
        return null;
      }
      let ownerWin = null;
      try {
        ownerWin = findTabOwnerWindow(tab);
      } catch (e) {}
      let index = 0;
      try {
        index = (gb.tabs && gb.tabs.length) || 0;
      } catch (e) {}
      let nt = null;
      try {
        nt = gb.adoptTab(tab, { tabIndex: index }) || null;
      } catch (e) {}
      if (!nt) {
        try {
          nt = gb.adoptTab(tab) || null;
        } catch (_e) {}
      }
      if (nt && ownerWin) {
        scrubAdoptionGhost(ownerWin, tab);
      }
      return nt;
    } catch (e) {
      return null;
    }
  }

  // Lowest workspace no live window (other than this one) claims. Only a
  // new-window placement hint now — windows no longer de-dupe, so any
  // collision is harmless (independent tab sets).
  function lowestUnownedWorkspace() {
    try {
      const owned = new Set();
      if (!aphIsPrivateWindow(window)) {
        for (const w of listAphWindows()) {
          try {
            if (!w || w.closed || aphIsPrivateWindow(w)) {
              continue;
            }
            const ws = w === window ? null : getWindowWs(w);
            if (isValidId(ws)) {
              owned.add(ws);
            }
          } catch (e) {}
        }
      }
      for (let i = 1; i <= 9; i++) {
        const id = String(i);
        if (!owned.has(id)) {
          return id;
        }
      }
    } catch (e) {}
    return null;
  }

  // Browser-Console diagnosis (Ctrl+Shift+J):
  //   Services.wm.getMostRecentWindow("navigator:browser").AphWorkspaces.debugExclusive()
  // Shows this window's claim (restore fallback included).
  function debugExclusive() {
    const out = { winId: null, current: null };
    try {
      out.winId = aphWinId();
    } catch (e) {}
    try {
      out.current = isValidId(current) ? current : null;
    } catch (e) {}
    return out;
  }

  // Session forensics (Browser Console, Ctrl+Shift+J):
  //   Services.wm.getMostRecentWindow("navigator:browser").AphWorkspaces.debugSession()
  // Run BEFORE closing windows and AFTER restore, then diff: this window
  // with its workspace claim and per-tab tag/visibility/pinned/pending
  // state. Answers "was it snapshotted?" vs "did restore drop it?".
  // (Pool-wide enumeration is gone with exclusive ownership; use one
  // capture per window.)
  function debugSession() {
    const out = [];
    try {
      const rec = { ws: null, self: true, tabs: [] };
      try {
        rec.ws = getWindowWs(window);
      } catch (e) {}
      let tabs = [];
      try {
        tabs = Array.from(gBrowser.tabs || []);
      } catch (e) {}
      for (const t of tabs) {
        const r = {};
        try {
          r.label = String(t.label || "").slice(0, 60);
        } catch (e) {
          r.label = "?";
        }
        try {
          r.spec = String(
            (t.linkedBrowser && t.linkedBrowser.currentURI && t.linkedBrowser.currentURI.spec) || "?"
          ).slice(0, 80);
        } catch (e) {
          r.spec = "?";
        }
        try {
          r.ws = readRemoteTabWs(t);
        } catch (e) {
          r.ws = null;
        }
        for (const k of ["hidden", "pinned", "selected", "closing"]) {
          try {
            r[k] = !!t[k];
          } catch (e) {}
        }
        try {
          r.pending = !!(t.hasAttribute && t.hasAttribute("pending"));
        } catch (e) {}
        rec.tabs.push(r);
      }
      out.push(rec);
    } catch (e) {}
    return out;
  }

  function tabSpec(t) {
    try {
      const s = t && t.linkedBrowser && t.linkedBrowser.currentURI && t.linkedBrowser.currentURI.spec;
      return typeof s === "string" ? s : "";
    } catch (e) {
      return "";
    }
  }

  function isInternalSpec(spec) {
    try {
      const s = String(spec || "").toLowerCase();
      return (
        s.startsWith("about:") ||
        s.startsWith("chrome:") ||
        s.startsWith("resource:")
      );
    } catch (e) {
      return true;
    }
  }
  // Workspace indicator: number, or "N: name" pill once named. Click
  // renames via the command palette (no popover exists — this is the
  // mouse path). The `data-aph-ws` attribute on tabContainer already
  // existed but nothing rendered it — this badge does.
  function ensureIndicator() {
    try {
      let el = document.getElementById("aph-ws-indicator");
      if (el) {
        return el;
      }
      const navBar = document.getElementById("nav-bar");
      if (!navBar) {
        return null;
      }
      el = document.createElement("div");
      el.id = "aph-ws-indicator";
      el.textContent = isValidId(current) ? current : "1";
      el.title = "Workspace (Alt+Shift+1..9, ]/[ to cycle, Tab for last)";
      try {
        el.addEventListener("click", () => {
          try {
            if (window.AphPalette) {
              window.AphPalette.renameCurrent();
            }
          } catch (e) {}
        });
      } catch (e) {}
      navBar.prepend(el);
      return el;
    } catch (e) {
      return null;
    }
  }

  function updateIndicator() {
    try {
      const el = document.getElementById("aph-ws-indicator") || ensureIndicator();
      if (el) {
        const cur = isValidId(current) ? current : "1";
        const name = getWsName(cur);
        el.textContent = name ? `${cur}: ${name}` : cur;
        // Bound container: colored dot + tooltip (theme.css §6 renders the
        // dot from data-aph-bound + --aph-ws-dot). Attribute + var driven
        // so the fixed-height pill never shifts layout, and the filled
        // dot reads on light and dark toolbars alike.
        let title = `Workspace ${cur}${name ? `: ${name}` : ""} (Alt+Shift+1..9 · ]/[ cycle · Tab toggles last · click to rename)`;
        let color = "";
        try {
          const bid = getWsContainerId(cur);
          if (bid) {
            const d = describeContainer(bid);
            if (d && d.name) {
              title = `Workspace ${cur}${name ? `: ${name}` : ""} · ${d.name} container (Ctrl+T opens here · click to rename)`;
            }
            if (d && d.color && CONTAINER_HEX[d.color]) {
              color = CONTAINER_HEX[d.color];
            }
          }
        } catch (e) {}
        try {
          let routed = 0;
          const map = loadRoutes();
          for (const k of Object.keys(map)) {
            if (map[k] === cur) {
              routed++;
            }
          }
          if (routed) {
            title += ` · ${routed} routed domain${routed === 1 ? "" : "s"}`;
          }
        } catch (e) {}
        el.title = title;
        try {
          if (color) {
            // Var first: if the style write throws (minimal stubs), the
            // attribute never lands and no var-less dot renders.
            el.style.setProperty("--aph-ws-dot", color);
            el.setAttribute("data-aph-bound", "1");
          } else {
            el.removeAttribute("data-aph-bound");
            el.style.removeProperty("--aph-ws-dot");
          }
        } catch (e) {}
      }
      // Dock repaints with the badge: switch/rename/bind/pref-sync covered.
      // Tab open/close/restore/pin call renderDock from their own handlers.
      try {
        renderDock();
      } catch (e) {}
    } catch (e) {}
  }

  // Crimson pulse timer for the workspace indicator (200ms flash).
  let wsPulseTimer = null;
  // Handles for process-global registrations owned by this window. Prefs /
  // progress / obs observers are held strongly by their service, so each
  // must be released on unload or the closed window (document, gBrowser,
  // tabs) leaks via the observer closure until process exit.
  let bindingObserver = null;
  let routeObserver = null;
  let nameObserver = null;
  let startupRestoreObserver = null;
  let navPopupObserver = null;
  // Original window.BrowserOpenTab, captured before initBoundNewTab wraps
  // it so + button / menu births land in the bound container. Restored on
  // unload (cleanupWindowObservers).
  let origBrowserOpenTab = null;
  function pulseWorkspaceIndicator() {
    try {
      const el = gBrowser.tabContainer;
      el.setAttribute("data-aph-ws-pulse", "1");
      const badge = document.getElementById("aph-ws-indicator");
      if (badge) {
        badge.setAttribute("data-aph-ws-pulse", "1");
      }
      if (wsPulseTimer) {
        clearTimeout(wsPulseTimer);
      }
      wsPulseTimer = setTimeout(() => {
        try {
          el.removeAttribute("data-aph-ws-pulse");
        } catch (e) {}
        try {
          if (badge) {
            badge.removeAttribute("data-aph-ws-pulse");
          }
        } catch (e) {}
        wsPulseTimer = null;
      }, 200);
    } catch (e) {}
  }

  // Switch animation: fade incoming tabs in after the synchronous
  // hidden-attribute swap. A leave-side tab fade is impossible here — the
  // whole switch commits in one task, so a leave frame would never paint
  // (splitting the commit async would break every sync visibility
  // assertion for a 100ms cosmetic). Instead the CARD dips (§24
  // .aph-ws-dip via dipWorkspaceCard below): the synchronous swap reads
  // as a dissolve rather than a blink, with zero visibility-semantics
  // change. Pins are global (never change) so they are excluded.
  // Fail-silent throughout (test tabs have no classList, which just
  // no-ops; test documents return null for the card, also a no-op).
  function animateIncomingTabs(tabs) {
    let animated = null;
    try {
      for (const t of tabs || []) {
        try {
          if (!t || t.closing || t.pinned) {
            continue;
          }
          if (t.hidden) {
            continue;
          }
          if (typeof t.hasAttribute === "function" && t.hasAttribute("hidden")) {
            continue;
          }
          if (!t.classList || typeof t.classList.add !== "function") {
            continue;
          }
          t.classList.add("aph-ws-enter");
          (animated = animated || []).push(t);
        } catch (e) {}
      }
    } catch (e) {}
    if (!animated) {
      return;
    }
    try {
      setTimeout(() => {
        try {
          for (const t of animated) {
            try {
              t.classList.remove("aph-ws-enter");
            } catch (e) {}
          }
        } catch (e) {}
      }, 200);
    } catch (e) {}
  }

  // Card dip dissolve (§24): called after reconcile's synchronous swap.
  // Adds .aph-ws-dip to #tabbrowser-tabbox (100ms dip to 0.45) and
  // removes it on a 120ms timer (180ms glide back). Retrigger-safe: a
  // mid-dip switch clears the pending removal and re-arms, so mashing
  // workspaces never sticks the card dim. Skipped under
  // prefers-reduced-motion. Visual only — no visibility semantics, so
  // sync tests observe nothing (their document stub returns null here).
  let wsDipTimer = null;
  function dipWorkspaceCard() {
    try {
      if (
        typeof window.matchMedia === "function" &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches
      ) {
        return;
      }
    } catch (e) {}
    let box = null;
    try {
      box = document.getElementById("tabbrowser-tabbox");
    } catch (e) {}
    if (!box || !box.classList || typeof box.classList.add !== "function") {
      return;
    }
    try {
      if (wsDipTimer) {
        clearTimeout(wsDipTimer);
        wsDipTimer = null;
      }
    } catch (e) {}
    try {
      box.classList.add("aph-ws-dip");
    } catch (e) {
      return;
    }
    try {
      wsDipTimer = setTimeout(() => {
        wsDipTimer = null;
        try {
          box.classList.remove("aph-ws-dip");
        } catch (e) {}
      }, 120);
    } catch (e) {}
  }

  // Local-only switch: show `target` in this window. `switchTo` is local
  // too; this entry exists for callers that already claimed (startup
  // restore) and for console use. Returns "local"/"noop" so console
  // callers can confirm what ran (no UI effect).
  function switchLocal(target) {
    if (!isValidId(target) || target === current) {
      return "noop";
    }
    beginWorkspaceSwitch(target);
    finishWorkspaceSwitch(target);
    return "local";
  }

  // Window-level workspace stamp: mirrors the tabContainer claim onto
  // documentElement so theme.css can tint per workspace
  // (:root[data-aph-ws="N"] -> --aph-ws-accent, §20). try/catch like the
  // tabContainer stamp — paint must never break a switch.
  function stampWindowWs(target) {
    try {
      document.documentElement.setAttribute("data-aph-ws", target);
    } catch (e) {}
  }

  // Commit this window's claim first: current + WIN_KEY + indicator. The
  // adopted-tab handler stamps arrivals to `current`, so the claim must
  // precede any pull — otherwise pulled tabs land in the old workspace.
  function beginWorkspaceSwitch(target) {
    if (!isValidId(target) || target === current) {
      return;
    }
    let tabs = [];
    try {
      tabs = Array.from(gBrowser.tabs);
    } catch (e) {}
    rememberCurrent(tabs);
    lastUsed = current;
    current = target;
    try {
      gBrowser.tabContainer.setAttribute("data-aph-ws", target);
    } catch (e) {}
    stampWindowWs(target);
    updateIndicator();
    pulseWorkspaceIndicator();
    try {
      if (typeof setWindowWs === "function") {
        setWindowWs(target);
      } else {
        SessionStore.setCustomWindowValue(window, WIN_KEY, target);
      }
    } catch (e) {}
  }

  // Settle visibility after the claim (and any pull): fresh tab snapshot
  // so adopted tabs reconcile in the same pass.
  function finishWorkspaceSwitch(target) {
    if (!isValidId(target)) {
      return;
    }
    let tabs = [];
    try {
      tabs = Array.from(gBrowser.tabs);
    } catch (e) {}
    anchorAllGroups();
    reconcile(target, tabs);
    dipWorkspaceCard();
    pruneExtraNewTabs(target);
    // Fresh snapshot: reconcile may have opened a tab for an empty
    // workspace, which the stale list above would miss.
    try {
      animateIncomingTabs(Array.from(gBrowser.tabs));
    } catch (e) {}
    // Pinned tabs match the viewed workspace (not their dormant tag), so
    // every switch re-syncs markers; unpinned matches are tag-stable and
    // the pass is a cheap no-op for them.
    try {
      if (typeof syncAllTabChrome === "function") {
        syncAllTabChrome();
      }
    } catch (e) {}
    // Deferred so the switch stays snappy; guards re-check at fire time.
    try {
      if (getUnloadOnSwitch()) {
        setTimeout(() => {
          try {
            unloadEligibleTabs({ scope: "foreign" });
          } catch (e) {}
        }, 0);
      }
    } catch (e) {}
    // Auto-archive (opt-in pref, default off — archive.js owns the pref
    // read, eligibility and timing): each switch (re-)arms a 15 s settle
    // timer there, so the sweep fires only once you've sat still; V1 has
    // no staleness threshold and every eligible hidden-workspace tab goes.
    try {
      const arc = window.AphArchive;
      if (arc && typeof arc.scheduleAutoSweep === "function") {
        arc.scheduleAutoSweep();
      }
    } catch (e) {}
  }

  // Window-scoped entry: every keyboard/dock/palette path funnels here.
  // Each window switches purely locally — other windows are never
  // consulted, pulled from, or focused. A workspace with no local tabs
  // opens a fresh tab via reconcile; same-id workspaces elsewhere are
  // independent tab sets. Returns "switched"/"local"/"noop" for console
  // diagnosis (callers ignore it).
  function switchTo(target) {
    if (!isValidId(target) || target === current) {
      return "noop";
    }
    try {
      if (typeof beginWorkspaceSwitch === "function") {
        beginWorkspaceSwitch(target);
      }
    } catch (e) {}
    try {
      if (typeof finishWorkspaceSwitch === "function") {
        finishWorkspaceSwitch(target);
      } else {
        switchLocal(target);
      }
    } catch (e) {}
    return "switched";
  }

  // Explicit cross-window move ("Move Tab to Other Window"): adopt each tab
  // into `destWin` and retag arrivals to the destination's current
  // workspace (confirmed semantics — arrivals join what the other window
  // shows). Whole native groups stay joined when the move covers the whole
  // group; partial moves eject like local sends. Pinned tabs never move
  // (app anchors don't duplicate). Never crosses the private boundary.
  // With no explicit set, the live selection moves (palette path).
  // Returns the moved count.
  function moveTabsToWindow(destWin, moveSet) {
    try {
      if (!destWin || destWin.closed || !destWin.gBrowser) {
        return 0;
      }
      let set = moveSet;
      try {
        if ((!set || !set.length) && typeof resolveSendBase === "function") {
          set = resolveSendBase(null);
        }
      } catch (e) {}
      let selfPrivate = false;
      try {
        selfPrivate =
          typeof aphIsPrivateWindow === "function" && aphIsPrivateWindow(window);
      } catch (e) {}
      try {
        if (
          typeof aphIsPrivateWindow === "function" &&
          !!aphIsPrivateWindow(destWin) !== !!selfPrivate
        ) {
          try {
            pulseWorkspaceIndicator();
          } catch (_e) {}
          return 0;
        }
      } catch (e) {}
      const moving = [];
      try {
        const live = new Set(Array.from(gBrowser.tabs || []));
        for (const t of set || []) {
          if (t && !t.closing && !t.pinned && live.has(t)) {
            moving.push(t);
          }
        }
      } catch (e) {}
      if (!moving.length) {
        return 0;
      }
      let destWs = null;
      try {
        const dw = destWin.AphWorkspaces;
        if (dw && typeof dw.getCurrent === "function") {
          const c = dw.getCurrent();
          if (isValidId(c)) {
            destWs = c;
          }
        }
      } catch (e) {}
      if (!destWs) {
        try {
          destWs = getWindowWs(destWin);
        } catch (e) {}
      }
      if (!isValidId(destWs)) {
        return 0;
      }
      // Whole-group preservation mirrors the local send rule.
      const movingSet = new Set(moving);
      let preserved = null;
      try {
        preserved = preservedSendGroups(moving);
      } catch (e) {
        preserved = new Set();
      }
      for (const tab of moving) {
        try {
          if (!tab.group) {
            continue;
          }
          let keep = false;
          try {
            keep = preserved && preserved.has(tab.group);
          } catch (e) {}
          if (!keep) {
            gBrowser.ungroupTab(tab);
          }
        } catch (e) {}
      }
      let moved = 0;
      for (const t of moving) {
        try {
          if (!t || t.closing || t.pinned) {
            continue;
          }
          let nt = null;
          try {
            if (typeof destWin.gBrowser.adoptTab === "function") {
              let idx = 0;
              try {
                idx = (destWin.gBrowser.tabs && destWin.gBrowser.tabs.length) || 0;
              } catch (e) {}
              try {
                nt = destWin.gBrowser.adoptTab(t, { tabIndex: idx }) || null;
              } catch (e) {
                try {
                  nt = destWin.gBrowser.adoptTab(t) || null;
                } catch (_e) {}
              }
            }
          } catch (e) {}
          if (!nt) {
            continue;
          }
          moved++;
          try {
            if (typeof scrubAdoptionGhost === "function") {
              scrubAdoptionGhost(window, t);
            }
          } catch (e) {}
          try {
            setWs(nt, destWs);
          } catch (e) {}
        } catch (e) {}
      }
      try {
        if (moved > 0 && typeof aphTabsLog === "function") {
          aphTabsLog(`move-to-window ws=${destWs} moved=${moved}`);
        }
      } catch (_e) {}
      try {
        const dw = destWin.AphWorkspaces;
        if (dw && typeof dw.renderDock === "function") {
          dw.renderDock();
        }
      } catch (e) {}
      try {
        reconcile(current, Array.from(gBrowser.tabs));
        pruneExtraNewTabs(current);
      } catch (e) {}
      try {
        if (typeof renderDock === "function") {
          renderDock();
        }
      } catch (e) {}
      return moved;
    } catch (e) {
      return 0;
    }
  }

  // Cycling: "active" = has a live unpinned tab (pins are global with a
  // dormant tag, so they don't count); current always counts so an empty
  // workspace never strands you. Sorted so next/prev wrap deterministically.
  function getActiveIds() {
    const seen = new Set();
    try {
      for (const t of Array.from(gBrowser.tabs || [])) {
        try {
          if (t.closing || t.pinned) {
            continue;
          }
          const w = getWs(t);
          if (isValidId(w)) {
            seen.add(w);
          }
        } catch (e) {}
      }
    } catch (e) {}
    if (isValidId(current)) {
      seen.add(current);
    }
    return [...seen].sort();
  }

  function cycleWorkspace(dir) {
    const ids = getActiveIds();
    if (ids.length < 2) {
      return;
    }
    const i = ids.indexOf(isValidId(current) ? current : "1");
    switchTo(ids[(i + dir + ids.length) % ids.length]);
  }

  function toggleLastWorkspace() {
    if (isValidId(lastUsed) && lastUsed !== current) {
      switchTo(lastUsed);
    }
  }

  // Send family helpers: native groups move as units, single tabs move
  // as-is. `preservedSendGroups` keeps membership when the move covers a
  // whole group (no ungroup); partial moves eject as before.
  // `executeWorkspaceSend` is the shared core: eject non-preserved members,
  // then retag the whole set.
  function dedupTabs(tabs) {
    const out = [];
    const seen = new Set();
    try {
      for (const t of tabs || []) {
        try {
          if (t && !t.closing && !seen.has(t)) {
            seen.add(t);
            out.push(t);
          }
        } catch (e) {}
      }
    } catch (e) {}
    return out;
  }

  function collectGroupFamily(baseTabs) {
    const out = [];
    const seen = new Set();
    try {
      const groups = new Set();
      for (const t of baseTabs || []) {
        try {
          if (t && !t.closing && t.group) {
            groups.add(t.group);
          }
        } catch (e) {}
      }
      if (!groups.size) {
        return dedupTabs(baseTabs);
      }
      const members = [];
      for (const g of groups) {
        let ms = [];
        try {
          ms = typeof groupMembers === "function" ? groupMembers(g) : [];
        } catch (e) {
          ms = [];
        }
        for (const m of ms || []) {
          try {
            if (m && !m.closing && !seen.has(m)) {
              seen.add(m);
              members.push(m);
            }
          } catch (e) {}
        }
      }
      return members.length ? members : dedupTabs(baseTabs);
    } catch (e) {}
    return dedupTabs(baseTabs);
  }

  function preservedSendGroups(moveSet) {
    const preserved = new Set();
    try {
      let groups = [];
      try {
        groups = gBrowser.tabGroups || [];
      } catch (e) {
        return preserved;
      }
      const moving = new Set(moveSet || []);
      for (const g of groups || []) {
        let members = [];
        try {
          members =
            typeof groupMembers === "function"
              ? groupMembers(g).filter((t) => !t.pinned)
              : [];
        } catch (e) {
          members = [];
        }
        if (!members.length) {
          continue;
        }
        let allMoving = true;
        for (const m of members) {
          try {
            if (!moving.has(m)) {
              allMoving = false;
              break;
            }
          } catch (e) {
            allMoving = false;
            break;
          }
        }
        if (allMoving) {
          preserved.add(g);
        }
      }
    } catch (e) {}
    return preserved;
  }

  function executeWorkspaceSend(target, moveSet) {
    if (!isValidId(target) || !moveSet || !moveSet.length) {
      return false;
    }
    // Window-scoped: every send retags locally. Other windows showing the
    // same id are independent tab sets and are never touched.
    const moving = new Set();
    try {
      for (const t of moveSet) {
        if (t && !t.closing) {
          moving.add(t);
        }
      }
    } catch (e) {}
    if (!moving.size) {
      return false;
    }
    const list = Array.from(moving);
    let preserved = null;
    try {
      preserved = preservedSendGroups(list);
    } catch (e) {
      preserved = new Set();
    }
    // Eject partial-group members; whole groups stay joined so membership
    // survives the retag.
    for (const tab of list) {
      try {
        if (!tab.group) {
          continue;
        }
        let keep = false;
        try {
          keep = preserved && preserved.has(tab.group);
        } catch (e) {}
        if (!keep) {
          gBrowser.ungroupTab(tab);
        }
      } catch (e) {}
    }
    for (const tab of list) {
      try {
        setWs(tab, target);
      } catch (e) {}
    }
    try {
      if (typeof aphTabsLog === "function") {
        aphTabsLog(`send ws=${target} moved=${list.length}`);
      }
    } catch (_e) {}
    anchorAllGroups();
    try {
      reconcile(current, Array.from(gBrowser.tabs));
      pruneExtraNewTabs(current);
    } catch (e) {}
    // Dock counts are tag-based: repaint so pill counts follow the move
    // immediately (drag-mode expansion collapses on dragend).
    try {
      if (typeof renderDock === "function") {
        renderDock();
      }
    } catch (e) {}
    return true;
  }

  function resolveSendBase(explicit) {
    let tabs = [];
    // Explicit drag set wins (dock DnD): dragging an unselected tab must
    // move that tab, not whatever happens to be selected. Keyboard/palette
    // callers pass nothing and keep the live-selection behavior below.
    try {
      if (Array.isArray(explicit)) {
        try {
          const live = new Set(Array.from(gBrowser.tabs || []));
          tabs = explicit.filter((t) => t && !t.closing && live.has(t));
        } catch (e) {
          tabs = explicit.filter((t) => t && !t.closing);
        }
      } else if (explicit && !explicit.closing) {
        // Single explicit tab (drag or caller): liveness filtering needs
        // the strip, which may itself throw — either way it moves alone.
        tabs = [explicit];
      }
    } catch (e) {}
    if (!tabs.length) {
      try {
        const multi = gBrowser.selectedTabs || gBrowser.multiselectedTabs || [];
        tabs = Array.from(multi).filter((t) => t && !t.closing);
      } catch (e) {}
    }
    if (!tabs.length) {
      try {
        const sel = gBrowser.selectedTab;
        if (sel && !sel.closing) {
          tabs = [sel];
        }
      } catch (e) {}
    }
    return tabs;
  }

  // Send the multiselection (Ctrl+click) to WS N and stay; with no
  // multiselection this is just the active tab. The selection moves as-is.
  // Native groups stay joined when the move covers
  // the whole group; partial moves eject as before (groups are single-WS).
  // Pinned tabs are global so sent pins stay visible; their tags are dormant
  // state applied on eventual unpin. Sent tabs keep their containers
  // (containers are immutable per tab), and position; bindings only affect
  // newly opened tabs.
  function sendTabTo(target, explicit) {
    if (!isValidId(target) || target === current) {
      return;
    }
    const base = resolveSendBase(explicit);
    if (!base.length) {
      return;
    }
    executeWorkspaceSend(target, base);
  }

  // Explicit native-group move: every tab in the containing group(s)
  // travels together with membership intact.
  // Ungrouped tabs move as-is.
  function sendGroupTo(target, explicit) {
    if (!isValidId(target) || target === current) {
      return;
    }
    const base = resolveSendBase(explicit);
    if (!base.length) {
      return;
    }
    executeWorkspaceSend(target, collectGroupFamily(base));
  }

  // Tab context-menu "Move to Workspace" submenus: the mouse-first path for
  // moving tabs and native groups across workspaces. Two variants
  // share one target-resolution rule (clicked tab wins; its live
  // multiselection rides along when the click belongs to it):
  // - "Move Tab(s) to Workspace >" — always shown, calls sendTabTo (which
  //   preserves whole groups).
  // - "Move Group to Workspace >" — only when the clicked tab sits in a
  //   native group of 2+; calls sendGroupTo (whole group, membership kept).
  // Labels carry workspace names + bound-container suffixes (palette wsFull
  // pattern, reimplemented here — the palette bundle is a separate scope).
  // XUL hosts need createXULElement (HTML-namespaced duds never render);
  // everything fails silent so a missing tabContextMenu never breaks chrome.
  // popupshowing BUBBLES from nested menupopups: only handle showings that
  // originate on our own menupopup (dock-menu pattern).
  let moveMenuItems = [];

  function clearMoveMenu() {
    try {
      for (const it of moveMenuItems) {
        try {
          if (it && it.parentNode) {
            it.parentNode.removeChild(it);
          } else if (it && typeof it.remove === "function") {
            it.remove();
          }
        } catch (err) {}
      }
    } catch (err) {}
    moveMenuItems = [];
  }

  function moveMenuClickedTab(e) {
    try {
      const popup = e && (e.currentTarget || e.target);
      const node =
        (popup && popup.triggerNode) ||
        (typeof document !== "undefined" && document.popupNode) ||
        null;
      if (node) {
        try {
          const direct =
            node.tab ||
            (typeof node.closest === "function" ? node.closest("tab") : null);
          if (direct) {
            return direct;
          }
        } catch (err) {}
        // Group-label right-click (or any group chrome): resolve to the
        // group's first live member so the Group variant still surfaces.
        try {
          const grp =
            typeof node.closest === "function"
              ? node.closest("tab-group")
              : null;
          if (grp) {
            let ms = [];
            try {
              ms =
                typeof groupMembers === "function"
                  ? groupMembers(grp)
                  : grp.tabs || [];
            } catch (err) {
              ms = [];
            }
            for (const m of ms || []) {
              if (m && !m.closing) {
                return m;
              }
            }
          }
        } catch (err) {}
      }
      if (gBrowser && gBrowser.selectedTab) {
        return gBrowser.selectedTab;
      }
    } catch (err) {}
    return null;
  }

  function moveMenuSelectedTabs(clicked) {
    try {
      if (clicked) {
        try {
          let sel = [];
          try {
            const multi =
              (gBrowser &&
                (gBrowser.selectedTabs || gBrowser.multiselectedTabs)) ||
              null;
            if (Array.isArray(multi) && multi.length) {
              sel = multi.slice();
            } else if (gBrowser && gBrowser.selectedTab) {
              sel = [gBrowser.selectedTab];
            }
          } catch (e) {}
          if (sel.length > 1) {
            try {
              if (sel.includes(clicked)) {
                const live = new Set(Array.from(gBrowser.tabs || []));
                return sel.filter((t) => t && !t.closing && live.has(t));
              }
            } catch (e) {}
          }
        } catch (e) {}
        return [clicked];
      }
    } catch (e) {}
    return [];
  }

  function moveMenuWsLabel(id) {
    try {
      let s = `Workspace ${id}`;
      try {
        const name =
          typeof getWsName === "function" ? getWsName(id) : "";
        if (name) {
          s += ` (${name})`;
        }
      } catch (e) {}
      try {
        if (
          typeof getWsContainerId === "function" &&
          typeof describeContainer === "function"
        ) {
          const bid = getWsContainerId(id);
          if (bid) {
            const d = describeContainer(bid);
            if (d && d.name) {
              s += ` · ${d.name}`;
            }
          }
        }
      } catch (e) {}
      return s;
    } catch (e) {
      return `Workspace ${id}`;
    }
  }

  function makeMoveMenuNode(tag, id, label, disabled) {
    try {
      const el =
        typeof document.createXULElement === "function"
          ? document.createXULElement(tag)
          : document.createElement(tag);
      el.id = id;
      try {
        el.setAttribute("label", label);
      } catch (e) {}
      if (disabled) {
        try {
          el.setAttribute("disabled", "true");
        } catch (e) {}
      }
      return el;
    } catch (e) {
      return null;
    }
  }

  function moveMenuGroupOf(tab) {
    try {
      const g = (tab && tab.group) || null;
      if (!g) {
        return null;
      }
      let members = [];
      try {
        members =
          typeof groupMembers === "function" ? groupMembers(g) : g.tabs || [];
      } catch (e) {
        members = [];
      }
      members = (members || []).filter((t) => t && !t.closing);
      if (members.length < 2) {
        return null;
      }
      return { group: g, members };
    } catch (e) {
      return null;
    }
  }

  function appendMoveSubmenu(menu, topId, topLabel, targets, runner) {
    try {
      const sub = makeMoveMenuNode("menu", topId, topLabel, false);
      if (!sub) {
        return null;
      }
      const popup =
        typeof document.createXULElement === "function"
          ? document.createXULElement("menupopup")
          : document.createElement("menupopup");
      if (!popup || typeof popup.appendChild !== "function") {
        return null;
      }
      let cur = null;
      try {
        cur = isValidId(current) ? current : null;
      } catch (e) {}
      for (let i = 1; i <= 9; i++) {
        const id = String(i);
        const item = makeMoveMenuNode(
          "menuitem",
          `${topId}-${id}`,
          moveMenuWsLabel(id),
          cur ? id === cur : false
        );
        if (!item) {
          continue;
        }
        if (typeof item.addEventListener === "function") {
          item.addEventListener("command", () => {
            try {
              runner(id, targets);
            } catch (err) {}
          });
        }
        try {
          popup.appendChild(item);
        } catch (e) {}
      }
      try {
        sub.appendChild(popup);
      } catch (e) {
        return null;
      }
      try {
        menu.appendChild(sub);
        moveMenuItems.push(sub);
      } catch (e) {
        return null;
      }
      return sub;
    } catch (e) {
      return null;
    }
  }

  function onMoveMenuShowing(e) {
    try {
      const menu = (e && (e.currentTarget || e.target)) || null;
      if (!menu || typeof menu.appendChild !== "function") {
        return;
      }
      try {
        if (!e || e.target !== menu) {
          return;
        }
      } catch (err) {
        return;
      }
      clearMoveMenu();
      const clicked = moveMenuClickedTab(e);
      if (!clicked || clicked.closing) {
        return;
      }
      const targets = moveMenuSelectedTabs(clicked).filter(
        (t) => t && !t.closing
      );
      if (!targets.length) {
        return;
      }
      const n = targets.length;
      const tabLabel =
        n > 1 ? `Move ${n} Tabs to Workspace` : "Move Tab to Workspace";
      try {
        appendMoveSubmenu(menu, "aph-move-tab", tabLabel, targets.slice(), (id, ts) => {
          try {
            if (typeof sendTabTo === "function") {
              sendTabTo(id, ts.length === 1 ? ts[0] : ts.slice());
            }
          } catch (err) {}
        });
      } catch (err) {}
      // Group variant: only when the clicked tab sits in a real group.
      try {
        const info = moveMenuGroupOf(clicked);
        if (info) {
          const gLabel = `Move Group (${info.members.length} Tabs) to Workspace`;
          appendMoveSubmenu(menu, "aph-move-group", gLabel, [clicked], (id, ts) => {
            try {
              if (typeof sendGroupTo === "function") {
                sendGroupTo(id, ts[0]);
              } else if (typeof sendTabTo === "function") {
                sendTabTo(id, info.members.slice());
              }
            } catch (err) {}
          });
        }
      } catch (err) {}
      // Window variant: explicit cross-window move (window-scoped model —
      // the only path that touches another window). Arrivals join the
      // destination's current workspace.
      try {
        if (
          typeof listWindows === "function" &&
          typeof moveTabsToWindow === "function"
        ) {
          const others = listWindows();
          if (others && others.length) {
            const sub = makeMoveMenuNode(
              "menu",
              "aph-move-window",
              n > 1 ? `Move ${n} Tabs to Other Window` : "Move Tab to Other Window",
              false
            );
            if (sub) {
              const popup =
                typeof document.createXULElement === "function"
                  ? document.createXULElement("menupopup")
                  : document.createElement("menupopup");
              if (popup && typeof popup.appendChild === "function") {
                for (const o of others) {
                  try {
                    let wsLabel = "";
                    try {
                      wsLabel = o && isValidId(o.ws) ? o.ws : "?";
                      const nm =
                        typeof getWsName === "function" && isValidId(o.ws)
                          ? getWsName(o.ws)
                          : "";
                      if (nm) {
                        wsLabel += ` (${nm})`;
                      }
                    } catch (err) {}
                    const item = makeMoveMenuNode(
                      "menuitem",
                      "aph-move-window-ws",
                      `Workspace ${wsLabel}`,
                      false
                    );
                    if (!item) {
                      continue;
                    }
                    if (typeof item.addEventListener === "function") {
                      const dest = o.win;
                      const moving = targets.slice();
                      item.addEventListener("command", () => {
                        try {
                          moveTabsToWindow(dest, moving);
                        } catch (err) {}
                      });
                    }
                    try {
                      popup.appendChild(item);
                    } catch (err) {}
                  } catch (err) {}
                }
                try {
                  sub.appendChild(popup);
                } catch (err) {}
                try {
                  menu.appendChild(sub);
                  moveMenuItems.push(sub);
                } catch (err) {}
              }
            }
          }
        }
      } catch (err) {}
    } catch (err) {}
  }

  function cleanupMoveMenu() {
    try {
      clearMoveMenu();
    } catch (e) {}
    try {
      const menu = document.getElementById("tabContextMenu");
      if (menu) {
        menu.removeEventListener("popupshowing", onMoveMenuShowing);
      }
    } catch (e) {}
  }

  function initMoveMenu() {
    try {
      const menu = document.getElementById("tabContextMenu");
      if (menu && typeof menu.addEventListener === "function") {
        menu.addEventListener("popupshowing", onMoveMenuShowing);
      }
    } catch (e) {}
    try {
      window.addEventListener("unload", cleanupMoveMenu, { once: true });
    } catch (e) {}
  }

  if (document.readyState === "complete") {
    initMoveMenu();
  } else {
    window.addEventListener("load", initMoveMenu, { once: true });
  }
  // Workspace dock: mouse-first pills pinned to the bottom of the
  // vertical tab strip. The nav-bar #aph-ws-indicator auto-hides with the
  // top bar, so mouse users get this instead: active workspaces + current
  // + a "+" jump-to-next-empty pill, with container underlines, drag-and-
  // drop retagging, and a right-click menu (rename / bind / unload /
  // close). Zero new prefs; all state reuses tags, names and bindings.
  // Anchor: #vertical-tabs (light-DOM box projected into sidebar-main's
  // tabstrip slot, above the tools area). Horizontal-tabs mode leaves
  // #sidebar-container hidden, so the dock skips itself and the nav-bar
  // indicator remains the only badge. Everything fails silent (house
  // style) so a missing anchor never breaks chrome.
  const DOCK_ID = "aph-ws-dock";
  const DOCK_MENU_ID = "aph-ws-dock-menu";
  // Tab being dragged over the dock (stock tab dataTransfer carries no tab
  // ref, so track dragstart on the shared tab container instead). Group
  // headers drag the whole native group: stock strip lets a <tab-group>
  // label move all its tabs, so the dock tracks that separately.
  let dockDragTab = null;
  let dockDragGroup = null;
  // Drag-mode: while a tab/group drag is in flight the dock expands to all
  // 9 workspaces so any workspace (including empty ones) is a drop target.
  // renderDock() checks this flag; enter/exit helpers re-render. The "+" pill
  // also accepts drops (moves to the lowest inactive workspace).
  let dockDragActive = false;

  function dockTabDragType(e) {
    try {
      const dt = e && e.dataTransfer;
      if (!dt) {
        return false;
      }
      // Chrome-privileged tab-drag identity (browser.xhtml runs as chrome,
      // so moz* APIs are visible here — unlike content, where bug 1345591
      // hides them). This is the same check the strip's own
      // getDropEffectForTabDrag uses: first type must be TAB_DROP_TYPE.
      try {
        if (typeof dt.mozItemCount === "number" && dt.mozItemCount > 0 &&
            typeof dt.mozTypesAt === "function") {
          const types = dt.mozTypesAt(0) || [];
          if (types[0] === "application/x-moz-tabbrowser-tab") {
            return true;
          }
        }
      } catch (err) {}
      // Firefox tab DnD carries application/x-moz-tabbrowser-tab (nsDragService).
      // types may be a DOMStringList (contains()) or a plain array (includes()).
      try {
        if (typeof dt.contains === "function" && dt.contains("application/x-moz-tabbrowser-tab")) {
          return true;
        }
      } catch (err) {}
      try {
        const types = dt.types || [];
        for (const t of Array.from(types)) {
          if (t === "application/x-moz-tabbrowser-tab") {
            return true;
          }
        }
      } catch (err) {}
    } catch (e) {}
    return false;
  }

  function isDockDropArmed(e) {
    try {
      if (dockDragTab || dockDragGroup || dockDragActive) {
        return true;
      }
    } catch (err) {}
    try {
      return dockTabDragType(e);
    } catch (err) {
      return false;
    }
  }

  // What will a drop move? Base tabs from resolveDockDragTabs
  // (sendTabTo moves the selection). Used for drop tooltips.
  function dockDropPreview() {
    try {
      const base = resolveDockDragTabs();
      if (!base.length) {
        return { count: 0, kind: "tab" };
      }
      const wasGroup = !!dockDragGroup;
      const seen = new Set();
      for (const t of base) {
        if (t && !t.closing) {
          seen.add(t);
        }
      }
      const count = seen.size;
      let kind = base.length > 1 ? `${base.length} tabs` : "tab";
      if (wasGroup) {
        kind = `group (${count} tab${count === 1 ? "" : "s"})`;
      } else if (base.length > 1) {
        kind = `${count} tabs`;
      } else {
        kind = "tab";
      }
      return { count, kind };
    } catch (e) {
      return { count: 0, kind: "tab" };
    }
  }

  function enterDockDragMode() {
    try {
      if (!dockDragActive) {
        dockDragActive = true;
        renderDock();
      }
    } catch (e) {}
  }

  function exitDockDragMode() {
    try {
      if (dockDragActive) {
        dockDragActive = false;
        renderDock();
      }
    } catch (e) {
      try {
        dockDragActive = false;
      } catch (_e) {}
    }
  }

  // Drop-then-hide ordering: hiding the dragged tab while Firefox's own tab
  // drag session is still active leaves its strip animation (translateY
  // shoves, drop-indicator margins) stranded mid-flight — visible as
  // overlapping tabs, gaps, and tabs pushed past the new-tab button. The
  // strip's own cleanup runs on dragend (finishAnimateTabMove /
  // _resetTabsAfterDrop clear inline styles), so a drop during a live tab
  // drag is recorded here and only executed once dragend has unwound the
  // session. Non-drag callers (tests, palette, context menu) and payloads
  // without a live session keep the synchronous path.
  let dockPendingDrop = null;

  // A live Firefox tab drag parks its state on the dragged tab (_dragData,
  // set by startTabDrag, deleted on dragend). Mocks and non-tab drags never
  // carry it, so they stay synchronous (and existing tests keep passing).
  function isLiveTabDragSession(tabs) {
    try {
      for (const t of tabs || []) {
        try {
          if (t && t._dragData) {
            return true;
          }
        } catch (e) {}
      }
      for (const t of [dockDragTab]) {
        try {
          if (t && t._dragData) {
            return true;
          }
        } catch (e) {}
      }
    } catch (e) {}
    return false;
  }

  function executeDockDrop(dest, dragTabs, wasGroup) {
    try {
      if (!dragTabs || !dragTabs.length || !isValidId(dest)) {
        return false;
      }
      if (dest === current) {
        try {
          pulseWorkspaceIndicator();
        } catch (e) {}
        return false;
      }
      if (wasGroup && typeof sendGroupTo === "function") {
        sendGroupTo(dest, dragTabs);
      } else {
        sendTabTo(dest, dragTabs);
      }
      return true;
    } catch (e) {
      return false;
    }
  }

  function flushDockPendingDrop() {
    let pending = null;
    try {
      pending = dockPendingDrop;
      dockPendingDrop = null;
    } catch (e) {
      pending = null;
    }
    if (!pending) {
      return false;
    }
    try {
      return executeDockDrop(pending.dest, pending.tabs, pending.wasGroup);
    } catch (e) {
      return false;
    }
  }

  function dockAnchor() {
    try {
      const sc = document.getElementById("sidebar-container");
      if (!sc || sc.hidden) {
        return null;
      }
      const box = document.getElementById("vertical-tabs");
      if (!box || box.hidden) {
        return null;
      }
      return box;
    } catch (e) {
      return null;
    }
  }

  function dockMenu() {
    try {
      const m = document.getElementById(DOCK_MENU_ID);
      return m || null;
    } catch (e) {
      return null;
    }
  }

  function dockGlyph(id) {
    try {
      const name = getWsName(id);
      if (name) {
        const first = Array.from(String(name))[0];
        if (first) {
          return first;
        }
      }
    } catch (e) {}
    return id;
  }

  function dockCounts() {
    const counts = Object.create(null);
    try {
      for (const t of Array.from(gBrowser.tabs || [])) {
        try {
          if (!t || t.closing || t.pinned) {
            continue;
          }
          const w = getWs(t);
          if (isValidId(w)) {
            counts[w] = (counts[w] || 0) + 1;
          }
        } catch (e) {}
      }
    } catch (e) {}
    return counts;
  }

  function lowestInactiveId(active) {
    try {
      const seen = new Set(active || []);
      for (let i = 1; i <= 9; i++) {
        const id = String(i);
        if (!seen.has(id)) {
          return id;
        }
      }
    } catch (e) {}
    return null;
  }

  function plusToWorkspace() {
    try {
      const free = lowestInactiveId(getActiveIds());
      if (!free) {
        pulseWorkspaceIndicator();
        return null;
      }
      switchTo(free);
      return openBoundTab("about:newtab", free);
    } catch (e) {
      return null;
    }
  }

  // Close every unpinned tab tagged `id`. Current-workspace closes switch
  // to the nearest other active workspace first (never strand the window
  // tabless: sole-workspace closes abort with a pulse). Pinned tabs are
  // global and always survive.
  function closeWorkspaceTabs(id) {
    try {
      if (!isValidId(id)) {
        return { closed: 0 };
      }
      let doomed = [];
      try {
        doomed = Array.from(gBrowser.tabs || []).filter(
          (t) => t && !t.closing && !t.pinned && getWs(t) === id
        );
      } catch (e) {
        return { closed: 0 };
      }
      if (!doomed.length) {
        return { closed: 0 };
      }
      if (id === current) {
        const others = getActiveIds()
          .filter((x) => x !== id)
          .sort((a, b) => Number(a) - Number(b));
        if (!others.length) {
          pulseWorkspaceIndicator();
          return { closed: 0, reason: "only" };
        }
        // Nearest by numeric distance, ties go up.
        const n = Number(id);
        let best = others[0];
        let bestDist = Math.abs(Number(best) - n);
        for (const cand of others) {
          const dist = Math.abs(Number(cand) - n);
          if (dist < bestDist || (dist === bestDist && Number(cand) > Number(best))) {
            best = cand;
            bestDist = dist;
          }
        }
        switchTo(best);
        try {
          doomed = doomed.filter((t) => t && !t.closing);
        } catch (e) {}
        if (!doomed.length) {
          return { closed: 0 };
        }
      }
      // Selection can never be doomed (doomed tabs are hidden when foreign,
      // and current-closes switch away first) — belt-and-braces anyway.
      try {
        const sel = gBrowser.selectedTab;
        if (sel && doomed.indexOf(sel) !== -1) {
          let survivor = null;
          try {
            const rest = Array.from(gBrowser.tabs || []).filter(
              (t) => t && !t.closing && doomed.indexOf(t) === -1
            );
            survivor =
              rest.find((t) => getWs(t) === current) || rest[0] || null;
          } catch (e) {}
          if (survivor) {
            gBrowser.selectedTab = survivor;
          } else {
            return { closed: 0, reason: "no-survivor" };
          }
        }
      } catch (e) {}
      let closed = 0;
      for (const t of doomed) {
        try {
          if (typeof aphTabsLog === "function") {
            aphTabsLog(`close-workspace ${id} closing ${aphTabDesc(t)}`);
          }
        } catch (e) {}
        try {
          gBrowser.removeTab(t);
          closed++;
        } catch (e) {}
      }
      try {
        renderDock();
      } catch (e) {}
      return { closed };
    } catch (e) {
      return { closed: 0 };
    }
  }

  function makeDockPill(id, isCurrent, count, isEmpty) {
    let pill = null;
    try {
      pill = document.createElement("div");
      pill.className = "aph-ws-pill";
      pill.setAttribute("data-ws", id);
      pill.setAttribute("role", "button");
      if (isCurrent) {
        pill.setAttribute("data-current", "1");
      }
      if (isEmpty) {
        try {
          pill.setAttribute("data-empty", "1");
        } catch (e) {}
      }
      const glyph = dockGlyph(id);
      pill.textContent = glyph;
      // Counts are per-window tab tags — this window's own set.
      if (count > 0) {
        try {
          const badge = document.createElement("span");
          badge.className = "aph-ws-count";
          badge.textContent = String(count);
          pill.appendChild(badge);
        } catch (e) {}
      }
      let title = `Workspace ${id}`;
      try {
        const name = getWsName(id);
        if (name) {
          title += `: ${name}`;
        }
      } catch (e) {}
      if (count > 0) {
        title += ` · ${count} tab${count === 1 ? "" : "s"}`;
      } else if (isEmpty) {
        title += " · empty";
      }
      try {
        const bid = getWsContainerId(id);
        if (bid) {
          const d = describeContainer(bid);
          if (d && d.name) {
            title += ` · ${d.name} container`;
          }
          if (d && d.color && CONTAINER_HEX[d.color]) {
            pill.style.boxShadow = `inset 0 -2px 0 ${CONTAINER_HEX[d.color]}`;
          }
        }
      } catch (e) {}
      // During a tab drag the tooltip previews the move (group aware).
      try {
        if (dockDragActive) {
          if (id === current) {
            pill.title = `${title} — current workspace (drop does nothing)`;
          } else {
            let preview = null;
            try {
              preview = dockDropPreview();
            } catch (e) {}
            const what =
              preview && preview.count > 0
                ? `Drop to move ${preview.kind} here`
                : "Drop to move tab(s) here";
            pill.title = `${title} — ${what}`;
          }
        } else {
          pill.title = `${title} — click to switch, drag tabs here to move, right-click for actions`;
        }
      } catch (e) {
        pill.title = `${title} — click to switch, right-click for actions`;
      }
      try {
        pill.addEventListener("click", () => {
          try {
            if (id === current) {
              pulseWorkspaceIndicator();
              return;
            }
            // Window-scoped: every pill switches locally. Same-id
            // workspaces in other windows are independent tab sets.
            switchTo(id);
          } catch (e) {}
        });
      } catch (e) {}
      try {
        const menu = dockMenu();
        if (menu) {
          // Native path (honored for XUL hosts). Pills are HTML divs, so
          // also open explicitly — preventDefault suppresses the stock
          // toolbar-context-menu from #vertical-tabs either way.
          pill.setAttribute("contextmenu", DOCK_MENU_ID);
          pill.addEventListener("contextmenu", (e) => {
            try {
              e.preventDefault();
              if (typeof e.stopPropagation === "function") {
                e.stopPropagation();
              }
              const m = ensureDockMenu();
              if (!m) {
                return;
              }
              try {
                m.setAttribute("data-ws", id);
              } catch (err) {}
              if (typeof m.openPopupAtScreen === "function") {
                m.openPopupAtScreen(e.screenX, e.screenY, true);
              } else if (typeof m.openPopup === "function") {
                m.openPopup(pill, "after_start", 0, 0, true, false, e);
              }
            } catch (err) {}
          });
        }
      } catch (e) {}
      try {
        const armDrop = (e) => {
          try {
            // Current workspace is never a drop target (send would no-op).
            // Window-scoped: every other pill is local, always a target.
            if (id === current) {
              return false;
            }
            if (!isDockDropArmed(e)) {
              return false;
            }
            e.preventDefault();
            // The dock lives inside #vertical-tabs: without this the strip's
            // own tab-drag handler (handle_dragover, bubble phase) also sees
            // the event and starts its tab-shove animation underneath the
            // dock hover. Shield it so pills are the only drop UI in play.
            try {
              if (typeof e.stopPropagation === "function") {
                e.stopPropagation();
              }
            } catch (err) {}
            try {
              e.dataTransfer.dropEffect = "move";
            } catch (err) {}
            pill.classList.add("drop-target");
            return true;
          } catch (err) {
            return false;
          }
        };
        pill.addEventListener("dragenter", armDrop);
        pill.addEventListener("dragover", armDrop);
        pill.addEventListener("dragleave", () => {
          try {
            pill.classList.remove("drop-target");
          } catch (err) {}
        });
        pill.addEventListener("drop", (e) => {
          try {
            e.preventDefault();
            try {
              if (typeof e.stopPropagation === "function") {
                e.stopPropagation();
              }
            } catch (err) {}
            pill.classList.remove("drop-target");
            if (id === current) {
              try {
                pulseWorkspaceIndicator();
              } catch (err) {}
              return;
            }
            const wasGroup = !!dockDragGroup;
            let dragTabs = [];
            try {
              dragTabs = resolveDockDragTabs();
            } catch (err) {
              dragTabs = [];
            }
            // Tracker missed (e.g. dragstart outside our listener) but the
            // payload is a tab drag: fall back to the live selection so the
            // drop still moves something sensible instead of nothing.
            if (!dragTabs.length && dockTabDragType(e)) {
              try {
                dragTabs = resolveSendBase(null).slice();
              } catch (err) {
                dragTabs = [];
              }
            }
            if (!dragTabs.length) {
              return;
            }
            // Live tab drag: defer until dragend so the strip's session
            // cleanup runs first (see dockPendingDrop note above).
            if (isLiveTabDragSession(dragTabs)) {
              try {
                dockPendingDrop = { dest: id, tabs: dragTabs.slice(), wasGroup };
              } catch (err) {}
              return;
            }
            executeDockDrop(id, dragTabs, wasGroup);
          } catch (err) {}
        });
      } catch (e) {}
    } catch (e) {
      pill = null;
    }
    return pill;
  }

  function makeDockPlus(free) {
    let pill = null;
    try {
      pill = document.createElement("div");
      pill.className = "aph-ws-pill aph-ws-add";
      pill.textContent = "+";
      pill.title = free
        ? `New workspace ${free} (click: switches here, opens a tab · drop: moves tab(s) here)`
        : "All 9 workspaces active";
      try {
        pill.addEventListener("click", () => {
          try {
            plusToWorkspace();
          } catch (e) {}
        });
      } catch (e) {}
      // The "+" pill is a drop target for a fresh workspace: dropping moves
      // to the lowest inactive ID (same destination a click would open).
      try {
        const armPlus = (e) => {
          try {
            if (!isDockDropArmed(e)) {
              return false;
            }
            if (!free) {
              return false;
            }
            e.preventDefault();
            try {
              if (typeof e.stopPropagation === "function") {
                e.stopPropagation();
              }
            } catch (err) {}
            try {
              e.dataTransfer.dropEffect = "move";
            } catch (err) {}
            pill.classList.add("drop-target");
            return true;
          } catch (err) {
            return false;
          }
        };
        pill.addEventListener("dragenter", armPlus);
        pill.addEventListener("dragover", armPlus);
        pill.addEventListener("dragleave", () => {
          try {
            pill.classList.remove("drop-target");
          } catch (err) {}
        });
        pill.addEventListener("drop", (e) => {
          try {
            e.preventDefault();
            try {
              if (typeof e.stopPropagation === "function") {
                e.stopPropagation();
              }
            } catch (err) {}
            pill.classList.remove("drop-target");
            const dest = lowestInactiveId(getActiveIds());
            if (!dest) {
              try {
                pulseWorkspaceIndicator();
              } catch (err) {}
              return;
            }
            const wasGroup = !!dockDragGroup;
            let dragTabs = [];
            try {
              dragTabs = resolveDockDragTabs();
            } catch (err) {
              dragTabs = [];
            }
            if (!dragTabs.length && dockTabDragType(e)) {
              try {
                dragTabs = resolveSendBase(null).slice();
              } catch (err) {
                dragTabs = [];
              }
            }
            if (!dragTabs.length) {
              return;
            }
            if (isLiveTabDragSession(dragTabs)) {
              try {
                dockPendingDrop = { dest, tabs: dragTabs.slice(), wasGroup };
              } catch (err) {}
              return;
            }
            executeDockDrop(dest, dragTabs, wasGroup);
          } catch (err) {}
        });
      } catch (e) {}
    } catch (e) {
      pill = null;
    }
    return pill;
  }

  // Aph key: persistent mouse entry point in Aph's own dock row (owns
  // its paint via theme.css — never fights Firefox's sidebar footer).
  // Left-click / Enter opens the Aph menu (palette is its first row);
  // right-click opens the dock menu for the current workspace. Distinct
  // `aph-dock-aph` class (never `aph-ws-pill`) so workspace-pill queries
  // and drop logic ignore it. Hidden during tab-drag mode so drop targets
  // stay clean.
  const APH_MENU_ID = "aph-aph-menu";

  function aphDockOpenPalette() {
    try {
      if (window.AphPalette) {
        if (typeof window.AphPalette.open === "function") {
          window.AphPalette.open();
          return;
        }
        if (typeof window.AphPalette.toggle === "function") {
          window.AphPalette.toggle();
          return;
        }
      }
    } catch (e) {}
  }

  function aphMenuCurrent() {
    try {
      if (typeof current !== "undefined" && typeof isValidId === "function" && isValidId(current)) {
        return current;
      }
    } catch (e) {}
    return "1";
  }

  function aphMenu() {
    try {
      const m = document.getElementById(APH_MENU_ID);
      return m || null;
    } catch (e) {
      return null;
    }
  }

  // Open-or-select a URL in the current workspace's bound container when
  // possible; plain trusted tab otherwise. Fail-silent house style.
  function aphOpenTab(url) {
    try {
      if (typeof openBoundTab === "function") {
        openBoundTab(url);
        return;
      }
    } catch (e) {}
    try {
      const t = gBrowser.addTrustedTab(url);
      try {
        gBrowser.selectedTab = t;
      } catch (_e) {}
    } catch (e) {}
  }

  function aphOpenArchive() {
    try {
      const a = window.AphArchive || null;
      if (a && typeof a.openArchive === "function" && a.openArchive()) {
        return;
      }
    } catch (e) {}
    try {
      aphOpenTab("chrome://browser/content/aph-archive.html");
    } catch (e) {}
  }

  function aphArchiveCurrent() {
    try {
      const a = window.AphArchive || null;
      if (a && typeof a.archiveCurrent === "function") {
        a.archiveCurrent();
        return;
      }
    } catch (e) {}
  }

  function aphShowCustomizeSidebar() {
    try {
      if (window.SidebarController && typeof window.SidebarController.show === "function") {
        window.SidebarController.show("viewCustomizeSidebar");
        return;
      }
    } catch (e) {}
  }

  function clearAphMenu(menu) {
    try {
      while (menu.firstChild) {
        menu.removeChild(menu.firstChild);
      }
    } catch (e) {}
  }

  function onAphMenuShowing(e) {
    try {
      const menu = (e && (e.currentTarget || e.target)) || null;
      if (!menu || typeof menu.appendChild !== "function") {
        return;
      }
      // popupshowing BUBBLES: opening the nested Bind submenu re-fires this
      // listener with e.target = the submenu. Only rebuild on our own popup.
      try {
        if (!e || e.target !== menu) {
          return;
        }
      } catch (err) {
        return;
      }
      clearAphMenu(menu);
      const cur = aphMenuCurrent();
      let curName = "";
      try {
        curName = typeof getWsName === "function" ? getWsName(cur) || "" : "";
      } catch (err) {}
      const head = curName ? `${cur}: ${curName}` : `Workspace ${cur}`;
      const pal = makeDockMenuItem("aph-aph-palette", "Open Command Palette…", () => {
        try {
          aphDockOpenPalette();
        } catch (err) {}
      });
      if (pal) {
        try {
          pal.setAttribute("shortcut", "Ctrl+K");
        } catch (err) {}
        try {
          menu.appendChild(pal);
        } catch (err) {}
      }
      try {
        const sep =
          typeof document.createXULElement === "function"
            ? document.createXULElement("menuseparator")
            : document.createElement("menuseparator");
        menu.appendChild(sep);
      } catch (err) {}
      const rename = makeDockMenuItem("aph-aph-rename", `Rename ${head}…`, () => {
        try {
          if (typeof promptDockRename === "function") {
            promptDockRename(cur);
          }
        } catch (err) {}
      });
      if (rename) {
        try {
          menu.appendChild(rename);
        } catch (err) {}
      }
      try {
        if (typeof isPrivateWindow === "function" ? !isPrivateWindow() : true) {
          const bindMenu =
            typeof document.createXULElement === "function"
              ? document.createXULElement("menu")
              : document.createElement("menu");
          bindMenu.setAttribute("label", `Bind ${head} to Container…`);
          const sub =
            typeof document.createXULElement === "function"
              ? document.createXULElement("menupopup")
              : document.createElement("menupopup");
          let bound = 0;
          try {
            bound = typeof getWsContainerId === "function" ? getWsContainerId(cur) : 0;
          } catch (err) {}
          const none = makeDockMenuItem("aph-aph-bind-none", "None (unbound)", () => {
            try {
              if (typeof setWsBinding === "function") {
                setWsBinding(cur, 0);
              }
              if (typeof renderDock === "function") {
                renderDock();
              }
            } catch (err) {}
          });
          if (none) {
            if (!bound) {
              try {
                none.setAttribute("checked", "true");
              } catch (err) {}
            }
            sub.appendChild(none);
          }
          try {
            const list = typeof listContainers === "function" ? listContainers() : [];
            for (const c of list || []) {
              const item = makeDockMenuItem(
                `aph-aph-bind-${c.userContextId}`,
                c.name || `Container ${c.userContextId}`,
                () => {
                  try {
                    if (typeof setWsBinding === "function") {
                      setWsBinding(cur, c.userContextId);
                    }
                    if (typeof renderDock === "function") {
                      renderDock();
                    }
                  } catch (err) {}
                }
              );
              if (item && bound === c.userContextId) {
                try {
                  item.setAttribute("checked", "true");
                } catch (err) {}
              }
              if (item) {
                sub.appendChild(item);
              }
            }
          } catch (err) {}
          bindMenu.appendChild(sub);
          menu.appendChild(bindMenu);
        }
      } catch (err) {}
      let archTitle = "Archive Current Tab";
      try {
        if (typeof archiveCmdTitle === "function") {
          archTitle = archiveCmdTitle();
        }
      } catch (err) {}
      const arch = makeDockMenuItem("aph-aph-archive", archTitle, () => {
        try {
          aphArchiveCurrent();
        } catch (err) {}
      });
      if (arch) {
        try {
          menu.appendChild(arch);
        } catch (err) {}
      }
      const openArch = makeDockMenuItem("aph-aph-open-archive", "Open Archive", () => {
        try {
          aphOpenArchive();
        } catch (err) {}
      });
      if (openArch) {
        try {
          menu.appendChild(openArch);
        } catch (err) {}
      }
      try {
        const sep =
          typeof document.createXULElement === "function"
            ? document.createXULElement("menuseparator")
            : document.createElement("menuseparator");
        menu.appendChild(sep);
      } catch (err) {}
      const cust = makeDockMenuItem("aph-aph-customize", "Customize Sidebar…", () => {
        try {
          aphShowCustomizeSidebar();
        } catch (err) {}
      });
      if (cust) {
        try {
          menu.appendChild(cust);
        } catch (err) {}
      }
      const prefs = makeDockMenuItem("aph-aph-settings", "Aph Settings…", () => {
        try {
          aphOpenTab("about:config?filter=aph");
        } catch (err) {}
      });
      if (prefs) {
        try {
          menu.appendChild(prefs);
        } catch (err) {}
      }
      const about = makeDockMenuItem("aph-aph-about", "About Aph", () => {
        try {
          aphOpenTab("https://aph-browser.github.io/");
        } catch (err) {}
      });
      if (about) {
        try {
          menu.appendChild(about);
        } catch (err) {}
      }
    } catch (e) {}
  }

  function ensureAphMenu() {
    try {
      let menu = aphMenu();
      if (menu) {
        return menu;
      }
      const set =
        typeof document.getElementById === "function"
          ? document.getElementById("mainPopupSet")
          : null;
      if (!set || typeof set.appendChild !== "function") {
        return null;
      }
      menu =
        typeof document.createXULElement === "function"
          ? document.createXULElement("menupopup")
          : document.createElement("menupopup");
      menu.id = APH_MENU_ID;
      if (typeof menu.addEventListener === "function") {
        menu.addEventListener("popupshowing", onAphMenuShowing);
      }
      set.appendChild(menu);
      return menu;
    } catch (e) {
      return null;
    }
  }

  function openAphMenu(btn, e) {
    try {
      const menu = ensureAphMenu();
      if (!menu) {
        aphDockOpenPalette();
        return;
      }
      try {
        if (typeof menu.openPopupAtScreen === "function" && e && e.screenX != null) {
          menu.openPopupAtScreen(e.screenX, e.screenY, true);
          return;
        }
      } catch (_e) {}
      try {
        if (typeof menu.openPopup === "function") {
          if (btn) {
            menu.openPopup(btn, "after_end", 0, 0, true, false, e);
          } else {
            menu.openPopup(null, "", 0, 0, true, false, e);
          }
          return;
        }
      } catch (_e) {}
    } catch (e) {}
    try {
      aphDockOpenPalette();
    } catch (_e) {}
  }

  // Aph mark: 2x2 spaces grid, active cell filled. Geometric and
  // abstract on purpose — a letterform would read as text at 14px.
  // currentColor throughout, so the ghost (dim) / hover (full) ink
  // story needs no paint logic here. Namespaced construction (never
  // innerHTML) so the XUL/XHTML host gets real SVG either way.
  function makeDockAphMark() {
    try {
      const NS = "http://www.w3.org/2000/svg";
      const svg = document.createElementNS(NS, "svg");
      svg.setAttribute("viewBox", "0 0 14 14");
      svg.setAttribute("width", "14");
      svg.setAttribute("height", "14");
      svg.setAttribute("aria-hidden", "true");
      const cells = [
        { x: 1, y: 1, active: true },
        { x: 8, y: 1, active: false },
        { x: 1, y: 8, active: false },
        { x: 8, y: 8, active: false },
      ];
      for (const c of cells) {
        const r = document.createElementNS(NS, "rect");
        r.setAttribute("x", String(c.x));
        r.setAttribute("y", String(c.y));
        r.setAttribute("width", "5");
        r.setAttribute("height", "5");
        r.setAttribute("rx", "1.5");
        if (c.active) {
          r.setAttribute("fill", "currentColor");
        } else {
          r.setAttribute("fill", "none");
          r.setAttribute("stroke", "currentColor");
          r.setAttribute("stroke-width", "1.4");
        }
        svg.appendChild(r);
      }
      return svg;
    } catch (e) {
      return null;
    }
  }

  function makeDockAph() {
    let btn = null;
    try {
      btn = document.createElement("div");
      btn.className = "aph-dock-aph";
      btn.setAttribute("role", "button");
      btn.setAttribute("tabindex", "0");
      btn.setAttribute("aria-label", "Aph menu");
      try {
        const mark = makeDockAphMark();
        if (mark) {
          btn.appendChild(mark);
        }
      } catch (e) {}
      btn.title = "Aph — menu · click for Aph actions · right-click for workspace actions";
      try {
        btn.addEventListener("click", (e) => {
          try {
            if (typeof e.stopPropagation === "function") {
              e.stopPropagation();
            }
          } catch (_e) {}
          try {
            if (typeof e.preventDefault === "function") {
              e.preventDefault();
            }
          } catch (_e) {}
          openAphMenu(btn, e);
        });
      } catch (e) {}
      try {
        btn.addEventListener("keydown", (e) => {
          try {
            if (e && (e.key === "Enter" || e.key === " ")) {
              if (typeof e.preventDefault === "function") {
                e.preventDefault();
              }
              openAphMenu(btn, null);
            }
          } catch (_e) {}
        });
      } catch (e) {}
      try {
        btn.addEventListener("contextmenu", (e) => {
          try {
            if (typeof e.preventDefault === "function") {
              e.preventDefault();
            }
            if (typeof e.stopPropagation === "function") {
              e.stopPropagation();
            }
          } catch (_e) {}
          try {
            const menu = typeof ensureDockMenu === "function" ? ensureDockMenu() : null;
            const id =
              typeof current !== "undefined" && typeof isValidId === "function" && isValidId(current)
                ? current
                : "1";
            if (menu) {
              try {
                menu.setAttribute("data-ws", id);
              } catch (_e) {}
              if (typeof menu.openPopupAtScreen === "function" && e) {
                menu.openPopupAtScreen(e.screenX, e.screenY, true);
                return;
              }
              if (typeof menu.openPopup === "function") {
                menu.openPopup(btn, "after_start", 0, 0, true, false, e);
                return;
              }
            }
          } catch (_e) {}
          aphDockOpenPalette();
        });
      } catch (e) {}
    } catch (e) {
      btn = null;
    }
    return btn;
  }

  function renderDock() {
    try {
      const anchor = dockAnchor();
      let dock = null;
      try {
        dock = document.getElementById(DOCK_ID);
      } catch (e) {}
      if (!anchor) {
        try {
          if (dock) {
            dock.hidden = true;
          }
        } catch (e) {}
        return;
      }
      if (!dock) {
        dock = ensureDock();
        if (!dock) {
          return;
        }
      }
      try {
        dock.hidden = false;
      } catch (e) {}
      try {
        while (dock.firstChild) {
          dock.removeChild(dock.firstChild);
        }
      } catch (e) {}
      // Drag-mode expands to all 9 workspaces so empty ones accept drops.
      // Normal mode shows active workspaces only (plus current).
      // Window-scoped: no remote pills — other windows' workspaces are
      // independent tab sets, never shown here.
      let ids = [];
      try {
        ids = getActiveIds();
      } catch (e) {
        ids = [];
      }
      const cur = isValidId(current) ? current : "1";
      const counts = dockCounts();
      if (dockDragActive) {
        try {
          dock.setAttribute("data-aph-dragging", "1");
        } catch (e) {}
        for (let i = 1; i <= 9; i++) {
          const id = String(i);
          try {
            const pill = makeDockPill(
              id,
              id === cur,
              counts[id] || 0,
              !ids.includes(id)
            );
            if (pill) {
              dock.appendChild(pill);
            }
          } catch (e) {}
        }
      } else {
        try {
          dock.removeAttribute("data-aph-dragging");
        } catch (e) {}
        for (const id of ids) {
          try {
            const pill = makeDockPill(id, id === cur, counts[id] || 0, false);
            if (pill) {
              dock.appendChild(pill);
            }
          } catch (e) {}
        }
      }
      try {
        const plus = makeDockPlus(lowestInactiveId(getActiveIds()));
        if (plus) {
          dock.appendChild(plus);
        }
      } catch (e) {}
      // Aph key last (far end of the row). Skipped in drag mode — pills +
      // plus are the only drop UI in play there.
      try {
        if (!dockDragActive) {
          const aph = makeDockAph();
          if (aph) {
            dock.appendChild(aph);
          }
        }
      } catch (e) {}
    } catch (e) {}
  }

  function makeDockMenuItem(id, label, action, disabled) {
    let item = null;
    try {
      // browser.xhtml is XHTML: createElement would build an
      // HTML-namespaced dud inside the XUL menupopup (pinreset pattern).
      item =
        typeof document.createXULElement === "function"
          ? document.createXULElement("menuitem")
          : document.createElement("menuitem");
      item.id = id;
      item.setAttribute("label", label);
      if (disabled) {
        item.setAttribute("disabled", "true");
      }
      if (typeof item.addEventListener === "function") {
        item.addEventListener("command", action);
      }
    } catch (e) {
      item = null;
    }
    return item;
  }

  function promptDockRename(id) {
    const commit = (v) => {
      try {
        setWsName(id, String(v == null ? "" : v));
        renderDock();
      } catch (e) {}
    };
    try {
      if (window.AphPalette && typeof window.AphPalette.prompt === "function") {
        window.AphPalette.prompt({
          title: `Rename workspace ${id} — Enter saves, Esc cancels`,
          initial: getWsName(id) || "",
          onCommit: commit,
        });
        return;
      }
    } catch (e) {}
    try {
      if (typeof window.prompt === "function") {
        commit(window.prompt(`Rename workspace ${id}:`, getWsName(id) || ""));
      }
    } catch (e) {}
  }

  // Resolve the right-clicked pill: explicit data-ws stashed by our own
  // contextmenu opener first, then the pinreset pattern (triggerNode,
  // document.popupNode fallback).
  function dockMenuTargetWs(menu) {
    try {
      const direct =
        menu && typeof menu.getAttribute === "function" && menu.getAttribute("data-ws");
      if (isValidId(direct)) {
        return direct;
      }
    } catch (e) {}
    try {
      const node =
        (menu && menu.triggerNode) || (typeof document !== "undefined" && document.popupNode) || null;
      if (node && typeof node.closest === "function") {
        const pill = node.closest(".aph-ws-pill");
        if (pill && typeof pill.getAttribute === "function") {
          const ws = pill.getAttribute("data-ws");
          if (isValidId(ws)) {
            return ws;
          }
        }
      }
    } catch (e) {}
    return null;
  }

  function clearDockMenu(menu) {
    try {
      while (menu.firstChild) {
        menu.removeChild(menu.firstChild);
      }
    } catch (e) {}
  }

  function isPrivateWindow() {
    try {
      const pbu = window.PrivateBrowsingUtils;
      if (pbu && typeof pbu.isWindowPrivate === "function") {
        return !!pbu.isWindowPrivate(window);
      }
    } catch (e) {}
    return false;
  }

  function onDockMenuShowing(e) {
    try {
      const menu = (e && (e.currentTarget || e.target)) || null;
      if (!menu || typeof menu.appendChild !== "function") {
        return;
      }
      // popupshowing BUBBLES: opening the nested Bind submenu re-fires this
      // listener with e.target = the submenu. Rebuilding here would rip the
      // submenu out mid-open (open/close flicker, submenu never stays up).
      // Only handle showings that originate on our own menupopup.
      try {
        if (!e || e.target !== menu) {
          return;
        }
      } catch (err) {
        return;
      }
      clearDockMenu(menu);
      const id = dockMenuTargetWs(menu);
      if (!id) {
        return;
      }
      // Window-scoped: every pill is local. Rename/bind stay (global
      // prefs); unload/close act on this window's tabs only.
      let name = "";
      try {
        name = getWsName(id) || "";
      } catch (err) {}
      const head = name ? `${id}: ${name}` : `Workspace ${id}`;
      let count = 0;
      try {
        count = dockCounts()[id] || 0;
      } catch (err) {}
      const rename = makeDockMenuItem(
        "aph-dock-rename",
        `Rename ${head}…`,
        () => {
          try {
            promptDockRename(id);
          } catch (err) {}
        }
      );
      if (rename) {
        try {
          menu.appendChild(rename);
        } catch (err) {}
      }
      if (!isPrivateWindow()) {
        try {
          const bindMenu =
            typeof document.createXULElement === "function"
              ? document.createXULElement("menu")
              : document.createElement("menu");
          bindMenu.setAttribute("label", "Bind to Container…");
          const sub =
            typeof document.createXULElement === "function"
              ? document.createXULElement("menupopup")
              : document.createElement("menupopup");
          const bound = getWsContainerId(id);
          const none = makeDockMenuItem("aph-dock-bind-none", "None (unbound)", () => {
            try {
              setWsBinding(id, 0);
              renderDock();
            } catch (err) {}
          });
          if (none) {
            if (!bound) {
              try {
                none.setAttribute("checked", "true");
              } catch (err) {}
            }
            sub.appendChild(none);
          }
          try {
            for (const c of listContainers()) {
              const item = makeDockMenuItem(
                `aph-dock-bind-${c.userContextId}`,
                c.name || `Container ${c.userContextId}`,
                () => {
                  try {
                    setWsBinding(id, c.userContextId);
                    renderDock();
                  } catch (err) {}
                }
              );
              if (item && bound === c.userContextId) {
                try {
                  item.setAttribute("checked", "true");
                } catch (err) {}
              }
              if (item) {
                sub.appendChild(item);
              }
            }
          } catch (err) {}
          bindMenu.appendChild(sub);
          menu.appendChild(bindMenu);
        } catch (err) {}
      }
      const unload = makeDockMenuItem(
        "aph-dock-unload",
        "Unload Inactive Tabs",
        () => {
          try {
            unloadEligibleTabs({ scope: "workspace", ws: id });
            renderDock();
          } catch (err) {}
        },
        id === current
      );
      if (unload) {
        try {
          menu.appendChild(unload);
        } catch (err) {}
      }
      try {
        const sep =
          typeof document.createXULElement === "function"
            ? document.createXULElement("menuseparator")
            : document.createElement("menuseparator");
        menu.appendChild(sep);
      } catch (err) {}
      const close = makeDockMenuItem(
        "aph-dock-close",
        count > 0 ? `Close Workspace (${count} tab${count === 1 ? "" : "s"})` : "Close Workspace",
        () => {
          try {
            closeWorkspaceTabs(id);
          } catch (err) {}
        },
        count === 0
      );
      if (close) {
        try {
          menu.appendChild(close);
        } catch (err) {}
      }
    } catch (e) {}
  }

  function ensureDockMenu() {
    try {
      let menu = dockMenu();
      if (menu) {
        return menu;
      }
      const set =
        typeof document.getElementById === "function"
          ? document.getElementById("mainPopupSet")
          : null;
      if (!set || typeof set.appendChild !== "function") {
        return null;
      }
      menu =
        typeof document.createXULElement === "function"
          ? document.createXULElement("menupopup")
          : document.createElement("menupopup");
      menu.id = DOCK_MENU_ID;
      if (typeof menu.addEventListener === "function") {
        menu.addEventListener("popupshowing", onDockMenuShowing);
      }
      set.appendChild(menu);
      return menu;
    } catch (e) {
      return null;
    }
  }

  function ensureDock() {
    try {
      let dock = null;
      try {
        dock = document.getElementById(DOCK_ID);
      } catch (e) {}
      if (dock) {
        return dock;
      }
      const anchor = dockAnchor();
      if (!anchor || typeof anchor.appendChild !== "function") {
        return null;
      }
      dock = document.createElement("div");
      dock.id = DOCK_ID;
      // Dock gaps (padding between pills) sit inside #vertical-tabs: a tab
      // drag hovering the gap would otherwise bubble to the strip's own
      // dragover and animate tab shoves with no pill in play. Swallow it.
      try {
        const shield = (e) => {
          try {
            if (!isDockDropArmed(e)) {
              return;
            }
            e.preventDefault();
            try {
              if (typeof e.stopPropagation === "function") {
                e.stopPropagation();
              }
            } catch (err) {}
          } catch (err) {}
        };
        dock.addEventListener("dragenter", shield);
        dock.addEventListener("dragover", shield);
      } catch (e) {}
      anchor.appendChild(dock);
      // Shared right-click menu must exist before pills reference it.
      try {
        ensureDockMenu();
      } catch (e) {}
      return dock;
    } catch (e) {
      return null;
    }
  }

  function onDockDragStart(e) {
    try {
      dockDragTab = null;
      dockDragGroup = null;
      const t = e && e.target;
      try {
        const tab =
          t && typeof t.closest === "function" ? t.closest("tab") : null;
        if (tab && !tab.closing) {
          dockDragTab = tab;
          enterDockDragMode();
          return;
        }
      } catch (err) {}
      // No tab under the cursor: a group-header drag carries the whole
      // native group (stock strip behavior). Resolve members at drop time
      // so mid-drag closes don't strand stale refs.
      try {
        const grp =
          t && typeof t.closest === "function" ? t.closest("tab-group") : null;
        if (grp && !grp.closing) {
          dockDragGroup = grp;
          enterDockDragMode();
          return;
        }
      } catch (err) {
        dockDragGroup = null;
      }
      // Drag started but hit neither tab nor group (e.g. empty strip gap):
      // still enter drag-mode if the payload looks like tabs so empty
      // workspaces become visible drop targets.
      try {
        if (dockTabDragType(e)) {
          enterDockDragMode();
        }
      } catch (err) {}
    } catch (err) {
      dockDragTab = null;
      dockDragGroup = null;
    }
  }

  // Resolve what a dock drop should move. Group-header drags return the
  // group's live members (sendGroupTo keeps membership); tab drags return
  // the dragged tab itself, expanded to the live multiselection only when
  // the dragged tab belongs to it (stock strip-drag semantics). Reading
  // selection alone is wrong — the user can drag an unselected tab while
  // something else is selected. Whole groups stay joined via preservation.
  function resolveDockDragTabs() {
    try {
      if (dockDragGroup) {
        let members = [];
        try {
          if (typeof groupMembers === "function") {
            members = groupMembers(dockDragGroup);
          } else {
            members = Array.from(dockDragGroup.tabs || []);
          }
        } catch (e) {
          members = [];
        }
        try {
          const live = new Set(Array.from(gBrowser.tabs || []));
          members = (members || []).filter(
            (t) => t && !t.closing && live.has(t)
          );
        } catch (e) {}
        if (members.length) {
          return members;
        }
        // Stale group ref (closed mid-drag): fall through to tab logic.
      }
      if (!dockDragTab || dockDragTab.closing) {
        return [];
      }
      let live = [];
      try {
        live = Array.from(gBrowser.tabs || []);
      } catch (e) {
        return [];
      }
      if (!live.includes(dockDragTab)) {
        return [];
      }
      try {
        const multi =
          (gBrowser && (gBrowser.selectedTabs || gBrowser.multiselectedTabs)) || null;
        if (Array.isArray(multi) && multi.length > 1) {
          try {
            if (multi.includes(dockDragTab)) {
              const liveSet = new Set(live);
              const filtered = multi.filter((t) => t && !t.closing && liveSet.has(t));
              if (filtered.length) {
                return filtered;
              }
            }
          } catch (e) {}
        }
      } catch (e) {}
      return [dockDragTab];
    } catch (e) {
      return [];
    }
  }

  function onDockDragEnd(e) {
    // A drop during a live tab drag only records dockPendingDrop (strip
    // session still active). Now the session has unwound — execute the move
    // against a settled strip, then collapse the drag UI.
    try {
      flushDockPendingDrop();
    } catch (err) {}
    try {
      dockPendingDrop = null;
    } catch (err) {}
    try {
      dockDragTab = null;
      dockDragGroup = null;
      const dock = document.getElementById(DOCK_ID);
      if (dock && typeof dock.querySelectorAll === "function") {
        for (const p of Array.from(dock.querySelectorAll(".drop-target"))) {
          try {
            p.classList.remove("drop-target");
          } catch (err) {}
        }
      }
    } catch (e) {}
    // Collapse back to active-only pills after the drag (drop handlers run
    // before dragend; deferred sends complete in flush above).
    try {
      exitDockDragMode();
    } catch (e) {}
  }

  function cleanupDock() {
    try {
      dockDragTab = null;
      dockDragGroup = null;
      dockDragActive = false;
      dockPendingDrop = null;
    } catch (e) {}
    try {
      const menu = dockMenu();
      if (menu) {
        if (typeof menu.removeEventListener === "function") {
          menu.removeEventListener("popupshowing", onDockMenuShowing);
        }
        if (menu.parentNode) {
          menu.parentNode.removeChild(menu);
        } else if (typeof menu.remove === "function") {
          menu.remove();
        }
      }
    } catch (e) {}
    try {
      const amenu = aphMenu();
      if (amenu) {
        if (typeof amenu.removeEventListener === "function") {
          amenu.removeEventListener("popupshowing", onAphMenuShowing);
        }
        if (amenu.parentNode) {
          amenu.parentNode.removeChild(amenu);
        } else if (typeof amenu.remove === "function") {
          amenu.remove();
        }
      }
    } catch (e) {}
    try {
      if (gBrowser && gBrowser.tabContainer) {
        gBrowser.tabContainer.removeEventListener("dragstart", onDockDragStart, true);
        gBrowser.tabContainer.removeEventListener("dragstart", onDockDragStart);
      }
    } catch (e) {}
    try {
      window.removeEventListener("dragstart", onDockDragStart, true);
    } catch (e) {}
    try {
      window.removeEventListener("dragend", onDockDragEnd);
    } catch (e) {}
  }

  function initDock() {
    try {
      renderDock();
    } catch (e) {}
    // Capture phase: the strip's own tab element handles dragstart with
    // capture=true and may stop propagation, which would starve a bubble
    // listener on the container (no tracking → no expansion, no indicator).
    // Ancestor capture fires first, so we always see the drag.
    try {
      if (gBrowser && gBrowser.tabContainer) {
        gBrowser.tabContainer.addEventListener("dragstart", onDockDragStart, true);
      }
    } catch (e) {}
    try {
      window.addEventListener("dragstart", onDockDragStart, true);
    } catch (e) {}
    try {
      window.addEventListener("dragend", onDockDragEnd);
    } catch (e) {}
    try {
      window.addEventListener("unload", cleanupDock, { once: true });
    } catch (e) {}
  }

  if (document.readyState === "complete") {
    initDock();
  } else {
    window.addEventListener("load", initDock, { once: true });
  }
  // Sidebar footer (gear) hide/show -------------------------------------
  // sidebar-main's bottom bar (gear + empty space when tools=none) can be
  // hidden to reclaim the strip: pref aph.sidebar.hideFooter, HIDDEN by
  // default (an absent pref counts as hidden, so seed-once profiles that
  // predate the pref hide too). The palette's Show/Hide Sidebar Footer
  // command flips the pref; a pref observer applies it live. The Aph
  // menu's "Customize Sidebar…" item stays the escape hatch.
  //
  // Mechanism: a host attribute + one-time shadow <style>, never an
  // inline style on Lit-managed nodes (re-renders would wipe it, which
  // is what the old MutationObserver existed to repair). Host attributes
  // survive re-renders — they live outside the shadow root — and shadow
  // CSS matches them via :host(). So hiding is a single attribute flip;
  // there is nothing to re-apply and no standing observer. theme.css
  // can't reach the shadow DOM, hence the injected style element.
  // Everything fails silent (house style).
  //
  // NOTE: deliberately NOT exempting expand-on-hover. Stock's hover
  // trigger is mouse-position-vs-launcher-bounds (MousePosTracker), not
  // CSS :hover, and nothing here shrinks those bounds (the dock only adds
  // height; the strip keeps its tabs) — carving out the mode would be
  // complexity without a proven mechanism.
  var SIDEBAR_FOOTER_PREF = "aph.sidebar.hideFooter";
  const SIDEBAR_FOOTER_STYLE_ID = "aph-footer-style";
  const SIDEBAR_FOOTER_ATTR = "data-aph-hide-footer";
  let sidebarFooterPrefObserver = null;

  function sidebarFooterHidden() {
    try {
      if (
        typeof Services !== "undefined" &&
        Services &&
        Services.prefs &&
        typeof Services.prefs.getBoolPref === "function"
      ) {
        return !!Services.prefs.getBoolPref(SIDEBAR_FOOTER_PREF);
      }
    } catch (e) {}
    return true;
  }

  function sidebarFooterHost() {
    try {
      if (typeof document === "undefined" || !document) {
        return null;
      }
      if (typeof document.querySelector !== "function") {
        return null;
      }
      return document.querySelector("sidebar-main") || null;
    } catch (e) {
      return null;
    }
  }

  // Inject once (guarded by id): :host([attr]) survives every Lit
  // re-render because the style element itself is static shadow content,
  // and the toggle below only touches the host attribute.
  function ensureSidebarFooterStyle() {
    try {
      const host = sidebarFooterHost();
      if (!host) {
        return null;
      }
      const root = host.shadowRoot || null;
      if (!root || typeof root.querySelector !== "function") {
        return null;
      }
      let style = null;
      try {
        style =
          typeof root.getElementById === "function"
            ? root.getElementById(SIDEBAR_FOOTER_STYLE_ID)
            : root.querySelector("#" + SIDEBAR_FOOTER_STYLE_ID);
      } catch (e) {
        style = null;
      }
      if (style) {
        return style;
      }
      try {
        style = document.createElement("style");
      } catch (e) {
        return null;
      }
      if (!style) {
        return null;
      }
      try {
        style.id = SIDEBAR_FOOTER_STYLE_ID;
        style.textContent =
          ':host([' + SIDEBAR_FOOTER_ATTR + ']) .buttons-wrapper{display:none !important;}';
      } catch (e) {}
      try {
        root.appendChild(style);
      } catch (e) {
        return null;
      }
      return style;
    } catch (e) {
      return null;
    }
  }

  function applySidebarFooter() {
    try {
      ensureSidebarFooterStyle();
    } catch (e) {}
    try {
      const host = sidebarFooterHost();
      if (!host || typeof host.toggleAttribute !== "function") {
        return false;
      }
      const hidden = sidebarFooterHidden();
      try {
        host.toggleAttribute(SIDEBAR_FOOTER_ATTR, hidden);
      } catch (e) {
        return false;
      }
      return hidden;
    } catch (e) {
      return false;
    }
  }

  function cleanupSidebarFooter() {
    try {
      if (
        sidebarFooterPrefObserver &&
        typeof Services !== "undefined" &&
        Services &&
        Services.prefs &&
        typeof Services.prefs.removeObserver === "function"
      ) {
        Services.prefs.removeObserver(SIDEBAR_FOOTER_PREF, sidebarFooterPrefObserver);
      }
    } catch (e) {}
    sidebarFooterPrefObserver = null;
    // Leave no trace: drop the attribute and the injected style.
    try {
      const host = sidebarFooterHost();
      if (host && typeof host.removeAttribute === "function") {
        try {
          host.removeAttribute(SIDEBAR_FOOTER_ATTR);
        } catch (e) {}
      }
      const root = (host && host.shadowRoot) || null;
      if (root) {
        let style = null;
        try {
          style =
            typeof root.getElementById === "function"
              ? root.getElementById(SIDEBAR_FOOTER_STYLE_ID)
              : root.querySelector("#" + SIDEBAR_FOOTER_STYLE_ID);
        } catch (e) {}
        try {
          if (style && style.parentNode && typeof style.parentNode.removeChild === "function") {
            style.parentNode.removeChild(style);
          } else if (style && typeof style.remove === "function") {
            style.remove();
          }
        } catch (e) {}
      }
    } catch (e) {}
  }

  function initSidebarFooter() {
    try {
      applySidebarFooter();
    } catch (e) {}
    try {
      if (
        typeof Services !== "undefined" &&
        Services &&
        Services.prefs &&
        typeof Services.prefs.addObserver === "function"
      ) {
        sidebarFooterPrefObserver = {
          observe() {
            try {
              applySidebarFooter();
            } catch (e) {}
          },
        };
        Services.prefs.addObserver(SIDEBAR_FOOTER_PREF, sidebarFooterPrefObserver);
      }
    } catch (e) {
      sidebarFooterPrefObserver = null;
    }
    try {
      window.addEventListener("unload", cleanupSidebarFooter, { once: true });
    } catch (e) {}
  }

  if (document.readyState === "complete") {
    initSidebarFooter();
  } else {
    window.addEventListener("load", initSidebarFooter, { once: true });
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
      const identity = IdentityService.create(`Tmp ${tempCounter++}`, "fingerprint", "purple");
      const tab = gBrowser.addTrustedTab(url, { userContextId: identity.userContextId });
      // insertAfterCurrent births tabs inside the selected tab's group — eject.
      try {
        gBrowser.ungroupTab(tab);
      } catch (e) {}
      tempContainers.add(identity.userContextId);
      setWs(tab, ws);
      aphShowTab(tab);
      gBrowser.selectedTab = tab;
      focusUrlBar();
    } catch (e) {}
  }

  // If a disposable container's last tab closed (any window), remove the
  // identity — remove() also wipes its cookies/storage/cache internally.
  function cleanupTempContainer(tab) {
    let id = null;
    try {
      id = tab.userContextId;
    } catch (e) {
      return;
    }
    if (!id || !IdentityService || !tempContainers.has(id)) {
      return;
    }
    setTimeout(() => {
      try {
        const en = Services.wm.getEnumerator("navigator:browser");
        while (en.hasMoreElements()) {
          const w = en.getNext();
          if (!w || w.closed || !w.gBrowser) {
            continue;
          }
          for (const t of w.gBrowser.tabs) {
            if (!t.closing && t.userContextId === id) {
              return; // still in use
            }
          }
        }
        tempContainers.delete(id);
        IdentityService.remove(id);
        if (tempContainers.size === 0) {
          tempCounter = 1; // Clean slate: next round starts at Tmp 1
        }
      } catch (e) {}
    }, 100);
  }

  // e.code, not e.key: Shift turns "1" into "!".
  function digitFromCode(code) {
    const m = code && code.match(/^(?:Digit|Numpad)([1-9])$/);
    return m ? m[1] : null;
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
    } else if (e.shiftKey) {
      e.preventDefault();
      e.stopPropagation();
      switchTo(d);
    }
  }

  // Owned-tab base URL machinery, shared by 75-pinreset.js (pinned tabs)
  // and 76-starred.js (starred tabs). Both features are the same machine
  // with different nouns: a per-tab stored URL (SessionStore custom value,
  // survives restore free), validated editing, container-aware loading,
  // and a right-click menu. Kind-specific state (pin capture, star flag +
  // close-button swap) and menu shapes stay in their own files; everything
  // byte-identical lives here. Same-bundle scope: 55-exclusive.js owns
  // tabSpec (used for the live-URL fallback), 65-dock.js owns the XUL
  // menu factory.
  //
  // Reject javascript: URLs; hostful http(s) and about: pages are fine.
  function isValidBaseURL(url) {
    try {
      const u = new URL(String(url || ""));
      if (u.protocol === "javascript:") {
        return false;
      }
      return !!u.host || u.protocol.indexOf("about:") === 0;
    } catch (e) {
      return false;
    }
  }

  function getStoredURL(tab, key) {
    try {
      if (!tab) {
        return "";
      }
      let v = null;
      try {
        v = SessionStore.getCustomTabValue(tab, key);
      } catch (e) {
        v = null;
      }
      return typeof v === "string" && v ? v : "";
    } catch (e) {
      return "";
    }
  }

  // Returns true when stored. Invalid URLs are rejected (previous value
  // kept) so a typo in the edit dialog can never brick the reset target.
  // noteErr receives failure codes for Browser-Console diagnosis.
  function setStoredURL(tab, key, url, noteErr) {
    try {
      if (!tab || !isValidBaseURL(url)) {
        return false;
      }
      SessionStore.setCustomTabValue(tab, key, String(url));
      return true;
    } catch (e) {
      try {
        if (typeof noteErr === "function") {
          noteErr("set-threw");
        }
      } catch (err) {}
      return false;
    }
  }

  function systemPrincipal() {
    try {
      return Services.scriptSecurityManager.getSystemPrincipal();
    } catch (e) {
      return null;
    }
  }

  function loadBaseURL(browser, url, noteErr) {
    const principal = systemPrincipal();
    let noted = false;
    const note = (code) => {
      noted = true;
      try {
        if (typeof noteErr === "function") {
          noteErr(code);
        }
      } catch (err) {}
    };
    try {
      if (browser && typeof browser.fixupAndLoadURIString === "function") {
        browser.fixupAndLoadURIString(url, { triggeringPrincipal: principal });
        return true;
      }
    } catch (e) {
      note("fixup-threw");
    }
    // Fallback for browsers without the fixup helper wired up.
    try {
      if (browser && typeof browser.loadURI === "function" && Services && Services.io) {
        browser.loadURI(Services.io.newURI(url), { triggeringPrincipal: principal });
        return true;
      }
    } catch (e) {
      note("loadURI-threw");
    }
    if (!noted) {
      note("no-loader");
    }
    return false;
  }

  // Resolve the right-clicked tab, mirroring stock tab-context-menu.js and
  // the archive.js pattern: triggerNode may carry the tab directly (.tab)
  // or contain it; fall back to the selected tab.
  function contextClickedTab(e) {
    try {
      const popup = e && e.target;
      const node = (popup && popup.triggerNode) || document.popupNode || null;
      if (node) {
        const direct =
          node.tab ||
          (typeof node.closest === "function" ? node.closest("tab") : null);
        if (direct) {
          return direct;
        }
      }
      if (gBrowser && gBrowser.selectedTab) {
        return gBrowser.selectedTab;
      }
    } catch (err) {}
    return null;
  }

  // Detach every tracked menu item; returns [] for `items = takeDown...`.
  function takeDownMenuItems(items) {
    try {
      for (const it of items || []) {
        try {
          if (it && it.parentNode) {
            it.parentNode.removeChild(it);
          } else if (it && typeof it.remove === "function") {
            it.remove();
          }
        } catch (err) {}
      }
    } catch (err) {}
    return [];
  }

  function promptBaseURL(tab, initial, dialogTitle, promptTitle, setURL) {
    const commit = (v) => {
      try {
        const value = String(v == null ? "" : v).trim();
        if (value && typeof setURL === "function") {
          setURL(tab, value);
        }
      } catch (err) {}
    };
    try {
      if (window.AphPalette && typeof window.AphPalette.prompt === "function") {
        window.AphPalette.prompt({
          title: dialogTitle,
          initial: initial || "",
          onCommit: commit,
        });
        return;
      }
    } catch (err) {}
    // Palette unavailable (tests, minimal chrome): stock prompt fallback.
    try {
      if (typeof window.prompt === "function") {
        commit(window.prompt(promptTitle, initial || ""));
      }
    } catch (err) {}
  }
  // Zen-style pinned-tab URLs: every pinned tab owns a "pinned URL"
  // (captured at pin time, editable). Right-click offers "Reset to Pinned
  // Page" + "Set Pinned Page…". Values persist via SessionStore custom
  // tab values (same mechanism as workspace tags), so they survive
  // session restore free.
  // NOTE: close-to-reset was tried and removed — TabClose is a
  // non-cancelable notification in stock Firefox ("committed to closing"),
  // and the re-open replacement proved unreliable in practice. Pinned
  // tabs close normally; getting back is what Reset is for.
  const PIN_URL_KEY = "aphPinURL";

  // Last failure code for Browser-Console diagnosis (AphPinReset.debug()).
  // House style stays silent in prod; this keeps the silence debuggable.
  let pinLastError = "";

  function pinNoteErr(code) {
    try {
      pinLastError = code;
    } catch (err) {}
  }

  function getPinURL(tab) {
    return getStoredURL(tab, PIN_URL_KEY);
  }

  // Returns true when stored. Invalid URLs are rejected (previous value
  // kept) so a typo in the edit dialog can never brick the reset target.
  function setPinURL(tab, url) {
    return setStoredURL(tab, PIN_URL_KEY, url, pinNoteErr);
  }

  function clearPinURL(tab) {
    try {
      if (!tab) {
        return;
      }
      if (SessionStore && typeof SessionStore.deleteCustomTabValue === "function") {
        SessionStore.deleteCustomTabValue(tab, PIN_URL_KEY);
      } else {
        SessionStore.setCustomTabValue(tab, PIN_URL_KEY, "");
      }
    } catch (e) {}
  }

  // Legacy pins (pinned before this feature) have no stored value:
  // fall back to the live URL so reset/menu never dead-end on them.
  function effectivePinURL(tab) {
    try {
      return getPinURL(tab) || tabSpec(tab);
    } catch (e) {
      return "";
    }
  }

  // Returns true when navigation was kicked off.
  function resetPinTab(tab) {
    try {
      if (!tab || !tab.pinned) {
        return false;
      }
      const url = effectivePinURL(tab);
      if (!url) {
        try {
          pinLastError = "no-url";
        } catch (err) {}
        return false;
      }
      const browser = tab.linkedBrowser;
      if (!browser) {
        try {
          pinLastError = "no-browser";
        } catch (err) {}
        return false;
      }
      return loadBaseURL(browser, url, pinNoteErr);
    } catch (e) {
      try {
        pinLastError = "reset-threw";
      } catch (err) {}
      return false;
    }
  }

  // Pin captures its live page as the default (custom values win — a
  // re-pin never clobbers an edited URL). Unpin clears for a fresh
  // default next time.
  function onPinChanged(e) {
    let tab = null;
    try {
      tab = e && e.target;
    } catch (err) {}
    if (!tab) {
      return;
    }
    try {
      if (tab.pinned) {
        if (!getPinURL(tab)) {
          const spec = tabSpec(tab);
          if (spec) {
            SessionStore.setCustomTabValue(tab, PIN_URL_KEY, spec);
          }
        }
      } else {
        clearPinURL(tab);
      }
    } catch (err) {}
  }

  let pinMenuItems = [];

  function clearPinMenu() {
    pinMenuItems = takeDownMenuItems(pinMenuItems);
  }

  function promptPinURL(tab, initial) {
    promptBaseURL(
      tab,
      initial,
      "Set Pinned Page — Enter saves, Esc cancels",
      "Set Pinned Page URL:",
      setPinURL
    );
  }

  function onPinMenuShowing(e) {
    try {
      const menu = (e && (e.currentTarget || e.target)) || null;
      if (!menu || typeof menu.appendChild !== "function") {
        return;
      }
      clearPinMenu();
      const tab = contextClickedTab(e);
      if (!tab || !tab.pinned) {
        return;
      }
      const stored = effectivePinURL(tab);
      const reset = makeDockMenuItem("aph-pinreset-reset", "Reset to Pinned Page", () => {
        try {
          resetPinTab(tab);
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
          pinMenuItems.push(reset);
        } catch (err) {}
      }
      const edit = makeDockMenuItem("aph-pinreset-set", "Set Pinned Page…", () => {
        try {
          // Live-first: Enter alone re-pins the current page (the common
          // "make this the base" case); stored is the fallback.
          promptPinURL(tab, tabSpec(tab) || stored);
        } catch (err) {}
      });
      if (edit) {
        try {
          menu.appendChild(edit);
          pinMenuItems.push(edit);
        } catch (err) {}
      }
    } catch (err) {}
  }

  function cleanupPinReset() {
    try {
      clearPinMenu();
    } catch (e) {}
    try {
      if (gBrowser && gBrowser.tabContainer) {
        gBrowser.tabContainer.removeEventListener("TabPinned", onPinChanged);
        gBrowser.tabContainer.removeEventListener("TabUnpinned", onPinChanged);
      }
    } catch (e) {}
    try {
      const menu = document.getElementById("tabContextMenu");
      if (menu) {
        menu.removeEventListener("popupshowing", onPinMenuShowing);
      }
    } catch (e) {}
  }

  function initPinReset() {
    try {
      if (!gBrowser || !gBrowser.tabContainer) {
        return;
      }
      gBrowser.tabContainer.addEventListener("TabPinned", onPinChanged);
      gBrowser.tabContainer.addEventListener("TabUnpinned", onPinChanged);
    } catch (e) {}
    try {
      const menu = document.getElementById("tabContextMenu");
      if (menu && typeof menu.addEventListener === "function") {
        menu.addEventListener("popupshowing", onPinMenuShowing);
      }
    } catch (e) {}
    try {
      window.addEventListener("unload", cleanupPinReset, { once: true });
    } catch (e) {}
    try {
      window.AphPinReset = {
        getPinURL,
        setPinURL,
        clearPinURL,
        resetPinTab,
        capturePinDefault: onPinChanged,
        PIN_URL_KEY,
        debug: () => {
          try {
            return { lastError: pinLastError || null };
          } catch (err) {
            return { lastError: "debug-threw" };
          }
        },
      };
    } catch (e) {}
  }

  if (document.readyState === "complete") {
    initPinReset();
  } else {
    window.addEventListener("load", initPinReset, { once: true });
  }
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
  // The tab close button shows a star instead of the X on starred tabs
  // (theme.css §18 swaps the glyph); activating it unstars (below).
  const STAR_CLOSE_SELECTOR = ".tab-close-button";
  const STAR_CLOSE_TIP = "Unstar tab";

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
      // Restored before SSTabRestored re-applies: attribute backstop. A
      // present-but-false hasAttribute implies getAttribute is null, so a
      // single branch covers both DOM and exotic tab-likes.
      try {
        if (typeof tab.hasAttribute === "function") {
          return tab.hasAttribute(STAR_ATTR);
        }
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

  function applyStarAttribute(tab) {
    try {
      if (!tab) {
        return;
      }
      const on = isStarredTab(tab);
      try {
        if (on) {
          if (typeof tab.setAttribute === "function") {
            tab.setAttribute(STAR_ATTR, "1");
          }
        } else if (typeof tab.removeAttribute === "function") {
          tab.removeAttribute(STAR_ATTR);
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
        }
      } catch (e) {}
      try {
        syncStarCloseTooltip(tab);
      } catch (e) {}
    } catch (e) {}
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
      return true;
    } catch (e) {
      return false;
    }
  }

  function unstarTab(tab) {
    try {
      if (!tab || !isStarredTab(tab)) {
        return false;
      }
      clearStar(tab);
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
          btn.setAttribute("tooltiptext", STAR_CLOSE_TIP);
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
    } catch (e) {}
  }

  function cleanupStar() {
    try {
      clearStarMenu();
    } catch (e) {}
    try {
      if (gBrowser && gBrowser.tabContainer) {
        gBrowser.tabContainer.removeEventListener("TabPinned", onStarTabPinned);
        gBrowser.tabContainer.removeEventListener("SSTabRestored", onStarTabRestored);
        gBrowser.tabContainer.removeEventListener("click", onStarCloseEvent, true);
        gBrowser.tabContainer.removeEventListener("command", onStarCloseEvent, true);
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
        gBrowser.tabContainer.addEventListener("click", onStarCloseEvent, true);
        gBrowser.tabContainer.addEventListener("command", onStarCloseEvent, true);
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
        getStarURL,
        setStarURL,
        starTab,
        unstarTab,
        toggleStarTab,
        toggleSelectedStar,
        resetStarTab,
        promptStarURL,
        STAR_FLAG_KEY,
        STAR_URL_KEY,
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
    // Session restore owns this tab until SSTabRestored: extData (aphWs)
    // has not been applied yet, so every write below — birth
    // age, last-viewed, fresh flag, container repair, stamp —
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
    // Restored tabs just keep their workspace tags.
    let restoreSettled = true;
    try {
      restoreSettled =
        typeof isRestoringTab !== "function" || !isRestoringTab(tab);
    } catch (err) {}
    if (!restoreSettled) {
      try {
        setTimeout(() => {
          try {
            if (tab.closing) {
              return;
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

  // Selecting counts as viewing for auto-archive staleness (same stamp
  // as birth in onTabOpen; never on SSTabRestored, where restore must
  // not look like viewing).
  function onTabSelect(e) {
    try {
      const tab =
        (e && e.target) ||
        (typeof gBrowser !== "undefined" && gBrowser && gBrowser.selectedTab) ||
        null;
      if (!tab || tab.closing) {
        return;
      }
      if (typeof stampLastViewed === "function") {
        stampLastViewed(tab);
      }
    } catch (err) {}
  }

  function onTabClose(e) {
    const tab = e.target;
    for (const id of Object.keys(lastSelected)) {
      if (lastSelected[id] === tab) {
        delete lastSelected[id];
      }
    }
    cleanupTempContainer(tab);
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
      if (!isValidId(current)) {
        return;
      }
      if (tab.pinned) {
        if (tab.hidden) {
          aphShowTab(tab);
        }
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
      renderDock();
    } catch (err) {}
  }

  // One-line diagnostics for the Browser Console (Ctrl+Shift+J).
  function routeLog(msg) {
    try {
      Services.console.logStringMessage(`[AphRoutes] ${msg}`);
    } catch (e) {}
  }

  // Retag a fresh tab into its routed workspace. When the target workspace
  // has a bound container the tab can't just be retagged (userContextId is
  // immutable once loading starts), so a fresh tab — no history worth
  // keeping — is reopened in the bound container and the original closed,
  // exactly like stock container extensions do. Foreground tabs pull the
  // window along via switchTo; background tabs move silently. The
  // replacement is born settled so its own location change never
  // re-triggers routing (no loops). specHint overrides the reopened URL:
  // the pre-dispatch path (onStateChange) knows the channel's target URI
  // while the tab's own currentURI still shows the previous page.
  function routeTab(tab, target, specHint) {
    if (!isValidId(target) || !tab || tab.closing) {
      return;
    }
    try {
      let prevSel = null;
      try {
        prevSel = gBrowser.selectedTab;
      } catch (e) {}
      const selected = prevSel === tab;
      const bound = getWsContainerId(target);
      let cid = 0;
      try {
        cid = tab.userContextId || 0;
      } catch (e) {}
    let spec = "";
    try {
      spec = String(specHint || tab.linkedBrowser?.currentURI?.spec || "");
    } catch (e) {}
      if (bound && spec && !/^about:/.test(spec) && cid !== bound) {
        let rep = null;
        try {
          rep = gBrowser.addTrustedTab(spec, { userContextId: bound });
        } catch (e) {
          rep = null;
        }
        if (rep) {
          try {
            rep.__aphFresh = false;
          } catch (e) {}
          try {
            gBrowser.ungroupTab(rep);
          } catch (e) {}
          setWs(rep, target);
          if (selected && target !== current) {
            switchTo(target);
          }
          try {
            if (rep.group?.collapsed) {
              rep.group.collapsed = false;
            }
          } catch (e) {}
          if (selected) {
            aphShowTab(rep);
            try {
              gBrowser.selectedTab = rep;
            } catch (e) {}
            try {
              lastSelected[target] = rep;
            } catch (e) {}
          } else {
            if (target !== current) {
              aphHideTab(rep);
            } else {
              aphShowTab(rep);
            }
            // addTrustedTab may have stolen selection — give it back.
            if (prevSel && !prevSel.closing && gBrowser.selectedTab !== prevSel) {
              try {
                gBrowser.selectedTab = prevSel;
              } catch (e) {}
            }
          }
          try {
            if (typeof aphTabsLog === "function") {
              aphTabsLog(`route-reopen ws=${target} closing ${aphTabDesc(tab)}`);
            }
          } catch (e) {}
          try {
            gBrowser.removeTab(tab, { animate: false });
          } catch (e) {
            try {
              gBrowser.removeTab(tab);
            } catch (_e) {}
          }
          // Scrub the reopen ghost: undo must not resurrect the
          // wrong-container original as a duplicate of the replacement.
          try {
            if (typeof scrubAdoptionGhost === "function") {
              scrubAdoptionGhost(window, tab);
            }
          } catch (e) {}
          routeLog(`reopened in container ${bound} (was ${cid})`);
          return;
        }
        // Reopen failed — fall through to a plain retag.
      }
      setWs(tab, target);
      if (selected && target !== current) {
        switchTo(target);
        try {
          if (tab.group?.collapsed) {
            tab.group.collapsed = false;
          }
        } catch (e) {}
        aphShowTab(tab);
        try {
          gBrowser.selectedTab = tab;
        } catch (e) {}
        try {
          lastSelected[target] = tab;
        } catch (e) {}
      } else if (!selected && target !== current) {
        aphHideTab(tab);
      } else {
        aphShowTab(tab);
      }
    } catch (e) {}
  }

  // Extension first-run silencer (startup interceptor): managed extensions
  // installed via policies.json ExtensionSettings (e.g. SponsorBlock) can
  // open welcome/help tabs on install — chrome.tabs.create fires on the
  // extension's onInstalled event, which no 3rdparty policy can suppress
  // for addons without managed-storage support. Those tabs are junk by
  // construction, so they are closed pre-paint (channel cancelled, then
  // removed) with a commit-stage backstop, reusing the domain router's two
  // stages. Precision guards (all must hold — fail closed): kill-switch
  // pref on, moz-extension scheme, welcome-path pattern, tab born seconds
  // ago via TabOpen (never a restored tab), first content still blank
  // (never a deliberate navigation), and no opener tab (never a link).
  const ADDON_SILENCE_PREF = "aph.addons.silenceFirstRun";
  const ADDON_SILENCE_MAX_AGE_MS = 30000;
  const ADDON_FIRSTRUN_PATTERNS = [
    "/help/index.html",
    "first-run",
    "welcome",
    "onboarding",
    "installed",
    "thank-you",
  ];

  function getSilenceFirstRun() {
    try {
      if (Services.prefs && typeof Services.prefs.getBoolPref === "function") {
        return Services.prefs.getBoolPref(ADDON_SILENCE_PREF);
      }
    } catch (e) {}
    return true;
  }

  function isAddonFirstRunSpec(spec) {
    try {
      const lower = String(spec || "").toLowerCase();
      if (!lower.startsWith("moz-extension://")) {
        return false;
      }
      for (const pat of ADDON_FIRSTRUN_PATTERNS) {
        if (lower.includes(pat)) {
          return true;
        }
      }
    } catch (e) {}
    return false;
  }

  // Brand-new tabs show about:blank (extension tabs.create) — anything else
  // means content already lived here; never touch those.
  function isFirstContentTab(tab) {
    try {
      const cur = String(tab.linkedBrowser?.currentURI?.spec || "");
      return cur === "about:blank" || cur === "about:newtab" || cur === "about:home" || cur === "";
    } catch (e) {
      return false;
    }
  }

  function isYoungTab(tab) {
    try {
      const birth = (tab && tab.__aphBirth) || 0;
      if (!birth) {
        return false;
      }
      return Date.now() - birth <= ADDON_SILENCE_MAX_AGE_MS;
    } catch (e) {
      return false;
    }
  }

  // Returns true when the tab was closed.
  function silenceAddonTab(tab, spec, request) {
    try {
      if (!tab || tab.closing) {
        return false;
      }
      // Session-restored tabs are born young with blank content in TabOpen
      // (birth stamped before SessionStore applies extData) — never mistake
      // a restored extension page for a fresh install tab.
      try {
        if (
          SessionStore &&
          typeof SessionStore.isTabRestoring === "function" &&
          SessionStore.isTabRestoring(tab)
        ) {
          return false;
        }
      } catch (e) {}
      if (!getSilenceFirstRun() || !isAddonFirstRunSpec(spec)) {
        return false;
      }
      if (!isYoungTab(tab) || !isFirstContentTab(tab)) {
        return false;
      }
      // Followed links carry a stock openerTab — never silence those.
      try {
        if (tab.openerTab) {
          return false;
        }
      } catch (e) {}
      try {
        tab.__aphFresh = false;
      } catch (e) {}
      // Cancel pre-paint so nothing flashes, then remove (same abort code
      // the domain router uses).
      try {
        if (request && typeof request.cancel === "function") {
          let aborted = 0x804b0002; // NS_BINDING_ABORTED
          try {
            if (typeof Cr !== "undefined" && Cr && typeof Cr.NS_BINDING_ABORTED === "number") {
              aborted = Cr.NS_BINDING_ABORTED;
            } else if (
              typeof Components !== "undefined" &&
              Components &&
              Components.results &&
              typeof Components.results.NS_BINDING_ABORTED === "number"
            ) {
              aborted = Components.results.NS_BINDING_ABORTED;
            }
          } catch (e) {}
          request.cancel(aborted);
        }
      } catch (e) {}
      try {
        gBrowser.removeTab(tab, { animate: false });
      } catch (e) {
        try {
          gBrowser.removeTab(tab);
        } catch (_e) {
          return false;
        }
      }
      try {
        routeLog(`silenced addon first-run tab (${String(spec || "").slice(0, 80)})`);
      } catch (e) {}
      return true;
    } catch (e) {
      return false;
    }
  }

  // Pre-paint router, two stages sharing the fresh-tab protocol:
  // 1. onStateChange (document STATE_START): the channel exists but nothing
  //    has hit the wire yet (no DNS, no TLS, no cookies). A matching rule
  //    cancels the channel synchronously and reopens bound immediately —
  //    the wrong container never dispatches. Non-matches stay fresh so
  //    redirect chains keep evaluating per hop; the commit stage settles.
  // 2. onLocationChange (commit): backstop for anything the START stage
  //    missed (cancel threw, notification skipped). Settles the tab even
  //    when no rule matches, so later redirect chains (OAuth/SSO
  //    handshakes) and in-tab navigations never route.
  // Signature NOTE: tabbrowser tabs-listeners are called as
  // (browser, webProgress, request, location, flags) — the <browser>
  // element is unshifted first (TabProgressListener wrapper, then again
  // for tabs in _callProgressListeners). NOT the stock listener order.
  // State bits / cancel result resolve from Ci/Cr with IDL literals as
  // fallback (Cr is absent in some contexts, e.g. tests).
  const routeListener = {
    QueryInterface: (() => {
      try {
        return ChromeUtils.generateQI([
          "nsIWebProgressListener",
          "nsISupportsWeakReference",
        ]);
      } catch (e) {
        return () => {};
      }
    })(),
    onLocationChange(aBrowser, aWebProgress, aRequest, aLocation, aFlags) {
      try {
        let tab = null;
        try {
          tab = gBrowser.getTabForBrowser(aBrowser);
        } catch (e) {
          return;
        }
        if (!tab || tab.closing) {
          return;
        }
        try {
          if (!aWebProgress || !aWebProgress.isTopLevel) {
            return;
          }
        } catch (e) {
          return;
        }
        try {
          if (aFlags & Ci.nsIWebProgressListener.LOCATION_CHANGE_SAME_DOCUMENT) {
            return;
          }
        } catch (e) {}
        // Session restore in flight for this tab (created tagless via
        // TabOpen, extData applied after): never route it — its first
        // commit looks exactly like a fresh navigation. Settle it so no
        // later stage claims it either. (The silencer guards itself.)
        try {
          if (
            SessionStore &&
            typeof SessionStore.isTabRestoring === "function" &&
            SessionStore.isTabRestoring(tab)
          ) {
            try {
              tab.__aphFresh = false;
            } catch (e) {}
            return;
          }
        } catch (e) {}
        let scheme = "";
        try {
          scheme = String(aLocation.scheme || "").toLowerCase();
        } catch (e) {
          return;
        }
        // Commit-stage backstop for the addon first-run silencer (covers a
        // missed pre-dispatch). aLocation always has .spec in chrome.
        if (scheme === "moz-extension") {
          let spec = "";
          try {
            spec = String(aLocation.spec || "");
          } catch (e) {}
          silenceAddonTab(tab, spec, aRequest);
          return;
        }
        if (scheme !== "http" && scheme !== "https") {
          return;
        }
        const host = normalizeHost(
          (() => {
            try {
              return aLocation.asciiHost;
            } catch (e) {
              return "";
            }
          })()
        );
        if (!host) {
          return;
        }
        let fresh = false;
        try {
          fresh = !!tab.__aphFresh;
        } catch (e) {}
        if (!fresh) {
          return;
        }
        try {
          tab.__aphFresh = false;
        } catch (e) {}
        const m = matchRoute(host);
        if (!m || getWs(tab) === m.ws) {
          return;
        }
        routeLog(`routing ${host} -> workspace ${m.ws} (rule ${m.pattern})`);
        routeTab(tab, m.ws);
      } catch (e) {}
    },
    onStateChange(aBrowser, aWebProgress, aRequest, aStateFlags, aStatus) {
      try {
        let stateStart = 1; // nsIWebProgressListener.STATE_START
        let stateIsDocument = 0x20000; // ...STATE_IS_DOCUMENT
        try {
          const wpl = Ci.nsIWebProgressListener || {};
          if (typeof wpl.STATE_START === "number") {
            stateStart = wpl.STATE_START;
          }
          if (typeof wpl.STATE_IS_DOCUMENT === "number") {
            stateIsDocument = wpl.STATE_IS_DOCUMENT;
          }
        } catch (e) {}
        if (!(aStateFlags & stateStart) || !(aStateFlags & stateIsDocument)) {
          return;
        }
        let tab = null;
        try {
          tab = gBrowser.getTabForBrowser(aBrowser);
        } catch (e) {
          return;
        }
        if (!tab || tab.closing) {
          return;
        }
        try {
          if (!aWebProgress || !aWebProgress.isTopLevel) {
            return;
          }
        } catch (e) {
          return;
        }
        // Same restore guard as the commit stage: a restoring tab's
        // pre-dispatch channel looks like a fresh navigation.
        try {
          if (
            SessionStore &&
            typeof SessionStore.isTabRestoring === "function" &&
            SessionStore.isTabRestoring(tab)
          ) {
            try {
              tab.__aphFresh = false;
            } catch (e) {}
            return;
          }
        } catch (e) {}
        // Channel URI: the pre-redirect target, known before dispatch.
        let channel = aRequest;
        try {
          if (channel && typeof channel.QueryInterface === "function" && Ci.nsIChannel) {
            channel = channel.QueryInterface(Ci.nsIChannel);
          }
        } catch (e) {}
        let uri = null;
        try {
          uri = (channel && channel.URI) || null;
        } catch (e) {
          return;
        }
        if (!uri) {
          return;
        }
        let scheme = "";
        try {
          scheme = String(uri.scheme || "").toLowerCase();
        } catch (e) {
          return;
        }
        // Pre-dispatch stage for the addon first-run silencer: the channel
        // exists but nothing has painted yet.
        if (scheme === "moz-extension") {
          let spec = "";
          try {
            spec = String((uri && uri.spec) || "");
          } catch (e) {}
          silenceAddonTab(tab, spec, aRequest);
          return;
        }
        if (scheme !== "http" && scheme !== "https") {
          return;
        }
        const host = normalizeHost(
          (() => {
            try {
              return uri.asciiHost;
            } catch (e) {
              return "";
            }
          })()
        );
        if (!host) {
          return;
        }
        let fresh = false;
        try {
          fresh = !!tab.__aphFresh;
        } catch (e) {}
        if (!fresh) {
          return;
        }
        const m = matchRoute(host);
        if (!m || getWs(tab) === m.ws) {
          return;
        }
        // Match: settle now so the commit backstop won't double-route.
        try {
          tab.__aphFresh = false;
        } catch (e) {}
        // Cancel pre-dispatch: best-effort. If it throws, the commit
        // backstop still migrates (with the old leak, but correctly placed).
        try {
          if (aRequest && typeof aRequest.cancel === "function") {
            let aborted = 0x804b0002; // NS_BINDING_ABORTED
            try {
              if (typeof Cr !== "undefined" && Cr && typeof Cr.NS_BINDING_ABORTED === "number") {
                aborted = Cr.NS_BINDING_ABORTED;
              } else if (
                typeof Components !== "undefined" &&
                Components &&
                Components.results &&
                typeof Components.results.NS_BINDING_ABORTED === "number"
              ) {
                aborted = Components.results.NS_BINDING_ABORTED;
              }
            } catch (e) {}
            aRequest.cancel(aborted);
          }
        } catch (e) {}
        let spec = "";
        try {
          spec = String(uri.spec || "");
        } catch (e) {}
        routeLog(`routing ${host} -> workspace ${m.ws} (rule ${m.pattern}) pre-dispatch`);
        routeTab(tab, m.ws, spec);
      } catch (e) {}
    },
    onProgressChange() {},
    onStatusChange() {},
    onSecurityChange() {},
    onContentBlockingEvent() {},
  };

  function initRouteListener() {
    try {
      if (!gBrowser || !gBrowser.addTabsProgressListener) {
        routeLog("OFF: gBrowser.addTabsProgressListener missing");
        return;
      }
      // Takes only the listener (no mask) in this build.
      gBrowser.addTabsProgressListener(routeListener);
      // Progress listeners are held weakly — keep our own strong ref.
      try {
        window.__aphRouteListener = routeListener;
      } catch (e) {}
      routeLog("on");
    } catch (e) {
      routeLog(`OFF: register failed (${e})`);
    }
  }

  // TabGroupCreate fires before members are adopted — defer past the settle.
  // Robust to target shapes: tab-group element (normal), tab inside a
  // group (some flows dispatch on the tab), or nothing usable (removal —
  // fall back to a full header sync so a destroyed group's header can't
  // linger visible).
  function onGroupChange(e) {
    let group = null;
    try {
      const t = e && e.target;
      if (t && typeof t.closest === "function") {
        group = t.closest("tab-group");
      }
      if (!group && t && t.group) {
        group = t.group;
      }
    } catch (err) {
      group = null;
    }
    if (!group) {
      try {
        if (isValidId(current) && typeof syncGroupHeaders === "function") {
          syncGroupHeaders(current);
        }
      } catch (err) {}
      return;
    }
    try {
      setTimeout(() => unifyGroup(group), 0);
    } catch (err) {
      unifyGroup(group);
    }
  }

  // New windows (Ctrl+N) land on the lowest workspace no other live
  // window claims, instead of inheriting the source window's workspace, so
  // two fresh windows don't open on top of each other. Stored value wins
  // (session restore); otherwise the opener's workspace is inherited
  // (window-scoped: sharing an id is harmless — independent tab sets).
  function initialWorkspace() {
    try {
      const w = SessionStore.getCustomWindowValue(window, WIN_KEY);
      if (isValidId(w)) {
        return w;
      }
    } catch (e) {}
    try {
      const op = window.opener;
      if (op && op !== window && !op.closed) {
        const ow = SessionStore.getCustomWindowValue(op, WIN_KEY);
        if (isValidId(ow)) {
          return ow;
        }
      }
    } catch (e) {}
    try {
      if (typeof lowestUnownedWorkspace === "function") {
        const free = lowestUnownedWorkspace();
        if (isValidId(free)) {
          return free;
        }
      }
    } catch (e) {}
    try {
      if (typeof Services !== "undefined" && Services.wm) {
        const recent = Services.wm.getMostRecentWindow("navigator:browser");
        if (recent && recent !== window && !recent.closed) {
          const rw = SessionStore.getCustomWindowValue(recent, WIN_KEY);
          if (isValidId(rw)) {
            return rw;
          }
        }
        const en = Services.wm.getEnumerator("navigator:browser");
        while (en.hasMoreElements()) {
          const w = en.getNext();
          if (!w || w === window || w.closed) {
            continue;
          }
          try {
            const v = SessionStore.getCustomWindowValue(w, WIN_KEY);
            if (isValidId(v)) {
              return v;
            }
          } catch (_e) {}
        }
      }
    } catch (e) {}
    return "1";
  }

  // Startup: SessionStore restores window values + tab tags asynchronously,
  // so the value read in init() can miss. Re-read once session restore
  // finishes (observer) with a timeout fallback, then land on it.
  // Falls back to the restored selected tab's workspace when no value yet.
  function startupRestore() {
    let target = null;
    try {
      const w = SessionStore.getCustomWindowValue(window, WIN_KEY);
      if (isValidId(w)) {
        target = w;
      }
    } catch (e) {}
    if (!target) {
      try {
        const sel = gBrowser.selectedTab;
        const sw = sel ? rawWs(sel) : null;
        if (isValidId(sw)) {
          target = sw;
        }
      } catch (e) {}
    }
    if (!target || target === current) {
      try {
        anchorAllGroups();
      } catch (e) {}
      try {
        reconcile(isValidId(current) ? current : "1", Array.from(gBrowser.tabs));
      } catch (e) {}
      try {
        pruneExtraNewTabs(isValidId(current) ? current : "1");
      } catch (e) {}
      return;
    }
    // Window-scoped landing: each window restores its own saved workspace
    // and reconciles its own strip (switchLocal — purely local). Same-id
    // workspaces elsewhere are independent tab sets; no de-dupe needed.
    // Prefer the restored selected tab when it already lives in target,
    // so we focus the exact tab left open instead of the first in order.
    try {
      const sel = gBrowser.selectedTab;
      if (sel && !sel.closing && rawWs(sel) === target) {
        lastSelected[target] = sel;
      }
    } catch (e) {}
    try {
      if (typeof switchLocal === "function") {
        switchLocal(target);
      } else {
        switchTo(target);
      }
    } catch (e) {}
  }

  let startupRestoreDone = false;
  function runStartupRestoreOnce() {
    if (startupRestoreDone) {
      return;
    }
    startupRestoreDone = true;
    try {
      startupRestore();
    } catch (e) {}
    // Bulk-restored tabs can arrive with tag/container still settling when
    // their SSTabRestored fires — one full chrome pass once session
    // restore completes, so no tab waits on a binding change for markers.
    try {
      if (typeof syncAllTabChrome === "function") {
        syncAllTabChrome();
      }
    } catch (e) {}
  }

  function scheduleStartupRestore() {
    try {
      if (typeof Services !== "undefined" && Services.obs) {
        startupRestoreObserver = {
          observe() {
            try {
              Services.obs.removeObserver(
                startupRestoreObserver,
                "sessionstore-windows-restored"
              );
            } catch (e) {}
            startupRestoreObserver = null;
            setTimeout(runStartupRestoreOnce, 0);
          },
        };
        Services.obs.addObserver(startupRestoreObserver, "sessionstore-windows-restored", false);
      }
    } catch (e) {
      startupRestoreObserver = null;
    }
    // Fallback in case the notification already fired or obs is unavailable.
    setTimeout(runStartupRestoreOnce, 3000);
  }

  // Keep the auto-hide top bar pinned while a nav-bar popup (uBO,
  // extensions, hamburger, all-tabs) is open. Pure `:hover` loses when the
  // mouse moves from the button into the panel, the anchor slides away, and
  // the popup closes. CSS `:has([open])` covers it when supported; this JS
  // sets [data-aph-popup-open] as the bulletproof fallback.
  function initNavPopupHold() {
    let toolbox = null;
    let navBar = null;
    try {
      toolbox = document.getElementById("navigator-toolbox");
      navBar = document.getElementById("nav-bar");
    } catch (e) {}
    if (!toolbox || !navBar) {
      return;
    }
    const openPopups = new Set();

    function syncHold() {
      let hasOpen = false;
      try {
        hasOpen = !!navBar.querySelector(
          ":is(toolbarbutton, toolbaritem)[open='true'], :is(toolbarbutton, toolbaritem)[open]"
        );
      } catch (e) {}
      const held = hasOpen || openPopups.size > 0;
      for (const el of [toolbox, navBar]) {
        try {
          if (held) {
            el.setAttribute("data-aph-popup-open", "1");
          } else {
            el.removeAttribute("data-aph-popup-open");
          }
        } catch (e) {}
      }
    }

    function popupAnchorInNavBar(popup) {
      try {
        const anchor = popup.triggerNode || popup.anchorNode;
        if (anchor && anchor.nodeType === 1) {
          if (typeof anchor.closest === "function" && anchor.closest("#nav-bar")) {
            return true;
          }
          try {
            if (navBar.contains(anchor)) {
              return true;
            }
          } catch (e) {}
        }
      } catch (e) {}
      // Extension popups don't always expose triggerNode — if a nav-bar
      // button is currently [open], assume the popup belongs to it.
      try {
        if (navBar.querySelector(":is(toolbarbutton, toolbaritem)[open]")) {
          return true;
        }
      } catch (e) {}
      return false;
    }

    try {
      const obs = new MutationObserver(syncHold);
      obs.observe(navBar, {
        subtree: true,
        attributes: true,
        attributeFilter: ["open", "aria-expanded"],
      });
      navPopupObserver = obs;
    } catch (e) {
      navPopupObserver = null;
    }

    window.addEventListener(
      "popupshowing",
      (e) => {
        try {
          const p = e.target;
          if (!p || (p.localName !== "menupopup" && p.localName !== "panel")) {
            return;
          }
          if (popupAnchorInNavBar(p)) {
            openPopups.add(p);
            syncHold();
          }
        } catch (err) {}
      },
      true
    );
    const onHide = (e) => {
      try {
        const p = e.target;
        if (openPopups.has(p)) {
          openPopups.delete(p);
        }
      } catch (err) {}
      // popuphidden fires before [open] clears — defer one tick.
      setTimeout(syncHold, 0);
    };
    window.addEventListener("popuphidden", onHide, true);
    window.addEventListener("popuphiding", onHide, true);
    syncHold();
    return navPopupObserver;
  }

  // Releases every process-global registration owned by this window.
  // Services hold their observers strongly: without this, each closed
  // window stays reachable (observer -> closure -> document/gBrowser) and
  // leaks until process exit.
  function cleanupWindowObservers() {
    // Window-scoped: closing needs no tab shuffling. SessionStore records
    // this window as-is for native undo (Recently Closed Windows); other
    // windows are never touched.
    try {
      if (bindingObserver) {
        Services.prefs.removeObserver(WS_CONTAINER_PREF, bindingObserver);
      }
    } catch (e) {}
    try {
      if (routeObserver) {
        Services.prefs.removeObserver(WS_ROUTES_PREF, routeObserver);
      }
    } catch (e) {}
    try {
      if (nameObserver) {
        Services.prefs.removeObserver(WS_NAMES_PREF, nameObserver);
      }
    } catch (e) {}
    bindingObserver = null;
    routeObserver = null;
    nameObserver = null;
    try {
      if (startupRestoreObserver && Services.obs) {
        Services.obs.removeObserver(
          startupRestoreObserver,
          "sessionstore-windows-restored"
        );
      }
    } catch (e) {}
    startupRestoreObserver = null;
    try {
      if (navPopupObserver && typeof navPopupObserver.disconnect === "function") {
        navPopupObserver.disconnect();
      }
    } catch (e) {}
    navPopupObserver = null;
    try {
      cleanupDock();
    } catch (e) {}
    try {
      if (typeof cleanupSidebarFooter === "function") {
        cleanupSidebarFooter();
      }
    } catch (e) {}
    try {
      if (
        window.__aphNewTabWrapped &&
        typeof origBrowserOpenTab === "function"
      ) {
        window.BrowserOpenTab = origBrowserOpenTab;
      }
    } catch (e) {}
    try {
      window.__aphNewTabWrapped = false;
    } catch (e) {}
    origBrowserOpenTab = null;
    try {
      if (wsPulseTimer) {
        clearTimeout(wsPulseTimer);
        wsPulseTimer = null;
      }
    } catch (e) {}
    try {
      if (typeof gBrowser !== "undefined" &&
        gBrowser &&
        typeof gBrowser.removeTabsProgressListener === "function"
      ) {
        gBrowser.removeTabsProgressListener(routeListener);
      }
    } catch (e) {}
    try {
      if (window.__aphRouteListener === routeListener) {
        window.__aphRouteListener = null;
      }
    } catch (e) {}
  }

  // Navbar order needs no runtime repair: `just rebrand` patches
  // verticalTabsDefaultPlacements in CustomizableUI.sys.mjs (root omni.ja)
  // so vertical-tabs profiles inherit the full stock navbar at birth.
  // See scripts/aph_rebrand/injectors/toolbar.py. Already-wiped profiles
  // heal via Customize > Restore Defaults (or `just nuke` for a fresh one).

  // Bound-workspace new tabs are born containered: wrap the window's
  // BrowserOpenTab (+ button, menus) so a bound workspace opens the tab
  // directly in its container — no phantom tab, no deferred swap, no
  // Recently-Closed pollution, no typing race. Unbound workspaces fall
  // through to stock (args and return preserved); private windows always
  // fall through (containers don't exist there). Coverage is narrow on
  // purpose: births that never call BrowserOpenTab (window.open,
  // extensions, restore) still arrive via TabOpen, where
  // armContainerRepair remains the fallback.
  function initBoundNewTab() {
    let orig = null;
    try {
      if (window.__aphNewTabWrapped) {
        return;
      }
      orig = window.BrowserOpenTab;
      if (typeof orig !== "function") {
        orig = null;
      }
    } catch (e) {
      orig = null;
    }
    origBrowserOpenTab = orig;
    const wrapped = function (...args) {
      let isPrivate = false;
      try {
        const pbu = window.PrivateBrowsingUtils;
        if (pbu && typeof pbu.isWindowPrivate === "function") {
          isPrivate = !!pbu.isWindowPrivate(window);
        }
      } catch (e) {}
      if (!isPrivate) {
        try {
          const bound = isValidId(current) ? getWsContainerId(current) : 0;
          if (bound) {
            return openBoundTab("about:newtab", current);
          }
        } catch (e) {}
      }
      try {
        if (typeof origBrowserOpenTab === "function") {
          return origBrowserOpenTab.apply(window, args);
        }
      } catch (e) {
        return null;
      }
      if (isPrivate) {
        return null;
      }
      // No stock opener (tests, popups): plain open beats dropping the tab.
      try {
        return openBoundTab("about:newtab", current);
      } catch (e) {}
      return null;
    };
    try {
      window.BrowserOpenTab = wrapped;
      window.__aphNewTabWrapped = true;
    } catch (e) {}
  }

  function init() {
    // Public API for command palette (and future chrome UI).
    try {
      window.AphWorkspaces = {
        switchTo,
        switchLocal: typeof switchLocal === "function" ? switchLocal : switchTo,
        listWindows:
          typeof listWindows === "function" ? listWindows : () => [],
        moveTabsToWindow:
          typeof moveTabsToWindow === "function" ? moveTabsToWindow : () => 0,
        debugExclusive:
          typeof debugExclusive === "function" ? debugExclusive : () => ({}),
        debugSession:
          typeof debugSession === "function" ? debugSession : () => ([]),
        scrubAdoptionGhost:
          typeof scrubAdoptionGhost === "function" ? scrubAdoptionGhost : () => {},
        sendTabTo,
        sendGroupTo,
        cycleWorkspace,
        toggleLastWorkspace,
        getActiveWorkspaces: getActiveIds,
        getLastWorkspace: () => lastUsed,
        openTempTab,
        openBoundTab,
        openInWorkspace,
        bindCurrentWs: bindCurrentWsToSelectedTab,
        clearWsBinding,
        setWsBinding,
        listContainers,
        getWsContainer: getWsContainerId,
        describeContainer,
        getRoutes: getAllRoutes,
        setRoute,
        deleteRoute,
        matchRoute,
        getWsName,
        setWsName,
        getCurrent: () => current,
        getWs,
        stampLastViewed,
        isTabMatchingBinding,
        syncTabBindingMatch,
        syncAllTabBindingMatches,
        syncTabChrome,
        syncAllTabChrome,
        canUnloadTab,
        unloadEligibleTabs,
        getUnloadOnSwitch,
        renderDock,
        closeWorkspaceTabs,
        applySidebarFooter:
          typeof applySidebarFooter === "function" ? applySidebarFooter : () => false,
      };
    } catch (e) {}
    current = initialWorkspace();
    // Stamp the live claim immediately: the restore path can settle without
    // passing through beginWorkspaceSwitch, and other windows must see this
    // window's workspace from birth, not from its first manual switch.
    try {
      if (isValidId(current) && typeof setWindowWs === "function") {
        setWindowWs(current);
      }
    } catch (e) {}
    if (isValidId(current)) {
      try {
        gBrowser.tabContainer.setAttribute("data-aph-ws", current);
      } catch (e) {}
      // Birth stamp: same window-level claim as beginWorkspaceSwitch so
      // the per-workspace tint (§20) is correct before the first switch.
      try {
        if (typeof stampWindowWs === "function") {
          stampWindowWs(current);
        }
      } catch (e) {}
    }
    updateIndicator();
    try {
      for (const t of gBrowser.tabs) {
        // Restoring tabs are owned by SessionStore until SSTabRestored:
        // stamping now would race extData and freeze
        // a WS3 tab to this window's workspace. Skip them here.
        try {
          if (typeof isRestoringTab === "function" && isRestoringTab(t)) {
            continue;
          }
        } catch (e) {}
        if (!rawWs(t)) {
          setWs(t, isValidId(current) ? current : "1");
        }
        // Pre-existing tabs resume live pages — settled, never auto-route.
        try {
          t.__aphFresh = false;
        } catch (e) {}
        // Heal legacy per-workspace pins: pins are global, never hidden.
        try {
          if (t.pinned && t.hidden) {
            aphShowTab(t);
          }
        } catch (e) {}
      }
      // Restored tabs keep their tags (no setWs above) — sync markers anyway.
      syncAllTabChrome();
    } catch (e) {}
    // Session restore may not preserve hidden state; force a full pass.
    // Purely local (switchLocal): each window reconciles its own strip.
    try {
      const saved = isValidId(current) ? current : "1";
      current = saved === "1" ? "__force__" : "1";
      if (typeof switchLocal === "function") {
        switchLocal(saved);
      } else {
        switchTo(saved);
      }
    } catch (e) {}
    gBrowser.tabContainer.addEventListener("TabOpen", onTabOpen);
    gBrowser.tabContainer.addEventListener("TabSelect", onTabSelect);
    gBrowser.tabContainer.addEventListener("TabClose", onTabClose);
    gBrowser.tabContainer.addEventListener("SSTabRestored", onTabRestored);
    gBrowser.tabContainer.addEventListener("TabPinned", onTabPinned);
    gBrowser.tabContainer.addEventListener("TabUnpinned", onTabPinned);
    gBrowser.tabContainer.addEventListener("TabGroupCreate", onGroupChange);
    gBrowser.tabContainer.addEventListener("TabGroupUpdate", onGroupChange);
    // Defensive: collapse/expand and destroy flows vary by Firefox
    // version; unknown names never fire (harmless), known ones route to
    // the same deferred unify. TabMove/TabClose cover the rest.
    try {
      gBrowser.tabContainer.addEventListener("TabGroupRemoved", onGroupChange);
    } catch (e) {}
    try {
      gBrowser.tabContainer.addEventListener("TabGroupCollapse", onGroupChange);
    } catch (e) {}
    try {
      gBrowser.tabContainer.addEventListener("TabGroupExpand", onGroupChange);
    } catch (e) {}
    // Whole-group strip moves (verified TabGroupMoved in omni.ja
    // Tabbrowser.sys.mjs #handleTabMove): membership is unchanged but
    // headers sync idempotently through the same handler.
    try {
      gBrowser.tabContainer.addEventListener("TabGroupMoved", onGroupChange);
    } catch (e) {}
    window.addEventListener("keydown", onKey, true);
    try {
      navPopupObserver = initNavPopupHold() || null;
    } catch (e) {
      navPopupObserver = null;
    }
    try {
      initBoundNewTab();
    } catch (e) {}
    // Cross-window binding sync: re-read the pref + repaint the badge.
    try {
      bindingObserver = {
        observe() {
          try {
            wsBindings = null;
            updateIndicator();
            syncAllTabChrome();
          } catch (e) {}
        },
      };
      Services.prefs.addObserver(WS_CONTAINER_PREF, bindingObserver);
    } catch (e) {
      bindingObserver = null;
    }
    // Cross-window route sync: drop the cached rules so the next match
    // re-reads the pref.
    try {
      routeObserver = {
        observe() {
          try {
            wsRoutes = null;
          } catch (e) {}
        },
      };
      Services.prefs.addObserver(WS_ROUTES_PREF, routeObserver);
    } catch (e) {
      routeObserver = null;
    }
    // Cross-window name sync: drop the cache and repaint the badge.
    try {
      nameObserver = {
        observe() {
          try {
            wsNames = null;
            updateIndicator();
          } catch (e) {}
        },
      };
      Services.prefs.addObserver(WS_NAMES_PREF, nameObserver);
    } catch (e) {
      nameObserver = null;
    }
    try {
      initRouteListener();
    } catch (e) {}
    scheduleStartupRestore();
    // Global-service registrations above outlive this window unless removed.
    try {
      window.addEventListener("unload", cleanupWindowObservers, { once: true });
    } catch (e) {}
  }

  if (document.readyState === "complete") {
    init();
  } else {
    window.addEventListener("load", init, { once: true });
  }
})();
