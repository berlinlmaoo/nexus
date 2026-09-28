package id.znetworks.nexus.feature.attendance

import id.znetworks.nexus.core.net.ApiClient
import id.znetworks.nexus.core.net.ApiError
import id.znetworks.nexus.core.net.ClientIdentity
import id.znetworks.nexus.core.session.Session
import kotlinx.coroutines.test.runTest
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Before
import org.junit.Test

class AttendanceApiTest {
    private lateinit var server: MockWebServer
    private lateinit var api: AttendanceApi

    @Before fun setUp() {
        server = MockWebServer(); server.start()
        api = AttendanceApi(ApiClient(server.url("/"), ClientIdentity("0.1.6", 1, 30), { Session("t", "c", "u1") }, mayCarrySession = { true }))
    }
    @After fun tearDown() { server.close() }

    private fun reply(code: Int, body: String) = server.enqueue(MockResponse.Builder().code(code).body(body).build())
    private val fix = LocationFix(-6.2, 106.8166, accuracyM = 12.5, altitudeM = 30.0, speedMps = 0.0001, simulated = true)

    @Test fun liveCheckInSendsEvidenceButNoReplayStamp() = runTest {
        reply(201, """{"record":{"id":"r1","checkInAt":"2026-09-24T02:00:00.000Z"}}""")
        val out = api.checkIn(byteArrayOf(9, 9), fix, "tap-1") as AttendanceOutcome.Success
        assertEquals("r1", out.record?.id)
        val body = server.takeRequest().body!!.utf8()
        assertTrue(body.contains("\r\n\r\n-6.2\r\n"))
        assertTrue(body.contains("0.0001"))           // no 1.0E-4
        assertTrue(body.contains("name=\"simulated\"") && body.contains("\r\n\r\n1\r\n"))
        assertTrue(body.contains("name=\"clientId\""))
        assertTrue(body.contains("tap-1"))
        assertFalse(body.contains("deviceAt"))         // live tap: server clock, not flagged offline
        assertTrue(body.contains("filename=\"selfie.jpg\""))
        assertTrue(body.contains("Content-Type: image/jpeg"))
    }

    @Test fun replayCarriesDeviceAtAndUptime() = runTest {
        reply(200, """{"record":{"id":"r1"},"duplicate":true}""")
        val out = api.checkIn(byteArrayOf(1), fix, "tap-1", ReplayStamp(1_790_000_000_000, 4242)) as AttendanceOutcome.Success
        assertTrue(out.duplicate)
        val body = server.takeRequest().body!!.utf8()
        assertTrue(body.contains("2026-09-21T"))  // ISO-8601 UTC of the tap
        assertTrue(body.contains("4242"))
    }

    @Test fun checkInOutsideRadiusWithoutCodeIsTyped() = runTest {
        reply(422, """{"error":"You're outside…","officeName":"HQ","distanceMeters":340.4,"radiusMeters":150}""")
        val out = api.checkIn(byteArrayOf(1), fix, "x") as AttendanceOutcome.OutsideRadius
        assertEquals("HQ", out.officeName)
        assertEquals(340.4, out.distanceMeters!!, 0.01)
    }

    @Test fun checkOutOutsideRadiusAndOffsiteFields() = runTest {
        reply(422, """{"error":"x","code":"OUTSIDE_RADIUS","officeName":"HQ","distanceMeters":900,"radiusMeters":100}""")
        assertTrue(api.checkOut(byteArrayOf(1), fix, "  refleksi  ", offsite = false, reason = null, clientId = "c") is AttendanceOutcome.OutsideRadius)
        val first = server.takeRequest().body!!.utf8()
        assertTrue(first.contains("\r\n\r\nrefleksi\r\n")) // trimmed
        assertFalse(first.contains("name=\"offsite\""))

        reply(200, """{"record":{"id":"r"},"pendingApproval":true}""")
        val ok = api.checkOut(byteArrayOf(1), fix, "r", offsite = true, reason = "shoot", clientId = "c2") as AttendanceOutcome.Success
        assertTrue(ok.pendingApproval)
        val second = server.takeRequest().body!!.utf8()
        assertTrue(second.contains("name=\"offsite\"") && second.contains("shoot"))
    }

    @Test fun otherRefusalsStayErrors() = runTest {
        reply(409, """{"error":"You have already checked in today."}""")
        try { api.checkIn(byteArrayOf(1), fix, "x"); fail() } catch (e: ApiError.Http) {
            assertEquals("You have already checked in today.", e.serverMessage)
        }
        reply(422, """{"error":"Jatah terlampaui"}""") // a 422 that is not about distance
        try { api.checkIn(byteArrayOf(1), fix, "x"); fail() } catch (e: ApiError.Http) { assertEquals(422, e.status) }
    }

    @Test fun todayCarriesTheExtraDayOffAllowance() = runTest {
        reply(200, """{"dayOffQuota":7,"dayOffUsedThisMonth":1,"dayOffAllowance":{"period":"2026-10","base":4,"bonus":3,"grants":[{"days":3,"reason":"Lembur event"}]}}""")
        val t = api.today()
        assertEquals(7, t.dayOffQuota) // already the raised figure
        assertEquals(3, t.dayOffAllowance?.bonus)
        assertEquals(4, t.dayOffAllowance?.base)
    }

    @Test fun todayToleratesUnknownAndMissingFields() = runTest {
        reply(200, """{"attendanceDateKey":"2026-09-24","today":null,"myShift":{"startTime":"09:00","endTime":"18:00","flexi":false,"new":1},"dayOffQuota":4,"somethingNew":[1,2]}""")
        val t = api.today()
        assertEquals("09:00", t.myShift?.startTime)
        assertEquals(4, t.dayOffQuota)
    }
}
