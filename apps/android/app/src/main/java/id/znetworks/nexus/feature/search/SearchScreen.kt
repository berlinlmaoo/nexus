package id.znetworks.nexus.feature.search

import android.app.Application
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
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.Checklist
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Description
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.ViewKanban
import androidx.compose.material.icons.filled.Assignment
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import id.znetworks.nexus.NexusApplication
import id.znetworks.nexus.R
import id.znetworks.nexus.core.net.ApiError
import id.znetworks.nexus.feature.projects.ProjectMark
import id.znetworks.nexus.ui.components.describe
import id.znetworks.nexus.ui.theme.Nx
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable
import java.net.URLEncoder
import java.util.Locale

// GET /api/search?q= (API.md §2.4): scoped to the caller's workspaces.

@Serializable data class TaskHit(val id: String, val title: String = "")
@Serializable data class ProjectHit(val id: String, val name: String = "", val color: String? = null, val icon: String? = null)
@Serializable data class DocHit(val id: String, val title: String = "")
@Serializable data class FormHit(val id: String, val name: String = "")
@Serializable data class MemberHit(val id: String, val name: String? = null, val email: String? = null, val avatar: String? = null)

@Serializable
data class SearchResults(
    val tasks: List<TaskHit> = emptyList(),
    val projects: List<ProjectHit> = emptyList(),
    val docs: List<DocHit> = emptyList(),
    val forms: List<FormHit> = emptyList(),
    val members: List<MemberHit> = emptyList(),
) {
    val isEmpty: Boolean get() = tasks.isEmpty() && projects.isEmpty() && docs.isEmpty() && forms.isEmpty() && members.isEmpty()
}

object SearchRules {
    const val MIN = 2
    const val DEBOUNCE_MS = 300L
    fun searchable(q: String) = q.trim().length >= MIN
}

data class SearchState(val query: String = "", val results: SearchResults? = null, val loading: Boolean = false, val error: String? = null)

class SearchViewModel(app: Application) : AndroidViewModel(app) {
    private val api = (app as NexusApplication).container.api
    private val res get() = getApplication<Application>().resources
    private val _state = MutableStateFlow(SearchState())
    val state = _state.asStateFlow()
    private var job: Job? = null

    fun setQuery(q: String) {
        _state.update { it.copy(query = q) }
        job?.cancel()
        if (!SearchRules.searchable(q)) { _state.update { it.copy(results = null, loading = false, error = null) }; return }
        job = viewModelScope.launch {
            delay(SearchRules.DEBOUNCE_MS)
            _state.update { it.copy(loading = true) }
            try {
                val r = api.get("/api/search?q=${URLEncoder.encode(q.trim(), "UTF-8")}", SearchResults.serializer())
                _state.update { it.copy(results = r, loading = false, error = null) }
            } catch (e: ApiError) {
                _state.update { it.copy(loading = false, error = e.describe(res)) }
            }
        }
    }
}

