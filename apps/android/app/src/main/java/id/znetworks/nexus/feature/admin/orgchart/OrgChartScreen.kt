package id.znetworks.nexus.feature.admin.orgchart

import id.znetworks.nexus.R
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import android.content.Context
import android.graphics.BitmapFactory
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.AnimationVector2D
import androidx.compose.animation.core.VectorConverter
import androidx.compose.animation.core.exponentialDecay
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.calculateCentroid
import androidx.compose.foundation.gestures.calculatePan
import androidx.compose.foundation.gestures.calculateZoom
import androidx.compose.foundation.horizontalScroll
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
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.wrapContentSize
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.AccountTree
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.FitScreen
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.TransformOrigin
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.input.pointer.positionChanged
import androidx.compose.ui.input.pointer.util.VelocityTracker
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.layout.Layout
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import id.znetworks.nexus.NexusApplication
import id.znetworks.nexus.core.net.ApiError
import id.znetworks.nexus.feature.admin.dismissKeyboardOnTapOrDrag
import id.znetworks.nexus.ui.components.Avatar
import id.znetworks.nexus.ui.components.describe
import id.znetworks.nexus.ui.theme.DisplayFont
import id.znetworks.nexus.ui.theme.Nx
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlin.math.max
import kotlin.math.min

/**
 * Control Room › Bagan IP & Divisi (replaces the old Teams screen; team data was deleted on the server
 * 30 Sep 2026). The web is final (5 Oct 2026, OrgChart.tsx); this is its behaviour on a phone: the same
 * layout engine on sizes MEASURED from these views, three views (Ringkas, per IP, Lengkap), pinch zoom
 * and pan with inertia, "Pas layar". Read: Manager and above; edit: BoD / One Above All. The web's
 * dragged positions are read (Lengkap) and never written. Copy is the web's Indonesian.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun OrgChartScreen(onBack: () -> Unit) {
    val c = Nx.colors
    val context = LocalContext.current
    val res = context.resources
    val container = (context.applicationContext as NexusApplication).container
    val api = remember { OrgChartApi(container.api) }
    val scope = rememberCoroutineScope()
    val viewer = container.viewer
    var canEdit by remember { mutableStateOf(viewer.isBoD) }
    LaunchedEffect(Unit) { viewer.load(); canEdit = viewer.isBoD }

    var data by remember { mutableStateOf<OrgChartData?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var tick by remember { mutableIntStateOf(0) }
    LaunchedEffect(tick) {
        try { data = api.chart(); error = null } catch (e: ApiError) { if (data == null) error = (e as? ApiError.Http)?.serverMessage ?: e.describe(res) }
    }
    val prefs = remember { context.getSharedPreferences("nexus.orgChart", Context.MODE_PRIVATE) }
    // "ringkas" | "lengkap" | "u:<unitId>", remembered per device.
    var view by remember { mutableStateOf(runCatching { prefs.getString("view", null) }.getOrNull() ?: "ringkas") }
    fun setView(v: String) { view = v; runCatching { prefs.edit().putString("view", v).apply() } }

    var editing by remember { mutableStateOf<OrgUnit?>(null) }
    var adding by remember { mutableStateOf<String?>(null) }
    var addingOpen by remember { mutableStateOf(false) }
    var placing by remember { mutableStateOf<String?>(null) }
    var notice by remember { mutableStateOf<String?>(null) }

    Column(Modifier.fillMaxSize().background(c.background).dismissKeyboardOnTapOrDrag()) {
        val d = data
        val tree = remember(d) { d?.let(::OrgTree) }
        val focusId = view.takeIf { it.startsWith("u:") }?.substring(2)?.takeIf { tree?.byId?.containsKey(it) == true }
        val mode = if (focusId != null) ChartMode.FOKUS else if (view == "lengkap") ChartMode.LENGKAP else ChartMode.RINGKAS
        var fitRequest by remember { mutableIntStateOf(0) }

        Row(Modifier.fillMaxWidth().padding(4.dp), verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, stringResource(R.string.back)) }
            Text(stringResource(R.string.oc_title), fontFamily = DisplayFont, fontWeight = FontWeight.Bold, fontSize = 18.sp, color = c.foreground, modifier = Modifier.weight(1f))
            if (tree != null) IconButton(onClick = { fitRequest++ }) { Icon(Icons.Filled.FitScreen, stringResource(R.string.oc_fit)) }
            if (tree != null && canEdit) TextButton(onClick = { adding = focusId ?: tree.roots.singleOrNull()?.id; addingOpen = true }) {
                Icon(Icons.Filled.Add, null, Modifier.size(16.dp)); Spacer(Modifier.width(4.dp)); Text(stringResource(R.string.oc_add), fontWeight = FontWeight.SemiBold)
            }
        }
        if (tree == null) {
            Box(Modifier.fillMaxSize().padding(24.dp), contentAlignment = Alignment.Center) {
                if (error == null) CircularProgressIndicator()
                else Text(stringResource(R.string.oc_load_failed) + "\n" + error.orEmpty(), color = c.mutedFg, textAlign = TextAlign.Center, fontSize = 13.sp)
            }
            return@Column
        }
        val unplaced = tree.people.filter { it.unitIds.isEmpty() }
        // Stats strip.
        Row(Modifier.fillMaxWidth().background(c.card).horizontalScroll(rememberScrollState()).padding(horizontal = 14.dp, vertical = 8.dp),
            horizontalArrangement = Arrangement.spacedBy(14.dp), verticalAlignment = Alignment.CenterVertically) {
            Stat("${d!!.stats.units}", stringResource(R.string.oc_stat_units))
            if (d.stats.groups > 0) Stat("${d.stats.groups}", stringResource(R.string.oc_stat_groups))
            Stat("${d.stats.placed} / ${d.stats.people}", stringResource(R.string.oc_stat_placed))
            Stat("${unplaced.size}", stringResource(R.string.oc_stat_unplaced), if (unplaced.isEmpty()) c.success else c.warning)
            if (!canEdit) Text(stringResource(R.string.oc_read_only), fontSize = 11.sp, color = c.mutedFg)
        }
        // View chips: Ringkas, Lengkap, then one per card right under the top.
        val activeTop = remember(focusId, tree) {
            if (focusId == null) null else {
                val tops = tree.topUnits.map { it.id }.toSet()
                val seen = HashSet<String>()
                var id: String? = focusId
                var found: String? = null
                while (id != null && seen.add(id)) { if (id in tops) { found = id; break }; id = tree.byId[id]?.parentId }
                found
            }
        }
        Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = 12.dp, vertical = 8.dp),
            horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
            ViewChip(stringResource(R.string.oc_view_summary), mode == ChartMode.RINGKAS) { setView("ringkas") }
            ViewChip(stringResource(R.string.oc_view_full), mode == ChartMode.LENGKAP) { setView("lengkap") }
            if (tree.topUnits.isNotEmpty()) Box(Modifier.width(1.dp).height(16.dp).background(c.border))
            tree.topUnits.forEach { u -> ViewChip(u.name, activeTop == u.id, logo = if (u.kind == "IP") u.logoUrl else null) { setView("u:${u.id}") } }
        }
        if (mode == ChartMode.FOKUS) {
            val trail = remember(focusId, tree) {
                val out = ArrayDeque<OrgUnit>(); val seen = HashSet<String>()
                var u = tree.byId[focusId]
                while (u != null && seen.add(u.id)) { out.addFirst(u); u = u.parentId?.let(tree.byId::get) }
                out.toList()
            }
            if (trail.size > 1) Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = 14.dp).padding(bottom = 6.dp),
                verticalAlignment = Alignment.CenterVertically) {
                trail.forEachIndexed { i, u ->
                    if (i > 0) Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, stringResource(R.string.next), tint = c.mutedFg, modifier = Modifier.size(14.dp))
                    if (i == trail.lastIndex) Text(u.name, fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = c.foreground)
                    else Text(u.name, fontSize = 12.sp, color = c.mutedFg, modifier = Modifier.clip(RoundedCornerShape(4.dp))
                        .clickable { setView(if (i == 0) "ringkas" else "u:${u.id}") }.padding(horizontal = 4.dp, vertical = 2.dp))
                }
            }
        }
        HorizontalDivider(color = c.border)

        if (tree.units.isEmpty()) {
            Column(Modifier.fillMaxWidth().padding(24.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                Text(stringResource(R.string.oc_empty_title), fontWeight = FontWeight.Bold, fontSize = 16.sp, color = c.foreground)
                Text(stringResource(R.string.oc_empty_body),
                    fontSize = 13.sp, color = c.mutedFg, textAlign = TextAlign.Center)
                if (canEdit) TextButton(onClick = { adding = null; addingOpen = true }) { Text(stringResource(R.string.oc_empty_add), fontWeight = FontWeight.Bold) }
            }
        } else {
            ChartCanvas(tree, mode, focusId, fitRequest, Modifier.weight(1f).fillMaxWidth(),
                onCard = { u -> if (canEdit) editing = u else if (tree.childUnits[u.id].orEmpty().isNotEmpty() && focusId != u.id) setView("u:${u.id}") },
                onPerson = { p -> if (canEdit) placing = p.userId })
        }
        // "Belum ditaruh" under the canvas.
        Column(Modifier.fillMaxWidth().background(c.muted.copy(alpha = 0.4f)).padding(horizontal = 14.dp, vertical = 10.dp)) {
            Text(pluralStringResource(R.plurals.oc_unplaced_label, unplaced.size, unplaced.size), fontSize = 10.5.sp, fontWeight = FontWeight.Bold, letterSpacing = 1.sp, color = c.mutedFg)
            if (unplaced.isEmpty()) Text(stringResource(R.string.oc_unplaced_none), fontSize = 12.sp, color = c.success)
            else Row(Modifier.horizontalScroll(rememberScrollState()).padding(top = 6.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                unplaced.forEach { p ->
                    Row(Modifier.clip(RoundedCornerShape(10.dp)).background(c.card).border(1.dp, c.border, RoundedCornerShape(10.dp))
                        .clickable(enabled = canEdit) { placing = p.userId }.padding(horizontal = 8.dp, vertical = 5.dp), verticalAlignment = Alignment.CenterVertically) {
                        Avatar(p.name, p.avatar, 22.dp, userId = p.userId); Spacer(Modifier.width(6.dp))
                        Text(p.label, fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = c.foreground, maxLines = 1)
                    }
                }
            }
        }

        val reload = { tick++ }
        editing?.let { u ->
            UnitSheet(tree, api, unit = u, parentId = u.parentId, onAddChild = { editing = null; adding = u.id; addingOpen = true },
                onFocus = if (focusId == u.id) null else ({ editing = null; setView("u:${u.id}") }),
                onClose = { editing = null }, onSaved = { msg -> editing = null; notice = msg; reload() })
        }
        if (addingOpen) UnitSheet(tree, api, unit = null, parentId = adding, onAddChild = {}, onFocus = null,
            onClose = { addingOpen = false }, onSaved = { msg -> addingOpen = false; notice = msg; reload() })
        placing?.let { id -> tree.people.firstOrNull { it.userId == id } }?.let { p ->
            PersonSheet(tree, api, p, onChanged = { msg -> notice = msg; reload() }, onClose = { placing = null })
        }
    }
    notice?.let { n -> LaunchedEffect(n) { kotlinx.coroutines.delay(2600); notice = null } }
    notice?.let { Toastish(it) }
}

@Composable
private fun Stat(n: String, label: String, tone: Color? = null) {
    val c = Nx.colors
    Row(verticalAlignment = Alignment.Bottom) {
        Text(n, fontSize = 13.sp, fontWeight = FontWeight.Bold, color = tone ?: c.foreground)
        Spacer(Modifier.width(4.dp))
        Text(label, fontSize = 11.sp, color = tone ?: c.mutedFg, maxLines = 1)
    }
}

@Composable
private fun ViewChip(text: String, active: Boolean, logo: String? = null, onClick: () -> Unit) {
    val c = Nx.colors
    val dark = c.background.luminance() < 0.5f
    val on = if (dark) Color(0xFF9FB6D6) else Color(0xFF1E3A5F)
    Row(Modifier.clip(CircleShape).background(if (active) on else c.background).border(1.dp, if (active) on else c.border, CircleShape)
        .clickable(onClick = onClick).padding(horizontal = 12.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
        if (logo != null) { UnitLogo(logo, null, 18, CircleShape); Spacer(Modifier.width(6.dp)) }
        Text(text, fontSize = 12.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, color = if (active) (if (dark) Color(0xFF0F1B2D) else Color.White) else c.mutedFg)
    }
}

@Composable
private fun Toastish(text: String) {
    Box(Modifier.fillMaxSize().padding(24.dp), contentAlignment = Alignment.BottomCenter) {
        Text(text, color = Color.White, fontSize = 13.sp, modifier = Modifier.clip(RoundedCornerShape(12.dp)).background(Color(0xE6202023)).padding(horizontal = 14.dp, vertical = 10.dp))
    }
}

// ── the canvas ──────────────────────────────────────────────────────────────────────────────────

private class Measured(val sizes: Map<String, Size>, val chips: Map<String, ChipSpot>)

/**
 * Every card, people box and group title is laid out once, unseen, to MEASURE it (as the web's hidden
 * tray); the layout engine places them from those sizes; the visible canvas draws them there, with the
 * connectors under the cards. Pinch zoom + pan with inertia, double-tap and "Pas layar" fit.
 */
