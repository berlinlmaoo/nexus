// node src/lib/attendance-outside.test.mjs
//
// Plain node, no test runner (same loader as permit-reason-guard.test.mjs): loads attendance-outside.ts
// directly when this node can strip types, otherwise transpiles it with the repo's own `typescript`.
import { readFile } from "node:fs/promises"
import { fileURLToPath, pathToFileURL } from "node:url"
import path from "node:path"
import { createRequire } from "node:module"
import assert from "node:assert/strict"

const here = path.dirname(fileURLToPath(import.meta.url))
const tsPath = path.join(here, "attendance-outside.ts")

async function load() {
  try {
    return await import(pathToFileURL(tsPath).href)
  } catch {
    const require = createRequire(import.meta.url)
    const ts = require("typescript")
    const src = await readFile(tsPath, "utf8")
    const out = ts.transpileModule(src, {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    }).outputText
    return await import("data:text/javascript;base64," + Buffer.from(out).toString("base64"))
  }
}

const M = await load()
let passed = 0
function t(name, fn) {
  try {
    fn()
    passed++
  } catch (e) {
    console.error(`FAIL ${name}\n  ${e.message}`)
    process.exitCode = 1
  }
}

// Office at the compat seed's coordinates, r = 150 m. 1° latitude ≈ 111,195 m.
const OFFICE = { latitude: -6.2253, longitude: 106.829, radiusMeters: 150 }
const north = (m) => ({ lat: OFFICE.latitude + m / 111195, lng: OFFICE.longitude })
const T0 = new Date("2026-09-24T02:00:00.000Z") // 09:00 WIB
const at = (min) => new Date(T0.getTime() + min * 60_000)
const cls = (m, extra = {}) => M.classifyPoint({ ...north(m), ...extra }, [OFFICE]).cls

// ── classifyPoint ────────────────────────────────────────────────────────────────────────────────
t("inside at the centre and at the radius", () => {
  assert.equal(cls(0), "inside")
  assert.equal(cls(149), "inside")
})
t("just past the radius is jitter, not outside (50 m floor)", () => {
  assert.equal(cls(160), "ambiguous")
  assert.equal(cls(199), "ambiguous")
  assert.equal(cls(201), "outside")
})
t("poor accuracy widens the buffer", () => {
  assert.equal(cls(300, { accuracy: 200 }), "ambiguous") // needs > 150 + 200
  assert.equal(cls(360, { accuracy: 200 }), "outside")
  assert.equal(cls(201, { accuracy: 10 }), "outside") // accuracy below 50 m does not shrink the floor
})
t("enter event counts as inside unless clearly outside", () => {
  assert.equal(cls(180, { event: "enter" }), "inside")
  assert.equal(cls(180, { event: "point" }), "ambiguous")
  assert.equal(cls(500, { event: "enter" }), "outside")
})
t("another office's radius is inside too", () => {
  const second = { latitude: OFFICE.latitude + 0.05, longitude: OFFICE.longitude, radiusMeters: 100 }
  const p = { lat: second.latitude, lng: second.longitude }
  assert.equal(M.classifyPoint(p, [OFFICE]).cls, "outside")
  assert.equal(M.classifyPoint(p, [OFFICE, second]).cls, "inside")
})
t("no offices → ambiguous (never outside)", () => {
  assert.equal(M.classifyPoint(north(5000), []).cls, "ambiguous")
})

