import SwiftUI

// MARK: - Social Media Report project view (owner, 14 Oct 2026)
//
// A project of type SOCIAL_MEDIA_REPORT shows Overview · Calendar · Chat, as the web's SocialMediaView.
// The two report tabs are ProjectDetailView's own tabs and share one store, so the month picked on one is
// the month on the other. Overview = per platform the month to date against the targets to date
// (engagement as the hero, posts below); Calendar = every day at a glance, a day opens its sheet with the
// figures per platform, the day's two notes and (Full access) its own targets.
//
// The server works everything out (src/lib/social-media.ts) and this app draws it; the shown month is read
// again whenever `social-media-changed` arrives on the project's room.

@MainActor
@Observable
final class SocialMediaStore {
    let projectId: String
    /// "YYYY-MM", the month both tabs show.
    private(set) var month: String
    private(set) var response: SocialMonthResponse?
    private(set) var loaded = false
    var loadError: String?
    var forbidden = false
    var signedOut = false
    /// A refused write, in the server's words when it gave some.
    var actionError: String?
    /// A one-line confirmation at the bottom ("Tuesday, 14 October saved.").
    var notice: String?
    /// The day whose sheet is open.
    var sheetDate: String?
    /// Platforms & targets.
    var settingsOpen = false
    @ObservationIgnored private var loadSeq = 0

    init(projectId: String) {
        self.projectId = projectId
        month = String(SocialFormat.wibToday().prefix(7))
    }

    private var current: SocialMonthResponse? { response?.month == month ? response : nil }
    var today: String { response?.today ?? SocialFormat.wibToday() }
    var thisYear: String { String(today.prefix(4)) }
    var config: SocialReportConfig { response?.config ?? .standard }
    var canRecord: Bool { response?.canRecord ?? false }
    var canManage: Bool { response?.canManage ?? false }
    var overview: SocialOverview? { current?.overview }
    var days: [SocialDay] { current?.days ?? [] }
    var targets: [SocialMonthTarget] { current?.targets ?? [] }
    var switching: Bool { loaded && response?.month != month }

    func day(_ d: String) -> SocialDay? { current?.days.first { $0.date == d } }
    func ownTarget(_ d: String, _ platformId: String) -> SocialDayTarget? {
        current?.dayTargets.first { $0.date == d && $0.platformId == platformId }
    }
    func hasOwnTarget(_ d: String) -> Bool { current?.dayTargets.contains { $0.date == d } ?? false }
    func monthTarget(_ platformId: String) -> SocialMonthTarget? { current?.targets.first { $0.platformId == platformId } }
    /// Some day of the month has its own engagement target for this platform.
    func hasOwnEngagementTarget(_ platformId: String) -> Bool {
        current?.dayTargets.contains { $0.platformId == platformId && $0.engagementTarget != nil } ?? false
    }

    /// The first load and every quiet reload. A reload that fails leaves what is drawn alone.
    func load() async {
        loadSeq += 1
        let seq = loadSeq
        let wanted = month
        do {
            let r = try await APIClient.shared.socialMonth(projectId: projectId, month: wanted)
            guard seq == loadSeq else { return }
            response = r
            loaded = true
            loadError = nil
            forbidden = false
        }
        catch APIError.unauthorized { signedOut = true }
        catch APIError.http(403, _) { if seq == loadSeq { forbidden = true } }
        catch {
            guard seq == loadSeq else { return }
            if !loaded { loadError = (error as? LocalizedError)?.errorDescription ?? T("Check your connection, then try again.") }
        }
    }

    func show(month m: String) async {
        guard m != month else { return }
        month = m
        await load()
    }

    /// Open a day's sheet, switching to its month first.
    func open(_ date: String) {
        sheetDate = date
        let m = String(date.prefix(7))
        if m != month { Task { await show(month: m) } }
    }

    func saveDay(_ date: String, body: [String: Any]) async -> Bool {
        do {
            try await APIClient.shared.socialSaveDay(projectId: projectId, date: date, body: body)
            notice = String(format: T("%@ saved."), OutletFormat.dayLong(date, thisYear: thisYear))
            await load()
            return true
        } catch {
            fail(error, T("The day wasn't saved. Try again."))
            return false
        }
    }

    func saveDayTargets(_ date: String, platforms: [String: Any]) async -> Bool {
        do {
            try await APIClient.shared.socialSaveDayTargets(projectId: projectId, date: date, platforms: platforms)
            notice = T("Day targets saved.")
            await load()
            return true
        } catch {
            fail(error, T("The target wasn't saved. Try again."))
            return false
        }
    }

    func saveTargets(platforms: [String: Any]) async throws {
        try await APIClient.shared.socialSaveTargets(projectId: projectId, month: month, platforms: platforms)
    }

    func fail(_ error: Error, _ fallback: String) {
        guard let api = error as? APIError else {
            actionError = (error as? LocalizedError)?.errorDescription ?? fallback
            return
        }
        switch api {
        case .unauthorized: signedOut = true
        case .http(_, let message): actionError = (message?.isEmpty == false) ? message : fallback
        default: actionError = api.errorDescription ?? fallback
        }
    }
}

/// A date for `.sheet(item:)`.
struct SocialSheetItem: Identifiable, Hashable { let id: String }

extension ProjectTab {
    /// The tabs a Social Media Report draws from its store, in the web's order.
    static let socialTabs: [ProjectTab] = [.overview, .calendar]
    var isSocialView: Bool { Self.socialTabs.contains(self) }
}

/// The report's two tabs. One view (one identity) for both, so switching keeps the store's month.
struct SocialMediaTab: View {
    @Bindable var store: SocialMediaStore
    @Binding var tab: ProjectTab

    @Environment(AuthStore.self) private var auth

