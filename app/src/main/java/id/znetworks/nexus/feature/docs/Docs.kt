package id.znetworks.nexus.feature.docs

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.MenuBook
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import id.znetworks.nexus.NexusApplication
import id.znetworks.nexus.R
import id.znetworks.nexus.core.net.ApiClient
import id.znetworks.nexus.core.net.ApiError
import id.znetworks.nexus.feature.chat.chatTime
import id.znetworks.nexus.feature.projects.TabEmpty
import id.znetworks.nexus.feature.tasks.blockText
import id.znetworks.nexus.ui.components.EmptyState
import id.znetworks.nexus.ui.components.describe
import id.znetworks.nexus.ui.theme.DisplayFont
import id.znetworks.nexus.ui.theme.Nx
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull

// API.md §2.4 docs: the Knowledge Library (read-only on the phones, as iOS).

@Serializable data class DocProject(val id: String? = null, val name: String? = null)

@Serializable
data class Doc(
    val id: String,
    val title: String = "",
    val content: JsonElement? = null,
    val contentText: String? = null,
    val icon: String? = null,
    val updatedAt: String? = null,
    val project: DocProject? = null,
) {
    val emoji: String get() = icon?.takeIf { it.isNotBlank() && !it.startsWith("/") } ?: "📄"
}

@Serializable data class DocsResponse(val docs: List<Doc> = emptyList())
@Serializable data class DocResponse(val doc: Doc)

/** One block to draw: a BlockNote block's type and its flattened text. */
data class DocBlock(val type: String, val text: String, val level: Int = 1, val checked: Boolean? = null)

object DocBlocks {
    /** BlockNote JSON (array of blocks with children) → a flat list, children indented as bullets. */
    fun from(content: JsonElement?): List<DocBlock> {
        val out = mutableListOf<DocBlock>()
        fun walk(e: JsonElement?) {
            when (e) {
                is JsonArray -> e.forEach(::walk)
                is JsonObject -> {
                    val type = (e["type"] as? JsonPrimitive)?.contentOrNull ?: "paragraph"
                    val props = e["props"] as? JsonObject
                    val own = blockText(JsonObject(e.filterKeys { it != "children" }))
                    if (own.isNotBlank() || type == "paragraph") out += DocBlock(type, own,
                        (props?.get("level") as? JsonPrimitive)?.intOrNull ?: 1, (props?.get("checked") as? JsonPrimitive)?.contentOrNull?.toBooleanStrictOrNull())
                    walk(e["children"])
                }
                is JsonPrimitive -> e.contentOrNull?.split("\n")?.forEach { out += DocBlock("paragraph", it) }
                else -> Unit
            }
        }
        walk(content)
        // Collapse runs of empty paragraphs.
        return out.filterIndexed { i, b -> !(b.type == "paragraph" && b.text.isBlank() && (i == 0 || out[i - 1].text.isBlank())) }
    }
}

class DocsApi(private val api: ApiClient) {
    suspend fun all(projectId: String? = null) =
        if (projectId == null) api.getCached("/api/docs", "docs", DocsResponse.serializer()).value.docs
        else api.get("/api/docs?projectId=$projectId", DocsResponse.serializer()).docs
    suspend fun one(id: String) = api.get("/api/docs/$id", DocResponse.serializer()).doc
}

@Composable
private fun docsApi(): DocsApi {
    val c = (LocalContext.current.applicationContext as NexusApplication).container
    return remember { DocsApi(c.api) }
}

@Composable
private fun DocCard(d: Doc, onOpen: () -> Unit) {
    val c = Nx.colors
    Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(c.card).border(1.dp, c.border, RoundedCornerShape(16.dp)).clickable(onClick = onOpen).padding(14.dp),
        verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.size(44.dp).background(c.muted, RoundedCornerShape(14.dp)), contentAlignment = Alignment.Center) { Text(d.emoji, fontSize = 22.sp) }
        Spacer(Modifier.width(14.dp))
        Column(Modifier.weight(1f)) {
            Text(d.title.ifBlank { "—" }, fontFamily = DisplayFont, fontWeight = FontWeight.Bold, fontSize = 15.sp, color = c.foreground, maxLines = 1, overflow = TextOverflow.Ellipsis)
            val preview = d.contentText?.takeIf { it.isNotBlank() } ?: DocBlocks.from(d.content).firstOrNull { it.text.isNotBlank() }?.text
            Text(preview ?: d.project?.name.orEmpty(), fontSize = 12.sp, color = c.mutedFg, maxLines = 2, overflow = TextOverflow.Ellipsis)
        }
    }
}

