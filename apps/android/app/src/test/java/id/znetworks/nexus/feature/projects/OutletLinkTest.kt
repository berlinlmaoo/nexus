package id.znetworks.nexus.feature.projects

import org.junit.Assert.*
import org.junit.Test

class OutletLinkTest {
    @Test fun projectLinkRetainsTheRequestedDate() {
        val target = id.znetworks.nexus.core.nav.Links.parse("nexus://projects/p?view=calendar&date=2026-10-15")
        assertEquals(id.znetworks.nexus.core.nav.Target.Project("p", "calendar", "2026-10-15"), target)
    }
    @Test fun outletLinksSelectOutletModulesInsteadOfTaskViews() {
        assertEquals(ProjectTab.OUTLET_CALENDAR, ProjectTabsLogic.outletLink("calendar"))
        assertEquals(ProjectTab.OUTLET_BOARD, ProjectTabsLogic.outletLink("board"))
        assertEquals(ProjectTab.OUTLET_OVERVIEW, ProjectTabsLogic.outletLink("overview"))
        assertEquals(ProjectTab.OUTLET_FORM, ProjectTabsLogic.outletLink("forms"))
        assertNull(ProjectTabsLogic.outletLink("unknown"))
    }
}
