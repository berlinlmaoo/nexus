export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"
import { checkProjectAccess } from "@/lib/rbac"
import { normalizeCustomFieldType } from "@/lib/custom-fields"
import { AUTOFILL_MODES, AUTOFILL_TYPES, lastAutofillResults } from "@/lib/gideon-autofill"

/**
 * AI Autofill settings of a project's custom fields (12 Oct 2026).
 *   GET ?projectId=   → { configs, marks: [{ customFieldId, taskId, value }], canManage, configured }
 *   PUT { customFieldId, enabled?, mode?, prompt?, onCreate?, onUpdate?, approval? } → { config }
 *   DELETE ?customFieldId= → { ok }
 * Reading needs project access; changing needs the same access as editing the field (project member+).
 */
function view(c: { customFieldId: string; projectId: string; enabled: boolean; mode: string; prompt: string | null; onCreate: boolean; onUpdate: boolean; approval: string; lastRunAt: Date | null; lastStatus: string | null; updatedAt: Date }) {
  const last = lastAutofillResults.get(c.customFieldId)
  return {
    customFieldId: c.customFieldId, projectId: c.projectId, enabled: c.enabled, mode: c.mode, prompt: c.prompt, onCreate: c.onCreate,
    onUpdate: c.onUpdate, approval: c.approval, lastRunAt: c.lastRunAt?.toISOString() ?? null, lastStatus: c.lastStatus, updatedAt: c.updatedAt.toISOString(),
    lastResult: last ? { at: last.at, filled: last.filled, proposed: last.proposed, skipped: last.skipped, error: last.error ?? null } : null,
  }
}

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const projectId = req.nextUrl.searchParams.get("projectId") || ""
  if (!projectId) return NextResponse.json({ error: "projectId is required" }, { status: 400 })
  if (!(await checkProjectAccess(session.user.id, projectId, ["VIEWER"])).allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  const [configs, canManage] = await Promise.all([
    prisma.customFieldAutofill.findMany({ where: { projectId }, orderBy: { createdAt: "asc" } }),
    checkProjectAccess(session.user.id, projectId, ["MEMBER"]).then((r) => r.allowed),
  ])
  const marks = configs.length
    ? await prisma.customFieldAiFill.findMany({ where: { customFieldId: { in: configs.map((c) => c.customFieldId) } }, select: { customFieldId: true, taskId: true, value: true }, take: 5000 })
    : []
  return NextResponse.json({ configs: configs.map(view), marks, canManage, configured: Boolean(process.env.GIDEON_CHAT_URL), types: AUTOFILL_TYPES })
}

export async function PUT(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const fieldId = typeof body.customFieldId === "string" ? body.customFieldId : ""
  const field = fieldId ? await prisma.customField.findUnique({ where: { id: fieldId }, select: { id: true, type: true, projectId: true } }) : null
  if (!field) return NextResponse.json({ error: "Custom field not found" }, { status: 404 })
  if (!(await checkProjectAccess(session.user.id, field.projectId, ["MEMBER"])).allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  const type = normalizeCustomFieldType(field.type)
  if (!type || !AUTOFILL_TYPES.includes(type)) return NextResponse.json({ error: "GIDEON can't fill this kind of field.", code: "unsupported_type" }, { status: 400 })
  const bool = (v: unknown) => (typeof v === "boolean" ? v : undefined)
  const mode = typeof body.mode === "string" && (AUTOFILL_MODES as readonly string[]).includes(body.mode) ? body.mode : undefined
  const approval = body.approval === "review" || body.approval === "auto" ? body.approval : undefined
  const prompt = typeof body.prompt === "string" ? body.prompt.trim().slice(0, 1000) || null : body.prompt === null ? null : undefined
  const data = {
    ...(bool(body.enabled) !== undefined ? { enabled: bool(body.enabled)! } : {}),
    ...(mode ? { mode } : {}),
    ...(approval ? { approval } : {}),
    ...(prompt !== undefined ? { prompt } : {}),
    ...(bool(body.onCreate) !== undefined ? { onCreate: bool(body.onCreate)! } : {}),
    ...(bool(body.onUpdate) !== undefined ? { onUpdate: bool(body.onUpdate)! } : {}),
  }
  const defaultMode = type === "SELECT" || type === "MULTI_SELECT" || type === "STATUS" ? "classify" : type === "TEXT" ? "summary" : "extract"
  const config = await prisma.customFieldAutofill.upsert({
    where: { customFieldId: field.id },
    create: { customFieldId: field.id, projectId: field.projectId, createdById: session.user.id, mode: defaultMode, ...data },
    update: data,
  })
  return NextResponse.json({ config: view(config) })
}

export async function DELETE(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const fieldId = req.nextUrl.searchParams.get("customFieldId") || ""
  const config = await prisma.customFieldAutofill.findUnique({ where: { customFieldId: fieldId } })
  if (!config) return NextResponse.json({ ok: true })
  if (!(await checkProjectAccess(session.user.id, config.projectId, ["MEMBER"])).allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  await prisma.customFieldAutofill.delete({ where: { customFieldId: fieldId } })
  // The values stay (they are the project's data now); only the ✨ marks go.
  await prisma.customFieldAiFill.deleteMany({ where: { customFieldId: fieldId } })
  return NextResponse.json({ ok: true })
}
