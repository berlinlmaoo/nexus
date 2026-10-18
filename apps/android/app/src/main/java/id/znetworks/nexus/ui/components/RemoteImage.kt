package id.znetworks.nexus.ui.components

import android.graphics.BitmapFactory
import android.util.LruCache
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import id.znetworks.nexus.NexusApplication
import id.znetworks.nexus.ui.theme.Nx
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * Images from `/api/files/…` need the session, so they are fetched through the API client (never
 * an image library that would drop the cookie, API.md §1.1) and kept decoded in memory. The URL
 * carries its own cache-buster (`?t=` / `?v=`), so it is the key.
 */
object ImageMemory {
    private val cache = object : LruCache<String, ImageBitmap>(24 * 1024 * 1024) {
        override fun sizeOf(key: String, value: ImageBitmap) = value.width * value.height * 4
    }
    fun get(url: String): ImageBitmap? = cache.get(url)
    fun put(url: String, img: ImageBitmap) { cache.put(url, img) }
    fun clear() = cache.evictAll()
}

/** One picture: memory, then the offline copy (warmed by OfflineSync), then the network with the session, kept on disk after. Null on failure. */
object RemoteImages {
    suspend fun load(context: android.content.Context, url: String, maxPx: Int): androidx.compose.ui.graphics.ImageBitmap? {
        ImageMemory.get(url)?.let { return it }
        val api = (context.applicationContext as NexusApplication).container.api
        return withContext(Dispatchers.IO) {
            runCatching {
                val bytes = id.znetworks.nexus.core.offline.DiskFiles.existing(url)?.readBytes()
                    ?: api.bytes(url).also { b -> runCatching { id.znetworks.nexus.core.offline.DiskFiles.fileFor(url, "img")?.writeBytes(b) } }
                val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
                BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
                var sample = 1
                while (maxOf(bounds.outWidth, bounds.outHeight) / (sample * 2) >= maxPx) sample *= 2
                BitmapFactory.decodeByteArray(bytes, 0, bytes.size, BitmapFactory.Options().apply { inSampleSize = sample })?.asImageBitmap()
            }.getOrNull()
        }?.also { ImageMemory.put(url, it) }
    }
}

@Composable
fun RemoteImage(url: String?, modifier: Modifier, contentScale: ContentScale = ContentScale.Crop, maxPx: Int = 512, placeholder: @Composable () -> Unit = {}) {
    val context = LocalContext.current
    var img by remember(url) { mutableStateOf(url?.let(ImageMemory::get)) }
    LaunchedEffect(url) {
        if (url == null || img != null) return@LaunchedEffect
        img = RemoteImages.load(context, url, maxPx)
    }
    val i = img
    if (i != null) Image(i, null, modifier, contentScale = contentScale) else Box(modifier) { placeholder() }
}

/** A person: their photo, or their initial on a colour derived from the name (stable across launches). */
@Composable
fun Avatar(name: String?, url: String?, size: Dp = 28.dp, ring: Boolean = false, initials: String? = null, userId: String? = null) {
    val c = Nx.colors
    val initial = initials ?: name?.trim()?.firstOrNull()?.uppercaseChar()?.toString() ?: "?"
    val palette = listOf(Color(0xFF7B68EE), Color(0xFF0091FF), Color(0xFF10B981), Color(0xFFF59E0B), Color(0xFFEF4444), Color(0xFFEC4899))
    val tint = palette[((name ?: "").fold(0) { a, ch -> (a * 31 + ch.code) and 0xFFFF }) % palette.size]
    val mod = Modifier.size(size).clip(CircleShape).then(if (ring) Modifier.border(1.5.dp, c.card, CircleShape) else Modifier)
    id.znetworks.nexus.feature.presence.PresenceAvatar(userId, name, size) { RemoteImage(url, mod, maxPx = 160) {
        Box(Modifier.size(size).background(tint, CircleShape), contentAlignment = Alignment.Center) {
            Text(initial, color = Color.White, fontWeight = FontWeight.Bold, fontSize = (size.value * 0.42f).sp)
        }
    } }
}

/** Up to [max] photos overlapping by 6dp with a card-coloured ring (AVATARS-PRIORITY), "+N" for the rest. */
@Composable
fun AvatarStack(people: List<Pair<String?, String?>>, size: Dp = 24.dp, max: Int = 3, userIds: List<String?> = emptyList()) {
    Row {
        people.take(max).forEachIndexed { i, (name, url) ->
            Box(Modifier.offset(x = (-6 * i).dp)) { Avatar(name, url, size, ring = true, userId = userIds.getOrNull(i)) }
        }
        if (people.size > max) {
            Box(Modifier.offset(x = (-6 * max).dp).size(size).background(Nx.colors.muted, CircleShape), contentAlignment = Alignment.Center) {
                Text("+${people.size - max}", fontSize = (size.value * 0.38f).sp, color = Nx.colors.mutedFg, fontWeight = FontWeight.Bold)
            }
        }
    }
}
