export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"
import { requestInclude, serializeForRequester } from "@/lib/legal/requests"

/**
 * My Legal requests (owner, 14 Oct 2026): the requests I sent through a Legal request link, with where each
 * stands. Only my own, and of Legal's archive only the document each of them produced.
 */
export async function GET() {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const rows = await prisma.legalRequest.findMany({
      where: { requesterId: session.user.id },
      orderBy: { createdAt: "desc" },
      take: 200,
      include: requestInclude,
    })
    return NextResponse.json({ requests: await serializeForRequester(session.user.id, rows) })
  } catch (error) {
    console.error("Error listing my Legal requests:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
