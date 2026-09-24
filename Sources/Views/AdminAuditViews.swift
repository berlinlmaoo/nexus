import SwiftUI

// MARK: - Audit (read-only)

/// Control Room → Audit.
///
/// The old tab was one card of 50 rows reading "UPDATE · task · Rina · 3 Sep": the first page of
/// the log and nothing after it, no way to narrow it, and no way to find out what an entry actually
/// changed. This one pages through the whole log (the route's own `limit`/`offset`), searches and
/// filters on the server so a filter covers the log and not just what happens to be loaded, and
/// opens every entry into the diff the server reads out of its metadata.
struct AdminAuditSection: View {
    @State private var logs: [AuditLog] = []
    @State private var total: Int?
    @State private var loading = true
    @State private var loadingMore = false
    @State private var reachedEnd = false
    @State private var error: String?
    /// Set when the first page came off the disk rather than the server.
    @State private var cachedFrom: Date?
    @State private var query = ""
    /// nil is "All". Values are the route's `action` param, which it matches exactly.
    @State private var action: String?
    @State private var opened: AuditLog?
    /// Bumped by every reload. A page that was in flight when the filter changed belongs to the old
    /// filter, and appending it would mix two different queries into one list.
    @State private var generation = 0

    private static let pageSize = 50
    private struct ActionFilter { let label: String; let value: String? }
    private static let filters: [ActionFilter] = [
        ActionFilter(label: "All", value: nil), ActionFilter(label: "Create", value: "create"),
        ActionFilter(label: "Update", value: "update"), ActionFilter(label: "Delete", value: "delete"),
        ActionFilter(label: "Login", value: "login"),
    ]

    private var trimmedQuery: String { query.trimmingCharacters(in: .whitespacesAndNewlines) }
    private var isFiltering: Bool { action != nil || !trimmedQuery.isEmpty }
    /// One key for both inputs, so `.task(id:)` restarts — and cancels the old fetch — on either.
    private var queryKey: String { "\(action ?? "")|\(trimmedQuery)" }

    var body: some View {
        VStack(spacing: 0) {
            controls
            content
        }
        .task(id: queryKey) {
            // Typing is debounced here rather than with a timer: `.task(id:)` cancels this closure on
            // the next keystroke, so only the pause after the last one reaches the server.
            if !trimmedQuery.isEmpty {
                try? await Task.sleep(nanoseconds: 350_000_000)
                if Task.isCancelled { return }
            }
            await reload()
        }
        // The only sheet on this view — the detail is the one thing it presents.
        .sheet(item: $opened) { AuditEntrySheet(log: $0) }
    }

    // MARK: controls

