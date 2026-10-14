package id.znetworks.nexus.feature.vault

import id.znetworks.nexus.ui.components.PageHeader
import id.znetworks.nexus.ui.components.HeaderIconButton
import androidx.compose.foundation.lazy.grid.items as gridItems
import androidx.compose.ui.graphics.Color
import id.znetworks.nexus.ui.components.PendingConfirm
import id.znetworks.nexus.ui.components.ConfirmDialog
import android.app.Application
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.CreateNewFolder
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Description
import androidx.compose.material.icons.filled.Folder
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Upload
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import id.znetworks.nexus.NexusApplication
import id.znetworks.nexus.R
import id.znetworks.nexus.core.files.FileOpener
import id.znetworks.nexus.core.net.ApiError
import id.znetworks.nexus.feature.chat.chatTime
import id.znetworks.nexus.feature.projects.Pill
import id.znetworks.nexus.feature.projects.TabEmpty
import id.znetworks.nexus.feature.tasks.sizeText
import id.znetworks.nexus.ui.components.EmptyState
import id.znetworks.nexus.ui.components.RemoteImage
import id.znetworks.nexus.ui.components.describe
import id.znetworks.nexus.ui.theme.DisplayFont
import id.znetworks.nexus.ui.theme.Nx
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

data class VaultState(
    val list: VaultList? = null,
    val loading: Boolean = true,
    val error: String? = null,
    val query: String = "",
    val upload: Pair<String, Float>? = null,
    val busy: Boolean = false,
    val notice: String? = null,
    val opening: String? = null,
)

class VaultViewModel(app: Application, handle: SavedStateHandle) : AndroidViewModel(app) {
    val folder: String? = handle.get<String>("folder")?.takeIf { it.isNotBlank() }
    val trash: Boolean = handle.get<String>("trash") == "1"
    private val c = (app as NexusApplication).container
    val api = VaultApi(c.api, c.uploads)
    private val res get() = getApplication<Application>().resources
    private val _state = MutableStateFlow(VaultState())
    val state = _state.asStateFlow()

    init { load() }

    fun load() = viewModelScope.launch {
        try {
            val l = api.list(folder, trash, _state.value.query.ifBlank { null })
            _state.update { it.copy(list = l, loading = false, error = null) }
        } catch (e: ApiError) { _state.update { it.copy(loading = false, error = if (it.list == null) e.describe(res) else null, notice = if (it.list != null) e.describe(res) else null) } }
    }

    fun search(q: String) { _state.update { it.copy(query = q) }; load() }
    fun dismiss() = _state.update { it.copy(notice = null) }

    private fun act(block: suspend () -> Unit) = viewModelScope.launch {
        _state.update { it.copy(busy = true) }
        try { block() } catch (e: ApiError) { _state.update { it.copy(notice = (e as? ApiError.Http)?.serverMessage ?: e.describe(res)) } }
        _state.update { it.copy(busy = false) }
        load()
    }

    fun newFolder(name: String) = act { api.createFolder(name, folder) }
    fun rename(i: VaultItem, name: String) = act { api.rename(i.id, name) }
    fun delete(i: VaultItem) = act { api.delete(i.id, purge = trash) }
    fun restore(i: VaultItem) = act { api.restore(i.id) }
    fun emptyTrash() = act { api.emptyTrash() }

