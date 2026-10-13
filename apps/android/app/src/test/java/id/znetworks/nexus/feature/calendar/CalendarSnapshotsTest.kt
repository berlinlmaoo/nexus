package id.znetworks.nexus.feature.calendar

import id.znetworks.nexus.core.net.NexusJson
import id.znetworks.nexus.feature.calendar.widget.CalendarSnapshots
import id.znetworks.nexus.feature.calendar.widget.CalendarSnapshots.Pass
import id.znetworks.nexus.feature.calendar.widget.CalendarWidgetWork
import id.znetworks.nexus.feature.calendar.widget.SavedGlance
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.nio.file.Files
import java.time.Instant

/**
 * The widgets' snapshot store (SPEC-widgets "Data"): all three scopes saved, never another person's
 * snapshot, everything gone on sign-out and when `flags.calendarWidgets` is off, at most every 5 minutes.
 */
class CalendarSnapshotsTest {
    private fun res(name: String) = javaClass.classLoader!!.getResource("calendar/$name")!!.readText()
    private fun snapshot(scope: GlanceScope, user: String = "u_staff") =
        NexusJson.decodeFromString(CalGlance.serializer(), res("glance/me.json")).copy(scope = scope.wire, requestedScope = scope.wire, userId = user)

    private val dir: File = Files.createTempDirectory("glance").toFile()
    private var user: String? = "u_staff"
    private var on = true
    private var clock = 1_000_000_000L
    private var answerAs: String? = null
    private val asked = mutableListOf<GlanceScope>()
    private var changes = 0
    private var signOutDuringFetch = false
    private var placed: Set<GlanceScope> = GlanceScope.entries.toSet()

    private val store = CalendarSnapshots(dir,
        fetch = { scope -> asked += scope; if (signOutDuringFetch) user = null; snapshot(scope, answerAs ?: "u_staff") },
        currentUserId = { user }, widgetsOn = { on }, changed = { changes++ }, now = { clock }, scopes = { placed })

    @Test fun savesAllThreeScopesForThePersonSignedIn() = runBlocking {
        assertEquals(Pass.SAVED, store.refresh(force = true))
        assertEquals(GlanceScope.entries.toList(), asked)
        GlanceScope.entries.forEach { s ->
            val saved = store.load(s)
            assertNotNull(saved); assertEquals(s.wire, saved!!.snapshot.scope); assertEquals("u_staff", saved.userId); assertEquals(clock, saved.savedAt)
        }
        assertEquals(1, changes)
    }

    @Test fun neverSavesAnotherPersonsSnapshot() = runBlocking {
        answerAs = "u_other"
        assertEquals(Pass.FAILED, store.refresh(force = true))
        GlanceScope.entries.forEach { assertNull(store.load(it)) }
        assertTrue(dir.listFiles().orEmpty().none { it.name.endsWith(".json") })
    }

    @Test fun signOutDuringTheRequestSavesNothing() = runBlocking {
        signOutDuringFetch = true
        store.refresh(force = true)
        user = "u_staff"
        GlanceScope.entries.forEach { assertNull(store.load(it)) }
    }

    @Test fun signOutDeletesEverything() = runBlocking {
        store.refresh(force = true)
        store.wipe()
        assertTrue(dir.listFiles().orEmpty().none { it.name.endsWith(".json") })
        store.refresh(force = true)
        store.clear()
        GlanceScope.entries.forEach { assertNull(store.load(it)) }
    }

    @Test fun aFileLeftByAnotherPersonIsNeverDrawn() = runBlocking {
        store.refresh(force = true)
        user = "u_next"
        GlanceScope.entries.forEach { assertNull(store.load(it)) }
    }

    @Test fun flagOffDeletesAndShowsNothing() = runBlocking {
        store.refresh(force = true)
        on = false
        GlanceScope.entries.forEach { assertNull(store.load(it)) }
        assertEquals(Pass.DISABLED, store.refresh(force = true))
        on = true
        GlanceScope.entries.forEach { assertNull(store.load(it)) }
    }

    @Test fun signedOutRefreshWipes() = runBlocking {
        store.refresh(force = true)
        user = null
        assertEquals(Pass.SIGNED_OUT, store.refresh(force = true))
        assertTrue(dir.listFiles().orEmpty().none { it.name.endsWith(".json") })
    }

    @Test fun throttledToFiveMinutesUnlessForced() = runBlocking {
        assertEquals(Pass.SAVED, store.refresh())
        clock += CalendarSnapshots.THROTTLE_MS - 1
        assertEquals(Pass.THROTTLED, store.refresh())
        assertEquals(Pass.SAVED, store.refresh(force = true))
        clock += CalendarSnapshots.THROTTLE_MS
        assertEquals(Pass.SAVED, store.refresh())
        assertEquals(9, asked.size)
    }

    @Test fun noWidgetPlacedAsksNothing() = runBlocking {
        // Audit #20: phones without a calendar widget make no request and keep no file.
        store.refresh(force = true)
        placed = emptySet()
        asked.clear(); changes = 0
        assertEquals(Pass.NO_WIDGETS, store.refresh(force = true))
        assertTrue(asked.isEmpty())
        assertEquals(0, changes)
        assertTrue(dir.listFiles().orEmpty().none { it.name.endsWith(".json") })
    }

    @Test fun onlyThePlacedScopesAreFetchedAndKept() = runBlocking {
        store.refresh(force = true)
        placed = setOf(GlanceScope.ALL)
        asked.clear()
        store.refresh(force = true)
        assertEquals(listOf(GlanceScope.ALL), asked)
        assertNull(store.load(GlanceScope.ME)); assertNull(store.load(GlanceScope.DIVISION)); assertNotNull(store.load(GlanceScope.ALL))
    }

    @Test fun nextRedrawIsTheFirstChangeOrMidnight() {
        val saved = SavedGlance(Instant.parse("2026-10-05T04:00:00.000Z").toEpochMilli(), "u_staff", snapshot(GlanceScope.ME))
        val mon1200 = Instant.parse("2026-10-05T05:00:00.000Z").toEpochMilli()
        // a05 at 19:00 WIB turns at 19:01.
        assertEquals(Instant.parse("2026-10-05T12:01:00.000Z").toEpochMilli(), CalendarWidgetWork.nextRedraw(listOf(saved), mon1200))
        // Nothing saved: WIB midnight.
        assertEquals(Instant.parse("2026-10-05T17:00:00.000Z").toEpochMilli(), CalendarWidgetWork.nextRedraw(emptyList(), mon1200))
    }
}
