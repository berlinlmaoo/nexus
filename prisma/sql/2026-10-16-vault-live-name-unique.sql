-- bluegreen: expand   (additive: a partial unique index built CONCURRENTLY; NO transaction)
-- Vault duplicate names (race audit 16 Oct 2026, LOW). Every writer picks a free name ("Report (2).pdf") with
-- uniqueNameInFolder and then inserts or renames, so two uploads of the same file into one folder at the same
-- moment both took "Report.pdf". The database now refuses the second: one LIVE item per (workspace, folder,
-- name ignoring case). Trashed items (deletedAt set) are outside the index, exactly like the app's own rule; a
-- restore from the trash picks a free name again. The app retries a refused write with the next free name.
--
-- Before building, it looks for live names that are already duplicated. If there is any, it ABORTS with the
-- list and changes nothing: renaming someone's files is the owner's call (rename or trash one of each pair in
-- Z Vault, then run this file again). Expression index (COALESCE for the root, lower() for case), so it lives
-- here and not in schema.prisma.
-- CONCURRENTLY cannot run inside a transaction block, so this file has NO BEGIN/COMMIT (nexus-sql.sh then skips
-- the rolled-back dry run and runs it statement by statement, ON_ERROR_STOP). Re-running it is safe.
-- Safe BEFORE the deploy: the running build already avoids duplicates when nothing races.
--   nexus-sql.sh <env> apply prisma/sql/2026-10-16-vault-live-name-unique.sql
-- Check afterwards (indisvalid must be t):
--   SELECT c.relname, i.indisvalid FROM pg_class c JOIN pg_index i ON i.indexrelid = c.oid WHERE c.relname = 'VaultItem_live_name_key';

SET lock_timeout = '5s';

DO $$
DECLARE
  r record;
  n int := 0;
  list text := '';
BEGIN
  FOR r IN
    SELECT "workspaceId", COALESCE("parentId", '(root)') AS folder, lower(name) AS lname, count(*) AS c, string_agg(id || ' "' || name || '"', ', ') AS items
    FROM "VaultItem"
    WHERE "deletedAt" IS NULL
    GROUP BY 1, 2, 3
    HAVING count(*) > 1
    ORDER BY 1, 2, 3
  LOOP
    n := n + 1;
    list := list || format(E'\n  workspace %s, folder %s: %s', r."workspaceId", r.folder, r.items);
  END LOOP;
  IF n > 0 THEN
    RAISE EXCEPTION 'VaultItem: % duplicated live name(s), nothing was changed. Rename or trash one of each, then run this file again:%', n, list;
  END IF;
END $$;

SELECT format('DROP INDEX CONCURRENTLY IF EXISTS %I', c.relname)
FROM pg_class c
JOIN pg_index i ON i.indexrelid = c.oid
WHERE c.relname = 'VaultItem_live_name_key' AND NOT i.indisvalid
\gexec

SET lock_timeout = '60s';

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "VaultItem_live_name_key"
  ON "VaultItem" ("workspaceId", COALESCE("parentId", ''), lower(name))
  WHERE "deletedAt" IS NULL;
