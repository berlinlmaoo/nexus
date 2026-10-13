# NEXUS Android — handoff for the Android session

You are building the native Android app of **NEXUS**, Z Networks' internal ops app (attendance,
projects/tasks, chat, forms, Z Vault, reports, quests, GIDEON). iOS 0.1.6 is the reference. The
owner is **Berlin** (Bagas Putro). Talk to him in casual Indonesian ("gw/lo"), short. All UI copy
ships in English with Indonesian translations (user picks the language), like iOS.

Read these before writing code:
- `docs/PRD.md` — what to build, the attendance rules, phased plan, acceptance criteria.
- `docs/API.md` — the server contract, taken from the iOS client and the server routes.
- The shared memory index at `/root/.claude/projects/-root/memory/MEMORY.md`. Start Claude from
  `/root` on the Proxmox host so you get that memory. Most of it is iOS/server history, but the
  attendance and feedback entries apply to you as well.

## Stack (decided)

- Kotlin + Jetpack Compose, single-activity, Material 3 themed to match NEXUS (not stock Material).
- Coroutines/Flow, Retrofit or Ktor + kotlinx.serialization, Room for the offline cache and the
  attendance queue, WorkManager for background sync, DataStore + EncryptedSharedPreferences/Keystore
  for the session token.
- CameraX + ML Kit face detection for the selfie liveness check.
- FusedLocationProvider + a foreground service (type `location`) for live location between check-in
  and check-out.
- FCM for push. Firebase and the Play Console are Berlin's to set up (see "Needs from Berlin").
- Flutter was considered and rejected: background location, the foreground service and liveness are
  all native work anyway, and Berlin agreed to native.

## Where things live

| What | Where |
|---|---|
| This repo | VM `agents`, `~/nexus-android` (`ssh agents`, user `debian`) |
| iOS app (reference, read-only for you) | VM `agents`, `~/nexus-ios` |
| Server (Next.js 15 + Prisma + Postgres) | VM `nexus-prod`, `~/nexus` |
| Web SPA (Phaëthon, React/TanStack) | `nexus-prod:~/nexus/apps/web` |
| Production | `https://nexus.znetworks.id` (Cloudflare → nginx → container `nexus-app`) |
| Office LAN shortcut | `https://lan.nexus.znetworks.id` (see API.md) |
| Standby | VPS Sumopod, automatic failover after 10 min; runbook `/srv/RUNBOOK.md` there |

## Building and testing on Linux

Android builds on Linux, unlike iOS. On VM `agents` install the JDK 17 + Android command-line tools
(`sdkmanager`), and build with `./gradlew assembleDebug` / `testDebugUnitTest`. There is no emulator
with KVM guaranteed in the VM. Check before relying on one. Otherwise test on Berlin's Android
phone over `adb` (wireless debugging via Tailscale) or ship to the Play internal testing track.
Every change must compile and pass unit tests before you say it is done. Berlin hates "should work".

## Coordination with the main session (important)

Another Claude session (the "main session") owns the server, web and iOS. Rules:

1. **Do not edit the server, web or iOS repos.** When Android needs a server change (FCM, the
   `android/` client tag, assetlinks.json, anything flagged "SERVER CHANGE REQUIRED" in API.md),
   write it up in `docs/SERVER-REQUESTS.md` (what, why, exact shape) and tell Berlin to pass it
   to the main session. If Berlin tells you to do it yourself, follow the deploy rules below.
2. **Never deploy at the same time as the main session.** Deploys go ONLY through
   `nexus-prod:~/deploy-nexus.sh`, which builds `nexus-app:candidate` and runs the compatibility
   harness (`scripts/compat/run.sh`, 127 fixtures × 2 passes) before tagging prod. Never
   `docker compose up`, never build `prod` by hand, and never skip the gate.
3. **DB changes are hand-written idempotent SQL applied before the deploy.** No `prisma migrate`
   history exists; `db push` must never run against production.
4. **Never POST to `/api/cron/*` or notification endpoints on production to "test".** They send
   real pushes to ~40 staff. Use `?dryRun=1`.
5. Do not read or query the production database unless Berlin asks. Staff data is personal.

## Client identification (you must send this)

Every request: `X-Nexus-Client: android/<versionName>/<versionCode>`, e.g. `android/0.1.0/1`.
The server parser is `src/lib/client-version.ts`. Today it only knows `ios` and `web`, and an unknown
platform is treated as the OLDEST client (looser rules, no version gate). Before Android goes to
real staff, the main session must:
- teach `version-policy.ts` / the middleware gate about `android` (its own minimum version and
  Play Store "latest"), so the forced-update lock works for Android as it does for iOS 0.1.6;
- decide per rule whether `android/*` counts as "modern" (single-date requests, permit guard,
  location required); and
- add an android profile to the compat harness.

Do not ship to staff before those land. Internal testing with Berlin is fine.

## Berlin's standing rules (non-negotiable)

- **Attendance is the core.** "gw gamau ada masalah kaya gini lagi ke ulang". Anything touching
  check-in/out, requests, the offline queue, location or the update lock gets double- and
  triple-checked. Prove it works end to end on a device before calling it done.
- **The server is never stricter than the oldest released client.** Android must also accept a
  server that is looser than it expects, so tolerate unknown fields and unknown enum values.
- **Selfie is always required** for check-in, plus the on-device liveness check. There is no
  "skip". Only BoD may skip attendance. Nobody else is "bebas absen".
