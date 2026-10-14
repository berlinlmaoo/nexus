package id.znetworks.nexus.feature.calendar

import id.znetworks.nexus.core.config.ConfigBody
import id.znetworks.nexus.core.net.ApiClient
import id.znetworks.nexus.core.net.ApiError
import id.znetworks.nexus.core.net.ClientIdentity
import id.znetworks.nexus.core.net.NexusJson
import id.znetworks.nexus.core.session.Session
import kotlinx.coroutines.test.runTest
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Before
import org.junit.Test
import java.time.Instant
import kotlinx.serialization.builtins.serializer

/**
 * The Calendar's API + model layer against the server's golden files (handoff/calendar/golden =
 * nexus src/lib/calendar/fixtures/golden, 5 Oct 2026). The golden items are the `items` arrays; the
 * response envelopes around them follow SPEC-server.md.
 */
/** golden/project-divisions.json: project id → its division (and why). */
@kotlinx.serialization.Serializable private data class Pd(val unitId: String, val why: String? = null)

class CalendarApiTest {
    private fun res(name: String) = javaClass.classLoader!!.getResource("calendar/$name")!!.readText()

    private fun itemsBody(day: String, who: String, access: String) = """{"v":1,"tz":"Asia/Jakarta","today":"$day","now":"${day}T05:00:00.000Z",
        "from":"$day","to":"$day","access":"$access","structureVersion":"s1","rules":{"overdueWindowDays":14,"urgentDays":3},
        "items":${res("items-$day.$who.json")},"people":{},"holidays":[],"truncated":false}"""
    private fun items(day: String, who: String) = NexusJson.decodeFromString(CalItems.serializer(),
        itemsBody(day, who, if (who == "bod") "all" else "all_except_private"))
    private val structure by lazy {
        val s = res("structure.json").trim()
        NexusJson.decodeFromString(CalStructure.serializer(), """{"v":1,"version":"s1","access":"all","me":null,${s.substring(1)}""")
    }

    @Test fun structureParsesInBaganOrder() {
        assertEquals(26, structure.units.size); assertEquals(48, structure.people.size)
        assertEquals(CalAccess.ALL, structure.accessLevel)
        assertEquals("The Z Networks", structure.unitsByRank.first().name)
        assertEquals((0 until 26).toList(), structure.unitsByRank.map { it.rank })
        // A group is a ribbon: nobody's home is a group.
        val groups = structure.units.filter { it.isGroup }.map { it.id }.toSet()
        assertTrue(groups.isNotEmpty()); assertTrue(structure.people.none { p -> p.homeUnitIds.any { it in groups } })
    }

    @Test fun accessValues() {
        assertEquals(listOf(CalAccess.NONE, CalAccess.OFF, CalAccess.ALL, CalAccess.ALL_EXCEPT_PRIVATE, CalAccess.OFF),
            listOf("none", "off", "all", "all_except_private", "something-new").map(CalAccess::of))
        // none/off: empty arrays, no rules, no structure version.
        val off = NexusJson.decodeFromString(CalItems.serializer(), """{"v":1,"tz":"Asia/Jakarta","today":"2026-10-05","now":"2026-10-05T01:00:00.000Z",
            "from":"2026-10-01","to":"2026-10-31","access":"off","structureVersion":null,"rules":null,"items":[],"people":{},"holidays":[],"truncated":false}""")
        assertEquals(CalAccess.OFF, off.accessLevel); assertFalse(off.accessLevel.hasData); assertNull(off.structureVersion)
        assertEquals(14, off.rulesOrDefault.overdueWindowDays)
        val none = NexusJson.decodeFromString(CalStructure.serializer(), """{"v":1,"version":null,"access":"none","me":null,"units":[],"people":[]}""")
        assertEquals(CalAccess.NONE, none.accessLevel); assertTrue(none.units.isEmpty())
    }

    @Test fun staffSeeFinanceMaskedBodDoesNot() {
        val bod = items("2026-10-03", "bod"); val staff = items("2026-10-03", "staff")
        assertEquals(12, bod.items.size); assertEquals(12, staff.items.size)
        assertEquals(0, bod.items.count { it.masked })
        val masked = staff.items.filter { it.masked }
        assertEquals(4, masked.size)
        for (m in masked) {
            assertTrue(m.key.startsWith("x_")); assertNull(m.id); assertNull(m.title); assertNull(m.project); assertNull(m.priority); assertNull(m.parent)
            assertTrue(m.linkedProjectIds.isEmpty()); assertFalse(m.openable)
            // Who and when stay; it reads "Internal task · Finance & Tech".
            assertTrue(m.assigneeIds.isNotEmpty()); assertEquals("2026-10-03", m.day)
            assertEquals("Finance & Tech", structure.sectionOf(m.placements.first().unitId)?.name)
        }
        assertTrue(bod.items.all { it.openable })
    }

