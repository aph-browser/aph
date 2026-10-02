#!/bin/sh
# Aph launcher — seed first-run prefs, then run Firefox with the Aph
# profile. Seeding lives in packaging/seed-profile.sh (single POSIX source
# of truth; aph.bat mirrors it, dev.py is the Python equivalent). The
# AppImage payload ships it at /usr/share/aph/seed-profile.sh (PKGBUILD
# extracts the AppDir into /usr/share), so /usr/bin/aph just delegates.
set -eu
APH_PROFILE="${APH_PROFILE:-$HOME/.config/aph/profile}"
mkdir -p "$APH_PROFILE"
/usr/share/aph/seed-profile.sh /usr/share/aph "$APH_PROFILE"
# No --no-remote so external links reuse the running instance.
exec /opt/aph/firefox --profile "$APH_PROFILE" "$@"
