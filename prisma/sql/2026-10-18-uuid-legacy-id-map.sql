-- bluegreen: expand   (additive: one new table + one function; safe BEFORE the deploy)
-- UUIDv7 ids (owner, 18 Oct 2026; docs/internal/UUID-MIGRATION.md).
--   legacy_id_map   every pre-conversion id -> its UUIDv7. EMPTY until scripts/uuid-migration/convert.sql
--                   runs in the maintenance window (runbook L.23). The app reads it (lib/legacy-ids.ts) and
--                   switches itself off while it is empty, so this file + the new build are harmless before.
--   nexus_uuid7()   a UUIDv7 minted by the database: default for SheetCellRevision.id (trigger insert) and,
--                   after the conversion, for every id column (raw SQL inserts: the host outage prober,
--                   SQL files, psql). Prisma mints uuid(7) itself.
-- Idempotent.
--   nexus-sql.sh <env> apply prisma/sql/2026-10-18-uuid-legacy-id-map.sql

SET lock_timeout = '5s';

BEGIN;

CREATE TABLE IF NOT EXISTS public.legacy_id_map (
  old_id       TEXT PRIMARY KEY,
  new_id       TEXT NOT NULL UNIQUE,
  model        TEXT NOT NULL,
  ts_source    TEXT NOT NULL,
  converted_at TIMESTAMPTZ(6) NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS legacy_id_map_model_idx ON public.legacy_id_map (model);

-- RFC 9562 UUIDv7: 48-bit unix ms | 7 | 12 random | variant 10 | 62 random. Randomness from gen_random_uuid().
CREATE OR REPLACE FUNCTION public.nexus_uuid7() RETURNS text LANGUAGE plpgsql VOLATILE AS $$
DECLARE
  r text := replace(gen_random_uuid()::text, '-', '');
  s text;
BEGIN
  -- r[13] (version) and r[17] (variant) of the v4 source are fixed bits: never used.
  s := lpad(to_hex((extract(epoch FROM clock_timestamp()) * 1000)::bigint), 12, '0')
       || '7' || substr(r, 1, 3)
       || to_hex(8 | (('x' || substr(r, 4, 1))::bit(4)::int & 3)) || substr(r, 5, 3)
       || substr(r, 8, 5) || substr(r, 18, 7);
  RETURN substr(s, 1, 8) || '-' || substr(s, 9, 4) || '-' || substr(s, 13, 4) || '-' || substr(s, 17, 4) || '-' || substr(s, 21, 12);
END $$;

-- SheetCellRevision rows are written by a trigger (lib/project-sheets.ts); v4 -> v7 for new rows.
DO $$ BEGIN
  IF to_regclass('public."SheetCellRevision"') IS NOT NULL THEN
    ALTER TABLE "SheetCellRevision" ALTER COLUMN id SET DEFAULT public.nexus_uuid7();
  END IF;
END $$;

COMMIT;
