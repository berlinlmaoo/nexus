package id.znetworks.nexus.feature.gideon

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import id.znetworks.nexus.R
import id.znetworks.nexus.core.net.ApiClient
import id.znetworks.nexus.core.net.ApiError
import id.znetworks.nexus.ui.components.describe
import id.znetworks.nexus.ui.theme.Nx
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable
import java.net.URLEncoder

@Serializable data class GCreditAllowance(val used: Int = 0, val limit: Int = 0, val remaining: Int = 0, val bonus: Int = 0)
@Serializable data class GCreditPeriod(val startKey: String = "", val endKey: String = "", val resetsAt: String = "")
@Serializable data class GCreditSummary(
    val unlimited: Boolean = false, val today: GCreditAllowance = GCreditAllowance(), val pool: GCreditAllowance = GCreditAllowance(),
    val period: GCreditPeriod = GCreditPeriod(), val period_used: Int = 0, val enforced: Boolean = false,
    val next: String = "ok", val fallbackToday: Int = 0, val fallbackPerDay: Int = 30,
)
@Serializable data class GCreditUsage(val id: String, val title: String? = null, val tier: String = "luna", val credits: Int = 0,
    val createdAt: String = "", val fallback: Boolean = false)
@Serializable data class GCreditResponse(val summary: GCreditSummary, val items: List<GCreditUsage> = emptyList(), val nextBefore: String? = null)

class GideonCreditsApi(private val api: ApiClient) {
    suspend fun balance() = api.get("/api/gideon/credits", GCreditResponse.serializer()).summary
    suspend fun history(before: String? = null) = api.get("/api/gideon/credits?history=1&limit=50" +
        (before?.let { "&before=" + URLEncoder.encode(it, "UTF-8") } ?: ""), GCreditResponse.serializer())
}

/** The server decides allowances, enforcement and fallback. Refresh at entry and after each answer. */
@Composable
fun GideonCreditMeter(api: ApiClient, refreshKey: Any?) {
    val c = Nx.colors
    val res = LocalContext.current.resources
    val service = remember(api) { GideonCreditsApi(api) }
    val scope = rememberCoroutineScope()
    var summary by remember { mutableStateOf<GCreditSummary?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var open by remember { mutableStateOf(false) }
    var history by remember { mutableStateOf<List<GCreditUsage>?>(null) }
    var next by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    var retry by remember { mutableIntStateOf(0) }
    LaunchedEffect(refreshKey, retry) {
        try { summary = service.balance(); error = null }
        catch (e: ApiError) { error = e.describe(res) }
    }
    val s = summary
    val label = when { s == null -> stringResource(R.string.gc_title); s.unlimited -> stringResource(R.string.audit_credits_unlimited, s.today.used)
        else -> stringResource(R.string.gc_today, s.today.used, s.today.limit) }
    Column(Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 6.dp)) {
        Text(label, fontSize = 12.sp, color = c.mutedFg, textAlign = androidx.compose.ui.text.style.TextAlign.Center, modifier = Modifier.fillMaxWidth().clickable { open = true }.padding(vertical = 6.dp))
        if (s != null && !s.unlimited) LinearProgressIndicator(progress = { if (s.today.limit > 0) (s.today.used.toFloat() / s.today.limit).coerceIn(0f, 1f) else 0f },
            modifier = Modifier.fillMaxWidth().height(2.dp), color = c.violet, trackColor = c.muted)
        if (s?.enforced == true && s.next != "ok") Text(stringResource(if (s.next == "blocked") R.string.gc_blocked else R.string.gc_fallback,
            (s.fallbackPerDay - s.fallbackToday).coerceAtLeast(0)), fontSize = 12.sp, color = c.warning, modifier = Modifier.padding(top = 6.dp))
    }
    if (open) AlertDialog(onDismissRequest = { open = false }, title = { Text(stringResource(if (history == null) R.string.gc_title else R.string.gc_history)) },
        text = { Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
            if (s == null) Text(error ?: stringResource(R.string.gc_loading))
            else {
                Text(label)
                if (!s.unlimited) {
                    // Summary.pool.limit already includes the bonus (unlike the admin role's monthly limit).
                    Text(stringResource(R.string.gc_pool, s.pool.used, s.pool.limit))
                    Text(s.period.startKey + " – " + s.period.endKey, fontSize = 12.sp)
                    Text(stringResource(R.string.gc_resets), fontSize = 12.sp)
                }
            }
            error?.let { Text(it, color = c.dangerText) }
            val rows = history
            if (rows != null) LazyColumn(Modifier.fillMaxWidth().heightIn(max = 360.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                if (rows.isEmpty()) item { Text(stringResource(R.string.gc_empty)) }
                items(rows, key = { it.id }) { usage ->
                    Column {
                        Text(usage.title ?: "GIDEON", fontSize = 14.sp)
                        Text((GideonTier.entries.firstOrNull { it.key == usage.tier }?.label ?: "GIDEON") + " · " + usage.credits + " · " +
                            id.znetworks.nexus.feature.chat.chatTime(usage.createdAt), fontSize = 12.sp, color = c.mutedFg)
                        if (usage.fallback) Text(stringResource(R.string.gc_answer_fallback), fontSize = 12.sp, color = c.warning)
                    }
                }
                if (next != null) item { TextButton(enabled = !busy, onClick = { busy = true; scope.launch {
                    try { val page = service.history(next); history = (history.orEmpty() + page.items).distinctBy { it.id }; next = page.nextBefore; error = null }
                    catch (e: ApiError) { error = e.describe(res) }; busy = false
                } }) { Text(stringResource(R.string.gc_more)) } }
            }
        } },
        confirmButton = { TextButton(onClick = { open = false }) { Text("OK") } },
        dismissButton = { TextButton(enabled = !busy, onClick = { busy = true; scope.launch {
            try { val page = service.history(); history = page.items; next = page.nextBefore; summary = page.summary; error = null }
            catch (e: ApiError) { error = e.describe(res) }; busy = false; retry++
        } }) { Text(stringResource(R.string.gc_history)) } })
}
