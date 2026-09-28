# NEXUS Android: status

**Active again since 28 Sep 2026** (hold lifted by Berlin). Parity with iOS per
`docs/UPDATES-2026-09-28.md` is done; see "28 Sep" below.

Repo `agents:~/nexus-android`; every change is committed, and nothing is half-finished.
Build: `./gradlew assembleDebug assembleRelease testDebugUnitTest` (295 JVM tests, all green).
Version 0.1.6 (versionCode 3 in the tree; nothing published yet), applicationId `id.znetworks.nexus`, minSdk 26, target 36.
Phases 1–4 done, Phase 5 done except Wear OS (Berlin's decision); re-audit of 28 Sep: every finding closed.

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
| 5.5 | **Wear OS (optional): needs Berlin's decision, not built.** A Wear OS app is installed on the watch itself, from the Play Store on the watch; a sideloaded phone APK (our only channel, /download/android) cannot carry it, so each watch would need adb over Wi-Fi. Until there is a Play listing (or Berlin wants an adb-installed build for a few people), the watch gets what the phone already posts: ordinary pushes (approvals, reminders) are mirrored by the Wear OS companion. Scope if built: today's status + 7 dots (as the widget) and approvals (as iOS Watch ApprovalsView), session from the phone over the Wear Data Layer | — |
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

**APK siap (untuk audit, BELUM terbit): versionCode 4, sha256 `98b608ffaa05c35a15785691cd8d9d76ba7b0877a71940cd55b5d18e143ceb8e`**
`agents:~/nexus-android-release/NEXUS-0.1.6-4.apk` (+ `.sha256`) — versionName 0.1.6, versionCode 4, 23.9 MB,
signed by the release key (SHA-256 53:22:FE:…:AD:26), with Firebase. Contains everything through the
re-audit fixes, no-logout-during-workday and Fake GPS (commit 2050db4 + versionCode). Smoke-tested on the
agents emulator (API 34): cold start to login, no crash, no R8/serialization errors, widget provider
registered. Berlin's rule: published only after parity + a clean audit and his go, as **0.1.6**; later
APKs raise versionName and versionCode.

Superseded, never published: `NEXUS-0.1.6-3.apk` (versionCode 3, sha256 `e63ca19d…a326`, audited "not
releasable"); `NEXUS-0.1.6-2.apk` (versionCode 2).
Older: `NEXUS-0.1.6-1.apk` (versionCode 1, sha256 `5fabc061…2d97e`), before Phase 2.

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

## Not built

Phases 2–4 of PRD §5 are built (28 Sep 2026). Left, by decision: Phase 5 (after adoption) and Sheets
on mobile (0.1.7 on iOS too).

## Next steps

1. Audit pass over everything built today (bugs first), then the Phase 4 acceptance by role
   (STAFF/MANAGER/BOD/OAA see and may do exactly what iOS allows).
2. Release per Berlin's rule (above): not before parity + a clean audit; new versionCode, publish via
   web /download/android, Android minimum 3 days later.
3. On-device run of the acceptance lists on the first staff phone (docs/INSTALL-APK.md checklist).
