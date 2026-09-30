/**
 * "Live location while checked in" — the decisions, and nothing else.
 *
 * Pure: no Prisma, no I/O, no "@/" imports, so `node src/lib/attendance-outside.test.mjs` can load it
 * on its own. The database side (ingest, the per-minute clock, the automatic offsite check-out) is in
 * attendance-location.ts and only ever asks this file what to do.
 *
 * The owner's rules (Sep 2026, final):
 *   - Tracked only between a self check-in at an office and the check-out.
 *   - Outside = distance > radius + max(accuracy, 50 m), on an "exit" event or on 2 consecutive points.
 *     Inside  = distance <= radius on any point, or an "enter" event (see classifyPoint for the one
 *     place this is looser than the letter of the rule, and why).
 *   - Outside continuously for 1 h 30 → reminder. 2 h → warning ("30 menit lagi"). 2 h 30 → automatic
 *     offsite check-out, check-out time = the moment they left the radius.
 *   - A real excuse (izin etc.) covering today that is PENDING or APPROVED pauses the clock; rejected or
 *     withdrawn → the clock restarts from that moment. Coming back inside resets it.
 *   - Presence checks (25 Sep 2026): while inside, the app (iOS 0.1.6+) also sends one point about every
 *     hour, event "presence", so the trail shows a day spent at the office (presenceHours below). They
 *     are points like any other: classified, counted in the outside episodes, stored 90 days.
 */

export const OUTSIDE_REMIND_MIN = 90
export const OUTSIDE_WARN_MIN = 120
export const OUTSIDE_AUTO_MIN = 150
/** After a warning, at least this long before the automatic check-out — see decideOutsideStep. */
export const OUTSIDE_WARN_GRACE_MIN = 30
/** No point for longer than this while outside = the phone went quiet (the clock keeps running). */
export const OUTSIDE_STALE_MIN = 30
/** Jitter floor: a fix must be this far past the radius (or its accuracy, if worse) to count as out. */
export const OUTSIDE_MIN_BUFFER_M = 50
export const MAX_POINTS_PER_REQUEST = 200

/** "presence": the hourly check while inside (iOS 0.1.6+). Classified and counted exactly like "point". */
export type TrailEvent = "exit" | "enter" | "point" | "presence"
export type PointClass = "inside" | "outside" | "ambiguous"
/** Stored in AttendanceRecord.outsideStage. */
export type StoredStage = "outside" | "reminded" | "warned" | "auto_checked_out"
/** What POST /api/attendance/location-trail answers. */
export type ResponseStage = "inside" | "outside" | "reminded" | "warned" | "auto_checked_out" | "paused_permit"
export type Fire = "reminder" | "warning" | "auto"

export type OfficeGeo = { latitude: number; longitude: number; radiusMeters: number }

/** Same formula as haversineDistanceMeters in attendance.ts (copied: that file imports Prisma). */
export function distanceMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const r = (v: number) => (v * Math.PI) / 180
  const dLat = r(lat2 - lat1)
  const dLng = r(lng2 - lng1)
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(r(lat1)) * Math.cos(r(lat2)) * Math.sin(dLng / 2) ** 2
  return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

/**
 * One fix against the offices it may count as "the office".
 *
 * Every active office of the workspace counts, not only the one checked in at: someone who checks in
 * at one office and walks to another for a meeting is not "di luar kantor".
 *
 *   inside    — within the radius of some office.
 *   outside   — beyond radius + max(accuracy, 50 m) of EVERY office (clearly out, not jitter).
 *   ambiguous — neither; it changes nothing on its own.
 *
 * An "enter" event is the one looser case: it counts as inside unless it is clearly outside. iOS fires
 * the region entry at the region's edge, often with a fix a few tens of metres out, and while inside
 * the app sends nothing more — so a literal "enter only counts at <= radius" would leave someone who
 * came back marked outside until the clock checked them out automatically.
 */
