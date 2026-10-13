package id.znetworks.nexus.feature.projects

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.StickyNote2
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.BugReport
import androidx.compose.material.icons.filled.CalendarMonth
import androidx.compose.material.icons.filled.Campaign
import androidx.compose.material.icons.filled.Celebration
import androidx.compose.material.icons.filled.Checklist
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Collections
import androidx.compose.material.icons.filled.Description
import androidx.compose.material.icons.filled.FilterAlt
import androidx.compose.material.icons.filled.Flag
import androidx.compose.material.icons.filled.Groups
import androidx.compose.material.icons.filled.Inventory2
import androidx.compose.material.icons.filled.Lightbulb
import androidx.compose.material.icons.filled.Map
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Storefront
import androidx.compose.material.icons.filled.TrackChanges
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import id.znetworks.nexus.NexusApplication
import id.znetworks.nexus.R
import id.znetworks.nexus.ui.theme.Nx

// The New project gallery (DEV-REDESIGN §1; web TemplateGallery): Blank first, the server's templates,
// then the dashboards (Outlet Sales, Pipeline). Cards and their small previews are drawn from the
// template's data, never from its name.

/** lucide names the registry uses, as Material icons; anything else is the checklist. */
internal fun templateIcon(name: String?): ImageVector = when (name) {
    "CalendarRange" -> Icons.Filled.CalendarMonth
    "Megaphone" -> Icons.Filled.Campaign
    "PartyPopper" -> Icons.Filled.Celebration
    "Users" -> Icons.Filled.Groups
    "StickyNote" -> Icons.AutoMirrored.Filled.StickyNote2
    "Lightbulb" -> Icons.Filled.Lightbulb
    "FileText" -> Icons.Filled.Description
    "Target" -> Icons.Filled.TrackChanges
    "Flag" -> Icons.Filled.Flag
    "Bug" -> Icons.Filled.BugReport
    "Package" -> Icons.Filled.Inventory2
    "Images" -> Icons.Filled.Collections
    "Map" -> Icons.Filled.Map
    else -> Icons.Filled.Checklist
}

/** Notion's colours, for the card wash, the icon and option chips. */
internal fun templateTint(tint: String?): Color = when (tint) {
    "brown" -> Color(0xFF92400E)
    "orange" -> Color(0xFFEA580C)
    "yellow" -> Color(0xFFCA8A04)
    "green" -> Color(0xFF059669)
    "blue" -> Color(0xFF0284C7)
    "purple" -> Color(0xFF7C3AED)
    "pink" -> Color(0xFFDB2777)
    "red" -> Color(0xFFE11D48)
    else -> Color(0xFF64748B)
}

private fun categoryLabel(c: String) = when (c) {
    "marketing" -> R.string.tg_cat_marketing
    "projects" -> R.string.tg_cat_projects
    "docs" -> R.string.tg_cat_docs
    "planning" -> R.string.tg_cat_planning
    "operations" -> R.string.tg_cat_operations
    "dashboards" -> R.string.tg_cat_dashboards
    else -> null
}

private fun dashboardIcon(t: ProjectType) = if (t == ProjectType.PIPELINE) Icons.Filled.FilterAlt else Icons.Filled.Storefront

/** The app's language as the server's code ("en"/"id"). */
@Composable
internal fun templateLang(): String = TemplateLogic.lang(id.znetworks.nexus.core.config.ConfigBody.lang(LocalConfiguration.current.locales[0]))

