export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import {
  addDays, CALENDAR_TZ, capGlance, dayStartUtc, glanceEntry, glanceWindow, inScope, subtreeOf, wibDay, type GlanceScope,
} from "@/lib/calendar/core"
import {
  buildCalendarItems, calendarCaller, calendarJson, holidaysBetween, loadStructure, loadTaskRows, loadUndatedRows, rulesOf,
} from "@/lib/calendar/server"

const MAX_DATED = 400
const MAX_UNDATED = 50

/**
 * GET /api/calendar/glance?scope=me|division|all — one snapshot the widgets (Home Screen, Lock Screen)
 * and the Apple Watch draw from without asking again: the tasks of the scope from a little before this
 * month to the end of next month, plus open tasks without a due date for "Suatu hari". Compact keys,
 * titles cut at 60 characters, ≤ ~64 KB. Bars, "+N", "Tidak lama lagi", the four lists and the counts
 * are worked out on the device from this, so they move at midnight without a refresh.
 *
 * Scopes (owner, 5 Oct 2026, decision 8): "me" = assigned to me; "division" = placed in one of my home
 * cards or below them (no card → "me", and `scope` says so); "all" = everything I may see. Private
 * projects stay masked exactly as in the calendar.
 */
export async function GET(req: NextRequest) {
  try {
    const raw = req.nextUrl.searchParams.get("scope")
    const requested: GlanceScope = raw === "division" || raw === "all" ? raw : "me"
    const caller = await calendarCaller()
    if (caller instanceof NextResponse) return caller
    const now = new Date()
    const today = wibDay(now)
    if (caller.kind !== "ok") {
      return calendarJson(req, { v: 1, tz: CALENDAR_TZ, userId: caller.userId, access: caller.kind, scope: requested, requestedScope: requested, today, now: now.toISOString(), from: null, to: null, rules: null, items: [], undated: [], holidays: [], truncated: false })
    }
    const { from, to } = glanceWindow(today, caller.settings.overdueWindowDays)
    const [s, { rows }, undatedRows, holidays] = await Promise.all([
      loadStructure(),
      loadTaskRows({ gte: dayStartUtc(from), lt: dayStartUtc(addDays(to, 1)) }),
      loadUndatedRows(requested === "me" ? caller.userId : null, requested === "me" ? MAX_UNDATED : 500),
      holidaysBetween(from, to),
    ])
    const myHomes = s.people.find((p) => p.userId === caller.userId)?.homeUnitIds ?? []
    const scope: GlanceScope = requested === "division" && myHomes.length === 0 ? "me" : requested
    const division = subtreeOf(s.units, myHomes)
    const pick = async (rs: typeof rows) => (await buildCalendarItems(rs, caller, s)).filter((i) => inScope(i, scope, caller.userId, division))
    const colors = { unitColor: s.unitColor, sectionColor: s.sectionColor, division }
    const dated = capGlance((await pick(rows)).map((i) => glanceEntry(i, scope, colors)), today, MAX_DATED)
    const undated = (await pick(undatedRows)).slice(0, MAX_UNDATED).map((i) => glanceEntry(i, scope, colors, false))
    return calendarJson(req, {
      v: 1,
      tz: CALENDAR_TZ,
      userId: caller.userId,
      access: caller.access,
      scope,
      requestedScope: requested,
      today,
      now: now.toISOString(),
      from,
      to,
      rules: rulesOf(caller.settings),
      items: dated.entries,
      undated,
      holidays,
      truncated: dated.truncated,
    })
  } catch (error) {
    console.error("[calendar/glance] GET", error)
    return NextResponse.json({ error: "Ringkasan kalender tidak bisa dimuat." }, { status: 500 })
  }
}
