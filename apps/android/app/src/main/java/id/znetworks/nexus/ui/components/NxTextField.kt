package id.znetworks.nexus.ui.components

import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.LocalTextStyle
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.TextFieldColors
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import id.znetworks.nexus.ui.theme.Nx

/** Shared native field surface: quiet fill at rest, accent focus and error rings only. */
@Composable
fun NxTextField(
    value: String,
    onValueChange: (String) -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    readOnly: Boolean = false,
    textStyle: TextStyle = LocalTextStyle.current,
    label: (@Composable () -> Unit)? = null,
    placeholder: (@Composable () -> Unit)? = null,
    leadingIcon: (@Composable () -> Unit)? = null,
    trailingIcon: (@Composable () -> Unit)? = null,
    prefix: (@Composable () -> Unit)? = null,
    suffix: (@Composable () -> Unit)? = null,
    supportingText: (@Composable () -> Unit)? = null,
    isError: Boolean = false,
    visualTransformation: VisualTransformation = VisualTransformation.None,
    keyboardOptions: KeyboardOptions = KeyboardOptions.Default,
    keyboardActions: KeyboardActions = KeyboardActions.Default,
    singleLine: Boolean = false,
    maxLines: Int = if (singleLine) 1 else Int.MAX_VALUE,
    minLines: Int = 1,
    interactionSource: MutableInteractionSource? = null,
    shape: Shape = RoundedCornerShape(12.dp),
    colors: TextFieldColors = OutlinedTextFieldDefaults.colors(),
) {
    val c = Nx.colors
    OutlinedTextField(value, onValueChange, modifier, enabled, readOnly, textStyle,
        label, placeholder, leadingIcon, trailingIcon, prefix, suffix, supportingText, isError,
        visualTransformation, keyboardOptions, keyboardActions, singleLine, maxLines, minLines,
        interactionSource, shape, colors.copy(
            focusedContainerColor = c.muted, unfocusedContainerColor = c.muted,
            disabledContainerColor = c.muted.copy(alpha = .6f), errorContainerColor = c.muted,
            focusedIndicatorColor = c.violetText, unfocusedIndicatorColor = Color.Transparent,
            disabledIndicatorColor = Color.Transparent, errorIndicatorColor = c.dangerText,
        ))
}