@Composable
fun DocsScreen(onBack: () -> Unit, onOpenDoc: (String) -> Unit) {
    val api = docsApi()
    val c = Nx.colors
    val res = LocalContext.current.resources
    var docs by remember { mutableStateOf<List<Doc>?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var q by rememberSaveable { mutableStateOf("") }
    var tick by remember { mutableStateOf(0) }
    LaunchedEffect(tick) { try { docs = api.all(); error = null } catch (e: ApiError) { error = e.describe(res) } }
    Column(Modifier.fillMaxSize().background(c.background)) {
        Row(Modifier.fillMaxWidth().padding(4.dp), verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, stringResource(R.string.back)) }
            Text("Knowledge Library", fontFamily = DisplayFont, fontWeight = FontWeight.Bold, fontSize = 18.sp, color = c.foreground)
        }
        OutlinedTextField(q, { q = it }, singleLine = true, leadingIcon = { Icon(Icons.Filled.Search, null) }, placeholder = { Text(stringResource(R.string.docs_search)) },
            shape = RoundedCornerShape(12.dp), modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 6.dp))
        val all = docs
        val shown = all?.filter { q.isBlank() || it.title.contains(q.trim(), true) }
        when {
            all == null && error == null -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
            all == null -> EmptyState(Icons.Filled.MenuBook, stringResource(R.string.docs_locked), error!!, stringResource(R.string.try_again), { tick++ }, Modifier.fillMaxSize())
            shown!!.isEmpty() -> TabEmpty(Icons.Filled.MenuBook, stringResource(if (q.isBlank()) R.string.docs_empty else R.string.docs_no_match))
            else -> LazyColumn(contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                items(shown, key = { it.id }) { d -> DocCard(d) { onOpenDoc(d.id) } }
            }
        }
    }
}

@Composable
fun DocReaderScreen(id: String, onBack: () -> Unit) {
    val api = docsApi()
    val c = Nx.colors
    val res = LocalContext.current.resources
    var doc by remember { mutableStateOf<Doc?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(id) { try { doc = api.one(id) } catch (e: ApiError) { error = e.describe(res) } }
    Column(Modifier.fillMaxSize().background(c.background)) {
        Row(Modifier.fillMaxWidth().padding(4.dp), verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, stringResource(R.string.back)) }
        }
        val d = doc
        when {
            d == null && error == null -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
            d == null -> TabEmpty(Icons.Filled.MenuBook, stringResource(R.string.docs_load_failed))
            else -> Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 20.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(d.emoji, fontSize = 30.sp); Spacer(Modifier.width(10.dp))
                    Text(d.title, fontFamily = DisplayFont, fontWeight = FontWeight.Bold, fontSize = 26.sp, color = c.foreground)
                }
                Text(listOfNotNull(d.project?.name, chatTime(d.updatedAt).takeIf { it.isNotBlank() }).joinToString(" · "), fontSize = 12.sp, color = c.mutedFg)
                val blocks = DocBlocks.from(d.content).ifEmpty { d.contentText?.split("\n")?.map { DocBlock("paragraph", it) }.orEmpty() }
                if (blocks.all { it.text.isBlank() }) Text(stringResource(R.string.docs_empty_doc), fontSize = 14.sp, color = c.mutedFg)
                var n = 0
                blocks.forEach { b ->
                    n = if (b.type == "numberedListItem") n + 1 else 0
                    when (b.type) {
                        "heading" -> Text(b.text, fontFamily = DisplayFont, fontWeight = FontWeight.Bold, color = c.foreground,
                            fontSize = when (b.level) { 1 -> 22.sp; 2 -> 19.sp; else -> 17.sp }, modifier = Modifier.padding(top = 6.dp))
                        "bulletListItem" -> Row { Text("•  ", color = c.mutedFg); Text(b.text, fontSize = 15.sp, color = c.foreground) }
                        "numberedListItem" -> Row { Text("$n.  ", color = c.mutedFg); Text(b.text, fontSize = 15.sp, color = c.foreground) }
                        "checkListItem" -> Row { Text(if (b.checked == true) "☑  " else "☐  ", color = c.mutedFg); Text(b.text, fontSize = 15.sp, color = c.foreground) }
                        "quote" -> Text(b.text, fontSize = 15.sp, fontStyle = FontStyle.Italic, color = c.mutedFg,
                            modifier = Modifier.fillMaxWidth().background(c.muted.copy(alpha = 0.4f), RoundedCornerShape(8.dp)).padding(10.dp))
                        "codeBlock" -> Text(b.text, fontSize = 13.sp, fontFamily = FontFamily.Monospace, color = c.foreground,
                            modifier = Modifier.fillMaxWidth().background(c.muted.copy(alpha = 0.6f), RoundedCornerShape(8.dp)).padding(10.dp))
                        else -> if (b.text.isNotBlank()) Text(b.text, fontSize = 15.sp, color = c.foreground.copy(alpha = 0.92f), lineHeight = 22.sp)
                    }
                }
                Spacer(Modifier.size(24.dp))
            }
        }
    }
}

/** A project's Pages tab. */
@Composable
fun ProjectPagesTab(projectId: String, onOpenDoc: (String) -> Unit) {
    val api = docsApi()
    var docs by remember { mutableStateOf<List<Doc>?>(null) }
    LaunchedEffect(projectId) { docs = runCatching { api.all(projectId) }.getOrDefault(emptyList()) }
    val l = docs
    when {
        l == null -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
        l.isEmpty() -> TabEmpty(Icons.Filled.MenuBook, stringResource(R.string.docs_none_in_project))
        else -> LazyColumn(contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            items(l, key = { it.id }) { d -> DocCard(d) { onOpenDoc(d.id) } }
        }
    }
}
