package id.znetworks.nexus.feature.attendance.history

import id.znetworks.nexus.core.net.ApiClient
import id.znetworks.nexus.core.net.ClientIdentity
import id.znetworks.nexus.core.net.NexusJson
import id.znetworks.nexus.core.session.Session
import id.znetworks.nexus.feature.attendance.requests.Attachment
import kotlinx.coroutines.test.runTest
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import org.junit.Assert.*
import org.junit.Test

class OverrideEvidenceTest {
    @Test fun transitionMatrix() {
        val states = listOf(
            HistoryRow() to "NONE",
            HistoryRow(recordKind = "ABSENT") to "ABSENT",
            HistoryRow(checkInAt = "now") to "PRESENT",
            HistoryRow(requestType = "PERMIT", requestStatus = "APPROVED", checkInAt = "now") to "PERMIT",
            HistoryRow(requestType = "SICK", requestStatus = "APPROVED") to "SICK",
            HistoryRow(requestType = "LEAVE", requestStatus = "APPROVED") to "LEAVE",
            HistoryRow(requestType = "RED_DATE", requestStatus = "APPROVED") to "DAY_OFF",
        )
        states.forEach { (row, from) ->
            assertEquals(from, OverrideEvidence.from(row))
            assertEquals("SICK_NOTE", OverrideEvidence.asked(row, "SICK"))
            assertEquals("PERMIT_EVIDENCE", OverrideEvidence.asked(row, "PERMIT"))
            assertEquals(if (from in setOf("NONE", "ABSENT", "PERMIT")) "PRESENT_EVIDENCE" else null, OverrideEvidence.asked(row, "PRESENT"))
            listOf("LEAVE", "DAY_OFF", "CLEAR_PENALTY", "TK").forEach { assertNull(OverrideEvidence.asked(row, it)) }
        }
        assertEquals("PRESENT", OverrideEvidence.from(HistoryRow(checkInAt = "now", requestType = "SICK", requestStatus = "APPROVED")))
        assertEquals("ABSENT", OverrideEvidence.from(HistoryRow(requestType = "DAY_OFF", requestStatus = "APPROVED", notes = "Auto: alpha")))
        assertEquals("NONE", OverrideEvidence.from(HistoryRow(requestType = "PERMIT", requestStatus = "PENDING")))
    }

    @Test fun optionalJsonAndMultipartCustomTimes() = runTest {
        val server = MockWebServer(); server.start()
        try {
            val api = HistoryApi(ApiClient(server.url("/"), ClientIdentity("0.1.6", 13, 30), { Session("t", "c", "u") }, mayCarrySession = { true }))
            fun reply() = server.enqueue(MockResponse.Builder().code(200).body("""{"ok":true,"evidenceAsked":"PRESENT_EVIDENCE","evidenceMissing":true}""").build())
            reply()
            assertTrue(api.override("u", "2026-10-20", "PRESENT").evidenceMissing)
            val plain = server.takeRequest()
            assertEquals("/api/attendance/override", plain.url.encodedPath)
            assertTrue(plain.headers["Content-Type"]!!.startsWith("application/json"))
            assertFalse(plain.body!!.utf8().contains("checkOutAt"))
            reply()
            api.override("u", "2026-10-20", "PRESENT", checkInAt = "2026-10-20T02:00:00Z", checkOutAt = "")
            assertTrue(server.takeRequest().body!!.utf8().contains("\"checkOutAt\":null"))
            reply()
            api.override("u", "2026-10-20", "PRESENT", evidence = Attachment("%PDF-test".toByteArray(), "note.pdf", "application/pdf"), checkInAt = "2026-10-20T02:00:00Z", checkOutAt = "")
            val upload = server.takeRequest()
            assertTrue(upload.headers["Content-Type"]!!.startsWith("multipart/form-data"))
            val body = upload.body!!.utf8()
            assertTrue(body.contains("name=\"evidence\"; filename=\"note.pdf\""))
            assertTrue(body.contains("Content-Type: application/pdf"))
            assertTrue(body.contains("name=\"checkOutAt\"\r\nContent-Length: 0\r\n\r\n\r\n") || body.contains("name=\"checkOutAt\"\r\n\r\n\r\n"))
            assertFalse(body.contains("supportingDocument"))
        } finally { server.close() }
    }

    @Test fun additiveEvidenceFieldsDecodeAndOldRowsRemainValid() {
        assertFalse(NexusJson.decodeFromString(HistoryRow.serializer(), "{}").evidenceMissing)
        val row = NexusJson.decodeFromString(HistoryRow.serializer(), """{"correctionEvidenceUrl":"/api/files/attendance/requests/override-a.pdf","correctionEvidenceName":"a.pdf","correctionEvidenceMissing":false,"evidenceMissing":true}""")
        assertEquals("a.pdf", row.correctionEvidenceName)
        assertTrue(row.evidenceMissing)
    }
}
