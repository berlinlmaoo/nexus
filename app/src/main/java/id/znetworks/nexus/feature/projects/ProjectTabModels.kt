package id.znetworks.nexus.feature.projects

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement
import java.text.NumberFormat
import java.util.Locale

// Project tabs beyond the board (API.md §2.4 automations, custom fields).

/** GET /api/status-updates?projectId= — one post on a project's Overview. */
@Serializable
data class StatusUpdate(val id: String, val text: String = "", val status: String? = null, val createdAt: String? = null, val author: UserRef? = null)

// Automation models live in AutomationText.kt (DEV-REDESIGN §2).

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
