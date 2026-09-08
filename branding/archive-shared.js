/* Aph tab archive — shared pure logic (no Firefox deps).
 *
 * Used by the window controller (branding/archive.js, classic script via
 * browser.xhtml) and by the archive page (branding/archive-page.js,
 * chrome://browser/content/aph-archive.html). Classic script on purpose:
 * defines a single global `AphArchiveLogic` so both consumers work without
 * a module system — same pattern as textpick-shared.js. Also loaded
 * directly in node:vm by tests/archive.test.js.
 *
 * Jobs: URL eligibility, entry validation, cap pruning, date grouping and
 * multi-word filtering. All functions are pure and side-effect free.
 */
var AphArchiveLogic = (function () {
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

  return {
    MAX_ENTRIES,
    isArchivableUrl,
    hostOfUrl,
    sanitizeEntries,
    pruneEntries,
    dayLabel,
    groupByDate,
    filterEntries,
  };
})();
