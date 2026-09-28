"""Seed-once prefs: launchers must never overwrite an existing profile/user.js."""

import json
import os
import re
import tempfile
from pathlib import Path

import pytest

from scripts.dev import profile_locked, resolve_launch, seed_user_js, sync_user_js


def _make_root(tmp_path: Path, user_js: str | None = 'user_pref("a.b", true);\n') -> Path:
    root = tmp_path / "root"
    (root / "config").mkdir(parents=True)
    if user_js is not None:
        (root / "config" / "user.js").write_text(user_js, encoding="utf-8")
    return root


def test_seed_creates_on_first_launch(tmp_path: Path) -> None:
    root = _make_root(tmp_path)
    profile = tmp_path / "profile"
    profile.mkdir()
    assert seed_user_js(root, profile) == "seeded"
    assert (profile / "user.js").read_text(encoding="utf-8") == 'user_pref("a.b", true);\n'


def test_seed_keeps_existing_user_edits(tmp_path: Path) -> None:
    root = _make_root(tmp_path)
    profile = tmp_path / "profile"
    profile.mkdir()
    custom = 'user_pref("a.b", false); // user changed this\n'
    (profile / "user.js").write_text(custom, encoding="utf-8")
    assert seed_user_js(root, profile) == "kept"
    assert (profile / "user.js").read_text(encoding="utf-8") == custom


def test_seed_missing_source(tmp_path: Path) -> None:
    root = _make_root(tmp_path, user_js=None)
    profile = tmp_path / "profile"
    profile.mkdir()
    assert seed_user_js(root, profile) == "missing-source"
    assert not (profile / "user.js").exists()


def test_sync_overwrites_with_backup(tmp_path: Path) -> None:
    root = _make_root(tmp_path)
    profile = tmp_path / "profile"
    profile.mkdir()
    old = 'user_pref("a.b", false);\n'
    (profile / "user.js").write_text(old, encoding="utf-8")
    sync_user_js(root, profile)
    assert (profile / "user.js").read_text(encoding="utf-8") == 'user_pref("a.b", true);\n'
    assert (profile / "user.js.bak").read_text(encoding="utf-8") == old


def test_sync_wipes_stale_caches(tmp_path: Path) -> None:
    """A sync must invalidate the about:newtab/chrome caches.

    Firefox caches the about:home/about:newtab document in cache2 and
    serves it to the privileged about-content process; that cache's own
    version check keys on appBuildID only, so a document baked with an old
    body inline style (e.g. an Activity Stream --newtab-wallpaper) can
    outlive the prefs that removed it. Wiping cache2 + startupCache after
    a sync is what makes the new default actually take effect.
    """
    root = _make_root(tmp_path)
    profile = tmp_path / "profile"
    profile.mkdir()
    for name in ("cache2", "startupCache"):
        d = profile / name
        d.mkdir()
        (d / "entry.bin").write_bytes(b"stale")
    (profile / "places.sqlite").write_bytes(b"keep me")
    sync_user_js(root, profile)
    assert not (profile / "cache2").exists()
    assert not (profile / "startupCache").exists()
    assert (profile / "places.sqlite").is_file(), "only caches are wiped"


def test_wipe_caches_reports_and_tolerates_missing() -> None:
    from scripts.dev import STALE_CACHE_DIRS, wipe_caches

    profile = Path(tempfile.mkdtemp())
    assert wipe_caches(profile) == [], "nothing to wipe on a fresh profile"
    (profile / "cache2").mkdir()
    assert wipe_caches(profile) == ["cache2"]
    assert set(STALE_CACHE_DIRS) == {"cache2", "startupCache"}


def _symlink_lock(profile: Path, pid: int) -> None:
    # Mirrors real Firefox lock targets: "<ip>:+<pid>" (cf. nuke-local parsing).
    try:
        os.symlink(f"127.0.0.1:+{pid}", profile / "lock")
    except OSError:
        pytest.skip("cannot create symlinks on this platform")


def test_profile_locked_live_pid(tmp_path: Path) -> None:
    profile = tmp_path / "profile"
    profile.mkdir()
    _symlink_lock(profile, os.getpid())
    assert profile_locked(profile) is True


def test_profile_unlocked_dead_pid(tmp_path: Path) -> None:
    profile = tmp_path / "profile"
    profile.mkdir()
    _symlink_lock(profile, 2**30)  # no such process
    assert profile_locked(profile) is False


def test_sync_refuses_while_running(tmp_path: Path) -> None:
    root = _make_root(tmp_path)
    profile = tmp_path / "profile"
    profile.mkdir()
    (profile / "user.js").write_text('user_pref("a.b", false);\n', encoding="utf-8")
    _symlink_lock(profile, os.getpid())
    with pytest.raises(SystemExit):
        sync_user_js(root, profile)
    # existing file untouched
    assert (profile / "user.js").read_text(encoding="utf-8") == 'user_pref("a.b", false);\n'


