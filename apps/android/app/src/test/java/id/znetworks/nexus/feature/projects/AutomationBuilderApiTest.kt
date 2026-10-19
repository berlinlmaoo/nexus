package id.znetworks.nexus.feature.projects

import id.znetworks.nexus.core.net.*
import id.znetworks.nexus.core.session.Session
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.*
import mockwebserver3.*
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test

class AutomationBuilderApiTest {
    private lateinit var server: MockWebServer
    private lateinit var api: ProjectsApi
    @Before fun setup() { server = MockWebServer(); server.start(); api = ProjectsApi(ApiClient(server.url("/"), ClientIdentity("0.1.6",13,36), { Session("t","c","u") }, mayCarrySession = { true })) }
    @After fun cleanup() { server.close() }
    private fun reply(body: String = "{}") { server.enqueue(MockResponse.Builder().code(200).body(body).build()) }
    @Test fun createAndEditPreserveOrderedActionsAndStructuredConfig() = runTest {
        val trigger = Rule("SCHEDULED", config = buildJsonObject { put("frequency","weekly"); put("time","09:30"); put("days", JsonArray(listOf(JsonPrimitive(1),JsonPrimitive(5)))); put("future", true) })
        val actions = listOf(Rule("CREATE_TASK", value = JsonPrimitive("Report {project}")), Rule("SEND_NOTIFICATION", config = buildJsonObject { put("to", JsonArray(listOf(JsonPrimitive("@leads")))) }))
        val conditions = Conditions("any", listOf(ConditionRule("priority","is",JsonPrimitive("HIGH")), ConditionRule("cf:rating","gt",JsonPrimitive("4"))))
        for (id in listOf(null,"rule")) {
            reply(); api.saveAutomation("project",id,"  Report  ",false,trigger,actions,conditions)
            val r = server.takeRequest(); assertEquals(if(id==null) "POST" else "PATCH",r.method); assertEquals("/api/automations",r.target)
            val b = NexusJson.parseToJsonElement(r.body!!.utf8()).jsonObject
            assertEquals(JsonPrimitive("Report"),b["name"]); assertEquals(JsonPrimitive(false),b["enabled"])
            assertEquals(NexusJson.encodeToJsonElement(Rule.serializer(),trigger),b["trigger"])
            assertEquals("CREATE_TASK",b["actions"]!!.jsonArray[0].jsonObject["type"]!!.jsonPrimitive.content)
            assertEquals("SEND_NOTIFICATION",b["actions"]!!.jsonArray[1].jsonObject["type"]!!.jsonPrimitive.content)
            assertEquals(NexusJson.encodeToJsonElement(Conditions.serializer(),conditions),b["conditions"])
            assertEquals(id,b["id"]?.jsonPrimitive?.content)
        }
    }
    @Test fun suggestionsKeepCanonicalRuleAndDeleteEncodesId() = runTest {
        reply("""{"suggestions":[{"name":"Route","confidence":0.8,"trigger":{"type":"TASK_CREATED"},"action":{"type":"MOVE_TO_SECTION","value":"lane"}}]}""")
        val sg = api.automationSuggestions("project").suggestions.single()
        assertEquals("MOVE_TO_SECTION",sg.action.type); assertEquals("lane",sg.action.text)
        assertEquals("/api/automations/suggestions?projectId=project",server.takeRequest().target)
        reply(); api.deleteAutomation("rule & other"); val r = server.takeRequest(); assertEquals("DELETE",r.method); assertEquals("/api/automations?id=rule+%26+other",r.target)
    }
}
