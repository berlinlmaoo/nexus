package id.znetworks.nexus.feature.admin

import id.znetworks.nexus.core.net.NexusJson
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class FakeGpsTest {
    private val list = NexusJson.decodeFromString(SuspectList.serializer(), """{"periodKey":"2026-09","periodLabel":"28 Aug – 27 Sep","currentPeriodKey":"2026-09",
        "counts":{"fakeOpen":1,"checkOpen":1,"valid":1,"invalid":0},
        "items":[
          {"recordId":"a","date":"2026-09-20","state":"open","level":"FAKE","user":{"id":"u1","name":"Ana"},"place":"HQ",
           "checkIn":{"at":"2026-09-20T01:00:00Z","lat":-6.2,"lng":106.8,"accuracyM":5,"simulated":true,"level":"FAKE","signals":["The phone reported a simulated location (mock)"]}},
          {"recordId":"b","date":"2026-09-21","state":"open","level":"CHECK","user":{"id":"u2"},"checkOut":{"signals":["Fast travel: 140 km/h since the previous check"],"level":"CHECK"}},
          {"recordId":"c","date":"2026-09-22","state":"valid","level":"CHECK","user":{"id":"u3"},"review":{"verdict":"VALID","reviewedBy":{"name":"Boss"}},"extra":1}
        ]}""")

    @Test fun tabsSplitByStateAndLevel() {
        assertEquals(listOf("a"), SuspectLogic.filter(list.items, 0).map { it.recordId })
        assertEquals(listOf("b"), SuspectLogic.filter(list.items, 1).map { it.recordId })
        assertEquals(listOf("c"), SuspectLogic.filter(list.items, 2).map { it.recordId })
        assertEquals(1, list.counts.fakeOpen); assertEquals(true, list.items[0].checkIn!!.simulated)
    }

    @Test fun notValidOnlyForProofWithANote() {
        val fake = list.items[0]; val check = list.items[1]
        assertFalse(SuspectLogic.canInvalidate(fake, "  ok "))   // < 3 after trim
        assertTrue(SuspectLogic.canInvalidate(fake, "fake GPS app"))
        assertFalse(SuspectLogic.canInvalidate(check, "looks odd")) // CHECK can only be cleared (server 422 NOT_PROOF)
        assertFalse(SuspectLogic.canInvalidate(list.items[2].copy(level = "FAKE"), "already reviewed"))
    }

    @Test fun signalsAndPeriods() {
        assertEquals(SuspectLogic.Signal.SIMULATED to null, SuspectLogic.signal("The phone reported a simulated location (x)"))
        assertEquals(SuspectLogic.Signal.FAST to "140 km/h", SuspectLogic.signal("Fast travel: 140 km/h since the previous check"))
        assertEquals(SuspectLogic.Signal.IMPOSSIBLE to "900 km/h", SuspectLogic.signal("Impossible travel: 900 km/h since the previous check"))
        assertEquals(SuspectLogic.Signal.OTHER to null, SuspectLogic.signal("Something new"))
        assertEquals("2026-08", SuspectLogic.shift("2026-09", -1)); assertEquals("2027-01", SuspectLogic.shift("2026-12", 1))
        assertEquals("Jl. A, B", SuspectLogic.shortAddress("Jl. A, B, C"))
    }

    @Test fun fakeGpsTabIsBoDOnly() {
        assertTrue("suspects" in ControlRoomTabs.forRole(isBoD = true))
        assertFalse("suspects" in ControlRoomTabs.forRole(isBoD = false))
    }
}
