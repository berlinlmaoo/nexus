import SwiftUI

// MARK: - models
//
// Shape taken from the web bundle (assets/complaints-*.js), which renders
// .subject / .body / .category / .status / .createdAt / .reporter / .attachments.
// Everything optional so a backend field rename degrades instead of failing to decode.

struct ComplaintsResponse: Decodable, Sendable {
    let complaints: [Complaint]?
}

struct Complaint: Decodable, Identifiable, Sendable {
    let id: String
    let subject: String?
    let body: String?
    let category: String?
    let status: String?
    let createdAt: String?
    let reporter: Reporter?
    let attachments: [Attachment]?

    struct Reporter: Decodable, Sendable { let name: String?; let avatar: String? }
    struct Attachment: Decodable, Sendable { let url: String? }

    var statusKey: String { (status ?? "OPEN").uppercased() }
    var title: String { subject?.isEmpty == false ? subject! : "(tanpa judul)" }
    var tone: ChipTone {
        switch statusKey {
        case "RESOLVED": return .success
        case "IN_REVIEW": return .warning
        case "CLOSED": return .neutral
        default: return .danger
        }
    }
    var statusLabel: String {
        switch statusKey {
        case "IN_REVIEW": return "In review"
        case "RESOLVED": return "Resolved"
        case "CLOSED": return "Closed"
        default: return "Open"
        }
    }
}

// MARK: - list

/// Port of the web /complaints screen ("Ticket" in the sidebar) — a direct line to the BoD for
/// ops/HR issues. READ ONLY for now: filing one requires photo evidence whose upload encoding
/// isn't visible from the client, so the composer is deliberately left out rather than guessed.
struct TicketsView: View {
    @Environment(AuthStore.self) private var auth
    @State private var items: [Complaint] = []
    @State private var loading = true
    @State private var error: String?
    @State private var filter = "ALL"
    @State private var selected: Complaint?

    private let filters = ["ALL", "OPEN", "IN_REVIEW", "RESOLVED", "CLOSED"]
    private func filterLabel(_ f: String) -> String {
        switch f {
        case "OPEN": return "Open"
        case "IN_REVIEW": return "In review"
        case "RESOLVED": return "Resolved"
        case "CLOSED": return "Closed"
        default: return "Semua"
        }
    }
    private var filtered: [Complaint] {
        filter == "ALL" ? items : items.filter { $0.statusKey == filter }
    }

    var body: some View {
        ZStack {
            NX.background.ignoresSafeArea()
            content
        }
        .navigationTitle("Ticket")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
        .sheet(item: $selected) { TicketDetailSheet(ticket: $0) }
    }

    @ViewBuilder private var content: some View {
        if loading {
            SkeletonList()
        } else if let error {
            ErrorState(message: error) { Task { await load() } }
        } else {
            VStack(spacing: 0) {
                filterBar
                if filtered.isEmpty {
                    EmptyState(icon: "ticket", title: "Nggak ada ticket di filter ini",
                               subtitle: "Ganti filter di atas buat lihat status lain.")
                } else {
                    ScrollView {
                        LazyVStack(spacing: 10) {
                            ForEach(filtered) { t in
                                Button { selected = t } label: { row(t) }.buttonStyle(.plain)
                            }
                        }
                        .padding(16)
                    }
                    .refreshable { await load() }
                }
            }
        }
    }

