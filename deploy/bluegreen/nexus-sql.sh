#!/usr/bin/env bash
# NEXUS schema SQL under blue-green: ledger + expand/contract guard (deploy/bluegreen/README.md).
#
#   nexus-sql.sh dev|prod|vps status                 every prisma/sql file: applied / PENDING / contract
#   nexus-sql.sh dev|prod pending                exit 1 if an expand file is not applied (the deploy gate)
#   nexus-sql.sh dev|prod apply FILE [--contract-ok]
#   nexus-sql.sh dev|prod record FILE --yes      it was applied by hand: write it in the ledger only
#   nexus-sql.sh dev|prod baseline [--from DIR] --yes   record every file in DIR (default the repo) as baseline
#   nexus-sql.sh dev|prod check IMAGE [LABEL]    does the database satisfy IMAGE's Prisma schema?
#
# The rules (two app versions share ONE database during a blue-green release):
#  * EXPAND files (the default): add tables/columns/indexes/enum values, backfill data. Must be harmless to
#    the version that is live now. Apply them BEFORE deploying the code that needs them; the deploy
#    refuses to switch while one is pending.
#  * CONTRACT files (drop/rename/narrow/NOT NULL): header line `-- bluegreen: contract`. Only once no
#    running or rollback-target version needs the objects, i.e. a release AFTER the code stopped using them
#    and after the old slot was stopped. They never block a deploy; `apply` refuses them without --contract-ok.
#  * `apply` lints the file, dry-runs it inside a transaction that is rolled back, and checks the
#    resulting catalog against the Prisma schema of every RUNNING slot image. Only then it applies it for
#    real and writes the ledger (table nexus_sql_ledger: name, sha256, applied_at, applied_by, kind).
set -uo pipefail
PROFILE="${1:-}"; shift || true
case "$PROFILE" in
  dev)  PG=nexus-dev-postgres; PGU=nexus_dev; PGD=nexus_dev; REPO="$HOME/nexus-dev"; SLOT_PREFIX=nexus-dev-app- ;;
  prod) PG=nexus-postgres; PGU=nexus_user; PGD=nexus_db; REPO="$HOME/nexus"; SLOT_PREFIX=nexus-app-
        [ -e /var/lib/nexus-fence/tripped ] && { echo "PAGAR AKTIF: NEXUS dilayani VPS — jangan ubah database kantor."; exit 1; } ;;
  vps)  PG=nexus-standby; PGU=nexus_user; PGD=nexus_db; REPO=/srv/nexus-src; SLOT_PREFIX=nexus-app-
        [ "$(docker exec nexus-standby psql -U nexus_user -d nexus_db -tAc 'select pg_is_in_recovery()' 2>/dev/null | tr -d '[:space:]')" = f ] \
          || { [ "${1:-}" = status ] || [ "${1:-}" = check ] || { echo "VPS database is a standby: SQL is applied at the office"; exit 1; }; } ;;
  *) sed -n '2,9p' "$0"; exit 2 ;;
esac
HERE="$(cd "$(dirname "$0")" && pwd)"
SQLDIR="${NEXUS_SQL_DIR:-$REPO/prisma/sql}"
CMD="${1:-status}"; shift || true

red()   { printf '\033[31m%s\033[0m\n' "$*"; }
green() { printf '\033[32m%s\033[0m\n' "$*"; }
psqlc() { docker exec -i "$PG" psql -U "$PGU" -d "$PGD" -v ON_ERROR_STOP=1 -q "$@"; }

ensure_ledger() {
  psqlc -c "set client_min_messages to warning; create table if not exists public.nexus_sql_ledger (
    name text primary key, sha256 text not null, applied_at timestamptz not null default now(),
    applied_by text, kind text not null default 'applied', note text)" >/dev/null
}
ledger() { psqlc -tA -F $'\t' -c "select name, sha256, kind from public.nexus_sql_ledger" 2>/dev/null; }
is_contract() { grep -qiE '^--[[:space:]]*bluegreen:[[:space:]]*contract' "$1"; }
sha() { sha256sum "$1" | cut -c1-64; }

# Destructive statements: allowed only in a contract file.
DESTRUCTIVE_RE='(^|[^a-z_])(drop[[:space:]]+(table|column|type|view|schema|materialized)|rename([[:space:]]+(column|to|value))|alter[[:space:]]+column[[:space:]]+[^;]*[[:space:]](type|set[[:space:]]+not[[:space:]]+null)|truncate)([^a-z_]|$)'
lint() {  # $1 file -> prints offending lines, returns 1 if destructive
  local hits; hits=$(sed -e 's/--.*$//' "$1" | tr 'A-Z' 'a-z' | grep -nE "$DESTRUCTIVE_RE" | head -5)
  [ -z "$hits" ] && return 0
  echo "$hits" | sed 's/^/      /'; return 1
}

