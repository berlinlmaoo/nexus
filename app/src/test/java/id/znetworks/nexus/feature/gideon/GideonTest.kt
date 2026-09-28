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
        assertEquals("Halo Budi" to null, GideonRules.parse(raw, dec))
    }

    @Test fun errorFrameIsTheSentence() {
        val (t, e) = GideonRules.parse("data: {\"type\":\"error\",\"content\":\"Kuota habis.\"}\n\ndata: {\"type\":\"done\"}\n", dec)
        assertEquals("", t); assertEquals("Kuota habis.", e)
    }

    @Test fun documentTypes() {
        assertTrue(GideonRules.acceptsDocument("Laporan Q3.XLSX"))
        assertFalse(GideonRules.acceptsDocument("video.mp4"))
        assertNull(GideonRules.parse("", dec).second)
    }
}
