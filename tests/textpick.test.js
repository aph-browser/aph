// Regression guards for the text-picker snap/clean logic
// (branding/textpick-shared.js). Pure DOM-shape tests — no layout engine.
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { run, makeContentNode, makeTextNode } = require("./helpers");

const sb = { window: {}, document: { readyState: "loading" } };
run("textpick-shared.js", sb);
const L = sb.AphTextPickLogic;

function paraTree() {
  // BODY > DIV > P > SPAN > B("word")
  const b = makeContentNode("B", { text: "word" });
  const span = makeContentNode("SPAN", { kids: [b] });
  const p = makeContentNode("P", { text: "full sentence", kids: [span] });
  const div = makeContentNode("DIV", { kids: [p] });
  const body = makeContentNode("BODY", { kids: [div] });
  return { body, div, p, span, b };
}

describe("snapToBlock", () => {
  it("climbs inline fragments to the block container", () => {
    const { p, span, b } = paraTree();
    assert.equal(L.snapToBlock(b), p);
    assert.equal(L.snapToBlock(span), p);
    assert.equal(L.snapToBlock(p), p);
  });

  it("snaps links to list items and bold to table cells", () => {
    const a = makeContentNode("A", { text: "link" });
    const li = makeContentNode("LI", { kids: [a] });
    assert.equal(L.snapToBlock(a), li);

    const b = makeContentNode("B", { text: "cell" });
    const td = makeContentNode("TD", { kids: [b] });
    const tr = makeContentNode("TR", { kids: [td] });
    const table = makeContentNode("TABLE", { kids: [tr] });
    assert.equal(L.snapToBlock(b), td);
    assert.equal(L.snapToBlock(table), table);
  });

  it("falls back to the hit element in div soup", () => {
    const span = makeContentNode("SPAN", { text: "card text" });
    const card = makeContentNode("DIV", { kids: [span] });
    assert.equal(L.snapToBlock(span), card);
    assert.equal(L.snapToBlock(card), card);
  });

  it("returns null for page chrome and text-node parents resolve", () => {
    const { p } = paraTree();
    const body = makeContentNode("BODY", { kids: [] });
    assert.equal(L.snapToBlock(body), null);
    assert.equal(L.snapToBlock(null), null);
    assert.equal(L.snapToBlock(undefined), null);

    const t = makeTextNode(p, "raw words");
    assert.equal(L.snapToBlock(t), p);
  });
});

describe("climbUp", () => {
  it("walks to parents and clamps at the root", () => {
    const { div, p } = paraTree();
    assert.equal(L.climbUp(p), div);
    assert.equal(L.climbUp(div), div, "parent is BODY: clamped");
  });
});

describe("cleanText", () => {
  it("trims, strips trailing space, collapses blank runs", () => {
    assert.equal(L.cleanText("  hello  \n\n\nworld  \n\n"), "hello\n\nworld");
    assert.equal(L.cleanText("   \n  "), "");
    assert.equal(L.cleanText(null), "");
    assert.equal(L.cleanText("a\t \nb"), "a\nb");
    assert.equal(
      L.cleanText("  code\n    indented\n  last  "),
      "code\n    indented\n  last",
      "pre interiors keep indentation, block edges trim"
    );
  });
});

describe("tag sets", () => {
  it("covers the copy-worthy blocks, excludes div/span", () => {
    for (const t of ["P", "LI", "BLOCKQUOTE", "PRE", "TABLE", "H2"]) {
      assert.ok(L.BLOCK_TAGS[t], t);
    }
    assert.ok(!L.BLOCK_TAGS.DIV && !L.BLOCK_TAGS.SPAN);
    assert.ok(L.PHRASING_TAGS.SPAN && L.PHRASING_TAGS.A && L.PHRASING_TAGS.CODE);
  });
});

// Parent controller (branding/textpick.js): arm/copy/shortcut with mocks.
function makeControllerSandbox(scheme, o) {
  const opts = o || {};
  const imported = [];
  const sent = [];
  const copied = [];
  const toastCls = new Set();
  const toastTexts = [];
  let keyHandler = null;
  const actor = { sendAsyncMessage: (n, d) => { sent.push([n, d]); } };
  const sb = {
    window: { addEventListener: (t, h) => { if (t === "keydown") keyHandler = h; } },
    document: {
      readyState: "complete",
      getElementById: () => null,
      createElement: () => {
        const el = {
          _text: "",
          classList: {
            add: (c) => toastCls.add(c),
            remove: (c) => toastCls.delete(c),
          },
        };
        Object.defineProperty(el, "textContent", {
          get() { return this._text; },
          set(v) { this._text = v; toastTexts.push(v); },
          configurable: true,
        });
        return el;
      },
      body: { appendChild() {} },
      documentElement: { appendChild() {} },
    },
    gBrowser: {
      selectedBrowser: {
        currentURI: { scheme },
        browsingContext: { currentWindowGlobal: { getActor: () => actor } },
      },
    },
    ChromeUtils: {
      // Registration runs at the parent module top level; the window only
      // imports it (registerWindowActor has zero window-scope precedent).
      importESModule: (uri) => {
        imported.push(uri);
        if (opts.importThrows) {
          throw new Error(opts.importThrows);
        }
        return {};
      },
    },
    Services: { console: { logStringMessage() {} } },
    Cc: {
      "@mozilla.org/widget/clipboardhelper;1": {
        getService: () => ({ copyString: (t) => { copied.push(t); } }),
      },
    },
    Ci: { nsIClipboardHelper: {} },
  };
  run("textpick.js", sb);
  return {
    api: sb.window.AphTextPick,
    imported, sent, copied, toastCls, toastTexts,
    key: (e) => keyHandler(e),
  };
}

