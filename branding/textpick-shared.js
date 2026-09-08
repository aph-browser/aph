/* Aph text picker — shared pure logic (no Firefox deps).
 *
 * Used by the content-side actor child (branding/textpick-child.sys.mjs,
 * loaded via loadSubScript) and by tests (tests/textpick.test.js loads this
 * file directly in node:vm). Classic script on purpose: defines a single
 * global `AphTextPickLogic` so both consumers work without a module system.
 *
 * Two jobs:
 *   1. snapToBlock(): click-a-word grabs the whole P/LI/BLOCKQUOTE/PRE/TABLE
 *      cell/heading, not the fragmented inline SPAN/B/A under the cursor.
 *   2. cleanText(): tidy innerText (respects CSS line breaks already — just
 *      collapse blank runs and trim).
 */
var AphTextPickLogic = (function () {
  // Block-level containers worth copying as a unit. TD/TH beat TABLE on
  // purpose: nearest wins, so cells snap to cells and ArrowUp reaches the
  // row/table. DIV is deliberately NOT here — div-soup falls through to the
  // hit element itself (see snapToBlock).
  const BLOCK_TAGS = {
    P: true, LI: true, BLOCKQUOTE: true, PRE: true,
    TD: true, TH: true, TABLE: true,
    H1: true, H2: true, H3: true, H4: true, H5: true, H6: true,
    FIGCAPTION: true, DT: true, DD: true, LEGEND: true,
  };

  // Phrasing content: transparent for selection, climb straight through it.
  const PHRASING_TAGS = {
    SPAN: true, B: true, I: true, U: true, S: true, STRIKE: true,
    EM: true, STRONG: true, CODE: true, SAMP: true, KBD: true, VAR: true,
    SUB: true, SUP: true, SMALL: true, BIG: true, MARK: true, Q: true,
    CITE: true, DFN: true, ABBR: true, TIME: true, DATA: true,
    A: true, LABEL: true, BDO: true, BDI: true, WBR: true,
  };

  const ROOT_TAGS = { BODY: true, HTML: true };

  function tagOf(node) {
    try {
      const t = node && node.tagName;
      return typeof t === "string" ? t.toUpperCase() : "";
    } catch (e) {
      return "";
    }
  }

  function parentOf(node) {
    try {
      return (node && (node.parentElement || node.parentNode)) || null;
    } catch (e) {
      return null;
    }
  }

  // Nearest structural ancestor-or-self for a hovered/clicked node.
  // Text nodes start at their parent. Climbs through phrasing content and
  // stops at the first structural element (P, LI, TD, DIV, …). Returns null
  // for BODY/HTML hits (clicking empty page chrome copies nothing).
  function snapToBlock(node) {
    try {
      let el = node;
      if (!el) {
        return null;
      }
      try {
        if (el.nodeType === 3) {
          el = parentOf(el);
        }
      } catch (e) {}
      while (el && PHRASING_TAGS[tagOf(el)]) {
        const p = parentOf(el);
        if (!p || ROOT_TAGS[tagOf(p)]) {
          return null;
        }
        el = p;
      }
      if (!el || ROOT_TAGS[tagOf(el)]) {
        return null;
      }
      return el;
    } catch (e) {
      return null;
    }
  }

  // One step toward the document root for ArrowUp. Clamps at BODY/HTML and
  // at parentless nodes (returns the input when there is nowhere to go).
  function climbUp(node) {
    try {
      if (!node) {
        return node;
      }
      const p = parentOf(node);
      if (!p || ROOT_TAGS[tagOf(p)]) {
        return node;
      }
      return p;
    } catch (e) {
      return node;
    }
  }

  // Tidy innerText: strip trailing spaces per line, collapse 3+ blank lines
  // to one, trim the block edges. Interior leading whitespace survives on
  // purpose (PRE/code indentation is meaningful).
  function cleanText(text) {
    try {
      const lines = String(text == null ? "" : text).split("\n");
      const out = [];
      let blanks = 0;
      for (let raw of lines) {
        const line = raw.replace(/[ 	\u00a0]+$/g, "");
        if (/^\s*$/.test(line)) {
          blanks++;
          if (blanks <= 1 && out.length > 0) {
            out.push("");
          }
          continue;
        }
        blanks = 0;
        out.push(line);
      }
      while (out.length && out[out.length - 1] === "") {
        out.pop();
      }
      return out.join("\n").replace(/^[ \t\u00a0]+/, "").replace(/[ \t\u00a0]+$/, "");
    } catch (e) {
      return "";
    }
  }

  return {
    BLOCK_TAGS,
    PHRASING_TAGS,
    tagOf,
    snapToBlock,
    climbUp,
    cleanText,
  };
})();
