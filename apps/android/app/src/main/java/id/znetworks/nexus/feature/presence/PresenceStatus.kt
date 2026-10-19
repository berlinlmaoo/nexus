package id.znetworks.nexus.feature.presence

import id.znetworks.nexus.core.net.ApiClient
import id.znetworks.nexus.core.net.ApiClient.Companion.toJsonBody
import id.znetworks.nexus.core.net.NexusJson
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.*
import okhttp3.Request
import java.net.URLEncoder
import java.time.*
import java.time.format.DateTimeFormatter
import java.util.Locale

@Serializable data class ManualPresence(val id: String, val text: String, val startsAt: String, val endsAt: String)
@Serializable data class PersonPresence(val userId: String, val state: String, val tone: String, val reason: String? = null,
    val text: String? = null, val label: Map<String, String> = emptyMap(), val until: String? = null, val since: String? = null, val manual: ManualPresence? = null) {
    fun label(language: String) = label[language] ?: label["en"].orEmpty()
}
@Serializable data class PresenceResponse(val enabled: Boolean = true, val statuses: List<PersonPresence> = emptyList(), val status: PersonPresence? = null, val serverTime: String? = null)
@Serializable data class PresenceChange(val userId: String, val status: PersonPresence)
@Serializable data class PresenceMutation(val status: PersonPresence? = null, val cleared: Int? = null)
data class PresenceSnapshot(val enabled: Boolean = true, val statuses: Map<String, PersonPresence> = emptyMap())

class PresenceApi(private val api: ApiClient) {
    suspend fun list() = api.get("/api/presence", PresenceResponse.serializer())
    suspend fun set(text: String, start: Instant?, end: Instant) = api.send(Request.Builder().url(api.url("/api/presence/manual")).put(buildJsonObject {
        put("text", text.trim()); put("startsAt", start?.toString()?.let(::JsonPrimitive) ?: JsonNull); put("endsAt", end.toString())
    }.toString().toJsonBody()).build(), PresenceMutation.serializer())
    suspend fun clear(id: String) = api.send(Request.Builder().url(api.url("/api/presence/manual?id=" + URLEncoder.encode(id, "UTF-8"))).delete().build(), PresenceMutation.serializer())
}

/** Session-only, keyed by account IDs; no coordinates, attendance writes, disk cache or notifications. */
class PresenceStatuses(private val api: PresenceApi, private val owner: () -> String?) {
    private val lock = Any()
    private val mutable = MutableStateFlow(PresenceSnapshot())
    val state = mutable.asStateFlow()
    private var generation = 0
    private var revision = 0L
    private var configEnabled = true
    private var serverEnabled = true
    private val changedAt = mutableMapOf<String, Long>()
    fun reset() = synchronized(lock) { generation++; revision = 0; changedAt.clear(); serverEnabled = true; mutable.value = PresenceSnapshot(configEnabled) }
    fun configure(enabled: Boolean) = synchronized(lock) { configEnabled = enabled; mutable.value = mutable.value.copy(enabled = enabled && serverEnabled) }
    suspend fun refresh() {
        val user = owner() ?: return
        val (epoch, before) = synchronized(lock) { generation to revision }
        val result = runCatching { api.list() }.getOrNull() ?: return
        synchronized(lock) {
            if (owner() != user || epoch != generation) return
            val fresh = result.statuses.associateBy { it.userId }.toMutableMap()
            changedAt.filterValues { it > before }.keys.forEach { id -> mutable.value.statuses[id]?.let { fresh[id] = it } }
            serverEnabled = result.enabled
            mutable.value = PresenceSnapshot(configEnabled && result.enabled, fresh)
        }
    }
    fun receive(raw: String?) { raw ?: return; val event = runCatching { NexusJson.decodeFromString(PresenceChange.serializer(), raw) }.getOrNull() ?: return
        if (event.userId == event.status.userId) patch(event.status)
    }
    private fun patch(status: PersonPresence) = synchronized(lock) {
        if (owner() == null) return
        changedAt[status.userId] = ++revision
        mutable.value = mutable.value.copy(statuses = mutable.value.statuses + (status.userId to status))
    }
    suspend fun set(text: String, start: Instant?, end: Instant) { val user = owner(); val epoch = synchronized(lock) { generation }; val r = api.set(text, start, end)
        synchronized(lock) { if (user != null && owner() == user && generation == epoch) r.status?.let(::patch) }
    }
    suspend fun clear(id: String) { val user = owner(); val epoch = synchronized(lock) { generation }; val r = api.clear(id)
        synchronized(lock) { if (user != null && owner() == user && generation == epoch) r.status?.let(::patch) }
    }
}

object PresenceTimes {
    val zone: ZoneId = ZoneId.of("Asia/Jakarta")
    fun end(start: Instant, option: String, picked: LocalDateTime): Instant = when (option) {
        "30m" -> start.plusSeconds(1800); "2h" -> start.plusSeconds(7200); "3h" -> start.plusSeconds(10800)
        "today" -> start.atZone(zone).toLocalDate().atTime(23, 59).atZone(zone).toInstant()
        "pick" -> picked.atZone(zone).toInstant(); else -> start.plusSeconds(3600)
    }
    fun until(value: String?, locale: Locale, now: Instant = Instant.now()): String? = value?.let {
        runCatching {
            if (Regex("\\d{4}-\\d{2}-\\d{2}").matches(it)) LocalDate.parse(it).format(DateTimeFormatter.ofPattern("EEE d MMM", locale))
            else Instant.parse(it).atZone(zone).let { t -> t.format(DateTimeFormatter.ofPattern(if (t.toLocalDate() == now.atZone(zone).toLocalDate()) "HH:mm" else "EEE d MMM HH:mm", locale)) }
        }.getOrNull()
    }
}

object PresenceDraft {
    fun payload(emoji: String, text: String): String = listOf(emoji.trim(), text.trim()).filter { it.isNotEmpty() }.joinToString(" ")
    fun split(value: String): Pair<String, String> {
        val emoji = listOf("🗓️", "🍽️", "🎬", "🚗").firstOrNull { value == it || value.startsWith("$it ") } ?: return "" to value
        return emoji to value.removePrefix(emoji).trimStart()
    }
}
