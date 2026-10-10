package id.znetworks.nexus.feature.admin

import id.znetworks.nexus.R
import id.znetworks.nexus.core.net.ApiError
import id.znetworks.nexus.core.net.NexusJson
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.descriptors.nullable

// Restore every kind of delete (Berlin, 8 Oct; RESTORE-ALL-TYPES, web AuditLogView). Project and task
// read exactly as before; every other kind by its own button, note, counts and refusals.

/**
 * `open` kept exactly as sent: an absent key decodes to [OpenField.ABSENT], `null` to JsonNull. A plain
 * `JsonElement?` can't tell them apart (both become null, and coerceInputValues would turn null into the
 * default of a non-null field) — and they mean different things (RestoreKinds.target).
 */
object OpenField : kotlinx.serialization.KSerializer<JsonElement> {
    val ABSENT: JsonElement = JsonPrimitive("\u0000absent")
    // Nullable, so a JSON null reaches deserialize (as JsonNull) instead of being coerced to the default.
    override val descriptor = JsonElement.serializer().descriptor.nullable
    override fun deserialize(decoder: kotlinx.serialization.encoding.Decoder): JsonElement = (decoder as kotlinx.serialization.json.JsonDecoder).decodeJsonElement()
    override fun serialize(encoder: kotlinx.serialization.encoding.Encoder, value: JsonElement) = (encoder as kotlinx.serialization.json.JsonEncoder).encodeJsonElement(value)
}

/** `restore.open` / the result's `open`: where the restored thing lives. */
@Serializable data class RestoreOpen(val type: String? = null, val id: String? = null, val projectId: String? = null, val date: String? = null)

/** A screen this app has for "Open …". */
data class RestoreTarget(val kind: Kind, val id: String? = null, val date: String? = null) {
    enum class Kind { PROJECT, TASK, DOC, FOLDER, ATTENDANCE, ROOMS, CALENDAR, VAULT, WIRE, CHAT }
}

object RestoreKinds {
    /** Server lib/deletion-entities.ts RESTORABLE: a delete of one of these without a copy predates the copies. */
    val RESTORABLE = setOf(
        "project", "task", "comment", "attachment", "proof_annotation", "doc", "project_page", "project_sheet", "sheet_comment",
        "custom_field", "form", "automation", "webhook", "workflow_bundle", "goal", "portfolio", "calendar", "room_booking",
        "announcement", "saved_search", "pnl_expense", "pnl_income", "pnl_payment", "pnl_category", "pnl_stage", "pnl_recurring",
        "pnl_expense_attachment", "pnl_budget", "holiday", "attendance_request", "attendance_office", "org_unit_member",
        "vault_file", "vault_folder", "vault_trash", "task_list", "project_folder", "org_unit", "sheet_rows", "form_submission",
        "attendance_record", "project_sheet_column", "post", "quest", "calendar_event", "dayoff_bonus",
        "chat_group", // DELETE-GROUP, 9 Oct
        "pipeline_deal", // PIPELINE-DASHBOARD, 9 Oct
        "pipeline_term", // PIPELINE-DASHBOARD §11.2, 9 Oct (opens its deal's board)
        "outlet_sales_event", // OUTLET-SALES, 10 Oct (opens its outlet)
    )
    private val VAULT = setOf("vault_file", "vault_folder", "vault_trash")

    /** The button per kind; a kind this app doesn't know (a newer server) says plain "Restore". */
    fun button(type: String?): Int = when (type) {
        "project" -> R.string.au_restore_project; "task" -> R.string.au_restore_task
        "comment", "sheet_comment" -> R.string.au_rb_comment; "attachment", "vault_file" -> R.string.au_rb_file
        "proof_annotation" -> R.string.au_rb_annotation; "doc" -> R.string.au_rb_doc; "project_page" -> R.string.au_rb_page
        "project_sheet" -> R.string.au_rb_sheet; "custom_field" -> R.string.au_rb_custom_field; "form" -> R.string.au_rb_form
        "automation" -> R.string.au_rb_automation; "webhook" -> R.string.au_rb_webhook; "workflow_bundle" -> R.string.au_rb_workflow_bundle
        "goal" -> R.string.au_rb_goal; "portfolio" -> R.string.au_rb_portfolio; "calendar" -> R.string.au_rb_calendar
        "room_booking" -> R.string.au_rb_booking; "announcement" -> R.string.au_rb_announcement; "saved_search" -> R.string.au_rb_saved_search
        "pnl_expense" -> R.string.au_rb_expense; "pnl_income" -> R.string.au_rb_income; "pnl_payment" -> R.string.au_rb_payment
        "pnl_category" -> R.string.au_rb_category; "pnl_stage" -> R.string.au_rb_stage; "pnl_recurring" -> R.string.au_rb_recurring
        "pnl_expense_attachment" -> R.string.au_rb_receipt; "pnl_budget" -> R.string.au_rb_budget; "holiday" -> R.string.au_rb_holiday
        "attendance_request" -> R.string.au_rb_day_off; "attendance_office" -> R.string.au_rb_office; "org_unit_member" -> R.string.au_rb_placement
        "vault_folder", "project_folder" -> R.string.au_rb_folder; "vault_trash" -> R.string.au_rb_trash; "task_list" -> R.string.au_rb_section
        "org_unit" -> R.string.au_rb_unit; "sheet_rows" -> R.string.au_rb_rows; "form_submission" -> R.string.au_rb_submission
        "attendance_record" -> R.string.au_rb_attendance_record; "project_sheet_column" -> R.string.au_rb_column; "post" -> R.string.au_rb_post
        "quest" -> R.string.au_rb_quest; "calendar_event" -> R.string.au_rb_event; "dayoff_bonus" -> R.string.au_rb_extra_day_off
        "chat_group" -> R.string.au_rb_chat_group
        "pipeline_deal" -> R.string.au_rb_deal
        "pipeline_term" -> R.string.au_rb_term
        "outlet_sales_event" -> R.string.au_rb_outlet_event
        else -> R.string.au_restore
    }

