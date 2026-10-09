-- Pipeline: a deal has several services, presets and typed ones (owner, 9 Oct 2026: "gw mau bisa select
-- multiple services dan ngetik service sendiri"). Additive and idempotent. No backfill: a deal whose list
-- is empty is read as its old single "service" (lib/pipeline-server.ts servicesOf), and the first write of
-- the list sets both columns. "service" stays = the first item, for apps that know one service only.
ALTER TABLE "PipelineDeal" ADD COLUMN IF NOT EXISTS "services" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
