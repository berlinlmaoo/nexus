package id.znetworks.nexus.feature.gideon

import id.znetworks.nexus.ui.components.NxSwitch

import androidx.activity.compose.BackHandler
import androidx.compose.animation.*
import androidx.compose.animation.core.tween
import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.ChevronRight
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import id.znetworks.nexus.NexusApplication
import id.znetworks.nexus.R
import id.znetworks.nexus.core.config.ConfigBody
import id.znetworks.nexus.core.net.ApiError
import id.znetworks.nexus.ui.components.PageHeader
import id.znetworks.nexus.ui.components.UiNotice
import id.znetworks.nexus.ui.theme.Nx
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

@Composable fun GideonMemoryScreen(initialSummary: Boolean = false, onBack: () -> Unit) {
    val context = LocalContext.current
    val container = (context.applicationContext as NexusApplication).container
    val store = container.gideonMemories
    val snapshot by store.state.collectAsStateWithLifecycle()
    val data = snapshot.data
    val c = Nx.colors
    val id = ConfigBody.lang(LocalConfiguration.current.locales[0]) == "id"
    var summary by rememberSaveable { mutableStateOf(initialSummary) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var confirm by remember { mutableStateOf(false) }
    fun act(block: suspend () -> Unit) {
        if (busy) return
        busy = true; error = null
        // A field's blur-save survives navigating to the summary or leaving Settings. The store still scopes requests to the account.
        container.appScope.launch(Dispatchers.Main.immediate) {
            try { block() } catch (e: ApiError) { error = memoryError(e, id, context.getString(R.string.gm_failed)) }
            finally { busy = false }
        }
    }
    LaunchedEffect(Unit) { act { store.refresh() } }
    BackHandler(summary) { summary = false }
    AnimatedContent(summary, modifier = Modifier.fillMaxSize(), label = "Memory summary navigation", transitionSpec = {
        if (targetState) (slideInHorizontally(tween(200)) { it } + fadeIn(tween(160))) togetherWith (slideOutHorizontally(tween(200)) { -it / 4 } + fadeOut(tween(160)))
        else (slideInHorizontally(tween(200)) { -it / 4 } + fadeIn(tween(160))) togetherWith (slideOutHorizontally(tween(200)) { it } + fadeOut(tween(160)))
    }) { showSummary ->
    if (showSummary) {
        GideonMemorySummary(snapshot, busy, error, { summary = false }, ::act, { confirm = true })
    } else Column(Modifier.fillMaxSize().background(c.background).imePadding()) {
        PageHeader(stringResource(R.string.gm_title), subtitle = stringResource(R.string.gm_subtitle), subtitleMaxLines = Int.MAX_VALUE, onBack = onBack) {
            if (busy) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
        }
        LazyColumn(Modifier.weight(1f), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
            item {
                MemoryGroup {
                    Row(Modifier.padding(horizontal = 16.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                        val label = stringResource(R.string.gm_use)
                        Text(label, Modifier.weight(1f), color = c.foreground)
                        NxSwitch(!data.paused, { on -> act { store.pause(!on) } }, enabled = snapshot.loaded && !busy,
                            modifier = Modifier.semantics { contentDescription = label })
                    }
                }
                MemoryCaption(stringResource(R.string.gm_off_hint))
            }
            item {
                MemoryGroup {
                    Row(Modifier.fillMaxWidth().clickable(enabled = snapshot.loaded) { summary = true }.padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
                        Text(stringResource(R.string.ui_memory_summary), Modifier.weight(1f), color = c.foreground)
                        Icon(Icons.Outlined.ChevronRight, null, tint = c.mutedFg)
                    }
                }
                MemoryCaption(stringResource(R.string.ui_memory_summary_hint))
            }
            MemoryProfile.Field.entries.forEach { field ->
                item(key = field.name) {
                        val memory = MemoryProfile.find(field, data.memories)
                        MemoryProfileEditor(field, memory, data.textMax, snapshot.loaded && !busy && data.available && (memory != null || MemoryRules.canAdd(data))) { value ->
                            act {
                                if (value.isBlank()) { if (memory != null) store.forget(memory) }
                                else if (memory != null) store.edit(memory, MemoryProfile.payload(field, value))
                                else store.add(MemoryProfile.payload(field, value), field.kind)
                            }
                        }
                }
            }
            item { MemoryCaption(stringResource(R.string.ui_memory_about_hint)) }
            error?.let { message -> item {
                Text(message, color = c.dangerText)
                if (!snapshot.loaded) TextButton(onClick = { act { store.refresh() } }) { Text(stringResource(R.string.gx_try_again)) }
            } }
        }
    }
    }
    if (confirm) AlertDialog(onDismissRequest = { confirm = false }, title = { Text(stringResource(R.string.gm_forget_title)) },
        text = { Text(pluralStringResource(R.plurals.gm_forget_body, data.memories.size, data.memories.size)) },
        confirmButton = { TextButton(onClick = { confirm = false; act { store.forgetAll(); UiNotice.show(context.getString(R.string.gm_forgotten)) } }) { Text(stringResource(R.string.gm_forget_all), color = c.dangerText) } },
        dismissButton = { TextButton(onClick = { confirm = false }) { Text(stringResource(R.string.cancel)) } })
}

@Composable internal fun MemoryGroup(content: @Composable ColumnScope.() -> Unit) {
    Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(Nx.colors.card), content = content)
}

@Composable private fun MemoryCaption(text: String) {
    Text(text, Modifier.padding(top = 8.dp, start = 4.dp, end = 4.dp), color = Nx.colors.mutedFg, fontSize = 12.sp)
}

@Composable private fun MemoryProfileEditor(field: MemoryProfile.Field, memory: GMemory?, max: Int, enabled: Boolean, save: (String) -> Unit) {
    val value = MemoryProfile.value(field, memory)
    var draft by remember(memory?.id, field) { mutableStateOf(value) }
    var focused by remember { mutableStateOf(false) }
    val focus = LocalFocusManager.current
    val c = Nx.colors
    LaunchedEffect(value) { if (!focused) draft = value }
    val label = stringResource(when (field) {
        MemoryProfile.Field.NICKNAME -> R.string.ui_memory_nickname
        MemoryProfile.Field.ROLE -> R.string.ui_memory_role
        MemoryProfile.Field.ABOUT -> R.string.ui_memory_about
    })
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
    Text(label, color = c.mutedFg, fontSize = 12.sp, modifier = Modifier.padding(horizontal = 4.dp))
    MemoryGroup {
    TextField(draft, { draft = it.replace('\n', ' ').take(MemoryProfile.limit(field, max)) }, enabled = enabled,
        placeholder = { Text(stringResource(R.string.ui_memory_optional)) },
        minLines = if (field == MemoryProfile.Field.ABOUT) 3 else 1, maxLines = if (field == MemoryProfile.Field.ABOUT) 4 else 2,
        textStyle = TextStyle(fontSize = 15.sp, color = c.foreground), keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
        keyboardActions = KeyboardActions(onDone = { focus.clearFocus() }),
        colors = TextFieldDefaults.colors(focusedContainerColor = Color.Transparent, unfocusedContainerColor = Color.Transparent,
            disabledContainerColor = Color.Transparent, focusedIndicatorColor = Color.Transparent, unfocusedIndicatorColor = Color.Transparent, disabledIndicatorColor = Color.Transparent),
        modifier = Modifier.fillMaxWidth().semantics { contentDescription = label }.onFocusChanged { state ->
            val wasFocused = focused; focused = state.isFocused
            if (wasFocused && !focused && draft != value) save(draft)
        })
    }
    }
}
