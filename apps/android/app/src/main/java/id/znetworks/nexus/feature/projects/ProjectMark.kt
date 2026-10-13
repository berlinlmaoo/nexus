package id.znetworks.nexus.feature.projects

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.unit.Dp
import id.znetworks.nexus.ui.components.RemoteImage

/**
 * A PROJECT's mark (Berlin, 11 Oct; PROJECT-ICON UPDATE 3, web 1cd2149): one default for every project — a
 * full-colour task icon (amber clipboard, white sheet, slate clip, green ticks) with no tile behind it —
 * unless the project has an uploaded photo. Emoji, named icons and the project colour are ignored on purpose.
 * Web, iOS and Android draw the same shapes on a 24×24 grid. Folders keep [IconTile].
 */
object ProjectMarkLogic {
    /** One rounded rectangle on the 24×24 grid: x, y, width, height, corner radius, colour. */
    data class Shape(val x: Float, val y: Float, val w: Float, val h: Float, val r: Float, val color: Long)

    const val GRID = 24f
    const val TICK = 0xFFFFFFFF
    const val TICK_WIDTH = 0.9f

    /** In drawing order (UPDATE 3, items 1–6). */
    val SHAPES = listOf(
        Shape(3f, 3f, 18f, 20f, 3.5f, 0xFFF59E0B),     // board
        Shape(5.5f, 5.5f, 13f, 15.5f, 1.8f, 0xFFFFFFFF), // sheet
        Shape(8.5f, 1.5f, 7f, 4f, 1.4f, 0xFF475569),    // clip
        Shape(7.2f, 8.2f, 3.4f, 3.4f, 0.8f, 0xFF22C55E), // row 1: done
        Shape(11.8f, 9.2f, 5.2f, 1.4f, 0.7f, 0xFFCBD5E1),
        Shape(7.2f, 12.6f, 3.4f, 3.4f, 0.8f, 0xFF22C55E), // row 2: done
        Shape(11.8f, 13.6f, 5.2f, 1.4f, 0.7f, 0xFFCBD5E1),
        Shape(7.2f, 17f, 3.4f, 3.4f, 0.8f, 0xFFE2E8F0),  // row 3: open
        Shape(11.8f, 18f, 3.6f, 1.4f, 0.7f, 0xFFCBD5E1),
    )

    /** The ticks' start points (M7.9 9.9 / M7.9 14.3), each then l0.9 0.9 l1.4 -1.6. */
    val TICKS = listOf(7.9f to 9.9f, 7.9f to 14.3f)

    /** What "Remove photo" stores: the column's default, drawn as the default mark. */
    const val REMOVED = "folder"
    /** A photo's crop. */
    const val PHOTO_RADIUS = 0.28f

    /** An uploaded photo: a `/api/files/…` path or an absolute URL. Anything else draws the default. */
    fun isPhoto(icon: String?) = icon?.trim()?.let { it.startsWith("/") || it.startsWith("http://") || it.startsWith("https://") } == true
}

private fun DrawScope.taskIcon() {
    val k = size.minDimension / ProjectMarkLogic.GRID
    ProjectMarkLogic.SHAPES.forEach { s ->
        drawRoundRect(Color(s.color), Offset(s.x * k, s.y * k), Size(s.w * k, s.h * k), CornerRadius(s.r * k))
    }
    ProjectMarkLogic.TICKS.forEach { (x, y) ->
        val p = Path().apply { moveTo(x * k, y * k); relativeLineTo(0.9f * k, 0.9f * k); relativeLineTo(1.4f * k, -1.6f * k) }
        drawPath(p, Color(ProjectMarkLogic.TICK), style = Stroke(ProjectMarkLogic.TICK_WIDTH * k, cap = StrokeCap.Round, join = StrokeJoin.Round))
    }
}

/** The default icon fills [size] with no background; a photo is cropped to a rounded square. */
@Composable
fun ProjectMark(icon: String?, size: Dp, modifier: Modifier = Modifier) {
    val default: @Composable () -> Unit = { Canvas(Modifier.size(size)) { taskIcon() } }
    if (ProjectMarkLogic.isPhoto(icon)) {
        Box(modifier.size(size).clip(RoundedCornerShape(size * ProjectMarkLogic.PHOTO_RADIUS)), contentAlignment = Alignment.Center) {
            RemoteImage(icon!!.trim(), Modifier.size(size), maxPx = 200) { default() }
        }
    } else Box(modifier.size(size), contentAlignment = Alignment.Center) { default() }
}
