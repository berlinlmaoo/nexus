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
  const r = M.outsidePushCopy("reminder", { minutesOutside: 90, autoAt: null, outsideSince: at(0) })
  assert.equal(r.type, "attendance_outside_reminder")
  assert.equal(r.title, "Masih di luar kantor")
  assert.equal(r.body, "Sudah 1 jam 30 menit di luar kantor. Balik ke kantor, atau ajukan izin kalau ada kegiatan di luar.")
  const w = M.outsidePushCopy("warning", { minutesOutside: 120, autoAt: at(150), outsideSince: at(0) })
  assert.equal(w.type, "attendance_outside_warning")
  assert.equal(w.title, "30 menit lagi")
  assert.equal(w.body, "Sudah 2 jam di luar kantor. Kalau belum kembali jam 11:30, kamu otomatis check-out offsite.")
  const a = M.outsidePushCopy("auto", { minutesOutside: 0, autoAt: null, outsideSince: at(0), approverMode: "BOD_GROUP" })
  assert.equal(a.type, "attendance_auto_offsite_checkout")
  assert.equal(a.body, "Kamu di luar kantor sejak 09:00, jadi di-check-out offsite. Menunggu persetujuan BoD.")
  const m = M.outsidePushCopy("auto", { minutesOutside: 0, autoAt: null, outsideSince: at(0), approverMode: "DIRECT_MANAGER" })
  assert.match(m.body, /persetujuan atasanmu\.$/)
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
  assert.equal(M.attendanceClientOf(UA.desktopChrome, "web/1"), "web")
  assert.equal(M.attendanceClientOf(UA.android, null), "web")
  assert.equal(M.attendanceClientOf(UA.ipadDesktopMode, null), "web")
  assert.equal(M.attendanceClientOf("curl/8.5.0", null), null)
  assert.equal(M.attendanceClientOf(null, null), null)
})

console.log(`${passed} passed${process.exitCode ? ", some FAILED" : ""}`)
