package id.znetworks.nexus.feature.gideon

import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.LinkAnnotation
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextLinkStyles
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.withLink
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import id.znetworks.nexus.ui.theme.Nx

/**
 * GIDEON answers as markdown (web components/gideon/GideonMarkdown.tsx, iOS GideonMarkdown.swift): headings,
 * paragraphs, bullet and numbered lists, quotes, code blocks, rules; inline bold, italic, `code`, links and
 * ~~strike~~. The parser is pure (JVM-tested); [GideonMarkdownText] draws it.
 */
object GideonMd {
    data class Span(val text: String, val bold: Boolean = false, val italic: Boolean = false, val code: Boolean = false,
                    val strike: Boolean = false, val url: String? = null)

    sealed interface Block {
        data class Heading(val level: Int, val spans: List<Span>) : Block
        data class Paragraph(val spans: List<Span>) : Block
        /** [ordered] numbers from [start]; each item is its own spans, [indent] its nesting level. */
        data class ListBlock(val ordered: Boolean, val start: Int, val items: List<Item>) : Block
        data class Quote(val spans: List<Span>) : Block
        data class Code(val text: String) : Block
        data object Rule : Block
    }

    data class Item(val spans: List<Span>, val indent: Int, val checked: Boolean? = null)

    private val HEADING = Regex("^(#{1,6})\\s+(.*?)\\s*#*\\s*$")
    private val BULLET = Regex("^(\\s*)[-*+]\\s+(.*)$")
    private val NUMBER = Regex("^(\\s*)(\\d{1,9})[.)]\\s+(.*)$")
    private val RULE = Regex("^\\s*([-*_])(\\s*\\1){2,}\\s*$")
    private val TASK = Regex("^\\[([ xX])]\\s+(.*)$")

    fun parse(md: String): List<Block> {
        val lines = md.replace("\r\n", "\n").split('\n')
        val out = mutableListOf<Block>()
        val para = mutableListOf<String>()
        fun flush() { if (para.isNotEmpty()) { out += Block.Paragraph(inline(para.joinToString("\n"))); para.clear() } }
        var i = 0
        while (i < lines.size) {
            val line = lines[i]
            val t = line.trim()
            when {
                t.startsWith("```") -> {
                    flush()
                    val code = mutableListOf<String>()
                    i++
                    while (i < lines.size && !lines[i].trim().startsWith("```")) { code += lines[i]; i++ }
                    out += Block.Code(code.joinToString("\n"))
                }
                t.isEmpty() -> flush()
                RULE.matches(line) -> { flush(); out += Block.Rule }
                HEADING.matches(t) -> { flush(); val m = HEADING.find(t)!!; out += Block.Heading(m.groupValues[1].length, inline(m.groupValues[2])) }
                t.startsWith(">") -> {
                    flush()
                    val q = mutableListOf<String>()
                    while (i < lines.size && lines[i].trim().startsWith(">")) { q += lines[i].trim().removePrefix(">").trimStart(); i++ }
                    out += Block.Quote(inline(q.joinToString("\n")))
                    continue
                }
                BULLET.matches(line) || NUMBER.matches(line) -> {
                    flush()
                    val ordered = NUMBER.matches(line) && !BULLET.matches(line)
                    val start = if (ordered) NUMBER.find(line)!!.groupValues[2].toIntOrNull() ?: 1 else 1
                    val items = mutableListOf<Item>()
                    while (i < lines.size) {
                        val l = lines[i]
                        val b = BULLET.find(l); val n = NUMBER.find(l)
                        // Bullets after numbers (or the other way round) start a list of their own.
                        if ((b != null || n != null) && items.isNotEmpty() && (n != null && b == null) != ordered) break
                        val (indent, body) = when {
                            b != null -> b.groupValues[1].length to b.groupValues[2]
                            n != null -> n.groupValues[1].length to n.groupValues[3]
                            // A wrapped continuation line belongs to the item above.
                            l.isNotBlank() && l.startsWith("  ") && items.isNotEmpty() -> {
                                val last = items.removeAt(items.lastIndex)
                                items += last.copy(spans = last.spans + Span(" ") + inline(l.trim())); i++; continue
                            }
                            else -> break
                        }
                        val task = TASK.find(body)
                        items += Item(inline(task?.groupValues?.get(2) ?: body), (indent / 2).coerceAtMost(4), task?.groupValues?.get(1)?.let { it != " " })
                        i++
                    }
                    out += Block.ListBlock(ordered, start, items)
                    continue
                }
                else -> para += t
            }
            i++
        }
        flush()
        return out
    }

