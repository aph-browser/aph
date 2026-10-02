#!/bin/sh
# Shared seed-once profile defaults for the POSIX launchers (AppRun, the
# flatpak wrapper). Canonical implementation — aph.bat mirrors it, and the
# parity pytest in tests_py/test_packaging_parity.py fails if the two
# drift. dev.py (repo/daily flows) is the richer tested implementation for
# Python callers; both follow the same contract: copy config/user.js and
# the chrome CSS seeds in once, never overwrite user edits afterwards.
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

mkdir -p "$PROFILE/chrome"
seed_file "$SHARE/user.js" "$PROFILE/user.js"
seed_file "$SHARE/userChrome.css" "$PROFILE/chrome/userChrome.css"
seed_file "$SHARE/userContent.css" "$PROFILE/chrome/userContent.css"
