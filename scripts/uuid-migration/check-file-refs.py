#!/usr/bin/env python3
"""Every upload the database points at exists on disk (before, and after the planned renames).

    check-file-refs.py DATA.sql UPLOADS_ROOT [PLAN.tsv]

DATA.sql = pg_dump --data-only of the database. With PLAN.tsv the disk is taken as it will be after
`rename-files.py apply PLAN.tsv` (nothing is renamed). Prints the count of references, how many are
missing, and up to 10 missing examples. Used to prove that the converted database and the renamed
files agree exactly as the original database and files did (UUID-MIGRATION.md, verification).
"""
import os
import re
import sys
from urllib.parse import unquote

REF = re.compile(r"(?:/api/files/|/uploads/)([A-Za-z0-9._~%/-]+)")

data, root = sys.argv[1], sys.argv[2].rstrip("/")
moves = {}
if len(sys.argv) > 3:
    for line in open(sys.argv[3], encoding="utf-8"):
        a, b = line.rstrip("\n").split("\t")
        moves[a] = b
gone = set(moves)
born = {b: a for a, b in moves.items()}

def exists(rel):
    path = os.path.normpath(os.path.join(root, rel))
    if path in born:
        return True
    if path in gone:
        return False
    # a parent folder may have moved too
    parts = rel.split("/")
    for i in range(1, len(parts)):
        parent = os.path.join(root, *parts[:i])
        if parent in gone:
            return False
    return os.path.exists(path)

refs = set()
with open(data, encoding="utf-8", errors="replace") as f:
    for line in f:
        for m in REF.finditer(line):
            rel = unquote(m.group(1)).rstrip("/")
            if rel.startswith(("attachments/legal/", "attachments/vault/", "attachments/pipeline/")):
                continue  # served from their own routes, names are random (not ids)
            refs.add(rel)
missing = sorted(r for r in refs if not exists(r))
print(f"refs {len(refs)} missing {len(missing)}")
for r in missing[:10]:
    print("  missing:", r)