    /** Inline marks: `code` first (nothing inside it is a mark), then links, **bold**, *italic* / _italic_, ~~strike~~. */
    fun inline(s: String): List<Span> {
        val out = mutableListOf<Span>()
        fun add(text: String, b: Boolean, it: Boolean, st: Boolean, url: String?) {
            if (text.isEmpty()) return
            val last = out.lastOrNull()
            if (last != null && !last.code && last.bold == b && last.italic == it && last.strike == st && last.url == url) out[out.lastIndex] = last.copy(text = last.text + text)
            else out += Span(text, b, it, false, st, url)
        }
        fun walk(text: String, b: Boolean, it: Boolean, st: Boolean, url: String?) {
            var k = 0
            val buf = StringBuilder()
            fun emit() { add(buf.toString(), b, it, st, url); buf.setLength(0) }
            while (k < text.length) {
                val c = text[k]
                if (c == '\\' && k + 1 < text.length && text[k + 1] in "\\`*_[]()~#>-+.!") { buf.append(text[k + 1]); k += 2; continue }
                if (c == '`') {
                    val end = text.indexOf('`', k + 1)
                    if (end > k) { emit(); out += Span(text.substring(k + 1, end), code = true, url = url); k = end + 1; continue }
                }
                if (c == '[' && url == null) {
                    val close = text.indexOf("](", k + 1)
                    val end = if (close > k) text.indexOf(')', close + 2) else -1
                    if (close > k && end > close) {
                        emit(); walk(text.substring(k + 1, close), b, it, st, text.substring(close + 2, end).trim()); k = end + 1; continue
                    }
                }
                if (text.startsWith("**", k) || text.startsWith("__", k)) {
                    val mark = text.substring(k, k + 2); val end = text.indexOf(mark, k + 2)
                    if (end > k + 2) { emit(); walk(text.substring(k + 2, end), true, it, st, url); k = end + 2; continue }
                }
                if (text.startsWith("~~", k)) {
                    val end = text.indexOf("~~", k + 2)
                    if (end > k + 2) { emit(); walk(text.substring(k + 2, end), b, it, true, url); k = end + 2; continue }
                }
                if ((c == '*' || c == '_') && k + 1 < text.length && !text[k + 1].isWhitespace()) {
                    // An underscore inside a word (snake_case) is not a mark.
                    val wordBefore = k > 0 && text[k - 1].isLetterOrDigit()
                    val end = text.indexOf(c, k + 1)
                    if (end > k + 1 && !text[end - 1].isWhitespace() && !(c == '_' && (wordBefore || (end + 1 < text.length && text[end + 1].isLetterOrDigit())))) {
                        emit(); walk(text.substring(k + 1, end), b, true, st, url); k = end + 1; continue
                    }
                }
                buf.append(c); k++
            }
            emit()
        }
        walk(s, false, false, false, null)
        return out
    }

    /** The answer as plain text (copy, share): marks dropped, list markers kept. */
    fun plain(blocks: List<Block>): String = blocks.joinToString("\n\n") { b ->
        when (b) {
            is Block.Heading -> b.spans.joinToString("") { it.text }
            is Block.Paragraph -> b.spans.joinToString("") { it.text }
            is Block.Quote -> b.spans.joinToString("") { it.text }
            is Block.Code -> b.text
            is Block.Rule -> "—"
            is Block.ListBlock -> b.items.mapIndexed { n, item -> "  ".repeat(item.indent) + (if (b.ordered) "${b.start + n}. " else "• ") + item.spans.joinToString("") { it.text } }.joinToString("\n")
        }
    }
}

