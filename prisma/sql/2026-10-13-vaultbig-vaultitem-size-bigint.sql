-- bluegreen: contract
-- Z Vault: VaultItem.size int4 -> int8 (13 Oct 2026).
--
-- Why: the per-file cap went to 5 GB (dev 14332c3 / prod 4439f1f). int4 stops at 2 147 483 647, so
-- the finalize of every file over ~2 GB failed with P2020 "value 2306309637 is out of range for type
-- integer" after the whole file had been uploaded. Prisma: `size BigInt?`; the app converts to Number
-- at every boundary (JSON, sockets, apps): bytesNumber() in src/lib/vault.ts.
--
-- Marked "contract" only because the ledger lint treats every ALTER COLUMN ... TYPE as destructive.
-- This one is a pure WIDENING and is safe to apply BEFORE the deploy, while the old version serves:
-- proven 13 Oct 2026 by running the released build's own Prisma client (Int) against an int8 column;
-- reads, writes, updates and the quota _sum behave exactly as on int4 for values < 2^31, and no
-- bigger value can exist until the new build is live. Apply with:
--   nexus-sql.sh <env> apply <this file> --contract-ok
--
-- Lock: ALTER ... TYPE bigint rewrites the table under ACCESS EXCLUSIVE. VaultItem is small (prod: a
-- few hundred rows), so the rewrite takes milliseconds; lock_timeout keeps it from queueing behind a
-- long transaction and stalling vault reads. If it times out, run it again.
-- Idempotent: a no-op when the column is already bigint (the big release re-runs it on prod).
SET lock_timeout = '5s';
DO $$
BEGIN
  IF (SELECT data_type FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'VaultItem' AND column_name = 'size') = 'integer' THEN
    ALTER TABLE "VaultItem" ALTER COLUMN "size" TYPE bigint;
  END IF;
END $$;
