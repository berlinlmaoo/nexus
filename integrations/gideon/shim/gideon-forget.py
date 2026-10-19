#!/usr/bin/env python3
"""GIDEON Hermes session privacy (owner, 19 Oct 2026): forget what NEXUS already keeps.

Every GIDEON request is one Hermes run, and Hermes writes that run's whole prompt and answer into
<HERMES_HOME>/state.db. NEXUS does not need it back: conversation context comes from NEXUS sending the
history with each request (proved 19 Oct 2026 on dev: a follow-up still answered from turns whose Hermes
sessions had been deleted), and the credits ledger reads a run's token usage right after the run (the shim,
readSessionUsage) and stores it in NEXUS (GideonCreditUsage). So:

  sessions ID [ID ...]   delete these sessions now (the shim calls this after a meeting-notes run, once
                         the usage has been read). Only GIDEON shim sessions are touched (below); any other
                         id is skipped and reported.
  retention [--days 90]  delete GIDEON shim sessions inactive for more than N days (daily timer), plus
                         orphaned request dumps that old, then compact if anything was deleted.
  compact                FTS merge + VACUUM + WAL truncate, so deleted text does not linger in free pages,
                         old FTS segments or the WAL. Run by `retention` when something was deleted since
                         the last compact (marker file .gideon-compact-pending).

A "GIDEON shim session" = source 'cli' started in the shim's workdir (cwd .../oracle-workdir). That is what
keeps this safe on the PROD default profile (~/.hermes), which also holds Telegram / WhatsApp / api_server
gateway sessions, cron runs and Berlin's own CLI sessions: none of those match. `--scope profile` widens
the match to every 'cli' session and is only for a profile that belongs to GIDEON alone (gideon-dev).

Deletion goes through Hermes' own SessionDB.delete_sessions (messages, FTS rows via triggers, usage rows via
ON DELETE CASCADE, delegate children, transcript files), on a connection with secure_delete ON.

Run with the Hermes venv python and HERMES_HOME set explicitly (refused otherwise).
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path

SHIM_WHERE = "s.source = 'cli' AND s.cwd LIKE '%/oracle-workdir'"
PROFILE_WHERE = "s.source = 'cli'"
MARKER = ".gideon-compact-pending"


def _home() -> Path:
    home = os.environ.get("HERMES_HOME", "").strip()
    if not home:
        print(json.dumps({"error": "HERMES_HOME must be set explicitly"}))
        sys.exit(2)
    p = Path(home).expanduser()
    if not (p / "state.db").exists():
        print(json.dumps({"error": f"no state.db in {p}"}))
        sys.exit(2)
    return p


def _open(home: Path):
    from hermes_state import SessionDB

    db = SessionDB(home / "state.db")
    # Freed pages are zeroed instead of left readable (per connection; set before any write).
    with db._lock:
        db._conn.execute("PRAGMA secure_delete = ON")
    return db


def _ids(db, where: str, params: list) -> list[str]:
    with db._read_ctx() as conn:
        return [r[0] for r in conn.execute(f"SELECT s.id FROM sessions s WHERE {where}", params).fetchall()]


def _delete(db, home: Path, ids: list[str]) -> int:
    n = 0
    for i in range(0, len(ids), 400):
        n += db.delete_sessions(ids[i:i + 400], sessions_dir=home / "sessions")
    if n:
        try:
            (home / MARKER).touch()
        except OSError:
            pass
    return n


def _compact(db, home: Path) -> dict:
    started = time.monotonic()
    try:
        db.vacuum()  # optimize_fts() + VACUUM + wal_checkpoint(TRUNCATE)
    except Exception as e:  # busy: keep the marker, the next run tries again
        return {"compacted": False, "error": str(e)[:200]}
    try:
        (home / MARKER).unlink(missing_ok=True)
    except OSError:
        pass
    return {"compacted": True, "ms": int((time.monotonic() - started) * 1000)}


def main() -> int:
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("sessions")
    s.add_argument("ids", nargs="+")
    s.add_argument("--scope", choices=["shim", "profile"], default="shim")
    r = sub.add_parser("retention")
    r.add_argument("--days", type=float, default=90)
    r.add_argument("--scope", choices=["shim", "profile"], default="shim")
    r.add_argument("--dry-run", action="store_true")
    sub.add_parser("compact")
    a = ap.parse_args()

    home = _home()
    db = _open(home)
    try:
        if a.cmd == "sessions":
            want = [i for i in dict.fromkeys(a.ids) if i and len(i) <= 80]
            where = SHIM_WHERE if a.scope == "shim" else PROFILE_WHERE
            ph = ",".join("?" * len(want))
            ok = _ids(db, f"s.id IN ({ph}) AND {where}", want) if want else []
            n = _delete(db, home, ok)
            print(json.dumps({"deleted": n, "skipped": [i for i in want if i not in ok]}))
            return 0
        if a.cmd == "compact":
            print(json.dumps(_compact(db, home)))
            return 0
        # retention
        cutoff = time.time() - a.days * 86400
        where = (SHIM_WHERE if a.scope == "shim" else PROFILE_WHERE) + (
            " AND COALESCE(s.pinned, 0) = 0"
            " AND COALESCE(s.last_activity_at, s.ended_at, s.started_at) < ?"
            " AND COALESCE((SELECT MAX(m.timestamp) FROM messages m WHERE m.session_id = s.id), 0) < ?"
        )
        ids = _ids(db, where, [cutoff, cutoff])
        out = {"days": a.days, "scope": a.scope, "matched": len(ids)}
        if a.dry_run:
            out["sample"] = ids[:5]
            print(json.dumps(out))
            return 0
        out["deleted"] = _delete(db, home, ids)
        # Request dumps of failed calls carry the prompt too; Hermes names them by session id, so a dump whose
        # session is gone (or that is simply this old) goes as well.
        dumps = 0
        sdir = home / "sessions"
        if a.scope == "profile" and sdir.is_dir():
            for f in sdir.glob("request_dump_*.json"):
                try:
                    if f.stat().st_mtime < cutoff:
                        f.unlink()
                        dumps += 1
                except OSError:
                    pass
        out["dumps"] = dumps
        if (home / MARKER).exists():
            out.update(_compact(db, home))
        print(json.dumps(out))
        return 0
    finally:
        try:
            db.close()
        except Exception:
            pass


if __name__ == "__main__":
    sys.exit(main())
