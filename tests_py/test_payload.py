"""Update payload channel: builder output, launcher wiring, release flow.

Guards the payload updater end to end: the builder emits a complete,
self-consistent artifact (manifest schema, every seed, hashes that
verify); the channel compares versions and gates on the exact Firefox
base; the Windows launcher hooks the check without breaking seed parity;
and the release workflow publishes the channel files next to the sums
that authenticate them.
"""

import hashlib
import json
import re
import tempfile
import zipfile
from pathlib import Path

import scripts.build_payload as build_payload

ROOT = Path(__file__).resolve().parent.parent


def _write_omni(path: Path, entries: dict[str, bytes]) -> None:
    with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_STORED) as z:
        for name in sorted(entries):
            z.writestr(name, entries[name])


def _synthetic_tree(d: Path) -> dict:
    """Minimal pristine/branded omni pair + seeds + ini, as named paths."""
    b_pristine, b_branded = d / "b0.ja", d / "b1.ja"
    t_pristine, t_branded = d / "t0.ja", d / "t1.ja"
    _write_omni(
        b_pristine,
        {
            "chrome/browser/content/browser/browser.xhtml": b"<stock/>",
            "chrome/browser/content/browser/untouched.js": b"same",
        },
    )
    _write_omni(
        b_branded,
        {
            "chrome/browser/content/browser/browser.xhtml": b"<stock aph/>",
            "chrome/browser/content/browser/untouched.js": b"same",
            "chrome/browser/content/browser/workspaces.js": b"aph",
        },
    )
    _write_omni(t_pristine, {"a.mjs": b"1"})
    _write_omni(t_branded, {"a.mjs": b"1", "actors/x.mjs": b"2"})
    ini = d / "application.ini"
    ini.write_text("[App]\nVersion=157.0.1\n", encoding="utf-8")
    seed = d / "user.js"
    seed.write_text("// seed\n", encoding="utf-8")
    return {
        "browser_omni": b_branded,
        "browser_pristine": b_pristine,
        "toolkit_omni": t_branded,
        "toolkit_pristine": t_pristine,
        "ini": ini,
        "seeds": [(seed, "share/user.js")],
    }


def test_diff_covers_added_and_changed_only() -> None:
    """The payload is exactly the Aph delta: no stock bytes leak in."""
    with tempfile.TemporaryDirectory() as d:
        t = _synthetic_tree(Path(d))
        got = dict(build_payload.diff_omni_entries(t["browser_pristine"], t["browser_omni"]))
        assert set(got) == {
            "chrome/browser/content/browser/browser.xhtml",
            "chrome/browser/content/browser/workspaces.js",
        }
        assert got["chrome/browser/content/browser/browser.xhtml"] == b"<stock aph/>"


def test_assemble_end_to_end() -> None:
    """Synthetic trees in, shippable zip + channel out, hashes verify."""
    with tempfile.TemporaryDirectory() as d:
        t = _synthetic_tree(Path(d))
        out = Path(d) / "out"
        got = build_payload.assemble_payload(
            t["browser_omni"],
            t["browser_pristine"],
            t["toolkit_omni"],
            t["toolkit_pristine"],
            t["ini"],
            t["seeds"],
            "0.9.9",
            out,
        )
        assert got["zip"].name == "aph-payload-0.9.9.zip"
        with zipfile.ZipFile(got["zip"]) as z:
            manifest = json.loads(z.read("manifest.json"))
            assert manifest["format"] == 1
            assert manifest["aph_version"] == "0.9.9"
            assert manifest["firefox"] == "157.0.1"
            assert {f["ja"] for f in manifest["files"]} == {"browser", "toolkit", "share"}
            for f in manifest["files"]:
                assert set(f) == {"ja", "path", "sha256", "size"}
                assert re.fullmatch(r"[0-9a-f]{64}", f["sha256"]), f["path"]
                if f["ja"] == "share":
                    data = z.read(f"share/{f['path']}")
                else:
                    data = z.read(f"{f['ja']}/{f['path']}")
                assert hashlib.sha256(data).hexdigest() == f["sha256"]
                assert len(data) == f["size"]
            # Replace-only: no delete list may ever appear.
            assert "delete" not in manifest and "remove" not in manifest
        version = json.loads(got["version"].read_text(encoding="utf-8"))
        assert version["aph_version"] == "0.9.9"
        assert version["firefox"] == "157.0.1"
        assert version["payload"] == got["zip"].name
        assert version["installer"] == "Aph-Setup-0.9.9.exe"
        payload_bytes = got["zip"].read_bytes()
        assert hashlib.sha256(payload_bytes).hexdigest() == version["payload_sha256"]
        assert version["payload_size"] == len(payload_bytes)


