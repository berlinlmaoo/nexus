package id.znetworks.nexus.feature.calendar

import id.znetworks.nexus.core.net.NexusJson
import id.znetworks.nexus.feature.calendar.CalendarGlance.Overdue
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter

/**
 * CalendarGlance on the web's glance fixtures (one snapshot per scope) at the four moments of
 * glance.test.mjs, compared with its 16 golden-glance files — the files iOS is held to as well. Equal
 * values (key for key, in order), not equal bytes. The owner's signed-off rules are asserted on top.
 */
class CalendarGlanceTest {
    private fun res(name: String) = javaClass.classLoader!!.getResource("calendar/$name")!!.readText()
    private fun load(name: String) = NexusJson.decodeFromString(CalGlance.serializer(), res("glance/$name.json"))
    private val json = Json { encodeDefaults = true; explicitNulls = true }

    private val saved = Instant.parse("2026-10-05T04:00:00.000Z").toEpochMilli()
    private val nows = linkedMapOf(
        "mon-1200" to Instant.parse("2026-10-05T05:00:00.000Z").toEpochMilli(),
        "mon-2359" to Instant.parse("2026-10-05T16:59:00.000Z").toEpochMilli(),
        "tue-0000" to Instant.parse("2026-10-05T17:00:00.000Z").toEpochMilli(),
        "nov-0000" to Instant.parse("2026-10-31T17:00:00.000Z").toEpochMilli(),
    )
    private val horizon = 36 * 3_600_000L
    private val iso = DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'").withZone(ZoneOffset.UTC)

    private fun view(s: CalGlance, now: Long): JsonElement = buildJsonObject {
        val g = CalendarGlance
        put("freshness", json.encodeToJsonElement(CalendarGlance.Freshness.serializer(), g.freshness(s, saved, now)))
        val m = g.monthView(s, now, 2)
        put("month", buildJsonObject {
            put("month", m.month); put("today", m.today)
            put("year", json.encodeToJsonElement(CalendarGlance.YearProgress.serializer(), m.year))
            put("cells", JsonArray(m.cells.map { c ->
                JsonObject(json.encodeToJsonElement(CalendarGlance.DayBars.serializer(), c.bars).jsonObject + ("inMonth" to JsonPrimitive(c.inMonth)))
            }))
        })
        put("week", json.encodeToJsonElement(ListSerializer(CalendarGlance.DayBars.serializer()), g.weekView(s, now, 3)))
        put("upcoming", json.encodeToJsonElement(CalendarGlance.BarList.serializer(), g.upcoming(s, now, 4)))
        put("quadrants", json.encodeToJsonElement(ListSerializer(CalendarGlance.QuadrantList.serializer()), g.quadrants(s, now)))
        put("ring", json.encodeToJsonElement(CalendarGlance.Ring.serializer(), g.todayRing(s, now)))
        put("inline", json.encodeToJsonElement(CalendarGlance.Inline.serializer(), g.inlineLine(s, now)))
        put("year", json.encodeToJsonElement(CalendarGlance.YearProgress.serializer(), g.yearProgress(g.wibClock(now).day)))
        put("redraw", JsonArray(g.redrawTimes(s, saved, now, horizon).map { JsonPrimitive(iso.format(Instant.ofEpochMilli(it))) }))
    }

    /** Same values and the same key order everywhere. */
    private fun same(where: String, a: JsonElement, b: JsonElement) {
        when {
            a is JsonObject && b is JsonObject -> {
                assertEquals("$where keys", b.keys.toList(), a.keys.toList())
                a.keys.forEach { same("$where.$it", a[it]!!, b[it]!!) }
            }
            a is JsonArray && b is JsonArray -> {
                assertEquals("$where size", b.size, a.size)
                a.indices.forEach { same("$where[$it]", a[it], b[it]) }
            }
            else -> assertEquals(where, b, a)
        }
    }

    @Test fun matchesTheSixteenGoldenFiles() {
        var n = 0
        for (file in listOf("all", "division-fallback", "me", "none")) {
            val s = load(file)
            for ((name, now) in nows) {
                val golden = Json.parseToJsonElement(res("golden-glance/$file.$name.json"))
                same("$file.$name", view(s, now), golden)
                n++
            }
        }
        assertEquals(16, n)
    }

    private val me by lazy { load("me") }
    private val mon get() = nows.getValue("mon-1200")
    private fun keys(bars: List<CalendarGlance.Bar>) = bars.map { it.key }

    @Test fun timeHelpers() {
        val g = CalendarGlance
        assertEquals(CalendarGlance.Clock("2026-10-05", "12:00"), g.wibClock(mon))
        assertEquals(CalendarGlance.Clock("2026-10-06", "00:00"), g.wibClock(nows.getValue("tue-0000")))
        assertEquals(nows.getValue("tue-0000"), g.wibInstant("2026-10-06", "00:00"))
        assertEquals(CalendarGlance.YearProgress(278, 365, 76), g.yearProgress("2026-10-05"))
        assertEquals(CalendarGlance.YearProgress(365, 365, 100), g.yearProgress("2026-12-31"))
        assertEquals(CalendarGlance.YearProgress(60, 366, 16), g.yearProgress("2028-02-29"))
    }

