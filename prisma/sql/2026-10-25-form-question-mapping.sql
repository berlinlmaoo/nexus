-- bluegreen: expand   (data only: fixes form questions mapped to a task field that was never chosen; safe BEFORE the deploy)
-- 10 questions on 4 forms were set to "fills a task field" without saying which field (mapping.target =
-- custom_field, no customFieldId), so their answers filled nothing (owner decision 25 Oct 2026):
--   Pengajuan Finance University: Harga, Tanggal Penggunaan, Request by -> the project's field of the same name
--                                  (as on the 7 other "Pengajuan Finance" forms)
--   IP FRAMEWORKZ REQUEST, PATS GROUP FRAMEWORKZ REQUEST: Lokasi VENUE x3 each -> plain question (no task fields)
--   Brief Intake: Objective -> plain question (no task fields)
-- Rule, so it works before and after the UUID conversion (matches form names, not ids; each name is used by one
-- form, checked 25 Oct 2026; project names differ between prod and dev): on these four forms only, a
-- question mapped to custom_field without customFieldId gets the id of the custom field in the form's project whose
-- name equals the question's (case and spaces ignored); with no such field the mapping is removed (a plain question:
-- its answer still lands in the task description summary). Bumps "version" so an open builder reloads.
-- Idempotent: a second run finds no such question and changes nothing.
--   nexus-sql.sh <env> apply prisma/sql/2026-10-25-form-question-mapping.sql

SET lock_timeout = '5s';

BEGIN;

DO $$
DECLARE
  f record;
  q jsonb;
  out jsonb;
  cf text;
  changed boolean;
  n_mapped int := 0;
  n_plain int := 0;
BEGIN
  FOR f IN
    SELECT fo.id, fo."projectId", fo.fields
      FROM "Form" fo
     WHERE fo.name IN ('Pengajuan Finance University', 'IP FRAMEWORKZ REQUEST', 'PATS GROUP FRAMEWORKZ REQUEST', 'Brief Intake')
       AND jsonb_typeof(fo.fields) = 'array'
     FOR UPDATE
  LOOP
    out := '[]'::jsonb;
    changed := false;
    FOR q IN SELECT value FROM jsonb_array_elements(f.fields) LOOP
      IF jsonb_typeof(q) = 'object'
         AND q->'mapping'->>'target' = 'custom_field'
         AND coalesce(q->'mapping'->>'customFieldId', '') = '' THEN
        SELECT c.id INTO cf FROM "CustomField" c
         WHERE c."projectId" = f."projectId"
           AND lower(btrim(c.name)) = lower(btrim(coalesce(q->>'name', q->>'label', '')))
         ORDER BY c.id LIMIT 1;
        IF cf IS NOT NULL THEN
          q := jsonb_set(q, '{mapping,customFieldId}', to_jsonb(cf));
          n_mapped := n_mapped + 1;
        ELSE
          q := q - 'mapping';
          n_plain := n_plain + 1;
        END IF;
        changed := true;
      END IF;
      out := out || jsonb_build_array(q);
    END LOOP;
    IF changed THEN
      UPDATE "Form" SET fields = out, version = version + 1, "updatedAt" = now() WHERE id = f.id;
    END IF;
  END LOOP;
  RAISE NOTICE 'questions mapped to a task field: %, made plain: %', n_mapped, n_plain;
END $$;

COMMIT;
