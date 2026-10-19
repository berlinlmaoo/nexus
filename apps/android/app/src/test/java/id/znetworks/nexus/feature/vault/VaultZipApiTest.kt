package id.znetworks.nexus.feature.vault
import id.znetworks.nexus.core.net.*
import id.znetworks.nexus.core.session.Session
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.*
import mockwebserver3.*
import org.junit.*
import org.junit.Assert.*
class VaultZipApiTest{
    private lateinit var server:MockWebServer
    private lateinit var api:VaultZipApi
    @Before fun setup(){server=MockWebServer();server.start();api=VaultZipApi(ApiClient(server.url("/"),ClientIdentity("0.1.6",13,36),{Session("t","c","u")},mayCarrySession={true}))}
    @After fun cleanup(){server.close()}
    private fun reply(s:String="{}"){server.enqueue(MockResponse.Builder().code(200).body(s).build())}
    private fun body(r:RecordedRequest)=NexusJson.parseToJsonElement(r.body!!.utf8()).jsonObject
    @Test fun archivePostStreamsToDiskWithSessionAndDeduplicatesSelection()=runTest{reply("{\"ok\":true,\"files\":2,\"bytes\":9}");api.check(listOf("a","a","folder"));val check=server.takeRequest();assertEquals("/api/vault/zip?check=1",check.target);assertEquals(JsonArray(listOf(JsonPrimitive("a"),JsonPrimitive("folder"))),body(check)["ids"]);reply("zip-bytes");val file=java.io.File.createTempFile("vault-zip-test",".zip");try{api.download(listOf("a","folder"),file){_,_->};val r=server.takeRequest();assertEquals("POST",r.method);assertEquals("/api/vault/zip",r.target);assertEquals("c=t",r.headers["Cookie"]);assertEquals("zip-bytes",file.readText());assertNull(r.headers["Range"])}finally{file.delete()}}
}
