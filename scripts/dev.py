#!/usr/bin/env python3
"""Launch Firefox with Aph overrides - Python replacement for dev.sh.

Prefs & chrome model: bundled defaults and stylesheets live directly inside
browser/omni.ja. User changes made via about:config / Settings persist natively
in prefs.js without profile seeding or user.js write-through. Enterprise policies
(config/policies.json) remain the force-applied mechanism.
"""

import contextlib
import json
import os
import re
import shutil
import subprocess
import sys
import time
from pathlib import Path
from types import ModuleType


def ensure_rebranded(root: Path) -> bool:
    """Run rebrand.py if branding or rebrand script changed.

    Returns True when a rebrand actually ran: omni.ja offsets move, so
    the profile's startupCache must be purged for that launch (stale
    chrome/resource mappings silently break privileged content like
    about:newtab's resource://newtab/ bundles — blank page, Security
    Error, zero console signal).
    """
    try:
        # Ensure root is on sys.path for `import scripts.rebrand`
        if str(root) not in sys.path:
            sys.path.insert(0, str(root))
        from scripts.rebrand import rebrand  # type: ignore

        omni = root / "build" / "firefox" / "browser" / "omni.ja"
        root_omni = root / "build" / "firefox" / "omni.ja"
        # Only rebrand if backup missing (first run) or branding newer than omni.ja
        if not omni.is_file():
            return False
        # Check mtime of all branding assets (sources + built bundles) AND
        # the rebrand package itself.
        watch_files = (
            list((root / "branding").rglob("*.js"))
            + list((root / "branding").rglob("*.css"))
            + list((root / "branding").rglob("*.html"))
            + list((root / "branding").rglob("*.ftl"))
            # Logos feed icon slicing + omni injection (icons.py, assets.py):
            # a swapped aph.png must count as stale, not launch silently old.
            + list((root / "branding").rglob("*.png"))
            + list((root / "branding").rglob("*.svg"))
            + list((root / "branding").rglob("*.ico"))
            + list((root / "scripts" / "aph_rebrand").rglob("*.py"))
            + [
                root / "scripts" / "rebrand.py",
                root / "scripts" / "build_assets.py",
                root / "config" / "default-prefs.js",
            ]
        )
        newest_source = max(f.stat().st_mtime for f in watch_files if f.is_file())
        # Both browser and root omni.ja get patched — a missing backup or a
        # stale timestamp on EITHER one must trigger a rebrand.
        targets = [p for p in (omni, root_omni) if p.is_file()]
        if any(not p.with_suffix(".ja.bak").exists() for p in targets) or newest_source > min(
            p.stat().st_mtime for p in targets
        ):
            print("Rebranding omni.ja to Aph...")
            rebrand()
            return True
        return False
    except Exception as e:
        print(f"Warning: rebrand check failed: {e}", file=sys.stderr)
        return False


def _rebrand_cache_module(root: Path) -> ModuleType | None:
    """Import scripts.aph_rebrand.cache for profile-cache helpers (best
    effort — a missing package must never block a launch)."""
    try:
        if str(root) not in sys.path:
            sys.path.insert(0, str(root))
        from scripts.aph_rebrand import cache

        return cache
    except Exception as e:
        print(f"Warning: profile-cache helpers unavailable: {e}", file=sys.stderr)
        return None


def merge_policies(root: Path) -> None:
    """Copy config/policies.json into Firefox's distribution dir."""
    custom_policies_file = root / "config" / "policies.json"
    dist_dir = root / "build" / "firefox" / "distribution"
    dist_dir.mkdir(parents=True, exist_ok=True)
    target_policies_file = dist_dir / "policies.json"
    if custom_policies_file.is_file():
        shutil.copy2(custom_policies_file, target_policies_file)


def _profile_lock_module():
    """Load the dependency-free shared lock helper.

    dev.py runs as a script (``scripts/`` on sys.path), so put the repo
    root first the same way the rebrand/session imports do.
    """
    root = Path(__file__).resolve().parent.parent
    if str(root) not in sys.path:
        sys.path.insert(0, str(root))
    from scripts.profile_lock import clear_stale_lock
    from scripts.profile_lock import profile_locked as locked

    return locked, clear_stale_lock


