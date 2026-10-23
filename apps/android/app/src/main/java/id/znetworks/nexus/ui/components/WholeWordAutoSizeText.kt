package id.znetworks.nexus.ui.components

import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.text.BasicText
import androidx.compose.foundation.text.TextAutoSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.text
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.sp
import id.znetworks.nexus.feature.projects.ProjectTitleLayout

/** Explicit whole-word lines prevent native wrapping from splitting a name inside a word. */
@Composable
internal fun WholeWordAutoSizeText(value: String, style: TextStyle, modifier: Modifier = Modifier, minLines: Int = 1) {
    val normal = style.fontSize.value.takeIf { it.isFinite() && it > 0 } ?: 16f
    val measurer = rememberTextMeasurer()
    val measure: (String, Float) -> Float = remember(measurer, style) {
        { text, size -> measurer.measure(AnnotatedString(text), style.copy(fontSize = size.sp), softWrap = false, maxLines = 1).size.width.toFloat() }
    }
    BoxWithConstraints(modifier) {
        val prepared = remember(value, constraints.maxWidth, normal, measure) {
            WholeWordAutoSizeLayout.prepare(value, constraints.maxWidth.toFloat(), normal, measure)
        }
        Column(Modifier.fillMaxWidth().clearAndSetSemantics { text = AnnotatedString(value) }) {
            prepared.slots(minLines).forEach { slot ->
                BasicText(slot.text, Modifier.fillMaxWidth(), style = style.copy(fontSize = prepared.fontSize.sp),
                    minLines = slot.minLines, maxLines = slot.maxLines, softWrap = slot.softWrap, overflow = TextOverflow.Ellipsis,
                    autoSize = TextAutoSize.StepBased(minFontSize = prepared.minFontSize.sp, maxFontSize = prepared.fontSize.sp, stepSize = prepared.stepSize.sp))
            }
        }
    }
}

internal object WholeWordAutoSizeLayout {
    data class Slot(val text: String, val softWrap: Boolean, val maxLines: Int, val minLines: Int)
    data class Prepared(val text: String, val fontSize: Float, val fits: Boolean, val minFontSize: Float, val stepSize: Float = .25f) {
        fun slots(minLines: Int): List<Slot> {
            // Compose forces softWrap=false + Ellipsis to one effective line, even with explicit newlines.
            // Fitted lines can wrap safely: each is measured at the largest candidate size already.
            if (fits) return listOf(Slot(text, softWrap = true, maxLines = 2, minLines = minLines.coerceIn(1, 2)))
            // An oversized word at the minimum must ellipsize in its own slot instead of splitting.
            val lines = text.split('\n')
            return (lines + List((minLines.coerceIn(1, 2) - lines.size).coerceAtLeast(0)) { "" }).map {
                Slot(it, softWrap = false, maxLines = 1, minLines = 1)
            }
        }
    }

    fun prepare(value: String, width: Float, normalFontSize: Float, measure: (String, Float) -> Float): Prepared {
        val result = ProjectTitleLayout.fit(value, width, normalFontSize * .75f, measure, normalFontSize)
        return Prepared(result.lines.joinToString("\n"), result.fontSize, result.fits, normalFontSize * .75f)
    }
}
