-- Outlet Sales Dashboard, owner's revisions after the meeting with Ryan (14 Oct 2026):
--  1. Daily targets: a date may set its own sales target, pax target, or both ("OutletSalesDayTarget").
--     A date without one falls back to the month's target split evenly (server: lib/outlet-sales.ts).
--  2. A report breakdown per outlet: Project."outletReportConfig" (JSON: RSVP items, Hosting items,
--     Communities) and OutletSalesEvent."reportValues" (JSON: figures by stable item id).
--     The seven original items keep their columns (rsvpWalkIn … hostingEo; the ids ARE the column names),
--     so nothing is backfilled or copied and released apps that send / read those keys keep working.
--     A project without a config reads as the original seven items.
-- Expand-only and idempotent: creates what is missing, never drops or rewrites a row. Apply BEFORE
-- deploying the image whose Prisma client reads these columns.
-- Names follow Prisma's conventions so `prisma migrate diff` sees no drift.

BEGIN;

ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "outletReportConfig" JSONB;
ALTER TABLE "OutletSalesEvent" ADD COLUMN IF NOT EXISTS "reportValues" JSONB NOT NULL DEFAULT '{}';

CREATE TABLE IF NOT EXISTS "OutletSalesDayTarget" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "salesTarget" DOUBLE PRECISION,
    "paxTarget" INTEGER,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "OutletSalesDayTarget_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "OutletSalesDayTarget_projectId_date_key" ON "OutletSalesDayTarget"("projectId", "date");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'OutletSalesDayTarget_projectId_fkey') THEN
    ALTER TABLE "OutletSalesDayTarget" ADD CONSTRAINT "OutletSalesDayTarget_projectId_fkey"
      FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'OutletSalesDayTarget_updatedById_fkey') THEN
    ALTER TABLE "OutletSalesDayTarget" ADD CONSTRAINT "OutletSalesDayTarget_updatedById_fkey"
      FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

COMMIT;
