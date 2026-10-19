package id.znetworks.nexus.feature.admin

import id.znetworks.nexus.core.net.*
import id.znetworks.nexus.feature.gideon.GideonSaveDocApi
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.*
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import org.junit.Assert.*
import org.junit.Test

class ParityAdminApiTest {
    private fun obj(s: String) = NexusJson.parseToJsonElement(s) as JsonObject
    @Test fun privateRunTitlesAndStepsAreNeverRenderedEvenIfPayloadContainsThem() {
        assertNull(InsightPrivacy.title(obj("""{"titleHidden":true,"title":"Private question"}""")))
        assertTrue(InsightPrivacy.steps(obj("""{"stepsHidden":true,"steps":[{"label":"Private query"}]}""")).isEmpty())
        assertEquals("Digest", InsightPrivacy.title(obj("""{"titleHidden":false,"title":"Digest"}""")))
    }
    @Test fun calendarPrivacyChangesOnlyOneProject() = runTest {
        val server = MockWebServer(); server.start()
        try {
            val api = CalendarPrivacyApi(ApiClient(server.url("/"), ClientIdentity("0.1.6", 13, 36), { null }))
            server.enqueue(MockResponse.Builder().body("{}").build())
            api.set("project", true)
            val request = server.takeRequest(); assertEquals("PATCH", request.method)
            assertEquals("/api/admin/calendar-settings", request.target)
            assertEquals(obj("""{"projectId":"project","private":true}"""), obj(request.body!!.utf8()))
        } finally { server.close() }
    }
    @Test fun roleDefaultClearsEveryOverrideRatherThanSavingZeros() {
        assertEquals(obj("""{"userId":"crew","dailyLimit":null,"monthlyLimit":null,"unlimited":null,"note":null}"""), CreditAdminDraft.override("crew", true, false, "0", "0", "Old note"))
        assertEquals(obj("""{"userId":"crew","dailyLimit":0,"monthlyLimit":2500,"unlimited":false,"note":"Work"}"""), CreditAdminDraft.override("crew", false, false, "0", "2500", " Work "))
        listOf("-1", "1.5", "10000001", "abc").forEach { assertNull(CreditAdminDraft.limit(it)) }
    }
    @Test fun creditWritesUseSeparateAdminRoutes() = runTest {
        val server = MockWebServer(); server.start()
        try {
            val api = GideonCreditAdminApi(ApiClient(server.url("/"), ClientIdentity("0.1.6", 13, 36), { null }))
            server.enqueue(MockResponse.Builder().body("{}").build())
            val body = CreditAdminDraft.override("crew", true, false, "", "", "")
            api.limits(body)
            val request = server.takeRequest()
            assertEquals("PUT", request.method); assertEquals("/api/gideon/credits/admin/override", request.target)
            assertEquals(body, obj(request.body!!.utf8()))
            server.enqueue(MockResponse.Builder().body("{}").build())
            val bonus = obj("""{"userId":"crew","credits":5,"reason":"Launch"}""")
            api.grant(bonus)
            val grant = server.takeRequest(); assertEquals("POST", grant.method)
            assertEquals("/api/gideon/credits/admin/bonus", grant.target); assertEquals(bonus, obj(grant.body!!.utf8()))
        } finally { server.close() }
    }
    @Test fun savedAnswerPreservesMarkdownAndRejectsMalformedSuccess() = runTest {
        val server = MockWebServer(); server.start()
        try {
            val api = GideonSaveDocApi(ApiClient(server.url("/"), ClientIdentity("0.1.6", 13, 36), { null }))
            server.enqueue(MockResponse.Builder().body("""{"doc":{"id":"page"}}""").build())
            assertEquals("page", api.save("project", "Report", "# Report\n\n**Bold**"))
            val request = server.takeRequest(); assertEquals("POST", request.method)
            assertEquals("/api/gideon/save-doc", request.target)
            assertEquals(obj("""{"projectId":"project","title":"Report","markdown":"# Report\n\n**Bold**"}"""), obj(request.body!!.utf8()))
            server.enqueue(MockResponse.Builder().body("{}").build())
            try { api.save("project", "Title", "Text"); fail("Malformed response must not navigate") } catch (_: ApiError.Decoding) { }
        } finally { server.close() }
    }
}