// ── outsideSpans / currentOutsideSince ───────────────────────────────────────────────────────────
const P = (min, c, event = "point") => ({ at: at(min), cls: c, event })
t("a single clear point is not enough", () => {
  assert.equal(M.currentOutsideSince([P(10, "outside")]), null)
})
t("two consecutive clear points → outside from the first", () => {
  assert.equal(M.currentOutsideSince([P(10, "outside"), P(25, "outside")])?.getTime(), at(10).getTime())
})
t("an exit event alone is enough", () => {
  assert.equal(M.currentOutsideSince([P(10, "outside", "exit")])?.getTime(), at(10).getTime())
})
t("an exit event that is only jitter is not", () => {
  assert.equal(M.currentOutsideSince([P(10, "ambiguous", "exit")]), null)
})
t("ambiguous between two clear points breaks the run", () => {
  assert.equal(M.currentOutsideSince([P(10, "outside"), P(20, "ambiguous"), P(30, "outside")]), null)
  assert.equal(M.currentOutsideSince([P(10, "outside"), P(20, "ambiguous"), P(30, "outside"), P(45, "outside")])?.getTime(), at(30).getTime())
})
t("coming back inside closes the episode; leaving again starts a new one", () => {
  const pts = [P(10, "outside", "exit"), P(25, "outside"), P(40, "inside", "enter"), P(100, "outside", "exit")]
  const spans = M.outsideSpans(pts)
  assert.equal(spans.length, 2)
  assert.equal(spans[0].to.getTime(), at(40).getTime())
  assert.equal(spans[1].from.getTime(), at(100).getTime())
  assert.equal(spans[1].to, null)
})
t("order of arrival does not matter (offline queue drains late)", () => {
  const a = [P(40, "inside", "enter"), P(10, "outside", "exit"), P(100, "outside"), P(115, "outside")]
  assert.equal(M.currentOutsideSince(a)?.getTime(), at(100).getTime())
})
t("ambiguous points while outside keep them outside", () => {
  assert.equal(M.currentOutsideSince([P(10, "outside", "exit"), P(25, "ambiguous"), P(40, "ambiguous")])?.getTime(), at(10).getTime())
})

// ── excuseEffect ─────────────────────────────────────────────────────────────────────────────────
t("pending or approved pauses; rejected/canceled restarts at the latest resolution", () => {
  assert.deepEqual(M.excuseEffect([{ status: "PENDING", resolvedAt: null }]), { paused: true, restartAt: null })
  assert.equal(M.excuseEffect([{ status: "APPROVED", resolvedAt: at(5) }]).paused, true)
  const r = M.excuseEffect([{ status: "REJECTED", resolvedAt: at(50) }, { status: "CANCELED", resolvedAt: at(70) }])
  assert.equal(r.paused, false)
  assert.equal(r.restartAt.getTime(), at(70).getTime())
})

