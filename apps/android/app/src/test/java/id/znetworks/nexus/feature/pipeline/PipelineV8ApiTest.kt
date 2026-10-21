package id.znetworks.nexus.feature.pipeline

import id.znetworks.nexus.core.net.ApiClient
import id.znetworks.nexus.core.net.ApiError
import id.znetworks.nexus.core.net.ClientIdentity
import id.znetworks.nexus.core.net.NexusJson
import id.znetworks.nexus.core.session.Session
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import java.nio.file.Files
import java.util.UUID

/** The v8 wire contract: scoped reads/exports, whole-deal item answers, and one idempotency key per tap. */
class PipelineV8ApiTest {
    private lateinit var server: MockWebServer
    private lateinit var api: PipelineApi

    @Before fun setup() {
        server = MockWebServer().also { it.start() }
        api = PipelineApi(ApiClient(server.url("/"), ClientIdentity("0.1.7", 14, 36), { Session("token", "cookie", "user") }, mayCarrySession = { true }))
    }

    @After fun cleanup() { server.close() }

    private fun reply(body: String, code: Int = 200) {
        server.enqueue(MockResponse.Builder().code(code).body(body).build())
    }

    @Test fun eachTapHasOneKeyAndRetryCanKeepIt() = runTest {
        reply("""{"deal":{"id":"d","cashback":[{"id":"i1"}]} ,"item":{"id":"i1"}}""", 201)
        assertEquals("i1", api.addItem("p", "d", "cashback")!!.cashback.single().id)
        val first = NexusJson.parseToJsonElement(server.takeRequest().body!!.utf8()).jsonObject
        assertEquals("cashback", first["kind"].str())
        val key = first["clientRequestId"].str()!!
        assertEquals(key, UUID.fromString(key).toString())
        assertEquals(setOf("kind", "clientRequestId"), first.keys)

        reply("""{"deal":{"id":"d","cashback":[{"id":"i1"}]} ,"duplicate":true}""")
        assertEquals("i1", api.addItem("p", "d", "cashback", clientRequestId = key)!!.cashback.single().id)
        val retry = server.takeRequest()
        assertEquals("POST", retry.method); assertEquals("/api/projects/p/pipeline/d/items", retry.target)
        assertEquals(first, NexusJson.parseToJsonElement(retry.body!!.utf8()))

        reply("""{"deal":{"id":"d"}}""", 201)
        api.addItem("p", "d", "contact")
        val next = NexusJson.parseToJsonElement(server.takeRequest().body!!.utf8()).jsonObject
        assertNotEquals(key, next["clientRequestId"].str())
    }

    @Test fun editingAndDeletingReturnTheWholeAuthoritativeDeal() = runTest {
        reply("""{"deal":{"id":"d","name":"Kept name","barterValue":7000000,"budgets":[{"id":"b","amount":10,"spent":12,"remaining":-2}]},"item":{"id":"b"}}""")
        val fields = JsonObject(mapOf("name" to JsonPrimitive("Venue")))
        val updated = api.updateItem("p", "d", "b", fields)!!
        val edit = server.takeRequest()
        assertEquals("PATCH", edit.method); assertEquals("/api/projects/p/pipeline/d/items/b", edit.target)
        assertEquals(fields, NexusJson.parseToJsonElement(edit.body!!.utf8()))
        assertEquals("Kept name", updated.name); assertEquals(7000000.0, updated.barterValue, 0.0)
        assertEquals(-2.0, updated.budgets.single().remaining, 0.0)

        reply("""{"deal":{"id":"d","name":"Kept name","budgets":[]}}""")
        assertTrue(api.deleteItem("p", "d", "b")!!.budgets.isEmpty())
        val delete = server.takeRequest()
        assertEquals("DELETE", delete.method); assertEquals("/api/projects/p/pipeline/d/items/b", delete.target)
    }

    @Test fun boardAndCombinedReadsCarryOnlyChosenFiltersAndNeverEnableCombinedEditing() = runTest {
        reply("""{"years":[2027,2026],"year":2026}""")
        assertEquals(2026, api.load("p", 2026).year)
        assertEquals("/api/projects/p/pipeline?year=2026", server.takeRequest().target)

        reply("""{"workspaceId":"w","boards":[{"id":"p","name":"Pipeline Suwara","dealCount":3}]}""")
        assertEquals(3, api.boards("w").boards.single().dealCount)
        assertEquals("/api/pipelines/boards?workspaceId=w", server.takeRequest().target)

        reply("""{"workspaceId":"w","canEdit":true,"year":2027,"source":"p"}""")
        val all = api.all("w", "p", 2027)
        assertFalse(all.canEdit); assertEquals("w", all.workspaceId)
        assertEquals("/api/pipelines/all?workspaceId=w&source=p&year=2027", server.takeRequest().target)

        reply("{}")
        assertFalse(api.all().canEdit)
        assertEquals("/api/pipelines/all", server.takeRequest().target)
    }

    @Test fun forbiddenBoardDiscoveryIsPreservedForTheCallerToHideEntryPoints() = runTest {
        reply("""{"error":"All Pipelines is for BoD and One Above All only.","code":"ALL_PIPELINES_FORBIDDEN"}""", 403)
        try {
            api.boards()
            fail("403 must reach the role-gated caller")
        } catch (error: ApiError.Http) {
            assertEquals(403, error.status); assertEquals("ALL_PIPELINES_FORBIDDEN", error.code)
        }
    }

    @Test fun excelDownloadsUseTheSameYearAndCompanyFilters() = runTest {
        val dir = Files.createTempDirectory("pipeline-v8-export").toFile()
        try {
            reply("single-board-workbook")
            val board = api.export("p", "id", dir, 2026)
            assertEquals("single-board-workbook", board.readText())
            assertEquals("/api/projects/p/pipeline/export?lang=id&year=2026", server.takeRequest().target)

            reply("combined-workbook")
            val combined = api.exportAll("en", dir, "w", "p", 2027)
            assertEquals("combined-workbook", combined.readText())
            assertEquals("/api/pipelines/all/export?lang=en&workspaceId=w&source=p&year=2027", server.takeRequest().target)
            assertFalse(dir.listFiles().orEmpty().any { it.name.endsWith(".part") })
        } finally {
            dir.deleteRecursively()
        }
    }
}
