export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { taskWriteRefusal } from "@/lib/write-access"
import prisma from "@/lib/prisma"
import { logAudit } from "@/lib/audit"

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ taskId: string; relationId: string }> }
) {
  try {
    const session = await auth()
    if (!session?.user?.id)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    // Signed in is not enough (writes batch): the relation must hang off the task in the path (either
    // end), and the caller must be able to open that task.
    const { taskId, relationId } = await params
    const relationRef = await prisma.taskRelation.findUnique({ where: { id: relationId }, select: { sourceTaskId: true, targetTaskId: true } })
    if (!relationRef || (relationRef.sourceTaskId !== taskId && relationRef.targetTaskId !== taskId)) {
      return NextResponse.json({ error: "Relation not found" }, { status: 404 })
    }
    const refusal = await taskWriteRefusal(session.user.id, taskId)
    if (refusal) return refusal

    await prisma.taskRelation.delete({
      where: { id: (await params).relationId },
    })

    logAudit({ action: "delete", entityType: "task_relation", entityId: (await params).relationId, userId: session.user.id, request: req })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Error deleting relation:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
