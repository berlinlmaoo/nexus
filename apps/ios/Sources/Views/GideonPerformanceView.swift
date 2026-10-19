import SwiftUI
import Charts
import Observation

@MainActor @Observable
final class GideonPerformanceStore {
    var data: GideonPerformanceData?
    var failure: String?
    var denied = false
    private var loading = false
    @ObservationIgnored private var refreshTask: Task<Void, Never>?
    func load() async {
        guard !loading else { return }; loading = true; defer { loading = false }
        do { data = try await NativeAPI.request("/api/gideon/perf"); failure = nil }
        catch let error as NativeAPIError where error.status == 403 { denied = true }
        catch { if !Task.isCancelled { failure = error.localizedDescription } }
    }
    func event(_ json: String) {
        struct Event: Decodable { let kind: String; let live: GideonPerformanceData.Live? }
        guard let event = try? JSONDecoder().decode(Event.self, from: Data(json.utf8)) else { return }
        var refetch = event.kind != "gpu"
        if let live = event.live {
            if data?.live?.engine?.up != live.engine?.up { refetch = true }
            data?.accept(live: live)
        }
        if refetch {
            refreshTask?.cancel()
            refreshTask = Task {
                try? await Task.sleep(for: .milliseconds(1500))
                if !Task.isCancelled { await load() }
            }
        }
    }
    func stop() { refreshTask?.cancel(); refreshTask = nil }
}

