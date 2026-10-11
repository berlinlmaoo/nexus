package id.znetworks.nexus.feature.projects

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Check
import androidx.compose.material3.Icon
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import id.znetworks.nexus.ui.components.RemoteImage

/**
 * A PROJECT's mark (Berlin, 11 Oct; PROJECT-ICON UPDATE 2, web 5af4601): one default for every project — a
 * coloured task tile, a white check on a blue gradient, the same on web and iOS — unless the project has an
 * uploaded photo. Emoji, named icons and the project colour are ignored on purpose. Folders keep [IconTile].
 */
object ProjectMarkLogic {
    val TOP = Color(0xFF3B82F6)
    val BOTTOM = Color(0xFF2563EB)
    /** Hairline inner border. */
    val EDGE = Color.Black.copy(alpha = 0.12f)
    const val RADIUS = 0.28f
    /** The check's share of the tile. */
    const val CHECK = 0.65f
    /** What "Remove photo" stores: the column's default, drawn as the default mark. */
    const val REMOVED = "folder"

    /** An uploaded photo: a `/api/files/…` path or an absolute URL. Anything else draws the default. */
    fun isPhoto(icon: String?) = icon?.trim()?.let { it.startsWith("/") || it.startsWith("http://") || it.startsWith("https://") } == true
}

/** The default tile fills [size]; a photo is cropped to the same rounded square. */
@Composable
fun ProjectMark(icon: String?, size: Dp, modifier: Modifier = Modifier) {
    val shape = RoundedCornerShape(size * ProjectMarkLogic.RADIUS)
    val tile: @Composable () -> Unit = {
        Box(Modifier.size(size).background(Brush.verticalGradient(listOf(ProjectMarkLogic.TOP, ProjectMarkLogic.BOTTOM)), shape)
            .border(0.5.dp, ProjectMarkLogic.EDGE, shape), contentAlignment = Alignment.Center) {
            Icon(Icons.Rounded.Check, null, tint = Color.White, modifier = Modifier.size(size * ProjectMarkLogic.CHECK))
        }
    }
    Box(modifier.size(size).clip(shape), contentAlignment = Alignment.Center) {
        if (ProjectMarkLogic.isPhoto(icon)) RemoteImage(icon!!.trim(), Modifier.size(size), maxPx = 200) { tile() }
        else tile()
    }
}
