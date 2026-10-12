#!/usr/bin/env python3
"""Does the database have everything a given NEXUS build's Prisma schema expects?

    schema-check.py CATALOG.tsv SCHEMA.prisma [LABEL]

CATALOG.tsv is the output of CATALOG_SQL below (psql -tA -F $'\\t'). Prints what is missing (tables,
columns, enum values) and exits 1 if anything is. Extra tables/columns in the database are fine: that
is exactly the "expand" half of expand/contract, and it is what lets two versions share one database.

The deploy runs it twice before a switch:
  * against the NEW build  -> anything missing = a SQL file was not applied: refuse to switch;
  * against the LIVE build -> anything missing = a contract (drop/rename) already ran while the old
    version is still serving: the live slot is broken and a rollback target would be too.
"""
import re, sys

CATALOG_SQL = """
select 'C', table_name, column_name from information_schema.columns where table_schema = 'public'
union all
select 'E', t.typname, e.enumlabel from pg_type t join pg_enum e on e.enumtypid = t.oid
  join pg_namespace n on n.oid = t.typnamespace where n.nspname = 'public'
"""

if len(sys.argv) >= 2 and sys.argv[1] == "--sql":
    print(CATALOG_SQL.strip()); sys.exit(0)

cat_path, schema_path = sys.argv[1], sys.argv[2]
label = sys.argv[3] if len(sys.argv) > 3 else schema_path

cols, enums = set(), set()
for line in open(cat_path):
    parts = line.rstrip("\n").split("\t")
    if len(parts) != 3: continue
    k, a, b = parts
    (cols if k == "C" else enums).add((a, b))
tables = {t for t, _ in cols}
enum_types = {t for t, _ in enums}

src = open(schema_path).read()
src = re.sub(r"//.*", "", src)
SCALARS = {"String", "Int", "BigInt", "Float", "Decimal", "Boolean", "DateTime", "Json", "Bytes"}

blocks = re.findall(r"^(model|enum|view)\s+(\w+)\s*\{(.*?)^\}", src, re.S | re.M)
models = {n for kind, n, _ in blocks if kind in ("model", "view")}
enum_names = {n for kind, n, _ in blocks if kind == "enum"}

missing = []
for kind, name, body in blocks:
    m = re.search(r'@@map\("([^"]+)"\)', body)
    db_name = m.group(1) if m else name
    if kind == "enum":
        if db_name not in enum_types:
            missing.append("enum type %s" % db_name); continue
        for line in body.splitlines():
            line = line.strip()
            if not line or line.startswith("@@"): continue
            val = line.split()[0]
            mm = re.search(r'@map\("([^"]+)"\)', line)
            label_v = mm.group(1) if mm else val
            if (db_name, label_v) not in enums:
                missing.append("enum value %s.%s" % (db_name, label_v))
        continue
    if "@@ignore" in body: continue
    if db_name not in tables:
        missing.append("table %s" % db_name); continue
    for line in body.splitlines():
        line = line.strip()
        if not line or line.startswith("@@"): continue
        parts = line.split()
        if len(parts) < 2: continue
        fname, ftype = parts[0], parts[1]
        base = re.sub(r"[?\[\]]", "", ftype)
        if "@ignore" in line or "@relation" in line: continue
        if base in models: continue           # relation field, no column
        if base not in SCALARS and base not in enum_names and not base.startswith("Unsupported"):
            continue
        mm = re.search(r'@map\("([^"]+)"\)', line)
        col = mm.group(1) if mm else fname
        if (db_name, col) not in cols:
            missing.append("column %s.%s" % (db_name, col))

if missing:
    print("   schema check [%s]: %d missing in the database:" % (label, len(missing)))
    for x in missing[:60]: print("      - " + x)
    if len(missing) > 60: print("      … and %d more" % (len(missing) - 60))
    sys.exit(1)
print("   schema check [%s]: ok (%d models, %d enums satisfied)" % (label, len(models), len(enum_names)))
