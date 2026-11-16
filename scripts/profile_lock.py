"""Firefox profile-lock detection shared by the launcher and cache helpers.

A profile ``lock`` symlink can outlive the Firefox that wrote it. Its PID
is then reused by an unrelated process, and a bare ``kill(pid, 0)`` reports
a live lock forever (seen live: a stale lock PID belonged to a waybar
thread, so every launch refused with "branding changed under the running
Aph"). Verify the PID is actually a Firefox process for this profile
before treating the lock as held.
"""

from __future__ import annotations

import contextlib
import os
from pathlib import Path


def _lock_pid(profile: Path) -> int | None:
    """PID embedded in Firefox's ``lock`` symlink, if the format is valid."""
    lock = profile / "lock"
    try:
        if not lock.is_symlink():
            return None
        target = os.readlink(lock)  # e.g. "127.0.0.1:+12345"
        pid = target.rsplit(":", 1)[-1].lstrip("+")
        return int(pid) if pid.isdigit() else None
    except (OSError, ValueError):
        return None


def _profile_arg(args: list[str]) -> str | None:
    """Profile path passed on the command line, if any."""
    for i, arg in enumerate(args):
        for flag in ("--profile", "-profile"):
            if arg == flag and i + 1 < len(args):
                return args[i + 1]
            prefix = flag + "="
            if arg.startswith(prefix):
                return arg[len(prefix) :]
    return None


def _process_matches_firefox_profile(pid: int, profile: Path) -> bool:
    """True when ``pid`` is a live Firefox process for ``profile``.

    Linux exposes the command line via procfs. When it is unavailable
    (non-Linux, or a permission edge), fall back to the liveness check so
    behavior stays conservative.
    """
    proc = Path("/proc") / str(pid)
    try:
        raw = (proc / "cmdline").read_bytes()
    except OSError:
        try:
            os.kill(pid, 0)
        except OSError:
            return False
        return True

    args = [os.fsdecode(arg) for arg in raw.split(b"\0") if arg]
    if not args:
        return False

    exe = os.path.basename(args[0]).lower()
    if not (exe.startswith("firefox") or exe.startswith("aph")):
        return False

    # Reused PIDs are most often threads/content processes, never the
    # browser parent that owns the lock.
    if any(arg == "-contentproc" or arg.startswith("-contentproc") for arg in args):
        return False

    named = _profile_arg(args)
    if named is None:
        # Firefox with the default profile: it matches any lock we cannot
        # disprove (better to preserve the old conservative behavior).
        return True

    candidate = Path(named)
    try:
        if not candidate.is_absolute():
            candidate = (proc / "cwd").resolve() / candidate
        return candidate.resolve() == profile.resolve()
    except OSError:
        return True


def profile_locked(profile: Path) -> bool:
    """True if a running Firefox holds this profile."""
    pid = _lock_pid(profile)
    if pid is None:
        return False
    return _process_matches_firefox_profile(pid, profile)


def clear_stale_lock(profile: Path) -> bool:
    """Remove a lock left by a process that no longer owns this profile.

    Only touches the lock when ``profile_locked`` is false, so a real
    running Firefox (including one on another profile with a reused PID)
    is never disturbed.
    """
    lock = profile / "lock"
    if not lock.is_symlink() or profile_locked(profile):
        return False
    try:
        lock.unlink()
    except OSError:
        return False
    parent = profile / ".parentlock"
    with contextlib.suppress(OSError):
        parent.unlink(missing_ok=True)
    return True