def profile_locked(profile: Path) -> bool:
    """True if a running Firefox (not a reused PID) holds this profile."""
    locked, _ = _profile_lock_module()
    return locked(profile)


def clear_stale_profile_lock(profile: Path) -> bool:
    """Drop a lock whose PID is dead or belongs to an unrelated process."""
    _, clear = _profile_lock_module()
    return clear(profile)


SESSION_BACKUP_DIR = "aph-session-backups"
SESSION_BACKUP_KEEP = 20
SESSION_RESTORE_MARKER = ".aph-session-restore-pending"
SESSION_RESTORE_MAX_ATTEMPTS = 3
# A marker older than this means Aph ran for a long time without confirming
# the restore. Do not roll back a day of later browsing to recover it.
SESSION_RESTORE_MAX_AGE = 24 * 60 * 60


def snapshot_session_state(profile: Path, keep: int = SESSION_BACKUP_KEEP) -> Path | None:
    """Keep a cold copy of the restore set before a launch can rotate it.

    Firefox moves sessionstore.jsonlz4 to sessionstore-backups/previous.jsonlz4
    on the next clean write, and the first write of the following launch
    replaces previous. A quick launch that quits before session restore
    completes can therefore leave only the degraded state. These timestamped
    copies live outside Firefox's loadOrder, so that state cannot erase the
    session the user actually had. prepare_session_state() restores one
    automatically when the browser could not confirm a healthy restore; it
    can also be copied back over the profile by hand while Aph is closed.

    Best effort: a launch must proceed even if the profile is unreadable or
    the disk is full. Callers skip this while Firefox holds the profile.
    """
    sources: list[Path] = []
    clean = profile / "sessionstore.jsonlz4"
    if clean.is_file():
        sources.append(clean)
    backups = profile / "sessionstore-backups"
    if backups.is_dir():
        with contextlib.suppress(OSError):
            sources.extend(sorted(p for p in backups.iterdir() if p.is_file()))
    if not sources:
        return None

    root = profile / SESSION_BACKUP_DIR
    stamp = time.strftime("%Y%m%d-%H%M%S")
    dest = root / stamp
    suffix = 1
    while dest.exists():
        dest = root / f"{stamp}-{suffix}"
        suffix += 1
    try:
        dest.mkdir(parents=True)
        for src in sources:
            out = dest / src.relative_to(profile)
            out.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(src, out)
    except OSError as e:
        shutil.rmtree(dest, ignore_errors=True)
        print(f"Warning: could not back up session state: {e}", file=sys.stderr)
        return None

    # Prune only our own timestamped directories, never user files.
    try:
        snaps = [
            d
            for d in root.iterdir()
            if d.is_dir() and re.fullmatch(r"\d{8}-\d{6}(?:-\d+)?", d.name)
        ]
        snaps.sort(key=lambda d: d.stat().st_mtime)
        if keep > 0:
            for old in snaps[:-keep]:
                shutil.rmtree(old, ignore_errors=True)
    except OSError:
        pass
    return dest


def _read_restore_marker(profile: Path) -> dict:
    """Read the launcher/browser restore-health handshake (best effort)."""
    try:
        data = json.loads((profile / SESSION_RESTORE_MARKER).read_text(encoding="utf-8"))
    except (OSError, UnicodeError, ValueError):
        return {}
    return data if isinstance(data, dict) else {}


def _write_restore_marker(profile: Path, snapshot: Path, attempts: int) -> None:
    """Record which pre-launch snapshot to fall back to if this launch fails.

    Written atomically: a crash while updating it must not leave a half
    marker that points at the wrong snapshot.
    """
    marker = profile / SESSION_RESTORE_MARKER
    payload = {
        "snapshot": snapshot.name,
        "attempts": attempts,
        "started": int(time.time()),
    }
    try:
        tmp = marker.with_name(marker.name + ".tmp")
        tmp.write_text(json.dumps(payload), encoding="utf-8")
        tmp.replace(marker)
    except OSError as e:
        print(f"Warning: could not write session restore marker: {e}", file=sys.stderr)


