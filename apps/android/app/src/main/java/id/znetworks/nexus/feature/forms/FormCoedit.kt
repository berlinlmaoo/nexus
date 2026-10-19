package id.znetworks.nexus.feature.forms

import kotlinx.serialization.json.*

@kotlinx.serialization.Serializable
data class FormEditorPresence(val userId: String, val name: String = "", val avatar: String? = null, val color: String = "#8b5cf6", val questionId: String? = null)
@kotlinx.serialization.Serializable
data class FormPresence(val formId: String, val members: List<FormEditorPresence> = emptyList())

/** Repair one pre-join focus loss; another device's later selection must not cause a focus ping-pong. */
internal class FormFocusRepair {
    private var pending = false
    fun sent() { pending = true }
    fun shouldResend(observed: String?, expected: String?): Boolean {
        val resend = pending && observed != expected
        pending = false
        return resend
    }
}

/** Field-level operations and three-way rebase shared by HTTP receipts and live form events. */
object FormCoedit {
    private val scalars = listOf("name", "description", "isPublic", "requireAuth", "accessSchedule")
    private val maps = listOf("branding", "settings")
    private fun JsonObject.questions() = (this["fields"] as? JsonArray).orEmpty().filterIsInstance<JsonObject>()
    private fun JsonObject.id() = (this["id"] as? JsonPrimitive)?.content.orEmpty()
    private fun objectOf(value: JsonElement?) = value as? JsonObject ?: JsonObject(emptyMap())
    private fun op(name: String, vararg values: Pair<String, JsonElement>) = JsonObject(mapOf("op" to JsonPrimitive(name), *values))
    private fun patch(base: JsonObject, draft: JsonObject) = JsonObject((base.keys + draft.keys).filter { base[it] != draft[it] }.associateWith { draft[it] ?: JsonNull })
    private fun merge(base: JsonObject, ours: JsonObject, theirs: JsonObject) = JsonObject((base.keys + ours.keys + theirs.keys).mapNotNull { key ->
        (if (ours[key] == base[key]) theirs[key] else ours[key])?.let { key to it }
    }.toMap())

    fun document(d: FormStudioDraft) = JsonObject(mapOf(
        "name" to JsonPrimitive(d.name), "description" to JsonPrimitive(d.description), "isPublic" to JsonPrimitive(d.isPublic),
        "requireAuth" to JsonPrimitive(d.requireAuth), "accessSchedule" to d.schedule.json(), "branding" to d.branding.json(),
        "settings" to d.settings.json(), "fields" to JsonArray(d.fields.map { it.cleanJson() })))
    fun rebase(base: FormStudioDraft, ours: FormStudioDraft, theirs: FormStudioDraft) =
        FormStudioDraft.of(BuilderForm(rebase(document(base), document(ours), document(theirs))))

    fun diff(base: JsonObject, draft: JsonObject): List<JsonObject> {
        val ops = mutableListOf<JsonObject>()
        if (base["name"] != draft["name"]) ops += op("set_title", "value" to (draft["name"] ?: JsonPrimitive("")))
        if (base["description"] != draft["description"]) ops += op("set_description", "value" to (draft["description"] ?: JsonNull))
        val settings = mutableMapOf<String, JsonElement>()
        (scalars.drop(2) + maps).forEach { key -> if (base[key] != draft[key]) settings[key] =
            if (key in maps && draft[key] is JsonObject) patch(objectOf(base[key]), objectOf(draft[key])) else draft[key] ?: JsonNull }
        if (settings.isNotEmpty()) ops += op("set_settings", *settings.toList().toTypedArray())
        val before = base.questions().associateBy { it.id() }; val after = draft.questions().associateBy { it.id() }
        before.keys.filter { it !in after }.forEach { ops += op("delete_question", "id" to JsonPrimitive(it)) }
        val working = base.questions().map { it.id() }.filter { it in after }.toMutableList()
        draft.questions().forEachIndexed { index, q ->
            val id = q.id()
            if (id !in before) {
                val prev = draft.questions().getOrNull(index - 1)?.id()
                ops += op("add_question", "question" to q, "afterId" to (prev?.let(::JsonPrimitive) ?: JsonNull))
                working.add(if (prev == null) 0 else (working.indexOf(prev).takeIf { it >= 0 }?.plus(1) ?: working.size), id)
            } else {
                val changes = patch(before.getValue(id), q).filterKeys { it != "id" }
                val unset = changes.keys.filter { it !in q }
                val fields = JsonObject(changes.filterKeys { it in q })
                if (changes.isNotEmpty()) ops += op("update_question", "id" to JsonPrimitive(id), "fields" to fields, "unset" to JsonArray(unset.map(::JsonPrimitive)))
            }
        }
        // Keep the longest already ordered run; only move the other questions.
        val target = draft.questions().map { it.id() }
        val ranks = target.map { working.indexOf(it) }; val lengths = IntArray(ranks.size) { 1 }; val previous = IntArray(ranks.size) { -1 }
        for (i in ranks.indices) for (j in 0 until i) if (ranks[j] < ranks[i] && lengths[j] + 1 > lengths[i]) { lengths[i] = lengths[j] + 1; previous[i] = j }
        val kept = mutableSetOf<String>(); var at = lengths.indices.maxByOrNull { lengths[it] } ?: -1
        while (at >= 0) { kept += target[at]; at = previous[at] }
        target.forEachIndexed { index, id -> if (id !in kept) {
            val prev = target.getOrNull(index - 1)
            ops += op("move_question", "id" to JsonPrimitive(id), "afterId" to (prev?.let(::JsonPrimitive) ?: JsonNull))
        } }
        return ops
    }

    fun rebase(base: JsonObject, ours: JsonObject, theirs: JsonObject): JsonObject {
        val out = theirs.toMutableMap()
        scalars.forEach { key -> if (ours[key] != base[key]) { if (key in ours) out[key] = ours.getValue(key) else out.remove(key) } }
        maps.forEach { key ->
            val merged = merge(objectOf(base[key]), objectOf(ours[key]), objectOf(theirs[key]))
            if (key in base || key in ours || key in theirs) out[key] = if (merged.isEmpty()) JsonNull else merged
        }
        val b = base.questions().associateBy { it.id() }; val o = ours.questions().associateBy { it.id() }; val t = theirs.questions().associateBy { it.id() }
        val fields = linkedMapOf<String, JsonObject>()
        (o.keys + t.keys).forEach { id ->
            when {
                id in b && (id !in o || id !in t) -> Unit // Either deletion wins over an edit.
                id !in b -> fields[id] = o[id] ?: t.getValue(id)
                else -> fields[id] = merge(b.getValue(id), o.getValue(id), t.getValue(id))
            }
        }
        val common = b.keys.intersect(o.keys)
        val reordered = b.keys.filter { it in common } != o.keys.filter { it in common }
        val preferred = if (reordered) o.keys.toList() else t.keys.toList()
        val order = preferred.filter { it in fields }.toMutableList()
        val secondary = if (reordered) t.keys.toList() else o.keys.toList()
        secondary.forEachIndexed { index, id -> if (id in fields && id !in order) {
            val prev = secondary.take(index).lastOrNull { it in order }
            order.add(if (prev == null) 0 else order.indexOf(prev) + 1, id)
        } }
        val surviving = fields.keys
        out["fields"] = JsonArray(order.map { id ->
            val q = fields.getValue(id); val parent = (q["showIf"] as? JsonObject)?.get("fieldId")?.jsonPrimitive?.contentOrNull
            if (parent != null && parent !in surviving) JsonObject(q - "showIf") else q
        })
        return JsonObject(out)
    }
}
