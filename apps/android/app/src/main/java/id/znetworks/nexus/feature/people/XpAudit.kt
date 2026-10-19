package id.znetworks.nexus.feature.people

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import id.znetworks.nexus.NexusApplication
import id.znetworks.nexus.R
import id.znetworks.nexus.core.net.ApiError
import id.znetworks.nexus.feature.chat.chatTime
import id.znetworks.nexus.feature.social.*
import id.znetworks.nexus.ui.components.Avatar
import id.znetworks.nexus.ui.components.describe
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonObject

@Composable
internal fun XpAuditCard(onChanged: () -> Unit = {}) {
    val context = LocalContext.current
    val container = (context.applicationContext as NexusApplication).container
    if (!container.viewer.isBoD) return
    val scope = rememberCoroutineScope()
    var open by remember { mutableStateOf(false) }
    var sign by remember { mutableStateOf("all") }
    var period by remember { mutableStateOf("period") }
    var rows by remember { mutableStateOf<List<JsonObject>>(emptyList()) }
    var next by remember { mutableStateOf<Int?>(null) }
    var loading by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var sequence by remember { mutableIntStateOf(0) }
    suspend fun load(more: Boolean) {
        val seq = ++sequence
        val offset = if (more) next ?: return else 0
        loading = true
        try {
            val page = container.api.get("/api/gamification/xp-transactions?scope=$period&sign=$sign&limit=40&offset=$offset", JsonObject.serializer())
            if (seq == sequence) {
                rows = ((if (more) rows else emptyList()) + page.rows("rows")).distinctBy { it.text("id") }
                next = if (page.flag("hasMore")) page.number("nextOffset")?.toInt() else null
                error = null
            }
        } catch (e: ApiError) { if (seq == sequence) error = e.describe(context.resources) }
        if (seq == sequence) loading = false
    }
    LaunchedEffect(open, sign, period) {
        sequence++
        rows = emptyList(); next = null
        if (open) load(false)
    }
    Card(Modifier.fillMaxWidth().padding(top = 16.dp)) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            XpAdjustButton { onChanged(); sequence++; rows = emptyList(); next = null; if (open) scope.launch { load(false) } }
            TextButton(onClick = { open = !open }) { Text(stringResource(R.string.xpa_title)) }
            Text(stringResource(R.string.xpa_description))
            if (open) {
                Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                    listOf("all" to R.string.xpa_all, "pos" to R.string.xpa_added, "neg" to R.string.xpa_deducted).forEach { (key, label) ->
                        FilterChip(selected = sign == key, onClick = { sign = key }, label = { Text(stringResource(label)) })
                    }
                }
                Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                    listOf("period" to R.string.xpa_period, "all" to R.string.xpa_all_time).forEach { (key, label) ->
                        FilterChip(selected = period == key, onClick = { period = key }, label = { Text(stringResource(label)) })
                    }
                }
                if (loading) LinearProgressIndicator(Modifier.fillMaxWidth())
                error?.let { Text(it, color = MaterialTheme.colorScheme.error); TextButton(onClick = { scope.launch { load(next != null && rows.isNotEmpty()) } }, enabled = !loading) { Text(stringResource(R.string.try_again)) } }
                val shown = rows.filter { (it.number("amount") ?: 0.0) != 0.0 }
                if (!loading && error == null && shown.isEmpty()) Text(stringResource(R.string.xpa_empty))
                shown.forEach { r ->
                    val amount = r.number("amount")?.toInt() ?: 0
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        Avatar(r.text("userName"), r.text("userAvatar"), 32.dp, userId = r.text("userId"))
                        Column(Modifier.weight(1f)) {
                            Text(r.text("userName"))
                            Text(xpTitle(XpLogLogic.entry(XpLogRow(r.text("id"), amount, r.text("reason"), r.text("createdAt"), r.number("lateMinutes")?.toInt()))), style = MaterialTheme.typography.bodySmall)
                            Text(chatTime(r.text("createdAt")), style = MaterialTheme.typography.bodySmall)
                        }
                        Text((if (amount > 0) "+" else "") + "$amount XP", color = if (amount > 0) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.error)
                    }
                }
                if (next != null) TextButton(onClick = { scope.launch { load(true) } }, enabled = !loading) { Text(stringResource(R.string.xpa_more)) }
            }
        }
    }
}
