# NEXUS for Android — Product Requirements

| | |
|---|---|
| Product | NEXUS by Z Networks — native Android app |
| Stack | Kotlin, Jetpack Compose, single-activity, Material 3 |
| Parity target | iOS app **0.1.6 (build 12)**, repo `~/nexus-ios` on `agents`, HEAD `a875c3c` + the live-location work in progress in that tree |
| Endpoint contract | **`docs/API.md`** (sibling file). This PRD names screens, rules and behaviours; request/response shapes live only in API.md. |
| Owner | Berlin (Bagas) — every "owner decision" below is his, dated where known |
| Status | Draft 1, 24 Sep 2026 |

Conventions in this document:
- **MUST / MUST NOT** = release-blocking requirement. **SHOULD** = expected unless an open question overrides it.
- `REQ-ATT-nn` ids are testable attendance requirements; each has a **Why** (the reason the owner gave or the incident that produced it) and a **Test**.
- **SERVER/WEB CHANGE** marks work outside the Android repo that the Android release depends on. None of it is done by this PRD.
- iOS file references are relative to `~/nexus-ios/Sources/`.

---

## 1. Product summary

### 1.1 What NEXUS is
NEXUS is Z Networks' internal operations app ("NEXUS Phaëthon"). One workspace per company; Z Networks is the main one. It covers:
- **Attendance** (the core): selfie + GPS check-in/check-out against office geofences, shifts, day-off/leave/sick/permit/public-holiday requests, approvals, offsite check-outs, daily reflections, crew board, penalties.
- **Projects & tasks** ("Missions" / "Quests"): folders, boards with lanes, list, spreadsheet, calendar, timeline, sprints, custom fields, dependencies, time tracking, comments, attachments.
- **Chat**: DMs, groups, project rooms; photos, locations, task links, mentions, replies.
- **Threads**: company feed with photos, likes, comments.
- **Forms & submissions**: fill forms (incl. public `/f/` links), follow your submissions (read-only kanban set by Finance).
- **Z Vault**: shared company file library with internal (`/v/`) and external (`/s/`) share links.
- **Reports**: per-person reports for the 28→27 period ("Me" / "My team").
- **Gamification**: XP, levels, streaks, quests (claimable), monthly leaderboard, XP penalties tied to attendance.
- **Tickets**: a line to the BoD for ops/HR issues, with attendance-correction proposals.
- **GIDEON**: the in-app AI assistant (chat, streaming, attachments, model tiers). GIDEON has **no attendance tools** — see REQ-ATT-40.
- **Control Room**: administration (users, approval chart, attendance settings, audit, quests, announcements, GIDEON usage, app installs).

### 1.2 Users and roles
| Role | Who | What changes |
|---|---|---|
| `STAFF` | most employees | own attendance, own reports only, no Control Room |
| `MANAGER` | team managers | reviews requests of **direct reports only** (one level, `approverId`); Control Room entry; "My team" reports = direct reports |
| `BOD` | Board of Directors | reviews anyone, overrides any decision (recorded as ADMIN), announcements, GIDEON usage, app installs, role changes below own tier; not live-location-tracked |
| `ONE_ABOVE_ALL` (OAA) | workspace owner tier | everything BOD can, plus assign every role |
| System `ADMIN` | platform-level flag, not a workspace role | sees all reports; treated as all-scope by the server |

- Tier numbers used for role editing: OAA 4, BOD 3, MANAGER 2, STAFF 1 (`Views/SettingsExtras.swift`). Nobody below tier 3 assigns roles; BOD assigns roles below its own.
- Per-member attendance flags set by BoD: **Flexi Time**, **Mobile mode** (`noGeofence` — check in anywhere, offsite check-out without approval), fixed **weekly rest days**, custom shift, **day-off quota** (default 4).
- **Approval chart** (live since 15 Sep 2026): each member may have one `approverId`. Requests go **only** to that approver, whatever the roles. No approver → the BoD group (safety net; shown as "Not placed"). Server rejects self-approval and cycles. Pending > 2 working days (Mon–Fri) → escalated to BoD (cron every 30 min). Team lead no longer exists.

