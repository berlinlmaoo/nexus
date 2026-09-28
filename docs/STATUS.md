# NEXUS Android: status

**Active again since 28 Sep 2026** (hold lifted by Berlin). Parity with iOS per
`docs/UPDATES-2026-09-28.md` is done; see "28 Sep" below.

Repo `agents:~/nexus-android`; every change is committed, and nothing is half-finished.
Build: `./gradlew assembleDebug assembleRelease testDebugUnitTest` (169 JVM tests, all green).
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

## Outside-the-office in the Work session notification (UPDATES §9), 28 Sep 2026

Done. `OutsideClock` (pure, JVM-tested) mirrors the server's `decideOutsideStep`: the clock starts at the
server's `outsideSince` (location-trail reply or `GET today → today.outsideSince`), the phone's own exit
time until the server answers; 90 min reminder, 120 min warning, auto check-out projected at +150 min and,
once the server says `warned`, its exact `nextAt`. A PENDING/APPROVED `todayRequest` (or stage
`paused_permit`) pauses it; going back inside clears the episode. The ongoing notification then turns
amber, reads "Di luar kantor sejak 20:59", counts down to the auto check-out with the system chronometer
("Auto check-out 23:29"), and from 90 min shows the reminder/warning wording plus the "Ajukan izin"
action (`nexus://attendance?permit=today`, the same as the push). It is re-posted only when that
presentation changes (state change, or the minute tick crossing 90/120). Inside it is unchanged.
AttendanceGuardTest now allows exactly one permit link per notification action, in Push.kt and
WorkTrailService.kt only. Not seen on the phone yet: needs a real 90+ min outside run.

Aligned with iOS 8a36fd2 (same day): `OutsideClock.present` is now a port of iOS `outsideStatus` —
the server's outsideSince counts only when heard after this exit and not >30 min before it; a restart
after a rejected/withdrawn excuse is read from the trail reply's `nextAt`; never a stage below the
server's; `paused_permit`/`auto_checked_out` → normal look; GET today's `todayRequest` only ever SETS
the pause; filing a request for today on the phone pauses the countdown at once.

## Local alerts and the precise route outside the office (UPDATES §10), 28 Sep 2026

Done (§10 was not yet written in UPDATES when this landed; built from Berlin's brief, re-check
against the text once it is there).
- Local notifications (channel `attendance_location`): "Kamu keluar kantor jam 14:05 · Auto check-out
  offsite jam 16:35 kalau belum balik atau ajukan izin" on leaving, and "Sudah 1 jam di luar kantor ·
  Sisa 1j 30m sebelum auto check-out (16:35)" at minute 60, both with the "Ajukan izin" action. Once
  per episode (keyed on the phone's exit time); someone found outside only after an hour gets the
  hour one alone. Taken back when back inside, when an excuse for today is PENDING/APPROVED, on
  check-out and on logout (service stop). Decided by `OutsideClock.alertStep` (JVM-tested).
- Precise route: outside, a point is queued every ~50 m moved (fixes vaguer than 100 m never count
  as moving) or every 5 min standing still; outside points go up in batches about every 2 min
  (exit/enter and the first fix after a resume go at once). GPS outside: high accuracy, 30 s /
  20 m. Inside unchanged (hourly presence check).
- The work-session text and the prominent location disclosure now say "every ~50 m or 5 min".
  PRD REQ-ATT-34/36 still say 15 min (owner's document, not edited here).

## Phase 2 (tasks & projects), in progress since 28 Sep 2026

| Part | What exists | Commit |
|---|---|---|
| 2.1 | Navigation (NavHost under the tab bar, tabs keep their state), link targets for projects/tasks, response cache (saved copy when nobody answers, per person, wiped on logout), session-aware images/avatars, Mission Control (search missions + tasks, folder tree, project cards with Cards/Done/Lanes/progress/next due from one fetch, create mission, create/edit/delete folder, move to folder) | 55a08ef |
| 2.2 | Project detail: header, tabs Overview/Board/List, token search with "shown/total", subtasks under their parent (merged from the project's task list), board lanes with inline add, long-press "Move to" lane (optimistic, reloads), done toggle, FAB "New task" (title, lane, priority, deadline; opens the new task), 403 → "Project locked" empty state, saved copy offline | d5ca76f |
| 2.3 | Task detail (iOS TaskDetailView + extras): parent breadcrumb, title edited in place (commits on Done/focus loss), status/priority menus, start/due pickers with clear, assignee picker from project members, BoD quest banner + "Make it a quest" (workspace role via `Viewer`), description editor (BlockNote flattened), subtasks (progress, toggle, add with Enter, open), files (camera/gallery/files; ≤64 MiB single request, above that 16 MiB chunks under one uploadId, one progress bar; open or share through FileProvider; delete), dependencies (blocked by/blocking, picker from the project's tasks, duplicates never sent), time log (total, last 6), comments (draft kept until posted), activity (last 12), delete task; PROOF_REQUIRED and other server sentences shown as-is | 2a0567d |
| 2.4 | Tasks tab = My Quest Log (iOS TasksView): Hot today (open, due within 2 days incl. overdue, soonest first, max 8) / In motion (12) / Recently slayed (8), shared TaskCard with project, done toggle, re-read on every visit, saved copy offline, empty state → Browse missions | 224ad86 |
| 2.5 | Home = dashboard (iOS DashboardView): greeting by office hour, **attendance card** (today's state incl. queued taps, open day, rest day; one tap to Attendance), level/XP card + level sheet, search pill (→ Mission Control search until 2.8) and bell with unread → Inbox, stat tiles Projects / Your Mission / Quest with sheets (quest **Claim**, one at a time, server sentence on refusal), XP rules (same tables as iOS/web), quick actions (Chat, Attendance, Leaderboard, Room Booking, Threads, Team Calendar; web until built), pinned + recent project shortcuts (per person on the phone, cleared on logout), 14-day agenda from my tasks, profile card. Attendance moved to its own screen reached from Home, More, pushes and links (`nexus://attendance…` focus still claimed by it) | 6f2f5a1 |
| 2.6 | Project tabs as the web/iOS: Sheet (every card + custom-field columns), Calendar (month grid, day list, add a task on that day), Timeline (gantt: title column, day axis, weekends, today line, priority colours, web taskWindow fallbacks), Sprints (Active/Planning/Shipped, progress, start/complete; **`requiresAction` handled**: asks backlog or another sprint and re-sends with `moveIncompleteTo` — iOS silently did nothing), Automations (IF → THEN, enable switch; LEAD refusal shown), Finance (name contains "finance") and P&L (flag + BoD) read-only by year. Pages, Forms and project Chat open the project on the web until Phase 3. Search box only on tabs that draw tasks | this step |

Still on the web until built: custom fields on a task (2.7), dashboard, search, sign-up/reset/passkeys, What's New.

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
| B13 | **Fixed** (main session, 28 Sep: board showed only people who had checked in on a period's first day). The board now merges `roster` from `GET /api/attendance/history?scope=workspace` with the people in the rows, sorted A–Z as on iOS/web (the viewer is no longer pinned first); roster quota is used when a person has no row yet (history/BoardModel.kt `members`, BoardModelTest `rosterShowsEveryoneEvenWithoutRows`). |

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