// ── decideOutsideStep ────────────────────────────────────────────────────────────────────────────
const step = (o) => M.decideOutsideStep({ stage: null, stageAt: null, paused: false, restartAt: null, ...o })
t("inside → nothing", () => {
  const s = step({ now: at(200), outsideSince: null })
  assert.equal(s.stage, "inside")
  assert.equal(s.fire, null)
  assert.equal(s.nextAt, null)
})
t("outside 1 h 29 → nothing yet, next at 1 h 30", () => {
  const s = step({ now: at(89), outsideSince: at(0), stage: "outside", stageAt: at(0) })
  assert.equal(s.fire, null)
  assert.equal(s.stage, "outside")
  assert.equal(s.nextAt.getTime(), at(90).getTime())
  assert.equal(s.autoAt.getTime(), at(150).getTime())
})
t("1 h 30 → reminder, once", () => {
  const s = step({ now: at(90), outsideSince: at(0), stage: "outside", stageAt: at(0) })
  assert.equal(s.fire, "reminder")
  assert.equal(s.nextStoredStage, "reminded")
  assert.equal(M.stageAfter(s), "reminded")
  const again = step({ now: at(95), outsideSince: at(0), stage: "reminded", stageAt: at(90) })
  assert.equal(again.fire, null)
  assert.equal(again.nextAt.getTime(), at(120).getTime())
})
t("2 h → warning; auto due at 2 h 30", () => {
  const s = step({ now: at(120), outsideSince: at(0), stage: "reminded", stageAt: at(90) })
  assert.equal(s.fire, "warning")
  assert.equal(s.autoAt.getTime(), at(150).getTime())
  const mid = step({ now: at(149), outsideSince: at(0), stage: "warned", stageAt: at(120) })
  assert.equal(mid.fire, null)
  assert.equal(mid.nextAt.getTime(), at(150).getTime())
})
t("2 h 30 → auto check-out, once", () => {
  const s = step({ now: at(150), outsideSince: at(0), stage: "warned", stageAt: at(120) })
  assert.equal(s.fire, "auto")
  assert.equal(s.nextStoredStage, "auto_checked_out")
  const done = step({ now: at(151), outsideSince: at(0), stage: "auto_checked_out", stageAt: at(150) })
  assert.equal(done.fire, null)
  assert.equal(done.stage, "auto_checked_out")
})
t("late discovery skips the reminder but never the warning, and waits 30 min after it", () => {
  // First proof of leaving arrives 2 h 40 after the fact (phone was offline).
  const s = step({ now: at(160), outsideSince: at(0), stage: "outside", stageAt: at(160) })
  assert.equal(s.fire, "warning")
  assert.equal(s.autoAt.getTime(), at(190).getTime())
  const early = step({ now: at(185), outsideSince: at(0), stage: "warned", stageAt: at(160) })
  assert.equal(early.fire, null)
  const due = step({ now: at(190), outsideSince: at(0), stage: "warned", stageAt: at(160) })
  assert.equal(due.fire, "auto")
})
t("a cron that ran late at 2 h 01 still gives a full 30 minutes", () => {
  const s = step({ now: at(121), outsideSince: at(0), stage: "reminded", stageAt: at(90) })
  assert.equal(s.fire, "warning")
  assert.equal(s.autoAt.getTime(), at(151).getTime())
})
t("a pending/approved excuse pauses everything", () => {
  const s = step({ now: at(300), outsideSince: at(0), stage: "warned", stageAt: at(120), paused: true })
  assert.equal(s.stage, "paused_permit")
  assert.equal(s.fire, null)
  assert.equal(s.nextAt, null)
})
t("rejected excuse restarts the clock from the rejection, and old stages no longer count", () => {
  // Out since 0, warned at 120, filed izin, rejected at 200.
  const a = step({ now: at(210), outsideSince: at(0), stage: "warned", stageAt: at(120), restartAt: at(200) })
  assert.equal(a.fire, null)
  assert.equal(a.stage, "outside")
  assert.equal(a.nextAt.getTime(), at(290).getTime())
  const b = step({ now: at(290), outsideSince: at(0), stage: "warned", stageAt: at(120), restartAt: at(200) })
  assert.equal(b.fire, "reminder")
  const c = step({ now: at(350), outsideSince: at(0), stage: "warned", stageAt: at(320), restartAt: at(200) })
  assert.equal(c.fire, "auto")
})
t("a rejection before the episode started changes nothing", () => {
  const s = step({ now: at(90), outsideSince: at(0), stage: "outside", stageAt: at(0), restartAt: at(-60) })
  assert.equal(s.fire, "reminder")
})
t("a stage from a previous episode does not count", () => {
  // Warned at 200 in an earlier episode; left again at 300. Not an instant auto check-out:
  const s = step({ now: at(350), outsideSince: at(300), stage: "warned", stageAt: at(200) })
  assert.equal(s.fire, null)
  assert.equal(s.stage, "outside")
  // …the new episode runs its own course from the reminder.
  assert.equal(step({ now: at(390), outsideSince: at(300), stage: "warned", stageAt: at(200) }).fire, "reminder")
})
t("minutesOutside is measured from leaving, not from a restart", () => {
  const s = step({ now: at(210), outsideSince: at(0), restartAt: at(200) })
  assert.equal(s.minutesOutside, 210)
})

