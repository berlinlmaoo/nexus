export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"
import { isOrgBodPlus } from "@/lib/org"
import { canSeeJob } from "@/lib/print/access"
import { refreshJob, serializeJob } from "@/lib/print/service"

type Ctx = { params: Promise<{ jobId: string }> }

/**
 * GET /api/print/jobs/{id} → { job } — one print, its status asked from the printer when it is still printing
 * (the dialog polls this until "done" or "failed"). Your own; BoD / One Above All anyone's. 404 otherwise.
 */
export async function GET(_req: NextRequest, { params }: Ctx) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const { jobId } = await params
    const row = await prisma.printJob.findUnique({ where: { id: jobId } })
    // Someone else's job reads as missing, not forbidden: its id says nothing.
    if (!row || !canSeeJob(session.user.id, row.userId === session.user.id ? false : await isOrgBodPlus(session.user.id), row)) {
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }
    const job = await refreshJob(row)
    const user = await prisma.user.findUnique({ where: { id: job.userId }, select: { id: true, name: true, avatar: true } })
    return NextResponse.json({ job: serializeJob(job, user) })
  } catch (error) {
    console.error("Error reading a print job:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
