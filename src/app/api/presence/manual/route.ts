export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { PresenceRefusal, availabilityFromDb, clearManualStatus, getPresence, parseWibTime, presenceEnabled, setManualStatus } from "@/lib/presence"

/**
 * The caller's own manual status, "<availability> · <text>" from `startsAt` to `endsAt` (owner, 19 Oct 2026).
 *   PUT    /api/presence/manual { text, startsAt?, endsAt, availability? }   startsAt default now; times = ISO
 *          instant, or "YYYY-MM-DD HH:MM" / "YYYY-MM-DDTHH:MM" read as WIB; availability (N-1) = online | away | dnd
 *          (any case), missing/null = away (iOS/Android 0.1.6 and older send none) → 200 { manual, status }
 *   DELETE /api/presence/manual[?id=<manual id>]              with id: only that one (another device may have set a
 *          newer one in between) → 200 { cleared: n, status }
 * Refusals: 400 { error, code } (AVAILABILITY | TEXT | END | END_PAST | END_BEFORE_START | START_FAR | TOO_LONG); 403 PRESENCE_OFF
 * while the remote-config switch is off. One status per person: PUT replaces. It ends by itself at endsAt (the
 * server's minute clock deletes it and everyone's screens update). Nobody is notified.
 */
function sourceOf(req: NextRequest): string {
  const c = (req.headers.get("x-nexus-client") ?? "").toLowerCase()
  if (c.startsWith("ios/")) return "ios"
  if (c.startsWith("android/")) return "android"
  return "web"
}

export async function PUT(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (!(await presenceEnabled())) return NextResponse.json({ error: "Status is not available right now.", code: "PRESENCE_OFF" }, { status: 403 })
  const body = (await req.json().catch(() => ({}))) as { text?: unknown; startsAt?: unknown; endsAt?: unknown; availability?: unknown }
  try {
    const row = await setManualStatus(session.user.id, {
      text: body.text,
      startsAt: body.startsAt == null || body.startsAt === "" ? null : parseWibTime(body.startsAt),
      endsAt: parseWibTime(body.endsAt),
      availability: body.availability,
      source: sourceOf(req),
    })
    const status = (await getPresence([session.user.id])).get(session.user.id) ?? null
    return NextResponse.json({ manual: { id: row.id, text: row.text, startsAt: row.startsAt.toISOString(), endsAt: row.endsAt.toISOString(), availability: availabilityFromDb(row.availability) }, status })
  } catch (e) {
    if (e instanceof PresenceRefusal) return NextResponse.json({ error: e.message, code: e.code }, { status: 400 })
    throw e
  }
}

export async function DELETE(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const id = req.nextUrl.searchParams.get("id")?.trim() || null
  const cleared = await clearManualStatus(session.user.id, id)
  const status = (await presenceEnabled()) ? ((await getPresence([session.user.id])).get(session.user.id) ?? null) : null
  return NextResponse.json({ cleared, status })
}
