package id.znetworks.nexus.feature.gideon

import androidx.compose.animation.*
import androidx.compose.animation.core.*
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.ArrowUpward
import androidx.compose.material.icons.outlined.Psychology
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import id.znetworks.nexus.NexusApplication
import id.znetworks.nexus.R
import id.znetworks.nexus.core.config.ConfigBody
import id.znetworks.nexus.core.net.ApiError
import id.znetworks.nexus.ui.components.EmptyState
import id.znetworks.nexus.ui.components.PageHeader
import id.znetworks.nexus.ui.theme.Nx
import kotlinx.coroutines.delay
import java.time.Instant
import kotlin.math.abs

@Composable internal fun GideonMemorySummary(snapshot: MemorySnapshot, busy: Boolean, error: String?, onBack: () -> Unit,
    act: (suspend () -> Unit) -> Unit, onForget: () -> Unit) {
    val context = LocalContext.current
    val store = (context.applicationContext as NexusApplication).container.gideonMemories
    val data = snapshot.data
    val c = Nx.colors
    val id = ConfigBody.lang(LocalConfiguration.current.locales[0]) == "id"
    var loading by remember { mutableStateOf(true) }
    var failed by remember { mutableStateOf<String?>(null) }
    var refresh by remember { mutableIntStateOf(0) }
    var animateReveal by remember { mutableStateOf(false) }
    var fetchedAt by remember { mutableLongStateOf(System.currentTimeMillis()) }
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    var draft by rememberSaveable { mutableStateOf("") }
    val addFocus = remember { FocusRequester() }
    LaunchedEffect(refresh) {
        loading = true; failed = null
        val started = android.os.SystemClock.elapsedRealtime()
        try { store.refresh() } catch (e: ApiError) { failed = memoryError(e, id, context.getString(R.string.gm_failed)) }
        finally {
            animateReveal = android.os.SystemClock.elapsedRealtime() - started >= 150
            fetchedAt = System.currentTimeMillis(); now = fetchedAt; loading = false
        }
    }
    LaunchedEffect(Unit) { while (true) { delay(60_000); now = System.currentTimeMillis() } }
    val updatedAt = data.memories.mapNotNull { m -> (m.updatedAt ?: m.createdAt)?.let { runCatching { Instant.parse(it).toEpochMilli() }.getOrNull() } }.maxOrNull() ?: fetchedAt
    Column(Modifier.fillMaxSize().background(c.background).imePadding()) {
        PageHeader(stringResource(R.string.ui_memory_summary), onBack = onBack, subtitleContent = {
            if (loading) MemoryShimmerText(stringResource(R.string.ui_memory_loading))
            else Text(stringResource(R.string.ui_memory_updated, memoryAge(updatedAt, now)), color = c.mutedFg, fontSize = 14.sp, lineHeight = 19.sp, modifier = Modifier.padding(top = 2.dp))
        })
        when {
            loading -> MemoryLoadingDots(Modifier.weight(1f))
            failed != null && !snapshot.loaded -> Column(Modifier.weight(1f).padding(20.dp)) {
                Text(failed!!, color = c.dangerText)
                TextButton(onClick = { refresh++ }) { Text(stringResource(R.string.gx_try_again)) }
            }
            else -> LazyColumn(Modifier.weight(1f), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(18.dp)) {
                val groups = listOf("PREFERENCE" to R.string.gm_preferences, "FACT" to R.string.ui_memory_about_section, "PERSON" to R.string.ui_memory_people, "DATE" to R.string.gm_dates)
                groups.forEachIndexed { index, (type, label) ->
                    val rows = data.memories.filter { it.kind == type || type == "FACT" && it.kind !in setOf("PREFERENCE", "PERSON", "DATE", "FACT") }
                    if (rows.isNotEmpty()) item(key = type) {
                        var revealed by remember { mutableStateOf(!animateReveal) }
                        LaunchedEffect(type) { if (animateReveal) delay(index * 35L); revealed = true }
                        Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                            Text(stringResource(label), color = c.mutedFg, fontSize = 12.sp, modifier = Modifier.padding(start = 4.dp))
                            if (!revealed) MemorySectionSkeleton()
                            else if (animateReveal) {
                                val visible = remember { MutableTransitionState(false).apply { targetState = true } }
                                AnimatedVisibility(visible, enter = fadeIn(tween(180)) + slideInVertically(tween(180)) { it / 6 }) {
                                    MemorySection(rows, busy, data.paused, data.textMax, act)
                                }
                            } else MemorySection(rows, busy, data.paused, data.textMax, act)
                        }
                    }
                }
                if (data.memories.isEmpty()) item {
                    EmptyState(Icons.Outlined.Psychology, stringResource(R.string.gm_empty), stringResource(R.string.gm_empty_hint), stringResource(R.string.gm_add),
                        { addFocus.requestFocus() }, actionEnabled = MemoryRules.canAdd(data) && !busy)
                }
                (failed ?: error)?.let { message -> item {
                    Text(message, color = c.dangerText)
                    if (failed != null) TextButton(onClick = { refresh++ }) { Text(stringResource(R.string.gx_try_again)) }
                } }
                if (data.memories.isNotEmpty()) item {
                    TextButton(onClick = onForget, enabled = !busy) { Text(stringResource(R.string.gm_forget_all), color = c.dangerText) }
                }
            }
        }
        Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp).padding(bottom = 12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            if (data.paused) Text(stringResource(R.string.gm_paused), color = c.mutedFg, fontSize = 12.sp)
            else if (data.memories.size >= data.max) Text(stringResource(R.string.gm_full, data.max.toString()), color = c.mutedFg, fontSize = 12.sp)
            val canSend = snapshot.loaded && !busy && MemoryRules.canAdd(data) && draft.isNotBlank()
            TextField(draft, { draft = it.take(data.textMax.coerceAtLeast(1)) }, placeholder = { Text(stringResource(R.string.ui_memory_add_update)) }, maxLines = 4,
                enabled = snapshot.loaded && !busy && MemoryRules.canAdd(data), modifier = Modifier.fillMaxWidth().focusRequester(addFocus),
                shape = RoundedCornerShape(28.dp),
                colors = TextFieldDefaults.colors(focusedContainerColor = c.muted, unfocusedContainerColor = c.muted, disabledContainerColor = c.muted,
                    focusedIndicatorColor = Color.Transparent, unfocusedIndicatorColor = Color.Transparent, disabledIndicatorColor = Color.Transparent),
                trailingIcon = { IconButton(onClick = { act { store.add(draft, "FACT"); draft = "" } }, enabled = canSend,
                    modifier = Modifier.padding(end = 6.dp).size(40.dp).background(if (canSend) c.violet else c.mutedFg.copy(alpha = .18f), CircleShape)) {
                    Icon(Icons.Outlined.ArrowUpward, stringResource(R.string.gm_add), tint = if (canSend) MaterialTheme.colorScheme.onPrimary else c.mutedFg)
                } })
        }
    }
}

