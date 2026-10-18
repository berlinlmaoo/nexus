package id.znetworks.nexus.feature.admin

import id.znetworks.nexus.core.net.*
import kotlinx.coroutines.test.runTest
import mockwebserver3.MockWebServer
import mockwebserver3.MockResponse
import org.junit.Assert.*
import org.junit.Test

class GideonPeopleTest {
    @Test fun chatsRequireBothTheOaaRoleAndServerPermission() {
        for (role in listOf(null, "BOD", "MANAGER", "STAFF", "ADMIN", "ONE_ABOVE_ALL")) {
            assertFalse(GideonReviewAccess.chats(role, false))
            assertEquals(role == "ONE_ABOVE_ALL", GideonReviewAccess.chats(role, true))
        }
    }

    @Test fun deletedTranscriptsKeepApprovalsStepsAndAttachments() {
        val data = NexusJson.decodeFromString(GReviewTranscript.serializer(), """{
          "chat":{"id":"chat","deleted":true,"deletedAt":"2026-10-18T01:00:00Z","tier":"luna","messages":2,"credits":9},
          "messages":[{"id":"u","role":"user","content":"Read this","attachments":[{"kind":"document","name":"Brief.pdf","url":"/api/files/brief.pdf"}]},
          {"id":"a","role":"assistant","content":"A proposal","createdAt":"2026-10-18T00:00:00Z","tier":"luna","credits":9,
          "meta":{"steps":[{"tool":"read_document","status":"done"}],"proposals":[{"id":"p","status":"APPLIED","diff":[{"field":"Title","from":"Before","to":"After"}]}]}}],"olderBefore":"cursor"} """)
        assertTrue(data.chat.deleted); assertEquals("cursor", data.olderBefore)
        assertEquals("Brief.pdf", data.messages.first().attachments.single().name)
        val answer = data.messages.last()
        assertEquals(9, answer.credits); assertEquals("done", answer.steps.single().status)
        assertEquals("APPLIED", answer.proposals.single().status)
        assertEquals("Before", answer.proposals.single().diff.single().fromText)
    }

    @Test fun reviewUsesGetOnlyAndPreservesCursorsAndFilters() = runTest {
        val server = MockWebServer(); server.start()
        try {
            val api = GideonPeopleApi(ApiClient(server.url("/"), ClientIdentity("0.1.6", 13, 34), sessionProvider = { null }))
            server.enqueue(MockResponse.Builder().body("""{"chats":[{"id":"c","deleted":true}],"total":1,"nextCursor":"older"}""").build())
            val list = api.chats("user", "file & task", "only", "2026-10-18T01:02:03Z|id", "2026-10-01", "2026-10-18")
            assertTrue(list.chats.single().deleted); assertEquals("older", list.nextCursor)
            val request = server.takeRequest()
            assertEquals("GET", request.method); assertEquals("/api/gideon/people/user/chats", request.url.encodedPath)
            assertEquals("file & task", request.url.queryParameter("q")); assertEquals("only", request.url.queryParameter("deleted"))
            assertEquals("2026-10-18T01:02:03Z|id", request.url.queryParameter("cursor")); assertEquals("2026-10-01", request.url.queryParameter("from"))
            server.enqueue(MockResponse.Builder().body("""{"chat":{"id":"c"},"messages":[],"olderBefore":null}""").build())
            api.transcript("user", "c", "older|message")
            val transcript = server.takeRequest()
            assertEquals("GET", transcript.method); assertEquals("/api/gideon/people/user/chats/c", transcript.url.encodedPath)
            assertEquals("older|message", transcript.url.queryParameter("before"))
        } finally { server.close() }
    }

    @Test fun serverDenialIsNotTreatedAsAnEmptyOrOwnConversation() = runTest {
        val server = MockWebServer(); server.start()
        try {
            val api = GideonPeopleApi(ApiClient(server.url("/"), ClientIdentity("0.1.6", 13, 34), sessionProvider = { null }))
            server.enqueue(MockResponse.Builder().code(403).body("""{"code":"OAA_ONLY","error":"Only OAA"}""").build())
            try { api.chats("person"); fail("403 must be propagated") }
            catch (e: ApiError.Http) { assertEquals(403, e.status); assertEquals("OAA_ONLY", e.code) }
            assertEquals(1, server.requestCount)
        } finally { server.close() }
    }
}
