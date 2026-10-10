"""Seed-profile.sh is the single POSIX source of truth for seed-once
profile defaults; every POSIX launcher (AppRun, flatpak wrapper) defers to
it, aph.bat mirrors it, dev.py is the Python equivalent for repo flows."""

import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SEED = ROOT / "packaging" / "seed-profile.sh"

SHARE_FILES = ("user.js", "userChrome.css", "userContent.css")


def _make_share(tmp: Path) -> Path:
    share = tmp / "share"
    share.mkdir()
    for name in SHARE_FILES:
        (share / name).write_text(f"// seed {name}\n", encoding="utf-8")
    return share


def _run_seed(share: Path, profile: Path) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["sh", str(SEED), str(share), str(profile)],
        check=False,
        capture_output=True,
        text=True,
    )


def test_seed_populates_fresh_profile(tmp_path: Path) -> None:
    share = _make_share(tmp_path)
    profile = tmp_path / "profile"
    result = _run_seed(share, profile)
    assert result.returncode == 0, result.stderr
    for name in SHARE_FILES:
        dst = profile / ("chrome" if name.endswith(".css") else "") / name
        assert dst.read_text(encoding="utf-8") == f"// seed {name}\n", name


def test_seed_never_overwrites(tmp_path: Path) -> None:
    share = _make_share(tmp_path)
    profile = tmp_path / "profile"
    _run_seed(share, profile)
    for name in SHARE_FILES:
        dst = profile / ("chrome" if name.endswith(".css") else "") / name
        dst.write_text("// user edit\n", encoding="utf-8")
    _run_seed(share, profile)
    for name in SHARE_FILES:
        dst = profile / ("chrome" if name.endswith(".css") else "") / name
        assert dst.read_text(encoding="utf-8") == "// user edit\n", name


def _stamped(text: str, version: int) -> str:
    return f"/* aph-seed-version: {version} */\n{text}"


def test_seed_migrates_chrome_on_version_bump(tmp_path: Path) -> None:
    """A newer bundled chrome seed backs the profile copy up to .bak and
    migrates; same-version user edits still persist; user.js stays
    seed-once (never versioned, never migrated)."""
    share = _make_share(tmp_path)
    for name in ("userChrome.css", "userContent.css"):
        (share / name).write_text(_stamped(f"/* bundled {name} */\n", 2), encoding="utf-8")
    profile = tmp_path / "profile"
    (profile / "chrome").mkdir(parents=True)
    for name in ("userChrome.css", "userContent.css"):
        (profile / "chrome" / name).write_text(_stamped("/* user edit */\n", 1), encoding="utf-8")
    (profile / "user.js").write_text("// user prefs\n", encoding="utf-8")
    result = _run_seed(share, profile)
    assert result.returncode == 0, result.stderr
    for name in ("userChrome.css", "userContent.css"):
        dst = profile / "chrome" / name
        assert dst.read_text(encoding="utf-8") == _stamped(f"/* bundled {name} */\n", 2), name
        bak = profile / "chrome" / f"{name}.bak"
        assert bak.read_text(encoding="utf-8") == _stamped("/* user edit */\n", 1), bak
    assert (profile / "user.js").read_text(encoding="utf-8") == "// user prefs\n"
    # Second run holds: same versions, no new backups, no churn.
    result = _run_seed(share, profile)
    assert result.returncode == 0, result.stderr
    for name in ("userChrome.css", "userContent.css"):
        assert (profile / "chrome" / name).read_text(encoding="utf-8") == _stamped(
            f"/* bundled {name} */\n", 2
        ), name


def test_posix_launchers_defer_to_shared_script() -> None:
    apprun = (ROOT / "packaging" / "AppRun").read_text(encoding="utf-8")
    flatpak = (ROOT / "packaging" / "flatpak" / "aph").read_text(encoding="utf-8")
    for text in (apprun, flatpak):
        assert "seed-profile.sh" in text
        # The inline cp-once blocks must NOT be copied back in: the launcher
        # defers to the shared script instead.
        assert 'cp -f "$PROFILE/' not in text.replace("$APH_PROFILE", "$PROFILE")
        assert "cp " not in text.split("seed-profile.sh")[1]


def test_bat_mirrors_shared_seed_contract() -> None:
    bat = (ROOT / "packaging" / "aph.bat").read_text(encoding="utf-8")
    for name in SHARE_FILES:
        assert f"{name}" in bat, name
    for token in ("if not exist", "copy /Y", "userChrome.css", "userContent.css"):
        assert token in bat


def test_dev_py_seeds_same_three_files() -> None:
    dev = (ROOT / "scripts" / "dev.py").read_text(encoding="utf-8")
    for token in ("config", "user.js", "userChrome.css", "userContent.css"):
        assert token in dev
