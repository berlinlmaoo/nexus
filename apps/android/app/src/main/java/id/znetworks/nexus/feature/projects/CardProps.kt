package id.znetworks.nexus.feature.projects

import id.znetworks.nexus.core.i18n.AppDateFormats

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.Comment
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.Checklist
import androidx.compose.material.icons.outlined.Schedule
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import id.znetworks.nexus.R
import id.znetworks.nexus.core.net.NexusJson
import id.znetworks.nexus.ui.components.AvatarStack
import id.znetworks.nexus.ui.theme.Nx
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import java.text.DecimalFormat
import java.text.DecimalFormatSymbols
import java.text.NumberFormat
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.util.Locale

/**
 * The properties a card / row shows, in the view's order (web lib/project-views.ts `visibleProps`, `taskValues` and
 * components/projects/views/view-layouts.tsx `PropValue`). Keys: section, status, priority, assignee, due, start,
 * tags, created, updated, subtasks, comments and `cf:<fieldId>`.
 */
object CardProps {
    val BUILTIN = listOf("section", "status", "priority", "assignee", "due", "start", "tags", "created", "updated", "subtasks", "comments")

    /** Web `defaultVisibleProps`: what a view shows before anyone picks its properties. */
    fun defaults(layout: String, fields: List<CustomFieldDef>): List<String> {
        val cfs = fields.sortedBy { it.position ?: Int.MAX_VALUE }.map { "cf:" + it.id }
        return when (layout) {
            "board" -> listOf("priority", "tags") + cfs + listOf("due", "subtasks", "comments", "assignee")
            // iOS ListPropLine order (the Android reference): the first three fields, due, priority, status, people.
            "list" -> cfs.take(3) + listOf("due", "priority", "status", "assignee")
            "table" -> listOf("assignee", "due", "priority", "status", "tags")
            "gallery" -> listOf("status", "due", "assignee")
            else -> listOf("status", "assignee")
        }
    }

    /**
     * The view's chosen properties (or the defaults) that still exist. With status options "status" means the
     * option (the section): one Status column, not two (web `visibleProps`).
     */
    fun visible(saved: List<String>?, layout: String, fields: List<CustomFieldDef>, statusOptions: Boolean): List<String> {
        var list = saved ?: defaults(layout, fields)
        if (statusOptions) list = list.map { if (it == "status") "section" else it }.distinct()
        val known = BUILTIN.toSet() + fields.map { "cf:" + it.id }
        return list.filter { it in known }
    }

    /** One drawn value. */
    sealed interface Item {
        val key: String
        data class Section(override val key: String, val name: String, val colorKey: String?) : Item
        data class Status(override val key: String, val status: String) : Item
        data class Priority(override val key: String, val priority: String) : Item
        data class People(override val key: String, val people: List<Pair<String?, String?>>, val userIds: List<String?> = emptyList()) : Item
        /** [date] null = a value that isn't a date (a "Request by" name in a CREATED field): shown as written. */
        data class When(override val key: String, val date: LocalDate?, val raw: String, val overdue: Boolean) : Item
        data class Number(override val key: String, val text: String) : Item
        data class Options(override val key: String, val values: List<Pair<String, String>>, val more: Int) : Item
        data class Plain(override val key: String, val text: String) : Item
        data class Files(override val key: String, val count: Int) : Item
        data class Check(override val key: String, val label: String) : Item
        data class Subtasks(override val key: String, val done: Int, val total: Int) : Item
        data class Comments(override val key: String, val count: Int) : Item
    }

    /** The task's values for [keys]; a property it has nothing in is left out (web: PropValue returns null). */
    fun items(t: BoardTask, keys: List<String>, fields: List<CustomFieldDef>, lanes: List<Lane>, people: Map<String, String>, today: LocalDate): List<Item> =
        keys.mapNotNull { item(t, it, fields, lanes, people, today) }

