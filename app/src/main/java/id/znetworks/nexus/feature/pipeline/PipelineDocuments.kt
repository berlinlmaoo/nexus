package id.znetworks.nexus.feature.pipeline

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.AttachFile
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Description
import androidx.compose.material.icons.filled.Download
import androidx.compose.material.icons.filled.Image
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.Link
import androidx.compose.material.icons.filled.Movie
import androidx.compose.material.icons.filled.PictureAsPdf
import androidx.compose.material.icons.filled.PhotoLibrary
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Checkbox
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import id.znetworks.nexus.NexusApplication
import id.znetworks.nexus.R
import id.znetworks.nexus.core.files.FileOpener
import id.znetworks.nexus.ui.components.PdfViewerDialog
import id.znetworks.nexus.ui.components.PhotoViewer
import id.znetworks.nexus.ui.theme.Nx
import kotlinx.coroutines.launch

/** What a file entry opens in: images and PDFs in the app, anything else in the phone's own app. */
internal enum class DocView { IMAGE, PDF, OTHER }

internal fun docView(l: PipelineLink): DocView {
    val m = l.mimeType.orEmpty().lowercase()
    val n = (l.fileName ?: l.label).lowercase()
    return when {
        m.startsWith("image/") || n.endsWith(".jpg") || n.endsWith(".jpeg") || n.endsWith(".png") || n.endsWith(".webp") || n.endsWith(".heic") -> DocView.IMAGE
        m == "application/pdf" || n.endsWith(".pdf") -> DocView.PDF
        else -> DocView.OTHER
    }
}

/**
 * "Documents & links" (PIPELINE-DASHBOARD §13.1, iOS 2e41d93): SPK, contract, MOU, invoice — attached as a file (any
 * file, or a photo from the gallery) or pasted as a link. Files go up on the shared chunk route; a link is saved in
 * the deal's `links` (the whole list, files sent back as received). Removing a file asks first; a link goes at once.
 */
