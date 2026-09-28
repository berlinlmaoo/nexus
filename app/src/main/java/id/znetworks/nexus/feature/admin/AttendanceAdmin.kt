package id.znetworks.nexus.feature.admin

import android.content.Intent
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowLeft
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.LocationOn
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TimePicker
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.material3.rememberTimePickerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.FileProvider
import id.znetworks.nexus.NexusApplication
import id.znetworks.nexus.R
import id.znetworks.nexus.core.net.ApiError
import id.znetworks.nexus.core.time.OfficeTime
import id.znetworks.nexus.feature.projects.Pill
import id.znetworks.nexus.feature.projects.TabEmpty
import id.znetworks.nexus.ui.components.Avatar
import id.znetworks.nexus.ui.components.describe
import id.znetworks.nexus.ui.theme.DisplayFont
import id.znetworks.nexus.ui.theme.Nx
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import java.io.File
import java.time.DayOfWeek
import java.time.Instant
import java.time.LocalDate
import java.time.YearMonth
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.time.format.TextStyle
import java.util.Locale

@Composable
private fun attApi(): AttendanceAdminApi {
    val c = (LocalContext.current.applicationContext as NexusApplication).container
    return remember { AttendanceAdminApi(c.api) }
}

@Composable
private fun MonthBar(label: String, onPrev: () -> Unit, onNext: () -> Unit) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        IconButton(onClick = onPrev) { Icon(Icons.AutoMirrored.Filled.KeyboardArrowLeft, null) }
        Text(label, fontWeight = FontWeight.Bold, fontSize = 15.sp, color = Nx.colors.foreground, modifier = Modifier.weight(1f), textAlign = TextAlign.Center)
        IconButton(onClick = onNext) { Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, null) }
    }
}

private fun monthLabel(ym: YearMonth) = DateTimeFormatter.ofPattern("MMMM yyyy", Locale.getDefault()).format(ym).replaceFirstChar(Char::titlecase)

