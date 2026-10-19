package id.znetworks.nexus.ui.shell

import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** The redesigned shell (dev web AppSidebar / MobileTabBar, 13 Oct 2026). */
class ShellNavTest {
    private fun items(company: Boolean?, admin: Boolean, cal: Boolean = true) = ShellNav.groups(company, admin, cal).flatMap { it.second }

    @Test fun groupsInTheWebOrder() {
        assertEquals(listOf(ShellNav.Group.HOME, ShellNav.Group.WORK, ShellNav.Group.TEAM, ShellNav.Group.SYSTEM), ShellNav.groups(true, true, true).map { it.first })
        // Home group in the web's order.
        assertEquals(
            listOf("DASHBOARD", "MESSAGES", "GIDEON", "NOTIFICATIONS", "THREADS", "VAULT", "MY_TASKS", "SUBMISSIONS", "CALENDAR", "ROOMS"),
            ShellNav.groups(true, true, true).first().second.map { it.name },
        )
    }

    @Test fun companyAndRoleGates() {
        // Workspace not known yet: Z Vault and Threads stay hidden; outside Z Networks too.
        assertFalse(ShellNav.Item.VAULT in items(null, false)); assertFalse(ShellNav.Item.THREADS in items(false, false))
        assertTrue(ShellNav.Item.VAULT in items(true, false))
        assertFalse(ShellNav.Item.ROOMS in items(null, false)); assertFalse(ShellNav.Item.ROOMS in items(false, false))
        assertTrue(ShellNav.Item.ROOMS in items(true, false))
        // Control Room: Manager and above only.
        assertFalse(ShellNav.Item.CONTROL_ROOM in items(true, false)); assertTrue(ShellNav.Item.CONTROL_ROOM in items(true, true))
        // Legal (owner, 14 Oct 2026): invitation only, drawn after Projects in Work.
        assertFalse(ShellNav.Item.LEGAL in items(true, true))
        val work = ShellNav.groups(true, true, true, legal = true).first { it.first == ShellNav.Group.WORK }.second
        assertEquals(listOf(ShellNav.Item.PROJECTS, ShellNav.Item.LEGAL), work.take(2))
        assertEquals(ShellNav.Item.LEGAL, ShellNav.itemOf("legal-doc/{id}"))
        assertEquals(ShellNav.Item.LEGAL, ShellNav.itemOf("legal?tab={tab}&request={request}"))
        // The calendar flag off: no Calendar entry.
        assertFalse(ShellNav.Item.CALENDAR in items(true, true, cal = false))
    }

    @Test fun routesMapToTheirEntry() {
        assertEquals(ShellNav.Item.DASHBOARD, ShellNav.itemOf("home"))
        assertEquals(ShellNav.Item.MESSAGES, ShellNav.itemOf(ShellRoutes.CHAT))
        assertEquals(ShellNav.Item.VAULT, ShellNav.itemOf("vault?folder={folder}&trash={trash}"))
        assertEquals(ShellNav.Item.PROJECTS, ShellNav.itemOf("project/{id}"))
        assertEquals(ShellNav.Item.CALENDAR, ShellNav.itemOf("calendar?date={date}&view={view}"))
        assertEquals(ShellNav.Item.CONTROL_ROOM, ShellNav.itemOf("admin-user/{id}"))
        assertEquals(ShellNav.Item.SETTINGS, ShellNav.itemOf("account"))
        // Every entry's own route (bar What's New, an action) maps back to it.
        ShellNav.Item.entries.filter { it.route.isNotEmpty() }.forEach { assertEquals(it, ShellNav.itemOf(it.route)) }
    }

    @Test fun tabsAreRealShellRoutes() {
        // Entries marked as tabs are bottom-bar tabs, so the shell switches to them instead of pushing a copy.
        ShellNav.Item.entries.filter { it.tab }.forEach { item -> assertTrue(item.name, Tab.entries.any { it.route == item.route }) }
    }

    @Test fun sidebarFromExpandedWidth() {
        assertFalse(ShellLayout.useSidebar(600)); assertFalse(ShellLayout.useSidebar(839)); assertTrue(ShellLayout.useSidebar(840))
    }

    @Test fun redesignStringsHaveIndonesian() {
        // Every new strings_*.xml (the redesign keeps its copy apart from strings.xml) has an Indonesian twin, key for key.
        val files = File("src/main/res/values").listFiles { f -> f.name.startsWith("strings_") && f.name.endsWith(".xml") }!!.map { it.name }
        assertTrue(files.isNotEmpty())
        val key = Regex("<(?:string|plurals) name=\"([^\"]+)\"")
        files.forEach { name ->
            val en = key.findAll(File("src/main/res/values/$name").readText()).map { it.groupValues[1] }.toSet()
            val id = key.findAll(File("src/main/res/values-in/$name").readText()).map { it.groupValues[1] }.toSet()
            assertEquals("$name: missing Indonesian", emptySet<String>(), en - id)
            assertEquals("$name: Indonesian without English", emptySet<String>(), id - en)
        }
    }
}
