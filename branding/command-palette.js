/* Aph command palette (MVP): Ctrl+K / Cmd+K toggles a filterable overlay.
 * Commands + open tabs in one list. Up/Down + Enter to run, Esc to close.
 * Injected into browser.xhtml via rebrand.py (chrome://browser/content/command-palette.js).
 */
(function () {
  if (window.__aphPaletteLoaded) {
    return;
  }
  window.__aphPaletteLoaded = true;

  let overlay = null;
  let input = null;
  let list = null;
  let items = [];
  let selected = 0;

  function ws() {
    return window.AphWorkspaces || null;
  }

  function commands() {
    const api = ws();
    const cmds = [];
    // Workspaces
    for (let i = 1; i <= 9; i++) {
      const n = String(i);
      cmds.push({
        title: `Switch to Workspace ${n}`,
        hint: `Alt+Shift+${n}`,
        run: () => api && api.switchTo(n),
      });
    }
    for (let i = 1; i <= 9; i++) {
      const n = String(i);
      cmds.push({
        title: `Send Active Tab to Workspace ${n}`,
        hint: `Ctrl+Alt+${n}`,
        run: () => api && api.sendTabTo(n),
      });
    }
    // Tabs / windows
    cmds.push(
      {
        title: "New Tab",
        hint: "Ctrl+T",
        run: () => gBrowser.addTrustedTab("about:newtab"),
      },
      {
        title: "New Temp Container Tab",
        hint: "Ctrl+Alt+T",
        run: () => api && api.openTempTab(),
      },
      {
        title: "Close Current Tab",
        hint: "Ctrl+W",
        run: () => gBrowser.removeCurrentTab(),
      },
      {
        title: "Reopen Closed Tab",
        hint: "Ctrl+Shift+T",
        run: () => {
          try {
            SessionStore.undoCloseTab(window, 0);
          } catch (e) {}
        },
      },
      {
        title: "Duplicate Current Tab",
        hint: "",
        run: () => {
          try {
            gBrowser.duplicateTab(gBrowser.selectedTab);
          } catch (e) {}
        },
      },
      {
        title: "Reload",
        hint: "Ctrl+R",
        run: () => {
          try {
            gBrowser.reload();
          } catch (e) {}
        },
      },
      {
        title: "Go Back",
        hint: "Alt+Left",
        run: () => {
          try {
            gBrowser.goBack();
          } catch (e) {}
        },
      },
      {
        title: "Go Forward",
        hint: "Alt+Right",
        run: () => {
          try {
            gBrowser.goForward();
          } catch (e) {}
        },
      },
      {
        title: "New Window",
        hint: "Ctrl+N",
        run: () => {
          try {
            window.OpenBrowserWindow();
          } catch (e) {}
        },
      },
      {
        title: "Focus Address Bar",
        hint: "Ctrl+L",
        run: () => {
          try {
            gURLBar.focus();
          } catch (e) {}
        },
      }
    );
    return cmds;
  }

  function openTabs() {
    let tabs = [];
    try {
      tabs = Array.from(gBrowser.tabs).filter((t) => !t.closing);
    } catch (e) {
      return [];
    }
    const api = ws();
    return tabs.map((t) => {
      let label = "Untitled";
      try {
        label = t.label || label;
      } catch (e) {}
      let w = "";
      try {
        w = api ? `WS ${api.getWs(t)} · ` : t.hidden ? "hidden · " : "";
      } catch (e) {}
      return {
        title: `Go to Tab: ${label}`,
        sub: `${w}${(()=>{ try { return t.linkedBrowser.currentURI.spec; } catch (e) { return ""; } })()}`,
        hint: t.pinned ? "pinned" : "",
        run: () => {
          try {
            if (t.hidden) {
              gBrowser.showTab(t);
            }
            gBrowser.selectedTab = t;
          } catch (e) {}
        },
      };
    });
  }

  function allItems(filter) {
    const q = (filter || "").trim().toLowerCase();
    const pool = [...commands(), ...openTabs()];
    if (!q) {
      return pool;
    }
    return pool.filter((it) =>
      `${it.title} ${it.sub || ""}`.toLowerCase().includes(q)
    );
  }

  function build() {
    overlay = document.createElement("div");
    overlay.id = "aph-palette-overlay";
    overlay.hidden = true;

    const box = document.createElement("div");
    box.id = "aph-palette";

    input = document.createElement("input");
    input.id = "aph-palette-input";
    input.setAttribute("placeholder", "Type a command or tab…");
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
    items = allItems(filter).slice(0, 50);
    selected = 0;
    paint();
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
      main.textContent = it.title;
      row.appendChild(main);
      if (it.hint) {
        const h = document.createElement("span");
        h.className = "aph-palette-hint";
        h.textContent = it.hint;
        row.appendChild(h);
      }
      if (it.sub) {
        const s = document.createElement("div");
        s.className = "aph-palette-sub";
        s.textContent = it.sub;
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

  function open() {
    if (!overlay) {
      build();
    }
    overlay.hidden = false;
    input.value = "";
    render("");
    setTimeout(() => {
      try {
        input.focus();
      } catch (e) {}
    }, 0);
  }

  function close() {
    if (overlay) {
      overlay.hidden = true;
    }
  }

  function isOpen() {
    return overlay && !overlay.hidden;
  }

  function toggle() {
    if (isOpen()) {
      close();
    } else {
      open();
    }
  }

  function choose() {
    const it = items[selected];
    close();
    if (!it) {
      return;
    }
    try {
      it.run();
    } catch (e) {}
  }

  function onListKey(e) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      e.stopPropagation();
      if (items.length) {
        selected = (selected + 1) % items.length;
        paint();
      }
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      e.stopPropagation();
      if (items.length) {
        selected = (selected - 1 + items.length) % items.length;
        paint();
      }
    } else if (e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      choose();
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close();
    }
  }

  function onKey(e) {
    if (e.repeat) {
      return;
    }
    const mod = e.ctrlKey || e.metaKey;
    // Toggle on Ctrl/⌘+K (hijack Firefox's search-focus binding).
    if (mod && !e.altKey && !e.shiftKey && e.code === "KeyK") {
      e.preventDefault();
      e.stopPropagation();
      toggle();
      return;
    }
    if (!isOpen()) {
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close();
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter") {
      // Input-level handler covers these when focused; this is the fallback.
      onListKey(e);
    }
  }

  window.addEventListener("keydown", onKey, true);

  if (document.readyState === "complete") {
    build();
  } else {
    window.addEventListener("load", build, { once: true });
  }
})();
