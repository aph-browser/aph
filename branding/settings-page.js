/* Aph settings page — runs inside aph-settings.html (chrome:// page in a tab).
 *
 * System-principal chrome pages can use Services directly (same precedent
 * as about:config and aph-archive-page.js), so toggles read and write
 * the aph.* prefs here with seed-once defaults from config/user.js.
 * Classic script, external file only (no inline scripts — chrome pages
 * may enforce script-src restrictions).
 *
 * Pure helpers live on window.AphSettingsLogic for node:vm tests;
 * the DOM controller below is fail-silent house style throughout.
 */
var AphSettingsLogic = (function () {
  const BOOL_DEFAULTS = {
    "aph.workspaces.unloadOnSwitch": false,
    "aph.archive.autoEnabled": false,
    "aph.addons.silenceFirstRun": true,
    "aph.pins.ctrlWUnloads": true,
    "aph.stars.ctrlWUnloads": true,
    "aph.sidebar.hideFooter": true,
    // Stock prefs (not aph.*): Sync/accounts and the password manager
    // ship OFF — the Settings toggles below are the on-ramp. Defaults
    // here must match config/user-overrides.js seed-once values.
    "identity.fxaccounts.enabled": false,
    "signon.rememberSignons": false,
  };

  const STALE_PREF = "aph.archive.autoStaleMin";
  const STALE_DEFAULT = 5;
  const STALE_MIN = 0;
  const STALE_MAX = 1440;

  const FRECENCY_PREF = "aph.palette.frecency";
  const NAMES_PREF = "aph.workspaces.names";
  const BINDINGS_PREF = "aph.workspaces.containerBindings";
  const ROUTES_PREF = "aph.workspaces.domainRoutes";
  const ARCHIVE_PREF = "aph.archive.tabs";

  const GROUPS = [
    {
      name: "Workspaces",
      rows: [
        {
          kind: "bool",
          pref: "aph.workspaces.unloadOnSwitch",
          title: "Unload hidden workspaces on switch",
          desc: "Discard eligible hidden-workspace tabs after each switch to save memory. Off by default — use the palette's “Unload Inactive Tabs” for manual sweeps.",
        },
      ],
    },
    {
      name: "Archive",
      rows: [
        {
          kind: "bool",
          pref: "aph.archive.autoEnabled",
          title: "Auto-archive hidden tabs",
          desc: "15 s after you stop switching, archive (close + store) every eligible hidden-workspace tab. Selected, pinned, starred, audible, loading and unsaved-form tabs never auto-close.",
        },
        {
          kind: "int",
          pref: "aph.archive.autoStaleMin",
          title: "Auto-archive staleness",
          desc: "Tabs viewed within this many minutes are spared when the sweep fires. Tabs with no recorded view time count as stale.",
        },
      ],
    },
    {
      name: "Tabs",
      rows: [
        {
          kind: "bool",
          pref: "aph.pins.ctrlWUnloads",
          title: "Ctrl+W parks pinned tabs",
          desc: "A drifted pin resets to its pinned base URL in place; a pin already at base unloads. Second press closes. Off restores stock close-on-first-press.",
        },
        {
          kind: "bool",
          pref: "aph.stars.ctrlWUnloads",
          title: "Ctrl+W parks starred tabs",
          desc: "Mirrors pins for starred tabs: drifted stars reset in place, at-base stars unload, second press closes.",
        },
      ],
    },
    {
      name: "Add-ons",
      rows: [
        {
          kind: "bool",
          pref: "aph.addons.silenceFirstRun",
          title: "Silence extension welcome tabs",
          desc: "Close noisy install/welcome tabs (e.g. SponsorBlock help) pre-paint. Off keeps them.",
        },
      ],
    },
    {
      name: "Sidebar",
      rows: [
        {
          kind: "bool",
          pref: "aph.sidebar.hideFooter",
          title: "Hide sidebar footer",
          desc: "Hide the sidebar settings gear to reclaim the strip. Customize Sidebar stays reachable via the Aph menu either way.",
        },
      ],
    },
    {
      name: "Accounts & Passwords",
      rows: [
        {
          kind: "bool",
          pref: "identity.fxaccounts.enabled",
          title: "Firefox Sync and Mozilla account",
          desc: "Show the account UI and allow signing in to Sync (bookmarks, history, passwords, tabs — end-to-end encrypted). Off by default; takes effect after a restart.",
        },
        {
          kind: "bool",
          pref: "signon.rememberSignons",
          title: "Save and fill passwords",
          desc: "Offer to save logins and fill them on sites. Off by default; already-saved logins stay stored until you delete them in Firefox Settings.",
        },
      ],
    },
  ];

  function clampStaleMin(v) {
    const n = Math.floor(Number(v));
    if (!Number.isFinite(n)) {
      return STALE_DEFAULT;
    }
    if (n < STALE_MIN) {
      return STALE_MIN;
    }
    if (n > STALE_MAX) {
      return STALE_MAX;
    }
    return n;
  }

  // Guarded JSON-object parse: malformed / non-object values become {}.
  function parseJsonObject(raw) {
    try {
      if (!raw) {
        return {};
      }
      const v = JSON.parse(raw);
      if (v && typeof v === "object" && !Array.isArray(v)) {
        return v;
      }
    } catch (e) {}
    return {};
  }

  function countKeys(o) {
    try {
      return Object.keys(o || {}).length;
    } catch (e) {
      return 0;
    }
  }

  // --- Backup / export -------------------------------------------------
  // File shape: { aphBackup: 1, exportedAt: <ISO>, prefs: { pref: value } }.
  // Values are parsed (objects stay objects), so files are readable and
  // diffable. Import writes only keys present in the file (merge, never
  // delete); unknown keys are ignored so newer files stay loadable.
  const BACKUP_VERSION = 1;
  const BACKUP_BOOL_PREFS = Object.keys(BOOL_DEFAULTS);
  const BACKUP_JSON_PREFS = [NAMES_PREF, BINDINGS_PREF, ROUTES_PREF, ARCHIVE_PREF, FRECENCY_PREF];

  // read: { bool(pref, def), int(pref, def), json(pref) } — the DOM
  // controller binds these to Services; tests pass stubs.
  function buildBackup(read) {
    const out = {};
    try {
      for (const k of BACKUP_BOOL_PREFS) {
        out[k] = !!read.bool(k, BOOL_DEFAULTS[k]);
      }
      out[STALE_PREF] = clampStaleMin(read.int(STALE_PREF, STALE_DEFAULT));
      for (const k of BACKUP_JSON_PREFS) {
        out[k] = read.json(k);
      }
    } catch (e) {}
    let exportedAt = "";
    try {
      exportedAt = new Date().toISOString();
    } catch (e) {}
    return { aphBackup: BACKUP_VERSION, exportedAt, prefs: out };
  }

  function isObject(v) {
    return !!v && typeof v === "object" && !Array.isArray(v);
  }

  // Strict on known-key types (a hand-edited file with a string where a
  // bool belongs is almost certainly a mistake); lenient on unknown keys
  // (ignored) and missing keys (import simply skips them).
  function parseBackup(text) {
    let root = null;
    try {
      root = JSON.parse(text);
    } catch (e) {
      return { ok: false, error: "Not valid JSON." };
    }
    if (!isObject(root) || !isObject(root.prefs)) {
      return { ok: false, error: "Not an Aph backup file." };
    }
    if (root.aphBackup !== BACKUP_VERSION) {
      return { ok: false, error: `Unsupported backup version ${String(root.aphBackup)}.` };
    }
    const prefs = {};
    for (const k of BACKUP_BOOL_PREFS) {
      if (k in root.prefs) {
        if (typeof root.prefs[k] !== "boolean") {
          return { ok: false, error: `${k} must be true or false.` };
        }
        prefs[k] = root.prefs[k];
      }
    }
    if (STALE_PREF in root.prefs) {
      if (typeof root.prefs[STALE_PREF] !== "number" || !Number.isFinite(root.prefs[STALE_PREF])) {
        return { ok: false, error: `${STALE_PREF} must be a number.` };
      }
      prefs[STALE_PREF] = clampStaleMin(root.prefs[STALE_PREF]);
    }
    // JSON prefs validate in BACKUP_JSON_PREFS order so an export →
    // import round-trip keeps stable key order (diffable files).
    for (const k of BACKUP_JSON_PREFS) {
      if (!(k in root.prefs)) {
        continue;
      }
      if (k === ARCHIVE_PREF) {
        if (!Array.isArray(root.prefs[k])) {
          return { ok: false, error: `${k} must be a list.` };
        }
        // Entries are sanitized again on read by the archive page, but
        // drop obvious junk now so a corrupt file can't wedge the store.
        const kept = [];
        let dropped = 0;
        for (const e of root.prefs[k]) {
          if (e && typeof e === "object" && typeof e.id === "string" && typeof e.url === "string") {
            kept.push(e);
          } else {
            dropped++;
          }
        }
        prefs[k] = kept;
        if (dropped > 0) {
          prefs.__droppedArchive = dropped;
        }
        continue;
      }
      if (!isObject(root.prefs[k])) {
        return { ok: false, error: `${k} must be an object.` };
      }
      prefs[k] = root.prefs[k];
    }
    return { ok: true, prefs, exportedAt: typeof root.exportedAt === "string" ? root.exportedAt : "" };
  }

  // One-line summary for the import confirm dialog.
  function summarizeBackup(prefs) {
    const bits = [];
    try {
      const n = countKeys(prefs[NAMES_PREF]);
      if (n) {
        bits.push(`${n} workspace name${n === 1 ? "" : "s"}`);
      }
      const b = countKeys(prefs[BINDINGS_PREF]);
      if (b) {
        bits.push(`${b} binding${b === 1 ? "" : "s"}`);
      }
      const r = countKeys(prefs[ROUTES_PREF]);
      if (r) {
        bits.push(`${r} route${r === 1 ? "" : "s"}`);
      }
      if (Array.isArray(prefs[ARCHIVE_PREF])) {
        bits.push(`${prefs[ARCHIVE_PREF].length} archived tab${prefs[ARCHIVE_PREF].length === 1 ? "" : "s"}`);
      }
      let toggles = 0;
      for (const k of BACKUP_BOOL_PREFS) {
        if (k in prefs) {
          toggles++;
        }
      }
      if (STALE_PREF in prefs) {
        toggles++;
      }
      if (toggles) {
        bits.push(`${toggles} setting${toggles === 1 ? "" : "s"}`);
      }
    } catch (e) {}
    return bits.length ? bits.join(", ") : "no Aph prefs";
  }

  return {
    BOOL_DEFAULTS,
    STALE_PREF,
    STALE_DEFAULT,
    STALE_MIN,
    STALE_MAX,
    FRECENCY_PREF,
    NAMES_PREF,
    BINDINGS_PREF,
    ROUTES_PREF,
    ARCHIVE_PREF,
    GROUPS,
    clampStaleMin,
    parseJsonObject,
    countKeys,
    BACKUP_VERSION,
    BACKUP_BOOL_PREFS,
    BACKUP_JSON_PREFS,
    buildBackup,
    parseBackup,
    summarizeBackup,
  };
})();

