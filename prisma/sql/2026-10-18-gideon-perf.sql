-- bluegreen: expand   (additive: two new tables and one defaulted column; safe BEFORE the deploy)
-- GIDEON performance panel (Control Room › GIDEON › Performance, owner 18 Oct 2026).
--   "GideonGpuSample"    readings of the office GPU (utilisation, VRAM, temperature, power) and the local engine
--                        (Ollama: up, loaded model, size vs size on the GPU), pushed by the host exporter. Raw rows
--                        are kept 48 h, then folded into 10-minute averages (res = '10m') kept 30 days.
--   "GideonModel0Event"  Model 0 generations (tokens/s) and model loads (seconds), read from the engine log. `ref`
--                        is unique so a re-sent batch is stored once. Kept 30 days.
--   "GideonRun"."routerRetry"  the shim's runner retried the question with every tool (a "router miss").
-- Expand-only and idempotent. The running build never reads these.
--   ~/deploy-nexus-dev.sh sql apply prisma/sql/2026-10-18-gideon-perf.sql
-- Names follow Prisma's conventions so `prisma migrate diff` sees no drift.

SET lock_timeout = '5s';

BEGIN;

CREATE TABLE IF NOT EXISTS "GideonGpuSample" (
    "id" BIGSERIAL NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "res" TEXT NOT NULL DEFAULT 'raw',
    "gpuName" TEXT,
    "gpuUtil" DOUBLE PRECISION,
    "memUsedMiB" INTEGER,
    "memTotalMiB" INTEGER,
    "tempC" DOUBLE PRECISION,
    "powerW" DOUBLE PRECISION,
    "powerLimitW" DOUBLE PRECISION,
    "engineUp" BOOLEAN,
    "modelName" TEXT,
    "sizeBytes" BIGINT,
    "sizeVramBytes" BIGINT,
    "whisperBusy" BOOLEAN,
    "whisperQueued" INTEGER,
    CONSTRAINT "GideonGpuSample_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "GideonGpuSample_res_at_idx" ON "GideonGpuSample"("res", "at");

CREATE TABLE IF NOT EXISTS "GideonModel0Event" (
    "id" BIGSERIAL NOT NULL,
    "ref" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL,
    "kind" TEXT NOT NULL,
    "evalTps" DOUBLE PRECISION,
    "promptTps" DOUBLE PRECISION,
    "outTokens" INTEGER,
    "promptTokens" INTEGER,
    "totalMs" INTEGER,
    "loadSec" DOUBLE PRECISION,
    CONSTRAINT "GideonModel0Event_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "GideonModel0Event_ref_key" ON "GideonModel0Event"("ref");
CREATE INDEX IF NOT EXISTS "GideonModel0Event_at_idx" ON "GideonModel0Event"("at");

ALTER TABLE "GideonRun" ADD COLUMN IF NOT EXISTS "routerRetry" BOOLEAN NOT NULL DEFAULT false;

COMMIT;
