package id.znetworks.nexus.feature.attendance

import id.znetworks.nexus.core.net.ApiError
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.IOException

class AttendanceQueueTest {
    @get:Rule val tmp = TemporaryFolder()

    /** Scripted server: each call pops the next answer (an outcome or an error to throw). */
    private class FakeSender : QueueSender {
        val answers = ArrayDeque<Any>()
        val calls = mutableListOf<String>()
        private fun next(label: String): AttendanceOutcome {
            calls += label
            val a = answers.removeFirst()
            if (a is Throwable) throw a
            return a as AttendanceOutcome
        }
        override suspend fun checkIn(selfie: ByteArray, entry: PendingAttendance) = next("in:${entry.id}")
        override suspend fun checkOut(selfie: ByteArray, entry: PendingAttendance, offsite: Boolean, reason: String?) =
            next("out:${entry.id}:offsite=$offsite:${reason ?: ""}")
    }

    private val ok = AttendanceOutcome.Success(null, pendingApproval = false, duplicate = false)
    private val outside = AttendanceOutcome.OutsideRadius("HQ", 340.0, 150.0)
    private val fix = LocationFix(-6.2, 106.8, accuracyM = 8.0)

    private var user: String? = "u1"
    private var locked = false
    private val refused = mutableListOf<QueueProblem.RefusedOutsideRadius>()
    private var landed = 0
    private val sender = FakeSender()

    private fun queue() = AttendanceQueue(tmp.root, sender, { user }, { locked }, { refused += it }, { landed++ })

    private fun AttendanceQueue.add(id: String, kind: AttendanceKind, at: Long, offsite: Boolean = false) =
        enqueue(id, kind, byteArrayOf(1, 2, 3), fix, deviceAtMillis = at, uptimeSec = 100, reflection = "r", offsite = offsite)

    @Test fun survivesRestartWithSelfie() {
        queue().add("a", AttendanceKind.CHECK_IN, 1)
        val again = queue()
        assertEquals(1, again.state.value.count)
        assertEquals("u1", again.state.value.entries[0].ownerId)
        assertTrue(tmp.root.resolve("a.jpg").exists())
    }

    @Test fun replaysOldestFirstAndEmpties() = runTest {
        val q = queue()
        q.add("out", AttendanceKind.CHECK_OUT, at = 2_000)
        q.add("in", AttendanceKind.CHECK_IN, at = 1_000)
        sender.answers.addAll(listOf(ok, ok))
        assertEquals(AttendanceQueue.FlushResult.DRAINED, q.flush())
        assertEquals(listOf("in:in", "out:out:offsite=false:"), sender.calls)
        assertEquals(0, q.state.value.count)
        assertEquals(1, landed)
        assertFalse(tmp.root.resolve("in.jpg").exists())
    }

    @Test fun unreachableStopsWithoutCountingAnAttempt() = runTest {
        val q = queue()
        q.add("a", AttendanceKind.CHECK_IN, 1)
        q.add("b", AttendanceKind.CHECK_OUT, 2)
        sender.answers += ApiError.Http(530, null, "NEXUS_DOWN", null)
        assertEquals(AttendanceQueue.FlushResult.UNREACHABLE, q.flush())
        sender.answers += ApiError.Transport(IOException("offline"))
        assertEquals(AttendanceQueue.FlushResult.UNREACHABLE, q.flush())
        assertEquals(2, q.state.value.count)
        assertEquals(0, q.state.value.entries[0].attempts)
        assertEquals(listOf("in:a", "in:a"), sender.calls) // never went on to the check-out
    }

    @Test fun serverRefusalCountsAndDropsAfterFive() = runTest {
        val q = queue()
        q.add("a", AttendanceKind.CHECK_IN, 1)
        repeat(4) {
            sender.answers += ApiError.Http(400, "Selfie photo is required.", null, null)
            q.flush()
        }
        assertEquals(4, q.state.value.entries[0].attempts)
        sender.answers += ApiError.Http(400, "Selfie photo is required.", null, null)
        q.flush()
        assertEquals(0, q.state.value.count)
        val p = q.state.value.problem as QueueProblem.ServerRefused
        assertTrue(p.dropped)
        assertEquals("Selfie photo is required.", p.message)
    }

    @Test fun upgradeHoldsWithoutAttemptAndLockPausesReplay() = runTest {
        val q = queue()
        q.add("a", AttendanceKind.CHECK_IN, 1)
        sender.answers += ApiError.UpgradeRequired("Update", "0.1.7", null)
        q.flush()
        assertTrue(q.state.value.isHeldForUpdate)
        assertEquals(0, q.state.value.entries[0].attempts)
        locked = true
        assertEquals(AttendanceQueue.FlushResult.LOCKED, q.flush())
        assertEquals(1, sender.calls.size)
        // Updated build: the lock is gone, the held tap lands and clears the hold.
        locked = false
        sender.answers += ok
        q.flush()
        assertFalse(q.state.value.heldForUpdate)
        assertEquals(0, q.state.value.count)
    }

