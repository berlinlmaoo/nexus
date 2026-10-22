package id.znetworks.nexus.feature.pipeline

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.outlined.Visibility
import androidx.compose.material.icons.outlined.VisibilityOff
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import id.znetworks.nexus.NexusApplication
import id.znetworks.nexus.R
import id.znetworks.nexus.core.Viewer
import id.znetworks.nexus.core.net.ApiClient
import id.znetworks.nexus.core.net.ApiError
import id.znetworks.nexus.core.realtime.LiveRefresh
import id.znetworks.nexus.core.realtime.RealtimeEvents
import id.znetworks.nexus.feature.projects.ProjectTitle
import id.znetworks.nexus.ui.components.HeaderIconButton
import id.znetworks.nexus.ui.theme.Nx

const val ALL_PIPELINES_ID = "all-pipelines"

/** In-memory display state shared by boards; never written to preferences or saved instance state. */
object PipelineSession {
    val presentation = mutableStateOf(false)
}

object PipelineAllAccess {
    /** A denial from either combined endpoint immediately hides every already-rendered entry. */
    val denied = mutableStateOf(false)
    fun hide() { denied.value = true }

    /** Members establishes the workspace role; boards independently verifies it before any entry appears. */
    suspend fun load(api: ApiClient, viewer: Viewer): PipelineBoards? {
        viewer.load()
        if (!viewer.isBoD) { hide(); return null }
        return try {
            PipelineApi(api).boards().also { denied.value = false }
        } catch (e: ApiError) {
            if ((e as? ApiError.Http)?.status == 403) hide()
            null
        }
    }
}

/** A plain title for other roles and a verified board switcher for BoD / One Above All. */
@Composable
fun PipelineBoardTitle(name: String, currentId: String, onOpenBoard: (String) -> Unit) {
    val container = (LocalContext.current.applicationContext as NexusApplication).container
    var access by remember(currentId) { mutableStateOf<PipelineBoards?>(null) }
    LiveRefresh("pipeline-switcher-$currentId", liveMs = null, fallbackMs = null,
        matches = { it.name == RealtimeEvents.WORKSPACE_CHANGED }, refreshOnResume = true, debounceMs = 300) {
        access = PipelineAllAccess.load(container.api, container.viewer)
    }
    PipelineBoardSwitcher(name, currentId, access?.boards?.takeUnless { PipelineAllAccess.denied.value }, onOpenBoard)
}

@Composable
internal fun PipelineBoardSwitcher(name: String, currentId: String, boards: List<PipelineBoard>?, onOpenBoard: (String) -> Unit) {
    val c = Nx.colors
    var menu by remember { mutableStateOf(false) }
    var confirm by remember { mutableStateOf(false) }
    val label = stringResource(R.string.pb8_switch_board)
    Box(Modifier.fillMaxWidth()) {
        Row(Modifier.fillMaxWidth().then(if (boards != null) Modifier.clickable { menu = true }.semantics { contentDescription = label } else Modifier), verticalAlignment = Alignment.CenterVertically) {
            ProjectTitle(name, Modifier.weight(1f))
            if (boards != null) Icon(Icons.Filled.KeyboardArrowDown, null, tint = c.mutedFg, modifier = Modifier.size(20.dp))
        }
        DropdownMenu(menu && boards != null, { menu = false }) {
            Text(stringResource(R.string.pb8_pipeline_boards), fontSize = 11.sp, color = c.mutedFg, fontWeight = FontWeight.Bold,
                modifier = Modifier.padding(horizontal = 12.dp, vertical = 6.dp))
            boards.orEmpty().forEach { board ->
                DropdownMenuItem(text = { Text(board.name, maxLines = 1, overflow = TextOverflow.Ellipsis) },
                    leadingIcon = { if (board.id == currentId) Icon(Icons.Filled.Check, null, tint = c.violetText) else Spacer(Modifier.size(24.dp)) },
                    trailingIcon = { Text(pluralStringResource(R.plurals.pl_n_deals, board.dealCount, board.dealCount), fontSize = 11.sp, color = c.mutedFg) },
                    onClick = { menu = false; if (board.id != currentId) onOpenBoard(board.id) })
            }
            HorizontalDivider(color = c.border)
            DropdownMenuItem(text = { Text(stringResource(R.string.pb8_all_pipelines)) },
                leadingIcon = { if (currentId == ALL_PIPELINES_ID) Icon(Icons.Filled.Check, null, tint = c.violetText) else Spacer(Modifier.size(24.dp)) },
                onClick = {
                    menu = false
                    if (currentId != ALL_PIPELINES_ID) {
                        if (PipelineSession.presentation.value) confirm = true else onOpenBoard(ALL_PIPELINES_ID)
                    }
                })
        }
    }
    ShowAllCompaniesDialog(confirm, { confirm = false }) { confirm = false; onOpenBoard(ALL_PIPELINES_ID) }
}

@Composable
fun ShowAllCompaniesDialog(visible: Boolean, onDismiss: () -> Unit, onConfirm: () -> Unit) {
    if (!visible) return
    AlertDialog(onDismissRequest = onDismiss,
        title = { Text(stringResource(R.string.pb8_show_all_title)) },
        text = { Text(stringResource(R.string.pb8_show_all_body)) },
        confirmButton = { TextButton(onClick = onConfirm) { Text(stringResource(R.string.pb8_show_all)) } },
        dismissButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.cancel)) } })
}

/** The combined route deliberately bypasses the project detail API: it is a view, not a project. */
@Composable
fun AllPipelinesScreen(onBack: () -> Unit, onOpenProject: (String) -> Unit, onOpenFolder: (String) -> Unit) {
    val c = Nx.colors
    var presenting by PipelineSession.presentation
    Column(Modifier.fillMaxSize()) {
        Row(Modifier.fillMaxWidth().padding(start = 4.dp, end = 12.dp, top = 12.dp, bottom = 12.dp), verticalAlignment = Alignment.Top) {
            HeaderIconButton(Icons.AutoMirrored.Filled.ArrowBack, stringResource(R.string.back), onBack)
            Spacer(Modifier.width(6.dp))
            Column(Modifier.weight(1f).padding(top = 8.dp), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                PipelineBoardTitle(stringResource(R.string.pb8_all_pipelines), ALL_PIPELINES_ID, onOpenProject)
                Text(stringResource(R.string.pb8_combined_subtitle), fontSize = 12.sp, color = c.mutedFg)
            }
            HeaderIconButton(if (presenting) Icons.Outlined.VisibilityOff else Icons.Outlined.Visibility,
                stringResource(if (presenting) R.string.pl_show_amounts else R.string.pl_hide_amounts), { presenting = !presenting })
        }
        HorizontalDivider(color = c.border)
        PipelineTab(0, onOpenProject, onOpenFolder, presentation = presenting)
    }
}
