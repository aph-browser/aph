"""Pre-launch session safety snapshots.

Guards the launcher's cold copy of the Firefox restore set: a quick launch
that quits before session restore finishes can otherwise overwrite the
previous clean session before the user can recover it.
"""

import json
import os
from pathlib import Path

from scripts.dev import (
    SESSION_BACKUP_DIR,
    SESSION_RESTORE_MARKER,
    prepare_session_state,
    snapshot_session_state,
)


def _profile_with_session(tmp_path: Path) -> Path:
    profile = tmp_path / "profile"
    backups = profile / "sessionstore-backups"
    backups.mkdir(parents=True)
    (profile / "sessionstore.jsonlz4").write_bytes(b"clean")
    (backups / "previous.jsonlz4").write_bytes(b"previous")
    (backups / "recovery.jsonlz4").write_bytes(b"recovery")
    (backups / "recovery.baklz4").write_bytes(b"recovery-bak")
    (backups / "upgrade.jsonlz4-20260101000000").write_bytes(b"upgrade")
    return profile


def test_snapshot_copies_the_whole_restore_set(tmp_path: Path) -> None:
    profile = _profile_with_session(tmp_path)

    dest = snapshot_session_state(profile)

    assert dest is not None
    assert dest.parent == profile / SESSION_BACKUP_DIR
    assert (dest / "sessionstore.jsonlz4").read_bytes() == b"clean"
    assert (dest / "sessionstore-backups" / "previous.jsonlz4").read_bytes() == b"previous"
    assert (dest / "sessionstore-backups" / "recovery.jsonlz4").read_bytes() == b"recovery"
    assert (dest / "sessionstore-backups" / "recovery.baklz4").read_bytes() == b"recovery-bak"
    assert (
        dest / "sessionstore-backups" / "upgrade.jsonlz4-20260101000000"
    ).read_bytes() == b"upgrade"


def test_snapshot_without_session_files_is_a_noop(tmp_path: Path) -> None:
    profile = tmp_path / "profile"
    profile.mkdir()

    assert snapshot_session_state(profile) is None
    assert not (profile / SESSION_BACKUP_DIR).exists()


def test_snapshot_retains_only_the_newest_copies(tmp_path: Path) -> None:
    profile = _profile_with_session(tmp_path)

    for _ in range(5):
        assert snapshot_session_state(profile, keep=2) is not None

    snapshots = [p for p in (profile / SESSION_BACKUP_DIR).iterdir() if p.is_dir()]
    assert len(snapshots) == 2


def test_snapshot_ignores_unrelated_directories(tmp_path: Path) -> None:
    profile = _profile_with_session(tmp_path)
    root = profile / SESSION_BACKUP_DIR
    keep = root / "my-own-notes"
    keep.mkdir(parents=True)

    for _ in range(3):
        snapshot_session_state(profile, keep=1)

    assert keep.is_dir()
    assert len([p for p in root.iterdir() if p.is_dir()]) == 2


def test_prepare_marks_the_snapshot_for_the_next_launch(tmp_path: Path) -> None:
    profile = _profile_with_session(tmp_path)

    dest = prepare_session_state(profile)

    assert dest is not None
    marker = json.loads((profile / SESSION_RESTORE_MARKER).read_text())
    assert marker["snapshot"] == dest.name
    assert marker["attempts"] == 1


def test_prepare_recovers_a_snapshot_after_an_unconfirmed_restore(tmp_path: Path) -> None:
    profile = _profile_with_session(tmp_path)
    good = snapshot_session_state(profile)
    assert good is not None
    (profile / SESSION_RESTORE_MARKER).write_text(
        json.dumps({"snapshot": good.name, "attempts": 1})
    )

    # What a blank/quick restore leaves behind: the clean slot and the
    # first-line backups now describe the degraded window.
    backups = profile / "sessionstore-backups"
    (profile / "sessionstore.jsonlz4").write_bytes(b"degraded")
    (backups / "previous.jsonlz4").write_bytes(b"degraded-previous")
    (backups / "recovery.jsonlz4").write_bytes(b"degraded-recovery")

    dest = prepare_session_state(profile)

    assert dest is not None
    assert (profile / "sessionstore.jsonlz4").read_bytes() == b"clean"
    assert (backups / "previous.jsonlz4").read_bytes() == b"previous"
    assert (backups / "recovery.jsonlz4").read_bytes() == b"recovery"
    marker = json.loads((profile / SESSION_RESTORE_MARKER).read_text())
    assert marker["attempts"] == 2


