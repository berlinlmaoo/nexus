/**
 * Retired "Customize project" switches (owner, 11 Oct 2026). The Customize section keeps only Auto assign:
 *
 * - enableTaskBatchDuplicate — multi-select + duplicate is now on in every project, so always true.
 * - enablePnlDashboard / financeEnabled — the P&L Dashboard and the legacy Finance matrix are gone
 *   (their API routes were removed; every table was empty), so always false.
 * - requireAttachmentForDone — the "Bukti Pencairan before Done" gate is gone, so always false. The
 *   Bukti Pencairan slot itself stays: finance uploads payout proof there and the submitter sees it
 *   on /submissions.
 * - disableTaskStatus — "calendar mode" is gone with nothing in its place, so always false.
 *
 * Released iOS / Android apps still decode and send these keys, so the columns stay and every project
 * the server returns carries these fixed values (the result extension in lib/prisma.ts). PATCH accepts
 * the keys and ignores them. prisma/sql/2026-10-11-project-customize-cleanup.sql writes the same values
 * into the rows and the column defaults.
 */
export const RETIRED_PROJECT_FLAGS = {
  enableTaskBatchDuplicate: true,
  enablePnlDashboard: false,
  financeEnabled: false,
  requireAttachmentForDone: false,
  disableTaskStatus: false,
} as const
