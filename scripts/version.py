"""Single source of truth for the Aph version: pyproject.toml [project].version.

Every other versioned artifact (AUR PKGBUILD, .SRCINFO, flatpak metainfo,
release notes heading, winget manifests) is derived from this one value —
see scripts/sync_version.py. Bump by editing pyproject.toml, then run
``just sync-version``; ``just check`` fails if the derived files drift.
"""

from __future__ import annotations

import re
import tomllib
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PYPROJECT = ROOT / "pyproject.toml"

_VERSION_LINE_RE = re.compile(r'^version = "([^"]+)"$', re.M)


def get_version() -> str:
    with PYPROJECT.open("rb") as f:
        data = tomllib.load(f)
    try:
        return str(data["project"]["version"])
    except KeyError as e:
        raise ValueError(f"{PYPROJECT} has no [project].version") from e


def set_version(version: str) -> bool:
    """Rewrite [project].version. Returns True when the file changed."""
    text = PYPROJECT.read_text(encoding="utf-8")
    new_text, count = _VERSION_LINE_RE.subn(f'version = "{version}"', text, count=1)
    if count != 1:
        raise ValueError(f"{PYPROJECT}: expected exactly one project version line")
    if new_text == text:
        return False
    PYPROJECT.write_text(new_text, encoding="utf-8")
    return True
