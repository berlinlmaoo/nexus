package id.znetworks.nexus.feature.docs
import id.znetworks.nexus.core.net.*
import id.znetworks.nexus.core.session.Session
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.*
import mockwebserver3.*
import org.junit.*
import org.junit.Assert.*
class PageManagementApiTest {
 private lateinit var server: MockWebServer
 private lateinit var api: PageManagementApi
 @Before fun setup(){server=MockWebServer();server.start();api=PageManagementApi(ApiClient(server.url("/"),ClientIdentity("0.1.6",13,36),{Session("t","c","u")},mayCarrySession={true}))}
 @After fun cleanup(){server.close()}
 private fun reply(s:String="{}"){server.enqueue(MockResponse.Builder().code(200).body(s).build())}
 @Test fun templateCreationUsesServerContent()=runTest{reply("""{"doc":{"id":"created"}}""");assertEquals("created",api.create("project"," Title ","template","parent"));val r=server.takeRequest();assertEquals("POST",r.method);val body=NexusJson.parseToJsonElement(r.body!!.utf8()).jsonObject;assertEquals(JsonPrimitive("template"),body["templateId"]);assertEquals(JsonPrimitive("parent"),body["parentId"]);assertFalse(body.containsKey("content"))}
 @Test fun metadataPatchPreservesBodyAndCarriesBase()=runTest{reply();api.update("doc","timestamp",buildJsonObject{put("title","Title");put("parentId",JsonNull)});val r=server.takeRequest();assertEquals("PATCH",r.method);val body=NexusJson.parseToJsonElement(r.body!!.utf8()).jsonObject;assertEquals(JsonPrimitive("timestamp"),body["baseUpdatedAt"]);assertEquals(JsonNull,body["parentId"]);assertFalse(body.containsKey("content"))}
 @Test fun conflictIsSurfaced()=runTest{server.enqueue(MockResponse.Builder().code(409).body("""{"error":"conflict"}""").build());try{api.update("doc","old",buildJsonObject{});fail("Expected conflict")}catch(e:ApiError){assertTrue(e is ApiError.Http)}}
 @Test fun treeHandlesOrphansAndCycles(){val docs=listOf(Doc("b",parentId="a"),Doc("a"),Doc("c",parentId="d"),Doc("d",parentId="c"),Doc("orphan",parentId="missing"));assertEquals(setOf("a","b"),PageTree.descendants("a",docs));val rows=PageTree.ordered(docs);assertEquals(5,rows.size);assertEquals(5,rows.map{it.first.id}.toSet().size);assertEquals(1,rows.find{it.first.id=="b"}!!.second)}
}
