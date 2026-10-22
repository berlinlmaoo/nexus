package id.znetworks.nexus.feature.projects

import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.text
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.sp
import id.znetworks.nexus.ui.theme.Nx
import id.znetworks.nexus.ui.theme.TextFont
import kotlin.math.abs

/** Project names share a two-line, word-only layout, including the Pipeline board switcher. */
@Composable
fun ProjectTitle(name: String, modifier: Modifier = Modifier, minFontSize: Float = 14f) {
    val measure = rememberProjectTitleMeasure()
    BoxWithConstraints(modifier) {
        val title = remember(name, constraints.maxWidth, measure, minFontSize) {
            ProjectTitleLayout.fit(name, constraints.maxWidth.toFloat(), minFontSize, measure)
        }
        Column(Modifier.fillMaxWidth().clearAndSetSemantics { text = AnnotatedString(name) }) {
            title.lines.forEach { line ->
                Text(line, modifier = Modifier.fillMaxWidth(), fontFamily = TextFont, fontWeight = FontWeight.SemiBold,
                    fontSize = title.fontSize.sp, lineHeight = (title.fontSize + 3f).sp, color = Nx.colors.foreground,
                    // Each line contains whole words. Oversized words and an extreme second line receive an ellipsis.
                    softWrap = false, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
        }
    }
}

@Composable
internal fun rememberProjectTitleMeasure(): (String, Float) -> Float {
    val measurer = rememberTextMeasurer()
    return remember(measurer) {
        { text, size ->
            measurer.measure(AnnotatedString(text), TextStyle(fontFamily = TextFont, fontWeight = FontWeight.SemiBold, fontSize = size.sp),
                softWrap = false, maxLines = 1).size.width.toFloat()
        }
    }
}

/** Separate from Compose so font selection and word-boundary behavior can be verified deterministically. */
internal object ProjectTitleLayout {
    data class Result(val lines: List<String>, val fontSize: Float, val fits: Boolean)

    fun fit(name: String, width: Float, measure: (String, Float) -> Float): Result = fit(name, width, 14f, measure)

    fun fit(name: String, width: Float, minFontSize: Float, measure: (String, Float) -> Float): Result {
        val minimum = minFontSize.coerceIn(1f, 19f)
        val words = name.trim().split(Regex("\\s+")).filter(String::isNotEmpty)
        if (words.isEmpty()) return Result(listOf(""), 19f, true)
        val sizes = (0..36).map { 19f - it * .5f }.takeWhile { it > minimum } + minimum
        for (size in sizes) {
            completeLines(words, width, size, measure)?.let { return Result(it, size, true) }
        }
        // Preserve complete words on line one; line two carries the remainder and receives the ellipsis.
        // If even the first word is too wide, Text ellipsizes it without wrapping it into another line.
        var end = 1
        while (end < words.size && measure(words.take(end + 1).joinToString(" "), minimum) <= width) end++
        val lines = listOf(words.take(end).joinToString(" "), words.drop(end).joinToString(" ")).filter(String::isNotEmpty)
        return Result(lines, minimum, false)
    }

    private fun completeLines(words: List<String>, width: Float, size: Float, measure: (String, Float) -> Float): List<String>? {
        val lines = mutableListOf<String>()
        var line = ""
        for (word in words) {
            if (measure(word, size) > width) return null
            val candidate = if (line.isEmpty()) word else "$line $word"
            if (measure(candidate, size) <= width) line = candidate
            else {
                if (lines.isNotEmpty()) return null
                lines += line
                line = word
            }
        }
        lines += line
        if (lines.size == 1) return lines
        // The largest fitting font is already selected by the caller. Balance only the word breaks
        // at this size; prefer two words on each line when that alternative fits, avoiding an orphan.
        data class Split(val lines: List<String>, val at: Int, val firstWidth: Float, val secondWidth: Float)
        val splits = (1 until words.size).mapNotNull { at ->
            val first = words.take(at).joinToString(" ")
            val second = words.drop(at).joinToString(" ")
            val firstWidth = measure(first, size)
            val secondWidth = measure(second, size)
            if (firstWidth <= width && secondWidth <= width) Split(listOf(first, second), at, firstWidth, secondWidth) else null
        }
        val withoutOrphan = splits.filter { it.at >= 2 && words.size - it.at >= 2 }
        return (withoutOrphan.ifEmpty { splits }).minWithOrNull(
            compareBy<Split> { abs(it.firstWidth - it.secondWidth) }.thenByDescending { it.firstWidth }
        )?.lines ?: lines
    }
}
