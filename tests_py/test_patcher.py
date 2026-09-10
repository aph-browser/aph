"""End-to-end patcher tests on a synthetic omni.ja."""

import warnings
import zipfile

import pytest

from scripts.aph_rebrand import BrandPatcher, load_payloads
from scripts.aph_rebrand.assets import PatchPayloads
from scripts.aph_rebrand.constants import WORKSPACES_XHTML_PATH

XHTML = (
    "<html><head>"
    '<script src="chrome://browser/content/browser-main.js"></script>'
    "</head><body></body></html>"
)


@pytest.fixture()
def synthetic_ja(tmp_path):
    ja = tmp_path / "omni.ja"
    with zipfile.ZipFile(ja, "w", compression=zipfile.ZIP_STORED) as z:
        z.writestr("localization/en-US/brand.ftl", "old")
        z.writestr("localization/en-US/sync-brand.ftl", "old")
        z.writestr("localization/en-US/brandings.ftl", "old")
        z.writestr("chrome/locale/brand.properties", "old")
        z.writestr("chrome/locale/brand.dtd", "old")
        z.writestr("chrome/browser/content/branding/about-logo.svg", "old")
        z.writestr(WORKSPACES_XHTML_PATH, XHTML)
    return ja


def test_patch_replaces_brand_and_appends_features(synthetic_ja) -> None:
    payloads = load_payloads({})
    counts = BrandPatcher(synthetic_ja, payloads).patch()

    assert (counts.brand, counts.sync, counts.brandings) == (1, 1, 1)
    assert (counts.props, counts.dtd, counts.logos, counts.xhtml) == (1, 1, 1, 1)
    assert counts.wsjs == 1
    assert counts.textpick == 4  # controller + shared/child/parent
    assert (counts.archivejs, counts.archiveshared) == (1, 1)
    assert counts.archivepage == 3  # html/css/page
    assert counts.tabrenamejs == 1

    with zipfile.ZipFile(synthetic_ja) as z:
        # Every entry stays ZIP_STORED for Gecko memory-mapping.
        assert {i.compress_type for i in z.infolist()} == {zipfile.ZIP_STORED}
        names = set(z.namelist())
        assert "chrome/browser/content/browser/workspaces.js" in names
        assert "chrome/browser/content/browser/tabrename.js" in names
        # Regression guard: every xhtml <script> tag must have its payload
        # entry appended, otherwise the browser logs "Missing chrome or
        # resource URL" at startup (textpick/archive bug).
        for entry in (
            "chrome/browser/content/browser/textpick.js",
            "actors/aph-textpick-shared.js",
            "actors/AphTextPickChild.sys.mjs",
            "actors/AphTextPickParent.sys.mjs",
            "chrome/browser/content/browser/archive-shared.js",
            "chrome/browser/content/browser/archive.js",
            "chrome/browser/content/browser/aph-archive.html",
            "chrome/browser/content/browser/aph-archive.css",
            "chrome/browser/content/browser/aph-archive-page.js",
        ):
            assert entry in names, entry
        assert b"Aph" in z.read("localization/en-US/brand.ftl")
        xhtml = z.read(WORKSPACES_XHTML_PATH)
        assert b"workspaces.js" in xhtml
        assert b"tabrename.js" in xhtml


def test_patch_is_idempotent_from_pristine_backup(synthetic_ja) -> None:
    payloads = load_payloads({})
    first = BrandPatcher(synthetic_ja, payloads).patch().as_tuple()
    second = BrandPatcher(synthetic_ja, payloads).patch().as_tuple()
    assert first == second
    assert (synthetic_ja.parent / "omni.ja.bak").exists()


def test_patch_fails_loud_without_brand_files(tmp_path) -> None:
    ja = tmp_path / "toolkit.ja"
    with zipfile.ZipFile(ja, "w", compression=zipfile.ZIP_STORED) as z:
        z.writestr("unrelated/file.txt", "x")
    with pytest.raises(ValueError, match="0 brand files"):
        BrandPatcher(ja, PatchPayloads()).patch()


def test_toolkit_omni_without_xhtml_gets_no_features(tmp_path) -> None:
    ja = tmp_path / "omni.ja"
    with zipfile.ZipFile(ja, "w", compression=zipfile.ZIP_STORED) as z:
        z.writestr("localization/brand.ftl", "old")
    counts = BrandPatcher(ja, load_payloads({})).patch()
    assert counts.brand == 1
    assert counts.wsjs == 0
    assert counts.xhtml == 0


def test_legacy_wrapper_still_returns_16_tuple(synthetic_ja) -> None:
    from scripts.rebrand import _patch_single_ja

    payloads = load_payloads({})
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", DeprecationWarning)
        result = _patch_single_ja(
            synthetic_ja,
            payloads.brand_ftl_data,
            payloads.brandings_ftl_data,
            payloads.sync_ftl_data,
            payloads.logos,
            payloads.workspaces_js,
            payloads.theme_css,
            payloads.palette_js,
            payloads.palette_css,
            payloads.textpick_js,
            payloads.textpick_files,
            payloads.archive_js,
            payloads.archive_shared_js,
            payloads.archive_page_files,
            payloads.tabrename_js,
        )
    assert len(result) == 16
