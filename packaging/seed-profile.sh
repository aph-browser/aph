#!/bin/sh
# Shared seed-once profile defaults for the POSIX launchers (AppRun, the
# flatpak wrapper). Canonical implementation — aph.bat mirrors it, and the
# parity pytest in tests_py/test_packaging_parity.py fails if the two
# drift. dev.py (repo/daily flows) is the richer tested implementation for
# Python callers; both follow the same contract: copy config/user.js and
# the chrome CSS seeds in once, never overwrite user edits afterwards —
# except when the bundled chrome seed version is newer than the profile
# copy (aph-seed-version stamp), which backs up to .bak and migrates.
# Usage: seed-profile.sh SHARE_DIR PROFILE_DIR
set -eu
SHARE="${1:?usage: seed-profile.sh SHARE_DIR PROFILE_DIR}"
PROFILE="${2:?usage: seed-profile.sh SHARE_DIR PROFILE_DIR}"

# One-time move off the legacy path (never use ~/.aph/profile). Opt-in
# migration — the same explicit block lives in the POSIX launchers; dev.py
# intentionally omits it.
if [ ! -e "$PROFILE" ] && [ -e "$HOME/.aph/profile" ]; then
  mkdir -p "$(dirname "$PROFILE")"
  mv "$HOME/.aph/profile" "$PROFILE"
fi

seed_file() {
  # $1 source, $2 destination — copy once, never overwrite user edits.
  if [ -f "$1" ] && [ ! -f "$2" ]; then
    cp "$1" "$2"
  fi
}

seed_version() {
  # $1 file — print its aph-seed-version stamp (first line), or 0 when
  # absent. Unversioned files predate the scheme and compare equal, so
  # seed-once behavior is unchanged until the bundled copy bumps.
  if [ -f "$1" ]; then
    v=$(grep -o 'aph-seed-version: [0-9][0-9]*' "$1" 2>/dev/null | head -n 1 | grep -o '[0-9][0-9]*' || true)
    echo "${v:-0}"
  else
    echo "0"
  fi
}

seed_chrome() {
  # $1 source, $2 destination — copy once; when the bundled seed version
  # is newer than the profile copy, back the profile copy up to .bak and
  # re-copy (same version never overwrites user edits).
  if [ ! -f "$1" ]; then
    return 0
  fi
  if [ ! -f "$2" ]; then
    cp "$1" "$2"
    return 0
  fi
  if [ "$(seed_version "$1")" -gt "$(seed_version "$2")" ]; then
    cp "$2" "$2.bak"
    cp "$1" "$2"
  fi
}

mkdir -p "$PROFILE/chrome"
seed_file "$SHARE/user.js" "$PROFILE/user.js"
seed_chrome "$SHARE/userChrome.css" "$PROFILE/chrome/userChrome.css"
seed_chrome "$SHARE/userContent.css" "$PROFILE/chrome/userContent.css"