@Composable
internal fun ChartCanvas(tree: OrgTree, mode: ChartMode, focusId: String?, fitRequest: Int, modifier: Modifier, onCard: (OrgUnit) -> Unit, onPerson: (OrgPerson) -> Unit) {
    val c = Nx.colors
    val density = LocalDensity.current
    val dark = c.background.luminance() < 0.5f
    val lineColor = if (dark) Color(0xFF3E4C61) else Color(0xFFB4C1D3)
    val groupFill = if (dark) Color(0x0F94A3B8) else Color(0x0B1E3A5F)
    val groupLine = if (dark) Color(0x2994A3B8) else Color(0x1C1E3A5F)
    val keys = remember(tree) { elementKeys(tree) }
    var measured by remember(tree, mode) { mutableStateOf<Measured?>(null) }

    // The unseen tray: measured with no limits, never placed (so never drawn or touched).
    val chipBuf = remember(tree, mode) { HashMap<String, ChipSpot>() }
    Layout(content = {
        for (k in keys) Box { Element(tree, mode, k, interactive = false, onCard = {}, onPerson = {}, chipSink = { key, spot -> chipBuf[key] = spot }) }
    }) { ms, _ ->
        val sizes = HashMap<String, Size>()
        ms.forEachIndexed { i, m ->
            val p = m.measure(Constraints())
            sizes[keys[i]] = Size(p.width / density.density.toDouble(), p.height / density.density.toDouble())
        }
        val next = Measured(sizes, chipBuf.mapValues { (_, s) -> ChipSpot(s.box, s.dx / density.density, s.dy / density.density, s.w / density.density, s.h / density.density) })
        val prev = measured
        if (prev == null || prev.sizes != next.sizes || prev.chips != next.chips) measured = next
        layout(0, 0) {}
    }

    val m = measured
    val chart = remember(m, tree, mode, focusId) { m?.let { layoutChart(tree, mode, focusId, it.sizes, it.chips) } }
    var viewport by remember { mutableStateOf(IntSize.Zero) }
    val transform = remember { Animatable(Offset.Zero, Offset.VectorConverter) }
    var scale by remember { mutableStateOf(1f) }
    val scope = rememberCoroutineScope()
    fun fit() {
        val l = chart ?: return
        if (viewport.width == 0) return
        val nw = (l.width * density.density).toFloat(); val nh = (l.height * density.density).toFloat()
        val pad = 32 * density.density
        val s = minOf((viewport.width - pad) / nw, (viewport.height - pad) / nh, 1.2f).coerceIn(0.2f, 2.5f)
        scale = s
        scope.launch { transform.snapTo(Offset((viewport.width - nw * s) / 2f, max(16 * density.density, (viewport.height - nh * s) / 2f))) }
    }
    // Fit on the first layouts after the view changes, and when asked.
    LaunchedEffect(chart, viewport, fitRequest) { fit() }

    Box(modifier.clipToBounds().onSizeChanged { viewport = it }
        .pointerInput(chart) {
            awaitEachGesture {
                awaitFirstDown(requireUnconsumed = false)
                scope.launch { transform.stop() }
                val tracker = VelocityTracker()
                var moved = false
                do {
                    val ev = awaitPointerEvent()
                    val zoom = ev.calculateZoom(); val pan = ev.calculatePan(); val centroid = ev.calculateCentroid()
                    if (zoom != 1f || pan != Offset.Zero) {
                        val next = (scale * zoom).coerceIn(0.2f, 2.5f)
                        // Zoom about the fingers: the point under them stays put.
                        val o = (transform.value - centroid) * (next / scale) + centroid + pan
                        scale = next
                        scope.launch { transform.snapTo(o) }
                        if (pan.getDistance() > 0.5f) moved = true
                    }
                    ev.changes.firstOrNull()?.let { tracker.addPosition(it.uptimeMillis, it.position) }
                    if (moved) ev.changes.forEach { if (it.positionChanged()) it.consume() }
                } while (ev.changes.any { it.pressed })
                if (moved) {
                    val v = tracker.calculateVelocity()
                    scope.launch { transform.animateDecay(Offset(v.x, v.y), exponentialDecay(frictionMultiplier = 1.6f)) }
                }
            }
        }) {
        val l = chart
        if (l == null) { Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }; return@Box }
        Box(Modifier.wrapContentSize(Alignment.TopStart, unbounded = true)
            .graphicsLayer { transformOrigin = TransformOrigin(0f, 0f); scaleX = scale; scaleY = scale; translationX = transform.value.x; translationY = transform.value.y }) {
            Box(Modifier.size(l.width.dp, l.height.dp)) {
                // Group frames under everything.
                for ((k, r) in l.rects) if (k.startsWith("c:") && tree.byId[k.substring(2)]?.isGroup == true) {
                    val n = tree.childUnits[k.substring(2)].orEmpty().size
                    Box(Modifier.offset(r.x.dp, r.y.dp).size(r.w.dp, r.h.dp).clip(RoundedCornerShape(18.dp)).background(groupFill).border(1.dp, groupLine, RoundedCornerShape(18.dp))) {
                        if (n == 0) Text(stringResource(R.string.oc_drop_here), fontSize = 11.sp, color = c.mutedFg, textAlign = TextAlign.Center,
                            modifier = Modifier.align(Alignment.BottomCenter).fillMaxWidth().height(LAYOUT.gEmpty.dp).wrapContentSize())
                    }
                }
                Canvas(Modifier.size(l.width.dp, l.height.dp)) {
                    val k = density.density
                    for (line in l.lines) {
                        val path = Path()
                        for (step in pathRounded(line.pts)) when (step) {
                            is PathStep.Move -> path.moveTo((step.x * k).toFloat(), (step.y * k).toFloat())
                            is PathStep.Line -> path.lineTo((step.x * k).toFloat(), (step.y * k).toFloat())
                            is PathStep.Quad -> path.quadraticTo((step.cx * k).toFloat(), (step.cy * k).toFloat(), (step.x * k).toFloat(), (step.y * k).toFloat())
                        }
                        drawPath(path, lineColor, style = Stroke(width = 1.5f * k, cap = StrokeCap.Round, join = StrokeJoin.Round))
                    }
                }
                for ((k, r) in l.rects) {
                    if (k.startsWith("c:") && tree.byId[k.substring(2)]?.isGroup == true) continue
                    Box(Modifier.offset(r.x.dp, r.y.dp).width(r.w.dp)) {
                        Element(tree, mode, k, interactive = true, onCard = onCard, onPerson = onPerson, chipSink = null)
                    }
                }
            }
        }
    }
}

