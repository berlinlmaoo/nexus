package id.znetworks.nexus.feature.chat

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.BrokenImage
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import id.znetworks.nexus.R
import id.znetworks.nexus.ui.components.ImageMemory
import id.znetworks.nexus.ui.components.RemoteImages
import id.znetworks.nexus.ui.theme.Nx
import kotlinx.coroutines.delay

/**
 * A chat picture that is never an empty box (iOS ChatPhoto, 8 Oct: a reply bubble showed a blank slab where
 * the picture failed once). Loading shows a spinner, one quiet retry happens on its own, and after that the
 * tile says so and a tap tries again. [ink] is the colour drawn over the bubble.
 */
@Composable
fun ChatPhoto(url: String?, modifier: Modifier, contentScale: ContentScale = ContentScale.Crop, maxPx: Int = 900, ink: Color = Nx.colors.mutedFg,
              onOpen: (() -> Unit)? = null) {
    val context = LocalContext.current
    var img by remember(url) { mutableStateOf<ImageBitmap?>(url?.let(ImageMemory::get)) }
    var failed by remember(url) { mutableStateOf(false) }
    var attempt by remember(url) { mutableIntStateOf(0) }
    LaunchedEffect(url, attempt) {
        if (url == null || img != null) return@LaunchedEffect
        failed = false
        img = RemoteImages.load(context, url, maxPx)
        if (img == null && attempt == 0) { delay(1_500); img = RemoteImages.load(context, url, maxPx) } // one quiet retry
        failed = img == null
    }
    val i = img
    if (i != null) Image(i, null, modifier.then(if (onOpen != null) Modifier.clickable(onClick = onOpen) else Modifier), contentScale = contentScale)
    else {
        val retry = stringResource(R.string.ci_photo_failed)
        Box(modifier.background(Nx.colors.muted).then(if (failed) Modifier.clickable { attempt++ }.semantics { contentDescription = retry } else Modifier),
            contentAlignment = Alignment.Center) {
            if (!failed) CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp, color = ink)
            else Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(4.dp), modifier = Modifier.padding(8.dp)) {
                Icon(Icons.Filled.BrokenImage, null, tint = ink)
                Text(retry, fontSize = 11.sp, color = ink, textAlign = TextAlign.Center)
            }
        }
    }
}
