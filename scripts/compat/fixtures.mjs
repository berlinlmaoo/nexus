// Fixtures: what each RELEASED client actually sends, and what it needs back.
//
// Sources (read these before editing a fixture — the whole point is to mirror the shipped code, not
// what we think the client does):
//   ios-0.1.4  nexus-ios @ 5bb9f5b  (build 8,  UA "NEXUS/8 …",  no X-Nexus-Client header)
//   ios-0.1.5  nexus-ios @ 02eabab  (build 11, UA "NEXUS/11 …", no X-Nexus-Client header)
//   ios-0.1.6  nexus-ios @ HEAD     (build 12, UA "NEXUS/12 …", X-Nexus-Client: ios/0.1.6/12)
//   ios-0.1.3  legacy build 7 (UA "NEXUS/7 …", no header). Source not pinned here; bodies modelled on
//              0.1.4. It exists to exercise the minimum-version gate, not to certify 0.1.3 itself.
//   web        apps/nexus-lovable-ui/src/lib/nexus-api.ts (X-Nexus-Client: web/1, FormData bodies,
//              session cookie from /api/auth/direct-login)
//   android-0.1.0  nexus-android docs/API.md (the contract the Android app is being built to; no Android
//              build has shipped yet — re-pin to the app's own ApiClient once it exists).
//              X-Nexus-Client: android/0.1.0/1, UA "NEXUS-Android/0.1.0 (1; Android 34)" (never NEXUS/<n>),
//              cookie login via /api/auth/app-login like iOS, OkHttp multipart (text parts without
//              Content-Type, files with their REAL MIME type), held to the 0.1.6 rules from day one.
//
//   git show 5bb9f5b:Sources/APIClient.swift          — checkIn/checkOut/createAttendanceRequest bodies
//   git show 5bb9f5b:Sources/Views/AttendanceRequestsView.swift — which types, START–UNTIL picker, photo
//   git show 5bb9f5b:Sources/AttendanceModels.swift   — which response fields are NON-optional
//
// Facts these fixtures encode (all verified in the pinned sources):
//   - iOS check-in/out: hand-built multipart; text parts have no Content-Type; the selfie part is
//     name="selfie" filename="selfie.jpg" Content-Type: image/jpeg. Live taps send lat, lng and the
//     CoreLocation fix (accuracyM, altitudeM, speedMps, simulated=0, fromAccessory=0); a replayed
//     offline tap adds clientId, deviceAt (ISO-8601, no millis), uptimeSec.
//   - iOS requests (0.1.4/0.1.5): fields type,startDate,endDate,reason — NEVER lat/lng. Attachment part
//     is name="supportingDocument", Content-Type: application/octet-stream (for every file, JPEG
//     included), filename "sick-note.jpg" for a camera/library photo (also for izin!) or the file's own
//     name from the Files picker. The date picker is START–UNTIL for every type (multi-day SICK and
//     PERMIT are possible), and UNTIL can lag behind START (0.1.4 picker bug) → end < start.
//     Photo is REQUIRED in the UI only for SICK; for PERMIT the UI says "(OPTIONAL)".
//   - iOS requests (0.1.6): same body plus lat/lng for PERMIT; SICK/PERMIT are single-day in the UI;
//     izin photo is "permit-photo.jpg"; photo required for SICK and PERMIT.
//   - iOS responses are decoded leniently (almost everything optional). Hard requirements:
//     login {ok, token, cookieName, user.id}; profile user.id; project id+name; board task id+title;
//     attendance record id; myShift startTime/endTime/source when present; request id.
//
// kind: "compat" — a released client does exactly this. A mismatch FAILS the run.
//       "policy" — the server's current rule for something the UI would not normally send (or sends
//                  and is refused on purpose). A mismatch is a WARN (so loosening a rule never blocks
//                  a deploy); a 5xx is always a FAIL.

export const PROFILES = [
  { id: "ios-0.1.3", style: "ios", version: "0.1.3", build: 7, header: null, legacy: true },
  { id: "ios-0.1.4", style: "ios", version: "0.1.4", build: 8, header: null },
  { id: "ios-0.1.5", style: "ios", version: "0.1.5", build: 11, header: null },
  { id: "ios-0.1.6", style: "ios", version: "0.1.6", build: 12, header: "ios/0.1.6/12" },
  { id: "web", style: "web", version: null, build: null, header: "web/1" },
  // The Android app. style "android" = a native client (app-login, token cookie, launch reads, push,
  // offline queue) like "ios", but with its own header, UA, multipart and version gate.
  { id: "android-0.1.0", style: "android", version: "0.1.0", build: 1, header: "android/0.1.0/1" },
]

/** A native app (iOS or Android) rather than the web: app-login, token cookie, offline queue. */
export const isNative = (p) => p.style === "ios" || p.style === "android"

// ---------- small helpers ----------
const isStr = (v) => typeof v === "string" && v.length > 0
// The Android release the harness publishes (run.sh ANDROID_LATEST + a 256 KiB fake APK).
const ANDROID_LATEST = process.env.COMPAT_ANDROID_LATEST_VERSION || "0.1.1"
const ANDROID_DOWNLOAD_URL = "https://nexus.znetworks.id/download/android"
const APK_SIZE = 262144
const need = (cond, msg) => (cond ? null : msg)
function firstError(...checks) {
  for (const c of checks) if (c) return c
  return null
}
function asArray(json, key) {
  if (Array.isArray(json)) return json
  if (json && Array.isArray(json[key])) return json[key]
  return null
}

// Honest, varied 250+ character reflection — passes assessReflection (≥20 words, ≥14 distinct, no
// padding, no repeated 4-grams). `tag` makes each user's text different from every other user's.
export function reflectionFor(tag) {
  return (
    `Catatan ${tag}: pagi ini saya merapikan jadwal konten minggu depan bersama tim desain, ` +
    `lalu memeriksa ulang rekap absensi bulan berjalan. Siang ada rapat singkat dengan klien soal ` +
    `revisi logo dan warnanya; catatan rapat sudah saya kirim ke grup. Besok saya lanjut menyiapkan ` +
    `draf presentasi kuartal dan menguji alur pengajuan izin di aplikasi.`
  )
}

// Jakarta calendar date (UTC+7, no DST), offset in days.
export function jktDate(offsetDays = 0) {
  return new Date(Date.now() + 7 * 3600e3 + offsetDays * 86400e3).toISOString().slice(0, 10)
}

