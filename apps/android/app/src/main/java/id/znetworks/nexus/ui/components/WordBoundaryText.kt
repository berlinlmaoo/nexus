package id.znetworks.nexus.ui.components

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.text
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.rememberTextMeasurer

/** Every rendered line contains whole words; a single oversized word remains readable by scrolling. */
@Composable
internal fun WordBoundaryText(value: String, style: TextStyle, modifier: Modifier = Modifier, minLines: Int = 1) {
    val measure = rememberWordMeasure(style)
    BoxWithConstraints(modifier) {
        val width = constraints.maxWidth.toFloat()
        val lines = remember(value, width, measure) { WordBoundaryLayout.wrap(value, width, measure) }
        Column(Modifier.clearAndSetSemantics { text = AnnotatedString(value) }) {
            (lines + List((minLines - lines.size).coerceAtLeast(0)) { "" }).forEach { line ->
                Text(line, style = style, maxLines = 1, softWrap = false,
                    modifier = if (measure(line) > width) Modifier.horizontalScroll(rememberScrollState()) else Modifier)
            }
        }
    }
}

@Composable
internal fun rememberWordMeasure(style: TextStyle): (String) -> Float {
    val measurer = rememberTextMeasurer()
    return remember(measurer, style) {
        { value -> measurer.measure(AnnotatedString(value), style, softWrap = false, maxLines = 1).size.width.toFloat() }
    }
}

internal object WordBoundaryLayout {
    fun wrap(value: String, width: Float, measure: (String) -> Float): List<String> {
        val words = value.trim().split(Regex("\\s+")).filter(String::isNotEmpty)
        if (words.isEmpty()) return listOf("")
        val lines = mutableListOf<String>()
        var line = ""
        for (word in words) {
            val next = if (line.isEmpty()) word else "$line $word"
            if (line.isNotEmpty() && measure(next) > width) { lines += line; line = word } else line = next
        }
        return lines + line
    }

    fun fits(value: String, width: Float, maxLines: Int, measure: (String) -> Float): Boolean =
        wrap(value, width, measure).let { it.size <= maxLines && it.all { line -> measure(line) <= width } }

    /** Keep all eight KPIs on one row whenever their full labels fit in two lines. */
    fun kpiColumns(labels: List<String>, width: Float, tilePadding: Float, measure: (String) -> Float): Int =
        listOf(8, 4, 2, 1).firstOrNull { count -> labels.all { fits(it, kotlin.math.floor(width / count) - tilePadding, 2, measure) } } ?: 1
}
