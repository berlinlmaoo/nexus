package id.znetworks.nexus.feature.admin

import id.znetworks.nexus.core.nav.Links
import id.znetworks.nexus.core.nav.Target
import id.znetworks.nexus.core.net.NexusJson
import id.znetworks.nexus.core.realtime.RealtimeEvents
import org.junit.Assert.*
import org.junit.Test
import java.time.Instant

class GideonPerformanceTest {
    @Test fun onlyCompanyBodAndOaaCanOpenThePanel() {
        assertTrue(PerformanceRules.allowed("BOD", true))
        assertTrue(PerformanceRules.allowed("ONE_ABOVE_ALL", true))
        assertFalse(PerformanceRules.allowed("MANAGER", true))
        assertFalse(PerformanceRules.allowed("STAFF", true))
        assertFalse(PerformanceRules.allowed("BOD", false))
        assertEquals(Target.GideonPerformance, Links.parse("/admin?tab=gideon&gideon=performance"))
    }
    @Test fun alertValuesMayBeHumanReadableStringsWhileQuietMetricsStayNull() {
        val d = NexusJson.decodeFromString(GideonPerformance.serializer(), """{"alerts":[{"key":"gpu_hot","active":true,"value":"85°C"}],"tiers":[{"id":"astra","errorRate":null,"p50Ms":null}]}""")
        assertEquals("85°C", id.znetworks.nexus.feature.gideon.GideonReview.loose(d.alerts.single().value))
        assertNull(d.tiers.single().p50Ms)
    }
    @Test fun staleIsRecomputedEvenWithoutAnotherServerReading() {
        val telemetry = PerfTelemetry("2026-10-19T00:00:00Z")
        assertFalse(PerformanceRules.stale(telemetry, Instant.parse("2026-10-19T00:03:00Z")))
        assertTrue(PerformanceRules.stale(telemetry, Instant.parse("2026-10-19T00:03:01Z")))
        assertTrue(PerformanceRules.stale(PerfTelemetry()))
    }
    @Test fun gpuPingsReplaceTelemetryWithoutDiscardingTheAnswerHistory() {
        val old = GideonPerformance(hours = listOf(PerfHour("hour", credits = 12.0)), model0 = PerfModel0(gens24h = 9), telemetry = PerfTelemetry(stale = true))
        val raw = """{"kind":"gpu","live":{"at":"2026-10-19T00:00:00Z","engine":{"up":true},"gpu":{"util":20}}}"""
        val event = RealtimeEvents.parse("gideon-perf", raw)
        val update = NexusJson.decodeFromString(PerfEvent.serializer(), event.raw!!)
        val fresh = PerformanceRules.replaceLive(old, update.live!!)
        assertEquals(old.hours, fresh.hours)
        assertEquals(9, fresh.model0.gens24h)
        assertFalse(fresh.telemetry.stale)
        assertEquals(update.live.at, fresh.telemetry.lastAt)
        assertTrue(RealtimeEvents.parse("join-denied", """{"room":"gideon:perf"}""").raw!!.contains("gideon:perf"))
    }
    @Test fun cacheRatioIsWeightedByTokensAndZeroUsageIsNotZeroPercent() {
        assertNull(PerformanceRules.cacheHit(emptyList()))
        assertEquals(.75, PerformanceRules.cacheHit(listOf(PerfHour("1", inputTokens = 100, cachedTokens = 100), PerfHour("2", cachedTokens = 200)))!!, .0001)
        assertTrue(PerformanceRules.gpuFull(.995))
        assertFalse(PerformanceRules.gpuFull(.994))
        assertEquals("search workspace", PerformanceRules.toolName("nexus_search_workspace"))
    }
}
