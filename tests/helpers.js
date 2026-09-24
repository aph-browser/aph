// Shared mocks for loading the real injected scripts (branding/*.js) in
// node:vm. Mock shapes are derived from build/firefox/omni.ja — notably the
// tabbrowser tabs-listener convention:
//   onLocationChange(browser, webProgress, request, location, flags).
const vm = require("vm");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");

function load(file, hookLine, hookCode) {
  let src = fs.readFileSync(path.join(ROOT, "branding", file), "utf8");
  if (hookLine) {
    if (!src.includes(hookLine)) {
      throw new Error(`hook anchor missing in ${file}`);
    }
    src = src.replace(hookLine, `${hookLine}\n${hookCode}`);
  }
  return src;
}

function run(file, sandbox, hookLine, hookCode) {
  sandbox.console = console;
  sandbox.setTimeout = () => 0;
  sandbox.clearTimeout = () => {};
  vm.createContext(sandbox);
  vm.runInContext(load(file, hookLine, hookCode), sandbox, { filename: file });
  return sandbox;
}

// <tab> stand-in with the attribute/event surface workspaces.js touches.
function makeTab(tabVals, o) {
  const t = {
    label: o.label, closing: false, pinned: !!o.pinned,
    hidden: !!o.hidden, selected: !!o.selected, group: null,
    multiselected: false, userContextId: o.cid || 0,
    soundPlaying: !!o.soundPlaying, audible: !!o.audible,
    busy: !!o.busy,
    __aphFresh: !!o.fresh,
    linkedBrowser: { currentURI: { spec: o.spec } },
    _attrs: {},
    setAttribute(k, v) {
      this._attrs[k] = v === undefined ? "" : String(v);
      if (k === "hidden") this.hidden = true;
    },
    removeAttribute(k) {
      delete this._attrs[k];
      if (k === "hidden") this.hidden = false;
    },
    hasAttribute(k) {
      if (k === "hidden") return this.hidden;
      return k in this._attrs;
    },
    getAttribute(k) {
      if (k === "hidden") return this.hidden ? "true" : null;
      return k in this._attrs ? this._attrs[k] : null;
    },
    dispatchEvent() {},
  };
  if (o.sharing) {
    t.linkedBrowser._sharingState = { webRTC: { sharing: true } };
  }
  if (o.beforeUnload) {
    t.linkedBrowser.frameLoader = { tabParent: { hasBeforeUnload: true } };
  }
  if (o.throwURI) {
    Object.defineProperty(t.linkedBrowser, "currentURI", {
      configurable: true,
      get() { throw new Error("unreadable"); },
    });
  }
  if (o.pending) {
    t.setAttribute("pending", "");
  }
  tabVals.set(t, { aphWs: o.ws });
  t.__browser = { __tab: t };
  return t;
}

// Shared chrome-DOM/service stand-ins. Per-suite makeEnv skeletons keep
// their own gBrowser/document/prefs shapes (behavior diverges there), but
// these blocks are byte-identical across suites — define once here.

// Light-DOM node stand-in with the attribute/event surface the bundles
// touch (superset of the old per-file fakeNodes).
function makeFakeNode(localName) {
  const n = {
    localName: localName || "div",
    children: [],
    _attrs: {},
    style: {},
    hidden: false,
    textContent: "",
    title: "",
    className: "",
    id: "",
    parentNode: null,
    _handlers: {},
    _classes: new Set(),
    appendChild(c) {
      c.parentNode = n;
      n.children.push(c);
      return c;
    },
    removeChild(c) {
      const i = n.children.indexOf(c);
      if (i !== -1) n.children.splice(i, 1);
      c.parentNode = null;
      return c;
    },
    get firstChild() { return n.children[0] || null; },
    setAttribute(k, v) { n._attrs[k] = String(v); },
    getAttribute(k) { return k in n._attrs ? n._attrs[k] : null; },
    removeAttribute(k) { delete n._attrs[k]; },
    addEventListener(t, fn) { (n._handlers[t] = n._handlers[t] || []).push(fn); },
    removeEventListener() {},
    fire(t, ev) { for (const fn of n._handlers[t] || []) fn(ev || {}); },
    querySelectorAll() { return []; },
    querySelector() { return null; },
    closest(sel) {
      if (sel === ".aph-ws-pill" && n.className.split(" ").includes("aph-ws-pill")) return n;
      if (sel === "tab" && n._isTab) return n;
      if (sel === "#nav-bar") return null;
      return null;
    },
  };
  n.classList = {
    add(c) { n._classes.add(c); },
    remove(c) { n._classes.delete(c); },
    contains(c) { return n._classes.has(c); },
  };
  return n;
}