    var body: some View {
        Group {
            if store.forbidden {
                EmptyState(icon: "lock", title: T("This report is for its project members"),
                           subtitle: T("Ask the Project Owner or a board member to add you to the project."))
            } else if !store.loaded {
                if let err = store.loadError {
                    ErrorState(message: err, icon: "heart.text.square") {
                        Task { store.loadError = nil; await store.load() }
                    }
                } else {
                    ProgressView().tint(NX.violetText).frame(maxWidth: .infinity, maxHeight: .infinity)
                        .accessibilityLabel(T("Loading the report"))
                }
            } else {
                Group {
                    switch tab {
                    case .calendar: SocialCalendarView(store: store)
                    default: SocialOverviewView(store: store)
                    }
                }
                // On this inner view, not next to the day sheet below: two .sheet modifiers on one view
                // leave one of them dead.
                .sheet(isPresented: $store.settingsOpen) {
                    // At most 720 pt tall: page height left ~700 pt empty under the platforms (UI tour run 16, R16-I-29).
                    SocialSettingsSheet(store: store).modifier(PageWideFittedSheet(maxHeight: 720))
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .task { await store.load() }
        .liveRefresh(every: 60, on: [.nexusSocialMediaChanged], projectId: store.projectId) { await store.load() }
        .onChange(of: store.signedOut) { _, out in if out { auth.logout() } }
        .sheet(item: Binding(get: { store.sheetDate.map(SocialSheetItem.init) },
                             set: { store.sheetDate = $0?.id })) { item in
            // Page sized on iPad / Mac: the form sheet showed only Instagram and one TikTok row, and the notes,
            // targets and "Last changed by" were never seen (UI tour run 15, Q-IB4).
            SocialDaySheet(store: store, date: item.id).tallSheet()
        }
        .alert(store.actionError ?? "", isPresented: Binding(
            get: { store.sheetDate == nil && !store.settingsOpen && store.actionError != nil },
            set: { if !$0 { store.actionError = nil } })) {
            Button("OK") { store.actionError = nil }
        }
        .overlay(alignment: .bottom) {
            if let notice = store.notice {
                Text(notice)
                    .font(NXFont.text(13, .semibold)).foregroundStyle(NX.card)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 16).padding(.vertical, 11)
                    .background(NX.foreground, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                    .padding(.horizontal, 20).padding(.bottom, 18)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
                    .onTapGesture { store.notice = nil }
            }
        }
        .animation(.easeOut(duration: 0.2), value: store.notice)
        .task(id: store.notice) {
            guard store.notice != nil else { return }
            try? await Task.sleep(nanoseconds: 4_500_000_000)
            if !Task.isCancelled { store.notice = nil }
        }
    }
}

// MARK: - Header

/// ‹ Oktober 2026 › with "This month", Platforms & targets (Full access) and Record today (Edit access).
struct SocialHeader: View {
    @Bindable var store: SocialMediaStore
    @Environment(\.horizontalSizeClass) private var hSize

    var body: some View {
        if hSize == .regular {
            // Words while they fit on one line, icons when they don't: a portrait iPad wrapped "Report
            // settings" and "Copy form link" onto two lines (UI tour run 13, I-10).
            // Then the labelled pair on a row of its own under the month, as the outlet's header does, before
            // icons: the two sibling pages must not disagree (UI tour run 17, iPad R17-I-14, decision 15).
            ViewThatFits(in: .horizontal) {
                row(labelled: true)
                VStack(alignment: .leading, spacing: 10) {
                    monthSwitcher(large: true)
                    HStack(spacing: 10) { actions(labelled: true, primary: true); Spacer(minLength: 0) }
                }
                row(labelled: false, primary: true)
                row(labelled: false)
            }
        } else {
            // Both named, as on the web and the outlet's header: on a row of their own under the month when they
            // do not fit beside it (UI tour run 18, iPhone R18-I-05: a bare sliders icon), before icons.
            ViewThatFits(in: .horizontal) {
                row(labelled: true)
                VStack(alignment: .leading, spacing: 8) {
                    monthSwitcher(large: false)
                    HStack(spacing: 6) { actions(labelled: true, primary: true); Spacer(minLength: 0) }
                }
                row(labelled: false, primary: true)
                row(labelled: false)
            }
        }
    }

    private func row(labelled: Bool, primary: Bool = false) -> some View {
        let wide = hSize == .regular
        return HStack(spacing: wide ? 10 : 6) {
            monthSwitcher(large: wide)
            Spacer(minLength: 4)
            actions(labelled: labelled, primary: primary)
        }
    }

    @ViewBuilder private func actions(labelled: Bool, primary: Bool) -> some View {
            if store.canManage {
                Button { store.settingsOpen = true } label: {
                    HStack(spacing: 6) {
                        Image(systemName: "slider.horizontal.3").font(.system(size: 14, weight: .semibold))
                        if labelled { Text(T("Platforms & targets")).font(NXFont.text(14, .semibold)).lineLimit(1).fixedSize() }
                    }
                    .foregroundStyle(NX.foreground)
                    .padding(.horizontal, labelled ? 14 : 0)
                    .frame(minWidth: 40, minHeight: 40)
                    .background(NX.card, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(NX.border))
                    .contentShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                }
                .buttonStyle(.plain)
                .hoverEffect(.highlight)
                .accessibilityLabel(T("Platforms & targets"))
            }
            if store.canRecord {
                Button { store.open(store.today) } label: {
                    HStack(spacing: 6) {
                        Image(systemName: "square.and.pencil").font(.system(size: 14, weight: .bold))
                        if labelled || primary { Text(T("Record today")).font(NXFont.text(14, .semibold)).lineLimit(1).fixedSize() }
                    }
                    // The web's near-black primary (UI tour run 15, Q-IB22).
                    .foregroundStyle(NX.background)
                    .padding(.horizontal, labelled || primary ? 14 : 0)
                    .frame(minWidth: 40, minHeight: 40)
                    .background(NX.onyx, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                    .contentShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                }
                .buttonStyle(.plain)
                .hoverEffect(.highlight)
                .accessibilityLabel(T("Record today"))
            }
    }

    private func monthSwitcher(large: Bool) -> some View {
        let current = String(store.today.prefix(7))
        return HStack(spacing: 2) {
            arrow("chevron.left", T("Previous month"), by: -1)
            Text(OutletFormat.monthLabel(store.month))
                .font(NXFont.display(large ? 22 : 16, .bold)).foregroundStyle(NX.foreground)
                .lineLimit(1).minimumScaleFactor(0.75)
                .frame(minWidth: large ? 150 : 112)
                .monospacedDigit()
            arrow("chevron.right", T("Next month"), by: 1)
            if store.month != current {
                Button(T("This month")) { Task { await store.show(month: current) } }
                    .font(NXFont.text(12, .semibold)).foregroundStyle(NX.violetText)
                    .lineLimit(1)
                    .padding(.horizontal, 6).frame(minHeight: 40)
            }
            if store.switching { ProgressView().scaleEffect(0.7).tint(NX.violetText) }
        }
    }

    private func arrow(_ icon: String, _ label: String, by: Int) -> some View {
        Button { Task { await store.show(month: OutletFormat.shiftMonth(store.month, by: by)) } } label: {
            Image(systemName: icon).font(.system(size: 14, weight: .bold)).foregroundStyle(NX.mutedFg)
                .frame(width: 36, height: 40).contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .hoverEffect(.highlight)
        .accessibilityLabel(label)
    }
}

/// "Engagement = Likes + Comments + Shares", one tap away, in a centred alert.
struct SocialEngagementInfoButton: View {
    @State private var shown = false
    var body: some View {
        Button { shown = true } label: {
            Image(systemName: "info.circle").font(.system(size: 14)).foregroundStyle(NX.mutedFg)
                .frame(minWidth: 32, minHeight: 32).contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(T("What counts as engagement"))
        .alert(T("Engagement = Likes + Comments + Shares"), isPresented: $shown) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(T("Views are counted on their own and are not part of engagement."))
        }
    }
}

// MARK: - Overview

struct SocialOverviewView: View {
    @Bindable var store: SocialMediaStore
    @Environment(\.horizontalSizeClass) private var hSize
    private var wide: Bool { hSize == .regular }
    /// The width the platform cards share.
    @State private var gridWidth: CGFloat = 0
    /// Three across on a portrait iPad as on the web: at 280 YouTube sat alone on a full-width row (UI tour
    /// run 15, Q-IB10).
    private static let cardMinWidth: CGFloat = 200

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: wide ? 20 : 14) {
                SocialHeader(store: store)
                content
            }
            .outletPage(wide: wide)
            .opacity(store.switching ? 0.55 : 1)
        }
        .refreshable { await store.load() }
    }

    @ViewBuilder private var content: some View {
        let monthName = OutletFormat.monthLabel(store.month)
        let setup: (() -> Void)? = store.canManage ? { store.settingsOpen = true } : nil
        let record: (() -> Void)? = store.canRecord ? { store.open(store.today) } : nil
        if let o = store.overview {
            if o.cutoff == nil {
                EmptyState(icon: "calendar.badge.clock", title: String(format: T("%@ hasn't started yet"), monthName),
                           subtitle: store.canManage ? T("You can set its targets now. The overview fills in from its first day.") : T("The overview fills in from its first day."),
                           actionTitle: store.canManage ? T("Set targets") : nil, actionIcon: "target",
                           action: setup)
            } else if o.recordedDays == 0 {
                EmptyState(icon: "heart.text.square", title: String(format: T("Nothing recorded for %@ yet"), monthName),
                           subtitle: store.canRecord
                               ? T("Record each day's views, likes, comments, shares and posts per platform. The totals and targets show up here.")
                               : T("The team records each day's figures per platform. They show up here once someone has."),
                           actionTitle: store.canRecord ? T("Record today") : nil, actionIcon: "square.and.pencil",
                           action: record)
            } else {
                summary(o)
            }
        }
    }

    @ViewBuilder private func summary(_ o: SocialOverview) -> some View {
        HStack(spacing: 4) {
            Text(o.cutoff.map { String(format: T("Month to date · %@"), OutletFormat.monthSpan(store.month, to: $0)) } ?? T("Month to date"))
                .font(NXFont.text(13)).foregroundStyle(NX.mutedFg)
            SocialEngagementInfoButton()
            Spacer(minLength: 0)
            if store.targets.allSatisfy({ $0.engagementTarget == nil && $0.postsTarget == nil }) && store.canManage {
                Button { store.settingsOpen = true } label: {
                    Label(T("Set this month's targets"), systemImage: "target").font(NXFont.text(13, .semibold))
                }
                .foregroundStyle(NX.violetText)
            }
        }
        // Rows of equal-height cards, as many across as fit (three on a Mac, like the web). A last row
        // with fewer cards shares the full width, so no card sits next to an empty slot (run 14, P-I29).
        let across = max(1, min(o.platforms.count, Int((gridWidth + 14) / (Self.cardMinWidth + 14))))
        let rows = stride(from: 0, to: o.platforms.count, by: across).map { Array(o.platforms[$0..<min($0 + across, o.platforms.count)]) }
        VStack(spacing: 14) {
            ForEach(rows, id: \.first?.id) { row in
                HStack(alignment: .top, spacing: 14) {
                    ForEach(row) { p in engagementCard(p) }
                }
                .fixedSize(horizontal: false, vertical: true)
            }
        }
        .frame(maxWidth: .infinity)
        .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { gridWidth = $0 }
        postsCard(o)
    }

    private func engagementCard(_ p: SocialPlatformOverview) -> some View {
        OutletCard(fillHeight: true) {
            HStack(alignment: .firstTextBaseline) {
                Text(p.archived == true ? "\(p.name) · \(T("archived"))" : p.name)
                    .font(NXFont.text(wide ? 15 : 14, .semibold)).foregroundStyle(NX.foreground).lineLimit(1)
                Spacer(minLength: 8)
                Text(T("Engagement")).font(NXFont.text(12)).foregroundStyle(NX.mutedFg)
            }
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Text(SocialFormat.count(p.engagement))
                    .font(NXFont.display(wide ? 30 : 26, .bold)).foregroundStyle(NX.foreground).monospacedDigit()
                Text("/ \(SocialFormat.count(p.engagementTargetToDate))")
                    .font(NXFont.text(15)).foregroundStyle(NX.mutedFg).monospacedDigit()
                if let pct = p.engagementPct { SocialPctChip(pct: pct) }
            }
            .lineLimit(1).minimumScaleFactor(0.7)
            OutletMeter(pct: p.engagementPct)
            if p.engagementTargetToDate == nil {
                // No target: the next step, not a dead end (W-B15 / M-15).
                // Side by side where they fit, else one under the other, never broken mid-phrase ("No engagement
                // / target", "Set a / target" in a narrow iPad card; UI tour run 17, iPad R17-I-13).
                ViewThatFits(in: .horizontal) {
                    HStack(spacing: 8) { noTargetParts }
                    VStack(alignment: .leading, spacing: 6) { noTargetParts }
                }
            } else {
                // One line on every card, as the web's, stepping the size down rather than wrapping "(incl. day
                // targets)" (UI tour run 16, R16-B-20); the figures below line up across the row.
                // Two lines where one does not fit: at 0.75 scale a narrow iPad card still cut "(incl. day
                // targets)" to "(in…" (UI tour run 17, iPad R17-I-02).
                // Two lines kept on every card side by side, so one card's wrapped helper does not push its
                // sparkline and figures below the others' (UI tour run 18, R18-M-06).
                // Run 20 (Mac R20-M-03, iPad R20-I-03): the one Text broke before "(incl. day targets)" on the Mac and
                // cut it to "(incl. day tar…" on the iPad. Now: the whole line where it fits (12, then 11 pt, as the
                // web keeps it), else whole phrases on their own lines, never cut.
                let line = monthTargetLine(p)
                ViewThatFits(in: .horizontal) {
                    Text(line).font(NXFont.text(12)).lineLimit(1).fixedSize()
                    Text(line).font(NXFont.text(11)).lineLimit(1).fixedSize()
                    phraseLines(Self.phraseParts(line, atDots: false))
                    phraseLines(Self.phraseParts(line, atDots: true))
                }
                .foregroundStyle(NX.mutedFg)
                .frame(minHeight: wide ? 32 : nil, alignment: .topLeading)
            }
            if let trend = p.trend, trend.count > 1, trend.contains(where: { $0 > 0 }) {
                SocialSparkline(values: trend)
                    .frame(height: 36)
                    .accessibilityLabel(String(format: T("%@ engagement per day"), p.name))
            }
            // The figures rest on the card's bottom, level across the row whatever sits above them (a card
            // without a target or a sparkline; R18-M-06). Side by side only: stacked cards have their own height.
            if wide { Spacer(minLength: 0) }
            Divider().overlay(NX.border)
            // Four across while every figure fits on one line, else two by two: in the narrow three-across
            // cards of a portrait iPad "41.000" broke into "41.00 / 0" and read as a decimal (UI tour run 16,
            // R16-I-04).
            ViewThatFits(in: .horizontal) {
                HStack(alignment: .top, spacing: 10) { stats(p) }
                Grid(alignment: .leading, horizontalSpacing: 10, verticalSpacing: 8) {
                    GridRow {
                        stat(SocialMetric.views.label, p.views)
                        stat(T("Likes"), p.likes)
                    }
                    GridRow {
                        stat(SocialMetric.comments.label, p.comments)
                        stat(SocialMetric.shares.label, p.shares)
                    }
                }
            }
        }
    }

    @ViewBuilder private var noTargetParts: some View {
        Text(T("No engagement target")).font(NXFont.text(12)).foregroundStyle(NX.mutedFg)
            .lineLimit(1).fixedSize()
        if store.canManage {
            // An underlined text link in the text colour, as web (decision 12 of run 20, R20-B-29: a violet link
            // with an icon).
            Button { store.settingsOpen = true } label: {
                Text(T("Set a target")).font(NXFont.text(12, .medium)).underline()
                    .lineLimit(1).fixedSize()
            }
            .buttonStyle(.borderless)
            .foregroundStyle(NX.foreground)
        }
    }

    @ViewBuilder private func stats(_ p: SocialPlatformOverview) -> some View {
        stat(SocialMetric.views.label, p.views)
        stat(T("Likes"), p.likes)
        stat(SocialMetric.comments.label, p.comments)
        stat(SocialMetric.shares.label, p.shares)
    }

    /// The overview's month target is the sum of every day's target. When a day has its own target that sum
    /// differs from the base target in Platforms & targets, so it says so (F-20 / W-B3).
    private func monthTargetLine(_ p: SocialPlatformOverview) -> String {
        let base = store.monthTarget(p.id)?.engagementTarget
        let month = p.engagementTargetMonth
        let hasDayTargets = store.hasOwnEngagementTarget(p.id)
        if let month, hasDayTargets, base?.rounded() != month.rounded() {
            return Self.phrases(String(format: T("Target to date · month target %@ (incl. day targets)"), SocialFormat.count(month)))
        }
        return Self.phrases(String(format: T("Target to date · month target %@"), SocialFormat.count(month)))
    }

    /// Breaks only between phrases (at " · " and before "("), never inside one: "month / target 62.000" and
    /// "(incl. / day targets)" wrapped mid-phrase (UI tour run 19, iPad R19-I-09, Mac R19-M-10).
    static func phrases(_ line: String) -> String {
        line.components(separatedBy: " · ").map { part in
            part.components(separatedBy: " (").map { $0.replacingOccurrences(of: " ", with: "\u{00A0}") }
                .joined(separator: " (")
        }
        .joined(separator: " · ")
    }

    /// The helper's phrases: split before "(", and also after each " · " when `atDots`.
    static func phraseParts(_ line: String, atDots: Bool) -> [String] {
        let flat = line.replacingOccurrences(of: "\u{00A0}", with: " ")
        let dots = flat.components(separatedBy: " · ")
        let groups = atDots ? dots.enumerated().map { i, g in i < dots.count - 1 ? g + " ·" : g } : [flat]
        return groups.flatMap { g -> [String] in
            let parts = g.components(separatedBy: " (")
            return parts.enumerated().map { i, part in i == 0 ? part : "(" + part }
        }
    }

    private func phraseLines(_ parts: [String]) -> some View {
        VStack(alignment: .leading, spacing: 1) {
            ForEach(Array(parts.enumerated()), id: \.offset) { _, part in
                Text(part).font(NXFont.text(12)).lineLimit(1).fixedSize()
            }
        }
    }

    private func stat(_ label: String, _ value: Double?) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            // Whole words and whole numbers: neither is ever cut or wrapped (R16-I-04: "Com…", "125.0 / 00").
            Text(label).font(NXFont.text(11)).foregroundStyle(NX.mutedFg).lineLimit(1).fixedSize()
            Text(SocialFormat.count(value)).font(NXFont.text(13, .semibold)).foregroundStyle(NX.foreground).monospacedDigit()
                .lineLimit(1).fixedSize()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func postsCard(_ o: SocialOverview) -> some View {
        OutletCard {
            Text(T("Posts published")).font(NXFont.text(14, .semibold)).foregroundStyle(NX.foreground)
            ForEach(o.platforms) { p in
                // One row as the web's: the platform, its bar, then "5 / 16 posts (31%)" (UI tour run 19, R19-B-06).
                HStack(spacing: 10) {
                    Text(p.name).font(NXFont.text(13, .medium)).foregroundStyle(NX.foreground).lineLimit(1)
                        .frame(width: 84, alignment: .leading)
                    OutletMeter(pct: p.postsPct, height: 6)
                    Group {
                        if let target = p.postsTargetToDate {
                            Text(String(format: T("%@ / %@ posts"), SocialFormat.count(p.posts), SocialFormat.count(target))
                                 + (p.postsPct.map { " (\($0)%)" } ?? ""))
                        } else {
                            Text(SocialFormat.posts(p.posts))
                        }
                    }
                    .font(NXFont.text(13)).monospacedDigit().lineLimit(1).fixedSize()
                }
                .accessibilityElement(children: .combine)
            }
            Text(T("Target to date = each day's target up to today. A day without its own target takes the month's target split evenly."))
                .font(NXFont.text(12)).foregroundStyle(NX.mutedFg)
        }
    }
}

/// "20%" on a soft pill: violet on the way, green once the target is reached.
struct SocialPctChip: View {
    let pct: Int64
    var size: CGFloat = 13
    var body: some View {
        Text("\(pct)%").font(NXFont.text(size, .bold)).monospacedDigit()
            // Grey like the web's chip; green once the target is met (UI tour run 16, R16-B-20).
            .foregroundStyle(pct >= 100 ? NX.success : NX.foreground)
            .padding(.horizontal, 8).padding(.vertical, 3)
            .background(pct >= 100 ? NX.success.opacity(0.12) : NX.muted, in: Capsule())
    }
}

/// The month's engagement per day, quiet: one dark line over a faint area, as the web (R16-B-20).
struct SocialSparkline: View {
    let values: [Double]
    var body: some View {
        GeometryReader { g in
            let maxV = max(1, values.max() ?? 1)
            let step = g.size.width / CGFloat(max(1, values.count - 1))
            let pt: (Int) -> CGPoint = { i in
                CGPoint(x: CGFloat(i) * step, y: g.size.height - 3 - CGFloat(values[i] / maxV) * (g.size.height - 8))
            }
            ZStack {
                Path { p in
                    p.move(to: CGPoint(x: 0, y: g.size.height))
                    for i in values.indices { p.addLine(to: pt(i)) }
                    p.addLine(to: CGPoint(x: g.size.width, y: g.size.height))
                    p.closeSubpath()
                }
                .fill(NX.foreground.opacity(0.06))
                Path { p in
                    for i in values.indices { if i == 0 { p.move(to: pt(i)) } else { p.addLine(to: pt(i)) } }
                }
                .stroke(NX.foreground, style: StrokeStyle(lineWidth: 2, lineCap: .round, lineJoin: .round))
                if let last = values.indices.last {
                    Circle().fill(NX.foreground).frame(width: 7, height: 7)
                        .overlay(Circle().strokeBorder(NX.card, lineWidth: 1.5))
                        .position(pt(last))
                }
            }
        }
        .accessibilityElement()
    }
}

// MARK: - Calendar

struct SocialCalendarView: View {
    @Bindable var store: SocialMediaStore
    @Environment(\.horizontalSizeClass) private var hSize
    private var wide: Bool { hSize == .regular }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: wide ? 20 : 14) {
                SocialHeader(store: store)
                grid
                OutletCalendarLegend(notes: true, unrecorded: true)
                Text(PlatformWording.tapOrClick(
                    tap: "Each day shows its engagement (likes + comments + shares) across platforms, and the posts published. Tap a day to record it.",
                    click: "Each day shows its engagement (likes + comments + shares) across platforms, and the posts published. Click a day to record it."))
                    .font(NXFont.text(12)).foregroundStyle(NX.mutedFg)
            }
            .outletPage(wide: wide)
            .opacity(store.switching ? 0.55 : 1)
        }
        .refreshable { await store.load() }
    }

    private var grid: some View {
        let cols = Array(repeating: GridItem(.flexible(), spacing: 0), count: 7)
        // One month-grid style everywhere (NXMonthGrid.swift; UI tour run 16, R16-I-06).
        return VStack(spacing: 0) {
            NXMonthWeekdayRow(names: OutletFormat.weekHeader, wide: wide)
            LazyVGrid(columns: cols, spacing: 0) {
                ForEach(OutletFormat.gridDays(store.month), id: \.self) { d in cell(d) }
            }
        }
        .nxMonthGridCard()
    }

    @ViewBuilder private func cell(_ d: String) -> some View {
        let inMonth = d.hasPrefix(store.month)
        let day = inMonth ? store.day(d) : nil
        let isToday = d == store.today
        let future = d > store.today
        Button { store.open(d) } label: {
            // Every day number top-left: centred, a day with a note icon pushed its number aside (UI tour run
            // 15, R15-I-18).
            // The number and the figures under it share one left inset; the notes and own-target marks sit in
            // the top-right corner, as on the outlet calendar and the web (UI tour run 16, R16-I-08).
            VStack(alignment: .leading, spacing: 3) {
                // The day-target mark right after the number, as on the outlet calendar (decision 12 of run 20,
                // R20-I-21); the notes mark keeps the corner.
                HStack(alignment: .center, spacing: 2) {
                    NXMonthDayNumber(day: OutletFormat.parts(d)?.d ?? 0, inMonth: inMonth, isToday: isToday,
                                     muted: future, wide: wide)
                    if inMonth && store.hasOwnTarget(d) { NXMonthTargetMark(wide: wide) }
                }
                // The plain dotted figure ("2.200"), never a compact "2.2k" (owner rule R14-WB-2, N-22 / P-M22).
                if let e = day?.engagement {
                    // Smaller, regular weight and muted under the bold day number, so "2" over "2.200" no longer
                    // reads as one figure (UI tour run 19, R19-B-17).
                    Text(SocialFormat.count(e)).font(NXFont.text(wide ? 12 : 10, .regular)).foregroundStyle(NX.mutedFg)
                        .monospacedDigit().lineLimit(1).minimumScaleFactor(0.7)
                        .padding(.top, 2)
                }
                // The posts line on every width, as the web and the caption under the grid say (UI tour run 17,
                // iPhone R17-I-04, decision 13).
                if let posts = day?.posts {
                    Text(SocialFormat.posts(posts))
                        .font(NXFont.text(wide ? 11 : 9)).foregroundStyle(NX.mutedFg)
                        .lineLimit(1).minimumScaleFactor(0.8)
                }
                Spacer(minLength: 0)
                // A day up to today with nothing recorded: the web's small grey dot (run 14, P-I30).
                if inMonth && !future && !(day?.recorded ?? false) {
                    Circle().fill(NX.mutedFg.opacity(0.5)).frame(width: 4, height: 4)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.leading, wide ? 4 : 2).padding(.bottom, 2)
                        .accessibilityHidden(true)
                }
            }
            .padding(wide ? 6 : 3)
            .frame(maxWidth: .infinity, minHeight: wide ? 92 : 58, alignment: .topLeading)
            .overlay(alignment: .topTrailing) {
                HStack(spacing: 2) {
                    if inMonth && (day?.hasNotes == true) {
                        Image(systemName: "square.and.pencil").font(.system(size: 9)).foregroundStyle(NX.mutedFg)
                    }
                }
                .padding(wide ? 7 : 4)
            }
            .nxMonthCell(inMonth: inMonth, selected: false)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(!inMonth)
        .hoverEffect(.highlight)
        .accessibilityLabel(cellLabel(d, day: day))
    }

    private func cellLabel(_ d: String, day: SocialDay?) -> String {
        var parts = [OutletFormat.dayLong(d, thisYear: store.thisYear)]
        if let e = day?.engagement { parts.append(String(format: T("%@ engagement"), SocialFormat.count(e))) }
        if let p = day?.posts { parts.append(SocialFormat.posts(p)) }
        if day?.hasNotes == true { parts.append(T("Has notes")) }
        if d.hasPrefix(store.month) && d <= store.today && !(day?.recorded ?? false) { parts.append(T("Not recorded")) }
        if d == store.today { parts.append(T("Today")) }
        return parts.joined(separator: ", ")
    }
}

