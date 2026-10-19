package id.znetworks.nexus.feature.gideon

import android.app.DatePickerDialog
import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import id.znetworks.nexus.NexusApplication
import id.znetworks.nexus.R
import id.znetworks.nexus.core.net.NexusJson
import id.znetworks.nexus.core.net.ApiError
import id.znetworks.nexus.core.nav.Links
import id.znetworks.nexus.ui.components.NxButton
import id.znetworks.nexus.ui.components.NxButtonKind
import id.znetworks.nexus.ui.theme.Nx
import java.time.LocalDate
import java.time.format.DateTimeFormatter

@Composable internal fun actionLabel(action: String?, apply: Boolean = false, done: Boolean = false): String {
    val ids = actionResources(action, apply, done)
    return stringResource(ids.second)
}

@Composable private fun fieldLabel(field: String): String = fieldResource(field)?.let { stringResource(it) } ?: field

/** Date-only wire values stay date-only; a trailing time is already WIB, never shifted by the phone zone. */
internal fun actionDay(value: String?, day: String?, locale: java.util.Locale): String {
    if (day == null) return value ?: "—"
    val date = runCatching { LocalDate.parse(day).format(DateTimeFormatter.ofPattern("EEE d MMM", locale)) }.getOrNull() ?: return value ?: day
    return date + (Regex("\\b\\d{2}:\\d{2}(?: WIB)?$").find(value.orEmpty())?.value?.let { " $it" } ?: "")
}