/** Full-screen picker; [onPick] closes it. */
@Composable
fun TemplateGalleryDialog(pipelineAccess: Boolean, onDismiss: () -> Unit, onPick: (GalleryPick) -> Unit) {
    val c = Nx.colors
    val lang = templateLang()
    val api = ProjectsApi((LocalContext.current.applicationContext as NexusApplication).container.api)
    var templates by remember { mutableStateOf<List<ProjectTemplate>?>(null) }
    var failed by remember { mutableStateOf(false) }
    var attempt by remember { mutableIntStateOf(0) }
    LaunchedEffect(attempt) {
        failed = false
        runCatching { ProjectTemplatesCache.get(api) }.onSuccess { templates = it }.onFailure { failed = true; if (templates == null) templates = emptyList() }
    }
    var query by rememberSaveable { mutableStateOf("") }
    var category by rememberSaveable { mutableStateOf("all") }
    val loading = templates == null
    val all = templates.orEmpty()
    val dashboards = TemplateLogic.dashboards(pipelineAccess)
    val shown = TemplateLogic.shown(all, category, query)
    val blankTitle = stringResource(R.string.tg_blank)
    val blankBody = stringResource(R.string.tg_blank_sub)
    val q = query.trim().lowercase()
    val showBlank = category == "all" && (q.isEmpty() || listOf("blank", blankTitle, blankBody).any { it.lowercase().contains(q) })
    val ctx = LocalContext.current
    val shownDashboards = dashboards.filter { d ->
        (category == "all" || category == "dashboards") && (q.isEmpty() || listOf(d.title, ctx.getString(d.description)).any { it.lowercase().contains(q) })
    }
    val nothing = !loading && !showBlank && shown.isEmpty() && shownDashboards.isEmpty()
    val wide = LocalConfiguration.current.screenWidthDp >= 600

    Dialog(onDismissRequest = onDismiss, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Column(Modifier.fillMaxSize().background(c.background).imePadding()) {
            Row(Modifier.fillMaxWidth().padding(horizontal = 4.dp, vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                TextButton(onClick = onDismiss) { Text(stringResource(R.string.cancel)) }
                Text(stringResource(R.string.pt_question), fontSize = 16.sp, fontWeight = FontWeight.SemiBold, color = c.foreground,
                    textAlign = TextAlign.Center, modifier = Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis)
                Spacer(Modifier.width(72.dp))
            }
            OutlinedTextField(query, { query = it }, singleLine = true, leadingIcon = { Icon(Icons.Filled.Search, null) },
                trailingIcon = { if (query.isNotEmpty()) IconButton(onClick = { query = "" }) { Icon(Icons.Filled.Close, stringResource(R.string.tg_clear_search)) } },
                placeholder = { Text(stringResource(R.string.tg_search)) }, shape = RoundedCornerShape(12.dp),
                modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp))
            Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 10.dp),
                horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                (listOf("all") + TemplateLogic.categories(all, dashboards.isNotEmpty())).forEach { cat ->
                    val on = category == cat
                    Text(categoryLabel(cat)?.let { stringResource(it) } ?: if (cat == "all") stringResource(R.string.tg_all) else cat,
                        fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = if (on) Color.White else c.mutedFg,
                        modifier = Modifier.clip(CircleShape).background(if (on) c.violet else c.muted).clickable { category = cat }
                            .padding(horizontal = 12.dp, vertical = 6.dp))
                }
            }
            LazyVerticalGrid(GridCells.Fixed(if (wide) 2 else 1), Modifier.fillMaxSize(),
                contentPadding = PaddingValues(start = 16.dp, end = 16.dp, bottom = 24.dp),
                horizontalArrangement = Arrangement.spacedBy(10.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                if (showBlank) item(key = "blank") {
                    GalleryCard(Icons.Filled.Add, c.violet, blankTitle, blankBody, { onPick(GalleryPick.Blank) }) { BlankPreview() }
                }
                if (loading) items(4) { Box(Modifier.fillMaxWidth().height(170.dp).clip(RoundedCornerShape(16.dp)).background(c.muted.copy(alpha = 0.5f))) }
                items(shown, key = { it.id }) { t ->
                    GalleryCard(templateIcon(t.icon), templateTint(t.tint), TemplateLogic.say(t.name, lang), TemplateLogic.say(t.blurb, lang),
                        { onPick(GalleryPick.Template(t)) }) { TemplatePreview(t, lang) }
                }
                items(shownDashboards, key = { it.code }) { d ->
                    GalleryCard(dashboardIcon(d), c.violet, d.title, stringResource(d.description), { onPick(GalleryPick.Dashboard(d)) }) { DashboardPreview(d) }
                }
                if (failed) item(key = "failed", span = { GridItemSpan(maxLineSpan) }) {
                    Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(c.muted.copy(alpha = 0.5f)).padding(horizontal = 12.dp, vertical = 8.dp),
                        verticalAlignment = Alignment.CenterVertically) {
                        Text(stringResource(R.string.tg_failed), fontSize = 12.sp, color = c.mutedFg, modifier = Modifier.weight(1f))
                        TextButton(onClick = { attempt++ }) { Text(stringResource(R.string.tg_retry)) }
                    }
                }
                if (nothing) item(key = "nothing", span = { GridItemSpan(maxLineSpan) }) {
                    Column(Modifier.fillMaxWidth().border(1.dp, c.border, RoundedCornerShape(16.dp)).padding(20.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                        Text(stringResource(R.string.tg_no_match, query.trim()), fontSize = 13.sp, color = c.mutedFg, textAlign = TextAlign.Center)
                        TextButton(onClick = { query = ""; category = "all" }) { Text(stringResource(R.string.tg_show_all)) }
                    }
                }
            }
        }
    }
}

