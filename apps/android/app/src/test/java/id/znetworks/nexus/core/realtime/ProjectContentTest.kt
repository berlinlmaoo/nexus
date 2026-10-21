package id.znetworks.nexus.core.realtime

import org.junit.Assert.*
import org.junit.Test

class ProjectContentTest {
    @Test fun projectKindsAreScopedAndTaskSideDataRefreshesTheOpenTask() {
        listOf("task", "tasks", "forms", "sheets", "sheet-comments", "status-updates", "members", "pages", "files").forEach { kind ->
            val e = RealtimeEvents.parse("project-changed", """{"projectId":"p","kind":"$kind","id":"t","actorId":"u"}""")
            assertTrue(RealtimeEvents.LISTENED.contains(e.name))
            assertEquals("u", e.userId)
            assertTrue(RealtimeEvents.touchesProject(e, "p"))
            assertFalse(RealtimeEvents.touchesProject(e, "other"))
            assertTrue(RealtimeEvents.projectContent(e, "p", kind))
            assertEquals(kind == "task", RealtimeEvents.touchesTask(e, "t"))
            assertFalse(RealtimeEvents.touchesTask(e, "other"))
        }
        val e = RealtimeEvents.parse("task-updated", """{"id":"t","projectId":"other"}""")
        assertFalse(RealtimeEvents.touchesProject(e, "p"))
    }

    @Test fun ticketPingRefetchesTheBoardAndMatchingDetail() {
        val e = RealtimeEvents.parse("complaint-changed", """{"id":"c","kind":"correction"}""")
        assertTrue(RealtimeEvents.LISTENED.contains(e.name))
        assertTrue(RealtimeEvents.complaint(e))
        assertTrue(RealtimeEvents.complaint(e, "c"))
        assertFalse(RealtimeEvents.complaint(e, "other"))
        assertFalse(RealtimeEvents.complaint(RealtimeEvent("task-updated")))
    }
}
