# Aph

Aph is a Firefox-based, workspaces-first web browser: it repackages upstream Firefox with native workspace management, a command palette, and hardened privacy defaults injected directly into the browser UI — no fork, no recompilation, just the stock binary with Aph overrides applied on every launch.

Website: <https://aph-browser.github.io/> · [Releases](https://github.com/aph-browser/aph/releases)

> **Beta:** Aph 0.x is unsigned and has no auto-update yet. Upgrades
> are manual re-downloads. Windows users will see a SmartScreen warning on
> first launch — this is expected for unsigned software.

## Features

- **Workspaces 1–9** (`Alt+1..9`, `Alt+Shift+]/[` to cycle, `Ctrl+`` for MRU tabs, `Ctrl+Shift+`` for reverse): window-scoped — every window has its own set, and the same number may show in two windows at once with independent tabs. Windows never move each other's tabs; cross-window moves are explicit (palette / tab right-click → Move Tab to Other Window, arrivals join that window's current workspace). Closing a window is native (SessionStore undo); session restore is per-window native.
- **Command palette** with workspace actions, tab search, bookmarks, and history.
- **Native tab groups** inside workspaces, **per-workspace container bindings**, **starred tabs**, and **tab unloading**.
- **Split view** (`Ctrl+Alt+\` or palette): native side-by-side panes with the most-recently-viewed same-workspace tab; switching workspaces separates the pair, both tabs stay open.
- **Focus mode** (`Ctrl+Alt+F` or palette): hides every chrome surface and leaves only the page; session-only and per-window, palette stays reachable.
- **Workspace accents**: per-workspace hue overrides (16 hues) alongside names, tags, and icons.
- **Privacy defaults**: telemetry, health reports, Normandy, and activity-stream telemetry off (bundled in `browser/omni.ja`); your edits in `about:config` or Aph Settings persist automatically.
- **Firefox onboarding** on first run (stock `about:welcome`) plus an **Aph Settings** page (`chrome://browser/content/aph-settings.html`).

## Install

Download the latest release from
[GitHub Releases](https://github.com/aph-browser/aph/releases)
(mirrored as code-only to GitLab). Verify checksums against `SHA256SUMS`:

```sh
sha256sum -c SHA256SUMS
```

### Linux — AppImage

```sh
chmod +x aph-x86_64.AppImage
./aph-x86_64.AppImage
```

### Windows — Installer

Run `Aph-Setup-*.exe` (per-user install, no admin rights needed). Nothing is
written outside the install folder except your profile.

## First run & profiles

- Release builds (AppImage, Flatpak) and daily driver: profile lives under
  `~/.config/aph/profile` (`APH_PROFILE` overrides the location).
- Repo runs: `./profile` (`just dev`), or `~/.config/aph/profile` for the
  daily driver (`just install-local`, `just daily`).
- Windows: profile lives under `%APPDATA%\Aph\profile`.
- Defaults (Betterfox + Aph privacy overrides, theme styling, and content backdrop)
  are bundled directly inside `browser/omni.ja`. Setting Firefox's default branch natively
  means any customizations you make in `about:config` or Aph Settings stick automatically
  in `prefs.js` without needing profile seeding or `user.js` write-through. Existing
  profiles have legacy seeded files (`user.js`, `chrome/*.css`) retired to `*.migrated`
  automatically.

## Reporting bugs

File issues at [GitHub Issues](https://github.com/aph-browser/aph/issues).
For workspace bugs, include the output of these two Browser Console
(`Ctrl+Shift+J`) commands, run before and after the problem:

```js
Services.wm.getMostRecentWindow("navigator:browser").AphWorkspaces.debugSession()
Services.wm.getMostRecentWindow("navigator:browser").AphWorkspaces.debugExclusive()
```

## License

[Mozilla Public License 2.0](LICENSE). See [SECURITY.md](SECURITY.md) to
report vulnerabilities.
