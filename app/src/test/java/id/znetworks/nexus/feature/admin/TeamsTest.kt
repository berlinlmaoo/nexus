package id.znetworks.nexus.feature.admin

import id.znetworks.nexus.core.net.NexusJson
import id.znetworks.nexus.feature.projects.Project
import kotlinx.serialization.json.JsonNull
import org.junit.Assert.assertEquals
import org.junit.Test

class TeamsTest {
    private val team = NexusJson.decodeFromString(Team.serializer(), """{"id":"t","name":"Ops","canManage":true,
        "members":[{"id":"tm1","userId":"u1","user":{"name":"Ana"}},{"id":"tm2","user":{"id":"u2","name":"Bo"}}],
        "projects":[{"id":"l1","projectId":"p1","project":{"name":"Web"}},{"id":"l2","project":{"id":"p2","name":"App"}}]}""")

    @Test fun addableAndLinkableSkipWhoIsAlreadyThere() {
        val roster = listOf(WsMember("m1", "u1", name = "Ana"), WsMember("m2", "u2", name = "Bo"), WsMember("m3", "u3", name = "cy"))
        assertEquals(listOf("u3"), TeamLogic.addable(team, roster).map { it.userId })
        assertEquals(listOf("p3"), TeamLogic.linkable(team, listOf(Project("p1"), Project("p2"), Project("p3"))).map { it.id })
    }

    @Test fun shiftOffSendsNullHours() {
        val off = TeamLogic.shiftBody("t", false, "08:00", "17:00")
        assertEquals(JsonNull, off["attendanceShiftStartTime"]); assertEquals(JsonNull, off["attendanceShiftEndTime"])
        assertEquals("\"08:00\"", TeamLogic.shiftBody("t", true, "08:00", "17:00")["attendanceShiftStartTime"].toString())
    }

    @Test fun leavingATeamLosesOnlyItsProjects() {
        val ms = UserMemberships(projects = listOf(MProject("p1", "Web", viaTeam = "Ops"), MProject("p9", "Own")))
        assertEquals(listOf("Web"), TeamLogic.losing(ms, "Ops")); assertEquals(emptyList<String>(), TeamLogic.losing(ms, "Other"))
    }
}
