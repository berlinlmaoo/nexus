/**
 * Presence status (owner, 19 Oct 2026): the one rule that turns what NEXUS already knows about a person today into
 * a status everyone in the workspace sees. Pure — no database — so the unit test loads it directly
 * (node src/lib/presence-core.test.mjs) and lib/presence.ts only gathers the facts.
 *
 * Order, first match wins:
 *   1. a manual status running now (<availability> · <text>) — set by the person (web, app, GIDEON card);
 *      availability Online / Away / Do not disturb (N-1, owner 19 Oct 2026; Away when the client sends none)
 *   2. an open attendance record (checked in, not out)        — Online · in the office / Away · out of the office
 *   3. an approved request covering today                     — Sick / Leave / Day off / Public holiday / Away · on permit
 *   4. checked out today                                      — Offline · checked out
 *   5. not expected today (BoD/OAA, no office, rest day, holiday, not a workday) — Offline
 *   6. inside today's shift window without a check-in         — Not checked in yet
 *   7. otherwise                                              — Offline
 *
 * It only READS attendance. Location stays coarse on purpose: in or out of an office, never where.
 */

export type PresenceState = "online" | "away" | "dnd" | "sick" | "leave" | "not_checked_in" | "offline"
export type PresenceTone = "green" | "yellow" | "red" | "grey" | "black"
export type PresenceReason =
  | "in_office"
  | "out_of_office"
  | "custom"
  | "permit"
  | "sick"
  | "leave"
  | "day_off"
  | "public_holiday"
  | "not_checked_in"
  | "checked_out"
  | "off_hours"
  | "not_a_workday"

/**
 * The availability a manual status shows (N-1, owner 19 Oct 2026): Online · <text>, Away · <text> or
 * Do not disturb · <text>. Stored upper case ("ONLINE" | "AWAY" | "DND", column default AWAY), sent lower case like
 * every other presence value. A client that sends none (iOS/Android 0.1.6 and older) gets Away, exactly as before.
 */
export type PresenceAvailability = "online" | "away" | "dnd"
export const AVAILABILITIES: readonly PresenceAvailability[] = ["online", "away", "dnd"]
export const DEFAULT_AVAILABILITY: PresenceAvailability = "away"

export type PresenceManual = { id: string; text: string; startsAt: string; endsAt: string; availability: PresenceAvailability }

export type PresenceStatus = {
  userId: string
  state: PresenceState
  tone: PresenceTone
  reason: PresenceReason
  /** The manual status text (reason custom); null otherwise. */
  text: string | null
  /** The running manual status's availability (reason custom; equals state); null when no manual status is running. */
  availability: PresenceAvailability | null
  /** Both languages, ready to show: "Away · Out of the office" / "Away · Di luar kantor". */
  label: { en: string; id: string }
  /** When this status is known to end: a manual status's end, the last day of a request ("YYYY-MM-DD"). */
  until: string | null
  /** When it began, where known (check-in, the start of the outside episode, a manual start). */
  since: string | null
  /**
   * The person's manual status, running or scheduled for later (so their own screen can show and clear it).
   * Everyone sees it — the owner's rule is that status and reason are public inside the workspace.
   */
  manual: PresenceManual | null
}

export const TONE_OF: Record<PresenceState, PresenceTone> = {
  online: "green",
  away: "yellow",
  dnd: "red",
  sick: "red",
  leave: "grey",
  not_checked_in: "grey",
  offline: "black",
}

const STATE_WORD: Record<PresenceState, { en: string; id: string }> = {
  online: { en: "Online", id: "Online" },
  away: { en: "Away", id: "Away" },
  dnd: { en: "Do not disturb", id: "Jangan diganggu" },
  sick: { en: "Sick leave", id: "Sakit" },
  leave: { en: "Leave", id: "Cuti" },
  not_checked_in: { en: "Not checked in yet", id: "Belum check-in" },
  offline: { en: "Offline", id: "Offline" },
}

const REASON_WORD: Partial<Record<PresenceReason, { en: string; id: string }>> = {
  in_office: { en: "In the office", id: "Di kantor" },
  out_of_office: { en: "Out of the office", id: "Di luar kantor" },
  permit: { en: "On permit", id: "Izin" },
  checked_out: { en: "Checked out", id: "Sudah check-out" },
  not_a_workday: { en: "Not a workday", id: "Bukan hari kerja" },
}

export function presenceLabel(state: PresenceState, reason: PresenceReason, text: string | null): { en: string; id: string } {
  const s = STATE_WORD[state]
  if (state === "leave" && reason === "day_off") return { en: "Day off", id: "Day off" }
  if (state === "leave" && reason === "public_holiday") return { en: "Public holiday", id: "Libur tanggal merah" }
  if (reason === "custom" && text) return { en: `${s.en} · ${text}`, id: `${s.id} · ${text}` }
  const r = REASON_WORD[reason]
  return r ? { en: `${s.en} · ${r.en}`, id: `${s.id} · ${r.id}` } : { en: s.en, id: s.id }
}

