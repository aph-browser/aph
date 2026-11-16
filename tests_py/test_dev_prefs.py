"""Dev launcher preferences and profile migration tests."""

import json
import os
import re
import tempfile
from pathlib import Path

import pytest

import scripts.profile_lock as profile_lock
from scripts.dev import (
    clear_stale_profile_lock,
    profile_locked,
    resolve_launch,
    skip_existing_launch,
)


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


def test_profile_locked_live_pid(tmp_path: Path, monkeypatch) -> None:
    profile = tmp_path / "profile"
    profile.mkdir()
    _symlink_lock(profile, os.getpid())
    monkeypatch.setattr(profile_lock, "_process_matches_firefox_profile", lambda pid, path: True)
    assert profile_locked(profile) is True


def test_profile_unlocked_when_pid_is_unrelated(tmp_path: Path) -> None:
    """A stale lock PID reused by a non-Firefox must not block launches.

    Regression: a waybar thread inherited the lock's old PID, so every
    `just dev --daily` refused with "branding changed under the running Aph".
    """
    profile = tmp_path / "profile"
    profile.mkdir()
    _symlink_lock(profile, os.getpid())  # pytest is not Firefox
    assert profile_locked(profile) is False


def test_clear_stale_lock_removes_unrelated_pid(tmp_path: Path) -> None:
    profile = tmp_path / "profile"
    profile.mkdir()
    _symlink_lock(profile, os.getpid())  # pytest is not Firefox
    (profile / ".parentlock").write_text("", encoding="utf-8")

    assert clear_stale_profile_lock(profile) is True
    assert not (profile / "lock").is_symlink()
    assert not (profile / ".parentlock").exists()


def test_clear_stale_lock_keeps_a_live_firefox(tmp_path: Path, monkeypatch) -> None:
    profile = tmp_path / "profile"
    profile.mkdir()
    _symlink_lock(profile, os.getpid())
    monkeypatch.setattr(profile_lock, "_process_matches_firefox_profile", lambda pid, path: True)

    assert clear_stale_profile_lock(profile) is False
    assert (profile / "lock").is_symlink()


def test_profile_unlocked_dead_pid(tmp_path: Path) -> None:
    profile = tmp_path / "profile"
    profile.mkdir()
    _symlink_lock(profile, 2**30)  # no such process
    assert profile_locked(profile) is False


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


def test_skip_existing_launch_only_for_bare_running_launch(tmp_path: Path, monkeypatch) -> None:
    import scripts.dev as dev

    monkeypatch.setattr(dev, "profile_locked", lambda profile: True)
    assert skip_existing_launch(tmp_path, []) is True
    assert skip_existing_launch(tmp_path, ["https://example.com"]) is False
    assert skip_existing_launch(tmp_path, ["--new-window"]) is False
    monkeypatch.setattr(dev, "profile_locked", lambda profile: False)
    assert skip_existing_launch(tmp_path, []) is False


def _write_policies(root: Path, data: dict) -> None:
    import json

    (root / "config" / "policies.json").write_text(json.dumps(data), encoding="utf-8")


def test_merge_policies_copies_config_directly(tmp_path: Path) -> None:
    """merge_policies directly copies config/policies.json to distribution/policies.json."""
    from scripts.dev import merge_policies

    root = tmp_path / "root"
    (root / "config").mkdir(parents=True)
    _write_policies(
        root,
        {
            "policies": {
                "DisableTelemetry": True,
                "ExtensionSettings": {"*": {"installation_mode": "allowed"}},
            }
        },
    )
    merge_policies(root)
    dist_policy = root / "build" / "firefox" / "distribution" / "policies.json"
    assert dist_policy.is_file()
    import json

    live = json.loads(dist_policy.read_text(encoding="utf-8"))
    assert live["policies"]["DisableTelemetry"] is True
    assert list(live["policies"]["ExtensionSettings"].keys()) == ["*"]


def test_ensure_rebranded_reports_false_without_omni(tmp_path: Path) -> None:
    """ensure_rebranded returns False (no purge needed) when there is no
    omni.ja to patch — callers rely on the bool, not just the side effect."""
    from scripts.dev import ensure_rebranded

    root = tmp_path / "root"
    (root / "build" / "firefox").mkdir(parents=True)
    assert ensure_rebranded(root) is False


