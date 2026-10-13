package id.znetworks.nexus.feature.threads

import id.znetworks.nexus.ui.components.PageHeader
import android.app.Application
import android.graphics.BitmapFactory
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.ChatBubbleOutline
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Favorite
import androidx.compose.material.icons.filled.FavoriteBorder
import androidx.compose.material.icons.filled.Image
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.Forum
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import id.znetworks.nexus.NexusApplication
import id.znetworks.nexus.R
import id.znetworks.nexus.core.net.ApiError
import id.znetworks.nexus.feature.attendance.requests.AttachmentReader
import id.znetworks.nexus.feature.chat.Mentions
import id.znetworks.nexus.feature.chat.chatTime
import id.znetworks.nexus.feature.projects.ProjectsApi
import id.znetworks.nexus.feature.projects.RosterMember
import id.znetworks.nexus.ui.components.Avatar
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
import java.time.Instant

/** A photo picked for a post, already made upright JPEG. */
class PickedPhoto(val jpeg: ByteArray, val w: Int, val h: Int)

data class ThreadsState(
    val posts: List<Post> = emptyList(),
    val cursor: String? = null,
    val hasMore: Boolean = false,
    val loading: Boolean = true,
    val loadingMore: Boolean = false,
    val error: String? = null,
    val posting: Boolean = false,
    val photos: List<PickedPhoto> = emptyList(),
    val roster: List<RosterMember> = emptyList(),
    val notice: String? = null,
    val comments: List<FeedComment>? = null,
    val commentsFor: String? = null,
    /** All | Mentions (web 13 Oct): the Mentions tab reads `mentions=me` and has no composer. */
    val mentionsOnly: Boolean = false,
)

class ThreadsViewModel(app: Application) : AndroidViewModel(app) {
    private val c = (app as NexusApplication).container
    private val api = ThreadsApi(c.api)
    private val res get() = getApplication<Application>().resources
    private val _state = MutableStateFlow(ThreadsState())
    val state = _state.asStateFlow()
    /** Picked @tags by user id (composer and comment box share it; cleared after each send). */
    val picked = mutableMapOf<String, String>()

    init {
        refresh()
        // The mention list: /api/members (THREADS-TASK-FOLDERS), else the workspace roster on an older server.
        viewModelScope.launch {
            (runCatching { api.members() }.getOrNull()?.takeIf { it.isNotEmpty() } ?: runCatching { ProjectsApi(c.api).roster().members }.getOrNull())
                ?.let { l -> _state.update { it.copy(roster = l) } }
        }
    }

    private fun rosterIds() = _state.value.roster.mapNotNull { m -> (m.userId ?: m.id)?.let { it to m.name.orEmpty() } }

    fun refresh() = viewModelScope.launch {
        val mentions = _state.value.mentionsOnly
        try {
            val p = api.page(null, mentionsMe = mentions)
            // A tab switched while this was on its way: its own answer wins.
            if (_state.value.mentionsOnly != mentions) return@launch
            _state.update { it.copy(posts = p.posts, cursor = p.nextCursor, hasMore = p.hasMore, loading = false, error = null) }
        } catch (e: ApiError) { _state.update { it.copy(loading = false, error = if (it.posts.isEmpty()) e.describe(res) else null) } }
    }

    /** All | Mentions: the list starts over from the tab's first page. */
    fun setMentions(on: Boolean) {
        if (_state.value.mentionsOnly == on) return
        _state.update { it.copy(mentionsOnly = on, posts = emptyList(), cursor = null, hasMore = false, loading = true, error = null) }
        refresh()
    }

    /** iOS never pages; Android does, with the server's cursor. */
    fun more() {
        val s = _state.value
        if (!s.hasMore || s.loadingMore || s.cursor == null) return
        _state.update { it.copy(loadingMore = true) }
        viewModelScope.launch {
            try {
                val p = api.page(s.cursor, mentionsMe = s.mentionsOnly)
                _state.update { st -> st.copy(posts = st.posts + p.posts.filter { n -> st.posts.none { it.id == n.id } }, cursor = p.nextCursor, hasMore = p.hasMore) }
            } catch (_: ApiError) {}
            _state.update { it.copy(loadingMore = false) }
        }
    }

