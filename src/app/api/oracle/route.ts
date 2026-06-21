export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { getAdminSessionContext } from "@/lib/admin-access"
import { askOracle, executeIntent, type ParsedIntent } from "@/lib/oracle"

// Codex LLM fallback (host shim). Classifies a free-form question into a structured intent; the
// backend still runs the actual query via executeIntent. Best-effort — any failure falls back to
// the deterministic result. Disabled unless ORACLE_LLM_URL is configured.
async function codexInterpret(query: string): Promise<ParsedIntent | null> {
  const url = process.env.ORACLE_LLM_URL
  if (!url) return null
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-oracle-secret": process.env.ORACLE_LLM_SECRET || "" },
      body: JSON.stringify({ query }),
      signal: AbortSignal.timeout(30000),
    })
    if (!res.ok) return null
    const data = (await res.json()) as ParsedIntent
    return data && typeof data.intent === "string" ? data : null
  } catch (e) {
    console.error("[oracle] codex shim failed", e)
    return null
  }
}

// One-Above-All voice dashboard backend. Strictly gated to ONE_ABOVE_ALL (or a system admin superuser).
export async function POST(request: NextRequest) {
  const { session, context } = await getAdminSessionContext()
  if (!context?.user || !session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const isOneAboveAll = context.workspaceMemberships.some((m) => m.role === "ONE_ABOVE_ALL")
  if (!isOneAboveAll && !context.isSystemAdmin) {
    return NextResponse.json({ error: "Khusus One Above All." }, { status: 403 })
  }

  let body: { query?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 })
  }
  const query = (body.query || "").toString().slice(0, 500)

  const actor = { id: context.user.id, name: context.user.name }
  try {
    const result = await askOracle(query, actor)
    // Deterministic parser found nothing → try the Codex LLM to classify a free-form question.
    if (result.needsLlm) {
      const parsed = await codexInterpret(query)
      if (parsed) {
        const llm = await executeIntent(parsed, actor)
        return NextResponse.json({ ...llm, usedLlm: true })
      }
    }
    return NextResponse.json(result)
  } catch (error) {
    console.error("[oracle] query failed", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
