export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { CALENDAR_TZ, compareItems, dayStartUtc, wibDay } from "@/lib/calendar/core"
import { buildCalendarItems, calendarCaller, calendarJson, extraPeople, loadStructure, loadTaskRows, rulesOf } from "@/lib/calendar/server"

/** Enough for today's ±500; more says `truncated`. */
const CAP = 1000

/**
 * GET /api/calendar/overdue — every open task the caller may see whose WIB due day is before today,
 * newest day first. Tasks of projects without status (calendar-only) are never overdue. The app splits it: up to `rules.overdueWindowDays` old → the overdue rail, older →
 * "Terbengkalai". A task with a time that passed earlier today comes from /items (the app knows `now`).
 */
export async function GET(req: NextRequest) {
  try {
    const caller = await calendarCaller()
    if (caller instanceof NextResponse) return caller
    const now = new Date()
    const today = wibDay(now)
    const base = { v: 1, tz: CALENDAR_TZ, today, now: now.toISOString() }
    if (caller.kind !== "ok") return calendarJson(req, { ...base, access: caller.kind, structureVersion: null, rules: null, items: [], people: {}, truncated: false })
    const [s, { rows, truncated }] = await Promise.all([
      loadStructure(),
      loadTaskRows({ lt: dayStartUtc(today) }, { open: true, take: CAP, order: "desc" }),
    ])
    // Newest day first; within a day the usual order (URGENT first, titled before masked).
    const items = (await buildCalendarItems(rows, caller, s)).sort((a, b) => (a.day !== b.day ? (a.day < b.day ? 1 : -1) : compareItems(a, b)))
    return calendarJson(req, {
      ...base,
      access: caller.access,
      structureVersion: s.version,
      rules: rulesOf(caller.settings),
      items,
      people: await extraPeople(items, s),
      truncated,
    })
  } catch (error) {
    console.error("[calendar/overdue] GET", error)
    return NextResponse.json({ error: "Tugas lewat tenggat tidak bisa dimuat." }, { status: 500 })
  }
}
