/* Aph tab stash — shared pure logic (no Firefox deps).
 *
 * Used by the window controller (branding/stash.js, classic script via
 * browser.xhtml) and by the stash page (branding/stash-page.js,
 * chrome://browser/content/aph-stash.html). Classic script on purpose:
 * defines a single global `AphStashLogic` so both consumers work without
 * a module system — same pattern as textpick-shared.js. Also loaded
 * directly in node:vm by tests/stash.test.js.
 *
 * Jobs: URL eligibility, entry validation, cap pruning, date grouping and
 * multi-word filtering. All functions are pure and side-effect free.
 */
var AphStashLogic = (function () {
  // Hard cap: the store lives in a single JSON pref (cheap cross-window
  // sync), so history is bounded — oldest entries prune first (FIFO).
  const MAX_ENTRIES = 300;

  const HTTP_RE = /^https?:\/\//i;

  // Only real web pages are archivable: no about:/chrome:/resource: pages,
  // no data:/blob: pseudo-URLs, no private-window tabs (checked separately
  // by the controller via PrivateBrowsingUtils).
  function isArchivableUrl(url) {
    return typeof url === "string" && HTTP_RE.test(url);
  }

  function hostOfUrl(url) {
    try {
      return (new URL(url).hostname || "").toLowerCase().replace(/\.$/, "");
    } catch (e) {
      // No URL constructor (or unparseable input): bare scheme://host grab,
      // same fallback shape as the palette's hostOfURL().
      try {
        const m = String(url || "").match(/^[a-z]+:\/\/([^/:?#]+)/i);
        return m ? m[1].toLowerCase().replace(/\.$/, "") : "";
      } catch (_e) {
        return "";
      }
    }
  }

  // Validate + normalize a raw parsed-pref value into entry objects.
  // Drops anything that is not a restorable http(s) entry (wrong shape,
  // missing id/url, non-web URL). Missing display fields fall back to
  // safe defaults; order is preserved (callers keep newest-first).
  function sanitizeEntries(raw) {
    if (!Array.isArray(raw)) {
      return [];
    }
    const out = [];
    for (const e of raw) {
      if (!e || typeof e !== "object") {
        continue;
      }
      const url = typeof e.url === "string" ? e.url : "";
      if (!isArchivableUrl(url)) {
        continue;
      }
      if (typeof e.id !== "string" || !e.id) {
        continue;
      }
      out.push({
        id: e.id,
        title: typeof e.title === "string" && e.title ? e.title : url,
        url,
        host: hostOfUrl(url),
        ws: typeof e.ws === "string" && /^[1-9]$/.test(e.ws) ? e.ws : "1",
        cid: Number.isInteger(e.cid) && e.cid > 0 ? e.cid : 0,
        cname: typeof e.cname === "string" ? e.cname : "",
        favicon: typeof e.favicon === "string" ? e.favicon : "",
        ts: typeof e.ts === "number" && e.ts > 0 ? e.ts : 0,
      });
    }
    return out;
  }

  // Newest-first list trimmed to the cap (default MAX_ENTRIES).
  function pruneEntries(list, max) {
    const cap = Number.isInteger(max) && max > 0 ? max : MAX_ENTRIES;
    return (list || []).slice(0, cap);
  }

  // "Today" / "Yesterday" / "Sep 12" (with year when not this year).
  function dayLabel(ts, nowMs) {
    try {
      const d = new Date(ts);
      const n = new Date(nowMs == null ? Date.now() : nowMs);
      if (isNaN(d.getTime()) || isNaN(n.getTime())) {
        return "";
      }
      const day = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
      const today = new Date(n.getFullYear(), n.getMonth(), n.getDate()).getTime();
      const diff = Math.round((today - day) / 86400000);
      if (diff <= 0) {
        return "Today";
      }
      if (diff === 1) {
        return "Yesterday";
      }
      const opts = { month: "short", day: "numeric" };
      if (d.getFullYear() !== n.getFullYear()) {
        opts.year = "numeric";
      }
      return d.toLocaleDateString("en-US", opts);
    } catch (e) {
      return "";
    }
  }

  function dateKey(ts) {
    try {
      const d = new Date(ts);
      return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    } catch (e) {
      return "unknown";
    }
  }

  // Consecutive same-day runs become one group (input stays newest-first).
  function groupByDate(entries, nowMs) {
    const groups = [];
    const byKey = new Map();
    for (const e of entries || []) {
      const ts = (e && typeof e.ts === "number" && e.ts > 0) ? e.ts : nowMs || Date.now();
      const k = dateKey(ts);
      let g = byKey.get(k);
      if (!g) {
        g = { key: k, label: dayLabel(ts, nowMs), items: [] };
        byKey.set(k, g);
        groups.push(g);
      }
      g.items.push(e);
    }
    return groups;
  }

  // Multi-word AND match across title, host, URL, workspace ("2",
  // "ws 2", "workspace 2", custom name) and container name.
  function filterEntries(entries, q, wsNames) {
    const needle = String(q == null ? "" : q).trim().toLowerCase();
    if (!needle) {
      return (entries || []).slice();
    }
    const names = wsNames || {};
    return (entries || []).filter((e) => {
      try {
        if (!e) {
          return false;
        }
        const wname = String((names && names[e.ws]) || "").toLowerCase();
        const hay = [
          e.title || "",
          e.host || "",
          e.url || "",
          `ws ${e.ws || ""}`,
          `workspace ${e.ws || ""}`,
          wname,
          e.cname || "",
        ].join(" ").toLowerCase();
        return needle.split(/\s+/).every((part) => part && hay.includes(part));
      } catch (err) {
        return false;
      }
    });
  }

  // Scored fuzzy match (palette dialect, simplified): exact prefix >
  // word-boundary substring > plain substring > subsequence. Returns
  // {score, indices} or null. Powers highlight + relevance sort.
  function fuzzyEntry(query, text) {
    try {
      const needle = String(query || "").toLowerCase();
      const hay = String(text || "").toLowerCase();
      const n = needle.length;
      if (!n || !hay) {
        return n ? null : { score: 0, indices: [] };
      }
      if (hay.startsWith(needle)) {
        const indices = [];
        for (let i = 0; i < n; i++) {
          indices.push(i);
        }
        return { score: 1000 - hay.length, indices };
      }
      const isBoundary = (i) => i === 0 || /[^a-z0-9]/.test(hay[i - 1]);
      const at = hay.indexOf(needle);
      if (at !== -1) {
        const indices = [];
        for (let i = 0; i < n; i++) {
          indices.push(at + i);
        }
        return { score: (isBoundary(at) ? 800 : 600) - at, indices };
      }
      // Subsequence with consecutive + boundary bonuses.
      const indices = [];
      let ti = 0;
      let score = 400;
      let consec = 0;
      let prev = -2;
      for (let qi = 0; qi < n; qi++) {
        const c = needle[qi];
        let f = -1;
        for (let j = ti; j < hay.length; j++) {
          if (hay[j] === c) {
            f = j;
            break;
          }
        }
        if (f === -1) {
          return null;
        }
        if (f === prev + 1) {
          consec++;
          score += 12;
        }
        if (isBoundary(f)) {
          score += 10;
        }
        score -= Math.max(0, f - ti) * 2;
        indices.push(f);
        prev = f;
        ti = f + 1;
      }
      score += consec * 4;
      return { score, indices };
    } catch (e) {
      return null;
    }
  }

  function hayOf(entry, wsNames) {
    try {
      const names = wsNames || {};
      const wname = String((names && names[entry.ws]) || "");
      return [entry.title || "", entry.host || "", entry.url || "", `ws ${entry.ws || ""}`, wname, entry.cname || ""].join(" ");
    } catch (e) {
      return "";
    }
  }

  // Fuzzy filter with per-token AND + relevance score. Returns
  // [{entry, score, indices}] sorted by score desc. Empty query returns
  // all entries unscored (score 0).
  function fuzzyFilter(entries, q, wsNames) {
    const needle = String(q == null ? "" : q).trim().toLowerCase();
    if (!needle) {
      return (entries || []).map((entry) => ({ entry, score: 0, indices: [] }));
    }
    const parts = needle.split(/\s+/).filter(Boolean);
    const out = [];
    for (const entry of entries || []) {
      try {
        if (!entry) {
          continue;
        }
        const hay = hayOf(entry, wsNames);
        let score = 0;
        let indices = [];
        let ok = true;
        for (const part of parts) {
          const m = fuzzyEntry(part, hay);
          if (!m) {
            ok = false;
            break;
          }
          score += m.score;
          indices = indices.concat(m.indices);
        }
        if (ok) {
          out.push({ entry, score, indices });
        }
      } catch (err) {}
    }
    out.sort((a, b) => b.score - a.score);
    return out;
  }

  function sortEntries(entries, mode) {
    const list = (entries || []).slice();
    try {
      if (mode === "oldest") {
        list.sort((a, b) => (a.ts || 0) - (b.ts || 0));
      } else if (mode === "site") {
        list.sort((a, b) => String(a.host || "").localeCompare(String(b.host || "")) || (b.ts || 0) - (a.ts || 0));
      } else {
        list.sort((a, b) => (b.ts || 0) - (a.ts || 0));
      }
    } catch (e) {}
    return list;
  }

  // ---------------------------------------------------------------- snapshots
  // A "stash" (workspace snapshot) is one captured workspace: a named set of
  // restorable tabs, newest-first in a capped JSON pref. Same shape as the
  // per-tab store above, so it reuses isArchivableUrl for eligibility.
  //
  // Caps: manual snapshots are the user's own work and are never dropped to
  // make room for auto captures — auto ones prune first (oldest), then manual
  // oldest-first once the manual cap is exceeded. Two separate caps (not one)
  // so an auto capture storm can never evict every manual stash.
  //
  // Autos use tiered retention: newest N recents plus newest one per
  // calendar day for the last D days (global, deduped). Manuals stay a
  // flat newest-N pool.
  const SNAP_MAX_MANUAL = 20;
  const SNAP_MAX_AUTO = 10;
  const SNAP_MAX_AUTO_MIN = 1;
  const SNAP_MAX_AUTO_MAX = 50;
  const SNAP_KEEP_DAILIES_DEFAULT = 7;
  const SNAP_KEEP_DAILIES_MIN = 0;
  const SNAP_KEEP_DAILIES_MAX = 30;

  // Validate + normalize raw snapshot objects. Keeps well-formed entries
  // only: a real id/name, a 1-9 workspace, http(s) tabs, sane cid/ts/auto.
  // A snapshot with zero surviving tabs is dropped (nothing to restore).
  //
  // Fidelity fields (all optional, old snapshots load fine without them):
  // per-tab idx (strip order), gi (index into groups[] or null), gname /
  // gcolor / gcollapsed (denormalized group state for display + regroup),
  // cname + favicon (display), star + starURL + tabName + lastViewed
  // (re-applied on restore). Envelope groups[] + selUrl + wsName power
  // the stash page and best-effort reorder/regroup.
  function sanitizeSnapTab(t) {
    if (!t || typeof t !== "object") {
      return null;
    }
    const url = typeof t.url === "string" ? t.url : "";
    if (!isArchivableUrl(url)) {
      return null;
    }
    const rec = {
      title: typeof t.title === "string" && t.title ? t.title : url,
      url,
      cid: Number.isInteger(t.cid) && t.cid > 0 ? t.cid : 0,
    };
    if (Number.isInteger(t.idx) && t.idx >= 0 && t.idx <= 10000) {
      rec.idx = t.idx;
    }
    if (Number.isInteger(t.gi) && t.gi >= 0 && t.gi <= 64) {
      rec.gi = t.gi;
    } else {
      rec.gi = null;
    }
    if (typeof t.gname === "string" && t.gname.trim()) {
      rec.gname = t.gname.trim().slice(0, 80);
    }
    if (typeof t.gcolor === "string" && t.gcolor.trim()) {
      rec.gcolor = t.gcolor.trim().slice(0, 32);
    }
    if (t.gcollapsed === true || t.gcollapsed === 1) {
      rec.gcollapsed = true;
    }
    if (typeof t.cname === "string" && t.cname) {
      rec.cname = t.cname.slice(0, 80);
    }
    if (typeof t.favicon === "string" && t.favicon && t.favicon.length <= 8192) {
      rec.favicon = t.favicon;
    }
    if (t.star === true || t.star === 1) {
      rec.star = true;
    }
    if (typeof t.starURL === "string" && t.starURL && t.starURL.length <= 2048) {
      rec.starURL = t.starURL;
    }
    if (typeof t.tabName === "string" && t.tabName.trim()) {
      rec.tabName = t.tabName.trim().slice(0, 100);
    }
    if (typeof t.lastViewed === "number" && t.lastViewed > 0) {
      rec.lastViewed = Math.floor(t.lastViewed);
    }
    return rec;
  }

  function sanitizeSnapshotGroups(raw) {
    if (!Array.isArray(raw)) {
      return [];
    }
    const out = [];
    for (const g of raw) {
      if (!g || typeof g !== "object") {
        continue;
      }
      out.push({
        name: typeof g.name === "string" ? g.name.slice(0, 80) : "",
        color: typeof g.color === "string" ? g.color.slice(0, 32) : "",
        collapsed: g.collapsed === true || g.collapsed === 1,
      });
      if (out.length >= 64) {
        break;
      }
    }
    return out;
  }

  function sanitizeSnapshots(raw) {
    if (!Array.isArray(raw)) {
      return [];
    }
    const out = [];
    for (const s of raw) {
      if (!s || typeof s !== "object") {
        continue;
      }
      if (typeof s.id !== "string" || !s.id) {
        continue;
      }
      const tabs = [];
      const seen = new Set();
      for (const t of Array.isArray(s.tabs) ? s.tabs : []) {
        const rec = sanitizeSnapTab(t);
        if (!rec) {
          continue;
        }
        if (seen.has(rec.url)) {
          continue;
        }
        seen.add(rec.url);
        tabs.push(rec);
      }
      if (!tabs.length) {
        continue;
      }
      const entry = {
        id: s.id,
        name: typeof s.name === "string" && s.name.trim()
          ? s.name.trim().slice(0, 80)
          : "Snapshot",
        ws: typeof s.ws === "string" && /^[1-9]$/.test(s.ws) ? s.ws : "1",
        ts: typeof s.ts === "number" && s.ts > 0 ? s.ts : 0,
        auto: !!s.auto,
        tabs,
      };
      const groups = sanitizeSnapshotGroups(s.groups);
      if (groups.length) {
        entry.groups = groups;
      }
      if (typeof s.selUrl === "string" && s.selUrl && s.selUrl.length <= 2048) {
        entry.selUrl = s.selUrl;
      }
      if (typeof s.wsName === "string" && s.wsName.trim()) {
        entry.wsName = s.wsName.trim().slice(0, 40);
      }
      out.push(entry);
    }
    return out;
  }

  // Periodic cadence check (pure, so the sweeper is testable without
  // timers): due when no capture exists yet (lastTs 0/missing) or the
  // interval has fully elapsed. Clamp faults to the default, never throw.
  const SNAP_INTERVAL_DEFAULT_MIN = 30;
  const SNAP_INTERVAL_MIN_MIN = 5;
  const SNAP_INTERVAL_MAX_MIN = 240;

  function clampSnapIntervalMin(m) {
    try {
      const n = Number(m);
      if (Number.isFinite(n)) {
        return Math.min(
          SNAP_INTERVAL_MAX_MIN,
          Math.max(SNAP_INTERVAL_MIN_MIN, Math.floor(n))
        );
      }
    } catch (e) {}
    return SNAP_INTERVAL_DEFAULT_MIN;
  }

  function snapshotDue(lastTs, nowMs, intervalMin) {
    try {
      const interval = clampSnapIntervalMin(intervalMin);
      const now = Number(nowMs);
      if (!Number.isFinite(now) || now < 0) {
        return false;
      }
      const last = Number(lastTs) || 0;
      if (!(last > 0)) {
        return true;
      }
      return now - last >= interval * 60000;
    } catch (e) {
      return false;
    }
  }

  // Trim to the caps: auto first (oldest auto goes), then manual oldest-first.
  // Legacy flat form: newest aCap autos + newest mCap manuals. Tiered
  // retention lives in pruneSnapshotsTiered below; this stays for callers
  // and tests that pass explicit caps.
  function pruneSnapshots(list, manualCap, autoCap) {
    const src = Array.isArray(list) ? list : [];
    const mCap = Number.isInteger(manualCap) && manualCap > 0
      ? manualCap
      : SNAP_MAX_MANUAL;
    const aCap = Number.isInteger(autoCap) && autoCap > 0 ? autoCap : SNAP_MAX_AUTO;
    const byAge = (a, b) => (a.ts || 0) - (b.ts || 0);
    const autos = src.filter((s) => s && s.auto).sort(byAge).slice(-aCap);
    const manual = src.filter((s) => s && !s.auto).sort(byAge).slice(-mCap);
    return [...autos, ...manual].sort((a, b) => (b.ts || 0) - (a.ts || 0));
  }

  function clampMaxAuto(m) {
    try {
      const n = Number(m);
      if (Number.isFinite(n)) {
        return Math.min(SNAP_MAX_AUTO_MAX, Math.max(SNAP_MAX_AUTO_MIN, Math.floor(n)));
      }
    } catch (e) {}
    return SNAP_MAX_AUTO;
  }

  function clampKeepDailies(m) {
    try {
      const n = Number(m);
      if (Number.isFinite(n)) {
        return Math.min(
          SNAP_KEEP_DAILIES_MAX,
          Math.max(SNAP_KEEP_DAILIES_MIN, Math.floor(n))
        );
      }
    } catch (e) {}
    return SNAP_KEEP_DAILIES_DEFAULT;
  }

  // Local calendar day slot (YYYY-MM-DD) for the daily tier. Empty for
  // missing/non-finite timestamps so undated snapshots never win a day.
  function dayKey(ts) {
    try {
      const n = Number(ts);
      if (!Number.isFinite(n) || n <= 0) {
        return "";
      }
      const d = new Date(n);
      if (isNaN(d.getTime())) {
        return "";
      }
      const mm = String(d.getMonth() + 1).padStart(2, "0");
      const dd = String(d.getDate()).padStart(2, "0");
      return `${d.getFullYear()}-${mm}-${dd}`;
    } catch (e) {
      return "";
    }
  }

  function startOfDay(ts) {
    try {
      const n = Number(ts);
      if (!Number.isFinite(n) || n <= 0) {
        return 0;
      }
      const d = new Date(n);
      if (isNaN(d.getTime())) {
        return 0;
      }
      return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    } catch (e) {
      return 0;
    }
  }

  // Tiered autos retention: newest maxAuto recents UNION newest one per
  // calendar day for the last keepDailies days (global, deduped by id).
  // Manuals stay a flat newest-mCap pool. nowMs injectable for tests;
  // defaults to Date.now(). Never throws.
  function pruneSnapshotsTiered(list, maxAuto, keepDailies, nowMs, manualCap) {
    try {
      const src = Array.isArray(list) ? list : [];
      const mCap = Number.isInteger(manualCap) && manualCap > 0
        ? manualCap
        : SNAP_MAX_MANUAL;
      const aCap = clampMaxAuto(maxAuto);
      const dKeep = clampKeepDailies(keepDailies);
      const byAge = (a, b) => (a.ts || 0) - (b.ts || 0);
      const byNewest = (a, b) => (b.ts || 0) - (a.ts || 0);
      const manual = src.filter((s) => s && !s.auto).sort(byAge).slice(-mCap);
      const autos = src.filter((s) => s && s.auto).sort(byNewest);
      const recents = autos.slice(0, aCap);
      const keep = new Map();
      for (const s of recents) {
        if (s && typeof s.id === "string" && s.id) {
          keep.set(s.id, s);
        }
      }
      if (dKeep > 0) {
        let now = Number(nowMs);
        if (!Number.isFinite(now) || now <= 0) {
          try {
            now = Date.now();
          } catch (e) {
            now = 0;
          }
        }
        if (now > 0) {
          const todayStart = startOfDay(now);
          const wanted = new Set();
          for (let i = 0; i < dKeep; i++) {
            const dk = dayKey(todayStart - i * 86400000);
            if (dk) {
              wanted.add(dk);
            }
          }
          const bestByDay = new Map();
          for (const s of autos) {
            try {
              if (!s || typeof s.id !== "string" || !s.id) {
                continue;
              }
              const dk = dayKey(s.ts);
              if (!dk || !wanted.has(dk) || bestByDay.has(dk)) {
                continue;
              }
              bestByDay.set(dk, s);
            } catch (e) {}
          }
          for (const s of bestByDay.values()) {
            if (s && typeof s.id === "string" && s.id) {
              keep.set(s.id, s);
            }
          }
        }
      }
      const keptAutos = [...keep.values()].sort(byNewest);
      return [...keptAutos, ...manual].sort(byNewest);
    } catch (e) {
      try {
        return pruneSnapshots(list, manualCap, maxAuto);
      } catch (_e) {
        return [];
      }
    }
  }

  // Search haystack for one snapshot: name, workspace ("2", "ws 2",
  // "workspace 2"), group names and every member tab's title, host and
  // URL — so a snapshot is findable by what it contains, not just what
  // it's called.
  function stashHay(snap) {
    try {
      if (!snap) {
        return "";
      }
      const parts = [
        snap.name || "",
        `ws ${snap.ws || ""}`,
        `workspace ${snap.ws || ""}`,
        snap.auto ? "auto" : "manual",
      ];
      for (const g of Array.isArray(snap.groups) ? snap.groups : []) {
        try {
          if (g && g.name) {
            parts.push(g.name);
          }
        } catch (_e) {}
      }
      for (const t of Array.isArray(snap.tabs) ? snap.tabs : []) {
        try {
          if (!t) {
            continue;
          }
          parts.push(t.title || "", hostOfUrl(t.url || ""), t.url || "");
          if (t.gname) {
            parts.push(t.gname);
          }
          if (t.tabName) {
            parts.push(t.tabName);
          }
        } catch (_e) {}
      }
      return parts.join(" ");
    } catch (e) {
      return "";
    }
  }

  // Fuzzy filter over snapshots (same per-token AND + relevance shape as
  // fuzzyFilter). Returns [{snap, score, indices}] sorted by score desc;
  // empty query returns every snapshot unscored (score 0).
  function fuzzyStashFilter(snaps, q) {
    const needle = String(q == null ? "" : q).trim().toLowerCase();
    if (!needle) {
      return (snaps || []).map((snap) => ({ snap, score: 0, indices: [] }));
    }
    const parts = needle.split(/\s+/).filter(Boolean);
    const out = [];
    for (const snap of snaps || []) {
      try {
        if (!snap) {
          continue;
        }
        const hay = stashHay(snap);
        let score = 0;
        let indices = [];
        let ok = true;
        for (const part of parts) {
          const m = fuzzyEntry(part, hay);
          if (!m) {
            ok = false;
            break;
          }
          score += m.score;
          indices = indices.concat(m.indices);
        }
        if (ok) {
          out.push({ snap, score, indices });
        }
      } catch (err) {}
    }
    out.sort((a, b) => b.score - a.score);
    return out;
  }

  // Newest-first by default; "oldest" flips; "name" sorts A-Z (the
  // per-tab "site" mode has no meaning for snapshots, so the stashes
  // view maps it here — see stash-page.js).
  function sortStashes(snaps, mode) {
    const list = (snaps || []).slice();
    try {
      if (mode === "oldest") {
        list.sort((a, b) => (a.ts || 0) - (b.ts || 0));
      } else if (mode === "name" || mode === "site") {
        list.sort(
          (a, b) =>
            String(a.name || "").localeCompare(String(b.name || "")) ||
            (b.ts || 0) - (a.ts || 0)
        );
      } else {
        list.sort((a, b) => (b.ts || 0) - (a.ts || 0));
      }
    } catch (e) {}
    return list;
  }

  // Content key for change detection: sorted URLs (what's open) + strip
  // order (how it's arranged) + group signature (who's grouped with whom,
  // incl. collapsed) + selected URL (where you are). Pure so both the
  // live-tab path and the saved-snapshot path share one definition.
  // tabs: [{url, gi, gname, gcolor, gcollapsed}] in strip order.
  function snapshotContentKey(tabs, selUrl) {
    try {
      const list = Array.isArray(tabs) ? tabs : [];
      const urls = [];
      const order = [];
      const gs = [];
      for (const t of list) {
        try {
          const url = t && typeof t.url === "string" ? t.url : "";
          if (!url) {
            continue;
          }
          urls.push(url);
          order.push(url);
          const gi = t && Number.isInteger(t.gi) && t.gi >= 0 ? t.gi : -1;
          const gn = t && typeof t.gname === "string" ? t.gname : "";
          const gc = t && typeof t.gcolor === "string" ? t.gcolor : "";
          const gx = t && t.gcollapsed ? "1" : "0";
          gs.push(`${url}#${gi}:${gn}:${gc}:${gx}`);
        } catch (_e) {}
      }
      urls.sort();
      gs.sort();
      return `${urls.join("\n")}\n---order---\n${order.join("\n")}\n---groups---\n${gs.join("\n")}\n---sel---\n${typeof selUrl === "string" ? selUrl : ""}`;
    } catch (e) {
      return "";
    }
  }

  function savedContentKey(snap) {
    try {
      if (!snap) {
        return "";
      }
      return snapshotContentKey(snap.tabs || [], snap.selUrl || "");
    } catch (e) {
      return "";
    }
  }

  // Slow-tier key: same shape as snapshotContentKey but selection-blind,
  // so selection-only drift never mints a 6h/daily snapshot. Covers
  // opened / closed / moved (URLs + order + groups incl. collapsed).
  function slowContentKey(tabs) {
    try {
      return snapshotContentKey(Array.isArray(tabs) ? tabs : [], "");
    } catch (e) {
      return "";
    }
  }

  function savedSlowKey(snap) {
    try {
      if (!snap) {
        return "";
      }
      return snapshotContentKey(snap.tabs || [], "");
    } catch (e) {
      return "";
    }
  }

  // Event-driven capture budget: at most one event capture per workspace
  // per cooldown even if closes/groups/switches fire in bursts. Time ticks
  // stay due-gated separately — this only throttles the event path.
  const SNAP_EVENT_COOLDOWN_MS = 10 * 60 * 1000;

  function eventDue(lastTs, nowMs, cooldownMs) {
    try {
      const cd = Number.isFinite(Number(cooldownMs)) && Number(cooldownMs) > 0
        ? Number(cooldownMs)
        : SNAP_EVENT_COOLDOWN_MS;
      const now = Number(nowMs);
      if (!Number.isFinite(now) || now < 0) {
        return false;
      }
      const last = Number(lastTs) || 0;
      if (!(last > 0)) {
        return true;
      }
      return now - last >= cd;
    } catch (e) {
      return false;
    }
  }

  return {
    MAX_ENTRIES,
    SNAP_MAX_MANUAL,
    SNAP_MAX_AUTO,
    SNAP_MAX_AUTO_MIN,
    SNAP_MAX_AUTO_MAX,
    SNAP_KEEP_DAILIES_DEFAULT,
    SNAP_KEEP_DAILIES_MIN,
    SNAP_KEEP_DAILIES_MAX,
    SNAP_INTERVAL_DEFAULT_MIN,
    SNAP_INTERVAL_MIN_MIN,
    SNAP_INTERVAL_MAX_MIN,
    SNAP_EVENT_COOLDOWN_MS,
    clampSnapIntervalMin,
    snapshotDue,
    eventDue,
    isArchivableUrl,
    hostOfUrl,
    sanitizeEntries,
    pruneEntries,
    dayLabel,
    groupByDate,
    filterEntries,
    fuzzyEntry,
    fuzzyFilter,
    sortEntries,
    sanitizeSnapTab,
    sanitizeSnapshotGroups,
    sanitizeSnapshots,
    snapshotContentKey,
    savedContentKey,
    slowContentKey,
    savedSlowKey,
    dayKey,
    clampMaxAuto,
    clampKeepDailies,
    pruneSnapshots,
    pruneSnapshotsTiered,
    stashHay,
    fuzzyStashFilter,
    sortStashes,
  };
})();
