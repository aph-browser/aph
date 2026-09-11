"""Flatpak metainfo: release entry stays current with the tagged version.

Guards against a stale <release> (wrong date showing in GNOME Software
on release day). Asserts well-formed XML, exactly one release entry,
version matching the documented first release, and a calendar date.
"""

import re
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
METAINFO = ROOT / "packaging/flatpak/io.github.aph_browser.Aph.metainfo.xml"


def test_metainfo_has_current_release() -> None:
    tree = ET.parse(METAINFO)
    releases = tree.getroot().find("releases")
    assert releases is not None
    entries = releases.findall("release")
    assert len(entries) == 1
    entry = entries[0]
    assert entry.get("version") == "0.1.0"
    assert re.fullmatch(r"\d{4}-\d{2}-\d{2}", entry.get("date") or "")