- **Day-off policy is settled:** TK and lateness over 120 minutes consume the day-off quota. There
  is no forgotten-check-in correction. A permit cannot be a day off. Do not propose loosening any of this.
- **Fix bugs you find without asking**, in Android, and flag server/web ones via SERVER-REQUESTS.
  Ask Berlin only about policy, people's data, XP/day-off refunds, or destructive actions.
- **Changes must actually run.** Reject patches that look right but whose code path is never hit.
- **Every new screen needs a real empty state**: why it is empty, what to do next, and an action button.
- **Web/mobile parity:** if Android gets a feature the web lacks, say so (the main session adds it).
- Code comments in English. Commits end with the attribution lines your harness gives you.
- Release notes (Play Store) follow the Gojek-ish house style: a hook in caps, short lines, one
  twist. Never mention XP or server outages, and no "update now" CTA.

## Needs from Berlin before specific milestones

- Google Play Console account ($25 one-off) — before the first internal-testing upload.
- Firebase project + `google-services.json` for package `id.znetworks.nexus` (confirm the id) and
  the server key / service-account JSON for the main session — before push works.
- An Android test phone, ideally a Xiaomi/Oppo/Vivo/Samsung (their battery killers are the real
  test for live location).
- Play's background-location declaration (form + demo video) — before a production release.

## First steps

1. Read PRD.md and API.md fully. List the open questions to Berlin in one message.
2. Scaffold the project (Gradle KTS, version catalog, `id.znetworks.nexus`, minSdk per PRD).
3. MVP order: login → today/attendance (selfie + liveness + GPS + offline queue) → requests →
   push → update lock. Then the other phases in PRD.md.

## Server status (updated 24 Sep 2026, server commit 6545d28)

Phase 0 is LIVE on production. The main session deployed it through the gate (compat 163/163, which
includes 36 android fixtures written from docs/API.md; re-pin them to the real ApiClient once it exists):
- `X-Nexus-Client: android/<x.y.z>/<code>` is parsed (all three version parts required). Android counts
  as a modern client for request rules. 426 gate reads env `NEXUS_ANDROID_MIN_VERSION` (default
  0.0.0 = nobody blocked). `GET /api/app/version-policy` and `/api/app/latest` have an `android` block.
- Push: `POST /api/push/devices` takes `{platform:"android", token, deviceId, appId, ...}`. The server
  sends FCM HTTP v1 notification+data messages with channel ids `attendance` / `messages` /
  `general` (`androidChannelFor` in `src/lib/fcm-payload.ts`). docs/API.md B4 asked for data-only
  messages and PRD 4.5 lists more channels: if you need that, write it in docs/SERVER-REQUESTS.md.
  Android push stays OFF until Berlin provides the Firebase service-account key
  (`NEXUS_FCM_SERVICE_ACCOUNT_JSON`, base64, dedicated key with the FCM role).
- `/.well-known/assetlinks.json` and passkey `android:apk-key-hash` origins come from env
  `NEXUS_ANDROID_CERT_SHA256` (Play app-signing SHA-256, comma-separated). Empty until set.
- Check-ins carrying the android tag are stored with `checkInClient = "android-app"` and are tracked.

## Android status (updated 25 Sep 2026, commit 9183a92)

Owner decisions of 24 Sep 2026 (final): versionName follows iOS (0.1.6, code 1); APK sideload, no
Play yet (download page + login-only APK endpoint requested in docs/SERVER-REQUESTS.md R2; staff
guide in docs/INSTALL-APK.md); maps are OpenStreetMap (osmdroid, same tiles as the web), not
Google Maps; no Huawei-without-GMS; tablets read-only; approve/reject only in the app; direct
battery-optimisation dialog allowed while sideloaded.

Built and unit-tested (107 JVM tests, `./gradlew testDebugUnitTest`):
- Login, session (Keystore AES-GCM, noBackupFilesDir), logout / 401 semantics, delete account.
- Version gate: android block of version-policy, persisted lock, 426 from any call, grace notice.
- Attendance: hero with OSM map, liveness (CameraX + bundled ML Kit, iOS thresholds), FaceGuard,
  fresh GPS fix with mock flag, check-in/out, offsite, reflection with draft, offline queue
  (same clientId, deviceAt, 5 attempts, 426 hold, owner scoping), NEXUS-down mode.
- Requests composer + review queue incl. offsite check-outs (managers too), attachments.
- Crew board (28->27), day detail with selfies, BoD record actions, xlsx export, trail map.
- Live location: TrailMachine (port of iOS WorkTrailPolicy), foreground service type location,
  disclosure, background permission, OEM battery guide.
- Deep links (router), Inbox, announcements, reflections, appearance, LAN shortcut.
- Push (FCM) wired but OFF until `~/.nexus-android-secrets/firebase.properties` exists
  (projectId, applicationId, apiKey, senderId); local check-in reminder while push is off.

Not yet verified end to end: nothing past the login screen has run against production (the
emulator cannot pass liveness; needs a real phone and Berlin's account). Release key:
`~/.nexus-android-secrets/nexus-release.jks` (backup host:/mnt/nexus-backup/android-signing),
SHA-256 53:22:FE:4C:77:ED:CC:73:36:81:76:67:0C:E5:D8:E1:41:C6:58:2D:4B:CD:36:E2:85:E0:EE:30:FF:A6:AD:26.
Emulator on this VM: start with `setsid --fork`, wait for load to settle (4–15 min).
