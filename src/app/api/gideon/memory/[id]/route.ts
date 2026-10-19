export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { MemoryRefusal, deleteMemory, updateMemory } from "@/lib/gideon-memory"

/**
 * One GIDEON Memory of the session user (19 Oct 2026). Someone else's id answers 404, exactly like a missing one.
 *   PATCH  { text?, kind?, date?, status?: "ACTIVE" } → { memory }   edit, or Save a suggestion (the chat chip)
 *   DELETE                                           → { deleted }  forget it / Don't save a suggestion
 */

function fail(e: unknown) {
  if (e instanceof MemoryRefusal) return NextResponse.json({ error: e.message, code: e.code }, { status: e.code === "not_found" ? 404 : 422 })
  console.error("GIDEON memory error:", e)
  return NextResponse.json({ error: "Server error" }, { status: 500 })
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { id } = await params
  const body = (await req.json().catch(() => ({}))) as { text?: unknown; kind?: unknown; date?: unknown; status?: unknown }
  try {
    return NextResponse.json({ memory: await updateMemory(session.user.id, String(id).slice(0, 64), body) })
  } catch (e) {
    return fail(e)
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { id } = await params
  const deleted = await deleteMemory(session.user.id, String(id).slice(0, 64))
  if (!deleted) return NextResponse.json({ error: "That memory is gone.", code: "not_found" }, { status: 404 })
  return NextResponse.json({ deleted: true })
}
