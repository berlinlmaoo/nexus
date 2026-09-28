# Server requests from the Android session

What the Android app needs from the server/web, for the **main session** to build. Nothing here is
done by the Android session (CLAUDE.md, coordination rule 1). Each item: what, why, exact shape, and
how Android behaves before and after it lands. Server reference: `nexus` @ `6545d28`.

Status legend: **OPEN** (not started) · **DONE** (live, with commit) · **DROPPED**.

---

## R1. FCM push: data-only + the PRD channels — DONE (server a79796b, live 24 Sep 2026)

**Owner decision (24 Sep 2026):** data-only messages and the channel set from PRD §4.5.

**Why.** `buildFcmMessage` (`src/lib/fcm-payload.ts`) sends `notification` + `data`. With a
`notification` block, Android shows the notification **itself** whenever the app is in the background
or killed: `onMessageReceived` is never called, so the app cannot
- add the **"File a permit"** action for `category: NEXUS_OUTSIDE_OFFICE` (REQ-ATT-35),
- react to `attendance_auto_offsite_checkout` in the background (stop the tracker, re-read today),
- use `notificationId` to mark the inbox row read on tap, or build the tap intent from `link` with the
  routing precedence in API.md §3.3 (the system tray opens the launcher with extras instead),
- file the message under the right channel when the app is killed (the tray uses `channel_id` only).

**Shape.** Keep `data` exactly as today (all strings: `title, body, type, taskId?, projectId?, link?,
category?, notificationId?` + extras). Drop the top-level `notification` block and
`android.notification`. Keep `android.priority: "HIGH"` (needed for delivery while dozing).
Add `data.channel` = the channel id below, so channel choice stays on the server.

```json
{ "message": { "token": "…", "android": { "priority": "HIGH" },
  "data": { "title": "…", "body": "…", "type": "attendance_request_pending", "link": "/attendance?request=…",
            "notificationId": "…", "channel": "approvals" } } }
```

**Channels** (replace `androidChannelFor`; the app creates exactly these ids):

| channel | types |
|---|---|
| `attendance_reminders` | `attendance_checkin_reminder`, `attendance_checkout_reminder`, `attendance_absent_recorded`, `dayoff_quota_low`, `red_date_quota_low`, `attendance_override` |
| `attendance_location` | the outside-office reminder/warning (category `NEXUS_OUTSIDE_OFFICE`) and `attendance_auto_offsite_checkout` |
| `approvals` | `attendance_request_pending`, `attendance_request_reviewed`, `attendance_request_escalated`, `offsite_checkout_pending`, `offsite_checkout_reviewed` |
| `messages` | `MESSAGE`, `MESSAGE_MENTION`, `feed_mention`, `feed_comment` |
| `tasks` | `task_*`, `comment_*`, `project_invite`, `status_update`, `automation`, `submission_status`, `streak_at_risk`, `quest_claimable`, `booking_*` |
| `tickets` | `complaint_*`, `system_gideon`, `peer_report_*`, `violation_announcement` |
| `announcements` | `announcement` |
| `system` | `app_update`, `system_disk`, `google_workspace_*`, `test_notification`, anything unknown |

