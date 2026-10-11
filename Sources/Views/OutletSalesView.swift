import SwiftUI

// MARK: - Outlet Sales Dashboard project view (owner, 10 Oct 2026, for Ryan)
//
// A project of type OUTLET_SALES shows Overview · Calendar · Board · Report form · Chat, as the web's
// OutletSalesView. The four outlet tabs are ProjectDetailView's own
// tabs and share one store, so the month chosen on one is the month on all of them, and a report
// saved on the form shows on the calendar it lands on.
//
// The server decides everything that is worked out: totals, percents (rounded down), the status of a
// night (Upcoming → Waiting report the day after → Reported once sales AND pax are filled). This app
// only draws what it is told, and refetches the shown month whenever `outlet-sales-changed` arrives on
// the project's room (held by ProjectDetailView).
//
// Ryan's request, the source of the labels and their order: Overview = sales and pax of the month
// against its target ("Rp2.000.000 / Rp2.000.000 (100%)", "3.000 / 6.000 (50%)"); Calendar = tap a day,
// its events' reports below; Board = the three statuses; Report form = the server's form, so the team
// only fills it in.

/// A report the form is about to switch to, waiting for "Discard the changes you haven't saved?".
struct OutletFormRequest: Equatable {
    let eventId: String?
    let date: String?
}

/// What the report form holds while someone types: every answer as text (numbers as typed, grouped),
/// next to what it was when opened, so a save sends only what changed.
struct OutletDraft: Equatable {
    var eventId: String?
    var date: String
    var values: [String: String]
    var originalDate: String
    var original: [String: String]

    static func new(date: String) -> OutletDraft {
        OutletDraft(eventId: nil, date: date, values: [:], originalDate: date, original: [:])
    }

    static func from(_ e: OutletEvent) -> OutletDraft {
        var v: [String: String] = ["name": e.name]
        for k in OutletEvent.numberKeys { v[k] = e.numbers[k].map(OutletFormat.grouped) ?? "" }
        for k in OutletEvent.textKeys { v[k] = e.texts[k] ?? "" }
        return OutletDraft(eventId: e.id, date: e.date, values: v, originalDate: e.date, original: v)
    }

    func text(_ key: String) -> String { values[key] ?? "" }
    func number(_ key: String) -> Int64? { OutletFormat.parse(text(key)) }