/** One element by key: a card ("c:"), a people box ("b:<id>:<kind>") or a group's title ("t:"). */
@Composable
private fun Element(tree: OrgTree, mode: ChartMode, key: String, interactive: Boolean, onCard: (OrgUnit) -> Unit, onPerson: (OrgPerson) -> Unit,
                    chipSink: ((String, ChipSpot) -> Unit)?) {
    val parts = key.split(":")
    val u = tree.byId[parts.getOrNull(1)] ?: return
    when (parts[0]) {
        "t" -> GroupTitle("${u.name} · ${tree.childUnits[u.id].orEmpty().size}")
        "c" -> UnitCard(u, tree.cardInfo(u, mode), if (interactive) ({ onCard(u) }) else null)
        else -> {
            val g = tree.groups[u.id] ?: return
            val kind = parts.drop(2).joinToString(":")
            PeopleBox(u.id, key, kind, boxPeople(g, kind), boxLabelText(boxLabel(g, kind, tree.people)), if (interactive) onPerson else null, chipSink)
        }
    }
}

@Composable
private fun GroupTitle(text: String) {
    val c = Nx.colors
    val dark = c.background.luminance() < 0.5f
    Text(text.uppercase(), fontSize = 10.sp, fontWeight = FontWeight.Bold, letterSpacing = 1.2.sp, color = c.mutedFg, maxLines = 1, softWrap = false,
        modifier = Modifier.clip(CircleShape).background(c.card).border(1.dp, if (dark) Color(0x2994A3B8) else Color(0x1C1E3A5F), CircleShape)
            .padding(horizontal = 10.dp, vertical = 3.dp))
}

