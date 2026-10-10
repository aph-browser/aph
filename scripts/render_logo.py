#!/usr/bin/env python3
"""Render the Aph mark (branding/aph.svg) to PNG masters with Pillow.

No external rasterizer needed: the mark is a plain capital "A" in
Inter Bold (branding/fonts/inter-700-latin.woff2, SIL OFL) centered on
a near-black tile with a faint hairline ring, plus a flat-cut apex —
a tile-colored subtraction over the live glyph (same file draws the
PNGs here and the <text> element in branding/aph.svg, so the
sources stay in sync (456-unit viewBox; tests_py/test_logo.py enforces
the match). The letter is flat Purple at full strength; the tile is
lifted a half-step off pure black with a 9% light ring so the icon
keeps a silhouette on dark chrome. Hinting keeps the counter open at
16px, so every master renders the same construction.

Outputs:

- branding/aph.png (1024): canonical master — about-logo.png/@2x,
  window icons 48+, desktop/installer art.
- branding/aph-small.png (512): small-size master, same construction —
  window icons 16/32. No separate SVG by design.
- docs/aph.png (512): site hero (same pixels as the master render).

Usage:
    just render-logo            # regenerate all three
    uv run python scripts/render_logo.py --check   # CI-style drift check
"""

import argparse
import io
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
BRANDING_DIR = ROOT / "branding"

# Exact mirror of branding/aph.svg (viewBox 456): tile + hairline + font-A.
GEOMETRY = {
    "size": 456,
    "base_rx": 100,
    # Tile: near-black, lifted a half-step off pure black so the icon
    # keeps a silhouette on dark chrome; the hairline does the rest.
    "base_top": "#0a0a0e",
    "base_bottom": "#0a0a0e",
    # Hairline: faint light ring over the tile edge (white at 9%,
    # the --aph-hairline strength), 2 units wide at the viewBox.
    "hairline_alpha": 23,  # 0.09 * 255
    "hairline_width": 2,
    # The letter — flat Purple, full strength (the violet->purple
    # sweep was invisible below 200px; one hue reads stronger).
    "grad_top": "#8e4ec6",  # purple
    "grad_bottom": "#8e4ec6",  # purple
    # The glyph: Inter Bold, centered. font_size is the Pillow point
    # size at the 456-unit viewBox (== SVG font-size); text_y is the
    # vertical center (+10 optical nudge, == SVG y with central baseline).
    "font_file": "branding/fonts/inter-700-latin.woff2",
    "font_size": 336,
    "text_x": 228,
    "text_y": 238,
    "font_weight": 700,
    "font_family": "Inter",
    # Apex cut: subtractive flat top, tile-colored over the live glyph
    # (the glyph stays real text — hinting and fallback survive). The
    # rect starts safely above the apex ink (tile-on-tile there is
    # invisible) and bites 8 units into it; its half-width covers the
    # resulting ~72px flat (30% of cap, ~2.5px at 16px) plus 3 units of
    # overshoot per side so no antialiased sliver survives. Mirrors the
    # trailing <rect> in branding/aph.svg exactly.
    "apex_cut_x": 189,
    "apex_cut_y": 106,
    "apex_cut_w": 78,
    "apex_cut_h": 17,
    "apex_cut_flat": 72,
}

OUTPUTS = (
    # (path relative to root, render size)
    ("branding/aph.png", 1024),
    ("branding/aph-small.png", 512),
    ("docs/aph.png", 512),
)


def _hex_rgb(h: str) -> tuple[int, int, int]:
    h = h.lstrip("#")
    return tuple(int(h[i : i + 2], 16) for i in (0, 2, 4))


def _vertical_gradient(size: tuple[int, int], top: str, bottom: str) -> Image.Image:
    """An RGB image ramped from the top colour to the bottom colour."""
    w, h = size
    ramp = Image.new("RGB", (1, h))
    t, b = _hex_rgb(top), _hex_rgb(bottom)
    for y in range(h):
        f = y / max(1, h - 1)
        ramp.putpixel(
            (0, y),
            tuple(round(t[i] + (b[i] - t[i]) * f) for i in range(3)),
        )
    return ramp.resize((w, h))


