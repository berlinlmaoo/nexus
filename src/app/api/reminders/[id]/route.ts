export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { ReminderRefusal, cancelPersonalReminder } from "@/lib/personal-reminders"

/** DELETE /api/reminders/:id — cancel one of your own reminders that has not gone off yet. 404 { code: NOT_FOUND }. */
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { id } = await params
  try {
    return NextResponse.json({ reminder: await cancelPersonalReminder(session.user.id, id) })
  } catch (e) {
    if (e instanceof ReminderRefusal) return NextResponse.json({ error: e.message, code: e.code }, { status: 404 })
    throw e
  }
}
