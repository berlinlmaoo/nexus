package id.znetworks.nexus.feature.calendar

import id.znetworks.nexus.core.net.NexusJson
import id.znetworks.nexus.feature.calendar.CalendarCore.Overdue
import id.znetworks.nexus.feature.calendar.CalendarCore.WeekRow
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant

/**
 * CalendarCore on the SERVER golden (18 Sep + 3 Oct 2026, BoD and staff) at the fixed now 5 Oct 2026
 * 12:00 WIB, compared with the web's golden-client files (client/core.test.mjs builds them the same way:
 * cell, legend, tree in brief form, week rows, overdue per item). Equal values, not equal bytes.
 * The owner's signed-off numbers (plan A2, A3, A5) are asserted on top, as in core.test.mjs.
 */
class CalendarCoreTest {
    private fun res(name: String) = javaClass.classLoader!!.getResource("calendar/$name")!!.readText()
    private val structure = NexusJson.decodeFromString(CalStructure.serializer(), res("structure.json"))
    private val ix = CalendarCore.indexStructure(structure.units, structure.people)
    private fun unit(name: String) = structure.units.first { it.name == name }
    private fun person(name: String) = structure.people.first { it.name == name }
    private val now = Instant.parse("2026-10-05T05:00:00.000Z").toEpochMilli()
    private val today = "2026-10-05"
    private val window = 14
    private fun items(day: String, who: String) = NexusJson.decodeFromString(ListSerializer(CalItem.serializer()), res("items-$day.$who.json"))

    private fun brief(n: CalendarCore.TreeNode?): JsonElement = if (n == null) JsonNull else buildJsonObject {
        put("unit", n.unit.name); put("count", n.count)
        put("items", JsonArray(n.items.map { JsonPrimitive(it.key) }))
        put("loose", JsonArray(n.loose.map { JsonPrimitive(it.key) }))
        put("people", JsonArray(n.people.map { p -> buildJsonObject { put("userId", p.userId); put("items", JsonArray(p.items.map { JsonPrimitive(it.key) })) } }))
        put("children", JsonArray(n.children.map(::brief)))
    }
    private fun keys(list: List<CalItem>) = JsonArray(list.map { JsonPrimitive(it.key) })

    private fun goldenOf(day: String, who: String, focusId: String): JsonObject {
        val all = items(day, who)
        val shown = CalendarCore.underFocus(all, ix, focusId)
        val tree = CalendarCore.dayTree(shown, ix, focusId, today, now, window)
        val cell = CalendarCore.dayCell(day, shown, ix, focusId, today, now, window)
        return buildJsonObject {
            put("cell", buildJsonObject {
                put("day", cell.day); put("count", cell.count)
                put("dots", JsonArray(cell.dots.map { d -> buildJsonObject { put("unitId", d.unitId); put("filled", d.filled); put("count", d.count) } }))
                put("overdue", cell.overdue)
            })
            put("legend", JsonArray(CalendarCore.legend(shown, ix, focusId).map { l -> buildJsonObject { put("unitId", l.unitId); put("count", l.count) } }))
            put("tree", buildJsonObject {
                put("total", tree.total); put("people", tree.people)
                put("unplaced", JsonArray(tree.unplaced.map { p -> buildJsonObject { put("userId", p.userId); put("items", keys(p.items)) } }))
                put("root", brief(tree.root))
            })
            put("week", buildJsonArray {
                for (r in CalendarCore.weekRows(shown, ix, focusId, CalendarCore.mondayOf(day), today, now, window)) add(when (r) {
                    is WeekRow.Unit -> buildJsonObject { put("kind", "unit"); put("unit", r.unit.name); put("depth", r.depth); put("count", r.count) }
                    is WeekRow.Unplaced -> buildJsonObject { put("kind", "unplaced"); put("depth", r.depth); put("count", r.count) }
                    is WeekRow.Person -> buildJsonObject { put("kind", "person"); put("unitId", r.unitId); put("userId", r.userId); put("depth", r.depth); put("days", JsonArray(r.days.map(::keys))) }
                    is WeekRow.Loose -> buildJsonObject { put("kind", "loose"); put("unitId", r.unitId); put("userId", JsonNull); put("depth", r.depth); put("days", JsonArray(r.days.map(::keys))) }
                })
            })
            put("overdue", buildJsonObject { all.forEach { put(it.key, CalendarCore.overdueState(it, today, now, window).name.lowercase()) } })
        }
    }

