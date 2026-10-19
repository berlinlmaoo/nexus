package id.znetworks.nexus.feature.social

import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.input.OffsetMapping
import androidx.compose.ui.text.input.TransformedText
import androidx.compose.ui.text.input.VisualTransformation

/** Group presentation only: backing state and server payload stay unambiguous whole-number digits. */
internal class GroupedNumber(private val separator: Char) : VisualTransformation {
    override fun filter(text: AnnotatedString): TransformedText {
        val raw = text.text
        val grouped = raw.reversed().chunked(3).joinToString(separator.toString()).reversed()
        val mapping = object : OffsetMapping {
            override fun originalToTransformed(offset: Int): Int {
                if (offset <= 0) return 0
                var digits = 0
                grouped.forEachIndexed { index, c ->
                    if (c != separator) digits++
                    if (digits == offset) return index + 1
                }
                return grouped.length
            }
            override fun transformedToOriginal(offset: Int) = grouped.take(offset.coerceIn(0, grouped.length)).count { it != separator }.coerceAtMost(raw.length)
        }
        return TransformedText(AnnotatedString(grouped), mapping)
    }
}
