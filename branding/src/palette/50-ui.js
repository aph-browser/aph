  function build() {
    overlay = document.createElement("div");
    overlay.id = "aph-palette-overlay";
    overlay.hidden = true;

    const box = document.createElement("div");
    box.id = "aph-palette";
    box.setAttribute("role", "dialog");
    box.setAttribute("aria-label", "Aph command palette");

    input = document.createElement("input");
    input.id = "aph-palette-input";
    input.setAttribute("placeholder", PLACEHOLDER);
    input.setAttribute("autocomplete", "off");
    input.setAttribute("spellcheck", "false");
    input.setAttribute("role", "combobox");
    input.setAttribute("aria-expanded", "true");
    input.setAttribute("aria-controls", "aph-palette-list");
    input.setAttribute("aria-autocomplete", "list");
    input.addEventListener("input", () => render(input.value));
    input.addEventListener("keydown", onListKey, true);

    chipsBar = document.createElement("div");
    chipsBar.id = "aph-palette-chips";
    const chipDefs = [
      ["all", "", "All"],
      ["tabs", "@", "Tabs"],
      ["workspaces", "#", "Workspaces"],
      ["bookmarks", "b:", "Bookmarks"],
      ["history", "h:", "History"],
      ["commands", ">", "Commands"],
    ];
    for (const [mKey, prefix, label] of chipDefs) {
      const chip = document.createElement("button");
      chip.className = "aph-palette-chip";
      chip.setAttribute("type", "button");
      chip.setAttribute("data-mode", mKey);
      chip.setAttribute("data-prefix", prefix);
      chip.textContent = label;
      chip.addEventListener("mousedown", (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (typeof setPaletteMode === "function") {
          setPaletteMode(prefix);
        }
      });
      chipsBar.appendChild(chip);
    }

    list = document.createElement("div");
    list.id = "aph-palette-list";
    list.setAttribute("role", "listbox");
    list.setAttribute("aria-label", "Results");

    footer = document.createElement("div");
    footer.id = "aph-palette-footer";

    box.appendChild(input);
    box.appendChild(chipsBar);
    box.appendChild(list);
    box.appendChild(footer);
    overlay.appendChild(box);
    overlay.addEventListener("mousedown", (e) => {
      if (e.target === overlay) {
        close();
      }
    });
    // Chrome document root (browser.xhtml): body may not exist yet.
    (document.body || document.documentElement).appendChild(overlay);
  }

  function render(filter) {
    if (iconPick) {
      items =
        typeof iconRows === "function" ? iconRows(ws(), iconPick.ws, filter) : [];
      selected = 0;
      paint();
      return;
    }
    if (prompt) {
      items = [
        {
          title: prompt.title,
          sub: "Empty clears back to “Workspace N”",
          hint: "Enter saves · Esc cancels",
        },
      ];
      selected = 0;
      paint();
      return;
    }
    if (viewStack.length > 0) {
      const top = viewStack[viewStack.length - 1];
      const q = (filter || "").trim();
      const pool = typeof top.items === "function" ? top.items(q) : [];
      items = q && !top.rawItems
        ? scoreAndGroup(pool, q)
        : pool.map((it) => {
            it._hl = it._hl || { t: new Set(), s: new Set(), h: new Set() };
            return it;
          });
      selected = 0;
      paint();
      try {
        if (input && top.placeholder) {
          input.setAttribute("placeholder", top.placeholder);
        }
        if (typeof top.onPreview === "function") {
          top.onPreview(items[selected] || null);
        }
      } catch (_e) {}
      return;
    }
    items = allItems(filter);
    selected = 0;
    paint();
  }

  // Highlight matched characters (fuzzy index sets); plain text otherwise.
  // Must clear first: pooled rows are reconfigured in place, so leftover
  // marks/text from the previous render would concatenate (garbled rows).
  function paintText(el, text, set) {
    try {
      if (!set || set.size === 0) {
        el.textContent = text;
        return;
      }
      while (el.firstChild) {
        el.removeChild(el.firstChild);
      }
      let buf = "";
      let cur = null;
      const flush = () => {
        if (!buf) {
          return;
        }
        if (cur) {
          const mark = document.createElement("span");
          mark.className = "aph-palette-mark";
          mark.textContent = buf;
          el.appendChild(mark);
        } else {
          el.appendChild(document.createTextNode(buf));
        }
        buf = "";
      };
      for (let i = 0; i < text.length; i++) {
        const m = set.has(i);
        if (cur === null) {
          cur = m;
        } else if (m !== cur) {
          flush();
          cur = m;
        }
        buf += text[i];
      }
      flush();
    } catch (e) {
      try {
        el.textContent = text;
      } catch (_e) {}
    }
  }

  function emptyMessage(mode, q) {
    if (mode === "tabs") {
      return q ? `No tabs match “${q}”` : "No open tabs";
    }
    if (mode === "commands") {
      return `No commands match “${q}” — try @ for tabs, ? for modes`;
    }
    if (mode === "workspaces") {
      return `No workspace rows match “${q}”`;
    }
    if (mode === "bookmarks") {
      return q.length < 2 ? "Type 2+ characters to search bookmarks" : `No bookmarks match “${q}”`;
    }
    if (mode === "history") {
      return q.length < 2 ? "Type 2+ characters to search history" : `No history matches “${q}”`;
    }
    const engine = typeof searchEngineName === "function" ? searchEngineName() : "DuckDuckGo";
    return `No results for “${q}” — Enter searches ${engine}`;
  }

  // Letter avatar for tabs without a favicon: first alnum character of
  // the title, tinted by a stable hash so each site is recognizable.
  function avatarLetter(it) {
    try {
      const s = String((it && it.title) || "").trim();
      for (const ch of s) {
        if (/[a-zA-Z0-9]/.test(ch)) {
          return ch.toUpperCase();
        }
      }
      const u = String((it && it.sub) || "");
      const m = u.match(/:\/\/([^/:?#.]+)/);
      if (m && m[1]) {
        return m[1][0].toUpperCase();
      }
    } catch (e) {}
    return "";
  }

  function avatarHue(it) {
    try {
      const s = String((it && it.sub) || it.title || "");
      let h = 0;
      for (let i = 0; i < s.length; i++) {
        h = (h * 31 + s.charCodeAt(i)) % 360;
      }
      return h;
    } catch (e) {
      return 210;
    }
  }

  // Pooled row: fixed children created once, reconfigured per paint.
  // Listeners attach once and read row._aph.index (updated per render).
  function makeRow() {
    const row = document.createElement("div");
    row.className = "aph-palette-item";
    row.setAttribute("role", "option");
    row.setAttribute("aria-selected", "false");
    const img = document.createElement("img");
    img.className = "aph-palette-icon-img";
    img.setAttribute("alt", "");
    img.setAttribute("draggable", "false");
    const ic = document.createElement("span");
    ic.className = "aph-palette-icon";
    const body = document.createElement("div");
    body.className = "aph-palette-body";
    const main = document.createElement("span");
    main.className = "aph-palette-title";
    const hint = document.createElement("span");
    hint.className = "aph-palette-hint";
    const sub = document.createElement("div");
    sub.className = "aph-palette-sub";
    const actions = document.createElement("span");
    actions.className = "aph-palette-row-actions";
    const moveBtn = document.createElement("button");
    moveBtn.className = "aph-palette-row-act";
    moveBtn.setAttribute("type", "button");
    moveBtn.setAttribute("title", "Move to workspace");
    moveBtn.textContent = "→";
    const closeBtn = document.createElement("button");
    closeBtn.className = "aph-palette-row-act";
    closeBtn.setAttribute("type", "button");
    closeBtn.setAttribute("title", "Close tab");
    closeBtn.textContent = "×";
    actions.appendChild(moveBtn);
    actions.appendChild(closeBtn);
    const key = document.createElement("span");
    key.className = "aph-palette-key";
    body.appendChild(main);
    body.appendChild(hint);
    body.appendChild(sub);
    row.appendChild(img);
    row.appendChild(ic);
    row.appendChild(body);
    row.appendChild(actions);
    row.appendChild(key);
    row._aph = { img, ic, main, hint, sub, actions, moveBtn, closeBtn, key, index: -1 };
    moveBtn.addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const it = items[row._aph.index];
      if (it && typeof pushView === "function" && typeof rowActionsView === "function") {
        pushView(rowActionsView(it));
      }
    });
    closeBtn.addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const it = items[row._aph.index];
      if (it && typeof closeRowTab === "function") {
        closeRowTab(it);
      }
    });
    row.addEventListener("mousedown", (e) => {
      e.preventDefault();
      selected = row._aph.index;
      choose();
    });
    row.addEventListener("mousemove", () => {
      if (selected !== row._aph.index) {
        selected = row._aph.index;
        paint();
      }
    });
    return row;
  }

  function configureRow(row, it, i) {
    const R = row._aph;
    R.index = i;
    const sel = i === selected;
    row.id = `aph-palette-row-${i}`;
    row.className = "aph-palette-item" + (sel ? " selected" : "");
    row.setAttribute("aria-selected", sel ? "true" : "false");
    // Icon slot: vendored workspace mark wins, else favicon img, else
    // tab letter avatar, else glyph. Pooled rows are reconfigured in
    // place — clear the mark slot first so a reused row never stacks
    // an old svg under new content.
    try {
      if (it && it.iconSVG) {
        let svg = null;
        try {
          const api = ws();
          svg = api && api.wsIconSvg ? api.wsIconSvg(it.iconSVG, 14) : null;
        } catch (_e) {}
        R.img.hidden = true;
        while (R.ic.firstChild) {
          R.ic.removeChild(R.ic.firstChild);
        }
        R.ic.className = "aph-palette-icon";
        try {
          R.ic.style.background = "";
        } catch (_e) {}
        if (svg) {
          R.ic.hidden = false;
          R.ic.appendChild(svg);
        } else {
          R.ic.hidden = false;
          R.ic.textContent = "⬢";
        }
      } else if (it && it.iconURL) {
        R.img.setAttribute("src", it.iconURL);
        R.img.hidden = false;
        R.ic.hidden = true;
      } else {
        R.img.hidden = true;
        let glyph = "";
        let avatar = false;
        try {
          if (it && it.kind === "tab") {
            const letter = avatarLetter(it);
            if (letter) {
              glyph = letter;
              avatar = true;
            }
          }
          if (!glyph) {
            glyph = (it && it.icon) || "";
          }
        } catch (_e) {}
        if (glyph) {
          R.ic.hidden = false;
          R.ic.textContent = glyph;
          R.ic.className = "aph-palette-icon" + (avatar ? " aph-palette-avatar" : "");
          try {
            R.ic.style.background = avatar ? `hsl(${avatarHue(it)} 45% 35% / 0.55)` : "";
          } catch (_e) {}
        } else {
          R.ic.hidden = true;
        }
      }
    } catch (e) {}
    try {
      paintText(R.main, it.title, it._hl && it._hl.t);
    } catch (e) {}
    try {
      if (it.hint) {
        R.hint.hidden = false;
        R.hint.className = "aph-palette-hint" + (it.wsId ? " aph-palette-ws-badge" : "");
        if (it.wsId) {
          R.hint.setAttribute("data-ws", String(it.wsId));
        } else {
          R.hint.removeAttribute("data-ws");
        }
        paintText(R.hint, it.hint, it._hl && it._hl.h);
      } else {
        R.hint.hidden = true;
        R.hint.className = "aph-palette-hint";
        R.hint.removeAttribute("data-ws");
        R.hint.textContent = "";
      }
    } catch (e) {}
    try {
      if (it.sub) {
        R.sub.hidden = false;
        // Clean display for bare-URL subs (tabs, bookmarks, copy rows) —
        // but only when no sub-highlight is active, so fuzzy marks always
        // align with the raw text they were computed on.
        const hl = it._hl && it._hl.s;
        const hasHl = !!(hl && hl.size);
        if (
          !hasHl &&
          typeof displayURL === "function" &&
          /^https?:\/\//i.test(String(it.sub).trim()) &&
          !/\s/.test(String(it.sub).trim())
        ) {
          paintText(R.sub, displayURL(it.sub), new Set());
        } else {
          paintText(R.sub, it.sub, hl);
        }
      } else {
        R.sub.hidden = true;
        R.sub.textContent = "";
      }
    } catch (e) {}
    // Inline tab quick-actions (→ actions, × close) on tab rows.
    try {
      if (R.actions) {
        R.actions.hidden = !(it && it.kind === "tab" && it.tabRef);
      }
    } catch (_e) {}
    // Alt+1–9 quick-pick badge on the first nine rows (right anchor).
    try {
      if (i < 9 && items.length > 1) {
        R.key.hidden = false;
        R.key.textContent = `⌥${i + 1}`;
      } else {
        R.key.hidden = true;
      }
    } catch (e) {}
  }

  function paint() {
    // Detach current children without destroying them — pooled rows and
    // headers are re-appended below, so no element is recreated.
    while (list.firstChild) {
      list.removeChild(list.firstChild);
    }
    let mode = "all";
    let q = "";
    try {
      const v = (input && input.value) || "";
      if (typeof parseMode === "function") {
        const p = parseMode(v);
        mode = p.mode || "all";
        q = p.q || "";
      } else {
        q = (v || "").trim();
      }
    } catch (e) {}
    // Per-mode placeholder + mode chips bar.
    try {
      if (input && typeof placeholderFor === "function") {
        input.setAttribute("placeholder", placeholderFor(mode));
      }
      if (chipsBar) {
        chipsBar.hidden = !!(iconPick || prompt || viewStack.length);
        const children = chipsBar.children || [];
        for (const ch of Array.from(children)) {
          const active = ch.getAttribute && ch.getAttribute("data-mode") === mode;
          if (ch.classList) {
            if (active) ch.classList.add("active");
            else ch.classList.remove("active");
          }
          if (ch.setAttribute) {
            ch.setAttribute("aria-pressed", active ? "true" : "false");
          }
        }
      }
    } catch (e) {}
    // Grow pools (never shrink); excess rows simply aren't re-appended.
    try {
      while (rowPool.length < items.length) {
        rowPool.push(makeRow());
      }
    } catch (e) {}
    if (!items.length) {
      try {
        if (!emptyEl) {
          emptyEl = document.createElement("div");
          emptyEl.className = "aph-palette-empty";
        }
        emptyEl.textContent = emptyMessage(mode, q || "");
        list.appendChild(emptyEl);
      } catch (e) {}
    } else {
      const frag = document.createDocumentFragment
        ? document.createDocumentFragment()
        : null;
      const target = frag || list;
      // Count sections first so the header pool is exactly sized.
      let sections = 0;
      let prev = null;
      for (const it of items) {
        const sec = (it && it.section) || "";
        if (sec && sec !== prev) {
          prev = sec;
          sections++;
        }
      }
      try {
        while (headerPool.length < sections) {
          const h = document.createElement("div");
          h.className = "aph-palette-section";
          headerPool.push(h);
        }
      } catch (e) {}
      let lastSection = null;
      let hi = 0;
      let selEl = null;
      items.forEach((it, i) => {
        const sec = (it && it.section) || "";
        if (sec && sec !== lastSection) {
          lastSection = sec;
          try {
            const h = headerPool[hi++];
            h.textContent = sec;
            target.appendChild(h);
          } catch (e) {}
        }
        try {
          const row = rowPool[i];
          configureRow(row, it, i);
          target.appendChild(row);
          if (i === selected) {
            selEl = row;
          }
        } catch (e) {}
      });
      if (frag) {
        list.appendChild(frag);
      }
      if (selEl) {
        try {
          // Instant scroll by design (no behavior:smooth) — safe under
          // reduced-motion, explicit so a future smooth never slips in.
          selEl.scrollIntoView({ block: "nearest", behavior: "auto" });
        } catch (e) {}
      }
    }
    try {
      if (input) {
        input.setAttribute("aria-activedescendant", `aph-palette-row-${selected}`);
      }
    } catch (e) {}
    try {
      if (footer && typeof footerHintFor === "function") {
        const cur = items[selected];
        if (viewStack.length > 0) {
          footer.textContent = "↵ Select · ⌫/Esc Back · ↑↓ Navigate";
        } else if (cur && cur.kind === "tab" && cur.tabRef) {
          footer.textContent = "↵ Switch · ⌃W Close · ⌃↵ Actions · Alt+←/→ Mode";
        } else if (cur && (cur.kind === "go" || cur.kind === "bookmark" || cur.kind === "history")) {
          footer.textContent = "↵ Open · ⌥↵ Temp Container · ⌃↵ Actions";
        } else if (cur && cur.keepOpen) {
          footer.textContent = "↵ Open Picker · ↑↓ Navigate";
        } else {
          footer.textContent = footerHintFor(mode, items.length);
        }
      }
    } catch (e) {}
  }

