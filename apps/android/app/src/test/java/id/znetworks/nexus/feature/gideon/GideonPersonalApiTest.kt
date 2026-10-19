package id.znetworks.nexus.feature.gideon
import id.znetworks.nexus.core.net.*
import id.znetworks.nexus.core.session.Session
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.*
import mockwebserver3.*
import org.junit.*
import org.junit.Assert.*
class GideonPersonalApiTest {
 private lateinit var server:MockWebServer
 private lateinit var api:GideonPersonalApi
 @Before fun setup(){server=MockWebServer();server.start();api=GideonPersonalApi(ApiClient(server.url("/"),ClientIdentity("0.1.6",13,36),{Session("t","c","u")},mayCarrySession={true}))}
 @After fun cleanup(){server.close()}
 @Test fun blankFieldsExplicitlyResetServerPreferences()=runTest{server.enqueue(MockResponse.Builder().code(200).body("{}").build());assertEquals("GIDEON",api.save(" "," ").name);val r=server.takeRequest();assertEquals("PUT",r.method);val body=NexusJson.parseToJsonElement(r.body!!.utf8()).jsonObject;assertEquals(JsonNull,body["assistantName"]);assertEquals(JsonNull,body["instructions"])}
 @Test fun acknowledgementDoesNotOverwritePersonalization()=runTest{server.enqueue(MockResponse.Builder().code(200).body("""{"assistantName":"Atlas","reviewNotice":false}""").build());val result=api.acknowledge();assertEquals("Atlas",result.name);assertFalse(result.reviewNotice);val body=NexusJson.parseToJsonElement(server.takeRequest().body!!.utf8()).jsonObject;assertEquals(setOf("reviewNoticeSeen"),body.keys)}
}
