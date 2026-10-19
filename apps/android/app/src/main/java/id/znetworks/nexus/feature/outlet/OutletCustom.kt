package id.znetworks.nexus.feature.outlet

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import id.znetworks.nexus.R
import id.znetworks.nexus.feature.social.*
import kotlinx.serialization.json.*

/** Server config drives fields, including archived items only when this event holds a value. */
fun OutletMonth.reportForm(event: OutletEvent?, archivedLabel: String, totalOnlyLabel: String): OutletForm {
    val config = raw.objectAt("config")
    if (config.isEmpty()) return form
    fun field(item: JsonObject, title: String? = null): OutletField? {
        val id = item.text("id")
        if (item.flag("archived") && event?.number("value:$id") == null) return null
        val name = (title ?: item.text("label")) + if (item.flag("archived")) " · " + archivedLabel else ""
        return OutletField("value:$id", "count", OutletText(name, name), false, 1_000_000.0, null)
    }
    val sections = form.sections.filter { it.key !in setOf("rsvp", "hosting") }.toMutableList()
    val custom = mutableListOf<OutletSection>()
    listOf("rsvp", "hosting").forEach { group ->
        val title = if (group == "rsvp") "RSVP" else "Hosting"
        custom += OutletSection(group, OutletText(title, title), if (group == "rsvp") "rsvpTotal" else "hostingTotal", config.rows(group).mapNotNull { field(it) })
    }
    config.rows("communities").forEach { community ->
        val id = community.text("id")
        val fields = mutableListOf<OutletField>()
        val own = event?.number("value:$id")
        if (community.text("mode") == "total" || own != null) field(community, totalOnlyLabel)?.let(fields::add)
        community.rows("items").forEach { field(it)?.let(fields::add) }
        if ((!community.flag("archived") || fields.any { event?.number(it.key) != null }) && fields.isNotEmpty()) {
            val title = community.text("name") + if (community.flag("archived")) " · " + archivedLabel else ""
            custom += OutletSection("community:$id", OutletText(title, title), "community:$id", fields)
        }
    }
    sections.addAll((sections.indexOfFirst { it.key == "pax" } + 1).coerceAtLeast(0), custom)
    return OutletForm(sections)
}

@Composable
internal fun OutletMonth.currentReportForm(event: OutletEvent?) = reportForm(event, stringResource(R.string.sm_archived), stringResource(R.string.oc_total_only))

/** Dynamic item ids travel inside `values`; legacy event keys keep their original wire shape. */
fun outletValues(body: JsonObject): JsonObject = buildJsonObject {
    body.filterKeys { !it.startsWith("value:") }.forEach { (k, v) -> put(k, v) }
    val values = body.filterKeys { it.startsWith("value:") }.mapKeys { it.key.removePrefix("value:") }
    if (values.isNotEmpty()) put("values", JsonObject(values))
}

@Composable
internal fun OutletGuests(d: OutletMonth, fill: () -> Unit, settings: () -> Unit) {
    val guests = d.raw.objectAt("guests")
    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(stringResource(R.string.oc_guests, OutletFormat.monthLabel(d.month)), style = MaterialTheme.typography.titleMedium)
            if ((guests.number("reportCount") ?: 0.0) == 0.0) {
                Text(stringResource(R.string.oc_guests_empty))
                TextButton(onClick = fill) { Text(stringResource(R.string.os_fill_report)) }
                if (d.raw.flag("canManageSettings")) TextButton(onClick = settings) { Text(stringResource(R.string.oc_settings)) }
            } else listOf("rsvp" to "RSVP", "hosting" to "Hosting", "communities" to stringResource(R.string.oc_communities)).forEach { (key, title) ->
                val group = guests.objectAt(key)
                Text("$title: ${OutletFormat.count(group.number("total"))}")
                group.rows("items").forEach { item ->
                    GuestLine(item, group.number("total"))
                    var expanded by remember(item.text("id")) { mutableStateOf(false) }
                    if (item.rows("items").isNotEmpty()) {
                        TextButton(onClick = { expanded = !expanded }) { Text(stringResource(if (expanded) R.string.oc_hide_breakdown else R.string.oc_breakdown)) }
                        if (expanded) item.rows("items").forEach { GuestLine(it, item.number("total")) }
                    }
                }
            }
        }
    }
}

