# Aph

Aph is a Firefox-based, workspaces-first web browser: it repackages upstream Firefox with native workspace management, a command palette, tab archiving, and hardened privacy defaults injected directly into the browser UI — no fork, no recompilation, just the stock binary with Aph overrides applied on every launch.

> **Beta:** Aph 0.x is unsigned and has no auto-update yet. Each release is
> a manual re-download. Windows users will see a SmartScreen warning on
> first launch — this is expected for unsigned software.

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

- Linux: profile lives under `~/.config/aph/profile` (daily install) or
  `./profile` (repo dev runs).
- Windows: profile lives under `%APPDATA%\Aph\profile`.
- On first run Aph seeds `user.js` from its bundled defaults; your edits
  persist afterwards (seed-once). `config/user.js` in the repo is the
  source of those defaults.

## License

[Mozilla Public License 2.0](LICENSE). See [SECURITY.md](SECURITY.md) to
report vulnerabilities.
