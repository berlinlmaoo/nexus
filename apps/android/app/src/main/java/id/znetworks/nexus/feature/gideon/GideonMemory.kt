package id.znetworks.nexus.feature.gideon

import id.znetworks.nexus.core.net.ApiClient
import id.znetworks.nexus.core.net.ApiClient.Companion.toJsonBody
import id.znetworks.nexus.core.net.ApiError
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.*
import okhttp3.Request
import java.net.URLEncoder
import java.time.MonthDay
import java.time.format.DateTimeFormatter
import java.util.Locale

@Serializable data class GMemory(val id: String, val text: String, val kind: String = "FACT", val monthDay: String? = null,
    val status: String = "PENDING", val source: String = "CHAT", val createdAt: String? = null, val updatedAt: String? = null)
@Serializable data class GMemories(val paused: Boolean = false, val available: Boolean = true, val max: Int = 40, val textMax: Int = 200, val memories: List<GMemory> = emptyList())
@Serializable data class GMemoryEnvelope(val memory: GMemory)
data class MemorySnapshot(val loaded: Boolean = false, val data: GMemories = GMemories(), val known: Map<String, GMemory> = emptyMap())

class MemoryApi(private val api: ApiClient) {
    suspend fun list() = api.get("/api/gideon/memory", GMemories.serializer())
    suspend fun add(text: String, kind: String) = api.send(Request.Builder().url(api.url("/api/gideon/memory")).post(buildJsonObject { put("text", text); put("kind", kind) }.toString().toJsonBody()).build(), GMemoryEnvelope.serializer()).memory
    suspend fun pause(paused: Boolean) = api.send(Request.Builder().url(api.url("/api/gideon/memory")).patch(buildJsonObject { put("paused", paused) }.toString().toJsonBody()).build(), GMemories.serializer())
    suspend fun edit(id: String, fields: JsonObject) = api.send(Request.Builder().url(api.url("/api/gideon/memory/" + URLEncoder.encode(id, "UTF-8"))).patch(fields.toString().toJsonBody()).build(), GMemoryEnvelope.serializer()).memory
    suspend fun delete(id: String) = api.send(Request.Builder().url(api.url("/api/gideon/memory/" + URLEncoder.encode(id, "UTF-8"))).delete().build(), JsonObject.serializer())
    suspend fun deleteAll() = api.send(Request.Builder().url(api.url("/api/gideon/memory")).delete().build(), JsonObject.serializer())
}

object MemoryRules {
    /** A late SSE/history suggestion cannot reverse a person's Save or Don't save tap. */
    fun merge(previous: GMemory?, incoming: GMemory): GMemory = when {
        previous == null -> incoming
        incoming.status == "DELETED" -> incoming
        previous.status == "DELETED" -> previous
        previous.status == "ACTIVE" && incoming.status == "PENDING" -> previous
        previous.updatedAt != null && incoming.updatedAt != null && previous.updatedAt > incoming.updatedAt -> previous
        else -> incoming
    }
    fun date(value: String?, locale: Locale): String? = value?.let { runCatching { MonthDay.parse("--$it").atYear(2000).format(DateTimeFormatter.ofPattern("d MMM", locale)) }.getOrNull() }
    fun canAdd(data: GMemories) = !data.paused && data.available && data.memories.size < data.max
    fun chatMemories(message: GMessage, readOnly: Boolean) = if (readOnly || message.role != "assistant") emptyList() else message.meta?.memories.orEmpty()
}

/** Only the signed-in person's endpoint. Kept in RAM, cleared on sign-out; never sent to cache/log/widget APIs. */
class GideonMemories(private val api: MemoryApi, private val owner: () -> String?) {
    private val lock = Any()
    private var generation = 0
    private var revision = 0L
    private var policyChangedAt = 0L
    private val changedAt = mutableMapOf<String, Long>()
    private val mutable = MutableStateFlow(MemorySnapshot())
    val state = mutable.asStateFlow()
    fun reset() = synchronized(lock) { generation++; revision = 0; policyChangedAt = 0; changedAt.clear(); mutable.value = MemorySnapshot() }
    private fun patch(memory: GMemory) {
        val current = mutable.value
        val merged = MemoryRules.merge(current.known[memory.id], memory)
        val known = current.known + (memory.id to merged)
        val rows = (current.data.memories.filterNot { it.id == memory.id } + listOf(merged).filter { it.status in setOf("ACTIVE", "PENDING") })
        changedAt[memory.id] = ++revision
        mutable.value = current.copy(data = current.data.copy(memories = rows), known = known)
    }
    fun receive(memories: List<GMemory>, sourceOwner: String? = owner()) = synchronized(lock) { if (sourceOwner != null && owner() == sourceOwner) memories.forEach(::patch) }
    private fun replace(data: GMemories, before: Long) {
        val old = mutable.value
        val ids = data.memories.map { it.id }.toSet()
        val known = old.known.mapValues { (id, m) -> if (id !in ids && (changedAt[id] ?: 0) <= before) m.copy(status = "DELETED") else m }.toMutableMap()
        data.memories.forEach { m -> if ((changedAt[m.id] ?: 0) <= before) known[m.id] = MemoryRules.merge(known[m.id], m) }
        mutable.value = MemorySnapshot(true, data.copy(paused = if (policyChangedAt > before) old.data.paused else data.paused, memories = known.values.filter { it.status in setOf("ACTIVE", "PENDING") }), known)
    }
    private suspend fun <T> request(call: suspend () -> T, accept: (T, Long) -> Unit): T {
        val user = owner() ?: throw CancellationException("Session ended")
        val (epoch, before) = synchronized(lock) { generation to revision }
        val result = call()
        synchronized(lock) { if (owner() != user || epoch != generation) throw CancellationException("Session changed"); accept(result, before) }
        return result
    }
    suspend fun refresh() { request({ api.list() }, ::replace) }
    suspend fun add(text: String, kind: String) { request({ api.add(text.trim(), kind) }) { m, _ -> patch(m) } }
    suspend fun pause(paused: Boolean) { request({ api.pause(paused) }) { data, before -> replace(data, before); policyChangedAt = ++revision } }
    suspend fun edit(memory: GMemory, text: String) { request({ api.edit(memory.id, buildJsonObject { put("text", text.trim()) }) }) { m, _ -> patch(m) } }
    suspend fun save(memory: GMemory) { request({ api.edit(memory.id, buildJsonObject { put("status", "ACTIVE") }) }) { m, _ -> patch(m) } }
    suspend fun forget(memory: GMemory) { request({ try { api.delete(memory.id) } catch (e: ApiError.Http) { if (e.status != 404) throw e; buildJsonObject {} } }) { _, _ -> patch(memory.copy(status = "DELETED")) } }
    suspend fun forgetAll() { request({ api.deleteAll() }) { _, before ->
        val all = mutable.value.known.values.filter { (changedAt[it.id] ?: 0) <= before }; all.forEach { patch(it.copy(status = "DELETED")) }
    } }
}
