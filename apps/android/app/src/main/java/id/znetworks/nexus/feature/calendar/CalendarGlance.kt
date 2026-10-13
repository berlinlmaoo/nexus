package id.znetworks.nexus.feature.calendar

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.ZoneOffset
import java.time.temporal.ChronoUnit

/**
 * Widget rules (Calendar phase 4): what the home-screen widgets draw from ONE /api/calendar/glance
 * snapshot at any moment. A 1:1 port of the web's client/glance/glance.ts, held to its golden files
 * (fixtures/golden-glance, CalendarGlanceTest) — the iOS CalendarGlance.swift is held to the same ones.
 * Pure and boring on purpose: no locale collation, nothing that could differ from the other two ports.
 */
object CalendarGlance {
    const val DAY_MS = 86_400_000L
    private const val WIB_MS = 7 * 3_600_000L
    /** A snapshot older than this is not shown as current ("Open NEXUS to refresh"). */
    const val STALE_AFTER_MS = 2 * DAY_MS

    data class Rules(val overdueWindowDays: Int, val urgentDays: Int)
    private val DEFAULT_RULES = Rules(14, 2)
    private fun rulesOf(s: CalGlance) = s.rules?.let { Rules(it.overdueWindowDays, it.urgentDays) } ?: DEFAULT_RULES

    // ── Time ──

    data class Clock(val day: String, val hm: String)

    /** The WIB day and minute of an instant: ("2026-10-05", "12:00"). */
    fun wibClock(nowMs: Long): Clock {
        val t = LocalDateTime.ofEpochSecond(Math.floorDiv(nowMs + WIB_MS, 1000L), 0, ZoneOffset.UTC)
        return Clock(t.toLocalDate().toString(), "%02d:%02d".format(t.hour, t.minute))
    }
    fun addDays(day: String, n: Int): String = LocalDate.parse(day).plusDays(n.toLong()).toString()
    /** b − a in days. */
    fun dayDiff(a: String, b: String): Int = ChronoUnit.DAYS.between(LocalDate.parse(a), LocalDate.parse(b)).toInt()
    /** 0 = Monday … 6 = Sunday. */
    fun mondayIndex(day: String): Int = LocalDate.parse(day).dayOfWeek.value - 1
    fun mondayOf(day: String): String = addDays(day, -mondayIndex(day))
    /** The instant a WIB day + "HH:MM" names, in ms. */
    fun wibInstant(day: String, hm: String): Long =
        LocalDateTime.parse("${day}T$hm:00").toInstant(ZoneOffset.UTC).toEpochMilli() - WIB_MS

    // ── One entry ──

    fun entryKey(e: GlanceEntry): String = e.id ?: e.k ?: ""
    /** Still work to do: not done, and in a project that has a status. */
    fun entryOpen(e: GlanceEntry): Boolean = !e.done && !e.ns

    @Serializable enum class Overdue { @SerialName("none") NONE, @SerialName("recent") RECENT, @SerialName("stale") STALE }

    /**
     * RECENT = overdue for at most the window (red), STALE = older (grey, stays on its date). Date-only
     * is overdue once its WIB day is over; timed from the minute after its time ("12:00" turns at 12:01).
     */
    fun entryOverdue(e: GlanceEntry, day: String, hm: String, windowDays: Int): Overdue {
        if (!entryOpen(e) || e.day == null) return Overdue.NONE
        val over = e.day < day || (e.day == day && e.time != null && e.time < hm)
        if (!over) return Overdue.NONE
        return if (dayDiff(e.day, day) > windowDays) Overdue.STALE else Overdue.RECENT
    }

    private fun prioRank(p: String?): Int = when (p ?: "MEDIUM") { "URGENT" -> 0; "HIGH" -> 1; "MEDIUM" -> 2; "LOW" -> 3; "NONE" -> 4; else -> 2 }

    /** Titles: lower-cased code units, then the raw string. Deliberately not a locale collation. */
    fun titleOrder(a: String, b: String): Int {
        val la = a.lowercase()
        val lb = b.lowercase()
        if (la != lb) return if (la < lb) -1 else 1
        return a.compareTo(b).coerceIn(-1, 1)
    }

    /** Inside one day: open first (overdue first), then done; timed by time, then date-only; priority; titled before masked; title; key. */
    fun compareInDay(day: String, hm: String, windowDays: Int) = Comparator<GlanceEntry> { a, b ->
        val oa = if (entryOpen(a)) 0 else 1
        val ob = if (entryOpen(b)) 0 else 1
        if (oa != ob) return@Comparator oa - ob
        val la = if (entryOverdue(a, day, hm, windowDays) == Overdue.NONE) 1 else 0
        val lb = if (entryOverdue(b, day, hm, windowDays) == Overdue.NONE) 1 else 0
        if (la != lb) return@Comparator la - lb
        if ((a.time == null) != (b.time == null)) return@Comparator if (a.time == null) 1 else -1
        if (a.time != b.time) return@Comparator if ((a.time ?: "") < (b.time ?: "")) -1 else 1
        val pa = prioRank(a.prio)
        val pb = prioRank(b.prio)
        if (pa != pb) return@Comparator pa - pb
        if (a.m != b.m) return@Comparator if (a.m) 1 else -1
        val t = titleOrder(a.t ?: "", b.t ?: "")
        if (t != 0) return@Comparator t
        entryKey(a).compareTo(entryKey(b)).coerceIn(-1, 1)
    }

