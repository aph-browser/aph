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
    __aphFresh: !!o.fresh,
    linkedBrowser: { currentURI: { spec: o.spec } },
    setAttribute(k) { if (k === "hidden") this.hidden = true; },
    removeAttribute(k) { if (k === "hidden") this.hidden = false; },
    hasAttribute(k) { return k === "hidden" ? this.hidden : false; },
    dispatchEvent() {},
  };
  tabVals.set(t, { aphWs: o.ws });
  t.__browser = { __tab: t };
  return t;
}

module.exports = { ROOT, load, run, makeTab };