@Composable internal fun GProperty(label: String, content: @Composable RowScope.() -> Unit) {
    Row(Modifier.fillMaxWidth().background(Nx.colors.muted.copy(alpha = .5f), RoundedCornerShape(6.dp)).padding(8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(label, color = Nx.colors.mutedFg, fontSize = 12.sp, modifier = Modifier.width(86.dp))
        Row(Modifier.weight(1f), content = content)
    }
}

@Composable internal fun GPicker(label: String, value: String?, options: List<Pair<String, String>>, enabled: Boolean = true, onPick: (String) -> Unit) {
    var open by remember { mutableStateOf(false) }
    var query by remember { mutableStateOf("") }
    TextButton(onClick = { query = ""; open = true }, enabled = enabled, contentPadding = PaddingValues(0.dp)) { Text(value ?: label, maxLines = 2, overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis) }
    if (open) AlertDialog(onDismissRequest = { open = false }, title = { Text(label) }, text = {
        Column {
            OutlinedTextField(query, { query = it }, placeholder = { Text(stringResource(R.string.gt_search)) }, singleLine = true)
            Column(Modifier.heightIn(max = 350.dp).verticalScroll(rememberScrollState())) {
                options.filter { it.second.contains(query, true) }.forEach { (id, name) ->
                    Text(name, maxLines = 2, overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis, color = Nx.colors.foreground, modifier = Modifier.fillMaxWidth().clickable { open = false; onPick(id) }.padding(vertical = 15.dp))
                }
            }
        }
    }, confirmButton = { TextButton(onClick = { open = false }) { Text(stringResource(R.string.cancel)) } })
}

@Composable internal fun ActionCard(p: GProposal, deciding: Boolean, onDecide: (GDecision) -> Unit, readOnly: Boolean = false) {
    val c = Nx.colors
    val ctx = LocalContext.current
    val container = (ctx.applicationContext as NexusApplication).container
    val locale = LocalConfiguration.current.locales[0]
    val deleting = p.action == "delete_task"
    val danger = deleting || p.action == "cancel_reminder"
    val extra = p.extra
    val preview = extra?.preview
    val cells = extra?.sheetEdit?.cells.orEmpty()
    val icon = when (p.action) {
        "send_message" -> Icons.Outlined.ChatBubbleOutline
        "create_reminder", "cancel_reminder" -> Icons.Outlined.Alarm
        "submit_leave_request", "decide_attendance_request" -> Icons.Outlined.EventAvailable
        "bulk_update_tasks", "add_subtasks" -> Icons.Outlined.Checklist
        "move_deal_stage" -> Icons.Outlined.ViewKanban
        "add_payment_term" -> Icons.Outlined.ReceiptLong
        "log_outlet_sales", "log_social_media_day" -> Icons.Outlined.TrendingUp
        "create_legal_draft" -> Icons.Outlined.Balance
        "create_vault_share_link" -> Icons.Outlined.Link
        "draft_announcement" -> Icons.Outlined.Campaign
        "edit_doc" -> Icons.Outlined.Edit
        "edit_sheet_cells", "create_sheet" -> Icons.Outlined.TableChart
        "save_file_to_vault" -> Icons.Outlined.DriveFileMove
        "delete_task" -> Icons.Outlined.Delete
        "set_my_status" -> Icons.Outlined.RadioButtonChecked
        else -> Icons.Outlined.VerifiedUser
    }
    Column(Modifier.fillMaxWidth().border(1.dp, if (p.isPending && danger) c.dangerText.copy(alpha = .4f) else c.border, RoundedCornerShape(16.dp)).background(c.card, RoundedCornerShape(16.dp)).padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Icon(icon, null, tint = if (danger) c.dangerText else c.foreground, modifier = Modifier.size(20.dp))
            Column {
                Text(actionLabel(p.action), color = if (danger) c.dangerText else c.foreground, fontWeight = FontWeight.SemiBold)
                Text(proposalSummary(p) ?: p.taskDelete?.title.orEmpty(), color = c.foreground, fontSize = 13.sp, textDecoration = if (deleting && p.status == "APPLIED") TextDecoration.LineThrough else null)
            }
        }
        ProposalNoChange(p)
        if (p.isPending) Text(stringResource(R.string.gc_waiting_approval), fontSize = 12.sp, color = c.warningFg)
        if (deleting && p.taskDelete != null) {
            val d = p.taskDelete
            val progress = d.progress?.let { id.znetworks.nexus.feature.projects.taskStatusLabel(it.uppercase().replace(' ', '_')) }
            listOf("Project" to d.projectName, "Status" to listOfNotNull(d.status, progress).distinct().joinToString(" · "), "Due" to if (d.dueDay == null) stringResource(R.string.gt_no_due) else actionDay(d.due, d.dueDay, locale), "Assignees" to d.assignees.joinToString(", ").ifEmpty { stringResource(R.string.td_unassigned) }).forEach { (label, value) ->
                GProperty(fieldLabel(label)) { Text(value?.ifBlank { "—" } ?: "—", color = c.foreground, fontSize = 13.sp) }
            }
            if (p.isPending) Text(stringResource(R.string.gt_delete_warning), color = c.mutedFg, fontSize = 12.sp)
        } else p.diff.filter { (preview == null || it.toText != preview) && cells.none { cell -> cell.ref == it.field } }.forEach { row ->
            GProperty(fieldLabel(row.field.orEmpty())) {
                SelectionContainer {
                    Column {
                        row.fromText?.takeIf { it.isNotEmpty() }?.let { Text(fieldLabel(actionDay(it, row.fromDay, locale)), color = c.dangerText, textDecoration = TextDecoration.LineThrough, fontSize = 13.sp) }
                        Text(fieldLabel(actionDay(row.toText, row.toDay, locale)), color = if (row.fromText != null) c.success else c.foreground, fontSize = 13.sp)
                    }
                }
            }
        }
        if (preview != null && cells.isEmpty()) SelectionContainer { Text(preview, color = c.foreground, fontSize = 13.sp, modifier = Modifier.fillMaxWidth().heightIn(max = 256.dp).background(c.muted, RoundedCornerShape(8.dp)).verticalScroll(rememberScrollState()).padding(10.dp)) }
        if (cells.isNotEmpty()) Column(Modifier.heightIn(max = 256.dp).verticalScroll(rememberScrollState()).horizontalScroll(rememberScrollState())) {
            Row { listOf(R.string.gt_cell, R.string.gt_before, R.string.gt_after).forEach { Text(stringResource(it), fontWeight = FontWeight.SemiBold, modifier = Modifier.width(120.dp).padding(6.dp)) } }
            cells.forEach { cell -> Row {
                Text(cell.ref, modifier = Modifier.width(120.dp).padding(6.dp))
                SelectionContainer { Text(GideonReview.loose(cell.from) ?: "—", color = c.dangerText, textDecoration = TextDecoration.LineThrough, modifier = Modifier.width(120.dp).padding(6.dp)) }
                SelectionContainer { Text(GideonReview.loose(cell.to) ?: "—", color = c.success, modifier = Modifier.width(120.dp).padding(6.dp)) }
            } }
        }
        p.error?.let { SelectionContainer { Text(it, color = c.dangerText, fontSize = 12.sp) } }
        if (p.isPending && !readOnly) {
            if (!deleting) Text(stringResource(R.string.gt_footer, actionLabel(p.action, apply = true)), color = c.mutedFg, fontSize = 11.sp)
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.End)) {
                NxButton(stringResource(if (deleting) R.string.gt_keep_task else R.string.gx_discard), { onDecide(GDecision(p, false)) }, kind = NxButtonKind.GHOST, enabled = !deciding, compact = true)
                NxButton(actionLabel(p.action, apply = true), { onDecide(GDecision(p, true)) }, kind = if (danger) NxButtonKind.DESTRUCTIVE else NxButtonKind.PRIMARY, enabled = !deciding, compact = true)
            }
        } else if (!p.isPending) {
            Text(if (p.status == "APPLIED") actionLabel(p.action, done = true) else when (p.status) { "DISCARDED" -> stringResource(R.string.gx_discarded); "APPLYING" -> stringResource(R.string.gx_applying); else -> stringResource(R.string.gx_apply_failed) }, color = if (p.status == "APPLIED") c.success else c.mutedFg, fontSize = 12.sp)
            if (p.status == "APPLIED") {
                extra?.link?.takeIf { it.startsWith("/") }?.let { link -> TextButton(onClick = { Links.parse(link)?.let(container.router::open) }) { Text(stringResource(R.string.gt_open)) } }
                extra?.note?.let { SelectionContainer { Text(it, color = c.mutedFg, fontSize = 12.sp) } }
            }
        }
    }
}

