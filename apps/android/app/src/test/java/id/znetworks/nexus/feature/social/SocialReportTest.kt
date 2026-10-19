package id.znetworks.nexus.feature.social

import id.znetworks.nexus.core.net.NexusJson
import id.znetworks.nexus.core.realtime.RealtimeEvents
import id.znetworks.nexus.feature.projects.*
import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Test

class SocialReportTest {
    private fun obj(s: String) = NexusJson.parseToJsonElement(s) as JsonObject

    @Test fun socialProjectsNeverExposeTaskViews() {
        val tabs = ProjectTabsLogic.visible(emptySet(), isSocial = true)
        assertEquals(listOf(ProjectTab.SOCIAL_OVERVIEW, ProjectTab.SOCIAL_CALENDAR, ProjectTab.CHAT), tabs)
        assertEquals(ProjectTab.SOCIAL_OVERVIEW, ProjectTabsLogic.fallback(ProjectTab.BOARD, tabs))
        assertFalse(ProjectDetailState(detail = ProjectDetail("p", "Brand", type = "SOCIAL_MEDIA_REPORT")).taskProject)
        assertTrue(TemplateLogic.dashboards(false).contains(ProjectType.SOCIAL_MEDIA_REPORT))
    }

    @Test fun dayWritesOnlyChangedFieldsAndDistinguishesBlankFromZero() {
        val original = obj("""{"platforms":{"instagram":{"views":100,"likes":0,"comments":null}},"worked":"Reel","didntWork":""}""")
        assertEquals(obj("""{"platforms":{"instagram":{"views":null,"comments":0}},"worked":""}"""), SocialDraft.day(original, mapOf(
            "instagram:views" to "", "instagram:likes" to "0", "instagram:comments" to "0", "worked" to "", "didntWork" to "")))
        assertTrue(SocialDraft.day(original, mapOf("instagram:likes" to "0", "worked" to "Reel")).isEmpty())
    }

    @Test fun numbersRejectInvalidAndOversizeInsteadOfSilentlyTruncating() {
        assertEquals(JsonNull, SocialDraft.number("", 100))
        assertEquals(JsonPrimitive(0), SocialDraft.number("0", 100))
        listOf("-1", "1.5", "101", "99999999999999999999999", "abc").forEach { assertNull(SocialDraft.number(it, 100)) }
    }

    @Test fun overviewUsesServerTargetsAndPermissions() {
        val d = SocialMonth(obj("""{"month":"2026-10","today":"2026-10-19","canRecord":true,"canManage":false,"overview":{"platforms":[{"engagement":15,"engagementTargetToDate":9.51,"engagementPct":157}]}}"""))
        assertTrue(d.canRecord); assertFalse(d.canManage)
        assertEquals(9.51, d.overview.rows("platforms").single().number("engagementTargetToDate")!!, 0.0)
        assertTrue(RealtimeEvents.LISTENED.contains("social-media-changed"))
    }
}
