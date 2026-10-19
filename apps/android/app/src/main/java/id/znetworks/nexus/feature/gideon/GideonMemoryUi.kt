package id.znetworks.nexus.feature.gideon

import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.key.*
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.contentDescription
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import id.znetworks.nexus.NexusApplication
import id.znetworks.nexus.R
import id.znetworks.nexus.core.config.ConfigBody
import id.znetworks.nexus.core.nav.Target
import id.znetworks.nexus.core.net.ApiError
import id.znetworks.nexus.ui.components.*
import id.znetworks.nexus.ui.theme.Nx
import kotlinx.coroutines.launch

internal fun memoryError(error: ApiError, id: Boolean, fallback: String): String {
    val http = error as? ApiError.Http
    if (id) when (http?.code) {
        "secret" -> return "GIDEON tidak pernah menyimpan password, PIN, kode, atau nomor kartu/rekening/KTP."
        "paused" -> return "Memori GIDEON sedang mati."
        "full" -> return "Memori GIDEON penuh (40). Hapus sesuatu untuk menambah."
    }
    return http?.serverMessage ?: fallback
}

@Composable fun GideonMemoryEntry() {
    val container = (LocalContext.current.applicationContext as NexusApplication).container
    Row(Modifier.fillMaxWidth().clickable { container.router.open(Target.GideonMemory) }.padding(vertical = 12.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        Icon(Icons.Outlined.Psychology, null, tint = Nx.colors.mutedFg)
        Text(stringResource(R.string.gm_title), color = Nx.colors.foreground)
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable internal fun MemoryRow(memory: GMemory, busy: Boolean, paused: Boolean, limit: Int, act: (suspend () -> Unit) -> Unit) {
    val context = LocalContext.current
    val store = (context.applicationContext as NexusApplication).container.gideonMemories
    val c = Nx.colors
    val profileField = MemoryProfile.field(memory)
    val initialDraft = if (profileField == null) memory.text else MemoryProfile.value(profileField, memory)
    var editing by remember(memory.id) { mutableStateOf(false) }
    var menu by remember(memory.id) { mutableStateOf(false) }
    var draft by remember(memory.id, memory.text) { mutableStateOf(initialDraft) }
    fun save() { if (busy || draft.isBlank()) return; act { store.edit(memory, if (profileField == null) draft else MemoryProfile.payload(profileField, draft)); editing = false } }
    Column(Modifier.fillMaxWidth().padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        if (editing) {
            OutlinedTextField(draft, { draft = it.take(if (profileField == null) limit.coerceAtLeast(1) else MemoryProfile.limit(profileField, limit)) }, enabled = !busy, singleLine = true, label = { Text(stringResource(R.string.gm_edit_memory)) }, modifier = Modifier.fillMaxWidth().onPreviewKeyEvent {
                if (it.type != KeyEventType.KeyDown) false else when (it.key) { Key.Escape -> { draft = initialDraft; editing = false; true }; Key.Enter, Key.NumPadEnter -> { save(); true }; else -> false }
            }, keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done), keyboardActions = KeyboardActions(onDone = { save() }))
            Row { TextButton(onClick = { draft = initialDraft; editing = false }, enabled = !busy) { Text(stringResource(R.string.cancel)) }; TextButton(onClick = ::save, enabled = !busy && draft.isNotBlank()) { Text(stringResource(R.string.gm_save)) } }
        } else {
            Row(verticalAlignment = Alignment.Top) {
                val text = if (profileField == null) memory.text else stringResource(when (profileField) {
                    MemoryProfile.Field.NICKNAME -> R.string.ui_memory_nickname
                    MemoryProfile.Field.ROLE -> R.string.ui_memory_role
                    MemoryProfile.Field.ABOUT -> R.string.ui_memory_about
                }) + ": " + MemoryProfile.value(profileField, memory)
                Text(text, color = c.foreground, modifier = Modifier.weight(1f))
                Box {
                    IconButton(onClick = { menu = true }, enabled = !busy, modifier = Modifier.size(40.dp)) { Icon(Icons.Outlined.MoreHoriz, stringResource(R.string.more), tint = c.mutedFg) }
                    DropdownMenu(menu, { menu = false }) {
                        DropdownMenuItem(text = { Text(stringResource(R.string.gm_edit)) }, onClick = { menu = false; editing = true })
                        DropdownMenuItem(text = { Text(stringResource(R.string.gm_delete), color = c.dangerText) }, onClick = { menu = false; act { store.forget(memory); UiNotice.show(context.getString(R.string.gm_forgotten)) } })
                    }
                }
            }
            if (memory.kind == "DATE") MemoryRules.date(memory.monthDay, LocalConfiguration.current.locales[0])?.let { Text(it, color = c.mutedFg, fontSize = 12.sp) }
            if (memory.status == "PENDING") FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(6.dp), itemVerticalAlignment = Alignment.CenterVertically) {
                Text(stringResource(R.string.gm_suggested), color = c.accentFg, fontSize = 12.sp, modifier = Modifier.background(c.accentBg, RoundedCornerShape(4.dp)).padding(horizontal = 6.dp, vertical = 2.dp))
                NxButton(stringResource(R.string.gm_save), { act { store.save(memory) } }, enabled = !busy && !paused, kind = NxButtonKind.PRIMARY, compact = true)
            }
        }
    }
}

@Composable internal fun GideonMemoryChip(memory: GMemory) {
    val context = LocalContext.current
    val container = (context.applicationContext as NexusApplication).container
    val store = container.gideonMemories
    val snapshot by store.state.collectAsStateWithLifecycle()
    val shown = snapshot.known[memory.id] ?: memory
    val c = Nx.colors
    val id = ConfigBody.lang(LocalConfiguration.current.locales[0]) == "id"
    val scope = rememberCoroutineScope()
    var busy by remember(memory.id) { mutableStateOf(false) }
    var error by remember(memory.id) { mutableStateOf<String?>(null) }
    fun decide(save: Boolean) { busy = true; error = null; scope.launch {
        try { if (save) store.save(shown) else store.forget(shown) } catch (e: ApiError) { error = memoryError(e, id, context.getString(R.string.gm_failed)) } finally { busy = false }
    } }
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        if (shown.status == "PENDING") {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) { Icon(Icons.Outlined.Psychology, null, Modifier.size(15.dp), tint = c.mutedFg); Text(stringResource(R.string.gm_remember), color = c.mutedFg, fontSize = 12.sp) }
            Text(shown.text, color = c.foreground, fontSize = 13.sp)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                TextButton(onClick = { decide(false) }, enabled = !busy) { Text(stringResource(R.string.gm_dont)) }
                NxButton(stringResource(R.string.gm_save), { decide(true) }, enabled = !busy, kind = NxButtonKind.PRIMARY, compact = true)
            }
        } else Row(verticalAlignment = Alignment.Top, horizontalArrangement = Arrangement.spacedBy(6.dp), modifier = Modifier.then(if (shown.status == "ACTIVE") Modifier.clickable { container.router.open(Target.GideonMemory) } else Modifier)) {
            Icon(if (shown.status == "ACTIVE") Icons.Outlined.Check else Icons.Outlined.Close, null, Modifier.size(15.dp), tint = c.mutedFg)
            Text(stringResource(if (shown.status == "ACTIVE") R.string.gm_saved else R.string.gm_not_saved, shown.text), color = c.mutedFg, fontSize = 12.sp)
        }
        error?.let { Text(it, color = c.dangerText, fontSize = 12.sp) }
    }
}
