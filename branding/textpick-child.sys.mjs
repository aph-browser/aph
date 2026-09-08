/* Aph text picker — content-side actor child (runs in the content process).
 *
 * Loaded automatically for http(s) pages via ChromeUtils.registerWindowActor
 * (see branding/textpick.js). Tracks the mouse, highlights the snapped
 * block under the cursor, and on click sends the cleaned text to the parent,
 * which owns the OS clipboard (page CSP can never block that path).
 *
 * Highlight styling uses CSSOM property sets only (`box.style.outline =`),
 * never style attributes or <style> nodes — programmatic style is exempt
 * from page Content-Security-Policy, so strict-CSP pages highlight fine.
 *
 * Shared snap/clean rules come from branding/textpick-shared.js (classic
 * script, loaded here via loadSubScript into a throwaway scope).
 *
 * NOTE: bare `Services` is correct here — actor module globals provide it
 * (every shipped actor uses it import-free). Do NOT add
 * `import { Services } from "resource://gre/modules/Services.sys.mjs"`:
 * that file does not ship and the static import would kill module load.
 */

const SHARED_URI = "resource:///actors/aph-textpick-shared.js";

function loadSharedLogic() {
  try {
    const scope = {};
    Services.scriptloader.loadSubScript(SHARED_URI, scope);
    if (scope.AphTextPickLogic) {
      return scope.AphTextPickLogic;
    }
  } catch (e) {}
  return null;
}

export class AphTextPickChild extends JSWindowActorChild {
  receiveMessage(message) {
    try {
      if (!message) {
        return;
      }
      if (message.name === "AphTextPick:Arm") {
        this.start();
      } else if (message.name === "AphTextPick:Cancel") {
        this.stop();
      }
    } catch (e) {}
  }

  get contentDoc() {
    try {
      return this.document;
    } catch (e) {
      return null;
    }
  }

  start() {
    try {
      if (this._active) {
        return;
      }
      const doc = this.contentDoc;
      if (!doc || typeof doc.addEventListener !== "function") {
        return;
      }
      this._logic = loadSharedLogic();
      if (!this._logic) {
        // Loud failure: parent toasts (silent here stranded the user with
        // a dead picker and nothing in any console).
        try {
          this.sendAsyncMessage("AphTextPick:Failed", {});
        } catch (e) {}
        return;
      }
      this._active = true;
      this._stack = [];
      this._hover = null;
      this._raf = 0;
      this._box = null;
      // Capture phase: click suppression must beat page handlers (links!).
      doc.addEventListener("mousemove", this, { capture: true, passive: true });
      doc.addEventListener("click", this, true);
      doc.addEventListener("keydown", this, true);
      doc.addEventListener("scroll", this, true);
      doc.addEventListener("visibilitychange", this, true);
      doc.defaultView?.addEventListener("resize", this, true);
      doc.addEventListener("pagehide", this, true);
    } catch (e) {}
  }

  stop() {
    try {
      if (!this._active) {
        return;
      }
      this._active = false;
      const doc = this.contentDoc;
      if (doc && typeof doc.removeEventListener === "function") {
        try {
          doc.removeEventListener("mousemove", this, { capture: true });
        } catch (e) {}
        try {
          doc.removeEventListener("click", this, true);
        } catch (e) {}
        try {
          doc.removeEventListener("keydown", this, true);
        } catch (e) {}
        try {
          doc.removeEventListener("scroll", this, true);
        } catch (e) {}
        try {
          doc.removeEventListener("visibilitychange", this, true);
        } catch (e) {}
        try {
          doc.defaultView?.removeEventListener("resize", this, true);
        } catch (e) {}
        try {
          doc.removeEventListener("pagehide", this, true);
        } catch (e) {}
      }
      this._removeBox();
      this._stack = [];
      this._hover = null;
    } catch (e) {}
  }

  handleEvent(event) {
    try {
      if (!this._active) {
        return;
      }
      switch (event.type) {
        case "mousemove":
          this._onMouseMove(event);
          break;
        case "click":
          this._onClick(event);
          break;
        case "keydown":
          this._onKey(event);
          break;
        case "scroll":
        case "resize":
          this._redraw();
          break;
        case "visibilitychange":
          try {
            if (this.contentDoc?.hidden) {
              this.stop();
            }
          } catch (e) {
            this.stop();
          }
          break;
        case "pagehide":
          this.stop();
          break;
        default:
          break;
      }
    } catch (e) {}
  }

