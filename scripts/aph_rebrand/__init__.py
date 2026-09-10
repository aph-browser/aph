"""Aph omni.ja rebranding — public API.

Rebrand Firefox omni.ja to Aph: swaps brand.ftl, logos, slices icons,
injects theme, clears cache. Gecko requires omni.ja entries to be
ZIP_STORED (no compression) for memory-mapping.
"""

from __future__ import annotations

from pathlib import Path

from .assets import PatchPayloads, load_payloads
from .cache import clear_startup_cache
from .constants import OMNI_JA
from .icons import slice_icons
from .injectors.base import PatchCounts
from .omni import is_optimized_omni_ja, normalize_omni_ja
from .patcher import BrandPatcher

__all__ = [
    "BrandPatcher",
    "PatchCounts",
    "PatchPayloads",
    "clear_startup_cache",
    "is_optimized_omni_ja",
    "load_payloads",
    "normalize_omni_ja",
    "patch_omni_ja",
    "rebrand",
    "slice_icons",
]


def patch_omni_ja(icon_buffers: dict[int, bytes]) -> bool:
    """Replace branding files inside browser/omni.ja and root omni.ja with ZIP_STORED."""
    # Root toolkit omni.ja: patching ensures Help → About uses Aph strings via -brand-shorter-name
    targets = BrandPatcher.discover_targets()
    if not targets:
        print(f"ERROR: {OMNI_JA} not found. Extract Firefox first.")
        return False
    if OMNI_JA not in targets:
        print(f"WARNING: {OMNI_JA} missing, only patching {[str(p) for p in targets]}")

    for ja_path in targets:
        normalize_omni_ja(ja_path)

    try:
        payloads = load_payloads(icon_buffers)
    except FileNotFoundError as e:
        print(f"ERROR: {e}")
        return False

    ok = True
    for ja_path in targets:
        try:
            counts = BrandPatcher(ja_path, payloads).patch()
            print(BrandPatcher.format_summary(ja_path, counts))
        except Exception as e:
            print(f"ERROR patching {ja_path}: {e}")
            ok = False
    return ok


def rebrand() -> bool:
    # Rebuild generated browser bundles from branding/src/ first so the
    # injected JS always matches the modular sources (no-op when up to date).
    try:
        try:
            from scripts.build_assets import build as build_assets
        except ImportError:
            from build_assets import build as build_assets  # type: ignore[no-redef]

        build_assets()
    except Exception as e:
        print(f"Warning: asset rebuild skipped: {e}")

    print("Slicing icons from branding/aph.png...")
    icon_buffers = slice_icons()
    if not icon_buffers:
        print("Icon slicing skipped or failed (continuing).")

    print("Patching omni.ja...")
    if not patch_omni_ja(icon_buffers):
        return False

    print("Clearing profile startup and favicon cache...")
    clear_startup_cache()
    return True


def _patch_single_ja(
    ja_path: Path,
    brand_ftl_data: bytes,
    brandings_ftl_data: bytes,
    sync_ftl_data: bytes,
    logos: dict[str, bytes],
    workspaces_js: bytes | None = None,
    theme_css: bytes | None = None,
    palette_js: bytes | None = None,
    palette_css: bytes | None = None,
    textpick_js: bytes | None = None,
    textpick: dict[str, bytes] | None = None,
    archive_js: bytes | None = None,
    archive_shared_js: bytes | None = None,
    archive_page: dict[str, bytes] | None = None,
    tabrename_js: bytes | None = None,
) -> tuple[int, ...]:
    """Deprecated compatibility wrapper: prefer :class:`BrandPatcher`.

    Kept so external imports of ``scripts.rebrand._patch_single_ja`` keep
    working; delegates to the injector pipeline and returns the legacy
    16-tuple in historical field order.
    """
    import warnings

    warnings.warn(
        "_patch_single_ja is deprecated; use BrandPatcher instead",
        DeprecationWarning,
        stacklevel=2,
    )
    payloads = PatchPayloads(
        brand_ftl_data=brand_ftl_data,
        brandings_ftl_data=brandings_ftl_data,
        sync_ftl_data=sync_ftl_data,
        logos=logos,
        workspaces_js=workspaces_js,
        theme_css=theme_css,
        palette_js=palette_js,
        palette_css=palette_css,
        textpick_js=textpick_js,
        textpick_files=textpick or {},
        archive_js=archive_js,
        archive_shared_js=archive_shared_js,
        archive_page_files=archive_page or {},
        tabrename_js=tabrename_js,
    )
    return BrandPatcher(ja_path, payloads).patch().as_tuple()


def _inject_workspaces_script(xhtml_bytes: bytes) -> bytes:
    """Deprecated compatibility wrapper: prefer ``XhtmlInjector``."""
    import warnings

    from .injectors.xhtml import XhtmlInjector

    warnings.warn(
        "_inject_workspaces_script is deprecated; use XhtmlInjector instead",
        DeprecationWarning,
        stacklevel=2,
    )
    data, _ = XhtmlInjector([]).inject(xhtml_bytes)
    return data
