package id.znetworks.nexus.feature.attendance.trail

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class OutsideClockTest {
    private val min = 60_000L
    private val t0 = 1_800_000_000_000L
    private val fence = TrailFence(-6.2, 106.8, 100.0)
    private fun out(since: Long = t0, vararg edits: (TrailState) -> TrailState): TrailState =
        edits.fold(TrailState(recordId = "r", fence = fence, zone = TrailZone.OUTSIDE, outsideSinceMillis = since)) { s, f -> f(s) }

    @Test fun insideOrInactiveIsNormal() {
        assertNull(OutsideClock.present(TrailState(), t0))
        assertNull(OutsideClock.present(out().copy(zone = TrailZone.INSIDE), t0))
    }

    @Test fun stagesByElapsedTimeWithProjectedAutoCheckout() {
        assertEquals(OutsideClock.Outside(t0, t0 + 150 * min, OutsideClock.Level.OUTSIDE), OutsideClock.present(out(), t0 + 89 * min))
        assertEquals(OutsideClock.Level.REMIND, OutsideClock.present(out(), t0 + 90 * min)!!.level)
        assertEquals(OutsideClock.Level.WARN, OutsideClock.present(out(), t0 + 120 * min)!!.level)
    }

    @Test fun serverStartWinsOverThePhones() {
        val s = out(t0, { it.copy(serverOutsideSinceMillis = t0 + 3 * min) })
        val p = OutsideClock.present(s, t0 + 10 * min)!!
        assertEquals(t0 + 3 * min, p.sinceMillis)
        assertEquals(t0 + 153 * min, p.autoAtMillis)
    }

    @Test fun onceWarnedTheServersAutoTimeIsUsed() {
        // A late warning (phone offline): the server waits 30 min after it, past the 150-min mark.
        val s = out(t0, { it.copy(stage = "warned", serverNextAtMillis = t0 + 170 * min) })
        val p = OutsideClock.present(s, t0 + 141 * min)!!
        assertEquals(OutsideClock.Level.WARN, p.level)
        assertEquals(t0 + 170 * min, p.autoAtMillis)
    }

    @Test fun anExcuseForTodayPauses() {
        assertNull(OutsideClock.present(out(t0, { it.copy(excusedToday = true) }), t0 + 100 * min))
        assertNull(OutsideClock.present(out(t0, { it.copy(stage = "paused_permit") }), t0 + 100 * min))
    }

    @Test fun backInsideResetsTheEpisode() {
        val m = TrailMachine(out(t0, { it.copy(serverOutsideSinceMillis = t0, stage = "reminded", serverNextAtMillis = t0 + 120 * min) }))
        m.determined(inside = true, lastKnown = null, now = t0 + 95 * min)
        assertNull(OutsideClock.present(m.state, t0 + 95 * min))
        assertNull(m.state.serverOutsideSinceMillis)
        assertNull(m.state.stage)
        m.determined(inside = false, lastKnown = null, now = t0 + 100 * min)
        val p = OutsideClock.present(m.state, t0 + 101 * min)!!
        assertEquals(OutsideClock.Level.OUTSIDE, p.level)
        assertEquals(t0 + 250 * min, p.autoAtMillis)
    }

    @Test fun todayNotesExcuseAndServerStartOnlyForTheTrackedRecord() {
        val m = TrailMachine(out())
        m.noteToday("other", t0 + 5 * min, excused = true)
        assertEquals(false, m.state.excusedToday)
        m.noteToday("r", t0 + 5 * min, excused = false)
        assertEquals(t0 + 5 * min, m.state.serverOutsideSinceMillis)
        m.noteToday("r", null, excused = true)
        assertEquals(true, m.state.excusedToday)
    }
}
