-- "Customize project" cleanup (owner, 11 Oct 2026). Five per-project switches are retired; Customize keeps
-- only Auto assign. The columns stay because released iOS / Android apps still decode and send them; the
-- server reports fixed values (src/lib/project-retired-flags.ts) and ignores writes. This file makes the
-- rows and the column defaults say the same thing:
--   enableTaskBatchDuplicate = true  (multi-select + duplicate is on in every project)
--   enablePnlDashboard       = false (P&L Dashboard removed; 0 PnlExpense/PnlIncome/PnlBudget rows)
--   financeEnabled           = false (legacy Finance matrix removed; 0 FinanceValue rows)
--   requireAttachmentForDone = false (Bukti Pencairan gate removed; the PROOF attachments themselves stay)
--   disableTaskStatus        = false (calendar mode removed, nothing replaces it)
-- Idempotent: only rows that still differ are touched, and SET DEFAULT can run any number of times.
-- No data is deleted. Safe before or after deploying the image that stops using the switches:
--   docker exec -i nexus-postgres psql -U nexus_user -d nexus_db -v ON_ERROR_STOP=1 < prisma/sql/2026-10-11-project-customize-cleanup.sql

BEGIN;

UPDATE "Project"
SET "enableTaskBatchDuplicate" = true,
    "enablePnlDashboard"       = false,
    "financeEnabled"           = false,
    "requireAttachmentForDone" = false,
    "disableTaskStatus"        = false
WHERE "enableTaskBatchDuplicate" IS DISTINCT FROM true
   OR "enablePnlDashboard"       IS DISTINCT FROM false
   OR "financeEnabled"           IS DISTINCT FROM false
   OR "requireAttachmentForDone" IS DISTINCT FROM false
   OR "disableTaskStatus"        IS DISTINCT FROM false;

ALTER TABLE "Project" ALTER COLUMN "enableTaskBatchDuplicate" SET DEFAULT true;
ALTER TABLE "Project" ALTER COLUMN "enablePnlDashboard"       SET DEFAULT false;
ALTER TABLE "Project" ALTER COLUMN "financeEnabled"           SET DEFAULT false;
ALTER TABLE "Project" ALTER COLUMN "requireAttachmentForDone" SET DEFAULT false;
ALTER TABLE "Project" ALTER COLUMN "disableTaskStatus"        SET DEFAULT false;

COMMIT;
