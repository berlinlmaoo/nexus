package id.znetworks.nexus.feature.pipeline

import id.znetworks.nexus.core.net.NexusJson
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** PIPELINE-DASHBOARD §13 (owner, 9 Oct late night): attached files, several services. */
class PipelineDocsServicesTest {
    private fun deal(json: String) = PipelineDeal(NexusJson.parseToJsonElement(json).jsonObject)

    @Test fun documents() {
        val d = deal("""{"id":"a","links":[
            {"id":"l1","type":"SPK","label":"","url":"https://x.test/spk"},
            {"id":"f1","type":"Kontrak","label":"Signed","url":"/api/projects/p/pipeline/a/documents/f1","kind":"file","fileName":"kontrak.pdf","mimeType":"application/pdf","size":2048,"uploadedAt":"2026-10-09T20:00:00Z"},
            {"id":"f2","type":"Invoice","label":"","url":"/api/projects/p/pipeline/a/documents/f2","kind":"file","fileName":"inv.jpg","mimeType":"image/jpeg"},
            {"id":"f3","type":"Lainnya","label":"","url":"/x","kind":"file","fileName":"deck.pptx"}]}""")
        val (link, pdf, img, other) = d.links
        assertFalse(link.isFile); assertEquals("https://x.test/spk", link.shownName) // no kind = a link
        assertTrue(pdf.isFile); assertEquals("Signed", pdf.shownName); assertEquals(2048L, pdf.size); assertEquals(DocView.PDF, docView(pdf))
        assertEquals("inv.jpg", img.shownName); assertEquals(DocView.IMAGE, docView(img)); assertEquals(DocView.OTHER, docView(other))
        // A file goes back as received (uploadedAt, mimeType…) with the edited label over it.
        val back = pdf.copy(label = "Final").json()
        assertEquals("Final", back["label"]!!.jsonPrimitive.content); assertEquals("file", back["kind"]!!.jsonPrimitive.content)
        assertEquals("2026-10-09T20:00:00Z", back["uploadedAt"]!!.jsonPrimitive.content)
        assertEquals("link", PipelineLink("n", "SPK", "", "https://y.test").json()["kind"]!!.jsonPrimitive.content)
        assertEquals("f1", PipelineChange.doc(NexusJson.parseToJsonElement("""{"id":"f1","type":"SPK","kind":"file","fileName":"a.pdf","url":"/x"}"""))!!.id)
        assertNull(PipelineChange.doc(null))
    }

    @Test fun services() {
        assertEquals(listOf("Event"), deal("""{"id":"a","service":"Event"}""").services) // older server
        val d = deal("""{"id":"b","service":"Event","services":["Event","KOL"," "]}""")
        assertEquals(listOf("Event", "KOL"), d.services)
        val presets = listOf("Event", "Creative")
        assertEquals(listOf("Event", "Creative"), PipelineServices.add(listOf("Event"), "  creative ", presets)) // preset spelling
        assertEquals(listOf("Event"), PipelineServices.add(listOf("Event"), "EVENT", presets)) // no duplicate
        assertNull(PipelineServices.add(listOf("Event"), "   ", presets))
        assertEquals(60, PipelineServices.add(emptyList(), "x".repeat(80), presets)!!.single().length)
        assertNull(PipelineServices.add(List(20) { "s$it" }, "one more", presets))
        assertEquals(listOf("KOL"), PipelineServices.toggle(listOf("Event", "KOL"), "event"))
        val other = deal("""{"id":"c","services":["Podcast","Creative"]}""")
        assertEquals(listOf("KOL", "Podcast"), PipelineServices.others(d, listOf(d, other), presets))
        assertEquals(listOf("c"), PipelineFilter.apply(listOf(d, other), "podcast", null, null, null).map { it.id }) // search covers services
        assertEquals(listOf("b"), PipelineFilter.apply(listOf(d, other), "", null, null, null, "kol").map { it.id })
        assertEquals(listOf("Creative", "Event", "KOL", "Podcast"), PipelineFilter.services(listOf(d, other)))
    }
}