// MARK: - Day sheet

/// One day: per platform the five figures (engagement adds itself up as you type), the two notes, and for
/// Full access the day's own targets. Only what changed is sent.
struct SocialDaySheet: View {
    @Bindable var store: SocialMediaStore
    let date: String

    @Environment(\.dismiss) private var dismiss
    @State private var figures: [String: [SocialMetric: String]] = [:]
    @State private var originalFigures: [String: [SocialMetric: String]] = [:]
    @State private var worked = ""
    @State private var didntWork = ""
    @State private var original = ("", "")
    @State private var ready = false
    @State private var saving = false
    @State private var confirmDiscard = false
    @State private var error: String?
    @State private var targetDraft: [String: (String, String)] = [:]
    @State private var editingTargets = false
    @Environment(\.horizontalSizeClass) private var hSize
    private var wide: Bool { hSize == .regular }

    private var future: Bool { date > store.today }
    private var editable: Bool { store.canRecord && !future }
    private var day: SocialDay? { store.day(date) }
    private var platforms: [SocialPlatform] {
        store.config.platforms.filter { p in
            !p.isArchived || SocialMetric.allCases.contains { day?.platforms[p.id]?.value($0) != nil }
        }
    }
    private var dirty: Bool {
        ready && (figuresChanged.count > 0 || worked != original.0 || didntWork != original.1)
    }
    private var figuresChanged: [(String, SocialMetric)] {
        var out: [(String, SocialMetric)] = []
        for (pid, f) in figures {
            for m in SocialMetric.allCases where OutletFormat.parse(f[m] ?? "") != OutletFormat.parse(originalFigures[pid]?[m] ?? "") {
                out.append((pid, m))
            }
        }
        return out
    }

