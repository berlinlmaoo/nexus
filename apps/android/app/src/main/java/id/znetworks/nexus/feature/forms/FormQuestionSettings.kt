package id.znetworks.nexus.feature.forms

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.ArrowForward
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.AttachFile
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.KeyboardArrowUp
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material.icons.outlined.ContentCopy
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.ErrorOutline
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import id.znetworks.nexus.R
import id.znetworks.nexus.feature.projects.CustomFieldDef
import id.znetworks.nexus.ui.theme.Nx
import id.znetworks.nexus.ui.theme.TextFont

/**
 * Everything about one question (iOS FormFieldEditorView pushed, the web's QuestionPanel): type, the toggles, its
 * options, logic, where the answer goes, routing, a preview, and moving / duplicating / deleting it. Edits go straight
 * into the studio's draft (by id, so a question moved meanwhile stays the same one), which saves itself.
 */
@Composable
fun FormQuestionSettings(
    field: BuilderField, index: Int, total: Int, allFields: List<BuilderField>,
    sections: List<Named>, members: List<Named>, customFields: List<CustomFieldDef>,
    onChange: (BuilderField) -> Unit, onMove: (Int) -> Unit, onDuplicate: () -> Unit, onDelete: () -> Unit, onClose: () -> Unit,
    editors: List<FormEditorPresence> = emptyList(),
) {
    val c = Nx.colors
    val f = field
    val others = allFields.filter { it.id != f.id }
    Dialog(onDismissRequest = onClose, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        BackHandler(onBack = onClose)
        Column(Modifier.fillMaxSize().background(c.background).imePadding()) {
            Row(Modifier.fillMaxWidth().padding(start = 4.dp, end = 8.dp, top = 6.dp, bottom = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                IconButton(onClick = onClose) { Icon(Icons.AutoMirrored.Filled.ArrowBack, stringResource(R.string.back), tint = c.foreground) }
                Text(f.displayName.ifEmpty { stringResource(R.string.fs_untitled_question) }, fontFamily = TextFont, fontWeight = FontWeight.SemiBold,
                    fontSize = 17.sp, color = c.foreground, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                TextButton(onClick = onClose) { Text(stringResource(R.string.fb_done), fontWeight = FontWeight.SemiBold, color = c.foreground) }
            }
            Box(Modifier.fillMaxWidth().height(1.dp).background(c.border))
            FormQuestionEditors(editors)
            Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).background(c.muted.copy(alpha = 0.25f)).padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(16.dp)) {
                BasicsCard(f, index, onChange)
                TogglesCard(f, onChange)
                if (f.hasOptions) OptionsCard(f, onChange)
                LogicCard(f, allFields, others, onChange)
                MappingCard(f, sections, customFields, onChange)
                RoutingCard(f, sections, members, customFields, onChange)
                StudioCard(stringResource(R.string.fb_preview)) { QuestionPreview(f) }
                StudioCard(stringResource(R.string.fs_question), hint = stringResource(R.string.fs_saves_itself)) {
                    StudioAction(stringResource(R.string.fs_move_up), Icons.Filled.KeyboardArrowUp, enabled = index > 0) { onMove(-1) }
                    StudioAction(stringResource(R.string.fs_move_down), Icons.Filled.KeyboardArrowDown, enabled = index < total - 1) { onMove(1) }
                    StudioAction(stringResource(R.string.fs_duplicate), Icons.Outlined.ContentCopy, onClick = onDuplicate)
                    StudioAction(stringResource(R.string.fs_delete_question), Icons.Outlined.Delete, danger = true, onClick = onDelete)
                }
            }
        }
    }
}

@Composable
private fun BasicsCard(f: BuilderField, index: Int, onChange: (BuilderField) -> Unit) {
    StudioCard(stringResource(R.string.fs_question_n, index + 1)) {
        StudioInput(stringResource(R.string.fs_question), f.name, { onChange(f.named(it.replace("\n", " "))) }, stringResource(R.string.fs_untitled_question), singleLine = false)
        val kind = f.questionKind
        StudioPick(stringResource(R.string.fb_type), stringResource(kind.label), FormQuestionKind.entries.map { it to stringResource(it.label) }) {
            if (it != kind) onChange(f.withKind(it))
        }
    }
}