(`work_session` is local only: the tracking service's own notification.)

**Android side: DONE** (commit after 877aa21). The app creates all eight channels above plus
`attendance`/`messages`/`general`, reads `data.channel` when present (falls back to the type), draws
data-only messages itself with the "File a permit" action for `category: NEXUS_OUTSIDE_OFFICE`,
re-reads today on `attendance_auto_offsite_checkout`, and marks the inbox row read from
`notificationId` on tap. Push is configured from `~/.nexus-android-secrets/firebase.properties`
(projectId, applicationId, apiKey, senderId), so it stays off until the owner's Firebase project exists.

**Before it lands:** the app still works, but background notifications are shown by the system under
the old three ids (the app will also create `attendance`/`messages`/`general` so they are not lost), and
tapping one opens the app on Home instead of the target.

---

## R2. APK distribution (no Play Store yet) — DONE (server a79796b). Publish: copy the APK into `nexus-prod:~/nexus-data/android/`, then atomically replace `current.json` = `{versionName, versionCode, file, sha256?, releasedAt?, notes?}` (hand both to the main session). `/download/android` and `GET /api/app/android/apk` (+ `/api/app/android/release`) are live and exempt from 426

**Owner decision (24 Sep 2026):** sideloaded APK, download only for signed-in people.

1. **Storage.** Keep release APKs outside the web root, e.g. `nexus-prod:~/nexus-data/android/`
   (`nexus-<versionName>-<versionCode>.apk`). The Android session builds and hands over the file
   (signed with the release key below) plus its SHA-256.
2. **`GET /download/android`** (web page, same origin): signed-out → the normal login, then back here.
   Signed-in → the current version, size, release notes, a big **Download** button, and the short
   install guide (`docs/INSTALL-APK.md` in the Android repo, copy it). This is the URL the app opens.
3. **`GET /api/app/android/apk`**: session required (401 otherwise). Streams the current APK with
   `Content-Type: application/vnd.android.package-archive`,
   `Content-Disposition: attachment; filename="NEXUS-<version>.apk"`, `Content-Length`, and supports
   `Range` (a phone on bad signal should be able to resume). **Must be exempt from the 426 gate**
   (like `/api/app/version-policy`): a locked build has to be able to fetch its own update.
4. **Point `android.storeUrl` at the download page.** In `version-policy` (`android` block),
   `/api/app/latest` (`android`), and the 426 body for Android tags:
   `storeUrl = "https://nexus.znetworks.id/download/android"` instead of the Play URL. Suggest an env
   `NEXUS_ANDROID_STORE_URL` with that default, so moving to Play later is one env change.
   The app treats any `play.google.com` URL as unusable and falls back to `/download/android` already,
   so this can ship in any order.
5. **Optional, additive:** `android.apkSha256`, `android.apkSizeBytes` in both policy responses, for a
   later in-app downloader. Not needed now.
6. **`app_update` reminder** (`lib/app-update.ts`): for Android devices compare with
   `NEXUS_ANDROID_LATEST_VERSION` and link to `/download/android` (never the App Store link).

---

## R3. Release certificate fingerprint — DONE (in the container; `/.well-known/assetlinks.json` serves it)

Set on `nexus-prod`:

```
NEXUS_ANDROID_CERT_SHA256=53:22:FE:4C:77:ED:CC:73:36:81:76:67:0C:E5:D8:E1:41:C6:58:2D:4B:CD:36:E2:85:E0:EE:30:FF:A6:AD:26
```

Release key created 24 Sep 2026 (RSA 4096, valid to 2056). Keystore: `agents:~/.nexus-android-secrets/`
(not in git), backup `host:/mnt/nexus-backup/android-signing/`. This feeds `assetlinks.json` and the
passkey origin. Remember `NEXUS_ANDROID_CERT_SHA256` must be in the deploy's OVERRIDABLE list, or the
edit to `.env.production` will not win over the runtime value.

---

## R4. Android minimum/latest by env — DONE: grace window needs `NEXUS_ANDROID_LATEST_RELEASED_AT` (ISO) with `NEXUS_ANDROID_LATEST_VERSION`; main session sets them per release

Owner: "tayang" is set by hand via `NEXUS_ANDROID_LATEST_VERSION`, and the minimum follows the iOS
rule (new version becomes minimum 3 days after release) via `NEXUS_ANDROID_MIN_VERSION`. The app reads
only the `android` block. It has no grace window today (`nextMinimum`/`graceUntil` absent). If
you want the once-a-day "Update NEXUS by <date>" warning on Android too, add `nextMinimum` +
`graceUntil` to the `android` block (the app already handles them).

---

## R5. Android build numbers in the version policy and the 426 floor — DROPPED (Berlin, 28 Sep: versionName rises per published APK and stays what is compared; nothing to build)

**Decision (main session, 28 Sep):** versionName stays 0.1.6, versionCode +1 per APK; update offers and
the floor compare the **versionCode**.

**Why.** `android.minSupported/latest/nextMinimum` and the 426 gate (`src/lib/client-version.ts`,
`src/lib/version-policy.ts`) compare versionName only, so build 2 and build 3 look the same: a broken
build 2 can't be locked out in favour of build 3.

**Shape** (additive; the `android` block of `GET /api/app/version-policy`):
`minBuild?: number`, `latestBuild?: number`, `nextMinimumBuild?: number` (same meaning as the name fields,
for the versionCode). The 426 gate: the header is already `X-Nexus-Client: android/<versionName>/<versionCode>`;
refuse when `versionCode < minBuild` too, with the same body (`minSupported`, `storeUrl`) plus `minBuild`.
`latestBuild` can come from `current.json.versionCode`.

**Android before:** "Update available" already compares `versionCode` from `GET /api/app/android/release`
(signed in); no build floor. **After:** reads the three fields (already implemented and tested:
`VersionGate.evaluate`, `lockLifted` with a persisted build floor), no app change needed.

## R6. Review of suspect attendance records (PRD Phase 5) — OPEN (28 Sep 2026)

**Why.** Check-in/out already carry a server verdict (`checkInSuspect` / `checkInSuspectReason` /
`checkInImpliedKmh`, same for check-out; `src/lib/attendance.ts` integrity check) but nothing lets anybody
look at them: no list, no "reviewed" state, no decision. PRD Phase 5 asks for a review UI on web + iOS +
Android; Berlin (28 Sep): Android builds it only once the endpoints exist. Nothing is built on Android yet.

**Proposed shape** (BoD / One Above All; a direct manager sees their reports only, like offsite review):
- `GET /api/attendance/suspects?period=YYYY-MM[&status=open|reviewed|all]` →
  `{ period, items: [{ recordId, side: "in"|"out", user: {id,name,avatar}, attendanceDate, at, reason,
  impliedKmh, accuracyM, simulated, distanceMeters, address, photoUrl, officeName, review: null |
  {verdict: "cleared"|"confirmed", note, by: {id,name}, at} }], counts: {open, reviewed} }`,
  newest first. `reason` as the server's own sentence (or a code + sentence).
- `POST /api/attendance/suspects/{recordId}/review` `{ side: "in"|"out", verdict: "cleared"|"confirmed",
  note?: string (≤ 500) }` → `{ review }`; idempotent per side; audit-logged. "Confirmed" changes no status
  by itself — a penalty or status change stays the existing override flow (`/api/attendance/override`),
  so the review can link to it.
- Schema: per side `…SuspectReviewedAt`, `…SuspectReviewedById`, `…SuspectVerdict`, `…SuspectNote`.
- Optional: `suspect` + `review` on history rows (board day sheet badge) and a push to BoD when a new
  suspect record lands (channel `attendance_approvals`), deduplicated per record.

**Android after it lands:** Control Room › Absensi gets a "Suspect records" list (open/reviewed, period
switch) with the evidence (selfie, map point, speed, accuracy, mock flag, reason) and Cleared / Confirmed
with a note; the board day sheet shows the badge. iOS and web the same.

## Found while porting (iOS, for the main session) — not Android work

### I1. Queued check-in refused for distance is retried 5× instead of dropped and said — DONE on iOS (caaca89). Server unchanged: adding `code` would flip live check-in into the offsite prompt on 0.1.4–0.1.6

`POST /api/attendance/check-in` answers an out-of-radius tap with 422
`{error, officeName, distanceMeters, radiusMeters}` and **no `code`** (`buildOutsideGeofenceResponse`,
check-in/route.ts). iOS `attendanceUpload` maps a 422 to `.outsideRadius` only when
`code == "OUTSIDE_RADIUS"` (check-out); for check-in it throws `APIError.transport(...)`. In
`AttendanceQueue.flush` that lands in the generic `catch` → `bumpAttempts`, so a queued check-in
taken outside the radius is replayed on five activations and then dropped with a generic sentence,
and the "Your check-in at HH:mm was refused…" line + local notification (REQ-ATT-14) never fire.

Fix (either): iOS treats a check-in 422 carrying `distanceMeters` as `.outsideRadius`; or the server
adds `code: "OUTSIDE_RADIUS"` to the check-in 422 (additive; the live iOS screen keys on
`officeName/distanceMeters` for its sentence, so it is unaffected). Android already handles both.

### I2. Managers can't see offsite check-outs on iOS — OPEN (parity)

`GET /api/attendance/offsite-checkouts` now serves a manager with direct reports (their reports
only, `isDirectManager` in the route), and those managers get the `offsite_checkout_pending` push.
iOS still shows the offsite queue only when `canManageAttendance` (`AttendanceRequestsCard(
canReviewOffsite: today?.canManageAttendance)`), so a manager taps the push and finds nothing to
approve. Android shows it for `canReviewAttendanceRequests || canManageAttendance` and treats a 403
as an empty list. Suggest iOS does the same.

### I2. Offsite check-out review was BoD-only on iPhone — DONE on iOS (afadd5c): direct managers see and decide their reports' offsite check-outs, as the server already allowed.