    var body: some View {
        NavigationStack {
            Group {
                if ready { form }
                else if let failure = store.loadError {
                    ErrorState(message: failure, icon: "wifi.exclamationmark") { Task { await store.load(); fill() } }
                } else {
                    ProgressView().tint(NX.violetText).frame(maxWidth: .infinity, maxHeight: .infinity)
                }
            }
            .navigationTitle(OutletFormat.dayLong(date, thisYear: store.thisYear))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                // iPad / Mac with the footer: Cancel sits there beside Save, the same pattern as Platforms &
                // targets and Report settings (UI tour run 19, R19-B-16); a read-only day keeps Close on top.
                if !(wide && editable) {
                    ToolbarItem(placement: .cancellationAction) {
                        Button(editable ? T("Cancel") : T("Close")) { if dirty { confirmDiscard = true } else { dismiss() } }
                    }
                    .nxPlainOnMac()
                }
                if editable && !wide {
                    ToolbarItem(placement: .confirmationAction) {
                        Button { Task { await save() } } label: {
                            if saving { ProgressView() } else { Text(T("Save")).fontWeight(.semibold) }
                        }
                        .disabled(!dirty || saving)
                    }
                }
            }
        }
        // iPad / Mac: the web's "Save day" button under the form, the fields fading into its bar, so the last
        // platform's footer reads as "more below" instead of cut (UI tour run 16, R16-B-19 / R16-I-24).
        .safeAreaInset(edge: .bottom, spacing: 0) {
            if wide && editable && ready {
                HStack(spacing: 10) {
                    Spacer(minLength: 0)
                    Button(T("Cancel")) { if dirty { confirmDiscard = true } else { dismiss() } }
                        .buttonStyle(.nxBordered)
                    Button { Task { await save() } } label: {
                        HStack(spacing: 6) {
                            if saving { ProgressView().controlSize(.small) }
                            Text(T("Save day"))
                        }
                    }
                    .buttonStyle(.nxPrimary)
                    .disabled(!dirty || saving)
                }
                .padding(.horizontal, 20).padding(.vertical, 12)
                .background(NX.background)
                .overlay(alignment: .top) { Rectangle().fill(NX.border).frame(height: 1) }
                .background(alignment: .top) {
                    LinearGradient(colors: [NX.background.opacity(0), NX.background], startPoint: .top, endPoint: .bottom)
                        .frame(height: 24).offset(y: -24).allowsHitTesting(false)
                }
            }
        }
        .interactiveDismissDisabled(dirty)
        .onAppear { fill() }
        // An empty day stays nil after its month loads; observe the month as well as the day.
        .onChange(of: store.response?.month) { _, _ in if !dirty { fill() } }
        .onChange(of: store.day(date)) { _, _ in if !dirty { fill() } }
        .alert(confirmDiscard ? T("Discard the changes you haven't saved?") : (error ?? ""),
               isPresented: Binding(get: { confirmDiscard || error != nil }, set: { if !$0 { confirmDiscard = false; error = nil } })) {
            if confirmDiscard {
                Button(T("Keep editing"), role: .cancel) { confirmDiscard = false }
                Button(T("Discard"), role: .destructive) { confirmDiscard = false; dismiss() }
            } else {
                Button("OK") { error = nil }
            }
        } message: {
            if confirmDiscard { Text(T("This day stays as it was.")) }
        }
    }

    /// The day as the server has it (its month may still be on its way: then nothing is filled yet).
    private func fill() {
        guard store.response?.month == String(date.prefix(7)) else { return }
        var f: [String: [SocialMetric: String]] = [:]
        for p in platforms {
            var row: [SocialMetric: String] = [:]
            for m in SocialMetric.allCases { row[m] = day?.platforms[p.id]?.value(m).map { OutletFormat.grouped(Int64($0.rounded())) } ?? "" }
            f[p.id] = row
        }
        figures = f
        originalFigures = f
        worked = day?.worked ?? ""
        didntWork = day?.didntWork ?? ""
        original = (worked, didntWork)
        var t: [String: (String, String)] = [:]
        for p in store.config.active {
            let own = store.ownTarget(date, p.id)
            t[p.id] = (own?.engagementTarget.map { OutletFormat.grouped(Int64($0)) } ?? "", own?.postsTarget.map { OutletFormat.grouped(Int64($0)) } ?? "")
        }
        targetDraft = t
        ready = true
    }

    private func figureBinding(_ pid: String, _ m: SocialMetric) -> Binding<String> {
        Binding(get: { figures[pid]?[m] ?? "" },
                set: { figures[pid, default: [:]][m] = OutletFormat.regroup($0) })
    }

    private var form: some View {
        Form {
            Section {
                Text(future
                     ? T("This day hasn't come yet. Record it once it's over.")
                     : !store.canRecord ? T("You can view this report. Recording needs Can edit access.")
                     : T("Fill what you have. An empty box stays empty, 0 is a real zero."))
                    .font(NXFont.text(13)).foregroundStyle(NX.mutedFg)
                    .listRowBackground(Color.clear)
                    .listRowInsets(EdgeInsets(top: 0, leading: 4, bottom: 0, trailing: 4))
            }
            ForEach(platforms) { p in platformSection(p) }
            Section {
                TextField(T("e.g. the 7 pm reel, a trending sound"), text: $worked, axis: .vertical)
                    .lineLimit(3...8).disabled(!editable)
            } header: { SheetSectionTitle(T("What worked")) }
            Section {
                TextField(T("e.g. carousel posted too late"), text: $didntWork, axis: .vertical)
                    .lineLimit(3...8).disabled(!editable)
            } header: { SheetSectionTitle(T("What didn't work")) }
            if store.canManage { targetsSection }
            if let by = day?.updatedBy, let at = OutletFormat.stamp(day?.updatedAt) {
                Section {
                    Text("\(String(format: T("Last changed by %@"), by.name ?? "?")) · \(at)")
                        .font(NXFont.text(12)).foregroundStyle(NX.mutedFg)
                        .listRowBackground(Color.clear)
                }
            }
        }
        // No empty band under the title: the intro sits right under it (run 14, P-I31), and no ~60 pt gap
        // between the intro and the first platform (run 15, Q-IB15).
        .contentMargins(.top, 8, for: .scrollContent)
        .listSectionSpacing(.compact)
        .scrollDismissesKeyboard(.interactively)
    }

    private func platformSection(_ p: SocialPlatform) -> some View {
        let f = figures[p.id] ?? [:]
        let eng = SocialFormat.engagement(likes: OutletFormat.parse(f[.likes] ?? ""), comments: OutletFormat.parse(f[.comments] ?? ""),
                                          shares: OutletFormat.parse(f[.shares] ?? ""))
        let info = day?.platforms[p.id]
        let engagementText = SocialFormat.count(eng.map(Double.init))
            + (info?.engagementTarget.map { " / \(SocialFormat.count($0))" } ?? "")
        return Section {
            if wide {
                // iPad / Mac: the web's three-column field grid per platform, Engagement in the header
                // (UI tour run 16, R16-B-19: one long single-column list ~3 screens tall on a Mac).
                LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 12, alignment: .top), count: 3),
                          alignment: .leading, spacing: 12) {
                    ForEach(SocialMetric.allCases) { m in
                        VStack(alignment: .leading, spacing: 4) {
                            Text(m.label).font(NXFont.text(12)).foregroundStyle(NX.mutedFg).lineLimit(1)
                            // An empty box, not a "—" placeholder that read as an entered value (R19-B-14).
                            // Numbers right-aligned, as the web and Notion (UI tour run 20, R20-B-22).
                            TextField("", text: figureBinding(p.id, m))
                                .keyboardType(.numberPad)
                                .multilineTextAlignment(.trailing)
                                .monospacedDigit()
                                .padding(.horizontal, 10).frame(minHeight: 36)
                                .nxSoftField(radius: 8)
                                .disabled(!editable)
                                .accessibilityLabel("\(p.name) \(m.label)")
                        }
                    }
                }
                .padding(.vertical, 4)
            } else {
                ForEach(SocialMetric.allCases) { m in
                    HStack {
                        Text(m.label).foregroundStyle(NX.foreground)
                        Spacer(minLength: 12)
                        TextField("—", text: figureBinding(p.id, m))
                            .keyboardType(.numberPad)
                            .multilineTextAlignment(.trailing)
                            .monospacedDigit()
                            .frame(maxWidth: 160)
                            .disabled(!editable)
                            .accessibilityLabel("\(p.name) \(m.label)")
                    }
                }
                HStack {
                    Text(T("Engagement")).font(NXFont.text(14, .semibold))
                    SocialEngagementInfoButton()
                    Spacer()
                    Text(engagementText).font(NXFont.text(14, .semibold)).monospacedDigit()
                }
            }
        } header: {
            HStack {
                SheetSectionTitle(p.isArchived ? "\(p.name) · \(T("archived"))" : p.name)
                if wide {
                    Spacer(minLength: 8)
                    // The achieved value bold, the target muted, and the info icon, as the web's header (R20-B-22).
                    HStack(spacing: 4) {
                        Text(T("Engagement")).foregroundStyle(NX.mutedFg)
                        SocialEngagementInfoButton()
                        (Text(SocialFormat.count(eng.map(Double.init))).bold().foregroundColor(NX.foreground)
                         + Text(info?.engagementTarget.map { " / \(SocialFormat.count($0))" } ?? "").foregroundColor(NX.mutedFg))
                            .monospacedDigit()
                    }
                    .textCase(nil)
                }
            }
        } footer: {
            // Every platform says where its day target stands, YouTube without one too; the bottom padding
            // keeps "Month's target ÷ days" off the next platform's header (run 14, P-I31 / P-M22).
            Group {
                if let info, info.engagementTarget != nil || info.postsTarget != nil {
                    let parts = [info.engagementTarget.map { String(format: T("%@ engagement"), SocialFormat.count($0)) },
                                 info.postsTarget.map(SocialFormat.posts)].compactMap { $0 }
                    // One line where it fits, as on the web (UI tour run 15, Q-IB15); else the source on its own
                    // line, so "÷ days" never wraps alone (F-18).
                    let target = "\(T("Day target")): \(parts.joined(separator: " · "))"
                    let source = info.ownTarget ? T("Own target") : T("Month's target ÷ days")
                    ViewThatFits(in: .horizontal) {
                        Text("\(target) · \(source)").lineLimit(1)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(target)
                            Text(source)
                        }
                    }
                } else {
                    Text(T("No target set for this day"))
                }
            }
            .padding(.bottom, 10)
        }
    }

    @ViewBuilder private var targetsSection: some View {
        if editingTargets {
            Section {
                ForEach(store.config.active) { p in
                    VStack(alignment: .leading, spacing: 6) {
                        Text(p.name).font(NXFont.text(13, .semibold))
                        HStack {
                            Text(T("Engagement target")).font(NXFont.text(13)).foregroundStyle(NX.mutedFg)
                            Spacer()
                            TextField(share(store.monthTarget(p.id)?.engagementTarget), text: targetBinding(p.id, first: true))
                                .keyboardType(.numberPad).multilineTextAlignment(.trailing).frame(maxWidth: 140)
                        }
                        HStack {
                            Text(T("Posts target")).font(NXFont.text(13)).foregroundStyle(NX.mutedFg)
                            Spacer()
                            TextField(share(store.monthTarget(p.id)?.postsTarget), text: targetBinding(p.id, first: false))
                                .keyboardType(.numberPad).multilineTextAlignment(.trailing).frame(maxWidth: 140)
                        }
                    }
                }
                Button {
                    Task {
                        var body: [String: Any] = [:]
                        for (pid, v) in targetDraft {
                            body[pid] = [
                                "engagementTarget": OutletFormat.parse(v.0).map { NSNumber(value: $0) } ?? NSNull(),
                                "postsTarget": OutletFormat.parse(v.1).map { NSNumber(value: $0) } ?? NSNull(),
                            ] as [String: Any]
                        }
                        if await store.saveDayTargets(date, platforms: body) { editingTargets = false } else { error = store.actionError; store.actionError = nil }
                    }
                } label: { Text(T("Save targets")).fontWeight(.semibold) }
            } header: {
                Text(T("This day's targets"))
            } footer: {
                Text(T("Fill either, both or none. An empty box uses the month's target split over its days."))
            }
        } else {
            Section {
                Button { editingTargets = true } label: { Label(T("Set this day's targets"), systemImage: "target") }
            }
        }
    }

    private func share(_ monthly: Double?) -> String {
        guard let monthly else { return T("No target") }
        let days = Double(max(1, store.days.count))
        return SocialFormat.count(monthly / days)
    }

    private func targetBinding(_ pid: String, first: Bool) -> Binding<String> {
        Binding(get: { first ? targetDraft[pid]?.0 ?? "" : targetDraft[pid]?.1 ?? "" },
                set: { v in
                    var cur = targetDraft[pid] ?? ("", "")
                    if first { cur.0 = OutletFormat.regroup(v) } else { cur.1 = OutletFormat.regroup(v) }
                    targetDraft[pid] = cur
                })
    }

    private func save() async {
        saving = true
        defer { saving = false }
        var body: [String: Any] = [:]
        var plats: [String: [String: Any]] = [:]
        for (pid, m) in figuresChanged {
            plats[pid, default: [:]][m.rawValue] = OutletFormat.parse(figures[pid]?[m] ?? "").map { NSNumber(value: $0) } ?? NSNull()
        }
        if !plats.isEmpty { body["platforms"] = plats }
        if worked != original.0 { body["worked"] = worked }
        if didntWork != original.1 { body["didntWork"] = didntWork }
        if await store.saveDay(date, body: body) {
            originalFigures = figures
            original = (worked, didntWork)
            dismiss()
        } else {
            error = store.actionError
            store.actionError = nil
        }
    }
}

