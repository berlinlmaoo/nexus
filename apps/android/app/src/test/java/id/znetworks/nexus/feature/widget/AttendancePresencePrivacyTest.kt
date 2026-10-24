package id.znetworks.nexus.feature.widget

import id.znetworks.nexus.core.net.NexusJson
import id.znetworks.nexus.core.session.Session
import id.znetworks.nexus.feature.attendance.AttendanceRecord
import id.znetworks.nexus.feature.attendance.AttendanceToday
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.take
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.*
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class AttendancePresencePrivacyTest {
    private class Phone(scope: CoroutineScope) {
        val original = Session("private-token-a", "session-cookie", "person-a")
        var session: Session? = original
        var server = "https://server-a.invalid/"
        var raw: String? = null
        var afterRead: () -> Unit = {}
        var fetch: suspend () -> List<DayDot> = { listOf(DayDot("2026-10-23", "P")) }
        var writes = 0
        var redraws = 0
        val presence = AttendancePresence(scope, queue = { emptyList() }, hereName = { null },
            currentSession = { session }, server = { server }, fetchRecent = { fetch() },
            readSnapshot = { val result = raw; afterRead(); result },
            writeSnapshot = { raw = it; if (it != null) writes++ }, redraw = { redraws++ })
    }

    private fun today(place: String = "Private office") = AttendanceToday(today = AttendanceRecord(
        id = "record", checkInAt = "2026-10-24T01:00:00Z",
        officeLocation = id.znetworks.nexus.feature.attendance.OfficeRef(name = place)))

    @Test fun saveAndImmediateLogoutPublishNewInputsToAnAlreadyRunningWidget() = runTest {
        val phone = Phone(this)
        val seen = mutableListOf<Long>()
        val observer = launch(start = CoroutineStart.UNDISPATCHED) { phone.presence.revision.take(3).toList(seen) }
        phone.presence.refresh(today()).join()
        runCurrent()
        assertEquals("Private office", phone.presence.load()?.place)
        phone.session = null
        val stopped = phone.presence.stop()
        // The disk and model go before the asynchronous launcher redraw can run.
        assertNull(phone.raw)
        assertNull(phone.presence.lastToday)
        assertNull(phone.presence.load())
        stopped.join(); observer.join()
        assertEquals(listOf(0L, 1L, 2L), seen)
        assertEquals(2, phone.redraws)
    }

    @Test fun coldReadRequiresCurrentOwnerAndServerAndNeverStoresCredentials() = runTest {
        val phone = Phone(this)
        phone.presence.refresh(today()).join()
        val saved = phone.raw!!
        assertFalse(saved.contains(phone.original.token))
        assertFalse(saved.contains(phone.original.cookieName))
        val restarted = Phone(this).also { it.raw = saved }
        assertEquals("Private office", restarted.presence.load()?.place)
        restarted.session = null
        assertNull(restarted.presence.load())
        restarted.session = restarted.original.copy(userId = "person-b")
        assertNull(restarted.presence.load())
        restarted.session = restarted.original
        restarted.server = "https://server-b.invalid/"
        assertNull(restarted.presence.load())
    }

    @Test fun legacyUnownedSnapshotAndAnAuthChangeDuringReadAreNeverRendered() = runTest {
        val phone = Phone(this)
        phone.raw = NexusJson.encodeToString(AttendanceSnapshot.serializer(), AttendanceSnapshot("2026-10-24", place = "Legacy private office"))
        assertNull(phone.presence.load())
        phone.presence.refresh(today()).join()
        phone.afterRead = { phone.session = null }
        assertNull(phone.presence.load())
    }

    @Test fun logoutWhileHistoryWaitsCannotRepublishEvenAfterSameCredentialLogin() = runTest {
        val phone = Phone(this)
        phone.presence.refresh(today()).join()
        val pending = CompletableDeferred<List<DayDot>>()
        phone.fetch = { pending.await() }
        val refresh = phone.presence.refresh(today(), forceRecent = true)
        runCurrent()
        phone.session = null
        phone.presence.stop()
        assertNull(phone.raw)
        phone.session = phone.original
        pending.complete(listOf(DayDot("2026-10-24", "A")))
        refresh.join(); advanceUntilIdle()
        assertNull(phone.raw)
        assertNull(phone.presence.lastToday)
        assertEquals(1, phone.writes)
    }

    @Test fun historyCompletionRejectsChangedTokenCookiePersonOrServer() = runTest {
        for (change in listOf<(Phone) -> Unit>(
            { it.session = it.original.copy(token = "different-token") },
            { it.session = it.original.copy(cookieName = "different-cookie") },
            { it.session = it.original.copy(userId = "person-b") },
            { it.server = "https://server-b.invalid/" },
        )) {
            val phone = Phone(this)
            val pending = CompletableDeferred<List<DayDot>>()
            phone.fetch = { pending.await() }
            val refresh = phone.presence.refresh(today())
            runCurrent()
            change(phone)
            pending.complete(listOf(DayDot("2026-10-24", "A")))
            refresh.join()
            assertNull(phone.raw)
            assertEquals(0, phone.redraws)
        }
    }

    @Test fun profileMetadataUpdateDoesNotDiscardCurrentCredentialsResponse() = runTest {
        val phone = Phone(this)
        val pending = CompletableDeferred<List<DayDot>>()
        phone.fetch = { pending.await() }
        val refresh = phone.presence.refresh(today())
        runCurrent()
        phone.session = phone.original.copy(userName = "New display name", userEmail = "new@example.invalid", expiresAtMillis = 99)
        pending.complete(listOf(DayDot("2026-10-24", "P")))
        refresh.join()
        assertNotNull(phone.presence.load())
        assertEquals(1, phone.writes)
    }

    @Test fun queuedRefreshCannotAdoptTheNextLoginOrReusePreviousOwnersToday() = runTest {
        val phone = Phone(this)
        val queued = phone.presence.refresh(today())
        phone.session = phone.original.copy(userId = "person-b", token = "private-token-b")
        queued.join()
        assertNull(phone.raw)
        phone.presence.refresh().join()
        val saved = phone.presence.load()!!
        assertNull(saved.place)
        assertNull(saved.checkInAtMillis)
        assertEquals(1, phone.writes)
    }

    @Test fun cancelledHistoryDoesNotFallThroughToSavingPrivateSnapshot() = runTest {
        val phone = Phone(this)
        phone.fetch = { throw CancellationException("cancelled") }
        val job = phone.presence.refresh(today())
        job.join()
        assertTrue(job.isCancelled)
        assertNull(phone.raw)
        assertEquals(0, phone.redraws)
    }
}
