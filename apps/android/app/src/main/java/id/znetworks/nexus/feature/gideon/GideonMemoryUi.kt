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

@Composable fun GideonMemoryScreen(onBack: () -> Unit) {
    val context = LocalContext.current
    val container = (context.applicationContext as NexusApplication).container
    val store = container.gideonMemories
    val snapshot by store.state.collectAsStateWithLifecycle()
    val data = snapshot.data
    val scope = rememberCoroutineScope()
    val c = Nx.colors
    val locale = LocalConfiguration.current.locales[0]
    val id = ConfigBody.lang(locale) == "id"
    var text by rememberSaveable { mutableStateOf("") }
    var kind by rememberSaveable { mutableStateOf("FACT") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var confirm by remember { mutableStateOf(false) }
    val addFocus = remember { FocusRequester() }
    fun act(block: suspend () -> Unit) { if (busy) return; busy = true; error = null; scope.launch {
        try { block() } catch (e: ApiError) { error = memoryError(e, id, context.getString(R.string.gm_failed)) } finally { busy = false }
    } }
    LaunchedEffect(Unit) { act { store.refresh() } }
    Column(Modifier.fillMaxSize().background(c.background).imePadding()) {
        PageHeader(stringResource(R.string.gm_title), subtitle = stringResource(R.string.gm_subtitle), subtitleMaxLines = Int.MAX_VALUE, onBack = onBack) { if (busy) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp) }
        LazyColumn(Modifier.weight(1f), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            item {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    val label = stringResource(R.string.gm_use)
                    Text(label, Modifier.weight(1f), color = c.foreground)
                    Switch(!data.paused, { on -> act { store.pause(!on) } }, enabled = snapshot.loaded && !busy, modifier = Modifier.semantics { contentDescription = label })
                }
                Text(stringResource(R.string.gm_off_hint), color = c.mutedFg, fontSize = 12.sp)
            }
            item {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedTextField(text, { text = it.take(data.textMax.coerceAtLeast(1)) }, placeholder = { Text(stringResource(R.string.gm_placeholder)) },
                        enabled = snapshot.loaded && !busy && MemoryRules.canAdd(data), supportingText = { Text("${text.length}/${data.textMax}") }, modifier = Modifier.fillMaxWidth().focusRequester(addFocus))
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        val types = listOf("FACT" to stringResource(R.string.gm_note), "PREFERENCE" to stringResource(R.string.gm_preference), "PERSON" to stringResource(R.string.gm_about), "DATE" to stringResource(R.string.gm_date))
                        GPicker(stringResource(R.string.gm_type), types.first { it.first == kind }.second, types, !busy && MemoryRules.canAdd(data)) { kind = it }
                        NxButton(stringResource(R.string.gm_add), { act { store.add(text, kind); text = "" } }, enabled = snapshot.loaded && !busy && MemoryRules.canAdd(data) && text.isNotBlank(), kind = NxButtonKind.PRIMARY, compact = true)
                    }
                    if (data.paused) Text(stringResource(R.string.gm_paused), color = c.mutedFg, fontSize = 12.sp)
                    else if (data.memories.size >= data.max) Text(stringResource(R.string.gm_full, data.max.toString()), color = c.mutedFg, fontSize = 12.sp)
                }
            }
            error?.let { message -> item { Text(message, color = c.dangerText); if (!snapshot.loaded) TextButton(onClick = { act { store.refresh() } }) { Text(stringResource(R.string.gx_try_again)) } } }
            if (snapshot.loaded && data.memories.isEmpty()) item { EmptyState(Icons.Outlined.Psychology, stringResource(R.string.gm_empty), stringResource(R.string.gm_empty_hint), stringResource(R.string.gm_add), { addFocus.requestFocus() }, actionEnabled = MemoryRules.canAdd(data) && !busy) }
            listOf("PREFERENCE" to R.string.gm_preferences, "PERSON" to R.string.gm_about, "DATE" to R.string.gm_dates, "FACT" to R.string.gm_notes).forEach { (type, label) ->
                val rows = data.memories.filter { it.kind == type || type == "FACT" && it.kind !in setOf("PREFERENCE", "PERSON", "DATE", "FACT") }
                if (rows.isNotEmpty()) item(key = type) {
                    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        Text(stringResource(label), color = c.mutedFg, fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
                        Column(Modifier.fillMaxWidth().border(1.dp, c.border, RoundedCornerShape(8.dp))) {
                            rows.forEachIndexed { index, memory ->
                                key(memory.id) { if (index > 0) HorizontalDivider(color = c.border); MemoryRow(memory, busy, data.paused, data.textMax, act = ::act) }
                            }
                        }
                    }
                }
            }
            if (data.memories.isNotEmpty()) item { TextButton(onClick = { confirm = true }, enabled = !busy) { Text(stringResource(R.string.gm_forget_all), color = c.dangerText) } }
        }
    }
    if (confirm) AlertDialog(onDismissRequest = { confirm = false }, title = { Text(stringResource(R.string.gm_forget_title)) }, text = { Text(stringResource(R.string.gm_forget_body, data.memories.size.toString())) },
        confirmButton = { TextButton(onClick = { confirm = false; act { store.forgetAll(); UiNotice.show(context.getString(R.string.gm_forgotten)) } }) { Text(stringResource(R.string.gm_forget_all), color = c.dangerText) } },
        dismissButton = { TextButton(onClick = { confirm = false }) { Text(stringResource(R.string.cancel)) } })
}

