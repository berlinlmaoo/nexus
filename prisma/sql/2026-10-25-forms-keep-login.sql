-- bluegreen: expand   (data only: existing forms keep requiring sign-in; safe BEFORE the deploy)
-- Public forms without sign-in (owner, 25 Oct 2026). Until now EVERY form needed a NEXUS login whatever its
-- requireAuth said; from this release a public form with requireAuth = false takes anyone, no account. So that no
-- existing form opens to the internet by itself, every form still on requireAuth = false is moved to true, ONCE
-- (marker row in "AppSetting"). Afterwards the owner of a form switches it to "Anyone with the link" in the builder;
-- running this file again changes nothing, so it never undoes that choice.
-- The column default stays false (the running build's schema check); POST /api/forms now sets true itself.
--   nexus-sql.sh <env> apply prisma/sql/2026-10-25-forms-keep-login.sql

SET lock_timeout = '5s';

BEGIN;

DO $$
DECLARE
  moved int := 0;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "AppSetting" WHERE key = 'migration:2026-10-25-forms-keep-login') THEN
    UPDATE "Form" SET "requireAuth" = true WHERE "requireAuth" = false;
    GET DIAGNOSTICS moved = ROW_COUNT;
    INSERT INTO "AppSetting" (key, value, "updatedAt")
    VALUES ('migration:2026-10-25-forms-keep-login', jsonb_build_object('formsMovedToSignIn', moved), now());
    RAISE NOTICE 'forms moved to sign-in: %', moved;
  ELSE
    RAISE NOTICE 'already applied once: nothing changed';
  END IF;
END $$;

COMMIT;
