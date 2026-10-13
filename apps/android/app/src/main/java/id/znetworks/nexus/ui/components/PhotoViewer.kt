package id.znetworks.nexus.ui.components

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.calculatePan
import androidx.compose.foundation.gestures.calculateZoom
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.input.pointer.positionChanged
import androidx.compose.ui.input.pointer.util.VelocityTracker
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import id.znetworks.nexus.R

/**
 * A person's picture that opens full screen when there IS a picture that loaded (PROFILE-TIDY, iOS
 * ZoomableAvatar): initials, or a photo that failed, open nothing and aren't clickable.
 */
@Composable
fun ZoomableAvatar(url: String?, name: String?, size: Dp) {
    val context = LocalContext.current
    var img by remember(url) { mutableStateOf(url?.let(ImageMemory::get)) }
    LaunchedEffect(url) { if (url != null && img == null) img = RemoteImages.load(context, url, 300) }
    var open by remember { mutableStateOf(false) }
    val i = img
    if (i == null) { Avatar(name, url, size); return }
    val desc = stringResource(R.string.pp_view_photo)
    Image(i, null, Modifier.size(size).clip(CircleShape).clickable { open = true }.semantics { contentDescription = desc }, contentScale = ContentScale.Crop)
    if (open) PhotoViewer(url!!, name) { open = false }
}

/**
 * Full screen on black: pinch 1×–6× and pan while zoomed, double-tap fit ↔ 2.5×, swipe down to close when
 * not zoomed (past 120 dp or a fast fling; else it springs back; two fingers never start it), an X, Back.
 * Loaded at page size, so zooming isn't just a bigger blur.
 */
@Composable
fun PhotoViewer(url: String, title: String?, onClose: () -> Unit) {
    val context = LocalContext.current
    var img by remember(url) { mutableStateOf<ImageBitmap?>(null) }
    LaunchedEffect(url) { img = RemoteImages.load(context, url, 2048) ?: ImageMemory.get(url) }
    var scale by remember { mutableFloatStateOf(1f) }
    var offset by remember { mutableStateOf(Offset.Zero) }
    var dragY by remember { mutableFloatStateOf(0f) }
    var dragging by remember { mutableStateOf(false) }
    val shownY by animateFloatAsState(if (dragging) dragY else 0f, label = "dismiss")
    Dialog(onDismissRequest = onClose, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Box(Modifier.fillMaxSize().background(Color.Black.copy(alpha = (1f - shownY / 1500f).coerceIn(0.4f, 1f)))) {
            val closeAt = with(androidx.compose.ui.platform.LocalDensity.current) { 120.dp.toPx() }
            Box(Modifier.fillMaxSize()
                .pointerInput(url) {
                    detectTapGestures(onDoubleTap = { if (scale > 1f) { scale = 1f; offset = Offset.Zero } else scale = 2.5f })
                }
                .pointerInput(url) {
                    awaitEachGesture {
                        awaitFirstDown(requireUnconsumed = false)
                        var twoFingers = false
                        val tracker = VelocityTracker()
                        while (true) {
                            val event = awaitPointerEvent()
                            val down = event.changes.count { it.pressed }
                            if (down == 0) break
                            if (down >= 2) twoFingers = true
                            val zoom = event.calculateZoom(); val pan = event.calculatePan()
                            if (scale > 1f || down >= 2) {
                                scale = (scale * zoom).coerceIn(1f, 6f)
                                offset = if (scale > 1f) offset + pan else Offset.Zero // back at 1× = centred
                                dragging = false; dragY = 0f
                            } else if (!twoFingers) {
                                dragging = true
                                dragY = (dragY + pan.y).coerceAtLeast(0f)
                                event.changes.first().let { tracker.addPosition(it.uptimeMillis, it.position) }
                            }
                            event.changes.forEach { if (it.positionChanged()) it.consume() }
                        }
                        if (dragging) {
                            val fling = tracker.calculateVelocity().y > 2500f
                            if (dragY > closeAt || fling) onClose()
                            dragging = false // springs back
                        }
                    }
                }, contentAlignment = Alignment.Center) {
                val i = img
                if (i != null) Image(i, title, Modifier.fillMaxSize().graphicsLayer {
                    scaleX = scale; scaleY = scale; translationX = offset.x; translationY = offset.y + shownY
                }, contentScale = ContentScale.Fit)
                else CircularProgressIndicator(color = Color.White)
            }
            title?.let { Text(it, color = Color.White, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis,
                modifier = Modifier.align(Alignment.TopStart).statusBarsPadding().padding(start = 16.dp, top = 14.dp, end = 72.dp)) }
            IconButton(onClick = onClose, modifier = Modifier.align(Alignment.TopEnd).statusBarsPadding().padding(4.dp)) {
                Box(Modifier.size(34.dp).background(Color.White.copy(alpha = 0.22f), CircleShape), contentAlignment = Alignment.Center) {
                    Icon(Icons.Filled.Close, stringResource(R.string.close), tint = Color.White)
                }
            }
        }
    }
}