@Composable
private fun TogglesCard(f: BuilderField, onChange: (BuilderField) -> Unit) {
    StudioCard(stringResource(R.string.fs_options)) {
        StudioSwitch(stringResource(R.string.fb_required), on = f.required) { onChange(f.copy(required = it)) }
        StudioSwitch(stringResource(R.string.fs_description), stringResource(R.string.fs_description_sub), f.description != null) {
            onChange(f.copy(description = if (it) f.description.orEmpty() else null))
        }
        f.description?.let { d ->
            StudioInput(null, d, { onChange(f.copy(description = it)) }, stringResource(R.string.fs_description_opt), singleLine = false)
        }
        if (f.type == "dropdown") StudioSwitch(stringResource(R.string.fs_as_list), stringResource(R.string.fs_as_list_sub), f.display == "list") {
            onChange(f.copy(display = if (it) "list" else ""))
        }
        if (f.type == "number") StudioSwitch(stringResource(R.string.fs_k_rupiah), "Rp 1.500.000", f.questionKind == FormQuestionKind.RUPIAH) {
            onChange(f.withKind(if (it) FormQuestionKind.RUPIAH else FormQuestionKind.NUMBER))
        }
        if (f.type == "text" || f.type == "email") {
            val opts = listOf("" to stringResource(R.string.fs_off), "name" to stringResource(R.string.fs_name), "email" to stringResource(R.string.fb_t_email))
            StudioPick(stringResource(R.string.fs_autofill), opts.firstOrNull { it.first == f.autofill }?.second ?: f.autofill, opts) { onChange(f.copy(autofill = it)) }
        }
        if (f.type != "file") StudioSwitch(stringResource(R.string.fs_allow_file), on = f.attachmentEnabled) { onChange(f.copy(attachmentEnabled = it)) }
        if (f.autofill.isNotEmpty()) StudioNote(stringResource(R.string.fs_autofill_note))
    }
}

@Composable
private fun OptionsCard(f: BuilderField, onChange: (BuilderField) -> Unit) {
    val c = Nx.colors
    StudioCard(stringResource(R.string.fs_answer_options), hint = stringResource(R.string.fs_blank_dropped)) {
        f.options.forEachIndexed { k, o ->
            Row(verticalAlignment = Alignment.CenterVertically) {
                StudioInput(null, o, { v -> onChange(f.copy(options = f.options.toMutableList().also { it[k] = v })) },
                    stringResource(R.string.fb_option_n, k + 1), modifier = Modifier.weight(1f))
                IconButton(onClick = { onChange(f.copy(options = f.options.toMutableList().also { val t = it[k]; it[k] = it[k - 1]; it[k - 1] = t })) }, enabled = k > 0) {
                    Icon(Icons.Filled.KeyboardArrowUp, stringResource(R.string.fs_move_up), tint = c.mutedFg.copy(alpha = if (k > 0) 1f else 0.3f))
                }
                IconButton(onClick = { onChange(f.copy(options = f.options.filterIndexed { j, _ -> j != k })) }) {
                    Icon(Icons.Outlined.Delete, stringResource(R.string.fs_delete_option), tint = c.dangerText)
                }
            }
        }
        StudioAction(stringResource(R.string.fb_add_option), Icons.Filled.Add, accent = true) { onChange(f.copy(options = f.options + "")) }
    }
}

