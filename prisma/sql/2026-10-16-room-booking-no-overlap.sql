-- Room Booking double-booking race (16 Oct 2026). POST /api/room-bookings checked for a conflict and then
-- inserted, so two requests for the same room and an overlapping time could both pass the check and both
-- insert. The database now refuses the second one: an exclusion constraint over the same workspace, the
-- same room and an overlapping [startsAt, endsAt) range, for ACTIVE bookings only (a cancelled booking
-- frees its slot, exactly like the app's guard). The app turns the refusal (SQLSTATE 23P01) into the
-- usual 409 ROOM_TAKEN.
--
-- Scope: workspaceId is part of the key, the same scope the app's guard and the Audit restore rule use.
-- The rooms are the company's physical rooms; the only other workspace holding bookings is a demo
-- workspace, whose bookings must not block (or be blocked by) real ones.
--
-- The columns are `timestamp without time zone` (UTC), so the range is tsrange: tstzrange over them would
-- cast through the session time zone, which is not immutable and cannot be used in a constraint.
--
-- Expand-only and idempotent. BEFORE adding the constraint, it looks for ACTIVE bookings that already
-- overlap (or whose end is before their start, which a range cannot hold). If there is any, it ABORTS
-- with the list and changes nothing: the owner decides which booking to cancel, then this runs again.
-- Safe BEFORE the deploy: the running build already refuses overlaps, so it never writes one.
--   nexus-sql.sh <env> apply prisma/sql/2026-10-16-room-booking-no-overlap.sql

SET lock_timeout = '5s';

BEGIN;

CREATE EXTENSION IF NOT EXISTS btree_gist;

DO $$
DECLARE
  r record;
  n int := 0;
  list text := '';
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'RoomBooking_no_overlap') THEN
    RETURN;
  END IF;

  FOR r IN
    SELECT id, "workspaceId", room, title, "startsAt", "endsAt"
    FROM "RoomBooking"
    WHERE status = 'ACTIVE' AND "endsAt" < "startsAt"
    ORDER BY "startsAt"
  LOOP
    n := n + 1;
    list := list || format(E'\n  ends before it starts: %s (%s, %s) %s → %s UTC, workspace %s',
      r.id, r.room, r.title, r."startsAt", r."endsAt", r."workspaceId");
  END LOOP;

  FOR r IN
    SELECT a.id AS a_id, a.title AS a_title, a."startsAt" AS a_start, a."endsAt" AS a_end,
           b.id AS b_id, b.title AS b_title, b."startsAt" AS b_start, b."endsAt" AS b_end,
           a.room, a."workspaceId"
    FROM "RoomBooking" a
    JOIN "RoomBooking" b
      ON b."workspaceId" = a."workspaceId" AND b.room = a.room AND b.id > a.id
     AND b.status = 'ACTIVE'
     AND a."startsAt" < b."endsAt" AND b."startsAt" < a."endsAt"
    WHERE a.status = 'ACTIVE'
    ORDER BY a."startsAt", a.id, b.id
  LOOP
    n := n + 1;
    list := list || format(E'\n  overlap in %s: %s "%s" %s → %s  ×  %s "%s" %s → %s (UTC), workspace %s',
      r.room, r.a_id, r.a_title, r.a_start, r.a_end, r.b_id, r.b_title, r.b_start, r.b_end, r."workspaceId");
  END LOOP;

  IF n > 0 THEN
    RAISE EXCEPTION 'RoomBooking: % ACTIVE booking problem(s) found, nothing was changed. Cancel or fix them, then run this file again:%', n, list;
  END IF;

  ALTER TABLE "RoomBooking"
    ADD CONSTRAINT "RoomBooking_no_overlap"
    EXCLUDE USING gist ("workspaceId" WITH =, room WITH =, tsrange("startsAt", "endsAt", '[)') WITH &&)
    WHERE (status = 'ACTIVE');
END $$;

COMMIT;
