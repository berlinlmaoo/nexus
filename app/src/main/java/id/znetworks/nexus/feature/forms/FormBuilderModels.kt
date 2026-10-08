package id.znetworks.nexus.feature.forms

import id.znetworks.nexus.R
import id.znetworks.nexus.core.net.NexusConfig
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.longOrNull

// The form builder's data (Berlin, 9 Oct; FORM-BUILDER.md, iOS FormBuilderModels.swift, web form-kit.tsx).
// `fields` and `accessSchedule` are untyped JSON: each field keeps the object it was loaded from and saving
// lays the builder's keys over it — only the ones that changed — so a key a newer web build adds survives.

private fun JsonElement?.str(): String? = (this as? JsonPrimitive)?.takeIf { it.isString }?.content
/** A scalar as text: an option stored as a number becomes "3", not nothing. */
private fun JsonElement?.text(): String? = (this as? JsonPrimitive)?.takeIf { it !is JsonNull }?.content
private fun JsonElement?.bool(): Boolean? = (this as? JsonPrimitive)?.booleanOrNull
private fun JsonElement?.obj(): JsonObject? = this as? JsonObject
private fun JsonElement?.arr(): JsonArray? = this as? JsonArray

/** One row of GET /api/forms?projectId= — the whole form (never GET /api/forms/{id}, which carries every submission). */
data class BuilderForm(val raw: JsonObject) {
    val id: String get() = raw["id"].text().orEmpty()
    val name: String get() = raw["name"].text().orEmpty()
    val description: String? get() = raw["description"].text()
    val slug: String? get() = raw["slug"].text()?.takeIf { it.isNotEmpty() }
    val isPublic: Boolean get() = raw["isPublic"].bool() ?: false
    val requireAuth: Boolean get() = raw["requireAuth"].bool() ?: false
    val submissions: Int get() = (raw["_count"].obj()?.get("submissions") as? JsonPrimitive)?.intOrNull ?: 0
    val fields: List<JsonObject> get() = raw["fields"].arr()?.mapNotNull { it.obj() }.orEmpty()
    val schedule: JsonElement? get() = raw["accessSchedule"]
    /** Always the public host (the link is for someone else's phone), slug first like the web's card. */
    val link: String get() = FormLink.url(slug, id)
}

object FormLink {
    fun url(slug: String?, formId: String) = NexusConfig.PUBLIC_BASE + "/f/" + (slug?.takeIf { it.isNotEmpty() } ?: formId)
}

data class BuilderCondition(val fieldId: String, val op: String, val value: String)

data class BuilderRule(
    val id: String, val op: String, val value: String, val action: String,
    val targetTaskListId: String, val targetUserId: String,
    /** As stored: `targetUserIds` (older builds) lives here untouched. */
    val raw: JsonObject,
) {
    fun json(): JsonObject = JsonObject(raw.toMutableMap().apply {
        put("id", JsonPrimitive(id)); put("operator", JsonPrimitive(op)); put("value", JsonPrimitive(value)); put("action", JsonPrimitive(action))
        if (targetTaskListId.isEmpty()) remove("targetTaskListId") else put("targetTaskListId", JsonPrimitive(targetTaskListId))
        if (targetUserId.isEmpty()) remove("targetUserId") else put("targetUserId", JsonPrimitive(targetUserId))
    })

    companion object {
        fun of(raw: JsonObject) = BuilderRule(raw["id"].text() ?: newId(), raw["operator"].str() ?: "equals", raw["value"].text().orEmpty(),
            raw["action"].str() ?: "assign_user", raw["targetTaskListId"].str().orEmpty(), raw["targetUserId"].str().orEmpty(), raw)
        /** The web's new rule: equals / "" / assign_user. */
        fun fresh() = of(JsonObject(mapOf("id" to JsonPrimitive(newId()), "operator" to JsonPrimitive("equals"), "value" to JsonPrimitive(""), "action" to JsonPrimitive("assign_user"))))
        fun newId() = "r_${System.currentTimeMillis()}_${(0 until 1_000_000).random()}"
    }
}

