package id.znetworks.nexus.feature.gideon

import id.znetworks.nexus.core.nav.*
import id.znetworks.nexus.core.nav.Target
import id.znetworks.nexus.core.net.*
import id.znetworks.nexus.core.session.Session
import kotlinx.coroutines.*
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.*
import mockwebserver3.*
import org.junit.Assert.*
import org.junit.Test
import java.util.Locale
import java.util.concurrent.TimeUnit

class GideonMemoryTest {
    private val pending = GMemory("m", "QA preference", status = "PENDING", updatedAt = "2026-10-19T01:00:00Z")
    private val active = pending.copy(status = "ACTIVE", updatedAt = "2026-10-19T01:01:00Z")
    private fun api(server: MockWebServer) = MemoryApi(ApiClient(server.url("/"), ClientIdentity("0.1.6", 13, 36), { Session("t", "c", "u") }, mayCarrySession = { true }))
    private fun list(vararg memories: GMemory) = MockResponse.Builder().body(NexusJson.encodeToString(GMemories.serializer(), GMemories(memories = memories.toList())))
    private fun envelope(memory: GMemory) = MockResponse.Builder().body(NexusJson.encodeToString(GMemoryEnvelope.serializer(), GMemoryEnvelope(memory))).build()
    @Test fun sseMemoryEventsReplaceByIdAndMemoryOnlyAnswersAreKept() {
        val raw = listOf(pending, active).joinToString("\n") { "data: " + buildJsonObject { put("type", "memory"); put("memory", NexusJson.encodeToJsonElement(GMemory.serializer(), it)) } }
        val result = GideonRules.parse(raw) { runCatching { NexusJson.parseToJsonElement(it).jsonObject }.getOrNull() }
        assertEquals(listOf(active), result.memories); assertTrue(result.answered)
        val message = GMessage("assistant", meta = GMeta(memories = result.memories))
        val history = NexusJson.decodeFromString(GHistory.serializer(), NexusJson.encodeToString(GHistory.serializer(), GHistory(listOf(message))))
        assertEquals(listOf(active), history.messages.single().meta?.memories)
    }
    @Test fun reviewTranscriptsNeverExposeMemoriesEvenIfMetadataContainsThem() {
        val message = GMessage("assistant", meta = GMeta(memories = listOf(active)))
        assertTrue(MemoryRules.chatMemories(message, readOnly = true).isEmpty())
        assertTrue(MemoryRules.chatMemories(message.copy(role = "user"), readOnly = false).isEmpty())
        assertEquals(listOf(active), MemoryRules.chatMemories(message, readOnly = false))
        assertEquals(Target.GideonMemory, Links.parse("/settings?section=gideon-memory"))
    }
    @Test fun settingsAndChipsShareSavedStateAndStaleSuggestionsCannotUndoIt() = runTest {
        MockWebServer().use { server -> server.start(); val store = GideonMemories(api(server)) { "u" }; store.receive(listOf(pending))
            server.enqueue(envelope(active)); store.save(pending)
            val request = server.takeRequest(); assertEquals("/api/gideon/memory/m", request.target)
            assertEquals("{\"status\":\"ACTIVE\"}", request.body!!.utf8())
            store.receive(listOf(pending)); assertEquals("ACTIVE", store.state.value.data.memories.single().status)
        }
    }
    @Test fun missingSuggestionIsTreatedAsNotSavedAndCannotBeResurrected() = runTest {
        MockWebServer().use { server -> server.start(); val store = GideonMemories(api(server)) { "u" }; store.receive(listOf(active))
            server.enqueue(MockResponse.Builder().code(404).body("{\"code\":\"not_found\"}").build())
            store.forget(pending); store.receive(listOf(active))
            assertEquals("DELETE", server.takeRequest().method)
            assertEquals("DELETED", store.state.value.known["m"]?.status); assertTrue(store.state.value.data.memories.isEmpty())
        }
    }
    @Test fun anOldRefreshCannotBringBackADeletedMemory() = runTest {
        MockWebServer().use { server -> server.start(); val store = GideonMemories(api(server)) { "u" }; store.receive(listOf(pending))
            server.enqueue(list(pending).bodyDelay(200, TimeUnit.MILLISECONDS).build())
            server.enqueue(MockResponse.Builder().body("{\"deleted\":true}").build())
            val work = async(Dispatchers.Default) { store.refresh() }; server.takeRequest()
            store.forget(pending); work.await(); assertTrue(store.state.value.data.memories.isEmpty())
            assertEquals("DELETED", store.state.value.known["m"]?.status)
        }
    }
    @Test fun accountChangeDropsInflightReadsAndAllCachedMemoryText() = runTest {
        MockWebServer().use { server -> server.start(); var owner: String? = "u"; val store = GideonMemories(api(server)) { owner }
            store.receive(listOf(pending)); server.enqueue(list(active).bodyDelay(100, TimeUnit.MILLISECONDS).build())
            val work = async(Dispatchers.Default) { runCatching { store.refresh() } }; server.takeRequest(); owner = "other"; store.reset(); work.await()
            assertTrue(store.state.value.known.isEmpty()); assertTrue(store.state.value.data.memories.isEmpty()); assertFalse(store.state.value.loaded)
        }
    }
    @Test fun pauseDisablesAddingAndAnOlderReadCannotTurnItBackOn() = runTest {
        MockWebServer().use { server -> server.start(); val store = GideonMemories(api(server)) { "u" }
            server.enqueue(list().bodyDelay(200, TimeUnit.MILLISECONDS).build())
            server.enqueue(MockResponse.Builder().body("{\"paused\":true,\"memories\":[]}").build())
            val work = async(Dispatchers.Default) { store.refresh() }; server.takeRequest(); store.pause(true); work.await()
            assertTrue(store.state.value.data.paused); assertFalse(MemoryRules.canAdd(store.state.value.data))
            assertEquals("{\"paused\":true}", server.takeRequest().body!!.utf8())
        }
    }
    @Test fun forgettingEverythingClearsTheOwnEndpointAndStaleChatChips() = runTest {
        MockWebServer().use { server -> server.start(); val store = GideonMemories(api(server)) { "u" }; store.receive(listOf(active, pending.copy(id = "second")))
            server.enqueue(MockResponse.Builder().body("{\"deleted\":2}").build()); store.forgetAll()
            val request = server.takeRequest(); assertEquals("DELETE", request.method); assertEquals("/api/gideon/memory", request.target)
            assertTrue(store.state.value.known.values.all { it.status == "DELETED" }); assertTrue(store.state.value.data.memories.isEmpty())
            store.receive(listOf(active)); assertTrue(store.state.value.data.memories.isEmpty())
        }
    }
    @Test fun datesUseTheAppLanguageAndLimitsDoNotAllowNewRows() {
        assertEquals("29 Feb", MemoryRules.date("02-29", Locale.UK)); assertNull(MemoryRules.date("02-30", Locale.UK))
        assertFalse(MemoryRules.canAdd(GMemories(paused = true)))
        assertFalse(MemoryRules.canAdd(GMemories(max = 1, memories = listOf(active))))
        assertEquals(active, MemoryRules.merge(active, pending))
        assertEquals("DELETED", MemoryRules.merge(active, pending.copy(status = "DELETED")).status)
    }
    @Test fun aLateStreamFromAnotherAccountCannotPopulateMemory() {
        MockWebServer().use { server -> server.start(); val store = GideonMemories(api(server)) { "new-person" }
            store.receive(listOf(active), "previous-person")
            assertTrue(store.state.value.known.isEmpty())
            store.receive(listOf(active), "new-person")
            assertEquals(listOf(active), store.state.value.data.memories)
        }
    }
}