@Composable
internal fun Documents(deal: PipelineDeal, types: List<String>, vm: PipelineViewModel, onSaveLinks: (List<PipelineLink>) -> Unit) {
    val c = Nx.colors
    val context = LocalContext.current
    val api = (context.applicationContext as NexusApplication).container.api
    val scope = rememberCoroutineScope()
    val uploads = vm.state.collectAsStateWithLifecycle().value.uploads.filter { it.dealId == deal.id }
    val links = deal.links
    var type by remember { mutableStateOf(types.firstOrNull() ?: "Lainnya") }
    var url by remember { mutableStateOf("") }
    var label by remember { mutableStateOf("") }
    var removing by remember { mutableStateOf<PipelineLink?>(null) }
    var viewing by remember { mutableStateOf<PipelineLink?>(null) }
    val pickFile = rememberLauncherForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { uris ->
        uris.forEach { vm.attach(deal.id, it, type, if (uris.size == 1) label else "") }; if (uris.isNotEmpty()) label = ""
    }
    val pickPhoto = rememberLauncherForActivityResult(ActivityResultContracts.PickMultipleVisualMedia()) { uris ->
        uris.forEach { vm.attach(deal.id, it, type, if (uris.size == 1) label else "") }; if (uris.isNotEmpty()) label = ""
    }
    fun open(l: PipelineLink, share: Boolean = false) {
        if (!share && docView(l) != DocView.OTHER) { viewing = l; return }
        scope.launch { runCatching { FileOpener.open(context, api, l.url, l.fileName ?: l.shownName, l.mimeType, share) } }
    }

    if (links.isEmpty() && uploads.isEmpty()) Text(stringResource(R.string.pl_no_docs), fontSize = 12.sp, color = c.mutedFg)
    links.forEach { l ->
        val typeWord = PipelineText.link(l.type)?.let { stringResource(it) } ?: l.type
        Row(verticalAlignment = Alignment.CenterVertically) {
            Icon(if (!l.isFile) Icons.Filled.Link else when (docView(l)) {
                DocView.IMAGE -> Icons.Filled.Image; DocView.PDF -> Icons.Filled.PictureAsPdf
                else -> if (l.mimeType.orEmpty().startsWith("video/")) Icons.Filled.Movie else Icons.Filled.Description
            }, null, tint = c.violetText)
            Spacer(Modifier.width(8.dp))
            Column(Modifier.weight(1f).clickable {
                if (l.isFile) open(l) else runCatching { context.startActivity(android.content.Intent(android.content.Intent.ACTION_VIEW, android.net.Uri.parse(l.url))) }
            }) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(typeWord, fontSize = 10.sp, fontWeight = FontWeight.Bold, color = c.violetText,
                        modifier = Modifier.background(c.accentBg, RoundedCornerShape(5.dp)).padding(horizontal = 5.dp, vertical = 1.dp))
                    Spacer(Modifier.width(6.dp))
                    Text(l.shownName, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = c.foreground, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
                val sub = if (l.isFile) listOfNotNull(l.fileName?.takeIf { l.label.isNotBlank() && it != l.label },
                    l.size?.let { android.text.format.Formatter.formatShortFileSize(context, it) }).joinToString(" · ") else l.url
                if (sub.isNotBlank()) Text(sub, fontSize = 11.sp, color = c.mutedFg, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
            if (l.isFile) IconButton(onClick = { open(l, share = true) }) { Icon(Icons.Filled.Download, stringResource(R.string.pl_doc_download), tint = c.mutedFg) }
            IconButton(onClick = { if (l.isFile) removing = l else onSaveLinks(links.filterNot { it.id == l.id }) }) {
                Icon(Icons.Filled.Delete, stringResource(R.string.pl_doc_remove), tint = c.dangerText) }
        }
    }
    uploads.forEach { u ->
        Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(stringResource(R.string.pl_doc_uploading, u.name), fontSize = 12.sp, color = c.mutedFg, maxLines = 1, overflow = TextOverflow.Ellipsis)
            LinearProgressIndicator(progress = { u.progress }, modifier = Modifier.fillMaxWidth())
        }
    }
    // One type for whatever is added next: a link, a file or a photo.
    Pick(stringResource(R.string.pl_link_type), type, types, label = { k -> PipelineText.link(k)?.let { stringResource(it) } ?: k }) { type = it }
    OutlinedTextField(label, { label = it }, singleLine = true, placeholder = { Text(stringResource(R.string.pl_doc_name_opt)) }, modifier = Modifier.fillMaxWidth())
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        OutlinedButton(onClick = { pickFile.launch(arrayOf("*/*")) }) { Icon(Icons.Filled.AttachFile, null, Modifier.size(16.dp)); Spacer(Modifier.width(4.dp)); Text(stringResource(R.string.pl_doc_attach)) }
        OutlinedButton(onClick = { pickPhoto.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageAndVideo)) }) {
            Icon(Icons.Filled.PhotoLibrary, null, Modifier.size(16.dp)); Spacer(Modifier.width(4.dp)); Text(stringResource(R.string.pl_doc_photo)) }
    }
    OutlinedTextField(url, { url = it }, singleLine = true, placeholder = { Text(stringResource(R.string.pl_paste_link)) }, modifier = Modifier.fillMaxWidth(),
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri))
    val ok = url.trim().let { it.startsWith("https://") || it.startsWith("http://") }
    TextButton(onClick = {
        onSaveLinks(links + PipelineLink("l_${System.currentTimeMillis()}", type, label.trim(), url.trim())); url = ""; label = ""
    }, enabled = ok) { Icon(Icons.Filled.Add, null, Modifier.size(16.dp)); Text(stringResource(R.string.pl_add_link)) }

    removing?.let { l ->
        AlertDialog(onDismissRequest = { removing = null }, title = { Text(stringResource(R.string.pl_doc_remove_q, l.shownName)) },
            text = { Text(stringResource(R.string.pl_doc_remove_body)) },
            confirmButton = { TextButton(onClick = { removing = null; vm.removeDocument(deal.id, l.id) }) {
                Text(stringResource(R.string.pl_doc_remove), color = c.dangerText, fontWeight = FontWeight.Bold) } },
            dismissButton = { TextButton(onClick = { removing = null }) { Text(stringResource(R.string.cancel)) } })
    }
    viewing?.let { l ->
        when (docView(l)) {
            DocView.IMAGE -> PhotoViewer(l.url, l.shownName) { viewing = null }
            else -> PdfViewerDialog(l.url, l.fileName ?: l.shownName) { viewing = null }
        }
    }
}

