-- Form questions that still send their answer to "Section" in a project whose category sections became the
-- field "Kategori" / "Category" (owner, 12 Oct 2026, Notion's logic; scripts/convert-category-sections.cjs).
--
-- Sections are statuses now (To Do / On Progress / Done). A question like Finance's "Divisi" (AI & Tech /
-- Management) left on `task_list` matches no section, and the public form used to replace its options with
-- the section names, so senders were offered "To Do / On Progress / Done" and the category was lost.
-- convert-category-sections.cjs --apply already rewrites the forms of every project it converts; this file
-- is the safety net that runs AFTER it at the release (RUNBOOK §I) and the repair of DEV:
--
--  1. DEV repair, guarded to one question: Finance Management's "Divisi" was switched back to Section on dev
--     (builder, 13 Oct 11:06, "Use these 3 sections as options" → To Do / On Progress / Done). It gets the
--     options it has on prod (AI & Tech / Management) back. A no-op anywhere else.
--  2. In a converted project (it has the "By category" / "Per kategori" view grouped by a SELECT field),
--     a question mapped to `task_list` none of whose options is a section name:
--       one-answer choice question (dropdown / select / radio) → mapping {custom_field, <that field>},
--         its options are KEPT (the category names it always had);
--       anything else (file / text…) → mapping "none" (it never matched a section; the answer stays in
--         the task description), as the conversion script does.
--     A question whose options are section (status) names is a real status question: left alone.
--  3. Report: routing rules "Move to section" that point at a section that no longer exists (the conversion
--     script rewrites them to "Set Kategori = …" from the names it still knows; the names are gone here).
--
-- Idempotent: a remapped question is no longer `task_list`, so a second run changes nothing. Runs in one
-- transaction. Never touches Task, TaskList or field values.

BEGIN;

-- 1. DEV repair (guarded: this form, this question, still Section, still the three status names).
UPDATE "Form" f SET
  fields = (
    SELECT jsonb_agg(CASE
             WHEN x.e->>'id' = '2c9k1u9z8q0j6gto0snmg' AND x.e->'mapping'->>'target' = 'task_list'
                  AND x.e->'options' = '["To Do", "On Progress", "Done"]'::jsonb
             THEN jsonb_set(x.e, '{options}', '["AI & Tech", "Management"]'::jsonb)
             ELSE x.e END ORDER BY x.i)
    FROM jsonb_array_elements(f.fields) WITH ORDINALITY x(e, i)),
  "updatedAt" = now()
WHERE f.id = 'cmqkpmiel01jx01qq5v7x6mnq' AND jsonb_typeof(f.fields) = 'array'
  AND EXISTS (SELECT 1 FROM jsonb_array_elements(f.fields) e
              WHERE e->>'id' = '2c9k1u9z8q0j6gto0snmg' AND e->'mapping'->>'target' = 'task_list'
                AND e->'options' = '["To Do", "On Progress", "Done"]'::jsonb);

-- 2. The category field of each converted project: the SELECT field its "By category" view groups by.
CREATE TEMP TABLE _formcat_field ON COMMIT DROP AS
SELECT DISTINCT ON (v."projectId") v."projectId", cf.id AS field_id, cf.name AS field_name
FROM "ProjectView" v
JOIN "CustomField" cf ON cf."projectId" = v."projectId" AND 'cf:' || cf.id = v.config->>'groupBy'
WHERE v.name IN ('By category', 'Per kategori') AND cf.type::text = 'SELECT'
ORDER BY v."projectId", v."createdAt";

CREATE TEMP TABLE _formcat_remap ON COMMIT DROP AS
SELECT f.id AS form_id, f.name AS form_name, x.i, coalesce(x.e->>'label', x.e->>'name') AS question,
  c.field_id, c.field_name,
  (coalesce(x.e->>'type', '') ~* '^(dropdown|select|radio|single_select|choice)$') AS choice
FROM "Form" f
JOIN _formcat_field c ON c."projectId" = f."projectId"
CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(f.fields) = 'array' THEN f.fields ELSE '[]'::jsonb END) WITH ORDINALITY x(e, i)
WHERE x.e->'mapping'->>'target' = 'task_list'
  AND NOT EXISTS (
    SELECT 1
    FROM jsonb_array_elements_text(CASE
           WHEN jsonb_typeof(x.e->'options') = 'array' THEN x.e->'options'
           WHEN jsonb_typeof(x.e->'options'->'choices') = 'array' THEN x.e->'options'->'choices'
           ELSE '[]'::jsonb END) o
    JOIN "TaskList" t ON t."projectId" = f."projectId" AND lower(trim(t.name)) = lower(trim(o)));

UPDATE "Form" f SET
  fields = (
    SELECT jsonb_agg(CASE
             WHEN r.form_id IS NULL THEN x.e
             WHEN r.choice THEN jsonb_set(x.e, '{mapping}', jsonb_build_object('target', 'custom_field', 'customFieldId', r.field_id))
             ELSE jsonb_set(x.e, '{mapping}', '{"target": "none"}'::jsonb) END ORDER BY x.i)
    FROM jsonb_array_elements(f.fields) WITH ORDINALITY x(e, i)
    LEFT JOIN _formcat_remap r ON r.form_id = f.id AND r.i = x.i),
  "updatedAt" = now()
WHERE f.id IN (SELECT form_id FROM _formcat_remap);

-- What happened (the release log keeps it).
SELECT form_name, question, CASE WHEN choice THEN 'answer → ' || field_name ELSE 'no longer picks a section' END AS remapped
FROM _formcat_remap ORDER BY form_name, i;

-- 3. Report only: "Move to section" rules pointing at a section that is gone.
SELECT f.name AS form, coalesce(e->>'label', e->>'name') AS question, r->>'value' AS when_answer, r->>'targetTaskListId' AS missing_section
FROM "Form" f
CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(f.fields) = 'array' THEN f.fields ELSE '[]'::jsonb END) e
CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(e->'routingRules') = 'array' THEN e->'routingRules' ELSE '[]'::jsonb END) r
WHERE r->>'action' = 'set_task_list'
  AND NOT EXISTS (SELECT 1 FROM "TaskList" t WHERE t.id = r->>'targetTaskListId' AND t."projectId" = f."projectId");

COMMIT;
