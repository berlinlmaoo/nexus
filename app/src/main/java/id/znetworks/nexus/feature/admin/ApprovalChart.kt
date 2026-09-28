package id.znetworks.nexus.feature.admin

import android.content.Intent
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.gestures.detectTransformGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.wrapContentSize
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.AccountTree
import androidx.compose.material.icons.filled.FitScreen
import androidx.compose.material.icons.filled.PhoneAndroid
import androidx.compose.material.icons.filled.Share
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.TransformOrigin
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.graphics.layer.drawLayer
import androidx.compose.ui.graphics.rememberGraphicsLayer
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.FileProvider
import id.znetworks.nexus.R
import id.znetworks.nexus.core.net.ApiError
import id.znetworks.nexus.feature.projects.TabEmpty
import id.znetworks.nexus.ui.components.Avatar
import id.znetworks.nexus.ui.components.describe
import id.znetworks.nexus.ui.theme.DisplayFont
import id.znetworks.nexus.ui.theme.Nx
import kotlinx.coroutines.launch
import java.io.File
import java.time.LocalDate

// Control Room › Approval chart (iOS ApprovalChartView, web TreeNode): who approves whom as a tree,
// pinch/drag to move around, tap a card to choose that person's approver, share as a PNG.

object ChartLogic {
    private fun rank(r: String?) = when (r) { "ONE_ABOVE_ALL" -> 0; "BOD" -> 1; "MANAGER" -> 2; "STAFF" -> 3; else -> 4 }
    fun isSenior(m: WsMember) = m.role == "BOD" || m.role == "ONE_ABOVE_ALL"
    fun sorted(xs: List<WsMember>) = xs.sortedWith(compareBy({ rank(it.role) }, { it.displayName.lowercase() }))

    /** Direct reports per approver; an approver who is not in the workspace means no approver. */
    fun children(people: List<WsMember>): Map<String, List<WsMember>> {
        val ids = people.map { it.userId }.toSet()
        return people.filter { it.approverId != null && it.approverId in ids }.groupBy { it.approverId!! }.mapValues { sorted(it.value) }
    }
    fun roots(people: List<WsMember>): List<WsMember> {
        val ids = people.map { it.userId }.toSet()
        return sorted(people.filter { it.approverId == null || it.approverId !in ids })
    }
    /** Trees: anyone without an approver who has reports, plus every BoD (the top even with none). */
    fun trees(people: List<WsMember>): List<WsMember> {
        val kids = children(people)
        return roots(people).filter { !kids[it.userId].isNullOrEmpty() || isSenior(it) }
    }
    /** Not a BoD, no approver and no reports: the "not placed" chips (their requests go to every BoD). */
    fun alone(people: List<WsMember>): List<WsMember> {
        val kids = children(people)
        return roots(people).filter { !isSenior(it) && kids[it.userId].isNullOrEmpty() }
    }
    fun placed(people: List<WsMember>): Int {
        val ids = people.map { it.userId }.toSet()
        return people.count { it.approverId != null && it.approverId in ids }
    }
    fun unplaced(people: List<WsMember>) = roots(people).count { !isSenior(it) }

    /** Everyone but the person and everyone under them (the server refuses a loop too). */
    fun candidates(people: List<WsMember>, selfUserId: String): List<WsMember> {
        val kids = children(people)
        val banned = mutableSetOf(selfUserId)
        val stack = ArrayDeque(listOf(selfUserId))
        while (stack.isNotEmpty()) {
            val cur = stack.removeLast()
            kids[cur].orEmpty().forEach { k -> if (banned.add(k.userId)) stack.addLast(k.userId) }
        }
        return people.filter { it.userId !in banned }
    }

    /** "09:00" → "9 AM", "13:30" → "1:30 PM": the card is narrow. */
    fun to12(hhmm: String): String {
        val p = hhmm.split(":")
        val h = p.getOrNull(0)?.toIntOrNull() ?: return hhmm
        val m = p.getOrNull(1)?.toIntOrNull() ?: return hhmm
        val ap = if (h >= 12) "PM" else "AM"
        val hh = ((h + 11) % 12) + 1
        return if (m == 0) "$hh $ap" else "$hh:%02d $ap".format(m)
    }
}

