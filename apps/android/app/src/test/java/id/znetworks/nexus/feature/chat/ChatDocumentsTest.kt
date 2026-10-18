package id.znetworks.nexus.feature.chat

import id.znetworks.nexus.core.net.NexusJson
import org.junit.Assert.*
import org.junit.Test

class ChatDocumentsTest {
    @Test fun onlyServerSupportedDocumentsWithinSizeLimit() {
        assertTrue(ChatDocuments.accepts("Report.PDF", ChatDocuments.MAX_BYTES))
        assertTrue(ChatDocuments.accepts("Budget.xlsx", 1024))
        assertFalse(ChatDocuments.accepts("Empty.txt", 0))
        assertFalse(ChatDocuments.accepts("Large.zip", ChatDocuments.MAX_BYTES + 1))
        assertFalse(ChatDocuments.accepts("Script.exe", 100))
        assertTrue(ChatDocuments.accepts("Photo.PNG", ChatDocuments.MAX_IMAGE_BYTES))
        assertTrue(ChatDocuments.accepts("Animated.gif", 1024))
        assertFalse(ChatDocuments.accepts("Photo.jpg", ChatDocuments.MAX_IMAGE_BYTES + 1))
    }
    @Test fun metadataAndOldMessagesDecode() {
        val m = NexusJson.decodeFromString(Message.serializer(), """{"id":"a","content":"","attachmentUrl":"/api/files/a.pdf","attachmentType":"application/pdf","attachmentKind":"file","attachmentName":"Report.pdf","attachmentSize":1234}""")
        assertFalse(m.isImage); assertEquals("Report.pdf", m.attachmentName); assertEquals(1234L, m.attachmentSize)
        assertNull(NexusJson.decodeFromString(Message.serializer(), """{"id":"old"}""").attachmentName)
    }
    @Test fun replyAndDocsTabKeepDocumentMetadata() {
        val reply = NexusJson.decodeFromString(ReplyRef.serializer(), """{"id":"r","attachmentType":"application/pdf","attachmentName":"Contract.pdf","attachmentSize":321}""")
        assertEquals("Contract.pdf", reply.attachmentName); assertEquals(321L, reply.attachmentSize)
        val doc = NexusJson.decodeFromString(ChatMediaItem.serializer(), """{"name":"Budget.xlsx","size":123}""")
        assertEquals("Budget.xlsx", doc.name); assertEquals(123L, doc.size)
    }
    @Test fun documentQuotesUseTheNameAndPhotosKeepTheirOwnPreview() {
        assertEquals("📎 Budget.xlsx", ChatDocuments.preview("application/vnd.ms-excel", "Budget.xlsx", "Files"))
        assertEquals("📎 Files", ChatDocuments.preview("application/pdf", null, "Files"))
        assertNull(ChatDocuments.preview("image/png", "Photo.png", "Files"))
        assertNull(ChatDocuments.preview(null, null, "Files"))
    }
}
