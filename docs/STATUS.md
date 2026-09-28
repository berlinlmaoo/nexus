# NEXUS Android: status

**Active again since 28 Sep 2026** (hold lifted by Berlin). Parity with iOS per
`docs/UPDATES-2026-09-28.md` is done; see "28 Sep" below.

Repo `agents:~/nexus-android`; every change is committed, and nothing is half-finished.
Build: `./gradlew assembleDebug assembleRelease testDebugUnitTest` (134 JVM tests, all green).
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

## 28 Sep: brought level with iOS (UPDATES-2026-09-28.md)

| § | What | Commit |
|---|---|---|
| 1 | Hourly presence checks at the office (50 min, ≤ 45 s precise window, ≤ 50 m ends it, 15-min retry, presence outside = exit, > 1 km never used); trail view "Presence checks" hour chips + faint inside dots; disclosure/notification text | 98e7717 |
| 2 | Resume: stale fixes (> 2 min) ignored, `resume()` on every new service process, first fresh fix outside sent at once, level-triggered setup re-asserted every 10 min | 98e7717 |
| 3 | Board Score (worked/working, capped + "+N", effective `user.dayOffQuota`), freeze panes, weekday labels | 1ff56f1 |
| 3 | BoD "Change status" incl. Permit + Clear penalty via `POST /api/attendance/override` | 7cda4a0 |
| 5 | Extra day off (LIVE, server e910294): `dayOffQuota` shown as sent (already raised); the card says "This period: 4 + 3 extra" from `dayOffAllowance`; `dayoff_bonus_granted` → attendance_reminders; no grant UI (Phase 4) | a884d5c, this step |
| 6 | Liveness on every attendance selfie, enforced by type + source-scanning test | 6f23cdc |
| — | Period keys: 28th-at-midnight-WIB cut-off verified everywhere (iOS bug 8838eec not present) | a808e55 |
| — | Firebase read from `app/google-services.json` (main session drops it in; git-ignored) | a884d5c |
| — | In-app APK update: release check, resumable download with session, sha256 + package + signing cert + version verified, PackageInstaller, "Install unknown apps" guided once | fd00ad5 |

## Phase 2 (tasks & projects), in progress since 28 Sep 2026

| Part | What exists | Commit |
|---|---|---|
| 2.1 | Navigation (NavHost under the tab bar, tabs keep their state), link targets for projects/tasks, response cache (saved copy when nobody answers, per person, wiped on logout), session-aware images/avatars, Mission Control (search missions + tasks, folder tree, project cards with Cards/Done/Lanes/progress/next due from one fetch, create mission, create/edit/delete folder, move to folder) | this step |

Still on the web until built: project detail, task detail, My tasks, dashboard, search, sign-up/reset/passkeys, What's New.

## iOS bug checklist (UPDATES §8), checked 28 Sep 2026

Paths are under `app/src/main/java/id/znetworks/nexus/`.