    private var controls: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                Image(systemName: "magnifyingglass").font(.system(size: 13)).foregroundStyle(NX.mutedFg)
                TextField(T("Search the audit log"), text: $query)
                    .font(NXFont.text(14)).textInputAutocapitalization(.never).autocorrectionDisabled()
                    .submitLabel(.search)
                if !query.isEmpty {
                    Button { query = "" } label: {
                        Image(systemName: "xmark.circle.fill").foregroundStyle(NX.mutedFg)
                    }.buttonStyle(.plain).accessibilityLabel(T("Clear search"))
                }
            }
            .padding(.horizontal, 12).padding(.vertical, 9)
            .background(NX.card, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(NX.border))

            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(Self.filters, id: \.label) { f in
                        let on = action == f.value
                        Button { action = f.value } label: {
                            Text(T(f.label)).font(NXFont.text(12, .semibold))
                                .foregroundStyle(on ? Color.white : NX.mutedFg)
                                .padding(.horizontal, 13).padding(.vertical, 7)
                                .background(on ? NX.violet : NX.card, in: Capsule())
                                .overlay(Capsule().strokeBorder(on ? Color.clear : NX.border))
                        }.buttonStyle(.plain)
                    }
                }
            }
        }
        .padding(.horizontal, 16).padding(.top, 12).padding(.bottom, 6)
    }

    // MARK: list

    @ViewBuilder private var content: some View {
        if loading && logs.isEmpty {
            ProgressView().tint(NX.violetText).frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if let error, logs.isEmpty {
            ErrorState(message: error, icon: "scroll") { Task { await reload() } }
        } else if logs.isEmpty {
            if isFiltering {
                EmptyState(icon: "line.3.horizontal.decrease.circle", title: T("Nothing matches this filter"),
                           subtitle: T("Search looks at the record's name, its type and the action. Try another word, or clear the filter."),
                           actionTitle: T("Clear filters"), actionIcon: nil, action: { query = ""; action = nil })
            } else {
                EmptyState(icon: "scroll", title: T("No audit entries yet."),
                           subtitle: T("Every create, change, delete and sign-in in the workspace is written here, newest first."))
            }
        } else {
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 8, pinnedViews: [.sectionHeaders]) {
                    ForEach(dayGroups, id: \.key) { group in
                        Section {
                            ForEach(group.rows) { log in
                                Button { opened = log } label: { AuditRow(log: log) }.buttonStyle(.plain)
                            }
                        } header: {
                            Text(group.title).font(NXFont.text(11, .bold)).tracking(0.5)
                                .foregroundStyle(NX.mutedFg)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .padding(.vertical, 6)
                                .background(NX.background)
                        }
                    }
                    footer
                }
                .padding(.horizontal, 16).padding(.bottom, 16)
            }
            .refreshable { await reload() }
        }
    }

    /// The sentinel that pulls the next page. Inside the LazyVStack, so it is only built — and its
    /// onAppear only fires — once the reader has actually scrolled down to it.
    @ViewBuilder private var footer: some View {
        if let cachedFrom {
            OfflineNotice(savedAt: cachedFrom)
        } else if !reachedEnd {
            HStack { Spacer(); ProgressView().tint(NX.violetText); Spacer() }
                .padding(.vertical, 12)
                .onAppear { Task { await loadMore() } }
        } else if logs.count > Self.pageSize {
            Text(String(format: T("That's all %d entries."), total ?? logs.count))
                .font(NXFont.text(11)).foregroundStyle(NX.mutedFg)
                .frame(maxWidth: .infinity).padding(.vertical, 12)
        }
    }

    private struct DayGroup { let key: String; let title: String; let rows: [AuditLog] }

    /// Consecutive rows of the same Jakarta day. The server already sorts newest first, so one pass
    /// keeps its order and never has to sort.
    private var dayGroups: [DayGroup] {
        var out: [DayGroup] = []
        var key = "", rows: [AuditLog] = []
        func flush() { if !rows.isEmpty { out.append(DayGroup(key: key, title: AuditTime.dayTitle(key), rows: rows)) } }
        for log in logs {
            let k = AuditTime.dayKey(log.createdAt)
            if k != key { flush(); key = k; rows = [] }
            rows.append(log)
        }
        flush()
        return out
    }

    // MARK: fetching

    private func reload() async {
        generation += 1
        let gen = generation
        loading = true; error = nil
        // Only the unfiltered first page is kept on disk: it is the one somebody opens the tab to
        // see, and a filtered page from a week ago shown as "the answer" would be misleading.
        let cacheable = !isFiltering
        do {
            let page = try await APIClient.shared.auditLogs(limit: Self.pageSize, offset: 0, action: action,
                                                            search: trimmedQuery, cache: cacheable)
            guard gen == generation else { return }
            logs = page.logs ?? []
            total = page.total
            reachedEnd = isLastPage(page, received: logs.count)
            cachedFrom = nil
        } catch {
            guard gen == generation else { return }
            if cacheable, let hit = ResponseCache.decoded(APIClient.auditCacheKey, as: AuditLogsResponse.self) {
                logs = hit.value.logs ?? []
                total = hit.value.total
                cachedFrom = hit.savedAt
                reachedEnd = true
            } else {
                logs = []
                self.error = (error as? LocalizedError)?.errorDescription ?? T("Couldn't load the audit log.")
            }
        }
        loading = false
    }

    private func loadMore() async {
        guard !loadingMore, !reachedEnd, !loading, cachedFrom == nil else { return }
        loadingMore = true
        defer { loadingMore = false }
        let gen = generation
        do {
            let page = try await APIClient.shared.auditLogs(limit: Self.pageSize, offset: logs.count, action: action,
                                                            search: trimmedQuery, cache: false)
            guard gen == generation else { return }
            // A row written between two page fetches shifts every offset by one, so the head of
            // this page can repeat the tail of the last one. Drop what is already on screen.
            let seen = Set(logs.map(\.id))
            let fresh = (page.logs ?? []).filter { !seen.contains($0.id) }
            logs.append(contentsOf: fresh)
            total = page.total ?? total
            reachedEnd = isLastPage(page, received: logs.count) || (page.logs ?? []).isEmpty
        } catch {
            // Stop asking rather than spin: the sentinel would fire again on the next layout pass
            // and hammer a server that just failed. Pull to refresh starts over.
            guard gen == generation else { return }
            reachedEnd = true
        }
    }

    private func isLastPage(_ page: AuditLogsResponse, received: Int) -> Bool {
        if let total = page.total { return received >= total }
        return (page.logs ?? []).count < Self.pageSize
    }
}