    fun item(t: BoardTask, key: String, fields: List<CustomFieldDef>, lanes: List<Lane>, people: Map<String, String>, today: LocalDate): Item? = when (key) {
        "section" -> lanes.firstOrNull { it.id == (t.taskListId ?: t.taskList?.id) }?.let { l ->
            Item.Section(key, l.name, if (l.taskStatus != null || l.color != null) StatusOptions.colorKey(l.color, l.taskStatus) else null)
        }
        "status" -> {
            // A section that stands for a status is shown as that option; a legacy project shows the five statuses.
            val l = lanes.firstOrNull { it.id == (t.taskListId ?: t.taskList?.id) }
            if (l?.taskStatus != null) Item.Section(key, l.name, StatusOptions.colorKey(l.color, l.taskStatus))
            else Item.Status(key, (t.status ?: "TODO").uppercase())
        }
        "priority" -> t.priority?.uppercase()?.takeIf { it.isNotBlank() && it != "NONE" }?.let { Item.Priority(key, it) }
        "assignee" -> t.assignees.filter { it.user != null }.map { it.user?.name to it.user?.avatar }.takeIf { it.isNotEmpty() }?.let { Item.People(key, it, t.assignees.filter { it.user != null }.map { it.userId ?: it.user?.id }) }
        "due" -> dateItem(key, t.dueDate, overdueCheck = !t.isDone, today = today)
        "start" -> dateItem(key, t.startDate, false, today)
        "created" -> dateItem(key, t.createdAt, false, today)
        "updated" -> dateItem(key, t.updatedAt, false, today)
        "tags" -> t.tags.filter { it.isNotBlank() }.takeIf { it.isNotEmpty() }?.let { tags ->
            Item.Options(key, tags.take(4).map { "#$it" to "gray" }, (tags.size - 4).coerceAtLeast(0))
        }
        "subtasks" -> t.subtasks.takeIf { it.isNotEmpty() }?.let { Item.Subtasks(key, t.doneSubs, it.size) }
        "comments" -> (t.count?.comments ?: 0).takeIf { it > 0 }?.let { Item.Comments(key, it) }
        else -> if (key.startsWith("cf:")) fieldItem(t, key, fields, people, today) else null
    }

    private fun dateItem(key: String, iso: String?, overdueCheck: Boolean, today: LocalDate): Item? {
        val raw = iso?.trim()?.takeIf { it.isNotEmpty() } ?: return null
        val d = dueDate(raw)
        return Item.When(key, d, raw, overdue = key == "due" && overdueCheck && d != null && d.isBefore(today))
    }

    private fun fieldItem(t: BoardTask, key: String, fields: List<CustomFieldDef>, people: Map<String, String>, today: LocalDate): Item? {
        val id = key.removePrefix("cf:")
        val def = fields.firstOrNull { it.id == id }
        val cfv = t.customFieldValues.firstOrNull { it.customFieldId == id } ?: return null
        val type = (def?.type ?: cfv.customField?.type).orEmpty().uppercase()
        val options = def?.options ?: cfv.customField?.options
        val vals = values(cfv.value, type)
        if (vals.isEmpty()) return null
        return when (type) {
            "SELECT", "DROPDOWN", "STATUS", "MULTI_SELECT" -> Item.Options(key, vals.take(3).map { v ->
                v to (def?.let { StatusOptions.optionColor(it, v) } ?: "gray")
            }, (vals.size - 3).coerceAtLeast(0))
            "DATE", "CREATED" -> dateItem(key, vals[0], false, today)
            "NUMBER", "RATING" -> number(vals[0], numberFormat(options))?.let { Item.Number(key, it) }
            "PEOPLE" -> Item.Plain(key, vals.joinToString(", ") { people[it] ?: it })
            "CHECKBOX" -> if (vals[0] == "true") Item.Check(key, def?.name ?: cfv.customField?.name.orEmpty()) else null
            "FILE" -> Item.Files(key, vals.size)
            "URL" -> Item.Plain(key, runCatching { java.net.URI(vals[0]).host?.removePrefix("www.") }.getOrNull() ?: vals[0])
            else -> Item.Plain(key, vals[0])
        }
    }