    fun addPhotos(uris: List<Uri>) = viewModelScope.launch {
        val room = FeedRules.MAX_IMAGES - _state.value.photos.size
        val picked = withContext(Dispatchers.IO) {
            uris.take(room).mapNotNull { u ->
                AttachmentReader.uprightJpeg(getApplication(), u)?.let { b ->
                    val o = BitmapFactory.Options().apply { inJustDecodeBounds = true }
                    BitmapFactory.decodeByteArray(b, 0, b.size, o)
                    PickedPhoto(b, o.outWidth, o.outHeight)
                }
            }
        }
        val tooBig = picked.any { it.jpeg.size > FeedRules.MAX_IMAGE_BYTES }
        _state.update { it.copy(photos = it.photos + picked.filter { p -> p.jpeg.size <= FeedRules.MAX_IMAGE_BYTES },
            notice = if (tooBig) res.getString(R.string.td_file_too_big) else if (picked.size < uris.take(room).size) res.getString(R.string.chat_photo_unreadable) else null) }
    }

    fun removePhoto(p: PickedPhoto) = _state.update { it.copy(photos = it.photos - p) }
    fun dismiss() = _state.update { it.copy(notice = null) }

    /** Server sentences (Indonesian: too long, 20 s between posts, hourly cap) are shown verbatim. */
    fun post(text: String, onDone: () -> Unit) {
        val s = _state.value
        if (s.posting || (text.isBlank() && s.photos.isEmpty())) return
        _state.update { it.copy(posting = true, notice = null) }
        viewModelScope.launch {
            try {
                val p = api.create(text, FeedMentions.ids(text, picked, rosterIds()), s.photos.map { Triple(it.jpeg, it.w, it.h) })
                picked.clear()
                _state.update { it.copy(posts = listOf(p.copy(canDelete = true, canEdit = true)) + it.posts, photos = emptyList()) }
                onDone()
            } catch (e: ApiError) {
                _state.update { it.copy(notice = (e as? ApiError.Http)?.serverMessage ?: res.getString(R.string.th_post_failed)) }
            }
            _state.update { it.copy(posting = false) }
        }
    }

    fun edit(p: Post, text: String) = viewModelScope.launch {
        try {
            val updated = api.edit(p.id, text, FeedMentions.ids(text, picked, rosterIds()))
            picked.clear()
            _state.update { s -> s.copy(posts = s.posts.map { if (it.id == p.id) updated else it }) }
        } catch (e: ApiError) { _state.update { it.copy(notice = (e as? ApiError.Http)?.serverMessage ?: e.describe(res)) } }
    }

    /** Optimistic, then reconciled with the server's count. */
    fun like(p: Post) {
        _state.update { s -> s.copy(posts = s.posts.map { if (it.id == p.id) it.copy(likedByMe = !p.likedByMe, likeCount = p.likeCount + if (p.likedByMe) -1 else 1) else it }) }
        viewModelScope.launch {
            try {
                val r = api.like(p.id)
                _state.update { s -> s.copy(posts = s.posts.map { if (it.id == p.id) it.copy(likedByMe = r.liked, likeCount = r.likeCount) else it }) }
            } catch (_: ApiError) {
                _state.update { s -> s.copy(posts = s.posts.map { if (it.id == p.id) p else it }) }
            }
        }
    }

    fun delete(p: Post) = viewModelScope.launch {
        try { api.delete(p.id); _state.update { s -> s.copy(posts = s.posts.filterNot { it.id == p.id }) } }
        catch (e: ApiError) { _state.update { it.copy(notice = (e as? ApiError.Http)?.serverMessage ?: res.getString(R.string.th_delete_failed)) } }
    }

    fun openComments(postId: String?) {
        _state.update { it.copy(commentsFor = postId, comments = null) }
        // A push or link to a post that isn't on the first page: fetch it so its heart, count and comments show.
        if (postId != null && _state.value.posts.none { it.id == postId }) viewModelScope.launch {
            runCatching { api.post(postId) }.getOrNull()?.let { p -> _state.update { s -> if (s.posts.any { it.id == p.id }) s else s.copy(posts = listOf(p) + s.posts) } }
        }
        if (postId != null) viewModelScope.launch {
            runCatching { api.comments(postId) }.getOrNull()?.let { l -> _state.update { it.copy(comments = l) } }
        }
    }

    fun comment(text: String, onDone: () -> Unit) {
        val id = _state.value.commentsFor ?: return
        viewModelScope.launch {
            try {
                val cm = api.comment(id, text, FeedMentions.ids(text, picked, rosterIds()))
                picked.clear()
                _state.update { s -> s.copy(comments = s.comments.orEmpty() + cm, posts = s.posts.map { if (it.id == id) it.copy(commentCount = it.commentCount + 1) else it }) }
                onDone()
            } catch (e: ApiError) { _state.update { it.copy(notice = (e as? ApiError.Http)?.serverMessage ?: res.getString(R.string.th_comment_failed)) } }
        }
    }
}

