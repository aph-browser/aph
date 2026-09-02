set shell := ["bash", "-cu"]

default:
    @just --list

# Launch LibreWolf with Aph profile (replaces ./dev.sh)
dev *args:
    uv run python scripts/dev.py {{args}}

# Alias for dev
run *args: (dev args)

# Force rebrand of browser/omni.ja (ZIP_STORED, backup -> .bak)
rebrand:
    uv run python scripts/rebrand.py

# Show profile and overrides status
status:
    @echo "profile: $(test -d profile && echo exists || echo missing)"
    @echo "overrides: $(test -f config/librewolf.overrides.cfg && echo ready || echo missing)"
    @test -f profile/librewolf.overrides.cfg && diff -u config/librewolf.overrides.cfg profile/librewolf.overrides.cfg | head -n 20 || echo "profile overrides not yet copied (run: just dev)"
    @echo "omni.ja: $(test -f build/librewolf/browser/omni.ja.bak && echo rebranded || echo original)"
    @test -f build/librewolf/browser/omni.ja && uv run python -c "import zipfile; print(open('build/librewolf/browser/omni.ja','rb').read().find(b'Aph'))" | grep -q "^-1" && echo "brand: LibreWolf" || echo "brand: Aph"

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

# Restore original omni.ja from backup
restore:
    test -f build/librewolf/browser/omni.ja.bak && cp build/librewolf/browser/omni.ja.bak build/librewolf/browser/omni.ja && echo "restored" || echo "no backup"
