package id.znetworks.nexus.feature.admin

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class RolesTest {
    private fun m(id: String, role: String = "STAFF", approver: String? = null, name: String = id) = WsMember("m$id", id, name = name, role = role, approverId = approver)

    @Test fun onlyRolesBelowMineAreAssignable() {
        assertEquals(listOf("MANAGER", "STAFF"), Roles.assignable("BOD"))
        // Server canAssign: One Above All may give any role; below BoD nobody assigns anything.
        assertEquals(Roles.ALL, Roles.assignable("ONE_ABOVE_ALL"))
        assertEquals(emptyList<String>(), Roles.assignable("MANAGER"))
        assertEquals(emptyList<String>(), Roles.assignable("STAFF"))
        assertEquals(emptyList<String>(), Roles.assignable(null))
        assertTrue(Roles.canEdit("ONE_ABOVE_ALL", "ONE_ABOVE_ALL")); assertFalse(Roles.canEdit("BOD", "BOD"))
        assertTrue(Roles.canEdit("BOD", "MANAGER")); assertFalse(Roles.canEdit("MANAGER", "STAFF"))
    }

    @Test fun rosterFilterSortsAToZ() {
        val l = listOf(m("1", name = "zed"), m("2", "BOD", name = "Ana"), m("3", name = "bob"))
        assertEquals(listOf("Ana", "bob", "zed"), Roles.filter(l, "ALL", "").map { it.displayName })
        assertEquals(listOf("Ana"), Roles.filter(l, "BOD", "").map { it.displayName })
        assertEquals(listOf("bob"), Roles.filter(l, "ALL", "BO").map { it.displayName })
    }

    @Test fun approvalLoopsAreSeenBeforeTheServerRefusesThem() {
        val l = listOf(m("boss", "BOD"), m("mgr", "MANAGER", approver = "boss"), m("staff", approver = "mgr"))
        assertTrue(Roles.makesCycle(l, "mgr", "staff"))   // staff → mgr → staff
        assertFalse(Roles.makesCycle(l, "staff", "boss"))
        assertEquals(listOf("new"), Roles.unplaced(l + m("new")).map { it.userId })
    }
}