/** Control Room › Absensi (BoD / One Above All): public holidays + allowance, members, offices, reflections. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AttendanceAdminTab(isBoD: Boolean, onOpenMember: (String) -> Unit, onOpenOffices: () -> Unit) {
    val c = Nx.colors
    if (!isBoD) { TabEmpty(Icons.Filled.Lock, stringResource(R.string.aa_bod_only)); return }
    val api = attApi()
    val admin = adminApi()
    val res = LocalContext.current.resources
    val scope = rememberCoroutineScope()
    var offset by rememberSaveable { mutableIntStateOf(0) }
    val month = YearMonth.from(OfficeTime.today()).plusMonths(offset.toLong())
    var hol by remember { mutableStateOf<Holidays?>(null) }
    var quota by remember { mutableStateOf<Int?>(null) }
    var quotaDraft by remember { mutableStateOf("") }
    var roster by remember { mutableStateOf<WsRoster?>(null) }
    var notice by remember { mutableStateOf<String?>(null) }
    var adding by remember { mutableStateOf(false) }
    var tick by remember { mutableIntStateOf(0) }
    LaunchedEffect(month, tick) {
        hol = runCatching { api.holidays(month.toString()) }.getOrNull()
        quota = runCatching { api.redQuota(month.toString()).quota }.getOrNull(); quotaDraft = quota?.toString().orEmpty()
    }
    LaunchedEffect(Unit) { roster = runCatching { admin.roster(includeRegistered = false) }.getOrNull() }
    fun run(block: suspend () -> Unit) = scope.launch { try { block(); tick++ } catch (e: ApiError) { notice = (e as? ApiError.Http)?.serverMessage ?: e.describe(res) } }
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        MonthBar(monthLabel(month), { offset-- }, { offset++ })
        AdminCard(stringResource(R.string.aa_public_holidays)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(stringResource(R.string.aa_allowance), fontSize = 13.sp, color = c.foreground, modifier = Modifier.weight(1f))
                OutlinedTextField(quotaDraft, { quotaDraft = it.filter(Char::isDigit).take(2) }, singleLine = true, modifier = Modifier.width(80.dp),
                    keyboardOptions = KeyboardOptions(imeAction = androidx.compose.ui.text.input.ImeAction.Done, keyboardType = KeyboardType.Number))
                TextButton(onClick = { quotaDraft.toIntOrNull()?.takeIf { it in 0..31 }?.let { q -> run { api.setRedQuota(month.toString(), q) } } },
                    enabled = quotaDraft.toIntOrNull() != quota && quotaDraft.toIntOrNull() in 0..31) { Text(stringResource(R.string.save)) }
            }
            if (quota == 0) Text(stringResource(R.string.aa_allowance_zero), fontSize = 11.sp, color = c.warning)
            HorizontalDivider(color = c.border)
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(stringResource(R.string.aa_holidays), fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = c.foreground, modifier = Modifier.weight(1f))
                TextButton(onClick = { adding = true }) { Text(stringResource(R.string.add)) }
            }
            val h = hol?.holidays.orEmpty()
            if (h.isEmpty()) Text(stringResource(R.string.aa_no_holidays), fontSize = 12.sp, color = c.mutedFg)
            h.sortedBy { it.date }.forEach { x ->
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(x.date, fontSize = 12.sp, fontWeight = FontWeight.Bold, color = c.danger, modifier = Modifier.width(96.dp))
                    Text(x.name, fontSize = 13.sp, color = c.foreground, modifier = Modifier.weight(1f))
                    IconButton(onClick = { run { api.deleteHoliday(x.id) } }) { Icon(Icons.Filled.Close, stringResource(R.string.delete), tint = c.mutedFg) }
                }
            }
        }
        OutlinedButton(onClick = onOpenOffices, modifier = Modifier.fillMaxWidth()) {
            Icon(Icons.Filled.LocationOn, null, Modifier.size(16.dp)); Spacer(Modifier.width(6.dp)); Text(stringResource(R.string.aa_offices))
        }
        AdminCard(stringResource(R.string.aa_members)) {
            val members = roster?.members.orEmpty().sortedBy { it.displayName.lowercase() }
            if (roster == null) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
            members.forEach { m ->
                Row(Modifier.fillMaxWidth().clickable { onOpenMember(m.userId) }.padding(vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                    Avatar(m.name, m.avatar, 28.dp); Spacer(Modifier.width(8.dp))
                    Column(Modifier.weight(1f)) {
                        Text(m.displayName, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = c.foreground)
                        Text(listOfNotNull(m.attendanceShiftStartTime?.let { "$it–${m.attendanceShiftEndTime}" },
                            m.attendanceShiftByDay?.takeIf { it.isNotEmpty() }?.let { stringResource(R.string.aa_custom_days, it.size) },
                            if (m.flexiTimeEnabled) "Flexi" else null, if (m.noGeofenceMode) stringResource(R.string.location_free) else null).joinToString(" · "),
                            fontSize = 11.sp, color = c.mutedFg)
                    }
                    Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, null, tint = c.mutedFg)
                }
            }
        }
    }
    if (adding) {
        var name by rememberSaveable { mutableStateOf("") }
        val st = rememberDatePickerState(initialSelectedDateMillis = month.atDay(1).atStartOfDay().toInstant(ZoneOffset.UTC).toEpochMilli())
        DatePickerDialog(onDismissRequest = { adding = false }, confirmButton = {
            TextButton(onClick = {
                st.selectedDateMillis?.let { ms -> val d = Instant.ofEpochMilli(ms).atZone(ZoneOffset.UTC).toLocalDate(); run { api.addHoliday(d.toString(), name) } }
                adding = false
            }, enabled = name.isNotBlank()) { Text(stringResource(R.string.save)) }
        }, dismissButton = { TextButton(onClick = { adding = false }) { Text(stringResource(R.string.cancel)) } }) {
            Column {
                DatePicker(st)
                OutlinedTextField(name, { name = it }, singleLine = true, placeholder = { Text(stringResource(R.string.aa_holiday_name)) }, modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp), keyboardOptions = AdminKeyboard.Done)
            }
        }
    }
    notice?.let { AlertDialog(onDismissRequest = { notice = null }, text = { Text(it) }, confirmButton = { TextButton(onClick = { notice = null }) { Text("OK") } }) }
}

/** One member's attendance settings: day-off allowance and grants (period), per-day shift, export, reflections. */
@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
fun MemberAttendanceAdminScreen(userId: String, onBack: () -> Unit, onOpenReflections: (String) -> Unit) {
    val api = attApi(); val admin = adminApi()
    val c = Nx.colors
    val context = LocalContext.current
    val res = context.resources
    val scope = rememberCoroutineScope()
    var roster by remember { mutableStateOf<WsRoster?>(null) }
    var offset by rememberSaveable { mutableIntStateOf(0) }
    val period = YearMonth.parse(OfficeTime.periodKey(OfficeTime.today())).plusMonths(offset.toLong()).toString()
    var d by remember { mutableStateOf<DayOffs?>(null) }
    var quotaDraft by remember { mutableStateOf("") }
    var granting by remember { mutableStateOf(false) }
    var dayEdit by remember { mutableStateOf<Int?>(null) }
    var notice by remember { mutableStateOf<String?>(null) }
    var exporting by remember { mutableStateOf(false) }
    var tick by remember { mutableIntStateOf(0) }
    LaunchedEffect(tick) { roster = runCatching { admin.roster(includeRegistered = false) }.getOrNull() }
    LaunchedEffect(period, tick) { d = runCatching { api.dayoffs(userId, period) }.getOrNull(); quotaDraft = d?.quotaOverride?.toString().orEmpty() }
    val m = roster?.members?.firstOrNull { it.userId == userId }; val ws = roster?.workspaceId
    fun run(block: suspend () -> Unit) = scope.launch { try { block(); tick++ } catch (e: ApiError) { notice = (e as? ApiError.Http)?.serverMessage ?: e.describe(res) } }
    Column(Modifier.fillMaxSize().background(c.background).dismissKeyboardOnTapOrDrag()) {
        Row(Modifier.fillMaxWidth().padding(4.dp), verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, stringResource(R.string.back)) }
            Text(m?.displayName ?: "", fontFamily = DisplayFont, fontWeight = FontWeight.Bold, fontSize = 18.sp, color = c.foreground, modifier = Modifier.weight(1f))
        }
        Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            MonthBar(stringResource(R.string.aa_period, period), { offset-- }, { offset++ })
            AdminCard(stringResource(R.string.aa_dayoff)) {
                d?.let { x ->
                    Text(stringResource(R.string.aa_dayoff_line, x.used, x.quota) + if (x.quotaOverride != null) " · " + stringResource(R.string.aa_override) else "", fontSize = 13.sp, color = c.foreground)
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        OutlinedTextField(quotaDraft, { quotaDraft = it.filter(Char::isDigit).take(3) }, singleLine = true, placeholder = { Text("${x.defaultQuota}") },
                            label = { Text(stringResource(R.string.aa_quota_override)) }, keyboardOptions = KeyboardOptions(imeAction = androidx.compose.ui.text.input.ImeAction.Done, keyboardType = KeyboardType.Number), modifier = Modifier.weight(1f))
                        TextButton(onClick = { run { api.setDayoffQuota(userId, quotaDraft.toIntOrNull()) } }) { Text(stringResource(if (quotaDraft.isBlank()) R.string.aa_reset else R.string.save)) }
                    }
                    x.dayoffs.forEach { r ->
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text(r.startDate?.take(10) ?: "—", fontSize = 12.sp, fontWeight = FontWeight.Bold, color = c.foreground, modifier = Modifier.width(96.dp))
                            Text(r.reason.orEmpty(), fontSize = 12.sp, color = c.mutedFg, modifier = Modifier.weight(1f))
                            Pill(r.status.orEmpty(), if (r.status == "APPROVED") c.success else c.warning)
                            IconButton(onClick = { run { api.deleteDayoff(r.id) } }) { Icon(Icons.Filled.Close, stringResource(R.string.delete), tint = c.mutedFg) }
                        }
                    }
                    TextButton(onClick = { granting = true }) { Text(stringResource(R.string.aa_grant)) }
                } ?: CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
            }
            if (m != null && ws != null) AdminCard(stringResource(R.string.aa_shift_by_day)) {
                Text(stringResource(R.string.aa_default_hours, m.attendanceShiftStartTime?.let { "$it–${m.attendanceShiftEndTime}" } ?: stringResource(R.string.ad_follows_team)), fontSize = 12.sp, color = c.mutedFg)
                DayOfWeek.entries.forEach { day ->
                    val v = m.attendanceShiftByDay?.get(day.value.toString())
                    Row(Modifier.fillMaxWidth().clickable { dayEdit = day.value }.padding(vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                        Text(day.getDisplayName(TextStyle.FULL, Locale.getDefault()), fontSize = 13.sp, color = c.foreground, modifier = Modifier.weight(1f))
                        Text(v?.let { "${it.start}–${it.end}" } ?: if (day.value in m.restDays) stringResource(R.string.ad_rest_days) else "—", fontSize = 13.sp,
                            fontWeight = if (v != null) FontWeight.Bold else FontWeight.Normal, color = if (v != null) c.violetText else c.mutedFg)
                    }
                }
            }
            OutlinedButton(onClick = {
                exporting = true
                scope.launch {
                    try {
                        val bytes = api.exportXlsx(period, userId)
                        val f = File(File(context.cacheDir, "shared").apply { mkdirs() }, "absensi-${(m?.displayName ?: userId).replace(Regex("[^A-Za-z0-9]+"), "-").lowercase()}-$period.xlsx").apply { writeBytes(bytes) }
                        val uri = FileProvider.getUriForFile(context, "${context.packageName}.files", f)
                        context.startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).setType("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
                            .putExtra(Intent.EXTRA_STREAM, uri).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION), null).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                    } catch (e: ApiError) { notice = e.describe(res) }
                    exporting = false
                }
            }, enabled = !exporting, modifier = Modifier.fillMaxWidth()) { Text(stringResource(R.string.aa_export)) }
            OutlinedButton(onClick = { onOpenReflections(userId) }, modifier = Modifier.fillMaxWidth()) { Text(stringResource(R.string.aa_reflections)) }
        }
    }
    if (granting) {
        var reason by rememberSaveable { mutableStateOf("") }
        val st = rememberDatePickerState(initialSelectedDateMillis = OfficeTime.today().atStartOfDay().toInstant(ZoneOffset.UTC).toEpochMilli())
        DatePickerDialog(onDismissRequest = { granting = false }, confirmButton = {
            TextButton(onClick = {
                st.selectedDateMillis?.let { ms -> val day = Instant.ofEpochMilli(ms).atZone(ZoneOffset.UTC).toLocalDate(); run { api.grantDayoff(userId, day.toString(), reason) } }
                granting = false
            }) { Text(stringResource(R.string.aa_grant)) }
        }, dismissButton = { TextButton(onClick = { granting = false }) { Text(stringResource(R.string.cancel)) } }) {
            Column { DatePicker(st); OutlinedTextField(reason, { reason = it }, singleLine = true, placeholder = { Text(stringResource(R.string.tk_reason)) }, modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp), keyboardOptions = AdminKeyboard.Done) }
        }
    }
    val md = m; val wsid = ws
    dayEdit?.let { day ->
        if (md == null || wsid == null) return@let
        DayShiftDialog(md.attendanceShiftByDay?.get(day.toString()), onDismiss = { dayEdit = null }) { start, end ->
            dayEdit = null
            // The whole map is replaced: send every day with this one changed.
            val map = (md.attendanceShiftByDay.orEmpty() - day.toString()).toMutableMap()
            if (start != null && end != null) map[day.toString()] = ShiftDay(start, end)
            val json: JsonElement = if (map.isEmpty()) JsonNull else JsonObject(map.mapValues { (_, v) -> JsonObject(mapOf("start" to JsonPrimitive(v.start), "end" to JsonPrimitive(v.end))) })
            run { admin.patchMember(md.id, wsid, mapOf("attendanceShiftByDay" to json)) }
        }
    }
    notice?.let { AlertDialog(onDismissRequest = { notice = null }, text = { Text(it) }, confirmButton = { TextButton(onClick = { notice = null }) { Text("OK") } }) }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun DayShiftDialog(current: ShiftDay?, onDismiss: () -> Unit, onSave: (String?, String?) -> Unit) {
    var start by remember { mutableStateOf(current?.start ?: "09:00") }
    var end by remember { mutableStateOf(current?.end ?: "18:00") }
    var editing by remember { mutableStateOf<String?>(null) }
    AlertDialog(onDismissRequest = onDismiss, title = { Text(stringResource(R.string.aa_shift_by_day)) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedButton(onClick = { editing = "s" }, modifier = Modifier.weight(1f)) { Text(start) }
                    OutlinedButton(onClick = { editing = "e" }, modifier = Modifier.weight(1f)) { Text(end) }
                }
                TextButton(onClick = { onSave(null, null) }) { Text(stringResource(R.string.aa_use_default)) }
            }
        },
        confirmButton = { TextButton(onClick = { onSave(start, end) }, enabled = ShiftRules.pairOk(start, end)) { Text(stringResource(R.string.save)) } },
        dismissButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.cancel)) } })
    editing?.let { w ->
        val cur = if (w == "s") start else end
        val st = rememberTimePickerState(cur.substringBefore(':').toInt(), cur.substringAfter(':').toInt(), is24Hour = true)
        AlertDialog(onDismissRequest = { editing = null }, text = { TimePicker(st) }, confirmButton = {
            TextButton(onClick = { val v = "%02d:%02d".format(st.hour, st.minute); if (w == "s") start = v else end = v; editing = null }) { Text("OK") }
        })
    }
}

