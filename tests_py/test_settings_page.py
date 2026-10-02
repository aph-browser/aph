"""Aph settings page: chrome-system files ship via the rebrand and the
page covers every behavior toggle (aph.* prefs plus the two stock
accounts/passwords prefs) and every read-only JSON pref, reachable
from the Aph menu and the palette.
"""

import re
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

HTML = ROOT / "branding" / "settings.html"
CSS = ROOT / "branding" / "settings.css"
PAGE_JS = ROOT / "branding" / "settings-page.js"

EXPECTED_PREFS = {
    "aph.unload.autoEnabled",
    "aph.unload.staleMin",
    "aph.unload.onLowMemory",
    "browser.tabs.unloadOnLowMemory",
    "aph.archive.autoEnabled",
    "aph.archive.autoStaleMin",
    "aph.addons.silenceFirstRun",
    "aph.pins.ctrlWUnloads",
    "aph.stars.ctrlWUnloads",
    "aph.sidebar.hideFooter",
    "identity.fxaccounts.enabled",
    "signon.rememberSignons",
}

READONLY_PREFS = {
    "aph.workspaces.names",
    "aph.workspaces.containerBindings",
    "aph.workspaces.domainRoutes",
    "aph.archive.tabs",
    "aph.palette.frecency",
}


def _theme_css() -> str:
    return (ROOT / "branding" / "theme.css").read_text(encoding="utf-8")


def test_settings_sources_exist() -> None:
    for p in (HTML, CSS, PAGE_JS):
        assert p.is_file(), f"missing {p.name}"


def test_settings_html_is_sane() -> None:
    text = HTML.read_text(encoding="utf-8")
    assert text.startswith("<!DOCTYPE html>")
    assert "chrome://browser/content/aph-settings.css" in text
    assert "chrome://browser/content/aph-settings-page.js" in text
    assert "<script>" not in text, "no inline scripts on chrome pages"
    assert 'id="aph-settings-list"' in text
    assert 'id="aph-settings-reset-frecency"' in text
    assert 'id="aph-settings-export"' in text
    assert 'id="aph-settings-import"' in text
    assert 'id="aph-settings-import-file"' in text
    assert 'type="file"' in text


def test_settings_css_is_sane() -> None:
    css = CSS.read_text(encoding="utf-8")
    assert css.count("{") == css.count("}"), "unbalanced braces"
    assert css.count("/*") == css.count("*/"), "unbalanced comments"
    # The local --set-* scale is gone; the page reads the shared tokens.
    for live in (
        "var(--aph-base)",
        "var(--aph-surface)",
        "var(--aph-field)",
        "var(--aph-ink)",
        "var(--aph-ink-dim)",
        "var(--aph-radius-lg)",
        "var(--aph-radius-xl)",
    ):
        assert live in css, f"missing shared token read: {live}"
    assert css.count("@font-face {") == 4
    assert "aph-fonts/inter-" in css
    assert "prefers-reduced-motion" in css
    assert "transition: none" in css


def test_settings_backup_buttons_are_styled() -> None:
    css = CSS.read_text(encoding="utf-8")
    for sel in ("#aph-settings-export", "#aph-settings-import", "#aph-settings-import-file"):
        assert sel in css, f"missing styled control: {sel}"


def test_settings_backup_logic_present() -> None:
    """Export covers every behavior + JSON pref; import validates strictly
    on known-key types, merges (never deletes), and confirms first."""
    js = PAGE_JS.read_text(encoding="utf-8")
    for token in (
        "BACKUP_VERSION = 1",
        "BACKUP_BOOL_PREFS",
        "BACKUP_JSON_PREFS",
        "buildBackup",
        "parseBackup",
        "summarizeBackup",
        "exportBackup",
        "importBackupFile",
        "writeBackupPrefs",
        "Not an Aph backup file.",
        "Unsupported backup version",
        "FileReader",
        "createObjectURL",
        "window.confirm",
    ):
        assert token in js, f"backup wiring missing: {token}"
    # Import writes flow through the same guarded writers as the UI —
    # never a raw pref write.
    assert "setStringPref" in js and "setBoolPref" in js and "setIntPref" in js


def test_settings_voice_parity() -> None:
    """The page used to duplicate the nine workspace hues under --set-ws-N
    with this test holding the copies equal. It now reads the tokens.css
    table outright, so parity is structural: the page spends the shared
    hues and carries no local copy."""
    css = CSS.read_text()
    theme_hues = dict(re.findall(r"--aph-ws-([1-9]):\s*(#[0-9a-fA-F]{6})", _theme_css()))
    assert len(theme_hues) == 9
    assert "--set-ws-" not in css
    for n in "123456789":
        assert f"var(--aph-ws-{n})" in css, n


def test_settings_identity_rows_carry_workspace() -> None:
    js = PAGE_JS.read_text(encoding="utf-8")
    assert 'setAttribute("data-ws"' in js
    css = CSS.read_text(encoding="utf-8")
    assert ".aph-settings-table tr[data-ws]" in css
    assert "--aph-ws-now" in css


def test_settings_stays_rtl_clean() -> None:
    """Table headers and workspace swatches must mirror in RTL."""
    code = re.sub(r"/\*.*?\*/", "", CSS.read_text(encoding="utf-8"), flags=re.S)
    for banned in (
        "margin-left:",
        "margin-right:",
        "float: left",
        "float: right",
        "text-align: left",
        "text-align: right",
    ):
        assert banned not in code, f"physical direction prop leaked: {banned}"