    /** Web `taskValues` for a field: lists for multi-select / people / files, a place's label, else the text. */
    fun values(v: JsonElement?, type: String): List<String> {
        val parsed = when {
            v is JsonPrimitive && v.isString -> v.content.trim().let { s ->
                if (s.startsWith("[") || s.startsWith("{")) runCatching { NexusJson.parseToJsonElement(s) }.getOrDefault(v) else v
            }
            else -> v
        }
        return when (parsed) {
            null -> emptyList()
            is JsonArray -> parsed.mapNotNull { (it as? JsonPrimitive)?.contentOrNull?.trim()?.takeIf(String::isNotEmpty) }
            is JsonObject -> listOfNotNull((parsed["label"] as? JsonPrimitive)?.contentOrNull?.takeIf { it.isNotBlank() })
            is JsonPrimitive -> {
                val s = parsed.contentOrNull?.trim().orEmpty()
                when {
                    s.isEmpty() -> emptyList()
                    type == "MULTI_SELECT" || type == "PEOPLE" || type == "FILE" -> s.split(',').map { it.trim() }.filter { it.isNotEmpty() }
                    else -> listOf(s)
                }
            }
        }
    }

    private fun numberFormat(options: JsonElement?): String? = ((options as? JsonObject)?.get("format") as? JsonPrimitive)?.contentOrNull

    /** Web `formatNumberProp`: Rupiah fields as "Rp 1.500.000" (a legacy "369.000" is 369 thousand), other numbers grouped. */
    fun number(raw: String, format: String?, locale: Locale = Locale.getDefault()): String? {
        if (format == "currency-idr") {
            val digits = raw.substringBefore(',').filter { it.isDigit() }.trimStart('0').ifEmpty { if (raw.any { it.isDigit() }) "0" else return null }
            val n = digits.toBigInteger()
            val f = DecimalFormat("#,##0", DecimalFormatSymbols(Locale.forLanguageTag("id-ID")))
            return (if (raw.trim().startsWith("-")) "-" else "") + "Rp " + f.format(n)
        }
        val n = raw.replace(Regex("[^\\d.-]+"), "").toDoubleOrNull() ?: return raw.takeIf { it.isNotBlank() }
        return NumberFormat.getNumberInstance(locale).apply { maximumFractionDigits = 2 }.format(n)
    }
}

private val pillShape = RoundedCornerShape(4.dp)

/** The properties of a card, wrapped (web `PropLine`). */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun PropLine(items: List<CardProps.Item>, modifier: Modifier = Modifier) {
    if (items.isEmpty()) return
    FlowRow(modifier, horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(4.dp),
        itemVerticalAlignment = Alignment.CenterVertically) {
        items.forEach { PropValue(it) }
    }
}

/** One property, compact (web `PropValue`): pills for options, plain muted text for numbers, a clock before dates. */
@Composable
fun PropValue(item: CardProps.Item) {
    val c = Nx.colors
    val dark = Nx.isDark
    when (item) {
        is CardProps.Item.Section -> if (item.colorKey != null) {
            val tone = StatusOptions.tone(item.colorKey, dark)
            Row(Modifier.clip(pillShape).background(tone.bg).padding(horizontal = 6.dp, vertical = 2.dp), verticalAlignment = Alignment.CenterVertically) {
                androidx.compose.foundation.layout.Box(Modifier.size(6.dp).background(tone.dot, CircleShape))
                androidx.compose.foundation.layout.Spacer(Modifier.size(4.dp))
                PillText(item.name, tone.fg)
            }
        } else MutedPill(item.name)
        is CardProps.Item.Status -> {
            val tone = taskStatusColor(item.status)
            PillText(taskStatusLabel(item.status), tone, Modifier.clip(pillShape).background(tone.copy(alpha = 0.14f)).padding(horizontal = 6.dp, vertical = 2.dp))
        }
        is CardProps.Item.Priority -> {
            val tone = priorityColor(item.priority)
            PillText(priorityLabel(item.priority), tone, Modifier.clip(CircleShape).background(tone.copy(alpha = 0.14f)).padding(horizontal = 7.dp, vertical = 2.dp))
        }
        is CardProps.Item.People -> AvatarStack(item.people, size = 20.dp, userIds = item.userIds)
        is CardProps.Item.When -> IconText(Icons.Outlined.Schedule, item.date?.let { AppDateFormats.ofPattern("d MMM", Locale.getDefault()).format(it) } ?: item.raw,
            if (item.overdue) c.danger else c.mutedFg, if (item.overdue) FontWeight.Medium else FontWeight.Normal)
        is CardProps.Item.Number -> Text(item.text, fontSize = 12.sp, color = c.mutedFg, maxLines = 1)
        is CardProps.Item.Options -> {
            item.values.forEach { (v, key) ->
                val tone = StatusOptions.tone(key, dark)
                PillText(v, tone.fg, Modifier.clip(pillShape).background(tone.bg).padding(horizontal = 6.dp, vertical = 2.dp))
            }
            if (item.more > 0) MutedPill("+${item.more}")
        }
        is CardProps.Item.Plain -> MutedPill(item.text)
        is CardProps.Item.Files -> MutedPill(pluralStringResource(R.plurals.cp_files, item.count, item.count))
        is CardProps.Item.Check -> Row(Modifier.clip(pillShape).background(c.muted).padding(horizontal = 6.dp, vertical = 2.dp), verticalAlignment = Alignment.CenterVertically) {
            Icon(Icons.Outlined.CheckCircle, null, Modifier.size(12.dp), tint = c.mutedFg); androidx.compose.foundation.layout.Spacer(Modifier.size(3.dp)); PillText(item.label, c.mutedFg)
        }
        is CardProps.Item.Subtasks -> {
            val all = item.done == item.total
            val fg = if (all) c.success else c.mutedFg
            Row(Modifier.clip(pillShape).background(if (all) c.success.copy(alpha = 0.14f) else c.muted).padding(horizontal = 6.dp, vertical = 2.dp), verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Outlined.Checklist, null, Modifier.size(12.dp), tint = fg); androidx.compose.foundation.layout.Spacer(Modifier.size(3.dp)); PillText("${item.done}/${item.total}", fg)
            }
        }
        is CardProps.Item.Comments -> IconText(Icons.AutoMirrored.Outlined.Comment, item.count.toString(), c.mutedFg, FontWeight.Normal)
    }
}

