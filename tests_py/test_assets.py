"""Bundle freshness: committed branding/*.js must match branding/src/."""

from pathlib import Path

from scripts.build_assets import BUNDLES, render

ROOT = Path(__file__).resolve().parent.parent


def test_bundles_up_to_date() -> None:
    for bundle in BUNDLES:
        expected = render(bundle)
        actual = (ROOT / "branding" / bundle).read_text(encoding="utf-8")
        assert actual == expected, f"{bundle} is stale — run: python scripts/build_assets.py"


def test_manifest_covers_all_sources() -> None:
    src_files = {
        p.relative_to(ROOT / "branding" / "src").as_posix()
        for p in (ROOT / "branding" / "src").rglob("*.js")
    }
    manifest_files = {rel for rels in BUNDLES.values() for rel in rels}
    assert src_files == manifest_files


def test_dock_after_indicator_in_bundle() -> None:
    """65-dock.js consumes switchTo/sendTabTo/getActiveIds from
    60-indicator-switch.js (same IIFE scope) — order matters."""
    order = BUNDLES["workspaces.js"]
    assert order.index("workspaces/60-indicator-switch.js") < order.index("workspaces/65-dock.js")
