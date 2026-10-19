package id.znetworks.nexus.feature.admin

import androidx.compose.foundation.*
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.repeatOnLifecycle
import id.znetworks.nexus.NexusApplication
import id.znetworks.nexus.R
import id.znetworks.nexus.core.net.ApiError
import id.znetworks.nexus.core.net.NexusJson
import id.znetworks.nexus.core.realtime.*
import id.znetworks.nexus.core.time.OfficeTime
import id.znetworks.nexus.feature.gideon.GideonTier
import id.znetworks.nexus.feature.gideon.GPicker
import id.znetworks.nexus.ui.theme.Nx
import kotlinx.coroutines.*
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import java.text.NumberFormat
import java.time.Instant
import java.time.format.DateTimeFormatter

@Composable fun GideonPerformanceTab() {
    val container = (LocalContext.current.applicationContext as NexusApplication).container
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    val c = Nx.colors
    var data by remember { mutableStateOf<GideonPerformance?>(null) }
    var error by remember { mutableStateOf(false) }
    var denied by remember { mutableStateOf(false) }
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    val lock = remember { Mutex() }
    suspend fun refresh() = lock.withLock {
        if (denied) return@withLock
        try { data = container.api.get("/api/gideon/perf", GideonPerformance.serializer()); error = false }
        catch (e: ApiError) { if (e is ApiError.Http && e.status == 403) { denied = true; data = null } else error = true }
    }
    RealtimeRoom(if (!denied) "gideon:perf" else null)
    LaunchedEffect(lifecycle) {
        lifecycle.repeatOnLifecycle(Lifecycle.State.RESUMED) {
            launch { refresh(); while (true) { delay(60_000); refresh() } }
            launch { while (true) { now = System.currentTimeMillis(); delay(1_000) } }
            launch {
                var pending: Job? = null
                container.realtime.events.collect { e ->
                    when (e.name) {
                        RealtimeEvents.JOIN_DENIED -> if (e.raw?.contains("gideon:perf") == true) { denied = true; data = null; pending?.cancel() }
                        RealtimeEvents.RECONNECTED -> refresh()
                        "gideon-perf" -> {
                            val event = e.raw?.let { runCatching { NexusJson.decodeFromString(PerfEvent.serializer(), it) }.getOrNull() }
                            val old = data
                            val flip = event?.live?.let { old?.live?.engine?.up != it.engine.up } == true
                            if (old != null && event?.live != null) data = PerformanceRules.replaceLive(old, event.live)
                            if (event?.kind == "alerts") refresh()
                            else if (flip || event?.kind in setOf("runs", "gpu+model0")) {
                                pending?.cancel(); pending = launch { delay(1_500); refresh() }
                            }
                        }
                    }
                }
            }
        }
    }
    if (denied) { Text(stringResource(R.string.ad_no_access), color = c.mutedFg, modifier = Modifier.padding(24.dp)); return }
    val d = data
    if (d == null) {
        Column(Modifier.fillMaxWidth().padding(24.dp)) {
            if (error) { Text(stringResource(R.string.perf_failed), color = c.dangerText); val scope = rememberCoroutineScope(); TextButton(onClick = { scope.launch { refresh() } }) { Text(stringResource(R.string.gx_try_again)) } }
            else CircularProgressIndicator()
        }; return
    }
    val locale = LocalConfiguration.current.locales[0]
    val nf = remember(locale) { NumberFormat.getNumberInstance(locale).apply { maximumFractionDigits = 1 } }
    fun n(v: Number?) = v?.let(nf::format) ?: "—"
    fun ms(v: Double?) = v?.let { if (it < 1000) n(it) + " ms" else n(it / 1000) + " s" } ?: "—"
    fun at(value: String?) = value?.let { runCatching { Instant.parse(it).atZone(OfficeTime.ZONE).format(DateTimeFormatter.ofPattern("HH:mm:ss", locale)) }.getOrNull() } ?: "—"
    val stale = PerformanceRules.stale(d.telemetry, Instant.ofEpochMilli(now))
    LazyColumn(contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        item { Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Row(Modifier.fillMaxWidth().background(c.card, RoundedCornerShape(14.dp)).padding(12.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                PerfTile(R.string.rev_perf_answers24, n(d.tiers.sumOf { it.answers24h }), Modifier.weight(1f))
                // The endpoint exposes failures15m, not a 24-hour error count. Never mislabel that window.
                PerfTile(R.string.rev_perf_errors24, stringResource(R.string.rev_perf_not_reported), Modifier.weight(1f))
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(5.dp)) {
                        Box(Modifier.size(7.dp).background(if (stale) c.warningFg else c.success, CircleShape))
                        Text("GPU", color = c.foreground, fontWeight = FontWeight.SemiBold, fontSize = 13.sp)
                    }
                    val age = d.telemetry.lastAt?.let { runCatching { ((now - Instant.parse(it).toEpochMilli()) / 1000).coerceAtLeast(0) }.getOrNull() }
                    Text(if (age == null) stringResource(R.string.perf_no_gpu) else stringResource(R.string.rev_perf_updated, n(age)), color = c.mutedFg, fontSize = 11.sp)
                }
            }
            Text(stringResource(R.string.perf_subtitle), color = c.mutedFg, fontSize = 11.sp)
            if (error) Text(stringResource(R.string.perf_failed), color = c.dangerText)
        } }
        items(d.alerts.filter { it.active }, key = { "alert:${it.key}" }) { a ->
            PerfCard(stringResource(when (a.key) { "model0_down" -> R.string.perf_model0_down; "error_rate" -> R.string.perf_error_rate; "vram_full" -> R.string.perf_vram_full; else -> R.string.perf_gpu_hot })) {
                Text(stringResource(R.string.perf_since, at(a.since)), color = c.dangerText)
                Text(id.znetworks.nexus.feature.gideon.GideonReview.loose(a.value) ?: "—", color = c.dangerText)
                Text(stringResource(R.string.perf_notified), color = c.mutedFg, fontSize = 12.sp)
            }
        }
        items(GideonTier.entries, key = { it.key }) { tier ->
            val row = d.tiers.firstOrNull { it.id == tier.key }
            Column(Modifier.fillMaxWidth().background(c.card, RoundedCornerShape(16.dp)).border(1.dp, c.border, RoundedCornerShape(16.dp)).padding(14.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween) {
                    Text(tier.label, fontWeight = FontWeight.SemiBold, color = c.foreground)
                    val tone = when (row?.status) { "online" -> c.success; "busy", "loading" -> c.warningFg; else -> c.dangerText }
                    Text(stringResource(when (row?.status) { "online" -> R.string.perf_online; "busy", "loading" -> R.string.perf_busy; else -> R.string.rev_perf_offline }),
                        color = tone, fontSize = 12.sp, modifier = Modifier.background(tone.copy(alpha = .12f), CircleShape).padding(horizontal = 9.dp, vertical = 4.dp))
                }
                row?.reason?.let { Text(stringResource(when (it) { "transcribing" -> R.string.perf_transcribing; "loading" -> R.string.perf_model_loading; "failing" -> R.string.perf_failing; else -> R.string.perf_down }), color = c.mutedFg, fontSize = 12.sp) }
                if (row == null || row.answers15m == 0 && row.inFlight == 0) {
                    Box(Modifier.fillMaxWidth().heightIn(min = 100.dp).background(c.muted.copy(alpha = .5f), RoundedCornerShape(12.dp)).padding(12.dp), contentAlignment = Alignment.Center) {
                        Text(stringResource(R.string.rev_perf_idle), color = c.mutedFg, fontSize = 13.sp)
                    }
                    Text(stringResource(R.string.rev_perf_answers24_count, n(row?.answers24h ?: 0)), color = c.mutedFg, fontSize = 11.sp)
                } else {
                    val metrics = listOf(
                        R.string.perf_p50 to ms(row.p50Ms), R.string.perf_p95 to ms(row.p95Ms),
                        R.string.perf_error to (row.errorRate?.let { n(it * 100) + "%" } ?: "—"), R.string.perf_inflight to n(row.inFlight),
                        R.string.perf_credits to (if (tier == GideonTier.EXPERIMENTAL) stringResource(R.string.perf_free) else n(row.avgCredits15m ?: row.avgCredits24h)),
                        R.string.rev_perf_answers24 to n(row.answers24h))
                    metrics.chunked(2).forEach { pair -> Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        pair.forEach { (label, value) -> PerfTile(label, value, Modifier.weight(1f).background(c.muted.copy(alpha = .5f), RoundedCornerShape(12.dp)).padding(10.dp)) }
                    } }
                }
            }
        }
        item { PerfCard(stringResource(R.string.perf_gpu_title)) {
            val live = d.live; val gpu = live?.gpu; val model = live?.engine?.model
            Text(gpu?.name ?: stringResource(R.string.perf_no_gpu), color = c.mutedFg, fontSize = 12.sp)
            Row {
                PerfMetric(R.string.perf_gpu_use, gpu?.util?.let { n(it) + "%" } ?: "—", Modifier.weight(1f))
                PerfMetric(R.string.perf_vram, if (gpu?.memUsedMiB != null && gpu.memTotalMiB != null) n(gpu.memUsedMiB / 1024) + " / " + n(gpu.memTotalMiB / 1024) + " GB" else "—", Modifier.weight(1f))
            }
            Row {
                PerfMetric(R.string.perf_temp, gpu?.tempC?.let { n(it) + "°C" } ?: "—", Modifier.weight(1f))
                PerfMetric(R.string.perf_power, gpu?.powerW?.let { n(it) + " W" } ?: "—", Modifier.weight(1f))
            }
            Text(stringResource(R.string.perf_alert_temp, n(d.thresholds.gpuHotC)) + " · " + stringResource(R.string.perf_power_limit, n(gpu?.powerLimitW)), color = c.mutedFg, fontSize = 11.sp)
            Text(stringResource(R.string.perf_model), fontWeight = FontWeight.SemiBold)
            if (model == null) Text(stringResource(R.string.perf_no_model), color = c.mutedFg, fontSize = 12.sp)
            else {
                Text(model.name ?: "—", color = c.foreground)
                Text(if (model.gpuShare == null) "—" else if (PerformanceRules.gpuFull(model.gpuShare)) stringResource(R.string.perf_full_gpu) else stringResource(R.string.perf_part_gpu, n(model.gpuShare * 100) + "%"), color = c.mutedFg, fontSize = 12.sp)
                Text(stringResource(R.string.perf_model_vram, n(model.sizeVramBytes?.div(1073741824.0)), n(model.sizeBytes?.div(1073741824.0))), color = c.mutedFg, fontSize = 12.sp)
            }
            PerfMetric(R.string.perf_speed, d.model0.avgEvalTps24h?.let { stringResource(R.string.perf_tps, n(it)) } ?: "—")
            Text(n(d.model0.gens24h) + " · " + (d.model0.loads.maxByOrNull { it.at }?.let { stringResource(R.string.perf_last_load, n(it.loadSec), at(it.at)) } ?: "—"), color = c.mutedFg, fontSize = 11.sp)
            PerfMetric(R.string.perf_transcriber, live?.whisper?.let { stringResource(if (!it.up) R.string.perf_unresponsive else if (it.busy) R.string.perf_whisper_busy else R.string.perf_idle) } ?: "—")
            Text(stringResource(R.string.perf_queue, n(live?.whisper?.queued)), color = c.mutedFg, fontSize = 12.sp)
        } }
        item { PerfCard(stringResource(R.string.perf_recent)) {
            Column(Modifier.horizontalScroll(rememberScrollState())) {
                Row { listOf(R.string.perf_time, R.string.perf_tokens_sec, R.string.perf_prompt, R.string.perf_tokens, R.string.perf_took).forEach { Text(stringResource(it), fontSize = 11.sp, color = c.mutedFg, modifier = Modifier.width(95.dp).padding(4.dp)) } }
                d.model0.recent.sortedByDescending { it.at }.take(8).forEach { g -> Row { listOf(at(g.at), n(g.evalTps), n(g.promptTps), n(g.outTokens), ms(g.totalMs)).forEach { Text(it, fontSize = 12.sp, modifier = Modifier.width(95.dp).padding(4.dp)) } } }
                if (d.model0.recent.isEmpty()) Text("—")
            }
        } }
        item { PerfChart(d.hours, R.string.perf_questions, tiered = true) { hour, tier -> hour.questions[tier]?.toDouble() ?: 0.0 } }
        item { PerfChart(d.hours, R.string.perf_latency, tiered = true) { hour, tier -> hour.p50Ms[tier]?.div(1000) } }
        item { PerfChart(d.hours, R.string.perf_spent, tiered = false) { hour, _ -> hour.credits } }
        item { PerfChart(d.hours, R.string.perf_cache, tiered = false, percent = true, subtitle = stringResource(R.string.perf_cache_total, PerformanceRules.cacheHit(d.hours)?.let { n(it * 100) + "%" } ?: "—")) { hour, _ -> hour.cacheHit?.times(100) } }
        item { PerfCard(stringResource(R.string.perf_quality)) {
            PerfMetric(R.string.perf_router, n(d.quality.routerMisses24h) + " / " + n(d.quality.answers24h))
            Text(stringResource(R.string.perf_router_hint), color = c.mutedFg, fontSize = 12.sp)
            d.quality.recentMisses.sortedByDescending { it.at }.take(5).forEach { Text(at(it.at) + " · " + (GideonTier.entries.firstOrNull { t -> t.key == it.tier }?.label ?: "—"), fontSize = 12.sp, color = c.mutedFg) }
            listOf(R.string.perf_top_tools to d.quality.topTools, R.string.perf_failed_tools to d.quality.failingTools).forEach { (label, tools) ->
                Text(stringResource(label), fontWeight = FontWeight.SemiBold)
                tools.forEach { tool -> Row(Modifier.fillMaxWidth()) { Text(PerformanceRules.toolName(tool.tool), modifier = Modifier.weight(1f), fontSize = 13.sp); Text(if (label == R.string.perf_top_tools) n(tool.calls) else n(tool.failures) + " / " + n(tool.calls), fontSize = 13.sp) } }
                if (tools.isEmpty()) Text("—")
            }
            PerfMetric(R.string.perf_thumbs, stringResource(R.string.perf_not_collected))
            Text(stringResource(R.string.perf_thumbs_hint), color = c.mutedFg, fontSize = 12.sp)
        } }
    }
}