@Composable
fun ThreadsScreen(onBack: () -> Unit, focusPostId: String? = null, vm: ThreadsViewModel = viewModel()) {
    val s by vm.state.collectAsStateWithLifecycle()
    val c = Nx.colors
    val list = rememberLazyListState()
    var draft by rememberSaveable { mutableStateOf("") }
    val nearEnd by remember { derivedStateOf { list.layoutInfo.visibleItemsInfo.lastOrNull()?.index?.let { it >= list.layoutInfo.totalItemsCount - 3 } == true } }
    LaunchedEffect(nearEnd) { if (nearEnd) vm.more() }
    // A mention/comment notification points at one post: its comments open once the feed is in.
    LaunchedEffect(focusPostId, s.loading) { if (focusPostId != null && !s.loading) vm.openComments(focusPostId) }
    val pick = rememberLauncherForActivityResult(ActivityResultContracts.PickMultipleVisualMedia(FeedRules.MAX_IMAGES)) { if (it.isNotEmpty()) vm.addPhotos(it) }

    Column(Modifier.fillMaxSize().background(c.background).imePadding()) {
        PageHeader(stringResource(R.string.th_title), subtitle = stringResource(R.string.sub_threads), onBack = onBack, tabs = {
            id.znetworks.nexus.ui.components.PageTabs(
                listOf(id.znetworks.nexus.ui.components.PageTab(false, stringResource(R.string.th_tab_all)),
                    id.znetworks.nexus.ui.components.PageTab(true, stringResource(R.string.th_tab_mentions))),
                s.mentionsOnly, vm::setMentions)
        })
        PullToRefreshBox(isRefreshing = false, onRefresh = { vm.refresh() }, modifier = Modifier.weight(1f)) {
            LazyColumn(state = list, contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                if (!s.mentionsOnly) item(key = "composer") {
                    Column(Modifier.fillMaxWidth().background(c.card, RoundedCornerShape(18.dp)).border(1.dp, c.border, RoundedCornerShape(18.dp)).padding(12.dp),
                        verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        OutlinedTextField(draft, { draft = it.take(FeedRules.MAX_TEXT) }, placeholder = { Text(stringResource(R.string.th_whats_new)) },
                            minLines = 2, maxLines = 6, modifier = Modifier.fillMaxWidth())
                        MentionRow(draft, s.roster, vm.picked) { draft = it }
                        if (s.photos.isNotEmpty()) Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            s.photos.forEach { p ->
                                val bmp = remember(p) { BitmapFactory.decodeByteArray(p.jpeg, 0, p.jpeg.size, BitmapFactory.Options().apply { inSampleSize = 8 })?.asImageBitmap() }
                                Box {
                                    bmp?.let { androidx.compose.foundation.Image(it, null, Modifier.size(72.dp).clip(RoundedCornerShape(10.dp)), contentScale = ContentScale.Crop) }
                                    IconButton(onClick = { vm.removePhoto(p) }, modifier = Modifier.align(Alignment.TopEnd).size(24.dp).background(Color.Black.copy(alpha = 0.5f), CircleShape)) {
                                        Icon(Icons.Filled.Close, stringResource(R.string.cancel), tint = Color.White, modifier = Modifier.size(14.dp))
                                    }
                                }
                            }
                        }
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            IconButton(onClick = { pick.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)) },
                                enabled = s.photos.size < FeedRules.MAX_IMAGES) { Icon(Icons.Filled.Image, stringResource(R.string.gallery), tint = c.violetText) }
                            Text("${draft.length}/${FeedRules.MAX_TEXT}", fontSize = 11.sp, color = c.mutedFg, modifier = Modifier.weight(1f))
                            TextButton(onClick = { vm.post(draft) { draft = "" } }, enabled = !s.posting && (draft.isNotBlank() || s.photos.isNotEmpty())) {
                                if (s.posting) CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp) else Text(stringResource(R.string.th_post), fontWeight = FontWeight.Bold)
                            }
                        }
                    }
                }
                when {
                    s.loading && s.posts.isEmpty() -> item { Box(Modifier.fillMaxWidth().padding(32.dp), contentAlignment = Alignment.Center) { CircularProgressIndicator() } }
                    s.error != null && s.posts.isEmpty() -> item { EmptyState(Icons.Filled.Forum, stringResource(R.string.th_load_failed), s.error!!, stringResource(R.string.try_again), { vm.refresh() }) }
                    // The composer above IS the next step, so no button that would only point at it.
                    s.posts.isEmpty() && s.mentionsOnly -> item {
                        EmptyState(Icons.Filled.Forum, stringResource(R.string.th_no_mentions), stringResource(R.string.th_no_mentions_sub),
                            stringResource(R.string.th_tab_all), { vm.setMentions(false) })
                    }
                    s.posts.isEmpty() -> item { id.znetworks.nexus.feature.projects.TabEmpty(Icons.Filled.Forum, stringResource(R.string.th_empty_sub)) }
                }
                items(s.posts, key = { it.id }) { p -> PostCard(p, vm) }
                if (s.loadingMore) item { Box(Modifier.fillMaxWidth().padding(12.dp), contentAlignment = Alignment.Center) { CircularProgressIndicator(Modifier.size(20.dp)) } }
            }
        }
    }
    s.notice?.let { AlertDialog(onDismissRequest = vm::dismiss, text = { Text(it) }, confirmButton = { TextButton(onClick = vm::dismiss) { Text("OK") } }) }
    if (s.commentsFor != null) CommentsSheet(s, vm)
}

