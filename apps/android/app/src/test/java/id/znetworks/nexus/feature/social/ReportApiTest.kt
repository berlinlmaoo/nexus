package id.znetworks.nexus.feature.social

import id.znetworks.nexus.core.net.*
import id.znetworks.nexus.core.session.Session
import id.znetworks.nexus.feature.admin.AttendanceAdminApi
import id.znetworks.nexus.feature.outlet.OutletApi
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.*
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test

class ReportApiTest {
    private lateinit var server: MockWebServer
    private lateinit var api: ApiClient
    @Before fun setup() {
        server = MockWebServer(); server.start()
        api = ApiClient(server.url("/"), ClientIdentity("0.1.6", 13, 36), { Session("t", "c", "u") }, mayCarrySession = { true })
    }
    @After fun cleanup() { server.close() }
    private fun response(body: String = "{}") { server.enqueue(MockResponse.Builder().code(200).body(body).build()) }
    private fun body(request: mockwebserver3.RecordedRequest) = NexusJson.parseToJsonElement(request.body!!.utf8())

    @Test fun socialMonthAndDayUseDocumentedPathsAndPut() = runTest {
        val social = SocialApi(api, "brand")
        response("""{"month":"2026-10","canRecord":true}""")
        assertTrue(social.month("2026-10").canRecord)
        assertEquals("/api/projects/brand/social-media?month=2026-10", server.takeRequest().target)
        response()
        val patch = buildJsonObject { put("worked", ""); put("platforms", buildJsonObject { put("instagram", buildJsonObject { put("likes", JsonNull) }) }) }
        social.put("days/2026-10-19", patch)
        val sent = server.takeRequest()
        assertEquals("PUT", sent.method); assertEquals("/api/projects/brand/social-media/days/2026-10-19", sent.target)
        assertEquals(patch, body(sent))
    }
    @Test fun outletConfigAndDayTargetsUseServerEndpoints() = runTest {
        val outlet = OutletApi(api)
        response(); outlet.config("outlet")
        assertEquals("/api/projects/outlet/outlet-sales/config", server.takeRequest().target)
        response(); val patch = buildJsonObject { put("date", "2026-10-19"); put("paxTarget", JsonNull) }
        outlet.put("outlet", "day-targets", patch)
        val sent = server.takeRequest(); assertEquals("PUT", sent.method)
        assertEquals("/api/projects/outlet/outlet-sales/day-targets", sent.target); assertEquals(patch, body(sent))
    }
    @Test fun employmentClearSendsNullAndDeductionsKeepTheAttendancePeriod() = runTest {
        val attendance = AttendanceAdminApi(api)
        response(); attendance.setEmployment("crew", null)
        val sent = server.takeRequest(); assertEquals("PATCH", sent.method)
        assertEquals("/api/attendance/employment-start", sent.target)
        assertEquals(buildJsonObject { put("userId", "crew"); put("date", JsonNull) }, body(sent))
        response(); attendance.deductions("2026-11", "crew")
        assertEquals("/api/attendance/deductions?month=2026-11&userId=crew", server.takeRequest().target)
        response(); attendance.clearDeduction("crew", "2026-10-28")
        val clear = server.takeRequest(); assertEquals("POST", clear.method)
        assertEquals("/api/attendance/override", clear.target)
        assertEquals(buildJsonObject { put("userId", "crew"); put("date", "2026-10-28"); put("action", "CLEAR_PENALTY") }, body(clear))
    }
}