@Composable
private fun GalleryCard(icon: ImageVector, tint: Color, title: String, body: String, onClick: () -> Unit, preview: @Composable () -> Unit) {
    val c = Nx.colors
    val shape = RoundedCornerShape(16.dp)
    Column(Modifier.fillMaxWidth().clip(shape).border(1.dp, c.border, shape).background(tint.copy(alpha = 0.06f)).clickable(onClick = onClick).padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Row(verticalAlignment = Alignment.Top) {
            Box(Modifier.size(32.dp).clip(RoundedCornerShape(10.dp)).background(tint.copy(alpha = 0.15f)), contentAlignment = Alignment.Center) {
                Icon(icon, null, tint = tint, modifier = Modifier.size(18.dp))
            }
            Spacer(Modifier.width(10.dp))
            Column(Modifier.weight(1f)) {
                Text(title, fontSize = 14.sp, fontWeight = FontWeight.Bold, color = c.foreground, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(body, fontSize = 12.sp, color = c.mutedFg, maxLines = 2, overflow = TextOverflow.Ellipsis, lineHeight = 15.sp)
            }
        }
        Box(Modifier.fillMaxWidth().height(96.dp).clip(RoundedCornerShape(12.dp)).background(c.card).border(1.dp, c.border, RoundedCornerShape(12.dp)).padding(8.dp)) {
            preview()
        }
    }
}

// Previews: plain blocks in theme colours, like TabPreview.

@Composable
private fun Bar(fraction: Float) {
    Box(Modifier.fillMaxWidth(fraction).height(4.dp).clip(CircleShape).background(Nx.colors.foreground.copy(alpha = 0.15f)))
}

@Composable
private fun Mini(text: String, color: String?) {
    val tint = templateTint(color)
    Text(text, fontSize = 9.sp, fontWeight = FontWeight.Medium, color = tint, maxLines = 1, overflow = TextOverflow.Ellipsis, lineHeight = 13.sp,
        modifier = Modifier.clip(RoundedCornerShape(4.dp)).background(tint.copy(alpha = 0.15f)).padding(horizontal = 4.dp))
}

/** One sample value: an option chip, a section chip, a person dot or a bar. */
@Composable
private fun Cell(t: ProjectTemplate, col: String, row: Int, lang: String) {
    when {
        col.startsWith("cf:") -> {
            val opt = t.fields.firstOrNull { it.key == col.removePrefix("cf:") }?.options?.takeIf { it.isNotEmpty() }?.let { it[row % it.size] }
            if (opt != null) Mini(TemplateLogic.say(opt.label, lang), opt.color) else Bar(if (row % 2 == 1) 0.5f else 0.66f)
        }
        col == "status" && t.sections.isNotEmpty() -> t.sections[row % t.sections.size].let { Mini(TemplateLogic.say(it.name, lang), it.color) }
        col == "assignee" -> Row(verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.size(10.dp).clip(CircleShape).background(Nx.colors.foreground.copy(alpha = 0.25f))); Spacer(Modifier.width(4.dp))
            Box(Modifier.width(32.dp)) { Bar(1f) }
        }
        else -> Bar(if (row % 2 == 1) 0.5f else 0.66f)
    }
}

