package id.znetworks.nexus.feature.chat

import android.app.Application
import android.content.Intent
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.Reply
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.AlternateEmail
import androidx.compose.material.icons.filled.Checklist
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material.icons.filled.LocationOn
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.Image
import androidx.compose.material.icons.filled.PhotoCamera
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
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.core.content.FileProvider
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import id.znetworks.nexus.NexusApplication
import id.znetworks.nexus.R
import id.znetworks.nexus.core.net.ApiError
import id.znetworks.nexus.feature.attendance.LocationProvider
import id.znetworks.nexus.feature.attendance.requests.AttachmentReader
import id.znetworks.nexus.ui.components.Avatar
import id.znetworks.nexus.ui.components.RemoteImage
import id.znetworks.nexus.ui.components.describe
import id.znetworks.nexus.ui.theme.DisplayFont
import id.znetworks.nexus.ui.theme.Nx
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File

data class ThreadState(
    val conversation: Conversation? = null,
    val messages: List<Message> = emptyList(),
    val hasMore: Boolean = false,
    val loading: Boolean = true,
    val loadingEarlier: Boolean = false,
    val sending: Boolean = false,
    val uploading: Boolean = false,
    val attachment: ChatUpload? = null,
    val replyTo: Message? = null,
    val notice: String? = null,
    val savedAt: Long? = null,
)

class ChatThreadViewModel(app: Application, handle: SavedStateHandle) : AndroidViewModel(app) {
    val id: String = handle["id"] ?: ""
    private val c = (app as NexusApplication).container
    private val api = ChatApi(c.api)
    private val res get() = getApplication<Application>().resources
    private val _state = MutableStateFlow(ThreadState())
    val state = _state.asStateFlow()
    val meId: String? get() = c.sessionStore.current?.userId
    private var markedReadId: String? = null
    /** The @tags picked from the list, by user id: sent as mentionedUserIds while still in the text. */
    val picked = mutableMapOf<String, String>()

    init {
        viewModelScope.launch {
            runCatching { api.conversations().value.conversations.firstOrNull { it.id == id } }.getOrNull()?.let { conv -> _state.update { it.copy(conversation = conv) } }
        }
        // No socket on mobile: an open thread polls (iOS: every 5 s).
        viewModelScope.launch { while (isActive) { load(); delay(ChatApi.THREAD_POLL_MS) } }
    }

    private suspend fun load() {
        try {
            val r = api.messages(id)
            _state.update { s ->
                // Keep anything older already loaded with "earlier".
                val fresh = r.value.messages
                val older = s.messages.filter { m -> fresh.none { it.id == m.id } && (fresh.firstOrNull()?.createdAt ?: "") > (m.createdAt ?: "") }
                s.copy(messages = older + fresh, hasMore = if (older.isEmpty()) r.value.hasMore else s.hasMore, loading = false, savedAt = r.savedAtMillis)
            }
            // Read on screen = read on the server, but only when something new arrived.
            val last = _state.value.messages.lastOrNull()?.id
            if (last != null && last != markedReadId && r.savedAtMillis == null) {
                markedReadId = last
                runCatching { api.markRead(id) }
            }
        } catch (e: ApiError) {
            _state.update { it.copy(loading = false, notice = if (it.messages.isEmpty()) e.describe(res) else it.notice) }
        }
    }

    fun loadEarlier() {
        val first = _state.value.messages.firstOrNull()?.createdAt ?: return
        if (_state.value.loadingEarlier) return
        _state.update { it.copy(loadingEarlier = true) }
        viewModelScope.launch {
            try {
                val r = api.earlier(id, first)
                _state.update { s -> s.copy(messages = r.messages + s.messages, hasMore = r.hasMore) }
            } catch (e: ApiError) { _state.update { it.copy(notice = e.describe(res)) } }
            _state.update { it.copy(loadingEarlier = false) }
        }
    }

    fun reply(m: Message?) = _state.update { it.copy(replyTo = m) }
    fun dismissNotice() = _state.update { it.copy(notice = null) }
    fun clearAttachment() = _state.update { it.copy(attachment = null) }

