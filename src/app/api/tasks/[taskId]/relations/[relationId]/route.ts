import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"
import { logAudit } from "@/lib/audit"

export async function DELETE(
  req: NextRequest,
  { params }: { params: { taskId: string; relationId: string } }
) {
  try {
    const session = await auth()
    if (!session?.user?.id)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    await prisma.taskRelation.delete({
      where: { id: params.relationId },
    })

    logAudit({ action: "delete", entityType: "task_relation", entityId: params.relationId, userId: session.user.id, request: req })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Error deleting relation:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
