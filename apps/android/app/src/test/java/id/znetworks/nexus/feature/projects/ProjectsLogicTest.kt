package id.znetworks.nexus.feature.projects

import org.junit.Assert.assertEquals
import org.junit.Test

/** The Projects page summary, filter and order (iOS ProjectsView / ProjectsSummaryCard). */
class ProjectsLogicTest {
    private fun p(id: String, name: String, status: String? = null, members: List<String> = emptyList(), tasks: Int = 0) =
        Project(id = id, name = name, status = status, members = members.map { ProjectMemberRef(userId = it) },
            taskLists = listOf(LaneSummary(id = "l-$id", count = LaneCount(tasks))))

    private val list = listOf(p("a", "beta", members = listOf("u1", "u2"), tasks = 4), p("b", "Alpha", "ARCHIVED", listOf("u2", "u3"), 10), p("c", "gamma", tasks = 2))
    private val tallies = mapOf("a" to Tally(1, 4, null), "b" to Tally(9, 10, null), "c" to Tally(1, 2, null))

    @Test fun summaryOverEveryProject() {
        // 11 of 16 done = 69 %; members counted once each.
        assertEquals(ProjectsLogic.Summary(69, 11, 3), ProjectsLogic.summary(list, tallies))
        assertEquals(ProjectsLogic.Summary(null, null, 3), ProjectsLogic.summary(list, null))
    }

    @Test fun filterAndOrder() {
        assertEquals(listOf("b", "c", "a"), ProjectsLogic.visible(list, "all", "energy", tallies).map { it.id })
        assertEquals(listOf("b", "a", "c"), ProjectsLogic.visible(list, "all", "name", tallies).map { it.id })
        assertEquals(listOf("b", "a", "c"), ProjectsLogic.visible(list, "all", "tasks", tallies).map { it.id })
        assertEquals(listOf("b"), ProjectsLogic.visible(list, "ARCHIVED", "energy", tallies).map { it.id })
        // No status = active.
        assertEquals(listOf("c", "a"), ProjectsLogic.visible(list, "ACTIVE", "energy", tallies).map { it.id })
    }
}
