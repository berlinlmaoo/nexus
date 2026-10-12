package id.znetworks.nexus.feature.projects

import id.znetworks.nexus.R
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull

// Project automations (DEV-REDESIGN §2; server lib/automation-rules.ts, web automation-meta.ts). The app reads
// and runs rules; they are built on the web. Every type gets a readable label, unknown ones show as sent.

/** A trigger or an action: `{ type, field?, value?, config? }`. */
@Serializable
data class Rule(val type: String? = null, val field: String? = null, val value: JsonElement? = null, val config: JsonObject? = null) {
    /** [value] as text: a string, a number, or a list joined (people, days). */
    val text: String? get() = when (val v = value) {
        is JsonPrimitive -> v.contentOrNull
        is JsonArray -> v.mapNotNull { (it as? JsonPrimitive)?.contentOrNull }.joinToString(",").ifEmpty { null }
        else -> null
    }
}

@Serializable
data class ConditionRule(val field: String = "", val op: String = "", val value: JsonElement? = null) {
    val text: String? get() = (value as? JsonPrimitive)?.contentOrNull
}

@Serializable
data class Conditions(val match: String = "all", val rules: List<ConditionRule> = emptyList())

@Serializable
data class Automation(
    val id: String,
    val name: String = "",
    val enabled: Boolean? = null,
    val trigger: Rule? = null,
    /** The first action (what released apps read). */
    val action: Rule? = null,
    val actions: List<Rule> = emptyList(),
    val conditions: Conditions? = null,
    val lastRunAt: String? = null,
    val lastRunStatus: String? = null,
    val runCount: Int = 0,
    val nextRunAt: String? = null,
) {
    /** Ordered actions; an old row carries only [action]. */
    val steps: List<Rule> get() = actions.ifEmpty { listOfNotNull(action) }
}

/** [canEdit]: the caller leads the project (Manager, BoD, One Above All): toggle and Run now. */
@Serializable
data class AutomationsResponse(val automations: List<Automation> = emptyList(), val canEdit: Boolean = false)

@Serializable
data class RunStep(val type: String = "", val ok: Boolean = true, val skipped: Boolean = false, val message: String = "")

@Serializable
data class RunRef(val id: String? = null, val title: String? = null, val name: String? = null)

@Serializable
data class AutomationRun(
    val id: String,
    val createdAt: String? = null,
    val event: String = "",
    val status: String = "",
    val steps: List<RunStep> = emptyList(),
    val error: String? = null,
    val durationMs: Long? = null,
    val taskId: String? = null,
    val task: RunRef? = null,
    val actor: RunRef? = null,
)

@Serializable
data class AutomationRunsResponse(val runs: List<AutomationRun> = emptyList(), val hasMore: Boolean = false)

/** POST /api/automations/run: `run` null + `skipped` = the task didn't meet the conditions. */
@Serializable
data class RunNowResponse(val run: AutomationRun? = null, val skipped: Boolean = false)

/** Who and what the ids in a rule are, from the project (sections, members, custom fields). */
data class AutomationNames(val sections: Map<String, String> = emptyMap(), val people: Map<String, String> = emptyMap(), val fields: Map<String, String> = emptyMap())

/** A string resource with its arguments: [say] turns it into text (Context.getString in the app, a fake in tests). */
typealias Say = (Int, Array<out Any>) -> String

