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

module.exports = { ROOT, load, run, makeTab, makeContentNode, makeTextNode };

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
