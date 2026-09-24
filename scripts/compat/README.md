# scripts/compat — pre-deploy compatibility harness

Checks that a **candidate server image** still works for every client people actually have: iOS
0.1.4, 0.1.5, 0.1.6, legacy 0.1.3 (to test the minimum-version gate) and the web SPA. Run it after
the image is built and before it replaces `nexus-app-beta`.

```
scripts/compat/run.sh prod                        # candidate = nexus-app:prod, passes min 0.1.4 and 0.1.6
scripts/compat/run.sh nexus-app:candidate         # any tag or image id
scripts/compat/run.sh prod --min-version 0.1.4    # one pass only
COMPAT_PROFILES_RUN=ios-0.1.4,web scripts/compat/run.sh prod   # subset of clients
COMPAT_KEEP_OUT=1 scripts/compat/run.sh prod      # keep logs/results even on success
```

Exit code: `0` all good · `1` regression (table + candidate error log printed) · `2` usage / image
missing · `3` network was NOT isolated (candidate never started) · `4` environment set-up failed.
Runtime on nexus-prod: about **65 s** for the default two passes (each pass ~15 s set-up + ~17 s
fixtures). The first run on a host also installs the Prisma CLI into a cache volume (~10 s, once).

## What a run does

Once per pass (`--min-version`, default `0.1.4` then `0.1.6`):

1. `docker network create --internal nexus-compat-<run>` — a bridge with **no route out**.
2. Fresh `postgres:16-alpine` on that network, data on tmpfs, random password.
3. **Egress check** (`egress-check.mjs`) from a container on that network: DNS for APNs, SMTP,
   Slack, Google, Nominatim, Sentry, iTunes…, TCP to public IPs, and TCP to every IP the host owns on
   5432/3002/3001/443. Every probe must fail or the run aborts (exit 3) before the app starts.
4. Schema: `schema.prisma` is copied **out of the candidate image**
   (`/app/src/generated/prisma/schema.prisma`) and applied with `prisma db push` using a Prisma CLI of
   the candidate's exact client version (cached in volume `nexus-compat-prisma-<version>`).
   Production uses `db push` too (`scripts/prisma-deploy.sh` falls back to it; there are no committed
   migrations), so this is the same mechanism.
5. Seed (`seed.cjs`, runs inside the candidate image with its own Prisma client): workspace with
   joinCode `COMPAT1`, office at −6.2253, 106.829 r=150 m, shift 09:00–18:00, a BoD, a MANAGER, and
   two STAFF per client profile whose `approverId` is the manager, one project, one list, one task per
   staff. Refuses to run unless `DATABASE_URL` is `compat@db:5432/compat`.
6. Candidate app: the candidate image, `node server.js`, on the internal network, with a
   **constructed** env (below), `NEXUS_IOS_MIN_VERSION=<pass>`, no volumes, no published ports.
7. Runner (`runner.mjs` + `fixtures.mjs`), in a container on the same network, logs in and replays
   each profile's fixtures, prints the table, writes `results-min-<v>.json`.
8. The pass's containers and network are removed; the `EXIT` trap removes anything left, and a later
   run deletes labelled leftovers older than 2 h (for a run that was SIGKILLed).

## Isolation — why this cannot send email/push or touch the production DB

* **No network path out.** `--internal` network; the egress check proves it on every run
  (DNS fails, `ENETUNREACH` to public IPs and to the host's own IPs including the Tailscale
  `100.118.101.24:5432` where production Postgres listens). A hard-coded URL in the source
  (e.g. Nominatim in `reverse-geocode.ts`) cannot get out either.
* **No outward credentials.** The candidate env is built from scratch: `NODE_ENV`, `PORT`,
  `DATABASE_URL` (throwaway), a random `AUTH_SECRET`, `AUTH_TRUST_HOST`, `NEXTAUTH_URL`
  / `NEXT_PUBLIC_APP_URL` (same loopback shape as prod), `NEXUS_PUBLIC_URL=https://nexus.compat.invalid`,
  `WA_DELIVERY_DISABLED=1`, `NEXUS_IOS_MIN_VERSION`, plus an allowlist of NON-secret behaviour keys
  copied from `nexus-app-beta`: `ABSENCE_DEDUCTION_START_DATE ATTENDANCE_OUTAGE_DATES APP_TIMEZONE
  LOG_LEVEL DB_POOL_MAX DB_IDLE_TIMEOUT DB_CONNECT_TIMEOUT`. The script then greps the env file for
  `SMTP_|APNS_|SLACK_|WA_WEBHOOK|WHATSAPP|HERMES_|GOOGLE_|SENTRY_|BUFFER_|ORACLE_|GIDEON_|NAS_|
  CF_TUNNEL|REDIS_|FINANCE_|NEXUS_WA_|NEXUS_SSO|NEXUS_GIDEON|CRON_SECRET|POSTGRES_` and aborts on
  a match. No APNs key is mounted, so push is impossible even in principle.
