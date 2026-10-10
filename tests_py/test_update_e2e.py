"""Updater end-to-end: the real aph-update.ps1 against stub channels.

Hermetic and fast — synthetic omni.ja trees (no Firefox download), a
loopback file server as the release channel, a staged install tree as
the patient. Skipped entirely when ``pwsh`` is absent (plain Linux CI),
and exercised for real on ``windows-latest`` (pwsh preinstalled) plus
any dev machine with cross-platform pwsh.

Coverage: happy-path apply with post-apply verification, up-to-date
no-op, hash mismatch, base mismatch (staged, never executed),
read-only rollback, opt-out silence, downgrade refusal. Every case
asserts exit 0 — the updater never blocks launch.
"""

import hashlib
import json
import os
import shutil
import subprocess
import sys
import threading
import zipfile
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import pytest

import scripts.build_payload as build_payload

ROOT = Path(__file__).resolve().parent.parent
PS1 = ROOT / "packaging" / "aph-update.ps1"

PWSH = shutil.which("pwsh")
needs_pwsh = pytest.mark.skipif(not PWSH, reason="pwsh not installed")

FX_VERSION = "157.0.1"
BROWSER_XHTML = "chrome/browser/content/browser/browser.xhtml"
WORKSPACES_JS = "chrome/browser/content/browser/workspaces.js"


def _write_omni(path: Path, entries: dict[str, bytes]) -> None:
    with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_STORED) as z:
        for name in sorted(entries):
            z.writestr(name, entries[name])


def _read_omni(path: Path) -> dict[str, bytes]:
    with zipfile.ZipFile(path, "r") as z:
        return {info.filename: z.read(info.filename) for info in z.infolist()}


def _make_world(
    tmp: Path, *, installed_version="0.0.1", channel_version="9.9.9", channel_firefox=FX_VERSION
) -> dict:
    """Stage install tree + build channel payload, return paths."""
    install = tmp / "install"
    (install / "firefox" / "browser").mkdir(parents=True)
    (install / "config").mkdir(parents=True)
    # Installed tree: stale workspaces.js, toolkit without the new actor.
    _write_omni(
        install / "firefox" / "browser" / "omni.ja",
        {
            BROWSER_XHTML: b"<stock aph v1/>",
            WORKSPACES_JS: b"/* aph 0.0.1 */",
        },
    )
    _write_omni(install / "firefox" / "omni.ja", {"a.mjs": b"1"})
    (install / "firefox" / "application.ini").write_text(
        "[App]\nVersion=157.0.1\n", encoding="utf-8"
    )
    for name in ("user.js", "userChrome.css", "userContent.css"):
        (install / "config" / name).write_text("/* old */\n", encoding="utf-8")
    (install / "payload-version.txt").write_text(installed_version, encoding="utf-8")

    # Channel payload built from synthetic pristine/branded pairs.
    src = tmp / "src"
    src.mkdir()
    _write_omni(
        src / "b0.ja",
        {
            BROWSER_XHTML: b"<stock aph v1/>",
            WORKSPACES_JS: b"/* aph 0.0.1 */",
        },
    )
    _write_omni(
        src / "b1.ja",
        {
            BROWSER_XHTML: b"<stock aph v1/>",
            WORKSPACES_JS: b"/* aph 9.9.9 */",
        },
    )
    _write_omni(src / "t0.ja", {"a.mjs": b"1"})
    _write_omni(src / "t1.ja", {"a.mjs": b"1", "actors/x.mjs": b"2"})
    ini = src / "application.ini"
    ini.write_text("[App]\nVersion=157.0.1\n", encoding="utf-8")
    seed = src / "seed-user.js"
    seed.write_text("// new seed\n", encoding="utf-8")
    out = tmp / "channel-out"
    # NOTE: assemble names the zip from aph_version; channel_version wins.
    built = build_payload.assemble_payload(
        src / "b1.ja",
        src / "b0.ja",
        src / "t1.ja",
        src / "t0.ja",
        ini,
        [(seed, "share/user.js")],
        channel_version,
        out,
    )
    served = tmp / "served"
    served.mkdir()
    shutil.copy(built["zip"], served / built["zip"].name)
    version = json.loads((out / "version.json").read_text(encoding="utf-8"))
    version["firefox"] = channel_firefox
    (served / "version.json").write_text(json.dumps(version), encoding="utf-8")
    return {"install": install, "served": served, "version": version, "zip_name": built["zip"].name}