    /** One line under the explanation, where the kind needs it said. [soft]: the delete only flipped a flag. */
    fun note(type: String?, soft: Boolean): Int? = when (type) {
        "project" -> R.string.au_restore_folder
        "task_list" -> R.string.au_note_task_list; "project_folder" -> R.string.au_note_project_folder; "org_unit" -> R.string.au_note_org_unit
        "sheet_rows" -> R.string.au_note_sheet_rows; "project_sheet_column" -> R.string.au_note_column; "project_sheet" -> R.string.au_note_sheet
        "form" -> R.string.au_note_form; "form_submission" -> R.string.au_note_submission; "attendance_record" -> R.string.au_note_attendance_record
        "pnl_recurring" -> R.string.au_note_recurring; "pnl_category" -> R.string.au_note_category; "pnl_stage" -> R.string.au_note_stage
        "room_booking" -> R.string.au_note_room_booking
        in VAULT -> if (soft) R.string.au_note_vault_soft else R.string.au_note_vault_purged
        "post" -> R.string.au_note_post; "quest" -> R.string.au_note_quest; "calendar_event" -> R.string.au_note_event
        "dayoff_bonus" -> R.string.au_note_bonus; "attendance_office" -> if (soft) R.string.au_note_office else null
        "chat_group" -> R.string.au_note_chat_group
        "pipeline_deal" -> R.string.au_note_deal
        "pipeline_term" -> R.string.au_note_term
        "outlet_sales_event" -> R.string.au_note_outlet_event
        else -> null
    }

    /** A Vault purge just restored by you lands in the Vault trash, not where it was. */
    fun restoredNow(type: String?, soft: Boolean) = if (type in VAULT && !soft) R.string.au_restored_now_vault else R.string.au_restored_now

    private fun conflict(type: String?, soft: Boolean) = when (type) {
        "holiday" -> R.string.au_cf_holiday; "attendance_record" -> R.string.au_cf_attendance_record; "pnl_budget" -> R.string.au_cf_budget
        "room_booking" -> R.string.au_cf_room_booking; "org_unit_member" -> R.string.au_cf_placement; "project_sheet_column" -> R.string.au_cf_column
        else -> if (soft) R.string.au_cf_soft else R.string.au_cf_other
    }

    private fun parent(type: String?, parent: String?) = when {
        type == "task" && parent == "task" -> R.string.au_pm_subtask
        type == "task" -> R.string.au_err_parent_missing
        else -> when (parent) {
            "project" -> R.string.au_pm_project; "task" -> R.string.au_pm_task; "section" -> R.string.au_pm_section
            "comment" -> R.string.au_pm_comment; "file" -> R.string.au_pm_file; "sheet" -> R.string.au_pm_sheet; "row" -> R.string.au_pm_row
            "page" -> R.string.au_pm_page; "doc" -> R.string.au_pm_doc; "form" -> R.string.au_pm_form; "custom field" -> R.string.au_pm_field
            "goal" -> R.string.au_pm_goal; "portfolio" -> R.string.au_pm_portfolio; "income" -> R.string.au_pm_income
            "expense" -> R.string.au_pm_expense; "folder" -> R.string.au_pm_folder; "org chart unit" -> R.string.au_pm_unit
            "office" -> R.string.au_pm_office; "person" -> R.string.au_pm_person; "workspace" -> R.string.au_pm_workspace
            "team" -> R.string.au_pm_team; else -> R.string.au_pm_unknown
        }
    }

    /** The app's own text for a refused restore, by code, kind and (PARENT_MISSING) `parent`. */
    fun errorRes(e: Throwable, type: String?, soft: Boolean): Int {
        val h = e as? ApiError.Http ?: return R.string.au_err_restore_failed
        return when (h.code) {
            "PARENT_MISSING" -> parent(type, (h.body?.get("parent") as? JsonPrimitive)?.takeIf { it.isString }?.content)
            "CONFLICT" -> conflict(type, soft)
            "ALREADY_RESTORED" -> R.string.au_err_already_restored
            "ALREADY_EXISTS" -> R.string.au_err_already_exists
            "NOT_RESTORABLE" -> R.string.au_err_not_restorable
            else -> R.string.au_err_restore_failed
        }
    }