def _usable_session_file(path: Path) -> bool:
    """A session file must exist and contain bytes to be worth restoring."""
    try:
        return path.is_file() and path.stat().st_size > 0
    except OSError:
        return False


def _snapshot_path(profile: Path, name: object) -> Path | None:
    """Resolve a marker's snapshot name, rejecting paths outside our root."""
    if not isinstance(name, str) or not re.fullmatch(r"\d{8}-\d{6}(?:-\d+)?", name):
        return None
    candidate = profile / SESSION_BACKUP_DIR / name
    return candidate if candidate.is_dir() else None


def _latest_snapshot(profile: Path) -> Path | None:
    """Newest timestamped cold snapshot, used when a marker is unreadable."""
    root = profile / SESSION_BACKUP_DIR
    try:
        snapshots = [
            d
            for d in root.iterdir()
            if d.is_dir() and re.fullmatch(r"\d{8}-\d{6}(?:-\d+)?", d.name)
        ]
        snapshots.sort(key=lambda d: d.stat().st_mtime)
    except OSError:
        return None
    return snapshots[-1] if snapshots else None


def _copy_snapshot(profile: Path, snapshot: Path) -> bool:
    """Copy one cold snapshot's restore set back over the profile."""
    root = (profile / SESSION_BACKUP_DIR).resolve()
    try:
        snapshot.resolve().relative_to(root)
    except (OSError, ValueError):
        return False

    copied = False
    try:
        clean = snapshot / "sessionstore.jsonlz4"
        if _usable_session_file(clean):
            shutil.copy2(clean, profile / "sessionstore.jsonlz4")
            copied = True
        backups = snapshot / "sessionstore-backups"
        if backups.is_dir():
            dest = profile / "sessionstore-backups"
            dest.mkdir(parents=True, exist_ok=True)
            for src in backups.iterdir():
                if _usable_session_file(src):
                    shutil.copy2(src, dest / src.name)
                    copied = True
    except OSError as e:
        print(f"Warning: could not restore session snapshot: {e}", file=sys.stderr)
    # The snapshot may have been taken while the clean slot was already
    # missing. Firefox loads "clean" before its backups, so promote the
    # newest restored backup rather than leaving a degraded file there.
    if not _usable_session_file(snapshot / "sessionstore.jsonlz4") and (
        _restore_latest_backup(profile) is not None
    ):
        copied = True
    return copied


def _restore_latest_backup(profile: Path) -> Path | None:
    """Promote the newest Firefox backup into the clean slot.

    Size is a trap: after a crash the old ``previous.jsonlz4`` can be
    larger than the newer ``recovery.jsonlz4`` that holds the last state.
    Picking by size rolled the daily profile back hours (seen live:
    13.7 MB previous from 11:43 beat the 5.4 MB recovery from 19:53).
    """
    backups = profile / "sessionstore-backups"
    candidates: list[Path] = []
    if backups.is_dir():
        with contextlib.suppress(OSError):
            candidates.extend(p for p in backups.iterdir() if _usable_session_file(p))
    if not candidates:
        return None
    try:
        source = max(candidates, key=lambda p: (p.stat().st_mtime, p.stat().st_size))
    except OSError:
        return None
    try:
        shutil.copy2(source, profile / "sessionstore.jsonlz4")
    except OSError as e:
        print(f"Warning: could not promote session backup: {e}", file=sys.stderr)
        return None
    return source


