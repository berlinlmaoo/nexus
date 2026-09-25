# NEXUS Android: status

**ON HOLD since 25 Sep 2026**: Berlin is finishing iOS 0.1.6 first. Do not resume without his go.

Repo `agents:~/nexus-android`; every change is committed, and nothing is half-finished.
Build: `./gradlew assembleDebug assembleRelease testDebugUnitTest` (107 JVM tests, all green).
Version 0.1.6 (versionCode 1), applicationId `id.znetworks.nexus`, minSdk 26, target 36.

## Done (Phase 1, attendance MVP)

| Area | What exists | Where |
|---|---|---|
| Core | ApiClient (X-Nexus-Client, cookie only to NEXUS hosts, no silent POST retry, 401/426 handling, error sentences verbatim), session in Keystore AES-GCM (noBackupFilesDir), backups disabled | `core/net`, `core/session` |
| Office LAN shortcut | host rewrite to `lan.nexus.znetworks.id` after a Wi-Fi-bound 300 ms probe; replay only when the request provably never left | `core/net/LanRoute.kt` |
| Auth | login (password), logout vs 401 semantics (queue kept for the same person), delete account (type DELETE) | `feature/auth`, More tab |
| Version gate | android block of version-policy, persisted lock (survives offline cold start), 426 from any call, grace notice once per WIB day, update opens `storeUrl` (/download/android) | `core/version`, `ui/update` |
| Attendance | hero with OSM map + live clock + shift/flexi, PRESENCE IN/OUT with the reason they are grey, reflection ≥ 200 with persisted draft, offsite check-out (same selfie+fix, new clientId), forgotten check-out, NEXUS-down mode with same-day saved copy, metrics, nearest office, tablets and devices without camera/GPS read-only | `feature/attendance` |
| Face check | CameraX + bundled ML Kit, iOS thresholds (11.5°/21.8°, blink 70 %→85 %), either first turn then the opposite, face lost restarts, dark-room screen light, final photo upright + re-checked; FaceGuard (face ≥ 12 %) before the fix | `feature/attendance/liveness` |
| Offline queue | same clientId live and on replay, deviceAt/uptime, oldest first, unreachable/401 never counted, 426 held (persisted), 5 attempts, offsite resend for check-out, refused check-in dropped + said + local notification, owner-scoped | `AttendanceQueue.kt` |
| Requests | composer (one date, only fileable types, permit ≥ today with photo + locked location, sick backdatable, quota 0 blocked before submit), attachments (camera/gallery/files, JPEG re-encode, PDF, 10 MB), review queue with offsite check-outs (BoD + direct managers), filters/window/search, reject note, focus from deep links | `feature/attendance/requests` |
| Board | 28→27 period, BoD palette, scroll to today, day detail with both selfies, BoD delete/reopen, xlsx export, location trail on OSM | `feature/attendance/history` |
| Live location | TrailMachine (port of iOS WorkTrailPolicy), foreground service type location + "Work session" notification, disclosure once per record (not repeated after a yes), "Allow all the time", OEM battery guide, on/denied reporting, boot resume with background permission | `feature/attendance/trail` |
| Deep links | router holding targets across cold start/sign-in, `nexus://`, notification extras, `/attendance?request=|offsite=|permit=today`, unbuilt screens open the web | `core/nav` |
| Inbox, announcements, reflections, appearance | as named | `feature/inbox`, `feature/attendance/reflections`, More tab |
| Push | FCM data-only handling, PRD channels (+ `system`, + the pre-R1 ids), "File a permit" action only, auto-offsite reconcile, tap marks inbox read; local 15-min check-in reminder while push is off. **Off until** `~/.nexus-android-secrets/firebase.properties` exists (projectId, applicationId, apiKey, senderId) | `feature/push` |
| Distribution | release key (see CLAUDE.md), ARM-only release APK ~22 MB, staff install guide | `docs/INSTALL-APK.md` |

Server side for all of this is live (SERVER-REQUESTS R1–R4 DONE, server a79796b; iOS I1/I2 fixed by the main session).

## Not verified yet (the first thing to do on resume)

Nothing past the login screen has run against production. The emulator can't pass liveness (synthetic
camera), and no account has been used. Needed:
1. A real Android phone (ideally the staff Oppo A53 / Android 11) with the release APK.
2. An account Berlin approves for testing. His own (`bagasputro.bp@gmail.com`) was offered. Check-ins and the
   location trail then land in production attendance under his name.
3. Firebase project values in `firebase.properties`, then a test push (`?dryRun=1` rules still apply to cron endpoints).

Run the PRD §5 Phase 1 acceptance list on that phone: liveness vs a photo on a screen, airplane-mode
check-in replayed at the tap time, 502/530 queued vs 409 not queued, reflection gate, offsite
approval, permit rules, push to the approver, 2 h 30 outside with the phone locked, floor raised →
lock + held tap, day-off never over quota.

## Not built (Phase 2+ in PRD §5)

Tasks/projects, full dashboard, search, sign-up/reset/passkeys in-app (today they open the web),
chat, Threads, tickets, forms (`/f/` App Links), submissions, Z Vault (`/v/`), reports, leaderboard,
profiles, GIDEON, Control Room, offices admin, reflections of others, What's New, offline media
warm-up. Those tabs and links open the web page today.

## Next steps when the hold lifts

1. On-device run of the acceptance list above, fixing what it finds.
2. Publish the first APK: hand the main session the release APK + SHA-256 for
   `nexus-prod:~/nexus-data/android/current.json` (R2), and set `NEXUS_ANDROID_LATEST_VERSION`
   (+ `NEXUS_ANDROID_LATEST_RELEASED_AT` for the grace window, R4).
3. Internal rollout to the Android staff (Rifqi, Alvar) with `docs/INSTALL-APK.md`; watch the App tab.
4. Then Phase 2 per PRD.