    /** What comes back, in the web's order: (plural, n), zeros left out. Project and task as they always read. */
    fun parts(c: AuditRestoreCounts, type: String?): List<Pair<Int, Int>> {
        val all = when {
            type == "project" || type == "task" -> listOf(
                (if (type == "task") R.plurals.au_n_subtasks else R.plurals.au_n_tasks) to c.tasks,
                R.plurals.au_n_lists to c.lists, R.plurals.au_n_files to c.files, R.plurals.au_n_comments to c.comments,
                R.plurals.au_n_sheets to c.sheets, R.plurals.au_n_members to c.members)
            type == "chat_group" -> listOf(R.plurals.au_n_messages to c.messages, R.plurals.au_n_members to c.members)
            type in VAULT || type !in RESTORABLE -> if (c.items > 1) listOf(R.plurals.au_n_items to c.items) else emptyList()
            else -> listOf(
                R.plurals.au_n_rows to c.rows, R.plurals.au_n_values to c.cells, R.plurals.au_n_tasks to c.tasks, R.plurals.au_n_lists to c.lists,
                R.plurals.au_n_projects to c.projects, R.plurals.au_n_subfolders to c.folders, R.plurals.au_n_people to c.people,
                R.plurals.au_n_units_under to c.units, R.plurals.au_n_subpages to c.pages, R.plurals.au_n_submissions to c.submissions,
                R.plurals.au_n_field_values to c.values, R.plurals.au_n_receipts to c.receipts, R.plurals.au_n_payments to c.payments,
                R.plurals.au_n_milestones to c.milestones, R.plurals.au_n_points to c.points, R.plurals.au_n_files to c.files,
                (if (type == "comment") R.plurals.au_n_replies else R.plurals.au_n_comments) to c.comments,
                R.plurals.au_n_sheets to c.sheets, R.plurals.au_n_members to c.members)
        }
        return all.filter { it.second > 0 }
    }

    /**
     * Where "Open …" goes. [open] absent (a copy from before `open` existed) → project/task by [entityId];
     * JSON null → no link; a type this app has no screen for → its project when known, else none.
     */
    fun target(open: JsonElement?, type: String?, entityId: String?): RestoreTarget? {
        if (open == null || open == OpenField.ABSENT) return when {
            entityId == null -> null
            type == "project" -> RestoreTarget(RestoreTarget.Kind.PROJECT, entityId)
            type == "task" -> RestoreTarget(RestoreTarget.Kind.TASK, entityId)
            else -> null
        }
        if (open is JsonNull || open !is JsonObject) return null
        val o = runCatching { NexusJson.decodeFromJsonElement(RestoreOpen.serializer(), open) }.getOrNull() ?: return null
        fun withId(k: RestoreTarget.Kind) = o.id?.let { RestoreTarget(k, it) }
        return when (o.type) {
            "project" -> withId(RestoreTarget.Kind.PROJECT)
            "task" -> withId(RestoreTarget.Kind.TASK)
            "doc" -> withId(RestoreTarget.Kind.DOC)
            "folder" -> withId(RestoreTarget.Kind.FOLDER)
            "vault" -> RestoreTarget(RestoreTarget.Kind.VAULT)
            "attendance_request", "attendance_record", "attendance_office" -> RestoreTarget(RestoreTarget.Kind.ATTENDANCE, o.id)
            "room_booking" -> RestoreTarget(RestoreTarget.Kind.ROOMS, o.id)
            "calendar", "calendar_event" -> RestoreTarget(RestoreTarget.Kind.CALENDAR, date = o.date)
            "post" -> RestoreTarget(RestoreTarget.Kind.WIRE, o.id)
            "chat" -> withId(RestoreTarget.Kind.CHAT)
            else -> o.projectId?.let { RestoreTarget(RestoreTarget.Kind.PROJECT, it) } // a sheet, page, form, P&L…: its project
        }
    }

    fun openLabel(k: RestoreTarget.Kind) = when (k) {
        RestoreTarget.Kind.PROJECT -> R.string.au_open_project; RestoreTarget.Kind.TASK -> R.string.au_open_task
        RestoreTarget.Kind.DOC -> R.string.au_open_doc; RestoreTarget.Kind.FOLDER -> R.string.au_open_folder
        RestoreTarget.Kind.ATTENDANCE -> R.string.au_open_attendance; RestoreTarget.Kind.ROOMS -> R.string.au_open_room
        RestoreTarget.Kind.CALENDAR -> R.string.au_open_calendar; RestoreTarget.Kind.VAULT -> R.string.au_open_vault
        RestoreTarget.Kind.WIRE -> R.string.au_open_wire; RestoreTarget.Kind.CHAT -> R.string.au_open_chat
    }

    /** No copy on a delete: why, for a kind that is restorable today. Null = say nothing (not a restorable kind, or not a delete). */
    fun tooOld(e: AuditEntry, restore: AuditRestoreDetail?): Int? = when {
        restore != null || e.action != "delete" -> null
        e.entityType == "project" || e.entityType == "task" -> R.string.au_restore_too_old
        e.entityType in RESTORABLE -> R.string.au_restore_too_old_any
        else -> null
    }
}
