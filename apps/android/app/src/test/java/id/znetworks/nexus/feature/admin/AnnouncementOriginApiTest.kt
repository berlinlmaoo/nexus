package id.znetworks.nexus.feature.admin

import id.znetworks.nexus.core.net.ApiClient
import id.znetworks.nexus.core.net.ApiError
import id.znetworks.nexus.core.net.ClientIdentity
import kotlinx.coroutines.test.runTest
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import org.junit.Assert.assertEquals
import org.junit.Assert.fail
import org.junit.Test

class AnnouncementOriginApiTest {
    @Test fun defaultListRequestsManualAndSystemRequestsItsOwnOrigin() = runTest {
        val server = MockWebServer(); server.start()
        try {
            val api = AdminMoreApi(ApiClient(server.url("/"), ClientIdentity("0.1.7", 14, 36), { null }))
            // Targeted, manually posted SPs still belong to Manual; audience and kind do not decide the segment.
            server.enqueue(MockResponse.Builder().body("""{"announcements":[{"id":"manual-sp","kind":"sp","active":true,"targetUserIds":["u1"],"origin":"manual","source":"composer"}],"counts":{"manual":1,"system":1}}""").build())
            val manual = api.announcements().single()
            assertEquals("manual-sp", manual.id)
            assertEquals("manual", manual.origin)
            assertEquals("composer", manual.source)
            assertEquals("/api/announcements?origin=manual", server.takeRequest().target)

            server.enqueue(MockResponse.Builder().body("""{"announcements":[{"id":"system-reminder","kind":"announcement","active":true,"origin":"system","source":"gideon"}],"counts":{"manual":1,"system":1}}""").build())
            val system = api.announcements(AnnouncementOrigin.SYSTEM).single()
            assertEquals("system-reminder", system.id)
            assertEquals("system", system.origin)
            assertEquals("gideon", system.source)
            assertEquals("/api/announcements?origin=system", server.takeRequest().target)
        } finally { server.close() }
    }

    @Test fun filterFailureIsSurfacedWithoutRetryingAnUnfilteredList() = runTest {
        val server = MockWebServer(); server.start()
        try {
            val api = AdminMoreApi(ApiClient(server.url("/"), ClientIdentity("0.1.7", 14, 36), { null }))
            server.enqueue(MockResponse.Builder().code(400).body("""{"error":"Invalid origin"}""").build())
            try { api.announcements(AnnouncementOrigin.SYSTEM); fail("A rejected filter must remain a load error") }
            catch (e: ApiError.Http) { assertEquals(400, e.status) }
            assertEquals("/api/announcements?origin=system", server.takeRequest().target)
            assertEquals(1, server.requestCount)
        } finally { server.close() }
    }
}
