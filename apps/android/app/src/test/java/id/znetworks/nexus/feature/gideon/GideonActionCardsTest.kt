package id.znetworks.nexus.feature.gideon

import id.znetworks.nexus.core.net.NexusJson
import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Test
import java.util.Locale

class GideonActionCardsTest {
    @Test fun outwardActionsEchoTheReviewedProposalOnlyOnApply() {
        val proposal = GProposal("proposal-id", action = "send_message", extra = GExtra(preview = "full\nmessage"))
        assertEquals("proposal-id", GideonReview.body(true, proposal = proposal)["confirm"]!!.jsonObject["proposalId"]!!.jsonPrimitive.content)
        assertNull(GideonReview.body(false, proposal = proposal)["confirm"])
        assertNull(GideonReview.body(true, proposal = GProposal("old", action = "update_task"))["confirm"])
    }

    @Test fun deleteEchoesTheTaskRatherThanAGenericProposalConfirmation() {
        val p = GProposal("proposal", action = "delete_task", taskDelete = GTaskDelete("task-uuid"))
        assertEquals("task-uuid", GideonReview.body(true, proposal = p)["confirm"]!!.jsonObject["taskId"]!!.jsonPrimitive.content)
        assertNull(GideonReview.body(false, proposal = p)["confirm"])
    }

    @Test fun chosenTaskTargetSendsSectionMembersAndNullableDueDate() {
        val choice = GTaskChoice("project", "section", listOf("member"), null)
        val task = GideonReview.body(true, proposal = GProposal("p", action = "create_task"), task = choice)["task"]!!.jsonObject
        assertEquals("project", task["projectId"]!!.jsonPrimitive.content)
        assertEquals("section", task["taskListId"]!!.jsonPrimitive.content)
        assertEquals(listOf("member"), task["assigneeIds"]!!.jsonArray.map { it.jsonPrimitive.content })
        assertNull(GideonReview.body(false, task = choice)["task"])
    }

    @Test fun richCardsKeepMultilinePreviewAndCellBeforeAfterValues() {
        val p = NexusJson.decodeFromString(GProposal.serializer(), """{"id":"p","action":"edit_sheet_cells","extra":{"preview":"line one\nline two","sheetEdit":{"cells":[{"ref":"B2","from":0,"to":"New\nvalue"}],"newRows":[["Next"]]}},"diff":[{"field":"When","to":"2026-10-20 18:00","toDay":"2026-10-20"}]}""")
        assertEquals("line one\nline two", p.extra!!.preview)
        assertEquals("0", GideonReview.loose(p.extra.sheetEdit!!.cells.single().from))
        assertEquals("New\nvalue", GideonReview.loose(p.extra.sheetEdit.cells.single().to))
        assertEquals("Tue 20 Oct 18:00", actionDay(p.diff.single().toText, p.diff.single().toDay, Locale.ENGLISH))
        assertEquals("Tue 20 Oct 18:00 WIB", actionDay("tomorrow 18:00 WIB", "2026-10-20", Locale.ENGLISH))
    }
}