    /**
     * Many files, one after another (the server limits concurrent chunk sessions; VAULT-MOVE-DND). A file
     * that can't be read or is too big is said and skipped; a server refusal (507 "Vault penuh…") stops the rest.
     */
    fun upload(uris: List<Uri>) {
        if (uris.isEmpty()) return
        viewModelScope.launch {
            var done = 0
            for (uri in uris) {
                val picked = c.uploads.describe(uri)
                if (picked == null || picked.size > VaultRules.MAX_FILE) {
                    _state.update { it.copy(notice = res.getString(if (picked == null) R.string.td_file_unreadable else R.string.vault_too_big)) }; continue
                }
                _state.update { it.copy(upload = picked.name to 0f) }
                try {
                    withContext(Dispatchers.IO) { api.upload(picked, folder) { d, t -> _state.update { it.copy(upload = picked.name to (if (t > 0) d.toFloat() / t else 0f)) } } }
                    done++
                } catch (e: ApiError) {
                    _state.update { it.copy(notice = (e as? ApiError.Http)?.serverMessage ?: res.getString(R.string.td_upload_failed)) }
                    break
                }
            }
            _state.update { it.copy(upload = null) }
            if (done > 1 && _state.value.notice == null) _state.update { it.copy(notice = res.getQuantityString(R.plurals.vm_uploaded, done, done, here())) }
            load()
        }
    }

    /** The folder on screen's name ("Vault" at the top). */
    fun here(): String = _state.value.list?.breadcrumb?.lastOrNull()?.name ?: "Vault"

    /** After Move to…: "“INTOO (2)” moved to Vault" (the returned name: a clash got a suffix), then the fresh list. */
    fun moved(item: VaultItem, folderName: String) { _state.update { it.copy(notice = res.getString(R.string.vm_moved, item.name, folderName)) }; load() }

    /** Raw bytes need the session: downloaded by the app, never handed to a browser. */
    fun open(i: VaultItem, share: Boolean) {
        val url = i.url ?: return
        viewModelScope.launch {
            _state.update { it.copy(opening = i.id) }
            try {
                if (!FileOpener.open(getApplication(), c.api, "$url?v=${i.updatedAt.orEmpty().hashCode()}", i.name, i.mimeType, share))
                    _state.update { it.copy(notice = res.getString(R.string.td_no_viewer)) }
            } catch (e: ApiError) { _state.update { it.copy(notice = e.describe(res)) } }
            _state.update { it.copy(opening = null) }
        }
    }
}