describe("controller", () => {
  it("imports the parent module (registration runs at its top level)", () => {
    const c = makeControllerSandbox("https");
    assert.equal(c.imported.length, 1);
    assert.ok(c.imported[0].endsWith("actors/AphTextPickParent.sys.mjs"));
    assert.equal(JSON.parse(c.api.debug()).registerError, "none");
  });

  it("surfaces import failure in debug()", () => {
    const c = makeControllerSandbox("https", { importThrows: "boom" });
    assert.equal(JSON.parse(c.api.debug()).registerError, "boom");
  });

  it("parent module self-registers with precedent-shaped options", () => {
    const fs = require("fs");
    const path = require("path");
    const src = fs.readFileSync(
      path.join(__dirname, "..", "branding", "textpick-parent.sys.mjs"),
      "utf8"
    );
    assert.ok(src.includes("registerWindowActor"), "registers");
    assert.ok(src.includes("esModuleURI"), "ESM key, not bare moduleURI");
    assert.ok(!/[^e]ModuleURI/.test(src.replace(/esModuleURI/g, "")), "no bare key");
    assert.ok(src.includes("http://*/*") && src.includes("https://*/*"), "schemes");
    assert.ok(src.includes("AphTextPickRegisterError"), "error export");
    // Web-content actors require both (see PageExtractor in omni.ja):
    // without them fission never instantiates the actor, silently.
    assert.ok(src.includes('messageManagerGroups'), "browser groups");
    assert.ok(src.includes('safeForUntrustedWebProcess'), "untrusted-process opt-in");
  });

  it("arms on https pages and copies picked text", () => {
    const c = makeControllerSandbox("https");
    assert.equal(c.api.arm(), true);
    assert.equal(c.api.isArmed(), true);
    assert.deepEqual(c.sent[0][0], "AphTextPick:Arm");
    c.api._onPickedText("hello world");
    assert.deepEqual(c.copied, ["hello world"]);
    assert.ok(c.toastTexts.some((t) => t.startsWith("Copied 11 chars")));
    assert.equal(c.api.isArmed(), false);
  });

  it("refuses non-web pages and empty picks", () => {
    const c = makeControllerSandbox("about");
    assert.equal(c.api.arm(), false);
    assert.equal(c.sent.length, 0);
    assert.ok(c.toastTexts.some((t) => /Can't pick/.test(t)));
    c.api._onPickedText("   ");
    assert.equal(c.copied.length, 0);
    assert.ok(c.toastTexts.some((t) => /No text/.test(t)));
  });

  it("child start failure surfaces a toast, not silence", () => {
    const c = makeControllerSandbox("https");
    c.api.arm();
    assert.equal(c.api.isArmed(), true);
    c.api._onFailed();
    assert.equal(c.api.isArmed(), false);
    assert.ok(c.toastTexts.some((t) => /failed to start/.test(t)));
  });

  it("debug() reports scheme, actor, and registration health", () => {
    const c = makeControllerSandbox("https");
    const d = JSON.parse(c.api.debug());
    assert.equal(d.scheme, "https");
    assert.equal(d.actor, "ok");
    assert.equal(d.canMessage, true);
    assert.equal(d.registerError, "none");
  });

  it("Ctrl+Alt+C toggles, editable targets exempt", () => {
    const c = makeControllerSandbox("https");
    const base = { ctrlKey: true, altKey: true, shiftKey: false, metaKey: false,
      code: "KeyC", repeat: false, preventDefault() {}, stopPropagation() {} };
    c.key({ ...base, target: { tagName: "DIV" } });
    assert.equal(c.api.isArmed(), true);
    c.key({ ...base, target: { tagName: "DIV" } });
    assert.equal(c.api.isArmed(), false, "second press cancels");
    c.key({ ...base, target: { tagName: "INPUT" } });
    assert.equal(c.api.isArmed(), false, "typing keeps AltGr+C");
  });
});
