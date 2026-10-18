package id.znetworks.nexus.feature.inbox

import org.junit.Assert.assertEquals
import org.junit.Test

class InboxLegacyTextTest {
    @Test fun legacyTemplatesKeepNamesAndTaskContent() {
        assertEquals("New legal request from QA Dev 6", InboxLegacyText.translate("New legal request from QA Dev 6", "en"))
        assertEquals("Permintaan Legal baru dari QA Dev 6", InboxLegacyText.translate("New legal request from QA Dev 6", "id"))
        assertEquals("QA Dev 4 menugaskan kamu: Keep English task", InboxLegacyText.translate("QA Dev 4 assigned you: Keep English task", "id"))
        assertEquals("QA Dev 4 menugaskan kamu \"Keep task\"", InboxLegacyText.translate("QA Dev 4 assigned you \"Keep task\"", "id"))
        assertEquals("Unrecognized content", InboxLegacyText.translate("Unrecognized content", "id"))
    }

    @Test fun serverTranslationWins() {
        val row = InboxItem("id", rawTitle = "New legal request from Example", texts = mapOf("id" to InboxText("Server wording")))
        assertEquals("Server wording", row.title("id"))
    }

    @Test fun legacyAssignmentBodyPreservesProjectName() {
        val row = InboxItem("id", type = "task_assigned", rawMessage = "In English Project")
        assertEquals("Di English Project", row.message("id"))
        assertEquals("In English Project", row.message("en"))
        assertEquals("QA berkomentar di: English task", InboxLegacyText.translate("QA commented on: English task", "id"))
    }

    @Test fun userContentIsNeverTranslatedAsANotificationTemplate() {
        val row = InboxItem("id", type = "comment", rawMessage = "QA assigned you: leave this quote intact")
        assertEquals(row.rawMessage, row.message("id"))
        val translated = row.copy(texts = mapOf("id" to InboxText(message = "Server body")))
        assertEquals("Server body", translated.message("id"))
    }
}