| # | Result on Android |
|---|---|
| B1 | **Not affected.** A 401 ends the session via `AuthRepository.sessionEnded` (feature/auth/AuthRepository.kt:100) → `AppContainer` keeps the queue with `holdForSignIn` (core/AppContainer.kt:123, AttendanceQueue.kt:211); only deliberate logout / delete account clears it (AppContainer.kt:119, AuthRepository.kt:88/93); another person signing in deletes the previous owner's taps (`keepOnly`, AppContainer.kt:109, AttendanceQueue.kt:219); replay only sends the signed-in owner's entries (AttendanceQueue.kt:142). Tests: AttendanceQueueTest `unauthorizedKeepsEverything`, `anotherPersonsTapsAreNeverReplayedAndAreDeletedOnSignIn`, AuthRepositoryTest `expiredSessionEndsNotDeliberately`. |
| B2 | **Not affected.** Every period key goes through `OfficeTime.periodKey` (core/time/OfficeTime.kt:27, 28th cut-off in WIB). Offline prefetch does not exist yet; it must use the same function. |
| B3 | **Not affected.** Board default/previous/next, export and the "This period" window use `OfficeTime.periodKey`; reflections use the calendar month on purpose; day-off and public-holiday counts come from the server. Boundary pinned at 28 Sep 00:00 WIB (BoardModelTest `periodFlipsAtMidnightWibOnThe28th`, a808e55). Member detail is Phase 4. |
| B4 | **Not applicable yet**: chat is Phase 3. When built: `POST /api/conversations/{id}/read` on open and whenever the last message id changes while open. |
| B5 | **Fixed** (98e7717 + this step): `TrailMachine.resume` (trail/TrailMachine.kt:206) drops a stale fix and sends the first fresh one outside at once; fixes older than 2 min ignored (TrailMachine.kt:252); `resume()` on every new service process (WorkTrailService.kt:78); setup re-asserted every 10 min (WorkTrailService.kt:94); reconcile on foreground, after every today load, on queue landing, and now also right after a location permission result (AttendanceViewModel `onLocationPermissionResult`). Tests: TrailMachineTest `resumeOutsideSendsTheFirstFreshFixAtOnce`, `staleFixIsIgnored`. |
| B6 | **Not affected.** A check-in 422 with `distanceMeters` and no `code` is typed outside-radius (AttendanceApi.kt:99-103): on replay it is dropped and said once (screen + local notification); live it keeps "You're N m from …". Tests: AttendanceApiTest `checkInOutsideRadiusWithoutCodeIsTyped`, AttendanceQueueTest `checkInOutsideRadiusIsDroppedAndSaid`. |
| B7 | **Not affected.** The offsite queue loads for `canReviewAttendanceRequests || canManageAttendance` (requests/RequestsViewModel.kt:101); there is no "file for someone else" path at all (`targetUserId` appears nowhere). |
| B8 | **Not affected** (built to the fixed rule, 1ff56f1): history/BoardModel.kt:43 (worked = present + permit + WFH), :58 (working = days − effective quota, capped, surplus). |
| B9 | **Not affected** (7cda4a0): BoD opens id-less and empty past cells (history/BoardUi.kt:147) and gets Change status (BoardUi.kt:453). |
| B10 | **Nothing to fix.** The LAN route replays only when the request provably never left (core/net/LanRoute.kt:113); LanRouteTest `postDroppedMidwayIsNotReplayed`. |
| B11 | **Not affected.** No splash that waits on data: MainActivity draws login/lock/shell on the first frame, nothing prefetches every project, and no GIDEON bubble exists. |
| B12 | **Not affected** (6f23cdc): attendance only accepts `LiveSelfie` from the face check (liveness/LivenessCaptureScreen.kt:100); AttendanceGuardTest fails the build on any bypass. |

## First APK, ready to publish (for the main session, R2)

`agents:~/nexus-android-release/NEXUS-0.1.6-1.apk` — versionName 0.1.6, versionCode 1, arm64-v8a +
armeabi-v7a, targetSdk 36, 21.9 MB, sha256 `5fabc061f5200e9783c594627e6a82f029614b26aafa8b7f8583411862e2d97e`,
signed by the release key (SHA-256 53:22:FE:…:AD:26). Built WITH Firebase (project
nexus-znetworks-android, read from `~/.nexus-android-secrets/firebase.properties`, 28 Sep).

## Not verified yet (the first thing to do)

Nothing past the login screen has run against production. The emulator can't pass liveness (synthetic
camera), and no account has been used. Needed:
1. Test phone: Oppo Reno 16 F 5G (Dimensity 7300-Energy, Android 16), with the APK above.
2. Test account: the STAFF member who holds that phone logs in himself; his attendance is real.
   Never ask for or store a password. One check-in per day per account.
3. Firebase: Berlin is creating the project (bagas@znetworks.id); the main session installs
   google-services.json + the server key. Then rebuild and test a push (never POST cron endpoints).

Run the PRD §5 Phase 1 acceptance list on that phone: liveness vs a photo on a screen, airplane-mode
check-in replayed at the tap time, 502/530 queued vs 409 not queued, reflection gate, offsite
approval, permit rules, push to the approver, 2 h 30 outside with the phone locked, floor raised →
lock + held tap, day-off never over quota.

## Not built (Phase 2+ in PRD §5)

Tasks/projects, full dashboard, search, sign-up/reset/passkeys in-app (today they open the web),
chat, Threads, tickets, forms (`/f/` App Links), submissions, Z Vault (`/v/`), reports, leaderboard,
profiles, GIDEON, Control Room, offices admin, reflections of others, What's New, offline media
warm-up. Those tabs and links open the web page today.

## Next steps

1. Main session publishes the APK above (`~/nexus-data/android/` + `current.json`, R2) and sets
   `NEXUS_ANDROID_LATEST_VERSION` (+ `_RELEASED_AT`, R4). The in-app updater is then testable with a
   0.1.6 (2) build.
2. On-device run of the acceptance list above on the Oppo, fixing what it finds.
3. Internal rollout to the Android staff (Rifqi, Alvar) with `docs/INSTALL-APK.md`; watch the App tab.
4. Then Phase 2 per PRD.
