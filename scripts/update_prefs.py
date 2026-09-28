#!/usr/bin/env python3
"""Merge latest Betterfox user.js with Aph native overrides.

On-demand only — never called from dev.py, so launches stay fast and fully
offline. Usage:
    just update-prefs                  # always fetch + regenerate
    just bootstrap                     # fetches only if user.js lacks Betterfox

The output is seed-once defaults: launchers copy it into a profile only on
first launch, so user changes via about:config / Settings persist. Re-apply
on purpose with: just sync-prefs

Firefox applies user.js top-to-bottom ("last line wins"), so Aph's overrides
are appended after Betterfox and take precedence on conflicts.
"""

import argparse
import re
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OVERRIDES_FILE = ROOT / "config" / "user-overrides.js"
TARGET_FILE = ROOT / "config" / "user.js"
BETTERFOX_URL = "https://raw.githubusercontent.com/yokoffing/Betterfox/main/user.js"
MARKER = "Betterfox"
TIMEOUT = 30


BANNER = (
    "// GENERATED — do not edit by hand. "
    "Edit config/user-overrides.js, then run: just update-prefs\n"
    "// Seed-once defaults: copied into a profile on first launch only; "
    "user edits persist. Re-apply with: just sync-prefs\n"
)


# Prefs stripped from the upstream Betterfox block on every merge.
# browser.contentblocking.category: Betterfox pins "strict"; Aph ships the
# stock default instead (policies.json EnableTrackingProtection already
# defaults to standard, unlocked), so tracking protection is never
# force-hardened and the user's choice sticks.
# privacy.resistFingerprinting / privacy.clearOnShutdown.cookies: not set
# by upstream today, but either would break usability (spoofed timezone /
# wiped cookies) if a future Betterfox started pinning it — strip
# pre-emptively so Aph stays on stock behavior.
# browser.cache.disk.enable: Betterfox disables the disk cache; Aph keeps
# stock (enabled) — memory-only caching re-downloads everything on every
# restart while cookies/history stay on disk anyway.
BETTERFOX_STRIP_PREFS = (
    "browser.contentblocking.category",
    "privacy.resistFingerprinting",
    "privacy.clearOnShutdown.cookies",
    "browser.cache.disk.enable",
)

_PREF_RE = re.compile(r"""user_pref\("([^"]+)""")


def fetch_betterfox() -> str:
    req = urllib.request.Request(BETTERFOX_URL, headers={"User-Agent": "aph-update-prefs"})
    with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
        raw = resp.read()
    try:
        return raw.decode("utf-8")
    except UnicodeDecodeError:
        return raw.decode("utf-8", errors="replace")


def merge(betterfox: str, overrides: str) -> str:
    kept = [
        line
        for line in betterfox.rstrip("\n").splitlines()
        if (m := _PREF_RE.search(line)) is None or m.group(1) not in BETTERFOX_STRIP_PREFS
    ]
    parts = [BANNER.rstrip("\n"), "", "\n".join(kept).rstrip("\n"), "", overrides.strip("\n"), ""]
    return "\n".join(parts)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--if-missing",
        action="store_true",
        help="Only fetch when config/user.js lacks Betterfox; "
        "tolerant of offline failures (for bootstrap).",
    )
    args = parser.parse_args()

    if args.if_missing and TARGET_FILE.is_file():
        try:
            if MARKER in TARGET_FILE.read_text(encoding="utf-8"):
                print("config/user.js already contains Betterfox, skipping.")
                return 0
        except OSError as e:
            print(f"Warning: cannot read {TARGET_FILE}: {e}", file=sys.stderr)

    if not OVERRIDES_FILE.is_file():
        print(f"ERROR: {OVERRIDES_FILE} not found.", file=sys.stderr)
        return 1

    try:
        betterfox = fetch_betterfox()
    except Exception as e:
        msg = f"ERROR downloading Betterfox: {e}"
        if args.if_missing:
            # Bootstrap must work offline — keep the existing user.js.
            print(f"{msg} (offline? keeping existing config/user.js)", file=sys.stderr)
            return 0
        print(msg, file=sys.stderr)
        return 1

    if MARKER not in betterfox:
        print("ERROR: download does not look like Betterfox (marker missing).", file=sys.stderr)
        return 1

    overrides = OVERRIDES_FILE.read_text(encoding="utf-8")
    TARGET_FILE.write_text(merge(betterfox, overrides), encoding="utf-8")
    print(f"Wrote {TARGET_FILE} ({len(betterfox.splitlines())} Betterfox lines + Aph overrides).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