* **No production database.** The candidate never receives the production `DATABASE_URL` or the
  Postgres password; its DB is a tmpfs Postgres reachable only on the compat network, with a random
  password generated per pass.
* **Nothing live is touched.** No `docker exec` / restart / network attach on `nexus-app-beta`,
  `nexus-postgres` or `nexus-web`; the only read of production state is `docker inspect
  nexus-app-beta` for the allowlisted keys above (values of other keys are never written anywhere).
  The candidate image is only read (`docker create` + `docker cp` of the schema).
* The live env's keys that are neither allowlisted nor matched by the outward pattern are printed
  (names only) as `NOTE live env keys not classified` — a new behaviour flag shows up there instead of
  silently differing between production and the test.
* Outward DNS lookups fail after 1 s (`--dns-opt timeout:1 attempts:1`) instead of musl's 5 s; this only
  changes how fast an unreachable call fails.

## Profiles and what they send

| profile | identifies as | source of truth |
|---|---|---|
| `ios-0.1.3` | UA `NEXUS/7 …`, no header | legacy; bodies modelled on 0.1.4 — for the gate only |
| `ios-0.1.4` | UA `NEXUS/8 …`, no `X-Nexus-Client` | `nexus-ios` @ `5bb9f5b` |
| `ios-0.1.5` | UA `NEXUS/11 …`, no header | `nexus-ios` @ `02eabab` |
| `ios-0.1.6` | UA `NEXUS/12 …`, `X-Nexus-Client: ios/0.1.6/12` | `nexus-ios` @ HEAD (build 12) |
| `web` | browser UA, `X-Nexus-Client: web/1`, session cookie | `apps/nexus-lovable-ui/src/lib/nexus-api.ts` |

iOS login is `POST /api/auth/app-login` → `Cookie: <cookieName>=<token>` on every request, as the app
does. Web login is `POST /api/auth/direct-login` with a same-origin `Origin`, and the `Set-Cookie`
session is replayed. All requests carry the headers nginx adds in production (`X-Forwarded-Proto:
https`, `X-Forwarded-Host`). iOS multipart bodies are built byte-for-byte like `APIClient.swift`
(text parts without Content-Type; selfie `image/jpeg` `selfie.jpg`; request attachments
`application/octet-stream` named `sick-note.jpg` — for izin too — or the Files-picker name).

## Fixtures and expectations

`compat` = a released client really does this → mismatch **FAILS** the run.
`policy` = a current server rule the UI doesn't normally hit → mismatch is **WARN** (loosening a rule
never blocks a deploy); any 5xx is always FAIL. Response checks come from the Swift decoders'
non-optional fields (e.g. login needs `ok/token/cookieName/user.id`, a record needs `id`).

Every non-web iOS profile (0.1.4, 0.1.5, 0.1.6):
- login → 200 + token · `GET /api/user/profile` → 200 `user.id` · `GET /api/projects` → 200 array of
  `{id,name}` · `GET /api/tasks?assigneeId=` and `?projectId=` → 200 arrays · `GET attendance/today` → 200
  (`myShift` shape) · `announcements/active`, `notifications`, `gamification/me`, `workspaces/members`,
  `auth/passkey` → 2xx · `POST /api/push/devices` → 2xx (token only stored).
- check-in (live tap: lat/lng + accuracyM/altitudeM/speedMps/simulated/fromAccessory + selfie) → 2xx
  with `record.id/checkInAt`; `today` afterwards shows `checkInAt`.
- second staff: check-in replayed from the offline queue (clientId/deviceAt/uptimeSec) → 2xx; same
  replay again → 2xx `duplicate:true` (no double check-in).
