package id.znetworks.nexus.feature.legal

import id.znetworks.nexus.core.net.NexusJson
import org.junit.Assert.*
import org.junit.Test

class LegalPageLayoutTest {
    @Test fun pageTypographyAndTableCellsSurviveDecoding() {
        val body = NexusJson.decodeFromString(LgParagraphs.serializer(), """{
          "page":{"width":595.3,"marginLeft":72,"marginRight":54,"marginTop":50,"font":"Times New Roman","size":11},
          "paragraphs":[{"index":0,"text":"","editable":true},
          {"index":1,"text":"Clause","editable":true,"layout":{"align":"justify","indentLeft":24,"hanging":12,"marker":"(1)","runs":[{"text":"Clause","b":true,"u":true}]}},
          {"index":2,"text":"A","layout":{"cell":{"table":0,"row":0,"col":0}}},
          {"index":3,"text":"B","layout":{"cell":{"table":0,"row":0,"col":1}}},
          {"index":4,"text":"More in B","layout":{"cell":{"table":0,"row":0,"col":1}}},
          {"index":5,"text":"After table"}] }""")
        assertEquals(54.0, body.page!!.marginRight, 0.0)
        assertEquals("Times New Roman", body.page!!.font)
        assertTrue(body.paragraphs.first().isBlank)
        assertTrue(body.paragraphs[1].layout!!.runs!!.first().u)
        assertEquals(listOf(1, 1, 3, 1), LegalPageBlocks.of(body.paragraphs).map { it.size })
        assertEquals(1, body.paragraphs[4].layout!!.cell!!.col)
    }

    @Test fun oldServersStillDecodeWithoutPageOrLayout() {
        val body = NexusJson.decodeFromString(LgParagraphs.serializer(), """{"paragraphs":[{"index":0,"text":"Old"}]}""")
        assertNull(body.page); assertNull(body.paragraphs.first().layout)
    }
}
