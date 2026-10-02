"""Packaging parity: every launcher must seed chrome CSS like dev.py.

Regression guard for the Flatpak/AppImage/Windows drift where production
launchers copied only user.js, so installs never got the menu accents —
and later never got the new-tab backdrop either. Each launcher below must
reference a seed-once copy of both userChrome.css and userContent.css,
and both CI workflows must stage both files into every package layout
(AppDir, flatpak-stage, win-portable); the Flatpak manifest must install
both staged files to /app/share/aph/.
"""

from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

SH_LAUNCHERS = [
    "packaging/AppRun",
    "packaging/flatpak/aph",
    "packaging/aur/aph.sh",
]

WIN_LAUNCHERS = [
    "packaging/aph.bat",
]

CHROME_FILES = ("userChrome.css", "userContent.css")


def test_posix_launchers_seed_chrome() -> None:
    """Launchers defer to the shared seed-profile.sh, which seeds both
    chrome CSS files exactly like dev.py."""
    script = (ROOT / "packaging" / "seed-profile.sh").read_text(encoding="utf-8")
    for name in CHROME_FILES:
        assert name in script, name
    assert "Seed-once" in script or "seed" in script
    for rel in SH_LAUNCHERS:
        text = (ROOT / rel).read_text(encoding="utf-8")
        assert "seed-profile.sh" in text, (rel, "must delegate")
        # The inline cp-once copies must be gone (drift guard): no direct
        # references to the staged chrome files from the launcher itself.
        assert "userChrome.css" not in text or text.count("userChrome.css") <= 1
        assert "userContent.css" not in text or text.count("userContent.css") <= 1


def test_windows_launchers_seed_chrome() -> None:
    for rel in WIN_LAUNCHERS:
        text = (ROOT / rel).read_text(encoding="utf-8")
        for name in CHROME_FILES:
            assert name in text, (rel, name)


def test_install_local_launcher_matches_dev_freshness() -> None:
    """install-local must delegate to dev.py --daily (not a frozen copy of
    its seed logic), so installs get seed/policies/rebrand parity with dev
    and never drift again (cf. the Flatpak/AppImage userChrome.css drift).
    """
    text = (ROOT / "justfile").read_text(encoding="utf-8")
    local = text.split("install-local:", 1)[1].split("\nuninstall-local:", 1)[0]
    assert "scripts/dev.py --daily" in local, "launcher must delegate to dev.py"
    # No divergent inline seed copies: dev.py owns seeding now.
    assert 'PROFILE="$HOME/.config/aph/profile"' not in local
    assert "branding/userChrome.css" not in local
    dev = (ROOT / "scripts" / "dev.py").read_text(encoding="utf-8")
    assert "seed_chrome_css" in dev, "daily path must seed menu accents"
    assert "merge_policies" in dev, "daily path must merge policies"
    assert "ensure_rebranded" in dev, "daily path must rebrand when stale"


def test_workflows_stage_chrome() -> None:
    for workflow in (
        ".github/workflows/release.yml",
        ".github/workflows/build-test.yml",
    ):
        text = (ROOT / workflow).read_text(encoding="utf-8")
        assert "branding/userChrome.css build/AppDir/usr/share/aph/userChrome.css" in text, workflow
        assert "branding/userChrome.css build/flatpak-stage/userChrome.css" in text, workflow
        assert "branding/userChrome.css build/win-portable/config/userChrome.css" in text, workflow
        assert "branding/userContent.css build/AppDir/usr/share/aph/userContent.css" in text, (
            workflow
        )
        assert "branding/userContent.css build/flatpak-stage/userContent.css" in text, workflow
        assert "branding/userContent.css build/win-portable/config/userContent.css" in text, (
            workflow
        )


def test_flatpak_manifest_installs_chrome() -> None:
    text = (ROOT / "packaging/flatpak/io.github.aph_browser.Aph.yml").read_text(encoding="utf-8")
    assert "stage/userChrome.css /app/share/aph/userChrome.css" in text
    assert "stage/userContent.css /app/share/aph/userContent.css" in text
