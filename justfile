set shell := ["bash", "-cu"]

default:
    @just --list

# Full bootstrap: download, extract, prefs, rebrand, and launch
bootstrap:
    uv run python scripts/fetch.py
    uv run python scripts/update_prefs.py --if-missing
    just rebrand
    @echo "Ready to launch: just dev"

# Download and extract Firefox into build/
setup *args:
    uv run python scripts/fetch.py {{args}}

# Remove current Firefox and re-download
refetch *args:
    rm -rf build/firefox
    uv run python scripts/fetch.py {{args}}

# Launch Firefox with Aph profile (replaces ./dev.sh)
dev *args:
    uv run python scripts/dev.py {{args}}

# Alias for dev
run *args: (dev args)

# Force rebrand of browser/omni.ja (ZIP_STORED, backup -> .bak)
# Rebuilds generated browser bundles from branding/src/ first.
rebrand:
    uv run python scripts/build_assets.py
    uv run python scripts/rebrand.py

# Rebuild generated browser bundles (branding/src/ -> branding/*.js)
build-assets:
    uv run python scripts/build_assets.py

# Verify committed bundles match branding/src/ (CI guard)
check-assets:
    uv run python scripts/build_assets.py --check

# Python lint + format check
lint:
    uv tool run ruff check scripts/ tests_py/
    uv tool run ruff format --check scripts/ tests_py/

# Python unit tests (omni helpers, xhtml injection, patcher, bundles)
test-py:
    uv run --group dev pytest tests_py/ -q

# All static gates: lint + asset freshness + python + node harness tests
check: lint check-assets test-py test

# Download latest Betterfox and merge with Aph overrides into config/user.js
# (seed-once: only affects fresh profiles until `just sync-prefs`)
update-prefs:
    uv run python scripts/update_prefs.py

# Force re-apply config/user.js over a profile (backs up user.js to user.js.bak).
# Next launch Firefox applies it over prefs.js, overwriting user edits to listed
# prefs. Defaults to the repo profile; `just sync-prefs local` targets the daily
# profile at ~/.config/aph/profile. Quit Aph on that profile first.
sync-prefs *args:
    uv run python -c "import sys; sys.path.insert(0, '.'); from scripts.dev import sync_user_js; from pathlib import Path; sync_user_js(Path('.').resolve(), Path.home() / '.config' / 'aph' / 'profile' if '{{args}}' == 'local' else Path('.').resolve() / 'profile')"

# Force re-apply branding/userChrome.css over a profile (backs up existing
# to userChrome.css.bak). Same profile selection and quit-first rule as sync-prefs.
sync-chrome *args:
    uv run python -c "import sys; sys.path.insert(0, '.'); from scripts.dev import sync_chrome_css; from pathlib import Path; sync_chrome_css(Path('.').resolve(), Path.home() / '.config' / 'aph' / 'profile' if '{{args}}' == 'local' else Path('.').resolve() / 'profile')"

# Run node harness tests for the injected browser scripts
test:
    node --test "tests/*.test.js"

# Pack the repo for LLM context (repomix-output.xml, gitignored). Excludes
# the generated bundles (branding/workspaces.js, branding/command-palette.js)
# — byte-derivable from branding/src/, so including them doubles ~3.5k lines.
repomix:
    bunx repomix --ignore "branding/workspaces.js,branding/command-palette.js"

# Show profile and build status
status:
    @echo "profile: $(test -d profile && echo exists || echo missing)"
    @echo "config: $(test -f config/user.js && echo ready || echo missing)"
    @test -f profile/user.js && diff -u config/user.js profile/user.js | head -n 20 || echo "profile user.js not yet seeded (run: just dev)"
    @echo "prefs: seed-once (user edits persist; \`just sync-prefs\` to re-apply config)"
    @echo "omni.ja: $(test -f build/firefox/browser/omni.ja.bak && echo rebranded || echo original)"
    @test -f build/firefox/browser/omni.ja && uv run python -c "print(open('build/firefox/browser/omni.ja','rb').read().find(b'Aph'))" | grep -q "^-1" && echo "brand: Firefox" || echo "brand: Aph"

