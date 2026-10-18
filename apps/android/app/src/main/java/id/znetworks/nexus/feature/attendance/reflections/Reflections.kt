package id.znetworks.nexus.feature.attendance.reflections

import id.znetworks.nexus.core.i18n.AppDateFormats

import android.app.Application
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowLeft
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.AutoAwesome
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import id.znetworks.nexus.NexusApplication
import id.znetworks.nexus.R
import id.znetworks.nexus.core.net.ApiClient.Companion.toJsonBody
import id.znetworks.nexus.core.net.ApiError
import id.znetworks.nexus.core.time.OfficeTime
import id.znetworks.nexus.ui.components.EmptyState
import id.znetworks.nexus.ui.components.describe
import id.znetworks.nexus.ui.theme.DisplayFont
import id.znetworks.nexus.ui.theme.Nx
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable
import okhttp3.Request
import java.time.LocalDate
import java.time.YearMonth
import java.time.format.DateTimeFormatter
import java.util.Locale

@Serializable data class ReflectionDay(val date: String, val reflection: String = "", val summary: String? = null)
@Serializable data class MonthSummary(val summary: String = "", val sourceDays: Int = 0, val updatedAt: String? = null)
@Serializable data class ReflectionsResponse(val days: List<ReflectionDay> = emptyList(), val monthly: MonthSummary? = null)
@Serializable private data class SummarizeBody(val month: String, val force: Boolean)
@Serializable private data class SummarizeResponse(val summary: String = "", val sourceDays: Int = 0, val updatedAt: String? = null)

data class ReflectionsState(
    val month: YearMonth = YearMonth.from(OfficeTime.today()),
    val data: ReflectionsResponse? = null,
    val loading: Boolean = true,
    val error: String? = null,
    val summarizing: Boolean = false,
    val summarizeError: String? = null,
)

/** Own reflections by calendar month with GIDEON's summaries (PRD §2.12, MVP: own only). */
class ReflectionsViewModel(app: Application) : AndroidViewModel(app) {
    private val api = (app as NexusApplication).container.api
    private val _state = MutableStateFlow(ReflectionsState())
    val state = _state.asStateFlow()
    private val res get() = getApplication<Application>().resources

    init { load() }

    fun shift(delta: Long) {
        val next = _state.value.month.plusMonths(delta)
        if (next.isAfter(YearMonth.from(OfficeTime.today()))) return
        _state.update { it.copy(month = next, data = null) }
        load()
    }

    fun load() = viewModelScope.launch {
        _state.update { it.copy(loading = true, error = null) }
        try {
            val r = api.get("/api/attendance/reflections?month=${_state.value.month}", ReflectionsResponse.serializer())
            _state.update { it.copy(data = r, loading = false) }
        } catch (e: ApiError) {
            _state.update { it.copy(loading = false, error = e.describe(res)) }
        }
    }

    /** Slow on purpose (the route may take minutes); a 503 is GIDEON's own sentence, shown as-is. */
    fun summarize() = viewModelScope.launch {
        _state.update { it.copy(summarizing = true, summarizeError = null) }
        try {
            val body = api.json.encodeToString(SummarizeBody.serializer(), SummarizeBody(_state.value.month.toString(), force = _state.value.data?.monthly != null))
            val r = api.send(Request.Builder().url(api.url("/api/attendance/reflections/summarize")).post(body.toJsonBody()).build(),
                SummarizeResponse.serializer(), callTimeoutMs = 300_000)
            _state.update { s -> s.copy(summarizing = false, data = s.data?.copy(monthly = MonthSummary(r.summary, r.sourceDays, r.updatedAt))) }
        } catch (e: ApiError) {
            _state.update { it.copy(summarizing = false, summarizeError = e.describe(res)) }
        }
    }
}

