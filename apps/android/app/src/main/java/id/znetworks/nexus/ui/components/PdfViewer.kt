package id.znetworks.nexus.ui.components

import android.graphics.Bitmap
import android.graphics.Color as AColor
import android.graphics.pdf.PdfRenderer
import android.os.ParcelFileDescriptor
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Description
import androidx.compose.material.icons.filled.OpenInNew
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import id.znetworks.nexus.NexusApplication
import id.znetworks.nexus.R
import id.znetworks.nexus.core.files.FileOpener
import id.znetworks.nexus.core.net.ApiError
import id.znetworks.nexus.ui.theme.Nx
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import java.io.File

/**
 * A NEXUS PDF (e.g. an SP on an announcement, Batch 2) read inside the app: the file wants the session,
 * so it is downloaded with it into the shared cache (emptied at sign-out) and drawn page by page with
 * [PdfRenderer]. "Open in" hands the same file to another app for zoom, print or save.
 */
@Composable
fun PdfViewerDialog(url: String, name: String, onDismiss: () -> Unit) {
    val context = LocalContext.current
    val container = (context.applicationContext as NexusApplication).container
    val scope = rememberCoroutineScope()
    val res = context.resources
    val fileName = if (name.lowercase().endsWith(".pdf")) name else "$name.pdf"
    var file by remember(url) { mutableStateOf<File?>(null) }
    var error by remember(url) { mutableStateOf<String?>(null) }
    LaunchedEffect(url) {
        try { file = FileOpener.fetch(context, container.api, url, fileName) }
        catch (e: ApiError) { error = e.describe(res) }
        catch (e: Exception) { error = res.getString(R.string.pdf_failed) }
    }
    Dialog(onDismissRequest = onDismiss, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Column(Modifier.fillMaxSize().background(Color(0xFF2B2B2E)).safeDrawingPadding()) {
            Row(Modifier.fillMaxWidth().padding(4.dp), verticalAlignment = Alignment.CenterVertically) {
                IconButton(onClick = onDismiss) { Icon(Icons.Filled.Close, stringResource(R.string.close), tint = Color.White) }
                Text(fileName, color = Color.White, fontSize = 15.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                IconButton(onClick = { scope.launch { runCatching { FileOpener.open(context, container.api, url, fileName, "application/pdf") } } }, enabled = file != null) {
                    Icon(Icons.Filled.OpenInNew, stringResource(R.string.pdf_open_in), tint = Color.White)
                }
            }
            val f = file
            when {
                error != null -> Box(Modifier.fillMaxSize().padding(24.dp), contentAlignment = Alignment.Center) {
                    Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Icon(Icons.Filled.Description, null, tint = Color.White.copy(alpha = 0.6f))
                        Text(error!!, color = Color.White)
                    }
                }
                f == null -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
                else -> PdfPages(f) { error = res.getString(R.string.pdf_failed) }
            }
        }
    }
}

@Composable
internal fun PdfPages(file: File, onBroken: () -> Unit) {
    // One renderer for the file; PdfRenderer allows one open page at a time, hence the lock.
    val doc = remember(file) {
        runCatching { PdfRenderer(ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY)) }.getOrNull()
    }
    DisposableEffect(doc) { onDispose { runCatching { doc?.close() } } }
    if (doc == null) { LaunchedEffect(Unit) { onBroken() }; return }
    val lock = remember(doc) { Mutex() }
    BoxWithConstraints(Modifier.fillMaxSize()) {
        val widthPx = with(LocalDensity.current) { maxWidth.toPx() }.toInt().coerceIn(600, 2000)
        LazyColumn(contentPadding = PaddingValues(12.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            items(doc.pageCount) { i ->
                var bmp by remember(i) { mutableStateOf<ImageBitmap?>(null) }
                var ratio by remember(i) { mutableStateOf(1f / 1.414f) }
                LaunchedEffect(i, widthPx) {
                    bmp = withContext(Dispatchers.IO) {
                        lock.withLock {
                            runCatching {
                                doc.openPage(i).use { page ->
                                    ratio = page.width.toFloat() / page.height
                                    val b = Bitmap.createBitmap(widthPx, (widthPx / ratio).toInt(), Bitmap.Config.ARGB_8888)
                                    b.eraseColor(AColor.WHITE)
                                    page.render(b, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY)
                                    b.asImageBitmap()
                                }
                            }.getOrNull()
                        }
                    }
                }
                Box(Modifier.fillMaxWidth().aspectRatio(ratio).background(Color.White), contentAlignment = Alignment.Center) {
                    bmp?.let { Image(it, null, contentScale = ContentScale.Fit, modifier = Modifier.fillMaxSize()) } ?: CircularProgressIndicator()
                }
            }
        }
    }
}
