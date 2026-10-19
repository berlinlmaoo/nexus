package id.znetworks.nexus.feature.admin

import id.znetworks.nexus.ui.components.NxSwitch

import id.znetworks.nexus.ui.components.NxTextField

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import id.znetworks.nexus.NexusApplication
import id.znetworks.nexus.R
import id.znetworks.nexus.core.net.ApiClient
import id.znetworks.nexus.core.net.ApiClient.Companion.toJsonBody
import id.znetworks.nexus.core.net.ApiError
import id.znetworks.nexus.feature.social.*
import id.znetworks.nexus.ui.components.describe
import kotlinx.coroutines.launch
import kotlinx.serialization.json.*
import okhttp3.Request

class CalendarPrivacyApi(private val api: ApiClient) {
    suspend fun load() = api.get("/api/admin/calendar-settings", JsonObject.serializer())
    suspend fun set(projectId: String, isPrivate: Boolean) = api.send(Request.Builder().url(api.url("/api/admin/calendar-settings"))
        .patch(buildJsonObject { put("projectId", projectId); put("private", isPrivate) }.toString().toJsonBody()).build(), JsonObject.serializer())
}

@Composable
internal fun CalendarPrivacyTab() {
    val context = LocalContext.current
    val container = (context.applicationContext as NexusApplication).container
    if (!container.viewer.isBoD) return
    val api = remember { CalendarPrivacyApi(container.api) }
    val scope = rememberCoroutineScope()
    var data by remember { mutableStateOf<JsonObject?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var query by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf<String?>(null) }
    var retry by remember { mutableIntStateOf(0) }
    LaunchedEffect(retry) { try { data = api.load(); error = null } catch (e: ApiError) { error = e.describe(context.resources) } }
    LazyColumn(Modifier.fillMaxSize().dismissKeyboardOnTapOrDrag(), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        item {
            Text(stringResource(R.string.calp_title), style = MaterialTheme.typography.titleLarge)
            Text(stringResource(R.string.calp_help))
            NxTextField(query, { query = it }, label = { Text(stringResource(R.string.gsd_search)) }, keyboardOptions = AdminKeyboard.Done, modifier = Modifier.fillMaxWidth())
        }
        if (data == null && error == null) item { CircularProgressIndicator() }
        error?.let { item { Text(it, color = MaterialTheme.colorScheme.error); TextButton(onClick = { retry++ }, enabled = busy == null) { Text(stringResource(R.string.try_again)) } } }
        items(data?.rows("projects").orEmpty().filter { it.text("name").contains(query.trim(), true) }, key = { it.text("id") }) { project ->
            Card(Modifier.fillMaxWidth()) {
                Row(Modifier.padding(12.dp)) {
                    Column(Modifier.weight(1f)) { Text(project.text("name")); Text(stringResource(if (project.flag("private")) R.string.calp_private else R.string.calp_visible), style = MaterialTheme.typography.bodySmall) }
                    NxSwitch(project.flag("private"), { isPrivate -> scope.launch {
                        if (busy != null) return@launch
                        busy = project.text("id"); error = null
                        try { data = api.set(project.text("id"), isPrivate) }
                        catch (e: ApiError) { error = e.describe(context.resources) }
                        busy = null
                    } }, enabled = busy == null)
                }
            }
        }
    }
}