// ── copy ─────────────────────────────────────────────────────────────────────────────────────────
t("clock text is HH:mm in WIB", () => {
  assert.equal(M.clockText(new Date("2026-09-24T06:05:00Z")), "13:05")
  assert.equal(M.clockText(new Date("2026-09-24T17:30:00Z")), "00:30")
})
t("durations", () => {
  assert.equal(M.durationText(90), "1 jam 30 menit")
  assert.equal(M.durationText(120), "2 jam")
  assert.equal(M.durationText(45), "45 menit")
})
t("push copy", () => {
  const r = M.outsidePushCopy("reminder", { minutesOutside: 90, autoAt: at(150), outsideSince: at(0), now: at(90) })
  assert.equal(r.type, "attendance_outside_reminder")
  assert.equal(r.title, "Masih di luar kantor")
  assert.equal(r.body, "Sudah 1 jam 30 menit di luar kantor · sisa 1 jam · check-out otomatis 11:30. Ajukan izin kalau ada kegiatan di luar.")
  const w = M.outsidePushCopy("warning", { minutesOutside: 120, autoAt: at(150), outsideSince: at(0), now: at(120) })
  assert.equal(w.type, "attendance_outside_warning")
  assert.equal(w.title, "30 menit lagi")
  assert.equal(w.body, "Sudah 2 jam di luar kantor · sisa 30 menit · check-out otomatis 11:30.")
  const a = M.outsidePushCopy("auto", { minutesOutside: 0, autoAt: null, outsideSince: at(0), approverMode: "BOD_GROUP" })
  assert.equal(a.type, "attendance_auto_offsite_checkout")
  assert.equal(a.body, "Kamu di luar kantor sejak 09:00, jadi di-check-out offsite. Menunggu persetujuan BoD.")
  const m = M.outsidePushCopy("auto", { minutesOutside: 0, autoAt: null, outsideSince: at(0), approverMode: "DIRECT_MANAGER" })
  assert.match(m.body, /persetujuan atasanmu\.$/)
})
t("push copy: the owner's example, end to end through the clock (out at 20:59 → auto 23:29)", () => {
  const since = at(719) // 20:59 WIB
  const copyAt = (min) => {
    const s = step({ now: at(min), outsideSince: since })
    return M.outsidePushCopy(s.fire, { minutesOutside: s.minutesOutside, autoAt: s.autoAt, outsideSince: since, now: at(min) }).body
  }
  assert.equal(copyAt(719 + 90), "Sudah 1 jam 30 menit di luar kantor · sisa 1 jam · check-out otomatis 23:29. Ajukan izin kalau ada kegiatan di luar.")
  const warned = step({ now: at(719 + 120), outsideSince: since, stage: "reminded", stageAt: at(719 + 90) })
  assert.equal(warned.fire, "warning")
  assert.equal(
    M.outsidePushCopy("warning", { minutesOutside: warned.minutesOutside, autoAt: warned.autoAt, outsideSince: since, now: at(719 + 120) }).body,
    "Sudah 2 jam di luar kantor · sisa 30 menit · check-out otomatis 23:29.",
  )
})
t("push copy: time left rounds up (a late tick never says 59 menit)", () => {
  const r = M.outsidePushCopy("reminder", { minutesOutside: 90, autoAt: at(150), outsideSince: at(0), now: new Date(at(90).getTime() + 25_000) })
  assert.match(r.body, / · sisa 1 jam · check-out otomatis 11:30\. /)
  const w = M.outsidePushCopy("warning", { minutesOutside: 121, autoAt: at(150), outsideSince: at(0), now: at(121) })
  assert.match(w.body, /^Sudah 2 jam 1 menit di luar kantor · sisa 29 menit · check-out otomatis 11:30\.$/)
})
t("push copy: a late warning quotes its own auto time (warn + 30)", () => {
  // Phone offline: the first proof of 3 h 20 min outside arrives at 12:20 → warned now, auto 12:50.
  const s = step({ now: at(200), outsideSince: at(0) })
  assert.equal(s.fire, "warning")
  const w = M.outsidePushCopy("warning", { minutesOutside: s.minutesOutside, autoAt: s.autoAt, outsideSince: at(0), now: at(200) })
  assert.equal(w.body, "Sudah 3 jam 20 menit di luar kantor · sisa 30 menit · check-out otomatis 12:50.")
})
t("push copy: after a rejected izin the clock restarted, the time outside did not", () => {
  const s = step({ now: at(290), outsideSince: at(0), restartAt: at(200) })
  assert.equal(s.fire, "reminder")
  const r = M.outsidePushCopy("reminder", { minutesOutside: s.minutesOutside, autoAt: s.autoAt, outsideSince: at(0), now: at(290) })
  assert.equal(r.body, "Sudah 4 jam 50 menit di luar kantor · sisa 1 jam · check-out otomatis 14:50. Ajukan izin kalau ada kegiatan di luar.")
})
t("push copy: no autoAt (never from the clock) still reads right", () => {
  const r = M.outsidePushCopy("reminder", { minutesOutside: 90, autoAt: null, outsideSince: at(0), now: at(90) })
  assert.equal(r.body, "Sudah 1 jam 30 menit di luar kantor. Ajukan izin kalau ada kegiatan di luar.")
  const w = M.outsidePushCopy("warning", { minutesOutside: 120, autoAt: null, outsideSince: at(0), now: at(120) })
  assert.equal(w.body, "Sudah 2 jam di luar kantor · sisa 30 menit · check-out otomatis 11:30.")
})
t("dense route (iOS 0.1.6: a point per 50 m): 3000 points through classify, spans and hours", () => {
  // Out and back ten times over a 10-hour day, a point every 12 s — far past a real day's density.
  const pts = []
  for (let i = 0; i < 3000; i++) {
    const phase = i % 300 // 0..299 in each hour: out for the first 200, back for the rest
    const m = phase < 200 ? 400 + phase * 10 : 0
    const p = { ...north(m), accuracy: 8, at: new Date(at(0).getTime() + i * 12_000), event: phase === 0 ? "exit" : phase === 200 ? "enter" : "point" }
    pts.push(p)
  }
  const t0 = Date.now()
  const classified = pts.map((p) => ({ at: p.at, cls: M.classifyPoint(p, [OFFICE]).cls, event: p.event }))
  const spans = M.outsideSpans(classified)
  const hours = M.presenceHours({ checkInAt: at(0), closedAt: at(600), now: at(700), points: classified, spans })
  const ms = Date.now() - t0
  assert.equal(spans.length, 10)
  assert.ok(spans.every((s) => s.to !== null), "every outing closed by its enter")
  assert.equal(hours.length, 10)
  assert.ok(ms < 1000, `took ${ms} ms`)
})
t("auto reason", () => {
  assert.equal(M.autoCheckoutReason(at(0)), "Auto: di luar kantor lebih dari 2 jam 30 menit (sejak 09:00)")
  assert.equal(M.isAutoOffsiteCheckoutReason(M.autoCheckoutReason(at(0))), true)
  assert.equal(M.isAutoOffsiteCheckoutReason("meeting klien"), false)
})

