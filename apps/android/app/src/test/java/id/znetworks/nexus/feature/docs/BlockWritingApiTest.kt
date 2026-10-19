package id.znetworks.nexus.feature.docs
import id.znetworks.nexus.core.net.*
import id.znetworks.nexus.core.session.Session
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.*
import mockwebserver3.*
import org.junit.*
import org.junit.Assert.*
class BlockWritingApiTest{
    private lateinit var server:MockWebServer
    private lateinit var api:BlockEditorApi
    @Before fun setup(){server=MockWebServer();server.start();api=BlockEditorApi(ApiClient(server.url("/"),ClientIdentity("0.1.6",13,36),{Session("t","c","u")},mayCarrySession={true}))}
    @After fun cleanup(){server.close()}
    @Test fun finalResultWinsOverPartialAndMalformedFrames()=runTest{
        server.enqueue(MockResponse.Builder().code(200).addHeader("Content-Type","text/event-stream").body("data: {bad}\n\ndata: {\"type\":\"delta\",\"content\":\"partial\"}\n\ndata: {\"type\":\"reset\"}\n\ndata: {\"type\":\"final\",\"content\":\"Final answer\"}\n\ndata: {\"type\":\"done\"}\n\n").build())
        assertEquals("Final answer",api.write("taskbody","task-id","tone","Source","Friendly","id")["content"]!!.jsonPrimitive.content)
        val r=server.takeRequest();assertEquals("/api/gideon/write",r.target);assertEquals("POST",r.method);val b=NexusJson.parseToJsonElement(r.body!!.utf8()).jsonObject;assertEquals(JsonPrimitive("task-id"),b["taskId"]);assertNull(b["docId"]);assertEquals(JsonPrimitive("Friendly"),b["tone"]);assertEquals(JsonPrimitive("id"),b["language"])
    }
    @Test fun partialErrorOrEmptyFinalCannotBecomeReplacementText()=runTest{
        for(body in listOf("data: {\"type\":\"delta\",\"content\":\"partial\"}\n\ndata: {\"type\":\"error\",\"content\":\"Failed\"}\n\n","data: {\"type\":\"final\",\"content\":\"\"}\n\n")){
            server.enqueue(MockResponse.Builder().code(200).body(body).build());try{api.write("doc","doc-id","improve","Source","","en");fail("Invalid stream accepted")}catch(_:ApiError){}
            server.takeRequest()
        }
    }
}
