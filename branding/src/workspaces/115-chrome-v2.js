  // Next-gen chrome (theme.css §29): floating pill bar and reworked
  // buttons. Always on — no pref, no toggle: the attribute is stamped
  // unconditionally at load and reload + stop live in the urlbar
  // trailing slot. Every DOM touch is guarded so test sandboxes
  // (no DOM) no-op.
  const CHROME_V2_ATTR = "data-aph-chrome-v2";

  // Reload (+ stop, its loading twin) lives in the urlbar trailing slot
  // (Safari pattern). Missing anchors fail open (stock bar layout).
  function placeChromeV2Reload() {
    try {
      const slot =
        typeof document.querySelector === "function"
          ? document.querySelector(".urlbar-input-container")
          : null;
      if (!slot || typeof document.getElementById !== "function") {
        return;
      }
      ["reload-button", "stop-button"].forEach((id) => {
        try {
          const btn = document.getElementById(id);
          if (!btn || btn.parentNode === slot) {
            return;
          }
          slot.appendChild(btn);
        } catch (e) {}
      });
    } catch (e) {}
  }

  function initChromeV2() {
    try {
      document.documentElement.setAttribute(CHROME_V2_ATTR, "1");
    } catch (e) {}
    try {
      placeChromeV2Reload();
    } catch (e) {}
  }

  if (document.readyState === "complete") {
    initChromeV2();
  } else {
    window.addEventListener("load", initChromeV2, { once: true });
  }
