  // Workspace accent overrides: {wsId: hueId} persists in pref
  // aph.workspaces.accents; the workspace end stays allowlist-validated
  // 1..9 (isValidId) while the hue end spans 1..16 (isHueId): nine
  // workspaces, sixteen hues — 10..16 are accent-only extras, never
  // workspace ids. Rendering is CSS-only via [data-accent="N"] /
  // :root[data-aph-accent="N"] (theme.css §21 companion) — no paint
  // logic here. Unset/empty means "follow workspace" (no attribute).
  // Same JSON-string-pref precedent as names (30) and icons (31).
  const WS_ACCENTS_PREF = "aph.workspaces.accents";
  let wsAccents = null; // lazy-loaded {wsId: hueId}

  // Hue ids cover the full 16-stop scale (theme.css §21); workspace ids
  // stay 1..9. Local (not shared): only the accent paths validate hues.
  function isHueId(v) {
    return (
      (v >= "1" && v <= "9" && v.length === 1) ||
      (v >= "10" && v <= "16" && v.length === 2)
    );
  }

  function loadWsAccents() {
    if (wsAccents) {
      return wsAccents;
    }
    wsAccents = Object.create(null);
    try {
      let raw = "";
      try {
        raw = Services.prefs.getStringPref(WS_ACCENTS_PREF, "");
      } catch (e) {}
      if (raw) {
        const obj = JSON.parse(raw);
        for (const k of Object.keys(obj || {})) {
          const v = String(obj[k] || "").trim();
          if (isValidId(k) && isHueId(v)) {
            wsAccents[k] = v;
          }
        }
      }
    } catch (e) {}
    return wsAccents;
  }

  function saveWsAccents() {
    try {
      const plain = {};
      const map = loadWsAccents();
      for (const k of Object.keys(map)) {
        plain[k] = map[k];
      }
      Services.prefs.setStringPref(WS_ACCENTS_PREF, JSON.stringify(plain));
    } catch (e) {}
  }

  function getWsAccent(wsId) {
    try {
      return loadWsAccents()[wsId] || "";
    } catch (e) {
      return "";
    }
  }

  function setWsAccent(wsId, hueId) {
    if (!isValidId(wsId)) {
      return false;
    }
    const h = String(hueId || "").trim();
    try {
      if (h) {
        if (!isHueId(h)) {
          return false;
        }
        loadWsAccents()[wsId] = h;
      } else {
        delete loadWsAccents()[wsId];
      }
      saveWsAccents();
    } catch (e) {
      return false;
    }
    try {
      renderDock();
    } catch (e) {}
    try {
      updateIndicator();
    } catch (e) {}
    // Immediate room: the window accent (:root[data-aph-accent] -> tab
    // fill, voice, hairline) is otherwise only stamped on switch/birth,
    // so a retune would lag one switch behind. Idempotent re-read of
    // the current workspace's hue — unconditional on purpose (cheaper
    // than diffing whether this ws is current).
    try {
      if (typeof stampWindowWs === "function") {
        stampWindowWs(typeof current !== "undefined" ? current : "1");
      }
    } catch (e) {}
    return true;
  }