// MARK: - Row

/// How an action looks: one colour and one symbol per kind, so the eye can pick out the deletes in
/// a day of edits without reading a word.
struct AuditActionStyle {
    let icon: String
    let tint: Color

    init(_ action: String?) {
        let a = (action ?? "").lowercased()
        if a.hasPrefix("create") || a == "created" {
            icon = "plus"; tint = NX.success
        } else if a.hasPrefix("update") {
            icon = "pencil"; tint = NX.blue
        } else if a.hasPrefix("delete") {
            icon = "trash"; tint = NX.danger
        } else if a.hasPrefix("login") || a.hasPrefix("logout") {
            icon = "person.badge.key"; tint = Color.gray
        } else if a.hasPrefix("view") {
            icon = "eye"; tint = NX.violet
        } else {
            icon = "circle.dashed"; tint = NX.mutedFg
        }
    }
}

private struct AuditRow: View {
    let log: AuditLog

    /// The server's sentence when it sent one; otherwise what the old list showed.
    private var headline: String {
        if let s = log.summary?.trimmingCharacters(in: .whitespacesAndNewlines), !s.isEmpty { return s }
        let action = humanizeEnum(log.action ?? "")
        let what = log.entityName ?? log.entityType.map(humanizeEnum) ?? "—"
        return action.isEmpty ? what : "\(action) · \(what)"
    }

    var body: some View {
        let style = AuditActionStyle(log.action)
        let name = log.user?.name ?? T("System")
        HStack(alignment: .top, spacing: 12) {
            ZStack {
                Circle().fill(style.tint.opacity(0.15))
                Image(systemName: style.icon).font(.system(size: 13, weight: .bold)).foregroundStyle(style.tint)
            }
            .frame(width: 34, height: 34)
            VStack(alignment: .leading, spacing: 5) {
                Text(headline).font(NXFont.text(13, .semibold)).foregroundStyle(NX.foreground)
                    .lineLimit(3).multilineTextAlignment(.leading)
                    .fixedSize(horizontal: false, vertical: true)
                HStack(spacing: 6) {
                    AvatarView(url: log.user?.avatar, initial: String(name.prefix(1)).uppercased(), size: 18)
                    Text(name).font(NXFont.text(11, .semibold)).foregroundStyle(NX.mutedFg).lineLimit(1)
                    if let when = AuditTime.relative(log.createdAt) {
                        Text("· \(when)").font(NXFont.text(11)).foregroundStyle(NX.mutedFg).lineLimit(1)
                    }
                }
            }
            Spacer(minLength: 0)
            Image(systemName: "chevron.right").font(.system(size: 11, weight: .semibold))
                .foregroundStyle(NX.mutedFg.opacity(0.6)).padding(.top, 10)
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(NX.card, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(NX.border))
        .contentShape(Rectangle())
    }
}

// MARK: - Detail

/// One entry, read out: what changed, what it touched, and — folded away — the raw evidence.
private struct AuditEntrySheet: View {
    let log: AuditLog
    @Environment(\.dismiss) private var dismiss
    @State private var detail: AuditEntryDetail?
    @State private var error: String?
    @State private var showTechnical = false