export function classifyPoint(
  p: { lat: number; lng: number; accuracy?: number | null; event?: string | null },
  offices: OfficeGeo[],
): { cls: PointClass; distanceMeters: number | null } {
  if (offices.length === 0) return { cls: "ambiguous", distanceMeters: null }
  const acc = typeof p.accuracy === "number" && Number.isFinite(p.accuracy) && p.accuracy > 0 ? p.accuracy : 0
  const buffer = Math.max(acc, OUTSIDE_MIN_BUFFER_M)
  let nearest = Infinity
  let within = false
  let clearOfAll = true
  let withinBuffered = false
  for (const o of offices) {
    const d = distanceMeters(p.lat, p.lng, o.latitude, o.longitude)
    nearest = Math.min(nearest, d)
    if (d <= o.radiusMeters) within = true
    if (d <= o.radiusMeters + buffer) {
      clearOfAll = false
      withinBuffered = true
    }
  }
  const dist = Math.round(nearest * 10) / 10
  if (within) return { cls: "inside", distanceMeters: dist }
  if (p.event === "enter" && withinBuffered) return { cls: "inside", distanceMeters: dist }
  if (clearOfAll) return { cls: "outside", distanceMeters: dist }
  return { cls: "ambiguous", distanceMeters: dist }
}

export type ClassifiedPoint = { at: Date; cls: PointClass; event?: string | null; distanceMeters?: number | null }

/**
 * An "exit" this close to an office proves the phone was inside one until that moment, even when the
 * matching "enter" never reached us. iOS 0.1.6 can lose the enter: a region entry with no fresh fix
 * waits for one, and when the next fix already says "outside" only the exit is sent (Azra, 30 Sep
 * 2026: 8 minutes inside TAN Group HQ, clock kept running from the office she left before).
 */
export const EXIT_PROVES_INSIDE_M = 400
export type OutsideSpan = { from: Date; to: Date | null }

/**
 * Walk the points of one record in time order (the check-in itself is the starting "inside") and
 * return every outside episode. The last span has `to: null` when the person is out right now.
 *
 * An episode starts at the FIRST fix that proves it: the exit event itself, or the first of the two
 * consecutive clearly-outside points. Not at some earlier ambiguous fix — while inside, the phone
 * sends nothing, so "the first fix past the radius since the last inside fix" could reach back hours
 * to a single noisy reading. Starting at the proof is the later, and therefore fairer, time; it is
 * also the check-out time an automatic offsite check-out records.
 *
 * Out-of-order arrival (an offline queue draining) does not matter: the caller sorts, and the whole
 * record is recomputed on every upload.
 */
export function outsideSpans(points: ClassifiedPoint[]): OutsideSpan[] {
  const sorted = [...points].sort((a, b) => a.at.getTime() - b.at.getTime())
  const spans: OutsideSpan[] = []
  let out = false
  let pending: ClassifiedPoint | null = null
  for (const p of sorted) {
    if (p.cls === "inside") {
      if (out) spans[spans.length - 1].to = p.at
      out = false
      pending = null
      continue
    }
    if (out) {
      if (p.event === "exit" && typeof p.distanceMeters === "number" && p.distanceMeters <= EXIT_PROVES_INSIDE_M) {
        // Inside an office until now (see EXIT_PROVES_INSIDE_M): the episode ends and a new one starts.
        spans[spans.length - 1].to = p.at
        spans.push({ from: p.at, to: null })
      }
      continue
    }
    if (p.cls === "outside") {
      if (p.event === "exit") {
        spans.push({ from: p.at, to: null })
        out = true
        pending = null
      } else if (pending) {
        spans.push({ from: pending.at, to: null })
        out = true
        pending = null
      } else {
        pending = p
      }
    } else {
      // Ambiguous breaks a run: "2 consecutive points" means consecutive.
      pending = null
    }
  }
  return spans
}

/** Start of the episode the person is in right now, or null when inside. */
export function currentOutsideSince(points: ClassifiedPoint[]): Date | null {
  const spans = outsideSpans(points)
  const last = spans[spans.length - 1]
  return last && last.to === null ? last.from : null
}

export type ExcuseForClock = { status: string; resolvedAt: Date | null }

/**
 * What the excuses covering the record's date do to the clock.
 * PENDING or APPROVED → paused. REJECTED or CANCELED → the clock may not start before that moment.
 */
export function excuseEffect(excuses: ExcuseForClock[]): { paused: boolean; restartAt: Date | null } {
  let paused = false
  let restartAt: Date | null = null
  for (const e of excuses) {
    if (e.status === "PENDING" || e.status === "APPROVED") paused = true
    else if ((e.status === "REJECTED" || e.status === "CANCELED") && e.resolvedAt) {
      if (!restartAt || e.resolvedAt > restartAt) restartAt = e.resolvedAt
    }
  }
  return { paused, restartAt }
}

const RANK: Record<string, number> = { outside: 0, reminded: 1, warned: 2, auto_checked_out: 3 }
const MIN = 60_000