export const MANUAL_TEXT_MAX = 80
/** A manual status lasts at most this long, and may start at most this far ahead. */
export const MANUAL_MAX_MS = 14 * 24 * 3600e3
export const MANUAL_AHEAD_MS = 30 * 24 * 3600e3

export class PresenceRefusal extends Error {
  code: string
  constructor(message: string, code: string) {
    super(message)
    this.code = code
  }
}

/**
 * The availability a client sent: missing / null / "" → Away (released apps send nothing); online | away | dnd in
 * any case (so "DND" and "Online" work too); anything else is refused (code AVAILABILITY), never silently Away.
 */
export function parseAvailability(v: unknown): PresenceAvailability {
  if (v == null || v === "") return DEFAULT_AVAILABILITY
  const s = typeof v === "string" ? v.trim().toLowerCase() : ""
  if ((AVAILABILITIES as readonly string[]).includes(s)) return s as PresenceAvailability
  throw new PresenceRefusal("Availability is online, away or dnd.", "AVAILABILITY")
}

/** "ONLINE" | "AWAY" | "DND" (the column) → the API value; anything unknown reads as Away. */
export function availabilityFromDb(v: string | null | undefined): PresenceAvailability {
  const s = (v ?? "").toLowerCase()
  return (AVAILABILITIES as readonly string[]).includes(s) ? (s as PresenceAvailability) : DEFAULT_AVAILABILITY
}
export const availabilityToDb = (a: PresenceAvailability): "ONLINE" | "AWAY" | "DND" => (a === "online" ? "ONLINE" : a === "dnd" ? "DND" : "AWAY")

/** Whether the client explicitly chose an availability (not missing / null / ""). */
export function availabilitySent(v: unknown): boolean {
  return !(v == null || v === "")
}

/** "Do not disturb · Meeting", or just "Do not disturb" for an availability-only status (N-1b). English, for GIDEON. */
export function manualWords(availability: PresenceAvailability, text: string | null | undefined): string {
  const w = STATE_WORD[availability].en
  return text ? `${w} · ${text}` : w
}

/** The manual status exactly as setting it would store it, or a refusal the person can act on. */
export function checkManualStatus(input: { text: unknown; startsAt: Date | null; endsAt: Date | null; availability?: unknown }, now: Date = new Date()): { text: string; startsAt: Date; endsAt: Date; availability: PresenceAvailability } {
  const availability = parseAvailability(input.availability)
  const text = typeof input.text === "string" ? input.text.replace(/\s+/g, " ").trim() : ""
  // N-1b (owner 19 Oct 2026): an availability-only status ("Do not disturb" with no text) is fine, but only when the
  // client sent the availability itself. Released apps (0.1.6 and older) never send it, so for them an empty text
  // stays refused exactly as before.
  if (!text && !availabilitySent(input.availability)) throw new PresenceRefusal("Write the status, e.g. “Meeting with a client”.", "TEXT")
  if ([...text].length > MANUAL_TEXT_MAX) throw new PresenceRefusal(`A status is at most ${MANUAL_TEXT_MAX} characters.`, "TEXT")
  const startsAt = input.startsAt && !Number.isNaN(input.startsAt.getTime()) ? input.startsAt : now
  const endsAt = input.endsAt
  if (!endsAt || Number.isNaN(endsAt.getTime())) throw new PresenceRefusal("Say until when (WIB).", "END")
  if (endsAt.getTime() <= now.getTime()) throw new PresenceRefusal("That end time has already passed.", "END_PAST")
  if (endsAt.getTime() <= startsAt.getTime()) throw new PresenceRefusal("The end must be after the start.", "END_BEFORE_START")
  if (startsAt.getTime() - now.getTime() > MANUAL_AHEAD_MS) throw new PresenceRefusal("A status can start at most 30 days ahead.", "START_FAR")
  if (endsAt.getTime() - Math.max(startsAt.getTime(), now.getTime()) > MANUAL_MAX_MS) throw new PresenceRefusal("A status lasts at most 14 days. For leave, file a request on the Attendance page.", "TOO_LONG")
  // A start in the past is "from now" (the card was confirmed a bit later than it was written).
  return { text, startsAt: startsAt.getTime() < now.getTime() ? now : startsAt, endsAt, availability }
}

/**
 * "2026-10-20 18:00" / "2026-10-20T18:00" (WIB), a full ISO instant with its zone, or "18:00" (today in WIB,
 * or `day` when given). Anything else → null: Date() reads almost anything ("besok jam 6" → 2001).
 */
export function parseWibTime(v: unknown, day?: string | null, now: Date = new Date()): Date | null {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v
  const s = typeof v === "string" ? v.trim() : ""
  if (!s) return null
  const local = (d: string, hh: number, mm: number) => (hh > 23 || mm > 59 ? null : new Date(`${d}T${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00+07:00`))
  const full = /^(\d{4}-\d{2}-\d{2})[T ](\d{1,2})[:.](\d{2})(?::\d{2}(?:\.\d+)?)?$/.exec(s)
  if (full) return local(full[1], Number(full[2]), Number(full[3]))
  const hm = /^(\d{1,2})[:.](\d{2})$/.exec(s)
  if (hm) {
    const d = day && /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : new Date(now.getTime() + 7 * 3600e3).toISOString().slice(0, 10)
    return local(d, Number(hm[1]), Number(hm[2]))
  }
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/.test(s)) return null
  const parsed = new Date(s)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

