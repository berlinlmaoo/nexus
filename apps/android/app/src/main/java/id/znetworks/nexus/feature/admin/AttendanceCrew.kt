package id.znetworks.nexus.feature.admin

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import id.znetworks.nexus.R
import id.znetworks.nexus.core.net.ApiError
import id.znetworks.nexus.core.time.OfficeTime
import id.znetworks.nexus.feature.outlet.OutletFormat
import id.znetworks.nexus.feature.social.*
import id.znetworks.nexus.ui.components.describe
import kotlinx.coroutines.launch
import kotlinx.serialization.json.*
import java.time.LocalDate
import java.time.ZoneOffset

/** Board-only crew tools; eligibility, periods and deductions are always read from the server. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun AttendanceCrew(api: AttendanceAdminApi, month: String, employment: Boolean, names: Map<String, String> = emptyMap(), close: () -> Unit) {
    val res = LocalContext.current.resources
    val scope = rememberCoroutineScope()
    var people by remember { mutableStateOf<List<JsonObject>>(emptyList()) }
    var summary by remember(month) { mutableStateOf<JsonObject?>(null) }
    var detail by remember(month) { mutableStateOf<JsonObject?>(null) }
    var user by remember { mutableStateOf<JsonObject?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var loading by remember { mutableStateOf(true) }
    var busy by remember { mutableStateOf(false) }
    var retry by remember { mutableIntStateOf(0) }
    var editing by remember { mutableStateOf<JsonObject?>(null) }
    var clear by remember { mutableStateOf<JsonObject?>(null) }
    var search by remember { mutableStateOf("") }
    LaunchedEffect(month, retry) {
        loading = true
        try {
            people = api.employment().rows("members")
            if (!employment) summary = api.deductions(month)
            error = null
        } catch (e: ApiError) { error = e.describe(res) }
        loading = false
    }
    LaunchedEffect(user, retry) {
        val selected = user ?: return@LaunchedEffect
        detail = null
        try { detail = api.deductions(month, selected.text("userId")); error = null }
        catch (e: ApiError) { error = e.describe(res) }
    }
    Dialog(onDismissRequest = { if (!busy) close() }, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Surface(Modifier.fillMaxWidth().fillMaxHeight(0.94f)) {
            Column(Modifier.dismissKeyboardOnTapOrDrag().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text(stringResource(if (employment) R.string.crew_employment else R.string.crew_deductions), style = MaterialTheme.typography.titleLarge)
                Text(month)
                if (!employment && user == null) AttendanceBulkTools(api) { retry++ }
                error?.let { Text(it, color = MaterialTheme.colorScheme.error); TextButton(onClick = { retry++ }) { Text(stringResource(R.string.try_again)) } }
                if (loading) CircularProgressIndicator()
                if (user != null && !employment) {
                    Text(user!!.text("name").ifEmpty { user!!.text("userId") }, style = MaterialTheme.typography.titleMedium)
                    TextButton(onClick = { user = null; detail = null }, enabled = !busy) { Text(stringResource(R.string.crew_all_people)) }
                    val entries = detail?.rows("entries").orEmpty()
                    if (detail != null && entries.isEmpty()) Text(stringResource(R.string.crew_no_deductions))
                    entries.forEach { entry ->
                        Card(Modifier.fillMaxWidth()) {
                            Column(Modifier.padding(12.dp)) {
                                Text(OutletFormat.shortDay(entry.text("dateKey"), OfficeTime.today().year))
                                Text(stringResource(when (entry.text("kind")) {
                                    "XP_LATE" -> R.string.crew_late; "XP_NOCHECKOUT" -> R.string.crew_no_checkout
                                    "XP_ALPHA" -> R.string.crew_absent; else -> R.string.crew_auto_dayoff
                                }))
                                Text("${entry.number("amount")?.toInt() ?: 0} ${if (entry.text("unit") == "XP") "XP" else stringResource(R.string.crew_days)}")
                                entry.text("detail").takeIf { it.isNotBlank() }?.let { Text(it) }
                                if (entry.flag("cleared")) Text(stringResource(R.string.crew_cleared))
                                else TextButton(onClick = { clear = entry }, enabled = !busy) { Text(stringResource(R.string.crew_clear)) }
                            }
                        }
                    }
                } else {
                    OutlinedTextField(search, { search = it }, label = { Text(stringResource(R.string.crew_search)) }, keyboardOptions = AdminKeyboard.Done, modifier = Modifier.fillMaxWidth())
                    val known = people.associateBy { it.text("userId") }
                    val rows = if (employment) people else summary?.rows("members").orEmpty()
                    rows.filter { row -> (known[row.text("userId")]?.text("name").orEmpty() + names[row.text("userId")].orEmpty() + row.text("userId")).contains(search, true) }.forEach { row ->
                        val person = known[row.text("userId")] ?: JsonObject(row + ("name" to JsonPrimitive(names[row.text("userId")].orEmpty())))
                        Card(Modifier.fillMaxWidth()) {
                            Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                                Text(person.text("name").ifEmpty { person.text("email").ifEmpty { row.text("userId") } })
                                if (employment) {
                                    Text(person.text("employmentStartDate").take(10).ifEmpty { stringResource(R.string.crew_no_start) })
                                    Text(when { person.flag("eligible") -> stringResource(R.string.crew_eligible)
                                        person.text("eligibleFrom").isNotEmpty() -> stringResource(R.string.crew_eligible_from, person.text("eligibleFrom").take(10))
                                        else -> stringResource(R.string.crew_ineligible) })
                                    TextButton(onClick = { editing = person }, enabled = !busy) { Text(stringResource(R.string.crew_set_start)) }
                                } else {
                                    Text(stringResource(R.string.crew_remaining, row.number("remaining")?.toInt() ?: 0, row.number("quota")?.toInt() ?: 0))
                                    Text(stringResource(R.string.crew_red_remaining, row.objectAt("redDate").number("remaining")?.toInt() ?: 0))
                                    Text("XP: ${row.objectAt("xp").number("score")?.toInt() ?: 0}")
                                    if (row.text("leftAt").isNotEmpty()) Text(stringResource(R.string.crew_left, row.text("leftAt")))
                                    TextButton(onClick = { user = person }, enabled = !busy) { Text(stringResource(R.string.crew_view_log)) }
                                }
                            }
                        }
                    }
                }
                TextButton(onClick = close, enabled = !busy) { Text(stringResource(R.string.sm_close)) }
            }
        }
    }
    editing?.let { person ->
        val start = rememberDatePickerState(initialSelectedDateMillis = runCatching { LocalDate.parse(person.text("employmentStartDate").take(10)).atStartOfDay().toInstant(ZoneOffset.UTC).toEpochMilli() }.getOrNull(),
            selectableDates = object : SelectableDates { override fun isSelectableDate(utcTimeMillis: Long) = utcTimeMillis <= OfficeTime.today().atStartOfDay().toInstant(ZoneOffset.UTC).toEpochMilli() })
        fun save(date: String?) { scope.launch {
            busy = true
            try { api.setEmployment(person.text("userId"), date); editing = null; retry++ }
            catch (e: ApiError) { error = e.describe(res) }
            busy = false
        } }
        DatePickerDialog(onDismissRequest = { if (!busy) editing = null }, confirmButton = {
            TextButton(onClick = { start.selectedDateMillis?.let { save(java.time.Instant.ofEpochMilli(it).atZone(ZoneOffset.UTC).toLocalDate().toString()) } }, enabled = !busy && start.selectedDateMillis != null) { Text(stringResource(R.string.sm_save)) }
        }, dismissButton = { Row {
            TextButton(onClick = { save(null) }, enabled = !busy) { Text(stringResource(R.string.crew_clear_date)) }
            TextButton(onClick = { editing = null }, enabled = !busy) { Text(stringResource(R.string.cancel)) }
        } }) { Column { DatePicker(start); error?.let { Text(it, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(16.dp)) } } }
    }
    clear?.let { entry ->
        AlertDialog(onDismissRequest = { if (!busy) clear = null }, title = { Text(stringResource(R.string.crew_clear_confirm, entry.text("dateKey"))) },
            text = { Column { Text(stringResource(R.string.crew_clear_help)); error?.let { Text(it, color = MaterialTheme.colorScheme.error) } } },
            confirmButton = { TextButton(onClick = { scope.launch {
                busy = true
                try { api.clearDeduction(user!!.text("userId"), entry.text("dateKey")); clear = null; retry++ }
                catch (e: ApiError) { error = e.describe(res) }
                busy = false
            } }, enabled = !busy) { Text(stringResource(R.string.crew_clear)) } }, dismissButton = { TextButton(onClick = { clear = null }, enabled = !busy) { Text(stringResource(R.string.cancel)) } })
    }
}
