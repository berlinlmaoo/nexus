package id.znetworks.nexus.core.version

import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant

class VersionGateTest {
    private class MapStorage : GateStorage {
        val map = mutableMapOf<String, String>()
        override fun get(key: String) = map[key]
        override fun put(key: String, value: String?) { if (value == null) map.remove(key) else map[key] = value }
    }

    private var clock = Instant.parse("2026-09-24T03:00:00Z")
    private var policy: AndroidPolicy? = null
    private var fetches = 0

    private fun gate(running: String, storage: GateStorage) =
        VersionGate(running, storage, fetchPolicy = { fetches++; policy }, now = { clock })

    @Test fun floorAboveLocksAndSurvivesOfflineColdStart() = runTest {
        val storage = MapStorage()
        policy = AndroidPolicy(minSupported = "0.1.7", storeUrl = "https://nexus.znetworks.id/download/android")
        gate("0.1.6", storage).checkPolicy(force = true)
        // Cold start in airplane mode: the fetch fails, the lock must still be there.
        policy = null
        val restarted = gate("0.1.6", storage)
        restarted.checkPolicy(force = true)
        assertEquals("0.1.7", restarted.state.value.required?.minSupported)
    }

    @Test fun updatedBuildLiftsPersistedLock() {
        val storage = MapStorage()
        gate("0.1.6", storage).require("0.1.7", null)
        assertNull(gate("0.1.7", storage).state.value.required)
        assertNull(storage.map["floor"])
    }

    @Test fun lockWithoutFloorNeedsANewerBuild() {
        val storage = MapStorage()
        gate("0.1.6", storage).require(null, null)
        assertNotNull(gate("0.1.6", storage).state.value.required) // relaunching the refused build
        assertNull(gate("0.1.6.1", storage).state.value.required)
    }

    @Test fun serverLoweringFloorLiftsLock() = runTest {
        val storage = MapStorage()
        val g = gate("0.1.6", storage)
        g.require("0.1.8", null)
        policy = AndroidPolicy(minSupported = "0.0.0")
        g.checkPolicy(force = true)
        assertNull(g.state.value.required)
    }

    @Test fun failedFetchNeverRaisesOrLifts() = runTest {
        val g = gate("0.1.6", MapStorage())
        policy = null
        g.checkPolicy(force = true)
        assertNull(g.state.value.required)
    }

    @Test fun throttledTo30MinutesUnlessForced() = runTest {
        val g = gate("0.1.6", MapStorage())
        policy = AndroidPolicy(minSupported = "0.0.0")
        g.checkPolicy(force = true)
        g.checkPolicy()
        assertEquals(1, fetches)
        clock = clock.plusSeconds(31 * 60)
        g.checkPolicy()
        assertEquals(2, fetches)
    }

    @Test fun availableAndGraceOncePerOfficeDay() = runTest {
        val storage = MapStorage()
        val g = gate("0.1.6", storage)
        policy = AndroidPolicy(minSupported = "0.1.6", latest = "0.1.7", nextMinimum = "0.1.7",
            graceUntil = "2026-09-27T02:00:00.000Z")
        g.checkPolicy(force = true)
        assertEquals("0.1.7", g.state.value.available)
        assertTrue(g.state.value.graceNoticeDue)
        g.graceNoticeSeen()
        g.checkPolicy(force = true)
        assertEquals(false, g.state.value.graceNoticeDue)
        clock = clock.plusSeconds(24 * 3600)
        g.checkPolicy(force = true)
        assertTrue(g.state.value.graceNoticeDue)
        clock = Instant.parse("2026-09-27T02:00:01Z") // grace over
        g.checkPolicy(force = true)
        assertNull(g.state.value.grace)
    }

    @Test fun onlyTheAndroidBlockCounts() {
        // Top-level fields are iOS's; a response without an android block has no opinion.
        val parsed = id.znetworks.nexus.core.net.NexusJson.decodeFromString(VersionPolicyResponse.serializer(),
            """{"minSupported":"9.9.9","latest":"9.9.9","storeUrl":"https://apps.apple.com/x"}""")
        assertNull(parsed.android)
        val live = id.znetworks.nexus.core.net.NexusJson.decodeFromString(VersionPolicyResponse.serializer(),
            """{"minSupported":"0.1.4","latest":"0.1.5","android":{"minSupported":"0.0.0","latest":null,"storeUrl":"https://play.google.com/x"}}""")
        assertEquals("0.0.0", live.android?.minSupported)
        assertNull(VersionGate.evaluate("0.1.6", live.android!!, Instant.now()).required)
    }

    // Server 29 Sep: latestName + latestBuild from the published APK; the name stays 0.1.6.
    @Test fun sameNameHigherBuildIsAvailable() {
        val now = Instant.now()
        val p = AndroidPolicy(latest = null, latestName = "0.1.6", latestBuild = 7)
        assertEquals("0.1.6 (7)", VersionGate.evaluate("0.1.6", p, now, runningCode = 6).available)
        assertNull(VersionGate.evaluate("0.1.6", p, now, runningCode = 7).available)
        assertNull(VersionGate.evaluate("0.1.6", p, now, runningCode = 8).available)
        // Unknown running build: no guess.
        assertNull(VersionGate.evaluate("0.1.6", p, now).available)
        // A newer name wins whatever the builds say; an older name never offers.
        assertEquals("0.1.7", VersionGate.evaluate("0.1.6", p.copy(latestName = "0.1.7", latestBuild = 1), now, 9).available)
        assertNull(VersionGate.evaluate("0.1.7", p.copy(latestBuild = 99), now, 1).available)
        // The live body parses.
        val live = id.znetworks.nexus.core.net.NexusJson.decodeFromString(VersionPolicyResponse.serializer(),
            """{"android":{"minSupported":"0.0.0","latest":null,"storeUrl":"x","latestName":"0.1.6","latestBuild":6}}""")
        assertEquals(6, live.android?.latestBuild)
        assertNull(VersionGate.evaluate("0.1.6", live.android!!, now, 6).available)
    }
}
