package id.znetworks.nexus.feature.projects

import id.znetworks.nexus.core.net.ApiClient
import id.znetworks.nexus.core.net.ClientIdentity
import id.znetworks.nexus.core.realtime.RealtimeEvents
import kotlinx.coroutines.test.runTest
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/** Access levels (HANDOFF scope 3; web 5e416d9 + e74a735 + f661bfb, iOS ProjectAccess). */
class AccessLevelsTest {
    @Test fun revokedRoomIsRead() {
        val e = RealtimeEvents.parse(RealtimeEvents.JOIN_DENIED, """{"room":"project:p1","reason":"revoked"}""")
        assertTrue(RealtimeEvents.revoked(e, "p1")); assertFalse(RealtimeEvents.revoked(e, "p2"))
        assertTrue(RealtimeEvents.touchesProject(e, "p1")) // the open project refetches into the no-access state
        assertFalse(RealtimeEvents.revoked(RealtimeEvents.parse(RealtimeEvents.JOIN_DENIED, """{"room":"project:p1","reason":"full"}"""), "p1"))
        assertTrue(RealtimeEvents.JOIN_DENIED in RealtimeEvents.LISTENED)
    }

    @Test fun memberWritesCarryTheLevel() = runTest {
        val server = MockWebServer(); server.start()
        try {
            val api = ProjectsApi(ApiClient(server.url("/"), ClientIdentity("0.1.6", 13, 34), sessionProvider = { null }))
            repeat(3) { server.enqueue(MockResponse.Builder().code(200).body("""{"added":[{"userId":"u"}]}""").build()) }
            api.addMembers("p1", listOf("u"), AccessLevel.COMMENT)
            val add = server.takeRequest()
            assertEquals("/api/projects/p1/members", add.url.encodedPath); assertTrue(add.body!!.utf8().contains("\"accessLevel\":\"COMMENT\""))
            api.setMemberAccess("p1", "u", AccessLevel.FULL)
            val patch = server.takeRequest()
            assertEquals("PATCH", patch.method); assertEquals("""{"userId":"u","accessLevel":"FULL"}""", patch.body!!.utf8())
            api.invite("p1", " a@b.co ", AccessLevel.VIEW)
            assertEquals("""{"email":"a@b.co","accessLevel":"VIEW"}""", server.takeRequest().body!!.utf8())
        } finally { server.close() }
    }

    @Test fun screensAreGated() {
        fun src(p: String) = File("src/main/java/id/znetworks/nexus/$p").readText()
        val settings = src("feature/projects/ProjectSettingsScreen.kt")
        assertTrue(settings.contains("val ro = !access.canManage") && settings.contains("R.string.acc_settings_readonly"))
        assertTrue(settings.contains("vm.setAccess(uid, l)") && settings.contains("R.string.acc_remove_q"))
        val task = src("feature/tasks/TaskDetailScreen.kt")
        assertTrue(task.contains("ReadOnly(ro) { DescriptionCard(t, vm) }") && task.contains("ReadOnly(!s.access.canComment) { CommentsCard(t, vm) }"))
        assertTrue(src("feature/chat/ChatThreadScreen.kt").contains("s.conversation?.canPost == false"))
        // Add task, inline New task and bulk edits need Can edit.
        val page = src("feature/projects/ProjectPage.kt")
        assertTrue(page.contains("val create = if (access.canEdit) groupCreate("))
        assertTrue(src("feature/projects/ProjectDetailScreen.kt").contains("val canAddTask = access.canEdit"))
    }
}