// ── parseTrailPoints ─────────────────────────────────────────────────────────────────────────────
t("bad points are dropped, not fatal; duplicates within a batch keep the first", () => {
  const { points, dropped } = M.parseTrailPoints([
    { lat: -6.2, lng: 106.8, at: "2026-09-24T02:00:00Z", accuracy: 12, event: "exit" },
    { lat: -6.2, lng: 106.8, at: "2026-09-24T02:00:00Z" },
    { lat: 95, lng: 106.8, at: "2026-09-24T02:10:00Z" },
    { lat: "x", lng: 106.8, at: "2026-09-24T02:10:00Z" },
    { lat: -6.2, lng: 106.8, at: "not a date" },
    { lat: -6.2, lng: 106.8, at: "2026-09-24T02:15:00Z", accuracy: -1, event: "bogus" },
    null,
  ])
  assert.equal(points.length, 2)
  assert.equal(dropped, 5)
  assert.equal(points[0].event, "exit")
  assert.equal(points[1].accuracy, null)
  assert.equal(points[1].event, null)
})

// ── client detection / iPhone browser rule ───────────────────────────────────────────────────────
const UA = {
  iosSafari: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1",
  iosChrome: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/140.0.7339.101 Mobile/15E148 Safari/604.1",
  ipadSafari: "Mozilla/5.0 (iPad; CPU OS 17_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.7 Mobile/15E148 Safari/604.1",
  ipod: "Mozilla/5.0 (iPod touch; CPU iPhone OS 15_8 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.8 Mobile/15E148 Safari/604.1",
  legacyApp: "NEXUS/8 CFNetwork/3860.700.1 Darwin/25.6.0",
  app016: "NEXUS/12 CFNetwork/3860.700.1 Darwin/25.6.0",
  android: "Mozilla/5.0 (Linux; Android 14; SM-A546E) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36",
  desktopChrome: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36",
  desktopSafari: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Safari/605.1.15",
  ipadDesktopMode: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Safari/605.1.15",
  windowsEdge: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0",
}
t("iPhone/iPad/iPod browsers are refused, with or without web/1", () => {
  assert.equal(M.isIosBrowserWithoutApp(UA.iosSafari, null), true)
  assert.equal(M.isIosBrowserWithoutApp(UA.iosChrome, null), true)
  assert.equal(M.isIosBrowserWithoutApp(UA.iosSafari, "web/1"), true)
  assert.equal(M.isIosBrowserWithoutApp(UA.ipadSafari, "web/1"), true)
  assert.equal(M.isIosBrowserWithoutApp(UA.ipod, null), true)
})
t("apps are never refused", () => {
  assert.equal(M.isIosBrowserWithoutApp(UA.legacyApp, null), false)
  assert.equal(M.isIosBrowserWithoutApp(UA.app016, "ios/0.1.6/12"), false)
  assert.equal(M.isIosBrowserWithoutApp(UA.iosSafari, "ios/0.1.7/13"), false) // header wins
  assert.equal(M.isIosBrowserWithoutApp(UA.iosSafari, "IOS/0.1.7/13"), false)
})
t("Android, desktop and iPadOS desktop mode are allowed", () => {
  for (const ua of [UA.android, UA.desktopChrome, UA.desktopSafari, UA.ipadDesktopMode, UA.windowsEdge]) {
    assert.equal(M.isIosBrowserWithoutApp(ua, "web/1"), false, ua)
    assert.equal(M.isIosBrowserWithoutApp(ua, null), false, ua)
  }
  assert.equal(M.isIosBrowserWithoutApp(null, null), false)
  assert.equal(M.isIosBrowserWithoutApp("curl/8.5.0", null), false)
})
t("check-in client", () => {
  assert.equal(M.attendanceClientOf(UA.app016, "ios/0.1.6/12"), "ios-app")
  assert.equal(M.attendanceClientOf(UA.legacyApp, null), "legacy-app")
  assert.equal(M.attendanceClientOf("NEXUS-Android/0.1.0 (1; Android 34)", "android/0.1.0/1"), "android-app")
  assert.equal(M.attendanceClientOf("okhttp/4.12.0", "Android/0.1.0/1"), "android-app")
  assert.equal(M.isIosBrowserWithoutApp("NEXUS-Android/0.1.0 (1; Android 34)", "android/0.1.0/1"), false)
  assert.equal(M.attendanceClientOf(UA.desktopChrome, "web/1"), "web")
  assert.equal(M.attendanceClientOf(UA.android, null), "web")
  assert.equal(M.attendanceClientOf(UA.ipadDesktopMode, null), "web")
  assert.equal(M.attendanceClientOf("curl/8.5.0", null), null)
  assert.equal(M.attendanceClientOf(null, null), null)
})

