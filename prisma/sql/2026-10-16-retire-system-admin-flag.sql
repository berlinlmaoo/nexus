-- bluegreen: contract   (data only: apply after every running/rollback version is the 16 Oct 2026 one or later)
-- =====================================================================================================
-- 2026-10-16  Retire the system ADMIN flag (User.role = 'ADMIN').
--
-- Owner, 16 Oct 2026: one power system before the big release. The workspace role (ONE_ABOVE_ALL / BOD /
-- MANAGER / STAFF, plus the per-project levels) is the only source of power. The code of the same change
-- stopped reading User.role for access; the API's legacy `role` field is now derived from the company
-- role ("ADMIN" = the company's One Above All), so released apps see no difference.
--
-- Contract, not expand: an older slot (rollback) still grants the ADMIN account its old powers, so this
-- runs only once no such slot can come back. The column and the enum value stay (a later release may
-- drop them); this only clears the flag. Expected on prod and dev: 1 row (the owner's account, which is
-- One Above All of the company workspace and keeps everything through that role).
--
-- Release checklist: run in the release window after the 16 Oct 2026 build is live and the rollback
-- window has closed:  deploy… sql apply prisma/sql/2026-10-16-retire-system-admin-flag.sql --contract-ok
-- =====================================================================================================

UPDATE "User" SET "role" = 'MEMBER', "updatedAt" = NOW() WHERE "role" = 'ADMIN';