@Composable private fun PerfCard(title: String, body: @Composable ColumnScope.() -> Unit) {
    Column(Modifier.fillMaxWidth().background(Nx.colors.card, RoundedCornerShape(16.dp)).border(1.dp, Nx.colors.border, RoundedCornerShape(16.dp)).padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(title, fontWeight = FontWeight.SemiBold, color = Nx.colors.foreground)
        body()
    }
}
@Composable private fun PerfMetric(label: Int, value: String, modifier: Modifier = Modifier) {
    Column(modifier.padding(vertical = 4.dp)) { Text(stringResource(label), fontSize = 11.sp, color = Nx.colors.mutedFg); Text(value, fontWeight = FontWeight.SemiBold, color = Nx.colors.foreground) }
}
@Composable private fun PerfTile(label: Int, value: String, modifier: Modifier = Modifier) {
    Column(modifier, verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text(value, fontSize = 20.sp, fontWeight = FontWeight.SemiBold, color = Nx.colors.foreground)
        Text(stringResource(label), fontSize = 11.sp, color = Nx.colors.mutedFg)
    }
}

/** The same four hourly plots as the web, with a tap target and an accessible hour picker for exact values. */
@Composable private fun PerfChart(hours: List<PerfHour>, title: Int, tiered: Boolean, percent: Boolean = false, subtitle: String? = null, value: (PerfHour, String) -> Double?) {
    val c = Nx.colors
    val locale = LocalConfiguration.current.locales[0]
    val nf = NumberFormat.getNumberInstance(locale).apply { maximumFractionDigits = 1 }
    val colors = listOf(Color(0xFF8B5CF6), Color(0xFFF97316), Color(0xFF10B981), Color(0xFF0EA5E9))
    val series = if (tiered) GideonTier.entries.map { it.key to it.label } else listOf("value" to stringResource(title))
    var selected by remember { mutableIntStateOf(-1) }
    val max = if (percent) 100.0 else hours.flatMap { h -> series.mapNotNull { value(h, it.first) } }.maxOrNull()?.coerceAtLeast(1.0) ?: 1.0
    val name = stringResource(title)
    fun time(h: PerfHour) = runCatching { Instant.parse(h.t).atZone(OfficeTime.ZONE).format(DateTimeFormatter.ofPattern("HH:mm", locale)) }.getOrDefault(h.t)
    PerfCard(name) {
        Text(subtitle ?: stringResource(if (title == R.string.perf_latency) R.string.perf_latency_hint else R.string.perf_hours), color = c.mutedFg, fontSize = 11.sp)
        Text(nf.format(max) + if (percent) "%" else "", fontSize = 10.sp, color = c.mutedFg)
        Canvas(Modifier.fillMaxWidth().height(150.dp).semantics { contentDescription = name }.pointerInput(hours) { detectTapGestures { pos -> if (hours.isNotEmpty()) selected = (pos.x / size.width * hours.size).toInt().coerceIn(hours.indices) } }) {
            repeat(5) { i -> val y = size.height * i / 4; drawLine(c.border, Offset(0f, y), Offset(size.width, y)) }
            if (hours.isNotEmpty()) {
                val width = size.width / hours.size
                series.forEachIndexed { j, (key, _) ->
                    val path = Path(); var started = false
                    hours.forEachIndexed { i, hour ->
                        val v = value(hour, key)
                        if (v == null) started = false else {
                            val x = width * (i + .5f); val y = size.height * (1 - v / max).toFloat()
                            if (!tiered) drawRect(colors[j].copy(alpha = .8f), Offset(width * i + 1, y), Size((width - 2).coerceAtLeast(1f), size.height - y))
                            else { if (started) path.lineTo(x, y) else path.moveTo(x, y); started = true }
                        }
                    }
                    if (tiered) drawPath(path, colors[j], style = androidx.compose.ui.graphics.drawscope.Stroke(2.dp.toPx()))
                }
                if (selected in hours.indices) drawLine(c.foreground.copy(alpha = .5f), Offset(width * (selected + .5f), 0f), Offset(width * (selected + .5f), size.height))
            }
        }
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) { hours.filterIndexed { i, _ -> i == 0 || i == hours.lastIndex || i == hours.size / 2 }.forEach { Text(time(it), fontSize = 10.sp, color = c.mutedFg) } }
        if (tiered) Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) { series.forEachIndexed { i, (_, label) -> Text("● $label", color = colors[i], fontSize = 10.sp) } }
        GPicker(stringResource(R.string.perf_time), hours.getOrNull(selected)?.let(::time), hours.mapIndexed { i, h -> i.toString() to time(h) }) { selected = it.toInt() }
        hours.getOrNull(selected)?.let { h -> series.forEach { (key, label) -> Text(label + " · " + (value(h, key)?.let { nf.format(it) + if (percent) "%" else "" } ?: "—"), color = c.mutedFg, fontSize = 12.sp) } }
    }
}
