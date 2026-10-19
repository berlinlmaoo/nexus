package id.znetworks.nexus.feature.sheets

import android.content.Context
import androidx.compose.foundation.ScrollState
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.rememberTransformableState
import androidx.compose.foundation.gestures.transformable
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.input.pointer.PointerEventPass
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import id.znetworks.nexus.NexusApplication
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch

internal val LocalSheetZoom = staticCompositionLocalOf { 1f }
internal val LocalSheetMultiTouch = staticCompositionLocalOf { false }

object SheetZoomMath {
    fun clamp(value: Float, fallback: Float = 1f) = if (value.isFinite()) value.coerceIn(.5f, 2f) else fallback
    fun default(compact: Boolean) = if (compact) .8f else 1f
    fun logical(scroll: Float, focal: Float, fixed: Float, scale: Float) = (scroll + (focal - fixed * scale).coerceAtLeast(0f)) / scale
    fun scroll(logical: Float, focal: Float, fixed: Float, scale: Float) = (logical * scale - (focal - fixed * scale).coerceAtLeast(0f)).coerceAtLeast(0f)
    fun row(heights: List<Float>, baseScroll: Float): Pair<Int, Float> {
        if (heights.isEmpty()) return 0 to 0f
        var left = baseScroll.coerceAtLeast(0f)
        for (index in heights.indices) {
            if (left < heights[index] || index == heights.lastIndex) return index to left.coerceAtMost(heights[index])
            left -= heights[index]
        }
        return 0 to 0f
    }
}

private class ZoomGesture {
    var center = Offset.Zero
    var anchor: Pair<Float, Float>? = null
    var scrollJob: Job? = null
}

internal data class SheetZoomControl(val scale: Float, val modifier: Modifier, val multiTouch: Boolean)

/** Scale grid metrics; standard transformable owns pinch recognition and gesture arbitration. */
@Composable
internal fun rememberSheetZoom(sheetId: String, fixedWidth: Float, fixedHeight: Float, rowHeights: List<Float>, h: ScrollState, v: LazyListState): SheetZoomControl {
    val context = LocalContext.current
    val account = (context.applicationContext as NexusApplication).container.sessionStore.current?.userId.orEmpty()
    val key = "$account:$sheetId"
    val compact = LocalConfiguration.current.screenWidthDp < 600
    val prefs = remember { context.getSharedPreferences("sheet-zoom", Context.MODE_PRIVATE) }
    var scale by remember(key) { mutableFloatStateOf(SheetZoomMath.clamp(prefs.getFloat(key, SheetZoomMath.default(compact)), SheetZoomMath.default(compact))) }
    val gesture = remember(key) { ZoomGesture() }
    var multiTouch by remember(key) { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    fun applyScale(next: Float, resetAnchor: Boolean = false) {
        val center = gesture.center
        val vertical = rowHeights.take(v.firstVisibleItemIndex).sum() * scale + v.firstVisibleItemScrollOffset
        if (resetAnchor || gesture.anchor == null) gesture.anchor = SheetZoomMath.logical(h.value.toFloat(), center.x, fixedWidth, scale) to SheetZoomMath.logical(vertical, center.y, fixedHeight, scale)
        val anchor = gesture.anchor!!
        val newScale = SheetZoomMath.clamp(next)
        val targetX = SheetZoomMath.scroll(anchor.first, center.x, fixedWidth, newScale)
        val targetY = SheetZoomMath.scroll(anchor.second, center.y, fixedHeight, newScale)
        scale = newScale
        gesture.scrollJob?.cancel()
        gesture.scrollJob = scope.launch {
            // Wait for the new metrics before clamping against the new scroll extent.
            withFrameNanos { }
            h.scrollTo(targetX.toInt())
            if (rowHeights.isNotEmpty()) {
                val (index, offset) = SheetZoomMath.row(rowHeights, targetY / newScale)
                v.requestScrollToItem(index, (offset * newScale).toInt())
            }
        }
    }
    val transform = rememberTransformableState { change, _, _ -> applyScale(scale * change) }
    LaunchedEffect(transform.isTransformInProgress, scale) {
        if (!transform.isTransformInProgress) {
            gesture.anchor = null
            prefs.edit().putFloat(key, scale).apply()
        }
    }
    val reset by rememberUpdatedState({ applyScale(1f, resetAnchor = true) })
    val observer = Modifier.pointerInput(key) {
        var previousTap = 0L
        var previousCenter = Offset.Zero
        awaitEachGesture {
            try {
            var start = 0L
            var maximum = 0
            var moved = false
            val origins = mutableMapOf<Long, Offset>()
            var end = 0L
            do {
                val event = awaitPointerEvent(PointerEventPass.Initial)
                val pressed = event.changes.filter { it.pressed }
                val time = event.changes.firstOrNull()?.uptimeMillis ?: 0L
                if (start == 0L) start = time
                end = time
                maximum = maxOf(maximum, pressed.size)
                if (pressed.size >= 2) multiTouch = true
                if (pressed.size >= 2) {
                    gesture.center = pressed.map { it.position }.reduce(Offset::plus) / pressed.size.toFloat()
                    pressed.forEach { change ->
                        val origin = origins.getOrPut(change.id.value) { change.position }
                        if ((change.position - origin).getDistance() > viewConfiguration.touchSlop) moved = true
                    }
                }
                // A two-finger tap must not also select/edit the cell beneath either finger.
                if (maximum >= 2) event.changes.filter { !it.pressed && it.previousPressed }.forEach { it.consume() }
            } while (event.changes.any { it.pressed })
            multiTouch = false
            val center = gesture.center
            if (maximum == 2 && !moved && end - start <= viewConfiguration.longPressTimeoutMillis) {
                if (previousTap != 0L && end - previousTap in viewConfiguration.doubleTapMinTimeMillis..viewConfiguration.doubleTapTimeoutMillis && (center - previousCenter).getDistance() < viewConfiguration.touchSlop * 4) {
                    reset(); previousTap = 0L
                } else { previousTap = end; previousCenter = center }
            } else previousTap = 0L
            } finally { multiTouch = false }
        }
    }
    return SheetZoomControl(scale, observer.transformable(transform, canPan = { false }), multiTouch)
}
