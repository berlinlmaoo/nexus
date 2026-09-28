package id.znetworks.nexus.feature.tickets

import android.app.Application
import android.graphics.BitmapFactory
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Image
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
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.AutoAwesome
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Image
import androidx.compose.material.icons.filled.PhotoCamera
import androidx.compose.material.icons.filled.SupportAgent
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
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
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.core.content.FileProvider
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import id.znetworks.nexus.NexusApplication
import id.znetworks.nexus.R
import id.znetworks.nexus.core.net.ApiError
import id.znetworks.nexus.feature.attendance.LocalNotifier
import id.znetworks.nexus.feature.attendance.requests.AttachmentReader
import id.znetworks.nexus.feature.chat.chatTime
import id.znetworks.nexus.feature.projects.Pill
import id.znetworks.nexus.ui.components.EmptyState
import id.znetworks.nexus.ui.components.describe
import id.znetworks.nexus.ui.theme.DisplayFont
import id.znetworks.nexus.ui.theme.Nx
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File
import java.util.Locale

@Composable
fun ticketStatusLabel(s: String) = stringResource(when (s) {
    "IN_REVIEW" -> R.string.tk_in_review
    "AWAITING_DECISION" -> R.string.tk_awaiting
    "RESOLVED" -> R.string.tk_resolved
    "CLOSED" -> R.string.tk_closed
    "ALL" -> R.string.tk_all
    else -> R.string.tk_open
})

@Composable
fun ticketStatusColor(s: String) = when (s) {
    "IN_REVIEW", "AWAITING_DECISION" -> Nx.colors.warning
    "RESOLVED" -> Nx.colors.success
    "CLOSED" -> Nx.colors.mutedFg
    else -> Nx.colors.blue
}

@Composable
fun ticketCategoryLabel(c: String?) = stringResource(when (c) {
    "ATTENDANCE" -> R.string.tk_cat_attendance
    "EXP" -> R.string.tk_cat_exp
    "DAY_OFF" -> R.string.tk_cat_dayoff
    else -> R.string.tk_cat_other
})

data class TicketsState(
    val list: TicketList? = null,
    val loading: Boolean = true,
    val error: String? = null,
    val savedAt: Long? = null,
    val filing: Boolean = false,
    val photos: List<ByteArray> = emptyList(),
    val formError: String? = null,
)

class TicketsViewModel(app: Application) : AndroidViewModel(app) {
    private val c = (app as NexusApplication).container
    private val api = TicketsApi(c.api)
    private val res get() = getApplication<Application>().resources
    private val _state = MutableStateFlow(TicketsState())
    val state = _state.asStateFlow()

    fun load() = viewModelScope.launch {
        try {
            val r = api.list()
            _state.update { it.copy(list = r.value, savedAt = r.savedAtMillis, loading = false, error = null) }
        } catch (e: ApiError) { _state.update { it.copy(loading = false, error = if (it.list == null) e.describe(res) else null) } }
    }

    fun addPhotos(uris: List<Uri>) = viewModelScope.launch {
        val room = TicketRules.MAX_PHOTOS - _state.value.photos.size
        val read = withContext(Dispatchers.IO) { uris.take(room).mapNotNull { AttachmentReader.uprightJpeg(getApplication(), it) } }
        _state.update { s -> s.copy(photos = s.photos + read.filter { it.size <= TicketRules.MAX_PHOTO_BYTES },
            formError = if (read.size < uris.take(room).size) res.getString(R.string.chat_photo_unreadable) else if (read.any { it.size > TicketRules.MAX_PHOTO_BYTES }) res.getString(R.string.td_file_too_big) else null) }
    }

    fun removePhoto(b: ByteArray) = _state.update { it.copy(photos = it.photos.filterNot { p -> p === b }) }
    fun resetForm() = _state.update { it.copy(photos = emptyList(), formError = null) }

    fun file(category: String, subject: String, body: String, onFiled: (String) -> Unit) {
        val s = _state.value
        val err = when {
            subject.trim().length !in TicketRules.SUBJECT_MIN..TicketRules.SUBJECT_MAX -> R.string.tk_subject_len
            body.trim().length !in TicketRules.BODY_MIN..TicketRules.BODY_MAX -> R.string.tk_body_len
            s.photos.isEmpty() -> R.string.tk_photo_required
            else -> null
        }
        if (err != null) { _state.update { it.copy(formError = res.getString(err)) }; return }
        _state.update { it.copy(filing = true, formError = null) }
        viewModelScope.launch {
            try {
                val t = api.create(category, subject, body, s.photos)
                _state.update { it.copy(photos = emptyList()) }
                load(); onFiled(t.id)
            } catch (e: ApiError) { _state.update { it.copy(formError = (e as? ApiError.Http)?.serverMessage ?: res.getString(R.string.tk_file_failed)) } }
            _state.update { it.copy(filing = false) }
        }
    }
}

