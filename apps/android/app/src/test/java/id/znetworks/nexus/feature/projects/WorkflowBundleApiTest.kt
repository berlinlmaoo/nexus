package id.znetworks.nexus.feature.projects
import id.znetworks.nexus.core.net.*
import id.znetworks.nexus.core.session.Session
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.*
import mockwebserver3.*
import org.junit.*
import org.junit.Assert.*
class WorkflowBundleApiTest{
    private lateinit var server:MockWebServer
    private lateinit var api:WorkflowBundleApi
    @Before fun setup(){server=MockWebServer();server.start();api=WorkflowBundleApi(ApiClient(server.url("/"),ClientIdentity("0.1.6",13,36),{Session("t","c","u")},mayCarrySession={true}))}
    @After fun cleanup(){server.close()}
    private fun reply(s:String="{}"){server.enqueue(MockResponse.Builder().code(200).body(s).build())}
    private fun body(r:RecordedRequest)=NexusJson.parseToJsonElement(r.body!!.utf8()).jsonObject
    @Test fun applyUsesProjectAndBundleIds()=runTest{reply("{\"bundles\":[{\"id\":\"bundle\",\"name\":\"Support\"}]}");assertEquals("bundle",api.list().single()["id"]!!.jsonPrimitive.content);assertEquals("/api/workflow-bundles",server.takeRequest().target);reply();api.apply("project","bundle");val r=server.takeRequest();assertEquals("POST",r.method);assertEquals("/api/projects/project/apply-bundle",r.target);assertEquals(JsonPrimitive("bundle"),body(r)["bundleId"])}
}
