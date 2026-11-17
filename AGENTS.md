# AGENTS.md

Aph injects a lightweight workspace + privacy layer into stock Firefox (`omni.ja`), with no browser fork or recompilation.

## Repo Layout & Generated Files
- `branding/src/workspaces/` and `branding/src/palette/`: source JS. **Do not hand-edit** `branding/workspaces.js` or `branding/command-palette.js` — rebuild with `just build-assets`.
- `config/user-overrides.js`: Aph default prefs. **Do not hand-edit** `config/default-prefs.js` — regenerate with `just update-prefs`.
- `branding/theme.css`, `branding/tokens.css`, `branding/command-palette.css`: injected chrome styles.
- `scripts/aph_rebrand/`: Python `omni.ja` patcher (`ZIP_STORED` only, always reads `.ja.bak`).

## Rules (Keep It Simple & Cheap)
- **Prefer deleting over adding.** Do not invent new features, prefs, UI panels, or Firefox-internal monkey-patches unless explicitly asked.
- **Stop copying old `try/catch` boilerplate.** Use optional chaining (`?.`) for reads and at most one `try/catch` at an entry point (event handler / XPCOM boundary) instead of wrapping individual lines.
- **Keep CSS minimal.** Do not add `!important` overrides skinning stock Firefox chrome (urlbar, menus, sidebar geometry) unless requested; support both dark and light (`prefers-color-scheme`) without hardcoded `rgba()` overlays.
- **Firefox XHTML rules:** `browser.xhtml` is XHTML—use `document.createXULElement()` for XUL elements (`menuitem`, `menupopup`, `toolbarbutton`), never `innerHTML`. Never declare implicit globals (`no-undef`).

## Verification
After edits, run:
- `just check` (ruff + bundle freshness + pytest + node tests)
- `npx oxlint branding/src/` (or `npm run lint`) on JS changes