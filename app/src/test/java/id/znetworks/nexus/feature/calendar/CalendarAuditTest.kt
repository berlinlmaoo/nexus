package id.znetworks.nexus.feature.calendar

import id.znetworks.nexus.core.net.NexusJson
import kotlinx.serialization.builtins.ListSerializer
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.nio.file.Files

/**
 * The Calendar screen's own logic after the "impeccable" audit (6 Oct): the disk cache (#21), the flat
 * day panel (#19) with the viewer first (#33), collapsed cards, and the notices (P1). On the server
 * golden files at 5 Oct 2026 12:00 WIB.
 */
class CalendarAuditTest {
    private fun res(name: String) = javaClass.classLoader!!.getResource("calendar/$name")!!.readText()
    private val structure0 = NexusJson.decodeFromString(CalStructure.serializer(), res("structure.json"))
    private fun items(file: String) = NexusJson.decodeFromString(ListSerializer(CalItem.serializer()), res(file))
    private fun state(day: String, file: String, me: CalMe? = null, lens: CalLens = CalLens.DIVISION, collapsed: Set<String> = emptySet()): CalState {
        val items = CalItems(today = "2026-10-05", now = "2026-10-05T05:00:00.000Z", items = items(file))
        val range = CalendarCore.gridRange(day)
        return CalState(structure = structure0.copy(me = me), items = items, day = day, itemsRange = range, lens = lens, collapsed = collapsed, loading = false)
    }
    private fun day(s: CalState): CalDay {
        val index = CalIndex(s.structure!!, dark = false)
        return CalDay(CalData(index, s), s.day, s.lens, s.collapsed)
    }

    @Test fun diskCacheIsPerUserAndPerRange() {
        val dir = Files.createTempDirectory("calcache").toFile()
        val cache = CalendarDiskCache(dir)
        val s = state("2026-09-18", "items-2026-09-18.bod.json")
        cache.saveStructure("u1", structure0, now = 42)
        cache.saveItems("u1", s.range, s.items!!, now = 43)
        assertEquals(42L, cache.structure("u1")?.savedAt)
        assertEquals(s.items!!.items.size, cache.items("u1", s.range)?.value?.items?.size)
        assertNull(cache.structure("u2"))
        assertNull(cache.items("u1", "2026-01-01" to "2026-01-31"))
        // Only the last 6 ranges stay.
        repeat(8) { k -> cache.saveItems("u1", "2026-0${k + 1}-01" to "2026-0${k + 1}-28", s.items!!, now = 50L + k); Thread.sleep(5) }
        assertTrue(File(dir, "u1").listFiles()!!.count { it.name.startsWith("items-") } <= 6)
    }

    @Test fun dayPanelIsFlatWithUniqueKeys() {
        val d = day(state("2026-09-18", "items-2026-09-18.bod.json"))
        assertTrue(d.rows.isNotEmpty())
        assertEquals(d.rows.size, d.rows.map { it.key }.toSet().size)
        // Every card opens with a header and closes with an end piece.
        assertEquals(d.rows.count { it is PanelRow.Card }, d.rows.count { it is PanelRow.End })
        assertTrue(d.rows.first() is PanelRow.Card)
        // Every task of the day is a row of its own.
        assertTrue(d.rows.count { it is PanelRow.Task } >= d.tree.total)
    }

    @Test fun collapsedCardIsHeaderAndEndOnly() {
        val open = day(state("2026-09-18", "items-2026-09-18.bod.json"))
        val first = (open.rows.first() as PanelRow.Card).node.unit.id
        val shut = day(state("2026-09-18", "items-2026-09-18.bod.json", collapsed = setOf(first)))
        val i = shut.rows.indexOfFirst { it is PanelRow.Card }
        assertTrue((shut.rows[i] as PanelRow.Card).collapsed)
        assertTrue(shut.rows[i + 1] is PanelRow.End)
        assertTrue(shut.rows.size < open.rows.size)
    }

    @Test fun theViewerComesFirstInTheirCard() {
        val base = day(state("2026-09-18", "items-2026-09-18.bod.json", lens = CalLens.PERSON))
        // Take a card with at least two people and make its last person the viewer.
        val persons = base.rows.filterIsInstance<PanelRow.Person>().groupBy { it.cardUnit to it.unitId }.values.first { it.size >= 2 }
        val viewer = persons.last().userId
        val mine = day(state("2026-09-18", "items-2026-09-18.bod.json", me = CalMe(viewer), lens = CalLens.PERSON))
        val same = mine.rows.filterIsInstance<PanelRow.Person>().filter { it.cardUnit == persons.first().cardUnit && it.unitId == persons.first().unitId }
        assertEquals(viewer, same.first().userId)
        assertTrue(same.first().me)
        assertFalse(same.drop(1).any { it.me })
    }

    @Test fun noticesOnlyForTheLoadedRange() {
        val s = state("2026-09-18", "items-2026-09-18.bod.json")
        val data = CalData(CalIndex(s.structure!!, false), s)
        assertFalse("rangestatus" in noticeKeys(data))
        val other = s.copy(day = "2026-11-10")
        assertEquals(listOf("rangestatus"), noticeKeys(CalData(CalIndex(other.structure!!, false), other)))
        // An empty month is only said for a month that was loaded.
        val empty = s.copy(items = s.items!!.copy(items = emptyList()))
        assertTrue("emptymonth" in noticeKeys(CalData(CalIndex(empty.structure!!, false), empty)))
        assertNotNull(empty.items)
    }

