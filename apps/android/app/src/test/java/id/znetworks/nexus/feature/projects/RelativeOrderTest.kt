package id.znetworks.nexus.feature.projects

import id.znetworks.nexus.core.net.*
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.*
import mockwebserver3.*
import org.junit.Assert.*
import org.junit.Test

class RelativeOrderTest {
    @Test fun movingOneCardNeverSendsTheStaleWholeColumn() = runTest {
        val server = MockWebServer(); server.start()
        try {
            val api = ProjectsApi(ApiClient(server.url("/"), ClientIdentity("0.1.6", 13, 34), sessionProvider = { null }))
            server.enqueue(MockResponse.Builder().body("""{"ok":true}""").build())
            api.reorder("lane", listOf("moving"), "anchor")
            val request = server.takeRequest()
            val body = NexusJson.parseToJsonElement(request.body!!.utf8()).jsonObject
            assertEquals("POST", request.method)
            assertEquals("/api/tasks/reorder", request.url.encodedPath)
            assertEquals("moving", body["movedIds"]!!.jsonArray.single().jsonPrimitive.content)
            assertEquals("anchor", body["beforeId"]!!.jsonPrimitive.content)
            assertFalse(body.containsKey("orderedIds"))
        } finally { server.close() }
    }
}
