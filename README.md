# Aph

Aph is a Firefox-based, workspaces-first web browser: it repackages upstream Firefox with native workspace management, a command palette, tab archiving, and hardened privacy defaults injected directly into the browser UI — no fork, no recompilation, just the stock binary with Aph overrides applied on every launch.

Website: <https://aph-browser.github.io/> · [Releases](https://github.com/aph-browser/aph/releases)

> **Beta:** Aph 0.x is unsigned and has no auto-update yet. Each release is
> a manual re-download. Windows users will see a SmartScreen warning on
> first launch — this is expected for unsigned software.

## Features

- **Workspaces 1–9** (`Alt+Shift+1..9`, `]/[` to cycle, `Tab` for last-used): exclusive model — one workspace renders in at most one window. Switching to a dormant workspace pulls its tabs to you; one that's live elsewhere focus-jumps instead.
- **Command palette** with workspace actions, tab search, bookmarks/history, and archive search.
- **Tab archive** with auto-sweep, container + workspace restore, and staleness tracking.
- **Tree tabs** (automatic 2-level hierarchy), **native tab groups** inside workspaces, **per-workspace container bindings**, **starred tabs**, and **tab unloading**.
- **Privacy defaults**: telemetry, health reports, Normandy, and activity-stream telemetry off (see `config/user.js`); your edits persist (seed-once, below).

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

### Linux — Flatpak

```sh
flatpak install aph-x86_64.flatpak
flatpak run io.github.aph_browser.Aph
```

### Windows — installer or portable ZIP

Run `Aph-Setup-*.exe` (per-user install, no admin rights needed), or
extract `aph-win64-portable.zip` anywhere and run `aph.bat`. Nothing is
written outside the install folder except your profile.

## First run & profiles

- Release builds (AppImage, Flatpak): profile lives under `~/.aph/profile`
  (`APH_PROFILE` overrides the location).
- Repo runs: `./profile` (`just dev`), or `~/.config/aph/profile` for the
  daily driver (`just install-local`, `just daily`).
- Windows: profile lives under `%APPDATA%\Aph\profile`.
- On first run Aph seeds `user.js` from its bundled defaults; your edits
  persist afterwards (seed-once). `config/user.js` in the repo is the
  source of those defaults. Menu accents seed the same way:
  `branding/userChrome.css` → `profile/chrome/userChrome.css`.

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
