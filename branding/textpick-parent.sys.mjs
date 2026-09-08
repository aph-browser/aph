/* Aph text picker — parent-side actor module (runs in the parent process).
 *
 * Tag-less omni.ja entry (no browser.xhtml script tag): instantiated by the
 * actor framework for every matching content process. Forwards the picked
 * text to the owning window's controller (branding/textpick.js), which owns
 * the OS clipboard + toast. Thin on purpose — all policy lives there.
 *
 * REGISTRATION LIVES HERE, at module top level. Rationale: the module top
 * level always executes in system scope with the full ChromeUtils API, and
 * ESM evaluates once per process no matter how many windows import it.
 * Calling ChromeUtils.registerWindowActor from a browser.xhtml window
 * script is unreliable (no shipped window script does it) and fails
 * silently. The controller (textpick.js) triggers this import at startup.
 */

const ACTOR = "AphTextPick";
const PARENT_URI = "resource:///actors/AphTextPickParent.sys.mjs";
const CHILD_URI = "resource:///actors/AphTextPickChild.sys.mjs";
// Explicit schemes — "*://*/*" has zero precedent in this build.
const MATCHES = ["http://*/*", "https://*/*"];

// surfaces registration failures (importESModule is sync: the namespace is
// returned, so the controller reads this right after importing). Declared
// before the try block — assignment inside catch would hit TDZ otherwise.
export let AphTextPickRegisterError = null;

try {
  ChromeUtils.registerWindowActor(ACTOR, {
    parent: { esModuleURI: PARENT_URI },
    child: { esModuleURI: CHILD_URI },
    matches: MATCHES.slice(),
    // Both keys are mandatory for web content (mirrors PageExtractor, the
    // shipped text-extraction actor): without messageManagerGroups the
    // actor is invisible to <browser> contexts, and without
    // safeForUntrustedWebProcess fission never instantiates it in
    // untrusted content processes. Either omission fails 100% silently.
    messageManagerGroups: ["browsers"],
    safeForUntrustedWebProcess: true,
  });
} catch (e) {
  // Repeats across imports are impossible (ESM evaluates once), so any
  // error here is real. Exported for the controller's debug().
  AphTextPickRegisterError = String((e && e.message) || e);
}

export class AphTextPickParent extends JSWindowActorParent {
  receiveMessage(message) {
    try {
      if (!message) {
        return;
      }
      const win = this.browsingContext?.topChromeWindow;
      if (!win?.AphTextPick) {
        return;
      }
      if (message.name === "AphTextPick:Picked") {
        win.AphTextPick._onPickedText(message.data?.text ?? "");
      } else if (message.name === "AphTextPick:Failed") {
        win.AphTextPick._onFailed();
      }
    } catch (e) {}
  }
}