struct GideonPerformanceView: View {
    var onDenied: () -> Void = {}
    @Environment(\.scenePhase) private var phase
    @State private var store = GideonPerformanceStore()
    private let columns = [GridItem(.adaptive(minimum: 245), spacing: 12)]
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                if let data = store.data {
                    GideonPerfSummaryStrip(data: data)
                    LazyVGrid(columns: columns, spacing: 12) { ForEach(data.tiers) { GideonPerfTierCard(tier: $0) } }
                    gpuCard(data)
                    charts(data)
                    quality(data)
                    alerts(data)
                } else if let failure = store.failure {
                    EmptyState(icon: "chart.xyaxis.line", title: T("Couldn't load GIDEON performance."), subtitle: failure, actionTitle: T("Try again"), action: { Task { await store.load() } })
                } else { ProgressView().frame(maxWidth: .infinity).padding(30) }
                if store.data != nil, let failure = store.failure { Text(failure).font(NXFont.text(12)).foregroundStyle(NX.danger) }
            }.padding(16)
        }
        .accessibilityIdentifier("gideon.performance")
        .task(id: phase) {
            guard LiveRefresh.inFront(phase) else { return }
            RealtimeClient.shared.join("gideon:perf")
            defer { RealtimeClient.shared.leave("gideon:perf") }
            await store.load()
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(60))
                if !Task.isCancelled { await store.load() }
            }
        }
        .onDisappear { store.stop() }
        .onReceive(NotificationCenter.default.publisher(for: .nexusGideonPerf)) { note in store.event(note.userInfo?[RealtimeKey.json] as? String ?? "{}") }
        .onReceive(NotificationCenter.default.publisher(for: .nexusRealtimeConnected)) { _ in Task { await store.load() } }
        .onReceive(NotificationCenter.default.publisher(for: .nexusGideonPerfDenied)) { _ in onDenied() }
        .onChange(of: store.denied) { _, denied in if denied { onDenied() } }
        .refreshable { await store.load() }
    }
    private func gpuCard(_ data: GideonPerformanceData) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(T("Model 0 and the office GPU")).font(NXFont.display(18, .bold))
            if let live = data.live {
                if let gpu = live.gpu {
                    Text(gpu.name ?? "—").font(NXFont.text(13, .semibold))
                    metric("GPU use", percent(gpu.util))
                    metric("VRAM", (gpu.memUsedMiB.map { AppNumber.decimal($0 / 1024) } ?? "—") + " / " + (gpu.memTotalMiB.map { AppNumber.decimal($0 / 1024) } ?? "—") + " GB")
                    metric("Temperature", gpu.tempC.map { AppNumber.decimal($0, digits: 0) + "°C" } ?? "—")
                    Text(String(format: T("Alert at %@°C"), AppNumber.int(Int(data.thresholds["gpuHotC"] ?? 85)))).font(NXFont.text(11)).foregroundStyle(NX.mutedFg)
                    metric("Power", (gpu.powerW.map { AppNumber.decimal($0) } ?? "—") + " / " + (gpu.powerLimitW.map { AppNumber.decimal($0) } ?? "—") + " W")
                }
                if let model = live.engine?.model {
                    metric("Loaded model", model.name)
                    if let share = model.gpuShare { Text(share >= 0.995 ? T("Fully on GPU") : String(format: T("Partly on CPU · %@ on GPU"), percent(share * 100))).font(NXFont.text(12)) }
                    if let used = model.sizeVramBytes, let total = model.sizeBytes { Text(String(format: T("%@ of %@ GB in VRAM"), AppNumber.decimal(used / 1_073_741_824), AppNumber.decimal(total / 1_073_741_824))).font(NXFont.text(12)) }
                } else { Text(T("None loaded. It loads on the next question.")).font(NXFont.text(12)).foregroundStyle(NX.mutedFg) }
                if let whisper = live.whisper {
                    metric("Meeting transcriber", T(!whisper.up ? "Not responding" : whisper.busy ? "Transcribing" : "Idle"))
                    Text(String(format: T("%@ waiting"), AppNumber.int(whisper.queued))).font(NXFont.text(12))
                }
            } else { EmptyState(icon: "desktopcomputer", title: T("No reading from the GPU host yet."), subtitle: T("Live data")) }
            metric("Speed (last 24 h)", data.model0.avgEvalTps24h.map { String(format: T("%@ tokens/s"), AppNumber.decimal($0)) } ?? "—")
            if let load = data.model0.loads.last { Text(String(format: T("last load %@ s at %@"), AppNumber.decimal(load.loadSec), clock(load.at))).font(NXFont.text(11)).foregroundStyle(NX.mutedFg) }
            DisclosureGroup(T("Recent Model 0 generations")) {
                ForEach(Array(data.model0.recent.enumerated()), id: \.offset) { _, generation in
                    HStack {
                        Text(clock(generation.at)); Spacer()
                        Text(generation.evalTps.map { String(format: T("%@ tokens/s"), AppNumber.decimal($0)) } ?? "—")
                        Text(generation.promptTps.map { String(format: T("Reading prompt: %@ tokens/s"), AppNumber.decimal($0)) } ?? "—")
                        Text(String(format: T("%@ tokens out"), AppNumber.int(generation.outTokens ?? 0)))
                        Text(seconds(generation.totalMs))
                    }.font(NXFont.text(11)).fixedSize(horizontal: false, vertical: true)
                }
            }
        }.frame(maxWidth: .infinity, alignment: .leading).nexusCard()
    }
    private func charts(_ data: GideonPerformanceData) -> some View {
        VStack(alignment: .leading, spacing: 16) {
            tierChart("Questions per tier", data: data, latency: false)
            tierChart("Typical answer time", data: data, latency: true)
            Text(T("Credits spent")).font(NXFont.text(14, .semibold))
            Chart(Array(data.hours.enumerated()), id: \.offset) { _, hour in
                if let date = NativeDate.parse(hour.t) { BarMark(x: .value("Hour", date), y: .value("Credits", hour.credits)).foregroundStyle(NX.violet) }
            }.frame(height: 140).chartXAxis { hourAxis }
            Text(T("Prompt cache hits")).font(NXFont.text(14, .semibold))
            Chart(Array(data.hours.enumerated()), id: \.offset) { _, hour in
                if let date = NativeDate.parse(hour.t), let hit = hour.cacheHit { LineMark(x: .value("Hour", date), y: .value("%", hit * 100)).foregroundStyle(NX.violet) }
            }.frame(height: 140).chartYScale(domain: 0...100).chartXAxis { hourAxis }
            let input = data.hours.reduce(0) { $0 + $1.inputTokens }; let cached = data.hours.reduce(0) { $0 + $1.cachedTokens }
            Text(String(format: T("%@ of input tokens came from the cache in 24 h"), input + cached > 0 ? percent(Double(cached) / Double(input + cached) * 100) : "—")).font(NXFont.text(12)).foregroundStyle(NX.mutedFg)
        }.nexusCard()
    }
    private func tierChart(_ title: String, data: GideonPerformanceData, latency: Bool) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(T(title)).font(NXFont.text(14, .semibold))
            Chart {
                ForEach(GideonTier.allCases) { tier in
                    ForEach(Array(data.hours.enumerated()), id: \.offset) { _, hour in
                        if let date = NativeDate.parse(hour.t), let value = latency ? ((hour.p50Ms[tier.rawValue] ?? nil).map { $0 / 1000 }) : Double(hour.questions[tier.rawValue] ?? 0) {
                            LineMark(x: .value("Hour", date), y: .value(latency ? "s" : "Questions", value))
                                .foregroundStyle(by: .value("GIDEON", tier.label))
                        }
                    }
                }
            }.frame(height: 150).chartXAxis { hourAxis }.chartLegend(position: .bottom, alignment: .leading)
        }
    }
    private var hourAxis: some AxisContent {
        AxisMarks(values: .stride(by: .hour, count: 6)) { value in
            AxisGridLine(); AxisTick()
            AxisValueLabel { if let date = value.as(Date.self) { Text(AppDateLocale.formatter("HH:mm", timeZone: TimeZone(identifier: "Asia/Jakarta")).string(from: date)).font(.system(size: 10)) } }
        }
    }
    private func quality(_ data: GideonPerformanceData) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(T("Quality")).font(NXFont.display(18, .bold))
            metric("Retried with all tools", AppNumber.int(data.quality.routerMisses24h))
            Text(T("GIDEON first said it couldn't, then answered again with every tool loaded.")).font(NXFont.text(12)).foregroundStyle(NX.mutedFg)
            tools("Most-used tools", rows: data.quality.topTools)
            tools("Most-failing tools", rows: data.quality.failingTools)
            Text(T("Thumbs down")).font(NXFont.text(14, .semibold))
            if let count = data.quality.thumbsDown { Text(AppNumber.int(count)) }
            else { EmptyState(icon: "hand.thumbsdown", title: T("Not collected yet"), subtitle: T("GIDEON answers don't have a thumbs up/down yet. This fills in once they do.")) }
        }.nexusCard()
    }
    private func tools(_ title: String, rows: [GideonPerformanceData.Quality.Tool]) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(T(title)).font(NXFont.text(13, .semibold))
            ForEach(Array(rows.enumerated()), id: \.offset) { _, tool in
                metric(tool.tool.replacingOccurrences(of: "nexus_", with: "").replacingOccurrences(of: "_", with: " "), AppNumber.int(title == "Most-failing tools" ? tool.failures : tool.calls))
            }
        }
    }
    private func alerts(_ data: GideonPerformanceData) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            ForEach(data.alerts) { alert in
                HStack(alignment: .top) {
                    Image(systemName: alert.active ? "exclamationmark.triangle.fill" : "checkmark.circle").foregroundStyle(alert.active ? NX.danger : NX.success)
                    VStack(alignment: .leading, spacing: 4) {
                        Text(T(["model0_down":"Model 0 is down","error_rate":"Error rate is high","vram_full":"GPU memory is full","gpu_hot":"GPU is running hot"][alert.key] ?? alert.key)).font(NXFont.text(13, .semibold))
                        if alert.active, let value = alert.value?.text { Text(value).font(NXFont.text(11)) }
                        if let since = alert.since { Text(String(format: T("since %@"), clock(since))).font(NXFont.text(11)) }
                        if alert.active { Text(T("The One Above All was notified.")).font(NXFont.text(11)).foregroundStyle(NX.mutedFg) }
                    }
                }
            }
        }.frame(maxWidth: .infinity, alignment: .leading).nexusCard()
    }
    private func metric(_ label: String, _ value: String) -> some View { HStack(alignment: .top) { Text(T(label)).foregroundStyle(NX.mutedFg); Spacer(minLength: 12); Text(value).multilineTextAlignment(.trailing) }.font(NXFont.text(12)) }
    private func seconds(_ milliseconds: Double?) -> String { milliseconds.map { AppNumber.decimal($0 / 1000) + " s" } ?? "—" }
    private func percent(_ value: Double?) -> String { value.map { AppNumber.decimal($0) + "%" } ?? "—" }
    private func clock(_ value: String) -> String { NativeDate.parse(value).map { AppDateLocale.formatter("HH:mm", timeZone: TimeZone(identifier: "Asia/Jakarta")).string(from: $0) } ?? "—" }
}

