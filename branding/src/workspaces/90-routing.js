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
  function onGroupChange(e) {
    const group = e.target && e.target.closest ? e.target.closest("tab-group") : null;
    if (!group) {
      return;
    }
    try {
      setTimeout(() => unifyGroup(group), 0);
    } catch (err) {
      unifyGroup(group);
    }
  }

