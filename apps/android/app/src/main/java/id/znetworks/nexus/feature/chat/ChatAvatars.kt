package id.znetworks.nexus.feature.chat

import id.znetworks.nexus.core.net.NexusJson
import id.znetworks.nexus.core.net.ResponseCache
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/**
 * A photo event is authoritative even when the following refetch fails or uses an offline list.
 * Revisions also stop a response already in flight from restoring the replaced URL.
 */
object ChatAvatars {
    private val _avatars = MutableStateFlow<Map<String, String?>>(emptyMap())
    val avatars = _avatars.asStateFlow()
    private var revision = 0L
    private var clearedAt = 0L
    private val changedAt = mutableMapOf<String, Long>()
    private var cache: ResponseCache? = null

    @Synchronized fun useCache(cache: ResponseCache?) { this.cache = cache }

    @Synchronized fun revision(): Long = revision

    @Synchronized fun changed(id: String, url: String?) {
        changedAt[id] = ++revision
        _avatars.value = _avatars.value + (id to url)
        persist(id, url)
    }

    @Synchronized fun observed(id: String, url: String?, startedAt: Long, cached: Boolean = false) {
        if (startedAt < clearedAt) return
        if ((cached && _avatars.value.containsKey(id)) || (changedAt[id] ?: 0L) > startedAt) {
            // getCached may just have saved an older in-flight response. Correct its disk copy too.
            persist(id, _avatars.value[id])
            return
        }
        _avatars.value = _avatars.value + (id to url)
    }

    @Synchronized fun mutated(id: String, url: String?, startedAt: Long) {
        if (startedAt >= clearedAt && (changedAt[id] ?: 0L) <= startedAt) changed(id, url)
    }

    fun resolve(id: String, fallback: String?): String? = avatars.value.let { if (it.containsKey(id)) it[id] else fallback }

    @Synchronized fun clear() { _avatars.value = emptyMap(); changedAt.clear(); clearedAt = ++revision }

    /** Keep the rest of the offline list, unknown fields and original saved-copy timestamp intact. */
    private fun persist(id: String, url: String?) {
        val store = cache ?: return
        store.update("conversations") { body ->
            val root = NexusJson.parseToJsonElement(body) as? JsonObject ?: return@update null
            val rows = root["conversations"] as? JsonArray ?: return@update null
            val next = url?.let(::JsonPrimitive) ?: JsonNull
            var edited = false
            val updated = rows.map { row ->
                val item = row as? JsonObject
                if (item != null && (item["id"] as? JsonPrimitive)?.content == id && item["avatarUrl"] != next) {
                    edited = true
                    JsonObject(item + ("avatarUrl" to next))
                } else row
            }
            if (edited) JsonObject(root + ("conversations" to JsonArray(updated))).toString() else null
        }
    }
}
