package id.znetworks.nexus.feature.chat

import id.znetworks.nexus.ui.components.NxCheckbox

import id.znetworks.nexus.ui.components.NxTextField

import id.znetworks.nexus.feature.presence.PresenceLine

import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.animation.core.animateFloat
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.material.icons.filled.Delete
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.material.icons.filled.PersonAdd
import id.znetworks.nexus.feature.projects.RosterMember
import id.znetworks.nexus.feature.projects.ProjectsApi
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
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Description
import androidx.compose.material.icons.filled.AttachFile
import androidx.compose.material3.TextField
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.material.icons.filled.Download
import id.znetworks.nexus.core.files.FileOpener
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
import androidx.compose.ui.text.withLink
import androidx.compose.ui.text.LinkAnnotation
import androidx.compose.ui.text.TextLinkStyles
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material.icons.filled.NotificationsOff
import androidx.lifecycle.repeatOnLifecycle
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
import id.znetworks.nexus.ui.components.rememberCameraCapture
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
    /** The server's cursor for the page older than what is held (null on older servers: the oldest createdAt). */
    val nextCursor: String? = null,
    /** False once the server answered 404 to mute: the option is hidden. */
    val muteSupported: Boolean = true,
    /** The workspace people for Add people; null until asked for. */
    val roster: List<RosterMember>? = null,
    val adding: Boolean = false,
    /** A search result or quote opened the thread on this message (around=); auto-scroll to the bottom waits. */
    val anchorId: String? = null,
    /** After a jump, newer messages are still coming in through the polls. */
    val newerPending: Boolean = false,
    /** The group was deleted (here or elsewhere, DELETE-GROUP): the thread shows that instead, and stops polling. */
    val deleted: Boolean = false,
    val denied: Boolean = false,
    val tooLongText: String? = null,
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
            val conv = runCatching { api.conversations().value.conversations.firstOrNull { it.id == id } }.getOrNull()
            if (conv != null) _state.update { it.copy(conversation = conv) }
            else try { api.info(id) } catch (e: ApiError) { unavailable(e) }
        }
        // The first page once; after that the screen polls only while it is visible (CHAT-REPORT P0).
        // Opened on a message (a search result): the page around it instead.
        val at: String? = handle["at"]
        viewModelScope.launch { if (at.isNullOrBlank()) firstPage() else jumpTo(at) }
    }

    private suspend fun firstPage() {
        if (_state.value.deleted) return
        try {
            val r = api.messages(id)
            _state.update { s -> s.copy(messages = ChatMerge.merge(s.messages, r.value.messages), hasMore = r.value.hasMore, nextCursor = r.value.nextCursor,
                loading = false, savedAt = r.savedAtMillis) }
        } catch (e: ApiError) {
            if (unavailable(e)) return
            _state.update { it.copy(loading = false, notice = if (it.messages.isEmpty()) e.describe(res) else it.notice) }
        }
    }

    private fun unavailable(e: ApiError): Boolean {
        val status = (e as? ApiError.Http)?.status
        if (status != 404 && status != 403) return false
        markDeleted(status == 403); return true
    }

    fun markDeleted(denied: Boolean = false) { _state.update { it.copy(deleted = true, denied = denied, loading = false, notice = null, messages = emptyList(), conversation = null, replyTo = null) }; ChatNotifier.cancel(getApplication(), id) }

    /**
     * Only what is new (`after=<last id>`), merged by id: nothing held is ever dropped. An older server that
     * ignores `after` sends its latest page; when that page leaves a hole (a long pause), older pages are
     * fetched with `before` until they meet what is held (at most 5).
     */
    suspend fun poll() {
        if (_state.value.deleted) return
        val held = _state.value.messages
        val last = held.lastOrNull()?.id ?: return firstPage()
        try {
            val page = api.newer(id, last).messages
            if (_state.value.newerPending && page.size < 100) _state.update { it.copy(newerPending = false) }
            var merged = ChatMerge.merge(held, page)
            if (ChatMerge.gap(held, page, 50)) {
                var before = page.minByOrNull { it.createdAt.orEmpty() }?.createdAt
                var guard = 0
                while (before != null && guard++ < 5) {
                    val older = api.earlier(id, before).messages
                    merged = ChatMerge.merge(merged, older)
                    if (older.isEmpty() || older.any { o -> held.any { it.id == o.id } }) break
                    before = older.minByOrNull { it.createdAt.orEmpty() }?.createdAt
                }
            }
            _state.update { it.copy(messages = merged, loading = false, savedAt = null) }
        } catch (e: ApiError) { unavailable(e) /* else a failed poll keeps what is on screen; the next one tries again */ }
    }

    /**
     * Read up to the last message on screen (`upToMessageId`), only when it changed — and only ever called
     * while the thread is visible and the app in front (no marking read in the background).
     */
    suspend fun markReadVisible() {
        val last = _state.value.messages.lastOrNull()?.id ?: return
        if (last == markedReadId || _state.value.savedAt != null) return
        markedReadId = last
        if (runCatching { api.markRead(id, last) }.isSuccess) c.badges.refresh()
    }

    fun loadEarlier(): kotlinx.coroutines.Job? {
        val s0 = _state.value
        val before = ChatMerge.before(s0.messages, s0.nextCursor) ?: return null
        if (s0.loadingEarlier) return null
        _state.update { it.copy(loadingEarlier = true) }
        return viewModelScope.launch {
            try {
                val r = api.earlier(id, before)
                _state.update { s -> s.copy(messages = ChatMerge.merge(s.messages, r.messages), hasMore = r.hasMore, nextCursor = r.nextCursor) }
            } catch (e: ApiError) { _state.update { it.copy(notice = e.describe(res)) } }
            _state.update { it.copy(loadingEarlier = false) }
        }
    }

    enum class Mute { HOURS_8, WEEK, ALWAYS, OFF }

    /** PATCH mute (CHAT-CONTRACT). A 404 = the server has no mute yet: the option goes away. */
    fun mute(m: Mute) = viewModelScope.launch {
        val until = ChatMute.until(m)
        try {
            val r = api.mute(id, until)
            _state.update { s -> s.copy(conversation = s.conversation?.copy(mutedUntil = r.mutedUntil)) }
            c.badges.refresh()
        } catch (e: ApiError) {
            if ((e as? ApiError.Http)?.status == 404) _state.update { it.copy(muteSupported = false, notice = res.getString(R.string.chat_mute_unavailable)) }
            else _state.update { it.copy(notice = e.describe(res)) }
        }
    }

    fun reply(m: Message?) = _state.update { it.copy(replyTo = m) }
    fun dismissNotice() = _state.update { it.copy(notice = null) }
    fun clearAttachment() = _state.update { it.copy(attachment = null) }

    fun attachDocument(uri: Uri) {
        val f = c.uploads.describe(uri)
        if (f == null || !ChatDocuments.accepts(f.name, f.size)) { _state.update { it.copy(notice = res.getString(R.string.chat_file_rules)) }; return }
        if (_state.value.uploading) return
        _state.update { it.copy(uploading = true, notice = null) }
        viewModelScope.launch {
            try {
                val up = c.uploads.send(f, "/api/upload/chat", listOf("conversationId" to id), emptyList(), ChatUpload.serializer()) { _, _ -> }
                _state.update { it.copy(attachment = up) }
            } catch (e: ApiError) { _state.update { it.copy(notice = e.describe(res)) } }
            _state.update { it.copy(uploading = false) }
        }
    }

    fun openDocument(m: Message, share: Boolean) = viewModelScope.launch {
        val url = m.attachmentUrl ?: return@launch
        try {
            if (!FileOpener.open(getApplication(), c.api, url,
                    m.attachmentName ?: url.substringAfterLast('/').substringBefore('?'), m.attachmentType, share))
                _state.update { it.copy(notice = res.getString(R.string.td_no_viewer)) }
        } catch (e: ApiError) { _state.update { it.copy(notice = e.describe(res)) } }
    }

    /** The composer clears only after the server says yes: a failed send leaves the text in place. */
    fun send(text: String, onSent: () -> Unit) {
        val s = _state.value
        if (s.deleted || s.sending || (text.isBlank() && s.attachment == null)) return
        if (ChatComposerLimit.tooLong(text)) { _state.update { it.copy(tooLongText = text) }; return }
        _state.update { it.copy(sending = true, notice = null, tooLongText = null) }
        viewModelScope.launch {
            try {
                api.send(id, text, Mentions.ids(text, picked), s.attachment, s.replyTo?.id)
                picked.clear()
                _state.update { it.copy(attachment = null, replyTo = null) }
                onSent()
                poll()
            } catch (e: ApiError) {
                _state.update { if ((e as? ApiError.Http)?.code == "MESSAGE_TOO_LONG") it.copy(tooLongText = text) else it.copy(notice = (e as? ApiError.Http)?.serverMessage ?: res.getString(R.string.chat_send_failed)) }
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
                poll()
            } catch (e: LocationProvider.Failure) {
                _state.update { it.copy(notice = res.getString(R.string.chat_location_failed)) }
            } catch (e: ApiError) {
                _state.update { it.copy(notice = e.describe(res)) }
            }
            _state.update { it.copy(sending = false) }
        }
    }

    fun loadRoster() = viewModelScope.launch {
        if (_state.value.roster != null) return@launch
        val list = try { ProjectsApi(c.api).roster().members } catch (e: ApiError) { emptyList() }
        _state.update { it.copy(roster = list) }
    }

    /** The conversation as the server has it now (members, permissions and group photo). */
    suspend fun refreshConversation() {
        val conv: Conversation? = try { api.conversations().value.conversations.firstOrNull { it.id == id } } catch (e: ApiError) { null }
        if (conv != null) _state.update { it.copy(conversation = conv) }
    }

    /**
     * Add people (iOS AddProjectPeopleSheet): a project room adds them to the project (their seat in the
     * room follows when they next open the app); a GROUP adds them to the room itself, which only Manager
     * and above may do — a MANAGER_REQUIRED refusal shows this app's sentence and hides the control.
     */
    fun addPeople(userIds: List<String>) = viewModelScope.launch {
        val conv = _state.value.conversation ?: return@launch
        if (userIds.isEmpty()) return@launch
        _state.update { it.copy(adding = true, notice = null) }
        val pid = conv.projectId
        try {
            if (pid != null) {
                val projects = ProjectsApi(c.api)
                // One request for everyone (PROJECT-SETUP-MEMBERS B, `{ userIds }`); people already in are skipped by the server.
                val added = try { projects.addMembers(pid, userIds) } catch (e: ApiError) { -1 }
                _state.update { it.copy(notice = res.getString(if (added < 0) R.string.chat_add_partial else R.string.chat_added_project)) }
            } else {
                val updated = api.addMembers(id, userIds)
                // No toast: the thread's own log line ("You added Mira") is the confirmation now (SYSTEM-MESSAGES).
                _state.update { it.copy(conversation = if (updated.members.isNotEmpty()) updated else it.conversation) }
                poll()
                refreshConversation()
            }
        } catch (e: ApiError) {
            if (ChatRules.managerRequired(e)) {
                _state.update { it.copy(notice = res.getString(R.string.chat_manager_required), conversation = it.conversation?.copy(canManageMembers = false)) }
                refreshConversation()
            } else _state.update { it.copy(notice = (e as? ApiError.Http)?.serverMessage ?: e.describe(res)) }
        }
        _state.update { it.copy(adding = false) }
    }

    /**
     * Show [messageId] (a search hit): the page centred on it (`around=`), newer ones then arrive with the
     * polls. An older server without `around` gets older pages until it shows up (at most 5).
     */
    suspend fun jumpTo(messageId: String) {
        if (_state.value.messages.any { it.id == messageId }) { _state.update { it.copy(anchorId = messageId, loading = false) }; return }
        try {
            val r = api.around(id, messageId)
            _state.update { it.copy(messages = r.messages, hasMore = r.hasMore, nextCursor = r.nextCursor, loading = false,
                anchorId = messageId.takeIf { mid -> r.messages.any { m -> m.id == mid } }, newerPending = r.hasMoreNewer) }
            if (r.messages.none { it.id == messageId }) _state.update { it.copy(notice = res.getString(R.string.ci_err_jump_gone)) }
        } catch (e: ApiError) {
            if (unavailable(e)) return
            val h = e as? ApiError.Http
            if (h?.status == 400 && h.code == "UNKNOWN_MESSAGE") { firstPage(); _state.update { it.copy(notice = res.getString(R.string.ci_err_jump_gone)) }; return }
            // No `around` (older server): page back from the newest until it shows up.
            if (_state.value.messages.isEmpty()) firstPage()
            repeat(5) {
                if (_state.value.messages.any { m -> m.id == messageId }) { _state.update { it.copy(anchorId = messageId) }; return }
                if (!_state.value.hasMore) return@repeat
                (loadEarlier() ?: return@repeat).join()
            }
            if (_state.value.messages.any { m -> m.id == messageId }) _state.update { it.copy(anchorId = messageId) }
            else _state.update { it.copy(notice = res.getString(R.string.ci_err_jump)) }
        }
    }

    fun clearAnchor() = _state.update { it.copy(anchorId = null) }

    fun rename(name: String) = viewModelScope.launch {
        try { val conv = api.rename(id, name); _state.update { it.copy(conversation = conv) } }
        catch (e: ApiError) { _state.update { it.copy(notice = (e as? ApiError.Http)?.serverMessage ?: e.describe(res)) } }
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
fun ChatThreadScreen(onBack: () -> Unit, onOpenTask: (String) -> Unit, onOpenInfo: () -> Unit = {}, vm: ChatThreadViewModel = viewModel()) {
    val s by vm.state.collectAsStateWithLifecycle()
    val c = Nx.colors
    val context = LocalContext.current
    val clipboard = LocalClipboardManager.current
    var input by rememberSaveable { mutableStateOf("") }
    var menu by remember { mutableStateOf(false) }
    var attachMenu by remember { mutableStateOf(false) }
    var renaming by remember { mutableStateOf(false) }
    var addingPeople by remember { mutableStateOf(false) }
    var viewing by remember { mutableStateOf<String?>(null) }
    val list = rememberLazyListState()
    val gallery = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { it?.let(vm::attach) }
    val documents = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { it?.let(vm::attachDocument) }
    val camera = rememberCameraCapture("chat") { vm.attach(it) }
    val locationPerm = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { vm.sendLocation() }
    val lastId = s.messages.lastOrNull()?.id
    // To the newest, unless a jump (a search hit) is being shown: then to that message, until the bottom is reached.
    LaunchedEffect(lastId) { if (s.messages.isNotEmpty() && s.anchorId == null) list.animateScrollToItem(s.messages.size) }
    LaunchedEffect(s.anchorId) {
        val a = s.anchorId ?: return@LaunchedEffect
        val i = s.messages.indexOfFirst { it.id == a }
        if (i >= 0) list.scrollToItem(i + (if (s.hasMore) 1 else 0))
    }
    LaunchedEffect(list, s.anchorId, s.newerPending) {
        if (s.anchorId == null || s.newerPending) return@LaunchedEffect
        androidx.compose.runtime.snapshotFlow { list.isScrollInProgress to list.canScrollForward }.collect { (moving, more) -> if (moving && !more) vm.clearAnchor() }
    }
    // Only while this thread is on screen and the app in front (CHAT-REPORT P0): it is "the open
    // conversation" (its pushes are not shown, its card is cleared), it polls every 5 s with `after=`,
    // refreshes at once on a push for it, and marks read up to the last message shown.
    val container = (context.applicationContext as NexusApplication).container
    val lifecycle = androidx.compose.ui.platform.LocalLifecycleOwner.current.lifecycle
    // message-created goes to the conversation's own room (pages/api/socket.ts): sit in it while open.
    id.znetworks.nexus.core.realtime.RealtimeRoom(if (s.deleted) null else "conversation:${vm.id}")
    // Message polling does not reload the room itself. A photo/name change, or returning from info,
    // must also refresh the conversation used by the header.
    id.znetworks.nexus.core.realtime.LiveRefresh(vm.id, liveMs = null, fallbackMs = null,
        matches = { it.name == id.znetworks.nexus.core.realtime.RealtimeEvents.CONVERSATION_UPDATED && it.conversationId == vm.id },
        refreshOnResume = true) { if (!vm.state.value.deleted) vm.refreshConversation() }
    LaunchedEffect(lifecycle, vm.id) {
        lifecycle.repeatOnLifecycle(androidx.lifecycle.Lifecycle.State.RESUMED) {
            ChatPresence.openConversationId = vm.id
            ChatNotifier.cancel(context, vm.id)
            try {
                launch { container.chatEvents.collect { cid -> if (cid == null || cid == vm.id) { vm.poll(); vm.markReadVisible() } } }
                // Deleted elsewhere (conversation-updated, reason "deleted"): close it with a note.
                launch { container.realtime.events.collect { e -> if (id.znetworks.nexus.core.realtime.RealtimeEvents.groupDeleted(e, vm.id)) vm.markDeleted() } }
                while (!vm.state.value.deleted) { vm.poll(); vm.markReadVisible(); delay(id.znetworks.nexus.core.realtime.RealtimeEvents.interval(container.realtime.connected, ChatApi.THREAD_POLL_LIVE_MS, ChatApi.THREAD_POLL_MS)) }
            } finally {
                if (ChatPresence.openConversationId == vm.id) ChatPresence.openConversationId = null
            }
        }
    }

    // "… is typing" (TYPING.md): who types here, and what this phone says while its person types.
    val typers = container.typing.rooms.collectAsStateWithLifecycle().value[vm.id].orEmpty()
    val typingSender = remember(vm.id) { TypingSender(vm.id, container.realtime::sendTyping) }
    LaunchedEffect(input) { typingSender.onText(input); if (input.isNotBlank()) { delay(TypingSender.IDLE_MS); typingSender.stop() } }
    val rtState by container.realtime.state.collectAsStateWithLifecycle()
    LaunchedEffect(rtState) { if (rtState != id.znetworks.nexus.core.realtime.Realtime.State.CONNECTED) typingSender.forget() }
    androidx.compose.runtime.DisposableEffect(vm.id) { onDispose { typingSender.stop() } }
    // Kept in view only when the list was already at its end.
    LaunchedEffect(typers.isNotEmpty()) {
        val lastShown = list.layoutInfo.visibleItemsInfo.lastOrNull()?.index ?: return@LaunchedEffect
        if (typers.isNotEmpty() && lastShown >= list.layoutInfo.totalItemsCount - 2) list.animateScrollToItem(list.layoutInfo.totalItemsCount)
    }

    val length = ChatComposerLimit.length(input)
    val tooLong = length > ChatComposerLimit.MAX_LENGTH || s.tooLongText == input
    val formattedLength = java.text.NumberFormat.getIntegerInstance(context.resources.configuration.locales[0]).format(length)
    val conv = s.conversation
    val members = conv?.members.orEmpty().filter { it.uid != vm.meId }
    val mentionQuery = Mentions.query(input)
    val matches = if (mentionQuery == null) emptyList() else members.filter { Mentions.matches(it.displayName, mentionQuery) }

    Column(Modifier.fillMaxSize().background(c.background).imePadding()) {
        Row(Modifier.fillMaxWidth().padding(4.dp), verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, stringResource(R.string.back)) }
            // The header opens the chat's info, like WhatsApp (SYSTEM-MESSAGES part 2).
            val infoHint = stringResource(R.string.ci_open_info)
            if (conv?.type == "GROUP" && !s.deleted) {
                Box(Modifier.clip(CircleShape).clickable(onClickLabel = infoHint, onClick = onOpenInfo)) {
                    ChatGroupAvatar(conv.name, conv.avatarUrl, 36.dp, conv.id)
                }
                Spacer(Modifier.width(10.dp))
            }
            Column(Modifier.weight(1f).clip(RoundedCornerShape(8.dp)).clickable(enabled = conv != null && !s.deleted, onClickLabel = infoHint, onClick = onOpenInfo)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(conv?.title(vm.meId, stringResource(R.string.chat_direct_message)) ?: "", fontFamily = DisplayFont, fontWeight = FontWeight.Bold, fontSize = 17.sp, color = c.foreground, maxLines = 1,
                        overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
                    if (conv?.muted() == true) Icon(Icons.Filled.NotificationsOff, stringResource(R.string.chat_muted), tint = c.mutedFg, modifier = Modifier.padding(start = 6.dp).size(16.dp))
                }
                // "typing…" in place of the member count while anyone types here (TYPING.md).
                if (typers.isNotEmpty()) Text(stringResource(R.string.ty_typing), fontSize = 11.sp, color = c.violetText)
                else if (conv?.type == "DM") PresenceLine(conv.other(vm.meId)?.id, showUntil = false)
                else if (conv != null && conv.type != "DM") Text(context.resources.getQuantityString(R.plurals.ci_members, conv.members.size, conv.members.size), fontSize = 11.sp, color = c.mutedFg)
            }
            // Add people: project rooms through the project, a GROUP for Manager and above (ChatRules).
            if (ChatRules.showsAddPeople(conv) && !s.deleted) IconButton(onClick = { vm.loadRoster(); addingPeople = true }, enabled = !s.adding) {
                Icon(Icons.Filled.PersonAdd, stringResource(R.string.chat_add_people), tint = c.violetText)
            }
            if (conv != null && !s.deleted && (conv.type == "GROUP" || s.muteSupported)) Box {
                IconButton(onClick = { menu = true }) { Icon(Icons.Filled.MoreVert, stringResource(R.string.more)) }
                DropdownMenu(menu, { menu = false }) {
                    if (conv.type == "GROUP") DropdownMenuItem(text = { Text(stringResource(R.string.chat_rename)) }, onClick = { menu = false; renaming = true })
                    // Mute per conversation (CHAT-CONTRACT): 8 hours, a week, always, or unmute.
                    if (s.muteSupported) {
                        if (conv.muted()) DropdownMenuItem(text = { Text(stringResource(R.string.chat_unmute)) }, leadingIcon = { Icon(Icons.Filled.Notifications, null) },
                            onClick = { menu = false; vm.mute(ChatThreadViewModel.Mute.OFF) })
                        else listOf(ChatThreadViewModel.Mute.HOURS_8 to R.string.chat_mute_8h, ChatThreadViewModel.Mute.WEEK to R.string.chat_mute_week,
                            ChatThreadViewModel.Mute.ALWAYS to R.string.chat_mute_always).forEach { (m, label) ->
                            DropdownMenuItem(text = { Text(stringResource(label)) }, leadingIcon = { Icon(Icons.Filled.NotificationsOff, null) },
                                onClick = { menu = false; vm.mute(m) })
                        }
                    }
                }
            }
        }
        if (s.deleted) { DeletedGroup(onBack, s.denied); return@Column }
        LazyColumn(Modifier.weight(1f), state = list, contentPadding = PaddingValues(horizontal = 12.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            if (s.hasMore) item(key = "earlier") {
                Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
                    if (s.loadingEarlier) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
                    else TextButton(onClick = vm::loadEarlier) { Text(stringResource(R.string.chat_load_earlier)) }
                }
            }
            if (s.loading && s.messages.isEmpty()) item { Box(Modifier.fillMaxWidth().padding(24.dp), contentAlignment = Alignment.Center) { CircularProgressIndicator() } }
            if (!s.loading && s.messages.isEmpty()) item { Text(stringResource(R.string.chat_say_hi), fontSize = 13.sp, color = c.mutedFg, textAlign = androidx.compose.ui.text.style.TextAlign.Center, modifier = Modifier.fillMaxWidth().padding(24.dp)) }
            itemsIndexed(s.messages, key = { _, message -> message.id }) { index, m ->
                if (!s.hasMore && m == s.messages.firstOrNull()) Text(stringResource(R.string.chat_conversation_start), fontSize = 12.sp, color = c.mutedFg,
                    textAlign = androidx.compose.ui.text.style.TextAlign.Center, modifier = Modifier.fillMaxWidth().padding(vertical = 16.dp))
                val date = chatDay(m.createdAt)
                if (date != null && (index == 0 || date != chatDay(s.messages.getOrNull(index - 1)?.createdAt))) {
                    Text(if (date == java.time.LocalDate.now()) stringResource(R.string.cal_today) else id.znetworks.nexus.core.i18n.AppDateFormats.ofPattern("d MMM yyyy").format(date),
                        color = c.mutedFg, fontSize = 12.sp, fontWeight = FontWeight.SemiBold, textAlign = androidx.compose.ui.text.style.TextAlign.Center,
                        modifier = Modifier.fillMaxWidth().padding(vertical = 12.dp))
                }
                // A group's log line ("Budi added Mira"): a centred muted pill, no avatar, no bubble, no actions;
                // a tap shows its time (SYSTEM-MESSAGES).
                if (m.isSystem) { SystemPill(m, vm.meId); return@itemsIndexed }
                val mine = m.userId == vm.meId || m.user?.id == vm.meId
                var msgMenu by remember { mutableStateOf(false) }
                Row(Modifier.fillMaxWidth(), horizontalArrangement = if (mine) Arrangement.End else Arrangement.Start, verticalAlignment = Alignment.Bottom) {
                    if (!mine && conv?.type != "DM") { Avatar(m.user?.name, m.user?.avatar, 26.dp, userId = m.user?.id); Spacer(Modifier.width(6.dp)) }
                    Box {
                        Column(
                            Modifier.widthIn(max = 290.dp).clip18().background(if (mine) c.onyx else c.card)
                                .let { if (m.id == s.anchorId) it.border(2.dp, c.warning, RoundedCornerShape(18.dp)) else it }
                                .let { if (!mine) it.border(1.dp, c.border, RoundedCornerShape(18.dp)) else it }
                                .combinedClickable(onClick = {}, onLongClick = { msgMenu = true }).padding(horizontal = 12.dp, vertical = 8.dp),
                        ) {
                            val fg = if (mine) c.background else c.foreground
                            if (!mine && conv?.type != "DM") Text(m.user?.name ?: "", fontSize = 11.sp, fontWeight = FontWeight.Bold, color = c.violetText)
                            m.replyTo?.let { r ->
                                Column(Modifier.fillMaxWidth().padding(vertical = 4.dp).background(fg.copy(alpha = 0.12f), RoundedCornerShape(8.dp)).padding(6.dp)) {
                                    Text(r.user?.name ?: "", fontSize = 11.sp, fontWeight = FontWeight.Bold, color = fg.copy(alpha = 0.9f))
                                    Text(ChatDocuments.preview(r.attachmentType, r.attachmentName, stringResource(R.string.files)) ?: r.content.ifBlank { "📷 " + stringResource(R.string.chat_photo) }, fontSize = 12.sp, color = fg.copy(alpha = 0.8f), maxLines = 2, overflow = TextOverflow.Ellipsis)
                                }
                            }
                            if (m.isImage) {
                                ChatPhoto(m.attachmentUrl, Modifier.padding(vertical = 4.dp).size(220.dp).clip18(), ContentScale.Crop, maxPx = 900,
                                    ink = if (mine) fg else c.mutedFg) { viewing = m.attachmentUrl }
                            }
                            if (m.attachmentUrl != null && !m.isImage) Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(fg.copy(alpha = 0.10f)).clickable { vm.openDocument(m, false) }.padding(start = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                                Icon(Icons.Filled.Description, null, tint = fg, modifier = Modifier.size(28.dp))
                                Column(Modifier.weight(1f).padding(horizontal = 8.dp)) {
                                    Text(m.attachmentName ?: stringResource(R.string.files), color = fg, fontSize = 14.sp, fontWeight = FontWeight.SemiBold)
                                    Text(listOfNotNull(m.attachmentName?.substringAfterLast('.', "")?.takeIf { it.isNotBlank() }?.uppercase(), id.znetworks.nexus.feature.tasks.sizeText(m.attachmentSize)).joinToString(" · "), color = fg.copy(alpha = 0.75f), fontSize = 11.sp)
                                }
                                IconButton(onClick = { vm.openDocument(m, true) }) { Icon(Icons.Filled.Download, stringResource(R.string.chat_file_download), tint = fg) }
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
                                ChatPayload.Plain -> if (m.content.isNotBlank()) Text(highlight(m.content, if (mine) fg else c.violetText, fg), fontSize = 15.sp, color = fg)
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
                    IconButton(onClick = { vm.reply(m) }) { Icon(Icons.AutoMirrored.Filled.Reply, stringResource(R.string.chat_reply), tint = c.mutedFg, modifier = Modifier.size(16.dp)) }
                }
            }
            if (typers.isNotEmpty()) item(key = "typing") { TypingIndicator(typers, conv?.type == "DM") }
        }
        s.notice?.let {
            Row(Modifier.fillMaxWidth().background(c.danger.copy(alpha = 0.08f)).padding(horizontal = 14.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(it, fontSize = 12.sp, color = c.danger, modifier = Modifier.weight(1f))
                IconButton(onClick = vm::dismissNotice) { Icon(Icons.Filled.Close, stringResource(R.string.cancel), tint = c.danger) }
            }
        }
        // Composer
        Column(Modifier.fillMaxWidth().background(c.card).padding(horizontal = 8.dp, vertical = 6.dp)) {
            s.replyTo?.let { r ->
                Row(Modifier.fillMaxWidth().padding(4.dp), verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.AutoMirrored.Filled.Reply, null, tint = c.violetText, modifier = Modifier.size(16.dp)); Spacer(Modifier.width(6.dp))
                    Column(Modifier.weight(1f)) {
                        Text(stringResource(R.string.chat_replying_to, r.user?.name ?: ""), fontSize = 11.sp, fontWeight = FontWeight.Bold, color = c.violetText)
                        Text(ChatDocuments.preview(r.attachmentType, r.attachmentName, stringResource(R.string.files)) ?: r.content.ifBlank { "📷" }, fontSize = 12.sp, color = c.mutedFg, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    }
                    IconButton(onClick = { vm.reply(null) }) { Icon(Icons.Filled.Close, stringResource(R.string.cancel)) }
                }
            }
            if (s.uploading || s.attachment != null) Row(Modifier.padding(4.dp), verticalAlignment = Alignment.CenterVertically) {
                if (s.uploading) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
                else if (s.attachment?.kind == "file") Icon(Icons.Filled.Description, null, modifier = Modifier.size(40.dp))
                else RemoteImage(s.attachment?.url, Modifier.size(56.dp).clip18(), ContentScale.Crop, maxPx = 200)
                Spacer(Modifier.width(8.dp))
                Text(if (s.attachment?.kind == "file" && !s.uploading) s.attachment?.name.orEmpty() + " · " + id.znetworks.nexus.feature.tasks.sizeText(s.attachment?.size) else stringResource(if (s.uploading) R.string.chat_uploading else R.string.chat_photo_ready), fontSize = 12.sp, color = c.mutedFg, modifier = Modifier.weight(1f))
                if (!s.uploading) IconButton(onClick = vm::clearAttachment) { Icon(Icons.Filled.Close, stringResource(R.string.cancel)) }
            }
            if (matches.isNotEmpty()) Row(Modifier.horizontalScroll(rememberScrollState()).padding(4.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                matches.forEach { m ->
                    Row(Modifier.clip18().background(c.muted).clickable {
                        input = Mentions.insert(input, m.displayName); vm.picked[m.uid] = Mentions.tag(m.displayName)
                    }.padding(horizontal = 10.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                        Avatar(m.displayName, m.user?.avatar, 20.dp, userId = m.uid); Spacer(Modifier.width(6.dp)); Text(m.displayName, fontSize = 12.sp, color = c.foreground)
                    }
                }
            }
            if (length >= ChatComposerLimit.COUNTER_FROM || tooLong) Text(stringResource(if (tooLong) R.string.qa_chat_too_long else R.string.qa_chat_count, formattedLength), color = if (tooLong) c.dangerText else c.mutedFg, fontSize = 12.sp, modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 4.dp))
            // Can view in a project room: read, no composer (web N-03).
            if (s.conversation?.canPost == false) Text(stringResource(R.string.chat_view_only), fontSize = 12.sp, color = c.mutedFg,
                textAlign = androidx.compose.ui.text.style.TextAlign.Center, modifier = Modifier.fillMaxWidth().padding(vertical = 12.dp, horizontal = 16.dp))
            else Row(verticalAlignment = Alignment.Bottom) {
                Box {
                    IconButton(onClick = { attachMenu = true }, enabled = !s.uploading, modifier = Modifier.border(1.dp, c.border, CircleShape)) { Icon(Icons.Filled.AttachFile, stringResource(R.string.chat_attach), tint = c.mutedFg) }
                    DropdownMenu(attachMenu, { attachMenu = false }) {
                        DropdownMenuItem(text = { Text(stringResource(R.string.files)) }, leadingIcon = { Icon(Icons.Filled.Description, null) }, onClick = {
                            attachMenu = false; documents.launch(arrayOf("*/*"))
                        })
                        DropdownMenuItem(text = { Text(stringResource(R.string.gallery)) }, leadingIcon = { Icon(Icons.Filled.Image, null) }, onClick = {
                            attachMenu = false; gallery.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly))
                        })
                        DropdownMenuItem(text = { Text(stringResource(R.string.camera)) }, leadingIcon = { Icon(Icons.Filled.PhotoCamera, null) }, onClick = {
                            attachMenu = false
                            camera()
                        })
                        DropdownMenuItem(text = { Text(stringResource(R.string.chat_send_location)) }, leadingIcon = { Icon(Icons.Filled.LocationOn, null) }, onClick = {
                            attachMenu = false
                            locationPerm.launch(arrayOf(android.Manifest.permission.ACCESS_FINE_LOCATION, android.Manifest.permission.ACCESS_COARSE_LOCATION))
                        })
                    }
                }
                TextField(input, { input = it }, placeholder = { Text(stringResource(R.string.chat_placeholder), fontSize = 14.sp) }, maxLines = 5,
                    colors = TextFieldDefaults.colors(focusedContainerColor = c.muted, unfocusedContainerColor = c.muted, focusedIndicatorColor = Color.Transparent, unfocusedIndicatorColor = Color.Transparent),
                    shape = RoundedCornerShape(28.dp), modifier = Modifier.weight(1f).padding(horizontal = 6.dp).onFocusChanged { if (!it.isFocused) typingSender.stop() })
                IconButton(onClick = { typingSender.stop(); vm.send(input) { input = "" } }, modifier = Modifier.background(if (input.isNotBlank() || s.attachment != null) c.onyx else c.mutedFg, CircleShape), enabled = !tooLong && !s.sending && !s.uploading && (input.isNotBlank() || s.attachment != null)) {
                    if (s.sending) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
                    else Icon(Icons.AutoMirrored.Filled.Send, stringResource(R.string.td_send), tint = c.background)
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
    if (addingPeople && conv != null) AddPeopleDialog(conv, s.roster, vm.meId, onDismiss = { addingPeople = false }) { ids -> addingPeople = false; vm.addPeople(ids) }
    if (renaming) {
        var name by rememberSaveable { mutableStateOf(conv?.name.orEmpty()) }
        AlertDialog(onDismissRequest = { renaming = false }, title = { Text(stringResource(R.string.chat_rename)) },
            text = { NxTextField(name, { name = it.take(80) }, singleLine = true, modifier = Modifier.fillMaxWidth()) },
            confirmButton = { TextButton(onClick = { renaming = false; vm.rename(name) }, enabled = name.isNotBlank()) { Text(stringResource(R.string.save)) } },
            dismissButton = { TextButton(onClick = { renaming = false }) { Text(stringResource(R.string.cancel)) } })
    }
}

private fun Modifier.clip18() = this.clip(RoundedCornerShape(18.dp))

private fun chatDay(raw: String?) = runCatching { java.time.Instant.parse(raw).atZone(java.time.ZoneId.systemDefault()).toLocalDate() }.getOrNull()

/** @mention tokens in the accent colour; web links underlined and tappable (CHAT-REPORT P0). */
internal fun highlight(text: String, accent: Color, linkColor: Color = accent): AnnotatedString = buildAnnotatedString {
    var i = 0
    ChatText.tokens(text).forEach { t ->
        append(text.substring(i, t.range.first))
        val v = text.substring(t.range)
        when (t.kind) {
            ChatText.Kind.MENTION -> withStyle(SpanStyle(color = accent, fontWeight = FontWeight.Bold)) { append(v) }
            ChatText.Kind.LINK -> withLink(LinkAnnotation.Url(ChatText.url(v), TextLinkStyles(SpanStyle(color = linkColor, textDecoration = TextDecoration.Underline)))) { append(v) }
        }
        i = t.range.last + 1
    }
    append(text.substring(i))
}

/** Mentions and links in a message (pure, tested). */
object ChatText {
    enum class Kind { MENTION, LINK }
    data class Token(val kind: Kind, val range: IntRange)
    private val LINK = Regex("""(?i)\b((?:https?://|www\.)[^\s<>"']+[^\s<>"'.,;:!?)\]])""")
    private val MENTION = Regex("@\\S+")

    fun tokens(text: String): List<Token> {
        val links = LINK.findAll(text).map { Token(Kind.LINK, it.range) }.toList()
        val mentions = MENTION.findAll(text).map { Token(Kind.MENTION, it.range) }.filter { m -> links.none { it.range.first <= m.range.first && m.range.first <= it.range.last } }
        return (links + mentions).sortedBy { it.range.first }
    }

    /** "www.x.id" opens as "https://www.x.id". */
    fun url(raw: String) = if (raw.startsWith("http", ignoreCase = true)) raw else "https://$raw"
}

/** Pick workspace people not yet in the room (iOS AddProjectPeopleSheet; a dialog, not a bottom sheet). */
@OptIn(androidx.compose.foundation.layout.ExperimentalLayoutApi::class)
@Composable
internal fun AddPeopleDialog(conv: Conversation, roster: List<RosterMember>?, meId: String?, onDismiss: () -> Unit, onAdd: (List<String>) -> Unit) {
    val c = Nx.colors
    var q by rememberSaveable { mutableStateOf("") }
    var picked by remember { mutableStateOf(setOf<String>()) }
    val inRoom = conv.members.map { it.uid }.toSet() + listOfNotNull(meId)
    val candidates = roster.orEmpty().filter { m -> (m.userId ?: m.id).let { !it.isNullOrBlank() && it !in inRoom } }
    val shown = candidates.filter { m -> q.isBlank() || listOfNotNull(m.name, m.email).any { it.contains(q.trim(), true) } }
        .sortedBy { it.name.orEmpty().lowercase() }
    val project = conv.projectId != null
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(R.string.chat_add_people)) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                if (project) Text(stringResource(R.string.chat_add_project_hint), fontSize = 12.sp, color = c.mutedFg)
                when {
                    roster == null -> CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
                    candidates.isEmpty() -> Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        Text(stringResource(R.string.chat_everyone_here), fontWeight = FontWeight.Bold, color = c.foreground)
                        Text(stringResource(if (project) R.string.chat_everyone_here_project else R.string.chat_everyone_here_group), fontSize = 13.sp, color = c.mutedFg)
                    }
                    else -> {
                        NxTextField(q, { q = it }, singleLine = true, placeholder = { Text(stringResource(R.string.ps_search_people)) }, modifier = Modifier.fillMaxWidth())
                        LazyColumn(Modifier.heightIn(max = 320.dp)) {
                            items(shown, key = { it.userId ?: it.id ?: it.email.orEmpty() }) { m ->
                                val uid = m.userId ?: m.id ?: ""
                                val on = uid in picked
                                Row(Modifier.fillMaxWidth().clickable { picked = if (on) picked - uid else picked + uid }.padding(vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                                    Avatar(m.name, m.avatar, 28.dp, userId = m.userId); Spacer(Modifier.width(10.dp))
                                    Text(m.name ?: m.email ?: "—", fontSize = 14.sp, color = c.foreground, modifier = Modifier.weight(1f))
                                    NxCheckbox(on, { picked = if (on) picked - uid else picked + uid })
                                }
                            }
                        }
                    }
                }
            }
        },
        confirmButton = { TextButton(onClick = { onAdd(picked.toList()) }, enabled = picked.isNotEmpty()) { Text(stringResource(R.string.add)) } },
        dismissButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.cancel)) } },
    )
}

