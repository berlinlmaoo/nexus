package id.znetworks.nexus.feature.docs

import id.znetworks.nexus.core.net.*
import id.znetworks.nexus.core.session.Session
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.*
import mockwebserver3.*
import org.junit.*
import org.junit.Assert.*

class BlockEditingTest {
    private fun doc(s:String)=NexusJson.parseToJsonElement(s).jsonObject
    @Test fun unchangedTreePreservesMarksNestedListsAndUnknownNodes(){
        val tree=doc("""{"type":"doc","content":[{"type":"bulletList","attrs":{"future":42},"content":[{"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text","text":"Keep","marks":[{"type":"bold"}]}]},{"type":"futureBlock","attrs":{"opaque":"yes"},"content":[{"type":"text","text":"Unknown"}]}]}]}]}""")
        val lines=BlockTree.lines(tree);assertEquals(2,lines.size);assertTrue(lines[0].editable);assertFalse(lines[1].editable)
        assertEquals(tree,BlockTree.update(tree,lines[0].path){BlockTree.replaceText(it,"Keep")})
        val changed=BlockTree.update(tree,lines[0].path){BlockTree.replaceText(it,"Keep more")}
        assertEquals(lines[1].node,BlockTree.at(changed,lines[1].path));assertEquals(tree["content"]!!.jsonArray[0].jsonObject["attrs"],changed["content"]!!.jsonArray[0].jsonObject["attrs"])
    }
    @Test fun changedTextRetainsPrefixAndSuffixMarks(){
        val node=doc("""{"type":"paragraph","attrs":{"id":"stable"},"content":[{"type":"text","text":"Hello ","marks":[{"type":"bold"}]},{"type":"text","text":"world","marks":[{"type":"italic"}]}]}""")
        val changed=BlockTree.replaceText(node,"Hello brave world")
        assertEquals("Hello brave world",BlockTree.text(changed));assertEquals(node["attrs"],changed["attrs"])
        val texts=changed["content"]!!.jsonArray
        assertEquals(node["content"]!!.jsonArray.first().jsonObject["marks"],texts.first().jsonObject["marks"])
        assertEquals(node["content"]!!.jsonArray.last().jsonObject["marks"],texts.last().jsonObject["marks"])
    }
    @Test fun removingAndReorderingOnlyChangeTheirParent(){
        val first=BlockTree.paragraph("a");val second=BlockTree.paragraph("b");val tree=buildJsonObject{put("type","doc");put("attrs",buildJsonObject{put("keep",true)});put("content",JsonArray(listOf(first,second)))}
        assertEquals(JsonArray(listOf(second,first)),BlockTree.moveUp(tree,listOf(1))["content"])
        val removed=BlockTree.remove(tree,listOf(0));assertEquals(JsonArray(listOf(second)),removed["content"]);assertEquals(tree["attrs"],removed["attrs"])
    }
    @Test fun clearingThenRetypingRetainsTypingMarksAndAttributes(){
        val node=doc("""{"type":"paragraph","attrs":{"id":"stable"},"content":[{"type":"text","text":"Bold","marks":[{"type":"bold"},{"type":"futureMark","attrs":{"keep":true}}]}]}""")
        val cleared=BlockTree.replaceText(node,"")
        assertEquals("",BlockTree.text(cleared))
        val typed=BlockTree.replaceText(cleared,"Replacement")
        assertEquals("Replacement",BlockTree.text(typed))
        assertEquals(node["attrs"],typed["attrs"])
        assertEquals(node["content"]!!.jsonArray[0].jsonObject["marks"],typed["content"]!!.jsonArray[0].jsonObject["marks"])
    }
    @Test fun canonicalReadAndSaveUseExactBase()=runTest{
        val server=MockWebServer();server.start()
        try{val api=BlockEditorApi(ApiClient(server.url("/"),ClientIdentity("0.1.6",13,36),{Session("t","c","u")},mayCarrySession={true}))
            val base=buildJsonObject{put("type","doc");put("content",JsonArray(listOf(BlockTree.paragraph("base"))))}
            server.enqueue(MockResponse.Builder().code(200).body(buildJsonObject{put("format","canonical");put("canEdit",true);put("doc",buildJsonObject{put("content",base)})}.toString()).build())
            assertEquals(CanonicalBody(base,true),api.load("doc","doc-id"));assertEquals("/api/docs/doc-id?format=canonical",server.takeRequest().target)
            val mine=BlockTree.append(base,BlockTree.paragraph("mine"));server.enqueue(MockResponse.Builder().code(200).body(buildJsonObject{put("doc",mine)}.toString()).build())
            assertEquals(mine,api.save("doc","doc-id",base,mine,true));val request=server.takeRequest();assertEquals("POST",request.method);assertEquals("/api/collab/edit",request.target)
            val sent=NexusJson.parseToJsonElement(request.body!!.utf8()).jsonObject;assertEquals(base,sent["base"]);assertEquals(mine,sent["doc"]);assertEquals(JsonPrimitive(true),sent["keepBoth"])
        }finally{server.close()}
    }
    @Test fun flattenedOrMissingCanonicalReadCannotBeEdited()=runTest{
        val server=MockWebServer();server.start();try{val api=BlockEditorApi(ApiClient(server.url("/"),ClientIdentity("0.1.6",13,36),{Session("t","c","u")},mayCarrySession={true}));server.enqueue(MockResponse.Builder().code(200).body("""{"doc":{"content":[]},"canEdit":true}""").build());try{api.load("doc","doc-id");fail("Unsafe base accepted")}catch(_:ApiError.Decoding){}}finally{server.close()}
    }
}