/// One line above the tiers (R-4): answers and errors over 24 h, the GPU's live dot with its age, then what
/// window the numbers below cover.
private struct GideonPerfSummaryStrip: View {
    let data: GideonPerformanceData
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .top, spacing: 12) {
                GideonPerfFigure(value: AppNumber.int(data.tiers.reduce(0) { $0 + $1.answers24h }), label: T("Answers 24 h"))
                GideonPerfFigure(value: AppNumber.int(errors), label: T(dayErrors ? "Errors 24 h" : "Errors (15 min)"))
                Spacer(minLength: 0)
            }
            TimelineView(.periodic(from: .now, by: 5)) { tick in
                let stale = data.telemetryStale(at: tick.date)
                HStack(spacing: 6) {
                    Circle().fill(stale ? NX.warning : NX.success).frame(width: 7, height: 7)
                    if !stale, let at = NativeDate.parse(data.telemetry.lastAt) {
                        Text(String(format: T("GPU updated %@ s ago"), AppNumber.int(max(0, Int(tick.date.timeIntervalSince(at))))))
                    } else { Text(T("GPU readings stopped")) }
                }.font(NXFont.text(12)).foregroundStyle(stale ? NX.warning : NX.mutedFg).lineLimit(1)
            }
        }.frame(maxWidth: .infinity, alignment: .leading).nexusCard()
        Text(T("Answers: last 15 min · Charts: last 24 h")).font(NXFont.text(11)).foregroundStyle(NX.mutedFg).padding(.horizontal, 4).padding(.top, -10)
    }
    private var dayErrors: Bool { data.tiers.allSatisfy { $0.failures24h != nil } }
    private var errors: Int { data.tiers.reduce(0) { $0 + (dayErrors ? $1.failures24h ?? 0 : $1.failures15m) } }
}

