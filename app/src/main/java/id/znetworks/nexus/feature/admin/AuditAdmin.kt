package id.znetworks.nexus.feature.admin

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.ui.text.withStyle
import androidx.compose.foundation.horizontalScroll
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
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.History
import androidx.compose.material.icons.filled.Key
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Visibility
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import id.znetworks.nexus.NexusApplication
import id.znetworks.nexus.R
import id.znetworks.nexus.core.net.ApiClient
import id.znetworks.nexus.core.net.ApiError
import id.znetworks.nexus.core.time.OfficeTime
import id.znetworks.nexus.feature.projects.TabEmpty
import id.znetworks.nexus.feature.projects.valueText
import id.znetworks.nexus.ui.components.Avatar
import id.znetworks.nexus.ui.components.describe
import id.znetworks.nexus.ui.theme.DisplayFont
import id.znetworks.nexus.ui.theme.Nx
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import java.net.URLEncoder
import java.time.Instant
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.util.Locale

// API.md §2.6 Audit.

@Serializable data class AuditUser(val id: String? = null, val name: String? = null, val email: String? = null, val avatar: String? = null)
@Serializable data class AuditLog(val id: String, val action: String? = null, val entityType: String? = null, val entityName: String? = null,
                                  val createdAt: String? = null, val user: AuditUser? = null, val summary: String? = null)
@Serializable data class AuditPage(val logs: List<AuditLog> = emptyList(), val total: Int = 0, val limit: Int = 50, val offset: Int = 0)
@Serializable data class AuditEntry(val id: String, val action: String? = null, val entityType: String? = null, val entityId: String? = null,
                                    val entityName: String? = null, val createdAt: String? = null, val ipAddress: String? = null,
                                    val userAgent: String? = null, val user: AuditUser? = null, val metadata: JsonElement? = null)
@Serializable data class AuditChange(val field: String? = null, val label: String? = null, val from: JsonElement? = null, val to: JsonElement? = null)
@Serializable data class AuditLink(val type: String? = null, val id: String? = null)
@Serializable data class AuditDetail(val label: String = "", val value: JsonElement? = null, val link: AuditLink? = null)
@Serializable data class AuditEntryResponse(val entry: AuditEntry, val title: String? = null, val changes: List<AuditChange> = emptyList(), val details: List<AuditDetail> = emptyList())

object AuditLogic {
    val LINKABLE = setOf("task", "project", "user")

    const val PAGE = 50
    /** Office-day groups, newest first. */
    fun byDay(logs: List<AuditLog>) = logs.groupBy { l -> l.createdAt?.let { runCatching { Instant.parse(it).atZone(OfficeTime.ZONE).toLocalDate() }.getOrNull() } }
        .toList().sortedByDescending { it.first ?: LocalDate.MIN }

    fun kind(action: String?): String {
        val a = action.orEmpty().lowercase()
        return when {
            a.startsWith("create") -> "create"; a.startsWith("update") -> "update"; a.startsWith("delete") -> "delete"
            a.startsWith("login") || a.startsWith("logout") -> "login"; a.startsWith("view") -> "view"; else -> "other"
        }
    }
}

class AuditApi(private val api: ApiClient) {
    suspend fun page(offset: Int, action: String?, search: String?) = api.get("/api/audit?limit=${AuditLogic.PAGE}&offset=$offset" +
        (action?.let { "&action=$it" } ?: "") + (search?.takeIf { it.isNotBlank() }?.let { "&search=${URLEncoder.encode(it.trim(), "UTF-8")}" } ?: ""), AuditPage.serializer())
    suspend fun entry(id: String) = api.get("/api/audit/$id", AuditEntryResponse.serializer())
}

@Composable
private fun auditApi(): AuditApi {
    val c = (LocalContext.current.applicationContext as NexusApplication).container
    return remember { AuditApi(c.api) }
}

@Composable
private fun kindStyle(kind: String): Pair<ImageVector, Color> {
    val c = Nx.colors
    return when (kind) {
        "create" -> Icons.Filled.Add to c.success; "update" -> Icons.Filled.Edit to c.blue; "delete" -> Icons.Filled.Delete to c.danger
        "login" -> Icons.Filled.Key to Color.Gray; "view" -> Icons.Filled.Visibility to c.violet; else -> Icons.Filled.History to c.mutedFg
    }
}