def load_font(px: int) -> ImageFont.FreeTypeFont:
    """Load the logo face at px pixels. Single source: GEOMETRY font_file."""
    return ImageFont.truetype(str(ROOT / GEOMETRY["font_file"]), px)


def render(size: int) -> Image.Image:
    """Draw the mark at size x size px. Pure function of GEOMETRY (testable)."""
    g = GEOMETRY
    unit = size / g["size"]
    im = Image.new("RGBA", (size, size), (0, 0, 0, 0))

    # 1. Tile: flat black clipped to the rounded square.
    tile_mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(tile_mask).rounded_rectangle(
        [0, 0, size - 1, size - 1],
        radius=round(g["base_rx"] * unit),
        fill=255,
    )
    im.paste(
        _vertical_gradient((size, size), g["base_top"], g["base_bottom"]),
        (0, 0),
        tile_mask,
    )

    # 2. The letter: Inter Bold "A" drawn into an L mask, then the
    #    violet->purple gradient is composited through it.
    shape = Image.new("L", (size, size), 0)
    draw = ImageDraw.Draw(shape)
    font = load_font(round(g["font_size"] * unit))
    draw.text(
        (g["text_x"] * unit, g["text_y"] * unit),
        "A",
        font=font,
        fill=255,
        anchor="mm",
    )

    letter = _vertical_gradient((size, size), g["grad_top"], g["grad_bottom"])
    im.paste(letter, (0, 0), shape)

    # 2b. Apex cut: tile-colored subtraction over the live glyph. ViewBox
    # coords scale to output pixels; the overshoot lands on bare tile
    # (invisible) by construction.
    cut = ImageDraw.Draw(im)
    cut.rectangle(
        [
            round(g["apex_cut_x"] * unit),
            round(g["apex_cut_y"] * unit),
            round((g["apex_cut_x"] + g["apex_cut_w"]) * unit) - 1,
            round((g["apex_cut_y"] + g["apex_cut_h"]) * unit) - 1,
        ],
        fill=_hex_rgb(g["base_top"]),
    )

    # 3. Hairline: faint light ring so the tile holds an edge on dark
    #    chrome. Drawn as a rounded-rect outline, composited at low alpha.
    ring_w = max(1, round(g["hairline_width"] * unit))
    ring = Image.new("L", (size, size), 0)
    ImageDraw.Draw(ring).rounded_rectangle(
        [0, 0, size - 1, size - 1],
        radius=round(g["base_rx"] * unit),
        outline=255,
        width=ring_w,
    )
    white = Image.new("RGB", (size, size), (255, 255, 255))
    glow = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    glow.paste(white, (0, 0), ring)
    glow.putalpha(ring.point(lambda v: v * g["hairline_alpha"] // 255))
    im = Image.alpha_composite(im, glow)
    return im


def render_all(write: bool = True) -> dict[str, bytes]:
    """Render every OUTPUT. Returns {relpath: png_bytes}; writes unless asked not to."""
    out: dict[str, bytes] = {}
    for rel, size in OUTPUTS:
        buf = io.BytesIO()
        render(size).save(buf, format="PNG", optimize=True)
        out[rel] = buf.getvalue()
        if write:
            target = ROOT / rel
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(out[rel])
            print(f"  rendered {rel} ({size}px)")
    return out


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--check",
        action="store_true",
        help="Fail if any committed PNG differs from a fresh render (drift guard).",
    )
    args = parser.parse_args(argv)
    rendered = render_all(write=not args.check)
    if not args.check:
        return 0
    stale = [
        rel
        for rel, data in rendered.items()
        if not (ROOT / rel).is_file() or (ROOT / rel).read_bytes() != data
    ]
    if stale:
        print(f"STALE logo renders (run: just render-logo): {', '.join(stale)}", file=sys.stderr)
        return 1
    print("Logo renders are fresh.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
