export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { auth } from "@/lib/auth"
import { logAudit } from "@/lib/audit"
import { checkProjectAccess } from "@/lib/rbac"
import { generateLegalDocument, LegalGenerateError } from "@/lib/legal-templates/generate"

// POST /api/legal/documents/generate  { taskId }
//
// Issues a document number and produces the invoice/PKS for a request task, attaching PDF + DOCX.
// Gated to project LEAD (checkProjectAccess also lets workspace OWNER/ADMIN through on its own):
// issuing a number is a bookkeeping act, and a requester shouldn't be able to mint one on their own
// request.
export async function POST(request: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const body = (await request.json().catch(() => ({}))) as { taskId?: unknown }
    const taskId = typeof body.taskId === "string" ? body.taskId : ""
    if (!taskId) return NextResponse.json({ error: "taskId wajib." }, { status: 400 })

    const task = await prisma.task.findUnique({
      where: { id: taskId },
      select: { id: true, taskList: { select: { projectId: true } } },
    })
    if (!task) return NextResponse.json({ error: "Task-nya nggak ketemu." }, { status: 404 })

    const access = await checkProjectAccess(session.user.id, task.taskList.projectId, ["LEAD"])
    if (!access.allowed) {
      return NextResponse.json({ error: "Cuma lead project ini yang boleh nerbitin nomor dokumen." }, { status: 403 })
    }

    const result = await generateLegalDocument({ taskId, actorId: session.user.id })

    logAudit({
      action: "create", entityType: "legal_document", entityId: result.documentId,
      entityName: result.number, userId: session.user.id, request,
      metadata: { taskId, series: result.series, number: result.number },
    })

    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    if (error instanceof LegalGenerateError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    console.error("Error generating legal document:", error)
    return NextResponse.json({ error: "Gagal generate dokumen." }, { status: 500 })
  }
}