    private fun focuses() = listOf("top" to ix.top!!.id, "fa" to unit("Framework Agency").id, "pats" to unit("PATS").id)

    @Test fun matchesTheWebGoldenClientFiles() {
        var n = 0
        for (day in listOf("2026-09-18", "2026-10-03")) for (who in listOf("bod", "staff")) for ((fname, fid) in focuses()) {
            val file = "$day.$who.$fname.json"
            val want = NexusJson.parseToJsonElement(res("golden-client/$file"))
            assertEquals(file, want, goldenOf(day, who, fid))
            n++
        }
        assertEquals(12, n)
    }

    @Test fun a2EighteenSeptemberCompany() {
        val cell = CalendarCore.dayCell("2026-09-18", items("2026-09-18", "bod"), ix, ix.top!!.id, today, now, window)
        assertEquals(8, cell.count)
        assertEquals(listOf("Framework Agency" to 4, "PATS" to 4, "Suwara" to 1), cell.dots.map { ix.byId.getValue(it.unitId).name to it.count })
        assertEquals(8, CalendarCore.dayTree(items("2026-09-18", "bod"), ix, ix.top!!.id, today, now, window).total)
    }

    @Test fun a2ZoomedIntoFrameworkAgency() {
        val fa = unit("Framework Agency").id
        val shown = CalendarCore.underFocus(items("2026-09-18", "bod"), ix, fa)
        val cell = CalendarCore.dayCell("2026-09-18", shown, ix, fa, today, now, window)
        assertEquals(listOf("Project Management" to 1, "Creative" to 1, "Multimedia" to 3), cell.dots.map { ix.byId.getValue(it.unitId).name to it.count })
        val creative = CalendarCore.dayTree(shown, ix, fa, today, now, window).root!!.children.first { it.unit.name == "Creative" }
        assertEquals("Event", creative.children.first().unit.name)
    }

    @Test fun a3SectionsOn3Oct() {
        val tree = CalendarCore.dayTree(items("2026-10-03", "bod"), ix, ix.top!!.id, today, now, window)
        assertEquals(listOf("Finance & Tech", "Framework Agency", "PATS", "Suwara"), tree.root!!.children.map { it.unit.name })
    }

    @Test fun a5ByPerson() {
        val fa = unit("Framework Agency").id
        val tree = CalendarCore.dayTree(CalendarCore.underFocus(items("2026-09-18", "bod"), ix, fa), ix, fa, today, now, window)
        val pm = tree.root!!.children.first { it.unit.name == "Project Management" }
        assertEquals(listOf(person("Person 14").userId), pm.people.map { it.userId })
        val mm = tree.root.children.first { it.unit.name == "Multimedia" }
        assertEquals(2, mm.people.first { it.userId == person("Person 19").userId }.items.size)
    }

    @Test fun unplacedRowsAtTheEndOfTheWeek() {
        val all = items("2026-09-18", "bod")
        val rows = CalendarCore.weekRows(all, ix, ix.top!!.id, CalendarCore.mondayOf("2026-09-18"), today, now, window)
        val tree = CalendarCore.dayTree(all, ix, ix.top.id, today, now, window)
        val at = rows.indexOfFirst { it is WeekRow.Unplaced }
        assertTrue(at > 0); assertEquals(tree.unplaced.size, (rows[at] as WeekRow.Unplaced).count)
        assertEquals(tree.unplaced.map { it.userId }, rows.drop(at + 1).map { (it as WeekRow.Person).userId })
    }

    @Test fun noPicGoesToTheProjectsDivisionWithoutAPerson() {
        val pats = unit("PATS").id
        val tree = CalendarCore.dayTree(CalendarCore.underFocus(items("2026-09-18", "bod"), ix, pats), ix, pats, today, now, window)
        val ent = tree.root!!.children.first { it.unit.name == "PATS Entertainment" }
        assertEquals(3, ent.loose.size); assertEquals(0, ent.people.size)
    }

