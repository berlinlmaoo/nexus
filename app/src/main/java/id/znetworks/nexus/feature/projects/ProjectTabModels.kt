package id.znetworks.nexus.feature.projects

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement
import java.text.NumberFormat
import java.util.Locale

// Project tabs beyond the board (API.md §2.4 sprints, automations, finance/P&L, custom fields).

@Serializable
data class SprintTaskRef(val id: String, val title: String? = null, val status: String? = null)

@Serializable
data class SprintTask(val task: SprintTaskRef? = null)

@Serializable
data class Sprint(
    val id: String,
    val name: String = "",
    val status: String? = null,
    val startDate: String? = null,
    val endDate: String? = null,
    val tasks: List<SprintTask> = emptyList(),
) {
    val refs: List<SprintTaskRef> get() = tasks.mapNotNull { it.task }
    val done: Int get() = refs.count { it.status.equals("DONE", true) }
    val progress: Float get() = if (refs.isEmpty()) 0f else done.toFloat() / refs.size
    val state: String get() = (status ?: "PLANNING").uppercase()
    /** PLANNING → ACTIVE → COMPLETED. */
    val next: String? get() = when (state) { "PLANNING" -> "ACTIVE"; "ACTIVE" -> "COMPLETED"; else -> null }
}

@Serializable
data class SprintsResponse(val sprints: List<Sprint> = emptyList())

/** PATCH reply: the sprint, or (completing with open tasks and no destination) nothing changed. */
@Serializable
data class SprintPatchReply(val requiresAction: Boolean? = null, val incompleteTasks: List<SprintTaskRef> = emptyList())

@Serializable
data class Rule(val type: String? = null, val field: String? = null, val value: JsonElement? = null) {
    fun text(): String {
        fun human(s: String) = s.lowercase().replace('_', ' ').replaceFirstChar(Char::titlecase)
        var out = human(type.orEmpty()).ifBlank { "—" }
        if (!field.isNullOrBlank()) out += " · " + human(field)
        valueText(value)?.takeIf { it.isNotBlank() }?.let { out += " = $it" }
        return out
    }
}

@Serializable
data class Automation(val id: String, val name: String = "", val enabled: Boolean? = null, val trigger: Rule? = null, val action: Rule? = null)

@Serializable
data class AutomationsResponse(val automations: List<Automation> = emptyList())

@Serializable
data class CustomFieldDef(
    val id: String,
    val name: String = "",
    val type: String? = null,
    val position: Int? = null,
    val options: JsonElement? = null,
    /** Only with `taskId`: string, string[] (MULTI_SELECT) or {label, mapUrl} (PLACE). */
    val value: JsonElement? = null,
) {
    val kind: String get() = type.orEmpty().uppercase()
    val choices: List<String> get() = optionList(options)
}

/** GET /api/workspaces/members: the caller's role and everyone in the workspace. */
@Serializable
data class RosterMember(val id: String? = null, val userId: String? = null, val name: String? = null, val email: String? = null, val avatar: String? = null, val role: String? = null)

@Serializable
data class Roster(val role: String? = null, val members: List<RosterMember> = emptyList())

@Serializable
data class CustomFieldsResponse(val fields: List<CustomFieldDef> = emptyList())

/** "Rp1.250.000", as iOS `idr`. */
fun idr(n: Double?): String = NumberFormat.getCurrencyInstance(Locale.forLanguageTag("id-ID")).apply {
    currency = java.util.Currency.getInstance("IDR"); maximumFractionDigits = 0
}.format(n ?: 0.0).replace(" ", "")
