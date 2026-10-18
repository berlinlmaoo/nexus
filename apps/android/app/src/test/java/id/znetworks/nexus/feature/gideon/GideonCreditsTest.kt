package id.znetworks.nexus.feature.gideon

import id.znetworks.nexus.core.net.*
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.*
import mockwebserver3.*
import org.junit.Assert.*
import org.junit.Test

class GideonCreditsTest {
    @Test fun creditsUseTheServerAllowanceAndHistoryCursor() = runTest {
        val server = MockWebServer(); server.start()
        try {
            val api = GideonCreditsApi(ApiClient(server.url("/"), ClientIdentity("0.1.6", 13, 34), sessionProvider = { null }))
            server.enqueue(MockResponse.Builder().code(200).body("""{"summary":{"unlimited":false,"today":{"used":64,"limit":100,"remaining":36},"pool":{"used":0,"limit":1000},"enforced":true,"next":"fallback","fallbackToday":2,"fallbackPerDay":30},"items":[{"id":"u","tier":"terra","credits":1,"fallback":true}],"nextBefore":"2026-10-18T00:00:00Z"}""").build())
            val page = api.history("2026-10-18T01:02:03Z")
            assertEquals(64, page.summary.today.used); assertEquals(1000, page.summary.pool.limit)
            assertEquals("fallback", page.summary.next); assertTrue(page.items.single().fallback)
            assertTrue(server.takeRequest().url.toString().contains("history=1"))
            assertEquals("2026-10-18T00:00:00Z", page.nextBefore)
        } finally { server.close() }
    }
    @Test fun unlimitedAndOlderBalancePayloadsDecode() {
        assertTrue(NexusJson.decodeFromString(GCreditResponse.serializer(), """{"summary":{"unlimited":true}}""").summary.unlimited)
    }
    @Test fun currentRoleLimitsRemainServerControlled() {
        for ((daily, pool) in listOf(250 to 2500, 750 to 7500)) {
            val s = NexusJson.decodeFromString(GCreditResponse.serializer(), """{"summary":{"today":{"limit":$daily},"pool":{"limit":$pool}}}""").summary
            assertEquals(daily, s.today.limit); assertEquals(pool, s.pool.limit)
        }
    }
    @Test fun partialStreamsKeepStepsRunningAndProposalsVisible() {
        val frame = """data: {"type":"step","step":{"id":"one","status":"running"}}
data: {"type":"delta","content":"Hello"}
"""
        fun decode(raw: String) = runCatching { NexusJson.parseToJsonElement(raw).jsonObject }.getOrNull()
        assertEquals("running", GideonRules.parse(frame, complete = false, ::decode).steps.single().status)
        assertEquals("Hello", GideonRules.parse(frame, complete = false, ::decode).text)
        assertEquals("done", GideonRules.parse(frame, decode = ::decode).steps.single().status)
    }
}