def test_settings_page_covers_every_pref() -> None:
    js = PAGE_JS.read_text(encoding="utf-8")
    for pref in EXPECTED_PREFS | READONLY_PREFS:
        assert pref in js, f"settings page ignores {pref}"
    # Defaults match config/user-overrides.js seed-once values (the last
    # two are stock prefs Aph seeds off, not aph.* prefs).
    for pref, val in (
        ('"aph.unload.autoEnabled": true', "unloadAuto"),
        ('"aph.unload.onLowMemory": true', "unloadLowMem"),
        ('"browser.tabs.unloadOnLowMemory": true', "nativeUnloadLowMem"),
        ('"aph.archive.autoEnabled": false', "autoEnabled"),
        ('"aph.addons.silenceFirstRun": true', "silenceFirstRun"),
        ('"aph.pins.ctrlWUnloads": true', "pins"),
        ('"aph.stars.ctrlWUnloads": true', "stars"),
        ('"aph.sidebar.hideFooter": true', "hideFooter"),
        ('"identity.fxaccounts.enabled": false', "fxaccounts"),
        ('"signon.rememberSignons": false', "rememberSignons"),
    ):
        assert pref in js, f"wrong default for {val}"
    assert "STALE_DEFAULT = 5" in js
    assert "UNLOAD_STALE_DEFAULT = 30" in js
    assert '"aph.unload.staleMin", 30' in js or '"aph.unload.staleMin"' in js


def test_native_unload_pref_in_both_configs() -> None:
    """The stock safety net ships seeded-on in BOTH config files (last-line
    merge would drop it from fresh profiles if either missed it)."""
    overrides = (ROOT / "config" / "user-overrides.js").read_text(encoding="utf-8")
    user_js = (ROOT / "config" / "user.js").read_text(encoding="utf-8")
    for name, text in (("user-overrides.js", overrides), ("user.js", user_js)):
        assert 'user_pref("browser.tabs.unloadOnLowMemory", true);' in text, (
            f"config/{name} must seed the native unloader on (parity with stock)"
        )


def test_settings_page_uses_services_directly() -> None:
    """System-principal precedent (same as archive-page.js): the page
    reads/writes prefs itself, observes them live, and never inlines."""
    js = PAGE_JS.read_text(encoding="utf-8")
    assert "Services" in js
    assert "getBoolPref" in js
    assert "setBoolPref" in js
    assert "setIntPref" in js
    assert "addObserver" in js


def test_settings_payloads_load_and_patch(tmp_path) -> None:
    from scripts.aph_rebrand import BrandPatcher, load_payloads
    from scripts.aph_rebrand.constants import (
        SETTINGS_CSS_JA_PATH,
        SETTINGS_HTML_JA_PATH,
        SETTINGS_PAGE_JA_PATH,
        WORKSPACES_XHTML_PATH,
    )

    payloads = load_payloads({})
    assert len(payloads.settings_page_files) == 3
    assert set(payloads.settings_page_files) == {
        SETTINGS_HTML_JA_PATH,
        SETTINGS_CSS_JA_PATH,
        SETTINGS_PAGE_JA_PATH,
    }

    ja = tmp_path / "omni.ja"
    with zipfile.ZipFile(ja, "w", compression=zipfile.ZIP_STORED) as z:
        z.writestr("localization/en-US/brand.ftl", "old")
        z.writestr("localization/en-US/sync-brand.ftl", "old")
        z.writestr("localization/en-US/brandings.ftl", "old")
        z.writestr("chrome/locale/brand.properties", "old")
        z.writestr("chrome/locale/brand.dtd", "old")
        z.writestr("chrome/browser/content/branding/about-logo.svg", "old")
        z.writestr(
            WORKSPACES_XHTML_PATH,
            "<html><head>"
            '<script src="chrome://browser/content/browser-main.js"></script>'
            "</head><body></body></html>",
        )
    counts = BrandPatcher(ja, payloads).patch()
    assert counts.settingspage == 3
    with zipfile.ZipFile(ja) as z:
        names = set(z.namelist())
        for entry in (
            SETTINGS_HTML_JA_PATH,
            SETTINGS_CSS_JA_PATH,
            SETTINGS_PAGE_JA_PATH,
        ):
            assert entry in names, entry


def test_settings_entry_points_wired() -> None:
    dock = (ROOT / "branding" / "src" / "workspaces" / "65-dock.js").read_text(encoding="utf-8")
    assert "function aphOpenSettings()" in dock
    assert "aph-settings.html" in dock
    assert "about:config?filter=aph" not in dock, "dock menu must open the page, not about:config"
    palette = (ROOT / "branding" / "src" / "palette" / "40-items.js").read_text(encoding="utf-8")
    assert "Open Aph Settings" in palette
    assert palette.count("aph-settings.html") >= 2, "palette must dedupe + open"
    # Generated bundles are fresh (just rebrand rebuilds them first, but
    # contributors must commit the rebuilt files all the same).
    assert "aphOpenSettings" in (ROOT / "branding" / "workspaces.js").read_text(encoding="utf-8")
    assert "Open Aph Settings" in (ROOT / "branding" / "command-palette.js").read_text(
        encoding="utf-8"
    )


def test_settings_toggles_persist_to_user_js() -> None:
    """Toggles must survive restarts: Firefox re-applies profile/user.js
    over prefs.js on every startup, so a prefs.js-only write reverts
    whenever the seeded line disagrees (the Sync toggle unchecked itself
    on restart). The page therefore patches the user_pref line through
    profile IO, reached via L() from the DOM controller."""
    js = PAGE_JS.read_text(encoding="utf-8")
    for token in (
        "patchUserJsLine",
        "persistToggleToUserJs",
        "persistToggleBestEffort",
        "ProfD",
        "readUTF8",
        "writeUTF8",
        'user_pref("${pref}"',
    ):
        assert token in js, f"user.js write-through missing: {token}"
