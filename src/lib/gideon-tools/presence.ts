import prisma from "@/lib/prisma"
import type { User } from "@/generated/prisma/client"
import { SYSTEM_USER_EMAILS } from "@/lib/system-users"
import {
  availabilityFromDb,
  checkManualStatus,
  clearManualStatus,
  getManualStatus,
  getPresence,
  parseWibTime,
  presenceEnabled,
  setManualStatus,
  visibleUserIds,
  type PresenceAvailability,
  type PresenceStatus,
} from "@/lib/presence"
import { wibDay } from "@/lib/calendar/core"
import { dayLabel, str, whenWib } from "./util"
import type { ExtraTool, Input } from "./types"

/**
 * Presence status through GIDEON (owner, 19 Oct 2026): "Berlin ke mana?" is answered from the same status everyone
 * sees on the avatars (lib/presence.ts), and "set status gw meeting klien 18:00–20:00" becomes a card.
 * Actor-scoped: only people who share a workspace with the asker exist here. The owner's rule is that everyone in the
 * workspace may see the status AND its reason (sick, the custom text); location is only "in / out of the office".
 */

const OFF = "Presence status is switched off right now · Status kehadiran sedang dimatikan."

/** People the actor may see, matched by (part of) their name. Exactly one, or an error the model can act on. */
async function findVisiblePerson(actor: User, name: string): Promise<{ id: string; name: string | null }> {
  if (/^(me|saya|aku|gw|gue|gua|i)$/i.test(name)) return { id: actor.id, name: actor.name }
  const visible = await visibleUserIds(actor.id)
  const people = await prisma.user.findMany({
    where: { id: { in: visible }, name: { contains: name, mode: "insensitive" }, deactivatedAt: null, email: { notIn: SYSTEM_USER_EMAILS } },
    select: { id: true, name: true },
    take: 8,
  })
  const exact = people.filter((p) => p.name?.trim().toLowerCase() === name.trim().toLowerCase())
  const pick = exact.length === 1 ? exact : people
  if (pick.length === 1) return pick[0]
  if (!pick.length) throw new Error(`Nobody in this person's workspace is named like "${name}".`)
  throw new Error(`Several people match "${name}": ${pick.map((p) => p.name).join(", ")}. Ask which one.`)
}

function view(name: string | null, s: PresenceStatus) {
  return {
    name,
    status: s.label.en,
    statusId: s.label.id,
    state: s.state,
    reason: s.reason,
    ...(s.text ? { customText: s.text } : {}),
    ...(s.availability ? { availability: s.availability } : {}),
    ...(s.state === "dnd" ? { doNotDisturb: true } : {}),
    ...(s.until ? { until: s.until.length === 10 ? dayLabel(s.until) : `${whenWib(s.until)} WIB` } : {}),
    ...(s.since && (s.state === "online" || s.state === "away") ? { since: `${whenWib(s.since)} WIB` } : {}),
    ...(s.manual && s.reason !== "custom" ? { scheduledStatus: `${s.manual.text} (${whenWib(s.manual.startsAt)}–${whenWib(s.manual.endsAt)} WIB)` } : {}),
  }
}

const NOTE = "Answer with the status as given (e.g. “Away · Out of the office”). Location is only in / out of the office: never guess where they are. Times are WIB. Do not disturb (doNotDisturb) = they asked not to be interrupted until the end time: say “Do not disturb” / “Jangan diganggu” and suggest a message they can read later rather than a call or a meeting now."

function rangeOf(input: Input): { startsAt: Date | null; endsAt: Date | null } {
  const day = str(input.date) ?? null
  const startsAt = parseWibTime(input.startsAt ?? input.from ?? input.start, day)
  const endsAt = parseWibTime(input.endsAt ?? input.until ?? input.to ?? input.end, day ?? (startsAt ? wibDay(startsAt) : null))
  return { startsAt, endsAt }
}
const textOf = (input: Input) => str(input.text) ?? str(input.status) ?? str(input.what)
const wantsClear = (input: Input) => input.clear === true || input.clear === "true"

/** N-1: the model's words for the availability → online | away | dnd (missing = away; unknown = refused by the core). */
function availabilityOf(input: Input): unknown {
  const v = str(input.availability)?.trim().toLowerCase()
  if (!v) return undefined
  if (/^(dnd|do[ _-]?not[ _-]?disturb|jangan[ _-]?diganggu|busy|sibuk|focus|fokus)$/.test(v)) return "dnd"
  if (/^(online|available|tersedia|ada)$/.test(v)) return "online"
  if (/^(away|pergi|keluar|lagi keluar)$/.test(v)) return "away"
  return v
}
const AVAIL_WORD: Record<PresenceAvailability, string> = { online: "Online", away: "Away", dnd: "Do not disturb" }

