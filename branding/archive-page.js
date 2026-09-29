/* Aph archive page — runs inside aph-archive.html (chrome:// page in a tab).
 *
 * System-principal chrome pages can use Services directly (same precedent
 * as about:config), so listing/deleting read and write the archive pref
 * here. Restores need the owning chrome window (gBrowser lives there), so
 * they go through the "aph-archive-restore" observer topic with the page's
 * own browsing-context id for routing; the owner answers on
 * "aph-archive-result". Classic script, external file only (no inline
 * scripts — chrome pages may enforce script-src restrictions).
 */
(function () {
  const PREF = "aph.archive.tabs";
  const NAMES_PREF = "aph.workspaces.names";
  const OBS_RESTORE = "aph-archive-restore";
  const OBS_RESULT = "aph-archive-result";
  const TOAST_MS = 2400;

  let bridge = false;
  let contextId = 0;
  let query = "";
  let pill = "all";
  let sortMode = "newest";
  let selectedIds = null;
  let toastTimer = null;

  try {
    selectedIds = new Set();
  } catch (e) {
    selectedIds = { has: () => false, add: () => {}, delete: () => {}, clear: () => {}, get size() { return 0; } };
  }

  function L() {
    try {
      return window.AphArchiveLogic || null;
    } catch (e) {
      return null;
    }
  }

  function $(id) {
    try {
      return document.getElementById(id);
    } catch (e) {
      return null;
    }
  }

  function readEntries() {
    try {
      const raw = Services.prefs.getStringPref(PREF, "");
      if (!raw) {
        return [];
      }
      const l = L();
      return l ? l.sanitizeEntries(JSON.parse(raw)) : [];
    } catch (e) {
      return [];
    }
  }

  function writeEntries(list) {
    try {
      Services.prefs.setStringPref(PREF, JSON.stringify(list));
    } catch (e) {}
  }

  function readNames() {
    try {
      const raw = Services.prefs.getStringPref(NAMES_PREF, "");
      return raw ? JSON.parse(raw) : {};
    } catch (e) {
      return {};
    }
  }

  // The page's own browsing-context id, so exactly one window (the owner)
  // acts on our restore requests no matter how many windows are open.
  function detectBridge() {
    try {
      const wgc = window.windowGlobalChild;
      if (wgc && wgc.browsingContext) {
        contextId = wgc.browsingContext.id || 0;
      }
    } catch (e) {
      contextId = 0;
    }
    try {
      bridge =
        contextId > 0 &&
        !!Services &&
        !!Services.obs &&
        typeof Services.obs.notifyObservers === "function";
    } catch (e) {
      bridge = false;
    }
    try {
      const nb = $("aph-archive-nobridge");
      if (nb) {
        nb.hidden = bridge;
        if (!bridge && !nb.querySelector("button")) {
          try {
            nb.textContent = "Archive bridge unavailable — restores are disabled. ";
            const btn = document.createElement("button");
            btn.type = "button";
            btn.textContent = "Retry";
            btn.addEventListener("click", () => {
              detectBridge();
              if (bridge) {
                toast("Bridge restored");
              } else {
                toast("Still unavailable — reload this page");
              }
            });
            nb.appendChild(btn);
          } catch (_e) {}
        }
      }
    } catch (e) {}
  }

  function toast(msg) {
    try {
      const el = $("aph-archive-toast");
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
      }, TOAST_MS);
    } catch (e) {}
  }

  function requestRestore(id, keep) {
    if (!bridge) {
      toast("Restore unavailable — reload this page");
      return;
    }
    try {
      Services.obs.notifyObservers(
        null,
        OBS_RESTORE,
        JSON.stringify({ contextId, id, keep: !!keep })
      );
    } catch (e) {
      toast("Restore failed");
    }
  }

  function deleteEntry(id) {
    try {
      const rest = readEntries().filter((e) => e && e.id !== id);
      writeEntries(rest);
      try {
        selectedIds.delete(id);
      } catch (e) {}
      render();
      toast("Deleted");
    } catch (e) {}
  }

  function paintText(el, text, indices) {
    try {
      if (!indices || !indices.length) {
        el.textContent = text;
        return;
      }
      const set = new Set(indices);
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
          mark.className = "aph-archive-mark";
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

  function titleIndices(entry) {
    try {
      const l = L();
      const q = String(query || "").trim();
      if (!l || !l.fuzzyEntry || !q) {
        return [];
      }
      const m = l.fuzzyEntry(q.split(/\s+/)[0] || "", entry.title || "");
      return (m && m.indices) || [];
    } catch (e) {
      return [];
    }
  }

  function initialOf(entry) {
    try {
      const t = (entry.title || entry.host || "?").trim();
      return (t[0] || "?").toUpperCase();
    } catch (e) {
      return "?";
    }
  }

  function favIcon(entry, box) {
    const src = entry.favicon;
    if (src && /^https?:|^data:image\//i.test(src)) {
      try {
        const img = document.createElement("img");
        img.alt = "";
        img.src = src;
        img.addEventListener("error", () => {
          try {
            box.textContent = initialOf(entry);
          } catch (e) {}
        });
        box.appendChild(img);
        return;
      } catch (e) {}
    }
    try {
      box.textContent = initialOf(entry);
    } catch (e) {}
  }

  function wsTag(entry, names) {
    try {
      const n = names[entry.ws];
      return n ? `WS ${entry.ws} · ${n}` : `WS ${entry.ws}`;
    } catch (e) {
      return `WS ${entry.ws}`;
    }
  }

  function makeRow(entry, names) {
    const row = document.createElement("div");
    row.className = "aph-archive-row" + (selectedIds.has(entry.id) ? " selected" : "");
    row.setAttribute("role", "button");
    row.setAttribute("tabindex", "0");
    row.setAttribute("aria-selected", selectedIds.has(entry.id) ? "true" : "false");

    const check = document.createElement("input");
    check.type = "checkbox";
    check.className = "aph-archive-check";
    check.checked = selectedIds.has(entry.id);
    check.setAttribute("aria-label", `Select ${entry.title || entry.url}`);
    check.addEventListener("click", (ev) => {
      try {
        ev.stopPropagation();
      } catch (e) {}
      try {
        if (check.checked) {
          selectedIds.add(entry.id);
        } else {
          selectedIds.delete(entry.id);
        }
      } catch (e) {}
      render();
    });
    row.appendChild(check);

    const fav = document.createElement("div");
    fav.className = "aph-archive-fav";
    favIcon(entry, fav);
    row.appendChild(fav);

    const main = document.createElement("div");
    main.className = "aph-archive-main";
    const title = document.createElement("div");
    title.className = "aph-archive-title";
    paintText(title, entry.title || entry.url, titleIndices(entry));
    title.title = entry.url || "";
    main.appendChild(title);
    const dom = document.createElement("div");
    dom.className = "aph-archive-domain";
    dom.textContent = entry.host || entry.url;
    main.appendChild(dom);
    row.appendChild(main);

    const tags = document.createElement("div");
    tags.className = "aph-archive-tags";
    const wtag = document.createElement("span");
    wtag.className = "aph-archive-tag";
    wtag.textContent = wsTag(entry, names);
    tags.appendChild(wtag);
    if (entry.cname) {
      const ctag = document.createElement("span");
      ctag.className = "aph-archive-tag";
      ctag.textContent = entry.cname;
      tags.appendChild(ctag);
    }
    row.appendChild(tags);

    const del = document.createElement("button");
    del.className = "aph-archive-del";
    del.textContent = "✕";
    del.title = "Delete (no restore)";
    del.setAttribute("aria-label", `Delete ${entry.title || entry.url}`);
    del.addEventListener("click", (ev) => {
      try {
        ev.stopPropagation();
      } catch (e) {}
      deleteEntry(entry.id);
    });
    row.appendChild(del);

    const go = (keep) => requestRestore(entry.id, keep);
    row.addEventListener("click", (ev) => {
      try {
        // Checkbox clicks already handled; row click restores.
        if (ev.target === check) {
          return;
        }
        go(!!ev.shiftKey);
      } catch (e) {}
    });
    row.addEventListener("keydown", (ev) => {
      try {
        if (ev.key === "Enter") {
          go(!!ev.shiftKey);
        } else if (ev.key === "Delete" || ev.key === "Backspace") {
          deleteEntry(entry.id);
        } else if (ev.key === " ") {
          ev.preventDefault();
          if (selectedIds.has(entry.id)) {
            selectedIds.delete(entry.id);
          } else {
            selectedIds.add(entry.id);
          }
          render();
        }
      } catch (e) {}
    });
    return row;
  }

  function renderPills(entries, names) {
    const bar = $("aph-archive-pills");
    if (!bar) {
      return;
    }
    while (bar.firstChild) {
      bar.removeChild(bar.firstChild);
    }
    const present = [];
    try {
      const seen = new Set();
      for (const e of entries) {
        if (e && /^[1-9]$/.test(e.ws) && !seen.has(e.ws)) {
          seen.add(e.ws);
          present.push(e.ws);
        }
      }
      present.sort();
    } catch (e) {}
    const mk = (value, label) => {
      const b = document.createElement("button");
      b.className = "aph-archive-pill" + (pill === value ? " on" : "");
      // Workspace identity for paint: archive.css tints [data-ws] pills
      // with their own hue when active (dock parity). No bridge needed —
      // the value IS the workspace id.
      try {
        if (/^[1-9]$/.test(value)) {
          b.setAttribute("data-ws", value);
        }
      } catch (e) {}
      b.textContent = label;
      b.addEventListener("click", () => {
        pill = value;
        render();
      });
      bar.appendChild(b);
    };
    mk("all", "All");
    for (const w of present) {
      let label = `WS ${w}`;
      try {
        if (names[w]) {
          label = `WS ${w} · ${names[w]}`;
        }
      } catch (e) {}
      mk(w, label);
    }
  }

  function render() {
    const l = L();
    const names = readNames();
    let entries = readEntries();
    const total = entries.length;
    const count = $("aph-archive-count");
    if (count) {
      try {
        count.textContent = total ? `${total}/300` : "";
      } catch (e) {}
    }
    renderPills(entries, names);
    if (pill !== "all") {
      entries = entries.filter((e) => e && e.ws === pill);
    }
    // Fuzzy filter (relevance-sorted) when available; legacy substring
    // AND otherwise. Either way the result then sorts by sortMode.
    let scored = null;
    try {
      if (l && l.fuzzyFilter) {
        scored = l.fuzzyFilter(entries, query, names);
        entries = scored.map((s) => s.entry);
      } else if (l) {
        entries = l.filterEntries(entries, query, names);
      }
    } catch (e) {
      entries = l ? l.filterEntries(entries, query, names) : entries;
    }
    try {
      if (l && l.sortEntries) {
        // Keep fuzzy relevance when searching; sortMode wins when idle.
        if (!String(query || "").trim()) {
          entries = l.sortEntries(entries, sortMode);
        }
      } else if (sortMode === "oldest") {
        entries = entries.slice().sort((a, b) => (a.ts || 0) - (b.ts || 0));
      } else if (sortMode === "site") {
        entries = entries.slice().sort((a, b) => String(a.host || "").localeCompare(String(b.host || "")));
      }
    } catch (e) {}
    updateBulkbar(total);
    const list = $("aph-archive-list");
    if (!list) {
      return;
    }
    while (list.firstChild) {
      list.removeChild(list.firstChild);
    }
    const empty = $("aph-archive-empty");
    const groups = l ? l.groupByDate(entries) : [{ key: "all", label: "", items: entries }];
    if (empty) {
      try {
        empty.hidden = entries.length > 0;
        if (!entries.length) {
          empty.textContent = query || pill !== "all"
            ? "No archived tabs match."
            : "No archived tabs yet. Archive one from the tab menu or the palette.";
        }
      } catch (e) {}
    }
    for (const g of groups) {
      const wrap = document.createElement("section");
      wrap.className = "aph-archive-group";
      if (g.label) {
        const h = document.createElement("h2");
        h.textContent = g.label;
        wrap.appendChild(h);
      }
      for (const e of g.items) {
        try {
          wrap.appendChild(makeRow(e, names));
        } catch (err) {}
      }
      list.appendChild(wrap);
    }
  }

  function updateBulkbar(total) {
    try {
      const bar = $("aph-archive-bulkbar");
      const cnt = $("aph-archive-bulkcount");
      if (!bar || !cnt) {
        return;
      }
      const n = selectedIds.size || 0;
      bar.hidden = n === 0;
      cnt.textContent = n ? `${n} selected` : "";
    } catch (e) {}
  }

  function bulkDelete() {
    try {
      if (!selectedIds.size) {
        return;
      }
      const ids = new Set(selectedIds);
      const rest = readEntries().filter((e) => e && !ids.has(e.id));
      writeEntries(rest);
      selectedIds.clear();
      render();
      toast("Deleted selected");
    } catch (e) {}
  }

  function bulkRestore() {
    try {
      if (!selectedIds.size) {
        return;
      }
      const ids = Array.from(selectedIds);
      let i = 0;
      const next = () => {
        if (i >= ids.length) {
          return;
        }
        const id = ids[i++];
        requestRestore(id, true);
        // Stagger restores so the owner window processes them in order.
        setTimeout(next, 120);
      };
      next();
      toast(`Restoring ${ids.length}…`);
    } catch (e) {}
  }

  function init() {
    detectBridge();
    // Owner-window answers to our restore requests (matched by contextId).
    try {
      Services.obs.addObserver(
        {
          observe(subj, topic, data) {
            try {
              if (topic !== OBS_RESULT) {
                return;
              }
              const msg = JSON.parse(data);
              if (!msg || msg.contextId !== contextId) {
                return;
              }
              if (msg.ok) {
                render();
              } else {
                toast(msg.reason === "missing" ? "Already gone" : "Restore failed");
                render();
              }
            } catch (e) {}
          },
        },
        OBS_RESULT,
        false
      );
    } catch (e) {}
    // Re-render on store changes from any window (and our own deletes).
    try {
      Services.prefs.addObserver(
        {
          observe(subj, topic) {
            try {
              if (!topic || topic === PREF) {
                render();
              }
            } catch (e) {}
          },
        },
        PREF,
        false
      );
    } catch (e) {}
    try {
      const s = $("aph-archive-search");
      if (s) {
        s.addEventListener("input", () => {
          try {
            query = s.value;
          } catch (e) {
            query = "";
          }
          render();
          // Keep focus where the user is typing across re-renders.
          try {
            s.focus();
          } catch (e) {}
        });
        document.addEventListener("keydown", (ev) => {
          try {
            if (ev.key === "/" && document.activeElement !== s) {
              ev.preventDefault();
              s.focus();
            }
          } catch (e) {}
        });
      }
    } catch (e) {}
    try {
      const sort = $("aph-archive-sort");
      if (sort) {
        sort.value = sortMode;
        sort.addEventListener("change", () => {
          try {
            sortMode = sort.value || "newest";
          } catch (e) {
            sortMode = "newest";
          }
          render();
        });
      }
    } catch (e) {}
    try {
      const bd = $("aph-archive-bulk-delete");
      if (bd) {
        bd.addEventListener("click", bulkDelete);
      }
      const br = $("aph-archive-bulk-restore");
      if (br) {
        br.addEventListener("click", bulkRestore);
      }
      const bc = $("aph-archive-bulk-clear");
      if (bc) {
        bc.addEventListener("click", () => {
          try {
            selectedIds.clear();
          } catch (e) {}
          render();
        });
      }
    } catch (e) {}
    try {
      document.addEventListener("visibilitychange", () => {
        try {
          if (!document.hidden) {
            render();
          }
        } catch (e) {}
      });
    } catch (e) {}
    render();
    try {
      const s = $("aph-archive-search");
      if (s && s.focus) {
        s.focus();
      }
    } catch (e) {}
  }

  if (document.readyState === "complete" || document.readyState === "interactive") {
    init();
  } else {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  }
})();