/** Offices: list, active toggle, edit, add at my position, archive. */
@Composable
fun OfficesScreen(onBack: () -> Unit) {
    val api = attApi()
    val c = Nx.colors
    val context = LocalContext.current
    val res = context.resources
    val scope = rememberCoroutineScope()
    var data by remember { mutableStateOf<Offices?>(null) }
    var editing by remember { mutableStateOf<Office?>(null) }
    var creating by remember { mutableStateOf(false) }
    var notice by remember { mutableStateOf<String?>(null) }
    var tick by remember { mutableIntStateOf(0) }
    LaunchedEffect(tick) { data = runCatching { api.offices() }.getOrNull() }
    fun run(block: suspend () -> Unit) = scope.launch { try { block(); tick++ } catch (e: ApiError) { notice = (e as? ApiError.Http)?.serverMessage ?: e.describe(res) } }
    Column(Modifier.fillMaxSize().background(c.background).dismissKeyboardOnTapOrDrag()) {
        Row(Modifier.fillMaxWidth().padding(4.dp), verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, stringResource(R.string.back)) }
            Text(stringResource(R.string.aa_offices), fontFamily = DisplayFont, fontWeight = FontWeight.Bold, fontSize = 18.sp, color = c.foreground, modifier = Modifier.weight(1f))
            if (data?.canManage == true) TextButton(onClick = { creating = true }) { Text(stringResource(R.string.add)) }
        }
        val d = data
        if (d == null) { Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }; return@Column }
        Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            if (d.offices.isEmpty()) Text(stringResource(R.string.aa_no_offices), fontSize = 13.sp, color = c.mutedFg)
            d.offices.forEach { o ->
                AdminCard {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f).clickable(enabled = d.canManage) { editing = o }) {
                            Text(o.name, fontSize = 14.sp, fontWeight = FontWeight.Bold, color = c.foreground)
                            Text(listOfNotNull(o.address, "${o.radiusMeters} m", stringResource(R.string.aa_grace, o.lateGraceMinutes)).joinToString(" · "), fontSize = 11.sp, color = c.mutedFg)
                        }
                        if (d.canManage) Switch(o.isActive, { on -> run { api.updateOffice(o.id, mapOf("isActive" to JsonPrimitive(on))) } })
                    }
                }
            }
        }
    }
    if (editing != null || creating) OfficeDialog(editing, onDismiss = { editing = null; creating = false }, onDelete = editing?.let { o -> { editing = null; run { api.deleteOffice(o.id) } } }) { f ->
        val o = editing; editing = null; creating = false
        run { if (o == null) api.createOffice(f) else api.updateOffice(o.id, f) }
    }
    notice?.let { AlertDialog(onDismissRequest = { notice = null }, text = { Text(it) }, confirmButton = { TextButton(onClick = { notice = null }) { Text("OK") } }) }
}

