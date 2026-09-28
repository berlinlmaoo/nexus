package id.znetworks.nexus.feature.admin

import id.znetworks.nexus.core.net.NexusJson
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import okhttp3.HttpUrl.Companion.toHttpUrl

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
        assertEquals(listOf("b"), SuspectLogic.filter(list.items, 2).map { it.recordId })
        assertEquals(listOf("c"), SuspectLogic.filter(list.items, 3).map { it.recordId })
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

    // Audit R7 (build 5): the record id is one encoded path segment.
    @Test fun reviewUrlEncodesTheId() {
        val api = SuspectsApi(id.znetworks.nexus.core.net.ApiClient("https://nexus.znetworks.id/".toHttpUrl(),
            id.znetworks.nexus.core.net.ClientIdentity("0.1.6", 5, 36), { null }))
        assertEquals("/api/attendance/suspects/a%2Fb%20c/review", api.reviewUrl("a/b c").encodedPath)
        assertEquals("/api/attendance/suspects/cmg123/review", api.reviewUrl("cmg123").encodedPath)
    }

    // Batch 2 (29 Sep, server e3091ab): Absen Monitor — NOFACE, face counts, warnings.
    private val batch2 = NexusJson.decodeFromString(SuspectList.serializer(), """{"periodKey":"2026-09",
        "counts":{"fakeOpen":0,"noFaceOpen":1,"checkOpen":0,"valid":0,"invalid":1},
        "items":[
          {"recordId":"n","date":"2026-09-27","state":"open","level":"NOFACE","user":{"id":"u1","name":"Ana"},
           "checkIn":{"photoUrl":"/a.jpg","faceCount":1,"signals":[]},
           "checkOut":{"photoUrl":"/b.jpg","faceCount":0,"level":"NOFACE","signals":["No face in the selfie (a wall, the floor, a covered camera)"]},
           "warnings":[{"at":"2026-09-28T02:00:00.000Z","by":{"name":"Boss"},"message":"Show your face"}]},
          {"recordId":"x","date":"2026-09-26","state":"invalid","level":"FAKE","user":{"id":"u2"},"checkIn":{"faceCount":null,"level":"FAKE"}}
        ]}""")

    @Test fun noFaceTabFaceCountsAndWarnings() {
        assertEquals(listOf("n"), SuspectLogic.filter(batch2.items, 1).map { it.recordId })
        assertEquals(1, batch2.counts.noFaceOpen)
        val n = batch2.items[0]
        assertEquals(0, n.checkOut!!.faceCount); assertEquals(1, n.checkIn!!.faceCount); assertEquals(null, batch2.items[1].checkIn!!.faceCount)
        assertEquals("Boss", n.warnings.single().by?.name)
        assertEquals(SuspectLogic.Signal.NOFACE to null, SuspectLogic.signal(n.checkOut!!.signals.single()))
        // The prefill names the side without a face; FAKE/CHECK the side carrying the level.
        assertEquals(SuspectLogic.Which.CHECK_OUT, SuspectLogic.warnSide(n))
        assertEquals(SuspectLogic.Which.CHECK_IN, SuspectLogic.warnSide(batch2.items[1]))
        assertTrue(SuspectLogic.canWarn(n)); assertFalse(SuspectLogic.canWarn(batch2.items[1]))
        assertFalse(SuspectLogic.warningValid("  ok ")); assertTrue(SuspectLogic.warningValid("Show your face"))
        assertFalse(SuspectLogic.warningValid("x".repeat(501)))
    }

    @Test fun warnUrlEncodesTheId() {
        val api = SuspectsApi(id.znetworks.nexus.core.net.ApiClient("https://nexus.znetworks.id/".toHttpUrl(),
            id.znetworks.nexus.core.net.ClientIdentity("0.1.6", 5, 36), { null }))
        assertEquals("/api/attendance/suspects/a%2Fb/warn", api.warnUrl("a/b").encodedPath)
    }
}
