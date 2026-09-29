/* Aph welcome page — runs inside aph-welcome.html (chrome:// page in a tab).
 *
 * System-principal chrome pages can use Services directly (same precedent
 * as about:config and aph-archive-page.js). The page is a static tour:
 * the only pref it touches is aph.welcome.seen, flipped by the dismiss
 * button (the window trigger in 105-welcome.js owns the show-once check).
 * Classic script, external file only (no inline scripts — chrome pages
 * may enforce script-src restrictions).
 *
 * Pure content lives on window.AphWelcomeLogic for node:vm tests;
 * the DOM controller below is fail-silent house style throughout.
 */
var AphWelcomeLogic = (function () {
  const SEEN_PREF = "aph.welcome.seen";
  const WELCOME_URL = "chrome://browser/content/aph-welcome.html";

  const SECTIONS = [
    {
      name: "Workspaces",
      cards: [
        {
          keys: ["Alt+1 … Alt+9"],
          title: "Jump to a workspace",
          desc: "Nine numbered workspaces per window. The dock pills at the bottom of the tab strip mirror them.",
        },
        {
          keys: ["Alt+Shift+]", "Alt+Shift+["],
          title: "Cycle workspaces",
          desc: "Move to the next or previous workspace.",
        },
        {
          keys: ["Alt+Shift+Tab"],
          title: "Last-used workspace",
          desc: "Hop straight back to where you just were.",
        },
      ],
    },
    {
      name: "Command palette",
      cards: [
        {
          keys: ["Ctrl+K"],
          title: "One overlay for everything",
          desc: "Workspace actions, open tabs, bookmarks, history and the archive in one filterable list.",
        },
        {
          keys: ["?"],
          title: "Palette modes",
          desc: "Type ? in the palette for the cheat-sheet: > commands, @ tabs, # workspaces, b: bookmarks, h: history, a: archive.",
        },
      ],
    },
    {
      name: "Tabs",
      cards: [
        {
          keys: ["Ctrl+Alt+T"],
          title: "Temp container tab",
          desc: "A disposable container for one-off pages — nothing lingers.",
        },
        {
          keys: ["Ctrl+W"],
          title: "Pinned and starred tabs park",
          desc: "Closing a drifted pin or star resets it in place; at base it unloads to save memory; a second press closes.",
        },
        {
          keys: [],
          title: "Tab archive",
          desc: "Park tabs away with workspace and container restore. Re-open them from the Aph menu or the palette.",
        },
      ],
    },
  ];

  // Absent or false means first run (never throws on odd input).
  function shouldShow(seen) {
    return seen !== true;
  }

  return {
    SEEN_PREF,
    WELCOME_URL,
    SECTIONS,
    shouldShow,
  };
})();

