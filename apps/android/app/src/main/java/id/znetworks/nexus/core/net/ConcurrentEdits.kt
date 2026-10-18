package id.znetworks.nexus.core.net

import kotlinx.serialization.json.*
import java.time.Instant

/** Send only the user's changes to a set, preserving additions made by another editor. */
object ConcurrentEdits {
    fun delta(base: Collection<String>, chosen: Collection<String>, add: String, remove: String): JsonObject = buildJsonObject {
        put(add, JsonArray((chosen.toSet() - base.toSet()).map(::JsonPrimitive)))
        put(remove, JsonArray((base.toSet() - chosen.toSet()).map(::JsonPrimitive)))
    }

    fun description(text: String, base: String): JsonObject = buildJsonObject {
        put("baseText", base)
        put("doc", buildJsonObject {
            put("type", "doc")
            put("content", JsonArray(text.split('\n').map { line -> buildJsonObject {
                put("type", "paragraph")
                if (line.isNotEmpty()) put("content", buildJsonArray { add(buildJsonObject { put("type", "text"); put("text", line) }) })
            } }))
        })
    }

    /** Missing/invalid timestamps never suppress a refresh. */
    fun older(incoming: String?, held: String?): Boolean {
        val a = incoming?.let { runCatching { Instant.parse(it) }.getOrNull() } ?: return false
        val b = held?.let { runCatching { Instant.parse(it) }.getOrNull() } ?: return false
        return a.isBefore(b)
    }
}