- check-out with a 200+ char reflection → 2xx `record.checkOutAt`.
- `history?scope=me&month=` → 200 rows incl. today; 0.1.5/0.1.6 also `history …&compact=1` → `records[]`.
- `requests?scope=me` → lists everything created; manager (same client build) `requests?scope=approvals`
  shows the staff's DAY_OFF; `PATCH requests/<id> {action:approve}` → 2xx.

Requests (dates from tomorrow, Jakarta):

| profile | fixture | expected |
|---|---|---|
| 0.1.4, 0.1.5 | PERMIT 1 day + photo, **no lat/lng** | 2xx |
| 0.1.4, 0.1.5 | PERMIT multi-day (START–UNTIL) + photo | 2xx |
| 0.1.4, 0.1.5 | PERMIT end < start (0.1.4 picker bug) | 2xx |
| 0.1.4, 0.1.5 | SICK multi-day + JPEG sent as octet-stream | 2xx |
| 0.1.4, 0.1.5 | SICK 1 day + PDF from Files | 2xx |
| 0.1.4, 0.1.5 | DAY_OFF 1 day | 2xx |
| 0.1.4, 0.1.5 | PERMIT without photo (UI says optional) | policy: 4xx with an `error` message |
| 0.1.6 | PERMIT 1 day + `permit-photo.jpg` + lat/lng · SICK 1 day · DAY_OFF | 2xx |
| 0.1.6 | SICK multi-day | policy: 400 `SINGLE_DAY_ONLY` |
| 0.1.6 | PERMIT without lat/lng | policy: 400 with message |
| web | PERMIT 1 day + photo + lat/lng · SICK 1 day · DAY_OFF | 2xx |
| web | PERMIT without lat/lng | policy: 400 with message |
| 0.1.3, 0.1.4, 0.1.5, 0.1.6, web | PERMIT with reason "ambil day off" (otherwise complete) | policy: 422 `PERMIT_NOT_DAYOFF` |
| 0.1.3 | login, profile, projects, tasks, today, history, requests list | 2xx |
| 0.1.3 | check-in, PERMIT | gate (below) |

## Minimum-version gate

The runner models the policy of 24 Sep 2026: floor 0.1.4; a legacy app (no header, known by UA build)
below the minimum gets **426 on attendance writes only** (non-GET under `/api/attendance`); a header app
below the minimum gets **426 on every `/api/*`** except `/api/app/version-policy` and `/api/health`; web is
never blocked. For each fixture the runner decides whether the gate applies at that pass's minimum and,
if so, expects 426 instead of the normal outcome (and still expects 2xx for every profile at or above
the minimum — a gate that locks out a current app FAILS).

The runner first calls `GET /api/app/version-policy`. If it is **404, the gate is not in the image**, and
every gate-affected fixture is reported as `PENDING-GATE` (with what the server does today) instead of
PASS/FAIL. Once the gate ships these turn into real assertions with no harness change. Passes:
`--min-version 0.1.4` (floor: NEXUS/7 writes → 426, its GETs 2xx; NEXUS/8/11/12 and web → 2xx) and
`--min-version 0.1.6` (NEXUS/8 and NEXUS/11 attendance writes → 426 as well).

## Files

- `run.sh` — orchestration, isolation, teardown.
- `fixtures.mjs` — per-client request list and expectations (edit here when a client release changes
  what it sends; cite the commit).
- `runner.mjs` — HTTP replay, gate model, table, exit code.
- `seed.cjs` — minimal world via the candidate's Prisma client (fields missing from an older schema are
  skipped with a note, not fatal).
- `egress-check.mjs` — the isolation proof.

## Wiring into deploy (for later — not done here)

`deploy-nexus.sh` builds straight onto `nexus-app:prod`. Build to a separate tag, run the harness, and
only then retag, so a failed harness leaves nothing for `recreate-beta.sh` to pick up by accident:

```
docker build -f Dockerfile.prod -t nexus-app:candidate . || exit 1
bash scripts/compat/run.sh nexus-app:candidate || { merah "compat gagal — tidak di-deploy"; exit 1; }
docker tag nexus-app:candidate nexus-app:prod
```

When a new iOS build ships: add a profile in `fixtures.mjs` from that release commit's
`APIClient.swift` / `AttendanceRequestsView.swift`, keep the old profiles until their UA stops appearing
in `docker logs nexus-web`.
