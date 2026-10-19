-- bluegreen: expand   (data only: renumbers deals that share a code; safe BEFORE the deploy)
-- Duplicate pipeline deal codes (QA final 19 Oct 2026, D-Q5; decided by the owner the same day).
-- Before 16 Oct 2026 every board counted its own codes, so the first deals of three boards all became
-- TZN-26001…TZN-26008. Since then codes are unique across boards and never reused (PipelineDealCode ledger,
-- lib/pipeline-server.ts nextDealCode), but those old duplicates stayed.
--
-- Rule: for every code held by more than one deal, the deal on the GM board "Pipeline Z Networks" keeps it (if none of
-- them is on that board, the oldest deal keeps it). Every other holder gets the next free code of the global series,
-- in the order (code, board name, created), and that code is written to the ledger like a code handed out by the app.
-- Holds the same advisory lock as the app's create (lockDealCodes) so a deal made meanwhile can't take the same code.
-- Idempotent: once no code is shared it changes nothing. Run on prod AT RELEASE with the other prisma/sql files:
--   nexus-sql.sh <env> apply prisma/sql/2026-10-19-pipeline-deal-code-renumber.sql

SET lock_timeout = '5s';

BEGIN;

SELECT pg_advisory_xact_lock(hashtext('pipeline-deal-code')::int8);

DO $$
DECLARE
  head text := 'TZN-' || to_char(now() AT TIME ZONE 'Asia/Jakarta', 'YY');
  nxt int;
  r record;
  newcode text;
  moved int := 0;
BEGIN
  SELECT COALESCE(MAX(n), 0) INTO nxt FROM (
    SELECT substring(code FROM length(head) + 1)::int AS n FROM "PipelineDealCode" WHERE code LIKE head || '%' AND substring(code FROM length(head) + 1) ~ '^[0-9]+$'
    UNION ALL
    SELECT substring(code FROM length(head) + 1)::int FROM "PipelineDeal" WHERE code LIKE head || '%' AND substring(code FROM length(head) + 1) ~ '^[0-9]+$'
    UNION ALL
    SELECT substring(d->>'code' FROM length(head) + 1)::int
      FROM "DeletionSnapshot" s, jsonb_array_elements(CASE WHEN jsonb_typeof(s.data::jsonb #> '{tables,PipelineDeal}') = 'array' THEN s.data::jsonb #> '{tables,PipelineDeal}' ELSE '[]'::jsonb END) d
     WHERE s."entityType" = 'pipeline_deal' AND s."restoredAt" IS NULL AND d->>'code' LIKE head || '%' AND substring(d->>'code' FROM length(head) + 1) ~ '^[0-9]+$'
  ) x;

  FOR r IN
    WITH holders AS (
      SELECT d.id, d.code, d."projectId", d."createdAt", p.name AS board,
             row_number() OVER (PARTITION BY d.code ORDER BY (p.name = 'Pipeline Z Networks') DESC, d."createdAt", d.id) AS rk,
             count(*) OVER (PARTITION BY d.code) AS cnt
        FROM "PipelineDeal" d JOIN "Project" p ON p.id = d."projectId"
    )
    SELECT id, code, "projectId", board FROM holders WHERE cnt > 1 AND rk > 1 ORDER BY code, board, "createdAt", id
  LOOP
    nxt := nxt + 1;
    newcode := head || lpad(nxt::text, 3, '0');
    INSERT INTO "PipelineDealCode" (code, "projectId", "createdAt") VALUES (newcode, r."projectId", now());
    UPDATE "PipelineDeal" SET code = newcode WHERE id = r.id;
    RAISE NOTICE 'renumbered % on "%" -> %', r.code, r.board, newcode;
    moved := moved + 1;
  END LOOP;
  RAISE NOTICE 'pipeline deal codes renumbered: %', moved;
END $$;

COMMIT;
