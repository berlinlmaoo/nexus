package id.znetworks.nexus.feature.vault

import android.net.Uri
import android.widget.MediaController
import android.widget.VideoView
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.gestures.detectTransformGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Description
import androidx.compose.material.icons.filled.Download
import androidx.compose.material.icons.filled.Folder
import androidx.compose.material.icons.filled.Link
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.VideoFile
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import id.znetworks.nexus.NexusApplication
import id.znetworks.nexus.R
import id.znetworks.nexus.ui.components.describe
import id.znetworks.nexus.core.net.ApiError
import id.znetworks.nexus.ui.components.ImageMemory
import id.znetworks.nexus.ui.components.RemoteImages
import id.znetworks.nexus.ui.theme.Nx
import kotlinx.coroutines.launch

// Z Vault: move, gallery, viewer (owner, 9 Oct; VAULT-MOVE-DND, iOS 4c193a8).

/** A picture by URL (thumbnail or /raw, with the session): null while loading, or for good if it failed. */
@Composable
private fun rememberBitmap(url: String?, maxPx: Int): ImageBitmap? {
    val context = LocalContext.current
    var img by remember(url) { mutableStateOf(url?.let(ImageMemory::get)) }
    LaunchedEffect(url) { if (url != null && img == null) img = RemoteImages.load(context, url, maxPx) }
    return img
}

/** A light checkerboard behind a picture that may be transparent (logos: white on nothing). */
@Composable
private fun Checkerboard(modifier: Modifier) {
    Canvas(modifier) {
        val step = 8.dp.toPx()
        drawRect(Color(0xFFF1F1F1))
        var y = 0f; var row = 0
        while (y < size.height) {
            var x = if (row % 2 == 0) 0f else step
            while (x < size.width) { drawRect(Color(0xFFDADADA), Offset(x, y), androidx.compose.ui.geometry.Size(step, step)); x += step * 2 }
            y += step; row++
        }
    }
}

/** One square of the gallery: the thumbnail (whole on a checkerboard for PNG/GIF/WebP), or a neutral tile with a play badge for films. */
@Composable
fun VaultTile(i: VaultItem, onOpen: () -> Unit, onMenu: @Composable () -> Unit) {
    val c = Nx.colors
    val thumb = rememberBitmap(VaultRules.thumb(i), 640)
    Box(Modifier.fillMaxWidth().aspectRatio(1f).clip(RoundedCornerShape(8.dp)).background(c.muted).clickable(onClick = onOpen)) {
        when {
            thumb != null && VaultRules.showWhole(i) -> { Checkerboard(Modifier.fillMaxSize()); Image(thumb, i.name, Modifier.fillMaxSize().padding(4.dp), contentScale = ContentScale.Fit) }
            thumb != null -> Image(thumb, i.name, Modifier.fillMaxSize(), contentScale = ContentScale.Crop)
            else -> Icon(if (i.isVideo) Icons.Filled.VideoFile else Icons.Filled.Description, i.name, tint = c.mutedFg, modifier = Modifier.align(Alignment.Center).size(32.dp))
        }
        if (i.isVideo) Box(Modifier.align(Alignment.Center).size(36.dp).background(Color.Black.copy(alpha = 0.5f), CircleShape), contentAlignment = Alignment.Center) {
            Icon(Icons.Filled.PlayArrow, null, tint = Color.White)
        }
        Box(Modifier.align(Alignment.TopEnd)) { onMenu() }
    }
}

/**
 * Move to…: a folder picker, one level at a time, opening at the item's own folder with the path above it.
 * The item itself is never listed, so its own subtree can't be reached.
 */