@Composable
private fun TemplatePreview(t: ProjectTemplate, lang: String) {
    val c = Nx.colors
    val cols = t.preview.columns
    when (t.preview.layout) {
        "board" -> Row(Modifier.fillMaxSize(), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            t.sections.take(3).forEachIndexed { i, s ->
                Column(Modifier.weight(1f).fillMaxHeight().clip(RoundedCornerShape(6.dp)).background(c.foreground.copy(alpha = 0.04f)).padding(4.dp),
                    verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Mini(TemplateLogic.say(s.name, lang), s.color)
                    repeat(if (i == 2) 1 else 2) { r ->
                        Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(4.dp)).background(c.card).padding(4.dp), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                            Bar(if (r == 1) 0.5f else 0.8f)
                            cols.firstOrNull()?.let { Cell(t, it, i * 2 + r, lang) }
                        }
                    }
                }
            }
        }
        "calendar" -> Column(Modifier.fillMaxSize(), verticalArrangement = Arrangement.spacedBy(3.dp)) {
            val lit = mapOf(1 to 0, 3 to 1, 7 to 2, 8 to 0, 12 to 1)
            repeat(3) { r ->
                Row(Modifier.weight(1f), horizontalArrangement = Arrangement.spacedBy(3.dp)) {
                    repeat(5) { col ->
                        val s = lit[r * 5 + col]?.let { t.sections.getOrNull(it % t.sections.size.coerceAtLeast(1)) }
                        Box(Modifier.weight(1f).fillMaxHeight().clip(RoundedCornerShape(3.dp)).background(c.foreground.copy(alpha = 0.05f)).padding(2.dp),
                            contentAlignment = Alignment.BottomCenter) {
                            if (s != null) Box(Modifier.fillMaxWidth().height(5.dp).clip(CircleShape).background(templateTint(s.color).copy(alpha = 0.5f)))
                        }
                    }
                }
            }
        }
        "gallery" -> Row(Modifier.fillMaxSize(), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            repeat(3) { i ->
                Column(Modifier.weight(1f).fillMaxHeight().clip(RoundedCornerShape(6.dp)).background(c.foreground.copy(alpha = 0.04f)).padding(4.dp),
                    verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Box(Modifier.fillMaxWidth().height(28.dp).clip(RoundedCornerShape(4.dp)).background(c.foreground.copy(alpha = 0.07f)))
                    Bar(0.8f)
                    cols.firstOrNull()?.let { Cell(t, it, i, lang) }
                }
            }
        }
        "list" -> Column(Modifier.fillMaxSize().padding(horizontal = 4.dp), verticalArrangement = Arrangement.spacedBy(10.dp, Alignment.CenterVertically)) {
            repeat(4) { i ->
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Filled.Description, null, tint = c.mutedFg, modifier = Modifier.size(10.dp)); Spacer(Modifier.width(6.dp))
                    Bar(if (i % 2 == 1) 0.5f else 0.75f)
                }
            }
        }
        else -> Column(Modifier.fillMaxSize()) {
            val shown = cols.take(2)
            Row(Modifier.fillMaxWidth().padding(bottom = 4.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                Text(stringResource(R.string.tg_col_name), fontSize = 9.sp, fontWeight = FontWeight.SemiBold, color = c.mutedFg, modifier = Modifier.weight(1f), maxLines = 1)
                shown.forEach { col -> Text(columnLabel(t, col, lang), fontSize = 9.sp, fontWeight = FontWeight.SemiBold, color = c.mutedFg, modifier = Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis) }
            }
            repeat(3) { r ->
                Row(Modifier.fillMaxWidth().weight(1f), horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
                    Box(Modifier.weight(1f)) { Bar(if (r % 2 == 1) 0.5f else 0.75f) }
                    shown.forEach { col -> Box(Modifier.weight(1f)) { Cell(t, col, r, lang) } }
                }
            }
        }
    }
}

@Composable
private fun columnLabel(t: ProjectTemplate, key: String, lang: String): String {
    if (key.startsWith("cf:")) return t.fields.firstOrNull { it.key == key.removePrefix("cf:") }?.let { TemplateLogic.say(it.name, lang) } ?: key
    t.builtins.firstOrNull { it.key == key }?.let { return TemplateLogic.say(it.name, lang) }
    return when (key) {
        "status" -> stringResource(R.string.tg_col_status)
        "assignee" -> stringResource(R.string.tg_col_assignee)
        "dueDate" -> stringResource(R.string.tg_col_due)
        "priority" -> stringResource(R.string.tg_col_priority)
        else -> key
    }
}