def test_exact_base_gate() -> None:
    """Payload applies only on its build base — never a range, never fuzzy."""
    assert build_payload.payload_applies("157.0.1", "157.0.1")
    assert build_payload.payload_applies(" 157.0.1 ", "157.0.1")
    assert not build_payload.payload_applies("157.0.2", "157.0.1")
    assert not build_payload.payload_applies("158.0", "157.0.1")
    assert not build_payload.payload_applies("", "157.0.1")


def test_version_compare_is_numeric() -> None:
    """Dotted numerics: 0.4.10 beats 0.4.3 (never lexicographic)."""
    assert build_payload.compare_versions("0.4.3", "0.4.3") == 0
    assert build_payload.compare_versions("0.4.10", "0.4.3") == 1
    assert build_payload.compare_versions("0.4.3", "0.5.0") == -1
    assert build_payload.compare_versions("v0.4.3", "0.4.3") == 0
    assert build_payload.compare_versions("1.0", "1.0.0") == 0


def test_ps_updater_house_rules() -> None:
    """Static guards on the updater: stored entries, backups, no blocking."""
    ps = (ROOT / "packaging" / "aph-update.ps1").read_text(encoding="utf-8")
    assert "NoCompression" in ps, "omni.ja entries must be ZIP_STORED (Gecko mmaps them)"
    assert ".aph-prev" in ps, "pre-apply backups required (single-generation rollback)"
    assert "payload-version.txt" in ps, "applied version must be recorded"
    assert "DisplayVersion" in ps, "fresh installs fall back to the installer version"
    assert "Get-FileHash" in ps and "SHA256" in ps, "hash verification required"
    assert "APH_NO_UPDATE" in ps, "opt-out required"
    assert "Test-PayloadBase" in ps, "exact-base gate must be one named mirror of payload_applies"
    assert "APH_UPDATE_CHANNEL" in ps, "channel override required (testing + mirrors)"
    assert '-replace "/", "\\"' not in ps, (
        "no separator rewriting (cross-platform pwsh must run this)"
    )
    # Never blocks launch: every path exits 0 (proceed). No auto-run of
    # the full installer (a session may be alive via remote-reuse).
    assert "exit 2" not in ps, "no launch-skipping exit codes"
    assert "/VERYSILENT" not in ps and "Start-Process" not in ps, (
        "full installer is staged + notified, never auto-run"
    )


def test_bat_hooks_updater_before_seeding() -> None:
    """aph.bat checks the channel first so fresh seeds migrate same-launch."""
    bat = (ROOT / "packaging" / "aph.bat").read_text(encoding="utf-8")
    hook = bat.find("aph-update.ps1")
    assert hook != -1, "launcher must invoke the updater"
    assert "APH_NO_UPDATE" in bat, "opt-out must be honored in batch too"
    assert "powershell" in bat.lower(), "check runs via PowerShell (no Python on user machines)"
    seed = bat.find("user.js")
    assert 0 < hook < seed, "update check must precede profile seeding"
    for name in ("userChrome.css", "userContent.css", "aph-seed-version", ".bak"):
        assert name in bat, f"seed parity must survive the hook: {name}"


def test_release_publishes_the_channel() -> None:
    """The workflow builds the payload once and sums everything it ships."""
    yml = (ROOT / ".github/workflows" / "release.yml").read_text(encoding="utf-8")
    assert "scripts/build_payload.py --out build/payload-out" in yml
    assert "rel-payload" in yml, "payload handed to publish"
    assert "dist/rel-payload/aph-payload-*.zip" in yml
    assert "dist/rel-payload/version.json" in yml
    sums = yml[yml.find("(cd release && sha256sum") :][:400]
    assert "aph-payload-*.zip" in sums and "version.json" in sums
    assert "release/aph-payload-*.zip" in yml and "release/version.json" in yml
    assert "build/win-portable/aph-update.ps1" in yml, "updater ships in portable + installer"
    assert "No auto-update channel yet" not in yml, "stale release-notes claim"