def test_prepare_promotes_the_largest_backup_without_a_snapshot(tmp_path: Path) -> None:
    profile = _profile_with_session(tmp_path)
    backups = profile / "sessionstore-backups"
    (backups / "recovery.baklz4").write_bytes(b"large-recovery" * 100)
    (profile / "sessionstore.jsonlz4").write_bytes(b"small")
    (profile / SESSION_RESTORE_MARKER).write_text(json.dumps({"attempts": 0}))

    dest = prepare_session_state(profile)

    assert dest is not None
    assert (profile / "sessionstore.jsonlz4").read_bytes() == b"large-recovery" * 100
    marker = json.loads((profile / SESSION_RESTORE_MARKER).read_text())
    assert marker["attempts"] == 1


def test_prepare_prefers_the_newest_backup_not_the_largest(tmp_path: Path) -> None:
    """A crash leaves recovery newer than previous; size must not win.

    Live regression: 13.7 MB previous from 11:43 beat the 5.4 MB recovery
    from 19:53, rolling the daily profile back hours on every launch.
    """
    profile = tmp_path / "profile"
    backups = profile / "sessionstore-backups"
    backups.mkdir(parents=True)
    old = backups / "previous.jsonlz4"
    new = backups / "recovery.jsonlz4"
    old.write_bytes(b"old-and-large" * 1000)
    new.write_bytes(b"new-small")
    os.utime(old, (1_000, 1_000))
    os.utime(new, (2_000, 2_000))

    dest = prepare_session_state(profile)

    assert dest is not None
    assert (profile / "sessionstore.jsonlz4").read_bytes() == b"new-small"


def test_prepare_promotes_a_backup_when_the_clean_slot_is_missing(tmp_path: Path) -> None:
    profile = _profile_with_session(tmp_path)
    backups = profile / "sessionstore-backups"
    (backups / "recovery.baklz4").write_bytes(b"large-recovery" * 100)
    (profile / "sessionstore.jsonlz4").unlink()

    dest = prepare_session_state(profile)

    assert dest is not None
    assert (profile / "sessionstore.jsonlz4").read_bytes() == b"large-recovery" * 100
    assert (profile / SESSION_RESTORE_MARKER).exists()


def test_prepare_replaces_a_zero_byte_clean_slot(tmp_path: Path) -> None:
    profile = _profile_with_session(tmp_path)
    backups = profile / "sessionstore-backups"
    (backups / "recovery.baklz4").write_bytes(b"large-recovery" * 100)
    (profile / "sessionstore.jsonlz4").write_bytes(b"")

    prepare_session_state(profile)

    assert (profile / "sessionstore.jsonlz4").read_bytes() == b"large-recovery" * 100


def test_prepare_promotes_a_backup_when_the_snapshot_had_no_clean_slot(
    tmp_path: Path,
) -> None:
    profile = _profile_with_session(tmp_path)
    backups = profile / "sessionstore-backups"
    (backups / "recovery.baklz4").write_bytes(b"large-recovery" * 100)
    (profile / "sessionstore.jsonlz4").unlink()
    good = snapshot_session_state(profile)
    assert good is not None
    (profile / SESSION_RESTORE_MARKER).write_text(
        json.dumps({"snapshot": good.name, "attempts": 1})
    )
    (profile / "sessionstore.jsonlz4").write_bytes(b"degraded")

    dest = prepare_session_state(profile)

    assert dest is not None
    assert (profile / "sessionstore.jsonlz4").read_bytes() == b"large-recovery" * 100


def test_prepare_stops_restoring_after_repeated_failures(tmp_path: Path) -> None:
    profile = _profile_with_session(tmp_path)
    (profile / SESSION_RESTORE_MARKER).write_text(json.dumps({"attempts": 3}))
    (profile / "sessionstore.jsonlz4").write_bytes(b"still-degraded")

    assert prepare_session_state(profile) is not None

    assert (profile / "sessionstore.jsonlz4").read_bytes() == b"still-degraded"
    assert not (profile / SESSION_RESTORE_MARKER).exists()


def test_prepare_never_rolls_back_a_day_of_later_browsing(tmp_path: Path) -> None:
    profile = _profile_with_session(tmp_path)
    good = snapshot_session_state(profile)
    assert good is not None
    (profile / SESSION_RESTORE_MARKER).write_text(
        json.dumps({"snapshot": good.name, "attempts": 1, "started": 0})
    )
    (profile / "sessionstore.jsonlz4").write_bytes(b"a-day-of-new-tabs")

    assert prepare_session_state(profile) is not None

    assert (profile / "sessionstore.jsonlz4").read_bytes() == b"a-day-of-new-tabs"
    assert not (profile / SESSION_RESTORE_MARKER).exists()


def test_prepare_skips_a_profile_firefox_is_using(tmp_path: Path, monkeypatch) -> None:
    import scripts.profile_lock as profile_lock

    monkeypatch.setattr(profile_lock, "_process_matches_firefox_profile", lambda pid, path: True)
    profile = _profile_with_session(tmp_path)
    (profile / "lock").symlink_to(f"127.0.0.1:+{os.getpid()}")

    assert prepare_session_state(profile) is None
    assert not (profile / SESSION_RESTORE_MARKER).exists()
