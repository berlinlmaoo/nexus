package id.znetworks.nexus.feature.social

import android.app.Application
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.clickable
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Flag
import androidx.compose.material.icons.outlined.Notes
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import id.znetworks.nexus.NexusApplication
import id.znetworks.nexus.R
import id.znetworks.nexus.core.net.ApiError
import id.znetworks.nexus.core.realtime.LiveRefresh
import id.znetworks.nexus.feature.outlet.OutletFormat
import id.znetworks.nexus.ui.components.describe
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.serialization.json.*
import java.time.LocalDate
import java.time.YearMonth
import java.time.ZoneId
import java.time.format.TextStyle
import java.util.Locale

data class SocialState(
    val month: String = YearMonth.now(ZoneId.of("Asia/Jakarta")).toString(),
    val data: SocialMonth? = null, val loading: Boolean = true,
    val busy: Boolean = false, val error: String? = null, val forbidden: Boolean = false,
)

class SocialViewModel(app: Application, handle: SavedStateHandle) : AndroidViewModel(app) {
    val projectId: String = handle["id"] ?: ""
    val api = SocialApi((app as NexusApplication).container.api, projectId)
    private val mutable = MutableStateFlow(SocialState(month = handle["socialMonth"] ?: YearMonth.now(ZoneId.of("Asia/Jakarta")).toString()))
    val state = mutable.asStateFlow()
    private val saved = handle
    private var sequence = 0
    init { load() }
    fun load() = viewModelScope.launch {
        val seq = ++sequence
        val month = mutable.value.month
        try {
            val data = api.month(month)
            if (seq == sequence) mutable.update { it.copy(data = data, loading = false, error = null, forbidden = false) }
        } catch (e: ApiError) {
            if (seq == sequence) mutable.update { it.copy(loading = false, error = e.describe(getApplication<Application>().resources), forbidden = (e as? ApiError.Http)?.status == 403) }
        }
    }
    fun month(value: String) {
        if (value == mutable.value.month) return
        saved["socialMonth"] = value
        mutable.update { it.copy(month = value, loading = true, error = null) }; load()
    }
    fun write(path: String, body: JsonObject, done: () -> Unit) = viewModelScope.launch {
        if (mutable.value.busy) return@launch
        mutable.update { it.copy(busy = true, error = null) }
        try { api.put(path, body); load().join(); done(); id.znetworks.nexus.ui.components.UiNotice.show(getApplication<Application>().getString(R.string.sm_saved)) }
        catch (e: ApiError) {
            if ((e as? ApiError.Http)?.code == "CONFIG_CHANGED") load().join()
            mutable.update { it.copy(error = e.describe(getApplication<Application>().resources)) }
        }
        mutable.update { it.copy(busy = false) }
    }
    fun settings(config: JsonObject, targets: JsonObject, configured: (JsonObject) -> Unit, done: () -> Unit) = viewModelScope.launch {
        if (mutable.value.busy) return@launch
        mutable.update { it.copy(busy = true, error = null) }
        try {
            val response = api.put("config", buildJsonObject { put("config", config) })
            configured(response.objectAt("config"))
            api.put("targets", targets)
            load().join(); done(); id.znetworks.nexus.ui.components.UiNotice.show(getApplication<Application>().getString(R.string.sm_saved))
        } catch (e: ApiError) { mutable.update { it.copy(error = e.describe(getApplication<Application>().resources)) } }
        mutable.update { it.copy(busy = false) }
    }
}

