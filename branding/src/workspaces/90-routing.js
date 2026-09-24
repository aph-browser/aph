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

