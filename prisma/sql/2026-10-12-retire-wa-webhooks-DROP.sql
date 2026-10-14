-- bluegreen: contract   (drops tables/columns: apply only after every running/rollback version stopped using them; deploy/bluegreen/README.md)
-- =====================================================================================================
-- 2026-10-12  Retire the NEXUS WhatsApp feature and Webhooks — the DATABASE half.
--
-- Owner (owner, 12 Oct 2026): "fitur whatsapp, webhooks hapus aja". The code stopped using every object
-- below on 12 Oct 2026 (branch dev): the WhatsApp link/commands/digest/notifications, project webhooks
-- (Settings → Webhooks + delivery on task/comment/project events) and the automation "Webhook received"
-- trigger / "Send webhook" action. The Prisma schema no longer declares any of these objects, so Prisma
-- never selects them; the columns/tables were kept only so an older slot (rollback) keeps working.
--
-- WHEN: in the release AFTER the one that ships the code removal, once the previous version's rollback
-- window has closed (expand/contract):
--     ~/deploy-nexus-dev.sh sql apply ~/nexus-dev/prisma/sql/2026-10-12-retire-wa-webhooks-DROP.sql --contract-ok
-- and the same through the prod ledger at release time (see deploy/bluegreen/RUNBOOK.md "Release checklist").
--
-- Row counts 12 Oct 2026 — prod: Webhook 0, WebhookDelivery 0, User.whatsappId set 4,
-- NotificationPreference.waEnabled true 1, waPhone set 2; Automation.webhookToken does not exist on prod
-- (it only exists where 2026-10-12-automations-builder.sql ran). Dev: Webhook 0, 2 automations with the
-- retired WEBHOOK_RECEIVED trigger (QA test rules; they never fire and stay editable).
--
-- Kept on purpose: User.phoneNumber (profile contact detail, still editable), NotificationPreference.
-- slackEnabled/slackWebhook (Slack is a separate channel), AuditLog rows that mention webhooks.
--
-- Idempotent: every statement is IF EXISTS, and the archive copies are made only once.
-- =====================================================================================================

BEGIN;

CREATE SCHEMA IF NOT EXISTS archive;

-- Archive copies (data + a timestamp) of anything that still has rows, before it goes.
DO $$ BEGIN
  IF to_regclass('public."Webhook"') IS NOT NULL AND to_regclass('archive."Webhook_20261012"') IS NULL THEN
    EXECUTE 'CREATE TABLE archive."Webhook_20261012" AS SELECT *, now() AS archived_at FROM public."Webhook"';
  END IF;
  IF to_regclass('public."WebhookDelivery"') IS NOT NULL AND to_regclass('archive."WebhookDelivery_20261012"') IS NULL THEN
    EXECUTE 'CREATE TABLE archive."WebhookDelivery_20261012" AS SELECT *, now() AS archived_at FROM public."WebhookDelivery"';
  END IF;
  -- The WhatsApp identities are personal data: only who had one, not the number/JID itself.
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'User' AND column_name = 'whatsappId')
     AND to_regclass('archive."UserWhatsappLink_20261012"') IS NULL THEN
    EXECUTE 'CREATE TABLE archive."UserWhatsappLink_20261012" AS SELECT id AS "userId", now() AS archived_at FROM public."User" WHERE "whatsappId" IS NOT NULL';
  END IF;
END $$;

-- Webhooks (deliveries first: they reference Webhook).
DROP TABLE IF EXISTS public."WebhookDelivery";
DROP TABLE IF EXISTS public."Webhook";

-- WhatsApp link on the user (the unique index on whatsappId goes with the column).
ALTER TABLE public."User" DROP COLUMN IF EXISTS "whatsappId";
ALTER TABLE public."User" DROP COLUMN IF EXISTS "waLinkCode";
ALTER TABLE public."User" DROP COLUMN IF EXISTS "waLinkExpiresAt";

-- WhatsApp notification channel.
ALTER TABLE public."NotificationPreference" DROP COLUMN IF EXISTS "waEnabled";
ALTER TABLE public."NotificationPreference" DROP COLUMN IF EXISTS "waPhone";

-- Inbound automation webhook (the "Webhook received" trigger); the unique index goes with the column.
ALTER TABLE public."Automation" DROP COLUMN IF EXISTS "webhookToken";

COMMIT;