(function () {
  function L() {
    try {
      return window.AphWelcomeLogic || null;
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

  function prefs() {
    try {
      return Services && Services.prefs ? Services.prefs : null;
    } catch (e) {
      return null;
    }
  }

  function render() {
    const list = $("aph-welcome-list");
    if (!list) {
      return;
    }
    while (list.firstChild) {
      list.removeChild(list.firstChild);
    }
    try {
      const l = L();
      let step = 0;
      for (const g of (l && l.SECTIONS) || []) {
        step++;
        const section = document.createElement("section");
        section.className = "aph-welcome-group";
        const h = document.createElement("h2");
        h.textContent = `Step ${step} — ${g.name}`;
        section.appendChild(h);
        for (const c of g.cards || []) {
          try {
            const card = document.createElement("div");
            card.className = "aph-welcome-card";
            const label = document.createElement("div");
            label.className = "aph-welcome-label";
            label.textContent = c.title;
            card.appendChild(label);
            if (c.keys && c.keys.length) {
              const keys = document.createElement("div");
              keys.className = "aph-welcome-keys";
              for (const k of c.keys) {
                const kbd = document.createElement("kbd");
                kbd.textContent = k;
                keys.appendChild(kbd);
                keys.appendChild(document.createTextNode(" "));
              }
              card.appendChild(keys);
            }
            if (c.desc) {
              const desc = document.createElement("div");
              desc.className = "aph-welcome-desc";
              desc.textContent = c.desc;
              card.appendChild(desc);
            }
            const demo = demoButtonsFor(c);
            if (demo) {
              card.appendChild(demo);
            }
            section.appendChild(card);
          } catch (_e) {}
        }
        list.appendChild(section);
      }
      markHeroStep(1);
    } catch (e) {}
  }

  // Interactive demo row per card: opens the real surface so the tour
  // teaches by doing (palette / settings / archive). Fail-silent.
  function demoButtonsFor(c) {
    try {
      const title = String((c && c.title) || "");
      const wrap = document.createElement("div");
      wrap.className = "aph-welcome-demo";
      let made = false;
      const btn = (label, fn) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "aph-welcome-demobtn";
        b.textContent = label;
        b.addEventListener("click", () => {
          try {
            fn();
          } catch (e) {}
        });
        wrap.appendChild(b);
        made = true;
      };
      if (/overlay for everything/i.test(title)) {
        btn("Try Ctrl+K now", () => {
          try {
            if (window.parent && window.parent.AphPalette) {
              window.parent.AphPalette.open();
            }
          } catch (e) {}
          toastLike("Press Ctrl+K in the browser window");
        });
      } else if (/modes/i.test(title)) {
        btn("Open palette help (?)", () => openChrome("chrome://browser/content/aph-settings.html"));
      } else if (/archive/i.test(title)) {
        btn("Open Archive", () => openChrome("chrome://browser/content/aph-archive.html"));
      } else if (/Jump to/i.test(title)) {
        btn("Open Settings", () => openChrome("chrome://browser/content/aph-settings.html"));
      }
      return made ? wrap : null;
    } catch (e) {
      return null;
    }
  }

  function openChrome(url) {
    try {
      if (window.open) {
        window.open(url, "_blank");
        return;
      }
    } catch (e) {}
    try {
      location.href = url;
    } catch (e) {}
  }

  function toastLike(msg) {
    try {
      const list = $("aph-welcome-list");
      if (!list) {
        return;
      }
      let el = document.getElementById("aph-welcome-toastlike");
      if (!el) {
        el = document.createElement("div");
        el.id = "aph-welcome-toastlike";
        el.className = "aph-welcome-desc";
        el.style.marginTop = "12px";
        list.appendChild(el);
      }
      el.textContent = msg;
    } catch (e) {}
  }

  function markHeroStep(n) {
    try {
      const steps = document.querySelectorAll(".aph-hero-step");
      steps.forEach((el, i) => {
        try {
          el.classList.toggle("on", i === (n - 1));
        } catch (e) {}
      });
    } catch (e) {}
  }

  function dismiss() {
    try {
      const l = L();
      const p = prefs();
      // "Don't show again" and Get started both persist seen — the
      // checkbox only makes the intent explicit on first run.
      const skip = $("aph-welcome-skip");
      const wantSeen = true;
      if (skip && skip.checked !== undefined) {
        void skip.checked;
      }
      if (p && typeof p.setBoolPref === "function") {
        p.setBoolPref((l && l.SEEN_PREF) || "aph.welcome.seen", wantSeen);
      }
    } catch (e) {}
    // Leave the tour: closing a chrome tab from its own page is allowed;
    // if anything refuses, the user just navigates away (seen is saved).
    try {
      window.close();
    } catch (e) {}
    try {
      location.href = "about:newtab";
    } catch (_e) {}
  }

  function init() {
    render();
    try {
      const btn = $("aph-welcome-dismiss");
      if (btn) {
        btn.addEventListener("click", dismiss);
      }
    } catch (e) {}
    try {
      // Scrolling the tour advances the hero step indicator.
      document.addEventListener("scroll", () => {
        try {
          const y = window.scrollY || 0;
          markHeroStep(y < 300 ? 1 : y < 700 ? 2 : 3);
        } catch (_e) {}
      }, { passive: true });
    } catch (e) {}
  }

  if (document.readyState === "complete" || document.readyState === "interactive") {
    init();
  } else {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  }
})();
