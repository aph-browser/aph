"""Toolbar-defaults injector tests (build-time vertical-tabs navbar fix).

Covers :class:`ToolbarDefaultsInjector` on synthetic omni.ja files: the
anchor is rewritten exactly once, patching is idempotent from the pristine
backup, jars without the module are untouched, and a shipped module whose
anchor is gone fails loud (Mozilla moved the code) instead of shipping a
silently unpatched build.
"""

import zipfile

import pytest

from scripts.aph_rebrand import BrandPatcher, load_payloads
from scripts.aph_rebrand.injectors.toolbar import (
    CUSTOMIZABLE_UI_PATH,
    ToolbarDefaultsInjector,
)

MODULE_WITH_ANCHOR = (
    b"let navbarPlacements = [\n"
    b'  "back-button",\n'
    b'  "forward-button",\n'
    b'  "stop-reload-button",\n'
    b"];\n"
    b'verticalTabsDefaultPlacements: ["alltabs-button", "ai-window-toggle"],\n'
)

PATCHED_FRAGMENT = b'verticalTabsDefaultPlacements: ["alltabs-button", ...navbarPlacements],'


def _brand_entries(z: zipfile.ZipFile) -> None:
    # BrandPatcher refuses jars with zero brand replacements (layout guard),
    # so the synthetic jar carries the same brand surface as test_patcher.
    z.writestr("localization/en-US/brand.ftl", "old")
    z.writestr("localization/en-US/sync-brand.ftl", "old")
    z.writestr("localization/en-US/brandings.ftl", "old")
    z.writestr("chrome/locale/brand.properties", "old")
    z.writestr("chrome/locale/brand.dtd", "old")
    z.writestr("chrome/browser/content/branding/about-logo.svg", "old")


@pytest.fixture()
def toolbar_ja(tmp_path):
    ja = tmp_path / "omni.ja"
    with zipfile.ZipFile(ja, "w", compression=zipfile.ZIP_STORED) as z:
        _brand_entries(z)
        z.writestr(
            "chrome/browser/content/browser/browser.xhtml",
            "<html><head></head><body></body></html>",
        )
        z.writestr(CUSTOMIZABLE_UI_PATH, MODULE_WITH_ANCHOR)
    return ja


def test_toolbar_anchor_rewritten_once(toolbar_ja) -> None:
    BrandPatcher(toolbar_ja, load_payloads({})).patch()
    with zipfile.ZipFile(toolbar_ja) as z:
        data = z.read(CUSTOMIZABLE_UI_PATH)
    assert data.count(PATCHED_FRAGMENT) == 1
    assert b'"ai-window-toggle"],' not in data
    # Stock placements survive verbatim behind the spread.
    assert b'"back-button"' in data


def test_toolbar_patch_idempotent_from_pristine_backup(toolbar_ja) -> None:
    payloads = load_payloads({})
    first = BrandPatcher(toolbar_ja, payloads).patch()
    with zipfile.ZipFile(toolbar_ja) as z:
        once = z.read(CUSTOMIZABLE_UI_PATH)
    second = BrandPatcher(toolbar_ja, payloads).patch()
    with zipfile.ZipFile(toolbar_ja) as z:
        twice = z.read(CUSTOMIZABLE_UI_PATH)
    assert once == twice
    assert first.as_tuple() == second.as_tuple()


def test_toolbar_missing_anchor_fails_loud(tmp_path) -> None:
    ja = tmp_path / "omni.ja"
    with zipfile.ZipFile(ja, "w", compression=zipfile.ZIP_STORED) as z:
        _brand_entries(z)
        z.writestr(CUSTOMIZABLE_UI_PATH, b"// Mozilla moved the registration\n")
    with pytest.raises(ValueError, match="layout changed"):
        BrandPatcher(ja, load_payloads({})).patch()


def test_toolbar_unit_skips_unrelated_entries() -> None:
    injector = ToolbarDefaultsInjector()
    assert injector.replace_existing("chrome/browser/foo.js", b"data", None) == b"data"
