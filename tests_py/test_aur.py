"""AUR packaging: PKGBUILD stays in sync with the tagged version.

Guards against a stale pkgver (users building an old AppImage) or a source
URL that drifted from the release asset layout. The AppImage sha256 itself
is verified by makepkg at build time, so here we only assert shape.
"""

import re
import tomllib
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
AUR = ROOT / "packaging" / "aur"
PKGBUILD = AUR / "PKGBUILD"
SRCINFO = AUR / ".SRCINFO"


def _project_version() -> str:
    with open(ROOT / "pyproject.toml", "rb") as f:
        return tomllib.load(f)["project"]["version"]


def _pkgbuild_field(name: str) -> str:
    m = re.search(rf"^{name}=([^\n]+)", PKGBUILD.read_text(encoding="utf-8"), re.M)
    assert m, f"{name} missing from PKGBUILD"
    return m.group(1).strip().strip("'\"")


def test_pkgver_matches_project_version() -> None:
    assert _pkgbuild_field("pkgver") == _project_version()


def test_source_url_tracks_release_asset() -> None:
    text = PKGBUILD.read_text(encoding="utf-8")
    assert "releases/download/v${pkgver}/aph-x86_64.AppImage" in text


def test_appimage_sha_is_pinned() -> None:
    m = re.search(r"sha256sums=\(\s*'([0-9a-f]{64})'", PKGBUILD.read_text(encoding="utf-8"))
    assert m, "AppImage sha256 must be pinned (64 hex chars)"


def test_srcinfo_matches_pkgbuild() -> None:
    text = SRCINFO.read_text(encoding="utf-8")
    assert f"pkgver = {_pkgbuild_field('pkgver')}" in text
    assert "pkgname = aph-bin" in text


def test_launcher_exists_and_seeds() -> None:
    text = (AUR / "aph.sh").read_text(encoding="utf-8")
    assert "/opt/aph/firefox" in text
    assert "user.js" in text and "userChrome.css" in text
