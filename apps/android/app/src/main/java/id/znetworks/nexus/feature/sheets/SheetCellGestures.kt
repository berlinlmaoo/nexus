package id.znetworks.nexus.feature.sheets

import androidx.compose.foundation.focusable
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.Modifier
import androidx.compose.ui.composed
import androidx.compose.ui.input.key.*
import androidx.compose.ui.input.pointer.*
import androidx.compose.ui.semantics.onClick
import androidx.compose.ui.semantics.onLongClick
import androidx.compose.ui.semantics.semantics

/** Leave downs available to the standard parent transformable, including fingers in different cells. */
internal fun Modifier.sheetCellActions(onClick: () -> Unit, onLongClick: () -> Unit): Modifier = composed {
    val click by rememberUpdatedState(onClick)
    val longClick by rememberUpdatedState(onLongClick)
    this.semantics {
        onClick { click(); true }
        onLongClick { longClick(); true }
    }.onKeyEvent {
        if (it.type == KeyEventType.KeyUp && it.key in listOf(Key.Enter, Key.NumPadEnter, Key.Spacebar)) { click(); true } else false
    }.focusable().pointerInput(Unit) {
        awaitEachGesture {
            val down = awaitFirstDown(requireUnconsumed = false)
            var cancelled = false
            var released = false
            val completed = withTimeoutOrNull(viewConfiguration.longPressTimeoutMillis) {
                while (!cancelled && !released) {
                    val event = awaitPointerEvent()
                    val change = event.changes.firstOrNull { it.id == down.id }
                    cancelled = event.changes.size > 1 || change == null || change.isConsumed ||
                        (change.position - down.position).getDistance() > viewConfiguration.touchSlop ||
                        change.position.x !in 0f..size.width.toFloat() || change.position.y !in 0f..size.height.toFloat()
                    if (!cancelled && change != null && !change.pressed) { change.consume(); released = true }
                }
                true
            }
            if (!cancelled) {
                if (released) click()
                else if (completed == null) {
                    longClick()
                    do { val event = awaitPointerEvent(); event.changes.forEach { it.consume() } }
                    while (event.changes.any { it.pressed })
                }
            }
        }
    }
}
