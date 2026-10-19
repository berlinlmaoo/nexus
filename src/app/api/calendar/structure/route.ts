export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { calendarCaller, calendarFolders, calendarJson, loadStructure } from "@/lib/calendar/server"

/**
 * GET /api/calendar/structure — the Bagan IP & Divisi as the Calendar groups by it, readable by every
 * company member (owner, 5 Oct 2026, decision 2): units with their order (`rank`), section and colour,
 * people with the cards their tasks go to (`homeUnitIds`), job titles and "di bawah". No email, no
 * canvas position. Not to be confused with /api/calendars (saved project sets) or /api/admin/org-chart
 * (the editor, Manager and up). The chart grants nothing.
 * `folders` (18 Oct 2026): the project folders the caller can filter by (?folder= on /items and /overdue),
 * in tree order with their depth — only folders holding a project the caller sees in full.
 */
export async function GET(req: NextRequest) {
  try {
    const caller = await calendarCaller()
    if (caller instanceof NextResponse) return caller
    if (caller.kind !== "ok") return calendarJson(req, { v: 1, version: null, access: caller.kind, me: null, units: [], people: [], folders: [] })
    const [s, folders] = await Promise.all([loadStructure(), calendarFolders(caller)])
    const mine = s.people.find((p) => p.userId === caller.userId)
    return calendarJson(req, {
      v: 1,
      version: s.version,
      access: caller.access,
      me: { userId: caller.userId, role: caller.orgRole, homeUnitIds: mine?.homeUnitIds ?? [] },
      units: s.units,
      people: s.people,
      folders,
    })
  } catch (error) {
    console.error("[calendar/structure] GET", error)
    return NextResponse.json({ error: "Struktur kalender tidak bisa dimuat." }, { status: 500 })
  }
}