@Composable
private fun PillText(text: String, color: Color, modifier: Modifier = Modifier) =
    Text(text, modifier.widthIn(max = 180.dp), fontSize = 12.sp, fontWeight = FontWeight.Medium, color = color, maxLines = 1, overflow = TextOverflow.Ellipsis)

@Composable
private fun MutedPill(text: String) = PillText(text, Nx.colors.mutedFg, Modifier.clip(pillShape).background(Nx.colors.muted).padding(horizontal = 6.dp, vertical = 2.dp))

@Composable
private fun IconText(icon: ImageVector, text: String, color: Color, weight: FontWeight) = Row(verticalAlignment = Alignment.CenterVertically) {
    Icon(icon, null, Modifier.size(13.dp), tint = color)
    androidx.compose.foundation.layout.Spacer(Modifier.size(3.dp))
    Text(text, fontSize = 12.sp, color = color, fontWeight = weight, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.widthIn(max = 180.dp))
}

/** The column header of a property (Table). */
@Composable
fun propLabel(key: String, fields: List<CustomFieldDef>, statusOptions: Boolean): String = when (key) {
    "section" -> stringResource(if (statusOptions) R.string.pt_col_status else R.string.pt_col_section)
    "status" -> stringResource(R.string.pt_col_status)
    "priority" -> stringResource(R.string.pt_col_priority)
    "assignee" -> stringResource(R.string.pt_col_assignee)
    "due" -> stringResource(R.string.td_due_date)
    "start" -> stringResource(R.string.td_start_date)
    "tags" -> stringResource(R.string.cp_tags)
    "created" -> stringResource(R.string.cp_created)
    "updated" -> stringResource(R.string.cp_updated)
    "subtasks" -> stringResource(R.string.td_subtasks)
    "comments" -> stringResource(R.string.td_comments)
    else -> fields.firstOrNull { "cf:" + it.id == key }?.name ?: key
}

/** What a view needs to draw its cards' properties: its keys, the project's fields, sections and people. */
data class PropCtx(
    val keys: List<String>,
    val fields: List<CustomFieldDef> = emptyList(),
    val lanes: List<Lane> = emptyList(),
    /** userId → name, for PEOPLE fields. */
    val people: Map<String, String> = emptyMap(),
    val today: LocalDate = LocalDate.now(),
    /** The project being viewed: a task from another project says "From …". */
    val projectId: String? = null,
) {
    fun items(t: BoardTask) = CardProps.items(t, keys, fields, lanes, people, today)
}
