package id.znetworks.nexus.feature.forms

import id.znetworks.nexus.ui.components.NxCheckbox

import id.znetworks.nexus.ui.components.NxOutlinedButton

import id.znetworks.nexus.ui.components.NxTextField

import android.app.Application
import android.net.Uri
import android.provider.OpenableColumns
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.AttachFile
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Description
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import id.znetworks.nexus.NexusApplication
import id.znetworks.nexus.R
import id.znetworks.nexus.core.net.ApiError
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
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneOffset

data class FormFillState(
    val form: FormDef? = null,
    val loading: Boolean = true,
    val error: String? = null,
    val closed: String? = null,
    val values: Map<String, FormValue> = emptyMap(),
    val extras: Map<String, FormUpload> = emptyMap(),
    val sending: Boolean = false,
    val progress: Pair<Long, Long>? = null,
    val sendError: String? = null,
    val done: SubmitResult? = null,
)

class FormFillViewModel(app: Application, handle: SavedStateHandle) : AndroidViewModel(app) {
    val key: String = handle["id"] ?: ""
    private val c = (app as NexusApplication).container
    private val api = FormsApi(app, c.api, c.sessionStore)
    private val res get() = getApplication<Application>().resources
    private val _state = MutableStateFlow(FormFillState())
    val state = _state.asStateFlow()

    init { load() }

    fun load() = viewModelScope.launch {
        _state.update { it.copy(loading = true, error = null, closed = null) }
        try {
            val f = api.load(key)
            // Autofilled answers are shown read-only; the server writes them from the session anyway.
            val session = c.sessionStore.current
            val auto = f.fields.filter { it.autofill != null }.associate {
                it.id to FormValue.Text(if (it.autofill == "email") session?.userEmail.orEmpty() else session?.userName.orEmpty())
            }
            _state.update { it.copy(form = f, loading = false, values = auto + it.values) }
        } catch (e: FormClosed) {
            _state.update { it.copy(loading = false, closed = e.message) }
        } catch (e: ApiError) {
            val gone = e is ApiError.Http && (e.status == 404 || e.status == 403)
            _state.update { it.copy(loading = false, error = if (gone) res.getString(R.string.form_gone) else e.describe(res)) }
        }
    }

    fun set(id: String, v: FormValue?) = _state.update { s -> s.copy(values = if (v == null) s.values - id else s.values + (id to v), sendError = null) }

    private fun describe(uri: Uri, part: String): FormUpload? {
        val cr = getApplication<Application>().contentResolver
        var name = "file"; var size = -1L
        runCatching {
            cr.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE), null, null, null)?.use { cur ->
                if (cur.moveToFirst()) { if (!cur.isNull(0)) name = cur.getString(0); if (!cur.isNull(1)) size = cur.getLong(1) }
            }
        }
        if (size <= 0) return null
        return FormUpload(part, FormLogic.safeName(name), cr.getType(uri) ?: "application/octet-stream", size, uri.toString())
    }

    /** 50 MB per file is refused here: the server would answer a bare 500 (API.md discrepancy). */
    fun addFiles(fieldId: String, uris: List<Uri>) = viewModelScope.launch {
        val picked = withContext(Dispatchers.IO) { uris.mapNotNull { describe(it, "file:$fieldId") } }
        val big = picked.filter { it.size > FormLogic.MAX_FILE }
        val ok = picked - big.toSet()
        val cur = (_state.value.values[fieldId] as? FormValue.Files)?.files.orEmpty()
        set(fieldId, FormValue.Files(cur + ok))
        if (big.isNotEmpty()) _state.update { it.copy(sendError = res.getString(R.string.form_file_too_big, big.first().filename)) }
    }

    fun removeFile(fieldId: String, f: FormUpload) {
        val left = (_state.value.values[fieldId] as? FormValue.Files)?.files.orEmpty() - f
        set(fieldId, if (left.isEmpty()) null else FormValue.Files(left))
    }

    fun setExtra(fieldId: String, uri: Uri?) = viewModelScope.launch {
        val u = uri?.let { withContext(Dispatchers.IO) { describe(it, "attachment:$fieldId") } }
        if (u != null && u.size > FormLogic.MAX_FILE) { _state.update { it.copy(sendError = res.getString(R.string.form_file_too_big, u.filename)) }; return@launch }
        _state.update { s -> s.copy(extras = if (u == null) s.extras - fieldId else s.extras + (fieldId to u)) }
    }

    fun submit() {
        val s = _state.value
        val f = s.form ?: return
        val visible = FormLogic.visible(f.fields, s.values)
        val missing = FormLogic.missingRequired(visible, s.values)
        if (missing.isNotEmpty()) { _state.update { it.copy(sendError = res.getString(R.string.form_fill_first, missing.joinToString(", "))) }; return }
        val uploads = visible.flatMap { (s.values[it.id] as? FormValue.Files)?.files.orEmpty() } + visible.mapNotNull { s.extras[it.id] }
        if (uploads.sumOf { it.size } > FormLogic.MAX_REQUEST) { _state.update { it.copy(sendError = res.getString(R.string.form_too_much)) }; return }
        _state.update { it.copy(sending = true, sendError = null, progress = null) }
        viewModelScope.launch {
            try {
                val r = withContext(Dispatchers.IO) {
                    api.submit(key, FormLogic.data(visible, s.values, s.extras), uploads) { done, total -> _state.update { it.copy(progress = done to total) } }
                }
                _state.update { it.copy(done = r) }
            } catch (e: ApiError) {
                // Not replayable, and a 401 (LOGIN_REQUIRED) keeps everything filled in.
                val msg = if (e is ApiError.Http && e.status == 401) res.getString(R.string.form_login_required) else (e as? ApiError.Http)?.serverMessage ?: e.describe(res)
                _state.update { it.copy(sendError = msg) }
            }
            _state.update { it.copy(sending = false) }
        }
    }
}