data class BuilderField(
    val id: String,
    /** The web writes the same text to `name` and `label`; the public form reads `name` first. */
    val name: String, val label: String,
    val type: String, val required: Boolean, val options: List<String>,
    val attachmentEnabled: Boolean,
    /** "" | "name" | "email" */
    val autofill: String,
    /** "" | "currency-idr" */
    val numberFormat: String,
    val showIf: BuilderCondition?,
    val rules: List<BuilderRule>,
    val mappingTarget: String, val mappingCustomFieldId: String,
    /** The field as stored; empty for a new one. */
    val raw: JsonObject,
) {
    val hasOptions get() = type == "dropdown" || type == "multi_select" || type == "select"
    val displayName get() = name.trim()

    /** With a new name: the web writes both keys. */
    fun named(n: String) = copy(name = n, label = n)

    /**
     * What gets saved: the stored object with the builder's keys laid over it; a key nobody changed keeps
     * its stored value exactly ("changed" is decided against a fresh read of the same stored object).
     */
    fun json(): JsonObject {
        val before = of(raw)
        val out = raw.toMutableMap()
        out["id"] = JsonPrimitive(id); out["name"] = JsonPrimitive(name); out["label"] = JsonPrimitive(label)
        out["type"] = JsonPrimitive(type); out["required"] = JsonPrimitive(required)
        // A list is saved cleaned; the old `{ choices }` shape is left alone unless the options were edited.
        if (raw["options"] is JsonArray || options != before.options || (hasOptions && raw["options"] == null))
            out["options"] = JsonArray(options.map { it.trim() }.filter { it.isNotEmpty() }.map(::JsonPrimitive))
        if (attachmentEnabled != before.attachmentEnabled) out["attachmentEnabled"] = JsonPrimitive(attachmentEnabled)
        // "none" is the key gone (the web writes undefined).
        if (autofill != before.autofill) { if (autofill.isEmpty()) out.remove("autofill") else out["autofill"] = JsonPrimitive(autofill) }
        if (numberFormat != before.numberFormat) { if (numberFormat.isEmpty()) out.remove("numberFormat") else out["numberFormat"] = JsonPrimitive(numberFormat) }
        if (showIf != before.showIf) {
            out["showIf"] = showIf?.let { c -> JsonObject((raw["showIf"].obj() ?: JsonObject(emptyMap())).toMutableMap().apply {
                put("fieldId", JsonPrimitive(c.fieldId)); put("operator", JsonPrimitive(c.op)); put("value", JsonPrimitive(c.value))
            }) } ?: JsonNull
        }
        if (rules != before.rules) out["routingRules"] = JsonArray(rules.map { it.json() })
        if (mappingTarget != before.mappingTarget || mappingCustomFieldId != before.mappingCustomFieldId) {
            out["mapping"] = JsonObject((raw["mapping"].obj() ?: JsonObject(emptyMap())).toMutableMap().apply {
                put("target", JsonPrimitive(mappingTarget))
                if (mappingCustomFieldId.isNotEmpty()) put("customFieldId", JsonPrimitive(mappingCustomFieldId))
            })
        }
        return JsonObject(out)
    }

    /** "Duplicate to another project": routing rules go (section and member ids), the mapping keeps only its target. */
    fun duplicateJson(): JsonObject = JsonObject(json().toMutableMap().apply {
        put("mapping", if (mappingTarget != "none") JsonObject(mapOf("target" to JsonPrimitive(mappingTarget))) else JsonNull)
        remove("routingRules")
    })

    companion object {
        /** A stored field as the web's builder loads it: name ↔ label from each other, "select" shown as "dropdown". */
        fun of(raw: JsonObject): BuilderField {
            val n = raw["name"].text().orEmpty(); val l = raw["label"].text().orEmpty()
            val t = raw["type"].str() ?: "text"
            val opts = raw["options"].arr()?.mapNotNull { it.text() }
                ?: raw["options"].obj()?.get("choices").arr()?.mapNotNull { it.text() } ?: emptyList()
            val c = raw["showIf"].obj()
            val mapping = raw["mapping"].obj()
            return BuilderField(
                id = raw["id"].text() ?: newId(), name = n.ifEmpty { l }, label = l.ifEmpty { n },
                type = if (t == "select") "dropdown" else t, required = raw["required"].bool() ?: false, options = opts,
                attachmentEnabled = raw["attachmentEnabled"].bool() ?: false, autofill = raw["autofill"].str().orEmpty(),
                numberFormat = raw["numberFormat"].str().orEmpty(),
                showIf = c?.let { BuilderCondition(it["fieldId"].text().orEmpty(), it["operator"].str() ?: "equals", it["value"].text().orEmpty()) },
                rules = raw["routingRules"].arr()?.mapNotNull { it.obj()?.let(BuilderRule::of) }.orEmpty(),
                mappingTarget = mapping?.get("target").str() ?: "none", mappingCustomFieldId = mapping?.get("customFieldId").str().orEmpty(),
                raw = raw,
            )
        }
        /** The web's newField(): `{ id: field_<ms>_<rand>, label: "", type: "text", required: false }`. */
        fun fresh() = of(JsonObject(mapOf("id" to JsonPrimitive(newId()), "label" to JsonPrimitive(""), "type" to JsonPrimitive("text"), "required" to JsonPrimitive(false))))
        fun newId() = "field_${System.currentTimeMillis()}_${java.util.UUID.randomUUID().toString().take(6)}"
    }
}

