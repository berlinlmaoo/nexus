export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"
import { checkProjectAccess } from "@/lib/rbac"
import { AUTOFILL_BATCH, lastAutofillResults, runAutofill } from "@/lib/gideon-autofill"

/**
 * Run AI Autofill now (12 Oct 2026). POST { customFieldId, scope: "empty" | "all" | "tasks", taskIds? }
 * → { started: true, count, remaining }. Fills at most 25 tasks per click (one GIDEON call), in the
 * background; GET /api/gideon/autofill shows the result (lastResult) and realtime task updates show the values.
 */
export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (!process.env.GIDEON_CHAT_URL) return NextResponse.json({ error: "GIDEON isn't connected on this server.", code: "not_configured" }, { status: 503 })
  const body = (await req.json().catch(() => ({}))) as { customFieldId?: unknown; scope?: unknown; taskIds?: unknown }
  const fieldId = typeof body.customFieldId === "string" ? body.customFieldId : ""
  const config = fieldId ? await prisma.customFieldAutofill.findUnique({ where: { customFieldId: fieldId } }) : null
  if (!config) return NextResponse.json({ error: "Turn on AI Autofill for this field first" }, { status: 404 })
  if (!(await checkProjectAccess(session.user.id, config.projectId, ["MEMBER"])).allowed) return NextResponse.json({ error: "You can't edit fields in this project." }, { status: 403 })
  const running = lastAutofillResults.get(fieldId)
  if (running && running.at === "running") return NextResponse.json({ error: "Already filling this field" }, { status: 409 })

  const scope = body.scope === "all" ? "all" : body.scope === "tasks" ? "tasks" : "empty"
  const where = {
    taskList: { projectId: config.projectId },
    ...(scope === "tasks" ? { id: { in: Array.isArray(body.taskIds) ? body.taskIds.filter((x): x is string => typeof x === "string").slice(0, AUTOFILL_BATCH) : [] } } : {}),
    ...(scope === "empty" ? { customFieldValues: { none: { customFieldId: fieldId, NOT: { value: "" } } } } : {}),
  }
  const [tasks, total] = await Promise.all([
    prisma.task.findMany({ where, select: { id: true }, orderBy: { createdAt: "desc" }, take: AUTOFILL_BATCH }),
    prisma.task.count({ where }),
  ])
  if (!tasks.length) return NextResponse.json({ started: false, count: 0, remaining: 0 })
  lastAutofillResults.set(fieldId, { ok: true, runId: null, filled: 0, proposed: 0, skipped: 0, at: "running" })
  void runAutofill({ projectId: config.projectId, fieldIds: [fieldId], taskIds: tasks.map((t) => t.id), actorId: session.user.id, trigger: "manual" })
    .then((r) => lastAutofillResults.set(fieldId, { ...r, at: new Date().toISOString(), remaining: Math.max(0, total - tasks.length) }))
  return NextResponse.json({ started: true, count: tasks.length, remaining: Math.max(0, total - tasks.length) })
}
