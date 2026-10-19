package id.znetworks.nexus.feature.gideon

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import id.znetworks.nexus.NexusApplication
import id.znetworks.nexus.R
import id.znetworks.nexus.core.nav.Target
import id.znetworks.nexus.core.net.ApiClient
import id.znetworks.nexus.core.net.ApiClient.Companion.toJsonBody
import id.znetworks.nexus.core.net.ApiError
import id.znetworks.nexus.feature.projects.Project
import id.znetworks.nexus.feature.projects.ProjectsApi
import id.znetworks.nexus.feature.social.objectAt
import id.znetworks.nexus.feature.social.text
import id.znetworks.nexus.ui.components.describe
import kotlinx.coroutines.launch
import kotlinx.serialization.json.*
import okhttp3.Request

class GideonSaveDocApi(private val api: ApiClient) {
    suspend fun save(project: String, title: String, markdown: String): String {
        val body = buildJsonObject { put("projectId", project); put("title", title.take(200)); put("markdown", markdown.take(60_000)) }
        return api.send(Request.Builder().url(api.url("/api/gideon/save-doc")).post(body.toString().toJsonBody()).build(), JsonObject.serializer())
            .objectAt("doc").text("id").takeIf { it.isNotBlank() } ?: throw ApiError.Decoding(IllegalStateException("Missing page"))
    }
}

@Composable
internal fun SaveAnswerButton(markdown: String, project: Pair<String, String>?) {
    var open by remember { mutableStateOf(false) }
    TextButton(onClick = { open = true }) { Text(stringResource(R.string.gsd_save)) }
    if (open) SaveAnswerDialog(markdown, project) { open = false }
}

@Composable
private fun SaveAnswerDialog(markdown: String, project: Pair<String, String>?, close: () -> Unit) {
    val context = LocalContext.current
    val container = (context.applicationContext as NexusApplication).container
    val api = remember { GideonSaveDocApi(container.api) }
    val projectsApi = remember { ProjectsApi(container.api) }
    val scope = rememberCoroutineScope()
    var projects by remember { mutableStateOf<List<Project>?>(null) }
    var query by remember { mutableStateOf("") }
    var title by remember { mutableStateOf(markdown.lineSequence().firstOrNull { it.isNotBlank() }?.trim()?.trimStart('#', ' ')?.take(200).orEmpty()) }
    var error by remember { mutableStateOf<String?>(null) }
    var saving by remember { mutableStateOf<String?>(null) }
    var retry by remember { mutableIntStateOf(0) }
    LaunchedEffect(retry) {
        try { projects = projectsApi.projects().value; error = null }
        catch (e: ApiError) { error = e.describe(context.resources) }
    }
    fun save(id: String) { scope.launch {
        if (saving != null) return@launch
        saving = id; error = null
        try { val doc = api.save(id, title, markdown); close(); container.router.open(Target.Docs(doc)) }
        catch (e: ApiError) { error = e.describe(context.resources); saving = null }
    } }
    AlertDialog(onDismissRequest = { if (saving == null) close() }, title = { Text(stringResource(R.string.gsd_save)) },
        text = { Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            OutlinedTextField(title, { if (it.length <= 200) title = it }, label = { Text(stringResource(R.string.gsd_title)) }, enabled = saving == null, modifier = Modifier.fillMaxWidth())
            OutlinedTextField(query, { query = it }, label = { Text(stringResource(R.string.gsd_search)) }, enabled = saving == null, modifier = Modifier.fillMaxWidth())
            error?.let { Text(it, color = MaterialTheme.colorScheme.error); TextButton(onClick = { retry++ }, enabled = saving == null) { Text(stringResource(R.string.try_again)) } }
            if (projects == null && error == null) CircularProgressIndicator()
            if (project != null && query.isBlank()) TextButton(onClick = { save(project.first) }, enabled = saving == null) { Text(stringResource(R.string.gsd_this_project, project.second)) }
            val shown = projects.orEmpty().filter { it.id != project?.first && it.name.contains(query.trim(), true) }.take(60)
            if (projects != null && shown.isEmpty()) Text(stringResource(R.string.gsd_no_project))
            shown.forEach { p -> TextButton(onClick = { save(p.id) }, enabled = saving == null) { Text(p.name) } }
            if (saving != null) LinearProgressIndicator(Modifier.fillMaxWidth())
        } }, confirmButton = {}, dismissButton = { TextButton(onClick = close, enabled = saving == null) { Text(stringResource(R.string.cancel)) } })
}