    /** The composer clears only after the server says yes: a failed send leaves the text in place. */
    fun send(text: String, onSent: () -> Unit) {
        val s = _state.value
        if (s.sending || (text.isBlank() && s.attachment == null)) return
        _state.update { it.copy(sending = true, notice = null) }
        viewModelScope.launch {
            try {
                api.send(id, text, Mentions.ids(text, picked), s.attachment, s.replyTo?.id)
                picked.clear()
                _state.update { it.copy(attachment = null, replyTo = null) }
                onSent()
                load()
            } catch (e: ApiError) {
                _state.update { it.copy(notice = (e as? ApiError.Http)?.serverMessage ?: res.getString(R.string.chat_send_failed)) }
            }
            _state.update { it.copy(sending = false) }
        }
    }

    /** Photos go up as JPEG (HEIC and friends are refused by the server), at most 8 MB. */
    fun attach(uri: Uri) {
        _state.update { it.copy(uploading = true, notice = null) }
        viewModelScope.launch {
            try {
                val jpeg = withContext(Dispatchers.IO) { AttachmentReader.uprightJpeg(getApplication(), uri) }
                when {
                    jpeg == null -> _state.update { it.copy(notice = res.getString(R.string.chat_photo_unreadable)) }
                    jpeg.size > ChatApi.MAX_IMAGE -> _state.update { it.copy(notice = res.getString(R.string.td_file_too_big)) }
                    else -> { val up = api.uploadImage(id, jpeg); _state.update { it.copy(attachment = up) } }
                }
            } catch (e: ApiError) { _state.update { it.copy(notice = (e as? ApiError.Http)?.serverMessage ?: e.describe(res)) } }
            _state.update { it.copy(uploading = false) }
        }
    }

    fun sendLocation() {
        if (_state.value.sending) return
        _state.update { it.copy(sending = true, notice = null) }
        viewModelScope.launch {
            try {
                val fix = c.location.currentFix()
                api.send(id, ChatPayload.location(fix.lat, fix.lng, res.getString(R.string.chat_my_location)), emptyList(), null, null)
                load()
            } catch (e: LocationProvider.Failure) {
                _state.update { it.copy(notice = res.getString(R.string.chat_location_failed)) }
            } catch (e: ApiError) {
                _state.update { it.copy(notice = e.describe(res)) }
            }
            _state.update { it.copy(sending = false) }
        }
    }

