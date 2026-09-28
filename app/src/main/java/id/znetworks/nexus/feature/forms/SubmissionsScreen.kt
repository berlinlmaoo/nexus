package id.znetworks.nexus.feature.forms

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Assignment
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import id.znetworks.nexus.NexusApplication
import id.znetworks.nexus.R
import id.znetworks.nexus.core.net.ApiError
import id.znetworks.nexus.feature.chat.chatTime
import id.znetworks.nexus.feature.projects.Pill
import id.znetworks.nexus.feature.projects.TabEmpty
import id.znetworks.nexus.feature.projects.valueText
import id.znetworks.nexus.ui.components.EmptyState
import id.znetworks.nexus.ui.components.describe
import id.znetworks.nexus.ui.theme.DisplayFont
import id.znetworks.nexus.ui.theme.Nx

@Composable
private fun formsApi(): FormsApi {
    val ctx = LocalContext.current
    val c = (ctx.applicationContext as NexusApplication).container
    return remember { FormsApi(ctx.applicationContext, c.api, c.sessionStore) }
}

/** What happened to the things I sent through forms: the board column and the "Status" field. */
@Composable
fun SubmissionsScreen(onBack: () -> Unit, onOpen: (String) -> Unit) {
    val api = formsApi()
    val c = Nx.colors
    val res = LocalContext.current.resources
    var list by remember { mutableStateOf<List<Submission>?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var tick by remember { mutableStateOf(0) }
    LaunchedEffect(tick) {
        try { list = api.mySubmissions().value.submissions; error = null } catch (e: ApiError) { error = e.describe(res) }
    }
    Column(Modifier.fillMaxSize().background(c.background)) {
        Row(Modifier.fillMaxWidth().padding(4.dp), verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, stringResource(R.string.back)) }
            Text(stringResource(R.string.form_my_submissions), fontFamily = DisplayFont, fontWeight = FontWeight.Bold, fontSize = 18.sp, color = c.foreground)
        }
        val l = list
        when {
            l == null && error == null -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
            l == null -> EmptyState(Icons.Filled.Assignment, stringResource(R.string.form_load_failed), error!!, stringResource(R.string.try_again), { tick++ }, Modifier.fillMaxSize())
            l.isEmpty() -> TabEmpty(Icons.Filled.Assignment, stringResource(R.string.form_no_submissions))
            else -> LazyColumn(contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                items(l, key = { it.id }) { s ->
                    Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(c.card).border(1.dp, c.border, RoundedCornerShape(16.dp))
                        .clickable { onOpen(s.id) }.padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        Text(s.formName ?: s.taskTitle ?: "—", fontSize = 15.sp, fontWeight = FontWeight.SemiBold, color = c.foreground)
                        Text(listOfNotNull(s.projectName, chatTime(s.createdAt)).joinToString(" · "), fontSize = 12.sp, color = c.mutedFg)
                        Row { StageChips(s) }
                    }
                }
            }
        }
    }
}

@Composable
private fun StageChips(s: Submission) {
    val c = Nx.colors
    s.stage?.let { Pill(it, c.blue); Spacer(Modifier.width(6.dp)) }
    Pill(s.procStatus ?: stringResource(R.string.form_not_processed), if (s.procStatus == null) c.mutedFg else c.success)
}

@Composable
fun SubmissionDetailScreen(id: String, onBack: () -> Unit, onOpenTask: (String) -> Unit, onOpenFile: (String) -> Unit) {
    val api = formsApi()
    val c = Nx.colors
    val res = LocalContext.current.resources
    var sub by remember { mutableStateOf<Submission?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(id) { try { sub = api.submission(id) } catch (e: ApiError) { error = e.describe(res) } }
    Column(Modifier.fillMaxSize().background(c.background)) {
        Row(Modifier.fillMaxWidth().padding(4.dp), verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, stringResource(R.string.back)) }
            Text(sub?.formName ?: "", fontFamily = DisplayFont, fontWeight = FontWeight.Bold, fontSize = 18.sp, color = c.foreground, maxLines = 1)
        }
        val s = sub
        when {
            s == null && error == null -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
            s == null -> TabEmpty(Icons.Filled.Assignment, error!!)
            else -> Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Row { StageChips(s) }
                Text(listOfNotNull(s.projectName, chatTime(s.createdAt)).joinToString(" · "), fontSize = 12.sp, color = c.mutedFg)
                s.taskId?.let { tid -> TextButton(onClick = { onOpenTask(tid) }) { Text(s.taskTitle ?: stringResource(R.string.chat_open_task)) } }
                s.answers.forEach { a ->
                    Column(Modifier.fillMaxWidth().background(c.card, RoundedCornerShape(12.dp)).border(1.dp, c.border, RoundedCornerShape(12.dp)).padding(12.dp)) {
                        Text(a.label ?: "—", fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = c.mutedFg)
                        Text(valueText(a.value) ?: "—", fontSize = 14.sp, color = c.foreground)
                    }
                }
                if (s.proofs.isNotEmpty()) {
                    Text(stringResource(R.string.form_proofs), fontFamily = DisplayFont, fontWeight = FontWeight.Bold, fontSize = 15.sp, color = c.foreground)
                    s.proofs.forEach { p -> TextButton(onClick = { p.url?.let(onOpenFile) }) { Text(p.name ?: "file") } }
                }
            }
        }
    }
}

/** The project's Forms tab: open one to fill it in. */
@Composable
fun ProjectFormsTab(projectId: String, onOpenForm: (String) -> Unit) {
    val api = formsApi()
    val c = Nx.colors
    val res = LocalContext.current.resources
    var forms by remember { mutableStateOf<List<FormSummary>?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(projectId) { try { forms = api.projectForms(projectId) } catch (e: ApiError) { error = e.describe(res) } }
    val l = forms
    when {
        l == null && error == null -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
        l == null -> TabEmpty(Icons.Filled.Assignment, error!!)
        l.isEmpty() -> TabEmpty(Icons.Filled.Assignment, stringResource(R.string.form_none_in_project))
        else -> LazyColumn(contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            items(l, key = { it.id }) { f ->
                Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(c.card).border(1.dp, c.border, RoundedCornerShape(16.dp))
                    .clickable { onOpenForm(f.slug ?: f.id) }.padding(12.dp)) {
                    Text(f.name, fontSize = 15.sp, fontWeight = FontWeight.SemiBold, color = c.foreground)
                    f.description?.takeIf { it.isNotBlank() }?.let { Text(it, fontSize = 12.sp, color = c.mutedFg, maxLines = 2) }
                    Text(stringResource(R.string.form_submissions_n, f.count?.submissions ?: 0), fontSize = 11.sp, color = c.mutedFg)
                }
            }
        }
    }
}
