package id.znetworks.nexus.feature.gideon

import id.znetworks.nexus.core.net.ApiClient
import id.znetworks.nexus.core.net.NexusJson
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject

@Serializable data class GTierAvailability(val available: Boolean = true, val reason: String? = null, val since: String? = null)
@Serializable data class GTiers(val tiers: Map<String, GTierAvailability> = emptyMap()) {
    fun available(tier: GideonTier) = tiers[tier.key]?.available != false
}

/** Session-wide availability; a chat keeps its selected tier when the GPU is lent to transcription. */
class GideonTiers(private val api: ApiClient) {
    private val mutable = MutableStateFlow(GTiers())
    val state = mutable.asStateFlow()
    suspend fun refresh() { runCatching { api.get("/api/gideon/tiers", GTiers.serializer()) }.getOrNull()?.let { mutable.value = it } }
    fun receive(raw: String?) {
        raw ?: return
        runCatching { NexusJson.decodeFromString(GTiers.serializer(), raw) }.getOrNull()?.let { mutable.value = it }
    }
    fun seed(tiers: Map<String, GTierAvailability>?) { if (mutable.value.tiers.isEmpty() && tiers != null) mutable.value = GTiers(tiers) }
    fun clear() { mutable.value = GTiers() }
}
