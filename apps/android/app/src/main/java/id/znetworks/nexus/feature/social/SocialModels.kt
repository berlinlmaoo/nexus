package id.znetworks.nexus.feature.social

import kotlinx.serialization.json.*

internal fun JsonObject.text(key: String) = (this[key] as? JsonPrimitive)?.takeUnless { it is JsonNull }?.content.orEmpty()
internal fun JsonObject.number(key: String) = (this[key] as? JsonPrimitive)?.doubleOrNull
internal fun JsonObject.flag(key: String) = (this[key] as? JsonPrimitive)?.booleanOrNull == true
internal fun JsonObject.objectAt(key: String) = this[key] as? JsonObject ?: JsonObject(emptyMap())
internal fun JsonObject.rows(key: String) = (this[key] as? JsonArray).orEmpty().mapNotNull { it as? JsonObject }

data class SocialMonth(val raw: JsonObject) {
    val month get() = raw.text("month")
    val today get() = raw.text("today")
    val canRecord get() = raw.flag("canRecord")
    val canManage get() = raw.flag("canManage")
    val platforms get() = raw.objectAt("config").rows("platforms")
    val overview get() = raw.objectAt("overview")
    val days get() = raw.rows("days")
    fun day(date: String) = days.firstOrNull { it.text("date") == date } ?: JsonObject(emptyMap())
    fun targets(date: String?) = raw.rows(if (date == null) "targets" else "dayTargets").filter { date == null || it.text("date") == date }
}

/** Preserve null versus zero, and send only edited fields so concurrent editors keep their work. */
object SocialDraft {
    val metrics = listOf("views", "likes", "comments", "shares", "posts")
    val targetKeys = listOf("engagementTarget", "postsTarget")
    fun number(text: String, max: Long): JsonElement? {
        if (text.isBlank()) return JsonNull
        val n = text.toLongOrNull()?.takeIf { it in 0..max } ?: return null
        return JsonPrimitive(n)
    }
    fun day(original: JsonObject, draft: Map<String, String>): JsonObject = buildJsonObject {
        val platforms = original.objectAt("platforms")
        val changes = mutableMapOf<String, MutableMap<String, JsonElement>>()
        draft.forEach { (key, value) ->
            if (key == "worked" || key == "didntWork") {
                if (value != original.text(key)) put(key, value)
            } else {
                val id = key.substringBefore(':'); val metric = key.substringAfter(':')
                val next = number(value, if (metric == "posts") 10_000 else 1_000_000_000) ?: return@forEach
                val old = platforms.objectAt(id)[metric] ?: JsonNull
                if (old != next) changes.getOrPut(id) { mutableMapOf() }[metric] = next
            }
        }
        if (changes.isNotEmpty()) put("platforms", JsonObject(changes.mapValues { JsonObject(it.value) }))
    }
}
