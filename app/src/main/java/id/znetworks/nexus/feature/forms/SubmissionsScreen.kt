package id.znetworks.nexus.feature.forms

import androidx.compose.material.icons.filled.Add
import kotlinx.coroutines.launch
import androidx.lifecycle.repeatOnLifecycle
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.gestures.snapping.SnapPosition
import androidx.compose.foundation.gestures.snapping.rememberSnapFlingBehavior
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.Inbox
import androidx.compose.material.icons.filled.Description
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
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

/**
 * My Submissions (Berlin 29 Sep, UI point 4; iOS SubmissionsView, web submissions.tsx): a read-only
 * kanban of what I sent through forms. Columns are the finance team's "Status" values from the server,
 * after one of ours for what nobody processed yet; each card shows the item's own title, not the form's.
 */
@Composable
fun SubmissionsScreen(onBack: () -> Unit, onOpen: (String) -> Unit, onOpenForms: () -> Unit = {}) {
    val api = formsApi()
    val c = Nx.colors
    val res = LocalContext.current.resources
    var data by remember { mutableStateOf<Submissions?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var tick by remember { mutableStateOf(0) }
    LaunchedEffect(tick) {
        try { data = api.mySubmissions().value; error = null } catch (e: ApiError) { error = e.describe(res) }
    }
    Column(Modifier.fillMaxSize().background(c.background)) {
        Box(Modifier.fillMaxWidth().padding(4.dp), contentAlignment = Alignment.Center) {
            IconButton(onClick = onBack, modifier = Modifier.align(Alignment.CenterStart)) { Icon(Icons.AutoMirrored.Filled.ArrowBack, stringResource(R.string.back)) }
            Text(stringResource(R.string.mt_submissions), fontWeight = FontWeight.SemiBold, fontSize = 17.sp, color = c.foreground)
        }
        val d = data
        when {
            d == null && error == null -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
            d == null -> EmptyState(Icons.Filled.Assignment, stringResource(R.string.form_load_failed), error!!, stringResource(R.string.try_again), { tick++ }, Modifier.fillMaxSize())
            d.submissions.isEmpty() -> EmptyState(Icons.Filled.Inbox, stringResource(R.string.sub_empty_title), stringResource(R.string.sub_empty_body),
                stringResource(R.string.sub_open_forms), onOpenForms, Modifier.fillMaxSize())
            else -> SubmissionBoardView(d, onOpen)
        }
    }
}

/** The board itself: the read-only chip, then the columns side by side. */
@Composable
internal fun SubmissionBoardView(d: Submissions, onOpen: (String) -> Unit) {
    val c = Nx.colors
    Column(Modifier.fillMaxSize()) {
        Row(Modifier.padding(start = 16.dp, top = 8.dp).background(c.muted.copy(alpha = 0.5f), CircleShape).padding(horizontal = 12.dp, vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically) {
            Icon(Icons.Filled.Lock, null, tint = c.mutedFg, modifier = Modifier.size(11.dp))
            Spacer(Modifier.width(6.dp))
            Text(stringResource(R.string.sub_read_only), fontSize = 11.sp, fontWeight = FontWeight.SemiBold, color = c.mutedFg)
        }
        val newCol = stringResource(R.string.sub_col_new)
        val columns = SubmissionBoard.columns(d, newCol)
        val state = rememberLazyListState()
        BoxWithConstraints(Modifier.fillMaxSize()) {
            // One column plus a hint of the next on any width (iOS: min(320, 82%)).
            val colWidth = minOf(320.dp, maxWidth * 0.82f)
            LazyRow(state = state, contentPadding = PaddingValues(16.dp), horizontalArrangement = Arrangement.spacedBy(12.dp),
                flingBehavior = rememberSnapFlingBehavior(state, SnapPosition.Start), modifier = Modifier.fillMaxSize()) {
                items(columns, key = { it.first }) { (name, items) -> BoardColumn(name, items, colWidth, onOpen) }
            }
        }
    }
}

/** Grouping for the board: kept pure so it is tested on the JVM. */
object SubmissionBoard {
    /**
     * Ours first (no status yet), then the server's columns in order; a status the server did not list
     * still gets a column, after them, so nothing sent ever disappears from the board.
     */
    fun columns(d: Submissions, newName: String): List<Pair<String, List<Submission>>> {
        fun key(s: Submission) = s.procStatus?.trim()?.takeIf { it.isNotEmpty() }
        val names = d.statusColumns.filter { it.isNotBlank() }.distinct()
        val extra = d.submissions.mapNotNull(::key).distinct().filter { it !in names }
        return listOf(newName to d.submissions.filter { key(it) == null }) + (names + extra).map { n -> n to d.submissions.filter { key(it) == n } }
    }

    /** Column tint, as iOS subColTone: done/approved green, in progress blue, rejected red, else grey. */
    enum class Tone { SUCCESS, BLUE, DANGER, MUTED }
    fun tone(name: String): Tone {
        val n = name.lowercase()
        return when {
            listOf("done", "selesai", "approve", "setuju", "paid").any { it in n } -> Tone.SUCCESS
            "progress" in n || "proses" in n -> Tone.BLUE
            listOf("tolak", "reject", "batal").any { it in n } -> Tone.DANGER
            else -> Tone.MUTED
        }
    }
}

@Composable
private fun BoardColumn(name: String, items: List<Submission>, width: androidx.compose.ui.unit.Dp, onOpen: (String) -> Unit) {
    val c = Nx.colors
    val tone = when (SubmissionBoard.tone(name)) {
        SubmissionBoard.Tone.SUCCESS -> c.success; SubmissionBoard.Tone.BLUE -> c.blue
        SubmissionBoard.Tone.DANGER -> c.danger; SubmissionBoard.Tone.MUTED -> c.mutedFg
    }
    val shape = RoundedCornerShape(18.dp)
    Column(Modifier.width(width).fillMaxHeight().clip(shape).background(tone.copy(alpha = 0.08f)).border(1.dp, tone.copy(alpha = 0.3f), shape)) {
        Row(Modifier.fillMaxWidth().padding(start = 10.dp, end = 10.dp, top = 10.dp, bottom = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(name, fontFamily = DisplayFont, fontWeight = FontWeight.Bold, fontSize = 14.sp, color = c.foreground, maxLines = 1,
                overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
            Text("${items.size}", fontSize = 12.sp, fontWeight = FontWeight.Bold, color = c.mutedFg,
                modifier = Modifier.background(c.card, CircleShape).padding(horizontal = 8.dp, vertical = 2.dp))
        }
        // Each column scrolls on its own: swipe sideways between columns, down inside one (iOS).
        LazyColumn(contentPadding = PaddingValues(start = 8.dp, end = 8.dp, bottom = 8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            items(items, key = { it.id }) { s -> BoardCard(s) { onOpen(s.id) } }
            if (items.isEmpty()) item {
                Box(Modifier.fillMaxWidth().dashedBorder(c.border).padding(vertical = 18.dp), contentAlignment = Alignment.Center) {
                    Text(stringResource(R.string.sub_col_empty), fontSize = 11.sp, color = c.mutedFg.copy(alpha = 0.7f))
                }
            }
        }
    }
}

@Composable
private fun BoardCard(s: Submission, onClick: () -> Unit) {
    val c = Nx.colors
    val shape = RoundedCornerShape(12.dp)
    Row(Modifier.fillMaxWidth().clip(shape).background(c.card).border(1.dp, c.border, shape).clickable(onClick = onClick).padding(10.dp),
        verticalAlignment = Alignment.Top) {
        Box(Modifier.size(28.dp).background(c.violet.copy(alpha = 0.12f), RoundedCornerShape(9.dp)), contentAlignment = Alignment.Center) {
            Icon(Icons.Filled.Description, null, tint = c.violetText, modifier = Modifier.size(15.dp))
        }
        Spacer(Modifier.width(8.dp))
        Column(Modifier.weight(1f)) {
            Text(s.taskTitle ?: s.formName ?: stringResource(R.string.sub_fallback_title), fontSize = 13.sp, fontWeight = FontWeight.Bold, color = c.foreground,
                maxLines = 2, overflow = TextOverflow.Ellipsis)
            Text(listOfNotNull(s.formName, s.projectName).joinToString(" · "), fontSize = 11.sp, color = c.mutedFg, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(stringResource(R.string.sub_submitted_at, submittedText(s.createdAt)), fontSize = 10.sp, color = c.mutedFg.copy(alpha = 0.8f))
        }
        Spacer(Modifier.width(4.dp))
        Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, null, tint = c.mutedFg.copy(alpha = 0.6f), modifier = Modifier.size(16.dp))
    }
}

/** "20 Sep, 19:14" in office time. */
private fun submittedText(iso: String?): String = iso?.let {
    runCatching { java.time.format.DateTimeFormatter.ofPattern("d MMM, HH:mm", java.util.Locale.getDefault())
        .format(java.time.Instant.parse(it).atZone(id.znetworks.nexus.core.time.OfficeTime.ZONE)) }.getOrNull()
}.orEmpty()

private fun Modifier.dashedBorder(color: androidx.compose.ui.graphics.Color) = drawBehind {
    drawRoundRect(color, style = androidx.compose.ui.graphics.drawscope.Stroke(width = 1.dp.toPx(),
        pathEffect = androidx.compose.ui.graphics.PathEffect.dashPathEffect(floatArrayOf(5.dp.toPx(), 5.dp.toPx()))),
        cornerRadius = androidx.compose.ui.geometry.CornerRadius(12.dp.toPx()))
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

/**
 * The project's Forms tab (FORM-BUILDER): "New form" on top, then its forms; tap = edit in the builder, long
 * press = Fill in, Copy public link / Share link (public only), Publish / Unpublish.
 */
@OptIn(androidx.compose.foundation.ExperimentalFoundationApi::class)
@Composable
fun ProjectFormsTab(projectId: String, onOpenForm: (String) -> Unit, onBuildForm: (String?) -> Unit = {}) {
    val api = formsApi()
    val c = Nx.colors
    val context = LocalContext.current
    val res = context.resources
    val scope = androidx.compose.runtime.rememberCoroutineScope()
    var forms by remember { mutableStateOf<List<BuilderForm>?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var notice by remember { mutableStateOf<String?>(null) }
    var tick by remember { mutableStateOf(0) }
    LaunchedEffect(projectId, tick) { try { forms = api.builderForms(projectId); error = null } catch (e: ApiError) { error = e.describe(res) } }
    // Back from the builder: what was saved shows here.
    val lifecycle = androidx.lifecycle.compose.LocalLifecycleOwner.current.lifecycle
    LaunchedEffect(lifecycle) { lifecycle.repeatOnLifecycle(androidx.lifecycle.Lifecycle.State.RESUMED) { tick++ } }
    val l = forms
    when {
        l == null && error == null -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
        l == null -> TabEmpty(Icons.Filled.Assignment, error!!)
        l.isEmpty() -> id.znetworks.nexus.ui.components.EmptyState(Icons.Filled.Assignment, stringResource(R.string.fb_empty_title), stringResource(R.string.fb_empty_body),
            stringResource(R.string.fb_new), { onBuildForm(null) }, Modifier.fillMaxSize())
        else -> LazyColumn(contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            item {
                Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(c.accentBg).clickable { onBuildForm(null) }.padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Filled.Add, null, tint = c.violetText); Spacer(Modifier.width(8.dp))
                    Text(stringResource(R.string.fb_new), fontSize = 15.sp, fontWeight = FontWeight.SemiBold, color = c.violetText)
                }
                Text(stringResource(R.string.fb_tab_hint), fontSize = 11.sp, color = c.mutedFg, modifier = Modifier.padding(top = 6.dp))
            }
            items(l, key = { it.id }) { f ->
                var menu by remember { mutableStateOf(false) }
                Box {
                    Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(c.card).border(1.dp, c.border, RoundedCornerShape(16.dp))
                        .combinedClickable(onClick = { onBuildForm(f.id) }, onLongClick = { menu = true }).padding(12.dp)) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text(f.name, fontSize = 15.sp, fontWeight = FontWeight.SemiBold, color = c.foreground, modifier = Modifier.weight(1f))
                            id.znetworks.nexus.feature.projects.Pill(stringResource(if (f.isPublic) R.string.fb_chip_public else R.string.fb_chip_private), if (f.isPublic) c.success else c.mutedFg)
                        }
                        f.description?.takeIf { it.isNotBlank() }?.let { Text(it, fontSize = 12.sp, color = c.mutedFg, maxLines = 2) }
                        Text(androidx.compose.ui.res.pluralStringResource(R.plurals.fb_submissions_n, f.submissions, f.submissions) + " · " +
                            androidx.compose.ui.res.pluralStringResource(R.plurals.fb_fields_count, f.fields.size, f.fields.size), fontSize = 11.sp, color = c.mutedFg)
                    }
                    androidx.compose.material3.DropdownMenu(menu, { menu = false }) {
                        androidx.compose.material3.DropdownMenuItem(text = { Text(stringResource(R.string.fb_fill_in)) }, onClick = { menu = false; onOpenForm(f.slug ?: f.id) })
                        if (f.isPublic) {
                            androidx.compose.material3.DropdownMenuItem(text = { Text(stringResource(R.string.fb_copy_public_link)) }, onClick = {
                                menu = false
                                val cm = context.getSystemService(android.content.ClipboardManager::class.java)
                                cm?.setPrimaryClip(android.content.ClipData.newPlainText("form", f.link)); notice = res.getString(R.string.fb_link_copied)
                            })
                            androidx.compose.material3.DropdownMenuItem(text = { Text(stringResource(R.string.fb_share_link)) }, onClick = {
                                menu = false
                                runCatching { context.startActivity(android.content.Intent.createChooser(android.content.Intent(android.content.Intent.ACTION_SEND)
                                    .setType("text/plain").putExtra(android.content.Intent.EXTRA_TEXT, f.link), null)) }
                            })
                        }
                        androidx.compose.material3.DropdownMenuItem(text = { Text(stringResource(if (f.isPublic) R.string.fb_unpublish else R.string.fb_publish)) }, onClick = {
                            menu = false
                            scope.launch {
                                // Only this key is sent: the rest of the form stays as it is.
                                try { api.updateForm(f.id, kotlinx.serialization.json.JsonObject(mapOf("isPublic" to kotlinx.serialization.json.JsonPrimitive(!f.isPublic))))
                                    notice = res.getString(if (f.isPublic) R.string.fb_unpublished else R.string.fb_published); tick++ }
                                catch (e: ApiError) { notice = res.getString(R.string.fb_update_failed) + ": " + ((e as? ApiError.Http)?.serverMessage ?: e.describe(res)) }
                            }
                        })
                    }
                }
            }
        }
    }
    notice?.let { androidx.compose.material3.AlertDialog(onDismissRequest = { notice = null }, text = { Text(it) },
        confirmButton = { androidx.compose.material3.TextButton(onClick = { notice = null }) { Text("OK") } }) }
}