private class Tone(val bg: Color, val fg: Color, val border: Color?, val meta: Color)
@Composable
private fun toneOf(t: CardTone): Tone {
    val dark = Nx.colors.background.luminance() < 0.5f
    return when (t) {
        CardTone.ROOT -> Tone(Color(0xFF0F2742), Color.White, null, Color.White.copy(alpha = 0.7f))
        CardTone.IP -> Tone(Color(0xFF1E3A5F), Color.White, null, Color.White.copy(alpha = 0.7f))
        CardTone.DIVISION -> if (dark) Tone(Color(0xFF1A2A41), Color(0xFFDCE7F6), Color(0xFF2E4565), Color(0xFF9FB0C8))
            else Tone(Color(0xFFEDF2F9), Color(0xFF15304F), Color(0xFFC6D4E7), Color(0xFF5A6B83))
        CardTone.SUB -> if (dark) Tone(Color(0xFF151B26), Color(0xFFD4DCE8), Color(0xFF2B3547), Color(0xFF9FB0C8))
            else Tone(Color.White, Color(0xFF22344D), Color(0xFFD8E0EB), Color(0xFF5A6B83))
    }
}

/** Kartu IP/Team: logo (IP only) + name (2 lines) + "n people"; in Ringkas up to 4 leader faces (+n). */
@Composable
private fun UnitCard(u: OrgUnit, info: OrgTree.CardInfo, onClick: (() -> Unit)?) {
    val t = toneOf(info.tone)
    val root = info.tone == CardTone.ROOT
    val shape = RoundedCornerShape(12.dp)
    Row(Modifier.widthIn(min = if (root) 212.dp else 176.dp, max = 232.dp).clip(shape).background(t.bg)
        .then(if (t.border != null) Modifier.border(1.dp, t.border, shape) else Modifier)
        .then(if (onClick != null) Modifier.clickable(onClick = onClick) else Modifier)
        .padding(horizontal = 12.dp, vertical = if (root) 12.dp else 10.dp), verticalAlignment = Alignment.CenterVertically) {
        if (u.kind == "IP") { UnitLogo(u.logoUrl, u.name, if (root) 40 else 34, RoundedCornerShape(8.dp)); Spacer(Modifier.width(10.dp)) }
        Column(Modifier.weight(1f, fill = false)) {
            Text(u.name, fontSize = if (root) 14.sp else 13.sp, fontWeight = FontWeight.SemiBold, color = t.fg, maxLines = 2, overflow = TextOverflow.Ellipsis, lineHeight = 16.sp)
            Text(cardMeta(info), fontSize = 10.5.sp, color = t.meta, lineHeight = 13.sp)
            if (info.faces.isNotEmpty()) Row(Modifier.padding(top = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                info.faces.take(4).forEachIndexed { i, p ->
                    Box(Modifier.offset(x = (-6 * i).dp).clip(CircleShape).background(t.bg).padding(2.dp)) { Avatar(p.name, p.avatar, 20.dp, userId = p.userId) }
                }
                if (info.faces.size > 4) Text("+${info.faces.size - 4}", fontSize = 10.sp, fontWeight = FontWeight.SemiBold, color = t.meta, modifier = Modifier.offset(x = (-6 * 3).dp))
            }
        }
    }
}

/**
 * A people box: label, then BoD / Manager rows side by side, staff and "di bawah" stacked (≥ 6 people:
 * two columns). Laid out by hand so every leader's chip position is known while measuring (the web's
 * data-oc-chip), which the leader lines start from.
 */
@Composable
private fun PeopleBox(unitId: String, boxKey: String, kind: String, list: List<OrgPerson>, title: String, onPerson: ((OrgPerson) -> Unit)?,
                      chipSink: ((String, ChipSpot) -> Unit)?) {
    val c = Nx.colors
    val horizontal = kind == "bod" || kind == "manager"
    val twoCols = !horizontal && list.size >= 6
    val density = LocalDensity.current
    Layout(
        modifier = Modifier.clip(RoundedCornerShape(12.dp)).background(c.card).border(1.dp, c.border, RoundedCornerShape(12.dp)),
        content = {
            Text(title.uppercase(), fontSize = 9.5.sp, fontWeight = FontWeight.Bold, letterSpacing = 1.sp, color = c.mutedFg, textAlign = TextAlign.Center, maxLines = 1)
            list.forEach { p -> PersonRow(p, unitId, onPerson) }
        },
    ) { ms, _ ->
        val pad = (6 * density.density).toInt(); val gx = (4 * density.density).toInt(); val gy = (2 * density.density).toInt(); val lb = (5 * density.density).toInt()
        val minRow = (148 * density.density).toInt(); val maxRow = (212 * density.density).toInt()
        val rows = ms.drop(1).map { it.measure(Constraints(minWidth = minRow, maxWidth = maxRow)) }
        val colW = rows.maxOfOrNull { it.width } ?: minRow
        val cols = if (horizontal) max(1, rows.size) else if (twoCols) 2 else 1
        val innerW = if (horizontal) rows.sumOf { it.width } + gx * max(0, rows.size - 1) else cols * colW + (cols - 1) * gx
        val label = ms[0].measure(Constraints(minWidth = innerW, maxWidth = innerW))
        val spots = ArrayList<Pair<Int, Int>>()
        var y0 = pad + label.height + lb
        var h: Int
        if (horizontal) {
            var x = pad
            rows.forEach { r -> spots += x to y0; x += r.width + gx }
            h = y0 + (rows.maxOfOrNull { it.height } ?: 0) + pad
        } else {
            var colY = IntArray(cols) { y0 }
            rows.forEachIndexed { i, r ->
                val col = if (twoCols) i % 2 else 0
                if (twoCols && col == 0 && i > 0) { val top = colY.max(); colY = IntArray(cols) { top } }
                spots += (pad + col * (colW + gx)) to colY[col]
                colY[col] += r.height + gy
            }
            h = colY.max() - (if (rows.isNotEmpty()) gy else 0) + pad
        }
        val w = innerW + 2 * pad
        list.forEachIndexed { i, p ->
            if (p.isLead) chipSink?.invoke("$unitId:${p.userId}", ChipSpot(boxKey, spots[i].first.toDouble(), spots[i].second.toDouble(), rows[i].width.toDouble(), rows[i].height.toDouble()))
        }
        layout(w, h) {
            label.place(pad, pad)
            rows.forEachIndexed { i, r -> r.place(spots[i].first, spots[i].second) }
        }
    }
}

@Composable
private fun PersonRow(p: OrgPerson, unitId: String, onPerson: ((OrgPerson) -> Unit)?) {
    val c = Nx.colors
    val extra = if (p.unitIds.size > 1) p.unitIds.size - 1 else 0
    val title = p.titles[unitId]
    Row(Modifier.clip(RoundedCornerShape(8.dp)).then(if (onPerson != null) Modifier.clickable { onPerson(p) } else Modifier)
        .padding(horizontal = 6.dp, vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
        Avatar(p.name, p.avatar, 26.dp, userId = p.userId)
        Spacer(Modifier.width(8.dp))
        Column(Modifier.weight(1f, fill = false)) {
            Text(p.label, fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = c.foreground, maxLines = 1, overflow = TextOverflow.Ellipsis, lineHeight = 14.sp)
            Text(listOfNotNull(title, ROLE_SUB[p.role] ?: p.role, if (extra > 0) pluralStringResource(R.plurals.oc_other_units, extra, extra) else null).joinToString(" · "),
                fontSize = 10.sp, color = c.mutedFg, maxLines = 1, overflow = TextOverflow.Ellipsis, lineHeight = 12.sp)
        }
    }
}

/**
 * Logos: mostly-light ones (white text PNG) on #0f1b2d, the others on white; initials when there is none.
 * Decoded down to at most [LOGO_MAX_PX] (an upload may be 2 MB / 2000 px), kept in a 4 MB LRU that is safe
 * to touch from the IO decode and the main thread (Calendar audit 2 #11).
 */
private const val LOGO_MAX_PX = 256
private val logoCache = object : android.util.LruCache<String, Pair<ImageBitmap, Boolean>>(4 * 1024 * 1024) {
    override fun sizeOf(key: String, value: Pair<ImageBitmap, Boolean>) = value.first.width * value.first.height * 4
}
@Composable
internal fun UnitLogo(url: String?, name: String?, size: Int, shape: androidx.compose.ui.graphics.Shape, fallback: (@Composable () -> Unit)? = null) {
    val api = (LocalContext.current.applicationContext as NexusApplication).container.api
    var img by remember(url) { mutableStateOf(url?.let { logoCache.get(it) }) }
    LaunchedEffect(url) {
        if (url == null || img != null) return@LaunchedEffect
        img = withContext(Dispatchers.IO) {
            runCatching {
                val bytes = api.bytes(url)
                val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
                BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
                var sample = 1
                while (maxOf(bounds.outWidth, bounds.outHeight) / (sample * 2) >= LOGO_MAX_PX) sample *= 2
                val bmp = BitmapFactory.decodeByteArray(bytes, 0, bytes.size, BitmapFactory.Options().apply { inSampleSize = sample }) ?: return@runCatching null
                val small = android.graphics.Bitmap.createScaledBitmap(bmp, 32, 32, true)
                var sum = 0.0; var n = 0
                for (x in 0 until 32) for (y in 0 until 32) {
                    val px = small.getPixel(x, y)
                    if (android.graphics.Color.alpha(px) / 255.0 < 0.2) continue
                    sum += (0.2126 * android.graphics.Color.red(px) + 0.7152 * android.graphics.Color.green(px) + 0.0722 * android.graphics.Color.blue(px)) / 255.0; n++
                }
                (bmp.asImageBitmap() to (n > 0 && sum / n > 0.72)).also { logoCache.put(url, it) }
            }.getOrNull()
        }
    }
    val im = img
    if (im != null) {
        Image(im.first, null, contentScale = ContentScale.Fit, modifier = Modifier.size(size.dp).clip(shape).background(if (im.second) Color(0xFF0F1B2D) else Color.White).padding(2.dp))
    } else if (fallback != null) fallback()
    else if (name != null) {
        Box(Modifier.size(size.dp).clip(shape).background(Color.White.copy(alpha = 0.15f)), contentAlignment = Alignment.Center) {
            Text(initialsOf(name), fontSize = 11.sp, fontWeight = FontWeight.Bold, color = Color.White)
        }
    }
}

/** "4 people · 7 parts" / "no one yet": the card's line in the app's language. */
@Composable
private fun cardMeta(info: OrgTree.CardInfo): String = listOfNotNull(
    if (info.people > 0) pluralStringResource(R.plurals.oc_people_n, info.people, info.people) else stringResource(R.string.oc_nobody_yet),
    if (info.parts > 0) pluralStringResource(R.plurals.oc_parts_n, info.parts, info.parts) else null,
).joinToString(" · ")

@Composable
private fun boxLabelText(l: BoxLabel): String = when (l.kind) {
    BoxLabel.Kind.BOD -> stringResource(R.string.oc_box_bod, l.n)
    BoxLabel.Kind.MANAGER -> stringResource(R.string.oc_box_manager, l.n)
    BoxLabel.Kind.STAFF -> pluralStringResource(R.plurals.oc_people_n, l.n, l.n)
    BoxLabel.Kind.UNDER -> stringResource(R.string.oc_box_under, l.leaderFirstName ?: "?", l.n)
}
