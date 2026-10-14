package id.znetworks.nexus.feature.people

import id.znetworks.nexus.feature.admin.Team
import id.znetworks.nexus.feature.admin.TeamMember
import id.znetworks.nexus.feature.projects.Project
import id.znetworks.nexus.feature.projects.ProjectMemberRef
import id.znetworks.nexus.feature.projects.UserRef
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** The member profile's Teams and Projects cards (iOS MemberProfileView): only where that person is a member. */
class MembershipLogicTest {
    @Test fun teamsAndProjectsOfThatPerson() {
        val teams = listOf(Team("t1", "Finance", members = listOf(TeamMember(userId = "u1"))), Team("t2", "Tech", members = listOf(TeamMember(userId = "u2"))))
        assertEquals(listOf("t1"), MembershipLogic.teams(teams, "u1").map { it.id })
        val projects = listOf(
            Project("p1", "A", members = listOf(ProjectMemberRef(user = UserRef(id = "u1")))),
            Project("p2", "B", members = listOf(ProjectMemberRef(userId = "u2"))),
        )
        assertEquals(listOf("p1"), MembershipLogic.projects(projects, "u1").map { it.id })
        assertEquals(emptyList<Project>(), MembershipLogic.projects(projects, "u3"))
    }

    @Test fun activeIsNotRepeated() {
        assertFalse(MembershipLogic.showStatus(null)); assertFalse(MembershipLogic.showStatus("active"))
        assertTrue(MembershipLogic.showStatus("ON_HOLD"))
    }
}
