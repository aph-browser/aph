set shell := ["bash", "-cu"]

default:
    @just --list

# Full bootstrap: download, extract, rebrand, and launch
bootstrap:
    uv run python scripts/fetch.py
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
rebrand:
    uv run python scripts/rebrand.py

# Show profile and build status
status:
    @echo "profile: $(test -d profile && echo exists || echo missing)"
    @echo "config: $(test -f config/user.js && echo ready || echo missing)"
    @test -f profile/user.js && diff -u config/user.js profile/user.js | head -n 20 || echo "profile user.js not yet copied (run: just dev)"
    @echo "omni.ja: $(test -f build/firefox/browser/omni.ja.bak && echo rebranded || echo original)"
    @test -f build/firefox/browser/omni.ja && uv run python -c "import zipfile; print(open('build/firefox/browser/omni.ja','rb').read().find(b'Aph'))" | grep -q "^-1" && echo "brand: Firefox" || echo "brand: Aph"

# Delete profile (full wipe) - explicit command
nuke:
    rm -rf profile
    rm -f profile/.purgecache_done
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
