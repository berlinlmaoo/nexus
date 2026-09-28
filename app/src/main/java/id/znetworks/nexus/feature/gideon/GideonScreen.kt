package id.znetworks.nexus.feature.gideon

import android.net.Uri
import android.provider.OpenableColumns
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.AutoAwesome
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import id.znetworks.nexus.NexusApplication
import id.znetworks.nexus.R
import id.znetworks.nexus.feature.attendance.requests.AttachmentReader
import id.znetworks.nexus.ui.theme.DisplayFont
import id.znetworks.nexus.ui.theme.Nx
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

@Composable
fun GideonScreen(onBack: () -> Unit) {
    val context = LocalContext.current
    val chat = (context.applicationContext as NexusApplication).container.gideon
    val s by chat.state.collectAsStateWithLifecycle()
    val c = Nx.colors
    val res = context.resources
    val scope = rememberCoroutineScope()
    var draft by rememberSaveable { mutableStateOf("") }
    var upload by remember { mutableStateOf<GUpload?>(null) }
    var menu by remember { mutableStateOf(false) }
    var attachMenu by remember { mutableStateOf(false) }
    var confirmClear by remember { mutableStateOf(false) }
    var note by remember { mutableStateOf<String?>(null) }
    val list = rememberLazyListState()
    LaunchedEffect(Unit) { chat.load() }
    LaunchedEffect(s.messages.size, s.thinking) { if (s.messages.isNotEmpty()) list.animateScrollToItem(s.messages.size) }
    val sentences = { i: Int -> res.getString(when (i) { 0 -> R.string.gd_too_big; 1 -> R.string.gd_unsupported; else -> R.string.gd_failed }) }

    val gallery = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
        uri?.let { scope.launch { val j = withContext(Dispatchers.IO) { AttachmentReader.uprightJpeg(context, it) }; if (j == null) note = res.getString(R.string.chat_photo_unreadable) else upload = GUpload.Image(j) } }
    }
    val files = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        uri?.let { u -> scope.launch { readDoc(context, u, res)?.let { r -> r.fold({ upload = it }, { e -> note = e.message }) } } }
    }

    Column(Modifier.fillMaxSize().background(c.background).imePadding()) {
        Row(Modifier.fillMaxWidth().padding(4.dp), verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, stringResource(R.string.back)) }
            Icon(Icons.Filled.AutoAwesome, null, tint = c.violetText); Spacer(Modifier.width(6.dp))
            Text("GIDEON", fontFamily = DisplayFont, fontWeight = FontWeight.Bold, fontSize = 18.sp, color = c.foreground, modifier = Modifier.weight(1f))
            Box {
                TextButton(onClick = { menu = true }) { Text(s.tier.label) }
                DropdownMenu(menu, { menu = false }) {
                    GideonTier.entries.forEach { t ->
                        DropdownMenuItem(text = { Column { Text(t.label, fontWeight = FontWeight.Bold); Text(stringResource(tierNote(t)), fontSize = 11.sp, color = c.mutedFg) } },
                            onClick = { menu = false; chat.setTier(t) })
                    }
                    DropdownMenuItem(text = { Text(stringResource(R.string.gd_clear), color = c.danger) }, onClick = { menu = false; confirmClear = true })
                }
            }
        }
        LazyColumn(Modifier.weight(1f), state = list, contentPadding = PaddingValues(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            if (s.messages.isEmpty() && !s.thinking) item {
                Column(Modifier.fillMaxWidth().padding(24.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                    Icon(Icons.Filled.AutoAwesome, null, tint = c.violetText, modifier = Modifier.size(36.dp))
                    Text(stringResource(R.string.gd_empty), fontFamily = DisplayFont, fontWeight = FontWeight.Bold, fontSize = 16.sp, color = c.foreground)
                    Text(stringResource(R.string.gd_empty_sub), fontSize = 13.sp, color = c.mutedFg)
                }
            }
            items(s.messages.withIndex().toList(), key = { it.index }) { (_, m) ->
                val mine = m.role == "user"
                Row(Modifier.fillMaxWidth(), horizontalArrangement = if (mine) Arrangement.End else Arrangement.Start) {
                    Column(Modifier.widthIn(max = 320.dp).background(if (mine) c.violet else c.card, RoundedCornerShape(16.dp))
                        .let { if (!mine) it.border(1.dp, c.border, RoundedCornerShape(16.dp)) else it }.padding(12.dp)) {
                        m.attachments.forEach { a -> Text("📎 " + (a.name ?: a.kind.orEmpty()), fontSize = 12.sp, color = if (mine) androidx.compose.ui.graphics.Color.White else c.mutedFg) }
                        SelectionContainer { Text(m.content, fontSize = 14.sp, color = if (mine) androidx.compose.ui.graphics.Color.White else c.foreground) }
                        if (m.tools.isNotEmpty()) Text("⚙ " + m.tools.joinToString(", "), fontSize = 10.sp, color = c.mutedFg)
                    }
                }
            }
            if (s.thinking) item {
                Row(verticalAlignment = Alignment.CenterVertically) { CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp); Spacer(Modifier.width(8.dp)); Text(stringResource(R.string.gd_typing), fontSize = 12.sp, color = c.mutedFg) }
            }
        }
        s.error?.let {
            Row(Modifier.fillMaxWidth().background(c.danger.copy(alpha = 0.08f)).padding(horizontal = 14.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(it, fontSize = 12.sp, color = c.danger, modifier = Modifier.weight(1f))
                IconButton(onClick = chat::dismissError, modifier = Modifier.size(24.dp)) { Icon(Icons.Filled.Close, null, tint = c.danger) }
            }
        }
        upload?.let { u ->
            Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                Text("📎 " + when (u) { is GUpload.Image -> stringResource(R.string.gd_image_attached); is GUpload.Document -> u.name }, fontSize = 12.sp, color = c.mutedFg, modifier = Modifier.weight(1f))
                IconButton(onClick = { upload = null }) { Icon(Icons.Filled.Close, stringResource(R.string.cancel)) }
            }
        }
        Row(Modifier.fillMaxWidth().background(c.card).padding(8.dp), verticalAlignment = Alignment.Bottom) {
            Box {
                IconButton(onClick = { attachMenu = true }) { Icon(Icons.Filled.Add, stringResource(R.string.chat_attach), tint = c.violetText) }
                DropdownMenu(attachMenu, { attachMenu = false }) {
                    DropdownMenuItem(text = { Text(stringResource(R.string.gallery)) }, onClick = { attachMenu = false; gallery.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)) })
                    DropdownMenuItem(text = { Text(stringResource(R.string.files)) }, onClick = { attachMenu = false; files.launch(arrayOf("*/*")) })
                }
            }
            OutlinedTextField(draft, { draft = it }, placeholder = { Text(stringResource(R.string.gd_placeholder)) }, maxLines = 6, shape = RoundedCornerShape(22.dp), modifier = Modifier.weight(1f))
            IconButton(onClick = { chat.ask(draft, upload, sentences); draft = ""; upload = null }, enabled = !s.thinking && (draft.isNotBlank() || upload != null)) {
                Icon(Icons.AutoMirrored.Filled.Send, stringResource(R.string.td_send), tint = c.violetText)
            }
        }
    }
    note?.let { AlertDialog(onDismissRequest = { note = null }, text = { Text(it) }, confirmButton = { TextButton(onClick = { note = null }) { Text("OK") } }) }
    if (confirmClear) AlertDialog(onDismissRequest = { confirmClear = false }, title = { Text(stringResource(R.string.gd_clear_q)) },
        confirmButton = { TextButton(onClick = { confirmClear = false; chat.clear { note = it } }) { Text(stringResource(R.string.gd_clear), color = c.danger) } },
        dismissButton = { TextButton(onClick = { confirmClear = false }) { Text(stringResource(R.string.cancel)) } })
}

