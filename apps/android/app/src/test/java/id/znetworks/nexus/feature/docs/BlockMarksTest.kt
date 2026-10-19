package id.znetworks.nexus.feature.docs
import kotlinx.serialization.json.*
import org.junit.Test
import org.junit.Assert.*
class BlockMarksTest{
    @Test fun togglingOneMarkPreservesOtherMarksAndOpaqueAttributes(){
        val node=Json.parseToJsonElement("""{"type":"paragraph","attrs":{"id":"stable"},"content":[{"type":"text","text":"Hello","marks":[{"type":"italic"},{"type":"futureMark","attrs":{"keep":true}}]}]}""").jsonObject
        val bold=BlockMarks.apply(node,"bold");assertEquals(3,bold["content"]!!.jsonArray[0].jsonObject["marks"]!!.jsonArray.size)
        assertEquals(node,BlockMarks.apply(bold,"bold"))
        val linked=BlockMarks.apply(node,"link",buildJsonObject{put("href","https://example.com")});assertEquals(node,BlockMarks.remove(linked,"link"))
    }
    @Test fun linksRejectScriptProtocolRelativeMalformedAndWhitespace(){
        assertTrue(BlockMarks.safeLink("https://example.com/path"));assertTrue(BlockMarks.safeLink("/tasks/abc"));assertTrue(BlockMarks.safeLink("mailto:test@example.com"))
        listOf("javascript:alert(1)","//evil.example","https://","file:///tmp/file","https://exa mple.com").forEach{assertFalse(it,BlockMarks.safeLink(it))}
    }
}