export const presenceTools: Record<string, ExtraTool> = {
  get_person_status: {
    read: async (actor, input) => {
      if (!(await presenceEnabled())) throw new Error(OFF)
      const who = str(input.person) ?? str(input.name) ?? str(input.who)
      const userId = str(input.userId)
      if (who || userId) {
        const p = userId && (await visibleUserIds(actor.id)).includes(userId)
          ? { id: userId, name: (await prisma.user.findUnique({ where: { id: userId }, select: { name: true } }))?.name ?? null }
          : await findVisiblePerson(actor, who ?? userId!)
        const s = (await getPresence([p.id])).get(p.id)
        if (!s) return { name: p.name, status: "Unknown", note: "No status for this person (not an active member)." }
        return { ...view(p.name, s), note: NOTE }
      }
      // No name: everyone, optionally only one state ("siapa yang sakit hari ini?").
      const state = str(input.state)?.toLowerCase()
      const ids = await visibleUserIds(actor.id)
      const all = await getPresence(ids)
      const names = new Map((await prisma.user.findMany({ where: { id: { in: [...all.keys()] } }, select: { id: true, name: true } })).map((u) => [u.id, u.name] as const))
      const rows = [...all.values()].filter((s) => !state || s.state === state || s.reason === state)
      return {
        total: rows.length,
        people: rows.slice(0, 80).map((s) => view(names.get(s.userId) ?? null, s)),
        note: NOTE,
      }
    },
    stepArg: (i) => str(i.person) ?? str(i.name) ?? null,
  },
  set_my_status: {
    describe: async (actor, input) => {
      if (!(await presenceEnabled())) throw new Error(OFF)
      if (wantsClear(input)) {
        const cur = await getManualStatus(actor.id)
        if (!cur) throw new Error("This person has no status set; nothing to clear.")
        return {
          summary: `Clear your status “${cur.text}”`,
          diff: [{ field: "Status", to: cur.text }, { field: "Until", to: `${whenWib(cur.endsAt)} WIB`, toDay: wibDay(cur.endsAt) }],
          store: { clear: true, manualId: cur.id },
          note: "NOT cleared yet: it waits on the card below for the person to confirm.",
        }
      }
      const r = rangeOf(input)
      const ok = checkManualStatus({ text: textOf(input), ...r, availability: availabilityOf(input) })
      const from = whenWib(ok.startsAt) ?? ok.startsAt.toISOString()
      const to = whenWib(ok.endsAt) ?? ok.endsAt.toISOString()
      const word = AVAIL_WORD[ok.availability]
      return {
        summary: `Set your status “${word} · ${ok.text}” ${from}–${to} WIB`.slice(0, 300),
        diff: [
          { field: "Status", to: `${word} · ${ok.text}` },
          { field: "From", to: `${from} WIB`, toDay: wibDay(ok.startsAt) },
          { field: "Until", to: `${to} WIB`, toDay: wibDay(ok.endsAt) },
        ],
        store: { text: ok.text, startsAt: ok.startsAt.toISOString(), endsAt: ok.endsAt.toISOString(), availability: ok.availability },
        note: "NOT set yet: it waits on the card below for the person to confirm. Say the times you resolved (day, HH:MM WIB). Everyone in the workspace will see it; nobody is notified.",
      }
    },
    apply: async (actor, input) => {
      if (!(await presenceEnabled())) throw new Error(OFF)
      if (wantsClear(input)) {
        const n = await clearManualStatus(actor.id, str(input.manualId) ?? null)
        return { cleared: n > 0, note: n > 0 ? "Status cleared." : "It was already gone (ended, or changed on another device)." }
      }
      const r = rangeOf(input)
      const row = await setManualStatus(actor.id, { text: textOf(input), ...r, availability: availabilityOf(input), source: "gideon" })
      return { set: true, status: `${AVAIL_WORD[availabilityFromDb(row.availability)]} · ${row.text}`, from: `${whenWib(row.startsAt)} WIB`, until: `${whenWib(row.endsAt)} WIB`, note: "Shown to everyone in the workspace until the end time, then it clears by itself." }
    },
    stepArg: (i) => (wantsClear(i) ? "clear" : textOf(i) ?? null),
  },
}