    /** Across days (lists): by day, undated last, then the in-day order. */
    fun compareChrono(day: String, hm: String, windowDays: Int): Comparator<GlanceEntry> {
        val inDay = compareInDay(day, hm, windowDays)
        return Comparator { a, b ->
            if (a.day != b.day) {
                if (a.day == null) return@Comparator 1
                if (b.day == null) return@Comparator -1
                return@Comparator if (a.day < b.day) -1 else 1
            }
            inDay.compare(a, b)
        }
    }

    /**
     * What a widget draws for one task. [id] and [title] are null when masked: the row opens the day.
     * [dim] = done or a status-less project (drawn faded); [done] = ticked done only (the ✓ — a
     * calendar-only project never gets one).
     */
    @Serializable
    data class Bar(
        val key: String, val id: String?, val title: String?, val day: String?, val time: String?, val color: String,
        val project: String?, val priority: String?, val dim: Boolean, val done: Boolean, val masked: Boolean, val overdue: Overdue,
    )

    private fun bar(e: GlanceEntry, day: String, hm: String, windowDays: Int) = Bar(
        key = entryKey(e), id = e.id, title = e.t, day = e.day, time = e.time, color = e.c, project = e.p, priority = e.prio,
        dim = !entryOpen(e), done = e.done && !e.ns, masked = e.m, overdue = entryOverdue(e, day, hm, windowDays),
    )

    // ── Days ──

    @Serializable
    data class DayBars(
        val day: String,
        /** Every task due that day (unique). */
        val count: Int,
        /** Of those, still to do. */
        val open: Int,
        /** The first `max` in the in-day order. */
        val bars: List<Bar>,
        /** "+N": the rest. */
        val more: Int,
        /** Something due that day is overdue within the window (a red mark). */
        val overdue: Boolean,
        val today: Boolean,
        val holiday: String?,
        val sunday: Boolean,
        /** Inside the snapshot's window; outside it the widget knows nothing (not the same as "no tasks"). */
        val covered: Boolean,
    )

    private fun dayBars(s: CalGlance, d: String, max: Int, nowMs: Long): DayBars {
        val (day, hm) = wibClock(nowMs)
        val w = rulesOf(s).overdueWindowDays
        val entries = s.items.filter { it.day == d }.sortedWith(compareInDay(day, hm, w))
        return DayBars(
            day = d,
            count = entries.size,
            open = entries.count(::entryOpen),
            bars = entries.take(max).map { bar(it, day, hm, w) },
            more = maxOf(0, entries.size - max),
            overdue = entries.any { entryOverdue(it, day, hm, w) == Overdue.RECENT },
            today = d == day,
            holiday = s.holidays.firstOrNull { it.day == d }?.name,
            sunday = mondayIndex(d) == 6,
            covered = s.from != null && s.to != null && d >= s.from && d <= s.to,
        )
    }

    @Serializable data class YearProgress(val day: Int, val days: Int, val percent: Int)

    /** "Day 278 · 76%": floored, so 100% only on 31 Dec. */
    fun yearProgress(day: String): YearProgress {
        val y = day.substring(0, 4).toInt()
        val n = dayDiff("$y-01-01", day) + 1
        val days = dayDiff("$y-01-01", "${y + 1}-01-01")
        return YearProgress(n, days, n * 100 / days)
    }

    data class MonthCell(val bars: DayBars, val inMonth: Boolean)
    /** [month] = "YYYY-MM" of today; [cells] = 42 days, Monday first, like the calendar's grid. */
    data class MonthView(val month: String, val today: String, val year: YearProgress, val cells: List<MonthCell>)

    fun monthView(s: CalGlance, nowMs: Long, maxBars: Int): MonthView {
        val day = wibClock(nowMs).day
        val start = mondayOf(day.substring(0, 8) + "01")
        return MonthView(day.substring(0, 7), day, yearProgress(day), List(42) { i ->
            val d = addDays(start, i)
            MonthCell(dayBars(s, d, maxBars, nowMs), d.substring(0, 7) == day.substring(0, 7))
        })
    }

    /** Monday → Sunday of this week. */
    fun weekView(s: CalGlance, nowMs: Long, maxBars: Int): List<DayBars> {
        val monday = mondayOf(wibClock(nowMs).day)
        return List(7) { dayBars(s, addDays(monday, it), maxBars, nowMs) }
    }

    // ── Lists ──

    @Serializable data class BarList(val rows: List<Bar>, val more: Int)

    /** "Coming up": open tasks not yet due — today's whose time has not passed (date-only all day), then later days. */
    fun upcoming(s: CalGlance, nowMs: Long, limit: Int): BarList {
        val (day, hm) = wibClock(nowMs)
        val w = rulesOf(s).overdueWindowDays
        val list = s.items
            .filter { e -> entryOpen(e) && e.day != null && (e.day > day || (e.day == day && (e.time == null || e.time >= hm))) }
            .sortedWith(compareChrono(day, hm, w))
        return BarList(list.take(limit).map { bar(it, day, hm, w) }, maxOf(0, list.size - limit))
    }