@Composable
fun VaultMoveDialog(item: VaultItem, api: VaultApi, onDismiss: () -> Unit, onMoved: (VaultItem, String) -> Unit) {
    val c = Nx.colors
    val res = LocalContext.current.resources
    val scope = rememberCoroutineScope()
    var at by remember { mutableStateOf(item.parentId) }
    var list by remember { mutableStateOf<VaultList?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    LaunchedEffect(at) {
        list = null; error = null
        try { list = api.list(at) } catch (e: ApiError) { error = e.describe(res) }
    }
    val root = "Vault"
    val here = list?.breadcrumb?.lastOrNull()?.name ?: root
    val block = list?.let { VaultRules.moveBlock(item.parentId, at, it.canWrite) }
    AlertDialog(onDismissRequest = { if (!busy) onDismiss() }, title = { Text(stringResource(R.string.vm_title, item.name)) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                // The path, to walk up: Vault › LOGO › …
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                    Text(root, fontSize = 12.sp, color = if (at == null) c.foreground else c.violetText, fontWeight = FontWeight.SemiBold,
                        modifier = Modifier.clickable(enabled = at != null) { at = null })
                    list?.breadcrumb?.forEach { b ->
                        Text(" › ", fontSize = 12.sp, color = c.mutedFg)
                        Text(b.name, fontSize = 12.sp, color = if (b.id == at) c.foreground else c.violetText, fontWeight = FontWeight.SemiBold, maxLines = 1,
                            overflow = TextOverflow.Ellipsis, modifier = Modifier.clickable(enabled = b.id != at) { at = b.id })
                    }
                }
                val folders = list?.items?.filter { it.isFolder && it.id != item.id }.orEmpty()
                when {
                    list == null && error == null -> CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp)
                    list != null && folders.isEmpty() -> Text(stringResource(R.string.vm_no_folders), fontSize = 13.sp, color = c.mutedFg)
                    else -> LazyColumn(Modifier.heightIn(max = 320.dp)) {
                        items(VaultRules.sorted(folders), key = { it.id }) { f ->
                            Row(Modifier.fillMaxWidth().clickable { at = f.id }.padding(vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                                Icon(Icons.Filled.Folder, null, tint = c.violetText); Spacer(Modifier.width(10.dp))
                                Text(f.name, fontSize = 14.sp, color = c.foreground, modifier = Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis)
                                Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, null, tint = c.mutedFg)
                            }
                            HorizontalDivider(color = c.border.copy(alpha = 0.5f))
                        }
                    }
                }
                block?.let { Text(stringResource(it), fontSize = 12.sp, color = c.mutedFg) }
                error?.let { Text(it, fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = c.dangerText) }
            }
        },
        confirmButton = { TextButton(onClick = {
            busy = true; error = null
            scope.launch {
                try { onMoved(api.move(item.id, at), here) }
                catch (e: ApiError) { error = e.describe(res) }
                busy = false
            }
        }, enabled = list != null && block == null && !busy) { Text(stringResource(R.string.vm_here)) } },
        dismissButton = { TextButton(onClick = onDismiss, enabled = !busy) { Text(stringResource(R.string.cancel)) } })
}

/** A picture you can pinch, pan and double-tap; reports whether it is zoomed (the pager stops paging then). */
@Composable
private fun ZoomablePicture(i: VaultItem, onZoomed: (Boolean) -> Unit) {
    val placeholder = rememberBitmap(VaultRules.thumb(i, 1280), 1280)
    val full = rememberBitmap(i.url?.let { "$it?v=${i.updatedAt.orEmpty().hashCode()}" }, 2048)
    var scale by remember { mutableFloatStateOf(1f) }
    var offset by remember { mutableStateOf(Offset.Zero) }
    val shown = full ?: placeholder
    Box(Modifier.fillMaxSize()
        .pointerInput(i.id) { detectTapGestures(onDoubleTap = { if (scale > 1f) { scale = 1f; offset = Offset.Zero } else scale = 2.5f; onZoomed(scale > 1f) }) }
        .pointerInput(i.id) {
            detectTransformGestures { _, pan, zoom, _ ->
                scale = (scale * zoom).coerceIn(1f, 5f)
                offset = if (scale > 1f) offset + pan else Offset.Zero
                onZoomed(scale > 1f)
            }
        }, contentAlignment = Alignment.Center) {
        if (shown != null) Image(shown, i.name, Modifier.fillMaxSize().graphicsLayer { scaleX = scale; scaleY = scale; translationX = offset.x; translationY = offset.y },
            contentScale = ContentScale.Fit)
        else CircularProgressIndicator(color = Color.White)
    }
}