// MARK: - Platforms & targets

/// A platform row while editing: its stable server id ("" for a new one) and a local row id.
private struct SocialPlatformRow: Identifiable, Equatable {
    let id: String
    var platformId: String
    var name: String
    var archived: Bool
}

struct SocialSettingsSheet: View {
    @Bindable var store: SocialMediaStore
    @Environment(\.horizontalSizeClass) private var hSize

    @Environment(\.dismiss) private var dismiss
    @State private var usage: [String: Int] = [:]
    @State private var rows: [SocialPlatformRow] = []
    @State private var originalRows: [SocialPlatformRow] = []
    @State private var targets: [String: [String]] = [:]
    @State private var originalTargets: [String: [String]] = [:]
    @State private var newName = ""
    @State private var loaded = false
    @State private var loadFailed = false
    @State private var saving = false
    @State private var error: String?
    @State private var confirmDiscard = false
    @State private var pendingArchive: SocialPlatformRow?

    private var dirty: Bool {
        loaded && (rows != originalRows || targets != originalTargets || !newName.trimmingCharacters(in: .whitespaces).isEmpty)
    }

    var body: some View {
        NavigationStack {
            Group {
                if loaded { form }
                else if loadFailed {
                    EmptyState(icon: "wifi.exclamationmark", title: T("The settings didn't load. Check your connection, then try again."),
                               actionTitle: T("Try again"), actionIcon: "arrow.clockwise", action: { Task { await load() } })
                } else {
                    ProgressView().tint(NX.violetText).frame(maxWidth: .infinity, maxHeight: .infinity)
                }
            }
            .navigationTitle(T("Platforms & targets"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                if hSize != .regular {
                    ToolbarItem(placement: .cancellationAction) {
                        Button(T("Cancel")) { if dirty { confirmDiscard = true } else { dismiss() } }
                    }
                    ToolbarItem(placement: .confirmationAction) {
                        Button { Task { await save() } } label: {
                            if saving { ProgressView() } else { Text(T("Save")).fontWeight(.semibold) }
                        }
                        .disabled(!dirty || saving)
                    }
                }
            }
            // iPad / Mac: Cancel and "Save settings" at the bottom, the same footer as the outlet's Report
            // settings and the web (UI tour run 17, R17-B-04, decision 10).
            .safeAreaInset(edge: .bottom, spacing: 0) {
                if hSize == .regular && loaded {
                    HStack(spacing: 10) {
                        Spacer(minLength: 0)
                        Button(T("Cancel")) { if dirty { confirmDiscard = true } else { dismiss() } }
                            .buttonStyle(.nxBordered)
                        Button { Task { await save() } } label: {
                            HStack(spacing: 6) {
                                if saving { ProgressView().controlSize(.small) }
                                Text(T("Save settings"))
                            }
                        }
                        .buttonStyle(.nxPrimary)
                        .disabled(!dirty || saving)
                    }
                    .padding(.horizontal, 20).padding(.vertical, 12)
                    .background(NX.background)
                    .overlay(alignment: .top) { Rectangle().fill(NX.border).frame(height: 1) }
                }
            }
        }
        .interactiveDismissDisabled(dirty)
        .task { await load() }
        // One centred alert for every question and refusal (owner rule: .alert, not a confirmation dialog).
        .alert(alertTitle, isPresented: Binding(get: { pendingArchive != nil || confirmDiscard || error != nil },
                                                set: { if !$0 { pendingArchive = nil; confirmDiscard = false; error = nil } })) {
            if let p = pendingArchive {
                Button(T("Cancel"), role: .cancel) { pendingArchive = nil }
                Button(T("Archive")) { setArchived(p.id, true); pendingArchive = nil }
            } else if confirmDiscard {
                Button(T("Keep editing"), role: .cancel) { confirmDiscard = false }
                Button(T("Discard"), role: .destructive) { confirmDiscard = false; dismiss() }
            } else {
                Button("OK") { error = nil }
            }
        } message: {
            if pendingArchive != nil {
                Text(T("It leaves the day form and the overview. Its past figures and targets stay, and you can restore it later."))
            } else if confirmDiscard {
                Text(T("The platforms and targets stay as they were."))
            }
        }
    }

    private var alertTitle: String {
        if let p = pendingArchive { return String(format: T("Archive %@?"), p.name) }
        if confirmDiscard { return T("Discard the changes you haven't saved?") }
        return error ?? ""
    }

    private func load() async {
        loadFailed = false
        do {
            let r = try await APIClient.shared.socialConfig(projectId: store.projectId)
            usage = r.usage
            rows = r.config.platforms.map { SocialPlatformRow(id: $0.id, platformId: $0.id, name: $0.name, archived: $0.isArchived) }
            originalRows = rows
            var t: [String: [String]] = [:]
            for p in r.config.active {
                let x = store.monthTarget(p.id)
                t[p.id] = [x?.engagementTarget.map { OutletFormat.grouped(Int64($0)) } ?? "", x?.postsTarget.map { OutletFormat.grouped(Int64($0)) } ?? ""]
            }
            targets = t
            originalTargets = t
            loaded = true
        } catch {
            loadFailed = true
        }
    }

    private func setArchived(_ rowId: String, _ on: Bool) {
        guard let k = rows.firstIndex(where: { $0.id == rowId }) else { return }
        rows[k].archived = on
        // An archived row goes to the end, a restored one to the end of the active ones.
        let row = rows.remove(at: k)
        if on { rows.append(row) } else { rows.insert(row, at: rows.firstIndex { $0.archived } ?? rows.count) }
    }

    private func nameBinding(_ rowId: String) -> Binding<String> {
        Binding(get: { rows.first { $0.id == rowId }?.name ?? "" },
                set: { v in if let k = rows.firstIndex(where: { $0.id == rowId }) { rows[k].name = String(v.prefix(40)) } })
    }

    private func targetBinding(_ pid: String, _ i: Int) -> Binding<String> {
        Binding(get: { targets[pid]?[i] ?? "" },
                set: { v in var cur = targets[pid] ?? ["", ""]; cur[i] = OutletFormat.regroup(v); targets[pid] = cur })
    }

    private func targetBox(_ label: String, _ text: Binding<String>) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label).font(NXFont.text(12)).foregroundStyle(NX.mutedFg)
            TextField(text: text, prompt: Text(T("No target")).foregroundStyle(NX.mutedFg)) { Text(label) }
                .keyboardType(.numberPad).multilineTextAlignment(.trailing).monospacedDigit()
                .font(NXFont.text(14))
                .padding(.horizontal, 10).frame(height: 36)
                .nxSoftField(radius: 8)
        }
        .frame(maxWidth: .infinity)
    }

    private var active: [SocialPlatformRow] { rows.filter { !$0.archived } }
    private var archived: [SocialPlatformRow] { rows.filter { $0.archived } }

    private var form: some View {
        List {
            // The web's subtitle (run 14, P-I31 / P-M31), on the same left edge as the section headers and with
            // no empty band above it (UI tour run 15, Q-IB14).
            // A section header, so it starts on the same left edge as the headings under it (UI tour run 20, iPad
            // R20-I-11: a row inset put it 4 pt to their right).
            Section {
                EmptyView()
            } header: {
                Text(T("What this report tracks, and the month's goals per platform."))
                    .font(NXFont.text(13)).foregroundStyle(NX.mutedFg).textCase(nil)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Section {
                // As the web: per platform, Engagement and Posts side by side, each an input box, the figure
                // right-aligned; the helper under the heading (UI tour run 20, R20-B-21: plain right-aligned text
                // with no input chrome, the helper under the card).
                ForEach(originalRows.filter { !$0.archived }) { p in
                    VStack(alignment: .leading, spacing: 8) {
                        Text(p.name).font(NXFont.text(13, .semibold))
                        HStack(alignment: .top, spacing: 12) {
                            targetBox(T("Engagement"), targetBinding(p.platformId, 0))
                            targetBox(T("Posts"), targetBinding(p.platformId, 1))
                        }
                    }
                    .moveDisabled(true)
                }
            } header: {
                OutletSettingsHeading(title: String(format: T("Targets for %@"), OutletFormat.monthLabel(store.month)),
                                      helper: T("Each day's target is the month's split evenly, unless a day sets its own in the calendar. Leave a box empty for no target."))
            }

            Section {
                // A drag handle on every row to reorder (owner, 16 Oct 2026: fix 16's ↑ ↓ buttons are reverted).
                ForEach(active) { p in
                    HStack(spacing: 14) {
                        TextField(T("Platform name"), text: nameBinding(p.id))
                            .foregroundStyle(NX.foreground)
                        NXRowIconButton(title: String(format: T("Archive %@"), p.name), icon: "archivebox", enabled: active.count > 1) {
                            if !p.platformId.isEmpty && (usage[p.platformId] ?? 0) > 0 { pendingArchive = p }
                            else if p.platformId.isEmpty { rows.removeAll { $0.id == p.id } }
                            else { setArchived(p.id, true) }
                        }
                    }
                }
                .onMove { from, to in
                    var a = active
                    a.move(fromOffsets: from, toOffset: to)
                    rows = a + archived
                }
                HStack {
                    Image(systemName: "plus").foregroundStyle(NX.mutedFg)
                    TextField(T("Add platform, e.g. LinkedIn"), text: $newName)
                        .onSubmit(add)
                    if !newName.trimmingCharacters(in: .whitespaces).isEmpty {
                        Button(T("Add platform"), action: add).buttonStyle(.borderless)
                    }
                }
                .moveDisabled(true)
            } header: {
                SheetSectionTitle(T("Platforms"))
            } footer: {
                // The web's note on new platforms too (UI tour run 15, Q-IB14).
                Text(T("Renaming keeps every figure. Archiving hides a platform from the form; its past days keep their numbers.")
                     + " " + T("A new platform gets its targets after you save."))
            }

            if !archived.isEmpty {
                Section(T("Archived")) {
                    ForEach(archived) { p in
                        HStack {
                            Text(p.name).foregroundStyle(NX.mutedFg)
                            Spacer()
                            Button(T("Restore")) { setArchived(p.id, false) }.buttonStyle(.borderless)
                        }
                        .moveDisabled(true)
                    }
                }
            }
        }
        .listStyle(.insetGrouped)
        .listSectionSpacing(.compact)
        .contentMargins(.top, 8, for: .scrollContent)
        // The sheet goes on below its edge (Platforms, Add platform): the indicator shows once.
        .scrollIndicatorsFlash(onAppear: true)
        .environment(\.editMode, .constant(.active))
        .scrollDismissesKeyboard(.interactively)
    }

    private func add() {
        let name = newName.trimmingCharacters(in: .whitespaces)
        guard !name.isEmpty else { return }
        let row = SocialPlatformRow(id: UUID().uuidString, platformId: "", name: String(name.prefix(40)), archived: false)
        rows.insert(row, at: rows.firstIndex { $0.archived } ?? rows.count)
        newName = ""
    }

    private func save() async {
        add()
        saving = true
        defer { saving = false }
        do {
            if rows != originalRows {
                let cfg = SocialReportConfig(platforms: rows.map {
                    SocialPlatform(id: $0.platformId, name: $0.name.trimmingCharacters(in: .whitespaces), archived: $0.archived ? true : nil)
                })
                _ = try await APIClient.shared.socialSaveConfig(projectId: store.projectId, config: cfg)
            }
            if targets != originalTargets {
                var body: [String: Any] = [:]
                for (pid, v) in targets where v != originalTargets[pid] {
                    body[pid] = [
                        "engagementTarget": OutletFormat.parse(v[0]).map { NSNumber(value: $0) } ?? NSNull(),
                        "postsTarget": OutletFormat.parse(v[1]).map { NSNumber(value: $0) } ?? NSNull(),
                    ] as [String: Any]
                }
                if !body.isEmpty { try await store.saveTargets(platforms: body) }
            }
            store.notice = T("Platforms and targets saved.")
            await store.load()
            dismiss()
        } catch APIError.http(_, let message) {
            await store.load()
            error = (message?.isEmpty == false) ? message : T("The settings weren't saved. Try again.")
        } catch {
            self.error = T("The settings weren't saved. Try again.")
        }
    }
}