private val SENIOR = Color(0xFF1E3A5F)
private val MANAGER = Color(0xFF2C5282)
private val COL_GAP = 18.dp
private val STUB = 16.dp

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun ApprovalChartScreen(onBack: () -> Unit, @Suppress("UNUSED_PARAMETER") onOpenUser: (String) -> Unit) {
    val api = adminApi()
    val c = Nx.colors
    val context = LocalContext.current
    val res = context.resources
    val scope = rememberCoroutineScope()
    var roster by remember { mutableStateOf<WsRoster?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var problem by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    var picking by remember { mutableStateOf<WsMember?>(null) }
    var tick by remember { mutableIntStateOf(0) }
    LaunchedEffect(tick) { try { roster = api.roster(includeRegistered = false); error = null } catch (e: ApiError) { error = e.describe(res) } }

    // Pan and zoom of the canvas; "fit" puts the whole chart on screen.
    var scale by remember { mutableFloatStateOf(1f) }
    var offset by remember { mutableStateOf(Offset.Zero) }
    var viewport by remember { mutableStateOf(IntSize.Zero) }
    var content by remember { mutableStateOf(IntSize.Zero) }
    var fitted by remember { mutableStateOf(false) }
    fun fit() {
        if (viewport.width == 0 || content.width == 0) return
        scale = minOf(viewport.width.toFloat() / content.width, viewport.height.toFloat() / content.height, 1f).coerceAtLeast(0.15f)
        offset = Offset((viewport.width - content.width * scale) / 2f, 0f)
    }
    val layer = rememberGraphicsLayer()

    Column(Modifier.fillMaxSize().background(c.background)) {
        Row(Modifier.fillMaxWidth().padding(4.dp), verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, stringResource(R.string.back)) }
            Text(stringResource(R.string.ad_chart), fontFamily = DisplayFont, fontWeight = FontWeight.Bold, fontSize = 18.sp, color = c.foreground, modifier = Modifier.weight(1f))
            if (busy) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
            IconButton(onClick = ::fit) { Icon(Icons.Filled.FitScreen, stringResource(R.string.ch_fit)) }
            IconButton(onClick = {
                scope.launch {
                    // Drawn from the chart itself, not the zoomed canvas: the same image at any zoom.
                    val bmp = runCatching { layer.toImageBitmap().asAndroidBitmap() }.getOrNull()
                    if (bmp == null) { problem = res.getString(R.string.ch_export_failed); return@launch }
                    val f = File(File(context.cacheDir, "shared").apply { mkdirs() }, "Bagan Approval ${LocalDate.now()}.png")
                    runCatching { f.outputStream().use { bmp.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, it) } }
                        .onFailure { problem = res.getString(R.string.ch_export_failed); return@launch }
                    val uri = FileProvider.getUriForFile(context, "${context.packageName}.files", f)
                    context.startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).setType("image/png")
                        .putExtra(Intent.EXTRA_STREAM, uri).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION), null).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                }
            }, enabled = roster != null) { Icon(Icons.Filled.Share, stringResource(R.string.ch_share)) }
        }
        val r = roster
        if (r == null) {
            if (error == null) Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
            else TabEmpty(Icons.Filled.AccountTree, error!!)
            return@Column
        }
        val people = r.members
        val kids = ChartLogic.children(people)
        val trees = ChartLogic.trees(people)
        val alone = ChartLogic.alone(people)
        val unplaced = ChartLogic.unplaced(people)
        // Stats strip.
        Row(Modifier.fillMaxWidth().background(c.card).padding(horizontal = 14.dp, vertical = 8.dp), horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
            Stat(ChartLogic.placed(people), stringResource(R.string.ch_placed), null)
            Stat(unplaced, stringResource(R.string.ch_unplaced), if (unplaced == 0) c.success else c.warning)
            Stat(trees.size, stringResource(R.string.ch_tops), null)
            Spacer(Modifier.weight(1f))
            Text(problem ?: stringResource(R.string.ch_hint), fontSize = 10.sp, color = if (problem != null) c.danger else c.mutedFg, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        HorizontalDivider(color = c.border)
        Box(Modifier.fillMaxSize().clipToBounds().onSizeChanged { viewport = it }
            .pointerInputTransform { centroid, pan, zoom ->
                val next = (scale * zoom).coerceIn(0.15f, 3f)
                // Zoom about the fingers: the point under them stays put.
                offset = (offset - centroid) * (next / scale) + centroid + pan
                scale = next
            }) {
            Box(Modifier.wrapContentSize(Alignment.TopStart, unbounded = true)
                .graphicsLayer { transformOrigin = TransformOrigin(0f, 0f); scaleX = scale; scaleY = scale; translationX = offset.x; translationY = offset.y }) {
                Column(Modifier
                    .onSizeChanged { content = it; if (!fitted && viewport.width > 0) { fitted = true; fit() } }
                    .drawWithContent { layer.record { this@drawWithContent.drawContent() }; drawLayer(layer) }
                    .background(c.background).padding(28.dp), verticalArrangement = Arrangement.spacedBy(22.dp)) {
                    Row(horizontalArrangement = Arrangement.spacedBy(28.dp), verticalAlignment = Alignment.Top) {
                        trees.forEach { root -> TreeNode(root, kids, rootless = !ChartLogic.isSenior(root)) { if (!busy) picking = it } }
                    }
                    if (alone.isNotEmpty()) Column(Modifier.widthIn(max = 640.dp).background(c.warning.copy(alpha = 0.06f), RoundedCornerShape(14.dp)).padding(12.dp),
                        verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text(stringResource(R.string.ch_alone, alone.size), fontSize = 11.sp, fontWeight = FontWeight.Bold, color = c.warning)
                        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            alone.forEach { p ->
                                Row(Modifier.clip(CircleShape).background(c.card).dashed(c.warning.copy(alpha = 0.5f), 50.dp).clickable { if (!busy) picking = p }
                                    .padding(horizontal = 10.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                                    Avatar(p.name, p.avatar, 20.dp); Spacer(Modifier.width(6.dp))
                                    Text(p.displayName, fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = c.foreground, maxLines = 1)
                                    Spacer(Modifier.width(6.dp)); Text(Roles.label(p.role), fontSize = 10.sp, color = c.mutedFg)
                                }
                            }
                        }
                    }
                }
            }
        }
        picking?.let { p ->
            val rows = listOf(PickRow("", res.getString(R.string.ad_detach), null)) +
                ChartLogic.sorted(ChartLogic.candidates(people, p.userId)).map { PickRow(it.userId, it.displayName, Roles.label(it.role) + if (it.userId == p.approverId) " · ✓" else "") }
            PickDialog(stringResource(R.string.ch_pick_for, p.displayName), rows, "", { picking = null }) { id ->
                scope.launch {
                    busy = true; problem = null
                    try { api.setApprover(p, r.workspaceId ?: return@launch, id.ifEmpty { null }); tick++ }
                    catch (e: ApiError) { problem = (e as? ApiError.Http)?.serverMessage ?: res.getString(R.string.ch_move_failed) }
                    busy = false
                }
            }
        }
    }
}