private fun time(iso: String?) = iso?.let { runCatching { DateTimeFormatter.ofPattern("HH:mm").format(Instant.parse(it).atZone(OfficeTime.ZONE)) }.getOrNull() }.orEmpty()

@Composable
fun AuditTab(onOpen: (String) -> Unit) {
    val api = auditApi()
    val c = Nx.colors
    val res = LocalContext.current.resources
    val scope = rememberCoroutineScope()
    var action by rememberSaveable { mutableStateOf<String?>(null) }
    var q by rememberSaveable { mutableStateOf("") }
    var logs by remember { mutableStateOf<List<AuditLog>?>(null) }
    var total by remember { mutableStateOf(0) }
    var more by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(action, q) {
        if (q.isNotBlank()) delay(350) // typing: only the pause after the last key reaches the server
        try { val p = api.page(0, action, q); logs = p.logs; total = p.total; error = null } catch (e: ApiError) { error = e.describe(res) }
    }
    Column(Modifier.fillMaxSize()) {
        OutlinedTextField(q, { q = it }, singleLine = true, leadingIcon = { Icon(Icons.Filled.Search, null) }, placeholder = { Text(stringResource(R.string.au_search)) },
            shape = RoundedCornerShape(12.dp), modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp), keyboardOptions = AdminKeyboard.Done)
        Row(Modifier.horizontalScroll(rememberScrollState()).padding(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            listOf(null to R.string.tk_all, "create" to R.string.au_create, "update" to R.string.au_update, "delete" to R.string.au_delete, "login" to R.string.au_login).forEach { (v, l) ->
                FilterChip(action == v, { action = v }, { Text(stringResource(l)) })
            }
        }
        val l = logs
        when {
            l == null && error == null -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
            l == null -> TabEmpty(Icons.Filled.History, error!!)
            l.isEmpty() -> TabEmpty(Icons.Filled.History, stringResource(if (action != null || q.isNotBlank()) R.string.au_no_match else R.string.au_empty))
            else -> LazyColumn(contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                AuditLogic.byDay(l).forEach { (day, rows) ->
                    item(key = "d$day") {
                        Text(day?.let { d -> when (d) { OfficeTime.today() -> stringResource(R.string.au_today); OfficeTime.today().minusDays(1) -> stringResource(R.string.au_yesterday)
                            else -> DateTimeFormatter.ofPattern("EEEE, d MMM yyyy", Locale.getDefault()).format(d) } } ?: "—",
                            fontSize = 11.sp, fontWeight = FontWeight.Bold, color = c.mutedFg, modifier = Modifier.padding(top = 8.dp))
                    }
                    items(rows, key = { it.id }) { log ->
                        val (icon, tint) = kindStyle(AuditLogic.kind(log.action))
                        Row(Modifier.fillMaxWidth().background(c.card, RoundedCornerShape(12.dp)).clickable { onOpen(log.id) }.padding(10.dp), verticalAlignment = Alignment.CenterVertically) {
                            Box(Modifier.size(30.dp).background(tint.copy(alpha = 0.14f), CircleShape), contentAlignment = Alignment.Center) { Icon(icon, null, tint = tint, modifier = Modifier.size(16.dp)) }
                            Spacer(Modifier.width(10.dp))
                            Column(Modifier.weight(1f)) {
                                Text(log.summary ?: listOfNotNull(log.action, log.entityType, log.entityName).joinToString(" · "), fontSize = 13.sp, color = c.foreground, maxLines = 2, overflow = TextOverflow.Ellipsis)
                                Text((log.user?.name ?: stringResource(R.string.au_system)) + " · " + time(log.createdAt), fontSize = 11.sp, color = c.mutedFg)
                            }
                        }
                    }
                }
                item {
                    if (l.size < total) TextButton(onClick = {
                        more = true
                        scope.launch { runCatching { api.page(l.size, action, q) }.onSuccess { p -> logs = l + p.logs.filter { n -> l.none { it.id == n.id } }; total = p.total }; more = false }
                    }, enabled = !more) { Text(stringResource(R.string.au_load_more)) }
                    else Text(stringResource(R.string.au_all_n, total), fontSize = 11.sp, color = c.mutedFg)
                }
            }
        }
    }
}