@Composable
private fun LogicCard(f: BuilderField, allFields: List<BuilderField>, others: List<BuilderField>, onChange: (BuilderField) -> Unit) {
    val parents = FormStudioLogic.logicParents(allFields, f.id)
    val cond = f.showIf
    StudioCard(stringResource(R.string.fs_logic),
        hint = stringResource(if (parents.isEmpty() && cond == null) R.string.fs_add_other_first else R.string.fs_logic_footer)) {
        StudioSwitch(stringResource(R.string.fs_show_when), on = cond != null, enabled = cond != null || parents.isNotEmpty()) { on ->
            if (!on) onChange(f.copy(showIf = null))
            else FormStudioLogic.defaultParent(allFields, f.id)?.let { p -> onChange(f.copy(showIf = BuilderCondition(p.id, "equals", ""))) }
        }
        if (cond != null) {
            val parent = others.firstOrNull { it.id == cond.fieldId }
            // A parent outside the allowed list (a loop) is still listed, so it can be seen and changed.
            val choices = (parents + listOfNotNull(parent?.takeIf { p -> parents.none { it.id == p.id } })).map { it.id to it.displayName.ifEmpty { "—" } }
            StudioPick(stringResource(R.string.fs_question),
                parent?.displayName?.ifEmpty { "—" } ?: stringResource(if (parents.isEmpty()) R.string.fs_no_other_questions else R.string.fs_choose_question), choices) { id ->
                // Another question: the old value was one of the previous question's options.
                onChange(f.copy(showIf = cond.copy(fieldId = id, value = "")))
            }
            StudioPick(stringResource(R.string.fs_condition), operatorLabel(cond.op), FormVocab.OPERATORS.map { it.first to stringResource(it.second) }) { op ->
                onChange(f.copy(showIf = cond.copy(op = op, value = if (FormVocab.needsValue(op)) cond.value else "")))
            }
            if (FormVocab.needsValue(cond.op)) {
                val opts = parent?.options?.map { it.trim() }?.filter { it.isNotEmpty() }.orEmpty()
                if (opts.isEmpty()) StudioInput(stringResource(R.string.fb_value), cond.value, { onChange(f.copy(showIf = cond.copy(value = it))) }, "")
                else StudioPick(stringResource(R.string.fb_value), cond.value.ifEmpty { "—" },
                    listOf("" to "—") + opts.map { it to it } + listOfNotNull(cond.value.takeIf { it.isNotEmpty() && it !in opts }?.let { it to it })) {
                    onChange(f.copy(showIf = cond.copy(value = it)))
                }
            }
            if (FormVocab.needsValue(cond.op) && cond.value.isBlank()) StudioNote(stringResource(R.string.fs_pick_value))
            if (parent != null && FormStudioLogic.staleOption(parent, cond.op, cond.value))
                StudioNote(stringResource(R.string.fs_cond_stale, cond.value), warn = true, icon = Icons.Outlined.ErrorOutline)
            if (parent != null && parents.none { it.id == parent.id })
                StudioNote(stringResource(R.string.fs_cond_loop, parent.displayName), warn = true, icon = Icons.Outlined.ErrorOutline)
        }
    }
}

@Composable
private fun MappingCard(f: BuilderField, sections: List<Named>, customFields: List<CustomFieldDef>, onChange: (BuilderField) -> Unit) {
    val c = Nx.colors
    val sectionNames = sections.map { it.name }
    // Answers go to the category field; its options replace section names (or nothing).
    fun sendTo(cat: CustomFieldDef) = onChange(f.copy(mappingTarget = "custom_field", mappingCustomFieldId = cat.id,
        options = if (FormCategory.shouldAdopt(f.options, sectionNames, cat.choices)) cat.choices else f.options))
    StudioCard(stringResource(R.string.fs_answer_goes), hint = stringResource(R.string.fs_answer_footer)) {
        val targets = FormVocab.MAPPING.map { it.first to stringResource(it.second) } +
            listOfNotNull(f.mappingTarget.takeIf { t -> FormVocab.MAPPING.none { it.first == t } }?.let { it to it })
        StudioPick(null, targets.firstOrNull { it.first == f.mappingTarget }?.second ?: f.mappingTarget, targets) { t ->
            onChange(f.copy(mappingTarget = t, mappingCustomFieldId = if (t == "custom_field") f.mappingCustomFieldId else ""))
        }
        when (f.mappingTarget) {
            "custom_field" -> {
                val current = customFields.firstOrNull { it.id == f.mappingCustomFieldId }
                StudioPick(stringResource(R.string.fs_field), current?.name
                    ?: stringResource(if (f.mappingCustomFieldId.isNotEmpty()) R.string.fb_gone_custom else R.string.fb_choose_custom),
                    customFields.map { it.id to it.name }) { id ->
                    // Choosing a SELECT field adopts its options when the question only had section names or none.
                    val target = customFields.firstOrNull { it.id == id }
                    onChange(f.copy(mappingCustomFieldId = id, options = if (f.hasOptions && target != null && FormCategory.isSelect(target) &&
                        FormCategory.shouldAdopt(f.options, sectionNames, target.choices)) target.choices else f.options))
                }
                // A select field: its options, answers that aren't among them, and "Use these N options".
                val choices = current?.choices?.map { it.trim() }?.filter { it.isNotEmpty() }.orEmpty()
                if (current != null && FormCategory.isSelect(current) && f.hasOptions && choices.isNotEmpty()) {
                    StudioNote(stringResource(R.string.fc_options_of, current.name, choices.joinToString(", ")))
                    val extra = FormCategory.extraOptions(f.options, choices)
                    if (extra.isNotEmpty()) StudioNote(stringResource(R.string.fc_not_option, current.name, extra.joinToString(", ")), warn = true)
                    if (!FormCategory.sameOptions(f.options, choices) && f.type != "multi_select")
                        StudioAction(pluralStringResource(R.plurals.fc_use_options, choices.size, choices.size), Icons.Outlined.ContentCopy, accent = true) {
                            onChange(f.copy(options = choices))
                        }
                }
            }
            "task_list" -> {
                // Options that are categories, while sections are statuses now (web 13 Oct): one tap moves it.
                val cat = FormCategory.fieldForSectionQuestion(f.type, f.mappingTarget, f.options, customFields, sectionNames)
                if (cat != null) {
                    StudioNote(stringResource(R.string.fc_are_categories, cat.name), warn = true)
                    StudioAction(stringResource(R.string.fc_send_to, cat.name), Icons.AutoMirrored.Filled.ArrowForward, accent = true) { sendTo(cat) }
                } else {
                    StudioNote(stringResource(R.string.fb_map_list_sub))
                    val projectCat = FormCategory.projectField(customFields)
                    if (projectCat != null && f.hasOptions && f.type != "multi_select") {
                        StudioNote(stringResource(R.string.fc_sections_are_statuses, projectCat.name))
                        StudioAction(stringResource(R.string.fc_send_to, projectCat.name), Icons.AutoMirrored.Filled.ArrowForward, accent = true) { sendTo(projectCat) }
                    }
                    if (sections.isEmpty()) StudioNote(stringResource(R.string.fb_no_sections), warn = true, icon = Icons.Filled.Warning)
                    else if (f.hasOptions && f.type != "multi_select")
                        StudioAction(stringResource(R.string.fb_use_sections, sections.size), Icons.Outlined.ContentCopy, accent = true) {
                            onChange(f.copy(options = sectionNames))
                        }
                }
            }
        }
    }
}