def prepare_session_state(profile: Path) -> Path | None:
    """Snapshot the restore set, or recover it after an unconfirmed restore.

    The browser removes ``SESSION_RESTORE_MARKER`` only after it has seen a
    healthy restore. If the marker survives a launch (quick quit, crash, or
    blank tabs), the next launch copies the pre-launch snapshot back before
    Firefox can rotate it away. A few consecutive failures stop the automatic
    loop so a permanently malformed snapshot cannot trap every launch.

    Returns the snapshot taken for this launch, or None when there is no
    session state to protect. Callers must skip this while the profile is held.
    """
    if profile_locked(profile):
        return None

    # Firefox prefers the clean slot over every backup. If it disappeared
    # or was truncated (crash before write, or the 2026-10-20 loss), promote
    # the newest backup now instead of letting the next restore blank it.
    if not _usable_session_file(profile / "sessionstore.jsonlz4"):
        source = _restore_latest_backup(profile)
        if source is not None:
            print(
                f"Restored session from crash backup {source.name} "
                "(previous shutdown left no clean session)."
            )

    marker = profile / SESSION_RESTORE_MARKER
    had_marker = marker.exists()
    data = _read_restore_marker(profile) if had_marker else {}
    attempts = data.get("attempts", 0)
    if isinstance(attempts, bool) or not isinstance(attempts, int) or attempts < 0:
        attempts = 0
    started = data.get("started")
    stale = (
        isinstance(started, (int, float))
        and not isinstance(started, bool)
        and time.time() - started > SESSION_RESTORE_MAX_AGE
    )
    recovered = False

    if had_marker and stale:
        print(
            "Warning: the previous session restore was never confirmed, but "
            "the marker is over a day old; keeping the current session. "
            f"Snapshots remain in {profile / SESSION_BACKUP_DIR}.",
            file=sys.stderr,
        )
    elif had_marker and attempts < SESSION_RESTORE_MAX_ATTEMPTS:
        snapshot = _snapshot_path(profile, data.get("snapshot"))
        if snapshot is None:
            snapshot = _latest_snapshot(profile)
        # Preserve anything the failed launch wrote (including tabs opened
        # during it) before replacing its restore set with the good snapshot.
        snapshot_session_state(profile)
        if snapshot is not None and _copy_snapshot(profile, snapshot):
            print(f"Recovered session state from snapshot {snapshot.name}.")
            recovered = True
        else:
            source = _restore_latest_backup(profile)
            if source is not None:
                print(f"Recovered session state from backup {source.name}.")
                recovered = True
        attempts += 1
    elif had_marker:
        print(
            f"Warning: session restore failed {attempts} times; not retrying "
            f"automatically. Snapshots remain in {profile / SESSION_BACKUP_DIR}.",
            file=sys.stderr,
        )

    dest = snapshot_session_state(profile)
    if dest is None:
        with contextlib.suppress(OSError):
            marker.unlink()
        return None

    # Attempts exhausted or the marker is stale: leave the snapshot for
    # manual recovery, but stop restoring it on every launch.
    if had_marker and (stale or (attempts >= SESSION_RESTORE_MAX_ATTEMPTS and not recovered)):
        with contextlib.suppress(OSError):
            marker.unlink()
        return dest

    # First launch records its snapshot as attempt 1. A recovered launch
    # carries the incremented count forward so repeated failures are bounded.
    _write_restore_marker(profile, dest, attempts + (0 if had_marker else 1))
    return dest


# Caches that can outlive the defaults they were built from. cache2 holds
# the about:home / about:newtab document Firefox serves to the privileged
# about-content process; its version check keys on appinfo.appBuildID only,
# so a document baked with an old body inline style (e.g. an Activity Stream
# `--newtab-wallpaper: url(...)`) survives a pref change. startupCache holds
# chrome/resource mappings, stale after a rebrand. Wiping both after a migration
# is what makes a changed default actually take effect on next launch.
STALE_CACHE_DIRS = ("cache2", "startupCache")


def wipe_caches(profile: Path) -> list[str]:
    """Delete STALE_CACHE_DIRS under profile. Returns the names removed.

    Callers must have already established the profile is unlocked
    (migrate_legacy_profile refuses while Firefox holds the lock).
    """
    removed = []
    for name in STALE_CACHE_DIRS:
        target = profile / name
        try:
            if target.is_dir():
                shutil.rmtree(target)
                removed.append(name)
        except OSError as e:
            print(f"Warning: could not remove {target}: {e}", file=sys.stderr)
    return removed


DAILY_FLAGS = ("--daily", "--local")


def resolve_launch(argv: list[str], root: Path) -> tuple[Path, list[str]]:
    """Split launcher flags from Firefox passthrough args.

    ``--daily`` (alias ``--local``) selects the persistent daily profile at
    ``~/.config/aph/profile``. Default is the repo ``./profile``.
    Remote is always allowed, so external links reuse the running instance.

    Returns ``(profile, firefox_args)``.
    """
    extra = [a for a in argv if a not in DAILY_FLAGS]
    daily = len(extra) != len(argv)
    profile = Path.home() / ".config" / "aph" / "profile" if daily else root / "profile"
    return profile, extra


