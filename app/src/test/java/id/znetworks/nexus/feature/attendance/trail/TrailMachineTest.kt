package id.znetworks.nexus.feature.attendance.trail

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class TrailMachineTest {
    // Office at the origin-ish; 0.001° lat ≈ 111 m.
    private val fence = TrailFence(-6.2, 106.8, 100.0)
    private val min = 60_000L
    private var now = 1_000_000_000L
    private val m = TrailMachine()

    private fun at(dLatDeg: Double, acc: Double = 10.0) = TrailPoint(recordId = "", lat = -6.2 + dLatDeg, lng = 106.8, accuracy = acc, atMillis = now)
    private fun inside() = at(0.0002)      // ~22 m
    private fun outside() = at(0.005)      // ~555 m

    private fun started() { m.start("r1", now, fence, now) }

    @Test fun insideSendsNothing() {
        started()
        repeat(60) { now += min; m.fix(inside(), now); m.tick(now) }
        assertEquals(TrailZone.INSIDE, m.state.zone)
        assertTrue(m.state.pending.isEmpty())
    }

    @Test fun leavingQueuesExitAtOnceThenEvery15Minutes() {
        started()
        m.fix(inside(), now)
        now += min
        val fx = m.fix(outside(), now)
        assertTrue(TrailEffect.StartContinuous in fx && TrailEffect.Flush in fx)
        assertEquals(TrailPoint.Event.exit, m.state.pending.single().event)
        assertEquals("r1", m.state.pending.single().recordId)
        // Standing still outside: no fixes, the tick re-sends the last position every 15 min.
        repeat(14) { now += min; m.tick(now) }
        assertEquals(1, m.state.pending.size)
        now += min; m.tick(now)
        assertEquals(2, m.state.pending.size)
        assertEquals(TrailPoint.Event.point, m.state.pending.last().event)
    }

    @Test fun comingBackQueuesEnterAndStops() {
        started()
        m.fix(outside(), now)
        now += 5 * min
        val fx = m.fix(inside(), now)
        assertTrue(TrailEffect.StopContinuous in fx)
        assertEquals(TrailPoint.Event.enter, m.state.pending.last().event)
        assertNull(m.state.outsideSinceMillis)
    }

    @Test fun serverCanAskForTheNextPointSooner() {
        started()
        m.fix(outside(), now)
        val ids = m.state.pending.map { it.id }.toSet()
        m.sent(ids, "r1", TrailReply(true, "outside", now, now + 5 * min), now)
        now += 4 * min; m.tick(now)
        assertTrue(m.state.pending.isEmpty())
        now += min; m.tick(now)
        assertEquals(1, m.state.pending.size)
    }

    @Test fun trackingFalseStopsForGoodForThatRecord() {
        started()
        m.fix(outside(), now)
        val fx = m.sent(m.state.pending.map { it.id }.toSet(), "r1", TrailReply(false, "auto_checked_out", null, null), now)
        assertTrue(TrailEffect.DisarmAll in fx)
        assertFalse(m.state.isActive)
        // Today still shows the record open; it must not restart.
        assertTrue(m.start("r1", now, fence, now).isEmpty())
        assertFalse(m.state.isActive)
        // A new record does start.
        assertTrue(m.start("r2", now, fence, now).isNotEmpty())
    }

    @Test fun checkoutKeepsUnsentLogoutDiscards() {
        started(); m.fix(outside(), now)
        val fx = m.stop(keepUnsent = true)
        assertEquals(1, m.state.pending.size)
        assertTrue(TrailEffect.Flush in fx)
        val m2 = TrailMachine(); m2.start("r1", now, fence, now); m2.fix(outside(), now)
        m2.stop(keepUnsent = false)
        assertTrue(m2.state.pending.isEmpty())
    }

    @Test fun shiftCapStandsDown() {
        started()
        assertTrue(m.state.isActive)
        now += 16 * 60 * min + 1
        m.tick(now)
        assertFalse(m.state.isActive)
        // And an already-too-old check-in never starts.
        val m2 = TrailMachine()
        assertTrue(m2.start("old", now - 17 * 60 * min, fence, now).isEmpty())
    }

    @Test fun edgeJitterIsNotAnExit() {
        started(); m.fix(inside(), now)
        // 110 m from the centre with 30 m accuracy: beyond the radius, inside the margin → undecided.
        m.fix(at(0.00099, acc = 30.0), now)
        assertEquals(TrailZone.INSIDE, m.state.zone)
        // A vague fix (300 m accuracy) decides nothing either.
        m.fix(at(0.005, acc = 300.0), now)
        assertEquals(TrailZone.INSIDE, m.state.zone)
    }

    @Test fun exitWithoutFreshFixAsksForOneAndTagsIt() {
        started()
        now += 10 * min
        val fx = m.determined(inside = false, lastKnown = null, now = now)
        assertTrue(TrailEffect.RequestFix in fx)
        m.fix(outside(), now)
        assertEquals(TrailPoint.Event.exit, m.state.pending.single().event)
    }

    @Test fun batchesArePerRecordAndCapped() {
        // No check-in time, so the 16 h cap does not stop the run before the queue fills.
        m.start("r1", null, fence, now); m.fix(outside(), now)
        repeat(1100) { now += 15 * min; m.tick(now) }
        assertEquals(TrailMachine.PENDING_CAP, m.state.pending.size)
        val (rec, batch) = m.nextBatch()!!
        assertEquals("r1", rec)
        assertEquals(TrailMachine.BATCH_LIMIT, batch.size)
    }

    @Test fun failedUploadWaitsTwoMinutes() {
        started(); m.fix(outside(), now)
        m.failed(m.state.pending.map { it.id }.toSet(), dropBatch = false, now = now)
        now += min
        assertFalse(TrailEffect.Flush in m.tick(now))
        now += 2 * min
        assertTrue(TrailEffect.Flush in m.tick(now))
    }
}
