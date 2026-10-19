#!/usr/bin/env python3
"""Rename upload files/folders named by pre-conversion ids (UUIDv7 conversion, docs/internal/UUID-MIGRATION.md).

    rename-files.py plan  MAP.tsv ROOT [ROOT...] > plan.tsv     # read-only: what would move
    rename-files.py apply PLAN.tsv                              # os.rename each line (refuses to overwrite)
    rename-files.py undo  PLAN.tsv                              # the reverse, for a rollback

MAP.tsv = `old_id<TAB>new_id` (psql -AtF $'\\t' -c "select old_id, new_id from legacy_id_map").
Names are tokenized exactly like uuid_mig.apply_hits (scripts/uuid-migration/uuid-lib.sql), so a file name
and the URL the database holds for it always change the same way:
  avatars/<userId>.jpg, project-icons/<projectId>.png, project-icons/folder-<folderId>.png,
  attendance/checkin-<userId>-<ts>-<rand>.jpg, chunk dirs <userId>/<uploadId>/ ...
Renames are inside the same filesystem (instant, no copy). Deepest entries first, so a renamed folder
never invalidates a path still to be renamed below it.
"""
import os
import re
import sys

TOKEN = re.compile(r"([A-Za-z0-9_-]+)|([^A-Za-z0-9_-]+)")
DASH_PIECES = re.compile(r"([A-Za-z0-9_]+)|(-+)")
UNDER_PIECES = re.compile(r"([A-Za-z0-9]+)|(_+)")


def remap(name, mp):
    out = []
    for m in TOKEN.finditer(name):
        tok = m.group(1)
        if tok is None:
            out.append(m.group(2))
            continue
        if tok in mp:
            out.append(mp[tok])
            continue
        if "_" in tok or "-" in tok:
            for p in DASH_PIECES.finditer(tok):
                part = p.group(1)
                if part is None:
                    out.append(p.group(2))
                elif part in mp:
                    out.append(mp[part])
                elif "_" in part:
                    for q in UNDER_PIECES.finditer(part):
                        out.append(mp.get(q.group(1), q.group(1)) if q.group(1) else q.group(2))
                else:
                    out.append(part)
        else:
            out.append(tok)
    return "".join(out)


def load_map(path):
    mp = {}
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.rstrip("\n")
            if not line:
                continue
            old, new = line.split("\t")[:2]
            mp[old] = new
    return mp


def plan(map_path, roots):
    mp = load_map(map_path)
    n = 0
    for root in roots:
        for dirpath, dirnames, filenames in os.walk(root, topdown=False):
            for name in filenames + dirnames:
                new = remap(name, mp)
                if new != name:
                    print(f"{os.path.join(dirpath, name)}\t{os.path.join(dirpath, new)}")
                    n += 1
    print(f"planned {n} renames", file=sys.stderr)


def run(plan_path, reverse):
    lines = [l.rstrip("\n").split("\t") for l in open(plan_path, encoding="utf-8") if l.strip()]
    if reverse:
        lines = [(b, a) for a, b in reversed(lines)]
    done = skipped = 0
    for src, dst in lines:
        if not os.path.lexists(src):
            skipped += 1
            continue
        if os.path.lexists(dst):
            sys.exit(f"refusing to overwrite {dst} (from {src}); {done} done so far")
        os.rename(src, dst)
        done += 1
    print(f"{'undone' if reverse else 'renamed'} {done}, skipped {skipped} (source gone)", file=sys.stderr)


if __name__ == "__main__":
    if len(sys.argv) >= 4 and sys.argv[1] == "plan":
        plan(sys.argv[2], sys.argv[3:])
    elif len(sys.argv) == 3 and sys.argv[1] in ("apply", "undo"):
        run(sys.argv[2], sys.argv[1] == "undo")
    else:
        sys.exit(__doc__)
