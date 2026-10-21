package id.znetworks.nexus.feature.pipeline

import android.app.Application
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import id.znetworks.nexus.R
import id.znetworks.nexus.core.realtime.LiveRefresh
import id.znetworks.nexus.core.realtime.RealtimeEvents
import id.znetworks.nexus.core.realtime.RealtimeRoom
import id.znetworks.nexus.ui.components.EmptyState
import id.znetworks.nexus.ui.theme.Nx

@Composable
internal fun SourceChip(deal: PipelineDeal) {
    val source = deal.source ?: return
    Text(source.name.removePrefix("Pipeline "), fontSize = 10.sp, color = Nx.colors.mutedFg, maxLines = 1, overflow = TextOverflow.Ellipsis,
        modifier = Modifier.background(Nx.colors.muted, RoundedCornerShape(6.dp)).semantics { contentDescription = source.name }
            .padding(horizontal = 6.dp, vertical = 2.dp))
}

/** A combined deal is loaded and edited through its actual board and that board's access response. */
@Composable
internal fun SourceDealSheet(dealId: String, source: PipelineSource, onOpenProject: (String) -> Unit, onOpenFolder: (String) -> Unit, onClose: () -> Unit) {
    val app = LocalContext.current.applicationContext as Application
    val factory = remember(source.projectId) {
        object : ViewModelProvider.Factory {
            @Suppress("UNCHECKED_CAST")
            override fun <T : ViewModel> create(modelClass: Class<T>): T =
                PipelineViewModel(app, SavedStateHandle(mapOf("id" to source.projectId))) as T
        }
    }
    val vm: PipelineViewModel = viewModel(key = "all-source-${source.projectId}", factory = factory)
    val s by vm.state.collectAsStateWithLifecycle()
    var opened by remember(dealId) { mutableStateOf(false) }
    LaunchedEffect(dealId) { vm.open(dealId); vm.load().join() }
    LaunchedEffect(dealId, s.openDealId) {
        if (s.openDealId == dealId) opened = true
        else if (opened && s.openDealId == null) onClose()
    }
    RealtimeRoom("project:${source.projectId}")
    LiveRefresh(source.projectId, null, 60_000,
        matches = { it.name == RealtimeEvents.PIPELINE_CHANGED && (it.projectId == null || it.projectId == source.projectId) }) { vm.load().join() }
    val data = s.data
    val deal = data?.deals?.firstOrNull { it.id == dealId }
    if (deal != null && data != null) {
        DealSheet(deal, data, s.people, vm, onOpenProject = { onClose(); onOpenProject(it) }, onOpenFolder = { onClose(); onOpenFolder(it) },
            sourceName = source.name, onBackToAll = onClose, onClose = onClose)
        s.notice?.let { message ->
            androidx.compose.material3.AlertDialog(onDismissRequest = vm::dismiss, text = { Text(message) },
                confirmButton = { androidx.compose.material3.TextButton(onClick = vm::dismiss) { Text("OK") } })
        }
    } else Dialog(onDismissRequest = onClose, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Box(Modifier.fillMaxSize().background(Nx.colors.background), contentAlignment = Alignment.Center) {
            if (s.loading) CircularProgressIndicator()
            else EmptyState(Icons.Filled.Lock, stringResource(if (s.forbidden) R.string.pl_forbidden else R.string.pl_load_failed),
                stringResource(R.string.pl_forbidden_sub), stringResource(R.string.pb8_all_pipelines), onClose)
        }
    }
}