@OptIn(ExperimentalLayoutApi::class)
@Composable private fun MemoryRow(memory: GMemory, busy: Boolean, paused: Boolean, limit: Int, act: (suspend () -> Unit) -> Unit) {
    val context = LocalContext.current
    val store = (context.applicationContext as NexusApplication).container.gideonMemories
    val c = Nx.colors
    var editing by remember(memory.id) { mutableStateOf(false) }
    var draft by remember(memory.id, memory.text) { mutableStateOf(memory.text) }
    fun save() { if (busy || draft.isBlank()) return; act { store.edit(memory, draft); editing = false } }
    Column(Modifier.fillMaxWidth().padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        if (editing) {
            OutlinedTextField(draft, { draft = it.take(limit.coerceAtLeast(1)) }, enabled = !busy, singleLine = true, label = { Text(stringResource(R.string.gm_edit_memory)) }, modifier = Modifier.fillMaxWidth().onPreviewKeyEvent {
                if (it.type != KeyEventType.KeyDown) false else when (it.key) { Key.Escape -> { draft = memory.text; editing = false; true }; Key.Enter, Key.NumPadEnter -> { save(); true }; else -> false }
            }, keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done), keyboardActions = KeyboardActions(onDone = { save() }))
            Row { TextButton(onClick = { draft = memory.text; editing = false }, enabled = !busy) { Text(stringResource(R.string.cancel)) }; TextButton(onClick = ::save, enabled = !busy && draft.isNotBlank()) { Text(stringResource(R.string.gm_save)) } }
        } else {
            Text(memory.text, color = c.foreground)
            if (memory.kind == "DATE") MemoryRules.date(memory.monthDay, LocalConfiguration.current.locales[0])?.let { Text(it, color = c.mutedFg, fontSize = 12.sp) }
            if (memory.status == "PENDING") FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(6.dp), itemVerticalAlignment = Alignment.CenterVertically) {
                Text(stringResource(R.string.gm_suggested), color = c.accentFg, fontSize = 12.sp, modifier = Modifier.background(c.accentBg, RoundedCornerShape(4.dp)).padding(horizontal = 6.dp, vertical = 2.dp))
                NxButton(stringResource(R.string.gm_save), { act { store.save(memory) } }, enabled = !busy && !paused, kind = NxButtonKind.PRIMARY, compact = true)
            }
            Row {
                TextButton(onClick = { editing = true }, enabled = !busy) { Text(stringResource(R.string.gm_edit)) }
                TextButton(onClick = { act { store.forget(memory); UiNotice.show(context.getString(R.string.gm_forgotten)) } }, enabled = !busy) { Text(stringResource(R.string.gm_delete), color = c.dangerText) }
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
