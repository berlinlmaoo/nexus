package id.znetworks.nexus.feature.projects

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import id.znetworks.nexus.R
import id.znetworks.nexus.ui.theme.Nx

/**
 * New project's tab picker as preview cards (PROJECT-SETUP-MEMBERS UPDATE, web 71a22a7 TabPreviewCards.tsx):
 * each tab is a card with a small drawing of the view, its name with a check circle, and one line on what it is.
 * Off = dimmed and the drawing loses its accent. Board or List stays on. Drawn with plain shapes, no images.
 */
object TabPreviewLogic {
    fun description(key: String): Int? = when (key) {
        "overview" -> R.string.tp_overview; "board" -> R.string.tp_board; "list" -> R.string.tp_list; "table" -> R.string.tp_table
        "sheet" -> R.string.tp_sheet; "calendar" -> R.string.tp_calendar; "timeline" -> R.string.tp_timeline
        "automations" -> R.string.tp_automations; "pages" -> R.string.tp_pages; "forms" -> R.string.tp_forms; "chat" -> R.string.tp_chat
        else -> null
    }

    /** 2 columns on a phone, 3 from 600dp. */
    fun columns(widthDp: Int) = if (widthDp >= 600) 3 else 2
}

@Composable
fun TabPreviewCards(hidden: Set<String>, enabled: Boolean, onChange: (Set<String>) -> Unit) {
    val cols = TabPreviewLogic.columns(LocalConfiguration.current.screenWidthDp)
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        ProjectSetupLogic.TABS.chunked(cols).forEach { row ->
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                row.forEach { t ->
                    val key = ProjectTabsLogic.key(t)!!
                    TabCard(t, key, on = key !in hidden, locked = ProjectTabsLogic.locked(key, hidden), enabled = enabled, modifier = Modifier.weight(1f)) {
                        onChange(if (key in hidden) hidden - key else hidden + key)
                    }
                }
                repeat(cols - row.size) { Spacer(Modifier.weight(1f)) }
            }
        }
    }
}