/** Pinch, drag, and a double tap that zooms in on the spot, as the iPhone canvas. */
private fun Modifier.pointerInputTransform(onTransform: (Offset, Offset, Float) -> Unit): Modifier =
    this.then(Modifier.pointerInput("chart") { detectTransformGestures { centroid, pan, zoom, _ -> onTransform(centroid, pan, zoom) } })
        .then(Modifier.pointerInput("chart-tap") { detectTapGestures(onDoubleTap = { p -> onTransform(p, Offset.Zero, 1.6f) }) })

private fun Modifier.dashed(color: Color, radius: androidx.compose.ui.unit.Dp) = drawBehind {
    drawRoundRect(color, style = Stroke(width = 1.dp.toPx(), pathEffect = PathEffect.dashPathEffect(floatArrayOf(4.dp.toPx(), 3.dp.toPx()))),
        cornerRadius = androidx.compose.ui.geometry.CornerRadius(radius.toPx()))
}

@Composable
private fun Stat(n: Int, label: String, tone: Color?) {
    val c = Nx.colors
    Row(verticalAlignment = Alignment.Bottom) {
        Text("$n", fontSize = 13.sp, fontWeight = FontWeight.Bold, color = tone ?: c.foreground); Spacer(Modifier.width(3.dp))
        Text(label, fontSize = 11.sp, color = tone ?: c.mutedFg)
    }
}

/**
 * One person and everyone under them. Branches (reports with reports, or managers/BoD) get their own
 * column; staff without reports stack in one box, as the web's TreeNode.
 */
