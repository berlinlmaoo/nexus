package id.znetworks.nexus.feature.admin

import id.znetworks.nexus.core.net.NexusJson
import id.znetworks.nexus.feature.inbox.AnnouncementsResponse
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

// Batch 2 C (Berlin 29 Sep; server cff1575 AS BUILT, iOS 78bfe37): targeted announcements and SP PDFs.
class AnnouncementBatch2Test {
    @Test fun bodyForEveryoneStaysAsBefore() {
        val b = AnnounceRules.body("T", " B ", "info", 0, "09:00")
        assertEquals(setOf("title", "body", "tone"), b.keys)
    }

    @Test fun selectedPeopleAndPdfMakeAnSp() {
        val b = AnnounceRules.body("SP 1", "Body", "warning", 0, "09:00", listOf("u1", "u2", "u1"), AnnounceAttachment("/api/files/attachments/announcements/1-a.pdf", "SP1.pdf", 10))
        assertEquals(listOf("u1", "u2"), b["targetUserIds"]!!.jsonArray.map { it.jsonPrimitive.content })
        assertEquals("sp", b["kind"]!!.jsonPrimitive.content)
        assertEquals("SP1.pdf", b["attachmentName"]!!.jsonPrimitive.content)
        assertEquals("/api/files/attachments/announcements/1-a.pdf", b["attachmentUrl"]!!.jsonPrimitive.content)
    }

    @Test fun postNeedsTitleBodyAndSomeoneWhenSelected() {
        assertEquals(AnnounceRules.Missing.TITLE, AnnounceRules.missing(" ", "b", true, emptySet()))
        assertEquals(AnnounceRules.Missing.BODY, AnnounceRules.missing("t", "", true, emptySet()))
        assertEquals(AnnounceRules.Missing.PEOPLE, AnnounceRules.missing("t", "b", false, emptySet()))
        assertNull(AnnounceRules.missing("t", "b", false, setOf("u")))
    }

    @Test fun rosterSearchAndOrder() {
        val m = listOf(WsMember("1", "u1", name = "Zed"), WsMember("2", "u2", name = "ana", email = "ana@z.id"), WsMember("3", "", name = "No account"))
        assertEquals(listOf("u2", "u1"), AnnounceRules.rosterRows(m, "").map { it.userId })
        assertEquals(listOf("u2"), AnnounceRules.rosterRows(m, "@Z.ID").map { it.userId })
    }

    @Test fun listAndPopUpParse() {
        val admin = NexusJson.decodeFromString(Announcements.serializer(), """{"announcements":[{"id":"a","title":"SP","body":"b","active":true,"kind":"sp",
            "attachmentUrl":"/api/files/x.pdf","attachmentName":"SP.pdf","targets":[{"id":"u1","name":"Ana"}],"targetUserIds":["u1"],"targetCount":1}]}""").announcements.single()
        assertEquals("sp", admin.kind); assertEquals("Ana", admin.targets.single().name)
        val pop = NexusJson.decodeFromString(AnnouncementsResponse.serializer(), """{"announcements":[{"id":"w","title":"Attendance warning","body":"m",
            "kind":"warning","imageUrl":"/api/files/s.jpg","attachmentUrl":null,"attachmentName":null,"targeted":true}]}""").announcements.single()
        assertEquals("warning", pop.kind); assertTrue(pop.targeted == true); assertNull(pop.attachmentUrl)
        assertFalse(NexusJson.decodeFromString(AnnouncementsResponse.serializer(), """{"announcements":[{"id":"x"}]}""").announcements.single().targeted == true)
    }
}