@Composable
private fun OfficeDialog(o: Office?, onDismiss: () -> Unit, onDelete: (() -> Unit)?, onSave: (Map<String, JsonElement>) -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var name by rememberSaveable { mutableStateOf(o?.name.orEmpty()) }
    var address by rememberSaveable { mutableStateOf(o?.address.orEmpty()) }
    var lat by rememberSaveable { mutableStateOf(o?.latitude?.toString().orEmpty()) }
    var lng by rememberSaveable { mutableStateOf(o?.longitude?.toString().orEmpty()) }
    var radius by rememberSaveable { mutableStateOf((o?.radiusMeters ?: 100).toString()) }
    var grace by rememberSaveable { mutableStateOf((o?.lateGraceMinutes ?: 0).toString()) }
    var locating by remember { mutableStateOf(false) }
    val ok = name.isNotBlank() && lat.toDoubleOrNull() != null && lng.toDoubleOrNull() != null && radius.toIntOrNull() in 10..5000 && grace.toIntOrNull() in 0..180
    AlertDialog(onDismissRequest = onDismiss, title = { Text(stringResource(if (o == null) R.string.aa_new_office else R.string.aa_edit_office)) },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                OutlinedTextField(name, { name = it.take(120) }, singleLine = true, label = { Text(stringResource(R.string.signup_name)) }, keyboardOptions = AdminKeyboard.Done)
                OutlinedTextField(address, { address = it.take(300) }, label = { Text(stringResource(R.string.aa_address)) }, keyboardOptions = AdminKeyboard.Done)
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    OutlinedTextField(lat, { lat = it }, singleLine = true, label = { Text("Lat") }, modifier = Modifier.weight(1f), keyboardOptions = AdminKeyboard.Done)
                    OutlinedTextField(lng, { lng = it }, singleLine = true, label = { Text("Lng") }, modifier = Modifier.weight(1f), keyboardOptions = AdminKeyboard.Done)
                }
                TextButton(onClick = {
                    locating = true
                    scope.launch {
                        runCatching { (context.applicationContext as NexusApplication).container.location.currentFix() }.onSuccess { f -> lat = "%.6f".format(Locale.US, f.lat); lng = "%.6f".format(Locale.US, f.lng) }
                        locating = false
                    }
                }, enabled = !locating) { Text(stringResource(if (locating) R.string.btn_locating else R.string.aa_use_my_location)) }
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    OutlinedTextField(radius, { radius = it.filter(Char::isDigit).take(4) }, singleLine = true, label = { Text(stringResource(R.string.aa_radius)) }, modifier = Modifier.weight(1f), keyboardOptions = AdminKeyboard.Done)
                    OutlinedTextField(grace, { grace = it.filter(Char::isDigit).take(3) }, singleLine = true, label = { Text(stringResource(R.string.aa_late_grace)) }, modifier = Modifier.weight(1f), keyboardOptions = AdminKeyboard.Done)
                }
                onDelete?.let { TextButton(onClick = it) { Text(stringResource(R.string.aa_archive), color = Nx.colors.danger) } }
            }
        },
        confirmButton = { TextButton(onClick = {
            onSave(buildMap {
                put("name", JsonPrimitive(name.trim())); put("address", if (address.isBlank()) JsonNull else JsonPrimitive(address.trim()))
                put("latitude", JsonPrimitive(lat.toDouble())); put("longitude", JsonPrimitive(lng.toDouble()))
                put("radiusMeters", JsonPrimitive(radius.toInt())); put("lateGraceMinutes", JsonPrimitive(grace.toInt()))
            })
        }, enabled = ok) { Text(stringResource(R.string.save)) } },
        dismissButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.cancel)) } })
}