object AutomationText {
    val TRIGGERS = mapOf(
        "TASK_CREATED" to R.string.au_t_task_created, "TASK_UPDATED" to R.string.au_t_task_updated,
        "STATUS_CHANGED" to R.string.au_t_status_changed, "TASK_COMPLETED" to R.string.au_t_task_completed,
        "ASSIGNEE_CHANGED" to R.string.au_t_assignee_changed, "FIELD_CHANGED" to R.string.au_t_field_changed,
        "DUE_DATE_APPROACHING" to R.string.au_t_due_approaching, "DUE_DATE_REACHED" to R.string.au_t_due_reached,
        "COMMENT_ADDED" to R.string.au_t_comment_added, "FORM_SUBMITTED" to R.string.au_t_form_submitted,
        "SCHEDULED" to R.string.au_t_scheduled,
        // Removed with NEXUS webhooks (12 Oct 2026): such a rule never fires; it stays so its owner can change it.
        "WEBHOOK_RECEIVED" to R.string.au_t_webhook_removed,
    )
    val ACTIONS = mapOf(
        "SET_STATUS" to R.string.au_a_set_status, "MARK_COMPLETE" to R.string.au_a_mark_complete, "SET_PRIORITY" to R.string.au_a_set_priority,
        "ASSIGN_TO" to R.string.au_a_assign, "UNASSIGN" to R.string.au_a_unassign, "SET_FIELD" to R.string.au_a_set_field,
        "MOVE_TO_SECTION" to R.string.au_a_move, "ADD_TAG" to R.string.au_a_add_tag, "REMOVE_TAG" to R.string.au_a_remove_tag,
        "ADD_COMMENT" to R.string.au_a_comment, "SEND_NOTIFICATION" to R.string.au_a_notify, "CREATE_TASK" to R.string.au_a_create_task,
        "CREATE_SUBTASK" to R.string.au_a_create_subtask, "DUPLICATE_TASK" to R.string.au_a_duplicate, "ARCHIVE_TASK" to R.string.au_a_archive,
    )
    /** Built-in task fields (conditions, Field changed, Set a field). */
    val FIELDS = mapOf(
        "status" to R.string.au_f_status, "priority" to R.string.au_f_priority, "assignee" to R.string.au_f_assignee,
        "section" to R.string.au_f_section, "tags" to R.string.au_f_tags, "title" to R.string.au_f_title,
        "description" to R.string.au_f_description, "dueDate" to R.string.au_f_due, "startDate" to R.string.au_f_start, "creator" to R.string.au_f_creator,
    )
    val OPS = mapOf(
        "is" to R.string.au_op_is, "is_not" to R.string.au_op_is_not, "contains" to R.string.au_op_contains,
        "not_contains" to R.string.au_op_not_contains, "is_empty" to R.string.au_op_empty, "is_not_empty" to R.string.au_op_not_empty,
        "gt" to R.string.au_op_gt, "lt" to R.string.au_op_lt, "overdue" to R.string.au_op_overdue, "within_days" to R.string.au_op_within,
    )
    val STATUSES = mapOf(
        "TODO" to R.string.tstatus_todo, "IN_PROGRESS" to R.string.tstatus_in_progress, "IN_REVIEW" to R.string.tstatus_in_review,
        "DONE" to R.string.tstatus_done, "CANCELLED" to R.string.tstatus_cancelled,
    )
    val PRIORITIES = mapOf("URGENT" to R.string.prio_urgent, "HIGH" to R.string.prio_high, "MEDIUM" to R.string.prio_medium, "LOW" to R.string.prio_low, "NONE" to R.string.prio_none)
    val RUN_STATUS = mapOf(
        "SUCCESS" to R.string.au_run_success, "PARTIAL" to R.string.au_run_partial, "FAILED" to R.string.au_run_failed,
        "SKIPPED" to R.string.au_run_skipped, "RUNNING" to R.string.au_run_running,
    )
    val EVENTS = mapOf(
        "task_created" to R.string.au_t_task_created, "task_updated" to R.string.au_ev_task_updated, "comment_added" to R.string.au_t_comment_added,
        "form_submitted" to R.string.au_t_form_submitted, "due_approaching" to R.string.au_t_due_approaching, "due_reached" to R.string.au_t_due_reached,
        "scheduled" to R.string.au_ev_scheduled, "webhook" to R.string.au_t_webhook, "manual" to R.string.au_ev_manual,
    )
    private val PEOPLE_TOKENS = mapOf("@actor" to R.string.au_p_actor, "@creator" to R.string.au_p_creator, "@assignees" to R.string.au_p_assignees,
        "@leads" to R.string.au_p_leads, "@all" to R.string.au_p_all)
    private val WEEKDAYS = listOf(R.string.au_d1, R.string.au_d2, R.string.au_d3, R.string.au_d4, R.string.au_d5, R.string.au_d6, R.string.au_d7)

