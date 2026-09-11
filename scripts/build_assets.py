#!/usr/bin/env python3
"""Bundle modular browser sources into the single files Firefox injects.

``branding/src/<bundle>/*.js`` are the human-edited sources (one concern
per file, plain classic scripts sharing the bundle IIFE scope — no ES
modules in chrome context). ``branding/workspaces.js`` and
``branding/command-palette.js`` are GENERATED concatenation output:

* ``python scripts/build_assets.py`` — rebuild bundles (runs in
  ``just rebrand`` / CI before patching).
* ``python scripts/build_assets.py --check`` — fail if bundles are stale
  (CI guard; contributors must commit the rebuilt files).

Bundle files carry a GENERATED banner; edit ``branding/src/`` instead.
``tests/*.test.js`` and ``scripts/aph_rebrand`` consume the built files,
so nothing downstream changes.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC_DIR = ROOT / "branding" / "src"
BRANDING_DIR = ROOT / "branding"

BANNER = (
    "/* GENERATED — do not edit by hand. "
    "Edit branding/src/, then run: python scripts/build_assets.py */\n"
)

BUNDLES: dict[str, list[str]] = {
    "workspaces.js": [
        "workspaces/00-core-open.js",
        "workspaces/10-container-bindings.js",
        "workspaces/20-domain-routes.js",
        "workspaces/30-names-tags.js",
        "workspaces/40-visibility-groups.js",
        "workspaces/50-unload.js",
        "workspaces/60-indicator-switch.js",
        "workspaces/70-temp-keys.js",
        "workspaces/75-pinreset.js",
        "workspaces/80-lifecycle.js",
        "workspaces/90-routing.js",
        "workspaces/100-startup.js",
        "workspaces/110-chrome-init.js",
    ],
    "command-palette.js": [
        "palette/00-core-open.js",
        "palette/10-workspace-accessors.js",
        "palette/20-nav.js",
        "palette/30-fuzzy.js",
        "palette/40-items.js",
        "palette/50-ui.js",
        "palette/60-control.js",
        "palette/70-keys-init.js",
    ],
}


def render(bundle: str) -> str:
    parts = [BANNER]
    for rel in BUNDLES[bundle]:
        src = SRC_DIR / rel
        if not src.is_file():
            raise FileNotFoundError(f"missing bundle source: {src}")
        text = src.read_text(encoding="utf-8")
        parts.append(text if text.endswith("\n") else text + "\n")
    return "".join(parts)


def build() -> list[Path]:
    written: list[Path] = []
    for bundle in BUNDLES:
        out = BRANDING_DIR / bundle
        out.write_text(render(bundle), encoding="utf-8")
        written.append(out)
        print(f"Built {out.relative_to(ROOT)} from {len(BUNDLES[bundle])} sources")
    return written


def check() -> int:
    stale: list[str] = []
    for bundle in BUNDLES:
        out = BRANDING_DIR / bundle
        expected = render(bundle)
        try:
            actual = out.read_text(encoding="utf-8")
        except OSError:
            actual = ""
        if actual != expected:
            stale.append(bundle)
    if stale:
        print(f"STALE bundles (run: python scripts/build_assets.py): {', '.join(stale)}")
        return 1
    print(f"Bundles up to date ({len(BUNDLES)} checked).")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--check",
        action="store_true",
        help="Verify committed bundles match sources (no writes).",
    )
    args = parser.parse_args(argv)
    if args.check:
        return check()
    build()
    return 0


if __name__ == "__main__":
    sys.exit(main())
