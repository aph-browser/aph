#!/usr/bin/env python3
"""Rebrand LibreWolf omni.ja to Aph — swaps brand.ftl, logos, slices icons, clears cache.

Gecko requires omni.ja entries to be ZIP_STORED (no compression) for memory-mapping.
"""

import io
from pathlib import Path
import shutil
import tempfile
import zipfile
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
OMNI_JA = ROOT / "build" / "librewolf" / "browser" / "omni.ja"
ROOT_OMNI_JA = ROOT / "build" / "librewolf" / "omni.ja"
BRANDING_DIR = ROOT / "branding"
ICONS_DIR = (
    ROOT / "build" / "librewolf" / "browser" / "chrome" / "icons" / "default"
)
PROFILE_DIR = ROOT / "profile"

# Sizes for window manager icons (WM spec) and tab favicons
ICON_SIZES = [16, 32, 48, 64, 128]

# Blank wordmark to erase LibreWolf/Firefox text, leaving only logo
BLANK_WORDMARK = b'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1" width="1" height="1"></svg>'

BRAND_PROPERTIES_TEMPLATE = """brandShorterName=Aph
brandShortName=Aph
brandFullName=Aph Browser
brandProductName=Aph Browser
vendorShortName=Aph

syncBrandShortName=Aph Sync
"""

BRAND_DTD_TEMPLATE = """<!-- Aph branding -->
<!ENTITY  brandShorterName      "Aph">
<!ENTITY  brandShortName        "Aph">
<!ENTITY  brandFullName         "Aph Browser">
<!ENTITY  brandProductName      "Aph Browser">
<!ENTITY  vendorShortName       "Aph">
<!ENTITY  trademarkInfo.part1   " ">
"""


def slice_icons() -> dict[int, bytes]:
    """Slice branding logo into 16/32/48/64/128 PNGs using Pillow.

    Saves to disk for the OS/WM and returns in-memory bytes for omni.ja.
    Prefers aph.png (canonical Aph source) with fallback to logo.png.
    """
    # Canonical is aph.png, fallback to logo.png for backwards compat
    src = BRANDING_DIR / "aph.png"
    if not src.is_file():
        src = BRANDING_DIR / "logo.png"
        if not src.is_file():
            print(
                f"WARNING: {BRANDING_DIR / 'aph.png'} not found, skipping icon slicing."
            )
            return {}

    ICONS_DIR.mkdir(parents=True, exist_ok=True)
    rendered_buffers: dict[int, bytes] = {}

    try:
        with Image.open(src) as im:
            im = im.convert("RGBA")
            for size in ICON_SIZES:
                resized = im.resize((size, size), Image.LANCZOS)

                # 1. Save to disk for window manager / desktop frame
                dst = ICONS_DIR / f"default{size}.png"
                resized.save(dst, format="PNG", optimize=True)

                # 2. Keep in memory for omni.ja injection
                buf = io.BytesIO()
                resized.save(buf, format="PNG", optimize=True)
                rendered_buffers[size] = buf.getvalue()
                print(f"  sliced {size}x{size} -> default{size}.png & icon{size}.png")

        return rendered_buffers
    except Exception as e:
        print(f"ERROR slicing icons: {e}")
        return {}


