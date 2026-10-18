package id.znetworks.nexus.feature.gideon

import id.znetworks.nexus.core.net.NexusJson
import org.junit.Assert.*
import org.junit.Test

class GideonTiersTest {
    @Test fun partialAvailabilityDoesNotDisableOtherTiers() {
        val tiers = NexusJson.decodeFromString(GTiers.serializer(), """{"tiers":{"experimental":{"available":false,"reason":"transcribing"}}}""")
        assertFalse(tiers.available(GideonTier.EXPERIMENTAL))
        assertTrue(tiers.available(GideonTier.LUNA))
        assertEquals("transcribing", tiers.tiers["experimental"]?.reason)
        assertTrue(GTiers().available(GideonTier.EXPERIMENTAL))
    }

    @Test fun unavailableStreamFinishesWithALocalisableNonRetryableProblem() {
        val raw = """data: {"type":"tier_unavailable","tier":"experimental"}
data: {"type":"error","code":"model0_unavailable","content":"server sentence"}
data: {"type":"done"}
"""
        val parsed = GideonRules.parse(raw) { NexusJson.parseToJsonElement(it) as? kotlinx.serialization.json.JsonObject }
        val problem = GideonProblem.stream(parsed.error!!)
        assertEquals(GideonProblem.Kind.TIER_UNAVAILABLE, problem.kind)
        assertFalse(problem.retryable)
        assertFalse(parsed.answered)
    }
}