@Composable internal fun CreateTaskCard(p: GProposal, deciding: Boolean, onDecide: (GDecision) -> Unit) {
    val target = p.taskTarget ?: return
    val context = LocalContext.current
    val api = (context.applicationContext as NexusApplication).container.api
    val c = Nx.colors
    var project by remember(p.id) { mutableStateOf(target.projectId?.takeIf { id -> target.projects.any { it.id == id } }) }
    var section by remember(p.id) { mutableStateOf(target.taskListId) }
    var assignees by remember(p.id) { mutableStateOf(target.assigneeIds) }
    var due by remember(p.id) { mutableStateOf(target.dueDay) }
    var targets by remember(p.id) { mutableStateOf<GTaskTargets?>(null) }
    var failed by remember(p.id) { mutableStateOf(false) }
    LaunchedEffect(p.id, project) {
        targets = null; failed = false
        val id = project ?: return@LaunchedEffect
        try {
            val loaded = api.get("/api/gideon/task-targets?projectId=" + java.net.URLEncoder.encode(id, "UTF-8"), GTaskTargets.serializer())
            targets = loaded
            assignees = assignees.filter { a -> loaded.members.any { it.id == a } }
            section = section?.takeIf { s -> loaded.sections.any { it.id == s } } ?: loaded.sections.firstOrNull { it.taskStatus == target.status }?.id ?: loaded.sections.firstOrNull()?.id
        } catch (_: ApiError) { failed = true }
    }
    Column(Modifier.fillMaxWidth().background(c.card, RoundedCornerShape(16.dp)).border(1.dp, c.border, RoundedCornerShape(16.dp)).padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Text(stringResource(R.string.gt_create_task), fontWeight = FontWeight.SemiBold, color = c.foreground)
        proposalSummary(p)?.let { Text(it, color = c.foreground, fontSize = 13.sp) }
        ProposalNoChange(p)
        Text(stringResource(R.string.gc_waiting_approval), color = c.warningFg, fontSize = 12.sp)
        GProperty(stringResource(R.string.gt_title)) { Text(target.title, color = c.foreground, fontSize = 13.sp) }
        GProperty(stringResource(R.string.gt_project)) { GPicker(stringResource(R.string.gt_choose_project), target.projects.firstOrNull { it.id == project }?.name, target.projects.map { it.id to it.name }, !deciding) { if (project != it) { targets = null; project = it } } }
        if (project != null) {
            GProperty(stringResource(R.string.gt_status)) { GPicker(stringResource(R.string.gt_choose_column), targets?.sections?.firstOrNull { it.id == section }?.name, targets?.sections.orEmpty().map { it.id to it.name }, !deciding && targets != null) { section = it } }
            GProperty("PIC") { Column {
                targets?.members.orEmpty().filter { it.id in assignees }.forEach { member -> TextButton(onClick = { assignees = assignees - member.id }, enabled = !deciding) { Text(member.name + " ×") } }
                GPicker(stringResource(R.string.gt_assignees), null, targets?.members.orEmpty().filter { it.id !in assignees }.map { it.id to it.name }, !deciding && targets != null) { assignees = assignees + it }
            } }
        }
        GProperty(stringResource(R.string.gt_due)) {
            TextButton(onClick = {
                val date = due?.let { runCatching { LocalDate.parse(it) }.getOrNull() } ?: LocalDate.now()
                DatePickerDialog(context, { _, y, m, d -> due = LocalDate.of(y, m + 1, d).toString() }, date.year, date.monthValue - 1, date.dayOfMonth).show()
            }, enabled = !deciding) { Text(due ?: stringResource(R.string.gt_no_due)) }
            if (due != null) IconButton(onClick = { due = null }, enabled = !deciding) { Icon(Icons.Outlined.Close, stringResource(R.string.cancel)) }
        }
        if (project == null) Text(stringResource(R.string.gt_pick_project_hint), color = c.mutedFg, fontSize = 12.sp)
        p.diff.filter { it.field == "Calendar" }.forEach { row -> GProperty(fieldLabel("Calendar")) { Text(fieldLabel(row.toText.orEmpty()), color = c.mutedFg, fontSize = 12.sp) } }
        if (failed) Text(stringResource(R.string.gt_no_project_access), color = c.dangerText, fontSize = 12.sp)
        p.error?.let { Text(it, color = c.dangerText, fontSize = 12.sp) }
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.End)) {
            NxButton(stringResource(R.string.gx_discard), { onDecide(GDecision(p, false)) }, kind = NxButtonKind.GHOST, enabled = !deciding, compact = true)
            NxButton(stringResource(R.string.gx_apply), { project?.let { onDecide(GDecision(p, true, task = GTaskChoice(it, section, assignees, due))) } }, kind = NxButtonKind.PRIMARY, enabled = !deciding && project != null && targets != null && !failed, compact = true)
        }
    }
}