    private fun s(say: Say, id: Int, vararg args: Any) = say(id, args)

    /** A status, a priority, a section, a person (or several, or a role) by name; otherwise as stored. */
    fun valueText(v: String?, names: AutomationNames, say: Say): String {
        if (v.isNullOrBlank()) return ""
        STATUSES[v]?.let { return s(say, it) }
        PRIORITIES[v]?.let { return s(say, it) }
        names.sections[v]?.let { return it }
        if (v.contains(',') || v.startsWith("@") || v in names.people) return people(v, names, say)
        return v
    }

    fun people(v: String?, names: AutomationNames, say: Say): String =
        v.orEmpty().split(',').map { it.trim() }.filter { it.isNotEmpty() }
            .joinToString(", ") { p -> PEOPLE_TOKENS[p]?.let { s(say, it) } ?: names.people[p] ?: p }

    fun fieldName(key: String?, names: AutomationNames, say: Say): String = when {
        key.isNullOrBlank() -> "—"
        FIELDS.containsKey(key) -> s(say, FIELDS.getValue(key))
        key.startsWith("cf:") -> names.fields[key.removePrefix("cf:")] ?: s(say, R.string.au_f_custom)
        else -> key
    }

    /** "Status changed to Done", "Daily 09:00 WIB", "24h before due"… */
    fun trigger(r: Rule?, names: AutomationNames, say: Say): String {
        if (r == null) return "—"
        val type = r.type.orEmpty()
        val v = r.text
        return when (type) {
            "STATUS_CHANGED" -> {
                val from = (r.config?.get("from") as? JsonPrimitive)?.contentOrNull?.takeIf { it.isNotBlank() }
                when {
                    from != null && !v.isNullOrBlank() -> s(say, R.string.au_t_status_from_to, valueText(from, names, say), valueText(v, names, say))
                    !v.isNullOrBlank() -> s(say, R.string.au_t_status_to, valueText(v, names, say))
                    else -> s(say, R.string.au_t_status_changed)
                }
            }
            "ASSIGNEE_CHANGED" -> if (!v.isNullOrBlank()) s(say, R.string.au_t_assigned_to, people(v, names, say)) else s(say, R.string.au_t_assignee_changed)
            "FIELD_CHANGED" -> if (!v.isNullOrBlank()) s(say, R.string.au_t_field_to, fieldName(r.field, names, say), valueText(v, names, say))
                else s(say, R.string.au_t_field_named, fieldName(r.field, names, say))
            "DUE_DATE_APPROACHING" -> s(say, R.string.au_t_hours_before, v?.toIntOrNull() ?: 24)
            "SCHEDULED" -> schedule(r.config, say)
            else -> TRIGGERS[type]?.let { s(say, it) } ?: type.ifBlank { "—" }
        }
    }

    /** "Daily 09:00 WIB", "Weekly Mon, Thu 09:00 WIB", "Monthly on day 1 09:00 WIB". */
    fun schedule(c: JsonObject?, say: Say): String {
        val time = (c?.get("time") as? JsonPrimitive)?.contentOrNull.orEmpty()
        val freq = (c?.get("frequency") as? JsonPrimitive)?.contentOrNull
        val when_ = when (freq) {
            "weekly" -> {
                val days = (c?.get("days") as? JsonArray)?.mapNotNull { (it as? JsonPrimitive)?.intOrNull }?.filter { it in 1..7 }?.sorted().orEmpty()
                s(say, R.string.au_s_weekly) + days.takeIf { it.isNotEmpty() }?.joinToString(", ", prefix = " ") { s(say, WEEKDAYS[it - 1]) }.orEmpty()
            }
            "weekdays" -> s(say, R.string.au_s_weekdays)
            "monthly" -> s(say, R.string.au_s_monthly, (c?.get("dayOfMonth") as? JsonPrimitive)?.intOrNull ?: 1)
            else -> s(say, R.string.au_s_daily)
        }
        return "$when_ $time WIB".replace("  ", " ")
    }