@Composable
private fun RoutingCard(f: BuilderField, sections: List<Named>, members: List<Named>, customFields: List<CustomFieldDef>, onChange: (BuilderField) -> Unit) {
    val c = Nx.colors
    val own = f.options.map { it.trim() }.filter { it.isNotEmpty() }
    val settable = FormStudioLogic.settableFields(customFields)
    StudioCard(stringResource(R.string.fb_routing), hint = if (f.rules.isEmpty()) stringResource(R.string.fs_routing_empty) else null) {
        f.rules.forEachIndexed { k, r ->
            fun put(nr: BuilderRule) = onChange(f.copy(rules = f.rules.map { if (it.id == r.id) nr else it }))
            Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp)).background(c.muted.copy(alpha = 0.45f)).padding(12.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Text(stringResource(R.string.fb_rule_n, k + 1).uppercase(), fontSize = 11.sp, fontWeight = FontWeight.SemiBold, color = c.mutedFg)
                StudioPick(stringResource(R.string.fb_if_answer), operatorLabel(r.op), FormVocab.OPERATORS.map { it.first to stringResource(it.second) }) { op ->
                    put(r.copy(op = op, value = if (FormVocab.needsValue(op)) r.value else ""))
                }
                if (FormVocab.needsValue(r.op)) {
                    if (own.isEmpty()) StudioInput(stringResource(R.string.fb_value), r.value, { put(r.copy(value = it)) }, "")
                    else StudioPick(stringResource(R.string.fb_value), r.value.ifEmpty { "—" },
                        listOf("" to "—") + own.map { it to it } + listOfNotNull(r.value.takeIf { it.isNotEmpty() && it !in own }?.let { it to it })) { put(r.copy(value = it)) }
                }
                if (FormStudioLogic.staleOption(f, r.op, r.value)) StudioNote(stringResource(R.string.fs_rule_value_stale, r.value), warn = true, icon = Icons.Outlined.ErrorOutline)
                val actions = FormVocab.ACTIONS.map { it.first to stringResource(it.second) } +
                    listOfNotNull(r.action.takeIf { a -> FormVocab.ACTIONS.none { it.first == a } }?.let { it to it })
                StudioPick(stringResource(R.string.fb_then), actions.firstOrNull { it.first == r.action }?.second ?: r.action, actions) { put(r.copy(action = it)) }
                when (r.action) {
                    "set_task_list" -> StudioPick(stringResource(R.string.fs_section), sections.firstOrNull { it.id == r.targetTaskListId }?.name
                        ?: stringResource(if (r.targetTaskListId.isNotEmpty()) R.string.fb_gone_section else R.string.fb_choose_section),
                        sections.map { it.id to it.name }) { put(r.copy(targetTaskListId = it)) }
                    "set_field" -> {
                        val target = settable.firstOrNull { it.id == r.targetCustomFieldId }
                        // Another field: the value picked for the previous one no longer applies.
                        StudioPick(stringResource(R.string.fs_field), target?.name
                            ?: stringResource(if (r.targetCustomFieldId.isNotEmpty()) R.string.fb_gone_custom else R.string.fb_choose_field),
                            settable.map { it.id to it.name }) { put(r.copy(targetCustomFieldId = it, targetValue = "")) }
                        if (target != null) {
                            val choices = target.choices
                            if (choices.isEmpty()) StudioInput(stringResource(R.string.fb_value), r.targetValue, { put(r.copy(targetValue = it)) }, "")
                            else StudioPick(stringResource(R.string.fb_value), r.targetValue.ifEmpty { "—" },
                                listOf("" to "—") + choices.map { it to it } + listOfNotNull(r.targetValue.takeIf { it.isNotEmpty() && it !in choices }?.let { it to it })) {
                                put(r.copy(targetValue = it))
                            }
                        }
                    }
                    else -> StudioPick(stringResource(R.string.fs_member), members.firstOrNull { it.id == r.targetUserId }?.name
                        ?: stringResource(if (r.targetUserId.isNotEmpty()) R.string.fb_gone_member else R.string.fb_choose_member),
                        members.map { it.id to it.name }) { put(r.copy(targetUserId = it)) }
                }
                StudioAction(stringResource(R.string.fb_delete_rule), Icons.Outlined.Delete, danger = true) { onChange(f.copy(rules = f.rules.filter { it.id != r.id })) }
            }
        }
        StudioAction(stringResource(R.string.fb_add_rule), Icons.Filled.Add, accent = true) { onChange(f.copy(rules = f.rules + BuilderRule.fresh())) }
    }
}

