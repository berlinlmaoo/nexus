package id.znetworks.nexus.feature.agenda

import id.znetworks.nexus.core.net.*
import id.znetworks.nexus.core.session.Session
import kotlinx.coroutines.test.runTest
import mockwebserver3.*
import org.junit.Assert.*
import org.junit.Test

class BookingLinkTest {
    @Test fun linksFindTheExactActiveBookingUsingTheRequiredAuthorizedRange() = runTest {
        MockWebServer().use { server -> server.start()
            val api = AgendaApi(ApiClient(server.url("/"), ClientIdentity("0.1.6", 13, 36), { Session("t", "c", "u") }, mayCarrySession = { true }))
            val body = """{"bookings":[{"id":"other"},{"id":"wanted","title":"Future booking","startsAt":"2027-01-01T00:00:00Z"}],"roomsAvailable":true}"""
            server.enqueue(MockResponse.Builder().body(body).build())
            assertEquals("wanted", api.findBooking("wanted")?.id)
            val request = server.takeRequest(); assertTrue(request.target.contains("rangeStart=")); assertTrue(request.target.contains("rangeEnd="))
            server.enqueue(MockResponse.Builder().body(body.replace("true", "false")).build())
            assertNull(api.findBooking("wanted"))
            server.enqueue(MockResponse.Builder().body(body).build())
            assertNull(api.findBooking("deleted"))
        }
    }
}
