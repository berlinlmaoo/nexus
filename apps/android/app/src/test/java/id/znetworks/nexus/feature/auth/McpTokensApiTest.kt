package id.znetworks.nexus.feature.auth
import id.znetworks.nexus.core.net.*
import id.znetworks.nexus.core.session.Session
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.*
import mockwebserver3.*
import org.junit.*
import org.junit.Assert.*
class McpTokensApiTest{
    private lateinit var server:MockWebServer
    private lateinit var api:McpTokensApi
    @Before fun setup(){server=MockWebServer();server.start();api=McpTokensApi(ApiClient(server.url("/"),ClientIdentity("0.1.6",13,36),{Session("t","c","u")},mayCarrySession={true}))}
    @After fun cleanup(){server.close()}
    private fun reply(s:String="{}"){server.enqueue(MockResponse.Builder().code(200).body(s).build())}
    private fun body(r:RecordedRequest)=NexusJson.parseToJsonElement(r.body!!.utf8()).jsonObject
    @Test fun createUsesBoundedExpiryAndRevokeIsScopedById()=runTest{reply("{\"token\":\"test-only-token\",\"id\":\"token-id\"}");assertEquals("test-only-token",api.create("  Laptop  ",30)["token"]!!.jsonPrimitive.content);val r=server.takeRequest();assertEquals("POST",r.method);assertEquals("/api/mcp/tokens",r.target);assertEquals(JsonPrimitive(30),body(r)["expiresInDays"]);assertEquals(JsonPrimitive("Laptop"),body(r)["name"]);reply();api.revoke("id & one");val revoke=server.takeRequest();assertEquals("DELETE",revoke.method);assertEquals("/api/mcp/tokens?id=id+%26+one",revoke.target)}
}
