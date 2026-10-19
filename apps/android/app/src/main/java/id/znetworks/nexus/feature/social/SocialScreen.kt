package id.znetworks.nexus.feature.social

import android.app.Application
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
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
        try { api.put(path, body); load().join(); done() }
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
            load().join(); done()
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
                OutletFormat.grid(YearMonth.parse(s.month)).chunked(7).forEach { week ->
                    Row(Modifier.fillMaxWidth()) {
                        week.forEach { day ->
                            val dayData = d.day(day.toString())
                            Column(Modifier.weight(1f).clickable { vm.month(day.toString().take(7)); date = day.toString() }.padding(4.dp)) {
                                Text(day.dayOfMonth.toString(), color = if (day.toString() == d.today) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurface)
                                if (dayData.number("engagement") != null) Text(OutletFormat.count(dayData.number("engagement")), style = MaterialTheme.typography.labelSmall, maxLines = 1)
                                if (dayData.text("worked").isNotEmpty() || dayData.text("didntWork").isNotEmpty()) Text(stringResource(R.string.sm_note_mark), style = MaterialTheme.typography.labelSmall)
                                if (d.targets(day.toString()).isNotEmpty()) Text(stringResource(R.string.sm_target_mark), style = MaterialTheme.typography.labelSmall)
                            }
                        }
                    }
                }
            } else {
                TextButton(onClick = { info = true }) { Text(stringResource(R.string.sm_to_date)) }
                when {
                    d.overview["cutoff"] == JsonNull -> Text(stringResource(R.string.sm_not_started, OutletFormat.monthLabel(d.month)))
                    (d.overview.number("recordedDays") ?: 0.0) == 0.0 -> Text(stringResource(R.string.sm_empty, OutletFormat.monthLabel(d.month)))
                    else -> d.overview.rows("platforms").forEach { platform ->
                        Card(Modifier.fillMaxWidth()) {
                            Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                                Text(platform.text("name") + if (platform.flag("archived")) " · " + stringResource(R.string.sm_archived) else "", style = MaterialTheme.typography.titleMedium)
                                SocialMetric(platform, "engagement", "engagementTargetToDate", R.string.sm_engagement)
                                Text(stringResource(R.string.sm_month_target, OutletFormat.count(platform.number("engagementTargetMonth"))))
                                val values = (platform["trend"] as? JsonArray).orEmpty().map { (it as? JsonPrimitive)?.floatOrNull ?: 0f }
                                val color = MaterialTheme.colorScheme.primary
                                Canvas(Modifier.fillMaxWidth().height(40.dp)) {
                                    if (values.size > 1) {
                                        val high = values.maxOrNull()?.coerceAtLeast(1f) ?: 1f
                                        val path = Path()
                                        values.forEachIndexed { i, n ->
                                            val x = size.width * i / (values.size - 1); val y = size.height * (1 - n / high)
                                            if (i == 0) path.moveTo(x, y) else path.lineTo(x, y)
                                        }
                                        drawPath(path, color, style = androidx.compose.ui.graphics.drawscope.Stroke(2.dp.toPx()))
                                    }
                                }
                                listOf("views", "likes", "comments", "shares").forEach { key -> Text("${stringResource(metricLabel(key))}: ${OutletFormat.count(platform.number(key))}") }
                                SocialMetric(platform, "posts", "postsTargetToDate", R.string.sm_posts)
                            }
                        }
                    }
                }
            }
        }
    }
    if (info) AlertDialog(onDismissRequest = { info = false }, title = { Text(stringResource(R.string.sm_engagement_info)) },
        text = { Text(stringResource(R.string.sm_views_info)) }, confirmButton = { TextButton(onClick = { info = false }) { Text(stringResource(R.string.sm_close)) } })
    if (d != null && date != null && date!!.startsWith(d.month)) SocialDayDialog(d, date!!, vm, s.busy, s.error) { date = null }
    if (d != null && settings) SocialSettingsDialog(d, vm, s.busy, s.error) { settings = false }
}

internal fun metricLabel(key: String) = when (key) {
    "views" -> R.string.sm_views; "likes" -> R.string.sm_likes; "comments" -> R.string.sm_comments
    "shares" -> R.string.sm_shares; "posts" -> R.string.sm_posts; "postsTarget" -> R.string.sm_posts_target
    else -> R.string.sm_engagement_target
}

@Composable
internal fun SocialMetric(raw: JsonObject, metric: String, target: String, label: Int) {
    Text("${stringResource(label)}: ${OutletFormat.vsTarget(raw.number(metric), raw.number(target), false, pct = raw.number(metric + "Pct")?.toInt())}")
    raw.number(metric + "Pct")?.let { pct -> LinearProgressIndicator(progress = { (pct / 100).toFloat().coerceIn(0f, 1f) }, modifier = Modifier.fillMaxWidth()) }
}