@Composable
fun SearchScreen(
    onBack: () -> Unit,
    onOpenTask: (String) -> Unit,
    onOpenProject: (String) -> Unit,
    onOpenWeb: (String) -> Unit,
    onOpenForm: (String) -> Unit = { onOpenWeb("/f/$it") },
    onOpenDoc: (String) -> Unit = { onOpenWeb("/docs/$it") },
    onOpenPerson: (String) -> Unit = {},
    vm: SearchViewModel = viewModel(),
) {
    val s by vm.state.collectAsStateWithLifecycle()
    val c = Nx.colors
    val focus = remember { FocusRequester() }
    LaunchedEffect(Unit) { runCatching { focus.requestFocus() } }
    Column(Modifier.fillMaxSize().background(c.background)) {
        Row(Modifier.fillMaxWidth().padding(start = 4.dp, end = 12.dp, top = 4.dp, bottom = 4.dp), verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, stringResource(R.string.back)) }
            OutlinedTextField(
                s.query, vm::setQuery, singleLine = true, leadingIcon = { Icon(Icons.Filled.Search, null) },
                trailingIcon = { if (s.query.isNotEmpty()) IconButton(onClick = { vm.setQuery("") }) { Icon(Icons.Filled.Close, stringResource(R.string.clear_search)) } },
                placeholder = { Text(stringResource(R.string.search_hint)) }, shape = RoundedCornerShape(24.dp),
                modifier = Modifier.weight(1f).focusRequester(focus),
            )
        }
        val r = s.results
        when {
            s.loading && r == null -> Centered { CircularProgressIndicator() }
            !SearchRules.searchable(s.query) -> Placeholder(Icons.Filled.Search, stringResource(if (s.query.isBlank()) R.string.search_start else R.string.search_min))
            s.error != null && r == null -> Placeholder(Icons.Filled.Search, s.error!!)
            r == null -> Centered { CircularProgressIndicator() }
            r.isEmpty -> Placeholder(Icons.Filled.Search, stringResource(R.string.search_none, s.query.trim()))
            else -> LazyColumn(contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                // The project's own mark (its photo, else the grey page), as iOS SearchView; it follows a photo change live.
                group(R.string.search_projects, r.projects) { p -> Hit(Icons.Filled.ViewKanban, c.violet, p.name, null, mark = { ProjectMark(p.icon, 34.dp, projectId = p.id) }) { onOpenProject(p.id) } }
                group(R.string.search_tasks, r.tasks) { t -> Hit(Icons.Filled.Checklist, c.success, t.title, null) { onOpenTask(t.id) } }
                // Docs and forms open on the web until Phase 3 builds them here.
                group(R.string.search_docs, r.docs) { d -> Hit(Icons.Filled.Description, c.violetText, d.title, null) { onOpenDoc(d.id) } }
                group(R.string.search_forms, r.forms) { f -> Hit(Icons.Filled.Assignment, c.blue, f.name, null) { onOpenForm(f.id) } }
                group(R.string.search_members, r.members) { m -> Hit(Icons.Filled.Person, c.danger, m.name ?: m.email ?: "—", m.email) { onOpenPerson(m.id) } }
            }
        }
    }
}

private fun <T> androidx.compose.foundation.lazy.LazyListScope.group(label: Int, items: List<T>, row: @Composable (T) -> Unit) {
    if (items.isEmpty()) return
    item(key = "h$label") {
        Text(androidx.compose.ui.res.stringResource(label).uppercase(Locale.getDefault()), fontSize = 11.sp, fontWeight = FontWeight.Bold, letterSpacing = 0.6.sp,
            color = Nx.colors.mutedFg, modifier = Modifier.padding(start = 4.dp, top = 10.dp))
    }
    items(items) { row(it) }
}

@Composable
private fun Hit(icon: ImageVector, tint: Color, title: String, sub: String?, mark: (@Composable () -> Unit)? = null, onClick: (() -> Unit)?) {
    val c = Nx.colors
    Row(
        Modifier.fillMaxWidth().background(c.card, RoundedCornerShape(14.dp)).border(1.dp, c.border, RoundedCornerShape(14.dp))
            .let { if (onClick != null) it.clickable(onClick = onClick) else it }.padding(12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (mark != null) mark()
        else Box(Modifier.size(34.dp).background(tint.copy(alpha = 0.14f), RoundedCornerShape(10.dp)), contentAlignment = Alignment.Center) {
            Icon(icon, null, tint = tint, modifier = Modifier.size(18.dp))
        }
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Text(title, fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = c.foreground, maxLines = 1, overflow = TextOverflow.Ellipsis)
            if (!sub.isNullOrBlank()) Text(sub, fontSize = 11.sp, color = c.mutedFg, maxLines = 1)
        }
        if (onClick != null) Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, null, tint = c.mutedFg.copy(alpha = 0.5f))
    }
}

@Composable
private fun Centered(content: @Composable () -> Unit) = Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { content() }

@Composable
private fun Placeholder(icon: ImageVector, text: String) {
    val c = Nx.colors
    Column(Modifier.fillMaxSize().padding(32.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
        Icon(icon, null, tint = c.mutedFg.copy(alpha = 0.5f), modifier = Modifier.size(40.dp))
        Spacer(Modifier.size(8.dp))
        Text(text, fontSize = 13.sp, color = c.mutedFg, textAlign = TextAlign.Center)
    }
}