/** `accessSchedule`, read as the server normalises it (src/lib/form-access-schedule.ts); sent whole, never half. */
data class BuilderSchedule(val enabled: Boolean, val days: List<Int>, val start: String, val end: String, val timezone: String,
                           /** "" follow the schedule, "open" forced open, "closed" forced closed. */ val override: String) {
    fun json(): JsonObject = JsonObject(buildMap {
        put("enabled", JsonPrimitive(enabled)); put("daysOfWeek", JsonArray(days.sorted().map(::JsonPrimitive)))
        put("startTime", JsonPrimitive(start)); put("endTime", JsonPrimitive(end)); put("timezone", JsonPrimitive(timezone))
        if (override.isNotEmpty()) put("override", JsonPrimitive(override))
    })

    /** Turning the schedule on with no days picks Mon–Fri. */
    fun switched(on: Boolean) = copy(enabled = on, days = if (on && days.isEmpty()) listOf(1, 2, 3, 4, 5) else days)

    companion object {
        private val TIME = Regex("^([01]\\d|2[0-3]):([0-5]\\d)$")
        fun validTime(s: String?) = s?.takeIf { TIME.matches(it) }
        fun of(raw: JsonElement?): BuilderSchedule {
            val o = raw.obj() ?: JsonObject(emptyMap())
            val days = o["daysOfWeek"].arr()?.mapNotNull { v -> (v as? JsonPrimitive)?.let { it.longOrNull?.toInt() ?: it.content.toIntOrNull() } }
                ?.filter { it in 0..6 }?.distinct()?.sorted().orEmpty()
            val ov = o["override"].str().orEmpty()
            return BuilderSchedule(o["enabled"].bool() ?: false, days, validTime(o["startTime"].str()) ?: "00:00", validTime(o["endTime"].str()) ?: "23:59",
                o["timezone"].str()?.trim()?.ifEmpty { null } ?: "Asia/Jakarta", if (ov == "open" || ov == "closed") ov else "")
        }
    }
}

/** The web builder's lists: same values, same order. */
object FormVocab {
    val TYPES = listOf("text" to R.string.fb_t_text, "textarea" to R.string.fb_t_textarea, "email" to R.string.fb_t_email, "number" to R.string.fb_t_number,
        "date" to R.string.fb_t_date, "dropdown" to R.string.fb_t_dropdown, "multi_select" to R.string.fb_t_multi, "checkbox" to R.string.fb_t_checkbox, "file" to R.string.fb_t_file)
    val OPERATORS = listOf("equals" to R.string.fb_op_equals, "not_equals" to R.string.fb_op_not_equals, "contains" to R.string.fb_op_contains,
        "is_empty" to R.string.fb_op_empty, "is_not_empty" to R.string.fb_op_not_empty)
    fun needsValue(op: String) = op != "is_empty" && op != "is_not_empty"
    val MAPPING = listOf("none" to R.string.fb_map_none, "task_title" to R.string.fb_map_title, "task_description" to R.string.fb_map_description,
        "task_due_date" to R.string.fb_map_due, "task_status" to R.string.fb_map_status, "task_priority" to R.string.fb_map_priority,
        "task_list" to R.string.fb_map_list, "custom_field" to R.string.fb_map_custom)
    val ACTIONS = listOf("set_task_list" to R.string.fb_act_section, "assign_user" to R.string.fb_act_assign)
    /** Index = JS getDay(): 0 Sunday … 6 Saturday. */
    val DAYS = listOf(java.time.DayOfWeek.SUNDAY, java.time.DayOfWeek.MONDAY, java.time.DayOfWeek.TUESDAY, java.time.DayOfWeek.WEDNESDAY,
        java.time.DayOfWeek.THURSDAY, java.time.DayOfWeek.FRIDAY, java.time.DayOfWeek.SATURDAY)
}