/** Everything the rule needs about one person, gathered by lib/presence.ts. Instants as Date. */
export type PresenceFacts = {
  userId: string
  now: Date
  /** availability: absent = Away (a row written before the column existed reads as AWAY anyway). */
  manual: { id: string; text: string; startsAt: Date; endsAt: Date; availability?: PresenceAvailability } | null
  /** The open record (checked in, not out) of today or yesterday (a night shift), if any. */
  open: {
    checkInAt: Date
    /** Start of the current outside-the-office episode (live location), null = inside / not tracked. */
    outsideSince: Date | null
    /** The check-in itself was away from the office (only a location-free member can do that). */
    checkInAway: boolean
  } | null
  /** Today's record was checked out (and nothing is open). */
  checkedOutAt: Date | null
  /** An approved request covering today (not the cron's own auto deduction). */
  request: { type: "LEAVE" | "SICK" | "PERMIT" | "DAY_OFF" | "RED_DATE"; endDay: string } | null
  /** Attendance does not expect this person today at all: BoD / One Above All, no office, rest day, holiday, not a workday. */
  notExpected: "exempt" | "not_a_workday" | null
  /** Today's shift window (and yesterday's, for a night shift still running), as instants. */
  windows: Array<{ start: Date; end: Date }>
}

export function decidePresence(f: PresenceFacts): PresenceStatus {
  const t = f.now.getTime()
  const manual = f.manual && f.manual.endsAt.getTime() > t ? f.manual : null
  const manualView: PresenceManual | null = manual
    ? { id: manual.id, text: manual.text, startsAt: manual.startsAt.toISOString(), endsAt: manual.endsAt.toISOString(), availability: manual.availability ?? DEFAULT_AVAILABILITY }
    : null
  const out = (state: PresenceState, reason: PresenceReason, extra: { text?: string | null; until?: string | null; since?: Date | null; availability?: PresenceAvailability } = {}): PresenceStatus => ({
    userId: f.userId,
    state,
    tone: TONE_OF[state],
    reason,
    text: extra.text ?? null,
    availability: extra.availability ?? null,
    label: presenceLabel(state, reason, extra.text ?? null),
    until: extra.until ?? null,
    since: extra.since ? extra.since.toISOString() : null,
    manual: manualView,
  })

  if (manual && manual.startsAt.getTime() <= t) {
    const availability = manual.availability ?? DEFAULT_AVAILABILITY
    return out(availability, "custom", { text: manual.text || null, until: manual.endsAt.toISOString(), since: manual.startsAt, availability })
  }
  if (f.open) {
    if (f.open.outsideSince) return out("away", "out_of_office", { since: f.open.outsideSince })
    if (f.open.checkInAway) return out("away", "out_of_office", { since: f.open.checkInAt })
    return out("online", "in_office", { since: f.open.checkInAt })
  }
  if (f.request) {
    const until = f.request.endDay
    switch (f.request.type) {
      case "SICK": return out("sick", "sick", { until })
      case "LEAVE": return out("leave", "leave", { until })
      case "DAY_OFF": return out("leave", "day_off", { until })
      case "RED_DATE": return out("leave", "public_holiday", { until })
      case "PERMIT": return out("away", "permit", { until })
    }
  }
  if (f.checkedOutAt) return out("offline", "checked_out", { since: f.checkedOutAt })
  if (f.notExpected === "not_a_workday") return out("offline", "not_a_workday")
  if (f.notExpected === "exempt") return out("offline", "off_hours")
  if (f.windows.some((w) => w.start.getTime() <= t && t < w.end.getTime())) return out("not_checked_in", "not_checked_in")
  return out("offline", "off_hours")
}

/** Whether two statuses would look different to anyone (the realtime event is sent only then). */
export function samePresence(a: PresenceStatus | null | undefined, b: PresenceStatus | null | undefined): boolean {
  if (!a || !b) return a === b
  return a.state === b.state && a.reason === b.reason && a.text === b.text && a.until === b.until && (a.availability ?? null) === (b.availability ?? null)
    && (a.manual?.availability ?? null) === (b.manual?.availability ?? null)
    && (a.manual?.id ?? null) === (b.manual?.id ?? null) && (a.manual?.endsAt ?? null) === (b.manual?.endsAt ?? null)
    && (a.manual?.startsAt ?? null) === (b.manual?.startsAt ?? null) && (a.manual?.text ?? null) === (b.manual?.text ?? null)
}

/**
 * The next instant at which this person's status could change by the clock alone (a manual start/end, a shift
 * window edge). A cached status is not served past it.
 */
export function nextClockEdge(f: PresenceFacts): number | null {
  const t = f.now.getTime()
  const edges: number[] = []
  if (f.manual) edges.push(f.manual.startsAt.getTime(), f.manual.endsAt.getTime())
  for (const w of f.windows) edges.push(w.start.getTime(), w.end.getTime())
  const future = edges.filter((e) => e > t)
  return future.length ? Math.min(...future) : null
}
