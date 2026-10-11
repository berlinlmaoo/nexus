package id.znetworks.nexus.feature.projects

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Checklist
import androidx.compose.material3.Icon
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.Dp
import id.znetworks.nexus.ui.components.RemoteImage
import id.znetworks.nexus.ui.theme.Nx

/**
 * A PROJECT's mark (Berlin, 11 Oct; PROJECT-ICON UPDATE, web 84cf62d): one default for every project — the
 * task icon (the same as the Tasks tab / My Mission), muted — unless the project has an uploaded photo.
 * Emoji, named icons and the project colour are ignored on purpose. Folders keep [IconTile].
 */
object ProjectMarkLogic {
    /** The Tasks tab's icon (SignedInShell Tab.TASKS). */
    val DEFAULT: ImageVector get() = Icons.Filled.Checklist
    /** The icon's share of a tile; an inline mark fills its slot. */
    const val SCALE = 0.6f
    /** What "Remove photo" stores: the column's default, drawn as the default mark. */
    const val REMOVED = "folder"

    /** An uploaded photo: a `/api/files/…` path or an absolute URL. Anything else draws the default. */
    fun isPhoto(icon: String?) = icon?.trim()?.let { it.startsWith("/") || it.startsWith("http://") || it.startsWith("https://") } == true
}

/** [tile]: the muted rounded slot behind it (cards, headers, rows); false for an inline mark beside text. */
@Composable
fun ProjectMark(icon: String?, size: Dp, modifier: Modifier = Modifier, tile: Boolean = true) {
    val c = Nx.colors
    val slot = RoundedCornerShape(size * 0.32f)
    val base = modifier.size(size).clip(slot).then(if (tile) Modifier.background(c.muted) else Modifier)
    val mark: @Composable () -> Unit = {
        Icon(ProjectMarkLogic.DEFAULT, null, tint = c.mutedFg, modifier = Modifier.size(if (tile) size * ProjectMarkLogic.SCALE else size))
    }
    Box(base, contentAlignment = Alignment.Center) {
        if (ProjectMarkLogic.isPhoto(icon)) RemoteImage(icon!!.trim(), Modifier.size(size), maxPx = 200) { Box(Modifier.size(size), contentAlignment = Alignment.Center) { mark() } }
        else mark()
    }
}
