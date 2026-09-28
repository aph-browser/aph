#!/usr/bin/env python3
"""Render the Aph grid mark (branding/aph.svg) to PNG masters with Pillow.

No external rasterizer needed: the mark is four rounded rects on a
rounded-square base, drawn here from the exact SVG geometry (456-unit
viewBox — keep GEOMETRY in sync with aph.svg; tests_py/test_logo.py
enforces this by parsing the SVG). Outputs:

- branding/aph.png (1024): canonical master — about-logo.png/@2x,
  window icons 48+, desktop/installer art.
- branding/aph-small.png (512): small-size master with heavier strokes
  (subpixel outlines vanish at 16px) — window icons 16/32. No separate
  SVG by design: same layout, only the stroke weight changes.
- docs/aph.png (512): site hero (same pixels as the master render).

Usage:
    just render-logo            # regenerate all three
    uv run python scripts/render_logo.py --check   # CI-style drift check
"""

import argparse
import io
import sys
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
BRANDING_DIR = ROOT / "branding"

# Exact mirror of branding/aph.svg (viewBox 456). CELL_RX stays shared —
# only the outline weight changes for small sizes.
GEOMETRY = {
    "size": 456,
    "base_rx": 100,
    "base_fill": "#17181f",
    "cell": 120,
    "cell_rx": 28,
    "cell_xy": (84, 84, 252),  # home-x, home-y, far offset (252 = 84 + 120 + 48)
    "ink": "#e8e8ec",
    "stroke": 20,
    "small_stroke": 36,
}

OUTPUTS = (
    # (path relative to root, render size, stroke key)
    ("branding/aph.png", 1024, "stroke"),
    ("branding/aph-small.png", 512, "small_stroke"),
    ("docs/aph.png", 512, "stroke"),
)


def render(size: int, stroke_width: int) -> Image.Image:
    """Draw the mark at size x size px. Pure function of GEOMETRY (testable)."""
    g = GEOMETRY
    unit = size / g["size"]
    im = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(im)
    draw.rounded_rectangle(
        [0, 0, size - 1, size - 1],
        radius=round(g["base_rx"] * unit),
        fill=g["base_fill"],
    )
    cell, rx = round(g["cell"] * unit), round(g["cell_rx"] * unit)
    w = max(1, round(stroke_width * unit))
    home_x, home_y, far = (round(v * unit) for v in g["cell_xy"])
    # Home cell (workspace 1 is home): filled ink.
    draw.rounded_rectangle(
        [home_x, home_y, home_x + cell, home_y + cell],
        radius=rx,
        fill=g["ink"],
    )
    # Remaining three: ink outlines.
    for x, y in ((far, home_y), (home_x, far), (far, far)):
        draw.rounded_rectangle(
            [x, y, x + cell, y + cell],
            radius=rx,
            outline=g["ink"],
            width=w,
        )
    return im


def render_all(write: bool = True) -> dict[str, bytes]:
    """Render every OUTPUT. Returns {relpath: png_bytes}; writes files unless asked not to."""
    out: dict[str, bytes] = {}
    for rel, size, stroke_key in OUTPUTS:
        buf = io.BytesIO()
        render(size, GEOMETRY[stroke_key]).save(buf, format="PNG", optimize=True)
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
