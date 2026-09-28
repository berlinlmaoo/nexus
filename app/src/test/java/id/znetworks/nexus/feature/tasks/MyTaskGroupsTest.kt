package id.znetworks.nexus.feature.tasks

import id.znetworks.nexus.feature.projects.BoardTask
import org.junit.Assert.assertEquals
import org.junit.Test
import java.time.LocalDate

class MyTaskGroupsTest {
    private val today = LocalDate.of(2026, 9, 28)
    private fun t(id: String, due: String? = null, status: String = "TODO") = BoardTask(id = id, title = id, dueDate = due, status = status)

    @Test fun hotIsOpenAndDueWithinTwoDaysSoonestFirst() {
        val g = MyTaskGroups.group(listOf(
            t("later", "2026-10-05T00:00:00.000Z"), t("tomorrow", "2026-09-29T00:00:00.000Z"),
            t("overdue", "2026-09-20T00:00:00.000Z"), t("nodue"), t("done", "2026-09-28", "DONE"),
        ), today).toMap()
        assertEquals(listOf("overdue", "tomorrow"), g[MyTaskGroups.Group.HOT]!!.map { it.id })
        assertEquals(listOf("later", "nodue"), g[MyTaskGroups.Group.MOTION]!!.map { it.id })
        assertEquals(listOf("done"), g[MyTaskGroups.Group.DONE]!!.map { it.id })
    }

    @Test fun emptyGroupsAreLeftOut() {
        assertEquals(listOf(MyTaskGroups.Group.MOTION), MyTaskGroups.group(listOf(t("a")), today).map { it.first })
    }
}