@Composable
private fun GuestLine(item: JsonObject, total: Double?) {
    val label = item.text("label").ifEmpty { item.text("name") } + if (item.flag("archived")) " · " + stringResource(R.string.sm_archived) else ""
    Text("$label: ${OutletFormat.count(item.number("total"))}")
    val share = if (total != null && total > 0) ((item.number("total") ?: 0.0) / total).toFloat().coerceIn(0f, 1f) else 0f
    LinearProgressIndicator(progress = { share }, modifier = Modifier.fillMaxWidth().height(3.dp))
}

@Composable
internal fun OutletDayTargets(d: OutletMonth, date: String, vm: OutletViewModel) {
    val day = d.raw.rows("days").firstOrNull { it.text("date") == date } ?: return
    var editing by remember(date) { mutableStateOf(false) }
    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(stringResource(R.string.oc_day_target), style = MaterialTheme.typography.titleMedium)
            listOf("sales" to R.string.oc_sales, "pax" to R.string.oc_pax).forEach { (key, label) ->
                Text("${stringResource(label)}: ${OutletFormat.vsTarget(day.number(key), day.number(key + "Target"), key == "sales", pct = day.number(key + "Pct")?.toInt())}")
                Text(stringResource(when (day.text(key + "TargetSource")) { "day" -> R.string.sm_own_target; "month" -> R.string.sm_month_share; else -> R.string.sm_no_target }))
                day.number(key + "Pct")?.let { LinearProgressIndicator(progress = { (it / 100).toFloat().coerceIn(0f, 1f) }, modifier = Modifier.fillMaxWidth()) }
            }
            if (d.canManageTargets) TextButton(onClick = { editing = true }) { Text(stringResource(R.string.oc_set_day_target)) }
        }
    }
    if (editing) {
        val original = remember(date) { d.raw.rows("dayTargets").firstOrNull { it.text("date") == date } ?: JsonObject(emptyMap()) }
        var sales by remember(date) { mutableStateOf(original.number("salesTarget")?.toLong()?.toString().orEmpty()) }
        var pax by remember(date) { mutableStateOf(original.number("paxTarget")?.toLong()?.toString().orEmpty()) }
        val s by vm.state.collectAsState()
        AlertDialog(onDismissRequest = { if (!s.busy) editing = false }, title = { Text(stringResource(R.string.oc_day_target)) },
            text = { Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(stringResource(R.string.sm_month_share))
                NumberBox(sales, R.string.oc_sales, !s.busy, 1_000_000_000_000) { sales = it }
                NumberBox(pax, R.string.oc_pax, !s.busy, 1_000_000) { pax = it }
                s.notice?.let { Text(it, color = MaterialTheme.colorScheme.error) }
            } }, confirmButton = { TextButton(enabled = !s.busy && SocialDraft.number(sales, 1_000_000_000_000) != null && SocialDraft.number(pax, 1_000_000) != null, onClick = {
                vm.saveCustom("day-targets", buildJsonObject {
                    put("date", date)
                    val saleValue = SocialDraft.number(sales, 1_000_000_000_000)!!; val paxValue = SocialDraft.number(pax, 1_000_000)!!
                    if (saleValue != (original["salesTarget"] ?: JsonNull)) put("salesTarget", saleValue)
                    if (paxValue != (original["paxTarget"] ?: JsonNull)) put("paxTarget", paxValue)
                }) { editing = false }
            }) { Text(stringResource(R.string.sm_save)) } }, dismissButton = { TextButton(onClick = { editing = false }, enabled = !s.busy) { Text(stringResource(R.string.sm_close)) } })
    }
}
