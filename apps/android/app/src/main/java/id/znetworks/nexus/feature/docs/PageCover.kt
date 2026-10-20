package id.znetworks.nexus.feature.docs

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import id.znetworks.nexus.ui.components.RemoteImage

internal val PageGradients = mapOf(
    "dusk" to listOf(0xff7b68ee, 0xffc86dd7, 0xfff3a683),
    "sea" to listOf(0xff2193b0, 0xff6dd5ed),
    "forest" to listOf(0xff134e5e, 0xff71b280),
    "sand" to listOf(0xffe6dada, 0xffc9b8a8, 0xffa38f7a),
    "ember" to listOf(0xfff12711, 0xfff5af19),
    "ink" to listOf(0xff232526, 0xff414345),
    "mint" to listOf(0xffd4fc79, 0xff96e6a1),
    "night" to listOf(0xff0f2027, 0xff203a43, 0xff2c5364),
)
@Composable internal fun PageCover(cover: String?) {
    if (cover.isNullOrBlank()) return
    val modifier = Modifier.fillMaxWidth().height(150.dp)
    if (cover.startsWith("gradient:")) {
        PageGradients[cover.removePrefix("gradient:")]?.let { colors -> Box(modifier.background(Brush.linearGradient(colors.map { Color(it) }))) }
    } else if (cover.startsWith("https://") || cover.startsWith("/")) RemoteImage(cover, modifier, maxPx = 1080)
}