  _onMouseMove(event) {
    try {
      this._mx = event.clientX;
      this._my = event.clientY;
      if (this._raf) {
        return;
      }
      const view = this.contentDoc?.defaultView;
      const run = () => {
        this._raf = 0;
        this._pickAt(this._mx, this._my);
      };
      if (view && typeof view.requestAnimationFrame === "function") {
        this._raf = 1;
        view.requestAnimationFrame(run);
      } else {
        run();
      }
    } catch (e) {}
  }

  _pickAt(x, y) {
    try {
      if (!this._active || x == null || y == null) {
        return;
      }
      const doc = this.contentDoc;
      if (!doc || typeof doc.elementFromPoint !== "function") {
        return;
      }
      const hit = doc.elementFromPoint(x, y);
      if (!hit || (this._box && hit === this._box)) {
        return;
      }
      const snapped = this._logic.snapToBlock(hit);
      if (!snapped) {
        this._hover = null;
        this._removeBox();
        this._stack = [];
        return;
      }
      this._hover = snapped;
      this._stack = [snapped];
      this._redraw();
    } catch (e) {}
  }

  _onClick(event) {
    try {
      if (!this._active) {
        return;
      }
      // Never let the page see picker clicks (links, buttons, focus).
      try {
        event.preventDefault();
      } catch (e) {}
      try {
        event.stopPropagation();
      } catch (e) {}
      try {
        if (typeof event.stopImmediatePropagation === "function") {
          event.stopImmediatePropagation();
        }
      } catch (e) {}
      let text = "";
      try {
        const top = this._stack.length
          ? this._stack[this._stack.length - 1]
          : this._hover;
        const raw = top ? top.innerText ?? top.textContent ?? "" : "";
        text = this._logic.cleanText(raw);
      } catch (e) {
        text = "";
      }
      try {
        this.sendAsyncMessage("AphTextPick:Picked", { text });
      } catch (e) {}
      this.stop();
    } catch (e) {}
  }

  _onKey(event) {
    try {
      if (!this._active) {
        return;
      }
      if (event.key === "Escape") {
        try {
          event.preventDefault();
        } catch (e) {}
        try {
          event.stopPropagation();
        } catch (e) {}
        this.stop();
        return;
      }
      if (event.key === "ArrowUp" || event.key === "ArrowDown") {
        if (!this._stack.length) {
          return;
        }
        try {
          event.preventDefault();
        } catch (e) {}
        try {
          event.stopPropagation();
        } catch (e) {}
        const top = this._stack[this._stack.length - 1];
        if (event.key === "ArrowUp") {
          const up = this._logic.climbUp(top);
          if (up && up !== top) {
            this._stack.push(up);
            this._redraw();
          }
        } else if (this._stack.length > 1) {
          this._stack.pop();
          this._redraw();
        }
      }
    } catch (e) {}
  }

  _redraw() {
    try {
      if (!this._active) {
        return;
      }
      const top = this._stack.length
        ? this._stack[this._stack.length - 1]
        : null;
      if (!top || typeof top.getBoundingClientRect !== "function") {
        this._removeBox();
        return;
      }
      const r = top.getBoundingClientRect();
      if (!r || (r.width <= 0 && r.height <= 0)) {
        this._removeBox();
        return;
      }
      const box = this._ensureBox();
      if (!box) {
        return;
      }
      // CSSOM sets (CSP-exempt) — never setAttribute("style", …).
      box.style.left = `${r.left}px`;
      box.style.top = `${r.top}px`;
      box.style.width = `${Math.max(0, r.width)}px`;
      box.style.height = `${Math.max(0, r.height)}px`;
    } catch (e) {}
  }

  _ensureBox() {
    try {
      if (this._box && this._box.isConnected) {
        return this._box;
      }
      const doc = this.contentDoc;
      if (!doc || typeof doc.createElement !== "function") {
        return null;
      }
      const box = doc.createElement("div");
      // pointer-events:none keeps it invisible to elementFromPoint, so no
      // hide-measure-reshow dance is needed on mousemove.
      box.style.position = "fixed";
      box.style.zIndex = "2147483647";
      box.style.pointerEvents = "none";
      box.style.margin = "0";
      box.style.padding = "0";
      box.style.outline = "2px solid #ff2d55";
      box.style.outlineOffset = "-1px";
      box.style.backgroundColor = "rgba(255, 45, 85, 0.08)";
      box.style.borderRadius = "2px";
      const root = doc.documentElement;
      if (!root || typeof root.appendChild !== "function") {
        return null;
      }
      root.appendChild(box);
      this._box = box;
      return box;
    } catch (e) {
      return null;
    }
  }

  _removeBox() {
    try {
      if (this._box) {
        try {
          this._box.remove();
        } catch (e) {}
        this._box = null;
      }
    } catch (e) {}
  }
}
