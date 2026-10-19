import { getAppSetting, setAppSetting } from "@/lib/app-setting"
import { eventBus, BUS_EVENTS } from "@/lib/event-bus"
import { createLogger } from "@/lib/logger"

/**
 * Which GIDEON tiers can answer right now (owner, 18 Oct 2026). Only GIDEON Model 0 can be away: it runs on the
 * office GPU, which the meeting transcriber borrows — Model 0 is unloaded for the transcript and is unavailable
 * until it has loaded again (a cold load takes over a minute). The transcription service on that machine reports
 * the state (GET /health → model0), the meeting ticker (lib/meeting-notes.ts, leader only) copies it here, and every
 * change goes to every open client (`gideon-tiers`, to all sockets: it is the same public fact for everyone).
 *
 * Stored in AppSetting "gideon-tier-status" so both blue-green slots, clients that open later (GET /api/gideon/tiers,
 * /api/app/config `gideonTiers`) and the chat route agree. Unknown / never reported = available: a transcriber that
 * cannot be reached must not take Model 0 away.
 */
const log = createLogger("gideon-tier-status")
const KEY = "gideon-tier-status"

export type TierAvailability = {
  available: boolean
  /** transcribing = unloaded for a meeting transcript; loading = coming back; down = the local engine does not answer. */
  reason: "transcribing" | "loading" | "down" | null
  since: string | null
}
export type TierStatus = Record<"astra" | "luna" | "terra" | "experimental", TierAvailability>

const OK: TierAvailability = { available: true, reason: null, since: null }

export function defaultTierStatus(): TierStatus {
  return { astra: { ...OK }, luna: { ...OK }, terra: { ...OK }, experimental: { ...OK } }
}

type Stored = { experimental?: TierAvailability; updatedAt?: string }

/** A stored state older than this is not trusted (the ticker stopped reporting): Model 0 counts as available. */
const STALE_MS = 3 * 60 * 1000

export async function getTierStatus(): Promise<TierStatus> {
  const out = defaultTierStatus()
  const stored = await getAppSetting<Stored>(KEY).catch(() => null)
  const exp = stored?.experimental
  const fresh = stored?.updatedAt ? Date.now() - Date.parse(stored.updatedAt) < STALE_MS : false
  if (exp && fresh && exp.available === false) out.experimental = { available: false, reason: exp.reason ?? null, since: exp.since ?? null }
  return out
}

/** The texts a client shows on a tier that is away (EN + ID). */
export function tierUnavailableText(reason: TierAvailability["reason"]) {
  const why = {
    transcribing: { en: "The office GPU is transcribing a meeting.", id: "GPU kantor sedang mentranskrip meeting." },
    loading: { en: "It's starting up again.", id: "Sedang dinyalakan lagi." },
    down: { en: "The local model isn't responding.", id: "Model lokal tidak merespons." },
  }[reason ?? "down"] ?? { en: "", id: "" }
  return {
    label: { en: "Unavailable right now", id: "Sedang tidak tersedia" },
    reason: why,
    send: {
      en: `GIDEON Model 0 is unavailable right now. ${why.en} Switch to GIDEON Phaëthon or try again in a few minutes.`,
      id: `GIDEON Model 0 sedang tidak tersedia. ${why.id} Ganti ke GIDEON Phaëthon atau coba lagi beberapa menit lagi.`,
    },
  }
}

/**
 * Record what the transcriber said about Model 0. Emits `gideon-tiers` only when availability or reason changed;
 * also refreshes `updatedAt` so a live state never goes stale. Never throws.
 */
export async function reportModel0(next: { available: boolean; reason: TierAvailability["reason"] }): Promise<void> {
  try {
    const stored = await getAppSetting<Stored>(KEY).catch(() => null)
    const prev = stored?.experimental ?? OK
    const changed = prev.available !== next.available || (prev.reason ?? null) !== (next.reason ?? null)
    // Available and unchanged: nothing to write (an old row reads as available anyway).
    if (!changed && next.available) return
    const now = new Date().toISOString()
    const value: TierAvailability = next.available ? { ...OK } : { available: false, reason: next.reason, since: changed ? now : prev.since ?? now }
    await setAppSetting<Stored>(KEY, { experimental: value, updatedAt: now })
    if (changed) {
      log.info("GIDEON Model 0 availability changed", { available: value.available, reason: value.reason })
      eventBus.emit(BUS_EVENTS.GIDEON_TIERS, { tiers: await getTierStatus() })
    }
  } catch (error) {
    log.warn("could not record Model 0 availability", { error: String(error) })
  }
}
