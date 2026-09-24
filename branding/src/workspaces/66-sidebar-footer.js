  // Sidebar footer (gear) hide/show -------------------------------------
  // sidebar-main's bottom bar (gear + empty space when tools=none) can be
  // hidden to reclaim the strip: pref aph.sidebar.hideFooter, HIDDEN by
  // default (an absent pref counts as hidden, so seed-once profiles that
  // predate the pref hide too). The palette's Show/Hide Sidebar Footer
  // command flips the pref; a pref observer applies it live. The Aph
  // menu's "Customize Sidebar…" item stays the escape hatch.
  //
  // Mechanism: a host attribute + one-time shadow <style>, never an
  // inline style on Lit-managed nodes (re-renders would wipe it, which
  // is what the old MutationObserver existed to repair). Host attributes
  // survive re-renders — they live outside the shadow root — and shadow
  // CSS matches them via :host(). So hiding is a single attribute flip;
  // there is nothing to re-apply and no standing observer. theme.css
  // can't reach the shadow DOM, hence the injected style element.
  // Everything fails silent (house style).
  //
  // NOTE: deliberately NOT exempting expand-on-hover. Stock's hover
  // trigger is mouse-position-vs-launcher-bounds (MousePosTracker), not
  // CSS :hover, and nothing here shrinks those bounds (the dock only adds
  // height; the strip keeps its tabs) — carving out the mode would be
  // complexity without a proven mechanism.
  var SIDEBAR_FOOTER_PREF = "aph.sidebar.hideFooter";
  const SIDEBAR_FOOTER_STYLE_ID = "aph-footer-style";
  const SIDEBAR_FOOTER_ATTR = "data-aph-hide-footer";
  let sidebarFooterPrefObserver = null;

  function sidebarFooterHidden() {
    try {
      if (
        typeof Services !== "undefined" &&
        Services &&
        Services.prefs &&
        typeof Services.prefs.getBoolPref === "function"
      ) {
        return !!Services.prefs.getBoolPref(SIDEBAR_FOOTER_PREF);
      }
    } catch (e) {}
    return true;
  }

  function sidebarFooterHost() {
    try {
      if (typeof document === "undefined" || !document) {
        return null;
      }
      if (typeof document.querySelector !== "function") {
        return null;
      }
      return document.querySelector("sidebar-main") || null;
    } catch (e) {
      return null;
    }
  }

  // Inject once (guarded by id): :host([attr]) survives every Lit
  // re-render because the style element itself is static shadow content,
  // and the toggle below only touches the host attribute.
  function ensureSidebarFooterStyle() {
    try {
      const host = sidebarFooterHost();
      if (!host) {
        return null;
      }
      const root = host.shadowRoot || null;
      if (!root || typeof root.querySelector !== "function") {
        return null;
      }
      let style = null;
      try {
        style =
          typeof root.getElementById === "function"
            ? root.getElementById(SIDEBAR_FOOTER_STYLE_ID)
            : root.querySelector("#" + SIDEBAR_FOOTER_STYLE_ID);
      } catch (e) {
        style = null;
      }
      if (style) {
        return style;
      }
      try {
        style = document.createElement("style");
      } catch (e) {
        return null;
      }
      if (!style) {
        return null;
      }
      try {
        style.id = SIDEBAR_FOOTER_STYLE_ID;
        style.textContent =
          ':host([' + SIDEBAR_FOOTER_ATTR + ']) .buttons-wrapper{display:none !important;}';
      } catch (e) {}
      try {
        root.appendChild(style);
      } catch (e) {
        return null;
      }
      return style;
    } catch (e) {
      return null;
    }
  }

  function applySidebarFooter() {
    try {
      ensureSidebarFooterStyle();
    } catch (e) {}
    try {
      const host = sidebarFooterHost();
      if (!host || typeof host.toggleAttribute !== "function") {
        return false;
      }
      const hidden = sidebarFooterHidden();
      try {
        host.toggleAttribute(SIDEBAR_FOOTER_ATTR, hidden);
      } catch (e) {
        return false;
      }
      return hidden;
    } catch (e) {
      return false;
    }
  }

  function cleanupSidebarFooter() {
    try {
      if (
        sidebarFooterPrefObserver &&
        typeof Services !== "undefined" &&
        Services &&
        Services.prefs &&
        typeof Services.prefs.removeObserver === "function"
      ) {
        Services.prefs.removeObserver(SIDEBAR_FOOTER_PREF, sidebarFooterPrefObserver);
      }
    } catch (e) {}
    sidebarFooterPrefObserver = null;
    // Leave no trace: drop the attribute and the injected style.
    try {
      const host = sidebarFooterHost();
      if (host && typeof host.removeAttribute === "function") {
        try {
          host.removeAttribute(SIDEBAR_FOOTER_ATTR);
        } catch (e) {}
      }
      const root = (host && host.shadowRoot) || null;
      if (root) {
        let style = null;
        try {
          style =
            typeof root.getElementById === "function"
              ? root.getElementById(SIDEBAR_FOOTER_STYLE_ID)
              : root.querySelector("#" + SIDEBAR_FOOTER_STYLE_ID);
        } catch (e) {}
        try {
          if (style && style.parentNode && typeof style.parentNode.removeChild === "function") {
            style.parentNode.removeChild(style);
          } else if (style && typeof style.remove === "function") {
            style.remove();
          }
        } catch (e) {}
      }
    } catch (e) {}
  }

  function initSidebarFooter() {
    try {
      applySidebarFooter();
    } catch (e) {}
    try {
      if (
        typeof Services !== "undefined" &&
        Services &&
        Services.prefs &&
        typeof Services.prefs.addObserver === "function"
      ) {
        sidebarFooterPrefObserver = {
          observe() {
            try {
              applySidebarFooter();
            } catch (e) {}
          },
        };
        Services.prefs.addObserver(SIDEBAR_FOOTER_PREF, sidebarFooterPrefObserver);
      }
    } catch (e) {
      sidebarFooterPrefObserver = null;
    }
    try {
      window.addEventListener("unload", cleanupSidebarFooter, { once: true });
    } catch (e) {}
  }

  if (document.readyState === "complete") {
    initSidebarFooter();
  } else {
    window.addEventListener("load", initSidebarFooter, { once: true });
  }
