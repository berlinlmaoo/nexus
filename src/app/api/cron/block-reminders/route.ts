export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { isCronRequest } from "@/lib/cron-auth"
import { notifyBlockReminder } from "@/lib/notification-service"

// "Remind me" chips in docs and task bodies (block editor, 12 Oct 2026). A save keeps BlockReminder in
// step with the chips (lib/block-bodies.ts syncReminders); this sends the due ones, each once.
// Meant for the host cron every 5 minutes (POST with the cron secret), like the other cron routes.
// Reminders more than a day late (cron off for a while) are marked fired without a notification.

const LATE_LIMIT_MS = 24 * 60 * 60 * 1000

export async function POST(req: NextRequest) {
  if (!isCronRequest(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const now = new Date()
  const due = await prisma.blockReminder.findMany({
    where: { firedAt: null, remindAt: { lte: now } },
    orderBy: { remindAt: "asc" },
    take: 200,
  })
  let sent = 0
  let skipped = 0
  for (const r of due) {
    // Claim it first: two overlapping runs never send the same reminder twice.
    const claimed = await prisma.blockReminder.updateMany({ where: { id: r.id, firedAt: null }, data: { firedAt: now } })
    if (claimed.count === 0) continue
    if (now.getTime() - r.remindAt.getTime() > LATE_LIMIT_MS) { skipped++; continue }
    if (r.sourceKind === "doc") {
      const doc = await prisma.doc.findUnique({ where: { id: r.sourceId }, select: { title: true, projectId: true } })
      if (!doc) { skipped++; continue }
      await notifyBlockReminder({ userId: r.userId, title: doc.title, text: r.text, link: `/docs/${r.sourceId}`, projectId: doc.projectId })
    } else {
      const task = await prisma.task.findUnique({ where: { id: r.sourceId }, select: { title: true, taskList: { select: { projectId: true } } } })
      if (!task) { skipped++; continue }
      const projectId = task.taskList.projectId
      await notifyBlockReminder({ userId: r.userId, title: task.title, text: r.text, link: `/projects/${projectId}/tasks/${r.sourceId}`, taskId: r.sourceId, projectId })
    }
    sent++
  }
  return NextResponse.json({ ok: true, due: due.length, sent, skipped })
}
