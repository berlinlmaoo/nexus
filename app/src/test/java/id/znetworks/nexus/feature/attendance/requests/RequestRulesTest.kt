package id.znetworks.nexus.feature.attendance.requests

import id.znetworks.nexus.core.net.ApiClient
import id.znetworks.nexus.core.net.ClientIdentity
import id.znetworks.nexus.core.session.Session
import id.znetworks.nexus.feature.attendance.AnnualLeave
import id.znetworks.nexus.feature.attendance.AttendanceToday
import id.znetworks.nexus.feature.attendance.requests.RequestRules.Missing
import kotlinx.coroutines.test.runTest
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant
import java.time.LocalDate

class RequestRulesTest {
    // 24 Sep 2026, 10:00 WIB
    private val now = Instant.parse("2026-09-24T03:00:00Z")
    private val todayWib = LocalDate.of(2026, 9, 24)

    private fun today(dayOffUsed: Int = 1, redQuota: Int = 0, leave: AnnualLeave? = null) = AttendanceToday(
        dayOffQuota = 4, dayOffUsedThisMonth = dayOffUsed, redDateQuota = redQuota, redDateUsedThisMonth = 0, annualLeave = leave,
    )

    @Test fun offersOnlyWhatCanBeFiled() {
        assertEquals(listOf("SICK", "PERMIT", "DAY_OFF"), RequestRules(today(), false).types)
        val all = RequestRules(today(redQuota = 1, leave = AnnualLeave(eligible = true, remaining = 7, quota = 12)), false).types
        assertEquals(listOf("LEAVE", "SICK", "PERMIT", "DAY_OFF", "RED_DATE"), all)
        // Eligible but nothing left: not offered.
        assertFalse("LEAVE" in RequestRules(today(leave = AnnualLeave(eligible = true, remaining = 0)), false).types)
    }

    @Test fun permitNeverBackdatedSickMayBe() {
        val r = RequestRules(today(), false)
        assertEquals(todayWib, r.earliest("PERMIT", now))
        assertNull(r.earliest("SICK", now))
        assertEquals(Missing.DATE, r.missing("PERMIT", "shooting konten", true, true, todayWib.minusDays(1), now))
        assertNull(r.missing("SICK", "demam tinggi", true, false, todayWib.minusDays(1), now))
    }

    @Test fun permitNeedsPhotoAndLocation() {
        val r = RequestRules(today(), false)
        assertEquals(Missing.ATTACHMENT, r.missing("PERMIT", "survey lokasi", false, true, todayWib, now))
        assertEquals(Missing.LOCATION, r.missing("PERMIT", "survey lokasi", true, false, todayWib, now))
        assertNull(r.missing("PERMIT", "survey lokasi", true, true, todayWib, now))
        assertEquals(Missing.ATTACHMENT, r.missing("SICK", "demam", false, false, todayWib, now))
        assertNull(r.missing("DAY_OFF", "istirahat", false, false, todayWib, now))
    }

    @Test fun zeroDayOffLeftBlockedBeforeSubmit() {
        val r = RequestRules(today(dayOffUsed = 4), false)
        assertTrue(r.quotaExhausted("DAY_OFF"))
        assertEquals(Missing.QUOTA, r.missing("DAY_OFF", "istirahat", false, false, todayWib, now))
        // BoD filing their own is charged the same.
        assertEquals(Missing.QUOTA, RequestRules(today(dayOffUsed = 4), true).missing("DAY_OFF", "x y z", false, false, todayWib, now))
    }

    @Test fun reasonAtLeastThreeAndNotJustThePrefill() {
        val r = RequestRules(today(), false)
        assertEquals(Missing.REASON, r.missing("DAY_OFF", "  ab ", false, false, todayWib, now))
        assertEquals(Missing.REASON, r.missing("PERMIT", "Out-of-office activity: ", true, true, todayWib, now, "Out-of-office activity: "))
    }

    @Test fun bodSkipsSelfFiledEvidenceRules() {
        val r = RequestRules(today(), true)
        assertNull(r.earliest("PERMIT", now))
        assertNull(r.missing("PERMIT", "event", false, false, todayWib.minusDays(3), now))
    }

