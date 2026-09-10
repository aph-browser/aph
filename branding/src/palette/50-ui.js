  function build() {
    overlay = document.createElement("div");
    overlay.id = "aph-palette-overlay";
    overlay.hidden = true;

    const box = document.createElement("div");
    box.id = "aph-palette";

    input = document.createElement("input");
    input.id = "aph-palette-input";
    input.setAttribute("placeholder", PLACEHOLDER);
    input.setAttribute("autocomplete", "off");
    input.setAttribute("spellcheck", "false");
    input.addEventListener("input", () => render(input.value));
    input.addEventListener("keydown", onListKey, true);

    list = document.createElement("div");
    list.id = "aph-palette-list";

    box.appendChild(input);
    box.appendChild(list);
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
    items = allItems(filter);
    selected = 0;
    paint();
  }

  // Highlight matched characters (fuzzy index sets); plain text otherwise.
  function paintText(el, text, set) {
    try {
      if (!set || set.size === 0) {
        el.textContent = text;
        return;
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

  function paint() {
    while (list.firstChild) {
      list.removeChild(list.firstChild);
    }
    items.forEach((it, i) => {
      const row = document.createElement("div");
      row.className = "aph-palette-item" + (i === selected ? " selected" : "");
      const main = document.createElement("span");
      main.className = "aph-palette-title";
      paintText(main, it.title, it._hl && it._hl.t);
      row.appendChild(main);
      if (it.hint) {
        const h = document.createElement("span");
        h.className = "aph-palette-hint";
        paintText(h, it.hint, it._hl && it._hl.h);
        row.appendChild(h);
      }
      if (it.sub) {
        const s = document.createElement("div");
        s.className = "aph-palette-sub";
        paintText(s, it.sub, it._hl && it._hl.s);
        row.appendChild(s);
      }
      row.addEventListener("mousedown", (e) => {
        e.preventDefault();
        selected = i;
        choose();
      });
      row.addEventListener("mousemove", () => {
        if (selected !== i) {
          selected = i;
          paint();
        }
      });
      list.appendChild(row);
    });
    const sel = list.querySelector(".aph-palette-item.selected");
    if (sel) {
      try {
        sel.scrollIntoView({ block: "nearest" });
      } catch (e) {}
    }
  }