@Composable
private fun MentionRow(text: String, roster: List<RosterMember>, picked: MutableMap<String, String>, onText: (String) -> Unit) {
    val q = Mentions.query(text) ?: return
    val c = Nx.colors
    val matches = roster.filter { !it.name.isNullOrBlank() && (q.isEmpty() || it.name.contains(q, true)) }.take(12)
    if (matches.isEmpty()) return
    Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        matches.forEach { m ->
            Row(Modifier.clip(RoundedCornerShape(16.dp)).background(c.muted).clickable {
                onText(Mentions.insert(text, m.name!!)); (m.userId ?: m.id)?.let { picked[it] = Mentions.tag(m.name) }
            }.padding(horizontal = 10.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                Avatar(m.name, m.avatar, 20.dp); Spacer(Modifier.width(6.dp)); Text(m.name!!, fontSize = 12.sp, color = c.foreground)
            }
        }
    }
}

private fun highlight(text: String, accent: Color): AnnotatedString = buildAnnotatedString {
    var i = 0
    Regex("@\\S+").findAll(text).forEach { m ->
        append(text.substring(i, m.range.first)); withStyle(SpanStyle(color = accent, fontWeight = FontWeight.Bold)) { append(m.value) }; i = m.range.last + 1
    }
    append(text.substring(i))
}