(function () {
  const L = function () {
    try {
      return window.AphSettingsLogic || null;
    } catch (e) {
      return null;
    }
  };

  const TOAST_MS = 2400;
  let toastTimer = null;
  let searchQuery = "";
  let modalOk = null;

  function $(id) {
    try {
      return document.getElementById(id);
    } catch (e) {
      return null;
    }
  }

  function prefs() {
    try {
      return Services && Services.prefs ? Services.prefs : null;
    } catch (e) {
      return null;
    }
  }

  function boolDefault(pref) {
    try {
      const l = L();
      if (l && l.BOOL_DEFAULTS && pref in l.BOOL_DEFAULTS) {
        return !!l.BOOL_DEFAULTS[pref];
      }
    } catch (e) {}
    return false;
  }

  function readBool(pref) {
    const d = boolDefault(pref);
    try {
      const p = prefs();
      if (!p || typeof p.getBoolPref !== "function") {
        return d;
      }
      try {
        // Two-arg form where supported; throws where not.
        return p.getBoolPref(pref, d);
      } catch (e) {
        return p.getBoolPref(pref);
      }
    } catch (e) {
      return d;
    }
  }

  function writeBool(pref, v) {
    try {
      const p = prefs();
      if (p && typeof p.setBoolPref === "function") {
        p.setBoolPref(pref, !!v);
        return true;
      }
    } catch (e) {}
    return false;
  }

  function readStale() {
    try {
      const l = L();
      const d = (l && l.STALE_DEFAULT) || 5;
      const p = prefs();
      if (!p || typeof p.getIntPref !== "function") {
        return d;
      }
      let v = d;
      try {
        v = p.getIntPref(l ? l.STALE_PREF : "aph.archive.autoStaleMin", d);
      } catch (e) {
        try {
          v = p.getIntPref(l ? l.STALE_PREF : "aph.archive.autoStaleMin");
        } catch (_e) {
          v = d;
        }
      }
      return l ? l.clampStaleMin(v) : v;
    } catch (e) {
      return 5;
    }
  }

  function writeStale(v) {
    try {
      const l = L();
      const clamped = l ? l.clampStaleMin(v) : Math.floor(Number(v));
      const p = prefs();
      if (p && typeof p.setIntPref === "function") {
        p.setIntPref(l ? l.STALE_PREF : "aph.archive.autoStaleMin", clamped);
        return clamped;
      }
      return clamped;
    } catch (e) {
      return null;
    }
  }

  function readString(pref) {
    try {
      const p = prefs();
      if (!p) {
        return "";
      }
      if (typeof p.getStringPref === "function") {
        try {
          return p.getStringPref(pref, "");
        } catch (e) {
          try {
            return p.getStringPref(pref);
          } catch (_e) {
            return "";
          }
        }
      }
      if (typeof p.getCharPref === "function") {
        try {
          return p.getCharPref(pref, "");
        } catch (e) {
          try {
            return p.getCharPref(pref);
          } catch (_e) {
            return "";
          }
        }
      }
    } catch (e) {}
    return "";
  }

  function readJsonObject(pref) {
    try {
      const l = L();
      const raw = readString(pref);
      if (l) {
        return l.parseJsonObject(raw);
      }
      if (!raw) {
        return {};
      }
      const v = JSON.parse(raw);
      return v && typeof v === "object" && !Array.isArray(v) ? v : {};
    } catch (e) {
      return {};
    }
  }

  function writeJsonObject(pref, obj) {
    return writeString(pref, obj || {});
  }

  function readJsonArray(pref) {
    try {
      const raw = readString(pref);
      if (!raw) {
        return [];
      }
      const v = JSON.parse(raw);
      return Array.isArray(v) ? v : [];
    } catch (e) {
      return [];
    }
  }

  function writeString(pref, value) {
    let text = "";
    try {
      text = JSON.stringify(value);
    } catch (e) {
      return false;
    }
    // JSON prefs may legitimately stringify to undefined (functions can
    // never appear here, but a hostile backup object could smuggle one
    // past parse — refuse instead of writing the literal "undefined").
    if (typeof text !== "string") {
      return false;
    }
    try {
      const p = prefs();
      if (!p) {
        return false;
      }
      if (typeof p.setStringPref === "function") {
        p.setStringPref(pref, text);
        return true;
      }
      if (typeof p.setCharPref === "function") {
        p.setCharPref(pref, text);
        return true;
      }
    } catch (e) {}
    return false;
  }

  function archiveCount() {
    try {
      const raw = readString("aph.archive.tabs");
      if (!raw) {
        return 0;
      }
      const v = JSON.parse(raw);
      return Array.isArray(v) ? v.length : 0;
    } catch (e) {
      return 0;
    }
  }

  function toast(msg) {
    try {
      const el = $("aph-settings-toast");
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

  // Modal confirm (replaces native confirm for import/reset). Falls back
  // to window.confirm when the modal DOM is absent (tests, minimal page).
  function showModal(opts) {
    const o = opts || {};
    try {
      const m = $("aph-settings-modal");
      const t = $("aph-settings-modal-title");
      const d = $("aph-settings-modal-desc");
      const ok = $("aph-settings-modal-ok");
      const cancel = $("aph-settings-modal-cancel");
      if (!m || !t || !d || !ok || !cancel) {
        let fallback = false;
        try {
          fallback = window.confirm(`${o.title || "Confirm"}\n${o.desc || ""}`);
        } catch (e) {
          fallback = false;
        }
        if (fallback && typeof o.onOk === "function") {
          o.onOk();
        }
        return;
      }
      t.textContent = o.title || "Confirm";
      d.textContent = o.desc || "";
      ok.textContent = o.okLabel || "Confirm";
      try {
        ok.classList.toggle("danger", !!o.danger);
      } catch (e) {}
      modalOk = typeof o.onOk === "function" ? o.onOk : null;
      m.hidden = false;
      try {
        ok.focus();
      } catch (e) {}
    } catch (e) {}
  }

  function hideModal() {
    try {
      const m = $("aph-settings-modal");
      if (m) {
        m.hidden = true;
      }
    } catch (e) {}
    modalOk = null;
  }

  function makeToggle(pref, current) {
    const b = document.createElement("button");
    b.className = "aph-settings-toggle";
    b.setAttribute("role", "switch");
    b.setAttribute("aria-checked", current ? "true" : "false");
    b.setAttribute("aria-label", pref);
    b.title = pref;
    b.addEventListener("click", (ev) => {
      try {
        ev.stopPropagation();
      } catch (e) {}
      const next = b.getAttribute("aria-checked") !== "true";
      if (writeBool(pref, next)) {
        b.setAttribute("aria-checked", next ? "true" : "false");
        toast(next ? "On" : "Off");
      } else {
        toast("Write failed");
      }
    });
    b.addEventListener("keydown", (ev) => {
      try {
        if (ev.key === "Enter" || ev.key === " ") {
          ev.preventDefault();
          b.click();
        }
      } catch (e) {}
    });
    return b;
  }

  function makeBoolRow(row) {
    const wrap = document.createElement("div");
    wrap.className = "aph-settings-row";
    wrap.setAttribute("role", "button");
    wrap.setAttribute("tabindex", "0");

    const main = document.createElement("div");
    main.className = "aph-settings-main";
    const label = document.createElement("div");
    label.className = "aph-settings-label";
    label.textContent = row.title;
    main.appendChild(label);
    if (row.desc) {
      const desc = document.createElement("div");
      desc.className = "aph-settings-desc";
      desc.textContent = row.desc;
      main.appendChild(desc);
    }
    const pref = document.createElement("div");
    pref.className = "aph-settings-pref";
    pref.textContent = row.pref;
    main.appendChild(pref);
    wrap.appendChild(main);

    const cur = readBool(row.pref);
    const toggle = makeToggle(row.pref, cur);
    wrap.appendChild(toggle);

    const flip = () => {
      try {
        toggle.click();
      } catch (e) {}
    };
    wrap.addEventListener("click", (ev) => {
      try {
        if (ev.target !== toggle) {
          flip();
        }
      } catch (e) {}
    });
    wrap.addEventListener("keydown", (ev) => {
      try {
        if ((ev.key === "Enter" || ev.key === " ") && ev.target === wrap) {
          ev.preventDefault();
          flip();
        }
      } catch (e) {}
    });
    return wrap;
  }

  function makeIntRow(row) {
    const wrap = document.createElement("div");
    wrap.className = "aph-settings-row";

    const main = document.createElement("div");
    main.className = "aph-settings-main";
    const label = document.createElement("div");
    label.className = "aph-settings-label";
    label.textContent = row.title;
    main.appendChild(label);
    if (row.desc) {
      const desc = document.createElement("div");
      desc.className = "aph-settings-desc";
      desc.textContent = row.desc;
      main.appendChild(desc);
    }
    const pref = document.createElement("div");
    pref.className = "aph-settings-pref";
    pref.textContent = row.pref + " · minutes";
    main.appendChild(pref);
    wrap.appendChild(main);

    const input = document.createElement("input");
    input.className = "aph-settings-number";
    input.type = "number";
    try {
      const l = L();
      input.min = String((l && l.STALE_MIN) || 0);
      input.max = String((l && l.STALE_MAX) || 1440);
    } catch (e) {}
    input.value = String(readStale());
    input.setAttribute("aria-label", row.pref);
    input.addEventListener("change", () => {
      const v = writeStale(input.value);
      if (v !== null && v !== undefined) {
        input.value = String(v);
        toast("Saved");
      } else {
        toast("Write failed");
      }
    });
    wrap.appendChild(input);
    return wrap;
  }

  function makeEditableTable(opts) {
    const o = opts || {};
    const section = document.createElement("section");
    section.className = "aph-settings-group";
    section.dataset.group = o.title || "";
    const h = document.createElement("h2");
    h.textContent = o.title || "";
    section.appendChild(h);

    const entries = o.entries || [];
    if (!entries.length) {
      const empty = document.createElement("div");
      empty.className = "aph-settings-empty";
      empty.textContent = o.emptyText || "Nothing here yet.";
      section.appendChild(empty);
    } else {
      const table = document.createElement("table");
      table.className = "aph-settings-table";
      const thead = document.createElement("thead");
      const hr = document.createElement("tr");
      for (const c of o.headers || []) {
        const th = document.createElement("th");
        th.textContent = c;
        th.setAttribute("scope", "col");
        hr.appendChild(th);
      }
      if (o.editable) {
        const th = document.createElement("th");
        th.textContent = "Edit";
        th.setAttribute("scope", "col");
        hr.appendChild(th);
      }
      thead.appendChild(hr);
      table.appendChild(thead);
      const tb = document.createElement("tbody");
      for (const e of entries) {
        const tr = document.createElement("tr");
        try {
          if (e.ws && /^[1-9]$/.test(e.ws)) {
            tr.setAttribute("data-ws", e.ws);
          }
        } catch (_e) {}
        if (o.editable && typeof o.renderEditor === "function") {
          for (const c of e.cells) {
            const td = document.createElement("td");
            td.textContent = c;
            tr.appendChild(td);
          }
          const tdEdit = document.createElement("td");
          try {
            const editor = o.renderEditor(e);
            if (editor) {
              tdEdit.appendChild(editor);
            }
          } catch (_e) {}
          // Delete button for bindings/routes/names.
          if (typeof o.onDelete === "function" && e.key) {
            try {
              const del = document.createElement("button");
              del.type = "button";
              del.className = "aph-settings-rowbtn danger";
              del.textContent = "Clear";
              del.setAttribute("aria-label", `Clear ${e.key}`);
              del.addEventListener("click", (ev) => {
                try {
                  ev.stopPropagation();
                } catch (_e) {}
                o.onDelete(e.key);
              });
              tdEdit.appendChild(document.createTextNode(" "));
              tdEdit.appendChild(del);
            } catch (_e) {}
          }
          tr.appendChild(tdEdit);
        } else {
          for (const c of e.cells) {
            const td = document.createElement("td");
            td.textContent = c;
            tr.appendChild(td);
          }
        }
        tb.appendChild(tr);
      }
      table.appendChild(tb);
      section.appendChild(table);
    }
    if (o.hint) {
      const hEl = document.createElement("div");
      hEl.className = "aph-settings-hint";
      hEl.textContent = o.hint;
      section.appendChild(hEl);
    }
    return section;
  }

  function makeTable(title, headers, entries, emptyText, hint) {
    return makeEditableTable({ title, headers, entries, emptyText, hint, editable: false });
  }

  function nameEditor(ws, current) {
    const input = document.createElement("input");
    input.className = "aph-settings-edit";
    input.type = "text";
    input.value = current || "";
    input.placeholder = `Workspace ${ws}`;
    input.maxLength = 40;
    input.setAttribute("aria-label", `Name for workspace ${ws}`);
    input.addEventListener("change", () => {
      try {
        const l = L();
        const pref = l ? l.NAMES_PREF : "aph.workspaces.names";
        const names = readJsonObject(pref);
        const v = String(input.value || "").trim().slice(0, 40);
        if (v) {
          names[ws] = v;
        } else {
          delete names[ws];
        }
        if (writeJsonObject(pref, names)) {
          toast(v ? "Name saved" : "Name cleared");
          refreshTables();
        } else {
          toast("Write failed");
        }
      } catch (e) {
        toast("Write failed");
      }
    });
    return input;
  }

  function routeEditor(host, currentWs) {
    const input = document.createElement("input");
    input.className = "aph-settings-edit";
    input.type = "text";
    input.value = currentWs || "";
    input.placeholder = "1–9";
    input.inputMode = "numeric";
    input.maxLength = 1;
    input.setAttribute("aria-label", `Workspace for ${host}`);
    input.addEventListener("change", () => {
      try {
        const l = L();
        const pref = l ? l.ROUTES_PREF : "aph.workspaces.domainRoutes";
        const routes = readJsonObject(pref);
        const v = String(input.value || "").trim();
        if (/^[1-9]$/.test(v)) {
          routes[host] = v;
          if (writeJsonObject(pref, routes)) {
            toast("Route saved");
            refreshTables();
          } else {
            toast("Write failed");
          }
        } else if (!v) {
          delete routes[host];
          if (writeJsonObject(pref, routes)) {
            toast("Route cleared");
            refreshTables();
          }
        } else {
          toast("Use 1–9");
          input.value = currentWs || "";
        }
      } catch (e) {
        toast("Write failed");
      }
    });
    return input;
  }

  function advancedSections() {
    const out = [];
    try {
      const l = L();
      const namesPref = l ? l.NAMES_PREF : "aph.workspaces.names";
      const bindPref = l ? l.BINDINGS_PREF : "aph.workspaces.containerBindings";
      const routesPref = l ? l.ROUTES_PREF : "aph.workspaces.domainRoutes";
      const names = readJsonObject(namesPref);
      const bindings = readJsonObject(bindPref);
      const routes = readJsonObject(routesPref);
      const n = archiveCount();

      const nameEntries = Object.keys(names || {})
        .filter((k) => /^[1-9]$/.test(k))
        .sort()
        .map((k) => ({ ws: k, key: k, cells: [`WS ${k}`, String(names[k])] }));
      // Always show all 9 slots so names are editable inline even when empty.
      const nameRows = [];
      for (let i = 1; i <= 9; i++) {
        const k = String(i);
        const cur = names[k] ? String(names[k]) : "";
        nameRows.push({
          ws: k,
          key: k,
          cells: [`WS ${k}`, cur || "—"],
          _cur: cur,
        });
      }
      out.push(
        makeEditableTable({
          title: "Workspace names",
          headers: ["Workspace", "Name"],
          entries: searchQuery ? nameEntries : nameRows,
          emptyText: "No custom names yet.",
          hint: "Edit inline — empty clears back to “Workspace N”. Also in palette (Ctrl+K → Rename).",
          editable: true,
          renderEditor: (e) => nameEditor(e.key, e._cur != null ? e._cur : String((names[e.key] || ""))),
          onDelete: (key) => {
            try {
              const cur = readJsonObject(namesPref);
              delete cur[key];
              if (writeJsonObject(namesPref, cur)) {
                toast("Name cleared");
                refreshTables();
              }
            } catch (_e) {}
          },
        })
      );

      const bindEntries = Object.keys(bindings || {})
        .filter((k) => /^[1-9]$/.test(k))
        .sort()
        .map((k) => ({ ws: k, key: k, cells: [`WS ${k}`, `Container ${bindings[k]}`] }));
      out.push(
        makeEditableTable({
          title: "Container bindings",
          headers: ["Workspace", "Binding"],
          entries: bindEntries,
          emptyText: "No bindings yet — new tabs open containerless.",
          hint: "Bind via the palette (Ctrl+K → Bind). Clear removes the binding here.",
          editable: true,
          renderEditor: () => null,
          onDelete: (key) => {
            try {
              const cur = readJsonObject(bindPref);
              delete cur[key];
              if (writeJsonObject(bindPref, cur)) {
                toast("Binding cleared");
                refreshTables();
              }
            } catch (_e) {}
          },
        })
      );

      const routeEntries = Object.keys(routes || {})
        .sort()
        .map((k) => ({ ws: String(routes[k] || ""), key: k, cells: [k, `WS ${routes[k]}`], _cur: String(routes[k] || "") }));
      out.push(
        makeEditableTable({
          title: "Domain routes",
          headers: ["Host", "Workspace"],
          entries: routeEntries,
          emptyText: "No domain routes yet.",
          hint: "Edit the workspace (1–9) inline or clear to remove. Route via palette on any http(s) tab.",
          editable: true,
          renderEditor: (e) => routeEditor(e.key, e._cur),
          onDelete: (key) => {
            try {
              const cur = readJsonObject(routesPref);
              delete cur[key];
              if (writeJsonObject(routesPref, cur)) {
                toast("Route cleared");
                refreshTables();
              }
            } catch (_e) {}
          },
        })
      );

      out.push(
        makeTable(
          "Archive store",
          ["Entries", ""],
          n ? [{ ws: "", cells: [`${n}/300 archived`, "Browse via Open Archive below"] }] : [],
          "Archive is empty.",
          "Archive rows live in the Archive tab; this page never edits them."
        )
      );
    } catch (e) {}
    return out;
  }

  // Light refresh for pref-observer updates: re-render tables only when
  // the user isn't editing (avoids clobbering an in-progress input).
  function refreshTables() {
    try {
      const ae = document.activeElement;
      if (ae && ae.className === "aph-settings-edit") {
        return;
      }
    } catch (e) {}
    render();
  }

  function matchesSearch(text) {
    try {
      const q = String(searchQuery || "").trim().toLowerCase();
      if (!q) {
        return true;
      }
      return String(text || "").toLowerCase().includes(q);
    } catch (e) {
      return true;
    }
  }

  function render() {
    const list = $("aph-settings-list");
    if (!list) {
      return;
    }
    while (list.firstChild) {
      list.removeChild(list.firstChild);
    }
    try {
      const l = L();
      const groups = (l && l.GROUPS) || [];
      for (const g of groups) {
        const rows = (g.rows || []).filter((r) => {
          if (!matchesSearch(`${r.title || ""} ${r.desc || ""} ${r.pref || ""} ${g.name || ""}`)) {
            return false;
          }
          return true;
        });
        if (searchQuery && !rows.length) {
          continue;
        }
        const section = document.createElement("section");
        section.className = "aph-settings-group";
        section.dataset.group = g.name || "";
        const h = document.createElement("h2");
        h.textContent = g.name;
        section.appendChild(h);
        for (const row of rows) {
          try {
            section.appendChild(row.kind === "int" ? makeIntRow(row) : makeBoolRow(row));
          } catch (_e) {}
        }
        list.appendChild(section);
      }
      const adv = document.createElement("section");
      adv.className = "aph-settings-group";
      adv.dataset.group = "Advanced";
      const ah = document.createElement("h2");
      ah.textContent = "Advanced";
      adv.appendChild(ah);
      const note = document.createElement("div");
      note.className = "aph-settings-hint";
      note.textContent = "Workspace names and routes edit inline below; bindings clear here (set them from the palette).";
      adv.appendChild(note);
      list.appendChild(adv);
      for (const s of advancedSections()) {
        // Search filters tables row-wise via text match on the section.
        if (searchQuery) {
          try {
            const txt = s.textContent || "";
            if (!matchesSearch(txt)) {
              continue;
            }
          } catch (_e) {}
        }
        list.appendChild(s);
      }
      try {
        list.classList.toggle("has-search", window.innerWidth >= 1100);
      } catch (e) {}
    } catch (e) {}
  }

  function resetFrecency() {
    showModal({
      title: "Reset command frecency?",
      desc: "Clears the palette's learned ranking. Commands return to default order.",
      okLabel: "Reset",
      danger: true,
      onOk: () => {
        try {
          const l = L();
          const p = prefs();
          const key = (l && l.FRECENCY_PREF) || "aph.palette.frecency";
          if (p) {
            try {
              if (typeof p.clearUserPref === "function") {
                p.clearUserPref(key);
                toast("Frecency reset");
                return;
              }
            } catch (e) {}
            try {
              if (typeof p.setStringPref === "function") {
                p.setStringPref(key, "{}");
                toast("Frecency reset");
                return;
              }
              if (typeof p.setCharPref === "function") {
                p.setCharPref(key, "{}");
                toast("Frecency reset");
                return;
              }
            } catch (e) {}
          }
          toast("Reset failed");
        } catch (e) {
          toast("Reset failed");
        }
      },
    });
  }

  // Writes only keys present in the backup (merge, never delete).
  // Returns the number of prefs written.
  function writeBackupPrefs(p) {
    let n = 0;
    try {
      const l = L();
      for (const k of (l && l.BACKUP_BOOL_PREFS) || []) {
        if (p && k in p && writeBool(k, !!p[k])) {
          n++;
        }
      }
      const sp = (l && l.STALE_PREF) || "aph.archive.autoStaleMin";
      if (p && sp in p) {
        const v = writeStale(p[sp]);
        if (v !== null && v !== undefined) {
          n++;
        }
      }
      for (const k of (l && l.BACKUP_JSON_PREFS) || []) {
        if (p && k in p && writeString(k, p[k])) {
          n++;
        }
      }
    } catch (e) {}
    return n;
  }

  function exportBackup() {
    try {
      const l = L();
      if (!l || typeof l.buildBackup !== "function") {
        toast("Export failed");
        return;
      }
      const data = l.buildBackup({
        bool: (k) => readBool(k),
        int: () => readStale(),
        json: (k) => (k === l.ARCHIVE_PREF ? readJsonArray(k) : readJsonObject(k)),
      });
      const text = JSON.stringify(data, null, 2);
      const blob = new Blob([text], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      let day = "";
      try {
        day = new Date().toISOString().slice(0, 10);
      } catch (e) {}
      const a = document.createElement("a");
      a.href = url;
      a.download = `aph-backup-${day || "settings"}.json`;
      try {
        (document.body || document.documentElement).appendChild(a);
      } catch (e) {}
      try {
        a.click();
      } catch (e) {}
      try {
        a.remove();
      } catch (e) {}
      setTimeout(() => {
        try {
          URL.revokeObjectURL(url);
        } catch (e) {}
      }, 5000);
      toast("Backup exported");
    } catch (e) {
      toast("Export failed");
    }
  }

  function importBackupFile(file) {
    if (!file) {
      return;
    }
    let reader = null;
    try {
      reader = new FileReader();
    } catch (e) {
      toast("Import failed");
      return;
    }
    reader.onload = () => {
      try {
        const l = L();
        const r = l && typeof l.parseBackup === "function" ? l.parseBackup(reader.result) : null;
        if (!r || !r.ok) {
          toast((r && r.error) || "Import failed");
          return;
        }
        const summary = l.summarizeBackup(r.prefs);
        const when = r.exportedAt ? ` from ${r.exportedAt.slice(0, 10)}` : "";
        const commit = () => {
          const n = writeBackupPrefs(r.prefs);
          render();
          toast(n > 0 ? "Backup imported" : "Nothing to import");
        };
        // Modal first; window.confirm fallback lives inside showModal.
        showModal({
          title: `Import Aph backup${when}?`,
          desc: `Replaces: ${summary}. Missing keys are left alone (merge, never delete).`,
          okLabel: "Import",
          danger: false,
          onOk: commit,
        });
      } catch (e) {
        toast("Import failed");
      }
    };
    reader.onerror = () => toast("Import failed");
    try {
      reader.readAsText(file);
    } catch (e) {
      toast("Import failed");
    }
  }

  function initSearch() {
    try {
      const s = $("aph-settings-search");
      if (!s) {
        return;
      }
      s.addEventListener("input", () => {
        try {
          searchQuery = s.value || "";
        } catch (e) {
          searchQuery = "";
        }
        // Targeted: re-render list only, keep focus in the search field.
        render();
        try {
          s.focus();
        } catch (e) {}
      });
      document.addEventListener("keydown", (ev) => {
        try {
          if (ev.key === "/" && document.activeElement !== s &&
              (!document.activeElement || !/INPUT|TEXTAREA/.test(document.activeElement.tagName || ""))) {
            ev.preventDefault();
            s.focus();
          }
        } catch (e) {}
      });
    } catch (e) {}
  }

  function initModal() {
    try {
      const cancel = $("aph-settings-modal-cancel");
      const ok = $("aph-settings-modal-ok");
      const m = $("aph-settings-modal");
      if (cancel) {
        cancel.addEventListener("click", hideModal);
      }
      if (ok) {
        ok.addEventListener("click", () => {
          const fn = modalOk;
          hideModal();
          if (fn) {
            try {
              fn();
            } catch (e) {}
          }
        });
      }
      if (m) {
        m.addEventListener("mousedown", (ev) => {
          try {
            if (ev.target === m) {
              hideModal();
            }
          } catch (e) {}
        });
      }
      document.addEventListener("keydown", (ev) => {
        try {
          if (ev.key === "Escape" && m && !m.hidden) {
            hideModal();
          }
        } catch (e) {}
      });
    } catch (e) {}
  }

  function init() {
    render();
    initSearch();
    initModal();
    try {
      const btn = $("aph-settings-reset-frecency");
      if (btn) {
        btn.addEventListener("click", resetFrecency);
      }
    } catch (e) {}
    try {
      const exp = $("aph-settings-export");
      if (exp) {
        exp.addEventListener("click", exportBackup);
      }
    } catch (e) {}
    try {
      const imp = $("aph-settings-import");
      const picker = $("aph-settings-import-file");
      if (imp && picker) {
        imp.addEventListener("click", () => {
          try {
            picker.click();
          } catch (e) {}
        });
        picker.addEventListener("change", () => {
          try {
            const f = picker.files && picker.files[0];
            // Reset so picking the same file twice still fires change.
            try {
              picker.value = "";
            } catch (_e) {}
            importBackupFile(f);
          } catch (e) {}
        });
      }
    } catch (e) {}
    // Live re-render when another window (or about:config) flips a pref.
    try {
      const p = prefs();
      const l = L();
      if (p && typeof p.addObserver === "function") {
        const watched = [];
        try {
          for (const g of (l && l.GROUPS) || []) {
            for (const r of g.rows || []) {
              if (r && r.pref) {
                watched.push(r.pref);
              }
            }
          }
          watched.push(l ? l.NAMES_PREF : "aph.workspaces.names");
          watched.push(l ? l.BINDINGS_PREF : "aph.workspaces.containerBindings");
          watched.push(l ? l.ROUTES_PREF : "aph.workspaces.domainRoutes");
          watched.push(l ? l.ARCHIVE_PREF : "aph.archive.tabs");
        } catch (e) {}
        const obs = {
          observe(subj, topic, data) {
            try {
              if (!data || watched.indexOf(data) !== -1) {
                // Targeted update: keep focus where the user is typing
                // across re-renders (search, number, inline editors).
                const ae = document.activeElement;
                let selStart = -1;
                let selEnd = -1;
                try {
                  if (ae && (ae.id === "aph-settings-search" || ae.className === "aph-settings-edit" || ae.className === "aph-settings-number") && typeof ae.selectionStart === "number") {
                    selStart = ae.selectionStart;
                    selEnd = ae.selectionEnd;
                  }
                } catch (_e) {}
                const aeId = ae && ae.id ? ae.id : "";
                const aeLabel = ae && ae.getAttribute ? ae.getAttribute("aria-label") : "";
                render();
                try {
                  let back = null;
                  if (aeId) {
                    back = document.getElementById(aeId);
                  }
                  if (!back && aeLabel) {
                    back = document.querySelector(`[aria-label="${aeLabel}"]`);
                  }
                  if (back && back.focus) {
                    back.focus();
                    if (selStart >= 0 && typeof back.setSelectionRange === "function") {
                      try {
                        back.setSelectionRange(selStart, selEnd);
                      } catch (_e) {}
                    }
                  }
                } catch (_e) {}
              }
            } catch (e) {}
          },
        };
        for (const k of watched) {
          try {
            p.addObserver(k, obs, false);
          } catch (e) {}
        }
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
  }

  if (document.readyState === "complete" || document.readyState === "interactive") {
    init();
  } else {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  }
})();
