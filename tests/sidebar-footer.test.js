// Sidebar footer hide/show (workspaces/66-sidebar-footer.js): a host
// attribute + one-time shadow <style> — no observers. The footer hides by
// default; the palette toggle flips the pref live.
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { run } = require("./helpers");

function footerWorld({ hidePref } = {}) {
  const tabVals = new WeakMap();
  const prefStore = {};
  if (hidePref !== undefined) {
    prefStore["aph.sidebar.hideFooter"] = hidePref;
  }
  const attrs = {};
  const shadowChildren = [];
  const shadow = {
    querySelector: () => null,
    getElementById: (id) => shadowChildren.find((c) => c.id === id) || null,
    appendChild(c) {
      c.parentNode = shadow;
      shadowChildren.push(c);
      return c;
    },
  };
  const host = {
    shadowRoot: shadow,
    toggleAttribute(k, force) {
      if (force) {
        attrs[k] = "";
      } else {
        delete attrs[k];
      }
    },
    hasAttribute: (k) => k in attrs,
    removeAttribute: (k) => { delete attrs[k]; },
  };
  const winHandlers = {};
  const sb = {
    document: {
      readyState: "complete",
      documentElement: {},
      createElement: () => ({ setAttribute() {}, removeAttribute() {}, style: {}, textContent: "" }),
      createEvent: () => ({ initEvent() {} }),
      querySelector: (sel) => (sel === "sidebar-main" ? host : null),
      getElementById: (id) => {
        if (id === "sidebar-container") return { hidden: false };
        if (id === "vertical-tabs") return { hidden: true };
        return null;
      },
    },
    addEventListener(t, fn) { (winHandlers[t] = winHandlers[t] || []).push(fn); },
    removeEventListener() {},
    gBrowser: {
      tabs: [],
      tabGroups: [],
      get selectedTab() { return null; },
      set selectedTab(t) {},
      showTab() {},
      addTrustedTab: () => null,
      removeTab() {},
      ungroupTab() {},
      replaceInSuccession() {},
      setSuccessor() {},
      _updateMultiselectedTabCloseButtonTooltip() {},
      getTabForBrowser: () => null,
      tabContainer: {
        setAttribute() {},
        addEventListener() {},
        removeEventListener() {},
        _invalidateCachedVisibleTabs() {},
        _updateCloseButtons() {},
      },
    },
    SessionStore: {
      getCustomTabValue: () => undefined,
      setCustomTabValue: () => {},
      deleteCustomTabValue: () => {},
      isTabRestoring: () => false,
      getCustomWindowValue: () => undefined,
      setCustomWindowValue: () => {},
    },
    Services: {
      prefs: {
        getStringPref: (k, d) => (k in prefStore ? prefStore[k] : d),
        setStringPref: (k, v) => { prefStore[k] = v; },
        getBoolPref: (k) => {
          if (!(k in prefStore)) throw new Error("unset");
          return !!prefStore[k];
        },
        setBoolPref: (k, v) => { prefStore[k] = !!v; },
        addObserver() {},
        removeObserver() {},
      },
      console: { logStringMessage() {} },
      wm: { getMostRecentWindow: () => null, getEnumerator: () => ({ hasMoreElements: () => false }) },
      obs: { addObserver() {}, removeObserver() {}, notifyObservers() {} },
    },
    ChromeUtils: { generateQI: () => () => {}, importESModule: () => { throw new Error("no"); } },
    Ci: { nsIWebProgressListener: {}, nsIWebProgress: {} },
  };
  sb.window = sb;
  sb.globalThis = sb;
  run("workspaces.js", sb);
  return { api: sb.window.AphWorkspaces, attrs, shadowChildren };
}

describe("sidebar footer", () => {
  it("hides by default (absent pref counts as hidden)", () => {
    const { attrs, shadowChildren } = footerWorld({});
    assert.ok("data-aph-hide-footer" in attrs, "host attribute set");
    assert.ok(
      shadowChildren.some((c) => c.id === "aph-footer-style"),
      "shadow style injected once"
    );
  });

  it("shows when the pref is false (attribute absent)", () => {
    const { attrs } = footerWorld({ hidePref: false });
    assert.ok(!("data-aph-hide-footer" in attrs), "host attribute absent");
  });

  it("exposes applySidebarFooter for console diagnosis", () => {
    const { api } = footerWorld({});
    assert.equal(typeof api.applySidebarFooter, "function");
  });
});
