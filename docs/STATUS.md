# NEXUS Android: status

**Active again since 28 Sep 2026** (hold lifted by Berlin). Parity with iOS per
`docs/UPDATES-2026-09-28.md` is done; see "28 Sep" below.

Repo `agents:~/nexus-android`; every change is committed, and nothing is half-finished.
Build: `./gradlew assembleDebug assembleRelease testDebugUnitTest` (431 JVM tests, all green).
Version 0.1.6 (versionCode 13 in the tree), applicationId `id.znetworks.nexus`, minSdk 26, target 36.
**Build 13 PUBLISHED** (5 Oct: `nexus-prod:~/nexus-data/android/nexus-0.1.6-13.apk` + `current.json` (previous kept as `current.json.prev-12`), sha256 `a6e09f68cae704162865a633dff4293b4fcdcb0dea865f113f315c959ceea98a`, from 0885fa0, 342 tests; versionCode 13, versionName 0.1.6, signer 5322fe4c…ad26; version-policy answers latestBuild 13): build 12 + the org chart in English and Indonesian. Emulator smoke: 3 cold launches drawn, no crash from this install.
**Build 12 PUBLISHED** (5 Oct 07:44 UTC: `nexus-prod:~/nexus-data/android/nexus-0.1.6-12.apk` + `current.json` (previous kept as `current.json.prev-11`), sha256 `6c660b44318a0872b44a2ba56bc9410373b5fd4da2b5f357e34e4a7957164a1b`, from e7924c4, 341 tests; versionCode 12, versionName 0.1.6, signer 5322fe4c…ad26; version-policy answers latestBuild 12): build 11 + Bagan IP & Divisi. Emulator smoke: 3 cold launches drawn, no crash from this install; the fixture and the debug preview are not in the release APK.
**Build 11 PUBLISHED** (29 Sep 11:38 UTC, by this session on the main session's instruction: `nexus-prod:~/nexus-data/android/nexus-0.1.6-11.apk` + `current.json` (previous kept as `current.json.prev-10`), sha256 `888d6d3c7350c886d61d850f1b183f473185fa74014e367ce8e4465cdfe53a10`, from 1dfc428, 334 tests; versionCode 11, versionName 0.1.6, signer 5322fe4c…ad26; version-policy answers latestBuild 11): build 10 + pinned projects synced with the server. Emulator smoke: 3 cold launches drawn, no crash from this install.
**Build 10 (published by the main session 11:02 UTC)** (`~/nexus-android-release/NEXUS-0.1.6-10.apk`, sha256 `8a57c090a0123acceeaf86388fb65fbe0d2dced575cd6e86997a04efca4ce462`, from 7dc72da, 330 tests; versionCode 10, versionName 0.1.6, signer 5322fe4c…ad26): 0.1.6 final — leave as one range, no past day for any type, photo for sick and permit (BoD included), always-location button to the app's Location screen, What's New line. (A first build 10 made from ea52b04 before Berlin's revision was replaced before anyone got it.) Emulator smoke: 3 cold launches drawn, no crash from this install (only the stale BOOT_COMPLETED to the removed previous uid).
**Build 9 ready, NOT published** (`~/nexus-android-release/NEXUS-0.1.6-9.apk`, sha256 `de3d5d61eb534cf86d1d22cede2466addbc2420b4401406060d4b7d94afdeaf6`, from 3dea3c4, 324 tests; versionCode 9, versionName 0.1.6, signer 5322fe4c…ad26): build 8 + Control Room › App per device + centred confirmations. Emulator smoke: 3 cold launches drawn, no crash from this install (only the stale BOOT_COMPLETED to the removed previous uid).
**Build 8 PUBLISHED** (29 Sep, by the main session: nexus-prod current.json versionCode 8, version-policy latestBuild 8; waiting for Berlin's test) (`~/nexus-android-release/NEXUS-0.1.6-8.apk`, sha256 `1a4fd49bc7b801dd0f482272baa25565acfa4ec6542ad8005cc38db8aa36eacc`, from b7000aa, 322 tests; versionCode 8, versionName 0.1.6, signer 5322fe4c…ad26): build 7 + Batch 2 A/B/C (Absen Monitor with warnings, Control Room keyboard, targeted announcements with SP PDF). Same emulator smoke as build 7: 3 cold launches drawn, no crash from this install (only the stale BOOT_COMPLETED to the removed previous uid).
**Build 7 ready, NOT published** (`~/nexus-android-release/NEXUS-0.1.6-7.apk`, sha256 `f10f4887e2eba6f83521e3584206b35cc04d09b92cb6417b22574612d66b1873`, from 1e3e706, 314 tests; versionCode 7, versionName 0.1.6, signer 5322fe4c…ad26): UI points 1–7 vs iOS + update offered by build number (latestName/latestBuild). Emulator smoke: 3 cold launches drawn, no crash from this install (the one crash in the log is the known stale BOOT_COMPLETED to the uninstalled previous uid).
Build 6 (sha256 `ec06a64e…1934`, from 91dded1, 308 tests) — see "APK ready".
**Release candidate: build 5** (`NEXUS-0.1.6-5.apk`, sha256 `4d75566d2e21e24d4ac93835e8cd7c1ba3875455168306c8de2bfb63c0943c38`,
from b122e0f, 300 JVM tests at that commit): security + parity audit 266af90 = **RILIS LAYAK**; it goes
out for Berlin to test. The fixes for that audit's RENDAH findings (R1, R3, R4, R6, R7) are in the code
after it and ride in the next build, which is made only when the main session says so.
Phases 1–5 done; Wear OS not built (Berlin: not a Play Store priority).

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
| Push | FCM data-only handling, PRD channels (+ `system`, + the pre-R1 ids), "File a permit" action only, auto-offsite reconcile, tap marks inbox read; local 15-min check-in reminder when push is unavailable. **On**: Firebase is installed (`~/.nexus-android-secrets/firebase.properties` + google-services.json), release builds are made with it; chat pushes as MessagingStyle per conversation (8 Oct) | `feature/push` |
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
- Exit margin = the server's `classifyPoint`: outside only beyond radius + max(accuracy, **50 m**)
  (was 30 m, the same bug iOS fixed in 81abc62: the phone said "outside" before the server's clock
  started). Moving points outside are at least 10 s apart (a car: ~300 points/hour, not 1,000).
- The work-session text and the prominent location disclosure now say "every ~50 m or 5 min".
  PRD REQ-ATT-34/36 still say 15 min (owner's document, not edited here).

## One attendance button with the flow inside it (UPDATES §11), 28 Sep 2026

Done. PRESENCE IN / OUT are gone; `AttendanceButton` is one full-width control:
- Ready → green "Check in". Checked in (or an earlier day still open) → "Check out", grey and locked
  with "120/200" and a progress line until the reflection reaches 200 characters, then red. An
  offsite check-out awaiting approval keeps it locked. Checked out → calm "Selesai hari ini · kerja
  8j 45m" (check-in → check-out). Rules are `AttendanceButtonLogic.mode` (JVM-tested), the same
  conditions the two buttons had.
- Press: the face check (full screen, unchanged) → "Selfie ✓" → "Mencari lokasimu…" (spinner) →
  "Di <office> · 12 m ✓" (or "<office> · 340 m dari sini"; display only, the server decides) with
  "Mengirim…" → success: check mark, light haptic, "Check in 09:02 · tepat waktu / · telat 6 menit"
  (lateMinutes from the reply); offline → amber "Tersimpan di HP ini — terkirim sendiri saat NEXUS
  kembali"; failure → light reject haptic, the server's sentence under the button, the button becomes
  "Coba check in lagi" (+ Settings link when the fix is a permission). The old result dialog is gone.
- Owner's correction (28 Sep): NO confetti, no shake, no bounce — steps inside the button, a check
  mark, a light haptic, plain crossfades. Submitted data, clientId/idempotency and the queue are
  untouched (AttendanceGuardTest still passes).
- Reflection (iOS 87ada44, 28 Sep): the keyboard's Done key, system back, a tap on empty space and a
  drag on the page all close the keyboard; while typing, the Check out button is kept in sight above
  the keyboard. The locked Check out is grey filling with red as the reflection grows (owner's pick);
  the thin progress line under it is gone.
- Hero map (iOS 4bb25f8 + 5ba2e93, 28 Sep): framed on today's record's office (or the nearest one
  before check-in), 7 × radius across and never under 300 m, with the violet check-in circle, an
  office pin and a blue dot for the person. Location-free members (`today.noGeofence`): the map
  follows their GPS (400 m, no office circle), and the location card reads "Lokasi check-in" with
  the first two parts of `checkInAddress` (or "Check-in di luar kantor" / "Bebas lokasi").

## Phase 2 (tasks & projects), in progress since 28 Sep 2026

| Part | What exists | Commit |
|---|---|---|
| 2.1 | Navigation (NavHost under the tab bar, tabs keep their state), link targets for projects/tasks, response cache (saved copy when nobody answers, per person, wiped on logout), session-aware images/avatars, Mission Control (search missions + tasks, folder tree, project cards with Cards/Done/Lanes/progress/next due from one fetch, create mission, create/edit/delete folder, move to folder) | 55a08ef |
| 2.1b | **Folder calendar** (iOS FolderAggregateView, web /folders/$id on mobile): calendar button on every folder row; every task due across the folder's projects (sub-folders included) on a Monday-first month grid with dots, day list with project colour bar, priority, assignee, opens the task; colour legend with inline recolour (project colour PATCH); "Pick projects" subset saved to the folder (`aggregateProjectIds`, all picked = [] so new projects join) | this step |
| 2.2b | Custom-field chips on task cards (board, list, my tasks, calendar day list), as iOS CustomFieldChips / web customFieldChip: STATUS coloured (done/progress/blocked/todo/other), IDR currency format, multi-select joined, place label, dates short; values stored as JSON text read the same | this step |
| 2.1c | Links: every path the server puts in a notification checked (`link:` in src/lib + api). `/dashboard` now opens Home (was the browser), an `announcement` push without a link opens Home (was the browser), `/people/<id>` the member profile, `/folders/<id>` the folder calendar. Only `/peer-reports` stays on the web (no such screen on iOS either) | this step |
| 2.2 | Project detail: header, tabs Overview/Board/List, token search with "shown/total", subtasks under their parent (merged from the project's task list), board lanes with inline add, long-press "Move to" lane (optimistic, reloads), done toggle, FAB "New task" (title, lane, priority, deadline; opens the new task), 403 → "Project locked" empty state, saved copy offline | d5ca76f |
| 2.3 | Task detail (iOS TaskDetailView + extras): parent breadcrumb, title edited in place (commits on Done/focus loss), status/priority menus, start/due pickers with clear, assignee picker from project members, BoD quest banner + "Make it a quest" (workspace role via `Viewer`), description editor (BlockNote flattened), subtasks (progress, toggle, add with Enter, open), files (camera/gallery/files; ≤64 MiB single request, above that 16 MiB chunks under one uploadId, one progress bar; open or share through FileProvider; delete), dependencies (blocked by/blocking, picker from the project's tasks, duplicates never sent), time log (total, last 6), comments (draft kept until posted), activity (last 12), delete task; PROOF_REQUIRED and other server sentences shown as-is | 2a0567d |
| 2.4 | Tasks tab = My Quest Log (iOS TasksView): Hot today (open, due within 2 days incl. overdue, soonest first, max 8) / In motion (12) / Recently slayed (8), shared TaskCard with project, done toggle, re-read on every visit, saved copy offline, empty state → Browse missions | 224ad86 |
| 2.5 | Home = dashboard (iOS DashboardView): greeting by office hour, **attendance card** (today's state incl. queued taps, open day, rest day; one tap to Attendance), level/XP card + level sheet, search pill (→ Mission Control search until 2.8) and bell with unread → Inbox, stat tiles Projects / Your Mission / Quest with sheets (quest **Claim**, one at a time, server sentence on refusal), XP rules (same tables as iOS/web), quick actions (Chat, Attendance, Leaderboard, Room Booking, Threads, Team Calendar; web until built), pinned + recent project shortcuts (per person on the phone, cleared on logout), 14-day agenda from my tasks, profile card. Attendance moved to its own screen reached from Home, More, pushes and links (`nexus://attendance…` focus still claimed by it) | 6f2f5a1 |
| 2.6 | Project tabs as the web/iOS: Sheet (every card + custom-field columns), Calendar (month grid, day list, add a task on that day), Timeline (gantt: title column, day axis, weekends, today line, priority colours, web taskWindow fallbacks), Sprints (Active/Planning/Shipped, progress, start/complete; **`requiresAction` handled**: asks backlog or another sprint and re-sends with `moveIncompleteTo` — iOS silently did nothing), Automations (IF → THEN, enable switch; LEAD refusal shown), Finance (name contains "finance") and P&L (flag + BoD) read-only by year. Pages, Forms and project Chat open the project on the web until Phase 3. Search box only on tabs that draw tasks | af4e36e |
| 2.7 | Custom fields on a task (view + edit every type: text, number, date, select/status, multi-select, place; created read-only) and **Project settings** (gear on the project header): identity (name, description, emoji, colour), flags (task duplicate mode, proof required for DONE, P&L for BoD, auto-assign with members), custom field definitions (create with options, delete), members (add from the workspace roster, remove, invite by email with role), duplicate (BoD) and delete project. LEAD/BoD refusals show the server's sentence. Custom fields in the New task dialog: **done** (every type but CREATED; filled values set after the task exists, a refused one is said) | 39bbc3b, this step |
| 2.8 | Search (Home's search pill): `GET /api/search`, 2-character minimum, 300 ms debounce, groups Projects / Tasks / Docs / Forms / Members as iOS. Projects and tasks open natively; docs and forms on the web until Phase 3; members are listed (profiles come with Phase 3) | db6d9df |
| 2.9 | Account, natively: **sign-up** (name, email, password, optional workspace code → 6-digit code → account created → signed in; the code is sent again on verify as the API requires), **password reset** (email → code + new password), resend with the server's countdown, first field error in form order, tries left shown; **passkeys**: sign in with a passkey on the login card (Credential Manager 1.6.0; server origins + assetlinks are live), and in More › Account & sign-in list/add/remove; **change email** (code to the new address, session email updated) and **change password**. `nexus://forgot-password?email=…&invited=1` and `nexus://register?code=…` open those cards. Not verified on a phone yet: the passkey sheet needs the release-signed APK (assetlinks has the release fingerprint only) | 073ee45 |
| 2.10 | What's New: a sheet once per versionName after sign-in (0.1.6 = the first Android release: one button, work session/outside countdown, offline queue, missions in the app, sign-up/reset/passkeys, in-app updates), also under More. A version without notes shows nothing | f691852 |

**Phase 2 is complete** (28 Sep 2026). To ship it, the APK needs a new versionCode (the one handed over below is build 1, before Phase 2): the main session decides the build number and publishes (R2/R4).

## Phase 3 (communication and knowledge), in progress since 28 Sep 2026

| Part | What exists | Commit |
|---|---|---|
| 3.1 | Messages: list (Direct / Groups / Projects, unread badges, previews, polled every 15 s, saved copy offline), new DM or group from the workspace roster, thread (polled every 5 s, load earlier, **reply** with quote, @mention picker → mentionedUserIds, photos from gallery/camera as JPEG ≤ 8 MB via /api/upload/chat, send location, location and task cards, copy, full-screen photo, rename group), **marks read** (`POST …/read`, which iOS never calls), the project Chat tab opens the project room, `/messages?c=` links and message pushes open the thread | 824a6f9 |
| 3.2 | Threads (company feed): composer (≤ 280 chars, up to 4 photos as JPEG ≤ 8 MB with their sizes in imageMeta, @mention picker from the roster), feed **paged** with the server cursor (iOS never pages), like (optimistic, reconciled), comments sheet with mentions, delete (own or BoD+), edit within 15 min (web parity), server sentences (20 s gap, hourly cap) shown verbatim; Home quick action and `/threads?post=` links/pushes open it (the post's comments) | da786a2 |
| 3.3 | Tickets (More › Tickets): list with status filters and counts (In review includes Awaiting decision), anonymous reporters, GIDEON-replied and decision-waiting marks; new ticket (category, subject 4–140, body ≥ 10, 1–5 evidence photos from camera/gallery as JPEG ≤ 8 MB); detail with photos, conversation (GIDEON labelled), reply (≥ 10), BoD status menu; **attendance corrections** on ATTENDANCE/EXP tickets: before → proposed times, penalty cancellation with XP/day-off cost, propose both kinds (iOS only times), BoD approve/reject with note, the 409 optimistic lock explained; `/complaints?id=` links and ticket pushes open it | 859622b |
| 3.4 | Forms + My Submissions: fill any form (public route, private fallback, "closed now" schedule sentence), every field type (text/textarea/number/currency/email/date/dropdown/multi-select/checkbox/files, autofilled read-only, section headings), `showIf` and required rules ported from iOS/web (hidden fields not sent), files streamed from disk (50 MB per file and 64 MB per request checked before sending), optional per-field attachment, progress, a 401 LOGIN_REQUIRED keeps the answers and signs nobody out; success shows the created task; My submissions (More) with board column + processing status, detail with answers and proofs (opened with the session); project Forms tab; search opens forms in the app; **https App Link `/f/`** added (assetlinks live) | b22f69d |
| 3.5 | Knowledge Library (More): searchable doc list, reader drawing BlockNote blocks (headings, bullets, numbered, checklists, quotes, code) or `contentText`, project Pages tab, search and `/docs/<id>` links open docs in the app. Read-only, as iOS. Home's Chat/Threads quick actions go to the app screens | f3c07dc |
| 3.6 | Z Vault (More): browse folders with breadcrumb and quota, workspace search, image thumbnails, open/share files through the session (never a browser), new folder, upload (≤ 64 MiB single, larger through the chunk route with `target=vault`, 1 GB cap, 507 "Vault penuh…" shown), rename, trash (restore, delete forever, empty), share links (members-only `/v/` or public `/s/` if allowed, download on/off, expiry, copy, revoke, views); `/v/<slug>` App Link opens the shared file in the app; `/s/` is never claimed (test pins the manifest) | ff7bee3 |
| 3.7 | Reports (More): Me and My team (hidden for staff on `REPORT_SELF_ONLY`), attendance period 28→27 with prev/next, headline stats with arrows vs last period (good/bad per metric), completed per week, overdue now (opens the task), by project, attendance breakdown, XP with level/streak/penalties (server kinds); team list with search by name/email/team and flags (3+ overdue, late 3+, few reflections), tap → that person's report; `REPORT_OUT_OF_SCOPE` said plainly; `/reports[/<id>]` links | 1cfbca6 |
| 3.8 | Leaderboard (Home quick action, `/leaderboard`): this period's ranking with shared places, you highlighted, tap → profile. Member profile (leaderboard, search members): header, Message (opens/creates the DM), level from the leaderboard, and the **member record** (`/api/members/<id>/record`, scoped like Reports; a 403 leaves those sections out): period prev/next, score worked/working (+surplus), counts, late, day-off and XP lines, streak board (tones, red dot for a deduction), XP log with load older and **BoD remove a deduction** (with note, refund route), requests with reviewer | 7cd5f92 |
| 3.9 | Room Booking (upcoming 14 days / history 30 days, grouped by office day) and Team Calendar (month grid, per-team or all teams merged — the server needs one call per team), both read-only as iOS; Home quick actions and `/room-booking`, `/master-calendar` links open them | 5b9fe27 |
| 3.10 | GIDEON: launcher on Home, history, model tiers (Astra/Luna/Terra/Experimental), questions with an image or a document (≤ 10 MB, the server's extensions), SSE answer parsed (text appended, error sentence, stop at done, bad frames skipped), 180 s read timeout, 413/415 sentences, clear chat. **Through the common client** (headers, cookie, LAN, 426), unlike iOS. The transcript lives in the container, so closing the screen does not lose the answer; wiped on logout | fba39b8 |
| 3.11 | Offline warm-up, DATA + MEDIA (iOS OfflineSync): data pass (today + workspace board/requests for managers, my tasks, projects, XP, my board and requests, my submissions) on sign-in, on foreground when older than 30 min and hourly (WorkManager, any network); media pass (every project's board and tasks, then this period's selfies and task attachments ≤ 40 MB for ≤ 80 tasks per project) every 6 h on unmetered networks unless "files on mobile data" is on; files kept under `cache/offline` keyed by URL (1.5 GB cap, oldest first) and reused by images and file opening; crew board and requests now read through the response cache too. More › **Offline copy** card: when data/files were saved, size, update now, mobile-data toggle. Wiped with the session | fa29801 |

**Phase 3 is complete** (28 Sep 2026). Next: Phase 4 (Control Room).

## Phase 4 (administration), in progress since 28 Sep 2026

| Part | What exists | Commit |
|---|---|---|
| 4.1 | Control Room (More, MANAGER+ only; tabs as iOS, BoD-only ones for BoD/OAA; tabs not built yet open `/admin` on the web). **Users**: role counts as filters, search, A–Z, invite by email with roles strictly below yours, bring in signed-up users (absorbs their personal workspace); **user detail**: role, approver (loop guarded before the server refuses), flexi, location-free, rest days (< 7), work hours (default start/end, overnight ok), memberships, account (name/email/password, only changed keys), remove from workspace, delete account (BoD). **Approval chart**: approvers with their direct reports, the unplaced listed | 7e42359 |
| 4.1b | Users list rows as iOS: Flexi / Mobile / Google (@) badges only when on, "Approver: X" or "Not placed on the Approval Chart" (Staff/Manager only), "N projects · N teams" from one memberships call | this step |
| 4.1c | **Approval chart as a tree** (iOS ApprovalChartView): cards coloured by role (BoD navy, Manager blue, Staff white), hours or Flexi, Mobile icon, report count; branches in columns with connector lines, childless staff stacked in one box; "no approver" tag on a top that is not BoD; not-placed chips; stats strip (have an approver / not placed / at the top); pinch, drag, double-tap zoom, fit to screen; tap any card → choose the approver (self and everyone below excluded, or detach); share as PNG | this step |
| 4.1d | Role acceptance vs iOS (PRD Phase 4): tabs identical (Users/Absensi/Audit/Quests for Manager+, the rest BoD/OAA; Absensi content BoD/OAA). User detail now as iOS: approval, attendance mode, rest days, work hours and account only for BoD/OAA (Managers no longer see them read-only); role, Google, editable memberships and the danger zone only on someone below you (One Above All: anyone) | this step |
| 4.2 | Control Room › **Absensi** (BoD/OAA): calendar month bar, public-holiday allowance (warns at 0) and holidays (add/remove), members list → member settings: day-off allowance per period (override / reset to 4), granted day-offs (grant with date+reason, remove), hours per weekday (whole map replaced, overnight ok, validated), export that member's month (xlsx, share sheet), their reflections. **Offices**: list, active toggle, edit (never the shift), add at my current position, archive. **Reflections** of a person by calendar month with GIDEON day notes, month summary and summarize (long timeout; a 503 is GIDEON's sentence) | 6cc56f9 |
| 4.3 | Control Room › **Audit**: search (debounced), action filters (create/update/delete/login), pages of 50 with load more, grouped by office day (Today/Yesterday), action icons; entry detail: title, who/when, what changed (from → to, set, cleared), details, technical (device, IP, entity, id, metadata JSON) | 8ff15b1 |
| 4.4 | Control Room › **Quests**: active list, create (finish N / clear N overdue / N high-priority / at most N overdue, XP 0–50, optional deadline), delete. **Pengumuman** (BoD): list with read count and repeat window, activate/deactivate, delete, create (title, body, tone, repeat once/+2/+3/+5/+7 days at HH:mm WIB; repeat keys sent only when repeating). **GIDEON** usage (BoD): totals + per person. **App** (BoD): using / not yet / devices, versions split per platform (`versionsByPlatform`), device rows with platform, people not using the app | e5e7c88 |
| 4.5 | Control Room › **Extra day off** (BoD/OAA; server re-checks): period chips (previous/current/next), people picker (search, A–Z, select shown, chosen chips, bounded list), days 1–31, reason 3–200, one confirmation for grant and revoke, result sentence with how many were notified; grants of the period, active first then revoked, revoke | d6a285b |
| 4.6 | **Teams** (as iOS: no list page; reached from a user's memberships). User detail › Teams & projects: direct projects removable (via-team ones not), add to project, add to team (or create one and add), remove from team with the projects lost named, open/manage team. **Team detail**: division (set/clear), divisions manager (create/rename/delete, teams stay), team shift hours (off = hours sent as null, saved once), members (profile, main attendance team, remove, add), linked projects (link/unlink), rename, delete with the numbers said | 06fca43 |
| 4.7 | Tuning Room › **Members** (iOS WorkspaceMembersCard): everyone A–Z with profile link; BoD+ invite by email with a role, change role, remove. Invite result says when the email could not be sent (`emailSent:false`), also in Control Room › Users. **Fix:** role rules now match the server `canAssign` — One Above All may give any role (incl. One Above All), Managers assign nothing (were offered roles the server 403s) | 15e49e7 |
| 4.8 | User detail › **Google Workspace** (BoD, per tier): link an existing account (others' accounts locked and named), unlink (JSON null), create a mailbox (name guessed, editable, domain menu; temporary password shown once, copied as sensitive, no way out but "Copied"; email failure and not-linked said at once). User detail › account: **change photo** (`/api/workspaces/members/{id}/avatar`), new password typed in the clear as iOS. **Gap closed (PRD 3.9, P2):** Tuning Room › **Profile** — photo upload (JPEG, 1024 px) / remove, name, Google Workspace address read-only | 4af03e0 |
| 4.9 | API call-list audit iOS vs Android (PRD acceptance): only gaps were `xp-log` and `upload/folder-icon`. **Member profile** now calls `/api/gamification/xp-log` when the record is 403: its 403 shows "Profile unavailable" (not a colleague), otherwise yourself/BoD see the period ledger (zero rows dropped, reasons mapped to the record's kinds) | 5229718 |
| 4.10 | Projects › folder dialog: **photo icon** (`/api/upload/folder-icon`, JPEG ≤ 1024 px so always under 5 MB) after create/edit; a refused picture keeps the folder and shows why. Closes the call-list audit: every iOS `/api/…` call now has an Android caller except `/api/app/latest` (iOS App Store only; Android uses its own version policy) | 4b50f89 |


Still on the web until built: Phase 3 (chat, Threads, docs/pages, forms, profiles, tickets, Z Vault, reports, leaderboard, GIDEON, Control Room).

## Phase 5 (Berlin, 28 Sep 2026: build now; "close web check-in" is NOT ours — server, after adoption)

| Part | What exists | Commit |
|---|---|---|
| 5.1 | **Home-screen widget** (Glance 1.2, as the iOS AttendanceWidget): small = state (working at <office/place> / done / not checked in / sending), a clock that counts by itself (platform Chronometer, no updates), until-time or "N taps still to send"; medium adds In/Out, time left or "Past 17:00 · check out", and the last 7 days as tone dots (server `history?compact=1`, P/L/I/C/S/D/A colours as iOS). One funnel (`AttendancePresence`): today read, queue size, office-now change; the dots re-fetched on a check-in/out or every 15 min. A snapshot from another day says "Open NEXUS to refresh"; wiped on sign-out. Tap opens Attendance | 1f5e4a3 |
| 5.2 | **LAN upload shortcut**: already there since Phase 1 (`core/net/LanRoute.kt`, the same `lan.nexus.znetworks.id` route as iOS LANRoute). Checked for Phase 5: every upload (task/vault single request, every 16 MiB chunk, avatar, folder icon, chat photo, forms) and every download goes through `ApiClient`'s one OkHttp client with the route interceptor; a request with a body keeps the 60 s timeout on the LAN and is never replayed once it may have left (LanRouteTest). Nothing to build | 6e88d2d |
| 5.3 | **Tablet navigation rail**: from 600 dp wide (tablets, unfolded phones, landscape on large phones) the five tabs move from the bottom bar to a NavigationRail on the left, same items, same back-stack behaviour; phones unchanged. Not seen on a device yet (needs a signed-in session) | 1a548fe |
| 5.4 | **Suspect-record review = Control Room › Fake GPS** (server f7f5f1c, iOS c977091; BoD/OAA tab after Extra day off): period switch (28→27), chips Fake GPS / Worth a look / Reviewed with the server's counts, a card per record (name, date, place, badge; check-in and check-out blocks with selfie, the server's signals in the app's language with the speed kept, offline mark, short address, ±accuracy, Map link), note (≤ 300), "It's fine" for any open record, "Not valid…" only for FAKE with a note of 3+ characters and one confirmation that says what happens (day deleted, TK, −150 XP after day off, person notified); server refusals (422 NOT_PROOF…) shown as sent. FakeGpsTest | 7aa6283, 17f59b4 |
| 5.5 | **Wear OS: NOT built — Berlin's decision (29 Sep): not a Play Store priority.** Background: A Wear OS app is installed on the watch itself, from the Play Store on the watch; a sideloaded phone APK (our only channel, /download/android) cannot carry it, so each watch would need adb over Wi-Fi. Until there is a Play listing (or Berlin wants an adb-installed build for a few people), the watch gets what the phone already posts: ordinary pushes (approvals, reminders) are mirrored by the Wear OS companion. Scope if built: today's status + 7 dots (as the widget) and approvals (as iOS Watch ApprovalsView), session from the phone over the Wear Data Layer | — |
| — | "Close web check-in": not ours (server decision after adoption, Berlin) | — |

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
| B14 | **Fixed** (iOS 91d7e98, crew board freeze panes): (1) a drag over the names, the Score column or the date row now scrolls the board too (outer `scrollable` on the whole grid sharing the day-cell and row scroll states; history/BoardUi.kt `Grid`); (2) **not affected**: rows are a plain Column, never a lazy list inside the two-way scroll, so every row is always drawn. |

## UI vs iOS (Berlin GO, 29 Sep; list in the main session's android-ui/LIST.md, points 1–7)

| Point | Fix | Commit |
|---|---|---|
| 6 (bug) keyboard closed at every letter of the reflection → no check-out; gap above the keyboard | The "keep Check out in sight" bring-into-view scroll reaches nested scroll as *user input* in Compose, so the scroll-to-dismiss closed the keyboard on each keystroke. The keyboard is now put away only by a real finger drag (pointer past touch slop), a tap on empty space, Done or back. The gap: the shell's bar padding is now consumed (`consumeWindowInsets`), so `imePadding` adds only what the keyboard covers beyond the bottom bar — for every screen. Guarded in AttendanceGuardTest. Not yet seen on a device (needs a signed-in session) | 93353d4 |
| 3 language + tab bar | English by default whatever the phone's language (iOS AppLanguage .en); Bahasa Indonesia by choice, kept (`AppLanguage`, applied before the first frame; a choice made in-app before this rule is kept). Tab labels on one line: text shrinks 12→9 sp to fit ("Kotak Masuk"), bar and rail keep their height. AppLanguageTest. The Tuning Room style for Language/Appearance/Logout/Delete comes with point 2 | f6b85e1 |
| 7 back animation zoomed | Explicit iOS push/pop on the NavHost: in from the right (the screen below drifts left), back = out to the right with the one below returning from the left, 300 ms; the predictive back gesture drives that same pop instead of the default scale; tab to tab without animation (ShellMotionTest) | 47fb693 |
| 1 attendance hero | One hero as iOS: 360 dp map with the purple time card floating on its top (12 dp inset, #c4b5fd→#7c3aed, soft violet shadow), short date "Sel, 29 Sep", clock 46 sp bold, shift chip, IN/OUT bold; status chip ("Currently clocked-in") and the location-free chip on the map's bottom left, recenter button bottom right; the map drawn 180 dp taller and pushed down 90 dp (iOS pinDrop) so the dot lands below the card. Card order below it as iOS (reflection, Reflections, the button, metrics) | 87f9a26 |
| 5 Home stat cards | No bottom sheet: the detail grows out of the tapped card as iOS MorphFlip — drawn full size in the middle, a scale+translate starts it exactly on the card and springs to full (response 0.4, damping 0.84), one gradient top to bottom, no scrim, list fading in once landed; tap outside, × or back shrinks it back into the card. Card rects kept outside state (no recomposition while scrolling) | 2bc7765 |
| 2 More grid | As iOS MoreView: centred "More", sections HOME BASE (Messages, Threads*, My Submissions, Team Calendar, Room Booking) · MISSIONS (Leaderboard, Reports) · KNOWLEDGE (Z Vault*, Forms) · PULSE CHECK (Attendance) · SYSTEM (Ticket, What's new, Tuning Room, Control Room†), two columns, white 18 dp tiles with a 46 dp icon square in the iOS tint at 14%; account card (photo, name, email → Tuning Room) and a red Logout under it (*company only, †MANAGER+). New Forms screen (iOS FormsView: every project's forms, card with project, Public chip, description, count; empty state as iOS). Tuning Room (was "Account & sign-in") now holds, in iOS order: update row, profile, email, Appearance (3 buttons), Language (flag rows with a check), Offline, Members, password, passkeys, Logout, Delete account set apart with a red border, footer with the version. Knowledge Library left More as on iOS (still reached from links). Logout from both places goes through one `rememberLogout` (confirm + workday block) | 4db6233 |
| 4 My Submissions kanban | As iOS SubmissionsView: centred title, "🔒 Read-only — status is set by the Finance team" chip, horizontal board snapping to each column (width min(320 dp, 82%)), columns New (nothing processed yet) + the server's `statusColumns` + any status the server did not list (so nothing disappears; iOS drops those), tinted like iOS (done/paid green, progress blue, rejected red, else grey, 8% fill, 30% border), count capsule, each column scrolling on its own, dashed "Empty"; card = violet doc icon, the item's own title (`taskTitle`, not the form's name), "form · project", "Submitted 20 Sep, 19:14" (WIB), chevron → detail. Empty board: iOS text + "Open forms". SubmissionBoardTest. Checked on the emulator with a debug-only preview activity (src/debug `UiPreviewActivity`, not in release): More grid, Tuning Room and the board render as the iOS screenshots | this step |

## 8 Oct, group chat admins + Restore in Audit (agents:~/handoff/chat/ANDROID-GROUP-ADMINS.md, ANDROID-RESTORE.md)

NOT published (decision 13). Server: group admins nexus 56e25ff (deploy by the lead), restore LIVE (nexus-prod 5017bf7).
iOS references 1e9190f, ba38cf4. POST /api/audit/{id}/restore was never called on production: checked with JSON
fixtures in JUnit and a debug preview only.

| Part | What changed | Commit |
|---|---|---|
| Group members, Manager and above | `Conversation.canManageMembers` (null = old server, today's behaviour). New **Add people** in the thread header (iOS parity, a dialog not a bottom sheet): a project room adds to the project ("joins the project itself" hint, seat follows when they open the app), a GROUP adds to the room and shows only when `canManageMembers != false`, a DM never. 403 `MANAGER_REQUIRED` (recognised by code; other 403s unchanged) shows "Only managers and above can add or remove members." / "Hanya manager ke atas…", hides the button and refetches the conversation. Remove-member and leave-group UI not built (neither web nor iOS has them) (ChatGroupAdminsTest) | d46a9e1 |
| Restore in Control Room › Audit | List: delete rows with `restore` get an outlined pill ↺ Restorable (violet) / ✓ Restored (muted); filter chip Restore between Delete and Login; action restore = ↺ in green. Entry, under the header: "Bring it back" card with the explanation (backup of {when, WIB} or as when deleted; "226 tasks, 7 lists and 155 files", subtasks for a task, joined with and/dan), the folder note for projects, error in red, full-width 48 dp "Restore project/task" (spinner + Restoring…) → confirm "Restore “{name}”?" / Yes, restore. After: "Restored. It's back where it was." / "Restored by {name} · {time}" + Open project/task; the list behind reloads. Errors per code (ALREADY_RESTORED, ALREADY_EXISTS, PARENT_MISSING, NOT_RESTORABLE, else "Couldn't restore it…"), the entry reloads first. Old delete of a project/task without `restore`: the "deleted before NEXUS kept…" note. Old server: nothing new shows (AuditRestoreTest) | this step |
| Screens | Debug preview `--es screen restore` (checked on the phone, dark) and `addpeople` (phone, light); the other two shots were cut off by the emulator's system_server dying (DeadSystemException, low RAM on agents), not the app | 72e03e6 |

## 8 Oct, attendance + navbar + chat (agents:~/handoff/chat/ANDROID-8OKT.md, CHAT-CONTRACT.md)

NOT published (decision 13). The server is being built in parallel: every new field is optional and each
call has an old-server fallback (noted per row).

| Part | What changed | Commit |
|---|---|---|
| A1 auto check-out off | Remote flag `outsideAutoCheckout` (default **false**): no countdown anywhere (notification chronometer counts up from "outside since", wording without "auto check-out at"), the 1 h 30 reminder and the 2 h heads-up stay with plain wording ("Sudah 2 jam di luar kantor. Ajukan izin…"). Flag true = the old 2 h 30 behaviour (OutsideClockTest) | 9661536 |
| A2 crew board, outside now | `HistoryRow.outsideSince`: today's cell for someone checked in, not checked out and outside shows an amber circle with a walking figure + amber border; TalkBack "Name, Outside the office since 10:12"; legend "Sedang di luar". Board reloads every 60 s only while visible and resumed. Old server (no field) = board as before (BoardModelTest) | 5fba9c4 |
| A3 push `attendance_outside_approver` | Approvals channel; Inbox row with a walking-figure icon on amber; tap opens the board as the other attendance pushes (ChannelTest) | c8b81a7 |
| C chat P0 | MessagingStyle, one notification per conversation (id from the conversation) + group summary; mentions on their own HIGH channel `chat_mentions`; image-only = "📷 Foto". No notification for the conversation open on screen; opening it clears its card; tapping a push for the open conversation does not stack a second thread. Thread polls `after=` only while visible and resumed (5 s), merges by id (never drops; old server ignoring `after` = same merge, a full page triggers backfill via `before`); "load older" via `nextCursor`/`before`; mark read with `upToMessageId` only while visible (no background mark-read). Links tappable (LinkAnnotation) + Copy. Mute 8 h / 1 week / always / unmute via PATCH `/mute`; a 404 hides the option with a notice. Unread from `/api/conversations/unread`, falling back to the list's sum of unmuted conversations; muted conversations get a grey pill and a bell-off icon (ChatReadyTest) | 8d5d56d |
| B navbar | Home · Tasks · **Calendar** · Projects · More; with `flags.calendar` off Inbox takes the slot back. Inbox moved into More (first tile, with its unread badge) and the More tab carries that badge; Inbox deep links/pushes push the screen when it has no tab. Messages tile (More) and Home's chat action show the chat unread (ShellMotionTest) | 6375687 |
| Screens | Debug preview `--es screen nav8` (bars, board cell, inbox row, conversations, link, More with badges), phone light + dark, 10.1" tablet dark (tablet light never drew: the emulator showed black even on the launcher); chat list time at the row end, muted pill readable in dark | b379cb0 |

## 8 Oct, Calendar — audit round 3, the remaining 8 findings (agents:~/handoff/calendar/AUDIT3-android.md)

NOT published (decision 13).

| # | What changed | Commit |
|---|---|---|
| 1 | The period ("October 2026", "14–20 Sep 2026") may wrap and is never cut; under 380 dp inner width or above 1.15× font the Month|People switch takes its own row | 3af6e06 + this step |
| 2 | People headers: the unit's own name first (two lines at most), the line above it under (start-ellipsis); the dot key wraps (FlowRow); preview labels grow past 84 dp; initials are sized in dp with their circle | 3af6e06 |
| 3 | Calendar text uses `CalType` roles from NexusTypography (Inter body / Plus Jakarta titles, matching line heights, no inherited 24 sp line or 0.5 sp tracking); `MicroLabel` is Inter | 3af6e06 |
| 4 | Landscape phones: one control row (‹ period › · switch · scope menu), 40 dp cells, so more weeks show; the filters side panel has no "Show N tasks" (results are live); tablet People person column = 20 % of the width (140–260 dp) | 3af6e06 |
| 5 | Quadrant widgets: `WidgetFit` counts a two-line title ("Penting dan mendesak") and reserves the "+N" row only when rows don't all fit, so "+N lagi" always shows (tested) | 74f113d |
| 6 | Month|People switch: the selected one shows a check in place of its icon (first try used the M3 icon slot, which stays empty without a label — caught on the emulator, fixed) | 3af6e06 + this step |
| 7 | Project colours at night in the app (task rows, filters, quadrant list) go through `NightHues` (moved to ui/theme, shared with the widgets) | 3af6e06 |
| 8 | Widget list rows 44 dp, "+N" a full-width 48 dp row | 74f113d |

Screens: `agents:/tmp/a3-after` — phone light/dark, 360 dp, font 1.3× and 2×, landscape (914×411 dp), 10.1" tablet at 1280/960/600 dp, widgets ID/EN light/dark.

## 8 Oct, Calendar — audit round 3: three bugs

NOT published (decision 13).

| Bug | Fix | Commit |
|---|---|---|
| P1 widget dots grids (3×3 month, mini month) lost every dot/check at font 1.3× and up, and showed half marks at 1.0× | Rows share the grid by weight; each dots cell has a fixed 7 dp mark strip and the day number takes the rest, its size worked out from the widget size × the font scale (capped), so the marks are never clipped | this step |
| P2 Today, or a second tap on the selected day, did nothing | `RevealDay` read `dayRequests` from the remembered screen handle (not keyed on it): now passed straight from the live state; `CalState.withDay` counts a request even for the same day (JVM test `todayOnTodayStillReveals`) | this step |
| Rule 10.31 check too thin (~0.67 dp) | Own vector `ic_cal_check`: a 1.5 dp stroked check with round caps in a 10 dp box, small on screen (10 dp grid, 7 dp widget, 12 dp legend) | this step |

Emulator: `agents:/tmp/a3` (widgets ID/EN, light/dark, font 1.0/1.3/2.0; month and person grids).

## 8 Oct, Calendar — rule 10.31 changed (Berlin): month marks (web 59eae9d, iOS 7648528)

NOT published (decision 13). Month grid: a full dot = something still to do; all done / no status = a small CHECK in the division's colour, the size of a dot (no ring any more). Legend: check + "done / no status" / "selesai / tanpa status". Widgets (3×3 month, mini month): done or status-less tasks drawn as a small tinted check (vector `ic_cal_check`) instead of a faded dot. Task lists keep their status icons (same as My Mission). CalendarAuditTest `monthMarksFollowRule1031`. Emulator: `agents:/tmp/a1031` (month light/dark, widgets ID/EN light/dark).

## 7 Oct, Calendar — "impeccable" round 2 (agents:~/handoff/calendar/AUDIT2-android.md, 28 findings; contract AUDIT2-CONTRACT.md)

NOT published (decision 13). Owner data (Bagan colours, names, tasks) untouched. Glyph meaning NOT changed (rule 10.31, contract 5): the month legend stays visible on the phone.

| Area | What changed (finding numbers) | Commit |
|---|---|---|
| Theme | M3 text-bearing roles from text tokens: primary = violetText (dark #B3A6FF with dark ink), error = dangerText with onError, outline = a new `boundary` token (≥ 3:1 on bg, card and the switch track) while dividers keep `border` — TextButtons, the filter badge, filled buttons, OFF switches, text fields and segmented borders pass in both themes; EmptyState's button uses the role (#2, #8). Selected segment: M3 check back + `segmentActive` container + violet border (#9). Widget fallback colours and avatar ink from tokens (#23). ThemeContrastTest checks every pair | dd8b3d3 |
| Contract | "Focus on {unit}" / "Fokus ke {unit}" (AssistChip with the focus icon; leaf divisions stay FilterChips), "All divisions" / "Semua divisi", the contract's legend hint; zoom/perbesar keys removed (#14, contract 1). Scope = a view: not counted, Reset keeps it, shown once (not in Filters) (contract 2). My division without a Bagan card → Mine + note, on screen and from widget links, never saved as My division (#15, contract 3). Viewer first + You/Kamu kept (contract 4). One `MicroLabel` style for uppercase labels (contract 6). "Open my tasks" / "Buka tugasku", "…in the Tasks tab" (#24) | f35afe5 |
| Screen | Expanded: no third pane below 1200 dp — Filters take the day pane's place (grid ǀ filters); from 1200 dp grid ǀ day ǀ filters; widths from what is left (#1). Landscape phones (≥ 600 wide, < 480 tall) get grid ǀ day (#7). A day asked for (cell, Today, day arrows) and the first open on today scroll the day header in (phone) or the day pane to its top (tablet), then move focus there so the live region speaks (#3, #12). Month ǀ People moved into the period row (#12). Hint until focus was used once; dot legend always (#12, contract 5). Active filters as removable chips (#16). Day numbers in a box that grows with the font, trimmed line height; segment labels may wrap (#6). Out-of-month red at 0.8 (#19). Medium cap 680 dp, so titles show on portrait tablets (#20). 304 polls: no disk write, no new state; the screen handle is remembered (#21). Rail rows are lazy items (#22). Deleted task → "This task was deleted or moved…" dialog; offline → snackbar with Retry; looked up after the cache (#25). Runs of masked rows → "4 internal tasks · 16.00 · Haykal, …"; the reason in a snackbar, not a dialog (#26) | cddbf5c |
| People, Filters, list, logos | People: unit headers only where people are, with the path "Framework Agency › Project Management" (#12); tablet task lines 48 dp with status and action (#4). Filters: selected people/projects stay listed (pinned), loading note, no CTA over the keyboard (#16, #7). Quadrant list starts from the widget's snapshot (works offline), EmptyState with "Open Calendar", opens tasks directly so Back returns to it (#17). Bagan logos decoded to ≤ 256 px into a 4 MB thread-safe LRU (#11) | ab844ce |
| Widgets | Night colours: the Bagan's colorDark for unit colours (from the Calendar's cached structure), else lightened to 3:1 on a dark surface (WidgetHuesTest) (#10). Dots grids (3×3 month, mini month) are one target opening today; per-day taps only where cells are large; "+N more" full-width targets; the 10 sp footer is no longer a link (#5). Day numbers without a fixed box, one line (#6). appWidgetBackground + the system corner radius on 12+, a rounded drawable below; attendance widget too (#27). Quadrant titles on two lines ("Penting dan mendesak" fits 2×2); "Hari ke-279 tahun ini · 76%", hidden in the dots size (#28) | 5e8db8c |
| Large fonts (found on the emulator) | Segment and weekday labels stay on one line and shrink (no "Everyon/e", "MO/N"); widget text follows the system size up to 1.3× (fixed cells), row counts grow with it | c749b0d, df7523f |
| Evidence | Debug preview keeps the shell's 80 dp NavigationBar (phone) / NavigationRail (tablet) space (#18). Real tablet AVD `nexustab` (10.1", 1280×800 dp), also at 960×600 and 600×960 dp; phone light/dark, font scale 1.3 and 2.0, landscape; widgets ID/EN light/dark: `agents:/tmp/a2-after` | this step |

Tests: ThemeContrastTest, CalendarAuditTest (scope not counted, Focus wording, no zoom keys, no duplicate keys, masked runs, People headers), WidgetHuesTest, CalendarWidgetLinksTest (+ background element, no fixed number box), CalendarLinkTest. Not verified on a real phone: TalkBack speech, the system corner radius on a real launcher, a real Bagan logo set.

## 6 Oct, Calendar — the rest of the "impeccable" audit (agents:~/handoff/calendar/AUDIT-android.md, 46 findings)

NOT published (decision 13). The audit's positives (AUDIT-android-positives.md) are kept: EN/ID parity, sp type, WIB clock, masked rows never leak, ETag polling, owner-checked widget snapshots, redraws at WIB midnight.

| Area | What changed (finding numbers) | Commit |
|---|---|---|
| Theme | NxColors: `navy`/`onNavy` (#1E3A5F light, #9FB6D6 dark, as the Bagan), `dangerText` (#B91C1C light) for red text, `warningBg/Fg`, `onSuccess`; every navy and white literal in the Calendar replaced (#6, #16, #22, #23). M3 scheme: surfaceContainer tiers, primaryContainer, inverseSurface from Nx tokens — no baseline purple on dialogs, the pull disc or switch tracks (#25) | 65e60e4 |
| Controls | Header = back + 18 sp title + Today and Filters (badge count) icon buttons (#45). Month/People, By division/By person and a quick scope switch Everyone · Mine · My division = M3 SingleChoiceSegmentedButtonRow (My division disabled outside the chart) (#3, #4, #31, #33, #39). Legend chips = FilterChip; a unit with children has a chevron and says "Zoom into …", a leaf "Filter by …"; breadcrumb = TextButtons; the hint is shown; Back zooms out; zoom, day, view and lens survive rotation/process death (#32). Period label one line, week "14–20 Sep 2026"; the relative chip sits under the date (#43) | 65e60e4 |
| TalkBack | Day cells: "Saturday, 3 Oct 2026, 12 tasks, 2 overdue, <holiday>", selected, "Show tasks" (#1). Task rows: state (done / no status / overdue / to do) and "Open task" / "Open read-only" / "Why it's locked" (#5). Day header = heading + polite live region; two-pane moves focus to it and each pane is a traversal group (#8). Card headers = heading + Expanded/Collapsed + Expand/Collapse, logo/initial silent (#9). Filters/config rows = one toggle/selectable stop with role (#2, #10). Avatars silent, centred, ink by fill lightness (#15, #22). Tablet People cells named, ≥ 48 dp, empty days not buttons (#7) | 65e60e4 |
| Core flow | A tap on a day scrolls its tasks into view (#29). Masked rows answer with the reason; inside their division's card they read just "Internal task" (#37). Viewer first, tagged You/Kamu, in By person (#33). People: sticky division headers, one flat card per person (#35), a task line opens the task, "+N more" opens in place, the header goes to Month (#34); empty week offers Reset filters / Go to this week (#44). Assignees wrap (FlowRow), never clipped (#36). Division cards show the Bagan logo (#27) | 65e60e4 |
| Not dialogs | Filters are part of the screen (side panel 420 dp when expanded): back arrow, live "Show N tasks" button, LazyColumn (#12, #24, #39). The read-only preview is the route `task-preview/{id}`: back arrow, theme banner, Try again on failure, 640 dp text column (#12, #23, #38). Masked / not found = M3 AlertDialog with Lock / CloudOff (#45) | 65e60e4 |
| Layout | Window size classes: compact < 600 one list; medium one list capped at 640 dp; expanded ≥ 840 (and ≥ 480 tall) grid + day list at 40 % (360–420 dp), wide cells show 2 titles (#11) | 65e60e4 |
| Performance | Derivations split by what they read (index per structure, data per items/filters/focus/range, day per day/lens/collapsed); opening a task, pulling or collapsing rebuilds nothing heavy; colours parsed once; weekRows remembered (#18). Day panel = one lazy item per card header / sub-unit / person / task row (cards drawn in slices); rail capped (#19). Structure + items paint first, /overdue alongside and only when today is in range; last structure and 6 ranges on disk per user (cacheDir/calendar, wiped at sign-out) shown at once with "Updated 14.05 · offline" (#21) | 65e60e4 |
| Widgets | Day/night text colours that pass 4.5:1, hues kept for bars (#17); NEXUS colours on Android 8–11, Material You on 12+ (#26); text ≥ 10 sp, day cells and rows spoken (#14); min resize 250 dp (Month + Coming up, Week), 180 dp (Month) (#13); every link carries `&scope=` and the Calendar applies it (#33); the quadrant header and "+N" open the new in-app list `calendar-list?q=&scope=` (#40); Mendesak / Suatu hari keep their names (Berlin) with the notes "mendesak, bukan prioritas tinggi" / "tidak mendesak, bukan prioritas tinggi", also in the picker descriptions (#41, #42); two-letter weekdays Sn Sl Rb Km Jm Sb Mg (#41); empty = an outcome with the scope (#44); config asks "Tugas siapa?" with the widget's name, EN "Mine" everywhere (#46); picker previews in EN and ID (#42); nothing clipped (week chips by height, "+N" by the number). Fetch only the scopes placed widgets use, nothing when none is placed, no redraw alarm without a widget, updatePeriodMillis 0, sign-out cancels the redraw too (#20) | 32519ba, 749c4fd |
| Fix found on the emulator | Calendar screens had no content colour (dark icons on dark) — now from the theme | 71f44d4 |

Tests: CalendarAuditTest (disk cache per user/range, flat panel keys, collapsed card, viewer first, notices only for the loaded range), CalendarWidgetLinksTest (scope in every link, masked → day, quadrant list, resize/previews/updatePeriod, no widget text under 10 sp), CalendarSnapshotsTest (no widget → no request, only placed scopes kept), LinksTest (scope + quadrant links), AttendanceGuardTest (calendar cache wiped at sign-out). Screenshots before/after on agents: `/tmp/audit-before`, `/tmp/audit-after` (screens, light/dark, tablet), `/tmp/audit-wg` (widgets, ID/EN, light/dark). Not verified on a device with a real account: TalkBack speech itself (semantics checked in code), the picker previews in a real launcher, a widget tap opening the Calendar with its scope.

## 6 Oct, Calendar — audit Impeccable P0 + P1 (iOS fixed with the same rule)

NOT published (decision 13).

| Change | What exists | Commit |
|---|---|---|
| P0: a `task=` link re-opened the task on every return | `CalendarLinkGate`: the last applied link (all args + nonce `n`) is kept in the entry's SavedStateHandle, so recomposition, Back from the task, rotation and process restore never apply it again; Router links carry a fresh `n` so the same link tapped again (widget, notification) still works. Calendar → task navigation is `launchSingleTop`. CalendarLinkTest: deep link task → Back → Calendar stays on top (also after "rotation"), new nonce opens again, source guard on singleTop + gate | this step |
| P1: a month loading or failed said "no tasks" | `CalState.itemsRange` (+ `current`): dots, day cards, counts, "empty month" and People rows only when the loaded range is the one on screen. Otherwise a LinearProgressIndicator under the grid + placeholder cards, or "The calendar could not be loaded. <reason>" + Try again. A failed refresh of data on screen keeps it and shows a snackbar "Couldn't update. Data as of 14.05" (once per failure streak; every pull). Checked on the emulator (debug `cal-loading`, `cal-failed`) | this step |

## 6 Oct, Master Calendar — phase 4, the widgets (spec agents:~/handoff/calendar/SPEC-widgets.md; rules = web client/glance/glance.ts)

NOT published: decision 13 — the APK goes out only after iOS 0.1.7 is approved by the App Store. Release APK built to check it (7 receivers + the config activity, no preview activity); not copied anywhere.

| Change | What exists | Commit |
|---|---|---|
| CalendarGlance.kt | 1:1 port of `glance.ts`, pure Kotlin: wibClock, entryOverdue (date-only after its day, timed from the next minute, > window = stale, done/ns never), compareInDay/compareChrono (titles = `lowercase()` + `compareTo`, no collator), monthView (42 days, Monday first), weekView, upcoming, quadrantOf/quadrants, todayRing, inlineLine, yearProgress, freshness, redrawTimes. CalendarGlanceTest runs the 4 glance fixtures at the 4 moments of glance.test.mjs and equals all **16 golden-glance files** (values and key order), plus the signed-off assertions | 126fc9b |
| Bar.done (spec update, same day) | Golden files re-taken: each bar has `done` = done && !ns. ✓ only for ticked-done tasks; a calendar-only project stays faded (dim) without ✓. Test `tickOnlyForDoneNotForCalendarOnlyProjects` | 6ff2fd3 |
| Snapshots + fetching | `widget/CalendarSnapshots.kt`: `/api/calendar/glance` for me/division/all, one private file each (`files/calendar-glance/*.json`: snapshot + savedAt + userId, tmp + rename). Never saves a snapshot whose userId is not the signed-in person's (also checked after the request); `load` re-checks the owner on every read. Fetched: hourly by `CalendarGlanceWorker` (WorkManager, network, skipped when no calendar widget is placed), on foreground, after the Calendar screen loads, when a widget is placed or configured (5-min throttle), and right after sign-in (forced). Sign-out (deliberate or expired): files deleted at once, worker cancelled, every widget redrawn. `flags.calendarWidgets` false → deleted, widgets say "Open NEXUS"; back on → fetched again. `CalendarRedrawWorker` redraws at the next `redrawTimes` moment (at the latest WIB midnight) and books the one after; a language change redraws too. CalendarSnapshotsTest (3 scopes, other person, sign-out mid-request, wipe, flag off, throttle, next redraw) | 9ba1943 |
| 7 Glance widgets | **Kalender Bulan** (resizable; Exact size: < 250 dp dots, < 320×340 bars + "+N" by the number, larger bars with titles; header month + "Hari ke-279 · 76%"; today circled, Sunday/holiday red, outside the month faded, red mark = overdue ≤ 14 days), **Bulan + Tidak lama lagi** 4×2 (mini month with dots, up to 4 upcoming as fit + "+N lagi"), **Minggu Ini** 4×2 (7 columns, ≤ 3 bars with titles, today highlighted), **Penting dan mendesak / Penting / Mendesak / Suatu hari** (one widget per list, red/indigo/amber/grey, count, rows "Hari ini 19.00"/"Besok"/"Kam 8"/"Tanpa tenggat" + project when wide, overdue red, "+N lagi"). Config activity per widget: Saya / Divisi saya / Semua (default Saya; Android 12+ optional, reconfigurable). Footer "Saya · Diperbarui 14.05", stale "Buka NEXUS untuk memperbarui"; signed out "Buka NEXUS untuk masuk"; access none/off "Kalender belum aktif untuk akunmu". Masked rows "Tugas internal", never the project. Taps: day → `/calendar?date=`, task → `/calendar?date=&task=` (opens as the Calendar does), masked → the day, undated → the task. System colours (GlanceTheme), the app's language (not the phone's). 35 strings EN + ID, no duplicate keys | 9ba1943 + this step |
| Debug widget preview | `src/debug/WidgetPreviewActivity`: hosts the real widgets (AppWidgetHost, `appwidget grantbind`) at launcher sizes with the web's fixtures. Screenshots on the emulator: every widget and size, ID and EN, light and dark (16 shots, `/tmp/shots-wg` on agents). One FATAL in the first shot run (`ConfigurationController.updateLocaleListFromAppContext` NPE during a process start, no app frame in the stack); not reproduced in a repeat run (install, mode switch, 3 preview launches) | this step |

Not verified: a real signed-in fetch and sign-out on a phone (needs a staff account on the device; covered by CalendarSnapshotsTest), the placement flow in a real launcher, lock-screen widgets (skipped per plan 4.2).

## 6 Oct, Master Calendar — phase 3, the screens (web reference d867ae2 + aa9ecdc; spec agents:~/handoff/calendar/SPEC-client.md)

NOT published: decision 13 — the APK goes out only after iOS 0.1.7 is approved by the App Store.

| Change | What exists | Commit |
|---|---|---|
| CalendarCore.kt | 1:1 port of the web's client `core.ts` (indexStructure, bucketOf, filterItems, underFocus, dayCell, legend, dayTree per division / per person, personOrder, weekRows incl. "unplaced", overdueState none/recent/stale, overdueRail, monthGrid/gridRange/shiftMonth, compareInDay), pure Kotlin. CalendarCoreTest runs it on the server golden at now 2026-10-05T05:00Z / window 14 and equals all 12 web golden-client files (cell, legend, tree brief, week, overdue), plus A2/A3/A5, unplaced rows, no-PIC → project's division, overdue window, filters, month grid, rail | b00bc60 |
| Calendar screens | `feature/calendar/`: CalendarViewModel (structure + items for the grid or the week + overdue, ETag polling every `calendarPollSeconds` while resumed, on show/foreground/pull-to-refresh; refetches structure on a new `structureVersion`; filters and collapsed sections remembered per device; open rule: `canEdit && editProjectId == project.id` → task screen, else read-only preview, masked never; unknown id → `/api/calendar/task`). **Phone**: one LazyColumn — ‹ Month ›, Today, Month/People, Filters (count) → unit chips (tap = zoom into a unit with children, else toggle it as a filter; breadcrumb All › …) → 6×7 grid (Monday first, dots max 3 + "+", filled/ring, red 2 dp bar = overdue ≤ 14 days, holidays red, today filled, selected framed) → day header (Today/Tomorrow/Yesterday, ‹ ›, "N tasks · N people") + By division / By person → overdue rail (today) → division cards (colour bar, initial, name, count, "You", collapsible) with sub-units and group ribbons; person lens: people rows ("also in …"), tasks without a person under the unit, "Not in the chart yet" last; unique total note. **Tablet ≥ 600 dp**: grid | day list 360 dp. **People**: phone per division › person with up to 3 tasks ("Fri 18 · title") + "+N more" and a week strip; tablet week table (name + 7 days, 2 chips + "+N"); a tap goes to Month on that day, person lens. **Task row** as specified (glyphs, struck-through done, grey stale, WIB time "19.00"/"19:00", project + "+N project", URGENT/HIGH, Overdue / "Overdue for more than 14 days", "↳ from", people here then "with Name (Unit)"; masked = lock + "Internal task · <division>", not clickable). **Filters** full screen (Everyone/Mine/My division — off when not in the chart; divisions tree; people/projects search; priority; hide done; only overdue; Reset). **Read-only preview** full screen (banner "Read only · you are not a member of <project>", status, due WIB, priority, project, people, description, subtasks, comments). States: skeleton, error + Try again, access none / off, empty month / filters / day, truncated. Entry: More tile and Home shortcut "Calendar" (hidden when `flags.calendar` is false); route `calendar?date&view&lens&focus&scope&task`, `team-calendar` alias; links `/calendar?…` and `/master-calendar` (`?booking=` → Room booking). Old Team Calendar screen and its API removed; the "+ Team" chip removed (POST /api/teams → 410). ~110 strings EN + ID from the web dictionary, no duplicate keys. No ModalBottomSheet. Checked on the emulator with the golden data (debug preview): month (3 Oct, staff, Finance masked), person lens (18 Sep), People week, filters, tablet landscape | 0e7acb3 |

## 5 Oct evening, Master Calendar — revised decisions (spec REVISED, nexus 6a586af)

Android release of the Calendar waits for iOS 0.1.7's App Store approval; audience is everyone.

| Change | What exists | Commit |
|---|---|---|
| Model follows the revision | `CalPerson.titles` removed (structure no longer sends job titles); `CalItem.placement` from the new `placedBy` ("pic" / "project": no PIC in the Bagan → under the project's division, out-of-Bagan PICs as userIds, maybe none; unknown reads as pic); no "No PIC yet" section and no "Abandoned" list (`hasNoPic`, strings `calendar_no_pic` / `calendar_abandoned` removed — overdue past 14 days stays on its date, grey, a screen rule for later). Golden files replaced (+ `project-divisions.json`). Tests: 18 Sep = 8 with FA 4 (PM 1, Event 1, Multimedia 3), PATS 4 (3 placed by project in PATS Entertainment), Suwara 1, Fortunatus (a member with no Bagan card) not in the chart; every project-placed task sits on its project's division from `project-divisions.json`; structure has no `titles`; 3 Oct and masking unchanged | b8febb5 |

## 5 Oct, Master Calendar — API + model layer only (server LIVE nexus 70f0d67; spec agents:~/handoff/calendar/SPEC-server.md)

No screen yet (design, client rules — dots, counts, trees, quadrants — and their golden files come after the web's phase 2). No build.

| Change | What exists | Commit |
|---|---|---|
| Calendar API + models | `feature/calendar/`: **CalendarModels.kt** — `CalStructure` (units with rank/depth/sectionId/colours, people with homeUnitIds/titles/reportsTo, me), `CalItems` (items, extra people, holidays, rules, structureVersion, truncated; server `today`/`now`), `CalItem` (masked rows: no id/title/project/priority/parent, `x_` key, `openable` false), `CalGlance` + `GlanceEntry`, `CalAccess` none/off/all/all_except_private (unknown → off), `CalDays` (day keys only — never cut from an ISO instant; the server's overdue rule: date-only day < today, timed due < now, never for done/noStatus). **CalendarApi.kt** — structure, items(from,to ≤ 62 days, checked before asking), overdue, glance(me/division/all); every call sends the held ETag as If-None-Match and a 304 hands back what is held (`Fetched.changed` false); cleared at sign-out. **ApiClient.getConditional** (the repo uses OkHttp + kotlinx.serialization, not Retrofit). RemoteConfig: `flags.calendar`, `flags.calendarWidgets`, `values.calendarPollSeconds` (server defaults true/true/60). Strings EN + ID: config fallbacks `calendar.none/off/empty.*`, masked "Internal task (· division)", "Not in the chart yet", "No PIC yet", "Abandoned", "Someday". **CalendarApiTest** on the golden files (test/resources/calendar): structure in Bagan order, staff 3 Oct = 4 Finance tasks masked (BoD 0), 17:00Z rows on the server's next WIB day, 18 Sep = 8 tasks with FA 4 (PM 1, Event 1, Multimedia 3), PATS 1, Suwara 1, not in chart 1, no PIC 3; 3 Oct sections Finance & Tech, Framework Agency, PATS, Suwara; overdue rule; access none/off envelopes; ETag/304 over MockWebServer; range errors | 2e71b1b |

## 5 Oct, Bagan IP & Divisi in English and Indonesian (→ build 13)

| Change | What exists | Commit |
|---|---|---|
| Every org-chart text in strings.xml (Berlin: English AND Indonesian) | 106 `oc_*` keys (8 of them plurals so English counts read "1 person / 2 people"): English in `values` as the source, Indonesian in `values-in` with the words build 12 used; covers the header, stats, Ringkas/Lengkap chips (EN "Summary"/"Full"), card lines, people-box labels, the edit/add sheet, the place picker, the person sheet, the delete confirm, toasts and error messages, and the Control Room entry. The model no longer builds sentences: `CardInfo` carries counts and `boxLabel()` a `BoxLabel`, worded by the screen. Unit and people names stay as they are. No duplicate keys in either file; every `oc_*` key in both. AttendanceGuardTest `orgChartTextComesFromResources` fails on a hard-coded text in feature/admin/orgchart. Checked in English on the emulator | 5bb061d |

## 5 Oct, Bagan IP & Divisi (→ build 12; server LIVE, web final 070c9f8, spec ~/refs/org-chart/SPEC.md)

| Change | What exists | Commit |
|---|---|---|
| Bagan IP & Divisi replaces Teams in Control Room | `feature/admin/orgchart/`: **OrgChartLayout.kt** = 1:1 port of the web's `org-chart-layout.ts` (tidyLayout, applyManual, nearestFree, route + A* maze, separateLines, alignRows, pathRounded, routeAll; JS rounding kept); **OrgChartModel.kt** = the component's pure parts (groupUnit, stack/row incl. groups side by side and the staff box never between groups, effective parent through groups, led sub-units, "di bawah" boxes, buildEdges with leader tracks and the stem through a gap, Ringkas/per-IP/Lengkap, card tones and Ringkas meta "N orang · M bagian" + faces); **OrgChartScreen.kt** = elements measured in an unseen tray (people boxes laid out by hand so each leader chip's spot is known), the same engine places them, lines drawn under the cards (1.5 dp, rounded 8, #b4c1d3 / dark #3e4c61); pinch zoom + pan with inertia, "Pas layar"; view chips remembered per device, breadcrumb; "Belum ditaruh" list. **Sheets** (BoD/OAA; Managers read-only, a tap opens the part instead): Ubah/Tambah kartu (Jenis cards + "Contoh di bagan", Nama, Logo for IP ≤ 2 MB, a new IP's logo after creating, Letaknya with a searchable indented picker + "Paling atas", Dipimpin oleh chips, Orang di kartu ini with Jabatan and Di bawah, Hapus with a centred confirm, Tambah di bawahnya, Lihat isinya); person sheet (Di bawah siapa — adds to that card first if needed — and the IP/Team checklist). Web's Indonesian copy. Positions (layoutX/Y, boxLayout, /layout) are read in Lengkap and never written (OrgChartApi has no way to; AttendanceGuardTest `orgChartNeverWritesPositions`). Entry: Control Room › Users › "Bagan IP & Divisi"; old team links open it. **Tests on the real chart** (fixture = the GET's exact query on 5 Oct, e-mails replaced, no avatars, `test/resources/org-chart-2026-10-05.json`): 0 overlapping legs between different lines and 0 crossings in Ringkas and every per-IP view at two size scales, PATS' row = Community, Outlet, PATS Entertainment, PATS Archive (rowOf and drawn order), Ringkas content, Lengkap saved places; the checkers proven on bad lines. Checked on the emulator (debug preview with the fixture): Ringkas, PATS, Lengkap, the edit sheet, the person sheet. OrgChartLayoutTest | this step |

## 29 Sep, pinned projects sync (→ build 11; server LIVE, iOS 286cada)

| Change | What exists | Commit |
|---|---|---|
| Pinned projects on the server | `ProjectShortcuts` keeps pins in `/api/projects/pins` (GET `{projectIds}` newest first, POST `{projectId, pinned}`), the same list as the web sidebar. Pin/unpin from Home (pin button) and from the Projects list (long-press menu: Pin/Unpin above "Move to"): changed at once, then sent; a refusal puts it back. Sync on sign-in, at launch and on every return to the app: the server's order, only projects in `/api/projects` (names from there; the last known names if that list can't be read). Pins made on this phone before (local) are sent up once per person. Home shows "Pinned" then "Recent"; Projects shows a "Pinned" section above all projects. Recents stay on the phone. ProjectPinsTest | 36fc55c |

## 29 Sep, 0.1.6 final (→ build 10; server LIVE, iOS 22c4ecb)

| Change | What exists | Commit |
|---|---|---|
| Sick note required for everyone filing their own | `RequestRules.attachmentRequired`: SICK always (BoD too; this composer only files for the signed-in person), PERMIT still self-filed only; the label says "required" and Send stays off until a photo/PDF is attached. RequestRulesTest `sickNoteRequiredForBoDToo` | ec96df9 |
| Annual leave as a RANGE (Berlin revision, iOS ed7545e; replaces the several-dates version 5aa66d1) | LEAVE picks one range with Material's `DateRangePicker` (tap the first day, then the last; days before today greyed), shown as "29 Sep – 4 Oct · 6 of 12 days"; a range longer than the days left is not taken ("That's N days — only M left."); sent as ONE request startDate..endDate. Checked on the emulator. LeaveRangeTest | 29d540d |
| No past day for any type, photo for sick AND permit — BoD included (revision; server BACKDATED_SELF) | `earliest()` = today for every type and everyone filing their own (date pickers start at today; "A request can't be for a day that has passed… a past day is filed by a BoD"); `attachmentRequired` = SICK or PERMIT for everyone; only the permit's location is still skipped for a BoD. Sick hint: "One day per request, today or later, with a photo of the doctor's note. A past day is filed by a BoD." RequestRulesTest `noPastDayForAnyType`, `photoRequiredForBoDToo`, `bodOnlySkipsThePermitLocation` | 29d540d |
| Always-location gate, final scan | The button now always tries the system request first: with precise granted, Android 11+ opens the app's own **Location permission** screen ("Allow all the time" + "Use precise location") — checked on the emulator (API 34). Only when Android refuses without asking (refused for good: answered in < 400 ms, or no rationale left) is App info opened, the one screen Android lets an app open for that — also checked. Title, text and button come from remote config `location.always.*` (the Android copy now names "Allow all the time" / "Use precise location"); the old ask-once bookkeeping is gone | e6cb87f |
| What's New 0.1.6 | One-line entry "Annual leave: pick a range of dates at once, up to the days you have left" (ID: "Cuti: pilih rentang tanggal sekaligus, sebanyak sisa jatahmu"), as iOS's `.also` line (worded for the range; iOS still says "several dates"). Seen-once is keyed by versionName, so a phone that already saw 0.1.6's sheet does not see it again. WhatsNewTest | this step |

## 29 Sep, after build 8 (→ build 9)

| Change | What exists | Commit |
|---|---|---|
| Control Room › App: every device per person (server LIVE, iOS 7920142) | `installs[].devices[]` read; under each name one line per device: iPhone/Android icon, OS (+ model, last seen), version chip "0.1.6 (8)" or "Not reported"; an older server without `devices` falls back to the row's own device. AdminMoreTest `installsListEveryDevice` | e8b59b9 |
| Confirmations as centred dialogs (Berlin, iOS 173ffff) | Checked every confirmation: extra day off (give/revoke), make TK, change status (board), revoke passkey, delete task/post/folder/vault item/attachment, empty trash, delete account were already plain `AlertDialog`s in the middle (Android has no popover confirmations; the 3 bottom sheets are content, not confirmations). What was missing: 5 red menu actions ran straight from the menu with no confirmation — remove from workspace (Members), remove from team, delete division, remove from project, revoke a vault share link. Each now asks in a centred `ConfirmDialog`. AttendanceGuardTest `destructiveMenuItemsAskInACentredDialog` | 8468e6f |

## Batch 2 (Berlin 29 Sep, into 0.1.6 → build 8; contract in the main session's batch2/CONTRACT.md)

Server routes read from nexus-prod `~/nexus` (e3091ab, cff1575, web 9f9313d); whether they are deployed is the main session's.

| Item | What exists | Commit |
|---|---|---|
| A Absen Monitor (was Fake GPS) | Tab renamed "Absen Monitor" (EN/ID); chips Fake GPS · No face (`counts.noFaceOpen`) · Worth a look · Reviewed; NOFACE badge/side in orange; each side with a selfie shows a face chip ("2 faces" / "no face" / "face: not checked"); the "No face in the selfie" signal translated; "Send warning…" on open and cleared cards (not on TK ones) → dialog prefilled per level and side as the web (editable, 3–500, counter) → `POST /api/attendance/suspects/{id}/warn` (id one encoded segment); warnings history on the card (who, when, message). FakeGpsTest | 9445075 |
| B Control Room keyboard | Every admin text field has a Done key (33 fields; multi-line notes/reasons too, only the announcement body keeps Enter for new lines); every admin screen root (Control Room and its sub-screens) closes the keyboard on a tap on empty space or a finger drag, with the same drag rule as the daily reflection (a bring-into-view scroll never closes it). AttendanceGuardTest `controlRoomKeyboardAlwaysCloses` | 6407216 |
| C Announcements: targeted + SP PDF | Control Room tab "Announcements" (ID "Pengumuman"; "Attendance" tab no longer hard-coded Indonesian). Composer as iOS CreateAnnouncementSheet: full screen, TITLE/BODY/AUDIENCE (Everyone · Selected people: roster search by name/email, A–Z, ≤ 60 rows, check rows, "N selected")/PDF (SP) (pick a PDF → `POST /api/announcements/attachment`, ≤ 10 MB checked before upload, 413/415 said in words; attached = kind "sp")/TONE/REPEAT; Post says why it is off; a refused post stays open with the server's reason. List: SP / Warning badges, the PDF (opens in the viewer), "To: names" or "To everyone". Pop-up: SP = red "WARNING LETTER" eyebrow + SP badge + "Open PDF" (+ file name); warning = amber with the selfie shown whole. In-app PDF viewer (`PdfViewerDialog`: downloaded with the session into the shared cache that sign-out empties, pages drawn with PdfRenderer, "Open in another app"). AnnouncementBatch2Test; composer, SP pop-up and PDF pages checked on the emulator (debug preview) | 5d5447a |

## 29 Sep (Berlin, into 0.1.6; iOS f068bbf)

| Change | What exists | Commit |
|---|---|---|
| Update offered by build number (server LIVE: version-policy `android.latestName` + `latestBuild`) | "Update available" (Tuning Room) when latestName > installed versionName, or the same name with latestBuild > installed versionCode (shown "0.1.6 (7)"); `latestName` wins over the old `latest`; unknown running build = no offer. The in-app updater already decides by versionCode from `/api/app/android/release`, so build 7+ installs over build 6 (VersionGateTest `sameNameHigherBuildIsAvailable`) | 516d407 |
| Logout revokes the token on the server | A manual logout (and delete account) sends `POST /api/auth/app-logout` with that session's cookie, fire and forget, after the push device is deleted (it needs the same cookie); the phone signs out at once regardless: offline, a 404 while the route is new, or any error change nothing, and a 401 there never touches the current session (AuthRepositoryTest) | 0fdbdee |
| Email change needs the current password | Account › Email: a required "Current password" field (sign-in button off while empty), help "To make sure this is you. Your old email will be told about this change."; sent as `currentPassword` to `/api/user/email/request`, never trimmed, never kept in restorable state, cleared once the code is sent (AccountApiTest) | 38be2f2 |
| Old tokens get 401 once (server sessionVersion) — checked | Every send path (JSON, text/SSE, downloads) goes through one `classify`: a 401 on a session call ends that session exactly once (not deliberate: no server revoke), concurrent 401s end it once, background jobs cannot crash (appScope handler); queued taps are kept for the same person and replayed after the next sign-in, never under another session. Session storage (Keystore + noBackupFilesDir) unchanged. AuthRepositoryTest, AttendanceQueueTest | c9db448 |
| Z Vault and Threads only for the company workspace (iOS 14b086f) | `Viewer.isCompany` from `/api/workspaces/members` (`isCompany`); the Z Vault row in More and the Threads tile on Home are drawn only when true (hidden while unknown and on older servers); the vault, vault-share (`/v/` links) and threads routes show "Only for Z Networks" when false (the server answers 403 anyway), a spinner while unknown. ViewerTest | 91dded1 |

## Security + parity audit of build 5 (docs/AUDIT.md 266af90): RILIS LAYAK, 8 RENDAH

R2 (restrict the Firebase key) and R5 (server-side logout) are not the Android session's. No new build
until the main session says; build 5 goes out for Berlin to test.

| Finding | Fix | Commit |
|---|---|---|
| R1 session cookie followed a redirect to another host | A network interceptor drops `Cookie` on any hop (redirects included) whose host may not carry the session (ApiClientTest) | c80e21e |
| R3 an id with "/" from a link crashed the app | Every id put into a route from a link or push is `Uri.encode`d (ticket, submission, chat, doc, vault, report, profile, folder, task, project, thread post, form); guarded in AttendanceGuardTest | ec14393, ae5d60b |
| R4 files in cache/shared and cache/evidence survived logout | Both emptied at sign-out with the rest of the session (the offline copy was already); AttendanceGuardTest checks every FileProvider cache path is covered | 7bd6270 |
| R6 "Now at" parity | Shown only when the trail tracks the record on the card (iOS WorkPlace.recordId); the office is read from the freshest clear fix among the latest and the last queued point (iOS latest / lastGood). TrailMachineTest | 1e7d413 |
| R7 Fake GPS review path not encoded | The record id goes in as one encoded path segment (`addPathSegment`), the period query encoded too (FakeGpsTest) | 68358b0 |
| R8 STATUS did not record build 5 | Header: build 5 with its sha256 and the 300 tests it was built with (305 now); "APK ready" names build 5 (566ca4a); Wear OS marked not built | this step |

## Re-audit 28 Sep 2026 evening (docs/AUDIT.md, HEAD 8842c35, "RILIS BELUM LAYAK"): fixes

Server findings (Manager → ADMIN, BoD edits OAA account, Manager removes members) fixed on the server
(c021fda, main session). T1: stays as server + iOS (only APPROVED hides the button).

| Finding | Fix | Commit |
|---|---|---|
| K1 (KRITIS) in-app update always "not a NEXUS build" on Android 9–10 | Archive read with GET_SIGNATURES + GET_SIGNING_CERTIFICATES on API 28–29 (only GET_SIGNING_CERTIFICATES from 30); signers fall back to the legacy field. Flags per SDK pinned in UpdateVerdictTest. Not yet run on an API 28/29 emulator (no image on agents) | 49d791a |
| T3 (TINGGI) update dialog stuck on "Installing…" | The system confirmation is a step of its own (`Confirm`, with the installer's intent): started at once when allowed, else a notification "Finish updating NEXUS" opens it; the dialog shows "Continue installing" (starts it from the app in front) and Cancel. Installing can be cancelled too; cancel/failure abandons the PackageInstaller session. Guarded in AttendanceGuardTest | b99064e |
| T4 (TINGGI) Approval chart editable by Managers, every save 403 | The chart row in Users is drawn for BoD/OAA only (iOS `canManageAttendanceFlags`); the chart itself is read-only below BoD (no picker, hint says only BoD changes approvers) | c8f3a79 |
| T5 (TINGGI) Camera button in the leave/sick form could crash | One camera path for the whole app, `rememberCameraCapture`: CAMERA asked first, launched only when granted; refused (or no camera app) → "Camera is off for NEXUS" with Open Settings, gallery still there. Used by the request form, chat, tickets and task files (those were silent taps). AttendanceGuardTest: `TakePicture(` only in CameraCapture.kt | 4076912 |
| T6 (TINGGI) crew board could show another period's people and Score | Each load cancels the one before (latest request wins); rows and roster carry the period they were fetched for and are drawn only under that period, so while loading the new one the board shows the spinner, and on failure the error, never the old numbers (BoardModelTest) | 8ba3882 |
| S4 (SEDANG) saved copies looked live on the crew board, requests and Reports | Each keeps the cache's `savedAtMillis` and says "Saved copy from HH:mm": under the board's dates (amber, only for this period's rows), above the requests list, under the Reports period bar and at the top of a person's report | 17a8c20 |
| S5 (SEDANG) version lock (versionName) and updater (versionCode) not cross-checked | The updater installs only the announced build (archive versionCode AND versionName = `/api/app/android/release`), else "not the version NEXUS announced" (UpdateVerdictTest). Locked by the floor with nothing newer published: "The version this phone needs isn't published yet" instead of "already the latest". The publish script's own check (env version = current.json) is the main session's | fce1d60 |
| S6 (SEDANG) streak days on the member record not tappable | Each day opens the crew board's own day sheet (details, trail, selfies; for the BoD "Change status", clear check-out, delete), fed by that person's history rows (`history?…&userId=`); rights from `record.viewer.canManageAttendance`; a change reloads the record. Same opening rule as iOS (BoardModelTest) | 1b894d7 |
| S7 (SEDANG) the APK download never really resumed | `download` reports the ETag as soon as the headers arrive and the updater stores it before the bytes, so a cut connection continues with Range + If-Range; a new build meanwhile still replaces the file whole (UpdaterDownloadTest) | 9fefc7e |
| S8 (SEDANG) non-ApiError exceptions in the updater crashed the app | `run()` turns any failure (disk, PackageInstaller, SecurityException) into Failed and abandons the half-done session; a malformed absolute download URL is a failed download; `appScope` has an exception handler (logged, never a crash) | 0197481 |
| S9 (SEDANG) approver picker offered only Managers and up | Everyone but the person, senior roles first (iOS, server); a choice that would close a loop is still disabled (makesCycle) | 2df5852 |
| R8 (RENDAH) remove/re-rank offered where the server refuses | Tuning Room › Members never offers your own row; a BoD peer's rest days are read-only (iOS). Server remove rule now (c021fda): BoD below BoD, OAA anyone but self = `Roles.canEdit` | 65f3b8f |
| R6 (RENDAH) unnamed roster people got the viewer's name | The viewer's name only on the viewer's own row; anyone else without name/email is "—" (BoardModelTest) | fd761d9 |
| R9 (RENDAH) App tab without "Web only · date" / "Never signed in" | Each person not using the app says which, from `lastActiveAt` (iOS 74c6750) | 44cb0c6 |
| R10 (RENDAH) audit entry: old values not struck, no links | "old → new" with the old value struck through; details linked to a task, project or person open it (iOS 3ae2630) | e2f4655 |
| R11 (RENDAH) update deadline not in More | During the grace window More shows "Update NEXUS by <date, time>. After that, this version can't take attendance." with Update, in place of the plain "available" row (iOS UpdateDeadlineRow) | 029cd92 |
| R12 (RENDAH) invite link read as "Reset password" | `/forgot-password?…&invited=1` (https and nexus://) opens the same flow titled "Set your password" (iOS ResetPasswordView); a forgotten password stays "Reset your password" (LinksTest) | 4cc45a4 |
| R7 (RENDAH) member record: requests not tappable; Remove could be sent twice | A request opens in full (status, dates, reason, reviewer and note); a deduction being given back hides its Remove until the answer, so one tap is one request | 186a315 |
| R5 (RENDAH) board period stuck past 00:00 WIB on the 28th | The board checks the period every minute and moves (and reloads) when it turns | this step |
| R13 (RENDAH) cosmetics | Fixed: "Change status" never offered for a future day, row or not. Left as they are (cosmetic, no wrong data): face-check window does not follow the face, no month line on the board, empty cells darker than iOS; key rotation would need `signingCertificateHistory` compared by lineage (no rotation planned); sha256 stays optional as the server sends it | this step |

**New for 0.1.6 (Berlin, 28 Sep; iOS b186172): no sign-out while a workday runs.** Logout in More is
refused while checked in and not checked out (live, or a check-in still queued offline; before today was
read this launch, an active work session counts): "Check out first — You're checked in, so your workday
and live location are still running…", with a button to Attendance. Checked again on the confirmation. A
queued check-out ends the day. A 401 still ends the session. WorkdayRule in PresenceTest; guarded in
AttendanceGuardTest (e0ead22).

**Remote config (Berlin, 28 Sep; iOS RemoteConfig.swift 77818ba).** `GET /api/app/config?platform=android`
(public, no session, 426-exempt): fetched at launch (forced) and on every foreground (at most every 5 min),
kept on disk, defaults = the server's current values, unknown keys ignored, a failed fetch changes nothing.
Used for: holding logout (`blockSignOutDuringWorkday`, dialog texts `signout.blocked.*`), the Fake GPS tab
(`fakeGpsReview`), the local outside alert (`outsideHourAlertMinutes`, title follows it). Texts in the app's
language (Android "in" = server "id"), else the server's English, else the app's own copy. **Rule from now
on: a rule or sentence that may change is read from this config, not hard-coded.** RemoteConfigTest (48ce87c).

**Check-in needs location "Allow all the time" + precise (Berlin, 28 Sep; iOS 77818ba; flag
`requireAlwaysLocation`).** Check in without ACCESS_FINE_LOCATION (precise) and, from Android 10,
ACCESS_BACKGROUND_LOCATION opens a required dialog (title/text/button = server `location.always.*`, else
the app's copy): the system dialog the first time for each permission (Android 11+ takes "all the time"
to its setting page), Settings after a refusal; check-in starts by itself once all is granted, never
before. Taken away mid-workday: the dialog comes back on every return to the app. Check-out is not held.
AlwaysLocationTest, AttendanceGuardTest (this step).

**Fake GPS (Berlin, 28 Sep; server f7f5f1c, iOS c977091).** The mock flag, the main evidence on Android:
every fix sent is built from a real `Location` by `toFix()` with `simulated = isMock` (API 31+) /
`isFromMockProvider`, and `simulated=1/0` goes on every check-in, check-out (incl. offsite) and offline
replay; a mocked fix queued offline keeps the flag on disk. Locked by AttendanceApiTest,
AttendanceQueueTest and AttendanceGuardTest (this step).

## Audit 28 Sep 2026 (docs/AUDIT.md, HEAD 4b50f89): fixes

No KRITIS findings. Decisions (Berlin, 28 Sep, replacing the main session's first answers): an approved request covering
today hides Check in; versionName rises per published APK and stays what is compared; inside ANY active
office is inside, and the office the person is in is shown; a replayed check-in answered 409 "already
checked in" has landed.

| Finding | Fix | Commit |
|---|---|---|
| T1 (TINGGI) approved request covering today still showed Check in | Button replaced by the iOS card "Your approved request covers today · <type> · No check-in needed" (APPROVED only; a forgotten or started check-out still shows) | c10ca62 |
| T2 (TINGGI) a new build with the same versionName was never offered | Resolved by the release rule instead: every published APK raises versionName (Berlin). The versionCode offer/floor of c283de2 was taken out again; R5 DROPPED | c283de2, reverted e86b974 |
| S2 (SEDANG) "outside" judged against the record's office only | Inside ANY active office is inside, as the server's `officesForRecord`: the workspace's active offices (`/api/attendance/offices`, once per record, persisted with the trail) join the record's fence; outside only when clear of every one. Moving from A to B raises no exit, alarm or countdown. The office they are in is shown: Work session notification "At <office> · …", Attendance card office tile while working. iOS: main session | db36861 |
| S3 (SEDANG) one refusal at the head of the queue held the check-out behind it | A replayed check-in answered 409 "You have already checked in today." (no code) is done: dropped silently, counts as landed, the next entry goes on. PENDING_CHECKOUT and "approved request covers today" stay refusals. iOS fixed the same in db9295c; like it, the replay now also clears an earlier attempt's warning | ad9cf3b, this step |
| S1 (SEDANG) check-in place per record not ported (iOS a0f1de4) | `AttendancePlace` (server flag first, else distance > radius; away → first two address parts, else `%.5f` coordinates, never the office). Attendance card: once checked in the record decides (away → "Where you checked in" + address, helper "Away from the office · In/Out"; inside the radius → the office even for location-free). Board day sheet: "Away from the office · <address>" instead of the office. Trail header: the place line (server `placeLabel`) | 57d1166 |
| R1 (RENDAH) done time from the phone clock | The record's checkInAt/checkOutAt, the phone clock only when the server sent none | 71f9703 |
| R2 (RENDAH) "Done for today" differed from iOS | Server `workedMinutes` first; a check-out still queued shows "Check-out saved on this phone" | 57d1166 |
| R3 (RENDAH) Indonesian extra-day-off wording | iOS 6144f2c wording ("Yang bersangkutan sudah dikabari." …) | 57d1166 |
| R4 (RENDAH) ownerless queue entries replayed for anyone | Replay only the signed-in person's own entries; ownerless ones are dropped at sign-in (Android never shipped one) | 2b5f715 |

**Audit status:** every finding (T1, T2, S1–S3, R1–R4) closed; 260 JVM tests green.

AttendanceGuardTest also locks, since: no confetti anywhere (Berlin, UPDATES §11); the Google Workspace temporary password lives only on its screen (never prefs, files or logs); the trail judges inside/outside against every active office (no single-fence call can bring back the false "left the office" alarm). 271 JVM tests.

Aligned with iOS 45ea4ea (the same change on iPhone): the office tile keeps the record's office and its
helper says "Now at <office> · In … · Out …" after moving to another active office; the office in now is
the nearest (edge distance) to the latest clear fix; the record's own office is removed from the list by
place, not by equality.

## Release rule (Berlin, 28 Sep 2026)

Build 2 is **not** published. The Android release to all staff comes only after every feature is
level with iOS 0.1.6 (Phase 3 + Phase 4 Control Room + every UPDATES section) and a clean audit; it
is published through the web `/download/android`, and the Android minimum version then follows the
iOS rule (3 days after release). With no phone tester before that, the release-critical paths are
held by tests (added 28 Sep): `AttendanceGuardTest` (only capture flow/queue reach check-in/out,
only the face check makes a selfie, notification actions are permit links only, no cron/notify
routes, GPS only through the work session, only the updater installs and it always runs the
verdict, the queue lives outside backups, the mock-location flag is always sent, no secrets in logs),
`UpdateVerdictTest` (checksum, package, signing key, version), `TrailMachineTest` (nothing recorded
without an open record; stale fixes decide nothing) on top of the queue/LAN/version-gate suites.
The first staff member's device checklist is in `docs/INSTALL-APK.md` (13 checks).

## Release smoke test (28 Sep 2026)

`NEXUS-0.1.6-3.apk` installed on the agents emulator (API 34), cold start: login screen drawn, no crash,
no R8 / serialization / missing-class errors in logcat. Nothing past login (no test account is used).

## APK ready (for the main session, R2) — publish only on Berlin's go

**APK siap (untuk audit, BELUM terbit): versionCode 6, sha256 `ec06a64eb4ecfb2c64c89d4113a205af1ea887b73c5264c8e26fe6221da11934`**
`agents:~/nexus-android-release/NEXUS-0.1.6-6.apk` (+ `.sha256`) — versionName 0.1.6, versionCode 6, 23.9 MB,
built from **91dded1**, signed by the release key (SHA-256 53:22:FE:…:AD:26), with Firebase; 308 JVM tests
green. Contains build 5 + the fixes of audit 266af90 (R1, R3, R4, R6, R7) + 29 Sep changes (logout revokes
the token on the server, email change needs the current password, 401/sessionVersion checked, Z Vault and
Threads only for the company workspace). Smoke test on the agents emulator (API 34): three cold starts of
the app, no crash in the app's process. A crash in the crash buffer was a *stale* `BOOT_COMPLETED` to
`WorkTrailBootReceiver` for the uid of the package the test script had just uninstalled (Start proc …
u0a200 while the new install is u0a201, empty DexPathList): an artefact of uninstall+reinstall right after
an emulator boot; a real update keeps the uid and cannot hit it. (An earlier build-6 file from 948f5e0,
sha256 39f989f6…77ce1, was replaced by this one before anyone saw it.)

Previous candidate, audited RILIS LAYAK (266af90) and going out for Berlin to test: `NEXUS-0.1.6-5.apk`
(versionCode 5, sha256 `4d75566d2e21e24d4ac93835e8cd7c1ba3875455168306c8de2bfb63c0943c38`, from b122e0f).

Superseded, never published: `NEXUS-0.1.6-4.apk` (versionCode 4, sha256 `98b608ff…ceb8e`, before remote config).
Superseded, never published: `NEXUS-0.1.6-3.apk` (versionCode 3, sha256 `e63ca19d…a326`, audited "not
releasable"); `NEXUS-0.1.6-2.apk` (versionCode 2).
Older: `NEXUS-0.1.6-1.apk` (versionCode 1, sha256 `5fabc061…2d97e`), before Phase 2.

## Not verified yet (the first thing to do)

Nothing past the login screen has run against production. The emulator can't pass liveness (synthetic
camera), and no account has been used. Needed:
1. Test phone: Oppo Reno 16 F 5G (Dimensity 7300-Energy, Android 16), with the APK above.
2. Test account: the STAFF member who holds that phone logs in himself; his attendance is real.
   Never ask for or store a password. One check-in per day per account.
3. Firebase is installed (release builds have push on). Test a real chat and attendance push on the phone
   (never POST cron or notification endpoints).

Run the PRD §5 Phase 1 acceptance list on that phone: liveness vs a photo on a screen, airplane-mode
check-in replayed at the tap time, 502/530 queued vs 409 not queued, reflection gate, offsite
approval, permit rules, push to the approver, 2 h 30 outside with the phone locked, floor raised →
lock + held tap, day-off never over quota.

## Not built

Phases 2–4 of PRD §5 are built (28 Sep 2026). Left, by decision: Phase 5 (after adoption) and Sheets
on mobile (0.1.7 on iOS too).

## Next steps

1. Audit pass over everything built today (bugs first), then the Phase 4 acceptance by role
   (STAFF/MANAGER/BOD/OAA see and may do exactly what iOS allows).
2. Release per Berlin's rule (above): not before parity + a clean audit; new versionCode, publish via
   web /download/android, Android minimum 3 days later.
3. On-device run of the acceptance lists on the first staff phone (docs/INSTALL-APK.md checklist).
