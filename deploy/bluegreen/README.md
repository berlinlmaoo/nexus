# NEXUS blue-green deploys

Zero-downtime releases with instant rollback. Live on **dev** since 12 Oct 2026, then **prod** and the warm
standby. The host-side deploy scripts and the operations runbook are kept privately, outside this repo.

## Shape

```
                    ┌──────────── nginx (nexus-web / nexus-dev-web) ─────────────┐
 public :3000 ─────►│ default.conf  (generated from maintenance/phaethon.conf)   │
 raw    :3002/3102 ►│   proxy_pass http://nexus_app_live      root $nexus_live_root
 preview:3012/3103 ►│   proxy_pass http://nexus_app_preview   root $nexus_preview_root
                    │ 00-bluegreen.conf  ← the ONLY file a switch rewrites        │
                    └──────┬─────────────────────────────┬────────────────────────┘
                 nexus-app-blue (slot)          nexus-app-green (slot)      same DB, same uploads,
                 html/blue/                     html/green/                  shared chunk dir
                                 html/_archive/assets/  (every build's hashed assets, 7 days)
```

* **Slots.** Two app containers `…-blue` / `…-green`; one is live, the other is the next release or the
  previous one kept warm. Images `<repo>:blue` / `<repo>:green` (never pruned: named + in use).
* **The switch** = rewrite `conf.d/00-bluegreen.conf` (upstream + html root of the live slot), `nginx -t`,
  write the live file, `nginx -s reload` (graceful: old workers finish their requests), wait until the raw
  listener answers from the new slot, then `SIGUSR2` to the old slot. Measured 256–346 ms on dev.
* **SPA per slot.** API and HTML switch in the same reload. Hashed assets the live build lacks fall back to
  `html/_archive` (`location @nexus_archived_asset`), so an open tab still loads its lazy chunks.
* **Preview listener** (`127.0.0.1` only) = the main server block pointed at the idle slot. The smoke test
  runs through it: real routing, before any user sees the release.
* **Raw listener** = stable host address for the live slot (`127.0.0.1:3002` prod — what the cron scripts and
  the realtime-boot drop-in already use; `127.0.0.1:3102` dev).

## In the app (`src/lib/bluegreen.ts`)

* `NEXUS_SLOT` names the slot; the deploy writes the live slot to `bluegreen/shared/live`, mounted read-only
  at `/app/data/bluegreen/live`. No `NEXUS_SLOT` (the warm standby, single container) = always live.
* **Singleton leader**: session advisory lock (`pg_try_advisory_lock(4632018812)`) on a dedicated pg
  connection (`application_name nexus-leader-<slot>`). Only the live slot competes; a non-live slot releases
  it. Crash ⇒ connection gone ⇒ lock gone ⇒ next holder within 5 s. If the live slot cannot hold it for
  2 min, the idle slot covers for 5 min at a time. A read-only replica (the warm standby) never leads.
  The automation ticker and GIDEON schedules run only on the leader. (`/api/cron/*` routes are unaffected.)
* **Demotion** (`SIGUSR2`): re-check the lock now and close every Socket.IO transport, so clients reconnect
  through nginx to the live slot and catch up. Sent only to a build that handles it (`/api/health` has
  `"leader"`); for an older build SIGUSR2 would kill the process.
* `/api/health` adds `slot`, `live`, `leader`. `NEXUS_CHUNK_DIR` puts chunked-upload parts on a directory
  both slots share, so an upload that straddles a switch completes.

## A release (dev and prod scripts do the same steps)