export type OutsideStepInput = {
  now: Date
  outsideSince: Date | null
  /** AttendanceRecord.outsideStage / outsideStageAt as stored. */
  stage: string | null
  stageAt: Date | null
  paused: boolean
  restartAt: Date | null
}

export type OutsideStep = {
  /** For the API response. */
  stage: ResponseStage
  /** When the clock for this episode started (outsideSince, or a later izin rejection). */
  clockFrom: Date | null
  minutesOutside: number
  /** What to do now, if anything. The caller writes `nextStoredStage` conditionally, then acts. */
  fire: Fire | null
  nextStoredStage: StoredStage | null
  /** The moment the automatic check-out is due (known once warned; projected before). */
  autoAt: Date | null
  nextAt: Date | null
}

/**
 * One tick of the clock. Pure, so both the per-minute cron and the upload route call it and agree.
 *
 * Each stage fires once per episode: the stored stage only counts if it was reached at or after the
 * clock started (`stageAt >= clockFrom`). A new episode, or a restart after a rejected izin, therefore
 * starts from nothing without anyone having to reset the column.
 *
 * Late discovery never skips the warning. If the first proof of being outside arrives late (a phone
 * offline for two hours drains its queue), the reminder is skipped but the warning is sent, and the
 * automatic check-out waits at least OUTSIDE_WARN_GRACE_MIN after it — nobody is checked out by a
 * push they never had a chance to read. The recorded check-out time is still when they left.
 */
export function decideOutsideStep(i: OutsideStepInput): OutsideStep {
  const base = { minutesOutside: 0, fire: null, nextStoredStage: null, autoAt: null, nextAt: null }
  if (!i.outsideSince) return { ...base, stage: "inside", clockFrom: null }
  if (i.stage === "auto_checked_out") return { ...base, stage: "auto_checked_out", clockFrom: i.outsideSince }

  const clockFrom = i.restartAt && i.restartAt > i.outsideSince ? i.restartAt : i.outsideSince
  const minutesOutside = Math.max(0, Math.floor((i.now.getTime() - i.outsideSince.getTime()) / MIN))
  if (i.paused) return { ...base, minutesOutside, stage: "paused_permit", clockFrom }

  const stageCounts = i.stage && i.stageAt && i.stageAt >= clockFrom && RANK[i.stage] !== undefined
  const current: StoredStage = stageCounts ? (i.stage as StoredStage) : "outside"
  const rank = RANK[current]
  const elapsed = (i.now.getTime() - clockFrom.getTime()) / MIN
  const at = (m: number) => new Date(clockFrom.getTime() + m * MIN)
  const warnedAt = current === "warned" && i.stageAt ? i.stageAt : null
  const autoAtWarned = (w: Date) => new Date(Math.max(at(OUTSIDE_AUTO_MIN).getTime(), w.getTime() + OUTSIDE_WARN_GRACE_MIN * MIN))

  if (rank === 2 && warnedAt) {
    const autoAt = autoAtWarned(warnedAt)
    if (i.now >= autoAt) {
      return { stage: "warned", clockFrom, minutesOutside, fire: "auto", nextStoredStage: "auto_checked_out", autoAt, nextAt: null }
    }
    return { stage: "warned", clockFrom, minutesOutside, fire: null, nextStoredStage: null, autoAt, nextAt: autoAt }
  }
  if (elapsed >= OUTSIDE_WARN_MIN) {
    // rank 0 or 1: warn now (skipping the reminder if it was never sent).
    const autoAt = autoAtWarned(i.now)
    return { stage: current, clockFrom, minutesOutside, fire: "warning", nextStoredStage: "warned", autoAt, nextAt: autoAt }
  }
  if (elapsed >= OUTSIDE_REMIND_MIN && rank < 1) {
    return { stage: current, clockFrom, minutesOutside, fire: "reminder", nextStoredStage: "reminded", autoAt: at(OUTSIDE_AUTO_MIN), nextAt: at(OUTSIDE_WARN_MIN) }
  }
  return {
    stage: current,
    clockFrom,
    minutesOutside,
    fire: null,
    nextStoredStage: null,
    autoAt: at(OUTSIDE_AUTO_MIN),
    nextAt: rank < 1 ? at(OUTSIDE_REMIND_MIN) : at(OUTSIDE_WARN_MIN),
  }
}