/** How the question will look on the form, drawn (not interactive). */
@Composable
internal fun QuestionPreview(f: BuilderField) {
    val c = Nx.colors
    Column(verticalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.semantics(mergeDescendants = true) {}) {
        if (f.type != "checkbox") Row {
            Text(f.displayName.ifEmpty { stringResource(R.string.fs_untitled_question) }, fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = c.foreground)
            if (f.required) Text(" *", fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = c.dangerText)
        }
        when {
            f.hasOptions -> {
                val list = f.options.map { it.trim() }.filter { it.isNotEmpty() }
                list.ifEmpty { listOf(stringResource(R.string.fb_option_n, 1)) }.forEach { o ->
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Box(Modifier.size(16.dp).border(1.dp, c.mutedFg.copy(alpha = 0.5f), if (f.type == "multi_select") RoundedCornerShape(4.dp) else CircleShape))
                        Text(o, fontSize = 15.sp, color = if (list.isEmpty()) c.mutedFg else c.foreground, modifier = Modifier.padding(start = 10.dp))
                    }
                }
            }
            f.type == "checkbox" -> Row(verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.size(18.dp).border(1.dp, c.mutedFg.copy(alpha = 0.5f), RoundedCornerShape(4.dp)))
                Text(f.displayName.ifEmpty { stringResource(R.string.fs_checkbox) }, fontSize = 15.sp, color = c.foreground, modifier = Modifier.padding(start = 10.dp))
                if (f.required) Text(" *", fontSize = 15.sp, color = c.dangerText)
            }
            else -> CanvasControl(f)
        }
        if (f.attachmentEnabled && f.type != "file") Row(verticalAlignment = Alignment.CenterVertically) {
            Icon(Icons.Filled.AttachFile, null, tint = c.mutedFg, modifier = Modifier.size(14.dp))
            Text(stringResource(R.string.fs_attach_optional), fontSize = 13.sp, color = c.mutedFg, modifier = Modifier.padding(start = 5.dp))
        }
    }
}