class _CountingHandler(SimpleHTTPRequestHandler):
    def do_GET(self):
        self.server.requests.append(self.path)
        return super().do_GET()

    def log_message(self, *args):  # quiet
        pass


@pytest.fixture()
def channel_server(tmp_path):
    """Loopback channel: serves a dir, counts requests, tears down clean."""
    www = tmp_path / "www"
    www.mkdir()
    server = ThreadingHTTPServer(("127.0.0.1", 0), partial(_CountingHandler, directory=str(www)))
    server.requests = []
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    port = server.server_address[1]
    yield {"www": www, "base": f"http://127.0.0.1:{port}/", "server": server}
    server.shutdown()
    thread.join(timeout=5)


def _run_updater(install: Path, base: str, localappdata: Path, extra_env=None):
    env = dict(os.environ)
    env["APH_UPDATE_CHANNEL"] = base
    env["LOCALAPPDATA"] = str(localappdata)
    if extra_env:
        env.update(extra_env)
    args = [
        PWSH,
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        str(PS1),
        "-InstallDir",
        str(install),
    ]
    try:
        proc = subprocess.run(args, capture_output=True, text=True, timeout=120, env=env)
    except subprocess.TimeoutExpired as e:
        raise AssertionError(f"updater hung: {e.stdout}") from e
    assert proc.returncode == 0, (
        f"updater must never block launch: rc={proc.returncode}\n{proc.stderr}"
    )
    return proc


def _browser_entries(install: Path) -> dict[str, bytes]:
    return _read_omni(install / "firefox" / "browser" / "omni.ja")


@needs_pwsh
def test_happy_path_applies_and_verifies(tmp_path, channel_server):
    w = _make_world(tmp_path)
    for name in ("version.json", w["zip_name"]):
        shutil.copy(w["served"] / name, channel_server["www"] / name)
    before = _browser_entries(w["install"])
    assert before[WORKSPACES_JS] == b"/* aph 0.0.1 */"

    proc = _run_updater(w["install"], channel_server["base"], tmp_path / "lad")
    after = _browser_entries(w["install"])
    assert after[WORKSPACES_JS] == b"/* aph 9.9.9 */", "entry replaced with payload bytes"
    toolkit = _read_omni(w["install"] / "firefox" / "omni.ja")
    assert toolkit.get("actors/x.mjs") == b"2", "new toolkit entry added"
    assert (w["install"] / "payload-version.txt").read_text(encoding="utf-8").strip() == "9.9.9"
    assert (w["install"] / "config" / "user.js").read_text(encoding="utf-8") == "// new seed\n"
    log = (tmp_path / "lad" / "Aph" / "update" / "update.log").read_text(encoding="utf-8")
    assert "applied" in log
    assert "updated to" in proc.stdout


@needs_pwsh
def test_up_to_date_is_noop(tmp_path, channel_server):
    w = _make_world(tmp_path, installed_version="9.9.9")
    for name in ("version.json", w["zip_name"]):
        shutil.copy(w["served"] / name, channel_server["www"] / name)
    before = _browser_entries(w["install"])
    _run_updater(w["install"], channel_server["base"], tmp_path / "lad")
    assert _browser_entries(w["install"]) == before, "nothing rewritten when current"


