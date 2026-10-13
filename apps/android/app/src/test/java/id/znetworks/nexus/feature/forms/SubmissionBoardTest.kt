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

    @Test fun boardLikeTheWeb() {
        val todo = SubmissionColumn("todo:to do", "To Do", "gray", "todo", projectIds = listOf("fm"))
        val prog = SubmissionColumn("in_progress:on progress", "On Progress", "yellow", "in_progress", projectIds = listOf("fm"))
        val done = SubmissionColumn("complete:done", "Done", "green", "complete", projectIds = listOf("fm"))
        val mm = SubmissionColumn("todo:brief", "Brief", null, "todo", projectIds = listOf("mm"))
        fun sub(id: String, col: SubmissionColumn, kind: String, project: String, needs: Boolean = false) =
            Submission(id, projectId = project, projectName = project.uppercase(), column = col, kind = kind, needsAction = needs)
        val d = Submissions(listOf(sub("a", prog, "finance", "fm"), sub("b", done, "finance", "fm", needs = true), sub("c", mm, "multimedia", "mm")),
            columns = listOf(todo, prog, done, mm))
        val all = SubmissionBoard.board(d, null, null, false, "New")
        assertEquals(listOf("To Do", "On Progress", "Done", "Brief"), all.columns.map { it.first.name })
        assertEquals(setOf("finance", "multimedia"), all.kinds)
        assertEquals(1, all.needCount)
        // Finance only: no multimedia columns; empty To Do of the finance project stays.
        val fin = SubmissionBoard.board(d, "finance", null, false, "New")
        assertEquals(listOf("To Do", "On Progress", "Done"), fin.columns.map { it.first.name })
        assertEquals(listOf("b"), SubmissionBoard.board(d, null, null, true, "New").columns.flatMap { it.second }.map { it.id })
        // A remembered project that has nothing any more is ignored.
        assertEquals(null, SubmissionBoard.board(d, null, "gone", false, "New").project)
        assertEquals(listOf("c"), SubmissionBoard.board(d, null, "mm", false, "New").columns.flatMap { it.second }.map { it.id })
        assertEquals("yellow", SubmissionBoard.colorKey(prog)); assertEquals("gray", SubmissionBoard.colorKey(mm))
    }
}
