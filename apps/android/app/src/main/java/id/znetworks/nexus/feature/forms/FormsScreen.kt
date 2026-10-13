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
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Description
import androidx.compose.material.icons.filled.Inbox
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import id.znetworks.nexus.NexusApplication
import id.znetworks.nexus.R
import id.znetworks.nexus.core.net.ApiError
import id.znetworks.nexus.feature.projects.Pill
import id.znetworks.nexus.feature.projects.ProjectsApi
import id.znetworks.nexus.ui.components.EmptyState
import id.znetworks.nexus.ui.components.describe
import id.znetworks.nexus.ui.theme.DisplayFont
import id.znetworks.nexus.ui.theme.Nx

/** More › Forms (iOS FormsView, web forms.tsx): the intake forms of every project the person is in. */
@Composable
fun FormsScreen(onBack: () -> Unit, onOpenForm: (String) -> Unit) {
    val ctx = LocalContext.current
    val container = (ctx.applicationContext as NexusApplication).container
    val formsApi = remember { FormsApi(ctx.applicationContext, container.api, container.sessionStore) }
    val projectsApi = remember { ProjectsApi(container.api) }
    val c = Nx.colors
    val res = ctx.resources
    var forms by remember { mutableStateOf<List<Pair<FormSummary, String?>>?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var reload by remember { mutableIntStateOf(0) }
    LaunchedEffect(reload) {
        error = null
        try {
            val projects = projectsApi.projects().value
            // One project's failure costs only that project's forms, as on iOS.
            forms = projects.flatMap { p -> runCatching { formsApi.projectForms(p.id) }.getOrDefault(emptyList()).map { it to p.name } }
        } catch (e: ApiError) {
            error = e.describe(res).ifBlank { res.getString(R.string.fm_load_error) }
        }
    }
    Column(Modifier.fillMaxSize().background(c.background)) {
        id.znetworks.nexus.ui.components.PageHeader(stringResource(R.string.mt_forms), subtitle = stringResource(R.string.sub_forms), onBack = onBack)
        val l = forms
        when {
            error != null -> EmptyState(Icons.Filled.Description, stringResource(R.string.fm_load_error), error!!, stringResource(R.string.try_again), { reload++ })
            l == null -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
            l.isEmpty() -> EmptyState(Icons.Filled.Description, stringResource(R.string.fm_empty_title), stringResource(R.string.fm_empty_body), stringResource(R.string.try_again), { reload++ })
            else -> LazyColumn(contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                item { Text(stringResource(R.string.fm_intro), fontSize = 12.sp, color = c.mutedFg) }
                items(l, key = { it.first.id }) { (f, project) -> FormCard(f, project ?: stringResource(R.string.fm_project)) { onOpenForm(f.slug ?: f.id) } }
            }
        }
    }
}

/** iOS FormCard: doc icon, name, project, Public chip, description, submission count. */
@Composable
private fun FormCard(f: FormSummary, project: String, onClick: () -> Unit) {
    val c = Nx.colors
    val shape = RoundedCornerShape(18.dp)
    Column(Modifier.fillMaxWidth().clip(shape).background(c.card).border(1.dp, c.border, shape).clickable(onClick = onClick).padding(14.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Row(verticalAlignment = Alignment.Top) {
            Box(Modifier.size(36.dp).background(c.violet.copy(alpha = 0.12f), RoundedCornerShape(12.dp)), contentAlignment = Alignment.Center) {
                Icon(Icons.Filled.Description, null, tint = c.violetText, modifier = Modifier.size(18.dp))
            }
            Spacer(Modifier.width(10.dp))
            Column(Modifier.weight(1f)) {
                Text(f.name, fontFamily = DisplayFont, fontWeight = FontWeight.Bold, fontSize = 15.sp, color = c.foreground, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(project, fontSize = 12.sp, color = c.mutedFg)
            }
            if (f.isPublic == true) Pill(stringResource(R.string.fm_public), c.success)
        }
        f.description?.takeIf { it.isNotBlank() }?.let { Text(it, fontSize = 13.sp, color = c.mutedFg, maxLines = 2, overflow = TextOverflow.Ellipsis) }
        Row(verticalAlignment = Alignment.CenterVertically) {
            Icon(Icons.Filled.Inbox, null, tint = c.mutedFg, modifier = Modifier.size(12.dp))
            Spacer(Modifier.width(6.dp))
            Text(stringResource(R.string.form_submissions_n, f.count?.submissions ?: 0), fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = c.mutedFg, textAlign = TextAlign.Start)
        }
    }
}
