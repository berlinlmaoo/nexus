export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import {
  MEMORY_MAX, MEMORY_TEXT_MAX, MemoryRefusal, PROFILE_FIELDS, isMemoryPaused, listMemories, memoryFeatureOn, profileFromMemories, setProfileMemories,
} from "@/lib/gideon-memory"

/**
 * GIDEON Memory fixed fields (19 Oct 2026) of the SESSION USER: "Your nickname", "Your role / occupation",
 * "More about you". Each is an ordinary memory (source PROFILE_NICKNAME | PROFILE_ROLE | PROFILE_ABOUT).
 *   PUT { nickname?, role?, about? }  string ("" or null clears; a missing key is left alone; max 170 chars)
 *     → the same state as GET /api/gideon/memory
 *   400 nothing to change · 422 { code: secret | paused | full | empty } · 503 { code: unavailable }
 */
export async function PUT(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (!(await memoryFeatureOn())) return NextResponse.json({ error: "GIDEON Memory is not available right now.", code: "unavailable" }, { status: 503 })
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const input: Record<string, unknown> = {}
  for (const f of PROFILE_FIELDS) if (body && f in body) input[f] = body[f]
  if (!Object.keys(input).length) return NextResponse.json({ error: "Nothing to change" }, { status: 400 })
  const userId = session.user.id
  try {
    await setProfileMemories(userId, input)
  } catch (e) {
    if (e instanceof MemoryRefusal) return NextResponse.json({ error: e.message, code: e.code }, { status: 422 })
    console.error("GIDEON memory profile error:", e)
    return NextResponse.json({ error: "Server error" }, { status: 500 })
  }
  const [paused, memories] = await Promise.all([isMemoryPaused(userId), listMemories(userId, { includePending: true })])
  const updatedAt = memories.reduce<string | null>((a, m) => (!a || m.updatedAt > a ? m.updatedAt : a), null)
  return NextResponse.json({ paused, available: true, max: MEMORY_MAX, textMax: MEMORY_TEXT_MAX, memories, profile: profileFromMemories(memories), updatedAt })
}