    @Test fun theDayIsTheServersNeverCutFromTheInstant() {
        val late = items("2026-10-03", "bod").items.filter { it.due?.startsWith("2026-10-02T17:00") == true }
        assertEquals(2, late.size)
        // 17:00Z on the 2nd is 00:00 WIB on the 3rd: take(10) of `due` would put them on the wrong day.
        assertTrue(late.all { it.day == "2026-10-03" && it.due!!.take(10) != it.day && it.time == null })
    }

    @Test fun signedOffFactsFor18Sep() {
        val day = items("2026-09-18", "bod").items
        assertEquals(8, day.size)
        // Per unique task, per section (never adding sub-sections up).
        fun inSection(name: String) = day.count { it.placements.any { p -> structure.sectionOf(p.unitId)?.name == name } }
        fun inUnit(name: String) = day.count { it.placements.any { p -> structure.unitById[p.unitId]?.name == name } }
        assertEquals(4, inSection("Framework Agency")); assertEquals(4, inSection("PATS")); assertEquals(1, inSection("Suwara"))
        assertEquals(1, inUnit("Project Management")); assertEquals(1, inUnit("Event")); assertEquals(3, inUnit("Multimedia"))
        // 3 of PATS' 4 are there through their project, in PATS Entertainment.
        val byProject = day.filter { it.placement == PlacedBy.PROJECT }
        assertEquals(3, byProject.size)
        assertTrue(byProject.all { it.placements.single().let { p -> structure.unitById[p.unitId]?.name == "PATS Entertainment" } })
        // Fortunatus is flagged as not in the chart.
        val fortunatus = "cmnr9lfd3000701rq5ev4pkfv"
        // A company member with no card in the Bagan.
        assertEquals(1, day.count { fortunatus in it.unplacedIds }); assertTrue(structure.personById.getValue(fortunatus).homeUnitIds.isEmpty())
        assertEquals(1, day.count { it.noStatus })
        assertEquals(items("2026-09-18", "bod").items.map { it.key }, items("2026-09-18", "staff").items.map { it.key })
    }

    @Test fun projectPlacedTasksSitUnderTheirProjectsDivision() {
        val divisions = NexusJson.decodeFromString(kotlinx.serialization.builtins.MapSerializer(String.serializer(), Pd.serializer()),
            res("project-divisions.json"))
        val all = listOf("2026-09-18", "2026-10-03").flatMap { d -> listOf("bod", "staff").flatMap { items(d, it).items } }
        val byProject = all.filter { it.placement == PlacedBy.PROJECT }
        assertTrue(byProject.isNotEmpty())
        for (it in byProject) {
            val project = it.project ?: continue // masked: no project to check against
            assertEquals(divisions.getValue(project.id).unitId, it.placements.single().unitId)
            // Its userIds are only PICs who are not in the Bagan (often none).
            assertTrue(it.placements.single().userIds.all { u -> structure.personById[u]?.homeUnitIds.isNullOrEmpty() })
        }
        // Every item says how it was placed, and every placement is a real card.
        assertTrue(all.all { i -> i.placements.all { structure.unitById.containsKey(it.unitId) } })
        assertEquals(PlacedBy.PIC, PlacedBy.of("something-new"))
    }

    @Test fun structureHasNoTitles() {
        assertTrue(!res("structure.json").contains("\"titles\""))
    }

    @Test fun sectionsOn3OctInBaganOrder() {
        val day = items("2026-10-03", "bod").items
        val sections = day.flatMap { it.placements }.mapNotNull { structure.sectionOf(it.unitId) }.distinctBy { it.id }.sortedBy { it.rank }.map { it.name }
        assertEquals(listOf("Finance & Tech", "Framework Agency", "PATS", "Suwara"), sections)
    }

    @Test fun overdueIsTheServersRule() {
        val now = Instant.parse("2026-10-05T03:00:00Z") // 10:00 WIB
        fun item(day: String, time: String? = null, due: String? = null, done: Boolean = false, ns: Boolean = false) =
            CalItem(key = "k", day = day, time = time, due = due, done = done, noStatus = ns)
        assertTrue(CalDays.isOverdue(item("2026-10-04"), "2026-10-05", now))
        assertFalse(CalDays.isOverdue(item("2026-10-05"), "2026-10-05", now))              // date-only today: not until the WIB day ends
        assertTrue(CalDays.isOverdue(item("2026-10-05", "09:00", "2026-10-05T02:00:00Z"), "2026-10-05", now))
        assertFalse(CalDays.isOverdue(item("2026-10-05", "11:00", "2026-10-05T04:00:00Z"), "2026-10-05", now))
        assertFalse(CalDays.isOverdue(item("2026-10-01", done = true), "2026-10-05", now))
        assertFalse(CalDays.isOverdue(item("2026-10-01", ns = true), "2026-10-05", now))
        assertEquals(31, CalDays.dayDiff("2026-09-04", "2026-10-05")); assertEquals("2026-11-01", CalDays.addDays("2026-10-31", 1))
        assertFalse(CalDays.isDayKey("2026-02-30")); assertTrue(CalDays.isDayKey("2026-10-05"))
    }