/** The stage a response reports right after `step` was carried out. */
export function stageAfter(step: OutsideStep): ResponseStage {
  if (!step.fire) return step.stage
  return step.nextStoredStage ?? step.stage
}

// ── hourly presence ────────────────────────────────────────────────────────────────────────────────

/**
 * Presence checks (owner, 25 Sep 2026). While checked in and INSIDE the office, the app sends one point
 * about every hour (event "presence"), so a day spent at the office shows as one — not only the time
 * outside. This folds a record's points into one entry per office-clock hour of the shift, for the hour
 * chips on the trail (web and iOS draw the same thing from it).
 *
 * Derived here, not on each client: only the server classifies against EVERY office of the workspace
 * (a client knows the one checked in at), and the outside episodes that decide an hour are the very
 * ones the clock and the automatic check-out use — a chip can never disagree with them.
 *
 * An hour's status, first match wins:
 *   outside — an outside episode (outsideSpans: an exit, or two clearly-outside points) overlaps it;
 *   inside  — a point in it is inside an office, or the check-in / an in-radius check-out happened in it
 *             (both are geofenced, so each is itself a check);
 *   unclear — points arrived but none could say: a vague fix, or a lone reading past the radius that
 *             nothing confirmed (the clock ignores that one as jitter too);
 *   pending — the hour still running with nothing yet (open record only);
 *   gap     — nothing arrived: phone off, app ended by iOS, Always refused, or an app before 0.1.6.
 *
 * Every point counts, not only "presence": exit/enter and the route points say where the phone was
 * just as well. Hours are clock hours in the office timezone ("10" = 10:00–10:59 on the office wall);
 * the first starts at the check-in, the last ends at the close (or now). At most PRESENCE_MAX_HOURS —
 * the app itself stops tracking 16 h after a check-in.
 */
export const PRESENCE_MAX_HOURS = 17
export type PresenceStatus = "inside" | "outside" | "unclear" | "pending" | "gap"
export type PresenceHour = { from: Date; to: Date; label: string; status: PresenceStatus; at: Date | null }

const HOUR = 60 * MIN

function localClock(d: Date, timeZone: string): { hour: number; minute: number; second: number } {
  const fmt = (tz: string) =>
    new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" })
  let parts: Intl.DateTimeFormatPart[]
  try {
    parts = fmt(timeZone).formatToParts(d)
  } catch {
    parts = fmt("Asia/Jakarta").formatToParts(d)
  }
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0)
  return { hour: get("hour") % 24, minute: get("minute"), second: get("second") }
}

/** Start of the office-clock hour that contains `d` (right for half-hour offsets like +05:30 too). */
export function hourStart(d: Date, timeZone = "Asia/Jakarta"): Date {
  const c = localClock(d, timeZone)
  return new Date(d.getTime() - c.minute * MIN - c.second * 1000 - d.getUTCMilliseconds())
}

export function presenceHours(i: {
  checkInAt: Date | null
  /** Whether the check-in counts as a check (within the radius). Default true: tracked records are. */
  checkInInside?: boolean
  /** When the record closed (for an automatic check-out: when it happened); null while open. */
  closedAt: Date | null
  /** A check-out made within the radius — a check for its hour. */
  checkOutInsideAt?: Date | null
  now: Date
  points: ClassifiedPoint[]
  /** The episodes as the trail reports them (an episode still open at the close already ends there). */
  spans: OutsideSpan[]
  timeZone?: string
}): PresenceHour[] {
  if (!i.checkInAt) return []
  const tz = i.timeZone || "Asia/Jakarta"
  const open = i.closedAt === null
  const inMs = i.checkInAt.getTime()
  const endMs = Math.max(inMs, (i.closedAt ?? i.now).getTime())
  const sorted = [...i.points].sort((a, b) => a.at.getTime() - b.at.getTime())
  const checks: number[] = []
  if (i.checkInInside !== false) checks.push(inMs)
  if (i.checkOutInsideAt) checks.push(i.checkOutInsideAt.getTime())

  const hours: PresenceHour[] = []
  for (let s = hourStart(i.checkInAt, tz).getTime(); (hours.length === 0 || s < endMs) && hours.length < PRESENCE_MAX_HOURS; s += HOUR) {
    const from = Math.max(s, inMs)
    const to = Math.min(s + HOUR, endMs)
    const final = s + HOUR >= endMs
    const inHour = (t: number) => t >= from && t < s + HOUR && t <= endMs
    const pts = sorted.filter((p) => inHour(p.at.getTime()))
    const outside = i.spans.some((sp) => sp.from.getTime() < Math.max(to, from + 1) && (sp.to ? sp.to.getTime() : endMs) > from)
    const insidePts = pts.filter((p) => p.cls === "inside").map((p) => p.at.getTime())
    const insideChecks = [...insidePts, ...checks.filter(inHour)].sort((a, b) => a - b)
    const latest = pts.length ? pts[pts.length - 1].at.getTime() : null

    let status: PresenceStatus
    let at: number | null
    if (outside) {
      status = "outside"
      at = latest
    } else if (insideChecks.length) {
      status = "inside"
      at = insideChecks[insideChecks.length - 1]
    } else if (pts.length) {
      status = "unclear"
      at = latest
    } else {
      status = open && final ? "pending" : "gap"
      at = null
    }
    const label = String(localClock(new Date(s), tz).hour).padStart(2, "0")
    hours.push({ from: new Date(from), to: new Date(to), label, status, at: at === null ? null : new Date(at) })
  }
  return hours
}

