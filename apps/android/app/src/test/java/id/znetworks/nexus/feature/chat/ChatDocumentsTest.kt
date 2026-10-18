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
    }
    @Test fun metadataAndOldMessagesDecode() {
        val m = NexusJson.decodeFromString(Message.serializer(), """{"id":"a","content":"","attachmentUrl":"/api/files/a.pdf","attachmentType":"application/pdf","attachmentKind":"file","attachmentName":"Report.pdf","attachmentSize":1234}""")
        assertFalse(m.isImage); assertEquals("Report.pdf", m.attachmentName); assertEquals(1234L, m.attachmentSize)
        assertNull(NexusJson.decodeFromString(Message.serializer(), """{"id":"old"}""").attachmentName)
    }
}
