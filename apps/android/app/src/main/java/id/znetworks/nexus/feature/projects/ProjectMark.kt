package id.znetworks.nexus.feature.projects

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.scale
import androidx.compose.ui.unit.Dp
import id.znetworks.nexus.ui.components.RemoteImage

/**
 * A PROJECT's mark (owner, 14 Oct 2026 — option A; web 51e97534, iOS 3b8a2748): the project's uploaded photo, else one
 * default for every project — a grey Notion-style page outline (no fill, no tile) on a 24×24 grid. Emoji, named icons
 * and the project colour are ignored on purpose. Folders keep [IconTile].
 */
object ProjectMarkLogic {
    const val GRID = 24f
    /** The page outline, its folded corner and two text lines (SVG path data on the 24×24 grid). */
    val PATHS = listOf(
        "M6 3h8l4 4v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z",
        "M14 3v4h4",
        "M8.5 12h7M8.5 15.5h5",
    )
    const val STROKE = 1.6f
    const val LIGHT = 0xFF91918E
    const val DARK = 0xFF9B9A97

/** What "Remove photo" stores: the column's default, drawn as the default mark. */
    const val REMOVED = "folder"
    /** A photo's crop. */
    const val PHOTO_RADIUS = 0.28f

    /** An uploaded photo: a `/api/files/…` path or an absolute URL. Anything else draws the default. */
    fun isPhoto(icon: String?) = icon?.trim()?.let { it.startsWith("/") || it.startsWith("http://") || it.startsWith("https://") } == true
}

private val pagePaths by lazy { ProjectMarkLogic.PATHS.map { androidx.compose.ui.graphics.vector.PathParser().parsePathString(it).toPath() } }

private fun DrawScope.pageIcon(color: Color) {
    val k = size.minDimension / ProjectMarkLogic.GRID
    scale(k, pivot = Offset.Zero) {
        pagePaths.forEach { drawPath(it, color, style = Stroke(ProjectMarkLogic.STROKE, cap = StrokeCap.Round, join = StrokeJoin.Round)) }
    }
}

/** The default icon fills [size] with no background; a photo is cropped to a rounded square. */
@Composable
fun ProjectMark(icon: String?, size: Dp, modifier: Modifier = Modifier, projectId: String? = null) {
    // One icon store (ProjectIcons): a mark that knows its project follows a photo change live, everywhere.
    val stored = projectId?.let { id -> ProjectIcons.icons.collectAsState().value.let { m -> if (m.containsKey(id)) m[id] else icon } }
    ProjectMarkFor(if (projectId != null) stored else icon, size, modifier)
}

@Composable
private fun ProjectMarkFor(icon: String?, size: Dp, modifier: Modifier) {
    val dark = id.znetworks.nexus.ui.theme.Nx.isDark
    val tone = Color(if (dark) ProjectMarkLogic.DARK else ProjectMarkLogic.LIGHT)
    val default: @Composable () -> Unit = { Canvas(Modifier.size(size)) { pageIcon(tone) } }
    if (ProjectMarkLogic.isPhoto(icon)) {
        Box(modifier.size(size).clip(RoundedCornerShape(size * ProjectMarkLogic.PHOTO_RADIUS)), contentAlignment = Alignment.Center) {
            RemoteImage(icon!!.trim(), Modifier.size(size), maxPx = 200) { default() }
        }
    } else Box(modifier.size(size), contentAlignment = Alignment.Center) { default() }
}