@Composable
fun FormFillScreen(onBack: () -> Unit, onOpenSubmissions: () -> Unit, vm: FormFillViewModel = viewModel()) {
    val s by vm.state.collectAsStateWithLifecycle()
    val c = Nx.colors
    Column(Modifier.fillMaxSize().background(c.background).imePadding()) {
        Row(Modifier.fillMaxWidth().padding(4.dp), verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, stringResource(R.string.back)) }
            Text(s.form?.name ?: stringResource(R.string.form_title), fontFamily = DisplayFont, fontWeight = FontWeight.Bold, fontSize = 18.sp, color = c.foreground, maxLines = 1)
        }
        val f = s.form
        when {
            s.loading -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
            s.closed != null -> EmptyState(Icons.Filled.Lock, stringResource(R.string.form_closed), s.closed!!, stringResource(R.string.back), onBack, Modifier.fillMaxSize())
            f == null -> EmptyState(Icons.Filled.Description, stringResource(R.string.form_load_failed), s.error.orEmpty(), stringResource(R.string.try_again), { vm.load() }, Modifier.fillMaxSize())
            s.done != null -> EmptyState(Icons.Filled.CheckCircle, stringResource(R.string.form_sent), s.done!!.task?.title?.let { stringResource(R.string.form_sent_task, it) } ?: stringResource(R.string.form_sent_sub),
                stringResource(R.string.form_my_submissions), onOpenSubmissions, Modifier.fillMaxSize())
            else -> Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
                f.description?.takeIf { it.isNotBlank() }?.let { Text(it, fontSize = 13.sp, color = c.mutedFg) }
                FormLogic.visible(f.fields, s.values).forEach { field -> FieldInput(field, s, vm) }
                s.sendError?.let { Text(it, color = c.danger, fontSize = 13.sp, fontWeight = FontWeight.SemiBold) }
                s.progress?.takeIf { s.sending && it.second > 0 }?.let { (d, t) -> LinearProgressIndicator(progress = { d.toFloat() / t }, modifier = Modifier.fillMaxWidth()) }
                Button(onClick = vm::submit, enabled = !s.sending, modifier = Modifier.fillMaxWidth(), shape = RoundedCornerShape(14.dp),
                    colors = ButtonDefaults.buttonColors(containerColor = c.violet, contentColor = Color.White)) {
                    if (s.sending) CircularProgressIndicator(Modifier.size(18.dp), color = Color.White, strokeWidth = 2.dp) else Text(stringResource(R.string.form_submit), fontWeight = FontWeight.Bold)
                }
                Spacer(Modifier.size(24.dp))
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
private fun FieldInput(f: FormField, s: FormFillState, vm: FormFillViewModel) {
    val c = Nx.colors
    if (f.isLayout) {
        Text(f.displayLabel, fontFamily = DisplayFont, fontWeight = FontWeight.Bold, fontSize = 16.sp, color = c.foreground, modifier = Modifier.padding(top = 8.dp))
        return
    }
    val v = s.values[f.id]
    val text = (v as? FormValue.Text)?.s.orEmpty()
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Text(f.displayLabel + if (f.required) " *" else "", fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = c.foreground)
        when {
            f.kind == "textarea" -> NxTextField(text, { vm.set(f.id, FormValue.Text(it)) }, minLines = 3, placeholder = f.placeholder?.let { p -> { Text(p) } }, modifier = Modifier.fillMaxWidth())
            f.kind == "dropdown" || f.kind == "select" -> {
                var open by remember { mutableStateOf(false) }
                Box {
                    Row(Modifier.fillMaxWidth().border(1.dp, c.border, RoundedCornerShape(10.dp)).clickable { open = true }.padding(14.dp)) {
                        Text(text.ifBlank { f.placeholder ?: "—" }, color = if (text.isBlank()) c.mutedFg else c.foreground, modifier = Modifier.weight(1f)); Text("▾", color = c.mutedFg)
                    }
                    DropdownMenu(open, { open = false }) {
                        if (!f.required) DropdownMenuItem(text = { Text("—") }, onClick = { open = false; vm.set(f.id, null) })
                        f.choices.forEach { ch -> DropdownMenuItem(text = { Text(ch) }, onClick = { open = false; vm.set(f.id, FormValue.Text(ch)) }) }
                    }
                }
            }
            f.kind == "multi_select" -> {
                val cur = (v as? FormValue.Choices)?.list.orEmpty()
                FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    f.choices.forEach { ch -> FilterChip(ch in cur, { vm.set(f.id, FormValue.Choices(if (ch in cur) cur - ch else cur + ch)) }, { Text(ch, fontSize = 12.sp) }) }
                }
            }
            f.kind == "checkbox" -> Row(verticalAlignment = Alignment.CenterVertically) {
                NxCheckbox((v as? FormValue.Flag)?.on == true, { vm.set(f.id, FormValue.Flag(it)) })
                f.placeholder?.let { Text(it, fontSize = 13.sp, color = c.foreground) }
            }
            f.kind == "file" -> FilesInput(f, v as? FormValue.Files, vm)
            f.autofill != null -> Text(text.ifBlank { "—" }, fontSize = 14.sp, color = c.mutedFg,
                modifier = Modifier.fillMaxWidth().background(c.muted.copy(alpha = 0.5f), RoundedCornerShape(10.dp)).padding(14.dp))
            f.kind == "date" -> {
                var picking by remember { mutableStateOf(false) }
                NxOutlinedButton(onClick = { picking = true }, modifier = Modifier.fillMaxWidth()) { Text(text.ifBlank { stringResource(R.string.form_pick_date) }) }
                if (picking) {
                    val st = rememberDatePickerState(initialSelectedDateMillis = (runCatching { LocalDate.parse(text) }.getOrNull() ?: LocalDate.now()).atStartOfDay().toInstant(ZoneOffset.UTC).toEpochMilli())
                    DatePickerDialog(onDismissRequest = { picking = false }, confirmButton = {
                        TextButton(onClick = { st.selectedDateMillis?.let { vm.set(f.id, FormValue.Text(Instant.ofEpochMilli(it).atZone(ZoneOffset.UTC).toLocalDate().toString())) }; picking = false }) { Text("OK") }
                    }) { DatePicker(st) }
                }
            }
            else -> {
                val numeric = f.kind == "number" || f.kind == "currency" || f.numberFormat?.contains("currency", true) == true
                NxTextField(text, { vm.set(f.id, FormValue.Text(if (numeric) it.filter { ch -> ch.isDigit() || ch == '.' || ch == ',' } else it)) },
                    singleLine = true, placeholder = f.placeholder?.let { p -> { Text(p) } },
                    prefix = if (f.numberFormat?.contains("currency", true) == true || f.kind == "currency") ({ Text("Rp ") }) else null,
                    keyboardOptions = KeyboardOptions(keyboardType = when { numeric -> KeyboardType.Decimal; f.kind == "email" -> KeyboardType.Email; f.kind == "phone" || f.kind == "tel" -> KeyboardType.Phone; else -> KeyboardType.Text }),
                    modifier = Modifier.fillMaxWidth())
            }
        }
        // An optional extra file on a non-file field (web "attachment").
        if (f.attachmentEnabled == true && f.kind != "file") {
            val extra = s.extras[f.id]
            val pick = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { it?.let { u -> vm.setExtra(f.id, u) } }
            if (extra == null) TextButton(onClick = { pick.launch(arrayOf("*/*")) }) { Icon(Icons.Filled.AttachFile, null, Modifier.size(16.dp)); Text(stringResource(R.string.form_attach)) }
            else FileRow(extra) { vm.setExtra(f.id, null) }
        }
    }
}

