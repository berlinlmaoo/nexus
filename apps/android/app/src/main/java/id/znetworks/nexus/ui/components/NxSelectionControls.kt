package id.znetworks.nexus.ui.components

import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CheckboxColors
import androidx.compose.material3.CheckboxDefaults
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchColors
import androidx.compose.material3.SwitchDefaults
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import id.znetworks.nexus.ui.theme.Nx

/** Selection uses the violet accent independently of the app's onyx primary actions. */
@Composable
fun NxCheckbox(
    checked: Boolean,
    onCheckedChange: ((Boolean) -> Unit)?,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    colors: CheckboxColors = CheckboxDefaults.colors(
        checkedColor = Nx.colors.violetText,
        checkmarkColor = Nx.colors.background,
    ),
    interactionSource: MutableInteractionSource? = null,
) = Checkbox(checked, onCheckedChange, modifier, enabled, colors, interactionSource)

@Composable
fun NxSwitch(
    checked: Boolean,
    onCheckedChange: ((Boolean) -> Unit)?,
    modifier: Modifier = Modifier,
    thumbContent: (@Composable () -> Unit)? = null,
    enabled: Boolean = true,
    colors: SwitchColors = SwitchDefaults.colors(
        checkedTrackColor = Nx.colors.violetText,
        checkedBorderColor = Nx.colors.violetText,
        checkedThumbColor = Nx.colors.background,
    ),
    interactionSource: MutableInteractionSource? = null,
) = Switch(checked, onCheckedChange, modifier, thumbContent, enabled, colors, interactionSource)
