package id.znetworks.nexus.feature.gideon

import id.znetworks.nexus.core.net.NexusJson
import org.junit.Assert.*
import org.junit.Test

class GideonProposalCopyTest {
    @Test fun localizedSummaryFallsBackForReleasedServersAndSurvivesWireDecoding() {
        val p = NexusJson.decodeFromString(GProposal.serializer(), """{"id":"p","summary":"Fallback","summaryEn":"English","summaryId":"Indonesia","noChange":true}""")
        assertEquals("English", p.summaryFor("en")); assertEquals("Indonesia", p.summaryFor("id")); assertTrue(p.noChange)
        val old = NexusJson.decodeFromString(GProposal.serializer(), """{"id":"p","summary":"Fallback"}""")
        assertEquals("Fallback", old.summaryFor("id")); assertFalse(old.noChange)
        assertEquals("Fallback", p.copy(summaryId = " ").summaryFor("id"))
    }
    @Test fun onlySmallNewChatApprovalSectionsStartOpen() {
        assertTrue(GideonPending.startsExpanded(true, 1)); assertTrue(GideonPending.startsExpanded(true, 2))
        assertFalse(GideonPending.startsExpanded(true, 3)); assertFalse(GideonPending.startsExpanded(false, 1))
        assertFalse(GideonPending.startsExpanded(false, 10))
    }
}
