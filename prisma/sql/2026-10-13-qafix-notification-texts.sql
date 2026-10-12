-- Bilingual notifications (QA 13 Oct 2026). Additive and nullable: old rows keep title/message as they
-- were; old apps keep reading title/message.
ALTER TABLE "Notification" ADD COLUMN IF NOT EXISTS "texts" JSONB;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "uiLanguage" TEXT;
