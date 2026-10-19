package id.znetworks.nexus.feature.gideon

import id.znetworks.nexus.core.net.ApiClient
import id.znetworks.nexus.core.net.ClientIdentity
import kotlinx.coroutines.test.runTest
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import org.junit.Assert.*
import org.junit.Test

class GideonHistoryTest {
    private fun client(server: MockWebServer) = ApiClient(server.url("/"), ClientIdentity("0.1.6", 13, 36), { null })

    @Test fun clearUsesOwnHistoryEndpointAndResetsOnlyAfterSuccess() = runTest {
        MockWebServer().use { server ->
            server.start()
            server.enqueue(MockResponse.Builder().body("""{"ok":true,"deleted":3}""").build())
            server.enqueue(MockResponse.Builder().body("""{"proposals":[]}""").build())
            val chat = GideonChat(client(server), this, memoryOwner = { "me" })
            chat.setQuery("keep until success")
            var ok: Boolean? = null
            chat.clearHistory { ok = it }.join()
            val request = server.takeRequest()
            assertEquals("DELETE", request.method)
            assertEquals("/api/gideon/history", request.url.encodedPath)
            assertEquals(true, ok)
            assertEquals("", chat.state.value.query)
            assertTrue(chat.state.value.chats!!.isEmpty())
        }
    }

    @Test fun failedClearPreservesHistoryAndReportsFailure() = runTest {
        MockWebServer().use { server ->
            server.start(); server.enqueue(MockResponse.Builder().code(500).body("{}").build())
            val chat = GideonChat(client(server), this, memoryOwner = { "me" })
            chat.setQuery("preserved")
            var ok: Boolean? = null
            chat.clearHistory { ok = it }.join()
            assertEquals(false, ok)
            assertEquals("preserved", chat.state.value.query)
        }
    }

    @Test fun lateClearResponseCannotResetAnotherAccount() = runTest {
        MockWebServer().use { server ->
            server.start(); server.enqueue(MockResponse.Builder().body("{}").build())
            var reads = 0
            val chat = GideonChat(client(server), this, memoryOwner = { if (reads++ == 0) "old" else "new" })
            chat.setQuery("new account")
            var called = false
            chat.clearHistory { called = true }.join()
            assertFalse(called)
            assertEquals("new account", chat.state.value.query)
        }
    }
}