    var body: some View {
        // Its own stack, so a tapped link pushes inside the sheet rather than trying to reach a
        // navigation stack underneath it that the sheet is covering.
        NavigationStack {
            ZStack {
                NX.background.ignoresSafeArea()
                ScrollView {
                    VStack(alignment: .leading, spacing: 14) {
                        header
                        if let detail {
                            if !detail.changes.isEmpty { changesCard(detail.changes) }
                            if !detail.details.isEmpty { detailsCard(detail.details) }
                            technicalCard(detail.entry)
                        } else if let error {
                            ErrorState(message: error, icon: "scroll") { Task { await load() } }
                                .frame(minHeight: 260)
                        } else {
                            ProgressView().tint(NX.violetText).frame(maxWidth: .infinity).padding(.vertical, 30)
                        }
                    }
                    .padding(16)
                }
            }
            .navigationTitle(T("Audit entry"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button(T("Close")) { dismiss() } } }
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
        .task { await load() }
    }

    private func load() async {
        error = nil
        do { detail = try await APIClient.shared.auditEntry(id: log.id) }
        catch { self.error = (error as? LocalizedError)?.errorDescription ?? T("Couldn't load this entry.") }
    }

    // Drawn from the row before the detail arrives, so the sheet is never blank while it loads.
    private var header: some View {
        let style = AuditActionStyle(detail?.entry.action ?? log.action)
        let user = detail?.entry.user ?? log.user
        let name = user?.name ?? T("System")
        let title = detail?.title ?? log.summary ?? log.entityName ?? humanizeEnum(log.action ?? "")
        let when = detail?.entry.createdAt ?? log.createdAt
        return VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top, spacing: 12) {
                ZStack {
                    Circle().fill(style.tint.opacity(0.15))
                    Image(systemName: style.icon).font(.system(size: 16, weight: .bold)).foregroundStyle(style.tint)
                }
                .frame(width: 42, height: 42)
                Text(title).font(NXFont.display(17, .bold)).foregroundStyle(NX.foreground)
                    .fixedSize(horizontal: false, vertical: true)
            }
            HStack(spacing: 8) {
                AvatarView(url: user?.avatar, initial: String(name.prefix(1)).uppercased(), size: 26)
                VStack(alignment: .leading, spacing: 1) {
                    Text(name).font(NXFont.text(13, .semibold)).foregroundStyle(NX.foreground)
                    Text([AuditTime.full(when), AuditTime.relative(when)].compactMap { $0 }.joined(separator: " · "))
                        .font(NXFont.text(11)).foregroundStyle(NX.mutedFg)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading).nexusCard()
    }

    private func changesCard(_ changes: [AuditEntryDetail.Change]) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            SectionLabel(T("What changed"))
            // By position, not by `field`: nothing promises one entry never lists a field twice.
            ForEach(changes.indices, id: \.self) { i in
                let c = changes[i]
                VStack(alignment: .leading, spacing: 4) {
                    Text(c.label).font(NXFont.text(12, .bold)).foregroundStyle(NX.foreground)
                    changeLine(c)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading).nexusCard()
    }

    /// Old value struck through in red, new value in green. A field that had no value before is a
    /// "Set to", not a strike through nothing; one that lost its value shows the old one struck
    /// through and says it was cleared.
    @ViewBuilder private func changeLine(_ c: AuditEntryDetail.Change) -> some View {
        if c.from == nil {
            Text(String(format: T("Set to %@"), c.to ?? "—"))
                .font(NXFont.text(13)).foregroundStyle(NX.success)
                .fixedSize(horizontal: false, vertical: true)
        } else {
            // A wrapping flow instead of an HStack: long values (a task description) would squeeze
            // an HStack into two unreadable columns.
            VStack(alignment: .leading, spacing: 3) {
                Text(c.from ?? "").strikethrough(true, color: NX.danger)
                    .font(NXFont.text(13)).foregroundStyle(NX.danger)
                    .fixedSize(horizontal: false, vertical: true)
                HStack(alignment: .firstTextBaseline, spacing: 5) {
                    Image(systemName: "arrow.right").font(.system(size: 10, weight: .bold)).foregroundStyle(NX.mutedFg)
                    if let to = c.to {
                        Text(to).font(NXFont.text(13, .semibold)).foregroundStyle(NX.success)
                            .fixedSize(horizontal: false, vertical: true)
                    } else {
                        Text(T("Cleared")).font(NXFont.text(13)).italic().foregroundStyle(NX.mutedFg)
                    }
                }
            }
        }
    }

    private func detailsCard(_ details: [AuditEntryDetail.Detail]) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            SectionLabel(T("Details")).padding(.bottom, 8)
            ForEach(details.indices, id: \.self) { i in
                if i > 0 { Divider().overlay(NX.border) }
                detailRow(details[i])
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading).nexusCard()
    }

    @ViewBuilder private func detailRow(_ d: AuditEntryDetail.Detail) -> some View {
        let line = HStack(alignment: .firstTextBaseline, spacing: 10) {
            Text(d.label).font(NXFont.text(12)).foregroundStyle(NX.mutedFg)
                .frame(width: 104, alignment: .leading)
            Text(d.value).font(NXFont.text(13, .semibold))
                .foregroundStyle(destination(d) == nil ? NX.foreground : NX.violetText)
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
            if destination(d) != nil {
                Image(systemName: "chevron.right").font(.system(size: 10, weight: .semibold)).foregroundStyle(NX.mutedFg)
            }
        }
        .padding(.vertical, 9)
        .contentShape(Rectangle())

        if let dest = destination(d) {
            NavigationLink { dest } label: { line }.buttonStyle(.plain)
        } else {
            line
        }
    }

