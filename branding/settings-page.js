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

  function makeTable(title, headers, entries, emptyText, hint) {
    const section = document.createElement("section");
    section.className = "aph-settings-group";
    const h = document.createElement("h2");
    h.textContent = title;
    section.appendChild(h);

    if (!entries.length) {
      const empty = document.createElement("div");
      empty.className = "aph-settings-empty";
      empty.textContent = emptyText;
      section.appendChild(empty);
    } else {
      const table = document.createElement("table");
      table.className = "aph-settings-table";
      const thead = document.createElement("thead");
      const hr = document.createElement("tr");
      for (const c of headers) {
        const th = document.createElement("th");
        th.textContent = c;
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
        for (const c of e.cells) {
          const td = document.createElement("td");
          td.textContent = c;
          tr.appendChild(td);
        }
        tb.appendChild(tr);
      }
      table.appendChild(tb);
      section.appendChild(table);
    }
    if (hint) {
      const hEl = document.createElement("div");
      hEl.className = "aph-settings-hint";
      hEl.textContent = hint;
      section.appendChild(hEl);
    }
    return section;
  }

  function advancedSections() {
    const out = [];
    try {
      const l = L();
      const names = readJsonObject(l ? l.NAMES_PREF : "aph.workspaces.names");
      const bindings = readJsonObject(l ? l.BINDINGS_PREF : "aph.workspaces.containerBindings");
      const routes = readJsonObject(l ? l.ROUTES_PREF : "aph.workspaces.domainRoutes");
      const n = archiveCount();

      const nameEntries = Object.keys(names || {})
        .filter((k) => /^[1-9]$/.test(k))
        .sort()
        .map((k) => ({ ws: k, cells: [`WS ${k}`, String(names[k])] }));
      out.push(
        makeTable(
          "Workspace names",
          ["Workspace", "Name"],
          nameEntries,
          "No custom names yet.",
          "Rename via the palette (Ctrl+K → Rename) or the Aph menu."
        )
      );

      const bindEntries = Object.keys(bindings || {})
        .filter((k) => /^[1-9]$/.test(k))
        .sort()
        .map((k) => ({ ws: k, cells: [`WS ${k}`, `Container ${bindings[k]}`] }));
      out.push(
        makeTable(
          "Container bindings",
          ["Workspace", "Binding"],
          bindEntries,
          "No bindings yet — new tabs open containerless.",
          "Bind via the palette (Ctrl+K → Bind) or the Aph menu."
        )
      );

      const routeEntries = Object.keys(routes || {})
        .sort()
        .map((k) => ({ ws: String(routes[k] || ""), cells: [k, `WS ${routes[k]}`] }));
      out.push(
        makeTable(
          "Domain routes",
          ["Host", "Workspace"],
          routeEntries,
          "No domain routes yet.",
          "Route via the palette (Ctrl+K → Route) on any http(s) tab."
        )
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
        const section = document.createElement("section");
        section.className = "aph-settings-group";
        const h = document.createElement("h2");
        h.textContent = g.name;
        section.appendChild(h);
        for (const row of g.rows || []) {
          try {
            section.appendChild(row.kind === "int" ? makeIntRow(row) : makeBoolRow(row));
          } catch (_e) {}
        }
        list.appendChild(section);
      }
      const adv = document.createElement("section");
      adv.className = "aph-settings-group";
      const ah = document.createElement("h2");
      ah.textContent = "Advanced";
      adv.appendChild(ah);
      const note = document.createElement("div");
      note.className = "aph-settings-hint";
      note.textContent = "Workspace names, bindings and routes are managed from the palette — shown here read-only.";
      adv.appendChild(note);
      list.appendChild(adv);
      for (const s of advancedSections()) {
        list.appendChild(s);
      }
    } catch (e) {}
  }

  function resetFrecency() {
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
  }

  function init() {
    render();
    try {
      const btn = $("aph-settings-reset-frecency");
      if (btn) {
        btn.addEventListener("click", resetFrecency);
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
                render();
                // Keep focus where the user is typing across re-renders.
                try {
                  const a = document.activeElement;
                  if (a && a.className === "aph-settings-number") {
                    a.focus();
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
