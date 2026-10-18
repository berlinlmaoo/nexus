import Foundation
import SwiftUI
import Observation

extension GideonClient {
    static func creditData(history: Bool = false, before: String? = nil) async throws -> Data {
        var path = "/api/gideon/credits"
        if history {
            path += "?history=1&limit=50"
            if let before { path += "&before=" + (before.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? before) }
        }
        let (data, response) = try await APIClient.shared.perform(APIClient.shared.makeRequest(path))
        guard let http = response as? HTTPURLResponse else { throw APIError.offline }
        guard (200..<300).contains(http.statusCode) else { throw APIError.http(http.statusCode, APIClient.serverMessage(data)) }
        return data
    }
}

@MainActor @Observable
final class GideonCredits {
    static let shared = GideonCredits()
    private(set) var summary: GideonCreditSummary?
    private var epoch = 0
    func refresh() async {
        let current = epoch
        struct Envelope: Decodable { let summary: GideonCreditSummary }
        guard let data = try? await GideonClient.creditData(),
              let envelope = try? JSONDecoder().decode(Envelope.self, from: data), current == epoch else { return }
        summary = envelope.summary
    }
    func accept(_ next: GideonCreditSummary) { epoch += 1; summary = next }
    func reset() { epoch += 1; summary = nil }
}

struct GideonCreditMeter: View {
    @State private var credits = GideonCredits.shared
    @State private var showUsage = false
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            if let s = credits.summary {
                Button { showUsage = true } label: {
                    HStack(spacing: 6) {
                        Image(systemName: s.unlimited ? "infinity" : "chart.bar.fill").foregroundStyle(NX.violetText)
                        Text(s.unlimited
                             ? String(format: T("Credits today %@ · Unlimited"), AppNumber.int(s.today.used))
                             : String(format: T("Credits today %@/%@"), AppNumber.int(s.today.used), AppNumber.int(s.today.limit)))
                        Image(systemName: "chevron.up").font(.system(size: 8))
                    }
                    .font(NXFont.text(11, .medium)).foregroundStyle(NX.mutedFg)
                    .frame(minHeight: 32).contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                if s.enforced && !s.unlimited && s.next != "ok" {
                    Text(s.next == "blocked"
                         ? T("You're out of credits for today, including backup answers. GIDEON Model 0 is still free.")
                         : String(format: T("You're out of credits: GIDEON Aphrodite answers instead (%@ left today)."), AppNumber.int(max(0, s.fallbackPerDay - s.fallbackToday))))
                        .font(NXFont.text(12)).foregroundStyle(NX.warning)
                }
            }
        }
        .task { await credits.refresh() }
        .sheet(isPresented: $showUsage) { GideonCreditUsageView() }
    }
}

struct GideonCreditUsageView: View {
    @Environment(\.dismiss) private var dismiss
    @State private var credits = GideonCredits.shared
    @State private var items: [GideonCreditHistory.Item] = []
    @State private var nextBefore: String?
    @State private var loading = false
    @State private var loaded = false
    @State private var failure: String?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    if let s = credits.summary { details(s) }
                    Text(T("GIDEON usage")).font(NXFont.display(18, .bold))
                    if let failure {
                        EmptyState(icon: "wifi.exclamationmark", title: T("Couldn't load your GIDEON usage."), subtitle: failure,
                                   actionTitle: T("Try again"), action: { Task { await load() } })
                    } else if loaded && items.isEmpty {
                        EmptyState(icon: "chart.bar", title: T("No GIDEON usage yet"),
                                   subtitle: T("Your answers and what each one cost."))
                    }
                    ForEach(items) { item in
                        HStack(alignment: .top, spacing: 12) {
                            VStack(alignment: .leading, spacing: 4) {
                                Text(item.title ?? T("GIDEON answer")).font(NXFont.text(14, .medium)).lineLimit(2)
                                Text((GideonTier(rawValue: item.tier)?.label ?? item.tier) + " · " + LegalLabels.date(item.createdAt))
                                    .font(NXFont.text(11)).foregroundStyle(NX.mutedFg)
                                if item.fallback { Text(T("Aphrodite backup answer")).font(NXFont.text(11)).foregroundStyle(NX.warning) }
                            }
                            Spacer(minLength: 0)
                            Text(item.credits == 0 ? T("Free") : AppNumber.int(item.credits))
                                .font(NXFont.text(13, .semibold)).monospacedDigit()
                        }
                        Divider()
                    }
                    if loading { ProgressView().frame(maxWidth: .infinity) }
                    if nextBefore != nil && !loading {
                        Button(T("Load more")) { Task { await load(more: true) } }.buttonStyle(.nxBordered)
                    }
                }
                .padding(20)
            }
            .background(NX.background)
            .navigationTitle(T("GIDEON credits")).navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button(T("Close")) { dismiss() } } }
            .task { await load() }
            .refreshable { await load() }
        }
    }

    private func details(_ s: GideonCreditSummary) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            if s.unlimited {
                Label(T("Unlimited"), systemImage: "infinity").font(NXFont.display(22, .bold))
                Text(T("Your role has unlimited GIDEON credits."))
            } else {
                Text(String(format: T("Credits today %@/%@"), AppNumber.int(s.today.used), AppNumber.int(s.today.limit))).font(NXFont.text(16, .semibold))
                ProgressView(value: Double(min(s.today.used, s.today.limit)), total: Double(max(1, s.today.limit))).tint(NX.violet)
                Text(T("Resets at 00:00 WIB. Unused credits don't carry over."))
                Text(String(format: T("Monthly pool %@/%@"), AppNumber.int(s.pool.used), AppNumber.int(s.pool.limit))).font(NXFont.text(14, .semibold))
                ProgressView(value: Double(min(s.pool.used, s.pool.limit)), total: Double(max(1, s.pool.limit))).tint(NX.violet)
                Text(s.period.startKey + " – " + s.period.endKey)
                Text(T("Used after today's credits run out. Renews on the 28th."))
                if s.pool.bonus > 0 { Text(String(format: T("Includes %@ bonus credits."), AppNumber.int(s.pool.bonus))) }
                if s.over > 0 { Text(String(format: T("%@ credits over your limit this period."), AppNumber.int(s.over))).foregroundStyle(NX.warning) }
                if !s.enforced { Text(T("Nothing is blocked yet.")) }
            }
            Text(T("A typical question: Phaëthon ≈ 10 credits, Artemis ≈ 45, Aphrodite ≈ 1, Model 0 free."))
        }
        .font(NXFont.text(12)).foregroundStyle(NX.mutedFg)
        .frame(maxWidth: .infinity, alignment: .leading).nexusCard()
    }

    private func load(more: Bool = false) async {
        guard !loading else { return }
        loading = true
        defer { loading = false }
        do {
            let data = try await GideonClient.creditData(history: true, before: more ? nextBefore : nil)
            let page = try JSONDecoder().decode(GideonCreditHistory.self, from: data)
            credits.accept(page.summary)
            let known = more ? Set(items.map(\.id)) : []
            items = (more ? items : []) + page.items.filter { !known.contains($0.id) }
            nextBefore = page.nextBefore
            failure = nil
            loaded = true
        } catch { failure = error.localizedDescription }
    }
}
