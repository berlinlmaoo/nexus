-- bluegreen: contract   (removes stored keys the code stopped reading; apply only after every running/rollback version is the 12 Oct 2026 one or later)
-- =====================================================================================================
-- 2026-10-12  Calendar: retire the hand-set "Project divisions" (Control Room › Calendar).
--
-- Owner, 12 Oct 2026: the Calendar stops guessing a division. A task with no PIC is no longer on the
-- calendar at all, and a task whose PICs are all outside the IP & Division Chart has no division. The
-- per-folder / per-project override list ("Project divisions", "Automatic" dropdowns) and the
-- folder/project-name inference were removed from the code in the same change.
--
-- Storage: NOT a table or column. The overrides live as two keys inside the JSON of AppSetting
-- key = 'calendar': "folderUnits" (folder id → Bagan card id) and "projectUnits" (project id → card id).
-- The new code ignores them and carries them over untouched on a PATCH, so an older slot (rollback)
-- still finds them. This file removes the two keys once no such slot can come back.
--
-- Stored on 12 Oct 2026 (same on prod and dev): folderUnits = 2 entries
--   cm_jagain_folder          THE Z CREATIVE → Framework Agency (ou47f297a5be7b0f6fbbae754)
--   cmqpiuy72011901pcc89h8uu1 Z MANAGEMENT   → Finance & Tech   (oub7186507c81bf7f984bb416)
-- projectUnits = absent (0 entries).
--
-- Release checklist: the deploy lists this file under "contract files waiting". Run it in the release
-- AFTER the one that ships the code, once its rollback window closed:
--   ~/deploy-nexus-bluegreen.sh sql apply ~/nexus/prisma/sql/2026-10-12-cal-divisions-DROP.sql --contract-ok
-- Idempotent: running it twice changes nothing. The removed values are printed first (NOTICE) so they
-- can be put back by hand if ever needed.
-- =====================================================================================================

DO $$
DECLARE v jsonb;
BEGIN
  SELECT value::jsonb INTO v FROM "AppSetting" WHERE key = 'calendar';
  IF v IS NOT NULL AND (v ? 'folderUnits' OR v ? 'projectUnits') THEN
    RAISE NOTICE 'calendar folderUnits before removal: %', v -> 'folderUnits';
    RAISE NOTICE 'calendar projectUnits before removal: %', v -> 'projectUnits';
  END IF;
END $$;

UPDATE "AppSetting"
   SET value = (value::jsonb - 'folderUnits' - 'projectUnits'), "updatedAt" = now()
 WHERE key = 'calendar'
   AND (value::jsonb ? 'folderUnits' OR value::jsonb ? 'projectUnits');
