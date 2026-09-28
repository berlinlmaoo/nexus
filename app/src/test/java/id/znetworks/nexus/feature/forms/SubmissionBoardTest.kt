package id.znetworks.nexus.feature.forms

import org.junit.Assert.assertEquals
import org.junit.Test

class SubmissionBoardTest {
    private fun sub(id: String, status: String?) = Submission(id, procStatus = status)

    // UI point 4 (iOS SubmissionsView): ours first, then the server's columns, nothing dropped.
    @Test fun columnsKeepEverySubmission() {
        val d = Submissions(listOf(sub("a", null), sub("b", "On Progress"), sub("c", " Done "), sub("d", "Archived"), sub("e", "")),
            statusColumns = listOf("On Progress", "Done", "Rejected"))
        val cols = SubmissionBoard.columns(d, "New")
        assertEquals(listOf("New", "On Progress", "Done", "Rejected", "Archived"), cols.map { it.first })
        assertEquals(listOf("a", "e"), cols[0].second.map { it.id })
        assertEquals(listOf("c"), cols[2].second.map { it.id })
        assertEquals(0, cols[3].second.size)
        assertEquals(5, cols.sumOf { it.second.size })
    }

    @Test fun tonesAsIos() {
        assertEquals(SubmissionBoard.Tone.BLUE, SubmissionBoard.tone("On Progress"))
        assertEquals(SubmissionBoard.Tone.SUCCESS, SubmissionBoard.tone("Done"))
        assertEquals(SubmissionBoard.Tone.SUCCESS, SubmissionBoard.tone("Sudah dibayar (paid)"))
        assertEquals(SubmissionBoard.Tone.DANGER, SubmissionBoard.tone("Ditolak"))
        assertEquals(SubmissionBoard.Tone.MUTED, SubmissionBoard.tone("New"))
    }
}
