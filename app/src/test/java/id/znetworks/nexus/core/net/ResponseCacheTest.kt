package id.znetworks.nexus.core.net

import id.znetworks.nexus.core.session.Session
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.Serializable
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.fail
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

class ResponseCacheTest {
    @get:Rule val tmp = TemporaryFolder()
    @Serializable data class Item(val id: String, val name: String = "")

    private lateinit var server: MockWebServer
    private var user = "u1"
    private lateinit var api: ApiClient

    @Before fun setUp() {
        server = MockWebServer().apply { start() }
        api = ApiClient(server.url("/"), ClientIdentity("0.1.6", 1, 36), { Session("t", "c", user) }, mayCarrySession = { true })
        api.cache = ResponseCache(tmp.root) { user }
    }
    @After fun tearDown() { runCatching { server.close() } }

    @Test fun liveThenSavedCopyWhenNobodyAnswers() = runTest {
        server.enqueue(MockResponse.Builder().code(200).body("""{"id":"p1","name":"Live"}""").build())
        val live = api.getCached("/api/projects/p1", "project-p1", Item.serializer())
        assertNull(live.savedAtMillis)
        server.enqueue(MockResponse.Builder().code(530).body("""{"error":"NEXUS is down","code":"NEXUS_DOWN","down":true}""").build())
        val saved = api.getCached("/api/projects/p1", "project-p1", Item.serializer())
        assertEquals("Live", saved.value.name)
        assertNotNull(saved.savedAtMillis)
    }

    @Test fun aRefusalIsNotPaperedOver() = runTest {
        server.enqueue(MockResponse.Builder().code(200).body("""{"id":"p1"}""").build())
        api.getCached("/api/projects/p1", "project-p1", Item.serializer())
        server.enqueue(MockResponse.Builder().code(403).body("""{"error":"Forbidden"}""").build())
        try { api.getCached("/api/projects/p1", "project-p1", Item.serializer()); fail() } catch (e: ApiError.Http) { assertEquals(403, e.status) }
    }

    @Test fun anotherPersonNeverReadsTheCopy() = runTest {
        server.enqueue(MockResponse.Builder().code(200).body("""{"id":"p1"}""").build())
        api.getCached("/api/x", "k", Item.serializer())
        user = "u2"
        server.close()
        try { api.getCached("/api/x", "k", Item.serializer()); fail() } catch (e: ApiError.Transport) { /* no copy for u2 */ }
    }
}