// ── copy ───────────────────────────────────────────────────────────────────────────────────────────

/** "13:05" in the office's timezone (never "13.05", which is what id-ID would print). */
export function clockText(d: Date, timeZone = "Asia/Jakarta"): string {
  try {
    return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone })
  } catch {
    return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Jakarta" })
  }
}

/** 90 → "1 jam 30 menit", 120 → "2 jam", 45 → "45 menit". */
export function durationText(minutes: number): string {
  const m = Math.max(0, Math.floor(minutes))
  const h = Math.floor(m / 60)
  const r = m % 60
  if (h === 0) return `${r} menit`
  return r === 0 ? `${h} jam` : `${h} jam ${r} menit`
}

export const OUTSIDE_PUSH_CATEGORY = "NEXUS_OUTSIDE_OFFICE"
export const OUTSIDE_PERMIT_LINK = "/attendance?permit=today"

/**
 * The push (and in-app notification) text for one step of the clock.
 *
 * Owner, 28 Sep 2026: the reminder and the warning say how long is left and when the automatic
 * check-out happens — the same two facts the phone's own alerts (on leaving, and an hour in) and the
 * Live Activity show:
 *   "Sudah 1 jam 30 menit di luar kantor · sisa 1 jam · check-out otomatis 23:29. Ajukan izin kalau ada kegiatan di luar."
 *   "Sudah 2 jam di luar kantor · sisa 30 menit · check-out otomatis 23:29."
 * `now` is the moment the push is decided (the clock's own `now`); "sisa" is rounded UP to the minute,
 * so a cron tick a few seconds late still reads "sisa 1 jam", never "59 menit".
 */
export function outsidePushCopy(
  fire: Fire,
  o: {
    minutesOutside: number
    autoAt: Date | null
    outsideSince: Date
    timeZone?: string
    approverMode?: "DIRECT_MANAGER" | "BOD_GROUP"
    now?: Date
  },
): { type: string; title: string; body: string } {
  const tz = o.timeZone || "Asia/Jakarta"
  const now = o.now ?? new Date()
  const left = (autoAt: Date) => {
    const minutes = Math.max(0, Math.ceil((autoAt.getTime() - now.getTime()) / MIN - 0.001))
    return `sisa ${durationText(minutes)} · check-out otomatis ${clockText(autoAt, tz)}`
  }
  if (fire === "reminder") {
    return {
      type: "attendance_outside_reminder",
      title: "Masih di luar kantor",
      body: o.autoAt
        ? `Sudah ${durationText(o.minutesOutside)} di luar kantor · ${left(o.autoAt)}. Ajukan izin kalau ada kegiatan di luar.`
        : `Sudah ${durationText(o.minutesOutside)} di luar kantor. Ajukan izin kalau ada kegiatan di luar.`,
    }
  }
  if (fire === "warning") {
    const autoAt = o.autoAt ?? new Date(now.getTime() + OUTSIDE_WARN_GRACE_MIN * MIN)
    return {
      type: "attendance_outside_warning",
      title: "30 menit lagi",
      body: `Sudah ${durationText(o.minutesOutside)} di luar kantor · ${left(autoAt)}.`,
    }
  }
  const who = o.approverMode === "DIRECT_MANAGER" ? "atasanmu" : "BoD"
  return {
    type: "attendance_auto_offsite_checkout",
    title: "Check-out otomatis",
    body: `Kamu di luar kantor sejak ${clockText(o.outsideSince, tz)}, jadi di-check-out offsite. Menunggu persetujuan ${who}.`,
  }
}

