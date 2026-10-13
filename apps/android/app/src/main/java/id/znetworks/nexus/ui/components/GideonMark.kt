package id.znetworks.nexus.ui.components

import androidx.compose.foundation.layout.size
import androidx.compose.material3.Icon
import androidx.compose.material3.LocalContentColor
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.painter.Painter
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import id.znetworks.nexus.R

/**
 * The GIDEON mark (owner, 14 Oct 2026: never a generic sparkle). The web's /gideon-mark.png drawn as a tinted shape,
 * like the web's CSS mask and the iOS template image, so it takes the text colour and follows the theme.
 */
@Composable
fun gideonPainter(): Painter = painterResource(R.drawable.gideon_mark)

@Composable
fun GideonMark(size: Dp = 20.dp, tint: Color = LocalContentColor.current, contentDescription: String? = null, modifier: Modifier = Modifier) =
    Icon(gideonPainter(), contentDescription, modifier.size(size), tint = tint)