@Composable
fun SocialTab(calendar: Boolean, initialDate: String? = null, vm: SocialViewModel = viewModel()) {
    val s by vm.state.collectAsStateWithLifecycle()
    var date by rememberSaveable { mutableStateOf<String?>(null) }
    var settings by rememberSaveable { mutableStateOf(false) }
    var info by remember { mutableStateOf(false) }
    LaunchedEffect(initialDate) { initialDate?.let { runCatching { LocalDate.parse(it) }.getOrNull() }?.let { vm.month(it.toString().take(7)); date = it.toString() } }
    LiveRefresh(vm.projectId, liveMs = null, fallbackMs = 60_000,
        matches = { it.name == "social-media-changed" && (it.projectId == null || it.projectId == vm.projectId) }) { vm.load().join() }
    val d = s.data?.takeIf { it.month == s.month && !s.forbidden }
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            TextButton(onClick = { vm.month(YearMonth.parse(s.month).minusMonths(1).toString()) }) { Text("‹") }
            Text(OutletFormat.monthLabel(s.month))
            TextButton(onClick = { vm.month(YearMonth.parse(s.month).plusMonths(1).toString()) }) { Text("›") }
        }
        TextButton(onClick = { vm.month(d?.today?.take(7) ?: YearMonth.now(ZoneId.of("Asia/Jakarta")).toString()) }) { Text(stringResource(R.string.sm_this_month)) }
        if (s.error != null) {
            Text(s.error!!, color = MaterialTheme.colorScheme.error)
            TextButton(onClick = { vm.load() }) { Text(stringResource(R.string.try_again)) }
        }
        if (s.loading) LinearProgressIndicator(Modifier.fillMaxWidth())
        if (d != null) {
            if (d.canManage) TextButton(onClick = { settings = true }) { Text(stringResource(R.string.sm_settings)) }
            if (d.canRecord) Button(onClick = { vm.month(d.today.take(7)); date = d.today }) { Text(stringResource(R.string.sm_record_today)) }
            if (calendar) {
                Row(Modifier.fillMaxWidth()) {
                    java.time.DayOfWeek.entries.forEach { Text(it.getDisplayName(TextStyle.NARROW, Locale.getDefault()), Modifier.weight(1f).padding(4.dp), style = MaterialTheme.typography.labelSmall) }
                }
                OutletFormat.grid(YearMonth.parse(s.month)).chunked(7).forEach { week ->
                    Row(Modifier.fillMaxWidth()) {
                        week.forEach { day ->
                            val dayData = d.day(day.toString())
                            Column(Modifier.weight(1f).clickable { vm.month(day.toString().take(7)); date = day.toString() }.padding(4.dp)) {
                                val today = day.toString() == d.today
                                Text(day.dayOfMonth.toString(), modifier = Modifier.background(if (today) MaterialTheme.colorScheme.primary else androidx.compose.ui.graphics.Color.Transparent, CircleShape).padding(3.dp),
                                    color = if (today) MaterialTheme.colorScheme.onPrimary else if (day.toString().startsWith(d.month)) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.onSurfaceVariant)
                                dayData.number("engagement")?.let { n -> Text(compact(n, stringResource(R.string.sm_thousand), stringResource(R.string.sm_million)), style = MaterialTheme.typography.labelSmall, maxLines = 1) }
                                Row {
                                    if (dayData.text("worked").isNotEmpty() || dayData.text("didntWork").isNotEmpty()) Icon(Icons.Outlined.Notes, stringResource(R.string.sm_note_mark), Modifier.size(12.dp))
                                    if (d.targets(day.toString()).isNotEmpty()) Icon(Icons.Outlined.Flag, stringResource(R.string.sm_target_mark), Modifier.size(12.dp))
                                }
                            }
                        }
                    }
                }
            } else {
                TextButton(onClick = { info = true }) { Text(stringResource(R.string.sm_to_date)) }
                d.overview.text("cutoff").takeIf { it.isNotEmpty() }?.let { Text(stringResource(R.string.sm_through, OutletFormat.shortDay(it, d.today.take(4).toInt()))) }
                when {
                    d.overview["cutoff"] == JsonNull -> Text(stringResource(R.string.sm_not_started, OutletFormat.monthLabel(d.month)))
                    (d.overview.number("recordedDays") ?: 0.0) == 0.0 -> Text(stringResource(R.string.sm_empty, OutletFormat.monthLabel(d.month)))
                    else -> SocialOverview(d)
                }
            }
        }
    }
    if (info) AlertDialog(onDismissRequest = { info = false }, title = { Text(stringResource(R.string.sm_engagement_info)) },
        text = { Text(stringResource(R.string.sm_views_info)) }, confirmButton = { TextButton(onClick = { info = false }) { Text(stringResource(R.string.sm_close)) } })
    if (d != null && date != null && date!!.startsWith(d.month)) SocialDayDialog(d, date!!, vm, s.busy, s.error) { date = null }
    if (d != null && settings) SocialSettingsDialog(d, vm, s.busy, s.error) { settings = false }
}

internal fun compact(number: Double, thousand: String, million: String): String {
    val divisor = when { number >= 1_000_000 -> 1_000_000; number >= 1000 -> 1000; else -> return number.toLong().toString() }
    val shown = java.text.DecimalFormat("0.#").format(number / divisor)
    return shown + (if (divisor == 1000) thousand else million)
}

internal fun metricLabel(key: String) = when (key) {
    "views" -> R.string.sm_views; "likes" -> R.string.sm_likes; "comments" -> R.string.sm_comments
    "shares" -> R.string.sm_shares; "posts" -> R.string.sm_posts; "postsTarget" -> R.string.sm_posts_target
    else -> R.string.sm_engagement_target
}

@Composable
internal fun SocialMetric(raw: JsonObject, metric: String, target: String, label: Int) {
    val actual = reportNumber(raw.number(metric)); val goal = raw.number(target)?.let(::reportNumber)
    val pct = raw.number(metric + "Pct")
    Text("${stringResource(label)}: $actual" + (goal?.let { " / $it" } ?: "") + (pct?.let { " (${it.toInt()}%)" } ?: ""))
    raw.number(metric + "Pct")?.let { pct -> LinearProgressIndicator(progress = { (pct / 100).toFloat().coerceIn(0f, 1f) }, modifier = Modifier.fillMaxWidth()) }
}

internal fun reportNumber(number: Double?) = number?.let { java.text.DecimalFormat("#,##0.##").format(it) } ?: "—"
