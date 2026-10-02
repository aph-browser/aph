"""Keep every derived version string in lockstep with pyproject.toml.

Derived files (rewritten in place from [project].version):
- packaging/aur/PKGBUILD: pkgver=
- packaging/aur/.SRCINFO: pkgver + release-URL version
- packaging/flatpak/io.github.aph_browser.Aph.metainfo.xml: newest <release>
- .github/workflows/release.yml: "### What's new in X.Y.Z" heading

Generated (not derived) artifacts are owned elsewhere: winget manifests come
from scripts/winget_manifest.py at release time into packaging/winget/<ver>/
(that directory is gitignored generator output).

``--check`` (CI) fails when any derived file disagrees with pyproject.toml;
bare run rewrites them.
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.version import get_version  # noqa: E402


def _sub(
    path: Path, pattern: re.Pattern[str], repl: str, label: str, apply: bool, bad: list[str]
) -> None:
    text = path.read_text(encoding="utf-8")
    new_text, count = pattern.subn(repl, text, count=1)
    if count != 1:
        bad.append(f"{label}: expected exactly one match in {path}")
        return
    if new_text != text:
        if apply:
            path.write_text(new_text, encoding="utf-8")
        else:
            bad.append(f"{label}: {path} is stale (expected {repl!r})")


def sync(apply: bool) -> list[str]:
    version = get_version()
    bad: list[str] = []
    PKGBUILD = ROOT / "packaging" / "aur" / "PKGBUILD"
    SRCINFO = ROOT / "packaging" / "aur" / ".SRCINFO"
    METAINFO = ROOT / "packaging" / "flatpak" / "io.github.aph_browser.Aph.metainfo.xml"
    RELEASE_YML = ROOT / ".github" / "workflows" / "release.yml"
    _sub(PKGBUILD, re.compile(r"^pkgver=.*$", re.M), f"pkgver={version}", "PKGBUILD", apply, bad)
    _sub(
        SRCINFO,
        re.compile(r"^\tpkgver = .*$", re.M),
        f"\tpkgver = {version}",
        ".SRCINFO",
        apply,
        bad,
    )
    _sub(
        SRCINFO,
        re.compile(r"/releases/download/v[^/]+/"),
        f"/releases/download/v{version}/",
        ".SRCINFO url",
        apply,
        bad,
    )
    if apply:
        _sub(
            METAINFO,
            re.compile(r'<release version="[^"]+" date="[^"]+"/>'),
            f'<release version="{version}" date="{_today()}"/>',
            "metainfo",
            apply,
            bad,
        )
    else:
        text = METAINFO.read_text(encoding="utf-8")
        m = re.search(r'<release version="([^"]+)"', text)
        if not m or m.group(1) != version:
            bad.append(
                f"metainfo: newest release is {m.group(1) if m else '?'}, expected {version}"
            )
    notes_text = RELEASE_YML.read_text(encoding="utf-8")
    if "### What's new in __VER__" not in notes_text:
        bad.append("release notes: heading must be the __VER__ token")
    return bad


def _today() -> str:
    from datetime import date

    return date.today().isoformat()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="fail on drift instead of rewriting")
    args = parser.parse_args()
    bad = sync(apply=not args.check)
    if bad:
        for b in bad:
            print(f"sync_version: {b}", file=sys.stderr)
        if args.check:
            print("Run: just sync-version", file=sys.stderr)
            return 1
    if not args.check:
        print(f"sync_version: derived files aligned with {get_version()}")
    else:
        print(f"sync_version: all derived files match {get_version()}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