    @Test fun monthGrid() {
        val m = CalendarGlance.monthView(me, mon, 2)
        assertEquals(42, m.cells.size)
        assertEquals("2026-09-28", m.cells[0].bars.day)
        val d8 = m.cells.first { it.bars.day == "2026-10-08" }.bars
        assertEquals(4, d8.count); assertEquals(2, d8.bars.size); assertEquals(2, d8.more)
        // Same time → title, lower-cased ("Cek" < "edit" < "Evaluasi").
        assertEquals(listOf("a13", "a14", "a12", "a11"), keys(CalendarGlance.weekView(me, mon, 9)[3].bars))
        assertTrue(m.cells.first { it.bars.day == "2026-10-04" }.bars.sunday)
        assertEquals("Cuti bersama (uji)", m.cells.first { it.bars.day == "2026-10-28" }.bars.holiday)
    }

    @Test fun overdueRules() {
        val g = CalendarGlance
        val today = g.weekView(me, mon, 9)[0]
        assertTrue(today.overdue)
        val m1 = today.bars.first { it.key == "x_m1" }
        assertEquals(Overdue.RECENT, m1.overdue); assertEquals(null, m1.id); assertEquals(null, m1.title)
        fun item(id: String) = me.items.first { it.id == id }
        assertEquals(Overdue.RECENT, g.entryOverdue(item("a01"), "2026-10-05", "12:00", 14))
        assertEquals(Overdue.STALE, g.entryOverdue(item("a01"), "2026-11-01", "00:00", 14))
        assertEquals(Overdue.NONE, g.entryOverdue(item("a05"), "2026-10-05", "19:00", 14))
        assertEquals(Overdue.RECENT, g.entryOverdue(item("a05"), "2026-10-05", "19:01", 14))
        assertEquals(Overdue.NONE, g.entryOverdue(item("a09"), "2026-10-20", "00:00", 14))
        assertEquals(Overdue.NONE, g.entryOverdue(item("a03"), "2026-10-20", "00:00", 14))
    }

    @Test fun tickOnlyForDoneNotForCalendarOnlyProjects() {
        val bars = CalendarGlance.monthView(me, mon, 9).cells.flatMap { it.bars.bars }
        val a03 = bars.first { it.key == "a03" } // done
        assertTrue(a03.dim); assertTrue(a03.done)
        val a09 = bars.first { it.key == "a09" } // status-less project: faded, no ✓
        assertTrue(a09.dim); assertFalse(a09.done)
    }

    @Test fun comingUp() {
        assertEquals(listOf("a05", "a06", "a08", "a10"), keys(CalendarGlance.upcoming(me, mon, 4).rows))
        assertEquals(listOf("a06", "a08"), keys(CalendarGlance.upcoming(me, nows.getValue("mon-2359"), 2).rows))
        assertEquals(listOf("a08"), keys(CalendarGlance.upcoming(me, nows.getValue("tue-0000"), 1).rows))
    }

    @Test fun fourListsHoldEveryOpenTaskOnce() {
        val q = CalendarGlance.quadrants(me, mon).associate { it.quadrant to keys(it.rows) }
        assertEquals(listOf("a01", "a02", "x_m1", "a08", "a11", "x_m2"), q[CalendarGlance.Quadrant.DO])
        assertEquals(listOf("a15", "a17", "a20", "u1"), q[CalendarGlance.Quadrant.PLAN])
        assertEquals(listOf("a05", "a06"), q[CalendarGlance.Quadrant.ACT])
        assertTrue(q.getValue(CalendarGlance.Quadrant.LATER).containsAll(listOf("a10", "u2")))
        val all = q.values.flatten()
        assertEquals(all.size, all.toSet().size)
        assertEquals((me.items + me.undated).count(CalendarGlance::entryOpen), all.size)
    }

    @Test fun ringInlineFreshnessRedraw() {
        val g = CalendarGlance
        assertEquals(CalendarGlance.Ring(1, 4), g.todayRing(me, mon))
        assertEquals(CalendarGlance.Inline(3, CalendarGlance.Next("2026-10-05", "19:00")), g.inlineLine(me, mon))
        assertEquals(CalendarGlance.Inline(1, CalendarGlance.Next("2026-10-06", "08:30")), g.inlineLine(me, nows.getValue("tue-0000")))
        assertEquals(CalendarGlance.Freshness.FRESH, g.freshness(me, saved, mon))
        assertEquals(CalendarGlance.Freshness.STALE, g.freshness(me, saved, saved + CalendarGlance.STALE_AFTER_MS + 1))
        assertEquals(CalendarGlance.Freshness.EMPTY, g.freshness(null, saved, mon))
        assertEquals(CalendarGlance.Freshness.NONE, g.freshness(load("none"), saved, mon))
        val r = g.redrawTimes(me, saved, mon, horizon).map { iso.format(Instant.ofEpochMilli(it)) }
        assertTrue(r.containsAll(listOf("2026-10-05T12:01:00.000Z", "2026-10-05T17:00:00.000Z", "2026-10-06T01:31:00.000Z")))
        assertFalse("2026-10-05T03:01:00.000Z" in r)
    }
}
