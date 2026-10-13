package id.znetworks.nexus.core.realtime

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** workspace-changed carries the project's new icon when a PATCH changed it (owner, 14 Oct 2026). */
class ProjectIconPingTest {
    @Test fun iconRidesOnTheProjectsPing() {
        val photo = RealtimeEvents.parse(RealtimeEvents.WORKSPACE_CHANGED, """{"kind":"projects","projectId":"p1","icon":"/api/files/project-icons/p1.jpg?v=9"}""")
        assertTrue(photo.iconChanged); assertEquals("/api/files/project-icons/p1.jpg?v=9", photo.icon)
        // Removed: null (or "folder") is a change too, back to the page icon.
        val removed = RealtimeEvents.parse(RealtimeEvents.WORKSPACE_CHANGED, """{"kind":"projects","projectId":"p1","icon":null}""")
        assertTrue(removed.iconChanged); assertNull(removed.icon)
        // Any other project change says nothing about the icon.
        val other = RealtimeEvents.parse(RealtimeEvents.WORKSPACE_CHANGED, """{"kind":"projects","projectId":"p1"}""")
        assertFalse(other.iconChanged)
    }
}
