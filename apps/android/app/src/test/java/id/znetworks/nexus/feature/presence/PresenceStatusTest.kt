package id.znetworks.nexus.feature.presence

import id.znetworks.nexus.core.config.*
import id.znetworks.nexus.core.net.*
import id.znetworks.nexus.core.session.Session
import id.znetworks.nexus.feature.gideon.*
import kotlinx.coroutines.*
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.*
import mockwebserver3.*
import org.junit.Assert.*
import org.junit.Test
import java.time.*
import java.util.Locale
import java.util.concurrent.TimeUnit

class PresenceStatusTest {
    private val old = PersonPresence("u", "offline", "black", label = mapOf("en" to "Server label", "id" to "Kalimat server"))
    private val fresh = old.copy(state = "away", tone = "yellow", reason = "custom", label = mapOf("en" to "Away · Test"))
    private fun api(server: MockWebServer) = PresenceApi(ApiClient(server.url("/"), ClientIdentity("0.1.6", 13, 36), { Session("t", "c", "u") }, mayCarrySession = { true }))
    private fun response(enabled: Boolean = true) = MockResponse.Builder().body(NexusJson.encodeToString(PresenceResponse.serializer(), PresenceResponse(enabled, listOf(old))))
    private fun event(status: PersonPresence) = NexusJson.encodeToString(PresenceChange.serializer(), PresenceChange(status.userId, status))
    @Test fun unknownStatesAndReasonsStillUseTheServerLabel() {
        val p = old.copy(state = "future", reason = "future")
        assertEquals("Kalimat server", p.label("id")); assertEquals("Server label", p.label("future"))
    }
    @Test fun availabilityRoundTripsAndOlderManualStatusesDefaultToAway() = runTest {
        val legacy = NexusJson.decodeFromString(ManualPresence.serializer(), """{"id":"m","text":"Test","startsAt":"2026-10-19T00:00:00Z","endsAt":"2026-10-20T00:00:00Z"}""")
        assertEquals("away", legacy.availability)
        MockWebServer().use { server -> server.start(); val api = api(server)
            for (availability in listOf("online", "away", "dnd")) {
                val status = fresh.copy(state = availability, tone = if (availability == "dnd") "red" else "green", availability = availability, manual = legacy.copy(availability = availability))
                server.enqueue(MockResponse.Builder().body(NexusJson.encodeToString(PresenceMutation.serializer(), PresenceMutation(status))).build())
                assertEquals(availability, api.set("Test", null, Instant.parse(legacy.endsAt), availability).status?.manual?.availability)
                val body = NexusJson.parseToJsonElement(server.takeRequest().body!!.utf8()).jsonObject
                assertEquals(availability, body["availability"]?.jsonPrimitive?.content)
            }
        }
    }
    @Test fun officeTimesKeepDateOnlyAndUseWibForInstants() {
        val now = Instant.parse("2026-10-19T12:00:00Z")
        assertEquals("20:00", PresenceTimes.until("2026-10-19T13:00:00Z", Locale.UK, now))
        assertEquals("Tue 20 Oct 20:00", PresenceTimes.until("2026-10-20T13:00:00Z", Locale.UK, now))
        assertEquals("Tue 20 Oct", PresenceTimes.until("2026-10-20", Locale.UK, now))
        assertEquals(Instant.parse("2026-10-19T16:59:00Z"), PresenceTimes.end(now, "today", LocalDateTime.MIN))
        assertEquals(now.plusSeconds(1800), PresenceTimes.end(now, "30m", LocalDateTime.MIN))
    }
    @Test fun clearSendsTheDisplayedManualIdAndSetUsesIsoInstants() = runTest {
        MockWebServer().use { server -> server.start(); val api = api(server)
            repeat(2) { server.enqueue(MockResponse.Builder().body("{\"cleared\":0}").build()) }
            api.clear("old-id"); assertEquals("/api/presence/manual?id=old-id", server.takeRequest().target)
            api.set(" Test ", null, Instant.parse("2026-10-20T13:00:00Z"))
            val request = server.takeRequest(); assertEquals("PUT", request.method)
            val body = NexusJson.parseToJsonElement(request.body!!.utf8()).jsonObject
            assertEquals(JsonNull, body["startsAt"]); assertEquals("Test", body["text"]?.jsonPrimitive?.content)
        }
    }
    @Test fun realtimePatchesByIdAndOffHidesEverything() = runTest {
        MockWebServer().use { server -> server.start(); server.enqueue(response().build()); val store = PresenceStatuses(api(server)) { "u" }
            store.refresh(); store.receive(event(fresh)); assertEquals(fresh, store.state.value.statuses["u"])
            store.receive("""{"userId":"wrong","status":${NexusJson.encodeToString(PersonPresence.serializer(), old)}}""")
            assertEquals(fresh, store.state.value.statuses["u"])
            store.configure(false); assertFalse(store.state.value.enabled)
            store.reset(); assertTrue(store.state.value.statuses.isEmpty()); assertFalse(store.state.value.enabled)
        }
    }
    @Test fun apiOffRemainsOffWhenTheDefaultConfigIsOn() = runTest {
        MockWebServer().use { server -> server.start(); server.enqueue(response(false).build()); val store = PresenceStatuses(api(server)) { "u" }
            store.refresh(); store.configure(true); assertFalse(store.state.value.enabled)
        }
        assertTrue(ConfigBody().presenceStatus); assertFalse(ConfigBody(flags = ConfigFlags(presenceStatus = false)).presenceStatus)
    }
    @Test fun anOlderFetchCannotOverwriteARealtimeStatus() = runTest {
        MockWebServer().use { server -> server.start(); server.enqueue(response().bodyDelay(100, TimeUnit.MILLISECONDS).build()); val store = PresenceStatuses(api(server)) { "u" }
            val work = async(Dispatchers.Default) { store.refresh() }; server.takeRequest()
            store.receive(event(fresh)); work.await(); assertEquals(fresh, store.state.value.statuses["u"])
        }
    }
    @Test fun responsesFromThePreviousAccountAreDropped() = runTest {
        MockWebServer().use { server -> server.start(); server.enqueue(response().bodyDelay(100, TimeUnit.MILLISECONDS).build()); var owner: String? = "u"; val store = PresenceStatuses(api(server)) { owner }
            val work = async(Dispatchers.Default) { store.refresh() }; server.takeRequest()
            owner = "other"; store.reset(); work.await(); assertTrue(store.state.value.statuses.isEmpty())
        }
    }
    @Test fun setStatusUsesTheExtraPackageApprovalEcho() {
        val proposal = GProposal("p", action = "set_my_status", extra = GExtra())
        val body = GideonReview.body(true, null, proposal, null)
        assertEquals("p", body["confirm"]?.jsonObject?.get("proposalId")?.jsonPrimitive?.content)
        assertEquals(GideonSteps.Kind.MY_STATUS, GideonSteps.text(GStep("s", "set_my_status", "Test")).kind)
    }
}
