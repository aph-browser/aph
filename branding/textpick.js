/* Aph text picker — parent-side controller (chrome window).
 * Arms the content actor (branding/textpick-child.sys.mjs), owns the OS
 * clipboard (page CSP can never block nsIClipboardHelper) and the toast.
 * Trigger: command palette ("Copy Text From Page…") or Ctrl+Alt+C.
 * Click copies, ArrowUp/Down adjust depth, Esc cancels, switching tabs
 * disarms (child stops on visibilitychange; the shortcut toggle self-heals).
 * Injected into browser.xhtml via rebrand.py (chrome://browser/content/textpick.js).
 */
(function () {
  const ACTOR = "AphTextPick";
  // Parent module in actors/ (browser omni.ja), matching every shipped actor.
  const PARENT_URI = "resource:///actors/AphTextPickParent.sys.mjs";
  const TOAST_MS = 2400;

  let armed = false;
  let toastTimer = null;
  let registerError = null;

  function pickLog(msg) {
    try {
      Services.console.logStringMessage(`[AphTextPick] ${msg}`);
    } catch (e) {}
  }

  // Registration itself runs at the parent module's top level (system
  // scope, evaluated once per process). This import is what triggers it —
  // and importESModule provably exists in window scope (workspaces.js uses
  // it live), unlike registerWindowActor, which no shipped window script
  // calls. importESModule is synchronous: it returns the namespace.
  function registerActor() {
    try {
      if (!ChromeUtils || typeof ChromeUtils.importESModule !== "function") {
        registerError = "importESModule unavailable";
        return;
      }
      const ns = ChromeUtils.importESModule(PARENT_URI);
      try {
        if (ns && ns.AphTextPickRegisterError) {
          registerError = String(ns.AphTextPickRegisterError);
        }
      } catch (e) {}
    } catch (e) {
      try {
        registerError = String((e && e.message) || e);
      } catch (_e) {
        registerError = "import failed";
      }
    }
  }

  function selectedScheme() {
    try {
      return gBrowser?.selectedBrowser?.currentURI?.scheme || "";
    } catch (e) {
      return "";
    }
  }

  function getActor() {
    try {
      const wg = gBrowser?.selectedBrowser?.browsingContext?.currentWindowGlobal;
      return wg?.getActor?.(ACTOR) || null;
    } catch (e) {
      return null;
    }
  }

  function arm() {
    try {
      const scheme = String(selectedScheme() || "").toLowerCase();
      if (scheme !== "http" && scheme !== "https") {
        toast("Can't pick text on this page");
        return false;
      }
      let actor = null;
      try {
        actor = getActor();
      } catch (e) {
        pickLog(`arm: getActor threw (${(e && e.message) || e})`);
        actor = null;
      }
      if (!actor) {
        pickLog(
          `arm: no actor (scheme=${scheme} registerError=${registerError || "none"})`
        );
        toast("Picker unavailable — reload the page and retry");
        return false;
      }
      actor.sendAsyncMessage("AphTextPick:Arm", {});
      armed = true;
      toast("Click an element to copy · ↑/↓ adjust · Esc cancels", 3200);
      return true;
    } catch (e) {
      return false;
    }
  }

  function cancel() {
    armed = false;
    try {
      getActor()?.sendAsyncMessage("AphTextPick:Cancel", {});
    } catch (e) {}
    hideToast();
  }

  // Called by the parent actor module on AphTextPick:Picked.
  function _onPickedText(text) {
    armed = false;
    const clean = String(text == null ? "" : text);
    if (!clean.trim()) {
      toast("No text there");
      return;
    }
    try {
      const helper = Cc["@mozilla.org/widget/clipboardhelper;1"].getService(
        Ci.nsIClipboardHelper
      );
      helper.copyString(clean);
      pickLog(`copied ${clean.length} chars`);
      toast(`Copied ${clean.length} char${clean.length === 1 ? "" : "s"}`);
    } catch (e) {
      toast("Copy failed");
    }
  }

  // Called by the parent actor module on AphTextPick:Failed (child could
  // not start — e.g. shared logic failed to load). Never fail silently:
  // a dead picker with no feedback is undebuggable.
  function _onFailed() {
    armed = false;
    pickLog("child failed to start");
    toast("Picker failed to start — see Browser Console");
  }

  // Ground-truth probe for the Browser Console: returns (and logs) one
  // JSON line describing scheme, actor state, and registration health.
  function debug() {
    const out = { scheme: "", actor: "missing", canMessage: false,
      registerError: registerError || "none" };
    try {
      out.scheme = String(selectedScheme() || "");
    } catch (e) {}
    try {
      const a = getActor();
      if (a) {
        out.actor = "ok";
        out.canMessage = typeof a.sendAsyncMessage === "function";
      }
    } catch (e) {
      out.actor = `error: ${(e && e.message) || e}`;
    }
    let s = "";
    try {
      s = JSON.stringify(out);
    } catch (e) {
      s = '{"error":"stringify"}';
    }
    pickLog(`debug ${s}`);
    return s;
  }

  function ensureToast() {
    try {
      let el = document.getElementById("aph-toast");
      if (el) {
        return el;
      }
      el = document.createElement("div");
      el.id = "aph-toast";
      (document.body || document.documentElement).appendChild(el);
      return el;
    } catch (e) {
      return null;
    }
  }

  function toast(msg, ms) {
    try {
      const el = ensureToast();
      if (!el) {
        return;
      }
      el.textContent = msg;
      el.classList.add("show");
      if (toastTimer) {
        clearTimeout(toastTimer);
      }
      toastTimer = setTimeout(() => {
        try {
          el.classList.remove("show");
        } catch (e) {}
        toastTimer = null;
      }, ms || TOAST_MS);
    } catch (e) {}
  }

  function hideToast() {
    try {
      if (toastTimer) {
        clearTimeout(toastTimer);
        toastTimer = null;
      }
      document.getElementById("aph-toast")?.classList.remove("show");
    } catch (e) {}
  }

  // Same shape as isEditableTarget() in workspaces.js: never steal
  // keystrokes from text fields (also keeps AltGr+C working while typing).
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
    if (e.repeat) {
      return;
    }
    // Ctrl+Alt+C arms (Ctrl+Alt+T/B/R/digits are workspaces; KeyC is free).
    if (e.ctrlKey && e.altKey && !e.shiftKey && !e.metaKey && e.code === "KeyC") {
      if (isEditableTarget(e.target)) {
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      try {
        if (armed) {
          cancel();
        } else {
          arm();
        }
      } catch (err) {}
    }
  }

  function init() {
    try {
      window.AphTextPick = { arm, cancel, debug, _onPickedText, _onFailed, isArmed: () => armed };
    } catch (e) {}
    registerActor();
    window.addEventListener("keydown", onKey, true);
  }

  if (document.readyState === "complete") {
    init();
  } else {
    window.addEventListener("load", init, { once: true });
  }
})();