@Composable
private fun PostCard(p: Post, vm: ThreadsViewModel) {
    val c = Nx.colors
    var menu by remember { mutableStateOf(false) }
    var confirmDelete by remember { mutableStateOf(false) }
    var editing by remember { mutableStateOf(false) }
    val editable = p.canEdit && p.createdAt?.let { runCatching { System.currentTimeMillis() - Instant.parse(it).toEpochMilli() < FeedRules.EDIT_WINDOW_MS }.getOrNull() } == true
    Column(Modifier.fillMaxWidth().background(c.card, RoundedCornerShape(18.dp)).border(1.dp, c.border, RoundedCornerShape(18.dp)).padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Avatar(p.author?.name, p.author?.avatar, 36.dp); Spacer(Modifier.width(10.dp))
            Column(Modifier.weight(1f)) {
                Text(p.author?.name ?: "—", fontSize = 14.sp, fontWeight = FontWeight.Bold, color = c.foreground)
                Text(chatTime(p.createdAt) + if (p.editedAt != null) " · " + stringResource(R.string.th_edited) else "", fontSize = 11.sp, color = c.mutedFg)
            }
            if (p.canDelete || editable) Box {
                IconButton(onClick = { menu = true }) { Icon(Icons.Filled.MoreVert, stringResource(R.string.more), tint = c.mutedFg) }
                DropdownMenu(menu, { menu = false }) {
                    if (editable) DropdownMenuItem(text = { Text(stringResource(R.string.th_edit)) }, onClick = { menu = false; editing = true })
                    if (p.canDelete) DropdownMenuItem(text = { Text(stringResource(R.string.delete), color = c.danger) }, onClick = { menu = false; confirmDelete = true })
                }
            }
        }
        if (p.text.isNotBlank()) Text(highlight(p.text, c.violetText), fontSize = 15.sp, color = c.foreground)
        val imgs = p.images.sortedBy { it.position ?: 0 }
        if (imgs.size == 1) {
            val i = imgs.first()
            val ratio = if ((i.width ?: 0) > 0 && (i.height ?: 0) > 0) (i.width!!.toFloat() / i.height!!).coerceIn(0.6f, 2f) else 1.3f
            RemoteImage(i.url, Modifier.fillMaxWidth().aspectRatio(ratio).clip(RoundedCornerShape(12.dp)), ContentScale.Crop, maxPx = 1400)
        } else if (imgs.size > 1) {
            imgs.chunked(2).forEach { row ->
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    row.forEach { i -> RemoteImage(i.url, Modifier.weight(1f).aspectRatio(1f).clip(RoundedCornerShape(12.dp)), ContentScale.Crop, maxPx = 800) }
                    if (row.size == 1) Spacer(Modifier.weight(1f))
                }
            }
        }
        Row(verticalAlignment = Alignment.CenterVertically) {
            Row(Modifier.clip(RoundedCornerShape(16.dp)).clickable { vm.like(p) }.padding(6.dp), verticalAlignment = Alignment.CenterVertically) {
                Icon(if (p.likedByMe) Icons.Filled.Favorite else Icons.Filled.FavoriteBorder, null, tint = if (p.likedByMe) c.danger else c.mutedFg, modifier = Modifier.size(18.dp))
                Spacer(Modifier.width(4.dp)); Text("${p.likeCount}", fontSize = 12.sp, color = c.mutedFg)
            }
            Spacer(Modifier.width(12.dp))
            Row(Modifier.clip(RoundedCornerShape(16.dp)).clickable { vm.openComments(p.id) }.padding(6.dp), verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Filled.ChatBubbleOutline, stringResource(R.string.th_comments), tint = c.mutedFg, modifier = Modifier.size(18.dp))
                Spacer(Modifier.width(4.dp)); Text("${p.commentCount}", fontSize = 12.sp, color = c.mutedFg)
            }
        }
    }
    if (confirmDelete) AlertDialog(onDismissRequest = { confirmDelete = false }, title = { Text(stringResource(R.string.th_delete_q)) },
        text = { Text(stringResource(R.string.th_delete_body)) },
        confirmButton = { TextButton(onClick = { confirmDelete = false; vm.delete(p) }) { Text(stringResource(R.string.delete), color = c.danger) } },
        dismissButton = { TextButton(onClick = { confirmDelete = false }) { Text(stringResource(R.string.cancel)) } })
    if (editing) {
        var text by rememberSaveable { mutableStateOf(p.text) }
        AlertDialog(onDismissRequest = { editing = false }, title = { Text(stringResource(R.string.th_edit)) },
            text = { OutlinedTextField(text, { text = it.take(FeedRules.MAX_TEXT) }, minLines = 3, modifier = Modifier.fillMaxWidth()) },
            confirmButton = { TextButton(onClick = { editing = false; vm.edit(p, text) }, enabled = text.isNotBlank() || p.images.isNotEmpty()) { Text(stringResource(R.string.save)) } },
            dismissButton = { TextButton(onClick = { editing = false }) { Text(stringResource(R.string.cancel)) } })
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun CommentsSheet(s: ThreadsState, vm: ThreadsViewModel) {
    val c = Nx.colors
    var draft by rememberSaveable { mutableStateOf("") }
    ModalBottomSheet(onDismissRequest = { vm.openComments(null) }, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true), containerColor = c.background) {
        Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp).navigationBarsPadding().imePadding(), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text(stringResource(R.string.th_comments), fontFamily = DisplayFont, fontWeight = FontWeight.Bold, fontSize = 17.sp, color = c.foreground)
            val list = s.comments
            Column(Modifier.heightIn(max = 420.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                if (list == null) CircularProgressIndicator(Modifier.size(20.dp))
                else if (list.isEmpty()) Text(stringResource(R.string.td_no_comments), fontSize = 13.sp, color = c.mutedFg)
                list?.forEach { cm ->
                    Row(verticalAlignment = Alignment.Top) {
                        Avatar(cm.author?.name, cm.author?.avatar, 28.dp); Spacer(Modifier.width(10.dp))
                        Column {
                            Row { Text(cm.author?.name ?: "—", fontSize = 13.sp, fontWeight = FontWeight.Bold, color = c.foreground); Spacer(Modifier.width(6.dp)); Text(chatTime(cm.createdAt), fontSize = 11.sp, color = c.mutedFg) }
                            Text(highlight(cm.text, c.violetText), fontSize = 14.sp, color = c.foreground)
                        }
                    }
                }
            }
            MentionRow(draft, s.roster, vm.picked) { draft = it }
            Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(bottom = 12.dp)) {
                OutlinedTextField(draft, { draft = it.take(FeedRules.MAX_COMMENT) }, placeholder = { Text(stringResource(R.string.th_reply_hint)) }, maxLines = 4, modifier = Modifier.weight(1f))
                IconButton(onClick = { vm.comment(draft) { draft = "" } }, enabled = draft.isNotBlank()) { Icon(Icons.AutoMirrored.Filled.Send, stringResource(R.string.td_send), tint = c.violetText) }
            }
        }
    }
}
