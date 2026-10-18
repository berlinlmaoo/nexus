export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import {
  MEMORY_MAX, MEMORY_TEXT_MAX, MemoryRefusal, deleteAllMemories, isMemoryPaused, listMemories, saveMemory, setMemoryPaused,
} from "@/lib/gideon-memory"

/**
 * GIDEON Memory (owner, 19 Oct 2026): what GIDEON remembers about the SESSION USER. Only ever their own — there is
 * no way to ask for anyone else's (not for OAA/BoD either; Control Room never reads this table).
 *   GET                         → { paused, max, textMax, memories: MemoryView[] }   (ACTIVE + PENDING suggestions)
 *   POST  { text, kind?, date? } → { memory }       add one (typed in Settings; saved as ACTIVE)
 *   PATCH { paused: boolean }   → { paused, ... }   pause / resume GIDEON Memory
 *   DELETE                      → { deleted: n }    forget everything
 * One memory: /api/gideon/memory/[id] (PATCH edit / confirm, DELETE forget).
 */

async function state(userId: string) {
  const [paused, memories] = await Promise.all([isMemoryPaused(userId), listMemories(userId, { includePending: true })])
  return { paused, max: MEMORY_MAX, textMax: MEMORY_TEXT_MAX, memories }
}

function refusal(e: unknown) {
  if (e instanceof MemoryRefusal) return NextResponse.json({ error: e.message, code: e.code }, { status: e.code === "not_found" ? 404 : 422 })
  console.error("GIDEON memory error:", e)
  return NextResponse.json({ error: "Server error" }, { status: 500 })
}

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  return NextResponse.json(await state(session.user.id))
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const body = (await req.json().catch(() => ({}))) as { text?: unknown; kind?: unknown; date?: unknown }
  try {
    // Typed by the person themself: that is an explicit ask (sensitive topics allowed; secrets still refused).
    const { memory, created } = await saveMemory(session.user.id, { text: body.text, kind: body.kind, date: body.date, status: "ACTIVE", source: "SETTINGS", explicit: true })
    return NextResponse.json({ memory, created }, { status: created ? 201 : 200 })
  } catch (e) {
    return refusal(e)
  }
}

export async function PATCH(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const body = (await req.json().catch(() => ({}))) as { paused?: unknown }
  if (typeof body.paused !== "boolean") return NextResponse.json({ error: "paused must be true or false" }, { status: 400 })
  await setMemoryPaused(session.user.id, body.paused)
  return NextResponse.json(await state(session.user.id))
}

export async function DELETE() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const deleted = await deleteAllMemories(session.user.id)
  return NextResponse.json({ deleted })
}