### 1.3 Languages
- Source language is **English**; every UI string is an English key. **Indonesian** is a user-selectable overlay (`Localization.swift`, ~1,140 entries) that applies **immediately, without restart**; a missing translation falls back to English, never to a raw key or blank.
- Default = English until the user picks Indonesian.
- Android: `values/strings.xml` (en) + `values-in/strings.xml` (Indonesian; Android's legacy code for `id`). Port the iOS dictionary by script, keeping the English text as the default value. Use `AppCompatDelegate.setApplicationLocales` for the in-app switch (works back to API 21 via AppCompat; integrates with the Android 13 per-app language setting).
- Server error messages arrive already written (often Indonesian) and MUST be shown verbatim, not replaced by a generic string.
- A few iOS labels are hard-coded Indonesian (Control Room "Peran/Akun/Zona berbahaya", "Pengumuman", sprint "Mulai/Selesaikan"). Android SHOULD route them through translations with the English key.

### 1.4 Why Android, why now
- Android staff have no app. They use the **web SPA** (`nexus.znetworks.id`), whose check-in is a browser selfie + one position.
- The web **cannot track location** between check-in and check-out, which the owner decided on 24 Sep 2026 is mandatory (§2.9). Web check-ins are marked `checkInClient="web"` and the board says "Web check-in · location not tracked".
- Owner decision (24 Sep 2026): web check-in stays open **only because** there is no Android app ("kasihan user Android"). **Once the Android app ships, web check-in will be closed.** That closure is a SERVER/WEB CHANGE gated on Android adoption (§5, Phase 5).
- Consequence: for Android users this app **replaces** their only way to take attendance. Attendance must be complete and robust in the MVP; everything else can follow.

---

## 2. Non-negotiable attendance rules

> Owner, 22 Sep 2026: *"absen ini core penting di app ini. gw gamau ada masalah kaya gini lagi ke ulang."* Attendance is the one dataset that cannot be honestly recreated later. Every rule below is release-blocking for the MVP.

### 2.0 Process rules that govern this whole section
- **REQ-ATT-00a — Build to what the server enforces today, and send the full evidence.** The Android client MUST satisfy the *strict* rule set (single date, permit photo + location, reflection, selfie). **Why:** four failures in one day (22–24 Sep) came from rules the shipped client could not meet. **Test:** the compat replay (`scripts/compat/run.sh`) gets Android scenarios and passes against prod rules.
- **REQ-ATT-00b — Every refusal is actionable from the screen.** Any rejection the server can send on an attendance path MUST display the server's sentence plus the next step (open Settings, retake, pick another date, file a permit). A dead-end error is a bug. **Why:** owner rule 3 in `absensi-verifikasi-sebelum-deploy`.
- **REQ-ATT-00c — Client identity header.** Every request carries `X-Nexus-Client: android/<versionName>/<versionCode>` (e.g. `android/0.1.6/1`). **Why:** the server holds each build to the rules that build can obey. The server currently parses any platform word but **treats `android` as unknown ⇒ loose rules and never blocked** (`src/lib/client-version.ts`, `clientCanObeyRequestPolicy`, `iosUpgradeGate`). That is the correct default (unknown ⇒ loosest). SERVER CHANGE (Phase 0): recognise `android` ≥ first release as strict and add an Android version floor. That change MUST NOT go live in the same deploy as the first Android build that sends the tag.
- **REQ-ATT-00d — Verify on production before calling it done.** Each attendance-affecting release: test session on prod, curl the endpoints, then the owner tests on a real device. Prove it with data (count rows by `checkInClient`), not assumption.

### 2.1 Selfie and on-device liveness
- **REQ-ATT-01 — No attendance write without a selfie.** Check-in and check-out MUST upload a selfie (`selfie` multipart part, JPEG, < 10 MB). No code path — widget, shortcut, notification action, Assistant/App Actions, wearable, GIDEON — may check in or out without going through the camera flow. **Why:** GPS is trivially spoofed; a face at the place and time is not. Any selfie-free path becomes the easiest way to check out from home (owner, 6 Sep 2026). **Test:** grep the codebase for check-in/out call sites; only the capture flow reaches them.
- **REQ-ATT-02 — Liveness sequence.** The selfie is taken by a dedicated full-screen face-check screen, not the system camera: **look straight → turn to one side → turn to the other side → blink → hold still → auto-capture**. **Why:** too many selfies were walls, ceilings or empty desks ("foto tembok kantor"); fintech-style liveness proves a person was present. **Test:** a printed photo or a phone screen held to the camera cannot complete the turn + blink steps.
  - Turn direction is **not** enforced: the first turn may go either way; the second MUST be the opposite. The on-screen words still say "right" then "left". (Yaw sign depends on camera mirroring/orientation and cannot be trusted.)
  - Thresholds to mirror iOS (`Views/LivenessCaptureView.swift`): frontal |yaw| ≤ **0.20 rad (≈11.5°)**, turned |yaw| ≥ **0.38 rad (≈21.8°)**; blink = eye openness drops below **70 %** of the widest openness seen in the last ~1.5 s, then reopens. With ML Kit use `headEulerAngleY` (degrees) and `left/rightEyeOpenProbability`.
  - Face lost for ~45 consecutive frames after the first step ⇒ restart with "Face lost. Let's start again."
  - Guidance copy per state: no face / come closer / move into the window / turn further / glasses make blinking harder. Step pills: Straight · Right · Left · Blink.
  - **Dark room:** the screen becomes the light — surroundings turn white, window brightness 100 %, restored exactly afterwards; latches on once (no strobe); manual toggle too.
  - Slow devices may skip frames except during the blink step.
  - Camera permission denied ⇒ full-screen explanation + "Open Settings".
- **REQ-ATT-03 — It is liveness, not identity.** Nothing is compared to an enrolled face; no face template is stored or sent. Only the one final JPEG leaves the device. **Why:** identity matching needs enrolment + server templates, a separate privacy decision the owner has not taken. **Test:** network capture during a check-in shows exactly one image upload.
- **REQ-ATT-04 — Final-photo face guard.** Before any upload, run face detection on the captured JPEG; refuse locally if no face whose shorter side ≥ **12 %** of the image's shorter side ("No face in the photo…"), or if unreadable ("That photo couldn't be read. Take it again."). Mirrors `FaceGuard.swift`.
- **REQ-ATT-05 — Works offline.** Liveness and face guard MUST run with no network (use the **bundled** ML Kit face-detection model, not the Play-services download-on-demand variant).

### 2.2 GPS, office geofence, anti-spoof signals
- **REQ-ATT-06 — One fresh high-accuracy fix per tap.** After the selfie, obtain a current fix (`FusedLocationProviderClient.getCurrentLocation(PRIORITY_HIGH_ACCURACY)` with a timeout); never a cached `lastLocation` older than the tap. Flow card states: "Getting your location…" → "Checking you in…" → result.
- **REQ-ATT-07 — Geofence verdict is the server's.** The server finds the nearest active office and compares the distance to its radius. Outside ⇒ HTTP 422 `OUTSIDE_RADIUS` on check-out (offer the offsite flow, REQ-ATT-10); on check-in the 422 carries `officeName`, `distanceMeters`, `radiusMeters` ⇒ show "You're N m from X, and check-in works within R m. Move closer and try again." Members with **Mobile mode** (`noGeofence`) are exempt and the hero shows "📍 Location-free — clock in from anywhere".
- **REQ-ATT-08 — Nearest-office card.** The attendance hero shows which office you are nearest and "You're inside this office area" or "X m from here"; "Turn location on to see which office you're at" when location is off. **Why:** 0.1.6 replaced a meaningless office count.
- **REQ-ATT-09 — Send the anti-spoof signals.** With every check-in/out (live and queued): `accuracyM`, `altitudeM`, `speedMps`, `simulated` (Android: `Location.isMock` on API 31+, `isFromMockProvider` below), `fromAccessory` (always `0` on Android). **Why:** the server's layer-2 check (implied speed > 900 km/h impossible, > 200 km/h odd; identical coordinates to the last record) flags `suspect` records without blocking. Flagging, not blocking, is deliberate: a false block hits an honest person in a lift. **Never promise the owner that spoofing is prevented** — it is made detectable. **Test:** enable a mock-location app ⇒ record stores `checkInSimulated=true`.

### 2.3 Offsite check-out
- **REQ-ATT-10** — When check-out returns `OUTSIDE_RADIUS`, show the amber card "You're outside the office area … **A reason is required** — the checkout will wait for BoD approval", a reason field, Cancel / "Checkout & request approval". Resend the same selfie and fix with `offsite=1` + `reason`. Afterwards show "⏳ Checkout outside the office area — waiting for BoD approval"; rejected ⇒ "Your out-of-area checkout was rejected by the BoD." Reviewers act on offsite check-outs inside Submissions (needs `canManageAttendance`); "You can't approve your own."

### 2.4 Offline-first queue
- **REQ-ATT-11 — Queue only when nobody answered.** A tap is queued only when (a) the request never got an HTTP response, or (b) the edge answered for an absent origin: **500, 502, 503, 504, 520–527, 530**. Everything else (409 already checked in, 422 outside radius, 400 bad data, 403) is the server's opinion and MUST NOT be queued or replayed. **Why:** 8 Sep outage (Cloudflare 530 all day); before the fix, outages were counted as refusals and queued attendance was deleted after 5 tries. **Test:** airplane mode ⇒ queued; server returns 409 ⇒ not queued, message shown.
- **REQ-ATT-12 — Record the tap, not the sync.** Each queued entry stores `clientId` (UUID generated **once per tap**, also sent on the live attempt), `deviceAt` (tap time, ISO-8601 UTC), `uptimeSec` (`SystemClock.elapsedRealtime()/1000`), lat/lng + all REQ-ATT-09 signals, reflection (check-out), offsite flag + reason. **Why:** a 09:00 tap synced at 11:00 must not be "2 h late"; `clientId` makes replay idempotent (server returns the existing record, `duplicate: true`) so a lost reply cannot become a second check-in. Server clamps `deviceAt` (no future, ≤ 7 days old) and always marks replayed records `offline`. **Test (owner's):** airplane mode → check in → wait → airplane mode off → reopen Attendance ⇒ recorded time = tap time.
- **REQ-ATT-13 — Replay rules.** Oldest first (a check-out must never land before its check-in). Flush on app start after sign-in, when Attendance opens (before loading today), on connectivity regained (WorkManager, `NetworkType.CONNECTED`, expedited), and periodically. Stop the pass at the first "still unreachable". 401 ⇒ keep the queue, wait for sign-in. Other failures count an attempt; drop after **5** and show why.
- **REQ-ATT-14 — Refusal on replay is said, not swallowed.** Replayed check-out answered `OUTSIDE_RADIUS` ⇒ resend once as offsite with reason "Checked out while NEXUS was unreachable; the phone was outside the office radius at the time." Replayed check-in answered `OUTSIDE_RADIUS` ⇒ drop it, show "Your check-in at HH:mm was refused when it was sent…" on screen **and** post a local notification.
- **REQ-ATT-15 — The queue is always visible.** Banner "N attendance records are on this phone, waiting to be sent." while N > 0. Queued check-in counts as "checked in" for the UI (PRESENCE OUT enabled); queued check-out as "checked out". **Why:** 8 Sep: someone checked in offline, PRESENCE OUT stayed disabled all day, the nightly cron read the missing check-out as an absence and took a day-off token.
- **REQ-ATT-16 — Storage and privacy.** Queue index + selfie files in app-private `noBackupFilesDir`; **excluded from Auto Backup / device transfer** (a restored queue would replay on another device). Each entry is tagged with the user id. A deliberate **Logout** clears the queue completely — a queued tap belongs to the person who made it (before 0.1.5 it was replayed under the next person's session). A **session expiry (401)** MUST NOT destroy it: keep the entries, and replay them only after the *same* user signs back in; if a different user signs in, discard them. (Deviation from iOS, where any 401 calls `logout()` and so also clears the queue — a lost tap is the one failure attendance cannot recover from.) Survives app updates.
- **REQ-ATT-17 — Server down is a mode, not an error.** When `today` cannot be loaded because nobody answered, show "NEXUS is down right now — Offline check-in mode is on…" with "Check again", render today from the saved copy with "Saved copy from HH:mm", and keep both buttons usable.

### 2.5 Daily reflection
- **REQ-ATT-18** — Check-out requires a **daily reflection ≥ 200 characters** (trimmed). The card appears whenever a check-out is due, with a live counter "N more characters needed…"; PRESENCE OUT stays disabled with "PRESENCE OUT unlocks once the daily reflection above reaches 200 characters." The server also refuses pasted/repeated text — show its sentence. **Why:** owner decision, 6 Sep 2026; GIDEON summarises reflections per day and month.
- The reflection survives app backgrounding (draft persisted per attendance date) and is cleared only after a successful or queued check-out.

### 2.6 Shifts and flexi
- **REQ-ATT-19** — The hero shows "My Work Schedule HH:mm – HH:mm" from `myShift`. Precedence (server): Flexi (per member) > user per-weekday > user default > team > office.
- **REQ-ATT-20 — Flexi Time:** on-time check-in window **12:00–15:00 WIB**; expected check-out = **check-in + 9 h**. Show the window and, once checked in, the expected end. Reminders follow the real expected end.
- **REQ-ATT-21 — Forgotten check-out.** If `pendingCheckout` holds an earlier day's open record, the hero switches to "Finish yesterday's attendance", check-in is blocked by the server until it is closed, and the check-out flow (selfie + reflection) targets that record.
- All times are **Asia/Jakarta (WIB)** regardless of device time zone.

### 2.7 Day-off quota, TK and lateness (owner decision 24 Sep 2026, final)
- **REQ-ATT-22** — Day-off quota = weekly rest days, **default 4 per attendance period 28th → 27th**. Automatic cuts **also consume it**: *tanpa keterangan* (TK: no check-in, no covering request) and **late > 120 min**. Quota exhausted ⇒ **no more day-off requests**; no extra/unpaid day off, no borrowing, no "forgot to check in" correction. Only BoD is exempt from attendance.
- **REQ-ATT-23 — Display capped.** Day-off tokens show `used/quota` and never exceed the quota ("4/4", never "6/4"); the server already caps (`today` route). Android MUST NOT compute its own count.
- **REQ-ATT-24 — Late penalty copy** (XP rules card): late check-in −1 XP/min up to 120; > 120 min also docks a day-off token; no check-out −25; rejected offsite −25; no-show −150/day.
- A push goes out for every TK at 08:00 WIB (server cron) — Android just needs the channel and deep link.
- Do **not** propose loosening any of this; the owner rejected every such proposal.

### 2.8 Requests (leave, sick, permit, day off, public holiday)
- **REQ-ATT-25 — One date per request, every type, every role.** No range picker; `endDate = startDate`. **Why:** a range was a second way to file days nothing else understood; the 0.1.4 START–UNTIL picker locked staff out when the server went single-date. **Test:** composer has exactly one date control.
- **REQ-ATT-26 — Offer only what can be filed.** Types shown: `LEAVE` only if eligible (≥ 12 months' service) **and** days remain; `SICK`, `PERMIT`, `DAY_OFF` always; `RED_DATE` (public holiday) only if this month's quota > 0 with days left. A one-line hint under the chips states cost/rules ("Day off: 2 of 4 left this period", "Annual leave: 7 of 12 days left this year", ineligibility reason). Asking with 0 left ⇒ blocked **before** submit: "You're asking for 1 days and only 0 is left."
- **REQ-ATT-27 — Sick:** one date, **may be backdated**; photo of the doctor's note **required**.
- **REQ-ATT-28 — Permit (izin):** one date, **today or later — never backdated** (date picker floor = today, clamped the moment Permit is selected; server `PERMIT_BACKDATED`); **photo required** (camera, gallery or file) **and location required** — the fix is taken the moment Permit is chosen and shown locked on screen: "Location locked (lat, lng)", with retry. **Why:** permits from iPhone silently died from mid-Aug to 22 Sep because the app never sent coordinates; staff quietly moved to the web.
- **REQ-ATT-29 — Permit is not a day off and not a cover for a forgotten check-in.** The server classifier (`src/lib/permit-reason-guard.ts`) refuses reasons that mean either (`PERMIT_NOT_DAYOFF`, `PERMIT_NOT_FORGOT_CHECKIN`). Android shows the server sentence and keeps the form filled; it MUST NOT reimplement the classifier. Work-outside permits (shoot, event, rehearsal, survey, client visit) are valid; no cap on the number of permits.
- **REQ-ATT-30 — Attachments:** ≤ 10 MB, photo or PDF; send a real MIME type (`image/jpeg`, `application/pdf`), and name the file by type (`sick-note.jpg` / `permit-photo.jpg`). **Why:** iOS labelled everything `application/octet-stream` and JPEGs were rejected; permits were filed under a sick note's name. Reason ≥ 3 characters.
- **REQ-ATT-31 — XP refund on filing is intentional.** Filing a request immediately returns that day's XP penalty; reject/cancel recompute the day. Do not "fix" (owner, 8 Sep: 3.7 % rejected vs 96 % legitimate).
- **REQ-ATT-32 — Approval flow.** Requests go to the member's approver (else BoD group), escalate after 2 working days. Reviewers see one queue ("Submissions" card) with Approve / Reject (reason sheet: "Say why, so they can fix it and file again…") / Cancel; decided rows show "Approved by X · when" or "Recorded automatically"; the requester sees the approver's note. You cannot approve your own. Filter chips Pending/Approved/Rejected/Canceled/All, search by name or reason, window **"Last 3 days" (default)** / "This period". A push about a request opens that request with Approve/Reject inline (REQ-ATT-45).

### 2.9 Live location while checked in (owner decision 24 Sep 2026; target iOS 0.1.6)
Status: iOS implementation is in progress in the `~/nexus-ios` working tree (`WorkLocationTracker.swift`, `WorkTrailPolicy.swift`, `Views/LocationTrailView.swift`, uncommitted); server endpoints are specified in API.md (draft names in iOS: `POST /api/attendance/location-trail`, `POST /api/attendance/location-status`, `GET /api/attendance/records/{id}/trail`).

- **REQ-ATT-33 — Scope.** Track **only** between a server-accepted check-in and the check-out, for members the server tracks (not BoD/OAA, not Mobile-mode members; the server answers `tracking:false` ⇒ stop and never restart for that record). Stop on check-out (including a queued offline check-out), logout (discard unsent points), `tracking:false`, or a 16 h safety cap.
- **REQ-ATT-34 — What is sent.** Inside the office radius: a **presence check about once an hour** (owner, 28 Sep 2026). Outside: one point on leaving, then the **precise route**: a point every ~50 m moved (≥10 s apart) or every 5 min when standing still, one on coming back (UPDATES §1, §10). Points carry their own `recordId`, are queued on disk, sent in batches (≤ 200 per request, cap 3,000 pending, oldest dropped first) at most every ~2 min, retried after 2 min. The server may ask for the next point sooner (e.g. just before the 1 h 30 reminder).
- **REQ-ATT-35 — Server clock and actions (server-driven; the app renders them).**
  - 1 h 30 outside ⇒ push "reminder" with action **"File a permit"** → opens the request composer for **today, type Permit, prefilled** (`/attendance?permit=today`).
  - 2 h ⇒ push warning "30 minutes left".
  - 2 h 30 ⇒ **automatic offsite check-out** (time = when the person left the radius), pending BoD approval via the existing offsite flow; push `attendance_auto_offsite_checkout` ⇒ app reconciles today and stops tracking.
  - A PENDING/APPROVED permit for today stops the clock; a rejected one restarts it from the rejection time.
  - Trail (points + path on a map) is visible to the person, their direct manager and BoD; points kept 90 days. Android shows it in the record detail (`LocationTrailView` equivalent).
- **REQ-ATT-36 — Permission and honesty.** After the first successful check-in of a record, show an in-app **prominent disclosure** (required by Google Play, see §4.10) before the system prompt: NEXUS records location only between check-in and check-out, including when the app is closed; about once an hour at the office, and your route while you are out of the office; nothing before check-in or after check-out. Then request `ACCESS_FINE_LOCATION` → `ACCESS_BACKGROUND_LOCATION` (Android 11+: this is a trip to Settings "Allow all the time"; the dialog must say so). Ask **once per record**, never nag. Refusal ⇒ report state `denied` for the record; the crew board shows **"location off"** for that day; the app still tracks while open (foreground).
- **REQ-ATT-37 — Android runtime.** Tracking runs in a **foreground service of type `location`** (`FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_LOCATION` on API 34+) with a **persistent notification** for the whole work session. Start it at check-in while the app is in the foreground (Android 12+ forbids starting it from the background); restart after reboot via `BOOT_COMPLETED` only if background location is granted and a record is still open. Use `GeofencingClient` (radius ≥ 100 m; the server still judges each point against the real radius) + fused updates `PRIORITY_BALANCED_POWER_ACCURACY` (~100 m) while outside; low-cost checks while inside. Also report state changes when the user turns device location off or revokes permission mid-session.
- **REQ-ATT-38 — Survive OEM battery killers.** On first tracking start, and whenever the service is found to have been killed (gap > 30 min in expected points while outside, or heartbeat missing), show a one-time guided sheet per manufacturer. Required: `ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS` (or `ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` — justified by the core feature; confirm against Play policy), plus the OEM screen. Every intent MUST be wrapped (component names change between OS versions) with fallback to the app's details page (`ACTION_APPLICATION_DETAILS_SETTINGS`):

  | OEM (skin) | What the user must switch | Deep-link candidates (try in order) |
  |---|---|---|
  | Xiaomi / Redmi / POCO (MIUI, HyperOS) | Autostart ON; Battery saver → "No restrictions"; lock app in recents | `com.miui.securitycenter/com.miui.permcenter.autostart.AutoStartManagementActivity`; `com.miui.powerkeeper/.ui.HiddenAppsConfigActivity` (extras `package_name`, `package_label`) |
  | Oppo / Realme / OnePlus (ColorOS, realme UI, OxygenOS 12+) | Auto launch / "Allow background activity"; battery "Don't optimize" | `com.coloros.safecenter/.permission.startup.StartupAppListActivity`; `com.coloros.safecenter/.startupapp.StartupAppListActivity`; `com.oppo.safe/.permission.startup.StartupAppListActivity` |
  | Vivo / iQOO (Funtouch, OriginOS) | Background power consumption → allow; Autostart | `com.vivo.permissionmanager/.activity.BgStartUpManagerActivity`; `com.iqoo.secure/.ui.phoneoptimize.AddWhiteListActivity`; `com.iqoo.secure/.ui.phoneoptimize.BgStartUpManager` |
  | Samsung (One UI) | Battery → "Unrestricted"; remove from "Sleeping/Deep sleeping apps"; add to "Never sleeping apps" | `com.samsung.android.lool/com.samsung.android.sm.battery.ui.BatteryActivity`; fallback app details |
  | Huawei / Honor (EMUI, MagicOS) | App launch → manage manually, allow all three | `com.huawei.systemmanager/.startupmgr.ui.StartupNormalAppListActivity`; `com.huawei.systemmanager/.optimize.process.ProtectActivity` |

  **Test:** on at least one device per row, check in, leave the radius, lock the phone 3 h ⇒ points arrive every ~15 min and the 2 h 30 auto check-out fires from server data, not from the app being opened.

### 2.10 Platforms that cannot take attendance
- **REQ-ATT-39** — Attendance writes require a phone with camera + GPS. iOS on Mac shows a read-only card: "Attendance is taken on the NEXUS app on your phone: it needs the face check and your real position, and a Mac can prove neither." Android on ChromeOS / devices without a front camera or GPS MUST show the equivalent card and keep all read-only attendance features.
- Web check-in: no location tracking ever. iPhone browsers are to be refused (planned 403 `USE_IOS_APP`, **not yet implemented** on the server as of `5c113e7`). After Android ships, web check-in closes entirely (SERVER/WEB CHANGE, Phase 5).
- **REQ-ATT-40 — No assistant/automation path.** GIDEON has no attendance, clock or quota tools by design ("acting as the user" restrains nothing there). Android MUST NOT expose check-in/out through App Actions, Assistant, Quick Settings tiles, widgets, Wear OS or notification actions. A shortcut may only **open** the Attendance screen (iOS `OpenAttendanceIntent`).

### 2.11 Forced update lock
- **REQ-ATT-41 — Version policy.** On launch/foreground (throttled to 30 min; "Check again" forces) call the unauthenticated version-policy endpoint with an 8 s timeout. `minSupported` > running ⇒ **full-screen lock** "Update NEXUS to continue — This version is no longer supported. Your data is safe…" with "Open Play Store" + "Check again". `latest` > running ⇒ soft "NEXUS X is available" row in Tuning Room. `nextMinimum` + `graceUntil` ⇒ warning "Update NEXUS by <date>. After that, this version can't take attendance." shown at most **once per office day (WIB)**.
- **REQ-ATT-42 — The lock persists.** Persist the floor and the build that was locked; restore it on cold start even offline. Only an update (running ≥ floor, or newer than the locked build when no floor was given) or a server answer with a lower floor lifts it. A failed policy fetch changes nothing in either direction. Any HTTP **426 `UPGRADE_REQUIRED`** raises the lock immediately. Version comparison is numeric per component ("0.1.10" > "0.1.9").
- **REQ-ATT-43 — Held attendance.** A check-in/out refused with 426 is queued exactly like an offline tap (same `clientId`, tap time, evidence), the queue is marked **held for update** (persisted), replay is paused while locked, and a popup explains: "Your check-in is saved on this phone — NEXUS needs an update before it can send it… will be sent automatically with the time you tapped." The lock screen carries a line about the saved tap. The updated build drains it on first signed-in launch. A 426 is never counted as a replay attempt.
- Owner policy (server-side, for reference): floor 0.1.4 for iOS; each new version becomes the minimum **3 days** after the store first shows it; minimum never goes down. SERVER CHANGE: an Android policy (Play has no public lookup like iTunes — use a server-set latest/floor, see open questions). Play **In-App Updates** (`AppUpdateManager`, IMMEDIATE) SHOULD be used as the "Open Play Store" action where available.

### 2.12 Screen-level attendance behaviours (covered here so the MVP is complete)
- **REQ-ATT-44 — Attendance screen** (`Views/AttendanceView.swift`), top to bottom: map hero (GPS dot, office circle) + violet time card (live clock, schedule, IN/OUT times, status "Ready to check in" / "Currently clocked-in" / "Done for today 🎉"); loading / server-down / saved-copy lines; reflection card (when due); "Reflections" link; location-off banner with Settings; **PRESENCE IN** (green) / **PRESENCE OUT** (red); offsite prompt; status banners; queue banner; metric cards (Today's status, Day-off tokens, Public holidays); **Submissions** card (requests + reviews); **Crew streak board**; **Offices** card (managers). The capture flow is a centred card: locating → sending → done (auto-closes after 1.6 s, "OK" to close sooner) / saved offline / failed with the reason. Pull to refresh.
- **Crew streak board:** follows the **28→27 period**, date order, **scrolls to today on open**; heatmap colours **red absent, green present/permit, orange sick, purple day off**; managers see direct reports, BoD everyone, staff themselves ("Your attendance history"); full-screen zoomable board; month export (xlsx to share sheet) for managers; tap a cell ⇒ day detail (status, times, place, distance, selfies, request evidence, shift, worked time, corrections, approver, **location trail**).
- **Record actions (BoD)** in the day detail: "Delete check-out (reopen)" and "Delete this attendance record" (shields that day from deductions; written to the audit log), both confirmed.
- **Offices (admin):** list, add/edit/delete; pick the point on a map with the radius drawn, search, my-location; radius slider; late grace minutes; fine-tune coordinates.
- **Reflections:** month view of check-out notes with GIDEON's per-day summary and a month summary ("Summarize so far" / "Update the summary"); managers can switch person ("Me" / others).
- **Member attendance sheet** (Control Room): shift (team/office default or custom, per-weekday override), day-off allowance used/quota for a month, export one person (one row per day).
- **REQ-ATT-45 — Notification entry points:** `/attendance?request=<id>` opens that request with Approve/Reject/Cancel inline (or "That request isn't in your list anymore — It may already have been decided, or it belongs to someone outside your approval chain."); `/attendance?offsite=<recordId>` opens the offsite check-out with map + Approve/Reject; `/attendance?permit=today` opens the prefilled permit composer.
- Reminders: server pushes 30 and 15 min before the shift, at the shift minute, and at check-out time (Flexi: window-based). If push registration is not accepted, schedule local fallbacks (15 min before shift; tasks due in 2 d / 1 d / now) as iOS does.

---

## 3. Feature inventory of iOS 0.1.6 (screen by screen)

Legend: **[MVP] [P2] [P3] [P4]** = Android phase (§5). Every screen that can be empty uses the shared **EmptyState** pattern: icon + title + *why it is empty / where content comes from* + a next-step action button (compact variant inside cards). `Text("No data")` is not acceptable (owner, 21 Sep 2026). Screens rendering cached data show "Saved copy from HH:mm".

### 3.1 Auth and launch
- **Login** — `Views/LoginView.swift` **[MVP]**. Light-only. Email ("ACCESS ID (EMAIL)") + password ("ENCRYPTION KEY"), CTA "Enter Mission Control" / "Opening uplink…"; empty-field error; "Sign in with passkey" (discoverable credential, no email) **[P2]**; "Create account" and "Forgot password?" swap in place (typed email carried).
- **Sign up** — `Views/SignUpView.swift` **[P2]**. Step 1: full name, email, password 8–128, workspace code (optional, uppercase, prefilled from `/register?code=`; empty ⇒ a *personal* workspace is created — not "no workspace"). Step 2: 6-digit code, resend with server cooldown; 429 ⇒ cooldown. Auto sign-in after verify.
- **Forgot / set password** — `Views/ResetPasswordView.swift` **[P2]** (MVP falls back to the web page). Email → code (response never reveals whether the account exists) → new password ×2 → auto sign-in. `invited=1` retitles to "Set your password".
- **Shared auth pieces** — `Views/AuthFormPieces.swift`: one-time-code field with SMS/autofill, cooldown CTA, resend button.
- **Passkeys** — `Passkeys.swift`, `Views/SettingsExtras.swift` (PasskeyCard) **[P2]**. RP `nexus.znetworks.id`; register/list/revoke; dashboard nudge "Sign in with Face ID" when none exist (Android: "Sign in with your screen lock"). Android via Credential Manager (needs assetlinks + server origin change, §4.8).
- **Splash + offline warm-up** — `Views/RootView.swift`, `OfflineSync.swift` **[MVP: data stage for attendance; P3: full]**. First sign-in or data > 30 min old: splash draws the X mark while the DATA stage fetches profile, gamification, projects, my tasks, attendance today/history/requests, submissions, every project's tasks; MEDIA stage (attachments + selfies, 1 GB budget) runs in background, Wi-Fi only unless allowed.
- **Offline copy card** — `Views/OfflineCard.swift` **[P3]**: storage used / 1 GB, status pill, last data sync / last media sync, "Use mobile data for files" (off by default), "Sync now" with progress.
- **Offline notice** — `Views/OfflineNotice.swift` **[MVP]**.
- **Update required / available / grace** — `Views/UpdateRequiredView.swift`, `AppVersionGate.swift` **[MVP]** (§2.11).
- **What's New** — `WhatsNew.swift` **[P2]**: shown once after an update; tiers headline / also / fix; BoD-only entries hidden from others; banner "NEXUS X is available" + Update. Android keeps its own entries per version.
- **Announcement modal** — `Views/AnnouncementModal.swift` **[MVP]**: app-wide queue of active announcements (tone info/success/warning, title, body, optional image), "Next"/"Got it" marks seen; `/dashboard?announcement=<id>` shows one even if seen; repeating announcements re-show daily.

### 3.2 Navigation shell
- **Phone tabs** — `Views/AdaptiveRoot.swift`: Home · Tasks · Inbox · Projects · More. Android: bottom `NavigationBar`, same five.
- **More** (`MoreView` in `Views/RootView.swift`): Home Base (Messages, Threads, My Submissions, Team Calendar, Room Booking) · Missions (Leaderboard, Reports) · Knowledge (Z Vault, Forms) · Pulse Check (Attendance) · System (Ticket, What's new, Tuning Room, Control Room if MANAGER+) · account footer with Logout.
- **Tablet sidebar** (iPad/Mac) with pinned/recent project shortcuts — Android tablets: `NavigationSuiteScaffold` rail/drawer **[P4, optional]**.
- **Search** — `Views/SearchView.swift` **[P2]**: ≥ 2 chars, 300 ms debounce; Projects, Tasks, Docs, Forms, Members.

### 3.3 Home
- **Dashboard** — `Views/DashboardView.swift` **[MVP: minimal; P2: full]**. Greeting by WIB time; level card (level, XP bar, streak) → detail; search row + bell with unread badge; bell panel (filters All/Tasks/Attendance/Messages/Submissions/Tickets/Announcements/Other, newest 8, Mark all); **3 stat cards**: Projects, Your Mission (done/total my tasks), **Quest** (done/total; the Quest panel is the **only** place to claim quest XP — "Claim" on claimable quests, one claim at a time, error shown in the panel); XP / Points rules card (§2.7 numbers); passkey nudge; quick actions (Chat, Attendance, Leaderboard, Room Booking, Threads, Team Calendar); project shortcuts; 14-day agenda of tasks due; profile card. MVP Home = greeting, attendance status card linking to Attendance, bell/inbox entry, announcements.

### 3.4 Attendance — see §2.12
- `Views/AttendanceView.swift` (hero, buttons, flow, metrics, streak board, record actions) **[MVP]**
- `Views/AttendanceRequestsView.swift` (Submissions card, filters/search/3-day default, RequestFocusSheet, RejectReasonSheet, RequestComposerSheet, offsite review) **[MVP]**
- `Views/LivenessCaptureView.swift`, `FaceGuard.swift` **[MVP]**
- `AttendanceQueue.swift`, `LocationManager.swift` **[MVP]**
- `WorkLocationTracker.swift`, `WorkTrailPolicy.swift`, `Views/LocationTrailView.swift` (in progress) **[MVP]**
- `Views/ReflectionsView.swift` **[MVP: own; P4: others]**
- `Views/AttendanceOfficesView.swift` **[P4]**
- `Views/MemberAttendanceSheet.swift`, `Views/AttendanceAdminView.swift` **[P4]**

### 3.5 Tasks and projects
- **My tasks ("My Quest Log")** — `Views/TasksView.swift` **[P2]**: Hot today (open, due ≤ ~2 d, max 8), In motion (max 12), Recently slayed (done, max 8); done toggle; lane, comments, priority chip; empty "No quests yet" → "Browse missions".
- **Projects ("Mission Control")** — `Views/ProjectsView.swift` **[P2]**: "+" New mission / New folder; search (projects locally + debounced task search); nested folder tree (edit/delete, move project to folder); project cards (icon emoji or image, brief, status ACTIVE/AT_RISK/OFF_TRACK/COMPLETED, cards/done/lanes, progress, members, deadline); create project (name, 8 emoji, 8 colours) and folder (name, emoji or uploaded icon, colour).
- **Folder aggregate** — `Views/FolderAggregateView.swift` **[P2]**: month calendar of all tasks across the folder subtree, project colour legend (recolour), pick projects.
- **Project detail** — `Views/ProjectBoardView.swift`, `Views/ProjectTabsView.swift`, `Views/ProjectTabExtras.swift` **[P2]**: tabs Overview, **Board** (lanes, drag between lanes, "move to" menu, inline add per lane, subtasks under parents), **List**, **Spreadsheet** (columns incl. custom fields), **Calendar** (Monday-first month, add task on a day), **Timeline** (Gantt, today line, ±3 d default for undated), Sprints (create, start, finish), Automations (toggle only; "Set up rules from the web app"), Pages (read docs), Forms, Finance (only if project name contains "finance"), P&L (only if enabled and BoD/OAA), Chat (project room). Token search across title/lane/status/priority/parent/assignee/custom fields with match count. 403 ⇒ "Project locked — you're not a member".
- **Create task** (in ProjectTabsView): title, lane, priority NONE→URGENT, deadline, custom fields by type (NUMBER, DATE, SELECT/STATUS, MULTI_SELECT, PLACE label + Maps link, TEXT).
- **Project settings** — `Views/ProjectSettingsView.swift`, `Views/ProjectSettingsExtras.swift`, `Views/AddProjectPeopleSheet.swift` **[P2]**: identity, task duplicate mode, P&L toggle (BoD), auto-assign, custom field editor (Dropdown, Multi-select, Status, Number incl. Rupiah, Date, Place), members (add from roster, invite by email as GUEST/MEMBER/VIEWER, remove), duplicate project, delete project.
- **Task detail** — `Views/TaskDetailView.swift`, `Views/TaskDetailExtrasView.swift`, `Views/CustomFieldChips.swift` **[P2]**: parent link; title; status/priority/start/due chips; quest banner ("Make it a quest" for BoD: title + XP 1–50, XP to assignee on DONE); assignees (multi-select); custom fields inline; description; subtasks; **attachments** (upload with progress, chunked for large files; preview image/PDF/video/audio, else share; delete with confirm); **dependencies** (blocked by / blocking, picker); **time tracking** (log minutes, total, last 6); **comments** (list + composer, mentions); activity (last 12); delete task. Likes/reactions on comments exist on the web (`553474c`: unlike, remove reaction) — confirm iOS parity in API.md before building.

### 3.6 Communication
- **Messages** — `Views/MessagesView.swift`, `MessagesModels.swift`, `Views/NewConversationSheet.swift` **[P3]**: Direct / Groups / Projects sections, unread badges, poll 15 s (thread 5 s) — Android SHOULD use the existing Socket.IO realtime if API.md confirms it, else poll; thread with image bubbles (full-screen viewer), location cards, task-link cards, @mention highlight; **reply**: swipe right or long-press ⇒ quoted bar above composer, quote inside the bubble, tap quote scrolls to the original (`replyToId`, must belong to the conversation); composer "+" (send location, link a task, photo, camera), "@" suggestions, upload progress; add people (project/group; adding to a project chat adds to the project), rename group; new chat: one person ⇒ DM, several ⇒ group with optional name.
- **Threads (feed)** — `Views/ThreadsView.swift` **[P3]**: composer up to 4 photos; posts with like, comments, mentions; post thread with comments; BoD can delete any post.
- **Inbox ("Signal Inbox")** — `Views/InboxView.swift` **[MVP]**: unread count, Mark all, group filters, rows route via the notification-link contract; external http links open outside the app; empty "Inbox clean" / filtered "Nothing of this kind" + "Show all".
- **Tickets** — `Views/TicketsView.swift` **[P3]**: filters All/Open/In review/Resolved/Closed; new ticket (category Attendance / EXP-Gamification / Leave-Day-off / Other; subject 4–140; body 10–4000; **1–5 evidence photos required**); detail with conversation (You / BoD / GIDEON), status menu for managers, reply; **attendance correction** proposals (date, check-in/out times, reason ≥ 10) with Approve/Reject for deciders and cancellation proposals that return XP/day-off token.
- **Push deep links** — `AppRouter.swift`, `NotificationManager.swift` **[MVP]** — contract in §4.6.

### 3.7 Forms, submissions, docs, vault
- **Forms list** — `Views/FormsView.swift` **[P3]**: forms across projects (name, project, Public chip, submission count); built by BoD on the web.
- **Form fill** — `Views/FormFillView.swift`, `FormFillAPI.swift` **[P3]**: text, textarea, currency (Rp), date, dropdown, multi-select, checkbox, **file (multiple; Take a photo / Choose from Photos / Browse files)**, read-only; autofilled name/email; optional extra attachment per field; required-field list; 50 MB per file + total ceiling; progress; "Form not open yet" / "Form unavailable"; "Submitted — thank you!". Opened by `/f/<id>` links.
- **My Submissions** — `Views/SubmissionsView.swift` **[P3]**: read-only kanban ("status is set by the Finance team"), detail with answers, stage chips, decided-by/when, "Bukti Pencairan" (payout proof) images.
- **Knowledge Library (docs)** — `Views/DocsView.swift` **[P3, read-only]**.
- **Z Vault** — `Views/VaultView.swift`, `VaultAPI.swift`, `Views/VaultSharedFileView.swift`, `Views/AttachmentViewerView.swift` **[P3]**: search, folders, quota bar (60 GB total incl. trash), breadcrumb, upload (chunked; not resumable), new folder, rename, move to trash, restore, delete forever, empty trash; share sheet: **Internal** (`/v/`, needs an account, opens in app) vs **External** (`/s/`, anyone, stays in browser — never claimed by the app), allow download, expiry 3 d / 7 d / 2 w / 1 m / permanent, list/copy/revoke links with view counts. Cache keyed by item id must be invalidated when bytes change (known iOS trap).

### 3.8 People, performance, gamification
- **Reports** — `Views/ReportsView.swift`, `Views/PersonReportView.swift`, `ReportsPeopleAPI.swift` **[P3]**: **Me** / **My team** (direct reports only for managers; everyone for BoD/OAA/ADMIN; staff see only themselves, no team medians or ranks); period menu = current 28→27 period + last 5; KPIs vs previous period (completed, on time, overdue now, attendance, late, XP), completed-per-week chart, overdue tasks, by project, attendance grid, XP section; multi-assignee tasks count **divided**; roster flags ("3+ overdue", "Late 3+ times", "Few reflections").
- **Leaderboard** — `Views/LeaderboardView.swift` **[P3]**: monthly, resets on the 1st 00:00 WIB; podium; rows open profiles.
- **Member profile** — `Views/MemberProfileView.swift` **[P3]**: role, email, joined, Message button, level/XP/streak, shared teams & projects, XP log only for self or BoD.
- **Team calendar / Room booking** — `Views/AgendaViews.swift` **[P3, read-only as on iOS]**.
- **Teams** — `Views/TeamsView.swift`, `Views/TeamDetailView.swift` **[P4]** (no navigation entry on iOS; reached from Control Room): rename, division, shift hours, members, main attendance team, linked projects.

### 3.9 Settings ("Tuning Room")
`Views/SettingsView.swift`, `Views/SettingsExtras.swift`, `Views/ChangeEmailSheet.swift`, `Views/DeleteAccountSheet.swift`, `Views/OfflineCard.swift`
- Update row (available / deadline) **[MVP]**; permission banners **[MVP]**
- Profile: avatar upload (re-encode to JPEG; PNG/JPG/WEBP ≤ 5 MB) / remove, name, email with **Change** (code sent to the new address) **[P2]**, Google Workspace address (read-only) **[P2]**
- **Appearance** (light / dark / system) **[MVP]**; **Language** (English / Bahasa Indonesia, immediate) **[MVP]**
- Offline copy **[P3]**; **Members & invite** (BoD+: invite by email + role, result says whether the email went out; change role / remove per tier rules) **[P4]**
- Change password (current + new ×2) **[P2]**; passkeys **[P2]**
- Logout **[MVP]**; **Delete account** (type DELETE; deactivates and anonymises — history kept as "Deleted account") **[MVP — Play requirement, §4.10]**

### 3.10 Control Room (MANAGER+) — `Views/AdminEditViews.swift` **[P4]**
Tabs in this order: **Users · Absensi · Audit · Quests** (MANAGER+), then **Pengumuman · GIDEON · App** (BoD/OAA only).
- **Users**: role stat filters; "Bagan Approval" (BoD+); search; badges Flexi/Mobile/Google; "Approver: X" / "Not placed on the Approval Chart"; "Not in the workspace yet" list with **Masukkan** (moves the person in and absorbs their empty personal workspace). **User detail** (`Views/AdminUserDetailView.swift`): role, account (photo, name, login email, password ≥ 8), approver (picker grouped by role; "Lepas dari bagan"), **Flexi Time** / **Mobile mode**, rest days (presets), shift & day-off sheet, Google Workspace link/create mailbox (temp password shown once), teams & projects, delete account (reassigns their work).
- **Approval chart** — `Views/ApprovalChartView.swift`: zoom/pan tree, colour by role, "Not placed" strip, stats, tap to change approver (descendants excluded), export PNG.
- **Absensi** — `Views/AttendanceAdminView.swift`: per-member shift & day-off, public-holiday quota per month, holidays list.
- **Audit** — `Views/AdminAuditViews.swift`: search, filters (All/Create/Update/Delete/Login), grouped by day, paged 50, **detail sheet** (what changed from→to, details with links, technical: user agent, IP, entity, metadata).
- **Quests**: create (task_count, overdue_cleared, priority_done, has_overdue penalty; target; XP ≤ 50; deadline), delete.
- **Pengumuman**: create (title, body, tone, repeat once / +2/+3/+5/+7 days at a WIB hour), activate/deactivate, delete, read count.
- **GIDEON usage**: people, questions, tools used; never the questions themselves.
- **App installs**: using / not using / devices; per person OS + app version or "Not reported"; "NOT USING THE APP" list with last activity. SERVER CHANGE: installs must carry platform so Android shows as Android.

### 3.11 GIDEON — `Views/GideonPanel.swift`, `Gideon.swift` **[P3]**
Floating launcher on Home; sheet with tier menu (Astra, **Luna default**, Terra, Experimental); streaming SSE answers with tool list; attachments (photo, camera, file: pdf/txt/md/csv/json/docx/xlsx/pptx/… ≤ 10 MB; images downscaled to 1568 px); conversation survives closing; queued questions; Clear chat.

### 3.12 iOS-only surfaces — nothing to build now
| iOS surface | File(s) | Android now | Android later |
|---|---|---|---|
| Apple Watch app (status, crew dots, approvals) + complication | `Watch/`, `WatchWidgets/` | none | Wear OS: read-only status + approvals only, never check-in (REQ-ATT-40) |
| Live Activity / Dynamic Island (work-session timer, pending taps) | `LiveActivityController.swift`, `Widgets/WorkSessionLiveActivity.swift` | **Ongoing notification** of the tracking foreground service = the work session: office, "Since HH:mm" chronometer, expected end, pending-tap count (amber), tap ⇒ Attendance. No check-out action on it. | Android 16 "live updates" / progress-style notification |
| Home/Lock Screen widgets (today's state, 7-day dots, glance) | `Widgets/`, `AttendancePresence.swift`, `GlancePresence.swift` | none | Glance home-screen widget reading a local snapshot (P5) |
| Siri / App Shortcut "Open attendance" | `NexusIntents.swift` | static launcher shortcut "Attendance" (opens screen only) | — |
| Mac Catalyst app, webcam capture | `DeskCameraCapture.swift` | n/a (ChromeOS: read-only card) | — |
| Office LAN shortcut (`lan.nexus.znetworks.id`, probed per network) | `LANRoute.swift` | none (optional) | P5 optimisation for uploads on office Wi-Fi |

### 3.13 Web features iOS 0.1.6 lacks (not in Android scope unless decided)
Room booking create/edit/delete; Team Calendar custom sources CRUD; doc editing; form builder; Integrity (peer reports); Social Approvals (Buffer); OAuth consent; room door display. Listed for the parity rule (`nexus-web-mobile-parity`); see open questions.

---

## 4. Android-specific requirements

### 4.1 Platform targets
- **minSdk 26 (Android 8.0)** recommended. Reasoning: in Indonesia the installed base is dominated by Android 11–15 on Xiaomi/Oppo/Vivo/Samsung/Realme mid-range devices; ≤ 7.x is a low single-digit share and NEXUS has ~40 staff, not a public audience. API 26 gives native notification channels, reliable Keystore-backed AES, and the modern background-execution baseline, while every library here (CameraX, ML Kit, Fused Location, WorkManager, Credential Manager, Compose) supports it. **Verify against the real fleet** before locking it (open question 1); if every staff phone is ≥ Android 10, raise to **minSdk 29** — background location then always has its own permission and the 8–9 code paths disappear.
- **targetSdk**: the level Google Play currently requires for new apps (Android 16 / API 36 as of the Aug 2026 deadline — confirm in Play Console at setup).
- Phone portrait first; tablets use the same UI in a wider layout.
- Application id: `id.znetworks.nexus` (same as iOS bundle id) unless Play reserves it otherwise.

### 4.2 Architecture
- Kotlin, Coroutines/Flow, Jetpack Compose + Material 3, Navigation Compose, Hilt (or Koin), Retrofit/OkHttp + kotlinx.serialization, Room for offline caches, DataStore for settings, WorkManager, Coil for images.
- Networking: base `https://nexus.znetworks.id`; session sent as the `Cookie` header on every request to allow-listed NEXUS hosts only; `Accept: application/json`; `X-Nexus-Client` on every request; a 426 interceptor feeds the version gate; 401 ⇒ sign-out, handled per REQ-ATT-16 (session expiry keeps the queue for the same user).
- Design tokens ported from `Theme.swift` (violet accent, fonts from `Sources/Fonts`), light/dark/system; login screen light-only.
- Empty states, offline notices and the "say why the button is disabled, next to the button" pattern are part of the component library from day one.

### 4.3 Camera and liveness
- **CameraX** (`Preview` + `ImageAnalysis` at ~640×480, `STRATEGY_KEEP_ONLY_LATEST`; `ImageCapture` for the final still, front lens).
- **ML Kit Face Detection, bundled model** (`com.google.mlkit:face-detection`), `PERFORMANCE_MODE_FAST`, `CLASSIFICATION_MODE_ALL` (eye-open probabilities), tracking on; head Euler Y for yaw.
- Final JPEG ≤ ~1 MB (quality ~0.8, long edge ~1280), EXIF orientation normalised so the server receives an upright face.
- Screen-as-light: `window.attributes.screenBrightness = 1f` while lit, restored on exit.
- Other photo capture (permit/sick evidence, chat, forms, tickets): `ActivityResultContracts.TakePicture` with a `FileProvider` URI (rear camera).

### 4.4 Location
- `FusedLocationProviderClient` for fixes (REQ-ATT-06), `GeofencingClient` + fused updates in a `location`-type foreground service for REQ-ATT-33…38.
- Permissions: `ACCESS_FINE_LOCATION`, `ACCESS_COARSE_LOCATION`, `ACCESS_BACKGROUND_LOCATION` (API 29+), `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_LOCATION` (API 34+), `POST_NOTIFICATIONS` (API 33+), `RECEIVE_BOOT_COMPLETED`.
- Approximate-only grant (Android 12+) is not enough to take attendance: explain and route to Settings to allow precise location.
- Device location switched off ⇒ `SettingsClient.checkLocationSettings` resolution dialog.
- Maps: Google Maps Compose (office picker, trail, offsite review) — needs a Maps API key restricted to the app signature.

### 4.5 Push (FCM)
- **SERVER CHANGE (Phase 0, blocking MVP):** `/api/push/devices` accepts only APNs hex tokens and `bundleId=id.znetworks.nexus`; `DeviceInstallation` has no platform column. Needed: a `platform`/provider field, FCM token validation, FCM HTTP v1 sender (service-account credential; use a dedicated env name — `GOOGLE_SERVICE_ACCOUNT_*` belongs to finance), invalid-token cleanup, and the installs report showing platform. Every notification that pushes to iOS must push to Android with the same payload keys (`type`, `link`, `taskId`, `projectId`, title naming the person).
- Register on sign-in and on token refresh; send app version, build, OS, device model; unregister on logout.
- Notification channels (user-visible names in both languages):

  | Channel | Importance | Content |
  |---|---|---|
  | `attendance_reminders` | high | shift −30/−15/0, check-out time, TK at 08:00 |
  | `attendance_location` | high | 1 h 30 reminder, 2 h warning (action **"File a permit"** ⇒ `/attendance?permit=today`), auto offsite check-out |
  | `work_session` | low, ongoing | the tracking foreground-service notification |
  | `approvals` | high | request filed / decided, offsite check-out, escalations |
  | `messages` | high | chat, mentions (MessagingStyle, reply-in-notification optional later) |
  | `tasks` | default | assigned, comment, mention, due |
  | `tickets` | default | replies, status, GIDEON answers |
  | `announcements` | high | announcements (incl. repeats) |
  | `system` | low | app update reminder, queued attendance refused/held |

- Notification actions allowed: "File a permit" (opens app), open-record taps. **No** approve/reject from the notification shade in the MVP (the request must be seen first), and never any check-in/out action.
- Handle a foreground `attendance_auto_offsite_checkout` by refreshing today and stopping the tracker.

### 4.6 Deep links
- **Notification link contract** (server → clients, since 0.1.5): `/attendance?request=<id>`, `/attendance?offsite=<recordId>`, `/attendance?permit=today`, `/complaints?id=<id>`, `/messages?c=<conversationId>` (also `/messages/<id>`), `/dashboard?announcement=<id>`, `/submissions?id=<id>`, `/threads?post=<id>`, `/tasks/<id>`, `/projects/<id>`, `/projects/<id>/tasks/<tid>`, and screen paths (`/inbox`, `/attendance`, `/forms`, `/vault`, `/reports`, `/leaderboard`, `/room-booking`, `/master-calendar`, `/settings`, `/admin`, …). Precedence for a push: `taskId` → `projectId` → `link` starting with http (open externally) → `link` path → fallback by `type`. A link for a screen not yet built in the current phase opens the web page in a Custom Tab rather than doing nothing.
- A focus target is held until its screen claims it (a request id that is not in the list ⇒ the "isn't in your list anymore" alert). Links arriving while signed out are replayed after sign-in.
- **Custom scheme** `nexus://<screen>` (dashboard, tasks, inbox, projects, messages, threads, submissions, teamCalendar, roomBooking, leaderboard, reports, docs, forms, vault, attendance, tickets, teams, settings, admin), `nexus://register?code=`, `nexus://forgot-password?email=&invited=1`.
- **Android App Links** for `https://nexus.znetworks.id` with `autoVerify`, paths: `/f/` (form fill), `/v/` (internal vault file), `/register`, `/forgot-password`. **`/s/` MUST NOT be claimed** (external vault links must stay in the browser for people without an account). Claim a path only in the build that can handle it — an app that opens on a link and shows nothing is worse than the browser.
- **SERVER/WEB CHANGE:** publish `https://nexus.znetworks.id/.well-known/assetlinks.json` (package `id.znetworks.nexus`, SHA-256 of the **Play app-signing** certificate and the upload certificate) with relations `delegate_permission/common.handle_all_urls` and `delegate_permission/common.get_login_creds` (passkeys). It must be served from the SPA `dist` beside the existing `apple-app-site-association` without disturbing it (`webcredentials` there keeps iOS passkeys alive). Today only the AASA exists.

### 4.7 Background work
- **WorkManager**: attendance queue flush (expedited, network-constrained, unique work, exponential backoff but never counting "unreachable" as an attempt), location-trail upload, periodic offline warm-up (DATA stage every few hours on unmetered/charging where possible), media prefetch (unmetered unless the user allows mobile data).
- The tracking foreground service owns location; WorkManager owns uploads.

### 4.8 Security and storage
- Session cookie encrypted at rest: AES-GCM key in the **Android Keystore** (StrongBox when available), ciphertext in DataStore (Jetpack `security-crypto` is deprecated; use Tink or a thin Keystore wrapper).
- `android:allowBackup` limited by `dataExtractionRules`/`fullBackupContent`: exclude session, attendance queue, selfies, trail points.
- Cleartext traffic disabled; cookie sent only to allow-listed hosts.
- Passkeys via **Credential Manager**; SERVER CHANGE: WebAuthn verification must accept the Android origin (`android:apk-key-hash:<base64url sha256 of signing cert>`) alongside `https://nexus.znetworks.id`.
- Screenshots allowed (no `FLAG_SECURE`) unless the owner decides otherwise.

### 4.9 Files
- Pickers: Android Photo Picker (`PickVisualMedia`, no storage permission) for photos; `OpenDocument` (SAF) for files; camera via `TakePicture`. Every attachment point offers **camera, gallery and files**, as iOS 0.1.6 does.
- Uploads send a real MIME type and a sensible file name; HEIC/HEIF re-encoded to JPEG where the server accepts only PNG/JPG/WEBP (avatar, chat).
- Downloads via the app cache + share sheet / `ACTION_VIEW`; in-app viewers for images, PDF (`PdfRenderer`), video/audio (Media3).
- Size limits mirror the server (requests 10 MB, forms 50 MB per file, GIDEON 10 MB, chat images 8 MB, avatar 5 MB).

### 4.10 Google Play requirements
- **Developer account** (open question): an **organisation** account (D-U-N-S) avoids the rule that new *personal* accounts must run a closed test with ≥ 12 testers for 14 days before production.
- **Background location declaration** (Play Console → App content → Sensitive permissions): core-feature justification ("records staff location between check-in and check-out so managers can see extended absences from the office; nothing inside the office"), a **short video** showing the in-app prominent disclosure, the permission grant, the persistent notification, and where the location is used (trail on the record). Expect review delay; submit in Phase 0/1 on the internal track.
- **Prominent disclosure** in-app before the runtime prompt, containing the words "location", "even when the app is closed or not in use", the purpose, and a clear accept/decline.
- **Foreground service type declaration** for `location` (Play Console form, same video can serve).
- **Data safety form**: precise + approximate location (collected, background, not shared, required for attendance), photos (selfies, evidence — collected), name/email/user ids, app activity (tasks, messages, forms), files, device identifiers (FCM token, device model/OS). Encrypted in transit: yes. Deletion: yes.
- **Account deletion**: in-app flow exists (REQ in §3.9) **and** Play requires a **web URL** where a user can request deletion without the app — SERVER/WEB CHANGE if the current web delete (inside Settings, login required) is not accepted as-is (open question).
- **Privacy policy URL** covering attendance photos, location trail (90-day retention), and GIDEON processing.
- Target audience: adults, not for children. App category: Business.
- **Release channels**: **internal testing** first (up to 100 testers — covers all staff), then closed testing with Android staff, then production (or keep it as a private/managed app — open question). Play **In-App Updates** for the forced-update flow.
- **Store listing / release notes**: follow the owner's style — ALL-CAPS hook, short lyric-like lines, a twist, English with real Indonesian quotes, never mention XP cuts or outages, no "update now" CTA, public name "Bagas".

---

## 5. Phased delivery plan

Every phase ends with: compat replay green, prod smoke test on real Android devices (at least one Xiaomi, one Oppo/Realme, one Vivo, one Samsung), owner sign-off, internal-track release. Web parity is checked per capability, not per screen.

### Phase 0 — Server and web prerequisites (SERVER/WEB CHANGE; no Android release)
- FCM device registration + sender + platform on `DeviceInstallation`; installs report by platform.
- Android client tag recognised; Android version policy (floor, latest, grace, store URL) + 426 for Android below floor; `scripts/compat/run.sh` gains Android scenarios.
- `assetlinks.json` published (after the Play signing key exists); WebAuthn Android origin accepted.
- Live-location endpoints (trail, status, record trail) live and documented in API.md.
- Play Console: app created, organisation/personal decision, background-location declaration drafted.
- **Acceptance:** an FCM test token registers and receives a push; `curl -H 'X-Nexus-Client: android/0.0.1/1'` on an attendance write returns 426 once the floor is 0.0.2 and 200 below it (on a test DB); assetlinks passes the Digital Asset Links API check; compat replay passes with Android scenarios.

### Phase 1 — MVP: attendance end to end
Login (password) · logout · delete account · attendance screen (hero, nearest office, PRESENCE IN/OUT, reflection, offsite, forgotten check-out, metrics, crew board for own/direct reports/BoD, day detail with selfies and trail, BoD record actions) · liveness + face guard · requests composer (all five types with every rule in §2.8) and review queue (filters, search, 3-day default, reject reason, focus sheet) · offsite review · offline queue · live location (foreground service, disclosure, OEM whitelist guide, ongoing work-session notification) · FCM push with channels + deep links for attendance/approvals/announcements + inbox · announcements modal · forced-update lock + grace + held queue · language + appearance · minimal Home. Links to not-yet-built screens open the web in a Custom Tab.
- **Acceptance (all must pass on the four OEM devices):**
  - Check-in inside radius with liveness ⇒ record on the server with selfie, `accuracyM`, `simulated=0`, `checkInClient` Android, correct WIB time.
  - Photo of a person on another screen cannot pass liveness; a wall photo is refused by the face guard.
  - Airplane-mode check-in at T, sync at T+2 h ⇒ recorded at T, `offline=true`, one record even if the first reply was lost (same `clientId`).
  - Server stopped (502/530) ⇒ tap queued, banner shows count, PRESENCE OUT enabled; server 409 ⇒ not queued.
  - Check-out blocked below 200 characters; offsite check-out lands PENDING and appears in the approver's queue.
  - Request composer: only one date; Permit cannot pick yesterday, needs photo + locked location; Sick can pick yesterday; Leave/Public holiday hidden when not usable; day-off with 0 left blocked before submit; a "lupa absen" permit reason shows the server's refusal.
  - Approver gets a push naming the requester; tapping opens the request with Approve/Reject; a manager sees only direct reports.
  - Live location: outside 15 min ⇒ ≥ 1 point; outside with the phone locked 2 h 30 ⇒ reminder at 1 h 30 with working "File a permit", warning at 2 h, auto offsite check-out at 2 h 30; check-out stops the service and the notification; declining "Allow all the time" shows "location off" on the board.
  - Raising the Android floor above the build ⇒ lock on next foreground and after a cold start in airplane mode; a tap during the lock is held and sent with its original time after updating.
  - Day-off shows "4/4" at most; flexi member sees 12:00–15:00 and an expected end of check-in + 9 h.
- **Then (owner decision needed):** announce Android app to Android staff; watch the App tab until every Android user runs it.

### Phase 2 — Tasks and projects
Full Dashboard (stat cards, Quest claim, XP rules, agenda, shortcuts) · search · My tasks · projects & folders · board/list/spreadsheet/calendar/timeline/overview/sprints/automations toggle/pages/finance/P&L · create/edit task, custom fields, subtasks, attachments (camera/gallery/files), dependencies, time, comments/mentions, quests · project settings & members · sign-up, forgot password, change email, change password, passkeys · What's New.
- **Acceptance:** every API call used by iOS for these screens has an Android caller (compare call lists, not screens); drag a task between lanes and see it on the web; a 200 MB attachment uploads with progress and survives a network blip per the server's chunk rules; `/register?code=` and `/forgot-password?invited=1` App Links open the app; passkey sign-in works on a device with a screen lock.

### Phase 3 — Communication and knowledge
Messages (DM/group/project, photos, location, task links, mentions, **reply**) · Threads · Tickets + attendance corrections · Forms (+ `/f/` links, all field types, files from camera/gallery/files) · My Submissions · Knowledge Library · Z Vault (+ `/v/` links, share links) · Reports (Me / My team) · Leaderboard · Member profiles · Team calendar / Room booking (read-only) · GIDEON panel · offline warm-up full (DATA + MEDIA, Offline copy card).
- **Acceptance:** reply to a message from Android and the quote shows on web/iOS; a `/v/` link opens the file in the app while an `/s/` link stays in the browser; a manager's "My team" lists exactly their direct reports; staff see no one else's numbers; with no signal, projects/tasks/today's attendance/crew board open with "Saved copy from …".

### Phase 4 — Administration
Control Room: Users + user detail, approval chart, Absensi (shifts, day-off, public-holiday quota, holidays), offices, member attendance sheet + export, reflections of others, Audit with detail, Quests, Announcements (repeat), GIDEON usage, App installs · Teams/Team detail · Members & invite in Tuning Room.
- **Acceptance:** each action is permitted/denied exactly as on iOS for STAFF/MANAGER/BOD/OAA test accounts; changing someone's approver moves the next request's notification to the new approver only; audit shows the Android action with the Android user agent.

### Phase 5 — After adoption
- **Close web check-in** (SERVER/WEB CHANGE): only after every active Android staff member has the app on a supported version (App tab: 0 Android users "not using the app"), announced in advance; reading attendance on the web stays open. Follow `absensi-verifikasi-sebelum-deploy`: count check-ins by client first, then close.
- Home-screen widget (Glance), optional Wear OS status/approvals, LAN upload shortcut, tablet navigation rail, suspect-record review UI (web + both apps).

---

## 6. Open questions for the owner

1. **Device fleet.** Can we collect the Android version + brand of every Android staff phone (a one-question form, or the web's user agent from recent logins)? Decides minSdk 26 vs 29 and which OEM guides to test first.
2. **Version number.** Should Android launch as **0.1.6** to share one number with iOS/Mac (as the Mac did), or start at 1.0.0 / 0.1.0?
3. **Minimum-version policy for Android.** Same rule as iOS (floor = new version 3 days after it is live), with "live" defined how — the server's own record of a Play rollout reaching 100 %, or a value you set?
4. **Distribution.** Public Play listing, unlisted, or a private app via Managed Google Play? Organisation developer account (needs D-U-N-S) or personal?
5. **Account deletion URL.** Is a web page that says "Tuning Room → Delete account, or email X" acceptable, or should the web get a signed-out deletion request form?
6. **Huawei / devices without Google Play services.** Any staff on recent Huawei phones? Without GMS there is no FCM, Fused Location or ML Kit bundled via Play — support them or require a GMS device?
7. **Approve/reject from the notification shade** — keep it in-app only (current proposal), or allow quick actions for approvers?
8. **Web check-in closure date.** Hard date after launch, or strictly "when the App tab shows every Android user on the app"?
9. **Battery-optimisation exemption.** OK to call the direct "Allow NEXUS to run in background" system dialog (`REQUEST_IGNORE_BATTERY_OPTIMIZATIONS`, Play-policy sensitive) instead of only sending people to Settings?
10. **Web-only features** (room booking CRUD, calendar sources, doc editing, form builder, Integrity, Social Approvals): out of scope for Android as they are for iOS, or should mobile gain some of them (parity rule applies both ways)?
11. **Tablets.** Is anyone taking attendance on an Android tablet? If not, phones only for check-in, tablets read-only.
12. **Wear OS.** Any demand for a watch status/approvals app, given it can never check in?