@Composable
fun TicketsScreen(onBack: () -> Unit, onOpenTicket: (String) -> Unit, vm: TicketsViewModel = viewModel()) {
    val s by vm.state.collectAsStateWithLifecycle()
    val c = Nx.colors
    var filter by rememberSaveable { mutableStateOf("ALL") }
    var composing by rememberSaveable { mutableStateOf(false) }
    LaunchedEffect(Unit) { vm.load() }
    Box(Modifier.fillMaxSize().background(c.background)) {
        Column(Modifier.fillMaxSize()) {
            Row(Modifier.fillMaxWidth().padding(4.dp), verticalAlignment = Alignment.CenterVertically) {
                IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, stringResource(R.string.back)) }
                Text(stringResource(R.string.tk_title), fontFamily = DisplayFont, fontWeight = FontWeight.Bold, fontSize = 18.sp, color = c.foreground)
            }
            val all = s.list?.complaints.orEmpty()
            Row(Modifier.horizontalScroll(rememberScrollState()).padding(horizontal = 12.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                listOf("ALL", "OPEN", "IN_REVIEW", "RESOLVED", "CLOSED").forEach { f ->
                    val n = all.count { TicketRules.inFilter(it, f) }
                    FilterChip(filter == f, { filter = f }, { Text(ticketStatusLabel(f) + if (n > 0) " · $n" else "", fontSize = 12.sp) })
                }
            }
            s.savedAt?.let { Text(stringResource(R.string.saved_copy_from, LocalNotifier.hhmm(it)), fontSize = 12.sp, color = c.mutedFg, modifier = Modifier.padding(horizontal = 16.dp)) }
            Box(Modifier.weight(1f)) {
                val shown = all.filter { TicketRules.inFilter(it, filter) }
                when {
                    s.loading && s.list == null -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
                    s.error != null -> EmptyState(Icons.Filled.SupportAgent, stringResource(R.string.tk_load_failed), s.error!!, stringResource(R.string.try_again), { vm.load() }, Modifier.fillMaxSize())
                    all.isEmpty() -> EmptyState(Icons.Filled.SupportAgent, stringResource(R.string.tk_empty), stringResource(R.string.tk_empty_sub), stringResource(R.string.tk_new), { composing = true }, Modifier.fillMaxSize())
                    shown.isEmpty() -> EmptyState(Icons.Filled.SupportAgent, stringResource(R.string.tk_empty_filter), stringResource(R.string.tk_empty_filter_sub), stringResource(R.string.tk_show_all), { filter = "ALL" }, Modifier.fillMaxSize())
                    else -> PullToRefreshBox(isRefreshing = false, onRefresh = { vm.load() }) {
                        LazyColumn(contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                            items(shown, key = { it.id }) { t -> TicketRow(t) { onOpenTicket(t.id) } }
                        }
                    }
                }
            }
        }
        FloatingActionButton(onClick = { vm.resetForm(); composing = true }, containerColor = c.violet, contentColor = Color.White,
            modifier = Modifier.align(Alignment.BottomEnd).padding(20.dp)) { Icon(Icons.Filled.Add, stringResource(R.string.tk_new)) }
    }
    if (composing) NewTicketDialog(s, vm, onDismiss = { composing = false }) { id -> composing = false; onOpenTicket(id) }
}