@Composable
private fun annotated(spans: List<GideonMd.Span>, codeBg: Color, link: Color): AnnotatedString = buildAnnotatedString {
    spans.forEach { s ->
        val style = SpanStyle(
            fontWeight = if (s.bold) FontWeight.SemiBold else null,
            fontStyle = if (s.italic) FontStyle.Italic else null,
            fontFamily = if (s.code) FontFamily.Monospace else null,
            background = if (s.code) codeBg else Color.Unspecified,
            textDecoration = if (s.strike) TextDecoration.LineThrough else null,
        )
        if (s.url != null && (s.url.startsWith("http") || s.url.startsWith("/") || s.url.startsWith("mailto:"))) {
            val target = if (s.url.startsWith("/")) id.znetworks.nexus.core.net.NexusConfig.base + s.url else s.url
            withLink(LinkAnnotation.Url(target, TextLinkStyles(SpanStyle(color = link, textDecoration = TextDecoration.Underline)))) { withStyle(style) { append(s.text) } }
        } else withStyle(style) { append(s.text) }
    }
}

/** An answer drawn from its markdown (selectable by the caller's SelectionContainer). */
@Composable
fun GideonMarkdownText(markdown: String, color: Color, modifier: Modifier = Modifier) {
    val c = Nx.colors
    val blocks = remember(markdown) { GideonMd.parse(markdown) }
    val codeBg = c.muted
    Column(modifier, verticalArrangement = Arrangement.spacedBy(8.dp)) {
        blocks.forEach { b ->
            when (b) {
                is GideonMd.Block.Heading -> Text(annotated(b.spans, codeBg, c.violetText), color = color, fontWeight = FontWeight.SemiBold,
                    fontSize = when (b.level) { 1 -> 19.sp; 2 -> 17.sp; else -> 16.sp }, lineHeight = 24.sp)
                is GideonMd.Block.Paragraph -> Text(annotated(b.spans, codeBg, c.violetText), color = color, fontSize = 15.sp, lineHeight = 22.sp)
                is GideonMd.Block.Quote -> Row {
                    Box(Modifier.width(3.dp).height(20.dp).background(c.border))
                    Text(annotated(b.spans, codeBg, c.violetText), color = c.mutedFg, fontSize = 15.sp, lineHeight = 22.sp, modifier = Modifier.padding(start = 10.dp))
                }
                is GideonMd.Block.Code -> Box(Modifier.fillMaxWidth().background(c.muted, RoundedCornerShape(8.dp)).horizontalScroll(rememberScrollState()).padding(10.dp)) {
                    Text(b.text, fontFamily = FontFamily.Monospace, fontSize = 13.sp, color = color, lineHeight = 18.sp)
                }
                is GideonMd.Block.Rule -> Box(Modifier.fillMaxWidth().height(1.dp).background(c.border))
                is GideonMd.Block.ListBlock -> Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    b.items.forEachIndexed { n, item ->
                        Row(Modifier.padding(start = (item.indent * 16).dp)) {
                            val marker = when {
                                item.checked == true -> "☑"
                                item.checked == false -> "☐"
                                b.ordered -> "${b.start + n}."
                                else -> "•"
                            }
                            Text(marker, color = c.mutedFg, fontSize = 15.sp, lineHeight = 22.sp, modifier = Modifier.width(if (b.ordered) 26.dp else 16.dp))
                            Text(annotated(item.spans, codeBg, c.violetText), color = color, fontSize = 15.sp, lineHeight = 22.sp)
                        }
                    }
                }
            }
        }
    }
}
