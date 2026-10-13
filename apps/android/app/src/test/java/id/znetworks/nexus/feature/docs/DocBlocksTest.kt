package id.znetworks.nexus.feature.docs

import id.znetworks.nexus.core.nav.Links
import id.znetworks.nexus.core.nav.Target
import id.znetworks.nexus.core.net.NexusJson
import org.junit.Assert.assertEquals
import org.junit.Test

class DocBlocksTest {
    @Test fun blockNoteBecomesTypedBlocksWithChildren() {
        val json = NexusJson.parseToJsonElement("""[
            {"type":"heading","props":{"level":2},"content":[{"type":"text","text":"SOP"}]},
            {"type":"bulletListItem","content":[{"type":"text","text":"Absen"}],"children":[{"type":"paragraph","content":[{"type":"text","text":"pakai selfie"}]}]},
            {"type":"checkListItem","props":{"checked":true},"content":[{"type":"text","text":"Refleksi"}]},
            {"type":"paragraph","content":[]},{"type":"paragraph","content":[]}]""")
        val b = DocBlocks.from(json)
        assertEquals(listOf("heading", "bulletListItem", "paragraph", "checkListItem", "paragraph"), b.map { it.type })
        assertEquals(2, b[0].level)
        assertEquals("pakai selfie", b[2].text)
        assertEquals(true, b[3].checked)
    }

    @Test fun docLinks() {
        assertEquals(Target.Docs("d1"), Links.parse("/docs/d1"))
        assertEquals(Target.Docs(null), Links.parse("/docs"))
    }
}
