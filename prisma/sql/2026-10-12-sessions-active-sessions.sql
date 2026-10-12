-- Active sessions (Settings > Security): device label + "sign out other sessions" cutoff. Additive only.
ALTER TABLE "UserSession" ADD COLUMN IF NOT EXISTS "client" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "sessionsCutoffAt" TIMESTAMP(3);
