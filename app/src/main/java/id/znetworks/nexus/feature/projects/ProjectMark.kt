package id.znetworks.nexus.feature.projects

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import id.znetworks.nexus.ui.components.RemoteImage
import id.znetworks.nexus.ui.theme.Nx

/**
 * A PROJECT's mark (Berlin, 11 Oct; PROJECT-ICON, web 22dda1a): one default for every project — a small
 * rounded square in the project's colour, 0.6 of the slot — unless the project has an uploaded photo.
 * Emoji and named icons stored by older screens are ignored on purpose. Folders keep [IconTile].
 */
object ProjectMarkLogic {
    const val FALLBACK = "#7B2FBE"
    const val SCALE = 0.6f
    const val RADIUS = 0.28f
    /** What "Remove photo" stores: the column's default, drawn as the default mark. */
    const val REMOVED = "folder"

    /** An uploaded photo: a `/api/files/…` path or an absolute URL. Anything else draws the default. */
    fun isPhoto(icon: String?) = icon?.trim()?.let { it.startsWith("/") || it.startsWith("http://") || it.startsWith("https://") } == true

    fun color(hex: String?): Color = parseColor(hex?.takeIf { it.isNotBlank() } ?: FALLBACK, parseColor(FALLBACK, Color.Magenta))
}

/** [tile]: the muted rounded slot behind it (cards, headers, rows); false for an inline mark beside text. */
@Composable
fun ProjectMark(icon: String?, color: String?, size: Dp, modifier: Modifier = Modifier, tile: Boolean = true) {
    val slot = RoundedCornerShape(size * if (tile) 0.32f else ProjectMarkLogic.RADIUS)
    val base = modifier.size(size).clip(slot).then(if (tile) Modifier.background(Nx.colors.muted) else Modifier)
    val square: @Composable () -> Unit = {
        val side = size * ProjectMarkLogic.SCALE
        Box(Modifier.size(side).background(ProjectMarkLogic.color(color), RoundedCornerShape(side * ProjectMarkLogic.RADIUS)))
    }
    Box(base, contentAlignment = Alignment.Center) {
        if (ProjectMarkLogic.isPhoto(icon)) RemoteImage(icon!!.trim(), Modifier.size(size), maxPx = 200) { Box(Modifier.size(size), contentAlignment = Alignment.Center) { square() } }
        else square()
    }
}