// The 28→27 attendance period ("YYYY-MM" = the month it ends in) a Jakarta date falls in.
export function periodOf(dateKey) {
  const [y, m, d] = dateKey.split("-").map(Number)
  if (d <= 27) return dateKey.slice(0, 7)
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`
}
function shiftPeriod(periodKey, delta) {
  const [y, m] = periodKey.split("-").map(Number)
  const i = y * 12 + (m - 1) + delta
  return `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}`
}

// A point ~10 m from the office — well inside the radius.
function inside(world, jitter = 0) {
  return { lat: +(world.office.lat + 0.00008 + jitter).toFixed(6), lng: +(world.office.lng + 0.00005).toFixed(6) }
}

function iosFix() {
  // String(Double) in Swift prints "5.0", not "5".
  return { accuracyM: "5.0", altitudeM: "12.4", speedMps: "0.0", simulated: "0", fromAccessory: "0" }
}

// Kotlin's Double.toString() prints "5.0" too. fromAccessory is always "0" on Android (API.md §2.2).
function androidFix() {
  return { accuracyM: "4.8", altitudeM: "31.0", speedMps: "0.0", simulated: "0", fromAccessory: "0" }
}

// ---------- the fixture list ----------
//
// step = {
//   id, title, as: "a" | "b" | "manager" | "bod", kind: "compat" | "policy",
//   login?: true,                               // performs the profile's login for `as`
//   request?: (ctx) => ({ method, path, json?, multipart?: { fields: [[k,v]], files: [{ field, filename, type, data }] } }),
//   expect: { status: "2xx" | "4xx" | <number>, code?, check?: (json, ctx) => string|null },
//   after?: (json, ctx) => void,                // record ids for later steps
//   needs?: (ctx) => string|null,               // reason to SKIP (prerequisite missing)
// }
export function buildFixtures(profile, world, media) {
  const p = profile
  const android = p.style === "android"
  // `ios` below means "a native app": every native step (app-login, launch reads, push, offline queue,
  // the location fix on check-in/out) applies to Android as it does to iOS 0.1.6.
  const ios = isNative(p)
  const modern = p.id === "ios-0.1.6" || android
  const fix = android ? androidFix : iosFix
  const month = jktDate(0).slice(0, 7)
  const steps = []
  const add = (s) => steps.push(s)

  // iOS photo from camera/library — the name 0.1.4/0.1.5 give EVERY picked photo, izin included.
  const libPhoto = { field: "supportingDocument", filename: "sick-note.jpg", type: "application/octet-stream", data: media.jpeg }
  const permitPhoto016 = { field: "supportingDocument", filename: "permit-photo.jpg", type: "application/octet-stream", data: media.jpeg }
  const filesPdf = { field: "supportingDocument", filename: "Surat Dokter.pdf", type: "application/octet-stream", data: media.pdf }
  const webPhoto = { field: "supportingDocument", filename: "IMG_2041.jpg", type: "image/jpeg", data: media.jpeg }
  // iOS: APIClient.multipartBody; web: LivenessCapture.tsx — both "selfie.jpg", image/jpeg.
  const selfie = { field: "selfie", filename: "selfie.jpg", type: "image/jpeg", data: media.jpeg }
  // Android sends the real type (API.md E3): a camera photo is image/jpeg, a picked PDF application/pdf.
  const androidPhoto = { field: "supportingDocument", filename: "permit-photo.jpg", type: "image/jpeg", data: media.jpeg }
  const androidSickPhoto = { field: "supportingDocument", filename: "sick-note.jpg", type: "image/jpeg", data: media.jpeg }
  const permitPhotoModern = android ? androidPhoto : permitPhoto016
  const sickPhotoModern = android ? androidSickPhoto : libPhoto

  // ---- login + reads ----
  add({
    id: "login", title: ios ? "POST /api/auth/app-login" : "POST /api/auth/direct-login (cookie)",
    as: "a", kind: "compat", login: true,
    expect: {
      status: 200,
      check: (j) => ios
        ? firstError(need(j?.ok === true, "ok!==true"), need(isStr(j?.token), "token missing"), need(isStr(j?.cookieName), "cookieName missing"), need(isStr(j?.user?.id), "user.id missing"))
        : need(j?.ok === true, "ok!==true"),
    },
  })
  add({
    id: "profile", title: "GET /api/user/profile", as: "a", kind: "compat",
    request: () => ({ method: "GET", path: "/api/user/profile" }),
    expect: { status: 200, check: (j) => need(isStr(j?.user?.id), "user.id missing") },
  })
  add({
    id: "projects", title: "GET /api/projects", as: "a", kind: "compat",
    request: () => ({ method: "GET", path: "/api/projects" }),
    expect: {
      status: 200,
      check: (j) => {
        const arr = asArray(j, "projects")
        if (!arr) return "not an array"
        if (!arr.length) return "empty (seeded project missing)"
        return need(arr.every((x) => isStr(x.id) && isStr(x.name)), "item without id/name")
      },
    },
  })
  if (ios) {
    add({
      id: "tasks-mine", title: "GET /api/tasks?assigneeId=<me>", as: "a", kind: "compat",
      request: (ctx) => ({ method: "GET", path: `/api/tasks?assigneeId=${ctx.users.a.id}` }),
      expect: {
        status: 200,
        check: (j) => {
          const arr = asArray(j, "tasks")
          if (!arr) return "not an array"
          if (!arr.length) return "empty (seeded task missing)"
          return need(arr.every((x) => isStr(x.id)), "item without id")
        },
      },
    })
  }
  add({
    id: "tasks-board", title: "GET /api/tasks?projectId=…", as: "a", kind: "compat",
    request: () => ({ method: "GET", path: `/api/tasks?projectId=${world.projectId}` }),
    expect: {
      status: 200,
      check: (j) => {
        const arr = asArray(j, "tasks")
        if (!arr) return "not an array"
        return need(arr.every((x) => isStr(x.id) && isStr(x.title)), "item without id/title")
      },
    },
  })
  add({
    id: "today-before", title: "GET /api/attendance/today (before)", as: "a", kind: "compat",
    request: () => ({ method: "GET", path: "/api/attendance/today" }),
    expect: {
      status: 200,
      check: (j) => firstError(
        need(j && typeof j === "object" && !Array.isArray(j), "not an object"),
        need(j?.today == null || isStr(j.today.id), "today without id"),
        need(j?.myShift == null || (isStr(j.myShift.startTime) && isStr(j.myShift.endTime) && isStr(j.myShift.source)), "myShift missing startTime/endTime/source"),
      ),
    },
  })

  if (ios && !p.legacy) {
    // The rest of what 0.1.4 does on every launch (top of the nginx log for NEXUS/8).
    for (const [id, path] of [
      ["announcements", "/api/announcements/active"],
      ["notifications", "/api/notifications"],
      ["gamification", "/api/gamification/me"],
      ["ws-members", "/api/workspaces/members"],
      ["passkeys", "/api/auth/passkey"],
    ]) {
      add({ id, title: `GET ${path}`, as: "a", kind: "compat", request: () => ({ method: "GET", path }), expect: { status: "2xx" } })
    }
    if (android) {
      // An FCM registration token: mixed case, ':' '-' '_', ~160 chars. Nothing is ever sent to it (the
      // candidate has no NEXUS_FCM_SERVICE_ACCOUNT_JSON and no route out).
      const fcmToken = "dQw4w9WgXcQ:APA91bH" + "Zx-9_kLmNoPqRsTuVwXyZ0123456789AbCdEfGhIjKlMn".repeat(3) + "_end-Of-Token"
      add({
        id: "push-register", title: "POST /api/push/devices (platform android, FCM token)", as: "a", kind: "compat",
        request: () => ({
          method: "POST", path: "/api/push/devices",
          json: {
            platform: "android", token: fcmToken, deviceId: `compat-${p.id}`, appId: "id.znetworks.nexus",
            appVersion: p.version, buildNumber: String(p.build), osVersion: "Android 14", deviceModel: "Pixel 7",
          },
        }),
        expect: { status: "2xx" },
      })
      add({
        id: "push-unregister", title: "DELETE /api/push/devices (FCM token, case kept)", as: "a", kind: "compat",
        request: () => ({ method: "DELETE", path: "/api/push/devices", json: { token: fcmToken } }),
        expect: { status: "2xx" },
      })
      add({
        id: "policy-android", title: "GET /api/app/version-policy → android block", as: "a", kind: "compat",
        request: () => ({ method: "GET", path: "/api/app/version-policy" }),
        expect: {
          status: 200,
          check: (j) => firstError(
            need(isStr(j?.minSupported), "iOS minSupported missing"),
            need(isStr(j?.android?.minSupported), "android.minSupported missing"),
            // NEXUS_ANDROID_STORE_URL is unset in the harness → the sideloaded download page.
            need(j?.android?.storeUrl === ANDROID_DOWNLOAD_URL, `android.storeUrl ${j?.android?.storeUrl} is not ${ANDROID_DOWNLOAD_URL}`),
            // run.sh publishes ANDROID_LATEST "now" → its 3-day window is open for the whole run.
            need(j?.android?.latest === ANDROID_LATEST, `android.latest ${j?.android?.latest} ≠ ${ANDROID_LATEST}`),
            need(j?.android?.nextMinimum === ANDROID_LATEST, `android.nextMinimum ${j?.android?.nextMinimum} ≠ ${ANDROID_LATEST}`),
            need(Date.parse(j?.android?.graceUntil ?? "") > Date.now() + 2 * 86400000, `android.graceUntil ${j?.android?.graceUntil} is not ~3 days out`),
            // The iOS fields must not have picked anything up from Android.
            need(j?.storeUrl?.startsWith("https://apps.apple.com/"), "iOS storeUrl changed"),
          ),
        },
      })
      // The Android minimum-version gate. The harness runs the candidate with NEXUS_ANDROID_MIN_VERSION
      // = COMPAT_ANDROID_MIN_VERSION (run.sh); a build below it is refused on every /api call except
      // the policy endpoint, with the Play link. `clientHeader` overrides the profile's header.
      add({
        id: "gate-android-old", title: "android/0.0.9/1 GET /api/user/profile → 426", as: "a", kind: "compat",
        request: () => ({ method: "GET", path: "/api/user/profile", clientHeader: "android/0.0.9/1" }),
        expect: {
          status: 426, code: "UPGRADE_REQUIRED",
          check: (j) => firstError(
            need(j?.storeUrl === ANDROID_DOWNLOAD_URL, `426 storeUrl ${j?.storeUrl} is not the download page`),
            need(/download/i.test(j?.error ?? "") && !/google play/i.test(j?.error ?? ""), "426 text still says Google Play"),
          ),
        },
      })
      add({
        id: "gate-android-exempt", title: "android/0.0.9/1 GET /api/app/version-policy → 200", as: "a", kind: "compat",
        request: () => ({ method: "GET", path: "/api/app/version-policy", clientHeader: "android/0.0.9/1" }),
        expect: { status: 200 },
      })
      add({
        id: "gate-android-unreadable", title: "android/0.0/1 (no x.y.z) → never gated", as: "a", kind: "compat",
        request: () => ({ method: "GET", path: "/api/user/profile", clientHeader: "android/0.0/1" }),
        expect: { status: 200 },
      })
      // The sideloaded APK (SERVER-REQUESTS R2). run.sh mounts a 256 KiB fake release at
      // NEXUS_ANDROID_APK_DIR; byte i of it is (i*31+7)&255, so a range can be checked byte for byte.
      const apkByte = (i) => (i * 31 + 7) & 255
      const hdr = (r, k) => r?.headers?.get(k) ?? ""
      add({
        id: "apk-release", title: "GET /api/app/android/release → the published build", as: "a", kind: "compat",
        request: () => ({ method: "GET", path: "/api/app/android/release" }),
        expect: {
          status: 200,
          check: (j) => firstError(
            need(j?.available === true, "available is not true"),
            need(j?.versionName === ANDROID_LATEST, `versionName ${j?.versionName}`),
            need(j?.sizeBytes === APK_SIZE, `sizeBytes ${j?.sizeBytes}`),
            need(j?.downloadUrl === "/api/app/android/apk", "downloadUrl"),
            need(j?.fileName === `NEXUS-${ANDROID_LATEST}.apk`, `fileName ${j?.fileName}`),
          ),
        },
      })
      add({
        id: "apk-full", title: "GET /api/app/android/apk → 200 whole APK", as: "a", kind: "compat",
        request: () => ({ method: "GET", path: "/api/app/android/apk" }),
        expect: {
          status: 200, raw: true,
          check: (_j, _c, r) => firstError(
            need(hdr(r, "content-type") === "application/vnd.android.package-archive", `content-type ${hdr(r, "content-type")}`),
            need(hdr(r, "content-length") === String(APK_SIZE), `content-length ${hdr(r, "content-length")}`),
            need(hdr(r, "content-disposition").startsWith(`attachment; filename="NEXUS-${ANDROID_LATEST}.apk"`), `disposition ${hdr(r, "content-disposition")}`),
            need(hdr(r, "accept-ranges") === "bytes", "no Accept-Ranges"),
            need(/^"apk-/.test(hdr(r, "etag")), "no ETag"),
            need(/no-store/.test(hdr(r, "cache-control")), `cache-control ${hdr(r, "cache-control")}`),
            need(r.bytes.length === APK_SIZE && r.bytes[1000] === apkByte(1000), `body ${r.bytes.length} bytes`),
          ),
        },
      })
      add({
        id: "apk-range", title: "GET apk Range: bytes=100000-100099 → 206", as: "a", kind: "compat",
        request: () => ({ method: "GET", path: "/api/app/android/apk", headers: { Range: "bytes=100000-100099" } }),
        expect: {
          status: 206, raw: true,
          check: (_j, _c, r) => firstError(
            need(hdr(r, "content-range") === `bytes 100000-100099/${APK_SIZE}`, `content-range ${hdr(r, "content-range")}`),
            need(r.bytes.length === 100 && r.bytes[0] === apkByte(100000) && r.bytes[99] === apkByte(100099), "wrong bytes"),
          ),
        },
      })
      add({
        id: "apk-range-stale", title: "GET apk Range + stale If-Range → 200 whole file", as: "a", kind: "compat",
        request: () => ({ method: "GET", path: "/api/app/android/apk", headers: { Range: "bytes=10-19", "If-Range": '"apk-0-0-0"' } }),
        expect: { status: 200, raw: true, check: (_j, _c, r) => need(r.bytes.length === APK_SIZE, `body ${r.bytes.length} bytes`) },
      })
      add({
        id: "apk-range-past-end", title: "GET apk Range past the end → 416", as: "a", kind: "compat",
        request: () => ({ method: "GET", path: "/api/app/android/apk", headers: { Range: `bytes=${APK_SIZE}-` } }),
        expect: { status: 416, raw: true },
      })
      add({
        id: "apk-locked-build", title: "android/0.0.9/1 (below min) GET apk → 206, not 426", as: "a", kind: "compat",
        request: () => ({ method: "GET", path: "/api/app/android/apk", clientHeader: "android/0.0.9/1", headers: { Range: "bytes=0-9" } }),
        expect: { status: 206, raw: true },
      })
      add({
        id: "apk-release-locked", title: "android/0.0.9/1 GET /api/app/android/release → 200", as: "a", kind: "compat",
        request: () => ({ method: "GET", path: "/api/app/android/release", clientHeader: "android/0.0.9/1" }),
        expect: { status: 200 },
      })
      add({
        id: "apk-anon", title: "GET apk without a session → 401", as: "anon", kind: "compat",
        request: () => ({ method: "GET", path: "/api/app/android/apk" }),
        expect: { status: 401 },
      })
    } else {
      add({
        id: "push-register", title: "POST /api/push/devices (token only stored)", as: "a", kind: "compat",
        request: () => ({
          method: "POST", path: "/api/push/devices",
          json: {
            token: "c0ffee".repeat(10) + "abcd", deviceId: `compat-${p.id}`, bundleId: "id.znetworks.nexus",
            environment: "production", appVersion: p.version, buildNumber: String(p.build), osVersion: "iOS 18.5", deviceModel: "iPhone",
          },
        }),
        expect: { status: "2xx" },
      })
    }
  }

  // ---- check-in ----
  const pos = inside(world)
  add({
    id: "check-in", title: ios ? "POST check-in (live tap: coords+fix+selfie)" : "POST check-in (FormData lat/lng/selfie)",
    as: "a", kind: "compat",
    request: () => ({
      method: "POST", path: "/api/attendance/check-in",
      multipart: {
        fields: ios && !p.legacy
          ? [["lat", String(pos.lat)], ["lng", String(pos.lng)], ...Object.entries(fix())]
          : [["lat", String(pos.lat)], ["lng", String(pos.lng)]],
        files: [selfie],
      },
    }),
    expect: { status: "2xx", check: (j) => firstError(need(isStr(j?.record?.id), "record.id missing"), need(isStr(j?.record?.checkInAt), "record.checkInAt missing")) },
    after: (j, ctx) => { ctx.flags.checkedIn = true; ctx.flags.recordId = j?.record?.id; ctx.flags.checkInAt = j?.record?.checkInAt },
  })
  add({
    id: "today-after", title: "GET /api/attendance/today (after check-in)", as: "a", kind: "compat",
    request: () => ({ method: "GET", path: "/api/attendance/today" }),
    expect: {
      status: 200,
      check: (j, ctx) => ctx.flags.checkedIn
        ? firstError(need(isStr(j?.today?.id), "today.id missing"), need(isStr(j?.today?.checkInAt), "today.checkInAt missing after a 2xx check-in"))
        : null,
    },
  })

  // ---- location trail (0.1.6: WorkTrailWire.body — JSON, ISO with millis, event "presence") ----
  // The hourly presence check while inside, then the trail read the manager's map makes.
  if (p.id === "ios-0.1.6") {
    add({
      id: "trail-presence", title: "POST location-trail: hourly presence check (inside)", as: "a", kind: "compat",
      needs: (ctx) => (ctx.flags.recordId ? null : "check-in did not succeed"),
      request: (ctx) => ({
        method: "POST", path: "/api/attendance/location-trail",
        json: { recordId: ctx.flags.recordId, points: [{ lat: pos.lat, lng: pos.lng, at: (ctx.flags.presenceAt = new Date().toISOString()), event: "presence", accuracy: 12 }] },
      }),
      expect: {
        status: 200,
        check: (j) => firstError(
          need(j?.tracking === true, `tracking=${j?.tracking} (a checked-in 0.1.6 staff member is tracked)`),
          need(j?.accepted === 1, `accepted=${j?.accepted}`),
          need(j?.stage === "inside", `stage=${j?.stage}`),
        ),
      },
    })
    add({
      id: "trail-read", title: "GET records/:id/trail → presence point + hours", as: "a", kind: "compat",
      needs: (ctx) => (ctx.flags.recordId ? null : "check-in did not succeed"),
      request: (ctx) => ({ method: "GET", path: `/api/attendance/records/${ctx.flags.recordId}/trail` }),
      expect: {
        status: 200,
        check: (j) => firstError(
          need(isStr(j?.record?.id) && Array.isArray(j?.points) && Array.isArray(j?.outsideSpans), "trail shape"),
          need((j?.points ?? []).some((pt) => pt.event === "presence" && pt.inside === true), "presence point missing or not inside"),
          need(Array.isArray(j?.presence) && j.presence.length >= 1, "presence[] missing"),
          need((j?.presence ?? []).every((h) => isStr(h.from) && isStr(h.to) && isStr(h.label) && isStr(h.status)), "presence entry shape"),
          need(j?.presence?.[0]?.status === "inside", `first hour ${j?.presence?.[0]?.status} (check-in + check are inside)`),
        ),
      },
    })
    // The route outside as 0.1.6 now records it (28 Sep 2026): a full batch — exit, 198 points 50 m
    // apart walking away, enter back at the office. Timestamps 40 ms apart, all after the presence
    // point above (one inside point in the middle would split the outing in two) and within the
    // server's check-in → now + 1 min window, so the record ends back inside.
    const routeBatch = (ctx) => {
      const from = Math.max(Date.parse(ctx.flags.presenceAt ?? "") || 0, Date.parse(ctx.flags.checkInAt ?? "") || 0) || Date.now() - 20_000
      const pts = []
      for (let i = 0; i < 200; i++) {
        const last = i === 199
        pts.push({
          lat: last ? pos.lat : pos.lat + 0.0036 + i * 0.00045,
          lng: pos.lng,
          accuracy: 8,
          at: new Date(from + 7 + i * 40).toISOString(),
          event: i === 0 ? "exit" : last ? "enter" : "point",
        })
      }
      return pts
    }
    add({
      id: "trail-route", title: "POST location-trail: 200-point route batch (exit … enter)", as: "a", kind: "compat",
      needs: (ctx) => (ctx.flags.recordId ? null : "check-in did not succeed"),
      request: (ctx) => ({ method: "POST", path: "/api/attendance/location-trail", json: { recordId: ctx.flags.recordId, points: routeBatch(ctx) } }),
      expect: {
        status: 200,
        check: (j) => firstError(
          need(j?.tracking === true, `tracking=${j?.tracking}`),
          need(j?.accepted === 200, `accepted=${j?.accepted} of 200`),
          need(j?.stage === "inside", `stage=${j?.stage} (the batch ends with the enter)`),
        ),
      },
    })
    add({
      id: "trail-route-read", title: "GET records/:id/trail → every route point + one closed outing", as: "a", kind: "compat",
      needs: (ctx) => (ctx.flags.recordId ? null : "check-in did not succeed"),
      request: (ctx) => ({ method: "GET", path: `/api/attendance/records/${ctx.flags.recordId}/trail` }),
      expect: {
        status: 200,
        check: (j) => firstError(
          need((j?.points ?? []).length >= 201, `points=${(j?.points ?? []).length} (presence + 200)`),
          need((j?.outsideSpans ?? []).length === 1 && isStr(j.outsideSpans[0].to), `outsideSpans=${JSON.stringify(j?.outsideSpans)}`),
        ),
      },
    })
  }

  // ---- offline replay (iOS queue) ----
  if (ios && !p.legacy) {
    add({ id: "login-b", title: "login (2nd staff, offline queue)", as: "b", kind: "compat", login: true, expect: { status: 200 } })
    const clientId = `compat-${p.id}-${Date.now()}`
    const deviceAt = new Date(Date.now() - 3 * 60 * 1000).toISOString().replace(/\.\d{3}Z$/, "Z")
    const replay = () => ({
      method: "POST", path: "/api/attendance/check-in",
      multipart: {
        fields: [["lat", String(pos.lat)], ["lng", String(pos.lng)], ...Object.entries(fix()), ["clientId", clientId], ["deviceAt", deviceAt], ["uptimeSec", "86400"]],
        files: [selfie],
      },
    })
    add({
      id: "check-in-queued", title: "POST check-in replayed from offline queue", as: "b", kind: "compat",
      request: replay,
      expect: { status: "2xx", check: (j) => need(isStr(j?.record?.id), "record.id missing") },
      after: (j, ctx) => { ctx.flags.queuedIn = true },
    })
    add({
      id: "check-in-replay-dup", title: "same queued tap replayed again → idempotent", as: "b", kind: "compat",
      needs: (ctx) => (ctx.flags.queuedIn ? null : "queued check-in did not succeed"),
      request: replay,
      expect: { status: "2xx", check: (j) => need(j?.duplicate === true, "duplicate!==true (would double check-in)") },
    })
  }

  // ---- check-out ----
  if (!p.legacy) {
    add({
      id: "check-out", title: "POST check-out with 200+ char reflection", as: "a", kind: "compat",
      needs: (ctx) => (ctx.flags.checkedIn ? null : "check-in did not succeed"),
      request: () => ({
        method: "POST", path: "/api/attendance/check-out",
        multipart: {
          fields: ios
            ? [["lat", String(pos.lat)], ["lng", String(pos.lng)], ["reflection", reflectionFor(p.id)], ...Object.entries(fix())]
            : [["lat", String(pos.lat)], ["lng", String(pos.lng)], ["reflection", reflectionFor(p.id)]],
          files: [selfie],
        },
      }),
      expect: { status: "2xx", check: (j) => need(isStr(j?.record?.checkOutAt), "record.checkOutAt missing") },
    })
  }

  // ---- history ----
  add({
    id: "history-month", title: "GET /api/attendance/history?scope=me&month=", as: "a", kind: "compat",
    request: () => ({ method: "GET", path: `/api/attendance/history?scope=me&month=${month}` }),
    expect: {
      status: 200,
      check: (j, ctx) => {
        const rows = j?.rows ?? j?.records
        if (!Array.isArray(rows)) return "neither rows nor records is an array"
        if (ctx.flags.checkedIn && rows.length === 0) return "today's record missing from history"
        return null
      },
    },
  })
  if (ios && (p.id === "ios-0.1.5" || modern)) {
    add({
      id: "history-compact", title: "GET history compact=1 (widget/watch)", as: "a", kind: "compat",
      request: () => ({ method: "GET", path: `/api/attendance/history?scope=me&dateFrom=${jktDate(-6)}&dateTo=${jktDate(0)}&compact=1` }),
      expect: { status: 200, check: (j) => need(Array.isArray(j?.records), "records not an array") },
    })
  }

  // ---- attendance requests ----
  // Dates start TOMORROW: today already has a check-in (a request over it is 409 by design) and izin
  // may not be backdated. Each fixture gets its own days, so nothing overlaps.
  const req = (id, title, kind, fields, files, expect, after) =>
    add({
      id, title, as: "a", kind,
      request: () => ({ method: "POST", path: "/api/attendance/requests", multipart: { fields, files } }),
      expect,
      after,
    })
  const created = { status: "2xx", check: (j) => need(isStr(j?.request?.id), "request.id missing") }
  const bump = (key) => (j, ctx) => { ctx.flags.created = (ctx.flags.created ?? 0) + 1; if (key) ctx.flags[key] = j?.request?.id }
  const base = (type, s, e, reason) => [["type", type], ["startDate", s], ["endDate", e], ["reason", reason]]
  // Izin that is really a day off (owner's rule, 24 Sep 2026; src/lib/permit-reason-guard.ts). Sent
  // complete — photo, and coords where the client sends them — so the reason is the only thing wrong.
  // Every izin reason in the compat fixtures above must stay unflagged; this one must be refused.
  const PERMIT_NOT_DAYOFF = {
    status: 422, code: "PERMIT_NOT_DAYOFF",
    check: (j) => need(isStr(j?.error), "refusal without an error message"),
  }

  if (p.legacy) {
    req("req-permit", "PERMIT 1 day + photo, no coords (0.1.4-shaped)", "compat",
      base("PERMIT", jktDate(1), jktDate(1), "Urus dokumen di kelurahan"), [libPhoto], created, bump())
    req("req-permit-dayoff", "PERMIT reason \"ambil day off\" → PERMIT_NOT_DAYOFF", "policy",
      base("PERMIT", jktDate(2), jktDate(2), "ambil day off"), [libPhoto], PERMIT_NOT_DAYOFF)
  } else if (ios && !modern) {
    // 0.1.4 / 0.1.5 — the regression class of 23–24 Sep: none of these may ever be refused.
    req("req-permit-1d", "PERMIT 1 day + photo, NO lat/lng", "compat",
      base("PERMIT", jktDate(1), jktDate(1), "Urus dokumen di kelurahan"), [libPhoto], created, bump())
    req("req-permit-multi", "PERMIT multi-day (START–UNTIL) + photo, no coords", "compat",
      base("PERMIT", jktDate(2), jktDate(3), "Mengantar orang tua berobat ke luar kota"), [libPhoto], created, bump())
    req("req-permit-endlag", "PERMIT with end < start (0.1.4 picker bug)", "compat",
      base("PERMIT", jktDate(5), jktDate(4), "Acara keluarga"), [libPhoto], created, bump())
    req("req-sick-multi", "SICK multi-day + photo (octet-stream JPEG)", "compat",
      base("SICK", jktDate(6), jktDate(7), "Demam, istirahat dari dokter"), [libPhoto], created, bump())
    req("req-sick-pdf", "SICK 1 day + PDF from Files picker", "compat",
      base("SICK", jktDate(8), jktDate(8), "Kontrol ke dokter"), [filesPdf], created, bump())
    req("req-dayoff", "DAY_OFF 1 day, no attachment", "compat",
      base("DAY_OFF", jktDate(9), jktDate(9), "Libur pribadi"), [], created, bump("dayOffId"))
    req("req-permit-nophoto", "PERMIT without photo (UI says optional)", "policy",
      base("PERMIT", jktDate(10), jktDate(10), "Keperluan mendadak"), [],
      { status: "4xx", check: (j) => need(isStr(j?.error), "refusal without an error message") })
    req("req-permit-dayoff", "PERMIT reason \"ambil day off\" → PERMIT_NOT_DAYOFF", "policy",
      base("PERMIT", jktDate(11), jktDate(11), "ambil day off"), [libPhoto], PERMIT_NOT_DAYOFF)
    // One-date-per-request (24 Sep 2026) is NOT applied to these builds: their START–UNTIL picker
    // offers a range for every type, and refusing it would strand them. 2 days + the 1-day DAY_OFF
    // above = 3, inside the default quota of 4 whichever payroll periods the dates fall in.
    req("req-dayoff-multi", "DAY_OFF multi-day (START–UNTIL) — legacy stays exempt", "compat",
      base("DAY_OFF", jktDate(12), jktDate(13), "Acara keluarga di luar kota"), [], created, bump())
  } else if (modern) {
    // iOS 0.1.6 and every Android build: the same rules; only the attachment's type differs.
    req("req-permit-1d", "PERMIT 1 day + permit-photo.jpg + lat/lng", "compat",
      [...base("PERMIT", jktDate(1), jktDate(1), "Urus dokumen di kelurahan"), ["lat", String(pos.lat)], ["lng", String(pos.lng)]], [permitPhotoModern], created, bump())
    req("req-sick-1d", "SICK 1 day + photo", "compat",
      base("SICK", jktDate(2), jktDate(2), "Demam, istirahat dari dokter"), [sickPhotoModern], created, bump())
    req("req-dayoff", "DAY_OFF 1 day", "compat",
      base("DAY_OFF", jktDate(3), jktDate(3), "Libur pribadi"), [], created, bump("dayOffId"))
    req("req-sick-multi", "SICK multi-day (UI cannot send) → SINGLE_DAY_ONLY", "policy",
      base("SICK", jktDate(4), jktDate(5), "Demam"), [sickPhotoModern],
      { status: 400, code: "SINGLE_DAY_ONLY" })
    req("req-permit-nocoords", "PERMIT without lat/lng (UI cannot send) → 400", "policy",
      base("PERMIT", jktDate(6), jktDate(6), "Keperluan mendadak"), [permitPhotoModern],
      { status: 400, check: (j) => need(isStr(j?.error), "refusal without an error message") })
    req("req-permit-dayoff", "PERMIT reason \"ambil day off\" → PERMIT_NOT_DAYOFF", "policy",
      [...base("PERMIT", jktDate(7), jktDate(7), "ambil day off"), ["lat", String(pos.lat)], ["lng", String(pos.lng)]], [permitPhotoModern], PERMIT_NOT_DAYOFF)
    // Policy fixture (owner's rule, 24 Sep 2026): every request type is one date. The 0.1.6 picker
    // (AttendanceRequestsView.swift `singleDay`) still offers a range for DAY_OFF, so this IS
    // reachable from the UI — the person gets the SINGLE_DAY_ONLY message and files per date.
    req("req-dayoff-multi", "DAY_OFF multi-day → SINGLE_DAY_ONLY (one date per request)", "policy",
      base("DAY_OFF", jktDate(8), jktDate(9), "Acara keluarga di luar kota"), [],
      { status: 400, code: "SINGLE_DAY_ONLY" })
  } else {
    // web
    req("req-permit-1d", "PERMIT 1 day + photo + lat/lng", "compat",
      [...base("PERMIT", jktDate(1), jktDate(1), "Urus dokumen di kelurahan"), ["lat", String(pos.lat)], ["lng", String(pos.lng)]], [webPhoto], created, bump())
    req("req-sick-1d", "SICK 1 day + photo", "compat",
      base("SICK", jktDate(2), jktDate(2), "Demam, istirahat dari dokter"), [webPhoto], created, bump())
    req("req-dayoff", "DAY_OFF 1 day", "compat",
      base("DAY_OFF", jktDate(3), jktDate(3), "Libur pribadi"), [], created, bump("dayOffId"))
    req("req-permit-nocoords", "PERMIT without lat/lng (location denied) → 400", "policy",
      base("PERMIT", jktDate(4), jktDate(4), "Keperluan mendadak"), [webPhoto],
      { status: 400, check: (j) => need(isStr(j?.error), "refusal without an error message") })
    req("req-permit-dayoff", "PERMIT reason \"ambil day off\" → PERMIT_NOT_DAYOFF", "policy",
      [...base("PERMIT", jktDate(5), jktDate(5), "ambil day off"), ["lat", String(pos.lat)], ["lng", String(pos.lng)]], [webPhoto], PERMIT_NOT_DAYOFF)
    // Policy fixture (owner's rule, 24 Sep 2026): every request type is one date. The web form
    // (attendance.tsx `singleDay`) still offers a range for DAY_OFF until it is updated.
    req("req-dayoff-multi", "DAY_OFF multi-day → SINGLE_DAY_ONLY (one date per request)", "policy",
      base("DAY_OFF", jktDate(6), jktDate(7), "Acara keluarga di luar kota"), [],
      { status: 400, code: "SINGLE_DAY_ONLY" })
  }

  add({
    id: "req-list", title: "GET /api/attendance/requests?scope=me", as: "a", kind: "compat",
    request: () => ({ method: "GET", path: "/api/attendance/requests?scope=me" }),
    expect: {
      status: 200,
      check: (j, ctx) => {
        const arr = asArray(j, "requests")
        if (!arr) return "requests not an array"
        if (!arr.every((r) => isStr(r.id))) return "request without id"
        const want = ctx.flags.created ?? 0
        return need(arr.length >= want, `only ${arr.length} of ${want} created requests listed`)
      },
    },
  })

  // ---- approver path (manager on the same client build) ----
  if (!p.legacy) {
    add({ id: "login-mgr", title: "login (manager / approver)", as: "manager", kind: "compat", login: true, expect: { status: 200 } })
    add({
      id: "mgr-approvals", title: "GET requests?scope=approvals (manager)", as: "manager", kind: "compat",
      request: () => ({ method: "GET", path: "/api/attendance/requests?scope=approvals" }),
      expect: {
        status: 200,
        check: (j, ctx) => {
          const arr = asArray(j, "requests")
          if (!arr) return "requests not an array"
          return ctx.flags.dayOffId ? need(arr.some((r) => r.id === ctx.flags.dayOffId), "staff's DAY_OFF not in the approver's queue") : null
        },
      },
    })
    add({
      id: "mgr-approve", title: "PATCH approve staff DAY_OFF (manager)", as: "manager", kind: "compat",
      needs: (ctx) => (ctx.flags.dayOffId ? null : "DAY_OFF request was not created"),
      request: (ctx) => ({ method: "PATCH", path: `/api/attendance/requests/${ctx.flags.dayOffId}`, json: { action: "approve" } }),
      expect: { status: "2xx" },
    })
  }

  // ---- extra day off (28 Sep 2026): the BoD grants days for ONE period; the staff member's own
  // today/requests must reflect it on every released build — they read `dayOffQuota` as the quota.
  if (!p.legacy) {
    const period = periodOf(jktDate(0))
    const BONUS = 2
    // 0.1.4 / 0.1.5 filed 3 DAY_OFF days above (jktDate 9, 12, 13). Two more (14, 15) make 5: over the
    // default 4, inside 4 + 2. Only meaningful while all of them sit in today's period.
    const capTest = ios && !modern && !android && periodOf(jktDate(15)) === period
    const capSkip = () => (capTest ? null : "the fixture dates cross into the next period today")
    const reqOver = (id, title, kind, expect, after) =>
      add({
        id, title, as: "a", kind, needs: capSkip,
        request: () => ({ method: "POST", path: "/api/attendance/requests", multipart: { fields: base("DAY_OFF", jktDate(14), jktDate(15), "Libur setelah event"), files: [] } }),
        expect, after,
      })
    add({
      id: "bonus-today-base", title: "GET today → dayOffQuota before any extra day off", as: "a", kind: "compat",
      request: () => ({ method: "GET", path: "/api/attendance/today" }),
      expect: { status: 200, check: (j) => need(Number.isInteger(j?.dayOffQuota), `dayOffQuota=${j?.dayOffQuota}`) },
      after: (j, ctx) => { ctx.flags.baseQuota = j.dayOffQuota },
    })
    if (capTest) {
      reqOver("bonus-cap-before", "DAY_OFF 2 days over the base quota → 422 (no extra yet)", "policy", { status: 422 })
    }
    add({ id: "login-bod", title: "login (BoD)", as: "bod", kind: "compat", login: true, expect: { status: 200 } })
    add({
      id: "bonus-forbidden", title: "POST day-off-bonus as staff → 403 FORBIDDEN", as: "a", kind: "policy",
      request: (ctx) => ({ method: "POST", path: "/api/attendance/day-off-bonus", json: { userIds: [ctx.users.a.id], periodKey: period, days: 5, reason: "Coba sendiri" } }),
      expect: { status: 403, code: "FORBIDDEN" },
    })
    add({
      id: "bonus-too-old", title: "POST day-off-bonus two periods back → PERIOD_TOO_OLD", as: "bod", kind: "policy",
      request: (ctx) => ({ method: "POST", path: "/api/attendance/day-off-bonus", json: { userIds: [ctx.users.a.id], periodKey: shiftPeriod(period, -2), days: 1, reason: "Event lama" } }),
      expect: { status: 400, code: "PERIOD_TOO_OLD" },
    })
    add({
      id: "bonus-grant", title: `POST day-off-bonus (BoD) +${BONUS} days this period`, as: "bod", kind: "compat",
      request: (ctx) => ({ method: "POST", path: "/api/attendance/day-off-bonus", json: { userIds: [ctx.users.a.id], periodKey: period, days: BONUS, reason: "Kerja event 3 hari" } }),
      expect: {
        status: 201,
        check: (j, ctx) => firstError(
          need(Array.isArray(j?.grants) && j.grants.length === 1, "grants[] missing"),
          need(j?.grants?.[0]?.userId === ctx.users.a.id && j.grants[0].days === BONUS && j.grants[0].active === true, "grant shape"),
          need(j?.periodKey === period && isStr(j?.periodLabel), "period"),
        ),
      },
      after: (j, ctx) => { ctx.flags.bonusId = j.grants[0].id },
    })
    add({
      id: "bonus-today", title: `GET today → dayOffQuota raised by ${BONUS}`, as: "a", kind: "compat",
      needs: (ctx) => (ctx.flags.bonusId && Number.isInteger(ctx.flags.baseQuota) ? null : "grant or baseline missing"),
      request: () => ({ method: "GET", path: "/api/attendance/today" }),
      expect: {
        status: 200,
        check: (j, ctx) => firstError(
          need(j?.dayOffQuota === ctx.flags.baseQuota + BONUS, `dayOffQuota=${j?.dayOffQuota}, want ${ctx.flags.baseQuota + BONUS}`),
          need(j?.dayOffAllowance?.bonus === BONUS && j?.dayOffAllowance?.base === ctx.flags.baseQuota, "dayOffAllowance breakdown"),
          need(Number.isInteger(j?.dayOffUsedThisMonth) && j.dayOffUsedThisMonth <= j.dayOffQuota, "dayOffUsedThisMonth"),
        ),
      },
    })
    add({
      id: "bonus-list-own", title: "GET day-off-bonus as staff → own grant only", as: "a", kind: "compat",
      needs: (ctx) => (ctx.flags.bonusId ? null : "grant missing"),
      request: () => ({ method: "GET", path: `/api/attendance/day-off-bonus?periodKey=${period}` }),
      expect: {
        status: 200,
        check: (j, ctx) => firstError(
          need(Array.isArray(j?.grants) && j.grants.every((g) => g.userId === ctx.users.a.id), "a staff member sees someone else's grant"),
          need(j.grants.some((g) => g.id === ctx.flags.bonusId), "own grant missing"),
          need(j?.canManage === false && j?.mine?.bonus === BONUS, "canManage / mine"),
        ),
      },
    })
    if (capTest) {
      reqOver("bonus-cap-after", "same DAY_OFF 2 days → accepted inside 4 + extra", "compat",
        { status: "2xx", check: (j) => need(isStr(j?.request?.id), "request.id missing") })
    }
    add({
      id: "bonus-revoke", title: "DELETE day-off-bonus/:id (BoD) → revoked", as: "bod", kind: "compat",
      needs: (ctx) => (ctx.flags.bonusId ? null : "grant missing"),
      request: (ctx) => ({ method: "DELETE", path: `/api/attendance/day-off-bonus/${ctx.flags.bonusId}` }),
      expect: { status: 200, check: (j) => need(j?.grant?.active === false && isStr(j?.grant?.revokedAt) && j?.alreadyRevoked === false, "not revoked") },
    })
    add({
      id: "bonus-today-revoked", title: "GET today → dayOffQuota back to the base", as: "a", kind: "compat",
      needs: (ctx) => (ctx.flags.bonusId && Number.isInteger(ctx.flags.baseQuota) ? null : "grant or baseline missing"),
      request: () => ({ method: "GET", path: "/api/attendance/today" }),
      expect: { status: 200, check: (j, ctx) => need(j?.dayOffQuota === ctx.flags.baseQuota, `dayOffQuota=${j?.dayOffQuota}, want ${ctx.flags.baseQuota}`) },
    })
  }

  // ---- member record + removing one XP deduction (28 Sep 2026): GET /api/members/:id/record and
  // POST /api/gamification/xp-transactions/:id/refund. Staff see themselves, the manager their
  // direct reports, the BoD everyone; only the BoD removes a deduction, once.
  if (!p.legacy) {
    const isRecord = (j) => firstError(
      need(isStr(j?.person?.id), "person.id"),
      need(isStr(j?.period?.key) && Array.isArray(j?.days) && j.days.length === j.period.days, "period/days"),
      need(Number.isInteger(j?.summary?.score?.working) && Number.isInteger(j?.summary?.counts?.absent), "summary"),
      need(Number.isInteger(j?.summary?.dayOff?.quota) && Number.isInteger(j?.summary?.xp?.lost), "dayOff/xp totals"),
      need(Array.isArray(j?.xp?.entries) && Array.isArray(j?.requests), "xp.entries / requests"),
    )
    const refund = (id, title, as, idOf, expect, kind = "compat") =>
      add({
        id, title, as, kind,
        needs: (ctx) => (idOf(ctx) ? null : "no XP entry to remove"),
        request: (ctx) => ({ method: "POST", path: `/api/gamification/xp-transactions/${idOf(ctx)}/refund`, json: { note: "Compat: bukan salah dia" } }),
        expect,
      })
    add({
      id: "record-self", title: "GET members/me/record (own record, current period)", as: "a", kind: "compat",
      request: () => ({ method: "GET", path: "/api/members/me/record" }),
      expect: { status: 200, check: (j, ctx) => firstError(isRecord(j), need(j?.person?.id === ctx.users.a.id && j.person.isSelf === true, "not self"), need(j?.viewer?.canRemoveXp === false, "staff may remove XP")) },
    })
    add({
      id: "record-peer", title: "GET members/<peer>/record as staff → 403 FORBIDDEN", as: "a", kind: "compat",
      request: (ctx) => ({ method: "GET", path: `/api/members/${ctx.users.b.id}/record` }),
      expect: { status: 403, code: "FORBIDDEN" },
    })
    add({
      id: "record-manager", title: "GET members/<direct report>/record as manager", as: "manager", kind: "compat",
      request: (ctx) => ({ method: "GET", path: `/api/members/${ctx.users.a.id}/record` }),
      expect: { status: 200, check: (j) => firstError(isRecord(j), need(j?.viewer?.scope === "DIRECT_REPORTS" && j.viewer.canRemoveXp === false, "manager scope")) },
    })
    add({
      id: "xp-cut", title: "POST xp-adjust −7 (BoD) — a deduction to remove", as: "bod", kind: "compat",
      request: (ctx) => ({ method: "POST", path: "/api/gamification/xp-adjust", json: { userId: ctx.users.a.id, amount: -7, note: `Compat ${p.id}` } }),
      expect: { status: 200, check: (j) => need(j?.ok === true, "ok!==true") },
    })
    add({
      id: "xp-gain", title: "POST xp-adjust +3 (BoD) — a gain, not removable", as: "bod", kind: "compat",
      request: (ctx) => ({ method: "POST", path: "/api/gamification/xp-adjust", json: { userId: ctx.users.a.id, amount: 3, note: `Compat ${p.id}` } }),
      expect: { status: 200, check: (j) => need(j?.ok === true, "ok!==true") },
    })
    add({
      id: "record-bod", title: "GET members/<staff>/record as BoD → the −7 is removable", as: "bod", kind: "compat",
      request: (ctx) => ({ method: "GET", path: `/api/members/${ctx.users.a.id}/record` }),
      expect: {
        status: 200,
        check: (j) => {
          const cut = j?.xp?.entries?.find((e) => e.kind === "admin_adjust" && e.originalAmount === -7)
          const gain = j?.xp?.entries?.find((e) => e.kind === "admin_adjust" && e.amount === 3)
          return firstError(isRecord(j), need(j?.viewer?.canRemoveXp === true, "BoD cannot remove"), need(cut?.canRemove === true && cut.removed === null, "−7 not removable"), need(gain && gain.canRemove === false, "+3 entry"))
        },
      },
      after: (j, ctx) => {
        ctx.flags.xpCutId = j.xp.entries.find((e) => e.kind === "admin_adjust" && e.originalAmount === -7)?.id
        ctx.flags.xpGainId = j.xp.entries.find((e) => e.kind === "admin_adjust" && e.amount === 3)?.id
      },
    })
    refund("xp-refund-staff", "POST refund as staff → 403 FORBIDDEN", "a", (ctx) => ctx.flags.xpCutId, { status: 403, code: "FORBIDDEN" })
    refund("xp-refund-bod", "POST refund (BoD) → +7 back", "bod", (ctx) => ctx.flags.xpCutId, {
      status: 200,
      check: (j, ctx) => firstError(need(j?.ok === true && j?.refund?.refunded === 7 && j.refund.amount === -7, "refund amount"), need(j?.refund?.userId === ctx.users.a.id && j.refund.kind === "admin_adjust", "refund shape")),
    })
    refund("xp-refund-again", "POST the same refund again → 409 ALREADY_REFUNDED", "bod", (ctx) => ctx.flags.xpCutId, { status: 409, code: "ALREADY_REFUNDED" })
    refund("xp-refund-gain", "POST refund of a gain → 400 NOT_A_DEDUCTION", "bod", (ctx) => ctx.flags.xpGainId, { status: 400, code: "NOT_A_DEDUCTION" })
    add({
      id: "record-removed", title: "GET members/me/record → the −7 shows as removed by the BoD", as: "a", kind: "compat",
      needs: (ctx) => (ctx.flags.xpCutId ? null : "no XP entry was removed"),
      request: () => ({ method: "GET", path: "/api/members/me/record?only=xp" }),
      expect: {
        status: 200,
        check: (j, ctx) => {
          const e = j?.xp?.entries?.find((x) => x.id === ctx.flags.xpCutId)
          return firstError(need(e, "entry missing"), need(e?.amount === 0 && e?.originalAmount === -7, "amounts"), need(e?.removed?.by?.id === ctx.users.bod.id && isStr(e?.removed?.at), "removed.by"))
        },
      },
    })
  }

  return steps
}
