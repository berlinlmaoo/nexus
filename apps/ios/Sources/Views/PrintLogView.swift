import SwiftUI

// ─────────────────────────────────────────────────────────────────────────────
// Print log (owner, 18 Nov 2026: every print is logged). Settings → Print log. Your own prints; BoD / One Above
// All (`canSeeAll`) see everyone's and may narrow to one person. Filter by period, pull to refresh, more on
// scrolling to the end (nextCursor). Web: /settings?section=print-log.
// ─────────────────────────────────────────────────────────────────────────────

struct PrintLogView: View {
    @Environment(AuthStore.self) private var auth

    enum Period: String, CaseIterable, Identifiable {
        case all, today, week, month, custom
        var id: String { rawValue }
        var label: String {
            switch self {
            case .all: return T("All time")
            case .today: return T("Today")
            case .week: return T("Last 7 days")
            case .month: return T("Last 30 days")
            case .custom: return T("Custom")
            }
        }
    }

    @State private var jobs: [PrintJob] = []
    @State private var nextCursor: String?
    @State private var canSeeAll = false
    @State private var people: [PrintPerson] = []
    @State private var person: String = ""
    @State private var period: Period = .all
    @State private var from = Calendar.current.date(byAdding: .day, value: -7, to: Date()) ?? Date()
    @State private var to = Date()
    @State private var loading = true
    @State private var loadingMore = false
    @State private var error: String?

    /// Changing any filter reloads from the first page.
    private var filterKey: String {
        "\(person)|\(period.rawValue)|\(period == .custom ? Self.day(from) + Self.day(to) : "")"
    }