running_slot_images() {  # "container image" per running blue-green slot (or the legacy single app)
  docker ps --format '{{.Names}} {{.Image}}' | awk -v p="$SLOT_PREFIX" 'index($1,p)==1 && $1 !~ /-prev$/'
  [ "$PROFILE" = prod ] && docker ps --format '{{.Names}} {{.Image}}' | awk '$1=="nexus-app-beta"'
  [ "$PROFILE" = dev ] && docker ps --format '{{.Names}} {{.Image}}' | awk '$1=="nexus-dev-app"'
  return 0
}

schema_of_image() {  # $1 image $2 out file
  local c; c=$(docker create "$1" 2>/dev/null) || return 1
  docker cp "$c:/app/src/generated/prisma/schema.prisma" "$2" >/dev/null 2>&1; local rc=$?
  docker rm -f "$c" >/dev/null 2>&1; return $rc
}

catalog() { psqlc -tA -F $'\t' -c "$(python3 "$HERE/schema-check.py" --sql)"; }

check_image() {  # $1 image $2 label [$3 catalog file]
  local tmp; tmp=$(mktemp -d); local cat="${3:-}"
  schema_of_image "$1" "$tmp/schema.prisma" || { red "   cannot read schema.prisma from $1"; rm -rf "$tmp"; return 2; }
  [ -n "$cat" ] || { cat="$tmp/catalog.tsv"; catalog > "$cat" || { rm -rf "$tmp"; return 2; }; }
  python3 "$HERE/schema-check.py" "$cat" "$tmp/schema.prisma" "$2"; local rc=$?
  rm -rf "$tmp"; return $rc
}

