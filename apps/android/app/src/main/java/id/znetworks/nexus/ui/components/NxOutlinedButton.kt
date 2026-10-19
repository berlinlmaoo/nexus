package id.znetworks.nexus.ui.components

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.ButtonColors
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.ButtonElevation
import androidx.compose.material3.OutlinedButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.unit.dp
import id.znetworks.nexus.ui.theme.Nx

/** Soft secondary action / picker surface; explicit semantic borders and colors remain supported. */
@Composable
fun NxOutlinedButton(
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    shape: Shape = RoundedCornerShape(12.dp),
    colors: ButtonColors = ButtonDefaults.outlinedButtonColors(containerColor = Nx.colors.muted),
    elevation: ButtonElevation? = null,
    border: BorderStroke? = BorderStroke(1.dp, Nx.colors.border),
    contentPadding: PaddingValues = ButtonDefaults.ContentPadding,
    interactionSource: MutableInteractionSource? = null,
    content: @Composable RowScope.() -> Unit,
) {
    OutlinedButton(onClick = onClick, modifier = modifier, enabled = enabled, shape = shape,
        colors = colors, elevation = elevation, border = border, contentPadding = contentPadding,
        interactionSource = interactionSource, content = content)
}
