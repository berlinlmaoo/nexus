package id.znetworks.nexus.feature.reports

import id.znetworks.nexus.core.nav.Links
import id.znetworks.nexus.core.nav.Target
import id.znetworks.nexus.core.net.NexusJson
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class ReportLogicTest {
    @Test fun ratiosAndHours() {
        assertEquals(67, Ratio(2, 3).pct); assertNull(Ratio(0, 0).pct)
        assertEquals("8:45", ReportLogic.hours(525)); assertNull(ReportLogic.hours(null))
    }

    @Test fun crewSearchByNameEmailOrTeam() {
        val rows = listOf(RosterRow("1", "Budi", "b@x.id", teams = listOf(TeamRef("t", "Creative"))), RosterRow("2", "Citra", "c@x.id"))
        assertEquals(listOf("1"), ReportLogic.filter(rows, "creat").map { it.userId })
        assertEquals(listOf("2"), ReportLogic.filter(rows, "C@X").map { it.userId })
        assertEquals(2, ReportLogic.filter(rows, " ").size)
    }

    @Test fun decodesPersonReportLeniently() {
        val r = NexusJson.decodeFromString(PersonReport.serializer(), """{"person":{"id":"u","name":"Budi","isSelf":true},"viewerScope":"SELF",
            "headline":{"completed":5,"onTime":{"num":4,"den":5},"attendanceRate":{"num":20,"den":21},"xpScore":120},
            "work":{"overdueList":[{"id":"t","title":"Invoice","daysOverdue":3}],"weekly":[{"completed":2},{"completed":3}]},
            "xp":{"periodScore":120,"penalties":[{"kind":"late","count":2,"xp":-40}]},"future":1}""")
        assertEquals(80, r.headline.onTime.pct)
        assertEquals(3, r.work.overdueList.single().daysOverdue)
        assertEquals(-40, r.xp!!.penalties.single().xp)
    }

    @Test fun reportLinks() {
        assertEquals(Target.Reports("u1"), Links.parse("/reports/u1"))
        assertEquals(Target.Reports(null), Links.parse("/reports"))
    }
}
