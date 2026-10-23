package id.znetworks.nexus.feature.projects

import androidx.compose.foundation.layout.Box
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.Layout
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.constrainHeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import id.znetworks.nexus.ui.components.WholeWordAutoSizeLayout
import id.znetworks.nexus.ui.components.WholeWordAutoSizeText

/** The unchanged folder controls move below only when they would force name truncation. */
@Composable
internal fun FolderNamePriorityRow(name: String, style: TextStyle, modifier: Modifier,
                                   leading: @Composable () -> Unit, controls: @Composable () -> Unit) {
    val measurer = rememberTextMeasurer()
    val measure: (String, Float) -> Float = remember(measurer, style) {
        { text, size -> measurer.measure(AnnotatedString(text), style.copy(fontSize = size.sp), softWrap = false, maxLines = 1).size.width.toFloat() }
    }
    val normal = style.fontSize.value.takeIf { it.isFinite() && it > 0 } ?: 16f
    Layout(content = {
        Box { leading() }
        Box { WholeWordAutoSizeText(name, style) }
        Box { controls() }
    }, modifier = modifier) { children, constraints ->
        val loose = constraints.copy(minWidth = 0, minHeight = 0)
        val start = children[0].measure(loose)
        val end = children[2].measure(loose)
        val space = FolderNameLayout.space(name, constraints.maxWidth, start.width, end.width, normal, measure)
        val label = children[1].measure(Constraints(minWidth = space.nameWidth, maxWidth = space.nameWidth, maxHeight = constraints.maxHeight))
        val positions = FolderNameLayout.positions(constraints.maxWidth, start.width, start.height, label.height,
            end.width, end.height, space.stacked, 4.dp.roundToPx())
        layout(constraints.maxWidth, constraints.constrainHeight(positions.height)) {
            start.placeRelative(0, (positions.topHeight - start.height) / 2)
            label.placeRelative(start.width, (positions.topHeight - label.height) / 2)
            end.placeRelative(positions.controlsX, positions.controlsY)
        }
    }
}

internal object FolderNameLayout {
    data class Space(val stacked: Boolean, val nameWidth: Int)
    data class Positions(val topHeight: Int, val controlsX: Int, val controlsY: Int, val height: Int)

    fun space(name: String, width: Int, leading: Int, controls: Int, normal: Float, measure: (String, Float) -> Float): Space {
        val inlineWidth = (width - leading - controls).coerceAtLeast(0)
        val stacked = !WholeWordAutoSizeLayout.prepare(name, inlineWidth.toFloat(), normal, measure).fits
        return Space(stacked, if (stacked) (width - leading).coerceAtLeast(0) else inlineWidth)
    }

    fun positions(width: Int, leadingWidth: Int, leadingHeight: Int, nameHeight: Int,
                  controlsWidth: Int, controlsHeight: Int, stacked: Boolean, gap: Int): Positions {
        val top = maxOf(leadingHeight, nameHeight, if (stacked) 0 else controlsHeight)
        val y = if (stacked) top + gap else (top - controlsHeight) / 2
        return Positions(top, (width - controlsWidth).coerceAtLeast(leadingWidth.takeIf { !stacked } ?: 0), y,
            if (stacked) y + controlsHeight else top)
    }
}