def test_resolve_launch_defaults_to_dev_profile(tmp_path: Path) -> None:
    root = tmp_path / "root"
    profile, extra = resolve_launch([], root)
    assert profile == root / "profile"
    assert extra == []


def test_resolve_launch_passthrough_kept(tmp_path: Path) -> None:
    root = tmp_path / "root"
    profile, extra = resolve_launch(["https://example.com", "-new-tab"], root)
    assert profile == root / "profile"
    assert extra == ["https://example.com", "-new-tab"]


def test_resolve_launch_daily_strips_flag(tmp_path: Path) -> None:
    root = tmp_path / "root"
    for flag in ("--daily", "--local"):
        profile, extra = resolve_launch([flag, "https://example.com"], root)
        assert profile == Path.home() / ".config" / "aph" / "profile"
        assert extra == ["https://example.com"]


def _write_policies(root: Path, data: dict) -> None:
    import json

    (root / "config" / "policies.json").write_text(json.dumps(data), encoding="utf-8")


def test_merge_policies_replaces_extension_settings(tmp_path: Path) -> None:
    """Removing an extension from config/policies.json must remove it from
    the live policy. Regression: deep_merge only added, so entries deleted
    from config resurrected from a stale policies.json.bak on every launch
    (SponsorBlock/containers reinstalled themselves)."""
    from scripts.dev import merge_policies

    root = tmp_path / "root"
    (root / "config").mkdir(parents=True)
    dist = root / "build" / "firefox" / "distribution"
    dist.mkdir(parents=True)
    import json

    stale_base = {
        "policies": {
            "ExtensionSettings": {
                "*": {"installation_mode": "allowed"},
                "sponsorBlocker@ajay.app": {"installation_mode": "normal_installed"},
            }
        }
    }
    (dist / "policies.json").write_text(json.dumps(stale_base), encoding="utf-8")
    (dist / "policies.json.bak").write_text(json.dumps(stale_base), encoding="utf-8")
    _write_policies(
        root,
        {
            "policies": {
                "ExtensionSettings": {
                    "*": {"installation_mode": "allowed"},
                }
            }
        },
    )
    merge_policies(root)
    live = json.loads((dist / "policies.json").read_text(encoding="utf-8"))
    assert list(live["policies"]["ExtensionSettings"].keys()) == ["*"]


def test_ensure_rebranded_reports_false_without_omni(tmp_path: Path) -> None:
    """ensure_rebranded returns False (no purge needed) when there is no
    omni.ja to patch — callers rely on the bool, not just the side effect."""
    from scripts.dev import ensure_rebranded

    root = tmp_path / "root"
    (root / "build" / "firefox").mkdir(parents=True)
    assert ensure_rebranded(root) is False


def test_no_default_theme_is_installed_or_pinned() -> None:
    """Aph owns its canvas, so no lightweight theme may ship as the default.

    A theme leaked through three structural tokens: `tab_line` (drove the
    orange active-tab outline via --tab-selected-outline-color),
    `--card-border-color` (drove the content separators), and
    --toolbarbutton-background-color-hover (the old --aph-voice default —
    nova-sun set it to a brown rgba(178,97,0,0.25)). All three are now
    claimed by theme.css, so nothing needs installing.

    Two things must NOT appear: an active theme pinned in prefs, and a
    layout.css.prefers-color-scheme override. The second matters because
    removing a theme must not decide the room — the room stays on
    prefers-color-scheme and the OS, exactly as before.
    """
    root = Path(__file__).resolve().parent.parent
    overrides = (root / "config" / "user-overrides.js").read_text(encoding="utf-8")
    user_js = (root / "config" / "user.js").read_text(encoding="utf-8")
    policies = json.loads((root / "config" / "policies.json").read_text(encoding="utf-8"))

    for name, text in (("user-overrides.js", overrides), ("user.js", user_js)):
        code = re.sub(r"//.*", "", text)
        assert "extensions.activeThemeID" not in code, (
            f"config/{name} must not pin a theme; Aph claims the canvas itself"
        )
        assert "prefers-color-scheme.content-override" not in code, (
            f"config/{name} must not pin the room — leave it to the OS"
        )

    ext = policies["policies"]["ExtensionSettings"]
    assert "nova-sun@mozilla.org" not in ext, "policies.json must not install a theme"
    for key, spec in ext.items():
        if key == "*":
            continue
        assert "install_url" not in spec or "nova" not in key, (
            f"ExtensionSettings must not install a theme by URL (got {key})"
        )


def test_shipped_user_js_has_no_retired_defaults() -> None:
    """Aph never force-sets retired defaults: no retired pref may appear
    in the shipped defaults (stock + unlocked policy already agree).
    chrome.enabled stays — the support flow needs it."""
    root = Path(__file__).resolve().parent.parent
    user_js = (root / "config" / "user.js").read_text(encoding="utf-8")
    code = re.sub(r"//.*", "", user_js)
    for retired in (
        "browser.contentblocking.category",
        "browser.startup.homepage.abouthome_cache.enabled",
        "devtools.debugger.remote-enabled",
        "privacy.resistFingerprinting",
        "privacy.clearOnShutdown.cookies",
        "browser.cache.disk.enable",
    ):
        assert retired not in code, f"config/user.js must not ship {retired}"
    assert 'user_pref("devtools.chrome.enabled", true);' in code