# Delete profile (full wipe) - explicit command
nuke:
    rm -rf profile
    @echo "profile deleted"

# Clean test profile (alias of nuke)
clean: nuke

# Alias: clear-profile
clear-profile: nuke
wipe: nuke

# Restore original omni.ja and policies.json from pristine backups
restore:
    test -f build/firefox/browser/omni.ja.bak && cp build/firefox/browser/omni.ja.bak build/firefox/browser/omni.ja || true
    test -f build/firefox/omni.ja.bak && cp build/firefox/omni.ja.bak build/firefox/omni.ja || true
    test -f build/firefox/distribution/policies.json.bak && cp build/firefox/distribution/policies.json.bak build/firefox/distribution/policies.json || true
    @echo "Restored pristine omni.ja and policies.json"

# Install Aph as a daily driver: desktop launcher + icon + persistent
# profile at ~/.config/aph/profile (outside the repo, safe from `just nuke`).
# The launcher drops --no-remote (unlike `just dev`) so external links from
# Slack/Discord/terminals open in the running Aph instance.
install-local:
    just rebrand
    uv run python -c "import sys; sys.path.insert(0, '.'); from scripts.dev import merge_policies; from pathlib import Path; merge_policies(Path('.').resolve())"
    mkdir -p "$HOME/.local/bin" "$HOME/.local/share/applications" "$HOME/.local/share/icons/hicolor/128x128/apps" "$HOME/.config/aph/profile"
    cp branding/aph.png "$HOME/.local/share/icons/hicolor/128x128/apps/aph.png"
    printf '%s\n' '#!/bin/sh' '# Aph daily launcher (installed by `just install-local`).' '# Seed-once prefs (dev.py parity). No --no-remote so' '# external links reuse the running instance.' 'set -eu' 'PROFILE="$HOME/.config/aph/profile"' 'APH_ROOT="{{justfile_directory()}}"' 'mkdir -p "$PROFILE"' 'if [ ! -f "$PROFILE/user.js" ]; then cp -f "$APH_ROOT/config/user.js" "$PROFILE/user.js"; fi' 'exec "$APH_ROOT/build/firefox/firefox" --profile "$PROFILE" "$@"' > "$HOME/.local/bin/aph"
    chmod +x "$HOME/.local/bin/aph"
    sed "s|^Exec=.*|Exec=$HOME/.local/bin/aph %u|" packaging/aph.desktop > "$HOME/.local/share/applications/aph.desktop"
    update-desktop-database "$HOME/.local/share/applications" 2>/dev/null || true
    @echo "Aph installed: ~/.local/bin/aph + launcher + icon. Daily profile: ~/.config/aph/profile"

# Remove the files installed by install-local (daily profile is kept)
uninstall-local:
    rm -f "$HOME/.local/bin/aph" "$HOME/.local/share/applications/aph.desktop" "$HOME/.local/share/icons/hicolor/128x128/apps/aph.png"
    update-desktop-database "$HOME/.local/share/applications" 2>/dev/null || true
    @echo "Aph uninstalled (daily profile kept at ~/.config/aph/profile)"

# Delete the daily local profile at ~/.config/aph/profile (cookies, logins,
# history). Requires --yes and refuses while Aph is running on it.
nuke-local *args:
    @if [ "{{args}}" != "--yes" ] && [ "{{args}}" != "-y" ]; then echo "This deletes ~/.config/aph/profile (cookies, logins, history). Re-run with --yes: just nuke-local --yes"; exit 1; fi
    @if lock="$HOME/.config/aph/profile/lock" && [ -L "$lock" ] && pid="$(readlink "$lock")" && pid="${pid##*:}" && pid="${pid#+}" && kill -0 "$pid" 2>/dev/null; then echo "Aph is running on the daily profile - quit it first."; exit 1; fi
    : "${HOME:?}"
    rm -rf "$HOME/.config/aph/profile"
    @echo "daily profile deleted"
