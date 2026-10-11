export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { describeRefs, type GideonContextRef } from "@/lib/gideon-assistant"

/** Name the context chips (POST { refs: [{ kind, id }] }) — only pages the person can open come back. */
export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const body = (await req.json().catch(() => ({}))) as { refs?: GideonContextRef[] }
  const refs = Array.isArray(body.refs) ? body.refs.slice(0, 8) : []
  return NextResponse.json({ refs: await describeRefs(session.user.id, refs) })
}