@Composable
internal fun SystemPill(m: Message, meId: String?) {
    val c = Nx.colors
    val res = LocalContext.current.resources
    val text = remember(m.id, m.event, meId) { ChatSystemText.sentence(m.event, m.content, meId, ChatSystemText.Words.of(res)) }
    var showTime by remember { mutableStateOf(false) }
    Column(Modifier.fillMaxWidth().padding(vertical = 2.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        Text(text, fontSize = 12.sp, color = c.mutedFg, textAlign = androidx.compose.ui.text.style.TextAlign.Center,
            modifier = Modifier.widthIn(max = 300.dp).clip(RoundedCornerShape(10.dp)).background(c.muted)
                .clickable { showTime = !showTime }.padding(horizontal = 10.dp, vertical = 5.dp))
        if (showTime) Text(chatTime(m.createdAt), fontSize = 10.sp, color = c.mutedFg, modifier = Modifier.padding(top = 2.dp))
    }
}

/** The group was deleted (DELETE-GROUP): instead of its messages and composer. */
@Composable
private fun ColumnScope.DeletedGroup(onBack: () -> Unit, denied: Boolean = false) {
    val c = Nx.colors
    Column(Modifier.weight(1f).fillMaxWidth().padding(32.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
        Icon(Icons.Filled.Delete, null, tint = c.mutedFg, modifier = Modifier.size(40.dp))
        Spacer(Modifier.height(12.dp))
        Text(stringResource(if (denied) R.string.qa_chat_denied else R.string.dg_deleted_title), fontFamily = DisplayFont, fontWeight = FontWeight.Bold, fontSize = 18.sp, color = c.foreground,
            textAlign = androidx.compose.ui.text.style.TextAlign.Center)
        if (!denied) Text(stringResource(R.string.dg_deleted_body), fontSize = 13.sp, color = c.mutedFg, textAlign = androidx.compose.ui.text.style.TextAlign.Center,
            modifier = Modifier.padding(top = 6.dp))
        Spacer(Modifier.height(16.dp))
        androidx.compose.material3.Button(onClick = onBack) { Text(stringResource(R.string.dg_back_to_chats)) }
    }
}

/**
 * The typers' photos (up to 3 overlapping, then "+N") beside one incoming bubble of three dots rising in turn;
 * in a group, "Budi is typing…" / "2 people are typing…" under it. Still dots when animations are off.
 */
@Composable
private fun TypingIndicator(typers: List<Typer>, isDm: Boolean) {
    val c = Nx.colors
    val context = LocalContext.current
    val someone = stringResource(R.string.ty_someone)
    val one = { n: String -> context.getString(R.string.ty_one, n) }
    val many = { n: Int -> context.resources.getQuantityString(R.plurals.ty_many, n, n) }
    val sentence = TypingText.sentence(typers, isDm, one, someone, many)
    val label = sentence ?: one(typers.firstOrNull()?.name ?: someone)
    val still = remember { runCatching { android.provider.Settings.Global.getFloat(context.contentResolver, android.provider.Settings.Global.ANIMATOR_DURATION_SCALE, 1f) == 0f }.getOrDefault(false) }
    Column(Modifier.fillMaxWidth().semantics(mergeDescendants = true) { contentDescription = label }) {
        Row(verticalAlignment = Alignment.Bottom) {
            Box {
                typers.take(3).forEachIndexed { i, t ->
                    Box(Modifier.padding(start = (i * 16).dp).border(1.5.dp, c.background, CircleShape)) { Avatar(t.name, t.avatar, 26.dp, userId = t.userId) }
                }
                if (typers.size > 3) Box(Modifier.padding(start = (3 * 16).dp).size(26.dp).background(c.muted, CircleShape).border(1.5.dp, c.background, CircleShape),
                    contentAlignment = Alignment.Center) { Text("+${typers.size - 3}", fontSize = 10.sp, fontWeight = FontWeight.Bold, color = c.mutedFg) }
            }
            Spacer(Modifier.width(6.dp))
            Row(Modifier.clip18().background(c.card).border(1.dp, c.border, RoundedCornerShape(18.dp)).padding(horizontal = 14.dp, vertical = 12.dp),
                horizontalArrangement = Arrangement.spacedBy(4.dp), verticalAlignment = Alignment.CenterVertically) {
                val cycle = androidx.compose.animation.core.rememberInfiniteTransition(label = "typing")
                repeat(3) { k ->
                    val lift by cycle.animateFloat(0f, 1f, androidx.compose.animation.core.infiniteRepeatable(
                        androidx.compose.animation.core.keyframes { durationMillis = 1200; 0f at 0 + k * 150; 1f at 300 + k * 150; 0f at 600 + k * 150; 0f at 1200 }), label = "dot$k")
                    val l = if (still) 0f else lift
                    Box(Modifier.size(7.dp).graphicsLayer { translationY = -4.dp.toPx() * l; alpha = 0.45f + 0.55f * l }.background(c.mutedFg, CircleShape))
                }
            }
        }
        sentence?.let { Text(it, fontSize = 11.sp, color = c.mutedFg, modifier = Modifier.padding(start = 2.dp, top = 3.dp)) }
    }
}