// SessionStore tab/window values over a tabVals WeakMap. Window values
// default to undefined (unowned); pass winVals to track claims.
function makeSessionStore(tabVals, { winVals = null } = {}) {
  return {
    getCustomTabValue: (t, k) => (tabVals.get(t) || {})[k],
    setCustomTabValue: (t, k, v) => {
      const o = tabVals.get(t) || {};
      o[k] = v;
      tabVals.set(t, o);
    },
    deleteCustomTabValue: (t, k) => {
      const o = tabVals.get(t) || {};
      delete o[k];
      tabVals.set(t, o);
    },
    getCustomWindowValue: (w, k) => (winVals && k === "aphWsCurrent" ? winVals.get(w) : undefined),
    setCustomWindowValue: (w, k, v) => {
      if (winVals && k === "aphWsCurrent") winVals.set(w, v);
    },
  };
}

function makeCi() {
  return {
    nsIWebProgressListener: { LOCATION_CHANGE_SAME_DOCUMENT: 2 },
    nsIWebProgress: { NOTIFY_LOCATION: 1 },
  };
}

// Container identity service stand-in (null = no containers bound).
// Pass a richer mock (e.g. dock.test.js's identities) where needed.
const nullIdentityService = {
  getPublicIdentityFromId: () => null,
  getPublicIdentities: () => [],
  create: () => { throw new Error("unused"); },
  remove: () => {},
};

function makeChromeUtils(identityService) {
  return {
    generateQI: () => () => {},
    importESModule: () => ({ ContextualIdentityService: identityService }),
  };
}

// Native tab-group stand-in (superset: closest + addTabs).
function makeGroup(tabs, o) {
  const g = {
    tabs: tabs.slice(),
    collapsed: !!(o && o.collapsed),
    hidden: false,
  };
  for (const t of tabs) {
    t.group = g;
  }
  g.closest = (sel) => (sel === "tab-group" ? g : null);
  // Stock tabgroup.js addTabs fallback (append to group end).
  g.addTabs = (arr) => {
    for (const t of arr || []) {
      if (!t || t.pinned) continue;
      t.group = g;
      if (!g.tabs.includes(t)) g.tabs.push(t);
    }
  };
  return g;
}

module.exports = { ROOT, load, run, makeTab, makeContentNode, makeTextNode, makeFakeNode, makeSessionStore, makeCi, makeChromeUtils, nullIdentityService, makeGroup };

// Minimal content-DOM stand-in for textpick-shared.js (duck-typed surface:
// nodeType, tagName, parentNode/parentElement, innerText/textContent).
function makeContentNode(tag, o) {
  const opts = o || {};
  const el = {
    nodeType: 1,
    tagName: tag,
    parentNode: null,
    parentElement: null,
    innerText: opts.text || "",
    textContent: opts.text || "",
    children: [],
  };
  for (const k of opts.kids || []) {
    k.parentNode = el;
    k.parentElement = el;
    el.children.push(k);
  }
  return el;
}

function makeTextNode(parent, text) {
  return {
    nodeType: 3,
    parentNode: parent || null,
    parentElement: parent || null,
    textContent: text || "",
  };
}
