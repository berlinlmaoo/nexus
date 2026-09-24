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
]

// ---------- small helpers ----------
const isStr = (v) => typeof v === "string" && v.length > 0
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

// A point ~10 m from the office — well inside the radius.
function inside(world, jitter = 0) {
  return { lat: +(world.office.lat + 0.00008 + jitter).toFixed(6), lng: +(world.office.lng + 0.00005).toFixed(6) }
}

function iosFix() {
  // String(Double) in Swift prints "5.0", not "5".
  return { accuracyM: "5.0", altitudeM: "12.4", speedMps: "0.0", simulated: "0", fromAccessory: "0" }
}

// ---------- the fixture list ----------
//
// step = {
//   id, title, as: "a" | "b" | "manager", kind: "compat" | "policy",
//   login?: true,                               // performs the profile's login for `as`
//   request?: (ctx) => ({ method, path, json?, multipart?: { fields: [[k,v]], files: [{ field, filename, type, data }] } }),
//   expect: { status: "2xx" | "4xx" | <number>, code?, check?: (json, ctx) => string|null },
//   after?: (json, ctx) => void,                // record ids for later steps
//   needs?: (ctx) => string|null,               // reason to SKIP (prerequisite missing)
// }
export function buildFixtures(profile, world, media) {
  const p = profile
  const ios = p.style === "ios"
  const modern = p.id === "ios-0.1.6"
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

  // ---- check-in ----
  const pos = inside(world)
  add({
    id: "check-in", title: ios ? "POST check-in (live tap: coords+fix+selfie)" : "POST check-in (FormData lat/lng/selfie)",
    as: "a", kind: "compat",
    request: () => ({
      method: "POST", path: "/api/attendance/check-in",
      multipart: {
        fields: ios && !p.legacy
          ? [["lat", String(pos.lat)], ["lng", String(pos.lng)], ...Object.entries(iosFix())]
          : [["lat", String(pos.lat)], ["lng", String(pos.lng)]],
        files: [selfie],
      },
    }),
    expect: { status: "2xx", check: (j) => firstError(need(isStr(j?.record?.id), "record.id missing"), need(isStr(j?.record?.checkInAt), "record.checkInAt missing")) },
    after: (j, ctx) => { ctx.flags.checkedIn = true },
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

  // ---- offline replay (iOS queue) ----
  if (ios && !p.legacy) {
    add({ id: "login-b", title: "login (2nd staff, offline queue)", as: "b", kind: "compat", login: true, expect: { status: 200 } })
    const clientId = `compat-${p.id}-${Date.now()}`
    const deviceAt = new Date(Date.now() - 3 * 60 * 1000).toISOString().replace(/\.\d{3}Z$/, "Z")
    const replay = () => ({
      method: "POST", path: "/api/attendance/check-in",
      multipart: {
        fields: [["lat", String(pos.lat)], ["lng", String(pos.lng)], ...Object.entries(iosFix()), ["clientId", clientId], ["deviceAt", deviceAt], ["uptimeSec", "86400"]],
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
            ? [["lat", String(pos.lat)], ["lng", String(pos.lng)], ["reflection", reflectionFor(p.id)], ...Object.entries(iosFix())]
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
  } else if (modern) {
    req("req-permit-1d", "PERMIT 1 day + permit-photo.jpg + lat/lng", "compat",
      [...base("PERMIT", jktDate(1), jktDate(1), "Urus dokumen di kelurahan"), ["lat", String(pos.lat)], ["lng", String(pos.lng)]], [permitPhoto016], created, bump())
    req("req-sick-1d", "SICK 1 day + photo", "compat",
      base("SICK", jktDate(2), jktDate(2), "Demam, istirahat dari dokter"), [libPhoto], created, bump())
    req("req-dayoff", "DAY_OFF 1 day", "compat",
      base("DAY_OFF", jktDate(3), jktDate(3), "Libur pribadi"), [], created, bump("dayOffId"))
    req("req-sick-multi", "SICK multi-day (UI cannot send) → SINGLE_DAY_ONLY", "policy",
      base("SICK", jktDate(4), jktDate(5), "Demam"), [libPhoto],
      { status: 400, code: "SINGLE_DAY_ONLY" })
    req("req-permit-nocoords", "PERMIT without lat/lng (UI cannot send) → 400", "policy",
      base("PERMIT", jktDate(6), jktDate(6), "Keperluan mendadak"), [permitPhoto016],
      { status: 400, check: (j) => need(isStr(j?.error), "refusal without an error message") })
    req("req-permit-dayoff", "PERMIT reason \"ambil day off\" → PERMIT_NOT_DAYOFF", "policy",
      [...base("PERMIT", jktDate(7), jktDate(7), "ambil day off"), ["lat", String(pos.lat)], ["lng", String(pos.lng)]], [permitPhoto016], PERMIT_NOT_DAYOFF)
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

  return steps
}