    private var filterBar: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(filters, id: \.self) { f in
                    let on = filter == f
                    Button { filter = f } label: {
                        Text(filterLabel(f)).font(NXFont.text(12, .semibold))
                            .foregroundStyle(on ? Color.white : NX.mutedFg)
                            .padding(.horizontal, 13).padding(.vertical, 7)
                            .background(on ? NX.violet : NX.card, in: Capsule())
                            .overlay(Capsule().strokeBorder(on ? Color.clear : NX.border))
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, 16)
        }
        .padding(.vertical, 10)
    }

    private func row(_ t: Complaint) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .top, spacing: 8) {
                Text(t.title).font(NXFont.text(14, .bold)).foregroundStyle(NX.foreground)
                    .lineLimit(2).multilineTextAlignment(.leading)
                Spacer(minLength: 4)
                NexusChip(text: t.statusLabel, tone: t.tone)
            }
            if let b = t.body, !b.isEmpty {
                Text(b).font(NXFont.text(12)).foregroundStyle(NX.mutedFg).lineLimit(2)
            }
            HStack(spacing: 8) {
                if let c = t.category, !c.isEmpty {
                    NexusChip(text: humanizeEnum(c), tone: .accent, systemImage: "tag.fill")
                }
                if let n = t.reporter?.name, !n.isEmpty {
                    Label(n, systemImage: "person.fill").font(NXFont.text(11)).foregroundStyle(NX.mutedFg)
                }
                Spacer(minLength: 0)
                if let d = ProjDate.parse(t.createdAt) {
                    Text(ProjDate.dayLabel(d)).font(NXFont.text(11)).foregroundStyle(NX.mutedFg)
                }
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background {
            RoundedRectangle(cornerRadius: 18, style: .continuous).fill(NX.card)
                .nexusShadowSoft()
                .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).strokeBorder(NX.border))
        }
    }

    private func load() async {
        error = nil
        do { items = try await APIClient.shared.complaints() }
        catch APIError.unauthorized { auth.logout() }
        catch { self.error = (error as? LocalizedError)?.errorDescription ?? "Gagal memuat ticket." }
        loading = false
    }
}

// MARK: - detail

struct TicketDetailSheet: View {
    let ticket: Complaint
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    HStack(alignment: .top, spacing: 8) {
                        Text(ticket.title).font(NXFont.display(20, .bold)).foregroundStyle(NX.foreground)
                        Spacer(minLength: 4)
                        NexusChip(text: ticket.statusLabel, tone: ticket.tone)
                    }
                    HStack(spacing: 8) {
                        if let c = ticket.category, !c.isEmpty {
                            NexusChip(text: humanizeEnum(c), tone: .accent, systemImage: "tag.fill")
                        }
                        if let d = ProjDate.parse(ticket.createdAt) {
                            Text(ProjDate.longLabel(d)).font(NXFont.text(11)).foregroundStyle(NX.mutedFg)
                        }
                    }
                    if let n = ticket.reporter?.name, !n.isEmpty {
                        HStack(spacing: 8) {
                            AvatarView(url: ticket.reporter?.avatar,
                                       initial: String(n.first ?? "?").uppercased(), size: 30)
                            Text(n).font(NXFont.text(13, .semibold)).foregroundStyle(NX.foreground)
                        }
                    }
                    if let b = ticket.body, !b.isEmpty {
                        VStack(alignment: .leading, spacing: 6) {
                            SectionLabel("Isi laporan")
                            Text(b).font(NXFont.text(14)).foregroundStyle(NX.foreground)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .nexusCard()
                    }
                    let photos = (ticket.attachments ?? []).compactMap { $0.url }
                    if !photos.isEmpty {
                        VStack(alignment: .leading, spacing: 8) {
                            SectionLabel("Foto bukti · \(photos.count)")
                            ScrollView(.horizontal, showsIndicators: false) {
                                HStack(spacing: 8) {
                                    ForEach(photos, id: \.self) { p in
                                        CachedImage(url: URL(string: p.hasPrefix("http") ? p : Config.baseURL.absoluteString + p)) {
                                            $0.resizable().scaledToFill()
                                        } placeholder: {
                                            NX.muted
                                        }
                                        .frame(width: 130, height: 130)
                                        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                                    }
                                }
                            }
                        }
                    }
                }
                .padding(16)
            }
            .background(NX.background.ignoresSafeArea())
            .navigationTitle("Ticket")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .topBarLeading) { Button("Tutup") { dismiss() } } }
        }
    }
}
