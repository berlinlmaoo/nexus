package id.znetworks.nexus.feature.projects

import id.znetworks.nexus.core.net.NexusJson
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.time.Instant

/** SPRINTS-OVERVIEW §3 (Berlin, 11 Oct; web fc81517): the Overview's numbers and the drill into the Board. */
class ProjectOverviewTest {
    // 2026-10-11 10:00 WIB.
    private val now = Instant.parse("2026-10-11T03:00:00Z")
    private fun who(id: String, name: String = id) = Assignee(id, UserRef(id, name))
    private val lanes = listOf(
        Lane("todo", "To do", tasks = listOf(
            BoardTask("late", status = "TODO", priority = "HIGH", dueDate = "2026-10-08", assignees = listOf(who("a"))),
            BoardTask("today", status = "IN_PROGRESS", priority = "URGENT", dueDate = "2026-10-11", assignees = listOf(who("a"), who("b"))),
            BoardTask("d6", status = "TODO", dueDate = "2026-10-17"),
            BoardTask("d10", status = "TODO", priority = "LOW", dueDate = "2026-10-21", assignees = listOf(who("b"))),
            BoardTask("nodue", status = "IN_REVIEW"),
            BoardTask("sub", status = "TODO", parentId = "late", dueDate = "2026-10-01"),
        )),
        Lane("done", "Done", tasks = listOf(
            BoardTask("fin1", status = "DONE", completedAt = "2026-10-10T08:00:00Z", completedById = "a", assignees = listOf(who("a"))),
            BoardTask("fin2", status = "DONE", completedAt = "2026-09-20T08:00:00Z", assignees = listOf(who("b"))),
            BoardTask("gone", status = "CANCELLED", dueDate = "2026-10-01"),
        )),
    )
    private val members = listOf(ProjectMemberRef("a", "LEAD", UserRef("a", "Ayu")), ProjectMemberRef("c", "MEMBER", UserRef("c", "Cici")))

    @Test fun numbers() {
        val m = OverviewLogic.compute(lanes, members, now)
        assertEquals(8, m.total)                       // the subtask is left out
        assertEquals(2, m.done); assertEquals(25, m.pct); assertEquals(1, m.doneLast7)
        assertEquals(mapOf("TODO" to 3, "IN_PROGRESS" to 1, "IN_REVIEW" to 1, "DONE" to 2, "CANCELLED" to 1), m.byStatus)
        assertEquals(5, m.open)
        assertEquals(listOf("late"), m.overdue.map { it.id })
        assertEquals(listOf("today", "d6", "d10"), m.upcoming.map { it.id })
        assertEquals(2, m.next7)                       // today and +6, not +10
        assertEquals(1, m.noDue); assertEquals(2, m.unassigned)
        assertEquals(mapOf("HIGH" to 1, "URGENT" to 1, "LOW" to 1, "NONE" to 2), m.byPriority)
        assertEquals(listOf("fin1", "fin2"), m.completed.map { it.id })
        val a = m.people.first { it.id == "a" }
        assertTrue(a.lead); assertEquals("Ayu", a.name); assertEquals(2, a.open); assertEquals(1, a.overdue); assertEquals(1, a.doneMonth)
        assertEquals(0, m.people.first { it.id == "b" }.doneMonth)   // September doesn't count
        assertEquals(listOf("a", "b", "c"), m.people.map { it.id }) // most open first; a member with nothing still listed
        assertEquals(OverviewSection("todo", "To do", 5, 5, 0), m.sections[0])
        assertEquals(OverviewSection("done", "Done", 3, 0, 2), m.sections[1])
    }

    @Test fun drillShowsOpenTasksOnly() {
        fun ids(d: OverviewDrill?) = OverviewLogic.filter(lanes, d, now).flatMap { it.tasks }.map { it.id }.filter { it != "sub" }
        assertEquals(listOf("late", "today", "d6", "d10", "nodue"), ids(OverviewDrill()))
        assertEquals(listOf("late"), ids(OverviewDrill(due = "OVERDUE")))
        assertEquals(listOf("today", "d6"), ids(OverviewDrill(due = "NEXT7")))
        assertEquals(listOf("nodue"), ids(OverviewDrill(due = "NONE")))
        assertEquals(listOf("d6", "nodue"), ids(OverviewDrill(assigneeId = "NONE")))
        assertEquals(listOf("late", "today"), ids(OverviewDrill(assigneeId = "a")))
        assertEquals(listOf("d6", "nodue"), ids(OverviewDrill(priority = "NONE")))
        assertEquals(emptyList<String>(), ids(OverviewDrill(section = "done")))
        assertEquals(lanes, OverviewLogic.filter(lanes, null, now))
    }

    @Test fun shapesAndWiring() {
        assertEquals("u", NexusJson.decodeFromString(BoardTask.serializer(), """{"id":"t","completedById":"u"}""").completedById)
        val u = NexusJson.decodeFromString(StatusUpdate.serializer(), """{"id":"s","text":"ok","status":"AT_RISK","createdAt":"2026-10-11T03:00:00Z","author":{"id":"a","name":"Ayu"}}""")
        assertEquals("Ayu", u.author?.name)
        val api = File("src/main/java/id/znetworks/nexus/feature/projects/ProjectsApi.kt").readText()
        assertTrue(api.contains("/api/status-updates?projectId=") && api.contains("/status-updates/generate"))
        val screen = File("src/main/java/id/znetworks/nexus/feature/projects/ProjectDetailScreen.kt").readText()
        assertTrue(screen.contains("ProjectTab.OVERVIEW -> ProjectOverview(") && screen.contains("OverviewLogic.filter(TemplateLogic.mine(s.lanes, if (s.mine) meId else null), s.drill)"))
        assertFalse(screen.contains("private fun Overview("))
        listOf("values", "values-in").forEach { v ->
            val s = File("src/main/res/$v/strings.xml").readText()
            listOf("ov_progress", "ov_deadlines", "ov_team", "ov_by_priority", "ov_recent_done", "ov_updates", "ov_days_late", "ov_hint_open").forEach { assertTrue("$v $it", s.contains("name=\"$it\"")) }
        }
    }
}