/** Somebody's daily reflections for a calendar month, with GIDEON's day and month summaries. */
@Composable
fun ReflectionsScreen(userId: String?, onBack: () -> Unit) {
    val api = attApi()
    val c = Nx.colors
    val res = LocalContext.current.resources
    val scope = rememberCoroutineScope()
    var offset by rememberSaveable { mutableIntStateOf(0) }
    val month = YearMonth.from(OfficeTime.today()).plusMonths(offset.toLong())
    var data by remember { mutableStateOf<Reflections?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var summarizing by remember { mutableStateOf(false) }
    var notice by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(month) { data = null; try { data = api.reflections(userId, month.toString()); error = null } catch (e: ApiError) { error = e.describe(res) } }
    Column(Modifier.fillMaxSize().background(c.background).dismissKeyboardOnTapOrDrag()) {
        Row(Modifier.fillMaxWidth().padding(4.dp), verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, stringResource(R.string.back)) }
            Text(stringResource(R.string.aa_reflections), fontFamily = DisplayFont, fontWeight = FontWeight.Bold, fontSize = 18.sp, color = c.foreground)
        }
        MonthBar(monthLabel(month), { offset-- }, { offset++ })
        val d = data
        when {
            d == null && error == null -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
            d == null -> TabEmpty(Icons.Filled.Lock, error!!)
            else -> Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                AdminCard("GIDEON") {
                    Text(d.monthly?.summary ?: stringResource(R.string.aa_no_summary), fontSize = 13.sp, color = if (d.monthly == null) c.mutedFg else c.foreground)
                    TextButton(onClick = {
                        summarizing = true
                        scope.launch {
                            // Slow; a 503 is GIDEON's own sentence (not an outage), shown as is.
                            try { val s = api.summarize(userId, month.toString(), force = d.monthly != null); data = d.copy(monthly = MonthlySummary(s.summary, s.sourceDays)) }
                            catch (e: ApiError) { notice = (e as? ApiError.Http)?.serverMessage ?: e.describe(res) }
                            summarizing = false
                        }
                    }, enabled = !summarizing && d.days.isNotEmpty()) { Text(stringResource(if (summarizing) R.string.aa_summarizing else R.string.aa_summarize)) }
                }
                if (d.days.isEmpty()) Text(stringResource(R.string.aa_no_reflections), fontSize = 13.sp, color = c.mutedFg)
                d.days.sortedByDescending { it.date }.forEach { r ->
                    AdminCard {
                        Text(runCatching { DateTimeFormatter.ofPattern("EEEE, d MMM", Locale.getDefault()).format(LocalDate.parse(r.date)) }.getOrDefault(r.date), fontSize = 12.sp, fontWeight = FontWeight.Bold, color = c.mutedFg)
                        Text(r.reflection, fontSize = 14.sp, color = c.foreground)
                        r.summary?.let { Text("GIDEON: $it", fontSize = 12.sp, color = c.violetText) }
                    }
                }
            }
        }
    }
    notice?.let { AlertDialog(onDismissRequest = { notice = null }, text = { Text(it) }, confirmButton = { TextButton(onClick = { notice = null }) { Text("OK") } }) }
}
