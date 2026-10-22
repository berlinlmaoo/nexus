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

/** Project names share a two-line, word-only layout, including the Pipeline board switcher. */
@Composable
fun ProjectTitle(name: String, modifier: Modifier = Modifier) {
    val measure = rememberProjectTitleMeasure()
    BoxWithConstraints(modifier) {
        val title = remember(name, constraints.maxWidth, measure) {
            ProjectTitleLayout.fit(name, constraints.maxWidth.toFloat(), measure)
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

    fun fit(name: String, width: Float, measure: (String, Float) -> Float): Result {
        val words = name.trim().split(Regex("\\s+")).filter(String::isNotEmpty)
        if (words.isEmpty()) return Result(listOf(""), 19f, true)
        for (step in 0..10) {
            val size = 19f - step * .5f
            completeLines(words, width, size, measure)?.let { return Result(it, size, true) }
        }
        // Preserve complete words on line one; line two carries the remainder and receives the ellipsis.
        // If even the first word is too wide, Text ellipsizes it without wrapping it into another line.
        var end = 1
        while (end < words.size && measure(words.take(end + 1).joinToString(" "), 14f) <= width) end++
        val lines = listOf(words.take(end).joinToString(" "), words.drop(end).joinToString(" ")).filter(String::isNotEmpty)
        return Result(lines, 14f, false)
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
        return lines
    }
}
