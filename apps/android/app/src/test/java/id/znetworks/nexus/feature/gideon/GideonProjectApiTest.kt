package id.znetworks.nexus.feature.gideon

import id.znetworks.nexus.core.net.*
import id.znetworks.nexus.core.session.Session
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.*
import mockwebserver3.*
import org.junit.*
import org.junit.Assert.*

class GideonProjectApiTest {
    private lateinit var server: MockWebServer
    private lateinit var api: GideonProjectApi
    @Before fun setup() { server=MockWebServer(); server.start();api=GideonProjectApi(ApiClient(server.url("/"),ClientIdentity("0.1.6",13,36),{Session("t","c","u")},mayCarrySession={true})) }
    @After fun cleanup(){server.close()}
    private fun reply(body:String="{}"){server.enqueue(MockResponse.Builder().code(200).body(body).build())}
    @Test fun schedulePreservesSundayAndExplicitNullInstructions()=runTest {
        val patch=buildJsonObject{put("weekdays",JsonArray(listOf(JsonPrimitive(0),JsonPrimitive(1))));put("time","08:30");put("timezone","Asia/Makassar");put("language","id");put("instructions",JsonNull);put("enabled",false)}
        reply();api.saveSchedule("project",null,patch);val create=server.takeRequest();assertEquals("POST",create.method);assertEquals("/api/gideon/schedules",create.target)
        assertEquals(JsonObject(patch+("projectId" to JsonPrimitive("project"))),NexusJson.parseToJsonElement(create.body!!.utf8()))
        reply();api.saveSchedule("project","schedule",buildJsonObject{put("enabled",true)});val update=server.takeRequest();assertEquals("PATCH",update.method);assertEquals("/api/gideon/schedules/schedule",update.target)
        reply();api.runSchedule("schedule");assertEquals("/api/gideon/schedules/schedule/run",server.takeRequest().target)
        reply();api.deleteSchedule("schedule");assertEquals("DELETE",server.takeRequest().method)
    }
    @Test fun autofillUsesPutAndScopeAllIsExplicit()=runTest {
        reply();api.saveAutofill("field",buildJsonObject{put("approval","review");put("onUpdate",false)})
        val save=server.takeRequest();assertEquals("PUT",save.method);assertEquals("/api/gideon/autofill",save.target)
        val b=NexusJson.parseToJsonElement(save.body!!.utf8()).jsonObject;assertEquals("field",b["customFieldId"]!!.jsonPrimitive.content);assertEquals("review",b["approval"]!!.jsonPrimitive.content)
        reply();api.runAutofill("field","empty");val run=server.takeRequest();assertEquals("/api/gideon/autofill/run",run.target);assertEquals("empty",NexusJson.parseToJsonElement(run.body!!.utf8()).jsonObject["scope"]!!.jsonPrimitive.content)
        reply();api.deleteAutofill("field & one");assertEquals("/api/gideon/autofill?customFieldId=field+%26+one",server.takeRequest().target)
    }
}