    fun rename(name: String) = viewModelScope.launch {
        try { val conv = api.rename(id, name); _state.update { it.copy(conversation = conv) } }
        catch (e: ApiError) { _state.update { it.copy(notice = (e as? ApiError.Http)?.serverMessage ?: e.describe(res)) } }
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
fun ChatThreadScreen(onBack: () -> Unit, onOpenTask: (String) -> Unit, vm: ChatThreadViewModel = viewModel()) {
    val s by vm.state.collectAsStateWithLifecycle()
    val c = Nx.colors
    val context = LocalContext.current
    val clipboard = LocalClipboardManager.current
    var input by rememberSaveable { mutableStateOf("") }
    var menu by remember { mutableStateOf(false) }
    var attachMenu by remember { mutableStateOf(false) }
    var renaming by remember { mutableStateOf(false) }
    var viewing by remember { mutableStateOf<String?>(null) }
    var cameraUri by rememberSaveable { mutableStateOf<String?>(null) }
    val list = rememberLazyListState()
    val gallery = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { it?.let(vm::attach) }
    val camera = rememberLauncherForActivityResult(ActivityResultContracts.TakePicture()) { ok -> if (ok) cameraUri?.let { vm.attach(Uri.parse(it)) } }
    val locationPerm = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { vm.sendLocation() }
    val lastId = s.messages.lastOrNull()?.id
    LaunchedEffect(lastId) { if (s.messages.isNotEmpty()) list.animateScrollToItem(s.messages.size) }

    val conv = s.conversation
    val members = conv?.members.orEmpty().filter { it.uid != vm.meId }
    val mentionQuery = Mentions.query(input)
    val matches = if (mentionQuery == null) emptyList() else members.filter { mentionQuery.isEmpty() || it.displayName.contains(mentionQuery, true) }

    Column(Modifier.fillMaxSize().background(c.background).imePadding()) {
        Row(Modifier.fillMaxWidth().padding(4.dp), verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, stringResource(R.string.back)) }
            Column(Modifier.weight(1f)) {
                Text(conv?.title(vm.meId) ?: "", fontFamily = DisplayFont, fontWeight = FontWeight.Bold, fontSize = 17.sp, color = c.foreground, maxLines = 1, overflow = TextOverflow.Ellipsis)
                if (conv != null && conv.type != "DM") Text(stringResource(R.string.chat_members_n, conv.members.size), fontSize = 11.sp, color = c.mutedFg)
            }
            if (conv?.type == "GROUP") Box {
                IconButton(onClick = { menu = true }) { Icon(Icons.Filled.MoreVert, stringResource(R.string.more)) }
                DropdownMenu(menu, { menu = false }) {
                    DropdownMenuItem(text = { Text(stringResource(R.string.chat_rename)) }, onClick = { menu = false; renaming = true })
                }
            }
        }
        LazyColumn(Modifier.weight(1f), state = list, contentPadding = PaddingValues(horizontal = 12.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            if (s.hasMore) item(key = "earlier") {
                Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
                    if (s.loadingEarlier) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
                    else TextButton(onClick = vm::loadEarlier) { Text(stringResource(R.string.chat_load_earlier)) }
                }
            }
            if (s.loading && s.messages.isEmpty()) item { Box(Modifier.fillMaxWidth().padding(24.dp), contentAlignment = Alignment.Center) { CircularProgressIndicator() } }
            if (!s.loading && s.messages.isEmpty()) item { Text(stringResource(R.string.chat_say_hi), fontSize = 13.sp, color = c.mutedFg, modifier = Modifier.fillMaxWidth().padding(24.dp)) }
            items(s.messages, key = { it.id }) { m ->
                val mine = m.userId == vm.meId || m.user?.id == vm.meId
                var msgMenu by remember { mutableStateOf(false) }
                Row(Modifier.fillMaxWidth(), horizontalArrangement = if (mine) Arrangement.End else Arrangement.Start, verticalAlignment = Alignment.Bottom) {
                    if (!mine && conv?.type != "DM") { Avatar(m.user?.name, m.user?.avatar, 26.dp); Spacer(Modifier.width(6.dp)) }
                    Box {
                        Column(
                            Modifier.widthIn(max = 290.dp).clip18().background(if (mine) c.violet else c.card)
                                .let { if (!mine) it.border(1.dp, c.border, RoundedCornerShape(18.dp)) else it }
                                .combinedClickable(onClick = {}, onLongClick = { msgMenu = true }).padding(horizontal = 12.dp, vertical = 8.dp),
                        ) {
                            val fg = if (mine) Color.White else c.foreground
                            if (!mine && conv?.type != "DM") Text(m.user?.name ?: "", fontSize = 11.sp, fontWeight = FontWeight.Bold, color = c.violetText)
                            m.replyTo?.let { r ->
                                Column(Modifier.fillMaxWidth().padding(vertical = 4.dp).background(fg.copy(alpha = 0.12f), RoundedCornerShape(8.dp)).padding(6.dp)) {
                                    Text(r.user?.name ?: "", fontSize = 11.sp, fontWeight = FontWeight.Bold, color = fg.copy(alpha = 0.9f))
                                    Text(r.content.ifBlank { "📷 " + stringResource(R.string.chat_photo) }, fontSize = 12.sp, color = fg.copy(alpha = 0.8f), maxLines = 2, overflow = TextOverflow.Ellipsis)
                                }
                            }
                            if (m.isImage) {
                                RemoteImage(m.attachmentUrl, Modifier.padding(vertical = 4.dp).size(220.dp).clip18().clickable { viewing = m.attachmentUrl }, ContentScale.Crop, maxPx = 900) {
                                    Box(Modifier.size(220.dp).background(c.muted))
                                }
                            }
                            when (val p = ChatPayload.parse(m.content)) {
                                is ChatPayload.Location -> Row(Modifier.clickable {
                                    runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(p.url))) }
                                }.padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                                    Icon(Icons.Filled.LocationOn, null, tint = fg); Spacer(Modifier.width(6.dp))
                                    Text(stringResource(R.string.chat_shared_location), fontSize = 14.sp, fontWeight = FontWeight.Bold, color = fg)
                                }
                                is ChatPayload.Task -> Row(Modifier.clickable { onOpenTask(p.id) }.padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                                    Icon(Icons.Filled.Checklist, null, tint = fg); Spacer(Modifier.width(6.dp))
                                    Text(p.title.ifBlank { stringResource(R.string.chat_open_task) }, fontSize = 14.sp, fontWeight = FontWeight.Bold, color = fg)
                                }
                                ChatPayload.Plain -> if (m.content.isNotBlank()) Text(highlight(m.content, if (mine) Color.White else c.violetText), fontSize = 15.sp, color = fg)
                            }
                            Text(chatTime(m.createdAt), fontSize = 10.sp, color = fg.copy(alpha = 0.6f), modifier = Modifier.align(Alignment.End))
                        }
                        DropdownMenu(msgMenu, { msgMenu = false }) {
                            DropdownMenuItem(text = { Text(stringResource(R.string.chat_reply)) }, leadingIcon = { Icon(Icons.AutoMirrored.Filled.Reply, null) },
                                onClick = { msgMenu = false; vm.reply(m) })
                            if (m.content.isNotBlank()) DropdownMenuItem(text = { Text(stringResource(R.string.chat_copy)) }, leadingIcon = { Icon(Icons.Filled.ContentCopy, null) },
                                onClick = { msgMenu = false; clipboard.setText(AnnotatedString(m.content)) })
                        }
                    }
                }
            }
        }
        s.notice?.let {
            Row(Modifier.fillMaxWidth().background(c.danger.copy(alpha = 0.08f)).padding(horizontal = 14.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(it, fontSize = 12.sp, color = c.danger, modifier = Modifier.weight(1f))
                IconButton(onClick = vm::dismissNotice, modifier = Modifier.size(24.dp)) { Icon(Icons.Filled.Close, null, tint = c.danger) }
            }
        }
        // Composer
        Column(Modifier.fillMaxWidth().background(c.card).padding(horizontal = 8.dp, vertical = 6.dp)) {
            s.replyTo?.let { r ->
                Row(Modifier.fillMaxWidth().padding(4.dp), verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.AutoMirrored.Filled.Reply, null, tint = c.violetText, modifier = Modifier.size(16.dp)); Spacer(Modifier.width(6.dp))
                    Column(Modifier.weight(1f)) {
                        Text(stringResource(R.string.chat_replying_to, r.user?.name ?: ""), fontSize = 11.sp, fontWeight = FontWeight.Bold, color = c.violetText)
                        Text(r.content.ifBlank { "📷" }, fontSize = 12.sp, color = c.mutedFg, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    }
                    IconButton(onClick = { vm.reply(null) }, modifier = Modifier.size(24.dp)) { Icon(Icons.Filled.Close, stringResource(R.string.cancel)) }
                }
            }
            if (s.uploading || s.attachment != null) Row(Modifier.padding(4.dp), verticalAlignment = Alignment.CenterVertically) {
                if (s.uploading) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
                else RemoteImage(s.attachment?.url, Modifier.size(56.dp).clip18(), ContentScale.Crop, maxPx = 200)
                Spacer(Modifier.width(8.dp))
                Text(stringResource(if (s.uploading) R.string.chat_uploading else R.string.chat_photo_ready), fontSize = 12.sp, color = c.mutedFg, modifier = Modifier.weight(1f))
                if (!s.uploading) IconButton(onClick = vm::clearAttachment) { Icon(Icons.Filled.Close, stringResource(R.string.cancel)) }
            }
            if (matches.isNotEmpty()) Row(Modifier.horizontalScroll(rememberScrollState()).padding(4.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                matches.forEach { m ->
                    Row(Modifier.clip18().background(c.muted).clickable {
                        input = Mentions.insert(input, m.displayName); vm.picked[m.uid] = Mentions.tag(m.displayName)
                    }.padding(horizontal = 10.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                        Avatar(m.displayName, m.user?.avatar, 20.dp); Spacer(Modifier.width(6.dp)); Text(m.displayName, fontSize = 12.sp, color = c.foreground)
                    }
                }
            }
            Row(verticalAlignment = Alignment.Bottom) {
                Box {
                    IconButton(onClick = { attachMenu = true }, enabled = !s.uploading) { Icon(Icons.Filled.Add, stringResource(R.string.chat_attach), tint = c.violetText) }
                    DropdownMenu(attachMenu, { attachMenu = false }) {
                        DropdownMenuItem(text = { Text(stringResource(R.string.gallery)) }, leadingIcon = { Icon(Icons.Filled.Image, null) }, onClick = {
                            attachMenu = false; gallery.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly))
                        })
                        DropdownMenuItem(text = { Text(stringResource(R.string.camera)) }, leadingIcon = { Icon(Icons.Filled.PhotoCamera, null) }, onClick = {
                            attachMenu = false
                            val f = File(File(context.cacheDir, "evidence").apply { mkdirs() }, "chat-${System.currentTimeMillis()}.jpg")
                            val uri = FileProvider.getUriForFile(context, "${context.packageName}.files", f)
                            cameraUri = uri.toString(); runCatching { camera.launch(uri) }
                        })
                        DropdownMenuItem(text = { Text(stringResource(R.string.chat_send_location)) }, leadingIcon = { Icon(Icons.Filled.LocationOn, null) }, onClick = {
                            attachMenu = false
                            locationPerm.launch(arrayOf(android.Manifest.permission.ACCESS_FINE_LOCATION, android.Manifest.permission.ACCESS_COARSE_LOCATION))
                        })
                    }
                }
                if (members.isNotEmpty()) IconButton(onClick = { input = if (input.isEmpty() || input.endsWith(" ")) "$input@" else "$input @" }) {
                    Icon(Icons.Filled.AlternateEmail, stringResource(R.string.chat_mention), tint = c.mutedFg)
                }
                OutlinedTextField(input, { input = it }, placeholder = { Text(stringResource(R.string.chat_placeholder)) }, maxLines = 5,
                    shape = RoundedCornerShape(22.dp), modifier = Modifier.weight(1f))
                IconButton(onClick = { vm.send(input) { input = "" } }, enabled = !s.sending && !s.uploading && (input.isNotBlank() || s.attachment != null)) {
                    if (s.sending) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
                    else Icon(Icons.AutoMirrored.Filled.Send, stringResource(R.string.td_send), tint = c.violetText)
                }
            }
        }
    }
    viewing?.let { url ->
        Dialog(onDismissRequest = { viewing = null }, properties = DialogProperties(usePlatformDefaultWidth = false)) {
            Box(Modifier.fillMaxSize().background(Color.Black).clickable { viewing = null }, contentAlignment = Alignment.Center) {
                RemoteImage(url, Modifier.fillMaxWidth().height(520.dp), ContentScale.Fit, maxPx = 2048)
            }
        }
    }
    if (renaming) {
        var name by rememberSaveable { mutableStateOf(conv?.name.orEmpty()) }
        AlertDialog(onDismissRequest = { renaming = false }, title = { Text(stringResource(R.string.chat_rename)) },
            text = { OutlinedTextField(name, { name = it.take(80) }, singleLine = true, modifier = Modifier.fillMaxWidth()) },
            confirmButton = { TextButton(onClick = { renaming = false; vm.rename(name) }, enabled = name.isNotBlank()) { Text(stringResource(R.string.save)) } },
            dismissButton = { TextButton(onClick = { renaming = false }) { Text(stringResource(R.string.cancel)) } })
    }
}

private fun Modifier.clip18() = this.clip(RoundedCornerShape(18.dp))

/** @mention tokens in the accent colour. */
private fun highlight(text: String, accent: Color): AnnotatedString = buildAnnotatedString {
    val re = Regex("@\\S+")
    var i = 0
    re.findAll(text).forEach { m ->
        append(text.substring(i, m.range.first))
        withStyle(SpanStyle(color = accent, fontWeight = FontWeight.Bold)) { append(m.value) }
        i = m.range.last + 1
    }
    append(text.substring(i))
}