    // ── Round 2, the cross-platform contract (AUDIT2-CONTRACT.md) ──

    private val root = generateSequence(File("").absoluteFile) { it.parentFile }.first { File(it, "app/src/main").isDirectory }
    private fun strings(dir: String) = File(root, "app/src/main/res/$dir/strings.xml").readText()

    @Test fun scopeIsAViewNotAFilter() {
        val s = state("2026-09-18", "items-2026-09-18.bod.json")
        val mine = s.copy(filters = CalendarCore.NO_FILTERS.copy(scope = CalendarCore.Scope.ME))
        assertEquals(0, CalData(CalIndex(mine.structure!!, false), mine).filterCount)
        val both = s.copy(filters = CalendarCore.NO_FILTERS.copy(scope = CalendarCore.Scope.ME, hideDone = true))
        assertEquals(1, CalData(CalIndex(both.structure!!, false), both).filterCount)
        // The Filters screen does not show the scope a second time; Reset goes through resetFilters (keeps it).
        val filters = File(root, "app/src/main/java/id/znetworks/nexus/feature/calendar/CalendarFilters.kt").readText()
        assertFalse("cal_everyone" in filters)
        assertTrue("vm.resetFilters()" in filters)
        assertFalse(File(root, "app/src/main/java/id/znetworks/nexus/feature/calendar").listFiles()!!.filter { it.isFile }.any { "NO_FILTERS)" in it.readText() && it.name != "CalendarViewModel.kt" })
    }

    @Test fun focusNotZoom() {
        for (dir in listOf("values", "values-in")) {
            val cal = Regex("""<(string|plurals) name="(w?cal_[a-z_0-9]+)"[^>]*>(.*?)</\1>""", RegexOption.DOT_MATCHES_ALL).findAll(strings(dir)).toList()
            cal.forEach { m -> assertFalse("${m.groupValues[2]} in $dir", Regex("(?i)zoom|perbesar").containsMatchIn(m.groupValues[3])) }
            val names = cal.map { it.groupValues[2] }
            assertEquals("no duplicate keys in $dir", names.size, names.toSet().size)
            assertTrue("cal_all_divisions" in names && "cal_focus_on" in names && "cal_focus_on_n" in names)
            assertFalse("cal_zoom_into" in names || "cal_all" in names)
        }
        assertTrue("Focus on %1\$s" in strings("values") && "Fokus ke %1\$s" in strings("values-in"))
        assertTrue(">All divisions<" in strings("values") && ">Semua divisi<" in strings("values-in"))
        assertTrue("A name with the focus icon focuses the calendar on that division; any other name filters it." in strings("values"))
        assertTrue("Nama berikon fokus memfokuskan kalender ke divisi itu; nama lain memfilternya." in strings("values-in"))
    }

    @Test fun maskedRunsBecomeOneRow() {
        // 3 Oct, staff: Finance & Tech holds four internal tasks in a row (cal-month-light-2.png).
        val d = day(state("2026-10-03", "items-2026-10-03.staff.json"))
        val groups = d.rows.filterIsInstance<PanelRow.MaskedGroup>()
        assertTrue(groups.isNotEmpty())
        assertTrue(groups.all { g -> g.items.size >= 2 && g.items.all { it.masked } })
        // No masked task is lost or shown twice.
        val masked = d.dayItems.count { it.masked }
        val shown = groups.sumOf { it.items.size } + d.rows.filterIsInstance<PanelRow.Task>().count { it.item.masked }
        assertTrue(shown >= masked)
        assertEquals(d.rows.size, d.rows.map { it.key }.toSet().size)
    }

    @Test fun peopleHeadersOnlyWherePeopleAre() {
        val s = state("2026-09-18", "items-2026-09-18.bod.json")
        val data = CalData(CalIndex(s.structure!!, false), s)
        val rows = CalendarCore.weekRows(data.shown, data.ix, data.focus, CalendarCore.mondayOf(s.day), s.today, s.nowMs, s.windowDays)
        val visible = visibleRows(rows)
        assertTrue(visible.size < rows.size)
        visible.forEachIndexed { i, r ->
            if (r is CalendarCore.WeekRow.Unit) assertTrue(visible.getOrNull(i + 1).let { it is CalendarCore.WeekRow.Person || it is CalendarCore.WeekRow.Loose })
        }
        // Every person row is kept.
        assertEquals(rows.count { it is CalendarCore.WeekRow.Person }, visible.count { it is CalendarCore.WeekRow.Person })
    }

    @Test fun monthMarksFollowRule1031() {
        // Berlin, 8 Oct: full dot = still to do; small check in the division colour = all done / no status. No rings.
        val screen = File(root, "app/src/main/java/id/znetworks/nexus/feature/calendar/CalendarScreen.kt").readText()
        assertTrue("if (dot.filled) Box(Modifier.size(6.dp).clip(CircleShape).background(col))" in screen)
        assertTrue("else Icon(Icons.Filled.Check, null, tint = col" in screen)
        assertFalse("border(1.dp, col, CircleShape)" in screen)
        assertFalse("border(1.dp, c.foreground, CircleShape)); Text(\" \" + stringResource(R.string.cal_legend_done)" in screen)
        val widget = File(root, "app/src/main/java/id/znetworks/nexus/feature/calendar/widget/CalendarWidgets.kt").readText()
        assertTrue("Dot(hue(it.color, faded), done = it.dim)" in widget && "R.drawable.ic_cal_check" in widget)
    }
}
