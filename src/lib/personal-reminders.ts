import { randomUUID } from "node:crypto"
import prisma from "@/lib/prisma"
import { bi } from "@/lib/notification-text"
import { createInAppNotification, notifyBlockReminder } from "@/lib/notification-service"
import { emitRemindersChanged } from "@/lib/socket-emitter"

/**
 * Personal reminders (owner, 18 Oct 2026: "remind me tomorrow 9 to follow up the vendor"). One row per reminder in
 * the BlockReminder table the block editor's "Remind me" chips already use (no new table): sourceKind "personal",
 * sourceId = the person, key = a random id. lib/block-bodies.ts only ever syncs its own kinds ("doc" / "task"),
 * so it never touches these.
 *
 * Fired by sendDueReminders below — every minute on the singleton leader (lib/automation-ticker.ts), and by
 * POST /api/cron/block-reminders — as an in-app notification + push in the person's language. A reminder is
 * claimed (firedAt set with a conditional update) before it is sent, and the notification carries a dedupeKey,
 * so two runs never send it twice. Times are WIB.
 *
 * Who can see / cancel one: only its owner (every query here is scoped by userId).
 */

export const PERSONAL = "personal"
export { REMINDER_TEXT_MAX, REMINDER_OPEN_MAX, ReminderRefusal, parseRemindAt, checkReminder } from "./personal-reminders-core"
import { REMINDER_OPEN_MAX, ReminderRefusal, checkReminder } from "./personal-reminders-core"
/** A reminder more than a day late (the clock was off for a while) is closed without a notification. */
const LATE_LIMIT_MS = 24 * 60 * 60 * 1000

export type ReminderView = { id: string; text: string; remindAt: string; firedAt: string | null; createdAt: string }

function view(r: { id: string; text: string; remindAt: Date; firedAt: Date | null; createdAt: Date }): ReminderView {
  return { id: r.id, text: r.text, remindAt: r.remindAt.toISOString(), firedAt: r.firedAt?.toISOString() ?? null, createdAt: r.createdAt.toISOString() }
}

export async function createPersonalReminder(userId: string, text: unknown, remindAt: Date | null): Promise<ReminderView> {
  const ok = checkReminder(text, remindAt)
  const row = await prisma.$transaction(async (tx) => {
    // Per-person lock: the open-count cap holds under concurrent creates.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`reminder|${userId}`}))`
    const open = await tx.blockReminder.count({ where: { sourceKind: PERSONAL, userId, firedAt: null } })
    if (open >= REMINDER_OPEN_MAX) throw new ReminderRefusal(`You already have ${open} reminders waiting. Cancel some first.`, "TOO_MANY")
    return tx.blockReminder.create({ data: { sourceKind: PERSONAL, sourceId: userId, userId, key: randomUUID(), remindAt: ok.remindAt, text: ok.text } })
  })
  emitRemindersChanged(userId, row.id)
  return view(row)
}

export async function listPersonalReminders(userId: string, opts: { includeDone?: boolean; limit?: number } = {}): Promise<{ upcoming: ReminderView[]; done: ReminderView[] }> {
  const take = Math.max(1, Math.min(200, opts.limit ?? 100))
  const [upcoming, done] = await Promise.all([
    prisma.blockReminder.findMany({ where: { sourceKind: PERSONAL, userId, firedAt: null }, orderBy: { remindAt: "asc" }, take }),
    opts.includeDone ? prisma.blockReminder.findMany({ where: { sourceKind: PERSONAL, userId, firedAt: { not: null } }, orderBy: { remindAt: "desc" }, take: 30 }) : Promise.resolve([]),
  ])
  return { upcoming: upcoming.map(view), done: done.map(view) }
}

export async function getPersonalReminder(userId: string, id: string): Promise<ReminderView | null> {
  const r = await prisma.blockReminder.findFirst({ where: { id, userId, sourceKind: PERSONAL } })
  return r ? view(r) : null
}

/** Cancel one that has not fired yet. Conditional, so a reminder that fires meanwhile is reported, not lost. */
export async function cancelPersonalReminder(userId: string, id: string): Promise<ReminderView> {
  const r = await prisma.blockReminder.findFirst({ where: { id, userId, sourceKind: PERSONAL } })
  if (!r) throw new ReminderRefusal("That reminder does not exist (or is not yours).", "NOT_FOUND")
  const gone = await prisma.blockReminder.deleteMany({ where: { id, userId, sourceKind: PERSONAL, firedAt: null } })
  if (gone.count === 0) throw new ReminderRefusal("That reminder has already gone off.", "NOT_FOUND")
  emitRemindersChanged(userId, id)
  return view(r)
}

async function notifyPersonalReminder(r: { id: string; userId: string; text: string }) {
  await createInAppNotification({
    userId: r.userId,
    type: "reminder",
    ...bi(["Reminder", r.text.slice(0, 200)], ["Pengingat", r.text.slice(0, 200)]),
    link: "/reminders",
    push: true,
    dedupeKey: `reminder|${r.id}`,
  })
}

/**
 * Send every reminder that is due: personal ones and the block editor's "Remind me" chips. Each is claimed first
 * (firedAt with a conditional update), so overlapping runs — the leader's minute tick and the cron route — never
 * send one twice.
 */
export async function sendDueReminders(now: Date = new Date()): Promise<{ due: number; sent: number; skipped: number }> {
  const due = await prisma.blockReminder.findMany({ where: { firedAt: null, remindAt: { lte: now } }, orderBy: { remindAt: "asc" }, take: 200 })
  let sent = 0
  let skipped = 0
  for (const r of due) {
    const claimed = await prisma.blockReminder.updateMany({ where: { id: r.id, firedAt: null }, data: { firedAt: now } })
    if (claimed.count === 0) continue
    if (now.getTime() - r.remindAt.getTime() > LATE_LIMIT_MS) { skipped++; continue }
    try {
      if (r.sourceKind === PERSONAL) {
        await notifyPersonalReminder(r)
        emitRemindersChanged(r.userId, r.id)
      } else if (r.sourceKind === "doc") {
        const doc = await prisma.doc.findUnique({ where: { id: r.sourceId }, select: { title: true, projectId: true } })
        if (!doc) { skipped++; continue }
        await notifyBlockReminder({ userId: r.userId, title: doc.title, text: r.text, link: `/docs/${r.sourceId}`, projectId: doc.projectId, dedupeKey: `block-reminder|${r.id}` })
      } else {
        const task = await prisma.task.findUnique({ where: { id: r.sourceId }, select: { title: true, taskList: { select: { projectId: true } } } })
        if (!task) { skipped++; continue }
        const projectId = task.taskList.projectId
        await notifyBlockReminder({ userId: r.userId, title: task.title, text: r.text, link: `/projects/${projectId}/tasks/${r.sourceId}`, taskId: r.sourceId, projectId, dedupeKey: `block-reminder|${r.id}` })
      }
      sent++
    } catch {
      // Release the claim so the next tick tries again (until LATE_LIMIT_MS): without this a failed send left the
      // reminder marked as gone off and the person was never told. The notification dedupeKey keeps a retry from
      // sending it twice.
      await prisma.blockReminder.updateMany({ where: { id: r.id, firedAt: now }, data: { firedAt: null } }).catch(() => {})
      skipped++
    }
  }
  return { due: due.length, sent, skipped }
}
