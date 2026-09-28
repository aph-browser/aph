"""Temp containers: shared persisted tracking, unique names, sweeps.

Guards the wiring that stops "Tmp 1" pile-ups: creation skips taken
names, tracked ids live in aph.tempContainers (shared across windows
and sessions, not a per-window set), reconcile runs post-restore and
the unload path sweeps surviving windows.
"""

from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "branding" / "src" / "workspaces"


def test_temp_tracking_is_shared_and_unique() -> None:
    src = (SRC / "70-temp-keys.js").read_text(encoding="utf-8")
    for token in (
        "aph.tempContainers",
        "isTempContainerId",
        "nextTempName",
        "sweepTempContainers",
        "sweepOrphanTempNames",
        "reconcileTempContainers",
        "initTempTracking",
    ):
        assert token in src, f"temp lifecycle missing: {token}"
    assert "tempCounter = 1" not in src, "counter must never reset under live identities"
    assert "Clean slate" not in src


def test_temp_hooks_wired() -> None:
    init = (SRC / "110-chrome-init.js").read_text(encoding="utf-8")
    assert "initTempTracking()" in init
    assert "sweepTempContainers(window)" in init, "unload must sweep surviving windows"
    startup = (SRC / "100-startup.js").read_text(encoding="utf-8")
    assert "reconcileTempContainers()" in startup, "reconcile runs once restore settles"
    bindings = (SRC / "10-container-bindings.js").read_text(encoding="utf-8")
    assert "tempContainers.has" not in bindings, "bind guards must see cross-window ids"
    assert bindings.count("isTempContainerId") == 4