/** A film streamed with the session cookie (the server answers Range with 206); a failure says to download it. */
@Composable
private fun VaultVideo(i: VaultItem) {
    val context = LocalContext.current
    val container = (context.applicationContext as NexusApplication).container
    var failed by remember(i.id) { mutableStateOf(false) }
    val session = container.sessionStore.current
    val url = i.url?.let { container.api.url(it).toString() }
    if (failed || url == null || session == null) {
        Text(stringResource(R.string.vv_cant_play), color = Color.White, textAlign = TextAlign.Center, modifier = Modifier.padding(32.dp))
        return
    }
    AndroidView(factory = { ctx ->
        VideoView(ctx).apply {
            setMediaController(MediaController(ctx).also { it.setAnchorView(this) })
            setOnErrorListener { _, _, _ -> failed = true; true }
            setVideoURI(Uri.parse(url), mapOf("Cookie" to "${session.cookieName}=${session.token}"))
            setOnPreparedListener { start() }
        }
    }, modifier = Modifier.fillMaxWidth())
}

/**
 * Full-screen viewer: pages through the folder's pictures and films (a zoomed picture pans instead), with
 * the name, "3 of 12", Download/Save, Share link and Close on top.
 */
@OptIn(ExperimentalFoundationApi::class)
@Composable
fun VaultViewer(items: List<VaultItem>, start: Int, onClose: () -> Unit, onSave: (VaultItem) -> Unit, onShare: (VaultItem) -> Unit) {
    val pager = rememberPagerState(initialPage = start.coerceIn(0, (items.size - 1).coerceAtLeast(0))) { items.size }
    var zoomed by remember { mutableStateOf(false) }
    Dialog(onDismissRequest = onClose, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Box(Modifier.fillMaxSize().background(Color.Black)) {
            HorizontalPager(pager, Modifier.fillMaxSize(), userScrollEnabled = !zoomed, key = { items[it].id }) { p ->
                val i = items[p]
                Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    if (i.isVideo) { if (pager.currentPage == p) VaultVideo(i) else Icon(Icons.Filled.PlayArrow, null, tint = Color.White, modifier = Modifier.size(56.dp)) }
                    else ZoomablePicture(i) { if (pager.currentPage == p) zoomed = it }
                }
            }
            LaunchedEffect(pager.currentPage) { zoomed = false }
            val cur = items.getOrNull(pager.currentPage)
            Row(Modifier.fillMaxWidth().statusBarsPadding().background(Color.Black.copy(alpha = 0.45f)).padding(4.dp), verticalAlignment = Alignment.CenterVertically) {
                IconButton(onClick = onClose) { Icon(Icons.Filled.Close, stringResource(R.string.close), tint = Color.White) }
                Column(Modifier.weight(1f)) {
                    Text(cur?.name.orEmpty(), color = Color.White, fontSize = 14.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Text(stringResource(R.string.vv_index, pager.currentPage + 1, items.size), color = Color.White.copy(alpha = 0.7f), fontSize = 11.sp)
                }
                cur?.let { i ->
                    IconButton(onClick = { onSave(i) }) { Icon(Icons.Filled.Download, stringResource(R.string.td_save_share), tint = Color.White) }
                    IconButton(onClick = { onShare(i) }) { Icon(Icons.Filled.Link, stringResource(R.string.vault_share_link), tint = Color.White) }
                }
            }
        }
    }
}
