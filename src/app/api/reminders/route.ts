export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { ReminderRefusal, createPersonalReminder, listPersonalReminders, parseRemindAt } from "@/lib/personal-reminders"

/**
 * Personal reminders (18 Oct 2026), the person's own only.
 *   GET  /api/reminders[?done=1]           { upcoming: Reminder[], done: Reminder[] }
 *   POST /api/reminders { text, remindAt }  remindAt = ISO instant, or "YYYY-MM-DDTHH:MM" read as WIB → 201 { reminder }
 * Reminder = { id, text, remindAt, firedAt, createdAt } (ISO strings). Fired as a notification + push (type
 * "reminder", link "/reminders") by the leader's minute tick. Refusals: 400 { error, code } (TEXT | TIME_PAST |
 * TIME_FAR | TIME_BAD | TOO_MANY).
 */
export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const done = req.nextUrl.searchParams.get("done") === "1"
  return NextResponse.json(await listPersonalReminders(session.user.id, { includeDone: done }))
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const body = (await req.json().catch(() => ({}))) as { text?: unknown; remindAt?: unknown; date?: unknown; time?: unknown }
  try {
    const reminder = await createPersonalReminder(session.user.id, body.text, parseRemindAt(body.remindAt, body.date, body.time))
    return NextResponse.json({ reminder }, { status: 201 })
  } catch (e) {
    if (e instanceof ReminderRefusal) return NextResponse.json({ error: e.message, code: e.code }, { status: 400 })
    throw e
  }
}
