package id.znetworks.nexus.feature.attendance.trail

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
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

    @Test fun serverStartWinsWhenHeardAfterThisExit() {
        val s = out(t0, { it.copy(serverOutsideSinceMillis = t0 + 3 * min, serverOutsideSinceAtMillis = t0 + 4 * min) })
        val p = OutsideClock.present(s, t0 + 10 * min)!!
        assertEquals(t0 + 3 * min, p.sinceMillis)
        assertEquals(t0 + 153 * min, p.autoAtMillis)
    }

    @Test fun anOlderEpisodesServerStartIsIgnored() {
        // Heard before this exit, or far earlier than it: an older episode's time.
        val heardBefore = out(t0, { it.copy(serverOutsideSinceMillis = t0 - 5 * min, serverOutsideSinceAtMillis = t0 - min) })
        assertEquals(t0, OutsideClock.present(heardBefore, t0 + min)!!.sinceMillis)
        val tooEarly = out(t0, { it.copy(serverOutsideSinceMillis = t0 - 45 * min, serverOutsideSinceAtMillis = t0 + min) })
        assertEquals(t0, OutsideClock.present(tooEarly, t0 + 2 * min)!!.sinceMillis)
    }

    @Test fun onceWarnedTheServersAutoTimeIsUsed() {
        // A late warning (phone offline): the server waits 30 min after it, past the 150-min mark.
        val s = out(t0, { it.copy(stage = "warned", serverNextAtMillis = t0 + 170 * min, serverStageAtMillis = t0 + 140 * min) })
        val p = OutsideClock.present(s, t0 + 141 * min)!!
        assertEquals(OutsideClock.Level.WARN, p.level)
        assertEquals(t0 + 170 * min, p.autoAtMillis)
    }

    @Test fun aRestartedClockIsReadFromTheServersNextAt() {
        // Excuse rejected at +60: the server's next reminder is at +150, so the clock runs from +60.
        val s = out(t0, { it.copy(stage = "outside", serverNextAtMillis = t0 + 150 * min, serverStageAtMillis = t0 + 61 * min) })
        val p = OutsideClock.present(s, t0 + 100 * min)!!
        assertEquals(OutsideClock.Level.OUTSIDE, p.level)
        assertEquals(t0 + 210 * min, p.autoAtMillis)
        assertEquals(t0, p.sinceMillis)
    }

    @Test fun neverBelowTheServersStage() {
        val s = out(t0, { it.copy(stage = "reminded", serverNextAtMillis = t0 + 120 * min, serverStageAtMillis = t0 + 90 * min) })
        assertEquals(OutsideClock.Level.REMIND, OutsideClock.present(s, t0 + 91 * min)!!.level)
    }

    @Test fun anExcuseForTodayPauses() {
        assertNull(OutsideClock.present(out(t0, { it.copy(stage = "paused_permit") }), t0 + 100 * min))
        assertNull(OutsideClock.present(out(t0, { it.copy(stage = "auto_checked_out") }), t0 + 100 * min))
        val m = TrailMachine(out()); m.excuseFiled()
        assertNull(OutsideClock.present(m.state, t0 + 100 * min))
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
        m.noteToday("other", t0 + 5 * min, excused = true, heardAt = t0 + 6 * min)
        assertNull(m.state.stage)
        m.noteToday("r", t0 + 5 * min, excused = false, heardAt = t0 + 6 * min)
        assertEquals(t0 + 5 * min, m.state.serverOutsideSinceMillis)
        // An older answer does not overwrite a newer one.
        m.noteToday("r", null, excused = false, heardAt = t0 + 2 * min)
        assertEquals(t0 + 5 * min, m.state.serverOutsideSinceMillis)
        m.noteToday("r", t0 + 5 * min, excused = true, heardAt = t0 + 7 * min)
        assertEquals("paused_permit", m.state.stage)
    }

    @Test fun leftAlertOnceThenTheHourOneThenNothing() {
        val A = OutsideClock.Alert.LEFT; val H = OutsideClock.Alert.HOUR
        assertEquals(OutsideClock.AlertStep(A, false), OutsideClock.alertStep(out(), t0 + min, emptySet()))
        assertEquals(OutsideClock.AlertStep(null, false), OutsideClock.alertStep(out(), t0 + 30 * min, setOf(A)))
        assertEquals(OutsideClock.AlertStep(H, false), OutsideClock.alertStep(out(), t0 + 60 * min, setOf(A)))
        assertEquals(OutsideClock.AlertStep(null, false), OutsideClock.alertStep(out(), t0 + 75 * min, setOf(A, H)))
    }

    @Test fun foundOutLateSkipsStraightToTheHourAlert() {
        assertEquals(OutsideClock.Alert.HOUR, OutsideClock.alertStep(out(), t0 + 70 * min, emptySet()).post)
    }

    @Test fun insideExcusedOrStoppedTakesTheAlertBack() {
        assertEquals(OutsideClock.AlertStep(null, true), OutsideClock.alertStep(out().copy(zone = TrailZone.INSIDE), t0, emptySet()))
        assertEquals(OutsideClock.AlertStep(null, true), OutsideClock.alertStep(out(t0, { it.copy(stage = "paused_permit") }), t0 + 60 * min, emptySet()))
        assertEquals(OutsideClock.AlertStep(null, true), OutsideClock.alertStep(TrailState(), t0, emptySet()))
    }

    @Test fun noCountdownWhenAutoCheckoutIsOff() {
        // owner, 8 Oct: flags.outsideAutoCheckout false (default) = no countdown, no check-out time; reminders stay.
        for (l in OutsideClock.Level.entries) {
            val w = OutsideClock.wording(l, autoCheckout = false)
            assertTrue(w.name, w.name.endsWith("PLAIN"))
        }
        assertEquals(OutsideClock.Wording.AUTO_AT, OutsideClock.wording(OutsideClock.Level.OUTSIDE, true))
        val o = OutsideClock.present(out(), t0 + 100 * min)!!
        assertEquals(o.sinceMillis to false, OutsideClock.chronometer(o, autoCheckout = false))
        assertEquals(o.autoAtMillis to true, OutsideClock.chronometer(o, autoCheckout = true))
        // The default when the server says nothing is OFF.
        assertEquals(false, id.znetworks.nexus.core.config.ConfigBody().outsideAutoCheckout)
    }
}
