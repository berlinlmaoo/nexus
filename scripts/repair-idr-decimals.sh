#!/usr/bin/env bash
# Repair Rupiah custom-field values stored with thousands separators (owner bug 12 Oct 2026).
#
# A NUMBER custom field with options.format "currency-idr" must hold integer digits. Before the fix
# (src/lib/custom-field-number.ts) the server stored whatever was typed, so "369.000" (= Rp 369.000)
# was kept as text and the web board read it as Rp 369. This script rewrites those values with the
# same rule the server now applies on every write:
#   - a separator followed by 3+ digits is grouping:  "369.000" -> 369000, "13.600000" -> 13600000,
#     "280,000" -> 280000, "Rp 1.500.000" -> 1500000
#   - 1-2 digits after the LAST separator are cents and are rounded: "150.000,50" -> 150001
#
# DRY RUN by default: prints every row before -> after and changes nothing.
#   scripts/repair-idr-decimals.sh            # prod (container nexus-postgres), dry run
#   scripts/repair-idr-decimals.sh --apply    # backs the rows up to CSV, then updates in one transaction
# Target another database with env: PG_CONTAINER=nexus-dev-postgres PG_USER=nexus_dev PG_DB=nexus_dev
# Backup directory: BACKUP_DIR (default ~/nexus-backups/idr-repair). Idempotent: a second run finds 0 rows.
set -euo pipefail

PG_CONTAINER="${PG_CONTAINER:-nexus-postgres}"
PG_USER="${PG_USER:-nexus_user}"
PG_DB="${PG_DB:-nexus_db}"
BACKUP_DIR="${BACKUP_DIR:-$HOME/nexus-backups/idr-repair}"
APPLY=0
[[ "${1:-}" == "--apply" ]] && APPLY=1

psql_ro() { docker exec -i -e PGOPTIONS="-c default_transaction_read_only=on" "$PG_CONTAINER" psql -v ON_ERROR_STOP=1 -U "$PG_USER" -d "$PG_DB" "$@"; }
psql_rw() { docker exec -i "$PG_CONTAINER" psql -v ON_ERROR_STOP=1 -U "$PG_USER" -d "$PG_DB" "$@"; }

# The rows to fix and their new value. `s` = the value without "Rp"/"IDR", spaces and a trailing ",-".
read -r -d '' CANDIDATES <<'SQL' || true
WITH base AS (
  SELECT v.id, v."taskId", v.value AS before, t.title, p.name AS project, f.name AS field,
         regexp_replace(regexp_replace(regexp_replace(v.value, '[[:space:]]', '', 'g'), '^(-?)(Rp\.?|IDR)', '\1', 'i'), '[.,]?-+$', '') AS s
  FROM "CustomFieldValue" v
  JOIN "CustomField" f ON f.id = v."customFieldId"
  JOIN "Task" t ON t.id = v."taskId"
  LEFT JOIN "Project" p ON p.id = f."projectId"
  WHERE f.type = 'NUMBER'
    AND lower(coalesce(f.options->>'format', f.options #>> '{}', '')) IN ('currency-idr', 'idr', 'rupiah')
    AND v.value <> ''
    AND v.value !~ '^-?[0-9]+$'
), calc AS (
  SELECT *,
    CASE
      -- 1-2 digits after the last separator = cents: integer part, rounded
      WHEN s ~ '^-?[0-9][0-9.,]*[.,][0-9]{1,2}$' THEN
        (CASE WHEN s LIKE '-%' THEN '-' ELSE '' END) ||
        ((regexp_replace(substring(s FROM '^-?([0-9.,]*)[.,][0-9]{1,2}$'), '[^0-9]', '', 'g')::numeric
          + CASE WHEN substring(s FROM '[.,]([0-9])[0-9]?$')::int >= 5 THEN 1 ELSE 0 END)::text)
      -- otherwise every separator is grouping
      WHEN s ~ '^-?[0-9][0-9.,]*$' THEN
        (CASE WHEN s LIKE '-%' THEN '-' ELSE '' END) || (regexp_replace(s, '[^0-9]', '', 'g')::numeric::text)
      ELSE NULL  -- not a number at all: left alone, listed for a human
    END AS after
  FROM base
)
SQL

echo "== Rupiah custom-field values with separators (${PG_CONTAINER}/${PG_DB}) =="
psql_ro -P pager=off <<SQL
${CANDIDATES}
SELECT "taskId", left(title, 60) AS task, project, field, before, coalesce(after, '(manual review)') AS after
FROM calc ORDER BY project, title;
SQL

if [[ $APPLY -ne 1 ]]; then
  echo "Dry run — nothing changed. Re-run with --apply to write (backup goes to ${BACKUP_DIR})."
  exit 0
fi

mkdir -p "$BACKUP_DIR"
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP="${BACKUP_DIR}/idr-decimals-${PG_DB}-${STAMP}.csv"
psql_ro -q > "$BACKUP" <<SQL
COPY (${CANDIDATES}
SELECT id, "taskId", before, after FROM calc) TO STDOUT WITH CSV HEADER;
SQL
echo "Backup: ${BACKUP} ($(($(wc -l < "$BACKUP") - 1)) rows)"

psql_rw <<SQL
BEGIN;
${CANDIDATES}
UPDATE "CustomFieldValue" v SET value = calc.after
FROM calc WHERE v.id = calc.id AND calc.after IS NOT NULL AND v.value = calc.before;
COMMIT;
SQL
echo "Applied. Undo from the CSV: UPDATE \"CustomFieldValue\" SET value = <before> WHERE id = <id>."