@Composable
private fun FilesInput(f: FormField, v: FormValue.Files?, vm: FormFillViewModel) {
    val pick = rememberLauncherForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { if (it.isNotEmpty()) vm.addFiles(f.id, it) }
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        v?.files?.forEach { up -> FileRow(up) { vm.removeFile(f.id, up) } }
        NxOutlinedButton(onClick = { pick.launch(arrayOf("*/*")) }) { Icon(Icons.Filled.AttachFile, null, Modifier.size(16.dp)); Spacer(Modifier.width(6.dp)); Text(stringResource(R.string.form_add_files)) }
    }
}

@Composable
private fun FileRow(u: FormUpload, onRemove: () -> Unit) {
    val c = Nx.colors
    Row(Modifier.fillMaxWidth().background(c.muted.copy(alpha = 0.5f), RoundedCornerShape(10.dp)).padding(start = 12.dp), verticalAlignment = Alignment.CenterVertically) {
        Icon(Icons.Filled.Description, null, tint = c.mutedFg, modifier = Modifier.size(16.dp)); Spacer(Modifier.width(8.dp))
        Text(u.filename, fontSize = 13.sp, color = c.foreground, maxLines = 1, modifier = Modifier.weight(1f))
        Text(id.znetworks.nexus.feature.tasks.sizeText(u.size), fontSize = 11.sp, color = c.mutedFg)
        IconButton(onClick = onRemove) { Icon(Icons.Filled.Close, stringResource(R.string.delete)) }
    }
}