    // Berlin 29 Sep (server, iOS 22c4ecb): a sick day filed by yourself always needs the note, BoD too.
    @Test fun sickNoteRequiredForBoDToo() {
        val bod = RequestRules(today(), true)
        assertTrue(bod.attachmentRequired("SICK"))
        assertEquals(Missing.ATTACHMENT, bod.missing("SICK", "demam", false, false, todayWib, now))
        assertNull(bod.missing("SICK", "demam", true, false, todayWib, now))
        assertFalse(bod.attachmentRequired("PERMIT"))
    }

    @Test fun cameraNamesByType() {
        val r = RequestRules(today(), false)
        assertEquals("sick-note.jpg", r.cameraFileName("SICK"))
        assertEquals("permit-photo.jpg", r.cameraFileName("PERMIT"))
    }

    private fun req(id: String, status: String, start: String, reviewedAt: String? = null, name: String = "Dési", updatedAt: String? = null) =
        SubmissionEntry.Req(AttendanceRequest(id, status = status, startDate = start, reviewedAt = reviewedAt, updatedAt = updatedAt,
            reason = "ke dokter gigi", user = PersonRef(name = name)))

    @Test fun pendingFirstAndNeverCutByDate() {
        val list = listOf(
            req("old-pending", "PENDING", "2026-09-01T00:00:00.000Z"),
            req("approved-now", "APPROVED", "2026-12-01T00:00:00.000Z", reviewedAt = "2026-09-24T02:00:00.000Z"),
            req("approved-old", "APPROVED", "2026-09-20T00:00:00.000Z", reviewedAt = "2026-09-10T02:00:00.000Z"),
        )
        val all = SubmissionFilter.apply(list, "ALL", SubmissionWindow.RECENT, "", todayWib)
        assertEquals(listOf("req-old-pending", "req-approved-now"), all.map { it.id })
        val period = SubmissionFilter.apply(list, "APPROVED", SubmissionWindow.PERIOD, "", todayWib)
        assertEquals(listOf("req-approved-now", "req-approved-old"), period.map { it.id }) // newest decision first
    }

    @Test fun searchIgnoresCaseAndAccents() {
        val list = listOf(req("a", "PENDING", "2026-09-24T00:00:00.000Z"), req("b", "PENDING", "2026-09-24T00:00:00.000Z", name = "Rifqi"))
        assertEquals(listOf("req-a"), SubmissionFilter.apply(list, "PENDING", SubmissionWindow.RECENT, "desi", todayWib).map { it.id })
        assertEquals(2, SubmissionFilter.apply(list, "PENDING", SubmissionWindow.RECENT, "GIGI", todayWib).size)
    }

    @Test fun autoDeductionAndOwnership() {
        val auto = AttendanceRequest("x", userId = "u1", approvalSource = "ADMIN", reason = "Auto: bolos")
        assertTrue(auto.isAutoDeduction)
        assertTrue(auto.isOwn("u1"))
        assertFalse(auto.isOwn("u2"))
    }

    @Test fun createSendsOneDateRealMimeAndLocation() = runTest {
        val server = MockWebServer().apply { start() }
        server.enqueue(MockResponse.Builder().code(201).body("""{"request":{"id":"r1"}}""").build())
        val api = RequestsApi(ApiClient(server.url("/"), ClientIdentity("0.1.6", 1, 30), { Session("t", "c", "u") }, mayCarrySession = { true }))
        api.create("PERMIT", "2026-09-24", "  survey  ", Attachment(byteArrayOf(1, 2), "permit\"photo.jpg", "image/jpeg"), -6.2, 106.8)
        val body = server.takeRequest().body!!.utf8()
        assertTrue(body.contains("name=\"startDate\"\r\nContent-Length: 10\r\n\r\n2026-09-24") || body.contains("2026-09-24"))
        assertEquals(2, Regex("2026-09-24").findAll(body).count()) // start == end
        assertTrue(body.contains("\r\n\r\nsurvey\r\n"))
        assertTrue(body.contains("filename=\"permitphoto.jpg\""))
        assertTrue(body.contains("Content-Type: image/jpeg"))
        assertTrue(body.contains("-6.2") && body.contains("106.8"))
        server.close()
    }
}
