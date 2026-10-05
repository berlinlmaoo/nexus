export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { addDays, CALENDAR_TZ, dayDiff, dayStartUtc, isDayKey, wibDay } from "@/lib/calendar/core"
import {
  buildCalendarItems, calendarCaller, calendarJson, extraPeople, holidaysBetween, loadStructure, loadTaskRows, ROW_CAP, rulesOf,
} from "@/lib/calendar/server"

/** Longest range one call may ask for, inclusive: two months. */
const MAX_DAYS = 62

/**
 * GET /api/calendar/items?from=YYYY-MM-DD&to=YYYY-MM-DD — every task the caller may see whose due date
 * falls on those WIB days (inclusive), each placed under the Bagan cards of its PICs, plus tanggal
 * merah. Masked rows (private projects, decision 1) carry no id, title or project. See lib/calendar.
 */
export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams
    const from = sp.get("from")
    const to = sp.get("to")
    if (!isDayKey(from) || !isDayKey(to) || to < from) {
      return NextResponse.json({ error: "from dan to harus tanggal YYYY-MM-DD, dan to tidak boleh sebelum from.", code: "BAD_RANGE" }, { status: 400 })
    }
    if (dayDiff(from, to) + 1 > MAX_DAYS) {
      return NextResponse.json({ error: `Rentang paling panjang ${MAX_DAYS} hari.`, code: "RANGE_TOO_LONG" }, { status: 400 })
    }
    const caller = await calendarCaller()
    if (caller instanceof NextResponse) return caller
    const now = new Date()
    const base = { v: 1, tz: CALENDAR_TZ, today: wibDay(now), now: now.toISOString(), from, to }
    if (caller.kind !== "ok") {
      return calendarJson(req, { ...base, access: caller.kind, structureVersion: null, rules: null, items: [], people: {}, holidays: [], truncated: false })
    }
    const [s, { rows, truncated }, holidays] = await Promise.all([
      loadStructure(),
      loadTaskRows({ gte: dayStartUtc(from), lt: dayStartUtc(addDays(to, 1)) }, { take: ROW_CAP }),
      holidaysBetween(from, to),
    ])
    const items = await buildCalendarItems(rows, caller, s)
    return calendarJson(req, {
      ...base,
      access: caller.access,
      structureVersion: s.version,
      rules: rulesOf(caller.settings),
      items,
      people: await extraPeople(items, s),
      holidays,
      truncated,
    })
  } catch (error) {
    console.error("[calendar/items] GET", error)
    return NextResponse.json({ error: "Kalender tidak bisa dimuat." }, { status: 500 })
  }
}
