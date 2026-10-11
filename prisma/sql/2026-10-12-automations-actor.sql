-- Automations, follow-up (12 Oct 2026): per-person switch for the push of automation notifications.
-- The "Automation" system user itself is created on first use by src/lib/automation-identity.ts.
ALTER TABLE "NotificationPreference" ADD COLUMN IF NOT EXISTS "automation" BOOLEAN NOT NULL DEFAULT true;
