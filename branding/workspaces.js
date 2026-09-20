/* GENERATED — do not edit by hand. Edit branding/src/, then run: python scripts/build_assets.py */
/* Aph workspaces: IDs "1"-"9", zero UI. Alt+Shift+1..9 jumps to a workspace,
 * Alt+Shift+]/Right cycles next active, Alt+Shift+[/Left cycles previous,
 * Alt+Shift+Tab toggles the last two used (MRU),
 * Ctrl+Alt+1..9 sends the selection there (stay here, focus next —
 * linked tree children ride along, whole native groups stay joined),
 * Ctrl+Alt+Shift+1..9 sends the whole tree explicitly.
 * Tab context menu offers Move Tab(s) / Move Tree / Move Group to Workspace
 * submenus; the dock accepts tab and group-header drops the same way.
 * Tree repair: Ctrl+Alt+Right indents the selected tab(s) under the tab
 * above, Ctrl+Alt+Left outdents (palette + tab context menu do the same).
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

  function getAllBindings() {
    const out = Object.create(null);
    for (let i = 1; i <= 9; i++) {
      const ws = String(i);
      const id = getWsContainerId(ws);
      if (id) {
        out[ws] = { userContextId: id, ...(describeContainer(id) || {}) };
      }
    }
    return out;
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
      try {
        if (typeof clearTreeParent === "function") {
          clearTreeParent(t);
        }
      } catch (e) {}
      try {
        if (typeof ensureTreeId === "function") {
          ensureTreeId(t);
        }
      } catch (e) {}
      try {
        if (typeof renderTree === "function") {
          renderTree();
        }
      } catch (e) {}
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
  // Archive restores land as Level 0 roots (no opener in this window).
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
      try {
        if (typeof clearTreeParent === "function") {
          clearTreeParent(t);
        }
      } catch (e) {}
      try {
        if (typeof ensureTreeId === "function") {
          ensureTreeId(t);
        }
      } catch (e) {}
      try {
        if (typeof renderTree === "function") {
          renderTree();
        }
      } catch (e) {}
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
          if (gBrowser.selectedTab !== tab) {
            // Background tab — leave it alone, tag normally.
            stampTab(tab);
            try {
              if (typeof treeAttachFromOpener === "function") {
                treeAttachFromOpener(tab, null);
              }
            } catch (_e) {}
            try {
              if (typeof renderTree === "function") {
                renderTree();
              }
            } catch (_e) {}
            return;
          }
          if (rawWs(tab) || (tab.userContextId || 0) !== 0) {
            return;
          }
          const uri = tab.linkedBrowser?.currentURI?.spec;
          if (uri !== "about:newtab" && uri !== "about:home") {
            // Navigated away meanwhile (link load, popup) — tag normally.
            stampTab(tab);
            try {
              if (typeof treeAttachFromOpener === "function") {
                treeAttachFromOpener(tab, null);
              }
            } catch (_e) {}
            try {
              if (typeof renderTree === "function") {
                renderTree();
              }
            } catch (_e) {}
            return;
          }
          if (!isValidId(current) || getWsContainerId(current) !== armed) {
            stampTab(tab);
            try {
              if (typeof treeAttachFromOpener === "function") {
                treeAttachFromOpener(tab, null);
              }
            } catch (_e) {}
            try {
              if (typeof renderTree === "function") {
                renderTree();
              }
            } catch (_e) {}
            return;
          }
          const replacement = gBrowser.addTrustedTab("about:newtab", { userContextId: armed });
          try {
            gBrowser.ungroupTab(replacement);
          } catch (e) {}
          setWs(replacement, current);
          // Manual new-tab swaps stay Level 0 roots.
          try {
            if (typeof clearTreeParent === "function") {
              clearTreeParent(replacement);
            }
          } catch (e) {}
          try {
            if (typeof ensureTreeId === "function") {
              ensureTreeId(replacement);
            }
          } catch (e) {}
          try {
            if (typeof renderTree === "function") {
              renderTree();
            }
          } catch (e) {}
          aphShowTab(replacement);
          try {
            gBrowser.selectedTab = replacement;
          } catch (e) {}
          // Stock focused the urlbar for the original tab; the swap moves
          // selection, so re-focus or typing lands in the page.
          focusUrlBar();
          try {
            gBrowser.removeTab(tab, { animate: false });
          } catch (e) {
            try {
              gBrowser.removeTab(tab);
            } catch (_e) {}
          }
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
  // their pre-restart viewed time). Stamped on TabSelect (45) and TabOpen
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
  // tooltip (76). Tree levels and visibility stay bulk (renderTree /
  // reconcile) and are called alongside at the same entries.
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
  // Tree-collapsed descendants are skipped (never auto-select a tab the
  // user folded away); the TabSelect path expands ancestors instead.
  function resolveTargetTab(target, tabs) {
    const candidates = [lastSelected[target], ...tabs];
    let fallback = null;
    for (const t of candidates) {
      if (t && !t.closing && tabs.includes(t) && getWs(t) === target) {
        try {
          if (typeof isTreeHiddenByCollapse === "function" && isTreeHiddenByCollapse(t) && !t.selected) {
            continue;
          }
        } catch (e) {}
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
    // Workspace visibility wins first; the tree then re-hides descendants
    // of collapsed parents in the target workspace.
    try {
      if (typeof applyTreeVisibility === "function") {
        applyTreeVisibility();
      }
    } catch (e) {}
    try {
      if (typeof renderTree === "function") {
        renderTree();
      }
    } catch (e) {}
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
  // tab before it. Hidden (foreign-workspace / tree-collapsed), closing,
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

  function parkSelectedStarredTab() {
    try {
      if (!getCtrlWParksStarred()) {
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
      try {
        if (sel.pinned) {
          return { ok: false, reason: "pinned" };
        }
      } catch (e) {}
      if (!isStarredForPark(sel)) {
        return { ok: false, reason: "not-starred" };
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
      // Drifted star: reset to the starred base URL in place (stay
      // selected, no unload) and claim the keystroke. Same ordering as
      // pins: after the guards (unsaved work still prompts via stock,
      // internal pages never navigate), before the neighbor check so a
      // sole-tab star can still reset.
      try {
        const target =
          typeof effectiveStarURL === "function" ? effectiveStarURL(sel) : "";
        if (target && spec && target !== spec) {
          try {
            if (typeof resetStarTab === "function") {
              resetStarTab(sel);
            }
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

  function parkSelectedPinnedTab() {
    try {
      if (!getCtrlWParksPinned()) {
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
      try {
        if (!sel.pinned) {
          return { ok: false, reason: "not-pinned" };
        }
      } catch (e) {
        return { ok: false, reason: "not-pinned" };
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
      // Drifted pin: reset to the pinned base URL in place (stay selected,
      // no unload) and claim the keystroke — the tab visibly snaps back
      // instead of closing. Runs after the guards above so unsaved work
      // still falls through to stock (which prompts) and internal pages
      // never navigate; runs before the neighbor check so a sole-tab pin
      // can still reset. Reset-then-discard in one press is deliberately
      // avoided: the fresh navigation would race the discard (which tears
      // down the load), so park happens on the next press, once at base.
      try {
        const target =
          typeof effectivePinURL === "function" ? effectivePinURL(sel) : "";
        if (target && spec && target !== spec) {
          try {
            if (typeof resetPinTab === "function") {
              resetPinTab(sel);
            }
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
        // Bound container: color underline + tooltip. boxShadow (not border)
        // so the fixed 24px badge never shifts layout.
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
          el.style.boxShadow = color ? `inset 0 -2px 0 ${color}` : "";
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

  function switchTo(target) {
    if (!isValidId(target) || target === current) {
      return;
    }
    const tabs = Array.from(gBrowser.tabs);
    rememberCurrent(tabs);
    lastUsed = current;
    current = target;
    try {
      gBrowser.tabContainer.setAttribute("data-aph-ws", target);
    } catch (e) {}
    updateIndicator();
    pulseWorkspaceIndicator();
    try {
      SessionStore.setCustomWindowValue(window, WIN_KEY, target);
    } catch (e) {}
    anchorAllGroups();
    reconcile(target, tabs);
    pruneExtraNewTabs(target);
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

  // Send family helpers: trees and native groups move as units, single
  // tabs extract. `collectTreeFamily` carries linked descendants (same-WS,
  // same-group filtered — stranded cross-edge tabs read detached and stay).
  // `preservedSendGroups` keeps membership when the move covers a whole
  // group (no ungroup); partial moves eject as before. `executeWorkspaceSend`
  // is the shared core: eject non-preserved members, keep links whose
  // parent travels, detach roots whose parent stays, promote stragglers
  // left behind, then retag the whole set.
  function collectTreeFamily(baseTabs) {
    const out = [];
    const seen = new Set();
    try {
      for (const t of baseTabs || []) {
        try {
          if (!t || t.closing || seen.has(t)) {
            continue;
          }
          seen.add(t);
          out.push(t);
        } catch (e) {}
      }
      // Descendants of each root join (recursive already); newly added
      // members can themselves own deeper levels, but getTreeDescendants
      // is transitive so one pass suffices.
      const roots = out.slice();
      for (const r of roots) {
        let kids = [];
        try {
          kids =
            typeof getTreeDescendants === "function" ? getTreeDescendants(r) : [];
        } catch (e) {
          kids = [];
        }
        for (const k of kids || []) {
          try {
            if (!k || k.closing || seen.has(k)) {
              continue;
            }
            seen.add(k);
            out.push(k);
          } catch (e) {}
        }
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
        return collectTreeFamily(baseTabs);
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
      // Carry grouped trees along (same filtered walk as single moves).
      return collectTreeFamily(members.length ? members : baseTabs);
    } catch (e) {}
    return collectTreeFamily(baseTabs);
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
    // Snapshot parent links before any retag (getWs-gated reads go stale
    // after the first setWs).
    const parentOf = new Map();
    try {
      for (const t of list) {
        let p = null;
        try {
          p =
            typeof getTreeParentTab === "function" ? getTreeParentTab(t) : null;
        } catch (e) {
          p = null;
        }
        parentOf.set(t, p || null);
      }
    } catch (e) {}
    // Eject partial-group members; whole groups stay joined so membership
    // (and the tree nesting invariant) survives the retag.
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
    // Detach roots whose parent stays behind; keep edges whose parent
    // travels. Stragglers (non-moving children of movers) promote to the
    // grandparent or to roots — the detachTreeForWorkspaceSend rule.
    try {
      const hasTreeFns =
        typeof clearTreeParent === "function" &&
        typeof ensureTreeId === "function";
      if (hasTreeFns) {
        for (const tab of list) {
          try {
            const parent = parentOf.get(tab) || null;
            if (parent && !moving.has(parent)) {
              clearTreeParent(tab);
            }
            try {
              ensureTreeId(tab);
            } catch (e) {}
          } catch (e) {}
        }
        // Promote non-moving children left behind by each mover.
        let allTabs = [];
        try {
          allTabs = Array.from(gBrowser.tabs || []);
        } catch (e) {}
        for (const mover of list) {
          let moverId = null;
          try {
            moverId =
              typeof rawTreeId === "function" ? rawTreeId(mover) : null;
          } catch (e) {}
          if (!moverId) {
            continue;
          }
          for (const t of allTabs) {
            try {
              if (!t || t === mover || moving.has(t) || t.closing) {
                continue;
              }
              let pid = null;
              try {
                pid =
                  typeof rawTreeParentId === "function"
                    ? rawTreeParentId(t)
                    : null;
              } catch (e) {}
              if (pid !== moverId) {
                continue;
              }
              // Child stays: re-hang to the mover's parent when that
              // parent stays too, else to a root.
              const gpTab = parentOf.get(mover) || null;
              if (gpTab && !moving.has(gpTab) && !gpTab.closing) {
                let gid = null;
                try {
                  gid =
                    typeof rawTreeId === "function" ? rawTreeId(gpTab) : null;
                } catch (e) {}
                if (gid) {
                  try {
                    if (typeof setTreeParent === "function") {
                      setTreeParent(t, gid);
                    }
                  } catch (e) {}
                  continue;
                }
              }
              try {
                clearTreeParent(t);
              } catch (e) {}
            } catch (e) {}
          }
          // Collapse flag travels with the family; drop it when nothing
          // was carried (mirrors detachTreeForWorkspaceSend).
          try {
            let carried = false;
            for (const t of list) {
              if (parentOf.get(t) === mover) {
                carried = true;
                break;
              }
            }
            if (!carried && typeof collapsedTreeParents !== "undefined") {
              try {
                collapsedTreeParents.delete(moverId);
              } catch (e) {}
            }
          } catch (e) {}
        }
      }
    } catch (e) {}
    for (const tab of list) {
      try {
        setWs(tab, target);
      } catch (e) {}
    }
    anchorAllGroups();
    try {
      if (typeof renderTree === "function") {
        renderTree();
      }
    } catch (e) {}
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
        try {
          const live = Array.from(gBrowser.tabs || []);
          tabs = live.includes(explicit) ? [explicit] : [explicit];
        } catch (e) {
          tabs = [explicit];
        }
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
  // multiselection this is just the active tab. Trees travel: linked
  // descendants join automatically so a parent move keeps its hierarchy in
  // the target workspace. Native groups stay joined when the move covers
  // the whole group; partial moves eject as before (groups are single-WS).
  // Pinned tabs are global so sent pins stay visible; their tags are dormant
  // state applied on eventual unpin. Sent tabs keep their containers
  // (containers are immutable per tab), and position; bindings only affect
  // newly opened tabs.
  function sendTabTo(target, explicit, opts) {
    if (!isValidId(target) || target === current) {
      return;
    }
    const base = resolveSendBase(explicit);
    if (!base.length) {
      return;
    }
    let moveSet = base;
    try {
      const withTree = !opts || opts.withTree !== false;
      moveSet = withTree ? collectTreeFamily(base) : base.slice();
    } catch (e) {
      moveSet = base;
    }
    executeWorkspaceSend(target, moveSet);
  }

  // Explicit tree move: the tab(s) plus all linked descendants travel
  // together, preserving parent links in the target workspace. Falls back
  // to the live selection like sendTabTo when given nothing.
  function sendTreeTo(target, explicit) {
    if (!isValidId(target) || target === current) {
      return;
    }
    const base = resolveSendBase(explicit);
    if (!base.length) {
      return;
    }
    executeWorkspaceSend(target, collectTreeFamily(base));
  }

  // Explicit native-group move: every tab in the containing group(s)
  // travels together with membership intact (plus linked tree descendants).
  // Ungrouped tabs fall back to a tree move.
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
  // moving tabs, trees, and native groups across workspaces. Three variants
  // share one target-resolution rule (clicked tab wins; its live
  // multiselection rides along when the click belongs to it):
  // - "Move Tab(s) to Workspace >" — always shown, calls sendTabTo (which
  //   auto-carries linked tree descendants and preserves whole groups).
  // - "Move Tree to Workspace >" — only when the selection owns descendants;
  //   calls sendTreeTo explicitly (same carry, explicit label/count).
  // - "Move Group to Workspace >" — only when the clicked tab sits in a
  //   native group of 2+; calls sendGroupTo (whole group + grouped trees).
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
            if (typeof getTreeSelectedTabs === "function") {
              sel = getTreeSelectedTabs() || [];
            } else {
              const multi =
                (gBrowser &&
                  (gBrowser.selectedTabs || gBrowser.multiselectedTabs)) ||
                null;
              if (Array.isArray(multi) && multi.length) {
                sel = multi.slice();
              } else if (gBrowser && gBrowser.selectedTab) {
                sel = [gBrowser.selectedTab];
              }
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

  function moveMenuFamilySize(tabs) {
    try {
      if (!tabs || !tabs.length) {
        return 0;
      }
      const seen = new Set();
      for (const t of tabs) {
        if (t && !t.closing) {
          seen.add(t);
        }
      }
      try {
        for (const t of Array.from(seen)) {
          let kids = [];
          try {
            kids =
              typeof getTreeDescendants === "function"
                ? getTreeDescendants(t)
                : [];
          } catch (e) {
            kids = [];
          }
          for (const k of kids || []) {
            try {
              if (k && !k.closing) {
                seen.add(k);
              }
            } catch (e) {}
          }
        }
      } catch (e) {}
      return seen.size;
    } catch (e) {
      return 0;
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
      // Tree variant: only when the selection owns descendants beyond
      // itself (otherwise it duplicates the Tab row).
      try {
        const family = moveMenuFamilySize(targets);
        if (family > n) {
          const treeLabel =
            n > 1
              ? `Move Tree (${family} Tabs) to Workspace`
              : `Move Tree (${family} Tabs) to Workspace`;
          appendMoveSubmenu(menu, "aph-move-tree", treeLabel, targets.slice(), (id, ts) => {
            try {
              if (typeof sendTreeTo === "function") {
                sendTreeTo(id, ts.length === 1 ? ts[0] : ts.slice());
              } else if (typeof sendTabTo === "function") {
                sendTabTo(id, ts.length === 1 ? ts[0] : ts.slice());
              }
            } catch (err) {}
          });
        }
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

  // What will a drop move? Base tabs from resolveDockDragTabs plus linked
  // tree descendants (sendTabTo auto-carry). Used for drop tooltips.
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
      try {
        for (const t of Array.from(seen)) {
          let kids = [];
          try {
            kids =
              typeof getTreeDescendants === "function"
                ? getTreeDescendants(t)
                : [];
          } catch (e) {
            kids = [];
          }
          for (const k of kids || []) {
            if (k && !k.closing) {
              seen.add(k);
            }
          }
        }
      } catch (e) {}
      const count = seen.size;
      let kind = base.length > 1 ? `${base.length} tabs` : "tab";
      if (wasGroup) {
        kind = `group (${count} tab${count === 1 ? "" : "s"})`;
      } else if (count > base.length) {
        kind = `tree (${count} tabs)`;
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
      // During a tab drag the tooltip previews the move (tree/group aware).
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
  // something else is selected. Trees ride along via sendTabTo's
  // auto-carry; whole groups stay joined via preservation.
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
  // Open a clean disposable container tab in the current workspace. Falls
  // back to a normal tab if the identity service is unavailable.
  // Manual birth: always a Level 0 root.
  function openTempTab(url = "about:newtab") {
    const ws = isValidId(current) ? current : "1";
    if (!IdentityService) {
      try {
        const t = gBrowser.addTrustedTab(url);
        setWs(t, ws);
        try {
          if (typeof clearTreeParent === "function") {
            clearTreeParent(t);
          }
        } catch (_e) {}
        try {
          if (typeof ensureTreeId === "function") {
            ensureTreeId(t);
          }
        } catch (_e) {}
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
      try {
        if (typeof clearTreeParent === "function") {
          clearTreeParent(tab);
        }
      } catch (_e) {}
      try {
        if (typeof ensureTreeId === "function") {
          ensureTreeId(tab);
        }
      } catch (_e) {}
      try {
        if (typeof renderTree === "function") {
          renderTree();
        }
      } catch (_e) {}
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
    // Ctrl+Alt+Left/Right folds the selected tab(s) one tree level
    // out/in (manual tree repair via keyboard; no-arg calls use the live
    // selection, multiselection included). Physical codes: Right always
    // deepens, even in RTL (mirroring applies to paint, not to keys). No
    // editable-target guard: arrows never produce characters, and the
    // AltGraph early-return above already shields AltGr compositions.
    // (Some graphics drivers steal Ctrl+Alt+arrows for screen rotation;
    // disable that OS hotkey if the browser never sees the press.)
    if (e.ctrlKey && !e.shiftKey && !e.metaKey && e.code === "ArrowRight") {
      e.preventDefault();
      e.stopPropagation();
      try {
        indentTreeTab();
      } catch (err) {}
      return;
    }
    if (e.ctrlKey && !e.shiftKey && !e.metaKey && e.code === "ArrowLeft") {
      e.preventDefault();
      e.stopPropagation();
      try {
        outdentTreeTab();
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
      e.preventDefault();
      e.stopPropagation();
      // Ctrl+Alt+Shift+digit moves the whole tree explicitly; plain
      // Ctrl+Alt+digit moves the selection (auto-carrying descendants and
      // preserving whole groups via sendTabTo).
      try {
        if (e.shiftKey && typeof sendTreeTo === "function") {
          sendTreeTo(d);
        } else {
          sendTabTo(d);
        }
      } catch (err) {}
    } else if (e.shiftKey) {
      e.preventDefault();
      e.stopPropagation();
      switchTo(d);
    }
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

  function pinSpec(tab) {
    try {
      const uri = tab && tab.linkedBrowser && tab.linkedBrowser.currentURI;
      const spec = uri && uri.spec;
      return typeof spec === "string" ? spec : "";
    } catch (e) {
      return "";
    }
  }

  function isPinnableURL(url) {
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

  function getPinURL(tab) {
    try {
      if (!tab) {
        return "";
      }
      let v = null;
      try {
        v = SessionStore.getCustomTabValue(tab, PIN_URL_KEY);
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
  function setPinURL(tab, url) {
    try {
      if (!tab || !isPinnableURL(url)) {
        return false;
      }
      SessionStore.setCustomTabValue(tab, PIN_URL_KEY, String(url));
      return true;
    } catch (e) {
      try {
        pinLastError = "set-threw";
      } catch (err) {}
      return false;
    }
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
      return getPinURL(tab) || pinSpec(tab);
    } catch (e) {
      return "";
    }
  }

  function systemPrincipal() {
    try {
      return Services.scriptSecurityManager.getSystemPrincipal();
    } catch (e) {
      return null;
    }
  }

  function loadPinURL(browser, url) {
    const principal = systemPrincipal();
    try {
      if (browser && typeof browser.fixupAndLoadURIString === "function") {
        browser.fixupAndLoadURIString(url, { triggeringPrincipal: principal });
        return true;
      }
    } catch (e) {
      try {
        pinLastError = "fixup-threw";
      } catch (err) {}
    }
    // Fallback for browsers without the fixup helper wired up.
    try {
      if (browser && typeof browser.loadURI === "function" && Services && Services.io) {
        browser.loadURI(Services.io.newURI(url), { triggeringPrincipal: principal });
        return true;
      }
    } catch (e) {
      try {
        pinLastError = "loadURI-threw";
      } catch (err) {}
    }
    try {
      if (!pinLastError) {
        pinLastError = "no-loader";
      }
    } catch (err) {}
    return false;
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
      return loadPinURL(browser, url);
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
          const spec = pinSpec(tab);
          if (spec) {
            SessionStore.setCustomTabValue(tab, PIN_URL_KEY, spec);
          }
        }
      } else {
        clearPinURL(tab);
      }
    } catch (err) {}
  }

  // Resolve the right-clicked tab, mirroring stock tab-context-menu.js and
  // the archive.js pattern: triggerNode may carry the tab directly (.tab)
  // or contain it; fall back to the selected tab.
  function pinClickedTab(e) {
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

  function makePinMenuItem(id, label, action) {
    let item = null;
    try {
      // browser.xhtml is an XHTML document: document.createElement would
      // build an HTML-namespaced dud inside the XUL menupopup (same
      // gotcha as archive.js).
      item =
        typeof document.createXULElement === "function"
          ? document.createXULElement("menuitem")
          : document.createElement("menuitem");
      item.id = id;
      item.setAttribute("label", label);
      if (typeof item.addEventListener === "function") {
        item.addEventListener("command", action);
      }
    } catch (err) {
      item = null;
    }
    return item;
  }

  let pinMenuItems = [];

  function clearPinMenu() {
    try {
      for (const it of pinMenuItems) {
        try {
          if (it && it.parentNode) {
            it.parentNode.removeChild(it);
          } else if (it && typeof it.remove === "function") {
            it.remove();
          }
        } catch (err) {}
      }
    } catch (err) {}
    pinMenuItems = [];
  }

  function promptPinURL(tab, initial) {
    const commit = (v) => {
      try {
        const value = String(v == null ? "" : v).trim();
        if (value) {
          setPinURL(tab, value);
        }
      } catch (err) {}
    };
    try {
      if (window.AphPalette && typeof window.AphPalette.prompt === "function") {
        window.AphPalette.prompt({
          title: "Set Pinned Page — Enter saves, Esc cancels",
          initial: initial || "",
          onCommit: commit,
        });
        return;
      }
    } catch (err) {}
    // Palette unavailable (tests, minimal chrome): stock prompt fallback.
    try {
      if (typeof window.prompt === "function") {
        commit(window.prompt("Set Pinned Page URL:", initial || ""));
      }
    } catch (err) {}
  }

  function onPinMenuShowing(e) {
    try {
      const menu = (e && (e.currentTarget || e.target)) || null;
      if (!menu || typeof menu.appendChild !== "function") {
        return;
      }
      clearPinMenu();
      const tab = pinClickedTab(e);
      if (!tab || !tab.pinned) {
        return;
      }
      const stored = effectivePinURL(tab);
      const reset = makePinMenuItem("aph-pinreset-reset", "Reset to Pinned Page", () => {
        try {
          resetPinTab(tab);
        } catch (err) {}
      });
      if (reset) {
        // Grey out when already there — nothing to do.
        try {
          if (stored && stored === pinSpec(tab)) {
            reset.setAttribute("disabled", "true");
          }
        } catch (err) {}
        try {
          menu.appendChild(reset);
          pinMenuItems.push(reset);
        } catch (err) {}
      }
      const edit = makePinMenuItem("aph-pinreset-set", "Set Pinned Page…", () => {
        try {
          // Live-first: Enter alone re-pins the current page (the common
          // "make this the base" case); stored is the fallback.
          promptPinURL(tab, pinSpec(tab) || stored);
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

  function starSpec(tab) {
    try {
      const uri = tab && tab.linkedBrowser && tab.linkedBrowser.currentURI;
      const spec = uri && uri.spec;
      return typeof spec === "string" ? spec : "";
    } catch (e) {
      return "";
    }
  }

  function isStarrableURL(url) {
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
      // Restored before SSTabRestored re-applies: attribute backstop.
      try {
        if (typeof tab.hasAttribute === "function" && tab.hasAttribute(STAR_ATTR)) {
          return true;
        }
      } catch (e) {}
      try {
        if (typeof tab.getAttribute === "function" && tab.getAttribute(STAR_ATTR) === "1") {
          return true;
        }
      } catch (e) {}
      return false;
    } catch (e) {
      return false;
    }
  }

  function getStarURL(tab) {
    try {
      if (!tab) {
        return "";
      }
      let v = null;
      try {
        v = SessionStore.getCustomTabValue(tab, STAR_URL_KEY);
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
  function setStarURL(tab, url) {
    try {
      if (!tab || !isStarrableURL(url)) {
        return false;
      }
      SessionStore.setCustomTabValue(tab, STAR_URL_KEY, String(url));
      return true;
    } catch (e) {
      try {
        starLastError = "set-threw";
      } catch (err) {}
      return false;
    }
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
      return getStarURL(tab) || starSpec(tab);
    } catch (e) {
      return "";
    }
  }

  function loadStarURL(browser, url) {
    let principal = null;
    try {
      principal = systemPrincipal();
    } catch (e) {
      principal = null;
    }
    try {
      if (browser && typeof browser.fixupAndLoadURIString === "function") {
        browser.fixupAndLoadURIString(url, { triggeringPrincipal: principal });
        return true;
      }
    } catch (e) {
      try {
        starLastError = "fixup-threw";
      } catch (err) {}
    }
    // Fallback for browsers without the fixup helper wired up.
    try {
      if (browser && typeof browser.loadURI === "function" && Services && Services.io) {
        browser.loadURI(Services.io.newURI(url), { triggeringPrincipal: principal });
        return true;
      }
    } catch (e) {
      try {
        starLastError = "loadURI-threw";
      } catch (err) {}
    }
    try {
      if (!starLastError) {
        starLastError = "no-loader";
      }
    } catch (err) {}
    return false;
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
      return loadStarURL(browser, url);
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
        const spec = starSpec(tab);
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

  // Resolve the right-clicked tab, mirroring 75-pinreset.js: triggerNode
  // may carry the tab directly (.tab) or contain it; fall back to selected.
  function starClickedTab(e) {
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

  function makeStarMenuItem(id, label, action) {
    let item = null;
    try {
      // browser.xhtml is an XHTML document: document.createElement would
      // build an HTML-namespaced dud inside the XUL menupopup (same
      // gotcha as archive.js / 75-pinreset.js).
      item =
        typeof document.createXULElement === "function"
          ? document.createXULElement("menuitem")
          : document.createElement("menuitem");
      item.id = id;
      item.setAttribute("label", label);
      if (typeof item.addEventListener === "function") {
        item.addEventListener("command", action);
      }
    } catch (err) {
      item = null;
    }
    return item;
  }

  let starMenuItems = [];

  function clearStarMenu() {
    try {
      for (const it of starMenuItems) {
        try {
          if (it && it.parentNode) {
            it.parentNode.removeChild(it);
          } else if (it && typeof it.remove === "function") {
            it.remove();
          }
        } catch (err) {}
      }
    } catch (err) {}
    starMenuItems = [];
  }

  function promptStarURL(tab, initial) {
    const commit = (v) => {
      try {
        const value = String(v == null ? "" : v).trim();
        if (value) {
          setStarURL(tab, value);
        }
      } catch (err) {}
    };
    try {
      if (window.AphPalette && typeof window.AphPalette.prompt === "function") {
        window.AphPalette.prompt({
          title: "Set Starred Page — Enter saves, Esc cancels",
          initial: initial || "",
          onCommit: commit,
        });
        return;
      }
    } catch (err) {}
    // Palette unavailable (tests, minimal chrome): stock prompt fallback.
    try {
      if (typeof window.prompt === "function") {
        commit(window.prompt("Set Starred Page URL:", initial || ""));
      }
    } catch (err) {}
  }

  function onStarMenuShowing(e) {
    try {
      const menu = (e && (e.currentTarget || e.target)) || null;
      if (!menu || typeof menu.appendChild !== "function") {
        return;
      }
      clearStarMenu();
      const tab = starClickedTab(e);
      if (!tab || tab.pinned) {
        return;
      }
      const starred = isStarredTab(tab);
      const toggle = makeStarMenuItem(
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
      const reset = makeStarMenuItem("aph-star-reset", "Reset to Starred Page", () => {
        try {
          resetStarTab(tab);
        } catch (err) {}
      });
      if (reset) {
        // Grey out when already there — nothing to do.
        try {
          if (stored && stored === starSpec(tab)) {
            reset.setAttribute("disabled", "true");
          }
        } catch (err) {}
        try {
          menu.appendChild(reset);
          starMenuItems.push(reset);
        } catch (err) {}
      }
      const edit = makeStarMenuItem("aph-star-set", "Set Starred Page…", () => {
        try {
          // Live-first: Enter alone re-stars the current page (the common
          // "make this the base" case); stored is the fallback.
          promptStarURL(tab, starSpec(tab) || stored);
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
    stampTab(tab);
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
    try {
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
    try {
      if (tab.pinned) {
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
        setWs(tab, current);
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
          // Routed replacements land as Level 0 roots in the target
          // workspace (workspace-scoped trees never span workspaces).
          // The original's removal promotes any children left behind.
          try {
            if (typeof clearTreeParent === "function") {
              clearTreeParent(rep);
            }
          } catch (e) {}
          try {
            if (typeof ensureTreeId === "function") {
              ensureTreeId(rep);
            }
          } catch (e) {}
          try {
            if (typeof renderTree === "function") {
              renderTree();
            }
          } catch (e) {}
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
            gBrowser.removeTab(tab, { animate: false });
          } catch (e) {
            try {
              gBrowser.removeTab(tab);
            } catch (_e) {}
          }
          routeLog(`reopened in container ${bound} (was ${cid})`);
          return;
        }
        // Reopen failed — fall through to a plain retag.
      }
      // Cross-workspace move detaches to a Level 0 root (children stay
      // behind, promoted in place); same-workspace retags keep the link.
      try {
        if (typeof getWs === "function" && typeof detachTreeForWorkspaceSend === "function") {
          if (getWs(tab) !== target) {
            detachTreeForWorkspaceSend(tab);
          }
        }
      } catch (e) {}
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
      if (!getSilenceFirstRun() || !isAddonFirstRunSpec(spec)) {
        return false;
      }
      if (!isYoungTab(tab) || !isFirstContentTab(tab)) {
        return false;
      }
      // A followed link is deliberate — background-created install tabs
      // have no opener.
      try {
        if (typeof resolveTreeOpener === "function" && resolveTreeOpener(tab, null)) {
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

  // New windows (Ctrl+N) inherit the source window's workspace instead of
  // falling back to "1". Stored value wins (session restore); else opener,
  // else most-recent / any open browser window; else "1".
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
    // Prefer the restored selected tab when it already lives in target,
    // so we focus the exact tab left open instead of the first in order.
    try {
      const sel = gBrowser.selectedTab;
      if (sel && !sel.closing && rawWs(sel) === target) {
        lastSelected[target] = sel;
      }
    } catch (e) {}
    try {
      switchTo(target);
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
      if (gBrowser && gBrowser.tabContainer) {
        try {
          gBrowser.tabContainer.removeEventListener("TabSelect", onTreeTabSelect);
        } catch (_e) {}
        try {
          gBrowser.tabContainer.removeEventListener("TabMove", onTreeTabMove);
        } catch (_e) {}
      }
    } catch (e) {}
    try {
      if (typeof collapsedTreeParents !== "undefined" && collapsedTreeParents) {
        collapsedTreeParents.clear();
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
        sendTabTo,
        sendTreeTo,
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
        getAllBindings,
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
        getTreeLevel,
        getTreeParent: getTreeParentTab,
        getTreeChildren,
        getTreeDescendants,
        countTreeDescendants,
        isTreeCollapsed,
        isTreeHidden: isTreeHiddenByCollapse,
        setTreeCollapsed,
        toggleTreeCollapsed,
        expandTreeAncestors,
        attachTreeChild,
        indentTreeTab,
        outdentTreeTab,
        promoteTreeTab,
        debugTree,
        findEnclosingTreeParent,
        renderTree,
        applyTreeVisibility,
        healTreeLinks,
      };
    } catch (e) {}
    current = initialWorkspace();
    if (isValidId(current)) {
      try {
        gBrowser.tabContainer.setAttribute("data-aph-ws", current);
      } catch (e) {}
    }
    updateIndicator();
    try {
      for (const t of gBrowser.tabs) {
        if (!rawWs(t)) {
          setWs(t, isValidId(current) ? current : "1");
        }
        // Pre-existing tabs resume live pages — settled, never auto-route.
        try {
          t.__aphFresh = false;
        } catch (e) {}
        // Every tab owns a stable tree id (roots simply have no parent).
        try {
          if (typeof ensureTreeId === "function") {
            ensureTreeId(t);
          }
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
      // Restored tree links survive via SessionStore; collapsed state
      // always starts expanded. Prune dangling/cross-WS edges.
      try {
        if (typeof healTreeLinks === "function") {
          healTreeLinks();
        }
      } catch (e) {}
      try {
        if (typeof renderTree === "function") {
          renderTree();
        }
      } catch (e) {}
    } catch (e) {}
    // Session restore may not preserve hidden state; force a full pass.
    try {
      const saved = isValidId(current) ? current : "1";
      current = saved === "1" ? "__force__" : "1";
      switchTo(saved);
    } catch (e) {}
    gBrowser.tabContainer.addEventListener("TabOpen", onTabOpen);
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
    try {
      gBrowser.tabContainer.addEventListener("TabSelect", onTreeTabSelect);
    } catch (e) {}
    try {
      gBrowser.tabContainer.addEventListener("TabMove", onTreeTabMove);
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