1. lock (dev: `/tmp/nexus-dev-deploy.lock`, taken by the script if the caller did not) · fence check (prod)
2. build candidate image → **compat harness** (`scripts/compat`, against the live slot's env)
3. SPA build → `html/<idle>` (+ archive). Prod: `.well-known` copied from the live slot, never from a build
4. **SQL gates** (`nexus-sql.sh`): no pending expand file in the ledger; the database satisfies the NEW
   build's Prisma schema (refuse); and still the LIVE build's (warn: a contract ran too early)
5. env (prod: running env + new `.env.production` keys + `OVERRIDABLE`; dev: allowlist) + slot keys → start
   the idle slot · health from inside · `realtime-init`
6. preview → **smoke test** (`smoke.mjs`: SPA, entry bundle, /login, /api/health slot, app login with the QA
   account, 5 signed-in reads, realtime-init, Engine.IO handshake with the cookie, join-room →
   presence-update). Prod has no smoke account unless the owner wants one: anonymous variant.
7. **switch** → public check (slot through the real URL; wrong ⇒ automatic rollback)
8. old slot kept `KEEP_MINUTES` (dev 10, prod 15) then stopped by a detached `finish` (skipped if that slot
   became live again or a newer deploy claimed it)
9. cleanup (dangling images, build cache cap; tag cleanup keeps prod/beta/blue/green/candidate + in-use)
10. checklist (contract SQL waiting, changed SQL files, rollback deadline)

Any failed gate stops before step 7: the live slot is never touched.

`rollback` (no deploy lock, switch lock only): flip to the other slot if it runs and is healthy (instant:
549–569 ms on dev); if it was already stopped, start it first (cold, ~5 s), still no downtime.

## Expand / contract (SQL)

Two versions share one database for `KEEP_MINUTES` after every switch, and a rollback runs the previous
version against the current schema. So:

* **Expand** (default): new tables/columns (nullable or with default), new enum values, indexes, backfills.
  Apply BEFORE the code that needs them ships: `deploy… sql apply prisma/sql/<file>.sql`. The deploy refuses
  to switch while an expand file is not in the ledger (`nexus_sql_ledger`).
* **Contract** (drop/rename/narrow/NOT NULL/type change): first line `-- bluegreen: contract`. Ship it in a
  LATER release than the code that stopped using the objects, and apply it only after the previous version's
  rollback window closed (`… sql apply FILE --contract-ok`). It never blocks a deploy.
* `apply` lints (destructive statement without the contract header ⇒ refused), dry-runs the file in a
  transaction that is rolled back and checks the resulting catalog against the Prisma schema of every running
  slot image (would break a running version ⇒ refused), then applies and records it.
* **Big tables: `CREATE INDEX CONCURRENTLY`** (e.g. `2026-10-16-notification-dedupe-key.sql`). It cannot run in
  a transaction, so such a file has NO `BEGIN`/`COMMIT`; `apply` sees `CONCURRENTLY`, skips the rolled-back dry
  run (lint only) and runs the file without `-1`, statement by statement, stopping at the first error. Write it
  so a re-run repairs a failed one: `ADD COLUMN IF NOT EXISTS` (nullable, no default), then drop an INVALID copy
  of the index (`SELECT format('DROP INDEX CONCURRENTLY IF EXISTS %I', …) … WHERE NOT indisvalid \gexec`), then
  `CREATE … CONCURRENTLY IF NOT EXISTS`. Afterwards check `pg_index.indisvalid` is true for it.
* Renames = expand (new column + dual write/backfill) → release → contract (drop old) in a later release.
* Already applied by hand: `… sql record FILE --yes`. `… sql status` lists everything.

## Files

| file | what |
|---|---|
| `bg-lib.sh` | switch, rollback, finish, upstream file, SPA install + archive, status (sourced) |
| `nginx-gen.py` | phaethon.conf → blue-green conf (`--profile dev|prod|vps`) |
| `nexus-sql.sh`, `schema-check.py` | SQL ledger, expand/contract lint, dry run, schema check (`dev|prod|vps`) |
| `smoke.mjs` | pre-switch smoke test (QA login or anonymous) |
| `switch-test.mjs`, `leader-sampler.sh` | the zero-downtime/realtime test and the leader sampler (Testing) |
| `vps-bluegreen.sh` | warm standby: follow / stop-all / start-live / emergency release |

## Testing (dev, 12 Oct 2026)

`switch-test.mjs`: 6 workers (half through the public dev URL, half on 127.0.0.1:8080; keep-alive like a
browser) over health, `/`, the entry bundle, two signed-in reads; plus one websocket client in `project:<id>`
receiving `task-updated` for a task the test PATCHes every 3 s, and every 15 s a fresh client (a tab opened
around the switch: realtime-init, connect, join-room, then its own PATCH) that must get its event within 6 s,
reported per slot. `leader-sampler.sh`: the leader flag of both
slots + the advisory-lock holder in `pg_locks`, every second.

| test | requests | failed | realtime | switch / rollback |
|---|---|---|---|---|
| deploy #2 blue→green (under load) | — (harness bug, fixed) | — | — | 262 ms |
| warm rollback green→blue | 22 037 | 0 | 29/29, 1 reconnect 668 ms | 335 ms switch, 549 ms total |
| deploy #3 blue→green | 37 662 | 0 | 49/49, reconnect 545 ms | 266 ms |
| forced unhealthy slot (`NEXUS_BG_TEST_BREAK=health`) | 25 489 | 0 | 33/33 | not switched ✔ |
| deploy #4 green→blue | 36 271 | 1 (*) | 49/49, reconnect 965 ms | 315 ms |
| cold rollback (old slot stopped) | 22 177 | 0 | see (**) | 346 ms switch, 5.3 s incl. start |
| deploy #5 green→blue (final tooling) | 37 723 | 0 | 48/49 (1 during the reconnect), 821 ms | 330 ms |
| cold rollback after the fix | 18 289 | 0 | reconnected in 717 ms | 508 ms switch, 5.6 s incl. start |
| warm roll-forward | — | — | — | 255 ms switch, 599 ms total |

(*) one `UND_ERR_SOCKET` on a direct keep-alive connection: nginx closed an idle keep-alive connection
during the reload just as the client reused it. Browsers and Go's HTTP client (cloudflared) retry an idempotent
request on that error; none of the requests through the tunnel-like public path failed in any run.
(**) found a bug: a cold-started slot had no Socket.IO server until someone called `/api/realtime-init`;
fixed — `bg_switch` now calls it on the target before every switch.

Ticker exactly-once: during every overlap `pg_locks` showed one holder and never two leaders; handover gap
3–4 s (≤ one 5 s check; a skipped minute is harmless: due-date windows are 24 h, schedules have 6 h grace).
Three scheduled automations due inside an overlap (both slots up) fired once each, all by the leader; the
non-leader logged no firing, and the Postgres dedup-violation log (the clock re-trying already-run keys) shows
only the leader's tick second. Before the switch the old pre-blue-green container (no election) visibly ticked
in parallel — exactly what the lock removes.
