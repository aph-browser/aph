#!/usr/bin/env python3
"""Lookout: watch Mozilla for Firefox releases newer than the pinned VERSION.

Daily CI (.github/workflows/lookout.yml) runs `--check` and opens a bump
PR when an update ships; `--apply` performs the pin edit.
`just lookout` runs the same check locally.

Exit 0 in all non-error cases so the scheduled run stays green — a newer
release is signal, not failure. Only hard errors (cannot rewrite on
--apply, refusing a downgrade) exit nonzero.
"""

import argparse
import os
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.fetch import VERSION as PINNED_VERSION  # noqa: E402
from scripts.fetch import fetch_latest_version  # noqa: E402

_VERSION_LINE_RE = re.compile(r'^VERSION = "[^"]*"\s*$', re.M)


def parse_version(version: str) -> tuple[int, ...] | None:
    """Numeric release tuple, or None when unparseable.

    Never crashes on upstream shapes (empty, beta tags): unknown input
    means "no signal", and callers treat that as not-newer.
    """
    try:
        parts = version.strip().split(".")
        if not parts or any(not part.isdigit() for part in parts):
            return None
        return tuple(int(part) for part in parts)
    except AttributeError:
        return None


def latest_is_newer(latest: str, pinned: str) -> bool:
    """True only when latest parses AND is strictly ahead of the pin."""
    parsed_latest = parse_version(latest)
    parsed_pinned = parse_version(pinned)
    if parsed_latest is None or parsed_pinned is None:
        return False
    return parsed_latest > parsed_pinned


def check() -> tuple[str | None, str, bool]:
    """Returns (latest_or_None, pinned, update_available).

    A failed upstream query yields (None, pinned, False): the lookout
    reports no signal rather than failing the scheduled run.
    """
    latest = fetch_latest_version()
    if latest is None:
        return None, PINNED_VERSION, False
    return latest, PINNED_VERSION, latest_is_newer(latest, PINNED_VERSION)


def bump_version(root: Path, version: str) -> bool:
    """Rewrite the VERSION pin in root/scripts/fetch.py.

    Returns True only when the file actually changed (idempotent:
    re-applying the current pin is a no-op False).
    """
    target = root / "scripts" / "fetch.py"
    try:
        text = target.read_text(encoding="utf-8")
    except OSError:
        return False
    new_text, count = _VERSION_LINE_RE.subn(f'VERSION = "{version}"', text, count=1)
    if count == 0 or new_text == text:
        return False
    try:
        target.write_text(new_text, encoding="utf-8")
    except OSError:
        return False
    return True


def _write_outputs(latest: str | None, pinned: str, update_available: bool) -> None:
    """Expose the check result to the workflow via GITHUB_OUTPUT (no-op locally)."""
    out = os.environ.get("GITHUB_OUTPUT")
    if not out:
        return
    try:
        with open(out, "a", encoding="utf-8") as f:
            f.write(f"latest={latest or ''}\n")
            f.write(f"pinned={pinned}\n")
            f.write(f"update_available={'true' if update_available else 'false'}\n")
    except OSError as e:
        print(f"Warning: could not write GITHUB_OUTPUT: {e}", file=sys.stderr)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--check",
        action="store_true",
        help="Only check for a newer release (the default when no flag is given).",
    )
    parser.add_argument(
        "--apply",
        nargs="?",
        const="__latest__",
        default=None,
        metavar="VERSION",
        help="Rewrite the VERSION pin (to VERSION, or to latest when bare) "
        "instead of just checking.",
    )
    args = parser.parse_args(argv)

    if args.apply is None:
        latest, pinned, update_available = check()
        if latest is None:
            print("Lookout: could not query Mozilla (offline?) — pin unchanged.")
        elif update_available:
            print(f"Lookout: Firefox {latest} available (pin is {pinned}).")
        else:
            print(f"Lookout: pin {pinned} is current (latest is {latest}).")
        _write_outputs(latest, pinned, update_available)
        return 0

    version = args.apply
    if version == "__latest__":
        version = fetch_latest_version()
        if version is None:
            print(
                "Lookout: could not query Mozilla (offline?) — pin unchanged.",
                file=sys.stderr,
            )
            return 1
    if version == PINNED_VERSION:
        print(f"Lookout: pin already at {version} — nothing to do.")
        return 0
    if not latest_is_newer(version, PINNED_VERSION):
        print(
            f"Lookout: refusing {version!r} (not newer than pin {PINNED_VERSION}).",
            file=sys.stderr,
        )
        return 1
    if bump_version(ROOT, version):
        print(f"Lookout: pin moved {PINNED_VERSION} -> {version}.")
        return 0
    print("Lookout: could not rewrite scripts/fetch.py.", file=sys.stderr)
    return 1


if __name__ == "__main__":
    sys.exit(main())