    var body: some View {
        List {
            filters
            if loading && jobs.isEmpty {
                HStack { Spacer(); ProgressView(); Spacer() }.listRowBackground(Color.clear)
            } else if let error, jobs.isEmpty {
                EmptyState(icon: "exclamationmark.triangle", title: T("Couldn't load the print log"), subtitle: error,
                           actionTitle: T("Try again"), actionIcon: "arrow.clockwise") { Task { await load() } }
                    .listRowBackground(Color.clear)
            } else if jobs.isEmpty {
                EmptyState(icon: "printer", title: T("No prints yet"),
                           subtitle: filtered ? T("Nothing was printed in this period. Try another date or person.")
                                              : T("Print a Legal document or a page from its ••• menu."))
                    .listRowBackground(Color.clear)
            } else {
                Section {
                    ForEach(jobs) { job in
                        PrintLogRow(job: job, showPerson: canSeeAll)
                            .onAppear { if job.id == jobs.last?.id { Task { await loadMore() } } }
                    }
                    if loadingMore {
                        HStack { Spacer(); ProgressView(); Spacer() }
                    }
                }
            }
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .background(NX.background.ignoresSafeArea())
        .navigationTitle(T("Print log"))
        .navigationBarTitleDisplayMode(.inline)
        .refreshable { await load() }
        .task(id: filterKey) { await load() }
    }

    private var filtered: Bool { !person.isEmpty || period != .all }

    @ViewBuilder private var filters: some View {
        Section {
            if canSeeAll {
                Picker(T("Person"), selection: $person) {
                    Text(T("Everyone")).tag("")
                    ForEach(people) { p in Text(p.name.isEmpty ? "—" : p.name).tag(p.id) }
                }
            }
            Picker(T("Period"), selection: $period) {
                ForEach(Period.allCases) { Text($0.label).tag($0) }
            }
            if period == .custom {
                DatePicker(T("From"), selection: $from, in: ...to, displayedComponents: .date)
                DatePicker(T("To"), selection: $to, in: from..., displayedComponents: .date)
            }
        }
    }

    /// The period as WIB days "YYYY-MM-DD", both inclusive.
    private var range: (from: String?, to: String?) {
        let now = Date()
        switch period {
        case .all: return (nil, nil)
        case .today: return (Self.day(now), Self.day(now))
        case .week: return (Self.day(now.addingTimeInterval(-6 * 86_400)), Self.day(now))
        case .month: return (Self.day(now.addingTimeInterval(-29 * 86_400)), Self.day(now))
        case .custom: return (Self.day(from), Self.day(to))
        }
    }

    private static func day(_ d: Date) -> String {
        let f = DateFormatter()
        f.calendar = Calendar(identifier: .gregorian)
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = TimeZone(identifier: "Asia/Jakarta")
        f.dateFormat = "yyyy-MM-dd"
        return f.string(from: d)
    }

    private func load() async {
        loading = true
        defer { loading = false }
        do {
            let page = try await APIClient.shared.printJobs(userId: person.isEmpty ? nil : person, from: range.from, to: range.to, cursor: nil)
            jobs = page.jobs
            nextCursor = page.nextCursor
            canSeeAll = page.canSeeAll
            if page.canSeeAll { people = page.people }
            error = nil
        } catch APIError.unauthorized {
            auth.logout()
        } catch {
            if !Task.isCancelled { self.error = (error as? LocalizedError)?.errorDescription ?? T("Check your connection and try again.") }
        }
    }

    private func loadMore() async {
        guard let cursor = nextCursor, !loadingMore, !loading else { return }
        loadingMore = true
        defer { loadingMore = false }
        if let page = try? await APIClient.shared.printJobs(userId: person.isEmpty ? nil : person, from: range.from, to: range.to, cursor: cursor) {
            let known = Set(jobs.map(\.id))
            jobs += page.jobs.filter { !known.contains($0.id) }
            nextCursor = page.nextCursor
        }
    }
}

/// One print: what, how many, colour, state and when (and who, for BoD / One Above All).
private struct PrintLogRow: View {
    let job: PrintJob
    let showPerson: Bool

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: job.kindIcon)
                .font(.system(size: 16)).foregroundStyle(NX.violetText)
                .frame(width: 32, height: 32)
                .background(NX.accentBg, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                .accessibilityLabel(job.kind == "legal" ? T("Legal document") : T("Page"))
            VStack(alignment: .leading, spacing: 4) {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Text(job.title.isEmpty ? "—" : job.title)
                        .font(NXFont.text(15, .semibold)).foregroundStyle(NX.foreground)
                        .lineLimit(2)
                    Spacer(minLength: 4)
                    NexusChip(text: job.statusLabel, tone: job.statusTone)
                }
                Text(meta).font(NXFont.text(12)).foregroundStyle(NX.mutedFg)
                if job.status == "failed", let error = job.error, !error.isEmpty {
                    Text(error).font(NXFont.text(12)).foregroundStyle(NX.danger).lineLimit(3)
                }
            }
        }
        .padding(.vertical, 4)
        .accessibilityElement(children: .combine)
    }

    private var meta: String {
        var parts = [job.pagesLabel, job.isColor ? T("Color") : T("Black & white")]
        if let d = job.created {
            parts.append(AppDateLocale.shortDate(d) + ", " + AppDateLocale.formatter("HH:mm", timeZone: TimeZone(identifier: "Asia/Jakarta")).string(from: d))
        }
        if showPerson, let name = job.user?.name, !name.isEmpty { parts.insert(name, at: 0) }
        return parts.joined(separator: " · ")
    }
}

/// Settings → Print log, drawn like the GIDEON Memory row. Shown while the server has a printer
/// (RemoteConfig `printing.enabled`), like every other print entry point.
struct PrintLogEntryRow: View {
    @State private var config = RemoteConfig.shared

    var body: some View {
        if config.printingEnabled {
            NavigationLink { PrintLogView() } label: {
                HStack {
                    Label(T("Print log"), systemImage: "printer")
                    Spacer()
                    Image(systemName: "chevron.right").font(.system(size: 11)).foregroundStyle(NX.mutedFg)
                }
                .font(NXFont.text(14)).foregroundStyle(NX.foreground).frame(minHeight: 44)
            }
            // One label for the tour and VoiceOver ("Print log" / "Riwayat print"), without the chevron.
            .accessibilityLabel(T("Print log"))
            .accessibilityIdentifier("settings.printLog")
            .nexusCard()
        }
    }
}