@Composable
fun AuditEntryScreen(id: String, onBack: () -> Unit, onOpenLink: (type: String, id: String) -> Unit = { _, _ -> }) {
    val api = auditApi()
    val c = Nx.colors
    val res = LocalContext.current.resources
    var r by remember { mutableStateOf<AuditEntryResponse?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(id) { try { r = api.entry(id) } catch (e: ApiError) { error = e.describe(res) } }
    Column(Modifier.fillMaxSize().background(c.background).dismissKeyboardOnTapOrDrag()) {
        Row(Modifier.fillMaxWidth().padding(4.dp), verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, stringResource(R.string.back)) }
            Text(stringResource(R.string.au_entry), fontFamily = DisplayFont, fontWeight = FontWeight.Bold, fontSize = 18.sp, color = c.foreground)
        }
        val x = r
        when {
            x == null && error == null -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
            x == null -> TabEmpty(Icons.Filled.History, error!!)
            else -> Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text(x.title ?: listOfNotNull(x.entry.action, x.entry.entityName).joinToString(" · "), fontFamily = DisplayFont, fontWeight = FontWeight.Bold, fontSize = 18.sp, color = c.foreground)
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Avatar(x.entry.user?.name, x.entry.user?.avatar, 26.dp); Spacer(Modifier.width(8.dp))
                    Text((x.entry.user?.name ?: stringResource(R.string.au_system)) + " · " + (x.entry.createdAt?.let { runCatching {
                        DateTimeFormatter.ofPattern("d MMM yyyy, HH:mm", Locale.getDefault()).format(Instant.parse(it).atZone(OfficeTime.ZONE)) }.getOrNull() } ?: ""), fontSize = 12.sp, color = c.mutedFg)
                }
                if (x.changes.isNotEmpty()) AdminCard(stringResource(R.string.au_changed)) {
                    x.changes.forEach { ch ->
                        Column {
                            Text(ch.label ?: ch.field ?: "—", fontSize = 12.sp, fontWeight = FontWeight.Bold, color = c.mutedFg)
                            val from = valueText(ch.from); val to = valueText(ch.to)
                            // The old value struck through, the new one plain (iOS 3ae2630).
                            val cleared = stringResource(R.string.au_cleared)
                            Text(when {
                                from == null && to != null -> androidx.compose.ui.text.AnnotatedString(stringResource(R.string.au_set_to, to))
                                else -> androidx.compose.ui.text.buildAnnotatedString {
                                    withStyle(androidx.compose.ui.text.SpanStyle(textDecoration = androidx.compose.ui.text.style.TextDecoration.LineThrough, color = c.mutedFg)) { append(from ?: "—") }
                                    append(" → "); append(to ?: cleared)
                                }
                            },
                                fontSize = 13.sp, color = c.foreground)
                        }
                    }
                }
                if (x.details.isNotEmpty()) AdminCard(stringResource(R.string.au_details)) {
                    x.details.forEach { d ->
                        // A detail that names a task, project or person opens it (iOS 3ae2630).
                        val target = d.link?.takeIf { it.type in AuditLogic.LINKABLE && !it.id.isNullOrBlank() }
                        Row(Modifier.then(if (target != null) Modifier.clickable { onOpenLink(target.type!!, target.id!!) } else Modifier)) {
                            Text(d.label, fontSize = 12.sp, color = c.mutedFg, modifier = Modifier.width(120.dp))
                            Text(valueText(d.value) ?: "—", fontSize = 13.sp, color = if (target != null) c.violetText else c.foreground,
                                fontWeight = if (target != null) FontWeight.SemiBold else FontWeight.Normal)
                        }
                    }
                }
                AdminCard(stringResource(R.string.au_technical)) {
                    listOf(R.string.au_device to x.entry.userAgent, R.string.au_ip to x.entry.ipAddress,
                        R.string.au_entity to listOfNotNull(x.entry.entityType, x.entry.entityId).joinToString(" · "), R.string.au_entry_id to x.entry.id).forEach { (l, v) ->
                        if (!v.isNullOrBlank()) Row { Text(stringResource(l), fontSize = 12.sp, color = c.mutedFg, modifier = Modifier.width(120.dp)); SelectionContainer { Text(v, fontSize = 12.sp, color = c.foreground) } }
                    }
                    x.entry.metadata?.let { m ->
                        Text(stringResource(R.string.au_metadata), fontSize = 11.sp, fontWeight = FontWeight.Bold, color = c.mutedFg)
                        SelectionContainer { Text(Json { prettyPrint = true }.encodeToString(JsonElement.serializer(), m), fontSize = 11.sp, fontFamily = FontFamily.Monospace, color = c.foreground) }
                    }
                }
            }
        }
    }
}