def _patch_single_ja(
    ja_path: Path, brand_ftl_data: bytes, logos: dict[str, bytes]
) -> tuple[int, int, int, int]:
    """Patch a single omni.ja from its pristine backup. Return counts (ftl, props, dtd, logos)."""
    backup = ja_path.with_suffix(".ja.bak")
    if not backup.exists():
        shutil.copy2(ja_path, backup)
        print(f"Created pristine backup: {backup}")

    # ALWAYS read from pristine backup to prevent cascading corruption
    src_ja = backup

    count_ftl = count_props = count_dtd = count_logo = 0
    tmp_fd, tmp_path = tempfile.mkstemp(suffix=".ja", dir=str(ja_path.parent))
    tmp_path = Path(tmp_path)

    try:
        with (
            zipfile.ZipFile(src_ja, "r") as zin,
            zipfile.ZipFile(
                tmp_path, "w", compression=zipfile.ZIP_STORED
            ) as zout,
        ):
            for info in zin.infolist():
                data = zin.read(info.filename)
                fname = info.filename.lower()

                # Surgical replacements only — NO blanket search-and-replace
                if fname.endswith("brand.ftl") or fname.endswith(
                    "brandings.ftl"
                ):
                    data = brand_ftl_data
                    count_ftl += 1
                elif fname.endswith("brand.properties"):
                    data = BRAND_PROPERTIES_TEMPLATE.encode("utf-8")
                    count_props += 1
                elif fname.endswith("brand.dtd"):
                    data = BRAND_DTD_TEMPLATE.encode("utf-8")
                    count_dtd += 1
                elif info.filename in logos:
                    data = logos[info.filename]
                    count_logo += 1

                new_info = zipfile.ZipInfo(
                    filename=info.filename,
                    date_time=info.date_time,
                )
                new_info.compress_type = zipfile.ZIP_STORED
                new_info.external_attr = info.external_attr
                zout.writestr(new_info, data)

        shutil.move(str(tmp_path), str(ja_path))
        return count_ftl, count_props, count_dtd, count_logo
    finally:
        if tmp_path.exists():
            tmp_path.unlink(missing_ok=True)
        try:
            import os

            os.close(tmp_fd)
        except Exception:
            pass


def patch_omni_ja(icon_buffers: dict[int, bytes]) -> bool:
    """Replace branding files inside browser/omni.ja and root omni.ja with ZIP_STORED."""
    # Root toolkit omni.ja: patching ensures Help → About uses Aph strings via -brand-shorter-name
    targets = [OMNI_JA, ROOT_OMNI_JA]
    # Filter to existing files
    targets = [p for p in targets if p.is_file()]
    if not targets:
        print(f"ERROR: {OMNI_JA} not found. Extract LibreWolf first.")
        return False
    if OMNI_JA not in targets:
        print(f"WARNING: {OMNI_JA} missing, only patching {[str(p) for p in targets]}")

    brand_ftl = BRANDING_DIR / "brand.ftl"
    if not brand_ftl.is_file():
        print(f"ERROR: {brand_ftl} not found.")
        return False

    brand_ftl_data = brand_ftl.read_bytes()
    if not brand_ftl_data.endswith(b"\n"):
        brand_ftl_data += b"\n"

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

    ok = True
    for ja_path in targets:
        try:
            c_ftl, c_props, c_dtd, c_logo = _patch_single_ja(ja_path, brand_ftl_data, logos)
            # Icons only exist in browser/omni.ja, root will have 0 logos
            print(
                f"Rebranded {ja_path.relative_to(ROOT)}: {c_ftl} brand.ftl, {c_props} brand.properties, {c_dtd} brand.dtd, {c_logo} logos"
            )
        except Exception as e:
            print(f"ERROR patching {ja_path}: {e}")
            ok = False
    return ok


def clear_startup_cache() -> None:
    """Clear profile caches and favicon database so branding changes show immediately."""
    if not PROFILE_DIR.is_dir():
        return

    # Clear Gecko startup caches
    for sub in ["startupCache", "cache2", "shader-cache"]:
        p = PROFILE_DIR / sub
        if p.exists():
            shutil.rmtree(p, ignore_errors=True)
            print(f"Cleared {p.relative_to(ROOT)}")

    # Clear SQLite favicon cache (CRUCIAL for sidebar tab icon!)
    for fav in [
        "favicons.sqlite",
        "favicons.sqlite-wal",
        "favicons.sqlite-shm",
    ]:
        p = PROFILE_DIR / fav
        if p.exists():
            p.unlink(missing_ok=True)
            print(f"Cleared favicon cache: {fav}")

    marker = PROFILE_DIR / ".purgecache_done"
    if marker.exists():
        marker.unlink(missing_ok=True)


def rebrand() -> bool:
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


if __name__ == "__main__":
    import sys

    ok = rebrand()
    sys.exit(0 if ok else 1)