@Composable
private fun BlankPreview() {
    val c = Nx.colors
    Row(Modifier.fillMaxSize(), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        listOf(2, 1, 0).forEach { n ->
            Column(Modifier.weight(1f).fillMaxHeight().clip(RoundedCornerShape(6.dp)).border(1.dp, c.border, RoundedCornerShape(6.dp)).padding(4.dp),
                verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Bar(0.5f)
                repeat(n) { Box(Modifier.fillMaxWidth().height(12.dp).clip(RoundedCornerShape(4.dp)).background(c.foreground.copy(alpha = 0.06f))) }
            }
        }
    }
}

@Composable
private fun DashboardPreview(type: ProjectType) {
    val c = Nx.colors
    if (type == ProjectType.PIPELINE) {
        Column(Modifier.fillMaxSize(), verticalArrangement = Arrangement.spacedBy(6.dp, Alignment.CenterVertically), horizontalAlignment = Alignment.CenterHorizontally) {
            listOf(1f, 0.78f, 0.55f, 0.34f).forEachIndexed { i, w ->
                Box(Modifier.fillMaxWidth(w).height(12.dp).clip(RoundedCornerShape(4.dp)).background(if (i == 3) c.violet.copy(alpha = 0.6f) else c.foreground.copy(alpha = 0.15f)))
            }
        }
        return
    }
    Column(Modifier.fillMaxSize(), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            repeat(2) { Box(Modifier.weight(1f).height(20.dp).clip(RoundedCornerShape(4.dp)).background(c.foreground.copy(alpha = 0.07f))) }
        }
        Row(Modifier.fillMaxWidth().weight(1f), horizontalArrangement = Arrangement.spacedBy(4.dp), verticalAlignment = Alignment.Bottom) {
            listOf(0.4f, 0.7f, 0.55f, 0.9f, 0.65f, 0.8f).forEachIndexed { i, h ->
                Box(Modifier.weight(1f).fillMaxHeight(h).clip(RoundedCornerShape(topStart = 2.dp, topEnd = 2.dp))
                    .background(if (i == 3) c.violet.copy(alpha = 0.6f) else c.foreground.copy(alpha = 0.15f)))
            }
        }
    }
}

/** Above the details form: what was picked and what it creates, with the way back to the gallery. */
@Composable
fun TemplateChosen(pick: GalleryPick, enabled: Boolean, onChange: () -> Unit) {
    val c = Nx.colors
    val lang = templateLang()
    val (icon, title) = when (pick) {
        is GalleryPick.Template -> templateIcon(pick.template.icon) to TemplateLogic.say(pick.template.name, lang)
        is GalleryPick.Dashboard -> dashboardIcon(pick.type) to pick.type.title
        GalleryPick.Blank -> Icons.Filled.Add to stringResource(R.string.tg_blank)
    }
    Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(c.violet.copy(alpha = 0.06f)).padding(start = 12.dp, top = 4.dp, bottom = 8.dp, end = 4.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Icon(icon, null, tint = c.violetText, modifier = Modifier.size(16.dp)); Spacer(Modifier.width(6.dp))
            Text(title, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = c.violetText, modifier = Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis)
            TextButton(onClick = onChange, enabled = enabled) { Text(stringResource(R.string.tg_change), fontSize = 12.sp) }
        }
        if (pick is GalleryPick.Template) {
            Text(stringResource(R.string.tg_sections, TemplateLogic.sectionsLine(pick.template, lang)), fontSize = 11.sp, color = c.mutedFg, maxLines = 2, overflow = TextOverflow.Ellipsis)
            if (pick.template.fields.isNotEmpty())
                Text(stringResource(R.string.tg_fields, TemplateLogic.fieldsLine(pick.template, lang)), fontSize = 11.sp, color = c.mutedFg, maxLines = 2, overflow = TextOverflow.Ellipsis)
        }
    }
}