def test_shipped_policies_have_no_forced_doh() -> None:
    """No DNS provider may be pinned: DNS resolution stays at stock
    behavior and remains user-changeable."""
    root = Path(__file__).resolve().parent.parent
    policies = json.loads((root / "config" / "policies.json").read_text(encoding="utf-8"))
    assert "DNSOverHTTPS" not in policies["policies"]


def test_update_prefs_strips_retired_upstream_pins() -> None:
    """merge() must drop every stripped pref so `just update-prefs`
    cannot silently reintroduce one — while keeping every other line."""
    from scripts.update_prefs import BETTERFOX_STRIP_PREFS, merge

    lines = [f'user_pref("{name}", "x");' for name in BETTERFOX_STRIP_PREFS]
    lines.append('user_pref("a.b", true);')
    out = merge("\n".join(lines) + "\n", "")
    for name in BETTERFOX_STRIP_PREFS:
        assert name not in out
    assert 'user_pref("a.b", true);' in out


def test_scrub_removes_retired_prefs(tmp_path: Path) -> None:
    """Profiles seeded before a default's removal carry it in
    profile/user.js (re-applied every launch) and prefs.js. One cold
    launch must scrub all of them, back up user.js, and keep the rest."""
    from scripts.dev import scrub_retired_prefs

    profile = tmp_path / "profile"
    profile.mkdir()
    retired = (
        'user_pref("browser.contentblocking.category", "strict");\n'
        'user_pref("browser.startup.homepage.abouthome_cache.enabled", false);\n'
        'user_pref("devtools.debugger.remote-enabled", true);\n'
        'user_pref("browser.cache.disk.enable", false);\n'
    )
    user_js = 'user_pref("a.b", true);\n' + retired
    prefs_js = "// mozilla header\n" + retired + 'user_pref("c.d", 1);\n'
    (profile / "user.js").write_text(user_js, encoding="utf-8")
    (profile / "prefs.js").write_text(prefs_js, encoding="utf-8")

    assert scrub_retired_prefs(profile) == ["user.js", "prefs.js"]

    assert (profile / "user.js").read_text(encoding="utf-8") == 'user_pref("a.b", true);\n'
    assert (profile / "user.js.bak").read_text(encoding="utf-8") == user_js
    remaining = (profile / "prefs.js").read_text(encoding="utf-8")
    assert "contentblocking" not in remaining
    assert "abouthome_cache" not in remaining
    assert "remote-enabled" not in remaining
    assert "cache.disk.enable" not in remaining
    assert 'user_pref("c.d", 1);' in remaining

    # Second launch is a no-op.
    assert scrub_retired_prefs(profile) == []


def test_scrub_keeps_deliberate_values(tmp_path: Path) -> None:
    """Anything but the old shipped values implies user action (or
    stock) — the migration must not touch it."""
    from scripts.dev import scrub_retired_prefs

    profile = tmp_path / "profile"
    profile.mkdir()
    user_js = (
        'user_pref("browser.contentblocking.category", "standard");\n'
        'user_pref("browser.startup.homepage.abouthome_cache.enabled", true);\n'
        'user_pref("devtools.debugger.remote-enabled", false);\n'
        'user_pref("browser.cache.disk.enable", true);\n'
        'user_pref("devtools.chrome.enabled", true);\n'
    )
    (profile / "user.js").write_text(user_js, encoding="utf-8")
    (profile / "prefs.js").write_text(user_js, encoding="utf-8")

    assert scrub_retired_prefs(profile) == []
    assert (profile / "user.js").read_text(encoding="utf-8") == user_js
    assert not (profile / "user.js.bak").exists()


def test_scrub_skips_while_running(tmp_path: Path) -> None:
    """Never edit live profile files: while Firefox holds the lock the
    migration must no-op until the next cold launch."""
    from scripts.dev import scrub_retired_prefs

    profile = tmp_path / "profile"
    profile.mkdir()
    user_js = 'user_pref("browser.contentblocking.category", "strict");\n'
    (profile / "user.js").write_text(user_js, encoding="utf-8")
    try:
        os.symlink(f"127.0.0.1:+{os.getpid()}", profile / "lock")
    except OSError:
        pytest.skip("cannot create symlinks on this platform")

    assert scrub_retired_prefs(profile) == []
    assert (profile / "user.js").read_text(encoding="utf-8") == user_js


def test_scrub_missing_files_is_noop(tmp_path: Path) -> None:
    """Fresh/partial profiles without either file must not fail."""
    from scripts.dev import scrub_retired_prefs

    profile = tmp_path / "profile"
    profile.mkdir()
    assert scrub_retired_prefs(profile) == []
