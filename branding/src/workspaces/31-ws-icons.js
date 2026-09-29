  // Workspace icons: Lucide 1.48.0 path data, vendored (ISC,
  // https://lucide.dev — attribution: "Lucide icons (ISC License),
  // Copyright (c) Lucide Contributors"). {wsId: lucide-key} persists in
  // pref aph.workspaces.icons; reads are allowlist-validated so unknown
  // keys fall back to the number. Marks render currentColor (monochrome
  // dock story, no paint logic here) via namespaced construction (never
  // innerHTML — XUL/XHTML-safe, same precedent as makeDockAphMark).
  const WS_ICONS_PREF = "aph.workspaces.icons";
  const WS_ICON_KEYS = ["briefcase", "code-xml", "mail", "message-circle", "globe", "file-text", "music", "calendar-days", "book-open", "terminal", "palette", "lightbulb", "inbox", "star", "house", "rocket", "target", "flag", "compass", "camera", "headphones", "gamepad-2", "shopping-bag", "graduation-cap", "newspaper", "pen-tool", "database", "coffee", "sparkles", "credit-card", "video", "folder", "bookmark", "heart", "calendar", "shield", "cpu", "code"];
  const WS_ICON_LABELS = {"briefcase": "Briefcase", "code-xml": "Code XML", "mail": "Mail", "message-circle": "Chat", "globe": "Web", "file-text": "Notes", "music": "Music", "calendar-days": "Calendar Days", "book-open": "Reading", "terminal": "Terminal", "palette": "Design", "lightbulb": "Ideas", "inbox": "Inbox", "star": "Starred", "house": "Home", "rocket": "Launch", "target": "Focus", "flag": "Flag", "compass": "Explore", "camera": "Photos", "headphones": "Audio", "gamepad-2": "Games", "shopping-bag": "Shopping", "graduation-cap": "Study", "newspaper": "News", "pen-tool": "Draw", "database": "Data", "coffee": "Break", "sparkles": "AI", "credit-card": "Finance", "video": "Video", "folder": "Projects", "bookmark": "Saved", "heart": "Favorites", "calendar": "Calendar", "shield": "Privacy", "cpu": "Labs", "code": "Code"};
  const WS_ICON_SEARCH = {"house": "home"};
  const WS_ICON_SHAPES = {"briefcase": [{ t: "path", a: { d: "M16 20V4a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" } }, { t: "rect", a: { width: "20", height: "14", x: "2", y: "6", rx: "2" } }], "code-xml": [{ t: "path", a: { d: "m18 16 4-4-4-4" } }, { t: "path", a: { d: "m6 8-4 4 4 4" } }, { t: "path", a: { d: "m14.5 4-5 16" } }], "mail": [{ t: "path", a: { d: "m22 7-8.991 5.727a2 2 0 0 1-2.009 0L2 7" } }, { t: "rect", a: { x: "2", y: "4", width: "20", height: "16", rx: "2" } }], "message-circle": [{ t: "path", a: { d: "M2.992 16.342a2 2 0 0 1 .094 1.167l-1.065 3.29a1 1 0 0 0 1.236 1.168l3.413-.998a2 2 0 0 1 1.099.092 10 10 0 1 0-4.777-4.719" } }], "globe": [{ t: "circle", a: { cx: "12", cy: "12", r: "10" } }, { t: "path", a: { d: "M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" } }, { t: "path", a: { d: "M2 12h20" } }], "file-text": [{ t: "path", a: { d: "M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z" } }, { t: "path", a: { d: "M14 2v5a1 1 0 0 0 1 1h5" } }, { t: "path", a: { d: "M10 9H8" } }, { t: "path", a: { d: "M16 13H8" } }, { t: "path", a: { d: "M16 17H8" } }], "music": [{ t: "path", a: { d: "M9 18V5l12-2v13" } }, { t: "circle", a: { cx: "6", cy: "18", r: "3" } }, { t: "circle", a: { cx: "18", cy: "16", r: "3" } }], "calendar-days": [{ t: "path", a: { d: "M8 2v3" } }, { t: "path", a: { d: "M16 2v3" } }, { t: "rect", a: { x: "3", y: "3", width: "18", height: "18", rx: "2" } }, { t: "path", a: { d: "M3 9h18" } }, { t: "path", a: { d: "M8 13h.01" } }, { t: "path", a: { d: "M12 13h.01" } }, { t: "path", a: { d: "M16 13h.01" } }, { t: "path", a: { d: "M8 17h.01" } }, { t: "path", a: { d: "M12 17h.01" } }, { t: "path", a: { d: "M16 17h.01" } }], "book-open": [{ t: "path", a: { d: "M12 5v16" } }, { t: "path", a: { d: "M20.001 19A2 2 0 0022 17V5a2 2 0 00-1.999-2L16 3.002A5 5 0 0012 5a5 5 0 00-4-2H4a2 2 0 00-2 2v12a2 2 0 001.999 2H8a5 5 0 014 2 5 5 0 014-2z" } }], "terminal": [{ t: "path", a: { d: "M12 19h8" } }, { t: "path", a: { d: "m4 17 6-6-6-6" } }], "palette": [{ t: "path", a: { d: "M12 22a1 1 0 0 1 0-20 10 9 0 0 1 10 9 5 5 0 0 1-5 5h-2.25a1.75 1.75 0 0 0-1.4 2.8l.3.4a1.75 1.75 0 0 1-1.4 2.8z" } }, { t: "circle", a: { cx: "13.5", cy: "6.5", r: ".5", fill: "currentColor" } }, { t: "circle", a: { cx: "17.5", cy: "10.5", r: ".5", fill: "currentColor" } }, { t: "circle", a: { cx: "6.5", cy: "12.5", r: ".5", fill: "currentColor" } }, { t: "circle", a: { cx: "8.5", cy: "7.5", r: ".5", fill: "currentColor" } }], "lightbulb": [{ t: "path", a: { d: "M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5" } }, { t: "path", a: { d: "M9 18h6" } }, { t: "path", a: { d: "M10 22h4" } }], "inbox": [{ t: "polyline", a: { points: "22 12 16 12 14 15 10 15 8 12 2 12" } }, { t: "path", a: { d: "M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" } }], "star": [{ t: "path", a: { d: "M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z" } }], "house": [{ t: "path", a: { d: "M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8" } }, { t: "path", a: { d: "M3 10a2 2 0 0 1 .709-1.528l7-6a2 2 0 0 1 2.582 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" } }], "rocket": [{ t: "path", a: { d: "M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5" } }, { t: "path", a: { d: "M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09" } }, { t: "path", a: { d: "M9 12a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.4 22.4 0 0 1-4 2z" } }, { t: "path", a: { d: "M9 12H4s.55-3.03 2-4c1.62-1.08 5 .05 5 .05" } }], "target": [{ t: "circle", a: { cx: "12", cy: "12", r: "10" } }, { t: "circle", a: { cx: "12", cy: "12", r: "6" } }, { t: "circle", a: { cx: "12", cy: "12", r: "2" } }], "flag": [{ t: "path", a: { d: "M4 22V4a1 1 0 0 1 .4-.8A6 6 0 0 1 8 2c3 0 5 2 7.333 2q2 0 3.067-.8A1 1 0 0 1 20 4v10a1 1 0 0 1-.4.8A6 6 0 0 1 16 16c-3 0-5-2-8-2a6 6 0 0 0-4 1.528" } }], "compass": [{ t: "circle", a: { cx: "12", cy: "12", r: "10" } }, { t: "path", a: { d: "m16.24 7.76-1.804 5.411a2 2 0 0 1-1.265 1.265L7.76 16.24l1.804-5.411a2 2 0 0 1 1.265-1.265z" } }], "camera": [{ t: "path", a: { d: "M13.997 4a2 2 0 0 1 1.76 1.05l.486.9A2 2 0 0 0 18.003 7H20a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h1.997a2 2 0 0 0 1.759-1.048l.489-.904A2 2 0 0 1 10.004 4z" } }, { t: "circle", a: { cx: "12", cy: "13", r: "3" } }], "headphones": [{ t: "path", a: { d: "M3 14h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a9 9 0 0 1 18 0v7a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3" } }], "gamepad-2": [{ t: "line", a: { x1: "6", x2: "10", y1: "11", y2: "11" } }, { t: "line", a: { x1: "8", x2: "8", y1: "9", y2: "13" } }, { t: "line", a: { x1: "15", x2: "15.01", y1: "12", y2: "12" } }, { t: "line", a: { x1: "18", x2: "18.01", y1: "10", y2: "10" } }, { t: "path", a: { d: "M17.32 5H6.68a4 4 0 0 0-3.978 3.59c-.006.052-.01.101-.017.152C2.604 9.416 2 14.456 2 16a3 3 0 0 0 3 3c1 0 1.5-.5 2-1l1.414-1.414A2 2 0 0 1 9.828 16h4.344a2 2 0 0 1 1.414.586L17 18c.5.5 1 1 2 1a3 3 0 0 0 3-3c0-1.545-.604-6.584-.685-7.258-.007-.05-.011-.1-.017-.151A4 4 0 0 0 17.32 5z" } }], "shopping-bag": [{ t: "path", a: { d: "M16 10a4 4 0 0 1-8 0" } }, { t: "path", a: { d: "M3.103 6.034h17.794" } }, { t: "path", a: { d: "M3.4 5.467a2 2 0 0 0-.4 1.2V20a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6.667a2 2 0 0 0-.4-1.2l-2-2.667A2 2 0 0 0 17 2H7a2 2 0 0 0-1.6.8z" } }], "graduation-cap": [{ t: "path", a: { d: "M21.42 10.922a1 1 0 0 0-.019-1.838L12.83 5.18a2 2 0 0 0-1.66 0L2.6 9.08a1 1 0 0 0 0 1.832l8.57 3.908a2 2 0 0 0 1.66 0z" } }, { t: "path", a: { d: "M22 10v6" } }, { t: "path", a: { d: "M6 12.5V16a6 3 0 0 0 12 0v-3.5" } }], "newspaper": [{ t: "path", a: { d: "M15 18h-5" } }, { t: "path", a: { d: "M18 14h-8" } }, { t: "path", a: { d: "M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-4 0v-9a2 2 0 0 1 2-2h2" } }, { t: "rect", a: { width: "8", height: "4", x: "10", y: "6", rx: "1" } }], "pen-tool": [{ t: "path", a: { d: "M15.707 21.293a1 1 0 0 1-1.414 0l-1.586-1.586a1 1 0 0 1 0-1.414l5.586-5.586a1 1 0 0 1 1.414 0l1.586 1.586a1 1 0 0 1 0 1.414z" } }, { t: "path", a: { d: "m18 13-1.375-6.874a1 1 0 0 0-.746-.776L3.235 2.028a1 1 0 0 0-1.207 1.207L5.35 15.879a1 1 0 0 0 .776.746L13 18" } }, { t: "path", a: { d: "m2.3 2.3 7.286 7.286" } }, { t: "circle", a: { cx: "11", cy: "11", r: "2" } }], "database": [{ t: "path", a: { d: "M3 5V19A9 3 0 0 0 21 19V5" } }, { t: "path", a: { d: "M3 12A9 3 0 0 0 21 12" } }], "coffee": [{ t: "path", a: { d: "M10 2v2" } }, { t: "path", a: { d: "M14 2v2" } }, { t: "path", a: { d: "M16 8a1 1 0 0 1 1 1v8a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V9a1 1 0 0 1 1-1h14a4 4 0 1 1 0 8h-1" } }, { t: "path", a: { d: "M6 2v2" } }], "sparkles": [{ t: "path", a: { d: "M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z" } }, { t: "path", a: { d: "M20 2v4" } }, { t: "path", a: { d: "M22 4h-4" } }, { t: "circle", a: { cx: "4", cy: "20", r: "2" } }], "credit-card": [{ t: "rect", a: { width: "20", height: "14", x: "2", y: "5", rx: "2" } }, { t: "line", a: { x1: "2", x2: "22", y1: "10", y2: "10" } }, { t: "path", a: { d: "M6 14h2" } }], "video": [{ t: "path", a: { d: "m16 13 5.223 3.482a.5.5 0 0 0 .777-.416V7.87a.5.5 0 0 0-.752-.432L16 10.5" } }, { t: "rect", a: { x: "2", y: "6", width: "14", height: "12", rx: "2" } }], "folder": [{ t: "path", a: { d: "M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" } }], "bookmark": [{ t: "path", a: { d: "M17 3a2 2 0 0 1 2 2v15a1 1 0 0 1-1.496.868l-4.512-2.578a2 2 0 0 0-1.984 0l-4.512 2.578A1 1 0 0 1 5 20V5a2 2 0 0 1 2-2z" } }], "heart": [{ t: "path", a: { d: "M2 9.5a5.5 5.5 0 0 1 9.591-3.676.56.56 0 0 0 .818 0A5.49 5.49 0 0 1 22 9.5c0 2.29-1.5 4-3 5.5l-5.492 5.313a2 2 0 0 1-3 .019L5 15c-1.5-1.5-3-3.2-3-5.5" } }], "calendar": [{ t: "path", a: { d: "M8 2v3" } }, { t: "path", a: { d: "M16 2v3" } }, { t: "rect", a: { x: "3", y: "3", width: "18", height: "18", rx: "2" } }, { t: "path", a: { d: "M3 9h18" } }], "shield": [{ t: "path", a: { d: "M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" } }], "cpu": [{ t: "path", a: { d: "M12 20v2" } }, { t: "path", a: { d: "M12 2v2" } }, { t: "path", a: { d: "M17 20v2" } }, { t: "path", a: { d: "M17 2v2" } }, { t: "path", a: { d: "M2 12h2" } }, { t: "path", a: { d: "M2 17h2" } }, { t: "path", a: { d: "M2 7h2" } }, { t: "path", a: { d: "M20 12h2" } }, { t: "path", a: { d: "M20 17h2" } }, { t: "path", a: { d: "M20 7h2" } }, { t: "path", a: { d: "M7 20v2" } }, { t: "path", a: { d: "M7 2v2" } }, { t: "rect", a: { x: "4", y: "4", width: "16", height: "16", rx: "2" } }, { t: "rect", a: { x: "8", y: "8", width: "8", height: "8", rx: "1" } }], "code": [{ t: "path", a: { d: "m16 18 6-6-6-6" } }, { t: "path", a: { d: "m8 6-6 6 6 6" } }]};
  let wsIcons = null; // lazy-loaded {wsId: lucide-key}

  function loadWsIcons() {
    if (wsIcons) {
      return wsIcons;
    }
    wsIcons = Object.create(null);
    try {
      let raw = "";
      try {
        raw = Services.prefs.getStringPref(WS_ICONS_PREF, "");
      } catch (e) {}
      if (raw) {
        const obj = JSON.parse(raw);
        for (const k of Object.keys(obj || {})) {
          const v = String(obj[k] || "").trim();
          if (isValidId(k) && WS_ICON_KEYS.indexOf(v) !== -1) {
            wsIcons[k] = v;
          }
        }
      }
    } catch (e) {}
    return wsIcons;
  }

  function saveWsIcons() {
    try {
      const plain = {};
      const map = loadWsIcons();
      for (const k of Object.keys(map)) {
        plain[k] = map[k];
      }
      Services.prefs.setStringPref(WS_ICONS_PREF, JSON.stringify(plain));
    } catch (e) {}
  }

  function getWsIcon(wsId) {
    try {
      return loadWsIcons()[wsId] || "";
    } catch (e) {
      return "";
    }
  }

  function setWsIcon(wsId, key) {
    if (!isValidId(wsId)) {
      return false;
    }
    const k = String(key || "").trim();
    try {
      if (k) {
        if (WS_ICON_KEYS.indexOf(k) === -1) {
          return false;
        }
        loadWsIcons()[wsId] = k;
      } else {
        delete loadWsIcons()[wsId];
      }
      saveWsIcons();
    } catch (e) {
      return false;
    }
    updateIndicator();
    return true;
  }

  // Namespaced SVG construction for one mark (size in px, square).
  // Null when the key is unknown or the host lacks createElementNS.
  function makeWsIconSvg(key, size) {
    try {
      const shapes = WS_ICON_SHAPES[key];
      if (!shapes || typeof document.createElementNS !== "function") {
        return null;
      }
      const NS = "http://www.w3.org/2000/svg";
      const svg = document.createElementNS(NS, "svg");
      const px = String(size || 14);
      svg.setAttribute("viewBox", "0 0 24 24");
      svg.setAttribute("width", px);
      svg.setAttribute("height", px);
      svg.setAttribute("aria-hidden", "true");
      svg.setAttribute("fill", "none");
      svg.setAttribute("stroke", "currentColor");
      svg.setAttribute("stroke-width", "2");
      svg.setAttribute("stroke-linecap", "round");
      svg.setAttribute("stroke-linejoin", "round");
      for (const s of shapes) {
        const el = document.createElementNS(NS, s.t);
        for (const a of Object.keys(s.a)) {
          el.setAttribute(a, s.a[a]);
        }
        svg.appendChild(el);
      }
      return svg;
    } catch (e) {
      return null;
    }
  }
