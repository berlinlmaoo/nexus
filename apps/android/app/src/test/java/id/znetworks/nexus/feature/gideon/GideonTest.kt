package id.znetworks.nexus.feature.gideon

import id.znetworks.nexus.core.net.NexusJson
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class GideonTest {
    private val dec = { s: String -> runCatching { NexusJson.parseToJsonElement(s).jsonObject }.getOrNull() }

    @Test fun textFramesAppendAndStopAtDone() {
        val raw = "data: {\"type\":\"text\",\"content\":\"Halo \"}\n\ndata: not-json\n\ndata: {\"type\":\"tool_result\"}\n\ndata: {\"type\":\"text\",\"content\":\"Budi\"}\n\n" +
            "data: {\"type\":\"done\"}\n\ndata: {\"type\":\"text\",\"content\":\"ignored\"}\n\n"
        val r = GideonRules.parse(raw, dec)
        assertEquals("Halo Budi", r.text); assertNull(r.error)
    }

    @Test fun errorFrameIsTheSentence() {
        val r = GideonRules.parse("data: {\"type\":\"error\",\"content\":\"Kuota habis.\"}\n\ndata: {\"type\":\"done\"}\n", dec)
        assertEquals("", r.text); assertEquals("Kuota habis.", r.error)
    }

    @Test fun documentTypes() {
        assertTrue(GideonRules.acceptsDocument("Laporan Q3.XLSX"))
        assertFalse(GideonRules.acceptsDocument("video.mp4"))
        assertNull(GideonRules.parse("", dec).error)
    }
}
