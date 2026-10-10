-- Outlet Sales Dashboard (Project.type "OUTLET_SALES", owner 10 Oct 2026, for Ryan): monthly targets and
-- the events (nights) of an outlet with their reports. One project = one outlet; there can be many.
-- Additive and idempotent: run it as many times as you like; it only creates what is missing and never
-- drops or rewrites a row. Apply BEFORE deploying the image whose Prisma client reads these tables:
--   docker exec -i nexus-postgres psql -U nexus_user -d nexus_db -v ON_ERROR_STOP=1 < prisma/sql/2026-10-10-outlet-sales.sql
-- Names follow Prisma's conventions (<Table>_<cols>_key/_idx/_fkey) so `prisma migrate diff` sees no drift.
-- Project.type is a plain TEXT column: "OUTLET_SALES" needs no change there.

BEGIN;

CREATE TABLE IF NOT EXISTS "OutletSalesTarget" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "salesTarget" DOUBLE PRECISION,
    "paxTarget" INTEGER,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "OutletSalesTarget_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "OutletSalesEvent" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "name" TEXT NOT NULL,
    "salesTarget" DOUBLE PRECISION,
    "paxTarget" INTEGER,
    "sales" DOUBLE PRECISION,
    "pax" INTEGER,
    "rsvpWalkIn" INTEGER,
    "rsvpTeam" INTEGER,
    "rsvpPr" INTEGER,
    "rsvpEo" INTEGER,
    "hostingTeam" INTEGER,
    "hostingPr" INTEGER,
    "hostingEo" INTEGER,
    "successWhat" TEXT NOT NULL DEFAULT '',
    "successWhy" TEXT NOT NULL DEFAULT '',
    "successRepeat" TEXT NOT NULL DEFAULT '',
    "failWhat" TEXT NOT NULL DEFAULT '',
    "failWhy" TEXT NOT NULL DEFAULT '',
    "failPrevent" TEXT NOT NULL DEFAULT '',
    "reportedAt" TIMESTAMP(3),
    "reportedById" TEXT,
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "OutletSalesEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "OutletSalesTarget_projectId_month_key" ON "OutletSalesTarget"("projectId", "month");
CREATE INDEX IF NOT EXISTS "OutletSalesEvent_projectId_date_idx" ON "OutletSalesEvent"("projectId", "date");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'OutletSalesTarget_projectId_fkey') THEN
    ALTER TABLE "OutletSalesTarget" ADD CONSTRAINT "OutletSalesTarget_projectId_fkey"
      FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'OutletSalesTarget_updatedById_fkey') THEN
    ALTER TABLE "OutletSalesTarget" ADD CONSTRAINT "OutletSalesTarget_updatedById_fkey"
      FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'OutletSalesEvent_projectId_fkey') THEN
    ALTER TABLE "OutletSalesEvent" ADD CONSTRAINT "OutletSalesEvent_projectId_fkey"
      FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'OutletSalesEvent_reportedById_fkey') THEN
    ALTER TABLE "OutletSalesEvent" ADD CONSTRAINT "OutletSalesEvent_reportedById_fkey"
      FOREIGN KEY ("reportedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'OutletSalesEvent_createdById_fkey') THEN
    ALTER TABLE "OutletSalesEvent" ADD CONSTRAINT "OutletSalesEvent_createdById_fkey"
      FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'OutletSalesEvent_updatedById_fkey') THEN
    ALTER TABLE "OutletSalesEvent" ADD CONSTRAINT "OutletSalesEvent_updatedById_fkey"
      FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

COMMIT;