@needs_pwsh
def test_hash_mismatch_is_noop(tmp_path, channel_server):
    w = _make_world(tmp_path)
    shutil.copy(w["served"] / "version.json", channel_server["www"] / "version.json")
    raw = (w["served"] / w["zip_name"]).read_bytes()
    tampered = bytearray(raw)
    tampered[len(tampered) // 2] ^= 0xFF
    (channel_server["www"] / w["zip_name"]).write_bytes(bytes(tampered))
    before = _browser_entries(w["install"])
    _run_updater(w["install"], channel_server["base"], tmp_path / "lad")
    assert _browser_entries(w["install"]) == before, "tampered payload must not apply"
    assert (w["install"] / "payload-version.txt").read_text(encoding="utf-8").strip() == "0.0.1"


@needs_pwsh
def test_base_mismatch_stages_but_never_runs(tmp_path, channel_server):
    w = _make_world(tmp_path, channel_firefox="999.0")
    installer = b"MZ-fake-installer"
    (channel_server["www"] / "Aph-Setup-9.9.9.exe").write_bytes(installer)
    sums = hashlib.sha256(installer).hexdigest() + "  Aph-Setup-9.9.9.exe\n"
    (channel_server["www"] / "SHA256SUMS").write_text(sums, encoding="utf-8")
    shutil.copy(w["served"] / "version.json", channel_server["www"] / "version.json")
    before = _browser_entries(w["install"])
    _run_updater(w["install"], channel_server["base"], tmp_path / "lad")
    assert _browser_entries(w["install"]) == before, "payload held on base skew"
    assert (w["install"] / "payload-version.txt").read_text(encoding="utf-8").strip() == "0.0.1"
    pending = tmp_path / "lad" / "Aph" / "update" / "update-pending.txt"
    assert pending.is_file(), "full installer staged for the user"
    assert json.loads(pending.read_text(encoding="utf-8"))["aph_version"] == "9.9.9"


@needs_pwsh
def test_readonly_omni_rolls_back(tmp_path, channel_server):
    w = _make_world(tmp_path)
    for name in ("version.json", w["zip_name"]):
        shutil.copy(w["served"] / name, channel_server["www"] / name)
    omnis = [w["install"] / "firefox" / "browser" / "omni.ja", w["install"] / "firefox" / "omni.ja"]
    before = {p: p.read_bytes() for p in omnis}
    if sys.platform == "win32":
        for p in omnis:
            os.system(f'attrib +r "{p}"')
    else:
        for p in omnis:
            p.chmod(0o444)
    try:
        _run_updater(w["install"], channel_server["base"], tmp_path / "lad")
    finally:
        if sys.platform == "win32":
            for p in omnis:
                os.system(f'attrib -r "{p}"')
        else:
            for p in omnis:
                p.chmod(0o644)
    for p in omnis:
        assert p.read_bytes() == before[p], "failed apply leaves bytes identical"
    assert (w["install"] / "payload-version.txt").read_text(encoding="utf-8").strip() == "0.0.1"


@needs_pwsh
def test_opt_out_is_silent(tmp_path, channel_server):
    w = _make_world(tmp_path)
    for name in ("version.json", w["zip_name"]):
        shutil.copy(w["served"] / name, channel_server["www"] / name)
    channel_server["server"].requests = []
    _run_updater(
        w["install"], channel_server["base"], tmp_path / "lad", extra_env={"APH_NO_UPDATE": "1"}
    )
    assert channel_server["server"].requests == [], "opt-out must not touch the network"
    assert (w["install"] / "payload-version.txt").read_text(encoding="utf-8").strip() == "0.0.1"


@needs_pwsh
def test_downgrade_refused(tmp_path, channel_server):
    w = _make_world(tmp_path, installed_version="9.9.9")
    version = dict(w["version"])
    version["aph_version"] = "0.0.0"
    (channel_server["www"] / "version.json").write_text(json.dumps(version), encoding="utf-8")
    _run_updater(w["install"], channel_server["base"], tmp_path / "lad")
    assert (w["install"] / "payload-version.txt").read_text(encoding="utf-8").strip() == "9.9.9"
