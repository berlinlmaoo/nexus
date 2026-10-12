-- Notification.actorId (QA 13 Oct 2026): who caused a notification, so the row can show the sender's
-- avatar. Additive and nullable: old rows and system notifications stay NULL; old apps never read it.
ALTER TABLE "Notification" ADD COLUMN IF NOT EXISTS "actorId" TEXT;