    private static func same(_ key: String, _ a: String?, _ b: String?) -> Bool {
        if OutletEvent.numberKeys.contains(key) { return OutletFormat.parse(a ?? "") == OutletFormat.parse(b ?? "") }
        return (a ?? "").trimmingCharacters(in: .whitespacesAndNewlines) == (b ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// The keys whose value differs from when the report was opened.
    var changedKeys: [String] {
        let keys = Set(values.keys).union(original.keys)
        return keys.filter { !Self.same($0, values[$0], original[$0]) }.sorted()
    }

    var dirty: Bool { date != originalDate || !changedKeys.isEmpty }

    /// The body to send: for a new event everything filled, for an existing one only what changed.
    /// A cleared number goes as null, a cleared answer as "".
    func body() -> [String: Any] {
        var out: [String: Any] = [:]
        let keys = eventId == nil ? Array(values.keys) : changedKeys
        for k in keys {
            if OutletEvent.numberKeys.contains(k) {
                if let n = number(k) { out[k] = NSNumber(value: n) } else if eventId != nil { out[k] = NSNull() }
            } else {
                let t = text(k).trimmingCharacters(in: .whitespacesAndNewlines)
                if !t.isEmpty || eventId != nil { out[k] = t }
            }
        }
        if eventId == nil || date != originalDate { out["date"] = date }
        return out
    }

    /// RSVP – TOTAL / HOSTING – TOTAL while typing: the sum of the filled parts, nil when none is.
    func total(of fields: [OutletFormField]) -> Int64? {
        let filled = fields.compactMap { number($0.key) }
        return filled.isEmpty ? nil : filled.reduce(0, +)
    }
}

/// What the four outlet tabs share: the month shown, its answer, the calendar's day and the form's draft.
@MainActor
@Observable
final class OutletSalesStore {
    let projectId: String
    /// "YYYY-MM", the month every tab shows.
    private(set) var month: String
    private(set) var response: OutletMonthResponse?
    private(set) var loaded = false
    var loadError: String?
    var forbidden = false
    var signedOut = false
    /// A refused write, in the server's words when it gave some.
    var actionError: String?
    /// A one-line confirmation at the bottom ("Report for Noxva saved.").
    var notice: String?
    /// The calendar's picked day; nil = the default (today in this month, else its first event, else the 1st).
    var selectedDay: String?
    /// The report on the form.
    var draft = OutletDraft.new(date: OutletFormat.wibToday())
    /// Another report asked for while the draft has unsaved changes: the form asks before it switches.
    var pendingForm: OutletFormRequest?
    /// The event shown in the detail sheet (Overview and Board).
    var sheetEventId: String?
    /// Events read one by one (another month's, from a link or a forgotten report).
    private(set) var loose: [String: OutletEvent] = [:]
    @ObservationIgnored private var loadSeq = 0

    init(projectId: String) {
        self.projectId = projectId
        month = String(OutletFormat.wibToday().prefix(7))
    }

    var events: [OutletEvent] { response?.month == month ? response?.events ?? [] : [] }
    var waitingEarlier: [OutletEvent] { response?.waitingEarlier ?? [] }
    var form: OutletForm {
        if let f = response?.form, !f.sections.isEmpty { return f }
        return .standard
    }
    var today: String { response?.today ?? OutletFormat.wibToday() }
    var thisYear: String { String(today.prefix(4)) }
    var summary: OutletSummary { response?.month == month ? response?.summary ?? OutletSummary() : OutletSummary() }
    var target: OutletTarget? { response?.month == month ? response?.target : nil }
    var canManageTargets: Bool { response?.canManageTargets ?? false }
    /// True while the answer on screen is for a month other than the one picked.
    var switching: Bool { loaded && response?.month != month }

    /// Every night still owed a report: this month's and older months', oldest first.
    var allWaiting: [OutletEvent] {
        var seen = Set<String>()
        return (waitingEarlier + events.filter { $0.status == .waiting })
            .filter { seen.insert($0.id).inserted }
            .sorted { $0.date < $1.date }
    }

    func event(_ id: String) -> OutletEvent? {
        events.first { $0.id == id } ?? waitingEarlier.first { $0.id == id } ?? loose[id]
    }

    func events(on day: String) -> [OutletEvent] { events.filter { $0.date == day } }

    /// The day the calendar shows: the picked one when it is in this month, else today in this month,
    /// else the month's first event, else the 1st.
    var calendarDay: String {
        if let d = selectedDay, d.hasPrefix(month) { return d }
        if today.hasPrefix(month) { return today }
        return events.first?.date ?? "\(month)-01"
    }

    // MARK: reading

    /// The first load and every quiet reload. A reload that fails leaves what is drawn alone.
    func load() async {
        loadSeq += 1
        let seq = loadSeq
        let wanted = month
        do {
            let r = try await APIClient.shared.outletMonth(projectId: projectId, month: wanted)
            // A newer month was asked for meanwhile: this answer is for one nobody looks at any more.
            guard seq == loadSeq else { return }
            response = r
            if !r.month.isEmpty && r.month != month && wanted == month { month = r.month }
            loaded = true
            loadError = nil
            forbidden = false
            // A loose event that is now in the month's answer is read from there.
            for e in r.events + r.waitingEarlier { loose[e.id] = nil }
        }
        catch APIError.unauthorized { signedOut = true }
        // Not on the project (an ordinary project's rule: members + Manager/BoD/OAA + admin).
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

    /// One event by id, from the month on screen or the server (another month's, a link).
    func fetchEvent(_ id: String) async -> OutletEvent? {
        if let e = event(id) { return e }
        do {
            let r = try await APIClient.shared.outletEvent(projectId: projectId, eventId: id)
            loose[id] = r.event
            return r.event
        } catch APIError.http(404, _) {
            actionError = T("This event no longer exists. It may have been deleted; Control Room → Audit can restore it.")
        } catch {
            fail(error, T("Check your connection, then try again."))
        }
        return nil
    }

    // MARK: the form

    /// Put a report on the form: an existing event, or a new one on `date`. With unsaved changes on
    /// the form this only asks (`pendingForm`); the form shows the question.
    func openForm(eventId: String?, date: String?) {
        let request = OutletFormRequest(eventId: eventId, date: date)
        if draft.dirty && !(eventId != nil && eventId == draft.eventId) {
            pendingForm = request
            return
        }
        apply(request)
    }

    /// Switch the form without asking (after "Discard", or when nothing was changed).
    func apply(_ request: OutletFormRequest) {
        pendingForm = nil
        if let id = request.eventId {
            if let e = event(id) {
                draft = .from(e)
            } else {
                // Another month's event: shown as soon as it arrives.
                draft = .new(date: request.date ?? calendarDay)
                Task {
                    if let e = await fetchEvent(id), pendingForm == nil, !draft.dirty { draft = .from(e) }
                }
            }
        } else {
            draft = .new(date: request.date ?? (today.hasPrefix(month) ? today : calendarDay))
        }
    }

    /// Save the draft: POST for a new event, PATCH with the changed keys for an existing one. Answers the
    /// saved event, or nil after showing the refusal.
    func saveDraft() async -> OutletEvent? {
        let body = draft.body()
        let isNew = draft.eventId == nil
        do {
            let saved: OutletEvent
            if let id = draft.eventId {
                saved = try await APIClient.shared.outletUpdateEvent(projectId: projectId, eventId: id, fields: body)
            } else {
                saved = try await APIClient.shared.outletCreateEvent(projectId: projectId, fields: body)
            }
            loose[saved.id] = saved
            draft = .from(saved)
            if saved.status == .reported {
                notice = String(format: T("Report for %@ saved."), saved.name)
            } else if isNew {
                notice = String(format: T("%@ added. Fill its report after the night."), saved.name)
            } else {
                notice = String(format: T("%@ saved."), saved.name)
            }
            return saved
        } catch {
            fail(error, T("That wasn't saved. Try again."))
            return nil
        }
    }

    /// After a save: the calendar on that night, in its month.
    func land(on saved: OutletEvent) async {
        selectedDay = saved.date
        if saved.month != month {
            month = saved.month
        }
        await load()
    }

    func delete(_ id: String) async -> Bool {
        let name = event(id)?.name ?? ""
        do {
            try await APIClient.shared.outletDeleteEvent(projectId: projectId, eventId: id)
            loose[id] = nil
            if draft.eventId == id { draft = .new(date: calendarDay) }
            if sheetEventId == id { sheetEventId = nil }
            notice = String(format: T("%@ deleted. Control Room → Audit can restore it."), name)
            await load()
            return true
        } catch {
            fail(error, T("The event wasn't deleted. Try again."))
            return false
        }
    }

    /// The month's targets. nil = no target (the box was left empty).
    func setTarget(sales: Int64?, pax: Int64?) async -> Bool {
        do {
            _ = try await APIClient.shared.outletSetTarget(projectId: projectId, month: month, salesTarget: sales, paxTarget: pax)
            notice = String(format: T("Target for %@ saved."), OutletFormat.monthLabel(month))
            await load()
            return true
        } catch {
            fail(error, T("The target wasn't saved. Try again."))
            return false
        }
    }

    /// "Copy form link": the web address of the form (not public: it opens NEXUS and needs a login and
    /// project access).
    func formLink(eventId: String? = nil) -> String {
        var s = "\(Config.baseURL.absoluteString)/projects/\(projectId)?view=form"
        if let eventId { s += "&event=\(eventId)" }
        return s
    }

    func copyFormLink(eventId: String? = nil) {
        UIPasteboard.general.string = formLink(eventId: eventId)
        notice = T("Form link copied. Anyone in this project can open it in NEXUS.")
    }

    private func fail(_ error: Error, _ fallback: String) {
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

/// An event id for `.sheet(item:)`.
struct OutletSheetItem: Identifiable, Hashable { let id: String }

extension ProjectTab {
    /// The tabs an Outlet Sales Dashboard draws from its store, in the web's order.
    static let outletTabs: [ProjectTab] = [.overview, .calendar, .board, .reportForm]
    var isOutletView: Bool { Self.outletTabs.contains(self) }
}

/// The outlet's four tabs. One view (one identity) for all four, so moving between them keeps the
/// store's month, the calendar's day and the form's draft.
struct OutletSalesTab: View {
    @Bindable var store: OutletSalesStore
    @Binding var tab: ProjectTab

    @Environment(AuthStore.self) private var auth

    var body: some View {
        Group {
            if store.forbidden {
                EmptyState(icon: "lock", title: T("This outlet is for its project members"),
                           subtitle: T("Ask the project lead or a manager to add you to the project."))
            } else if !store.loaded {
                if let err = store.loadError {
                    ErrorState(message: err, icon: "storefront") {
                        Task { store.loadError = nil; await store.load() }
                    }
                } else {
                    ProgressView().tint(NX.violetText).frame(maxWidth: .infinity, maxHeight: .infinity)
                        .accessibilityLabel(T("Loading the outlet"))
                }
            } else {
                switch tab {
                case .calendar:   OutletCalendarView(store: store, tab: $tab)
                case .board:      OutletBoardView(store: store, tab: $tab)
                case .reportForm: OutletReportFormView(store: store, tab: $tab)
                default:          OutletOverviewView(store: store, tab: $tab)
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .task { await store.load() }
        // Live: a colleague's report, a new night, a deleted or restored one, a target changed. A ping
        // only: whatever month is shown is read again (an event moved to another date leaves one month
        // and enters another).
        .liveRefresh(every: 60, on: [.nexusOutletSalesChanged], projectId: store.projectId) { await store.load() }
        .onChange(of: store.signedOut) { _, out in if out { auth.logout() } }
        .sheet(item: Binding(get: { store.sheetEventId.map(OutletSheetItem.init) },
                             set: { store.sheetEventId = $0?.id })) { item in
            OutletEventSheet(store: store, eventId: item.id) { id in
                store.sheetEventId = nil
                store.openForm(eventId: id, date: nil)
                tab = .reportForm
            }
        }
        // The form shows its own refusals (with its discard and delete questions); this one is the rest.
        .alert(store.actionError ?? "", isPresented: Binding(
            get: { tab != .reportForm && store.sheetEventId == nil && store.actionError != nil },
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
                    .padding(.horizontal, 20).padding(.bottom, tab == .reportForm ? 86 : 18)
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

// MARK: - Shared pieces

/// ‹ Oktober 2026 › with "This month" when another month is shown, "Copy form link" and "Add event".
/// The row above Overview, Calendar and Board.
struct OutletHeader: View {
    @Bindable var store: OutletSalesStore
    @Binding var tab: ProjectTab
    /// The date a new event gets ("Add event" on the calendar = the picked day).
    var newEventDate: String? = nil

    @Environment(\.horizontalSizeClass) private var hSize

    var body: some View {
        HStack(spacing: 6) {
            OutletMonthSwitcher(store: store)
            Spacer(minLength: 4)
            Button { store.copyFormLink() } label: {
                Image(systemName: "link").font(.system(size: 15, weight: .semibold)).foregroundStyle(NX.foreground)
                    .frame(width: 40, height: 40)
                    .background(NX.card, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(NX.border))
            }
            .buttonStyle(.plain)
            .accessibilityLabel(T("Copy form link"))
            Button {
                store.openForm(eventId: nil, date: newEventDate)
                tab = .reportForm
            } label: {
                HStack(spacing: 6) {
                    Image(systemName: "plus").font(.system(size: 14, weight: .bold))
                    if hSize == .regular { Text(T("Add event")).font(NXFont.text(14, .semibold)) }
                }
                .foregroundStyle(.white)
                .padding(.horizontal, hSize == .regular ? 14 : 0)
                .frame(minWidth: 40, minHeight: 40)
                .background(NX.violetFill, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            }
            .buttonStyle(.plain)
            .accessibilityLabel(T("Add event"))
        }
    }
}

struct OutletMonthSwitcher: View {
    @Bindable var store: OutletSalesStore

    var body: some View {
        let current = String(store.today.prefix(7))
        HStack(spacing: 2) {
            arrow("chevron.left", T("Previous month"), by: -1)
            Text(OutletFormat.monthLabel(store.month))
                .font(NXFont.display(16, .bold)).foregroundStyle(NX.foreground)
                .lineLimit(1).minimumScaleFactor(0.75)
                .frame(minWidth: 112)
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
        .accessibilityLabel(label)
    }
}

/// The status pill: a dot in the status colour and its name.
struct OutletStatusPill: View {
    let status: OutletStatus
    var body: some View {
        HStack(spacing: 5) {
            Circle().fill(status.tone.fg).frame(width: 6, height: 6)
            Text(status.label).font(NXFont.text(11, .bold)).lineLimit(1)
        }
        .padding(.horizontal, 8).padding(.vertical, 4)
        .foregroundStyle(status.tone.fg)
        .background(status.tone.bg, in: Capsule())
    }
}

/// A bar for "how much of the target": capped at full, green once the target is reached.
struct OutletMeter: View {
    let pct: Int64?
    var body: some View {
        let value = Double(min(100, max(0, pct ?? 0))) / 100
        GeometryReader { geo in
            ZStack(alignment: .leading) {
                Capsule().fill(NX.muted)
                Capsule().fill((pct ?? 0) >= 100 ? NX.success : NX.violet).frame(width: geo.size.width * value)
            }
        }
        .frame(height: 8)
        .accessibilityElement()
        .accessibilityValue(pct.map { "\($0)%" } ?? "—")
    }
}

/// One card with the outlet's look.
struct OutletCard<Content: View>: View {
    @ViewBuilder let content: () -> Content
    var body: some View {
        VStack(alignment: .leading, spacing: 10) { content() }
            .padding(14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(NX.card, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(NX.border))
    }
}

// MARK: - Overview

struct OutletOverviewView: View {
    @Bindable var store: OutletSalesStore
    @Binding var tab: ProjectTab

    @Environment(\.horizontalSizeClass) private var hSize
    @State private var editingTarget = false
    @State private var salesTargetText = ""
    @State private var paxTargetText = ""
    @State private var savingTarget = false

    private var wide: Bool { hSize == .regular }
    private var monthName: String { OutletFormat.monthLabel(store.month) }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                OutletHeader(store: store, tab: $tab)
                cards
                targetLine
                strip
                waitingBox
                eventsList
            }
            .padding(16)
            .frame(maxWidth: 920, alignment: .leading)
            .frame(maxWidth: .infinity)
            .opacity(store.switching ? 0.55 : 1)
        }
        .refreshable { await store.load() }
        .scrollDismissesKeyboard(.interactively)
        .onChange(of: store.month) { _, _ in editingTarget = false }
    }

    // MARK: sales and pax against the month's target

    @ViewBuilder private var cards: some View {
        let s = store.summary
        let sales = metricCard(title: String(format: T("Sales · %@"), monthName),
                               hint: store.form.field("sales")?.hint?.text,
                               actual: OutletFormat.rupiah(s.sales ?? 0),
                               target: s.salesTarget.map { OutletFormat.rupiah($0) },
                               pct: s.salesTarget == nil ? nil : s.salesPct)
        let pax = metricCard(title: String(format: T("Pax · %@"), monthName),
                             hint: store.form.field("pax")?.hint?.text,
                             actual: OutletFormat.count(s.pax ?? 0),
                             target: s.paxTarget.map { OutletFormat.count($0) },
                             pct: s.paxTarget == nil ? nil : s.paxPct)
        if wide {
            HStack(alignment: .top, spacing: 12) { sales; pax }
        } else {
            VStack(spacing: 12) { sales; pax }
        }
    }

    private func metricCard(title: String, hint: String?, actual: String, target: String?, pct: Int64?) -> some View {
        OutletCard {
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(NXFont.text(13, .semibold)).foregroundStyle(NX.foreground)
                if let hint, !hint.isEmpty {
                    Text(hint).font(NXFont.text(11)).foregroundStyle(NX.mutedFg).fixedSize(horizontal: false, vertical: true)
                }
            }
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                (Text(actual).foregroundColor(NX.foreground)
                 + Text(" / \(target ?? "—")").foregroundColor(NX.mutedFg))
                    .font(NXFont.display(22, .bold))
                    .monospacedDigit()
                    .lineLimit(1).minimumScaleFactor(0.6)
                Spacer(minLength: 0)
                if let pct {
                    NexusChip(text: "\(pct)%", tone: pct >= 100 ? .success : .accent)
                }
            }
            if target != nil {
                OutletMeter(pct: pct)
            } else {
                Text(T("No target for this month")).font(NXFont.text(12)).foregroundStyle(NX.mutedFg)
            }
        }
    }

    // MARK: who set the target, and the editor for those who may

    @ViewBuilder private var targetLine: some View {
        if editingTarget {
            OutletCard {
                targetField(String(format: T("Sales target for %@"), monthName), text: $salesTargetText, money: true)
                targetField(String(format: T("Pax target for %@"), monthName), text: $paxTargetText, money: false)
                Text(T("Leave a box empty for no target. The month's total is the sum of its events' actual figures."))
                    .font(NXFont.text(11)).foregroundStyle(NX.mutedFg).fixedSize(horizontal: false, vertical: true)
                HStack(spacing: 10) {
                    Button {
                        Task {
                            savingTarget = true
                            let ok = await store.setTarget(sales: OutletFormat.parse(salesTargetText), pax: OutletFormat.parse(paxTargetText))
                            savingTarget = false
                            if ok { editingTarget = false }
                        }
                    } label: {
                        HStack(spacing: 6) { if savingTarget { ProgressView().tint(.white) }; Text(T("Save target")) }
                    }
                    .buttonStyle(NexusPrimaryButton(fullWidth: false))
                    .disabled(savingTarget)
                    Button(T("Cancel")) { editingTarget = false }
                        .font(NXFont.text(14, .semibold)).foregroundStyle(NX.mutedFg)
                        .frame(minHeight: 44)
                }
            }
        } else {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                VStack(alignment: .leading, spacing: 2) {
                    if let who = store.target?.updatedBy?.name,
                       store.target?.salesTarget != nil || store.target?.paxTarget != nil {
                        Text(String(format: T("Target set by %@"), who))
                    } else if store.target?.salesTarget == nil && store.target?.paxTarget == nil {
                        Text(String(format: T("No target for %@ yet."), monthName))
                        if !store.canManageTargets { Text(T("The project lead or a manager sets it.")) }
                    }
                }
                .font(NXFont.text(12)).foregroundStyle(NX.mutedFg)
                Spacer(minLength: 0)
                if store.canManageTargets {
                    let has = store.target?.salesTarget != nil || store.target?.paxTarget != nil
                    Button(has ? T("Change target") : T("Set target")) { startEditing() }
                        .font(NXFont.text(13, .semibold)).foregroundStyle(NX.violetText)
                        .frame(minHeight: 40)
                }
            }
        }
    }

    private func targetField(_ label: String, text: Binding<String>, money: Bool) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label).font(NXFont.text(12, .semibold)).foregroundStyle(NX.foreground)
            OutletNumberField(text: text, money: money, placeholder: "—")
        }
    }

    private func startEditing() {
        salesTargetText = store.target?.salesTarget.map(OutletFormat.grouped) ?? ""
        paxTargetText = store.target?.paxTarget.map(OutletFormat.grouped) ?? ""
        editingTarget = true
    }

    // MARK: Events · Reported · Waiting report · RSVP · Hosting

    private var strip: some View {
        let s = store.summary
        return LazyVGrid(columns: [GridItem(.adaptive(minimum: wide ? 130 : 100), spacing: 8)], spacing: 8) {
            tile(T("Events"), OutletFormat.count(s.eventCount))
            tile(T("Reported"), OutletFormat.count(s.reportedCount))
            tile(T("Waiting report"), OutletFormat.count(s.waitingCount), warn: s.waitingCount > 0)
            tile(T("RSVP"), OutletFormat.count(s.rsvpTotal))
            tile(T("Hosting"), OutletFormat.count(s.hostingTotal))
        }
    }

    private func tile(_ label: String, _ value: String, warn: Bool = false) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(value).font(NXFont.display(18, .bold)).foregroundStyle(warn ? ChipTone.warning.fg : NX.foreground).monospacedDigit()
            Text(label).font(NXFont.text(11, .medium)).foregroundStyle(NX.mutedFg).lineLimit(1).minimumScaleFactor(0.8)
        }
        .padding(.horizontal, 12).padding(.vertical, 10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(NX.card, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(NX.border))
        .accessibilityElement(children: .combine)
    }

    // MARK: the nights still owed a report (this month and older ones)

    @ViewBuilder private var waitingBox: some View {
        let waiting = store.allWaiting
        if !waiting.isEmpty {
            VStack(alignment: .leading, spacing: 10) {
                Label(waiting.count == 1 ? T("1 night is waiting for its report")
                                         : String(format: T("%d nights are waiting for their report"), waiting.count),
                      systemImage: "exclamationmark.circle.fill")
                    .font(NXFont.text(13, .semibold)).foregroundStyle(ChipTone.warning.fg)
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach(waiting) { e in
                            Button {
                                store.openForm(eventId: e.id, date: nil)
                                tab = .reportForm
                            } label: {
                                Text("\(OutletFormat.dayShort(e.date, thisYear: store.thisYear)) \(e.name)")
                                    .font(NXFont.text(12, .semibold)).foregroundStyle(NX.foreground).lineLimit(1)
                                    .padding(.horizontal, 10).padding(.vertical, 8)
                                    .background(NX.card, in: Capsule())
                                    .overlay(Capsule().strokeBorder(NX.warning.opacity(0.45)))
                                    .frame(minHeight: 40)
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
                .fixedSize(horizontal: false, vertical: true)
            }
            .padding(14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(NX.warning.opacity(0.10), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(NX.warning.opacity(0.35)))
        }
    }

    // MARK: the month's nights

    @ViewBuilder private var eventsList: some View {
        VStack(alignment: .leading, spacing: 8) {
            SectionLabel(String(format: T("Events in %@"), monthName))
            if store.events.isEmpty {
                EmptyState(icon: "calendar.badge.plus", title: T("No events this month yet"),
                           subtitle: T("Add the nights you have planned. After each one, the team fills its report and the totals above update."),
                           actionTitle: T("Add event"),
                           action: { store.openForm(eventId: nil, date: nil); tab = .reportForm },
                           compact: true)
                    .padding(.vertical, 18)
                    .frame(maxWidth: .infinity)
            } else {
                VStack(spacing: 0) {
                    ForEach(Array(store.events.enumerated()), id: \.element.id) { i, e in
                        if i > 0 { Divider().overlay(NX.border) }
                        row(e)
                    }
                }
                .background(NX.card, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(NX.border))
            }
        }
    }

    private func row(_ e: OutletEvent) -> some View {
        Button { store.sheetEventId = e.id } label: {
            HStack(alignment: .top, spacing: 10) {
                Text(OutletFormat.dayShort(e.date))
                    .font(NXFont.text(12, .semibold)).foregroundStyle(NX.mutedFg)
                    .frame(width: wide ? 96 : 78, alignment: .leading)
                VStack(alignment: .leading, spacing: 4) {
                    HStack(spacing: 6) {
                        Text(e.name).font(NXFont.text(14, .semibold)).foregroundStyle(NX.foreground).lineLimit(1)
                        Spacer(minLength: 4)
                        OutletStatusPill(status: e.status)
                    }
                    HStack(spacing: 8) {
                        Text(OutletFormat.vsTarget(e.sales, e.salesTarget, e.salesPct, money: true))
                            .lineLimit(1).minimumScaleFactor(0.8)
                        Text("·")
                        Text(String(format: T("%@ pax"), OutletFormat.count(e.pax))).lineLimit(1)
                    }
                    .font(NXFont.text(12)).foregroundStyle(NX.mutedFg).monospacedDigit()
                }
            }
            .padding(.horizontal, 14).padding(.vertical, 12)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

/// A number box that groups its digits while typing ("8.000.000"), with "Rp" before money.
struct OutletNumberField: View {
    @Binding var text: String
    let money: Bool
    var placeholder: String = ""

    var body: some View {
        HStack(spacing: 6) {
            if money { Text("Rp").font(NXFont.text(15, .semibold)).foregroundStyle(NX.mutedFg) }
            TextField(placeholder, text: $text)
                .keyboardType(.numberPad)
                .font(NXFont.text(15)).foregroundStyle(NX.foreground)
                .monospacedDigit()
                .onChange(of: text) { _, new in
                    let regrouped = OutletFormat.regroup(new)
                    if regrouped != new { text = regrouped }
                }
        }
        .padding(.horizontal, 12).frame(minHeight: 44)
        .background(NX.background, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(NX.border))
    }
}

// MARK: - Board

struct OutletBoardView: View {
    @Bindable var store: OutletSalesStore
    @Binding var tab: ProjectTab

    @Environment(\.horizontalSizeClass) private var hSize
    private var wide: Bool { hSize == .regular }

    private func items(_ status: OutletStatus) -> [OutletEvent] {
        switch status {
        case .waiting: return store.allWaiting
        default: return store.events.filter { $0.status == status }
        }
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                OutletHeader(store: store, tab: $tab)
                if store.events.isEmpty && store.waitingEarlier.isEmpty {
                    EmptyState(icon: "rectangle.split.3x1", title: T("No events this month yet"),
                               subtitle: T("Add the nights you have planned. After each one, the team fills its report and the totals above update."),
                               actionTitle: T("Add event"),
                               action: { store.openForm(eventId: nil, date: nil); tab = .reportForm },
                               compact: true)
                        .padding(.vertical, 40)
                        .frame(maxWidth: .infinity)
                } else if wide {
                    HStack(alignment: .top, spacing: 12) {
                        ForEach(OutletStatus.allCases) { column($0) }
                    }
                } else {
                    VStack(spacing: 12) {
                        ForEach(OutletStatus.allCases) { column($0) }
                    }
                }
            }
            .padding(16)
            .frame(maxWidth: 1100, alignment: .leading)
            .frame(maxWidth: .infinity)
            .opacity(store.switching ? 0.55 : 1)
        }
        .refreshable { await store.load() }
    }

    private func emptyText(_ status: OutletStatus) -> String {
        switch status {
        case .upcoming: return T("Nothing planned ahead in this month.")
        case .waiting: return T("Every night that's over has its report.")
        case .reported: return T("No reports in this month yet.")
        }
    }

    private func column(_ status: OutletStatus) -> some View {
        let list = items(status)
        return VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 6) {
                Circle().fill(status.tone.fg).frame(width: 8, height: 8)
                Text(status.label).font(NXFont.text(13, .bold)).foregroundStyle(NX.foreground)
                Text("\(list.count)").font(NXFont.text(12, .semibold)).foregroundStyle(NX.mutedFg).monospacedDigit()
                Spacer(minLength: 0)
            }
            .accessibilityElement(children: .combine)
            if list.isEmpty {
                Text(emptyText(status)).font(NXFont.text(12)).foregroundStyle(NX.mutedFg)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.vertical, 6)
            } else {
                ForEach(list) { card($0) }
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .topLeading)
        .background(NX.muted.opacity(0.45), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
    }

    private func card(_ e: OutletEvent) -> some View {
        Button { store.sheetEventId = e.id } label: {
            VStack(alignment: .leading, spacing: 5) {
                HStack(spacing: 6) {
                    Text(OutletFormat.dayShort(e.date, thisYear: String(store.month.prefix(4))))
                        .font(NXFont.text(11, .semibold)).foregroundStyle(NX.mutedFg)
                    Spacer(minLength: 4)
                    if e.status == .waiting, let missing = e.missingLabel { NexusChip(text: missing, tone: .warning) }
                }
                Text(e.name).font(NXFont.text(14, .semibold)).foregroundStyle(NX.foreground).lineLimit(2)
                Group {
                    Text("\(T("Sales")): \(OutletFormat.vsTarget(e.sales, e.salesTarget, e.salesPct, money: true))")
                    Text("\(T("Pax")): \(OutletFormat.vsTarget(e.pax, e.paxTarget, e.paxPct, money: false))")
                }
                .font(NXFont.text(12)).foregroundStyle(NX.mutedFg).monospacedDigit()
                .lineLimit(1).minimumScaleFactor(0.8)
            }
            .padding(12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(NX.card, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(NX.border))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

// MARK: - The night's report as Ryan listed it

/// Nama event · Hari/Tanggal · Sales · Pax · RSVP – TOTAL and its four parts · HOSTING – TOTAL and its
/// three · Hal yang berhasil (Apa / Kenapa berhasil / Gimana biar bisa terulang lagi) · Hal yang gagal
/// (Apa / Kenapa gagal / Gimana biar tidak kejadian lagi). Labels from the server's form.
struct OutletEventCard: View {
    let event: OutletEvent
    let form: OutletForm
    let thisYear: String
    var onEdit: (() -> Void)? = nil

    @Environment(\.horizontalSizeClass) private var hSize
    private var labelWidth: CGFloat { hSize == .regular ? 200 : 128 }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .center, spacing: 10) {
                OutletStatusPill(status: event.status)
                Spacer(minLength: 0)
                if let onEdit {
                    let reported = event.status == .reported
                    Button(action: onEdit) {
                        Label(reported ? T("Edit report") : T("Fill report"), systemImage: "square.and.pencil")
                            .font(NXFont.text(13, .semibold))
                            .foregroundStyle(reported ? NX.foreground : .white)
                            .padding(.horizontal, 12).frame(minHeight: 40)
                            .background(reported ? NX.background : NX.violetFill, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(reported ? NX.border : .clear))
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.bottom, 6)
            row(form.label("name", "Event name"), Text(event.name).fontWeight(.semibold))
            row(form.label("date", "Day/Date"), Text(OutletFormat.dayLong(event.date, thisYear: thisYear)))
            row(form.label("sales", "Sales"), Text(OutletFormat.vsTarget(event.sales, event.salesTarget, event.salesPct, money: true)))
            row(form.label("pax", "Pax"), Text(OutletFormat.vsTarget(event.pax, event.paxTarget, event.paxPct, money: false)))
            total("rsvp", event.rsvpTotal)
            total("hosting", event.hostingTotal)
            story("success")
            story("fail")
            if let footer {
                Divider().overlay(NX.border).padding(.top, 6)
                Text(footer).font(NXFont.text(11)).foregroundStyle(NX.mutedFg).padding(.top, 8)
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(NX.card, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(NX.border))
    }

    private var footer: String? {
        if let who = event.reportedBy {
            let when = OutletFormat.stamp(event.reportedAt).map { " · \($0)" } ?? ""
            return String(format: T("Reported by %@"), who.name ?? "?") + when
        }
        if let who = event.updatedBy ?? event.createdBy {
            let when = OutletFormat.stamp(event.updatedAt).map { " · \($0)" } ?? ""
            return String(format: T("Last changed by %@"), who.name ?? "?") + when
        }
        return nil
    }

    private func row(_ label: String, _ value: Text, strong: Bool = false, indent: Bool = false) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 10) {
            Text(label)
                .font(strong ? NXFont.text(11, .bold) : NXFont.text(13))
                .foregroundStyle(strong ? NX.foreground : NX.mutedFg)
                .frame(width: labelWidth - (indent ? 12 : 0), alignment: .leading)
            value.font(NXFont.text(13, strong ? .semibold : .regular)).foregroundStyle(NX.foreground)
                .monospacedDigit()
                .frame(maxWidth: .infinity, alignment: .leading)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.leading, indent ? 12 : 0)
        .padding(.vertical, 5)
        .accessibilityElement(children: .combine)
    }

    @ViewBuilder private func total(_ key: String, _ value: Int64?) -> some View {
        if let s = form.section(key) {
            Divider().overlay(NX.border).padding(.vertical, 4)
            row(s.title.text, Text(OutletFormat.count(value)), strong: true)
            ForEach(s.fields, id: \.key) { f in
                row(f.label.text, Text(OutletFormat.count(event.numbers[f.key])), indent: true)
            }
        }
    }

    @ViewBuilder private func story(_ key: String) -> some View {
        if let s = form.section(key) {
            Divider().overlay(NX.border).padding(.vertical, 4)
            Text(s.title.text.uppercased()).font(NXFont.text(11, .bold)).tracking(0.4).foregroundStyle(NX.foreground)
                .padding(.vertical, 5)
            ForEach(s.fields, id: \.key) { f in
                let answer = event.texts[f.key] ?? ""
                row(f.label.text, answer.isEmpty ? Text(T("Not filled")).foregroundColor(NX.mutedFg) : Text(answer), indent: true)
            }
        }
    }
}

/// The detail sheet of Overview and Board: the night's report and the way to fill or edit it.
struct OutletEventSheet: View {
    @Bindable var store: OutletSalesStore
    let eventId: String
    let onEdit: (String) -> Void

    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Group {
                if let e = store.event(eventId) {
                    ScrollView {
                        VStack(alignment: .leading, spacing: 12) {
                            Text(T("The night's report, as the team filled it."))
                                .font(NXFont.text(12)).foregroundStyle(NX.mutedFg)
                            OutletEventCard(event: e, form: store.form, thisYear: store.thisYear) { onEdit(e.id) }
                        }
                        .padding(16)
                        .frame(maxWidth: 720, alignment: .leading)
                        .frame(maxWidth: .infinity)
                    }
                } else {
                    EmptyState(icon: "calendar.badge.exclamationmark", title: T("The outlet didn't load"),
                               subtitle: T("This event no longer exists. It may have been deleted; Control Room → Audit can restore it."))
                }
            }
            .background(NX.background.ignoresSafeArea())
            .navigationTitle(store.event(eventId)?.name ?? "")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button { store.copyFormLink(eventId: eventId) } label: { Image(systemName: "link") }
                        .accessibilityLabel(T("Copy form link"))
                }
                ToolbarItem(placement: .topBarTrailing) { Button(T("Done")) { dismiss() } }
            }
        }
        .presentationDetents([.large])
    }
}