    @Test fun holdSurvivesRestart() {
        val q = queue()
        q.add("a", AttendanceKind.CHECK_IN, 1)
        q.holdForUpdate()
        assertTrue(queue().state.value.isHeldForUpdate)
    }

    @Test fun checkOutOutsideRadiusIsResentAsOffsiteWithSameId() = runTest {
        val q = queue()
        q.add("o", AttendanceKind.CHECK_OUT, 1)
        sender.answers.addAll(listOf(outside, ok))
        q.flush()
        assertEquals(listOf("out:o:offsite=false:", "out:o:offsite=true:${AttendanceQueue.OFFSITE_REPLAY_REASON}"), sender.calls)
        assertEquals(0, q.state.value.count)
        assertTrue(refused.isEmpty())
    }

    @Test fun checkInOutsideRadiusIsDroppedAndSaid() = runTest {
        val q = queue()
        q.add("i", AttendanceKind.CHECK_IN, 42)
        q.add("o", AttendanceKind.CHECK_OUT, 43)
        sender.answers.addAll(listOf(outside, ok))
        q.flush()
        assertEquals(0, q.state.value.count)
        assertEquals(listOf(QueueProblem.RefusedOutsideRadius(AttendanceKind.CHECK_IN, 42)), refused)
    }

    @Test fun unauthorizedKeepsEverything() = runTest {
        val q = queue()
        q.add("a", AttendanceKind.CHECK_IN, 1)
        sender.answers += ApiError.Unauthorized
        assertEquals(AttendanceQueue.FlushResult.SIGNED_OUT, q.flush())
        assertEquals(1, q.state.value.count)
        assertEquals(0, q.state.value.entries[0].attempts)
    }

    @Test fun signedOutNeverSends() = runTest {
        val q = queue()
        q.add("a", AttendanceKind.CHECK_IN, 1)
        user = null
        assertEquals(AttendanceQueue.FlushResult.SIGNED_OUT, q.flush())
        assertTrue(sender.calls.isEmpty())
    }

    @Test fun anotherPersonsTapsAreNeverReplayedAndAreDeletedOnSignIn() = runTest {
        val q = queue()
        q.add("mine", AttendanceKind.CHECK_IN, 1)
        user = "u2"
        sender.answers += ok
        q.flush()
        assertTrue(sender.calls.isEmpty()) // u1's tap is not sent under u2's session
        q.keepOnly("u2")
        assertEquals(0, q.state.value.count)
        assertFalse(tmp.root.resolve("mine.jpg").exists())
    }

    @Test fun logoutClearsEverything() {
        val q = queue()
        q.add("a", AttendanceKind.CHECK_IN, 1)
        q.clearAll()
        assertEquals(0, q.state.value.count)
        assertEquals(0, queue().state.value.count)
        assertFalse(tmp.root.resolve("a.jpg").exists())
    }

    @Test fun duplicateReplayCountsAsLanded() = runTest {
        val q = queue()
        q.add("a", AttendanceKind.CHECK_IN, 1)
        sender.answers += AttendanceOutcome.Success(null, pendingApproval = false, duplicate = true)
        q.flush()
        assertEquals(0, q.state.value.count)
    }

    // Audit S3: a replayed check-in the server already has is done; the check-out behind it goes on.
    @Test fun alreadyCheckedInDropsSilentlyAndCheckOutFollows() = runTest {
        val q = queue()
        q.add("in", AttendanceKind.CHECK_IN, 1)
        q.add("out", AttendanceKind.CHECK_OUT, 2)
        sender.answers += ApiError.Http(409, "You have already checked in today.", null, null)
        sender.answers += ok
        assertEquals(AttendanceQueue.FlushResult.DRAINED, q.flush())
        assertEquals(listOf("in:in", "out:out:offsite=false:"), sender.calls)
        assertEquals(0, q.state.value.count)
        assertEquals(null, q.state.value.problem)
        assertFalse(tmp.root.resolve("in.jpg").exists())
    }

    @Test fun otherConflictsStayRefusals() = runTest {
        val q = queue()
        q.add("in", AttendanceKind.CHECK_IN, 1)
        sender.answers += ApiError.Http(409, "Kamu belum check-out di hari sebelumnya.", "PENDING_CHECKOUT", null)
        assertEquals(AttendanceQueue.FlushResult.STOPPED, q.flush())
        assertEquals(1, q.state.value.entries[0].attempts)
        assertFalse(AttendanceQueue.alreadyCheckedIn(AttendanceKind.CHECK_IN,
            ApiError.Http(409, "Attendance cannot be recorded because an approved sick request already covers today.", null, null)))
        assertFalse(AttendanceQueue.alreadyCheckedIn(AttendanceKind.CHECK_OUT, ApiError.Http(409, "You have already checked in today.", null, null)))
    }
}