@Composable
private fun TabCard(t: ProjectTab, key: String, on: Boolean, locked: Boolean, enabled: Boolean, modifier: Modifier, onToggle: () -> Unit) {
    val c = Nx.colors
    val shape = RoundedCornerShape(16.dp)
    val name = stringResource(t.label)
    val state = stringResource(if (on) R.string.tp_on else R.string.tp_off)
    Column(
        modifier.clip(shape).background(if (on) c.violet.copy(alpha = 0.05f) else c.background)
            .border(1.dp, if (on) c.violet.copy(alpha = 0.5f) else c.border, shape)
            .clickable(enabled = enabled && !locked, role = Role.Checkbox, onClick = onToggle)
            .semantics { contentDescription = name; stateDescription = state }
            .alpha(if (on) 1f else 0.6f).padding(8.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Box(Modifier.fillMaxWidth().height(56.dp).clip(RoundedCornerShape(12.dp)).background(c.muted.copy(alpha = 0.6f)).padding(8.dp)) {
            // Off: the accent goes grey, the web's grayscale.
            val accent = if (on) c.violet else c.mutedFg
            Canvas(Modifier.fillMaxSize()) { thumb(key, c.foreground, c.background, accent) }
        }
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(name, fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = c.foreground, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
            Box(Modifier.size(16.dp).clip(CircleShape).then(if (on) Modifier.background(c.violet) else Modifier.border(1.dp, c.border, CircleShape)),
                contentAlignment = Alignment.Center) {
                if (on) Icon(Icons.Filled.Check, null, Modifier.size(11.dp), tint = Color.White)
            }
        }
        TabPreviewLogic.description(key)?.let {
            Text(stringResource(it), fontSize = 11.sp, lineHeight = 14.sp, color = c.mutedFg, maxLines = 2, overflow = TextOverflow.Ellipsis)
        }
        if (locked) Text(stringResource(R.string.setup_err_view), fontSize = 10.sp, color = c.mutedFg, maxLines = 1)
    }
}

/** The drawings (web Thumb): plain blocks in theme colours; [accent] is the one highlighted part. */
private fun DrawScope.thumb(key: String, fg: Color, bg: Color, accent: Color) {
    val w = size.width; val h = size.height
    val r = 3.dp.toPx(); val line = 1.dp.toPx()
    val soft = fg.copy(alpha = 0.15f); val faint = fg.copy(alpha = 0.07f); val edge = fg.copy(alpha = 0.10f)
    val hit = accent.copy(alpha = 0.7f)
    fun rect(x: Float, y: Float, rw: Float, rh: Float, col: Color, rad: Float = r) = drawRoundRect(col, Offset(x, y), Size(rw, rh), CornerRadius(rad))
    fun box(x: Float, y: Float, rw: Float, rh: Float, ring: Color = edge) { rect(x, y, rw, rh, bg); drawRoundRect(ring, Offset(x, y), Size(rw, rh), CornerRadius(r), style = Stroke(line)) }
    fun bar(x: Float, y: Float, bw: Float, bh: Float = 4.dp.toPx(), col: Color = soft) = rect(x, y, bw, bh, col, bh / 2)
    val gap = 4.dp.toPx()
    when (key) {
        "overview" -> {
            val bw = (w - 2 * gap) / 3; val top = 16.dp.toPx()
            repeat(3) { box(it * (bw + gap), 0f, bw, top) }
            val area = h - top - 6.dp.toPx(); val cw = (w - 4 * gap - 4f) / 5
            listOf(0.4f, 0.7f, 0.55f, 0.9f, 0.65f).forEachIndexed { i, p ->
                rect(2f + i * (cw + gap), h - area * p, cw, area * p, if (i == 3) hit else soft, 2f)
            }
        }
        "board" -> {
            val cw = (w - 2 * gap) / 3; val card = 10.dp.toPx(); val pad = 2.dp.toPx()
            listOf(3, 2, 1).forEachIndexed { col, n ->
                val x = col * (cw + gap)
                rect(x, 0f, cw, h, fg.copy(alpha = 0.05f))
                repeat(n) { i -> box(x + pad, pad + i * (card + gap), cw - 2 * pad, card, if (col == 1 && i == 0) accent.copy(alpha = 0.6f) else edge) }
            }
        }
        "list" -> {
            val rowH = h / 4; val dot = 8.dp.toPx()
            repeat(4) { i ->
                val cy = rowH * i + rowH / 2
                if (i < 2) drawCircle(hit, dot / 2, Offset(dot / 2, cy)) else drawCircle(fg.copy(alpha = 0.25f), dot / 2 - line / 2, Offset(dot / 2, cy), style = Stroke(line))
                bar(dot + 6.dp.toPx(), cy - 2.dp.toPx(), (w - dot - 6.dp.toPx()) * if (i % 2 == 1) 0.6f else 0.8f)
            }
        }
        "table", "sheet" -> {
            val cols = if (key == "table") 4 else 6; val rows = if (key == "table") 4 else 5
            val cw = w / cols; val rh = h / rows
            for (y in 0 until rows) for (x in 0 until cols) {
                val i = y * cols + x
                val head = if (key == "table") y == 0 else y == 0 || x == 0
                val col = when { head -> edge; key == "sheet" && i == 14 -> accent.copy(alpha = 0.25f); else -> bg }
                drawRect(col, Offset(x * cw, y * rh), Size(cw, rh))
                drawRect(edge, Offset(x * cw, y * rh), Size(cw, rh), style = Stroke(line))
                if (key == "sheet" && i == 14) drawRect(accent, Offset(x * cw, y * rh), Size(cw, rh), style = Stroke(line))
            }
        }
        "calendar" -> {
            val g = 2.dp.toPx(); val cw = (w - 6 * g) / 7; val rh = (h - 3 * g) / 4
            repeat(28) { i ->
                val col = when (i) { 9, 10 -> hit; 3, 18, 23 -> accent.copy(alpha = 0.35f); else -> faint }
                rect((i % 7) * (cw + g), (i / 7) * (rh + g), cw, rh, col, 2f)
            }
        }
        "timeline" -> {
            val bh = 8.dp.toPx(); val step = h / 4
            listOf(0f to 0.45f, 0.2f to 0.4f, 0.45f to 0.35f, 0.6f to 0.3f).forEachIndexed { i, (l, bw) ->
                bar(w * l, step * i + (step - bh) / 2, w * bw, bh, if (i == 1) hit else fg.copy(alpha = 0.2f))
            }
        }
        "automations" -> {
            val bw = 28.dp.toPx(); val bh = 20.dp.toPx(); val d = 20.dp.toPx(); val link = 12.dp.toPx()
            val total = bw * 2 + d + link * 2 + gap * 4; var x = (w - total) / 2; val cy = h / 2
            box(x, cy - bh / 2, bw, bh); x += bw + gap
            drawLine(fg.copy(alpha = 0.3f), Offset(x, cy), Offset(x + link, cy), line); x += link + gap
            val dc = Offset(x + d / 2, cy)
            rotate(45f, dc) { rect(dc.x - d / 2 * 0.72f, dc.y - d / 2 * 0.72f, d * 0.72f, d * 0.72f, hit) }
            x += d + gap
            drawLine(fg.copy(alpha = 0.3f), Offset(x, cy), Offset(x + link, cy), line); x += link + gap
            box(x, cy - bh / 2, bw, bh)
        }
        "pages" -> {
            val pw = w * 0.8f; val x = (w - pw) / 2; val p = 6.dp.toPx()
            box(x, 0f, pw, h)
            val iw = pw - 2 * p
            bar(x + p, p, iw * 0.5f, 6.dp.toPx(), fg.copy(alpha = 0.4f))
            listOf(1f, 5f / 6, 2f / 3).forEachIndexed { i, f -> bar(x + p, p + 10.dp.toPx() + i * 7.dp.toPx(), iw * f) }
        }
        "forms" -> {
            val fw = w * 0.8f; val x = (w - fw) / 2; val ih = 10.dp.toPx(); val lh = 4.dp.toPx(); val g = 3.dp.toPx()
            var y = (h - (2 * (lh + g + ih + g) + ih)) / 2
            listOf(1f / 3, 1f / 4).forEach { f -> bar(x, y, fw * f, lh); y += lh + g; box(x, y, fw, ih); y += ih + g }
            bar(x + fw * 2 / 3, y, fw / 3, ih, hit)
        }
        "chat" -> {
            val bh = 10.dp.toPx(); val g = 4.dp.toPx(); var y = (h - 3 * bh - 2 * g) / 2
            bar(0f, y, w * 0.6f, bh); y += bh + g
            bar(w * 0.5f, y, w * 0.5f, bh, hit); y += bh + g
            bar(0f, y, w * 0.4f, bh)
        }
    }
}
