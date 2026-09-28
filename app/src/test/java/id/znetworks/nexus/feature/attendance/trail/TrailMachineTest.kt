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

    @Test fun insideSendsOnlyTheHourlyPresenceCheck() {
        started()
        repeat(49) { now += min; m.fix(inside(), now); m.tick(now) }
        assertEquals(TrailZone.INSIDE, m.state.zone)
        assertTrue(m.state.pending.isEmpty())
        repeat(60) { now += min; m.fix(inside(), now); m.tick(now) }
        // 109 min after check-in: one check at ~50 min, one at ~100 min, nothing else.
        assertEquals(listOf(TrailPoint.Event.presence, TrailPoint.Event.presence), m.state.pending.map { it.event })
    }

    @Test fun presenceWindowTakesAGoodFixOrTheBestAtTimeout() {
        started(); m.fix(inside(), now)
        now += 50 * min
        // No fresh fix in hand: the tick opens the precise window.
        assertTrue(TrailEffect.PreciseChanged in m.tick(now))
        assertTrue(m.setup.precise)
        // A vague (80 m) fix inside the window is kept as the best, not sent yet.
        now += 5_000; m.fix(at(0.0002, acc = 80.0), now)
        assertTrue(m.state.pending.isEmpty())
        // Timeout: the best fix counts, the window closes.
        now += 45_000; val fx = m.tick(now)
        assertTrue(TrailEffect.PreciseChanged in fx)
        assertFalse(m.setup.precise)
        assertEquals(TrailPoint.Event.presence, m.state.pending.single().event)
    }

    @Test fun presenceWindowEndsEarlyOnAPreciseFix() {
        started(); m.fix(inside(), now)
        now += 50 * min; m.tick(now)
        now += 3_000
        val fx = m.fix(at(0.0002, acc = 12.0), now)
        assertTrue(TrailEffect.PreciseChanged in fx)
        assertEquals(TrailPoint.Event.presence, m.state.pending.single().event)
        assertFalse(m.setup.precise)
    }

    @Test fun presenceWithNoFixRetriesAfter15Minutes() {
        started(); m.fix(inside(), now)
        now += 50 * min; m.tick(now)
        now += 46_000; m.tick(now) // timed out with nothing
        assertTrue(m.state.pending.isEmpty())
        now += 10 * min; assertTrue(m.tick(now).isEmpty())
        now += 5 * min; assertTrue(TrailEffect.PreciseChanged in m.tick(now))
    }

    @Test fun presenceFixOutsideBecomesTheExit() {
        started(); m.fix(inside(), now)
        now += 50 * min; m.tick(now)
        now += 2_000
        val fx = m.fix(outside(), now)
        assertTrue(TrailEffect.StartContinuous in fx)
        assertEquals(TrailPoint.Event.exit, m.state.pending.single().event)
        assertFalse(m.setup.precise)
    }

    @Test fun cellLevelFixesAreNeverUsed() {
        started()
        m.fix(at(0.05, acc = 1500.0), now) // 5.5 km away but 1.5 km vague
        assertEquals(TrailZone.UNKNOWN, m.state.zone)
        assertNull(m.state.latest)
    }

    @Test fun staleFixIsIgnored() {
        started()
        val old = TrailPoint(recordId = "", lat = -6.205, lng = 106.8, accuracy = 10.0, atMillis = now - 3 * min)
        assertTrue(m.fix(old, now).isEmpty())
        assertEquals(TrailZone.UNKNOWN, m.state.zone)
    }

    @Test fun resumeOutsideSendsTheFirstFreshFixAtOnce() {
        started(); m.fix(outside(), now)                      // exit queued
        m.sent(m.state.pending.map { it.id }.toSet(), "r1", TrailReply(true, "outside", now, null), now)
        // Killed; reopened 4 min later, inside the 5-min rhythm.
        now += 4 * min
        val restored = TrailMachine(m.state)
        val fx = restored.resume(now)
        assertTrue(TrailEffect.RequestFix in fx)
        assertNull(restored.state.latest) // the pre-kill fix is never re-sent stamped "now"
        now += 10_000
        assertTrue(TrailEffect.Flush in restored.fix(outside(), now))
        assertEquals(TrailPoint.Event.point, restored.state.pending.single().event)
        // And only the first: the next one waits for the rhythm again.
        now += min
        assertTrue(restored.fix(outside(), now).isEmpty())
    }

    @Test fun oldStateFileStillDecodes() {
        val json = """{"recordId":"r1","zone":"INSIDE","pending":[{"id":"a","recordId":"r1","lat":1.0,"lng":2.0,"atMillis":5,"event":"exit"}]}"""
        val s = id.znetworks.nexus.core.net.NexusJson.decodeFromString(TrailState.serializer(), json)
        assertEquals("r1", s.recordId)
        assertNull(s.preciseSinceMillis)
    }

    @Test fun leavingQueuesExitAtOnceThenEvery5MinutesStandingStill() {
        started()
        m.fix(inside(), now)
        now += min
        val fx = m.fix(outside(), now)
        assertTrue(TrailEffect.StartContinuous in fx && TrailEffect.Flush in fx)
        assertEquals(TrailPoint.Event.exit, m.state.pending.single().event)
        assertEquals("r1", m.state.pending.single().recordId)
        // Standing still outside: no fixes, the tick re-sends the last position every 5 min.
        repeat(4) { now += min; m.tick(now) }
        assertEquals(1, m.state.pending.size)
        now += min; m.tick(now)
        assertEquals(2, m.state.pending.size)
        assertEquals(TrailPoint.Event.point, m.state.pending.last().event)
    }

    @Test fun movingOutsideQueuesAPointEvery50mAndUploadsInBatches() {
        started(); m.fix(outside(), now)                        // exit, sent at once
        m.sent(m.state.pending.map { it.id }.toSet(), "r1", TrailReply(true, "outside", now, null), now)
        now += 20_000
        assertTrue(m.fix(at(0.0053), now).isEmpty())            // ~33 m: not a step yet
        assertTrue(m.state.pending.isEmpty())
        now += 20_000
        assertTrue(m.fix(at(0.0055), now).isEmpty())            // ~55 m: queued, waits for the batch
        assertEquals(1, m.state.pending.size)
        now += 5_000; m.fix(at(0.006), now)                     // a step, but 5 s after the last point: waits
        assertEquals(1, m.state.pending.size)
        now += 15_000; m.fix(at(0.006), now)                    // 20 s on: counts
        assertEquals(2, m.state.pending.size)
        now += 20_000
        assertTrue(m.fix(at(0.007, acc = 150.0), now).isEmpty()) // a vague fix is not movement
        assertEquals(2, m.state.pending.size)
        // Two minutes after the last upload the batch goes up.
        now += 40_000
        assertTrue(TrailEffect.Flush in m.tick(now))
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

    @Test fun exitMarginIsTheServers50m() {
        val fence = TrailFence(0.0, 0.0, 100.0)
        fun p(m: Double, acc: Double) = TrailPoint(recordId = "", lat = m / 111_195.0, lng = 0.0, accuracy = acc, atMillis = 0)
        // 140 m with a 10 m fix: beyond radius + 30 but not radius + 50 → not yet outside (was, before 81abc62).
        assertNull(TrailMachine.decisive(p(140.0, 10.0), fence))
        assertEquals(false, TrailMachine.decisive(p(155.0, 10.0), fence))
        // A worse fix widens the margin: 155 m with 70 m accuracy is still undecided.
        assertNull(TrailMachine.decisive(p(155.0, 70.0), fence))
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

    @Test fun nothingIsRecordedWithoutAnOpenRecord() {
        // Before check-in: fixes and ticks queue nothing and ask for no GPS.
        assertTrue(m.fix(outside(), now).isEmpty())
        assertTrue(m.tick(now + 20 * min).isEmpty())
        assertTrue(m.state.pending.isEmpty())
        assertFalse(m.setup.active)
        // After check-out: the same.
        started(); m.fix(outside(), now)
        m.sent(m.state.pending.map { it.id }.toSet(), "r1", TrailReply(true, "outside", now, null), now)
        m.stop(keepUnsent = true)
        now += 10 * min
        assertTrue(m.fix(outside(), now).isEmpty())
        m.tick(now)
        assertTrue(m.state.pending.isEmpty())
        assertFalse(m.setup.active)
        assertNull(OutsideClock.present(m.state, now))
    }

    @Test fun aStaleCachedFixDecidesNothing() {
        started()
        val old = at(0.005).copy(atMillis = now - 10 * min)
        assertTrue(m.fix(old, now).isEmpty())
        assertEquals(TrailZone.UNKNOWN, m.state.zone)
    }
}
