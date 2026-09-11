"""Packaging parity: every launcher must seed userChrome.css like dev.py.

Regression guard for the Flatpak/AppImage/Windows drift where production
launchers copied only user.js, so installs never got the menu accents.
Each launcher below must reference a seed-once userChrome.css copy, and
both CI workflows must stage branding/userChrome.css into every package
layout (AppDir, flatpak-stage, win-portable); the Flatpak manifest must
install the staged file to /app/share/aph/.
"""

from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

SH_LAUNCHERS = [
    "packaging/AppRun",
    "packaging/flatpak/aph",
]

WIN_LAUNCHERS = [
    "packaging/aph.bat",
]


def test_posix_launchers_seed_chrome_css() -> None:
    for rel in SH_LAUNCHERS:
        text = (ROOT / rel).read_text(encoding="utf-8")
        assert "chrome/userChrome.css" in text, rel
        assert "userChrome.css" in text, rel


def test_windows_launchers_seed_chrome_css() -> None:
    for rel in WIN_LAUNCHERS:
        text = (ROOT / rel).read_text(encoding="utf-8")
        assert "userChrome.css" in text, rel


def test_install_local_launcher_seeds_chrome_css() -> None:
    text = (ROOT / "justfile").read_text(encoding="utf-8")
    assert "branding/userChrome.css" in text
    assert "chrome/userChrome.css" in text


def test_workflows_stage_chrome_css() -> None:
    for workflow in (
        ".github/workflows/release.yml",
        ".github/workflows/build-test.yml",
    ):
        text = (ROOT / workflow).read_text(encoding="utf-8")
        assert "branding/userChrome.css build/AppDir/usr/share/aph/userChrome.css" in text, workflow
        assert "branding/userChrome.css build/flatpak-stage/userChrome.css" in text, workflow
        assert "branding/userChrome.css build/win-portable/config/userChrome.css" in text, workflow


def test_flatpak_manifest_installs_chrome_css() -> None:
    text = (ROOT / "packaging/flatpak/io.github.aph_browser.Aph.yml").read_text(encoding="utf-8")
    assert "stage/userChrome.css /app/share/aph/userChrome.css" in text
