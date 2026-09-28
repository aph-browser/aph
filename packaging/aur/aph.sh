#!/bin/sh
# Aph launcher — mirrors packaging/AppRun: seed first-run prefs,
# then run Firefox with the Aph profile.
set -eu
APH_PROFILE="${APH_PROFILE:-$HOME/.config/aph/profile}"
# One-time move off the legacy path (never use ~/.aph/profile).
if [ ! -e "$APH_PROFILE" ] && [ -e "$HOME/.aph/profile" ]; then mkdir -p "$(dirname "$APH_PROFILE")"; mv "$HOME/.aph/profile" "$APH_PROFILE"; fi
mkdir -p "$APH_PROFILE"
# Seed-once defaults: never overwrite an existing user.js (user edits persist).
if [ ! -f "$APH_PROFILE/user.js" ]; then cp -f /usr/share/aph/user.js "$APH_PROFILE/user.js"; fi
# Seed-once menu accents: never overwrite user edits.
mkdir -p "$APH_PROFILE/chrome"
if [ ! -f "$APH_PROFILE/chrome/userChrome.css" ]; then cp -f /usr/share/aph/userChrome.css "$APH_PROFILE/chrome/userChrome.css"; fi
# Seed-once new-tab backdrop: never overwrite user edits.
if [ ! -f "$APH_PROFILE/chrome/userContent.css" ]; then cp -f /usr/share/aph/userContent.css "$APH_PROFILE/chrome/userContent.css"; fi
# No --no-remote so external links reuse the running instance.
exec /opt/aph/firefox --profile "$APH_PROFILE" "$@"
