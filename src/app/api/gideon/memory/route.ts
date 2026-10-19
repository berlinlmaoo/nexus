export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import {
  MEMORY_MAX, MEMORY_TEXT_MAX, MemoryRefusal, profileFromMemories, deleteAllMemories, isMemoryPaused, listMemories, memoryFeatureOn, saveMemory, setMemoryPaused,
} from "@/lib/gideon-memory"

/**
 * GIDEON Memory (owner, 19 Oct 2026): what GIDEON remembers about the SESSION USER. Only ever their own — there is
 * no way to ask for anyone else's (not for OAA/BoD either; Control Room never reads this table).
 *   GET                         → { paused, available, max, textMax, memories: MemoryView[], profile, updatedAt }   (ACTIVE + PENDING)
 *     profile: { nickname, role, about } (string | null) — the fixed fields, also listed in `memories` (source PROFILE_*)
 *     updatedAt: ISO time of the newest change, null when empty (added 19 Oct 2026; older clients ignore both)
 *   PUT /api/gideon/memory/profile { nickname?, role?, about? } → same state (see that route)
 *     available=false: the remote-config kill switch is off (adding refused; listing and deleting still work)
 *   POST  { text, kind?, date? } → { memory }       add one (typed in Settings; saved as ACTIVE)
 *   PATCH { paused: boolean }   → { paused, ... }   pause / resume GIDEON Memory
 *   DELETE                      → { deleted: n }    forget everything
 * One memory: /api/gideon/memory/[id] (PATCH edit / confirm, DELETE forget).
 */

async function state(userId: string) {
  const [paused, available, memories] = await Promise.all([isMemoryPaused(userId), memoryFeatureOn(), listMemories(userId, { includePending: true })])
  // updatedAt: the newest change among the live memories (null when there are none) — "Updated 2 h ago".
  const updatedAt = memories.reduce<string | null>((a, m) => (!a || m.updatedAt > a ? m.updatedAt : a), null)
  return { paused, available, max: MEMORY_MAX, textMax: MEMORY_TEXT_MAX, memories, profile: profileFromMemories(memories), updatedAt }
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
  if (!(await memoryFeatureOn())) return NextResponse.json({ error: "GIDEON Memory is not available right now.", code: "unavailable" }, { status: 503 })
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
