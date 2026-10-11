-- Sections are the project's status options (owner, 12 Oct 2026, Notion's logic; lib/status-sections.ts).
-- Every section of a task project gets the status it stands for (TaskList.taskStatus, added by
-- 2026-10-12-templates-project-templates.sql), so marking a task done moves it to the Done column and
-- dragging a card into a column sets its status.
--
-- 1. Sections without a status get one from their name (case-insensitive, EN + ID), first match wins:
--      cancel / batal / gagal                                   → CANCELLED
--      done / selesai / complete / publish / finish / beres / tayang / closed / approved → DONE
--      review / revisi / approval / cek / check / qc             → IN_REVIEW
--      progress / proses / ongoing / doing / jalan / wip / sedang / produksi / working → IN_PROGRESS
--      anything else (to do, backlog, belum, pengajuan, idea, …) → TODO (the To-do group; order kept)
-- 2. A task project with no Done section after that gets one at the end: "Selesai" when its other
--    sections read Indonesian, else "Done".
-- Pipeline and Outlet Sales projects are left alone. No task is moved and no status changes: a task
-- already DONE sitting in a To-do section stays there until someone touches it.
-- Idempotent: only sections whose taskStatus is NULL are touched; a project that has a Done section
-- gets none added. DEV first; the owner reviews the per-project list before prod.

BEGIN;

-- Colour of each status option (null = its group's colour). Additive.
ALTER TABLE "TaskList" ADD COLUMN IF NOT EXISTS "color" TEXT;

CREATE TEMP TABLE _status_bind ON COMMIT DROP AS
SELECT tl.id, tl."projectId", tl.name,
  CASE
    WHEN lower(tl.name) ~ '(cancel|batal|gagal)' THEN 'CANCELLED'
    WHEN lower(tl.name) ~ '(done|selesai|complete|publish|finish|beres|tayang|closed|approved)' THEN 'DONE'
    WHEN lower(tl.name) ~ '(review|revisi|approval|\mcek\M|check|\mqc\M)' THEN 'IN_REVIEW'
    WHEN lower(tl.name) ~ '(progress|proses|ongoing|doing|jalan|\mwip\M|sedang|produksi|working)' THEN 'IN_PROGRESS'
    ELSE 'TODO'
  END AS status
FROM "TaskList" tl
JOIN "Project" p ON p.id = tl."projectId"
WHERE tl."taskStatus" IS NULL AND coalesce(p.type, 'TASK') NOT IN ('PIPELINE', 'OUTLET_SALES');

UPDATE "TaskList" tl SET "taskStatus" = b.status::"TaskStatus"
FROM _status_bind b WHERE tl.id = b.id AND tl."taskStatus" IS NULL;

CREATE TEMP TABLE _status_done ON COMMIT DROP AS
SELECT p.id AS "projectId",
  CASE WHEN EXISTS (
    SELECT 1 FROM "TaskList" x WHERE x."projectId" = p.id
      AND lower(x.name) ~ '(belum|proses|selesai|sedang|pengajuan|revisi|batal|ide\M|tugas|rencana|jalan)'
  ) THEN 'Selesai' ELSE 'Done' END AS name,
  coalesce((SELECT max(position) + 1 FROM "TaskList" x WHERE x."projectId" = p.id), 0) AS position
FROM "Project" p
WHERE coalesce(p.type, 'TASK') NOT IN ('PIPELINE', 'OUTLET_SALES')
  AND EXISTS (SELECT 1 FROM "TaskList" x WHERE x."projectId" = p.id)
  AND NOT EXISTS (SELECT 1 FROM "TaskList" x WHERE x."projectId" = p.id AND x."taskStatus" = 'DONE');

INSERT INTO "TaskList" (id, name, position, "projectId", "taskStatus", "createdAt", "updatedAt")
SELECT 'c' || substr(md5(random()::text || clock_timestamp()::text || d."projectId"), 1, 24), d.name, d.position, d."projectId", 'DONE', now(), now()
FROM _status_done d;

-- What happened, per project (the owner reviews this before prod).
SELECT p.name AS project, b.name AS section, b.status AS bound_to FROM _status_bind b JOIN "Project" p ON p.id = b."projectId" ORDER BY p.name, b.name;
SELECT p.name AS project, d.name AS added_done_section FROM _status_done d JOIN "Project" p ON p.id = d."projectId" ORDER BY p.name;

COMMIT;