    /// Where a link goes, for the kinds this app has a screen for. Attendance and form links have no
    /// by-id screen on iOS, so they are drawn as plain text rather than a row that opens nothing.
    private func destination(_ d: AuditEntryDetail.Detail) -> AnyView? {
        guard let link = d.link, !link.id.isEmpty else { return nil }
        switch link.type {
        case "task": return AnyView(TaskDetailView(taskId: link.id))
        case "project": return AnyView(ProjectDetailView(projectId: link.id, projectName: d.value))
        case "user": return AnyView(MemberProfileView(target: ProfileTarget(userId: link.id, name: d.value, avatar: nil)))
        default: return nil
        }
    }

    private func technicalCard(_ e: AuditEntryDetail.Entry) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Button {
                withAnimation(.easeInOut(duration: 0.18)) { showTechnical.toggle() }
            } label: {
                HStack {
                    SectionLabel(T("Technical"))
                    Spacer()
                    Image(systemName: "chevron.down").font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(NX.mutedFg).rotationEffect(.degrees(showTechnical ? 180 : 0))
                }
                .contentShape(Rectangle())
            }.buttonStyle(.plain)
            if showTechnical {
                techLine(T("Device"), e.userAgent)
                techLine(T("IP address"), e.ipAddress)
                techLine(T("Entity"), [e.entityType, e.entityId].compactMap { $0 }.joined(separator: " · "))
                techLine(T("Entry ID"), e.id)
                if let meta = e.metadata, !meta.isEmpty {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(T("Metadata")).font(NXFont.text(11, .bold)).foregroundStyle(NX.mutedFg)
                        ScrollView(.horizontal, showsIndicators: true) {
                            Text(meta.pretty).font(.system(size: 11, design: .monospaced))
                                .foregroundStyle(NX.foreground).textSelection(.enabled)
                                .fixedSize(horizontal: true, vertical: true)
                                .padding(10)
                        }
                        .background(NX.muted.opacity(0.6), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading).nexusCard()
    }

    @ViewBuilder private func techLine(_ label: String, _ value: String?) -> some View {
        if let value, !value.isEmpty {
            VStack(alignment: .leading, spacing: 2) {
                Text(label).font(NXFont.text(11, .bold)).foregroundStyle(NX.mutedFg)
                Text(value).font(.system(size: 12, design: .monospaced)).foregroundStyle(NX.foreground)
                    .textSelection(.enabled).fixedSize(horizontal: false, vertical: true)
            }
        }
    }
}

// MARK: - Time

/// Day keys, day headers and "5 min ago", all on Jakarta time: the log is read by people in one
/// office, and a header that flips to "Yesterday" at 07:00 because the phone is on UTC is wrong.
enum AuditTime {
    private static let keyFormatter: DateFormatter = {
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd"
        f.timeZone = ProjDate.cal.timeZone
        f.locale = Locale(identifier: "en_US_POSIX")
        return f
    }()
    private static let fullFormatter: DateFormatter = {
        let f = DateFormatter()
        f.dateFormat = "d MMM yyyy · HH:mm"
        f.timeZone = ProjDate.cal.timeZone
        f.locale = Locale(identifier: "en_US_POSIX")
        return f
    }()

    static func dayKey(_ iso: String?) -> String {
        guard let d = ProjDate.parse(iso) else { return "" }
        return keyFormatter.string(from: d)
    }

    static func dayTitle(_ key: String) -> String {
        guard let d = keyFormatter.date(from: key) else { return T("Unknown date").uppercased() }
        let cal = ProjDate.cal
        if cal.isDateInToday(d) { return T("Today").uppercased() }
        if cal.isDateInYesterday(d) { return T("Yesterday").uppercased() }
        return ProjDate.longLabel(d).uppercased()
    }

    static func full(_ iso: String?) -> String? {
        ProjDate.parse(iso).map { fullFormatter.string(from: $0) }
    }

    /// Short and relative ("5 min. ago"), in the app's own language rather than the phone's.
    /// Two formatters built once: this runs for every row the list draws.
    static func relative(_ iso: String?) -> String? {
        guard let d = ProjDate.parse(iso) else { return nil }
        let f = AppLanguage.shared.lang == .id ? relativeID : relativeEN
        return f.localizedString(for: d, relativeTo: Date())
    }
    private static let relativeEN = makeRelative("en_US")
    private static let relativeID = makeRelative("id_ID")
    private static func makeRelative(_ locale: String) -> RelativeDateTimeFormatter {
        let f = RelativeDateTimeFormatter()
        f.unitsStyle = .short
        f.locale = Locale(identifier: locale)
        return f
    }
}
