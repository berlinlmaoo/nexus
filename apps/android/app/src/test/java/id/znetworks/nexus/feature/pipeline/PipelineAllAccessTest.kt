package id.znetworks.nexus.feature.pipeline

import id.znetworks.nexus.core.Viewer
import id.znetworks.nexus.core.net.ApiClient
import id.znetworks.nexus.core.net.ClientIdentity
import id.znetworks.nexus.core.session.Session
import kotlinx.coroutines.test.runTest
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class PipelineAllAccessTest {
    private fun api(server: MockWebServer) = ApiClient(server.url("/"), ClientIdentity("0.1.7", 13, 36),
        { Session("t", "c", "u") }, mayCarrySession = { true })

    @Test fun otherWorkspaceRolesNeverRequestCombinedDiscovery() = runTest {
        for (role in listOf("MANAGER", "STAFF")) MockWebServer().use { server ->
            server.start()
            val api = api(server)
            server.enqueue(MockResponse.Builder().body("""{"role":"$role","isCompany":true}""").build())
            assertNull(PipelineAllAccess.load(api, Viewer(api)))
            assertEquals(1, server.requestCount)
            assertEquals("/api/workspaces/members", server.takeRequest().target)
        }
    }

    @Test fun eligibleRoleStillRequiresServerDiscoveryApproval() = runTest {
        MockWebServer().use { server ->
            server.start()
            val api = api(server)
            val viewer = Viewer(api)
            server.enqueue(MockResponse.Builder().body("""{"role":"BOD","isCompany":true}""").build())
            server.enqueue(MockResponse.Builder().code(403).body("""{"error":"Forbidden","code":"ALL_PIPELINES_FORBIDDEN"}""").build())
            assertNull(PipelineAllAccess.load(api, viewer))
            assertEquals("/api/workspaces/members", server.takeRequest().target)
            assertEquals("/api/pipelines/boards", server.takeRequest().target)

            server.enqueue(MockResponse.Builder().body("""{"workspaceId":"w","boards":[{"id":"p","name":"Pipeline Suwara","dealCount":3}]}""").build())
            val approved = PipelineAllAccess.load(api, viewer)
            assertEquals("w", approved?.workspaceId)
            assertEquals("p", approved?.boards?.single()?.id)
            assertEquals("/api/pipelines/boards", server.takeRequest().target)
        }
    }
}
