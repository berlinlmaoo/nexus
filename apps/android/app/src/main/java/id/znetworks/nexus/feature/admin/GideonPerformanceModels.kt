package id.znetworks.nexus.feature.admin

import kotlinx.serialization.Serializable
import java.time.Instant

@Serializable data class GideonPerformance(
    val now: String? = null, val thresholds: PerfThresholds = PerfThresholds(), val telemetry: PerfTelemetry = PerfTelemetry(),
    val tiers: List<PerfTier> = emptyList(), val live: PerfLive? = null, val model0: PerfModel0 = PerfModel0(),
    val hours: List<PerfHour> = emptyList(), val quality: PerfQuality = PerfQuality(), val alerts: List<PerfAlert> = emptyList(),
)
@Serializable data class PerfThresholds(val gpuHotC: Int = 85, val model0DownMin: Int = 5, val errorRatePct: Int = 5, val errorRateWindowMin: Int = 15, val errorRateMinAnswers: Int = 5, val vramFullPct: Int = 98, val sustainMin: Int = 2)
@Serializable data class PerfTelemetry(val lastAt: String? = null, val stale: Boolean = false, val cadenceSec: Int = 5)
@Serializable data class PerfTier(val id: String, val status: String = "unavailable", val reason: String? = null, val inFlight: Int = 0, val answers15m: Int = 0, val failures15m: Int = 0, val errorRate: Double? = null, val p50Ms: Double? = null, val p95Ms: Double? = null, val avgCredits15m: Double? = null, val avgCredits24h: Double? = null, val answers24h: Int = 0, val failures24h: Int? = null)
@Serializable data class PerfLive(val at: String? = null, val gpu: PerfGpu? = null, val engine: PerfEngine = PerfEngine(), val whisper: PerfWhisper? = null)
@Serializable data class PerfGpu(val name: String? = null, val util: Double? = null, val memUsedMiB: Double? = null, val memTotalMiB: Double? = null, val tempC: Double? = null, val powerW: Double? = null, val powerLimitW: Double? = null)
@Serializable data class PerfEngine(val up: Boolean = false, val model: PerfLoadedModel? = null)
@Serializable data class PerfLoadedModel(val name: String? = null, val sizeBytes: Long? = null, val sizeVramBytes: Long? = null, val gpuShare: Double? = null, val contextLength: Int? = null, val expiresAt: String? = null)
@Serializable data class PerfWhisper(val up: Boolean = false, val busy: Boolean = false, val queued: Int = 0)
@Serializable data class PerfModel0(val recent: List<PerfGeneration> = emptyList(), val loads: List<PerfLoad> = emptyList(), val avgEvalTps24h: Double? = null, val gens24h: Int = 0)
@Serializable data class PerfGeneration(val at: String, val evalTps: Double? = null, val promptTps: Double? = null, val outTokens: Int? = null, val totalMs: Double? = null)
@Serializable data class PerfLoad(val at: String, val loadSec: Double? = null)
@Serializable data class PerfHour(val t: String, val questions: Map<String, Int> = emptyMap(), val p50Ms: Map<String, Double?> = emptyMap(), val credits: Double = 0.0, val inputTokens: Long = 0, val cachedTokens: Long = 0, val cacheHit: Double? = null)
@Serializable data class PerfQuality(val routerMisses24h: Int = 0, val answers24h: Int = 0, val recentMisses: List<PerfMiss> = emptyList(), val topTools: List<PerfTool> = emptyList(), val failingTools: List<PerfTool> = emptyList())
@Serializable data class PerfMiss(val at: String, val tier: String)
@Serializable data class PerfTool(val tool: String, val calls: Int = 0, val failures: Int = 0)
@Serializable data class PerfAlert(val key: String, val active: Boolean = false, val since: String? = null, val value: kotlinx.serialization.json.JsonElement? = null)
@Serializable data class PerfEvent(val kind: String? = null, val live: PerfLive? = null)

object PerformanceRules {
    /** Missing from older servers: absence must not look like a measured zero or a 15-minute count. */
    fun errors24h(tiers: List<PerfTier>): Int? = if (tiers.isEmpty() || tiers.any { it.failures24h == null }) null else tiers.sumOf { it.failures24h!! }
    fun allowed(role: String?, company: Boolean) = company && role in setOf("BOD", "ONE_ABOVE_ALL")
    fun stale(telemetry: PerfTelemetry, now: Instant = Instant.now()): Boolean = telemetry.stale || telemetry.lastAt?.let {
        runCatching { java.time.Duration.between(Instant.parse(it), now).seconds > 180 }.getOrDefault(true)
    } ?: true
    fun replaceLive(old: GideonPerformance, live: PerfLive) = old.copy(live = live, telemetry = old.telemetry.copy(lastAt = live.at, stale = false))
    fun toolName(tool: String) = tool.removePrefix("nexus_").replace('_', ' ')
    fun gpuFull(share: Double?) = share != null && share >= .995
    fun cacheHit(hours: List<PerfHour>): Double? {
        val input = hours.sumOf { it.inputTokens }; val cached = hours.sumOf { it.cachedTokens }
        return if (input + cached == 0L) null else cached.toDouble() / (input + cached)
    }
}
