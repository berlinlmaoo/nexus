package id.znetworks.nexus.feature.admin

import org.junit.Assert.assertEquals
import org.junit.Test

class ChartLogicTest {
    private fun m(id: String, role: String = "STAFF", approver: String? = null) = WsMember("m$id", id, name = id, role = role, approverId = approver)
    private val people = listOf(
        m("boss", "BOD"), m("lonely", "BOD"),
        m("mgr", "MANAGER", "boss"), m("s1", approver = "mgr"), m("s2", approver = "mgr"),
        m("free"), m("ghost", approver = "left-the-company"), m("lead", "MANAGER"), m("s3", approver = "lead"),
    )

    @Test fun treesAloneAndCounts() {
        assertEquals(listOf("boss", "lonely", "lead"), ChartLogic.trees(people).map { it.userId })
        assertEquals(listOf("free", "ghost"), ChartLogic.alone(people).map { it.userId }) // an approver not in the workspace = none
        assertEquals(4, ChartLogic.placed(people))
        assertEquals(3, ChartLogic.unplaced(people)) // lead (a manager at the top), free, ghost
        assertEquals(listOf("s1", "s2"), ChartLogic.children(people)["mgr"]!!.map { it.userId })
    }

    @Test fun candidatesExcludeSelfAndEveryoneBelow() {
        val c = ChartLogic.candidates(people, "boss").map { it.userId }.toSet()
        assertEquals(setOf("lonely", "free", "ghost", "lead", "s3"), c)
        assertEquals(false, "mgr" in ChartLogic.candidates(people, "mgr").map { it.userId })
    }

    @Test fun hoursOnTheCard() {
        assertEquals("9 AM", ChartLogic.to12("09:00")); assertEquals("1:30 PM", ChartLogic.to12("13:30"))
        assertEquals("12 AM", ChartLogic.to12("00:00")); assertEquals("x", ChartLogic.to12("x"))
    }
}
