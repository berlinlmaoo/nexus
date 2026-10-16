package id.znetworks.nexus.feature.admin

import id.znetworks.nexus.R
import id.znetworks.nexus.core.net.ApiError
import id.znetworks.nexus.core.net.NexusJson
import id.znetworks.nexus.feature.attendance.history.BoardModel
import id.znetworks.nexus.feature.attendance.history.HistoryResponse
import id.znetworks.nexus.feature.auth.LoginErrors
import id.znetworks.nexus.feature.projects.UserRef
import id.znetworks.nexus.feature.reports.ReportRoster
import id.znetworks.nexus.ui.components.LeftAt
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.time.LocalDate

/** ANDROID-OFFBOARD (owner, 8 Oct; OFFBOARD-CONTRACT): mirror of the web. */
class OffboardTest {
    @Test fun adminUsersCarryTheExit() {
        val p = NexusJson.decodeFromString(AdminUsersPage.serializer(), """{"users":[
            {"id":"a","name":"Rina","deactivatedAt":"2026-10-08T09:00:00.000Z","formerMemberships":[{"workspaceId":"w","workspaceName":"Z Networks","leftAt":"2026-10-10T00:00:00.000Z","reason":"RESIGNED"}]},
            {"id":"b","name":"Signed up only"}],"pagination":{"total":2,"page":1,"pageSize":50,"totalPages":1}}""")
        assertEquals("2026-10-10T00:00:00.000Z", p.users[0].leftAt)
        assertNull(p.users[1].deactivatedAt)
        assertEquals(1, p.pagination.totalPages)
    }

    @Test fun offboardResult() {
        val r = NexusJson.decodeFromString(OffboardResult.serializer(), """{"ok":true,"user":{"id":"a","name":"Rina"},"leftAt":"2026-10-10T00:00:00.000Z",
            "lastWorkingDay":"2026-10-10","workspaces":["Z Networks"],"approverEdgesCleared":[{"id":"x","name":"Doni"}],"pendingRequests":2,"autoDeductionsCanceled":1,"openTasks":5}""")
        assertEquals(listOf("Doni"), r.approverEdgesCleared.map { it.name })
        assertEquals(5, r.openTasks)
    }

    @Test fun eachRefusalHasTheAppsText() {
        fun http(code: String?, status: Int = 400) = ApiError.Http(status, "Teks server", code, null)
        assertEquals(R.string.off_err_self, Offboarding.errorRes(http("SELF")))
        assertEquals(R.string.off_err_rank, Offboarding.errorRes(http("RANK", 403)))
        assertEquals(R.string.off_err_forbidden, Offboarding.errorRes(http("FORBIDDEN", 403)))
        assertEquals(R.string.off_err_bad_date, Offboarding.errorRes(http("BAD_DATE")))
        assertEquals(R.string.off_err_not_member, Offboarding.errorRes(http("NOT_MEMBER")))
        assertEquals(R.string.off_err_already, Offboarding.errorRes(http("ALREADY_OFFBOARDED", 409)))
        assertEquals(R.string.off_err_not_offboarded, Offboarding.errorRes(http("NOT_OFFBOARDED", 409)))
        // Unknown codes (NOT_FOUND, BAD_REASON, …) show the server's text, as the web.
        assertNull(Offboarding.errorRes(http("BAD_REASON")))
        assertTrue(Offboarding.hasAttendanceData(http("HAS_ATTENDANCE_DATA", 409)))
        assertFalse(Offboarding.hasAttendanceData(http(null, 409)))
    }

    @Test fun lastWorkingDayRules() {
        val today = LocalDate.of(2026, 10, 8)
        // joinedAt is an instant; the Jakarta date counts (17:30 UTC on the 1st = the 2nd in Jakarta).
        val joined = Offboarding.joinedDay("2026-10-01T17:30:00.000Z")
        assertEquals(LocalDate.of(2026, 10, 2), joined)
        assertTrue(Offboarding.dayValid(today, today, joined))
        assertFalse(Offboarding.dayValid(today.plusDays(1), today, joined))
        assertFalse(Offboarding.dayValid(LocalDate.of(2026, 10, 1), today, joined))
        assertTrue(Offboarding.dayValid(LocalDate.of(2020, 1, 1), today, null))
        assertEquals(listOf("RESIGNED", "CONTRACT_ENDED", "DISMISSED", "OTHER"), Offboarding.REASONS)
    }

    @Test fun leftAtIsTheDateItSays() {
        // 00:00 UTC of the Jakarta date: never shifted by a zone.
        assertEquals(LocalDate.of(2026, 10, 10), LeftAt.date("2026-10-10T00:00:00.000Z"))
        assertEquals(LocalDate.of(2026, 10, 10), LeftAt.date("2026-10-10"))
        assertNull(LeftAt.date(null)); assertNull(LeftAt.date("soon"))
    }

    @Test fun deactivatedSignIn() {
        val body = JsonObject(mapOf("error" to JsonPrimitive("AccountDeactivated"), "message" to JsonPrimitive("Akun ini sudah dinonaktifkan.")))
        assertTrue(LoginErrors.deactivated(ApiError.Http(401, "Akun ini sudah dinonaktifkan.", null, body)))
        assertFalse(LoginErrors.deactivated(ApiError.Http(401, "Invalid credentials", null, JsonObject(mapOf("error" to JsonPrimitive("Invalid credentials"))))))
        assertFalse(LoginErrors.deactivated(ApiError.Http(403, null, null, body)))
    }

    @Test fun recapsMarkWhoLeft() {
        val h = NexusJson.decodeFromString(HistoryResponse.serializer(), """{"records":[
            {"id":"r1","attendanceDate":"2026-10-01T00:00:00.000Z","checkInAt":"2026-10-01T01:00:00.000Z","user":{"id":"a","name":"Rina","leftAt":"2026-10-03T00:00:00.000Z"}}],
            "roster":[{"id":"a","name":"Rina","leftAt":"2026-10-03T00:00:00.000Z"},{"id":"b","name":"Doni"}]}""")
        val board = BoardModel.members(h.records, "v", "Viewer", h.roster)
        assertEquals("2026-10-03T00:00:00.000Z", board.first { it.id == "a" }.leftAt)
        assertNull(board.first { it.id == "b" }.leftAt)
        val rep = NexusJson.decodeFromString(ReportRoster.serializer(), """{"rows":[{"userId":"a","name":"Rina","leftAt":"2026-10-03"}]}""")
        assertEquals("2026-10-03", rep.rows[0].leftAt)
        assertEquals("2026-10-08T09:00:00.000Z", NexusJson.decodeFromString(UserRef.serializer(), """{"id":"a","deactivatedAt":"2026-10-08T09:00:00.000Z"}""").deactivatedAt)
    }

    @Test fun stringsInBothLanguagesOnce() {
        val en = File("src/main/res/values/strings.xml").readText()
        val id = File("src/main/res/values-in/strings.xml").readText()
        listOf("off_deactivated", "off_has_attendance", "off_left_on", "off_reinstate_not", "off_task_left").forEach { k ->
            assertEquals(k, 1, Regex("name=\"$k\"").findAll(en).count())
            assertEquals(k, 1, Regex("name=\"$k\"").findAll(id).count())
        }
        assertTrue(id.contains("Akun ini sudah dinonaktifkan."))
    }
}
