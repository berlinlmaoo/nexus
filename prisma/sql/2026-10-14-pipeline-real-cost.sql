-- Pipeline: real cost lines on a deal (Control Tower v4, 14 Oct 2026): an open list of
-- [{ "id", "label", "amount" }]. Margin = net value − Σ amount and the "Real Profit" tile are derived on
-- the server (lib/pipeline.ts marginOf / summarize), never stored. Additive and idempotent; no backfill:
-- every existing deal reads as [] (no cost data). Apply BEFORE deploying the image that reads the column.
ALTER TABLE "PipelineDeal" ADD COLUMN IF NOT EXISTS "costs" JSONB NOT NULL DEFAULT '[]';