@Composable
private fun TreeNode(person: WsMember, children: Map<String, List<WsMember>>, rootless: Boolean = false, onTap: (WsMember) -> Unit) {
    val c = Nx.colors
    val line = c.mutedFg.copy(alpha = 0.55f)
    val kids = children[person.userId].orEmpty()
    val leaves = kids.filter { children[it.userId].isNullOrEmpty() && it.role == "STAFF" }
    val branches = kids - leaves.toSet()
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        PersonCard(person, kids.size, rootless, onTap)
        if (kids.isEmpty()) return@Column
        Box(Modifier.width(1.5.dp).height(STUB).background(line))
        val columns = branches.size + if (leaves.isEmpty()) 0 else 1
        val density = LocalDensity.current
        val half = with(density) { (COL_GAP / 2).toPx() }
        Row(horizontalArrangement = Arrangement.spacedBy(COL_GAP), verticalAlignment = Alignment.Top) {
            var i = 0
            branches.forEach { k ->
                val idx = i++
                ChartColumn(idx, columns, half, line) { TreeNode(k, children, onTap = onTap) }
            }
            if (leaves.isNotEmpty()) ChartColumn(i, columns, half, line) {
                Column(Modifier.background(c.muted.copy(alpha = 0.5f), RoundedCornerShape(12.dp)).dashed(line, 12.dp).padding(8.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("${leaves.size} staff", fontSize = 10.sp, fontWeight = FontWeight.Bold, color = c.mutedFg)
                    leaves.forEach { PersonCard(it, 0, false, onTap) }
                }
            }
        }
    }
}

/**
 * A child column with its stub; the horizontal bar is drawn in pieces by each column (to its left
 * neighbour's gap, to its right one's), so it runs exactly from the first centre to the last.
 */
@Composable
private fun ChartColumn(index: Int, count: Int, halfGap: Float, line: Color, content: @Composable () -> Unit) {
    Column(Modifier.drawBehind {
        if (count > 1) {
            val y = 0.75.dp.toPx()
            val mid = size.width / 2
            val from = if (index == 0) mid else -halfGap
            val to = if (index == count - 1) mid else size.width + halfGap
            drawLine(line, Offset(from, y), Offset(to, y), strokeWidth = 1.5.dp.toPx())
        }
    }, horizontalAlignment = Alignment.CenterHorizontally) {
        Box(Modifier.width(1.5.dp).height(STUB).background(line))
        content()
    }
}

/** A person card; colour follows the ROLE (depth can be anything), as the web's PersonCard. */
@Composable
private fun PersonCard(p: WsMember, reports: Int, rootless: Boolean, onTap: (WsMember) -> Unit) {
    val c = Nx.colors
    val senior = ChartLogic.isSenior(p)
    val manager = p.role == "MANAGER"
    val filled = senior || manager
    val fg = if (filled) Color.White else c.foreground
    val sub = if (filled) Color.White.copy(alpha = 0.75f) else c.mutedFg
    val hours = if (p.flexiTimeEnabled) null else p.attendanceShiftStartTime?.takeIf { it.isNotEmpty() }?.let { s ->
        p.attendanceShiftEndTime?.takeIf { it.isNotEmpty() }?.let { e -> "${ChartLogic.to12(s)}–${ChartLogic.to12(e)}" }
    }
    Box {
        Row(Modifier.width(150.dp).clip(RoundedCornerShape(10.dp)).background(if (senior) SENIOR else if (manager) MANAGER else c.card)
            .then(if (filled) Modifier else Modifier.border(1.dp, c.border, RoundedCornerShape(10.dp)))
            .clickable { onTap(p) }.padding(horizontal = 8.dp, vertical = 7.dp), verticalAlignment = Alignment.CenterVertically) {
            Avatar(p.name, p.avatar, 28.dp); Spacer(Modifier.width(8.dp))
            Column {
                Text(p.displayName, fontSize = 12.sp, fontWeight = FontWeight.Bold, color = fg, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(Roles.label(p.role) + if (reports > 0) " · $reports" else "", fontSize = 9.5.sp, fontWeight = FontWeight.SemiBold, color = sub)
                Row(verticalAlignment = Alignment.CenterVertically) {
                    if (p.flexiTimeEnabled) Text("⚡ Flexi", fontSize = 9.sp, fontWeight = FontWeight.Bold, color = if (filled) Color(0xFFFBBF24) else c.warning)
                    else hours?.let { Text(it, fontSize = 9.sp, color = sub, maxLines = 1) }
                    if (p.noGeofenceMode) { Spacer(Modifier.width(5.dp)); Icon(Icons.Filled.PhoneAndroid, null, Modifier.size(10.dp), tint = if (filled) Color.White else c.violetText) }
                }
            }
        }
        if (rootless) Text(stringResource(R.string.ch_no_approver), fontSize = 8.5.sp, fontWeight = FontWeight.Bold, color = Color(0xFF92400E),
            modifier = Modifier.align(Alignment.TopEnd).padding(end = 6.dp).graphicsLayer { translationY = -8.dp.toPx() }
                .background(Color(0xFFFEF3C7), CircleShape).border(1.dp, Color(0xFFFCD34D), CircleShape).padding(horizontal = 5.dp, vertical = 1.dp))
    }
}
