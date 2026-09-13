"""winget manifest generator: identity derives from packaging/aph.iss."""

from pathlib import Path

import pytest

from scripts.winget_manifest import (
    PACKAGE_IDENTIFIER,
    installer_filename,
    installer_url,
    lookup_sha256,
    read_app_id,
    render_installer,
    render_locale,
    render_version,
    write_manifests,
)

VERSION = "0.1.0"
SHA = "ab" * 32


def test_app_id_matches_inno_setup() -> None:
    assert read_app_id() == "{e521632c-cee2-452b-9bc1-46b0e1bae58e}"


def test_asset_url_and_filename_convention() -> None:
    assert installer_filename(VERSION) == "Aph-Setup-0.1.0.exe"
    assert (
        installer_url(VERSION)
        == "https://github.com/aph-browser/aph/releases/download/v0.1.0/Aph-Setup-0.1.0.exe"
    )


def test_lookup_sha256_from_sums_file(tmp_path: Path) -> None:
    sums = tmp_path / "SHA256SUMS"
    sums.write_text(f"{SHA}  Aph-Setup-0.1.0.exe\n{'cd' * 32} *other.zip\n", encoding="utf-8")
    assert lookup_sha256(sums, "Aph-Setup-0.1.0.exe") == SHA
    with pytest.raises(ValueError, match="not found"):
        lookup_sha256(sums, "missing.exe")


def test_manifests_carry_identity_and_silent_switches() -> None:
    url = installer_url(VERSION)
    assert PACKAGE_IDENTIFIER in render_version(VERSION)
    assert VERSION in render_version(VERSION)
    locale = render_locale(VERSION)
    assert "MPL-2.0" in locale
    assert "firefox" in locale.lower()
    inst = render_installer(VERSION, url, SHA, read_app_id())
    assert "InstallerType: inno" in inst
    assert "Scope: user" in inst
    assert "/SILENT" in inst and "/VERYSILENT" in inst
    assert SHA.upper() in inst
    assert url in inst
    assert read_app_id() in inst


def test_write_manifests_layout(tmp_path: Path) -> None:
    written = write_manifests(VERSION, installer_url(VERSION), SHA, tmp_path)
    names = sorted(p.name for p in written)
    assert names == [
        "AphBrowser.Aph.installer.yaml",
        "AphBrowser.Aph.locale.en-US.yaml",
        "AphBrowser.Aph.yaml",
    ]
    assert (tmp_path / VERSION / names[0]).is_file()
    for path in written:
        assert "ManifestType:" in path.read_text(encoding="utf-8")