    /** DO = important and urgent · PLAN = important · ACT = urgent · LATER = neither. */
    @Serializable enum class Quadrant(val wire: String) {
        @SerialName("do") DO("do"), @SerialName("plan") PLAN("plan"), @SerialName("act") ACT("act"), @SerialName("later") LATER("later");
        companion object { fun of(wire: String?) = entries.firstOrNull { it.wire == wire } }
    }

    /**
     * Eisenhower, open tasks only. Important = URGENT or HIGH. Urgent = URGENT, or due from today to
     * `urgentDays − 1` ahead, or overdue within the window. Older overdue and undated: urgent only when URGENT.
     */
    fun quadrantOf(e: GlanceEntry, day: String, rules: Rules): Quadrant {
        val important = e.prio == "URGENT" || e.prio == "HIGH"
        var urgent = e.prio == "URGENT"
        if (!urgent && e.day != null) {
            val ahead = dayDiff(day, e.day)
            urgent = ahead < rules.urgentDays && ahead >= -rules.overdueWindowDays
        }
        return when {
            important && urgent -> Quadrant.DO
            important -> Quadrant.PLAN
            urgent -> Quadrant.ACT
            else -> Quadrant.LATER
        }
    }

    @Serializable data class QuadrantList(val quadrant: Quadrant, val count: Int, val rows: List<Bar>)

    /** All four, every open task once (dated and undated), each in order. */
    fun quadrants(s: CalGlance, nowMs: Long): List<QuadrantList> {
        val (day, hm) = wibClock(nowMs)
        val rules = rulesOf(s)
        val all = (s.items + s.undated).filter(::entryOpen)
        val cmp = compareChrono(day, hm, rules.overdueWindowDays)
        return Quadrant.entries.map { q ->
            val list = all.filter { quadrantOf(it, day, rules) == q }.sortedWith(cmp)
            QuadrantList(q, list.size, list.map { bar(it, day, hm, rules.overdueWindowDays) })
        }
    }

    // ── Rings and one-liners ──

    @Serializable data class Ring(val done: Int, val total: Int)

    /** Today's tasks done / all (status-less projects left out). */
    fun todayRing(s: CalGlance, nowMs: Long): Ring {
        val day = wibClock(nowMs).day
        val today = s.items.filter { it.day == day && !it.ns }
        return Ring(today.count { it.done }, today.size)
    }

    @Serializable data class Next(val day: String, val time: String?)
    @Serializable data class Inline(val openToday: Int, val next: Next?)

    /** "3 due today · next 19:00": open today (overdue included) and the first of [upcoming]. */
    fun inlineLine(s: CalGlance, nowMs: Long): Inline {
        val day = wibClock(nowMs).day
        val first = upcoming(s, nowMs, 1).rows.firstOrNull()
        return Inline(s.items.count { it.day == day && entryOpen(it) }, first?.let { Next(it.day!!, it.time) })
    }

    // ── Freshness and redraws ──

    @Serializable enum class Freshness { @SerialName("empty") EMPTY, @SerialName("none") NONE, @SerialName("off") OFF, @SerialName("stale") STALE, @SerialName("fresh") FRESH }

    /** EMPTY = nothing saved · NONE / OFF = no calendar for this account · STALE = > 2 days old or past the window. */
    fun freshness(s: CalGlance?, savedAtMs: Long, nowMs: Long): Freshness {
        if (s == null) return Freshness.EMPTY
        if (s.accessLevel == CalAccess.NONE) return Freshness.NONE
        if (s.accessLevel == CalAccess.OFF) return Freshness.OFF
        if (nowMs - savedAtMs > STALE_AFTER_MS) return Freshness.STALE
        val day = wibClock(nowMs).day
        if (s.to == null || day > s.to || (s.from != null && day < s.from)) return Freshness.STALE
        return Freshness.FRESH
    }

    /**
     * The moments after [nowMs] (within [horizonMs]) at which the picture changes on its own: each WIB
     * midnight, the minute after an open timed task's time, the moment the snapshot turns stale. Sorted, unique, ≤ 48.
     */
    fun redrawTimes(s: CalGlance, savedAtMs: Long, nowMs: Long, horizonMs: Long): List<Long> {
        val end = nowMs + horizonMs
        val out = sortedSetOf<Long>()
        var midnight = wibInstant(addDays(wibClock(nowMs).day, 1), "00:00")
        while (midnight <= end) { out += midnight; midnight += DAY_MS }
        for (e in s.items) {
            if (!entryOpen(e) || e.day == null || e.time == null) continue
            val at = wibInstant(e.day, e.time) + 60_000
            if (at > nowMs && at <= end) out += at
        }
        val stale = savedAtMs + STALE_AFTER_MS + 1
        if (stale > nowMs && stale <= end) out += stale
        return out.take(48)
    }
}