private fun tierNote(t: GideonTier) = when (t) {
    GideonTier.ASTRA -> R.string.gd_astra; GideonTier.LUNA -> R.string.gd_luna; GideonTier.TERRA -> R.string.gd_terra; GideonTier.EXPERIMENTAL -> R.string.gd_experimental
}

/** A document for GIDEON: a known extension and ≤ 10 MB, read whole (it goes as base64). */
private suspend fun readDoc(context: android.content.Context, uri: Uri, res: android.content.res.Resources): Result<GUpload>? = withContext(Dispatchers.IO) {
    val cr = context.contentResolver
    var name = "file"; var size = -1L
    runCatching { cr.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE), null, null, null)?.use { c -> if (c.moveToFirst()) { if (!c.isNull(0)) name = c.getString(0); if (!c.isNull(1)) size = c.getLong(1) } } }
    when {
        !GideonRules.acceptsDocument(name) -> Result.failure(Exception(res.getString(R.string.gd_unsupported)))
        size > GideonRules.MAX_DOC -> Result.failure(Exception(res.getString(R.string.gd_too_big)))
        else -> runCatching { cr.openInputStream(uri)!!.use { it.readBytes() } }.fold(
            { b -> if (b.size > GideonRules.MAX_DOC) Result.failure(Exception(res.getString(R.string.gd_too_big))) else Result.success(GUpload.Document(name, cr.getType(uri) ?: "application/octet-stream", b)) },
            { Result.failure(Exception(res.getString(R.string.gd_unreadable))) })
    }
}
