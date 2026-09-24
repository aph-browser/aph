  // --- Prefix modes (VSCode/Raycast style) -------------------------------
  // ">" commands · "@" tabs · "#" workspaces/routes/binds · "?" help ·
  // "b:" bookmarks · "h:" history · "a:" archive. Bare text = unified
  // search across everything. Single-char modes only trigger on the very
  // first character so normal queries ("apple", "history of…") never break.
  // Returns {mode, q} where q is the de-prefixed query (trimmed).
  function parseMode(raw) {
    const s = (raw || "").trim();
    if (!s) {
      return { mode: "all", q: "" };
    }
    const first = s[0];
    if (first === ">" || first === "@" || first === "#" || first === "?") {
      return { mode: modeForPrefix(first), q: s.slice(1).trim() };
    }
    // Extended "x:" modes — only when a colon follows a short key.
    const m = s.match(/^([a-zA-Z])\s*:\s*(.*)$/);
    if (m) {
      const k = m[1].toLowerCase();
      if (k === "b") {
        return { mode: "bookmarks", q: (m[2] || "").trim() };
      }
      if (k === "h") {
        return { mode: "history", q: (m[2] || "").trim() };
      }
      if (k === "a") {
        return { mode: "archive", q: (m[2] || "").trim() };
      }
    }
    return { mode: "all", q: s };
  }

  function modeForPrefix(p) {
    if (p === ">") {
      return "commands";
    }
    if (p === "@") {
      return "tabs";
    }
    if (p === "#") {
      return "workspaces";
    }
    return "help";
  }

  function modePrefix(mode) {
    if (mode === "commands") {
      return ">";
    }
    if (mode === "tabs") {
      return "@";
    }
    if (mode === "workspaces") {
      return "#";
    }
    if (mode === "bookmarks") {
      return "b:";
    }
    if (mode === "history") {
      return "h:";
    }
    if (mode === "archive") {
      return "a:";
    }
    if (mode === "help") {
      return "?";
    }
    return "";
  }

  function placeholderFor(mode) {
    try {
      return MODE_PLACEHOLDERS[mode] || PLACEHOLDER;
    } catch (e) {
      return PLACEHOLDER;
    }
  }

  // Static help rows — the "?" mode. keepOpen so users can read then type.
  function helpItems() {
    const rows = [
      [">", "Commands", "All palette commands · e.g. >bind, >new tab"],
      ["@", "Tabs", "Open tabs only · e.g. @github · Ctrl+W closes highlighted tab"],
      ["#", "Workspaces", "Switch / send / routes / binds · e.g. #work, #route"],
      ["b:", "Bookmarks", "Bookmark search only · e.g. b:github"],
      ["h:", "History", "History search only · e.g. h:docs"],
      ["a:", "Archive", "Archived tabs only · e.g. a:report · Enter restores"],
      ["?", "Help", "This cheat-sheet"],
      ["Tab", "Autocomplete", "Fills the selected row title into the input"],
      ["Alt+1–9", "Quick pick", "Runs the Nth visible row"],
      ["Alt+Enter", "Temp container", "Opens URLs / restores archive without consuming"],
      ["Ctrl+N/P", "Navigate", "Move selection up/down without arrow keys"],
      ["Ctrl+W", "Close tab", "Closes the highlighted tab · palette stays open"],
      ["Shift+Enter", "Temp alias", "Same as Alt+Enter"],
    ];
    return rows.map(([key, title, sub]) => ({
      title: `${key}  ${title}`,
      sub,
      hint: "Help",
      kind: "help",
      section: "Help",
      icon: KIND_ICONS.help,
      run: () => {
        try {
          if (input) {
            input.value = key.length <= 2 ? key : "";
            render(input.value);
            try {
              input.focus();
            } catch (_e) {}
          }
        } catch (e) {}
      },
      keepOpen: true,
    }));
  }

  // Footer hint per mode (rendered in #aph-palette-footer).
  function footerHintFor(mode, count) {
    const n = `${count} result${count === 1 ? "" : "s"}`;
    switch (mode) {
      case "tabs":
        return `${n} · ↑↓/Ctrl+N/P · Enter switch · Ctrl+W close · Esc clear`;
      case "commands":
        return `${n} · ↑↓ navigate · Enter run · Tab complete · Esc clear`;
      case "workspaces":
        return `${n} · Enter switch / send / apply route · Esc clear`;
      case "bookmarks":
      case "history":
      case "archive":
        return `${n} · Enter open / restore · Alt+Enter temp · Esc clear`;
      case "help":
        return `Enter inserts prefix · Esc closes`;
      default:
        return `${n} · ↑↓ navigate · Enter open · Alt+Enter temp · ? modes`;
    }
  }
