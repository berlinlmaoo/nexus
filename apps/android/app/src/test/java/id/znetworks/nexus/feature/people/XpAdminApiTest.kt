package id.znetworks.nexus.feature.people
import id.znetworks.nexus.core.net.*
import id.znetworks.nexus.core.session.Session
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.*
import mockwebserver3.*
import org.junit.*
import org.junit.Assert.*
class XpAdminApiTest{
    private lateinit var server:MockWebServer
    private lateinit var api:XpAdminApi
    @Before fun setup(){server=MockWebServer();server.start();api=XpAdminApi(ApiClient(server.url("/"),ClientIdentity("0.1.6",13,36),{Session("t","c","u")},mayCarrySession={true}))}
    @After fun cleanup(){server.close()}
    private fun reply(s:String="{}"){server.enqueue(MockResponse.Builder().code(200).body(s).build())}
    private fun body(r:RecordedRequest)=NexusJson.parseToJsonElement(r.body!!.utf8()).jsonObject
    @Test fun adjustmentKeepsSignAndNormalizesNote()=runTest{reply();api.adjust("person",-25,"  Follow   up  ");val r=server.takeRequest();assertEquals("/api/gamification/xp-adjust",r.target);assertEquals(JsonPrimitive(-25),body(r)["amount"]);assertEquals(JsonPrimitive("Follow up"),body(r)["note"])}
    @Test fun penaltiesAreNegativeDistinctAndDismissedPerId(){val rows=listOf(row("a",-5),row("a",-5),row("b",-10),row("z",0),row("positive",2));assertEquals(listOf("b"),XpPenaltyRules.fresh(rows,setOf("a")).map{it["id"]!!.jsonPrimitive.content});assertEquals(150,XpPenaltyRules.dismissed((1..160).map{it.toString()},listOf(row("new",-1))).size)}
    private fun row(id:String,amount:Int)=buildJsonObject{put("id",id);put("amount",amount)}
}