    @Test fun glanceParses() {
        val g = NexusJson.decodeFromString(CalGlance.serializer(), """{"v":1,"tz":"Asia/Jakarta","userId":"u","access":"all_except_private","scope":"me","requestedScope":"division",
            "today":"2026-10-05","now":"2026-10-05T01:00:00.000Z","from":"2026-09-21","to":"2026-11-29","rules":{"overdueWindowDays":14,"urgentDays":3},
            "items":[{"id":null,"k":"x_abc","t":null,"day":"2026-10-05","time":null,"c":"#0B6FB8","p":null,"prio":null,"done":false,"m":true},
                     {"id":"t1","t":"Shoot","day":"2026-10-06","time":"09:00","c":"#ec4899","p":"PATS","prio":"HIGH","done":false,"m":false,"ns":true}],
            "undated":[{"id":"t2","t":"Later","day":null,"time":null,"c":"#64748b","p":null,"prio":"MEDIUM","done":false,"m":false}],"holidays":[{"day":"2026-12-25","name":"Natal"}],"truncated":false}""")
        assertEquals("me", g.scope); assertEquals("division", g.requestedScope)
        assertTrue(g.items[0].m); assertEquals("x_abc", g.items[0].k); assertNull(g.items[0].t)
        assertTrue(g.items[1].ns); assertFalse(g.items[0].ns); assertNull(g.undated.single().day)
    }

    @Test fun remoteConfigCalendarDefaults() {
        assertTrue(ConfigBody().calendar); assertTrue(ConfigBody().calendarWidgets); assertEquals(60, ConfigBody().calendarPollSeconds)
        val c = NexusJson.decodeFromString(ConfigBody.serializer(), """{"flags":{"calendar":false},"values":{"calendarPollSeconds":120}}""")
        assertFalse(c.calendar); assertEquals(120, c.calendarPollSeconds)
    }

    // ── ETag / 304 over the wire ────────────────────────────────────────────────────────────────
    private lateinit var server: MockWebServer
    private lateinit var api: CalendarApi

    @Before fun up() {
        server = MockWebServer().apply { start() }
        api = CalendarApi(ApiClient(server.url("/"), ClientIdentity("0.1.6", 14, 36), { Session("t", "c", "u") }, mayCarrySession = { true }))
    }
    @After fun down() = server.close()

    @Test fun etagIsSentBackAnd304KeepsWhatWeHave() = runTest {
        val body = itemsBody("2026-10-03", "staff", "all_except_private")
        server.enqueue(MockResponse.Builder().code(200).addHeader("ETag", "\"abc\"").body(body).build())
        server.enqueue(MockResponse.Builder().code(304).addHeader("ETag", "\"abc\"").build())
        server.enqueue(MockResponse.Builder().code(200).addHeader("ETag", "\"def\"").body(body.replace("\"truncated\":false", "\"truncated\":true")).build())
        val first = api.items("2026-10-03", "2026-10-03")
        assertTrue(first.changed); assertEquals(12, first.value.items.size)
        val r1 = server.takeRequest()
        assertEquals("/api/calendar/items?from=2026-10-03&to=2026-10-03", r1.target); assertNull(r1.headers["If-None-Match"])
        val second = api.items("2026-10-03", "2026-10-03")
        assertFalse(second.changed); assertEquals(first.value, second.value)
        assertEquals("\"abc\"", server.takeRequest().headers["If-None-Match"])
        val third = api.items("2026-10-03", "2026-10-03")
        assertTrue(third.changed); assertTrue(third.value.truncated)
        assertEquals("\"abc\"", server.takeRequest().headers["If-None-Match"])
    }

    @Test fun rangeIsCheckedBeforeAskingAndServerCodesSurface() = runTest {
        try { api.items("2026-10-01", "2026-12-31"); fail() } catch (_: IllegalArgumentException) {}
        try { api.items("2026-10-05", "2026-10-01"); fail() } catch (_: IllegalArgumentException) {}
        try { api.items("2026-10-1", "2026-10-02"); fail() } catch (_: IllegalArgumentException) {}
        assertEquals(0, server.requestCount)
        server.enqueue(MockResponse.Builder().code(400).body("""{"error":"x","code":"RANGE_TOO_LONG"}""").build())
        try { api.items("2026-10-01", "2026-10-02"); fail() } catch (e: ApiError.Http) { assertEquals("RANGE_TOO_LONG", e.code) }
    }
}