    @Test fun overdueWindow() {
        val open = items("2026-09-18", "bod").first { !it.done && !it.noStatus }
        assertEquals(Overdue.STALE, CalendarCore.overdueState(open, today, now, window)) // 17 days ago
        assertEquals(Overdue.RECENT, CalendarCore.overdueState(open, "2026-09-25", Instant.parse("2026-09-25T05:00:00Z").toEpochMilli(), window))
        assertEquals(Overdue.NONE, CalendarCore.overdueState(open.copy(done = true), today, now, window))
        assertEquals(Overdue.NONE, CalendarCore.overdueState(open.copy(noStatus = true), today, now, window))
        val timed = open.copy(day = today, time = "10:00", due = "2026-10-05T03:00:00.000Z")
        assertEquals(Overdue.RECENT, CalendarCore.overdueState(timed, today, now, window)) // 10:00 WIB passed at 12:00
        assertEquals(Overdue.NONE, CalendarCore.overdueState(timed.copy(time = null, due = "2026-10-05T00:00:00.000Z"), today, now, window))
    }

    @Test fun filters() {
        val all = items("2026-09-18", "bod")
        val viewer = person("Person 19")
        val ctx = CalendarCore.FilterContext(ix, viewer.userId, viewer.homeUnitIds, today, now, window)
        fun f(x: CalendarCore.Filters) = CalendarCore.filterItems(all, x, ctx).size
        val none = CalendarCore.NO_FILTERS
        assertEquals(8, f(none))
        assertEquals(2, f(none.copy(scope = CalendarCore.Scope.ME)))
        assertEquals(3, f(none.copy(scope = CalendarCore.Scope.DIVISION))) // Multimedia
        assertEquals(4, f(none.copy(units = listOf(unit("PATS").id))))
        assertEquals(all.count { !it.done }, f(none.copy(hideDone = true)))
        assertEquals(3, CalendarCore.activeFilterCount(none.copy(scope = CalendarCore.Scope.ME, units = listOf("x"), hideDone = true)))
    }

    @Test fun monthGrid() {
        val g = CalendarCore.monthGrid("2026-10-18")
        assertEquals(42, g.size); assertEquals("2026-09-28", g[0]); assertEquals("2026-11-08", g[41])
        assertEquals("2026-02-28", CalendarCore.shiftMonth("2026-01-31", 1))
        assertEquals("2027-01-15", CalendarCore.shiftMonth("2026-12-15", 1))
        assertEquals("2026-09-28" to "2026-11-08", CalendarCore.gridRange("2026-10-05"))
    }

    @Test fun overdueRailNewestFirstWithinTheWindow() {
        val stale = items("2026-09-18", "bod").first { !it.done && !it.noStatus }
        val recent = stale.copy(key = "r1", day = "2026-10-01", due = "2026-10-01T00:00:00.000Z")
        val todayPassed = stale.copy(key = "t1", day = today, time = "10:00", due = "2026-10-05T03:00:00.000Z")
        val rail = CalendarCore.overdueRail(listOf(stale, recent), listOf(todayPassed, recent), today, now, window)
        assertEquals(listOf("t1", "r1"), rail.map { it.key })
    }

    @Test fun itemsInNoDivisionCountAtTheTop() {
        // Dev server 14 Oct: two tasks of QA people outside the Bagan made the web say 7 tasks and Android 5 (web core.ts `nowhere`).
        val base = items("2026-09-18", "bod")
        val nowhere = base.first().copy(key = "nowhere-1", placements = emptyList())
        val withIt = base + nowhere
        assertEquals(CalendarCore.dayTree(base, ix, ix.top!!.id, today, now, window).total + 1, CalendarCore.dayTree(withIt, ix, ix.top!!.id, today, now, window).total)
        val fa = unit("Framework Agency").id
        assertEquals(CalendarCore.dayTree(base, ix, fa, today, now, window).total, CalendarCore.dayTree(withIt, ix, fa, today, now, window).total)
    }
}