@Composable
fun ReflectionsDialog(onClose: () -> Unit, vm: ReflectionsViewModel = viewModel()) {
    val s by vm.state.collectAsStateWithLifecycle()
    val c = Nx.colors
    Dialog(onDismissRequest = onClose, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Column(Modifier.fillMaxSize().background(c.background).systemBarsPadding()) {
            Row(Modifier.padding(8.dp), verticalAlignment = Alignment.CenterVertically) {
                IconButton(onClick = onClose) { Icon(Icons.Filled.Close, stringResource(R.string.close)) }
                Text(stringResource(R.string.reflections_title), fontFamily = DisplayFont, fontWeight = FontWeight.Bold, fontSize = 18.sp, modifier = Modifier.weight(1f))
                IconButton(onClick = { vm.shift(-1) }) { Icon(Icons.AutoMirrored.Filled.KeyboardArrowLeft, stringResource(R.string.previous)) }
                Text(AppDateFormats.ofPattern("MMM yyyy", Locale.getDefault()).format(s.month), fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
                IconButton(onClick = { vm.shift(1) }, enabled = s.month.isBefore(YearMonth.from(OfficeTime.today()))) {
                    Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, stringResource(R.string.next))
                }
            }
            val data = s.data
            when {
                s.loading && data == null -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
                s.error != null && data == null -> EmptyState(Icons.Filled.AutoAwesome, stringResource(R.string.reflections_load_failed), s.error!!,
                    stringResource(R.string.try_again), { vm.load() }, Modifier.fillMaxSize())
                data == null || data.days.isEmpty() -> EmptyState(Icons.Filled.AutoAwesome, stringResource(R.string.reflections_empty),
                    stringResource(R.string.reflections_empty_sub), stringResource(R.string.previous_month), { vm.shift(-1) }, Modifier.fillMaxSize())
                else -> LazyColumn(contentPadding = androidx.compose.foundation.layout.PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    item {
                        Column(
                            Modifier.fillMaxWidth().background(c.accentBg, RoundedCornerShape(18.dp)).padding(14.dp),
                            verticalArrangement = Arrangement.spacedBy(8.dp),
                        ) {
                            Text(stringResource(R.string.reflections_month_summary), fontWeight = FontWeight.Bold, color = c.accentFg)
                            data.monthly?.summary?.takeIf { it.isNotBlank() }?.let { Text(it, fontSize = 13.sp, color = c.foreground) }
                            s.summarizeError?.let { Text(it, fontSize = 12.sp, color = c.danger) }
                            Button(onClick = vm::summarize, enabled = !s.summarizing, shape = RoundedCornerShape(12.dp),
                                colors = ButtonDefaults.buttonColors(containerColor = c.violet, contentColor = Color.White)) {
                                if (s.summarizing) { CircularProgressIndicator(Modifier.size(16.dp), color = Color.White, strokeWidth = 2.dp); Spacer(Modifier.size(8.dp)) }
                                Text(stringResource(if (data.monthly == null) R.string.reflections_summarize else R.string.reflections_update_summary))
                            }
                        }
                    }
                    items(data.days.sortedByDescending { it.date }, key = { it.date }) { d ->
                        Column(Modifier.fillMaxWidth().background(c.card, RoundedCornerShape(16.dp)).border(1.dp, c.border, RoundedCornerShape(16.dp)).padding(12.dp),
                            verticalArrangement = Arrangement.spacedBy(6.dp)) {
                            Text(runCatching { AppDateFormats.ofPattern("EEEE, d MMM", Locale.getDefault()).format(LocalDate.parse(d.date.take(10))) }.getOrDefault(d.date),
                                fontWeight = FontWeight.Bold, fontSize = 13.sp)
                            d.summary?.takeIf { it.isNotBlank() }?.let { Text("✨ $it", fontSize = 12.sp, color = c.violetText) }
                            Text(d.reflection, fontSize = 13.sp, color = c.foreground)
                        }
                    }
                }
            }
        }
    }
}
