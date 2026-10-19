export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"
import { proposalLang, proposalView } from "@/lib/gideon-runs"

/**
 * GET /api/gideon/proposals — the writes GIDEON is holding for the signed-in person (approval mode,
 * 12 Oct 2026). Only their own: a proposal is applied as them, so nobody else may see or decide it.
 * ?status=PENDING (default) | ALL. Newest first, at most 30.
 */
export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const all = req.nextUrl.searchParams.get("status") === "ALL"
  const rows = await prisma.gideonProposal.findMany({
    where: { userId: session.user.id, ...(all ? {} : { status: "PENDING" }) },
    orderBy: { createdAt: "desc" },
    take: 30,
  })
  const lang = await proposalLang(session.user.id, req.headers)
  return NextResponse.json({ proposals: rows.map((p) => proposalView(p, lang)) })
}