@Composable private fun MemorySection(rows: List<GMemory>, busy: Boolean, paused: Boolean, limit: Int, act: (suspend () -> Unit) -> Unit) {
    MemoryGroup {
        rows.forEachIndexed { index, memory -> key(memory.id) {
            if (index > 0) HorizontalDivider(color = Nx.colors.border)
            MemoryRow(memory, busy, paused, limit, act)
        } }
    }
}

@Composable private fun memoryAge(updated: Long, now: Long): String {
    val seconds = ((now - updated) / 1000).coerceAtLeast(0)
    return when {
        seconds < 60 -> stringResource(R.string.ui_memory_just_now)
        seconds < 3600 -> (seconds / 60).toInt().let { pluralStringResource(R.plurals.ui_memory_minutes_ago, it, it) }
        seconds < 86400 -> (seconds / 3600).toInt().let { pluralStringResource(R.plurals.ui_memory_hours_ago, it, it) }
        else -> (seconds / 86400).toInt().let { pluralStringResource(R.plurals.ui_memory_days_ago, it, it) }
    }
}

@Composable private fun MemoryShimmerText(text: String) {
    val c = Nx.colors
    val phase by rememberInfiniteTransition(label = "memory subtitle").animateFloat(0f, 1f, infiniteRepeatable(tween(1200, easing = LinearEasing)), label = "subtitle sweep")
    var width by remember { mutableFloatStateOf(240f) }
    val start = width * (phase * 3 - 1)
    Text(text, fontSize = 14.sp, lineHeight = 19.sp, style = TextStyle(brush = Brush.linearGradient(listOf(c.mutedFg, c.foreground, c.mutedFg), Offset(start, 0f), Offset(start + width, 0f))),
        modifier = Modifier.padding(top = 2.dp).onSizeChanged { width = it.width.toFloat().coerceAtLeast(1f) })
}

@Composable private fun MemoryLoadingDots(modifier: Modifier) {
    val c = Nx.colors
    val phase by rememberInfiniteTransition(label = "memory dots").animateFloat(0f, 1f, infiniteRepeatable(tween(1200, easing = LinearEasing)), label = "diagonal fade")
    Canvas(modifier.fillMaxWidth().clearAndSetSemantics {}) {
        val step = 20.dp.toPx()
        for (row in 0..(size.height / step).toInt()) for (col in 0..(size.width / step).toInt()) {
            val wave = ((phase - (row + col) / 35f) % 1f + 1f) % 1f
            val alpha = .02f + (1f - abs(wave * 2f - 1f)) * .10f
            drawCircle(c.mutedFg.copy(alpha = alpha), 1.1.dp.toPx(), Offset(col * step + step / 2, row * step + step / 2))
        }
    }
}

@Composable private fun MemorySectionSkeleton() {
    Column(Modifier.fillMaxWidth().padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Box(Modifier.fillMaxWidth(.8f).height(12.dp).background(Nx.colors.muted, RoundedCornerShape(6.dp)))
        Box(Modifier.fillMaxWidth(.55f).height(12.dp).background(Nx.colors.muted, RoundedCornerShape(6.dp)))
    }
}