/** Services (§13.2): a row that opens a picker — presets with checkmarks, other services, add one of your own. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun ServicesRow(deal: PipelineDeal, data: PipelineData, onSave: (List<String>) -> Unit) {
    val c = Nx.colors
    var open by remember { mutableStateOf(false) }
    Row(Modifier.fillMaxWidth().clickable { open = true }.heightIn(min = 44.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(stringResource(R.string.pl_f_services), fontSize = 13.sp, color = c.mutedFg, modifier = Modifier.width(110.dp))
        val list = deal.services
        if (list.isEmpty()) Text(stringResource(R.string.pl_no_services), fontSize = 13.sp, color = c.mutedFg, modifier = Modifier.weight(1f))
        else FlowRow(Modifier.weight(1f), horizontalArrangement = Arrangement.spacedBy(4.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            list.forEach { Text(it, fontSize = 12.sp, color = c.foreground, modifier = Modifier.background(c.muted, RoundedCornerShape(6.dp)).padding(horizontal = 6.dp, vertical = 2.dp)) }
        }
        Icon(Icons.Filled.KeyboardArrowDown, null, tint = c.mutedFg)
    }
    if (open) {
        val presets = data.vocab.services
        var picked by remember { mutableStateOf(deal.services) }
        var typed by remember { mutableStateOf("") }
        val others = remember(picked) { (PipelineServices.others(deal, data.deals, presets) + picked.filter { p -> presets.none { it.equals(p, true) } }).distinctBy { it.lowercase() } }
        fun addTyped() { PipelineServices.add(picked, typed, presets)?.let { picked = it; typed = "" } }
        @Composable fun Option(s: String) {
            val on = picked.any { it.equals(s, ignoreCase = true) }
            Row(Modifier.fillMaxWidth().clickable { picked = PipelineServices.toggle(picked, s) }, verticalAlignment = Alignment.CenterVertically) {
                Checkbox(on, { picked = PipelineServices.toggle(picked, s) }); Text(s, fontSize = 14.sp, color = c.foreground)
            }
        }
        AlertDialog(onDismissRequest = { open = false }, title = { Text(stringResource(R.string.pl_f_services)) },
            text = {
                Column(Modifier.verticalScroll(rememberScrollState())) {
                    Text(stringResource(R.string.pl_services_hint), fontSize = 12.sp, color = c.mutedFg)
                    presets.forEach { Option(it) }
                    if (others.isNotEmpty()) {
                        Text(stringResource(R.string.pl_other_services), fontSize = 12.sp, fontWeight = FontWeight.Bold, color = c.mutedFg, modifier = Modifier.padding(top = 8.dp))
                        others.forEach { Option(it) }
                    }
                    OutlinedTextField(typed, { typed = it.take(PipelineServices.MAX_LEN) }, singleLine = true, placeholder = { Text(stringResource(R.string.pl_add_service)) },
                        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done), keyboardActions = KeyboardActions(onDone = { addTyped() }),
                        trailingIcon = { IconButton(onClick = { addTyped() }, enabled = typed.isNotBlank() && picked.size < PipelineServices.MAX) { Icon(Icons.Filled.Add, stringResource(R.string.pl_add_service)) } },
                        modifier = Modifier.fillMaxWidth().padding(top = 8.dp))
                }
            },
            confirmButton = { TextButton(onClick = { open = false; if (picked != deal.services) onSave(picked) }) { Text(stringResource(R.string.save)) } },
            dismissButton = { TextButton(onClick = { open = false }) { Text(stringResource(R.string.cancel)) } })
    }
}