status_rows() {  # name<TAB>state
  local L; L=$(ledger)
  for f in "$SQLDIR"/*.sql; do
    [ -e "$f" ] || continue
    local n; n=$(basename "$f"); local row; row=$(printf '%s\n' "$L" | awk -F'\t' -v n="$n" '$1==n')
    if [ -n "$row" ]; then
      if [ "$(echo "$row" | cut -f2)" = "$(sha "$f")" ]; then printf '%s\t%s\n' "$n" "applied ($(echo "$row" | cut -f3))"
      else printf '%s\t%s\n' "$n" "applied, file CHANGED since ($(echo "$row" | cut -f3))"; fi
    elif is_contract "$f"; then printf '%s\t%s\n' "$n" "contract — not applied (apply after the old version is retired)"
    else printf '%s\t%s\n' "$n" "PENDING"; fi
  done
}

case "$CMD" in
  status)
    ensure_ledger; status_rows | awk -F'\t' '{printf "   %-58s %s\n", $1, $2}' ;;
  pending)
    ensure_ledger
    p=$(status_rows | awk -F'\t' '$2=="PENDING"{print $1}')
    c=$(status_rows | awk -F'\t' '$2 ~ /^contract/{print $1}')
    ch=$(status_rows | awk -F'\t' '$2 ~ /CHANGED/{print $1}')
    [ -n "$ch" ] && { echo "   NOTE changed after being applied (re-check they are still idempotent):"; echo "$ch" | sed 's/^/      /'; }
    [ -n "$c" ] && { echo "   contract files waiting (apply only after the old version is gone):"; echo "$c" | sed 's/^/      /'; }
    if [ -n "$p" ]; then
      red "   PENDING expand SQL (the new version may need it):"; echo "$p" | sed 's/^/      /'
      echo "      apply:  $0 $PROFILE apply $SQLDIR/<file>     (or 'record <file> --yes' if you already ran it)"
      exit 1
    fi
    echo "   SQL ledger: no pending expand file" ;;
  check)
    img="${1:?image}"; check_image "$img" "${2:-$img}" ;;
  record)
    f="${1:?file}"; [ "${2:-}" = "--yes" ] || { echo "add --yes: this records $f as applied WITHOUT running it"; exit 2; }
    [ -f "$f" ] || { red "no such file: $f"; exit 1; }
    ensure_ledger
    psqlc -c "insert into public.nexus_sql_ledger(name, sha256, applied_by, kind) values ('$(basename "$f")', '$(sha "$f")', '$(whoami)@$(hostname) record', 'recorded') on conflict (name) do update set sha256 = excluded.sha256, applied_at = now(), applied_by = excluded.applied_by, kind = 'recorded'" >/dev/null \
      && green "   recorded $(basename "$f")" ;;
  baseline)
    from="$SQLDIR"; [ "${1:-}" = "--from" ] && { from="$2"; shift 2; }
    [ "${1:-}" = "--yes" ] || { echo "add --yes: records every *.sql in $from as already applied"; exit 2; }
    ensure_ledger; n=0
    for f in "$from"/*.sql; do
      [ -e "$f" ] || continue
      psqlc -c "insert into public.nexus_sql_ledger(name, sha256, applied_by, kind) values ('$(basename "$f")', '$(sha "$f")', '$(whoami)@$(hostname) baseline', 'baseline') on conflict (name) do nothing" >/dev/null && n=$((n+1))
    done
    green "   baseline: $n files from $from" ;;
  apply)
    f="${1:?file}"; shift; CONTRACT_OK=0; [ "${1:-}" = "--contract-ok" ] && CONTRACT_OK=1
    [ -f "$f" ] || { red "no such file: $f"; exit 1; }
    ensure_ledger
    n=$(basename "$f")
    echo "== $n"
    if is_contract "$f"; then
      echo "   CONTRACT file (destructive by declaration)"
      [ "$CONTRACT_OK" = 1 ] || { red "   refused: add --contract-ok once no running or rollback version needs these objects"; exit 1; }
    elif ! lint "$f"; then
      red "   refused: destructive statement(s) above in a file without '-- bluegreen: contract'."
      echo "   Split it: the additive part ships now (expand); the drop/rename ships as a contract file in a"
      echo "   LATER release, after the version that still uses the old objects is gone (incl. its rollback window)."
      exit 1
    fi
    # Dry run: the file inside a transaction that is rolled back; the resulting catalog is checked against
    # every running slot's schema. BEGIN/COMMIT lines of the file are stripped for this pass only.
    if grep -qiE 'concurrently|^[[:space:]]*vacuum' "$f"; then
      echo "   dry run skipped (CONCURRENTLY/VACUUM cannot run in a transaction) — lint only"
    else
      tag="bg-$$-$RANDOM"
      { echo "BEGIN;"; sed -E '/^[[:space:]]*(begin|BEGIN|commit|COMMIT|start transaction|START TRANSACTION)[[:space:]]*;[[:space:]]*$/d' "$f"
        echo; echo "\\pset format unaligned"; echo "\\pset tuples_only on"; echo "\\pset fieldsep '\\t'"
        echo "\\o /tmp/$tag.tsv"; python3 "$HERE/schema-check.py" --sql | tr '\n' ' '; echo ";"; echo "\\o"; echo "ROLLBACK;"; } \
        | docker exec -i "$PG" psql -U "$PGU" -d "$PGD" -v ON_ERROR_STOP=1 -q >/dev/null 2>"/tmp/$tag.err" \
        || { red "   dry run FAILED (nothing changed):"; sed 's/^/      /' "/tmp/$tag.err" | head -20; rm -f "/tmp/$tag.err"; exit 1; }
      rm -f "/tmp/$tag.err"
      tmpcat=$(mktemp); docker exec "$PG" cat "/tmp/$tag.tsv" > "$tmpcat"; docker exec "$PG" rm -f "/tmp/$tag.tsv"
      bad=0
      while read -r cname cimg; do
        [ -n "$cname" ] || continue
        check_image "$cimg" "after $n: running $cname ($cimg)" "$tmpcat" || bad=1
      done < <(running_slot_images)
      rm -f "$tmpcat"
      [ "$bad" = 0 ] || { red "   refused: after this file a RUNNING version would miss what its schema expects (above)."; exit 1; }
      echo "   dry run ok (rolled back); every running version still satisfied"
    fi
    if grep -qiE '^[[:space:]]*(begin|start transaction)[[:space:]]*;' "$f" || grep -qiE 'concurrently|^[[:space:]]*vacuum' "$f"; then
      docker exec -i "$PG" psql -U "$PGU" -d "$PGD" -v ON_ERROR_STOP=1 -q < "$f" || { red "   apply FAILED"; exit 1; }
    else
      docker exec -i "$PG" psql -U "$PGU" -d "$PGD" -v ON_ERROR_STOP=1 -q -1 < "$f" || { red "   apply FAILED (rolled back)"; exit 1; }
    fi
    psqlc -c "insert into public.nexus_sql_ledger(name, sha256, applied_by, kind) values ('$n', '$(sha "$f")', '$(whoami)@$(hostname)', '$(is_contract "$f" && echo contract || echo applied)') on conflict (name) do update set sha256 = excluded.sha256, applied_at = now(), applied_by = excluded.applied_by, kind = excluded.kind" >/dev/null
    green "   applied + recorded: $n" ;;
  *) sed -n '2,9p' "$0"; exit 2 ;;
esac
