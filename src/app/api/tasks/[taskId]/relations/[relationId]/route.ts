import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"

export async function DELETE(
  req: NextRequest,
  { params }: { params: { taskId: string; relationId: string } }
) {
  const session = await auth()
  if (!session?.user?.id)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  await prisma.taskRelation.delete({
    where: { id: params.relationId },
  })

  return NextResponse.json({ success: true })
}
