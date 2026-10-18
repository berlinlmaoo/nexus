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
}
