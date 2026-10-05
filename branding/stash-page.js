/* Aph Stash page — runs inside aph-stash.html (chrome:// page in a tab).
 *
 * Two views over one idea:
 *   - Stashed tabs: individual swept tabs (aph.stash.tabs pref).
 *   - Workspace stashes: whole-workspace snapshots (aph.stash.snapshots pref),
 *     restored append-only.
 *
 * System-principal chrome pages can use Services directly (same precedent
 * as about:config), so listing/deleting read and write the prefs here.
 * Restores need the owning chrome window (gBrowser lives there), so they
 * go through the "aph-stash-restore" observer topic with the page's own
 * browsing-context id for routing; the owner answers on "aph-stash-result".
 * Classic script, external file only (no inline scripts — chrome pages
 * may enforce script-src restrictions).
 */
(function () {
  const PREF = "aph.stash.tabs";
  const NAMES_PREF = "aph.workspaces.names";
  const SNAP_PREF = "aph.stash.snapshots";
  // Pre-rename keys: read-once fallback so profiles that stashed under
  // the old names still list (the window controller adopts forward).
  const OLD_PREF = "aph.archive.tabs";
  const OLD_SNAP_PREF = "aph.snapshots";
  const OBS_RESTORE = "aph-stash-restore";
  const OBS_RESULT = "aph-stash-result";
  const TOAST_MS = 2400;

  let bridge = false;
  let contextId = 0;
  let query = "";
  let pill = "all";
  let sortMode = "newest";
  let view = "tabs"; // "tabs" | "stashes"
  let selectedIds = null;
  let expandedIds = null;
  let toastTimer = null;

  try {
    selectedIds = new Set();
  } catch (e) {
    selectedIds = { has: () => false, add: () => {}, delete: () => {}, clear: () => {}, get size() { return 0; } };
  }

  try {
    expandedIds = new Set();
  } catch (e) {
    expandedIds = { has: () => false, add: () => {}, delete: () => {}, clear: () => {}, get size() { return 0; } };
  }

  function L() {
    try {
      return window.AphStashLogic || null;
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
      let raw = "";
      try {
        raw = Services.prefs.getStringPref(PREF, "") || "";
      } catch (e) {
        raw = "";
      }
      if (!raw) {
        try {
          raw = Services.prefs.getStringPref(OLD_PREF, "") || "";
        } catch (e) {
          raw = "";
        }
      }
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
    try {
      if (Services.prefs && typeof Services.prefs.clearUserPref === "function") {
        Services.prefs.clearUserPref(OLD_PREF);
      }
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

  // Workspace stashes (snapshots) live in their own pref; same
  // sanitize-on-read discipline as the per-tab store.
  function readStashes() {
    try {
      let raw = "";
      try {
        raw = Services.prefs.getStringPref(SNAP_PREF, "") || "";
      } catch (e) {
        raw = "";
      }
      if (!raw) {
        try {
          raw = Services.prefs.getStringPref(OLD_SNAP_PREF, "") || "";
        } catch (e) {
          raw = "";
        }
      }
      if (!raw) {
        return [];
      }
      const l = L();
      return l ? l.sanitizeSnapshots(JSON.parse(raw)) : [];
    } catch (e) {
      return [];
    }
  }

  function writeStashes(list) {
    try {
      Services.prefs.setStringPref(SNAP_PREF, JSON.stringify(list));
    } catch (e) {}
    try {
      if (Services.prefs && typeof Services.prefs.clearUserPref === "function") {
        Services.prefs.clearUserPref(OLD_SNAP_PREF);
      }
    } catch (e) {}
  }

  function deleteStash(id) {
    try {
      writeStashes(readStashes().filter((s) => s && s.id !== id));
      render();
      toast("Deleted stash");
    } catch (e) {}
  }

  // Inline rename (same trim + 80-char rules as the controller's
  // renameStash; blank cancels and the old name stands).
  function commitStashRename(id, name) {
    try {
      const clean = String(name == null ? "" : name).trim().slice(0, 80);
      if (!clean) {
        return false;
      }
      const list = readStashes();
      const entry = list.find((s) => s && s.id === id);
      if (!entry || entry.name === clean) {
        return false;
      }
      entry.name = clean;
      writeStashes(list);
      return true;
    } catch (e) {
      return false;
    }
  }

  function startStashRename(wrap, snap) {
    try {
      // First .aph-stash-title in the wrapper is the header name (member
      // rows sort after it in document order).
      const nameEl = wrap && wrap.querySelector
        ? wrap.querySelector(".aph-stash-title")
        : null;
      if (!nameEl || !nameEl.parentNode || !snap) {
        return;
      }
      const input = document.createElement("input");
      input.type = "text";
      input.className = "aph-stash-card-rename";
      input.value = snap.name || "";
      input.setAttribute("aria-label", "Rename stash");
      input.maxLength = 80;
      let done = false;
      const cancel = () => {
        if (done) {
          return;
        }
        done = true;
        render();
      };
      const commit = () => {
        if (done) {
          return;
        }
        done = true;
        if (commitStashRename(snap.id, input.value)) {
          render();
          toast("Renamed");
        } else {
          render();
        }
      };
      input.addEventListener("keydown", (ev) => {
        try {
          if (ev.key === "Enter") {
            ev.preventDefault();
            commit();
          } else if (ev.key === "Escape") {
            ev.preventDefault();
            cancel();
          } else if (ev.key === " " && ev.target !== input) {
            ev.preventDefault();
          }
        } catch (e) {}
      });
      // Blur commits (clicking elsewhere keeps the edit); guarded so a
      // blur right after Enter can't double-commit.
      input.addEventListener("blur", commit);
      nameEl.parentNode.replaceChild(input, nameEl);
      try {
        input.focus();
        input.select();
      } catch (e) {}
    } catch (e) {}
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
      const nb = $("aph-stash-nobridge");
      if (nb) {
        nb.hidden = bridge;
        if (!bridge && !nb.querySelector("button")) {
          try {
            nb.textContent = "Stash bridge unavailable — restores are disabled. ";
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
      const el = $("aph-stash-toast");
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

  function requestRestore(id, keep, kind, extra) {
    if (!bridge) {
      toast("Restore unavailable — reload this page");
      return;
    }
    try {
      const msg = { contextId, id, keep: !!keep, kind };
      try {
        if (extra && typeof extra.url === "string" && extra.url) {
          msg.url = extra.url;
        }
      } catch (e) {}
      Services.obs.notifyObservers(null, OBS_RESTORE, JSON.stringify(msg));
    } catch (e) {
      toast("Restore failed");
    }
  }

  // One-line summary for a finished restore (whole snapshot or one
  // tab) or an in-place update: opened count first, then residuals.
  function restoreResultText(msg) {
    try {
      const opened = Number(msg.opened) || 0;
      const skipped = Number(msg.skipped) || 0;
      const unbound = Number(msg.unbound) || 0;
      if (msg.kind === "stash-tab") {
        return msg.ok ? "Tab restored" : null;
      }
      if (msg.kind === "stash-update") {
        if (!msg.ok) {
          return null;
        }
        const n = Number(msg.count) || 0;
        return n > 0 ? `Updated · ${n} tab${n === 1 ? "" : "s"}` : "Updated";
      }
      if (!msg.ok) {
        return null;
      }
      if (opened > 0) {
        let s = `Restored ${opened} tab${opened === 1 ? "" : "s"}`;
        if (skipped > 0) {
          s += ` · ${skipped} already open`;
        }
        if (unbound > 0) {
          s += ` · ${unbound} lost its container`;
        }
        return s;
      }
      if (skipped > 0) {
        return "Already open — nothing to restore";
      }
      return "Restored";
    } catch (e) {
      return null;
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
          mark.className = "aph-stash-mark";
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
    row.className = "aph-stash-row" + (selectedIds.has(entry.id) ? " selected" : "");
    row.setAttribute("role", "button");
    row.setAttribute("tabindex", "0");
    row.setAttribute("aria-selected", selectedIds.has(entry.id) ? "true" : "false");

    const check = document.createElement("input");
    check.type = "checkbox";
    check.className = "aph-stash-check";
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
    fav.className = "aph-stash-fav";
    favIcon(entry, fav);
    row.appendChild(fav);

    const main = document.createElement("div");
    main.className = "aph-stash-main";
    const title = document.createElement("div");
    title.className = "aph-stash-title";
    paintText(title, entry.title || entry.url, titleIndices(entry));
    title.title = entry.url || "";
    main.appendChild(title);
    const dom = document.createElement("div");
    dom.className = "aph-stash-domain";
    dom.textContent = entry.host || entry.url;
    main.appendChild(dom);
    row.appendChild(main);

    const tags = document.createElement("div");
    tags.className = "aph-stash-tags";
    const wtag = document.createElement("span");
    wtag.className = "aph-stash-tag";
    wtag.textContent = wsTag(entry, names);
    tags.appendChild(wtag);
    if (entry.cname) {
      const ctag = document.createElement("span");
      ctag.className = "aph-stash-tag";
      ctag.textContent = entry.cname;
      tags.appendChild(ctag);
    }
    row.appendChild(tags);

    const del = document.createElement("button");
    del.className = "aph-stash-del";
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

    const go = (keep) => requestRestore(entry.id, keep, "tab");
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
    const bar = $("aph-stash-pills");
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
      b.className = "aph-stash-pill" + (pill === value ? " on" : "");
      // Workspace identity for paint: stash.css tints [data-ws] pills
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

  // ---- workspace stashes as rows --------------------------------------
  // Snapshots render in the tab row dialect: checkbox, workspace tile,
  // name + subline, tags, ✕. Row click restores the whole snapshot;
  // the chevron expands inline member rows (same dialect — click one to
  // restore just that tab); Rename/Update live in the expanded detail.
  // No new page, no new dependencies.
  function stashSubline(snap) {
    try {
      const l = L();
      const bits = [];
      const n = (snap.tabs || []).length;
      bits.push(`${n} tab${n === 1 ? "" : "s"}`);
      try {
        const when = l && l.dayLabel ? l.dayLabel(snap.ts, Date.now()) : "";
        if (when) {
          bits.push(when);
        }
      } catch (e) {}
      try {
        const seen = new Set();
        const hosts = [];
        for (const t of snap.tabs || []) {
          let h = "";
          try {
            h = l && l.hostOfUrl ? l.hostOfUrl((t && t.url) || "") : "";
          } catch (e) {}
          if (h && !seen.has(h)) {
            seen.add(h);
            hosts.push(h);
          }
          if (hosts.length >= 3) {
            break;
          }
        }
        if (hosts.length) {
          bits.push(hosts.join(", "));
        }
      } catch (e) {}
      return bits.join(" · ");
    } catch (e) {
      return "";
    }
  }

  function memberInitial(t) {
    try {
      const s = String((t && t.title) || "?").trim();
      return (s[0] || "?").toUpperCase();
    } catch (e) {
      return "?";
    }
  }

  function memberHost(t) {
    try {
      const l = L();
      const h = l && l.hostOfUrl ? l.hostOfUrl((t && t.url) || "") : "";
      return h || (t && t.url) || "";
    } catch (e) {
      return "";
    }
  }

  function toggleStashExpanded(id) {
    try {
      if (expandedIds.has(id)) {
        expandedIds.delete(id);
      } else {
        expandedIds.add(id);
      }
    } catch (e) {}
    render();
  }

  function deleteStashTab(id, url) {
    try {
      const list = readStashes();
      const entry = list.find((s) => s && s.id === id);
      if (!entry) {
        return;
      }
      const kept = (entry.tabs || []).filter((t) => t && t.url !== url);
      if (kept.length === (entry.tabs || []).length) {
        return;
      }
      if (!kept.length) {
        // Last tab out: the snapshot would vanish on next sanitize
        // anyway — delete it explicitly instead of keeping a husk.
        writeStashes(list.filter((s) => s && s.id !== id));
        try {
          selectedIds.delete(id);
        } catch (e) {}
        render();
        toast("Deleted stash");
        return;
      }
      entry.tabs = kept;
      writeStashes(list);
      render();
      toast("Removed tab");
    } catch (e) {}
  }

  function makeStashMember(snap, t) {
    const row = document.createElement("div");
    row.className = "aph-stash-row aph-stash-member";
    row.setAttribute("role", "button");
    row.setAttribute("tabindex", "0");
    row.setAttribute("aria-label", `Restore ${t.title || t.url}`);
    const fav = document.createElement("div");
    fav.className = "aph-stash-fav";
    fav.textContent = memberInitial(t);
    row.appendChild(fav);
    const main = document.createElement("div");
    main.className = "aph-stash-main";
    const title = document.createElement("div");
    title.className = "aph-stash-title";
    title.textContent = t.title || t.url;
    title.title = t.url || "";
    main.appendChild(title);
    const dom = document.createElement("div");
    dom.className = "aph-stash-domain";
    dom.textContent = memberHost(t);
    main.appendChild(dom);
    row.appendChild(main);
    const del = document.createElement("button");
    del.className = "aph-stash-del";
    del.textContent = "✕";
    del.title = "Remove this tab from the stash";
    del.setAttribute("aria-label", `Remove ${t.title || t.url} from stash`);
    del.addEventListener("click", (ev) => {
      try {
        if (ev && typeof ev.stopPropagation === "function") {
          ev.stopPropagation();
        }
      } catch (e) {}
      deleteStashTab(snap.id, t.url);
    });
    row.appendChild(del);
    const go = (ev) => {
      try {
        if (ev && typeof ev.stopPropagation === "function") {
          ev.stopPropagation();
        }
      } catch (e) {}
      requestRestore(snap.id, false, "stash-tab", { url: t.url });
    };
    row.addEventListener("click", go);
    row.addEventListener("keydown", (ev) => {
      try {
        if (ev.target !== row) {
          return;
        }
        if (ev.key === "Enter") {
          go(ev);
        } else if (ev.key === "Delete" || ev.key === "Backspace") {
          deleteStashTab(snap.id, t.url);
        }
      } catch (e) {}
    });
    return row;
  }

  function makeStashRow(snap) {
    const wrap = document.createElement("div");
    wrap.className = "aph-stash-snap";
    const open = expandedIds.has(snap.id);

    const row = document.createElement("div");
    row.className = "aph-stash-row" + (selectedIds.has(snap.id) ? " selected" : "");
    row.setAttribute("role", "button");
    row.setAttribute("tabindex", "0");
    row.setAttribute("aria-selected", selectedIds.has(snap.id) ? "true" : "false");
    row.setAttribute("aria-expanded", open ? "true" : "false");

    const check = document.createElement("input");
    check.type = "checkbox";
    check.className = "aph-stash-check";
    check.checked = selectedIds.has(snap.id);
    check.setAttribute("aria-label", `Select ${snap.name || "stash"}`);
    check.addEventListener("click", (ev) => {
      try {
        ev.stopPropagation();
      } catch (e) {}
    });
    check.addEventListener("change", () => {
      try {
        if (check.checked) {
          selectedIds.add(snap.id);
        } else {
          selectedIds.delete(snap.id);
        }
      } catch (e) {}
      render();
    });
    row.appendChild(check);

    const expand = document.createElement("button");
    expand.type = "button";
    expand.className = "aph-stash-expand";
    expand.textContent = open ? "▾" : "▸";
    expand.title = open ? "Collapse member tabs" : "Expand member tabs";
    expand.setAttribute("aria-label", open ? "Collapse" : "Expand");
    expand.setAttribute("aria-expanded", open ? "true" : "false");
    expand.addEventListener("click", (ev) => {
      try {
        if (ev && typeof ev.stopPropagation === "function") {
          ev.stopPropagation();
        }
      } catch (e) {}
      toggleStashExpanded(snap.id);
    });
    row.appendChild(expand);

    const fav = document.createElement("div");
    fav.className = "aph-stash-fav";
    fav.textContent = /^[1-9]$/.test(String(snap.ws || "")) ? snap.ws : "•";
    fav.title = `Workspace ${snap.ws || ""}`;
    row.appendChild(fav);

    const main = document.createElement("div");
    main.className = "aph-stash-main";
    const name = document.createElement("div");
    name.className = "aph-stash-title";
    name.textContent = snap.name || "Snapshot";
    name.title = snap.name || "";
    main.appendChild(name);
    const sub = document.createElement("div");
    sub.className = "aph-stash-domain";
    sub.textContent = stashSubline(snap);
    main.appendChild(sub);
    row.appendChild(main);

    const tags = document.createElement("div");
    tags.className = "aph-stash-tags";
    const wtag = document.createElement("span");
    wtag.className = "aph-stash-tag";
    wtag.textContent = `WS ${snap.ws || "1"}`;
    tags.appendChild(wtag);
    if (snap.auto) {
      const atag = document.createElement("span");
      atag.className = "aph-stash-tag";
      atag.textContent = "auto";
      atag.title = "Automatic capture";
      tags.appendChild(atag);
    }
    row.appendChild(tags);

    const del = document.createElement("button");
    del.className = "aph-stash-del";
    del.textContent = "✕";
    del.title = "Delete (no restore)";
    del.setAttribute("aria-label", `Delete ${snap.name || "stash"}`);
    del.addEventListener("click", (ev) => {
      try {
        ev.stopPropagation();
      } catch (e) {}
      deleteStash(snap.id);
    });
    row.appendChild(del);

    row.addEventListener("click", (ev) => {
      try {
        const t = ev.target;
        if (t === check || t === expand) {
          return;
        }
        // Clicks from the expanded detail (members, action buttons,
        // rename input) handle themselves — the row only restores on
        // direct hits.
        if (t && typeof t.closest === "function" && t.closest(".aph-stash-detail")) {
          return;
        }
        requestRestore(snap.id, false, "stash");
      } catch (e) {}
    });
    row.addEventListener("keydown", (ev) => {
      try {
        if (ev.target !== row) {
          return;
        }
        if (ev.key === "Enter") {
          requestRestore(snap.id, false, "stash");
        } else if (ev.key === "Delete" || ev.key === "Backspace") {
          deleteStash(snap.id);
        } else if (ev.key === " ") {
          ev.preventDefault();
          if (selectedIds.has(snap.id)) {
            selectedIds.delete(snap.id);
          } else {
            selectedIds.add(snap.id);
          }
          render();
        }
      } catch (e) {}
    });
    wrap.appendChild(row);

    if (open) {
      const detail = document.createElement("div");
      detail.className = "aph-stash-detail";
      const members = document.createElement("div");
      members.className = "aph-stash-members";
      for (const t of snap.tabs || []) {
        try {
          if (t && t.url) {
            members.appendChild(makeStashMember(snap, t));
          }
        } catch (e) {}
      }
      detail.appendChild(members);
      const actions = document.createElement("div");
      actions.className = "aph-stash-card-actions";
      const mkAction = (label, title, fn) => {
        const b = document.createElement("button");
        b.type = "button";
        b.textContent = label;
        b.title = title;
        b.addEventListener("click", (ev) => {
          try {
            if (ev && typeof ev.stopPropagation === "function") {
              ev.stopPropagation();
            }
          } catch (e) {}
          fn();
        });
        actions.appendChild(b);
      };
      mkAction("Restore", "Opens these tabs alongside the ones you have now (nothing is closed)",
        () => requestRestore(snap.id, false, "stash"));
      mkAction("Rename", "Rename this stash", () => startStashRename(wrap, snap));
      mkAction("Update", "Re-capture this workspace into the same stash (name kept)",
        () => requestRestore(snap.id, false, "stash-update"));
      detail.appendChild(actions);
      wrap.appendChild(detail);
    }
    return wrap;
  }

  // Stash-view pills: All / Manual / Auto with counts (the tab view's
  // workspace pills don't apply here — pill is reset on every view
  // switch, so the two vocabularies never collide).
  function renderStashPills(snaps) {
    const bar = $("aph-stash-pills");
    if (!bar) {
      return;
    }
    while (bar.firstChild) {
      bar.removeChild(bar.firstChild);
    }
    let manual = 0;
    let auto = 0;
    try {
      for (const s of snaps || []) {
        if (s && s.auto) {
          auto++;
        } else if (s) {
          manual++;
        }
      }
    } catch (e) {}
    const mk = (value, label) => {
      const b = document.createElement("button");
      b.className = "aph-stash-pill" + (pill === value ? " on" : "");
      b.textContent = label;
      b.addEventListener("click", () => {
        pill = value;
        render();
      });
      bar.appendChild(b);
    };
    mk("all", `All (${snaps.length})`);
    mk("manual", `Manual (${manual})`);
    mk("auto", `Auto (${auto})`);
  }

  function renderStashes() {
    const l = L();
    const snaps = readStashes();
    const count = $("aph-stash-count");
    if (count) {
      try {
        count.textContent = snaps.length ? `${snaps.length} stash${snaps.length === 1 ? "" : "es"}` : "";
      } catch (e) {}
    }
    // Same toolbar as the tab view: filter pills, sort, bulk bar. The
    // shared sort select's "By site" has no meaning for snapshots, so it
    // reads "By name" over here (sortStashes maps it).
    const pills = $("aph-stash-pills");
    if (pills) {
      try {
        pills.hidden = false;
      } catch (e) {}
    }
    renderStashPills(snaps);
    const sortbar = $("aph-stash-sortbar");
    if (sortbar) {
      try {
        sortbar.hidden = false;
      } catch (e) {}
    }
    try {
      const sort = $("aph-stash-sort");
      if (sort && sort.options) {
        for (const o of Array.from(sort.options)) {
          try {
            if (o.value === "site") {
              o.textContent = "By name";
            }
          } catch (e) {}
        }
      }
    } catch (e) {}
    let shown = snaps;
    if (pill === "manual") {
      shown = shown.filter((s) => s && !s.auto);
    } else if (pill === "auto") {
      shown = shown.filter((s) => s && s.auto);
    }
    const list = $("aph-stash-list");
    if (!list) {
      return;
    }
    while (list.firstChild) {
      list.removeChild(list.firstChild);
    }
    const empty = $("aph-stash-empty");
    if (empty) {
      try {
        empty.hidden = snaps.length > 0;
        if (!snaps.length) {
          empty.textContent = "No workspace stashes yet. Use “Stash Current Workspace…” in the palette.";
        }
      } catch (e) {}
    }
    // Fuzzy match across name, workspace and member tabs (same
    // relevance shape as the tab view); substring AND when the shared
    // scorer is unavailable. sortMode wins when idle; relevance wins
    // while searching.
    const q = String(query || "").trim();
    if (q) {
      try {
        if (l && l.fuzzyStashFilter) {
          shown = l.fuzzyStashFilter(shown, q).map((s) => s.snap);
        } else {
          const needle = q.toLowerCase();
          shown = shown.filter(
            (s) =>
              String(s.name || "").toLowerCase().includes(needle) ||
              String(s.ws || "").includes(needle) ||
              (s.tabs || []).some((t) => String(t.url || "").toLowerCase().includes(needle))
          );
        }
      } catch (e) {}
    } else {
      try {
        shown = l && l.sortStashes ? l.sortStashes(shown, sortMode) : shown;
      } catch (e) {}
    }
    updateBulkbar(shown.length);
    const wrap = document.createElement("section");
    wrap.className = "aph-stash-group";
    for (const s of shown) {
      try {
        wrap.appendChild(makeStashRow(s));
      } catch (e) {}
    }
    list.appendChild(wrap);
  }

  function render() {
    if (view === "stashes") {
      renderStashes();
      return;
    }
    const l = L();
    const names = readNames();
    let entries = readEntries();
    const total = entries.length;
    const count = $("aph-stash-count");
    if (count) {
      try {
        count.textContent = total ? `${total}/300` : "";
      } catch (e) {}
    }
    // Back from the stashes view: these were hidden there.
    try {
      const pills = $("aph-stash-pills");
      if (pills) {
        pills.hidden = false;
      }
      const sortbar = $("aph-stash-sortbar");
      if (sortbar) {
        sortbar.hidden = false;
      }
      // The stashes view borrows "By site" as "By name" (see
      // renderStashes): restore the tab-view label on the way back.
      const sort = $("aph-stash-sort");
      if (sort && sort.options) {
        for (const o of Array.from(sort.options)) {
          try {
            if (o.value === "site") {
              o.textContent = "By site";
            }
          } catch (e) {}
        }
      }
    } catch (e) {}
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
    const list = $("aph-stash-list");
    if (!list) {
      return;
    }
    while (list.firstChild) {
      list.removeChild(list.firstChild);
    }
    const empty = $("aph-stash-empty");
    const groups = l ? l.groupByDate(entries) : [{ key: "all", label: "", items: entries }];
    if (empty) {
      try {
        empty.hidden = entries.length > 0;
        if (!entries.length) {
          empty.textContent = query || pill !== "all"
            ? "Nothing stashed matches."
            : "Nothing stashed yet. Stash a tab from the tab menu or the palette.";
        }
      } catch (e) {}
    }
    for (const g of groups) {
      const wrap = document.createElement("section");
      wrap.className = "aph-stash-group";
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
      const bar = $("aph-stash-bulkbar");
      const cnt = $("aph-stash-bulkcount");
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
      if (view === "stashes") {
        writeStashes(readStashes().filter((s) => s && !ids.has(s.id)));
        selectedIds.clear();
        render();
        toast("Deleted selected stashes");
        return;
      }
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
      // Stash snapshots restore whole; per-tab entries restore kept.
      const kind = view === "stashes" ? "stash" : "tab";
      const keep = view !== "stashes";
      const ids = Array.from(selectedIds);
      let i = 0;
      const next = () => {
        if (i >= ids.length) {
          return;
        }
        const id = ids[i++];
        requestRestore(id, keep, kind);
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
                const summary = restoreResultText(msg);
                render();
                if (summary) {
                  toast(summary);
                }
              } else {
                toast(
                  msg.reason === "missing"
                    ? "Already gone"
                    : msg.kind === "stash-update" && msg.reason === "empty"
                      ? "Nothing stashable in that workspace"
                      : "Restore failed"
                );
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
              if (!topic || topic === PREF || topic === SNAP_PREF) {
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
      // View switch: Stashed tabs <-> Workspace stashes. Same search box,
      // pills, sort and bulk bar serve both; the stashes view swaps the
      // pill vocabulary (All/Manual/Auto) and reads "By site" as "By name".
      try {
        const btns = $("aph-stash-views");
        if (btns && typeof btns.querySelectorAll === "function") {
          for (const b of Array.from(btns.querySelectorAll("[data-view]"))) {
            b.addEventListener("click", () => {
              try {
                const next = String(b.getAttribute("data-view") || "tabs");
                if (next === view) {
                  return;
                }
                view = next === "stashes" ? "stashes" : "tabs";
                // Filters don't carry across views (workspace pills vs
                // manual/auto mean different things); selections and
                // expansions neither.
                pill = "all";
                try {
                  selectedIds.clear();
                } catch (e) {}
                try {
                  expandedIds.clear();
                } catch (e) {}
                for (const other of Array.from(btns.querySelectorAll("[data-view]"))) {
                  try {
                    other.setAttribute(
                      "aria-selected",
                      other.getAttribute("data-view") === view ? "true" : "false"
                    );
                  } catch (e) {}
                }
                render();
              } catch (e) {}
            });
          }
        }
      } catch (e) {}
      const s = $("aph-stash-search");
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
      const sort = $("aph-stash-sort");
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
      const bd = $("aph-stash-bulk-delete");
      if (bd) {
        bd.addEventListener("click", bulkDelete);
      }
      const br = $("aph-stash-bulk-restore");
      if (br) {
        br.addEventListener("click", bulkRestore);
      }
      const bc = $("aph-stash-bulk-clear");
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
      const s = $("aph-stash-search");
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
