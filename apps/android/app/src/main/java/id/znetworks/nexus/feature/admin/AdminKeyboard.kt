package id.znetworks.nexus.feature.admin

import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.text.input.ImeAction
import id.znetworks.nexus.feature.attendance.dismissKeyboardOnDrag

/**
 * Batch 2 B (owner 29 Sep): in Control Room the keyboard must always be put away — Done on the key,
 * a tap on empty space, or a drag (the same finger-drag rule as the daily reflection, so a bring-into-view
 * scroll never closes it at every letter).
 */
object AdminKeyboard {
    val Done = KeyboardOptions(imeAction = ImeAction.Done)
}

/** On an admin screen's root: a tap on empty space or a finger drag clears focus and closes the keyboard. */
@Composable
fun Modifier.dismissKeyboardOnTapOrDrag(): Modifier {
    val focus = LocalFocusManager.current
    return dismissKeyboardOnDrag { focus.clearFocus() }.pointerInput(Unit) { detectTapGestures { focus.clearFocus() } }
}