    /** "Set status: Done", "Move to section: Published", "Add comment: “…”". */
    fun action(a: Rule, names: AutomationNames, say: Say): String {
        val type = a.type.orEmpty()
        val base = ACTIONS[type]?.let { s(say, it) } ?: type.ifBlank { "—" }
        val v = a.text
        val detail = when (type) {
            "SET_STATUS", "SET_PRIORITY", "MOVE_TO_SECTION" -> valueText(v, names, say)
            "ASSIGN_TO", "UNASSIGN" -> people(v, names, say)
            "ADD_TAG", "REMOVE_TAG", "CREATE_TASK", "CREATE_SUBTASK" -> v.orEmpty()
            "SET_FIELD" -> fieldName(a.field, names, say) + (v?.takeIf { it.isNotBlank() }?.let { " = " + valueText(it, names, say) }.orEmpty())
            "ADD_COMMENT" -> v?.takeIf { it.isNotBlank() }?.let { "“" + (if (it.length > 60) it.take(59) + "…" else it) + "”" }.orEmpty()
            "SEND_NOTIFICATION" -> people((a.config?.get("to") as? JsonArray)?.mapNotNull { (it as? JsonPrimitive)?.contentOrNull }?.joinToString(",") ?: "@assignees", names, say)
            else -> ""
        }
        return if (detail.isBlank()) base else "$base: $detail"
    }

    /** "Priority is High", "Due date is overdue", "Due date is within the next 3 days". */
    fun condition(c: ConditionRule, names: AutomationNames, say: Say): String {
        val field = fieldName(c.field, names, say)
        val op = OPS[c.op]?.let { s(say, it) } ?: c.op
        val v = c.text
        val value = when {
            c.op in setOf("is_empty", "is_not_empty", "overdue") -> ""
            c.op == "within_days" -> s(say, R.string.au_days, v?.toIntOrNull() ?: 0)
            c.field == "assignee" || c.field == "creator" -> people(v, names, say)
            else -> valueText(v, names, say)
        }
        return listOf(field, op, value).filter { it.isNotBlank() }.joinToString(" ")
    }

    /** The list line: "When Status changed to Done · 2 conditions → Add comment, Send notification". */
    fun summary(a: Automation, names: AutomationNames, say: Say): String {
        val n = a.conditions?.rules?.size ?: 0
        val cond = if (n > 0) " · " + s(say, if (n == 1) R.string.au_one_condition else R.string.au_n_conditions, n) else ""
        val acts = a.steps.joinToString(", ") { action(it, names, say) }.ifBlank { "—" }
        return s(say, R.string.au_when) + " " + trigger(a.trigger, names, say) + cond + " → " + acts
    }
}

/**
 * The identity automations sign their own writes with (server lib/automation-identity.ts): comments, tasks and
 * activity an automation makes come from "Automation" (⚡ avatar, a PNG the app loads like any avatar). It is a
 * plain user row, so it is recognised by its avatar path or its `.invalid` address and named in the app's language.
 */
object SystemActors {
    const val AUTOMATION_AVATAR = "/api/system-avatars/automation.png"
    const val AUTOMATION_EMAIL = "automation@nexus.invalid"

    fun isAutomation(u: UserRef?): Boolean = u != null && (u.avatar == AUTOMATION_AVATAR || u.email.equals(AUTOMATION_EMAIL, ignoreCase = true))
}

/** An author's name: "Automation" / "Otomasi" for the system identity, else the stored name. */
@androidx.compose.runtime.Composable
fun authorName(u: UserRef?): String =
    if (SystemActors.isAutomation(u)) androidx.compose.ui.res.stringResource(R.string.au_actor_name) else u?.name ?: u?.email ?: "—"
