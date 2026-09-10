"""Unit tests for the omni.ja container helpers."""

import struct

from scripts.aph_rebrand.omni import is_optimized_omni_ja


def _eocd(cd_entries: int, cd_size: int, cd_offset: int) -> bytes:
    return struct.pack("<IHHHHIIH", 0x06054B50, 0, 0, 0, cd_entries, cd_size, cd_offset, 0)


def test_rejects_too_short() -> None:
    assert not is_optimized_omni_ja(b"")
    assert not is_optimized_omni_ja(b"PK\x01\x02" + b"\0" * 20)


def test_rejects_standard_zip() -> None:
    import io
    import zipfile

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("a.txt", "hello")
    assert not is_optimized_omni_ja(buf.getvalue())


def test_detects_optimized_layout() -> None:
    cd_size = 100
    filler = b"PK\x03\x04" + b"\0" * 200
    data = b"HDR!" + b"C" * cd_size + _eocd(3, cd_size, 4) + filler + _eocd(3, cd_size, 4)
    # Fix the CD magic at offset 4 and the trailing EOCD expectation.
    data = data[:4] + b"PK\x01\x02" + data[8:]
    assert is_optimized_omni_ja(data)


def test_rejects_wrong_cd_offset() -> None:
    cd_size = 100
    data = (
        b"HDR!"
        + b"PK\x01\x02"
        + b"C" * (cd_size - 4)
        + _eocd(3, cd_size, 99)
        + b"PK\x03\x04"
        + b"\0" * 200
        + _eocd(3, cd_size, 99)
    )
    assert not is_optimized_omni_ja(data)
