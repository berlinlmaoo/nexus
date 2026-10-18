import prisma from "@/lib/prisma"
import type { User } from "@/generated/prisma/client"
import { PERSONAL, cancelPersonalReminder, checkReminder, createPersonalReminder, listPersonalReminders, parseRemindAt } from "@/lib/personal-reminders"
import { str, whenWib, PUBLIC_BASE } from "./util"
import { wibDay } from "@/lib/calendar/core"
import type { ExtraTool, Input } from "./types"

/**
 * Personal reminders through GIDEON (18 Oct 2026): "remind me tomorrow 9 to follow up the vendor". The Reminders
 * page's own functions (lib/personal-reminders.ts), as the person; approval modes like a task for oneself (direct in
 * "don't ask", a card otherwise). Only the person's own reminders exist for GIDEON.
 */

function remindAtOf(input: Input): Date | null {
  return parseRemindAt(input.at ?? input.remindAt ?? input.when, input.date, input.time)
}

const textOf = (input: Input) => str(input.text) ?? str(input.about) ?? str(input.what) ?? str(input.title)

async function findOne(actor: User, input: Input) {
  const id = str(input.reminderId) ?? str(input.id)
  if (id) {
    const r = await prisma.blockReminder.findFirst({ where: { id, userId: actor.id, sourceKind: PERSONAL, firedAt: null } })
    if (!r) throw new Error("No waiting reminder of this person has that id (it went off, was cancelled, or is not theirs).")
    return r
  }
  const q = textOf(input) ?? str(input.query)
  if (!q) throw new Error("Say which reminder: reminderId (from nexus_list_reminders) or part of its text.")
  const rows = await prisma.blockReminder.findMany({ where: { userId: actor.id, sourceKind: PERSONAL, firedAt: null, text: { contains: q, mode: "insensitive" } }, orderBy: { remindAt: "asc" }, take: 6 })
  if (rows.length === 1) return rows[0]
  if (!rows.length) throw new Error(`No waiting reminder mentions "${q}".`)
  throw new Error(`Several reminders match "${q}": ${rows.map((r) => `${whenWib(r.remindAt)} ${r.text.slice(0, 40)}`).join("; ")}. Ask which one.`)
}

export const reminderTools: Record<string, ExtraTool> = {
  list_reminders: {
    read: async (actor, input) => {
      const { upcoming, done } = await listPersonalReminders(actor.id, { includeDone: input.includeDone === true || input.done === true })
      return {
        upcoming: upcoming.map((r) => ({ reminderId: r.id, at: whenWib(r.remindAt), text: r.text })),
        ...(done.length ? { wentOff: done.slice(0, 10).map((r) => ({ at: whenWib(r.remindAt), text: r.text })) } : {}),
        page: `${PUBLIC_BASE}/reminders`,
        note: upcoming.length ? "Times are WIB." : "No reminders waiting.",
      }
    },
  },
  create_reminder: {
    describe: async (_actor, input) => {
      const ok = checkReminder(textOf(input), remindAtOf(input))
      const at = whenWib(ok.remindAt) ?? ok.remindAt.toISOString()
      return {
        summary: `Remind you ${at} WIB: ${ok.text}`.slice(0, 300),
        diff: [{ field: "When", to: at, toDay: wibDay(ok.remindAt) }, { field: "Reminder", to: ok.text }],
        store: { text: ok.text, remindAt: ok.remindAt.toISOString() },
        note: "NOT set yet: it waits on the card below for the person to confirm. Say the time you resolved (day, date, HH:MM WIB).",
      }
    },
    apply: async (actor, input) => {
      const r = await createPersonalReminder(actor.id, textOf(input), remindAtOf(input))
      return { created: true, reminderId: r.id, at: whenWib(r.remindAt), text: r.text, link: "/reminders", note: "It goes off as a NEXUS notification and a push at that time (WIB). Listed and cancellable on the Reminders page.", page: `${PUBLIC_BASE}/reminders` }
    },
    stepArg: (i) => textOf(i) ?? null,
  },
  cancel_reminder: {
    describe: async (actor, input) => {
      const r = await findOne(actor, input)
      return {
        summary: `Cancel the reminder “${r.text.slice(0, 80)}” (${whenWib(r.remindAt)} WIB)`,
        diff: [{ field: "When", to: whenWib(r.remindAt), toDay: wibDay(r.remindAt) }, { field: "Reminder", to: r.text }],
        store: { reminderId: r.id },
      }
    },
    apply: async (actor, input) => {
      const r = await findOne(actor, input)
      const gone = await cancelPersonalReminder(actor.id, r.id)
      return { cancelled: true, text: gone.text, at: whenWib(gone.remindAt), link: "/reminders" }
    },
    stepArg: (i) => textOf(i) ?? str(i.query) ?? null,
  },
}
