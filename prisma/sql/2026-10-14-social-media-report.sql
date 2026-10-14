-- Social Media Report, a new project type (owner, 14 Oct 2026; Project.type "SOCIAL_MEDIA_REPORT"):
--  1. Project."socialReportConfig" (JSON): the platforms tracked, by stable id. Null = Instagram + TikTok.
--  2. "SocialMediaDay": one platform's figures on one day (views, likes, comments, shares, posts).
--  3. "SocialMediaNote": a day's two notes ("What worked" / "What didn't work").
--  4. "SocialMediaTarget": a platform's monthly engagement and posts targets.
--  5. "SocialMediaDayTarget": a date's own targets for one platform; a date without one falls back to the
--     month's target split evenly (server: lib/social-media.ts).
-- Expand-only and idempotent: creates what is missing, never drops or rewrites a row. Apply BEFORE
-- deploying the image whose Prisma client reads these tables.
-- Names follow Prisma's conventions so `prisma migrate diff` sees no drift.

BEGIN;

ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "socialReportConfig" JSONB;

CREATE TABLE IF NOT EXISTS "SocialMediaDay" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "platformId" TEXT NOT NULL,
    "views" INTEGER,
    "likes" INTEGER,
    "comments" INTEGER,
    "shares" INTEGER,
    "posts" INTEGER,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SocialMediaDay_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "SocialMediaDay_projectId_date_platformId_key" ON "SocialMediaDay"("projectId", "date", "platformId");

CREATE TABLE IF NOT EXISTS "SocialMediaNote" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "worked" TEXT NOT NULL DEFAULT '',
    "didntWork" TEXT NOT NULL DEFAULT '',
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SocialMediaNote_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "SocialMediaNote_projectId_date_key" ON "SocialMediaNote"("projectId", "date");

CREATE TABLE IF NOT EXISTS "SocialMediaTarget" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "platformId" TEXT NOT NULL,
    "engagementTarget" INTEGER,
    "postsTarget" INTEGER,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SocialMediaTarget_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "SocialMediaTarget_projectId_month_platformId_key" ON "SocialMediaTarget"("projectId", "month", "platformId");

CREATE TABLE IF NOT EXISTS "SocialMediaDayTarget" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "platformId" TEXT NOT NULL,
    "engagementTarget" INTEGER,
    "postsTarget" INTEGER,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SocialMediaDayTarget_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "SocialMediaDayTarget_projectId_date_platformId_key" ON "SocialMediaDayTarget"("projectId", "date", "platformId");

DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['SocialMediaDay', 'SocialMediaNote', 'SocialMediaTarget', 'SocialMediaDayTarget'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = t || '_projectId_fkey') THEN
      EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE',
        t, t || '_projectId_fkey');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = t || '_updatedById_fkey') THEN
      EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE',
        t, t || '_updatedById_fkey');
    END IF;
  END LOOP;
END $$;

COMMIT;