// ── presence checks (25 Sep 2026) ─────────────────────────────────────────────────────────────────
{
  const O = [{ latitude: -6.2253, longitude: 106.829, radiusMeters: 150 }]
  const north = (m) => -6.2253 + m / 111195 // metres north of the office centre
  // 08:47 WIB = 01:47Z
  const W = (hhmm) => new Date(`2026-09-25T${String(Number(hhmm.slice(0, 2)) - 7).padStart(2, "0")}:${hhmm.slice(3)}:00Z`)
  const cp = (hhmm, cls, event = "presence") => ({ at: W(hhmm), cls, event })

  t("presence: parse accepts the event, classify treats it like a point", () => {
    const { points, dropped } = M.parseTrailPoints([{ lat: -6.2, lng: 106.8, at: "2026-09-25T02:00:00.000Z", accuracy: 9, event: "presence" }])
    assert.equal(dropped, 0)
    assert.equal(points[0].event, "presence")
    // 180 m out with ±10: within radius+50 → ambiguous (only "enter" gets the looser rule)
    assert.equal(M.classifyPoint({ lat: north(180), lng: 106.829, accuracy: 10, event: "presence" }, O).cls, "ambiguous")
    assert.equal(M.classifyPoint({ lat: north(180), lng: 106.829, accuracy: 10, event: "enter" }, O).cls, "inside")
    assert.equal(M.classifyPoint({ lat: north(40), lng: 106.829, accuracy: 12, event: "presence" }, O).cls, "inside")
    assert.equal(M.classifyPoint({ lat: north(400), lng: 106.829, accuracy: 12, event: "presence" }, O).cls, "outside")
  })

  t("presence: counts in the outside episodes like any point", () => {
    // two consecutive clearly-outside presence checks prove an episode; a presence inside ends it
    const spans = M.outsideSpans([cp("10:00", "outside"), cp("10:50", "outside"), cp("11:40", "inside")])
    assert.equal(spans.length, 1)
    assert.equal(spans[0].from.toISOString(), W("10:00").toISOString())
    assert.equal(spans[0].to.toISOString(), W("11:40").toISOString())
    // a lone outside reading between inside checks proves nothing
    assert.equal(M.outsideSpans([cp("10:00", "inside"), cp("10:50", "outside"), cp("11:40", "inside")]).length, 0)
  })

  t("presence hours: a full day at the office", () => {
    const pts = ["09:37", "10:27", "11:17", "12:07", "12:57", "13:47", "14:37", "15:27", "16:17"].map((h) => cp(h, "inside"))
    const hours = M.presenceHours({ checkInAt: W("08:47"), closedAt: W("17:05"), checkOutInsideAt: W("17:05"), now: W("20:00"), points: pts, spans: [] })
    assert.deepEqual(hours.map((h) => h.label), ["08", "09", "10", "11", "12", "13", "14", "15", "16", "17"])
    assert.ok(hours.every((h) => h.status === "inside"), hours.map((h) => h.status).join(","))
    assert.equal(hours[0].from.toISOString(), W("08:47").toISOString(), "first hour starts at the check-in")
    assert.equal(hours[0].at.toISOString(), W("08:47").toISOString(), "the check-in is the first hour's check")
    assert.equal(hours[9].to.toISOString(), W("17:05").toISOString(), "last hour ends at the check-out")
    assert.equal(hours[12 - 8].at.toISOString(), W("12:57").toISOString(), "latest check of the hour")
  })

  t("presence hours: outside episode, gap, unclear, pending", () => {
    const pts = [
      cp("09:37", "inside"),
      cp("10:20", "outside", "exit"), cp("10:35", "outside", "point"), cp("10:50", "outside", "point"),
      cp("11:05", "inside", "enter"),
      cp("11:55", "inside"),
      // 12: nothing (phone quiet) → gap
      cp("13:30", "ambiguous"),
      cp("14:10", "outside"), // lone, unconfirmed → unclear
      cp("15:05", "inside"),
    ]
    const spans = M.outsideSpans(pts)
    assert.equal(spans.length, 1)
    const hours = M.presenceHours({ checkInAt: W("08:47"), closedAt: null, now: W("15:20"), points: pts, spans })
    assert.deepEqual(hours.map((h) => `${h.label}:${h.status}`), ["08:inside", "09:inside", "10:outside", "11:outside", "12:gap", "13:unclear", "14:unclear", "15:inside"])
    assert.equal(hours[7].to.toISOString(), W("15:20").toISOString(), "open record: the running hour ends now")
    assert.equal(hours[4].at, null)
    assert.equal(hours[6].at.toISOString(), W("14:10").toISOString())
  })

  t("presence hours: the running hour with nothing yet is pending, a past one a gap", () => {
    const hours = M.presenceHours({ checkInAt: W("08:47"), closedAt: null, now: W("10:20"), points: [cp("09:37", "inside")], spans: [] })
    assert.deepEqual(hours.map((h) => `${h.label}:${h.status}`), ["08:inside", "09:inside", "10:pending"])
    const later = M.presenceHours({ checkInAt: W("08:47"), closedAt: null, now: W("11:20"), points: [cp("09:37", "inside")], spans: [] })
    assert.deepEqual(later.map((h) => h.status), ["inside", "inside", "gap", "pending"])
  })

  t("presence hours: an hour inside an open episode with no points is outside, not a gap", () => {
    const pts = [cp("09:10", "outside", "exit")]
    const hours = M.presenceHours({ checkInAt: W("08:47"), closedAt: null, now: W("11:30"), points: pts, spans: M.outsideSpans(pts) })
    assert.deepEqual(hours.map((h) => h.status), ["inside", "outside", "outside", "outside"])
    // the check-in hour stays inside (the episode starts at 09:10)
    assert.equal(hours[0].label, "08")
  })

  t("presence hours: out-of-radius check-in / check-out are not checks", () => {
    const hours = M.presenceHours({ checkInAt: W("08:47"), checkInInside: false, closedAt: W("09:30"), checkOutInsideAt: null, now: W("12:00"), points: [], spans: [] })
    assert.deepEqual(hours.map((h) => h.status), ["gap", "gap"])
  })

  t("presence hours: no check-in → none; just checked in → one pending-free hour", () => {
    assert.deepEqual(M.presenceHours({ checkInAt: null, closedAt: null, now: W("09:00"), points: [], spans: [] }), [])
    const h = M.presenceHours({ checkInAt: W("09:00"), closedAt: null, now: W("09:00"), points: [], spans: [] })
    assert.equal(h.length, 1)
    assert.equal(h[0].status, "inside")
    assert.equal(h[0].label, "09")
  })

  t("presence hours: office timezone decides the hour, including +05:30", () => {
    const at = new Date("2026-09-25T03:10:00Z") // 10:10 WIB, 08:40 IST
    const wib = M.presenceHours({ checkInAt: at, closedAt: new Date("2026-09-25T04:45:00Z"), now: at, points: [], spans: [] })
    assert.deepEqual(wib.map((h) => h.label), ["10", "11"])
    const ist = M.presenceHours({ checkInAt: at, closedAt: new Date("2026-09-25T04:45:00Z"), now: at, points: [], spans: [], timeZone: "Asia/Kolkata" })
    assert.deepEqual(ist.map((h) => h.label), ["08", "09", "10"])
    assert.equal(ist[1].from.toISOString(), "2026-09-25T03:30:00.000Z", "IST hours start at :30 UTC")
    assert.equal(M.hourStart(at, "Not/AZone").toISOString(), "2026-09-25T03:00:00.000Z", "bad timezone falls back to WIB")
  })

  t("presence hours: capped, and a forgotten check-out does not grow forever", () => {
    const h = M.presenceHours({ checkInAt: W("08:47"), closedAt: null, now: new Date(W("08:47").getTime() + 40 * 3600e3), points: [], spans: [] })
    assert.equal(h.length, M.PRESENCE_MAX_HOURS)
    assert.equal(h[h.length - 1].status, "gap", "only the running hour can be pending")
  })

  t("presence hours: a close exactly on the hour adds no empty hour", () => {
    const h = M.presenceHours({ checkInAt: W("08:47"), closedAt: W("10:00"), now: W("12:00"), points: [cp("09:37", "inside")], spans: [] })
    assert.deepEqual(h.map((x) => x.label), ["08", "09"])
  })
}

console.log(`${passed} passed${process.exitCode ? ", some FAILED" : ""}`)