@Composable
private fun TicketRow(t: Ticket, onClick: () -> Unit) {
    val c = Nx.colors
    Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(c.card).border(1.dp, c.border, RoundedCornerShape(16.dp)).clickable(onClick = onClick).padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Pill(ticketStatusLabel(t.status), ticketStatusColor(t.status)); Spacer(Modifier.width(6.dp))
            Pill(ticketCategoryLabel(t.category), c.mutedFg)
            Spacer(Modifier.weight(1f))
            Text(chatTime(t.lastMessageAt ?: t.createdAt), fontSize = 11.sp, color = c.mutedFg)
        }
        Text(t.subject.ifBlank { stringResource(R.string.tk_no_subject) }, fontSize = 15.sp, fontWeight = FontWeight.SemiBold, color = c.foreground, maxLines = 2, overflow = TextOverflow.Ellipsis)
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(t.reporter?.name ?: stringResource(R.string.tk_someone), fontSize = 12.sp, color = c.mutedFg, modifier = Modifier.weight(1f))
            if (t.gideonReplied) { Icon(Icons.Filled.AutoAwesome, null, tint = c.violetText, modifier = Modifier.size(14.dp)); Spacer(Modifier.width(4.dp)) }
            if (t.pendingCorrection) { Pill(stringResource(R.string.tk_decision_waiting), c.warning); Spacer(Modifier.width(6.dp)) }
            Text("💬 ${t.messageCount}", fontSize = 12.sp, color = c.mutedFg)
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun NewTicketDialog(s: TicketsState, vm: TicketsViewModel, onDismiss: () -> Unit, onFiled: (String) -> Unit) {
    val c = Nx.colors
    val context = LocalContext.current
    var category by rememberSaveable { mutableStateOf("ATTENDANCE") }
    var subject by rememberSaveable { mutableStateOf("") }
    var body by rememberSaveable { mutableStateOf("") }
    var cameraUri by rememberSaveable { mutableStateOf<String?>(null) }
    val gallery = rememberLauncherForActivityResult(ActivityResultContracts.PickMultipleVisualMedia(TicketRules.MAX_PHOTOS)) { if (it.isNotEmpty()) vm.addPhotos(it) }
    val camera = rememberLauncherForActivityResult(ActivityResultContracts.TakePicture()) { ok -> if (ok) cameraUri?.let { vm.addPhotos(listOf(Uri.parse(it))) } }
    Dialog(onDismissRequest = { if (!s.filing) onDismiss() }, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Column(Modifier.fillMaxSize().background(c.background).systemBarsPadding().imePadding()) {
            Row(Modifier.fillMaxWidth().padding(8.dp), verticalAlignment = Alignment.CenterVertically) {
                IconButton(onClick = onDismiss, enabled = !s.filing) { Icon(Icons.Filled.Close, stringResource(R.string.cancel)) }
                Text(stringResource(R.string.tk_new), fontFamily = DisplayFont, fontWeight = FontWeight.Bold, fontSize = 18.sp, color = c.foreground, modifier = Modifier.weight(1f))
            }
            Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text(stringResource(R.string.tk_intro), fontSize = 12.sp, color = c.mutedFg)
                Label(stringResource(R.string.tk_category))
                FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    TicketRules.CATEGORIES.forEach { k -> FilterChip(category == k, { category = k }, { Text(ticketCategoryLabel(k), fontSize = 12.sp) }) }
                }
                Label(stringResource(R.string.tk_subject))
                OutlinedTextField(subject, { subject = it.take(TicketRules.SUBJECT_MAX) }, singleLine = true, placeholder = { Text(stringResource(R.string.tk_subject_ph)) }, modifier = Modifier.fillMaxWidth())
                Label(stringResource(R.string.tk_what_happened))
                OutlinedTextField(body, { body = it.take(TicketRules.BODY_MAX) }, minLines = 4, placeholder = { Text(stringResource(R.string.tk_body_ph)) }, modifier = Modifier.fillMaxWidth())
                Label(stringResource(R.string.tk_evidence))
                Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    s.photos.forEach { p ->
                        val bmp = remember(p) { BitmapFactory.decodeByteArray(p, 0, p.size, BitmapFactory.Options().apply { inSampleSize = 8 })?.asImageBitmap() }
                        Box {
                            bmp?.let { Image(it, null, Modifier.size(72.dp).clip(RoundedCornerShape(10.dp)), contentScale = ContentScale.Crop) }
                            IconButton(onClick = { vm.removePhoto(p) }, modifier = Modifier.align(Alignment.TopEnd).size(24.dp).background(Color.Black.copy(alpha = 0.5f), CircleShape)) {
                                Icon(Icons.Filled.Close, null, tint = Color.White, modifier = Modifier.size(14.dp))
                            }
                        }
                    }
                }
                if (s.photos.size < TicketRules.MAX_PHOTOS) Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedButton(onClick = {
                        val f = File(File(context.cacheDir, "evidence").apply { mkdirs() }, "ticket-${System.currentTimeMillis()}.jpg")
                        val uri = FileProvider.getUriForFile(context, "${context.packageName}.files", f)
                        cameraUri = uri.toString(); runCatching { camera.launch(uri) }
                    }) { Icon(Icons.Filled.PhotoCamera, null, Modifier.size(16.dp)); Spacer(Modifier.width(6.dp)); Text(stringResource(R.string.camera)) }
                    OutlinedButton(onClick = { gallery.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)) }) {
                        Icon(Icons.Filled.Image, null, Modifier.size(16.dp)); Spacer(Modifier.width(6.dp)); Text(stringResource(R.string.gallery))
                    }
                }
                s.formError?.let { Text(it, color = c.danger, fontSize = 13.sp, fontWeight = FontWeight.SemiBold) }
                TextButton(onClick = { vm.file(category, subject, body, onFiled) }, enabled = !s.filing, modifier = Modifier.fillMaxWidth()) {
                    if (s.filing) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp) else Text(stringResource(R.string.tk_file), fontWeight = FontWeight.Bold)
                }
                Spacer(Modifier.size(24.dp))
            }
        }
    }
}

@Composable
internal fun Label(text: String) =
    Text(text.uppercase(Locale.getDefault()), fontSize = 11.sp, fontWeight = FontWeight.Bold, letterSpacing = 0.5.sp, color = Nx.colors.mutedFg)