@Composable
fun VaultScreen(onBack: () -> Unit, onOpenFolder: (String) -> Unit, onOpenTrash: () -> Unit, vm: VaultViewModel = viewModel()) {
    val s by vm.state.collectAsStateWithLifecycle()
    val c = Nx.colors
    var naming by remember { mutableStateOf<VaultItem?>(null) }
    var creating by remember { mutableStateOf(false) }
    var sharing by remember { mutableStateOf<VaultItem?>(null) }
    var confirm by remember { mutableStateOf<VaultItem?>(null) }
    var confirmEmpty by remember { mutableStateOf(false) }
    var q by rememberSaveable { mutableStateOf("") }
    val pick = rememberLauncherForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { vm.upload(it) }
    var moving by remember { mutableStateOf<VaultItem?>(null) }
    var viewing by remember { mutableStateOf<Int?>(null) }
    // Any vault change in the company (upload, move, trash, …): refetch this folder (VAULT-MOVE-DND). The
    // screen's own fallback pace covers a server without the ping.
    id.znetworks.nexus.core.realtime.LiveRefresh(vm.folder to vm.trash, liveMs = null, fallbackMs = 60_000,
        matches = { it.name == id.znetworks.nexus.core.realtime.RealtimeEvents.WORKSPACE_CHANGED && it.kind == "vault" }) { vm.load().join() }
    LaunchedEffect(q) { if (q != s.query) { kotlinx.coroutines.delay(300); vm.search(q) } }
    val l = s.list
    Column(Modifier.fillMaxSize().background(c.background)) {
        // The shelf's subtitle at the root only; a folder or the trash is named by its title.
        PageHeader(if (vm.trash) stringResource(R.string.vault_trash) else l?.breadcrumb?.lastOrNull()?.name ?: "Z Vault",
            subtitle = if (!vm.trash && vm.folder == null) stringResource(R.string.sub_vault) else null, onBack = onBack) {
            if (s.busy) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
            if (vm.trash && l?.items?.isNotEmpty() == true) TextButton(onClick = { confirmEmpty = true }) { Text(stringResource(R.string.vault_empty_trash), color = c.danger) }
        }
        // iOS phoneHeader: Trash · Folder · Upload as labelled buttons (they were three bare icons); Upload is the primary.
        if (!vm.trash && (vm.folder == null || l?.canWrite == true)) {
            Row(Modifier.padding(horizontal = 16.dp, vertical = 4.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                if (vm.folder == null) id.znetworks.nexus.ui.components.NxButton(stringResource(R.string.vault_trash), onOpenTrash, compact = true, icon = Icons.Filled.Delete)
                if (l?.canWrite == true) {
                    id.znetworks.nexus.ui.components.NxButton(stringResource(R.string.vault_folder_short), { creating = true }, compact = true, icon = Icons.Filled.CreateNewFolder)
                    id.znetworks.nexus.ui.components.NxButton(stringResource(R.string.td_upload), { pick.launch(arrayOf("*/*")) }, compact = true, icon = Icons.Filled.Upload,
                        kind = id.znetworks.nexus.ui.components.NxButtonKind.PRIMARY, enabled = s.upload == null)
                }
            }
        }
        if (!vm.trash) {
            if (l != null && l.breadcrumb.size > 1) Row(Modifier.horizontalScroll(rememberScrollState()).padding(horizontal = 16.dp)) {
                Text(l.breadcrumb.joinToString(" › ") { it.name }, fontSize = 12.sp, color = c.mutedFg)
            }
            id.znetworks.nexus.ui.components.CompactSearchField(q, { q = it }, stringResource(R.string.vault_search), Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 6.dp))
        }
        // The shelf's use against its 5 GB, in every mode (trash counts too); red past 90 % (web).
        VaultRules.usage(l?.quota)?.let { u ->
            Column(Modifier.padding(horizontal = 16.dp, vertical = 4.dp)) {
                LinearProgressIndicator(progress = { u.percent / 100f }, color = if (u.nearlyFull) c.dangerText else c.onyx, trackColor = c.muted,
                    // No Material stop dot at the far end: with a tiny share used it read as a lone dot (run 5).
                    drawStopIndicator = {}, gapSize = 0.dp,
                    modifier = Modifier.fillMaxWidth().height(6.dp).clip(CircleShape))
                Text(stringResource(R.string.vault_quota, VaultRules.humanSize(u.used), VaultRules.humanSize(u.total)), fontSize = 12.sp, color = c.mutedFg,
                    modifier = Modifier.padding(top = 4.dp))
            }
        }
        if (vm.trash) Text(stringResource(R.string.vault_trash_note), fontSize = 13.sp, color = c.mutedFg,
            modifier = Modifier.padding(horizontal = 16.dp, vertical = 6.dp).fillMaxWidth().clip(RoundedCornerShape(10.dp)).background(c.muted).padding(10.dp))
        s.upload?.let { (name, p) ->
            Column(Modifier.padding(horizontal = 16.dp, vertical = 6.dp)) {
                Text(stringResource(R.string.td_uploading, name), fontSize = 12.sp, color = c.mutedFg, maxLines = 1)
                LinearProgressIndicator(progress = { p }, modifier = Modifier.fillMaxWidth())
            }
        }
        Box(Modifier.weight(1f)) {
            when {
                s.loading && l == null -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
                l == null -> EmptyState(Icons.Filled.Lock, stringResource(R.string.vault_load_failed), s.error.orEmpty(), stringResource(R.string.try_again), { vm.load() }, Modifier.fillMaxSize())
                // Why it is empty and the next step, with the action right there.
                l.items.isEmpty() && vm.trash -> EmptyState(Icons.Filled.Folder, stringResource(R.string.vault_trash_empty), stringResource(R.string.vault_trash_empty_sub),
                    stringResource(R.string.back), onBack, Modifier.fillMaxSize())
                l.items.isEmpty() && s.query.isNotBlank() -> EmptyState(Icons.Filled.Search, stringResource(R.string.docs_no_match), stringResource(R.string.vault_no_match_sub),
                    stringResource(R.string.vault_clear_search), { q = "" }, Modifier.fillMaxSize())
                l.items.isEmpty() -> EmptyState(Icons.Filled.Folder, stringResource(R.string.vault_empty_title), stringResource(R.string.vault_empty),
                    stringResource(R.string.td_upload), { pick.launch(arrayOf("*/*")) }, Modifier.fillMaxSize())
                else -> PullToRefreshBox(isRefreshing = false, onRefresh = { vm.load() }) {
                    // Trash: a plain list. A folder: folders (rows), then pictures and films (a square grid), then other files (rows).
                    val g = VaultRules.gallery(l.items)
                    val media = if (vm.trash) emptyList() else g.media
                    val itemRow: @Composable (VaultItem) -> Unit = { i ->
                            var menu by remember { mutableStateOf(false) }
                        // One Column: a grid cell stacks its children like a Box, so the divider sat on top of the row.
                        Column {
                        Row(Modifier.fillMaxWidth().clickable {
                            when { vm.trash -> Unit; i.isFolder -> onOpenFolder(i.id); i.isMedia -> viewing = media.indexOf(i); else -> vm.open(i, false) }
                        }.padding(horizontal = 16.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                            Box(Modifier.size(42.dp).background(if (i.isFolder) c.violet.copy(alpha = 0.14f) else c.muted, RoundedCornerShape(12.dp)), contentAlignment = Alignment.Center) {
                                // The server's small thumbnail (never the whole file); without one, the type icon.
                                    val t = VaultRules.thumb(i, 160)
                                    if (t != null) RemoteImage(t, Modifier.size(42.dp).clip(RoundedCornerShape(12.dp)), ContentScale.Crop, maxPx = 160)
                                else Icon(if (i.isFolder) Icons.Filled.Folder else Icons.Filled.Description, null, tint = if (i.isFolder) c.violetText else c.mutedFg)
                            }
                            Spacer(Modifier.width(12.dp))
                            Column(Modifier.weight(1f)) {
                                Text(i.name, fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = c.foreground, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                Text(listOfNotNull(if (i.isFolder) stringResource(R.string.vault_items_n, i.childCount ?: 0) else sizeText(i.size),
                                    chatTime(i.deletedAt ?: i.updatedAt).takeIf { it.isNotBlank() }).joinToString(" · "), fontSize = 11.sp, color = c.mutedFg)
                            }
                            if ((i.shareCount ?: 0) > 0) { Pill("🔗 ${i.shareCount}", c.blue); Spacer(Modifier.width(4.dp)) }
                            if (s.opening == i.id) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
                            Box {
                                IconButton(onClick = { menu = true }) { Icon(Icons.Filled.MoreVert, stringResource(R.string.more), tint = c.mutedFg) }
                                DropdownMenu(menu, { menu = false }) {
                                    if (vm.trash) {
                                        DropdownMenuItem(text = { Text(stringResource(R.string.vault_restore)) }, onClick = { menu = false; vm.restore(i) })
                                        DropdownMenuItem(text = { Text(stringResource(R.string.vault_delete_forever), color = c.danger) }, onClick = { menu = false; confirm = i })
                                    } else {
                                        if (!i.isFolder) {
                                            DropdownMenuItem(text = { Text(stringResource(R.string.td_open_file)) }, onClick = { menu = false; vm.open(i, false) })
                                            DropdownMenuItem(text = { Text(stringResource(R.string.td_save_share)) }, onClick = { menu = false; vm.open(i, true) })
                                            DropdownMenuItem(text = { Text(stringResource(R.string.vault_share_link)) }, onClick = { menu = false; sharing = i })
                                        }
                                        if (i.canModify == true) {
                                            DropdownMenuItem(text = { Text(stringResource(R.string.vm_menu)) }, onClick = { menu = false; moving = i })
                                            DropdownMenuItem(text = { Text(stringResource(R.string.vault_rename)) }, onClick = { menu = false; naming = i })
                                            DropdownMenuItem(text = { Text(stringResource(R.string.vault_to_trash), color = c.danger) }, onClick = { menu = false; confirm = i })
                                        }
                                    }
                                }
                            }
                        }
                        HorizontalDivider(color = c.border.copy(alpha = 0.5f), modifier = Modifier.padding(start = 70.dp))
                        }
                    }
                    if (vm.trash) LazyColumn(contentPadding = PaddingValues(vertical = 8.dp)) { items(VaultRules.sorted(l.items), key = { it.id }) { itemRow(it) } }
                    else androidx.compose.foundation.lazy.grid.LazyVerticalGrid(androidx.compose.foundation.lazy.grid.GridCells.Fixed(3), contentPadding = PaddingValues(vertical = 8.dp),
                        horizontalArrangement = Arrangement.spacedBy(4.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        val full: (androidx.compose.foundation.lazy.grid.LazyGridItemSpanScope.() -> androidx.compose.foundation.lazy.grid.GridItemSpan) = { androidx.compose.foundation.lazy.grid.GridItemSpan(maxLineSpan) }
                        gridItems(g.folders, key = { it.id }, span = { full() }) { itemRow(it) }
                        if (media.isNotEmpty()) item(key = "media-title", span = { full() }) {
                            Text(stringResource(R.string.vm_photos_videos), fontSize = 12.sp, fontWeight = FontWeight.Bold, color = c.mutedFg, modifier = Modifier.padding(horizontal = 16.dp, vertical = 6.dp))
                        }
                        gridItems(media, key = { it.id }) { i ->
                            Box(Modifier.padding(horizontal = 2.dp)) {
                                VaultTile(i, onOpen = { viewing = media.indexOf(i) }) {
                                    var menu by remember { mutableStateOf(false) }
                                    IconButton(onClick = { menu = true }) { Icon(Icons.Filled.MoreVert, stringResource(R.string.more), tint = Color.White) }
                                    DropdownMenu(menu, { menu = false }) {
                                        DropdownMenuItem(text = { Text(stringResource(R.string.td_save_share)) }, onClick = { menu = false; vm.open(i, true) })
                                        DropdownMenuItem(text = { Text(stringResource(R.string.vault_share_link)) }, onClick = { menu = false; sharing = i })
                                        if (i.canModify == true) {
                                            DropdownMenuItem(text = { Text(stringResource(R.string.vm_menu)) }, onClick = { menu = false; moving = i })
                                            DropdownMenuItem(text = { Text(stringResource(R.string.vault_rename)) }, onClick = { menu = false; naming = i })
                                            DropdownMenuItem(text = { Text(stringResource(R.string.vault_to_trash), color = c.danger) }, onClick = { menu = false; confirm = i })
                                        }
                                    }
                                }
                            }
                        }
                        gridItems(g.files, key = { it.id }, span = { full() }) { itemRow(it) }
                    }
                }
            }
        }
    }
    s.notice?.let { AlertDialog(onDismissRequest = vm::dismiss, text = { Text(it) }, confirmButton = { TextButton(onClick = vm::dismiss) { Text("OK") } }) }
    if (creating || naming != null) {
        var name by rememberSaveable { mutableStateOf(naming?.name.orEmpty()) }
        AlertDialog(onDismissRequest = { creating = false; naming = null }, title = { Text(stringResource(if (naming != null) R.string.vault_rename else R.string.vault_new_folder)) },
            text = { OutlinedTextField(name, { name = it }, singleLine = true, modifier = Modifier.fillMaxWidth()) },
            confirmButton = { TextButton(onClick = { naming?.let { vm.rename(it, name) } ?: vm.newFolder(name); creating = false; naming = null }, enabled = name.isNotBlank()) { Text(stringResource(R.string.save)) } },
            dismissButton = { TextButton(onClick = { creating = false; naming = null }) { Text(stringResource(R.string.cancel)) } })
    }
    confirm?.let { i ->
        AlertDialog(onDismissRequest = { confirm = null },
            title = { Text(stringResource(if (vm.trash) R.string.vault_delete_forever_q else R.string.vault_to_trash_q, i.name)) },
            text = { Text(stringResource(if (vm.trash) R.string.vault_delete_forever_body else R.string.vault_to_trash_body)) },
            confirmButton = { TextButton(onClick = { confirm = null; vm.delete(i) }) { Text(stringResource(R.string.delete), color = c.danger) } },
            dismissButton = { TextButton(onClick = { confirm = null }) { Text(stringResource(R.string.cancel)) } })
    }
    if (confirmEmpty) AlertDialog(onDismissRequest = { confirmEmpty = false }, title = { Text(stringResource(R.string.vault_empty_trash_q)) },
        text = { Text(stringResource(R.string.vault_delete_forever_body)) },
        confirmButton = { TextButton(onClick = { confirmEmpty = false; vm.emptyTrash() }) { Text(stringResource(R.string.vault_empty_trash), color = c.danger) } },
        dismissButton = { TextButton(onClick = { confirmEmpty = false }) { Text(stringResource(R.string.cancel)) } })
    sharing?.let { ShareDialog(it, vm.api, s.list?.canManageAccess == true || it.canModify == true) { sharing = null } }
    moving?.let { i -> VaultMoveDialog(i, vm.api, onDismiss = { moving = null }) { item, folderName -> moving = null; vm.moved(item, folderName) } }
    viewing?.let { start ->
        val media = s.list?.items?.let { VaultRules.gallery(it).media }.orEmpty()
        if (media.isNotEmpty()) VaultViewer(media, start, onClose = { viewing = null }, onSave = { vm.open(it, true) }, onShare = { sharing = it })
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun ShareDialog(item: VaultItem, api: VaultApi, canExternal: Boolean, onClose: () -> Unit) {
    val c = Nx.colors
    val res = LocalContext.current.resources
    val clipboard = LocalClipboardManager.current
    val scope = rememberCoroutineScope()
    var shares by remember { mutableStateOf<List<VaultShare>?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var internal by remember { mutableStateOf(true) }
    var download by remember { mutableStateOf(true) }
    var expires by remember { mutableStateOf("permanent") }
    var tick by remember { mutableStateOf(0) }
    var askRevoke by remember { mutableStateOf<PendingConfirm?>(null) }
    val revokeTitle = stringResource(R.string.cf_revoke_link)
    val revokeMsg = stringResource(R.string.cf_revoke_link_body)
    val revokeAction = stringResource(R.string.vault_revoke)
    ConfirmDialog(askRevoke) { askRevoke = null }
    LaunchedEffect(item.id, tick) { shares = runCatching { api.shares(item.id) }.getOrDefault(emptyList()) }
    AlertDialog(
        onDismissRequest = onClose,
        title = { Text(stringResource(R.string.vault_share_link)) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(item.name, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = c.foreground)
                shares?.filter { it.status == "active" }?.forEach { sh ->
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text(sh.url, fontSize = 12.sp, color = c.violetText, maxLines = 1, overflow = TextOverflow.Ellipsis,
                                modifier = Modifier.clickable { clipboard.setText(AnnotatedString(sh.url)) })
                            Text(listOfNotNull(stringResource(if (sh.requireAuth) R.string.vault_internal else R.string.vault_external),
                                stringResource(R.string.vault_views, sh.viewCount), sh.expiresAt?.let { chatTime(it) }).joinToString(" · "), fontSize = 11.sp, color = c.mutedFg)
                        }
                        TextButton(onClick = { askRevoke = PendingConfirm(revokeTitle, revokeMsg, revokeAction) { scope.launch { runCatching { api.revoke(sh.id) }.onFailure { e -> error = (e as? ApiError)?.describe(res) }; tick++ } } }) {
                            Text(stringResource(R.string.vault_revoke), color = c.danger, fontSize = 12.sp)
                        }
                    }
                }
                HorizontalDivider(color = c.border)
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(stringResource(R.string.vault_members_only), fontSize = 13.sp, color = c.foreground, modifier = Modifier.weight(1f))
                    // A public (/s/) link needs modify rights on the server.
                    Switch(internal, { if (canExternal || it) internal = it })
                }
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(stringResource(R.string.vault_allow_download), fontSize = 13.sp, color = c.foreground, modifier = Modifier.weight(1f))
                    Switch(download, { download = it })
                }
                FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    VaultRules.EXPIRES.forEach { e -> FilterChip(expires == e, { expires = e }, { Text(if (e == "permanent") stringResource(R.string.vault_permanent) else e, fontSize = 12.sp) }) }
                }
                error?.let { Text(it, color = c.danger, fontSize = 12.sp) }
            }
        },
        confirmButton = {
            TextButton(onClick = {
                scope.launch {
                    try {
                        val sh = api.share(item.id, internal, download, expires)
                        clipboard.setText(AnnotatedString(sh.url)); error = null; tick++
                    } catch (e: ApiError) { error = (e as? ApiError.Http)?.serverMessage ?: e.describe(res) }
                }
            }) { Text(stringResource(R.string.vault_create_link)) }
        },
        dismissButton = { TextButton(onClick = onClose) { Text(stringResource(R.string.close)) } },
    )
}