def skip_existing_launch(profile: Path, extra_args: list[str]) -> bool:
    """True when a launch would only open a blank duplicate window.

    Firefox opens a fresh window when invoked with no URL while an instance
    already holds the profile. That is how a daily icon click can look like
    "all my tabs are gone": the new window has one blank tab, while the real
    window (with every restored tab) is still behind it. Only skip the bare
    form; URLs and explicit ``--new-window`` still forward normally.
    """
    return not extra_args and profile_locked(profile)


def main() -> None:
    root = Path(__file__).resolve().parent.parent
    profile, extra_args = resolve_launch(sys.argv[1:], root)
    binary = root / "build" / "firefox" / ("firefox.exe" if sys.platform == "win32" else "firefox")

    profile.mkdir(parents=True, exist_ok=True)
    if clear_stale_profile_lock(profile):
        print(f"Cleared stale profile lock: {profile / 'lock'}")

    # Cold safety copy before anything can rotate or overwrite the session.
    # If the previous launch never confirmed a healthy restore, this also
    # rolls the profile back to that launch's pre-restore snapshot. A held
    # profile is live; its next cold launch captures the settled files.
    if not profile_locked(profile):
        prepare_session_state(profile)

    # Auto-merge enterprise policies & extensions
    merge_policies(root)

    # Self-heal before launch: a leftover 0-byte favicons.sqlite makes the
    # whole Places init fail as "database is locked" (history/bookmarks
    # dead; daily profile, 2026-10-18). Skips held profiles internally —
    # a running instance owns its own files.
    rebrand_cache = _rebrand_cache_module(root)
    if rebrand_cache is not None:
        rebrand_cache.drop_zero_byte_favicons(profile)

    # Auto-rebrand browser/omni.ja. A fresh rebrand moves omni offsets;
    # rebrand() also drops the purge marker, so this launch passes
    # -purgecaches and the stale startupCache (which would otherwise
    # keep mapping chrome and resource:// URLs to the old bytes) is
    # rebuilt.
    ensure_rebranded(root)

    if not binary.is_file():
        print(f"ERROR: {binary} not found. Extract Firefox first.", file=sys.stderr)
        sys.exit(1)

    # Always pass -purgecaches if cache was cleared
    purgecache_marker = profile / ".purgecache_done"
    if profile_locked(profile) and not purgecache_marker.exists():
        # A rebrand landed since this instance started (manual rebrand
        # or another profile's launch): the purge marker is gone, so the
        # running process has the previous build memory-mapped.
        # Forwarding into it would open a window on stale code — the
        # refetch/dev/quit loop. Quit first, then relaunch.
        print(
            f"ERROR: branding changed under the running Aph on {profile} - "
            "quit it first, then re-run.",
            file=sys.stderr,
        )
        sys.exit(1)
    if skip_existing_launch(profile, extra_args):
        print(
            f"Aph is already running on {profile}. Use the existing window "
            "(or pass --new-window to force another one)."
        )
        return
    if not purgecache_marker.exists():
        purgecache_marker.touch()
        # Purge pending (rebrand/clear landed while a launch was held):
        # that held profile kept its favicons files, so wipe them here —
        # this profile is idle (a held one exited ERROR above), the safe
        # rebuild slot before this launch starts.
        if rebrand_cache is not None:
            rebrand_cache.wipe_favicons(profile)
        cmd = [str(binary), "-purgecaches", "--profile", str(profile), *extra_args]
    else:
        cmd = [str(binary), "--profile", str(profile), *extra_args]
    # Replace current process (like exec in bash)
    try:
        # Use exec on POSIX for exact bash parity
        os.execv(cmd[0], cmd)
    except (AttributeError, OSError):
        # Fallback for non-POSIX, or if exec fails (e.g. bad binary)
        result = subprocess.run(cmd, check=False)
        sys.exit(result.returncode)


if __name__ == "__main__":
    main()
