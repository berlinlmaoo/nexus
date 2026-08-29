import SwiftUI

/// Port of reports.tsx: range selector + metric grid + By-status/By-priority distributions + project health.
struct ReportsView: View {
    @Environment(AuthStore.self) private var auth
    @State private var report: Reports?
    @State private var days = 30
    @State private var loading = true
    @State private var error: String?

    private static let statusColor: [String: String] = ["TODO": "#94a3b8", "IN_PROGRESS": "#0091ff", "IN_REVIEW": "#f59e0b", "DONE": "#16a34a", "CANCELLED": "#ef4444"]
    private static let prioColor: [String: String] = ["URGENT": "#ef4444", "HIGH": "#f59e0b", "MEDIUM": "#0091ff", "LOW": "#94a3b8", "NONE": "#cbd5e1"]

    var body: some View {
        ZStack {
            NX.background.ignoresSafeArea()
            content
        }
        .navigationTitle("Reports")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    ForEach([7, 30, 90], id: \.self) { d in Button("\(d) \(T("days"))") { days = d; Task { await load() } } }
                } label: { Text("\(days) \(T("days"))").font(NXFont.text(13, .bold)) }
            }
        }
        .task { await load() }
    }

    @ViewBuilder private var content: some View {
        if loading {
            ProgressView().tint(NX.violet).frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if let error {
            VStack(spacing: 12) {
                Image(systemName: "chart.bar.xaxis").font(.system(size: 40)).foregroundStyle(NX.mutedFg)
                Text(error).font(NXFont.text(14)).foregroundStyle(NX.mutedFg)
                Button(T("Try again")) { Task { await load() } }.buttonStyle(NexusPrimaryButton(fullWidth: false))
            }.frame(maxWidth: .infinity, maxHeight: .infinity).padding(32)
        } else if let r = report {
            ScrollView {
                VStack(spacing: 16) {
                    let m = r.metrics
                    LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 12) {
                        metric("Total tasks", "\(m?.totalTasks ?? 0)", tone: .neutral)
                        metric("Completed", "\(m?.completedTasks ?? 0)", tone: .success, trend: m?.completionTrend)
                        metric("Overdue", "\(m?.overdueTasks ?? 0)", tone: (m?.overdueTasks ?? 0) > 0 ? .danger : .neutral)
                        metric("Completion", "\(m?.completionRate ?? 0)%", tone: .info, sub: m?.avgCompletionDays.map { "\(Int($0))d avg" })
                    }
                    distro("By status", rows: (r.tasksByStatus ?? []).map { ($0.status.replacingOccurrences(of: "_", with: " ").capitalized, $0.count, Self.statusColor[$0.status] ?? "#7b68ee") })
                    distro("By priority", rows: (r.tasksByPriority ?? []).map { ($0.priority.replacingOccurrences(of: "_", with: " ").capitalized, $0.count, Self.prioColor[$0.priority] ?? "#7b68ee") })
                    if let health = r.projectHealth, !health.isEmpty { projectHealth(health) }
                }
                .padding(16)
            }
            .refreshable { await load() }
        }
    }

    private func metric(_ label: String, _ value: String, tone: ChipTone, trend: Int? = nil, sub: String? = nil) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label.uppercased()).font(NXFont.text(10, .bold)).tracking(0.5).foregroundStyle(NX.mutedFg)
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Text(value).font(NXFont.display(28, .black)).foregroundStyle(tone == .danger ? NX.danger : NX.foreground)
                if let trend, trend != 0 {
                    Text("\(trend > 0 ? "↑" : "↓")\(abs(trend))%").font(NXFont.text(11, .bold)).foregroundStyle(trend > 0 ? NX.success : NX.danger)
                }
            }
            if let sub { Text(sub).font(NXFont.text(11)).foregroundStyle(NX.mutedFg) }
        }
        .frame(maxWidth: .infinity, alignment: .leading).nexusCard(padding: 16, radius: 18)
    }

    private func distro(_ title: String, rows: [(String, Int, String)]) -> some View {
        let maxV = max(1, rows.map(\.1).max() ?? 1)
        return VStack(alignment: .leading, spacing: 10) {
            Text(title).font(NXFont.display(15, .bold)).foregroundStyle(NX.foreground)
            if rows.isEmpty { Text(T("No data yet.")).font(NXFont.text(13)).foregroundStyle(NX.mutedFg) }
            ForEach(rows, id: \.0) { row in
                VStack(spacing: 4) {
                    HStack {
                        Text(row.0).font(NXFont.text(12, .semibold)).foregroundStyle(NX.foreground)
                        Spacer()
                        Text("\(row.1)").font(NXFont.text(12, .bold)).foregroundStyle(NX.mutedFg)
                    }
                    GeometryReader { geo in
                        ZStack(alignment: .leading) {
                            Capsule().fill(NX.muted)
                            Capsule().fill(Color(hex: row.2)).frame(width: geo.size.width * CGFloat(row.1) / CGFloat(maxV))
                        }
                    }.frame(height: 7)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading).nexusCard()
    }

    private func projectHealth(_ health: [Reports.ProjectHealth]) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Project health").font(NXFont.display(15, .bold)).foregroundStyle(NX.foreground)
            ForEach(health, id: \.idv) { p in
                VStack(spacing: 5) {
                    HStack {
                        Circle().fill(Color(hex: p.color ?? "#7b68ee")).frame(width: 9, height: 9)
                        Text(p.name ?? "—").font(NXFont.text(13, .semibold)).foregroundStyle(NX.foreground).lineLimit(1)
                        Spacer()
                        if let o = p.overdue, o > 0 { NexusChip(text: "\(o) overdue", tone: .danger) }
                        Text("\(p.completionRate ?? 0)%").font(NXFont.text(12, .bold)).foregroundStyle(NX.mutedFg)
                    }
                    GeometryReader { geo in
                        ZStack(alignment: .leading) {
                            Capsule().fill(NX.muted)
                            Capsule().fill(NX.success).frame(width: geo.size.width * CGFloat(p.completionRate ?? 0) / 100)
                        }
                    }.frame(height: 6)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading).nexusCard()
    }

    private func load() async {
        error = nil
        do { report = try await APIClient.shared.reports(days: days) }
        catch APIError.unauthorized { auth.logout() }
        catch { self.error = (error as? LocalizedError)?.errorDescription ?? "Login/session diperlukan." }
        loading = false
    }
}