/** A `/v/<slug>` link opened in the app: what was shared, and open/download it with the session. */
@Composable
fun VaultPublicScreen(slug: String, onBack: () -> Unit) {
    val c = Nx.colors
    val context = LocalContext.current
    val container = (context.applicationContext as NexusApplication).container
    val api = remember { VaultApi(container.api, container.uploads) }
    val res = context.resources
    val scope = rememberCoroutineScope()
    var p by remember { mutableStateOf<VaultPublic?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(slug) { try { p = api.public(slug) } catch (e: ApiError) { error = (e as? ApiError.Http)?.serverMessage ?: e.describe(res) } }
    Column(Modifier.fillMaxSize().background(c.background)) {
        Row(Modifier.fillMaxWidth().padding(4.dp), verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, stringResource(R.string.back)) }
            Text("Z Vault", fontFamily = DisplayFont, fontWeight = FontWeight.Bold, fontSize = 18.sp, color = c.foreground)
        }
        val v = p
        when {
            v == null && error == null -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
            v == null -> TabEmpty(Icons.Filled.Lock, error!!)
            else -> Column(Modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                if (v.file.mimeType.orEmpty().startsWith("image/") && v.previewUrl != null)
                    RemoteImage(v.previewUrl, Modifier.fillMaxWidth().height(320.dp).clip(RoundedCornerShape(16.dp)), ContentScale.Fit, maxPx = 1600)
                Text(v.file.name, fontFamily = DisplayFont, fontWeight = FontWeight.Bold, fontSize = 18.sp, color = c.foreground)
                Text(listOfNotNull(v.file.mimeType, sizeText(v.file.size).takeIf { it.isNotBlank() }).joinToString(" · "), fontSize = 12.sp, color = c.mutedFg)
                TextButton(onClick = { v.previewUrl?.let { u -> scope.launch { runCatching { FileOpener.open(context, container.api, u, v.file.name, v.file.mimeType) } } } }) {
                    Text(stringResource(R.string.td_open_file))
                }
                if (v.allowDownload && v.downloadUrl != null) TextButton(onClick = { scope.launch { runCatching { FileOpener.open(context, container.api, v.downloadUrl, v.file.name, v.file.mimeType, share = true) } } }) {
                    Text(stringResource(R.string.td_save_share))
                }
            }
        }
    }
}