def test_extension_settings_restricts_no_install_types() -> None:
    """The "*" entry must not carry allowed_types: Firefox has five install
    types (extension, theme, dictionary, locale, sitepermission), so any
    allowlist silently bans whatever it omits — historically language
    packs (locale). Aph restricts nothing; uBlock stays force-installed."""
    import json

    root = Path(__file__).resolve().parent.parent
    policies = json.loads((root / "config" / "policies.json").read_text(encoding="utf-8"))
    ext = policies["policies"]["ExtensionSettings"]
    assert ext["*"]["installation_mode"] == "allowed"
    assert "allowed_types" not in ext["*"], "no install type may be banned (see locale)"
    assert "blocked_install_message" not in ext["*"], "no stale ban message"
    assert "uBlock0@raymondhill.net" in ext


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
    default_prefs = (root / "config" / "default-prefs.js").read_text(encoding="utf-8")
    policies = json.loads((root / "config" / "policies.json").read_text(encoding="utf-8"))

    for name, text in (("user-overrides.js", overrides), ("default-prefs.js", default_prefs)):
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


def test_shipped_default_prefs_has_no_retired_defaults() -> None:
    """Aph never force-sets retired defaults: no retired pref may appear
    in the shipped defaults (stock + unlocked policy already agree).
    chrome.enabled stays — the support flow needs it."""
    root = Path(__file__).resolve().parent.parent
    default_prefs = (root / "config" / "default-prefs.js").read_text(encoding="utf-8")
    code = re.sub(r"//.*", "", default_prefs)
    for retired in (
        "browser.contentblocking.category",
        "browser.startup.homepage.abouthome_cache.enabled",
        "devtools.debugger.remote-enabled",
        "privacy.resistFingerprinting",
        "privacy.clearOnShutdown.cookies",
        "browser.cache.disk.enable",
        "browser.shell.checkDefaultBrowser",
        "browser.startup.homepage_override.mstone",
        "browser.aboutwelcome.enabled",
    ):
        assert retired not in code, f"config/default-prefs.js must not ship {retired}"
    assert 'pref("devtools.chrome.enabled", true);' in code


def test_shipped_policies_have_no_forced_doh() -> None:
    """No DNS provider may be pinned: DNS resolution stays at stock
    behavior and remains user-changeable."""
    root = Path(__file__).resolve().parent.parent
    policies = json.loads((root / "config" / "policies.json").read_text(encoding="utf-8"))
    assert "DNSOverHTTPS" not in policies["policies"]


def test_shipped_policies_suppress_default_browser_nag() -> None:
    """Firefox owns onboarding: about:welcome remains stock, while the
    default-browser check is policy-suppressed so launch stays silent."""
    root = Path(__file__).resolve().parent.parent
    policies = json.loads((root / "config" / "policies.json").read_text(encoding="utf-8"))
    p = policies["policies"]
    assert "OverrideFirstRunPage" not in p
    assert p.get("DontCheckDefaultBrowser") is True
    assert not p.get("UserMessaging", {}).get("SkipOnboarding")


def test_update_prefs_strips_retired_upstream_pins() -> None:
    """merge() must drop every stripped pref so `just update-prefs`
    cannot silently reintroduce one — while keeping every other line."""
    from scripts.update_prefs import BETTERFOX_STRIP_PREFS, merge

    lines = [f'user_pref("{name}", "x");' for name in BETTERFOX_STRIP_PREFS]
    lines.append('user_pref("a.b", true);')
    out = merge("\n".join(lines) + "\n", "")
    for name in BETTERFOX_STRIP_PREFS:
        assert name not in out
    assert 'pref("a.b", true);' in out


def test_ensure_rebranded_watches_default_prefs_and_html() -> None:
    """ensure_rebranded must watch config/default-prefs.js and branding/*.html so
    updates to preferences or settings pages trigger rebrand on launch."""
    root = Path(__file__).resolve().parent.parent
    dev_text = (root / "scripts" / "dev.py").read_text(encoding="utf-8")
    assert 'root / "config" / "default-prefs.js"' in dev_text
    assert '.rglob("*.html")' in dev_text
