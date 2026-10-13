package id.znetworks.nexus.feature.tasks

import id.znetworks.nexus.feature.projects.BoardTask
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant

/** My Tasks like the web (lib/my-tasks.ts): Overdue · Due soon · Later · Done in the last 7 days. */
class MyTaskGroupsTest {
    // 14 Oct 2026, 10:00 WIB.
    private val now = Instant.parse("2026-10-14T03:00:00Z").toEpochMilli()
    private fun t(id: String, due: String? = null, status: String = "TODO", priority: String? = null, completedAt: String? = null, updatedAt: String? = null) =
        BoardTask(id = id, title = id, dueDate = due, status = status, priority = priority, completedAt = completedAt, updatedAt = updatedAt)

    @Test fun groupsLikeTheWeb() {
        val g = MyTaskGroups.group(listOf(
            t("yesterday", "2026-10-13T00:00:00.000Z"),
            t("today-date", "2026-10-14T00:00:00.000Z"),        // date-only, today: not overdue yet
            t("today-0900", "2026-10-14T02:00:00.000Z"),        // 09:00 WIB, already past
            t("in3days", "2026-10-17T00:00:00.000Z"),
            t("in4days", "2026-10-18T00:00:00.000Z"),
            t("nodue"),
            t("cancelled", "2026-10-13T00:00:00.000Z", status = "CANCELLED"),
            t("done-recent", status = "DONE", completedAt = "2026-10-12T13:27:37.772Z"),
            t("done-old", status = "DONE", completedAt = "2026-09-08T18:32:01.640Z"),
        ), now).toMap()
        assertEquals(listOf("yesterday", "today-0900"), g[MyTaskGroups.Group.OVERDUE]!!.map { it.id })
        assertEquals(listOf("today-date", "in3days"), g[MyTaskGroups.Group.SOON]!!.map { it.id })
        assertEquals(listOf("in4days", "nodue"), g[MyTaskGroups.Group.LATER]!!.map { it.id })
        assertEquals(listOf("done-recent"), g[MyTaskGroups.Group.DONE]!!.map { it.id })
    }

    @Test fun onlyOldDoneTasksMeansEmpty() {
        // The dev account on 14 Oct: 8 tasks, all done months ago. The web shows "No tasks yet".
        assertTrue(MyTaskGroups.group(listOf(t("a", status = "DONE", completedAt = "2026-04-17T14:57:35.452Z", updatedAt = "2026-06-15T13:23:24.205Z")), now).isEmpty())
    }

    @Test fun sameDayByPriorityThenTime() {
        val g = MyTaskGroups.group(listOf(
            t("low-early", "2026-10-15T01:00:00Z", priority = "LOW"), t("urgent-late", "2026-10-15T09:00:00Z", priority = "URGENT"),
            t("b"), t("a-high", priority = "HIGH"),
        ), now).toMap()
        assertEquals(listOf("urgent-late", "low-early"), g[MyTaskGroups.Group.SOON]!!.map { it.id })
        assertEquals(listOf("a-high", "b"), g[MyTaskGroups.Group.LATER]!!.map { it.id })
    }

    @Test fun dateOnly() {
        assertTrue(MyTaskGroups.isDateOnly(Instant.parse("2026-10-14T00:00:00Z").toEpochMilli()))
        assertTrue(MyTaskGroups.isDateOnly(Instant.parse("2026-10-13T17:00:00Z").toEpochMilli())) // 00:00 WIB
        assertFalse(MyTaskGroups.isDateOnly(Instant.parse("2026-10-14T02:00:00Z").toEpochMilli()))
    }
}
