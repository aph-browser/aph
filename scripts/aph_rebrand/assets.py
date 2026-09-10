"""Load rebrand payloads from ``branding/`` into memory.

Pure I/O boundary: reads FTL / logos / feature JS-CSS-HTML files, warns on
missing sources (skip, not fatal), and returns a single :class:`PatchPayloads`
value object consumed by :class:`BrandPatcher`. No zip I/O here.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from .constants import (
    ARCHIVE_CSS_JA_PATH,
    ARCHIVE_CSS_SRC,
    ARCHIVE_HTML_JA_PATH,
    ARCHIVE_HTML_SRC,
    ARCHIVE_JS_SRC,
    ARCHIVE_PAGE_JA_PATH,
    ARCHIVE_PAGE_SRC,
    ARCHIVE_SHARED_SRC,
    BLANK_WORDMARK,
    BRAND_FTL_SRC,
    BRANDING_DIR,
    BRANDINGS_FTL_SRC,
    PALETTE_CSS_SRC,
    PALETTE_JS_SRC,
    SYNC_BRAND_FTL_SRC,
    TABRENAME_JS_SRC,
    TEXTPICK_CHILD_JA_PATH,
    TEXTPICK_CHILD_SRC,
    TEXTPICK_JS_SRC,
    TEXTPICK_PARENT_JA_PATH,
    TEXTPICK_PARENT_SRC,
    TEXTPICK_SHARED_JA_PATH,
    TEXTPICK_SHARED_SRC,
    THEME_CSS_SRC,
    WORKSPACES_JS_SRC,
)


@dataclass
class PatchPayloads:
    brand_ftl_data: bytes = b""
    brandings_ftl_data: bytes = b""
    sync_ftl_data: bytes = b""
    logos: dict[str, bytes] = field(default_factory=dict)
    workspaces_js: bytes | None = None
    theme_css: bytes | None = None
    palette_js: bytes | None = None
    palette_css: bytes | None = None
    textpick_js: bytes | None = None
    textpick_files: dict[str, bytes] = field(default_factory=dict)
    archive_js: bytes | None = None
    archive_shared_js: bytes | None = None
    archive_page_files: dict[str, bytes] = field(default_factory=dict)
    tabrename_js: bytes | None = None


def _read(src, label: str) -> bytes | None:
    if src.is_file():
        return src.read_bytes()
    print(f"WARNING: {src} not found, skipping {label}.")
    return None


def load_ftl() -> tuple[bytes, bytes, bytes]:
    if not BRAND_FTL_SRC.is_file():
        raise FileNotFoundError(f"{BRAND_FTL_SRC} not found.")
    brand_ftl_data = BRAND_FTL_SRC.read_bytes()
    if not brand_ftl_data.endswith(b"\n"):
        brand_ftl_data += b"\n"

    brandings_ftl_data = b""
    if BRANDINGS_FTL_SRC.is_file():
        brandings_ftl_data = BRANDINGS_FTL_SRC.read_bytes()
        if not brandings_ftl_data.endswith(b"\n"):
            brandings_ftl_data += b"\n"

    sync_ftl_data = b""
    if SYNC_BRAND_FTL_SRC.is_file():
        sync_ftl_data = SYNC_BRAND_FTL_SRC.read_bytes()
        if not sync_ftl_data.endswith(b"\n"):
            sync_ftl_data += b"\n"
    return brand_ftl_data, brandings_ftl_data, sync_ftl_data


def build_logos(icon_buffers: dict[int, bytes]) -> dict[str, bytes]:
    logos: dict[str, bytes] = {}

    # 1. about-logo.svg — canonical aph.svg
    logo_svg_src = BRANDING_DIR / "aph.svg"
    if not logo_svg_src.is_file():
        logo_svg_src = BRANDING_DIR / "about-logo.svg"
    if logo_svg_src.is_file():
        logos["chrome/browser/content/branding/about-logo.svg"] = logo_svg_src.read_bytes()

    # 2. Large New Tab PNGs — canonical aph.png
    logo_png_src = BRANDING_DIR / "aph.png"
    if not logo_png_src.is_file():
        logo_png_src = BRANDING_DIR / "logo.png"
    if logo_png_src.is_file():
        png_bytes = logo_png_src.read_bytes()
        logos["chrome/browser/content/branding/about-logo.png"] = png_bytes
        logos["chrome/browser/content/branding/about-logo@2x.png"] = png_bytes

    # 3. Wordmarks: inject about-wordmark.svg into BOTH about-wordmark.svg and firefox-wordmark.svg
    wordmark_src = BRANDING_DIR / "about-wordmark.svg"
    if wordmark_src.is_file():
        wm_bytes = wordmark_src.read_bytes()
        logos["chrome/browser/content/branding/about-wordmark.svg"] = wm_bytes
        logos["chrome/browser/content/branding/firefox-wordmark.svg"] = wm_bytes
    else:
        logos["chrome/browser/content/branding/about-wordmark.svg"] = BLANK_WORDMARK
        logos["chrome/browser/content/branding/firefox-wordmark.svg"] = BLANK_WORDMARK

    # 4. Inject all icon sizes into omni.ja for tab favicons!
    for size, data in icon_buffers.items():
        logos[f"chrome/browser/content/branding/icon{size}.png"] = data
    return logos


def load_payloads(icon_buffers: dict[int, bytes]) -> PatchPayloads:
    """Read every branding source file. Missing feature files warn and skip."""
    brand_ftl_data, brandings_ftl_data, sync_ftl_data = load_ftl()
    payloads = PatchPayloads(
        brand_ftl_data=brand_ftl_data,
        brandings_ftl_data=brandings_ftl_data,
        sync_ftl_data=sync_ftl_data,
        logos=build_logos(icon_buffers),
    )

    payloads.workspaces_js = _read(WORKSPACES_JS_SRC, "workspaces injection")
    payloads.theme_css = _read(THEME_CSS_SRC, "theme injection")
    payloads.palette_js = _read(PALETTE_JS_SRC, "palette injection")
    payloads.palette_css = _read(PALETTE_CSS_SRC, "palette CSS injection")
    payloads.textpick_js = _read(TEXTPICK_JS_SRC, "picker injection")

    textpick_files: dict[str, bytes] = {}
    for src, ja_path in (
        (TEXTPICK_SHARED_SRC, TEXTPICK_SHARED_JA_PATH),
        (TEXTPICK_CHILD_SRC, TEXTPICK_CHILD_JA_PATH),
        (TEXTPICK_PARENT_SRC, TEXTPICK_PARENT_JA_PATH),
    ):
        data = _read(src, "picker file")
        if data is not None:
            textpick_files[ja_path] = data
    payloads.textpick_files = textpick_files

    payloads.archive_shared_js = _read(ARCHIVE_SHARED_SRC, "archive shared injection")
    payloads.archive_js = _read(ARCHIVE_JS_SRC, "archive injection")

    archive_page_files: dict[str, bytes] = {}
    for src, ja_path in (
        (ARCHIVE_HTML_SRC, ARCHIVE_HTML_JA_PATH),
        (ARCHIVE_CSS_SRC, ARCHIVE_CSS_JA_PATH),
        (ARCHIVE_PAGE_SRC, ARCHIVE_PAGE_JA_PATH),
    ):
        data = _read(src, "archive page file")
        if data is not None:
            archive_page_files[ja_path] = data
    payloads.archive_page_files = archive_page_files

    payloads.tabrename_js = _read(TABRENAME_JS_SRC, "tab rename injection")
    return payloads
