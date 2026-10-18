package id.znetworks.nexus.ui.components

import androidx.compose.foundation.ScrollState
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp

/** A fading viewport boundary signals content beyond it without cutting a hard edge through text. */
fun Modifier.scrollEdges(state: ScrollState, surface: Color, vertical: Boolean = false): Modifier = drawWithContent {
    drawContent()
    val edge = 24.dp.toPx()
    if (state.canScrollForward) {
        if (vertical) drawRect(Brush.verticalGradient(listOf(Color.Transparent, surface), startY = size.height - edge), topLeft = Offset(0f, size.height - edge), size = Size(size.width, edge))
        else drawRect(Brush.horizontalGradient(listOf(Color.Transparent, surface), startX = size.width - edge), topLeft = Offset(size.width - edge, 0f), size = Size(edge, size.height))
    }
    if (!vertical && state.canScrollBackward) drawRect(Brush.horizontalGradient(listOf(surface, Color.Transparent), endX = edge), size = Size(edge, size.height))
}