private fun actionResources(action: String?, apply: Boolean, done: Boolean): Pair<Int, Int> = when (action) {
    "set_my_status" -> R.string.prs_card_title to (if (apply) R.string.prs_card_apply else if (done) R.string.prs_card_done else R.string.prs_card_title)
    "send_message" -> R.string.gt_send_message_title to (if (apply) R.string.gt_send_message_apply else if (done) R.string.gt_send_message_done else R.string.gt_send_message_title)
    "create_reminder" -> R.string.gt_create_reminder_title to (if (apply) R.string.gt_create_reminder_apply else if (done) R.string.gt_create_reminder_done else R.string.gt_create_reminder_title)
    "cancel_reminder" -> R.string.gt_cancel_reminder_title to (if (apply) R.string.gt_cancel_reminder_apply else if (done) R.string.gt_cancel_reminder_done else R.string.gt_cancel_reminder_title)
    "submit_leave_request" -> R.string.gt_submit_leave_request_title to (if (apply) R.string.gt_submit_leave_request_apply else if (done) R.string.gt_submit_leave_request_done else R.string.gt_submit_leave_request_title)
    "decide_attendance_request" -> R.string.gt_decide_attendance_request_title to (if (apply) R.string.gt_decide_attendance_request_apply else if (done) R.string.gt_decide_attendance_request_done else R.string.gt_decide_attendance_request_title)
    "bulk_update_tasks" -> R.string.gt_bulk_update_tasks_title to (if (apply) R.string.gt_bulk_update_tasks_apply else if (done) R.string.gt_bulk_update_tasks_done else R.string.gt_bulk_update_tasks_title)
    "add_subtasks" -> R.string.gt_add_subtasks_title to (if (apply) R.string.gt_add_subtasks_apply else if (done) R.string.gt_add_subtasks_done else R.string.gt_add_subtasks_title)
    "move_deal_stage" -> R.string.gt_move_deal_stage_title to (if (apply) R.string.gt_move_deal_stage_apply else if (done) R.string.gt_move_deal_stage_done else R.string.gt_move_deal_stage_title)
    "add_payment_term" -> R.string.gt_add_payment_term_title to (if (apply) R.string.gt_add_payment_term_apply else if (done) R.string.gt_add_payment_term_done else R.string.gt_add_payment_term_title)
    "log_outlet_sales" -> R.string.gt_log_outlet_sales_title to (if (apply) R.string.gt_log_outlet_sales_apply else if (done) R.string.gt_log_outlet_sales_done else R.string.gt_log_outlet_sales_title)
    "log_social_media_day" -> R.string.gt_log_social_media_day_title to (if (apply) R.string.gt_log_social_media_day_apply else if (done) R.string.gt_log_social_media_day_done else R.string.gt_log_social_media_day_title)
    "create_legal_draft" -> R.string.gt_create_legal_draft_title to (if (apply) R.string.gt_create_legal_draft_apply else if (done) R.string.gt_create_legal_draft_done else R.string.gt_create_legal_draft_title)
    "create_vault_share_link" -> R.string.gt_create_vault_share_link_title to (if (apply) R.string.gt_create_vault_share_link_apply else if (done) R.string.gt_create_vault_share_link_done else R.string.gt_create_vault_share_link_title)
    "draft_announcement" -> R.string.gt_draft_announcement_title to (if (apply) R.string.gt_draft_announcement_apply else if (done) R.string.gt_draft_announcement_done else R.string.gt_draft_announcement_title)
    "edit_doc" -> R.string.gt_edit_doc_title to (if (apply) R.string.gt_edit_doc_apply else if (done) R.string.gt_edit_doc_done else R.string.gt_edit_doc_title)
    "edit_sheet_cells" -> R.string.gt_edit_sheet_cells_title to (if (apply) R.string.gt_edit_sheet_cells_apply else if (done) R.string.gt_edit_sheet_cells_done else R.string.gt_edit_sheet_cells_title)
    "create_sheet" -> R.string.gt_create_sheet_title to (if (apply) R.string.gt_create_sheet_apply else if (done) R.string.gt_create_sheet_done else R.string.gt_create_sheet_title)
    "save_file_to_vault" -> R.string.gt_save_file_to_vault_title to (if (apply) R.string.gt_save_file_to_vault_apply else if (done) R.string.gt_save_file_to_vault_done else R.string.gt_save_file_to_vault_title)
    "delete_task" -> R.string.gt_delete_task_title to (if (apply) R.string.gt_delete_task_apply else if (done) R.string.gt_delete_task_done else R.string.gt_delete_task_title)
    else -> R.string.gx_change_default to R.string.gx_apply
}
private fun fieldResource(field: String): Int? = when (field) {
    "From" -> R.string.prs_from
    "To" -> R.string.gt_wire_0
    "Recipient" -> R.string.gt_wire_1
    "Approver" -> R.string.gt_wire_2
    "Chat" -> R.string.gt_wire_3
    "Message" -> R.string.gt_wire_4
    "When" -> R.string.gt_wire_5
    "Reminder" -> R.string.gt_wire_6
    "Type" -> R.string.gt_wire_7
    "Dates" -> R.string.gt_wire_8
    "Days" -> R.string.gt_wire_9
    "Reason" -> R.string.gt_wire_10
    "Balance" -> R.string.gt_wire_11
    "Person" -> R.string.gt_wire_12
    "Decision" -> R.string.gt_wire_13
    "Note" -> R.string.gt_wire_14
    "Tasks" -> R.string.gt_wire_15
    "Change" -> R.string.gt_wire_16
    "Deal" -> R.string.gt_wire_17
    "Stage" -> R.string.gt_wire_18
    "Amount" -> R.string.gt_wire_19
    "Due" -> R.string.gt_wire_20
    "Project" -> R.string.gt_wire_21
    "Date" -> R.string.gt_wire_22
    "Sales" -> R.string.gt_wire_23
    "Pax" -> R.string.gt_wire_24
    "Views" -> R.string.gt_wire_25
    "Likes" -> R.string.gt_wire_26
    "Comments" -> R.string.gt_wire_27
    "Shares" -> R.string.gt_wire_28
    "Template" -> R.string.gt_wire_29
    "Company" -> R.string.gt_wire_30
    "Number" -> R.string.gt_wire_31
    "File" -> R.string.gt_wire_32
    "Expires" -> R.string.gt_wire_33
    "Access" -> R.string.gt_wire_34
    "Doc" -> R.string.gt_wire_35
    "Section" -> R.string.gt_wire_36
    "Edit" -> R.string.gt_wire_37
    "Title" -> R.string.gt_wire_38
    "Audience" -> R.string.gt_wire_39
    "Until" -> R.string.gt_wire_40
    "Task" -> R.string.gt_wire_41
    "Subtasks" -> R.string.gt_wire_42
    "Platform" -> R.string.gt_wire_43
    "Label" -> R.string.gt_wire_44
    "Fields" -> R.string.gt_wire_45
    "Password" -> R.string.gt_wire_46
    "Counterparty" -> R.string.gt_wire_47
    "Location" -> R.string.gt_wire_48
    "Download" -> R.string.gt_wire_49
    "Tone" -> R.string.gt_wire_50
    "Repeats" -> R.string.gt_wire_51
    "Announcement" -> R.string.gt_wire_52
    "Folder" -> R.string.gt_wire_53
    "Status" -> R.string.gt_wire_54
    "Probability" -> R.string.gt_wire_55
    "Term" -> R.string.gt_wire_56
    "Terms" -> R.string.gt_wire_57
    "Invoice" -> R.string.gt_wire_58
    "Paid" -> R.string.gt_wire_59
    "Contract value" -> R.string.gt_wire_60
    "Event" -> R.string.gt_wire_61
    "What worked" -> R.string.gt_wire_62
    "What didn't" -> R.string.gt_wire_63
    "Posts" -> R.string.gt_wire_64
    "Direct message" -> R.string.gt_wire_65
    "New direct message" -> R.string.gt_wire_66
    "Group" -> R.string.gt_wire_67
    "Project room" -> R.string.gt_wire_68
    "Approve" -> R.string.gt_wire_69
    "Reject" -> R.string.gt_wire_70
    "Annual leave" -> R.string.gt_wire_71
    "Day off" -> R.string.gt_wire_72
    "Sick" -> R.string.gt_wire_73
    "Permission (izin)" -> R.string.gt_wire_74
    "Public holiday" -> R.string.gt_wire_75
    "Add a section" -> R.string.gt_wire_76
    "Anyone with the link" -> R.string.gt_wire_77
    "No expiry" -> R.string.gt_wire_78
    "Replace section" -> R.string.gt_wire_79
    "Append to the end" -> R.string.gt_wire_80
    "Append under section" -> R.string.gt_wire_81
    "Everyone" -> R.string.gt_wire_82
    "Attached — open the request to see it" -> R.string.gt_wire_83
    "Draft" -> R.string.gt_wire_84
    "NEXUS members (login required)" -> R.string.gt_wire_85
    "3 days" -> R.string.gt_wire_86
    "7 days" -> R.string.gt_wire_87
    "14 days" -> R.string.gt_wire_88
    "30 days" -> R.string.gt_wire_89
    "Allowed" -> R.string.gt_wire_90
    "View only" -> R.string.gt_wire_91
    "Info" -> R.string.gt_wire_92
    "Good news" -> R.string.gt_wire_93
    "Important" -> R.string.gt_wire_94
    "Shows on the calendar (it has a PIC and a date)" -> R.string.gt_wire_95
    else -> null
}
