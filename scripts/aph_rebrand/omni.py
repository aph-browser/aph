"""Firefox omni.ja container helpers.

Gecko requires omni.ja entries to be ZIP_STORED (no compression) for
memory-mapping. Firefox ships omni.ja in an optimized CD-first layout
which ``zipfile`` cannot read, so the pristine backup is normalized to a
standard ZIP first (Firefox reads both layouts).
"""

from __future__ import annotations

import os
import shutil
import struct
import tempfile
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path


def is_optimized_omni_ja(data: bytes) -> bool:
    """Detect Firefox's optimized omni.ja layout: [4-byte hdr][CD][EOCD][Local][EOCD].

    The 4-byte header varies per build (not a constant magic), so detect
    structurally: CD at file offset 4, EOCD at end with cd_offset == 4.
    """
    if len(data) < 30:
        return False
    if data[4:8] != b"PK\x01\x02":
        return False
    if data[-22:-18] != b"PK\x05\x06":
        return False
    try:
        sig, _d1, _d2, _d3, cd_entries, cd_size, cd_offset, _comment_len = struct.unpack(
            "<IHHHHIIH", data[-22:]
        )
    except struct.error:
        return False
    if sig != 0x06054B50:
        return False
    if cd_offset != 4:
        return False
    if cd_entries == 0 or cd_size == 0:
        return False
    # CD must fit before the final EOCD
    return not 4 + cd_size + 22 >= len(data)


def normalize_omni_ja(ja_path: Path) -> bool:
    """Convert Firefox's optimized omni.ja (CD-first) to standard ZIP (local-first).

    Optimized layout: [4-byte hdr][Central Directory][EOCD][Local entries][EOCD]
    Standard layout:  [Local entries][Central Directory][EOCD]

    Also rewrites each CD entry's "relative offset of local header" since local
    entries shift from `local_start` to 0. Returns True if converted.
    """
    with open(ja_path, "rb") as f:
        data = f.read()

    if not is_optimized_omni_ja(data):
        return False

    eocd = data[-22:]
    sig, _d1, _d2, _d3, cd_entries, cd_size, _cd_offset, comment_len = struct.unpack(
        "<IHHHHIIH", eocd
    )

    cd_start = 4
    cd_end = cd_start + cd_size
    # Local entries start right after the middle EOCD (22 bytes) — verify by
    # locating the first local file header rather than assuming the offset.
    local_start = data.find(b"PK\x03\x04", cd_end)
    if local_start == -1:
        print(f"WARNING: {ja_path.name} looks optimized but no local headers found")
        return False

    cd_bytes = bytearray(data[cd_start:cd_end])
    local_data = bytearray(data[local_start : len(data) - 22])

    if not local_data.startswith(b"PK\x03\x04"):
        print(f"WARNING: unexpected local data start in {ja_path.name}")
        return False

    # Fix "relative offset of local header" in each central directory entry:
    # old offsets are file offsets, new file starts locals at 0.
    pos = 0
    for fixed in range(cd_entries):
        if pos + 46 > len(cd_bytes):
            break
        if cd_bytes[pos : pos + 4] != b"PK\x01\x02":
            break
        # offset 42 (from CD entry start) = relative offset of local header (4 bytes LE)
        local_hdr_offset = int.from_bytes(cd_bytes[pos + 42 : pos + 46], "little")
        new_offset = local_hdr_offset - local_start
        if new_offset < 0:
            raise ValueError(
                f"CD entry {fixed} points at file offset {local_hdr_offset}, "
                f"before local data start {local_start} — unexpected omni.ja layout"
            )
        cd_bytes[pos + 42 : pos + 46] = new_offset.to_bytes(4, "little", signed=False)
        # filename length at offset 28, extra length at 30, comment length at 32
        fname_len = int.from_bytes(cd_bytes[pos + 28 : pos + 30], "little")
        extra_len = int.from_bytes(cd_bytes[pos + 30 : pos + 32], "little")
        comment_len_entry = int.from_bytes(cd_bytes[pos + 32 : pos + 34], "little")
        pos += 46 + fname_len + extra_len + comment_len_entry

    new_cd_offset = len(local_data)
    new_eocd = struct.pack(
        "<IHHHHIIH", sig, _d1, _d2, _d3, cd_entries, cd_size, new_cd_offset, comment_len
    )
    standard_zip = bytes(local_data) + bytes(cd_bytes) + new_eocd

    tmp_fd, tmp_path_str = tempfile.mkstemp(suffix=".ja", dir=str(ja_path.parent))
    os.close(tmp_fd)
    try:
        with open(tmp_path_str, "wb") as f:
            f.write(standard_zip)
        shutil.move(tmp_path_str, str(ja_path))
        print(f"Normalized {ja_path.name} from Firefox optimized JAR to standard ZIP")
    finally:
        if os.path.exists(tmp_path_str):
            os.unlink(tmp_path_str)
    return True


@contextmanager
def atomic_ja_temp(ja_path: Path) -> Iterator[Path]:
    """Yield a temp path in the same directory for atomic replace.

    The mkstemp handle is closed immediately: holding it across
    ``shutil.move`` breaks Windows (file lock). The temp lives in the
    target directory so the final move stays on one filesystem.
    """
    # mkstemp returns an open handle we never use (ZipFile opens by path).
    # Close it at once: holding it across shutil.move breaks Windows (file lock).
    tmp_fd, tmp_path_str = tempfile.mkstemp(suffix=".ja", dir=str(ja_path.parent))
    os.close(tmp_fd)
    tmp_path = Path(tmp_path_str)
    try:
        yield tmp_path
    finally:
        if tmp_path.exists():
            tmp_path.unlink(missing_ok=True)
