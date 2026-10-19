package id.znetworks.nexus.feature.outlet

import id.znetworks.nexus.core.net.NexusJson
import id.znetworks.nexus.core.realtime.RealtimeEvents
import id.znetworks.nexus.feature.projects.ProjectTab
import id.znetworks.nexus.feature.projects.ProjectTabsLogic
import id.znetworks.nexus.feature.projects.ProjectType
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.YearMonth

/** OUTLET-SALES.md (owner, 10 Oct 2026): the outlet team's formats, the server's wire, the form draft, the project's tabs. */
class OutletSalesTest {
    private fun month(json: String) = OutletMonth(NexusJson.parseToJsonElement(json).jsonObject)
    private fun event(json: String) = OutletEvent(NexusJson.parseToJsonElement(json).jsonObject)

    @Test fun ryansShapes() {
        assertEquals("Rp8.000.000 / Rp20.000.000 (40%)", OutletFormat.vsTarget(8_000_000.0, 20_000_000.0, money = true, id = true))
        assertEquals("Rp8,000,000 / Rp20,000,000 (40%)", OutletFormat.vsTarget(8_000_000.0, 20_000_000.0, money = true, id = false))
        assertEquals("50 / 200 (25%)", OutletFormat.vsTarget(50.0, 200.0, money = false, id = true))
        assertEquals("Rp3.200.000", OutletFormat.vsTarget(3_200_000.0, null, money = true, id = true))
        assertEquals("— / Rp20.000.000", OutletFormat.vsTarget(null, 20_000_000.0, money = true, id = true))
        assertEquals("3.000", OutletFormat.count(3000.0, id = true)); assertEquals("—", OutletFormat.count(null))
        // Rounded down: Rp1 short never shows 100 %; above 100 is fine; no target → none.
        assertEquals(99, OutletFormat.pct(1_999_999.0, 2_000_000.0)); assertEquals(150, OutletFormat.pct(3.0, 2.0)); assertNull(OutletFormat.pct(5.0, 0.0))
        // Money beyond Int32.
        assertEquals("Rp3.000.000.000", OutletFormat.money(3e9, id = true))
    }

    @Test fun days() {
        assertEquals("Minggu, 4 Oktober", OutletFormat.longDay("2026-10-04", 2026, id = true))
        assertEquals("Sunday, 4 October", OutletFormat.longDay("2026-10-04", 2026, id = false))
        assertEquals("Sabtu, 4 Oktober 2025", OutletFormat.longDay("2025-10-04", 2026, id = true))
        assertEquals("Min, 4 Okt", OutletFormat.shortDay("2026-10-04", 2026, id = true))
        assertEquals("Sun, 4 Oct", OutletFormat.shortDay("2026-10-04", 2026, id = false))
        assertEquals("Oktober 2026", OutletFormat.monthLabel("2026-10", id = true))
        assertEquals("5 Okt, 23.30", OutletFormat.stamp("2026-10-05T16:30:00.000Z", id = true))
        val g = OutletFormat.grid(YearMonth.of(2026, 10))
        assertEquals(42, g.size); assertEquals("2026-09-28", g.first().toString())   // Monday first, 6 weeks
    }

    @Test fun wire() {
        val m = month("""{"canManageTargets":true,"month":"2026-10","today":"2026-10-10","target":null,
            "summary":{"sales":29700000,"pax":254,"salesTarget":null,"salesPct":null,"eventCount":2,"waitingCount":1},
            "events":[{"id":"a","date":"2026-10-04","name":"Noxva","sales":8000000,"pax":null,"status":"WAITING_REPORT","missing":["pax"]},
                      {"id":"b","date":"2026-10-12","name":"Ladies Night","status":"UPCOMING","missing":["sales","pax"]}],
            "waitingEarlier":[{"id":"z","date":"2026-09-20","name":"Old","status":"WAITING_REPORT","missing":["sales","pax"]}]}""")
        assertTrue(m.canManageTargets); assertNull(m.target); assertNull(m.summary.salesPct)
        assertEquals(listOf("z", "a"), m.allWaiting.map { it.id })                       // oldest first, older months too
        assertEquals(listOf("pax"), m.events[0].missing); assertNull(m.events[0].pax)
        assertEquals(OutletForm.DEFAULT, m.form)                                          // no form sent → the built-in v1
        assertEquals(listOf("event", "sales", "pax", "rsvp", "hosting", "success", "fail"), m.form.sections.map { it.key })
        assertEquals("rsvpTotal", m.form.sections[3].total)
        assertEquals("Gimana biar tidak kejadian lagi", m.form.field("failPrevent")!!.label.pick(true))
    }

    @Test fun draftSendsOnlyChanges() {
        val form = OutletForm.DEFAULT
        val e = event("""{"id":"a","date":"2026-10-04","name":"Noxva","sales":8000000,"pax":50,"rsvpTeam":20,"successWhat":"Lighting"}""")
        val orig = OutletDraft.of(e, form, "2026-10-10")
        assertEquals("8.000.000".takeIf { OutletFormat.isId() } ?: OutletFormat.box(8_000_000.0), orig["sales"])
        val edited = orig + ("pax" to "60") + ("rsvpTeam" to "") + ("failWhat" to " Rain ")
        val ch = OutletDraft.changes(form, orig, edited)
        assertEquals(setOf("pax", "rsvpTeam", "failWhat"), ch.keys)
        assertEquals(JsonPrimitive(60L), ch["pax"]); assertEquals(JsonNull, ch["rsvpTeam"]); assertEquals(JsonPrimitive("Rain"), ch["failWhat"])
        assertTrue(OutletDraft.changes(form, orig, orig).isEmpty())
        // New: the date pre-filled, empty boxes left out.
        val fresh = OutletDraft.of(null, form, "2026-10-12") + ("name" to "Ladies Night")
        assertEquals(setOf("name", "date"), OutletDraft.all(form, fresh).keys)
        assertEquals(35.0, OutletFormat.total(listOf(10.0, 20.0, 5.0, null))); assertNull(OutletFormat.total(listOf(null, null)))
        assertEquals(8_000_000.0, OutletFormat.parseNumber("Rp8.000.000"))
    }

    @Test fun projectTypeAndTabs() {
        assertEquals(listOf("TASK", "OUTLET_SALES", "SOCIAL_MEDIA_REPORT", "CONTENT", "PIPELINE"), ProjectType.entries.map { it.code })
        assertTrue(ProjectType.OUTLET_SALES.ready)
        val tabs = ProjectTabsLogic.visible(emptySet(), isOutlet = true)
        assertEquals(listOf(ProjectTab.OUTLET_OVERVIEW, ProjectTab.OUTLET_CALENDAR, ProjectTab.OUTLET_BOARD, ProjectTab.OUTLET_FORM, ProjectTab.CHAT), tabs)
        assertEquals(ProjectTab.OUTLET_OVERVIEW, ProjectTabsLogic.fallback(ProjectTab.BOARD, tabs))
        assertFalse(ProjectTabsLogic.visible(emptySet()).any { it.name.startsWith("OUTLET") })
        val e = RealtimeEvents.parse(RealtimeEvents.OUTLET_SALES_CHANGED, """{"projectId":"p","eventId":null,"month":"2026-10","actorId":"u"}""")
        assertEquals("p", e.projectId); assertTrue(RealtimeEvents.OUTLET_SALES_CHANGED in RealtimeEvents.LISTENED)
    }
}