/** The offsite reason the automatic check-out records (the "Auto:" prefix is how it is recognised). */
export function autoCheckoutReason(outsideSince: Date, timeZone = "Asia/Jakarta"): string {
  return `Auto: di luar kantor lebih dari 2 jam 30 menit (sejak ${clockText(outsideSince, timeZone)})`
}

export function isAutoOffsiteCheckoutReason(reason: string | null | undefined): boolean {
  return (reason ?? "").startsWith("Auto: di luar kantor")
}

// ── where a check-in came from ─────────────────────────────────────────────────────────────────────

export type CheckInClient = "ios-app" | "android-app" | "web" | "legacy-app"

/**
 * "ios-app"    — X-Nexus-Client: ios/… (0.1.6 and later).
 * "android-app" — X-Nexus-Client: android/… (every Android build).
 * "legacy-app" — no such header, User-Agent `NEXUS/<build> CFNetwork/… Darwin/…` (0.1.5 and older).
 * "web"        — X-Nexus-Client: web/… or any browser (User-Agent starting "Mozilla/").
 * null         — anything else (curl, scripts): unknown, and never guessed.
 */
export function attendanceClientOf(userAgent: string | null | undefined, clientHeader: string | null | undefined): CheckInClient | null {
  const header = (clientHeader ?? "").trim()
  if (/^ios\//i.test(header)) return "ios-app"
  if (/^android\//i.test(header)) return "android-app"
  const ua = (userAgent ?? "").trim()
  if (/^NEXUS\/\d+/.test(ua)) return "legacy-app"
  if (/^web\//i.test(header)) return "web"
  if (/^Mozilla\//.test(ua)) return "web"
  return null
}

/**
 * An iPhone / iPad / iPod browser checking in or out without the app — refused (owner, Sep 2026):
 * on a phone that has the app, the browser cannot report the location trail.
 *
 * Never refused: anything with X-Nexus-Client ios/…, the legacy apps (`NEXUS/<build> …`, no header —
 * their UA carries no device name anyway), Android and desktop browsers, and iPadOS Safari in its
 * default desktop mode, which sends a Macintosh User-Agent and cannot be told from a Mac.
 */
export function isIosBrowserWithoutApp(userAgent: string | null | undefined, clientHeader: string | null | undefined): boolean {
  if (/^\s*ios\//i.test(clientHeader ?? "")) return false
  const ua = (userAgent ?? "").trim()
  if (!ua || /^NEXUS\//.test(ua)) return false
  return /iPhone|iPad|iPod/.test(ua)
}

export const USE_IOS_APP_ERROR = {
  error: "Absen dari iPhone pakai app NEXUS ya — di browser iPhone lokasi kerjamu tidak bisa dicatat.",
  code: "USE_IOS_APP",
} as const

// ── input validation for the upload ────────────────────────────────────────────────────────────────

export type TrailPointInput = { lat: number; lng: number; accuracy: number | null; at: Date; event: TrailEvent | null }

/**
 * Parse the uploaded points. Unusable entries (bad coordinates or time) are dropped rather than
 * failing the batch — the app deletes what it sent on a 200, and one bad fix must not hold the queue.
 * Duplicate timestamps inside one batch keep the first.
 */
export function parseTrailPoints(raw: unknown): { points: TrailPointInput[]; dropped: number } {
  const list = Array.isArray(raw) ? raw : []
  const seen = new Set<number>()
  const points: TrailPointInput[] = []
  let dropped = 0
  for (const item of list) {
    const o = (item ?? {}) as Record<string, unknown>
    const lat = typeof o.lat === "number" ? o.lat : Number.NaN
    const lng = typeof o.lng === "number" ? o.lng : Number.NaN
    const at = typeof o.at === "string" ? new Date(o.at) : new Date(Number.NaN)
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180 || Number.isNaN(at.getTime())) {
      dropped++
      continue
    }
    if (seen.has(at.getTime())) {
      dropped++
      continue
    }
    seen.add(at.getTime())
    const accuracy = typeof o.accuracy === "number" && Number.isFinite(o.accuracy) && o.accuracy >= 0 ? o.accuracy : null
    const event = o.event === "exit" || o.event === "enter" || o.event === "point" || o.event === "presence" ? o.event : null
    points.push({ lat, lng, accuracy, at, event })
  }
  return { points, dropped }
}