/// A tier: name and status pill, then the metrics as tiles. With no answer in 15 min the timing tiles say so
/// once instead of a dash each.
private struct GideonPerfTierCard: View {
    let tier: GideonPerformanceData.Tier
    /// Two columns; three in a row when only the three live tiles are left (no answer in 15 min).
    private let tiles = [GridItem(.flexible(), spacing: 8), GridItem(.flexible(), spacing: 8)]
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(GideonTier(rawValue: tier.id)?.label ?? tier.id).font(NXFont.display(18, .bold)).lineLimit(1)
                Spacer(minLength: 8)
                NexusChip(text: T(statusLabel), tone: statusTone)
            }
            if let reason = tier.reason { Text(reasonText(reason)).font(NXFont.text(12)).foregroundStyle(NX.mutedFg).fixedSize(horizontal: false, vertical: true) }
            if quiet { Text(T("No answers in 15 min")).font(NXFont.text(12)).foregroundStyle(NX.mutedFg) }
            LazyVGrid(columns: quiet ? tiles + [GridItem(.flexible(), spacing: 8)] : tiles, alignment: .leading, spacing: 8) {
                if !quiet {
                    GideonPerfTile(value: seconds(tier.p50Ms), label: T("Typical time (p50)"))
                    GideonPerfTile(value: seconds(tier.p95Ms), label: T("Slowest 5% (p95)"))
                    GideonPerfTile(value: tier.errorRate.map { AppNumber.decimal($0 * 100) + "%" } ?? "—", label: T("Error rate"))
                }
                GideonPerfTile(value: AppNumber.int(tier.inFlight), label: T("Answering now"))
                if let credits { GideonPerfTile(value: credits, label: T("Credits / answer")) }
                GideonPerfTile(value: AppNumber.int(tier.answers24h), label: T("Answers 24 h"))
            }
        }.frame(maxWidth: .infinity, alignment: .leading).nexusCard()
    }
    private var quiet: Bool { tier.answers15m == 0 }
    private var credits: String? {
        if tier.id == "experimental" { return T("Free") }
        return (tier.avgCredits15m ?? tier.avgCredits24h).map { AppNumber.decimal($0) } ?? (quiet ? nil : "—")
    }
    private var statusLabel: String { ["online": "Online", "busy": "Busy", "loading": "Loading"][tier.status] ?? "Offline" }
    private var statusTone: ChipTone { tier.status == "online" ? .success : tier.status == "unavailable" ? .danger : .warning }
    private func seconds(_ milliseconds: Double?) -> String { milliseconds.map { AppNumber.decimal($0 / 1000) + " s" } ?? "—" }
    private func reasonText(_ reason: String) -> String { T(["transcribing":"The GPU is transcribing a meeting.","loading":"Loading the model into the GPU.","down":"The local engine isn't responding.","failing":"The last 3 answers failed."][reason] ?? "Unavailable") }
}

private struct GideonPerfFigure: View {
    let value: String
    let label: String
    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(value).font(NXFont.display(24, .bold)).monospacedDigit().lineLimit(1)
            Text(label).font(NXFont.text(12)).foregroundStyle(NX.mutedFg).lineLimit(1)
        }.frame(minWidth: 96, alignment: .leading).accessibilityElement(children: .combine)
    }
}

private struct GideonPerfTile: View {
    let value: String
    let label: String
    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(value).font(NXFont.display(20, .bold)).monospacedDigit().lineLimit(1).minimumScaleFactor(0.7)
            Text(label).font(NXFont.text(11)).foregroundStyle(NX.mutedFg).lineLimit(2).fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, minHeight: 58, alignment: .topLeading)
        .padding(10)
        .background(NX.muted.opacity(0.6), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}
