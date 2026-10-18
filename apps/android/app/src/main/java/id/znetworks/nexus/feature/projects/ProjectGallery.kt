package id.znetworks.nexus.feature.projects

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.HideImage
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import id.znetworks.nexus.NexusApplication
import id.znetworks.nexus.R
import id.znetworks.nexus.ui.components.RemoteImage
import id.znetworks.nexus.ui.theme.Nx
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonPrimitive

@Serializable private data class TaskCover(val url: String? = null)
@Serializable private data class TaskCovers(val covers: Map<String, TaskCover> = emptyMap())

/** Same cover endpoint and image/no-cover setting as the approved web Gallery. */
@Composable
fun GalleryView(tasks: List<BoardTask>, props: PropCtx, projectId: String, config: JsonObject?, onOpen: (String) -> Unit) {
    val c = Nx.colors
    val api = (LocalContext.current.applicationContext as NexusApplication).container.api
    val showCover = config?.get("cardCover")?.jsonPrimitive?.content != "none"
    val size = config?.get("cardSize")?.jsonPrimitive?.content
    var covers by remember(projectId) { mutableStateOf<Map<String, TaskCover>>(emptyMap()) }
    LaunchedEffect(projectId, showCover) {
        if (showCover) covers = runCatching { api.get("/api/projects/$projectId/task-covers", TaskCovers.serializer()).covers }.getOrDefault(emptyMap())
    }
    LazyVerticalGrid(columns = GridCells.Adaptive(when(size) { "small" -> 200.dp; "large" -> 320.dp; else -> 260.dp }),
        contentPadding = PaddingValues(16.dp), horizontalArrangement = Arrangement.spacedBy(16.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
        items(tasks, key = { it.id }) { task ->
            Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(c.card).border(1.dp, c.border, RoundedCornerShape(12.dp)).clickable { onOpen(task.id) }) {
                if (showCover) Box(Modifier.fillMaxWidth().aspectRatio(if(size == "small") 16f/9f else 2f).background(c.muted), contentAlignment = Alignment.Center) {
                    val url = covers[task.id]?.url
                    if (url != null) RemoteImage(url, Modifier.fillMaxSize(), ContentScale.Crop)
                    else Icon(Icons.Outlined.HideImage, stringResource(R.string.gallery_no_image), tint = c.mutedFg, modifier = Modifier.size(20.dp))
                }
                Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(task.title, fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = c.foreground, maxLines = 2)
                    PropLine(props.items(task))
                }
            }
        }
    }
}
