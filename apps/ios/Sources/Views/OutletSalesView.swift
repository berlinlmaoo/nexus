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
    /// The outlet's breakdown figures by item id (owner, 14 Oct 2026), as typed; "" = not filled.
    var figures: [String: String] = [:]
    var originalFigures: [String: String] = [:]

    static func new(date: String) -> OutletDraft {
        OutletDraft(eventId: nil, date: date, values: [:], originalDate: date, original: [:])
    }

    static func from(_ e: OutletEvent, config: OutletReportConfig) -> OutletDraft {
        var v: [String: String] = ["name": e.name]
        for k in OutletEvent.numberKeys { v[k] = e.numbers[k].map(OutletFormat.grouped) ?? "" }
        for k in OutletEvent.textKeys { v[k] = e.texts[k] ?? "" }
        var f: [String: String] = [:]
        for id in Set(config.allIds).union(e.values.keys) { f[id] = e.values[id].map(OutletFormat.grouped) ?? "" }
        return OutletDraft(eventId: e.id, date: e.date, values: v, originalDate: e.date, original: v, figures: f, originalFigures: f)
    }

    func figure(_ id: String) -> Int64? { OutletFormat.parse(figures[id] ?? "") }

    /// The breakdown ids whose figure differs from when the report was opened.
    var changedFigures: [String] {
        Set(figures.keys).union(originalFigures.keys)
            .filter { OutletFormat.parse(figures[$0] ?? "") != OutletFormat.parse(originalFigures[$0] ?? "") }
            .sorted()
    }

    /// A live total while typing: the sum of the filled figures of `ids`, nil when none is.
    func figureTotal(_ ids: [String]) -> Int64? {
        let filled = ids.compactMap { figure($0) }
        return filled.isEmpty ? nil : filled.reduce(0, +)
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

    var dirty: Bool { date != originalDate || !changedKeys.isEmpty || !changedFigures.isEmpty }

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
        // The breakdown goes as `values` by item id; null clears one (owner, 14 Oct 2026).
        var vals: [String: Any] = [:]
        for id in (eventId == nil ? Array(figures.keys) : changedFigures) {
            if let n = figure(id) { vals[id] = NSNumber(value: n) } else if eventId != nil { vals[id] = NSNull() }
        }
        if !vals.isEmpty { out["values"] = vals }
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
    var canManageSettings: Bool { response?.canManageSettings ?? canManageTargets }
    /// The outlet's own breakdown (Report settings); the original seven items until the server says.
    var config: OutletReportConfig { response?.config ?? .standard }
    var guests: OutletGuests? { response?.month == month ? response?.guests : nil }
    /// The Report settings sheet.
    var settingsOpen = false

    /// A day of the shown month with its target in force and its actuals.
    func day(_ d: String) -> OutletDay? { response?.month == month ? response?.days.first { $0.date == d } : nil }
    /// The date's own target, when it set one.
    func ownTarget(_ d: String) -> OutletDayTarget? { response?.month == month ? response?.dayTargets.first { $0.date == d } : nil }
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
                draft = .from(e, config: config)
            } else {
                // Another month's event: shown as soon as it arrives.
                draft = .new(date: request.date ?? calendarDay)
                Task {
                    if let e = await fetchEvent(id), pendingForm == nil, !draft.dirty { draft = .from(e, config: config) }
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
            draft = .from(saved, config: config)
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

    /// A date's own target. nil = that part goes back to the month's target split over its days.
    func setDayTarget(date: String, sales: Int64?, pax: Int64?) async -> Bool {
        do {
            try await APIClient.shared.outletSetDayTarget(projectId: projectId, date: date, salesTarget: sales, paxTarget: pax)
            notice = String(format: T("Target for %@ saved."), OutletFormat.dayLong(date, thisYear: thisYear))
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
                           subtitle: T("Ask the Project Owner or a board member to add you to the project."))
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
                Group {
                    switch tab {
                    case .calendar:   OutletCalendarView(store: store, tab: $tab)
                    case .board:      OutletBoardView(store: store, tab: $tab)
                    case .reportForm: OutletReportFormView(store: store, tab: $tab)
                    default:          OutletOverviewView(store: store, tab: $tab)
                    }
                }
                // Report settings (owner, 14 Oct 2026). On this inner view, not next to the event sheet
                // below: two .sheet modifiers on one view leave one of them dead.
                .sheet(isPresented: $store.settingsOpen) {
                    // Page wide, at most 1000 pt tall: page height left ~250 pt empty under the last card on an
                    // iPad (UI tour run 16, R16-I-29).
                    OutletReportSettingsView(store: store).modifier(PageWideFittedSheet(maxHeight: 1000))
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

/// Page width and margins of the outlet tabs. On Mac and iPad (regular width) a page uses the window up
/// to a readable cap with comfortable margins, instead of a phone column centred in empty space.
enum OutletLayout {
    static let maxWidth: CGFloat = 1240
    static func margin(_ wide: Bool) -> CGFloat { wide ? 32 : 16 }
}

extension View {
    /// The outlet page frame: margins, top/bottom air, the width cap, centred in the window.
    func outletPage(wide: Bool, maxWidth: CGFloat = OutletLayout.maxWidth) -> some View {
        self
            .padding(.horizontal, OutletLayout.margin(wide))
            .padding(.vertical, wide ? 24 : 16)
            .frame(maxWidth: maxWidth + 2 * OutletLayout.margin(wide), alignment: .leading)
            .frame(maxWidth: .infinity)
    }
}

/// ‹ Oktober 2026 › with "This month" when another month is shown, "Copy form link" and "Add event".
/// The row above Overview, Calendar and Board.
struct OutletHeader: View {
    @Bindable var store: OutletSalesStore
    @Binding var tab: ProjectTab
    /// The date a new event gets ("Add event" on the calendar = the picked day).
    var newEventDate: String? = nil

    @Environment(\.horizontalSizeClass) private var hSize

    var body: some View {
        if hSize == .regular {
            // Words while they fit on one line, icons when they don't: a portrait iPad wrapped "Report
            // settings" and "Copy form link" onto two lines (UI tour run 13, I-10).
            // Then the labelled buttons on a row of their own under the month, before icons alone: a 13" iPad
            // beside the sidebar showed three bare icons where the web and the Mac name them (UI tour run 16,
            // R16-I-15).
            ViewThatFits(in: .horizontal) {
                row(labelled: true)
                VStack(alignment: .leading, spacing: 10) {
                    OutletMonthSwitcher(store: store, large: true)
                    HStack(spacing: 10) { actions(labelled: true); Spacer(minLength: 0) }
                }
                row(labelled: false, primary: true)
                row(labelled: false)
            }
        } else {
            // The web's words on a phone too: the three named actions on a row of their own under the month, a
            // little tighter, before the primary alone and icons (UI tour run 18, iPhone R18-I-05: sliders, link
            // and + read as bare icons where the web names them).
            ViewThatFits(in: .horizontal) {
                row(labelled: true)
                VStack(alignment: .leading, spacing: 8) {
                    OutletMonthSwitcher(store: store)
                    HStack(spacing: 6) { actions(labelled: true, tight: true); Spacer(minLength: 0) }
                }
                row(labelled: false, primary: true)
                row(labelled: false)
            }
        }
    }

    private func row(labelled: Bool, primary: Bool = false) -> some View {
        let wide = hSize == .regular
        return HStack(spacing: wide ? 10 : 6) {
            OutletMonthSwitcher(store: store, large: wide)
            Spacer(minLength: 4)
            actions(labelled: labelled, primary: primary)
        }
    }

    /// `tight`: 13 pt words and 10 pt sides, so the three named buttons share a phone's row.
    @ViewBuilder private func actions(labelled: Bool, primary: Bool = false, tight: Bool = false) -> some View {
            let size: CGFloat = tight ? 13 : 14
            let side: CGFloat = tight ? 10 : 14
            if store.canManageSettings {
                Button { store.settingsOpen = true } label: {
                    HStack(spacing: 6) {
                        Image(systemName: "slider.horizontal.3").font(.system(size: 14, weight: .semibold))
                        if labelled { Text(T("Report settings")).font(NXFont.text(size, .semibold)).lineLimit(1).fixedSize() }
                    }
                    .foregroundStyle(NX.foreground)
                    .padding(.horizontal, labelled ? side : 0)
                    .frame(minWidth: 40, minHeight: 40)
                    .background(NX.card, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(NX.border))
                    .contentShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                }
                .buttonStyle(.plain)
                .hoverEffect(.highlight)
                .accessibilityLabel(T("Report settings"))
            }
            Button { store.copyFormLink() } label: {
                HStack(spacing: 6) {
                    Image(systemName: "link").font(.system(size: 14, weight: .semibold))
                    if labelled { Text(T("Copy form link")).font(NXFont.text(size, .semibold)).lineLimit(1).fixedSize() }
                }
                .foregroundStyle(NX.foreground)
                .padding(.horizontal, labelled ? side : 0)
                .frame(minWidth: 40, minHeight: 40)
                .background(NX.card, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(NX.border))
                .contentShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            }
            .buttonStyle(.plain)
            .hoverEffect(.highlight)
            .accessibilityLabel(T("Copy form link"))
            Button {
                store.openForm(eventId: nil, date: newEventDate)
                tab = .reportForm
            } label: {
                HStack(spacing: 6) {
                    Image(systemName: "plus").font(.system(size: 14, weight: .bold))
                    if labelled || primary { Text(T("Add event")).font(NXFont.text(size, .semibold)).lineLimit(1).fixedSize() }
                }
                .foregroundStyle(NX.background)
                .padding(.horizontal, labelled || primary ? side : 0)
                .frame(minWidth: 40, minHeight: 40)
                .background(NX.onyx, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                .contentShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            }
            .buttonStyle(.plain)
            .hoverEffect(.highlight)
            .accessibilityLabel(T("Add event"))
    }
}

struct OutletMonthSwitcher: View {
    @Bindable var store: OutletSalesStore
    /// Mac/iPad: the month is the page's title, so it reads as one.
    var large = false

    var body: some View {
        let current = String(store.today.prefix(7))
        HStack(spacing: 2) {
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

/// What the small markers in a calendar cell mean, with the glyphs the cells draw (W-B11 / F-21):
/// "◎ Day target · ✎ Note" on Social Media; the outlet adds its event dots, the same four entries as the
/// web ("◎ Day target · ● Upcoming · ● Waiting report · ● Reported", run 14 N-06 / P-I28 / P-M20).
struct OutletCalendarLegend: View {
    var notes = false
    /// The event status dots the outlet cells draw.
    var statuses = false
    /// Social Media: the grey dot of a past day with nothing recorded (web "Not recorded", P-I30).
    var unrecorded = false
    var body: some View {
        // Wraps onto a second line on a narrow phone instead of cutting the last entry.
        ViewThatFits(in: .horizontal) {
            HStack(spacing: 14) { entries }
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 14) { target; if notes { note } }
                if statuses { HStack(spacing: 14) { dots } }
                if unrecorded { notRecorded }
            }
        }
        .font(NXFont.text(12)).foregroundStyle(NX.mutedFg)
        .accessibilityElement(children: .combine)
    }

    @ViewBuilder private var entries: some View {
        target
        if notes { note }
        if statuses { dots }
        if unrecorded { notRecorded }
    }

    private var notRecorded: some View {
        HStack(spacing: 5) {
            Circle().fill(NX.mutedFg.opacity(0.5)).frame(width: 4, height: 4)
            Text(T("Not recorded")).lineLimit(1)
        }
    }

    private var target: some View {
        Label(T("Day target"), systemImage: "target").labelStyle(LegendLabelStyle(tint: NX.violetText))
    }

    private var note: some View {
        Label(T("Note"), systemImage: "square.and.pencil").labelStyle(LegendLabelStyle(tint: NX.mutedFg))
    }

    @ViewBuilder private var dots: some View {
        ForEach(OutletStatus.allCases) { s in
            HStack(spacing: 5) {
                Circle().fill(s.tone.fg).frame(width: 6, height: 6)
                Text(s.label).lineLimit(1)
            }
        }
    }

    private struct LegendLabelStyle: LabelStyle {
        let tint: Color
        func makeBody(configuration: Configuration) -> some View {
            HStack(spacing: 4) {
                configuration.icon.font(.system(size: 11, weight: .semibold)).foregroundStyle(tint)
                configuration.title
            }
        }
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
    var height: CGFloat = 8
    var body: some View {
        let value = Double(min(100, max(0, pct ?? 0))) / 100
        GeometryReader { geo in
            ZStack(alignment: .leading) {
                Capsule().fill(NX.muted)
                // The web's neutral fill (UI tour run 15, Q-IB11: purple bars), green once the target is reached.
                Capsule().fill((pct ?? 0) >= 100 ? NX.success : NX.foreground.opacity(0.55)).frame(width: geo.size.width * value)
            }
        }
        .frame(height: height)
        .accessibilityElement()
        .accessibilityValue(pct.map { "\($0)%" } ?? "—")
    }
}

/// One card with the outlet's look.
struct OutletCard<Content: View>: View {
    /// Stretch to the row's height (cards side by side line up at the bottom too).
    var fillHeight = false
    @ViewBuilder let content: () -> Content
    var body: some View {
        VStack(alignment: .leading, spacing: 10) { content() }
            .padding(14)
            .frame(maxWidth: .infinity, maxHeight: fillHeight ? .infinity : nil, alignment: .topLeading)
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
    /// The room the two target cards share (iPad / Mac): side by side only where each keeps its line whole.
    @State private var cardsWidth: CGFloat = 0
    @State private var salesTargetText = ""
    @State private var paxTargetText = ""
    @State private var savingTarget = false

    private var wide: Bool { hSize == .regular }
    private var monthName: String { OutletFormat.monthLabel(store.month) }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: wide ? 20 : 14) {
                OutletHeader(store: store, tab: $tab)
                VStack(alignment: .leading, spacing: 10) {
                    cards
                    targetLine
                }
                waitingBox
                // Owner, 14 Oct 2026: one Guest overview replaces the counts strip and the month's list.
                OutletGuestOverview(store: store, tab: $tab)
                    .padding(.top, wide ? 8 : 4)
            }
            .outletPage(wide: wide)
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
        // Side by side from 700 pt; a portrait iPad beside the sidebar (~660 pt) stacks them full width, as the
        // phone does, so "Rp 6.000.000 / Rp 150.000.000 4%" stays on one line: in a half-width card it dropped
        // under the figure even at the smaller sizes (UI tour run 17 iPad R17-I-17, run 18 R18-I-04).
        Group {
            if wide && (cardsWidth == 0 || cardsWidth >= 700) {
                HStack(alignment: .top, spacing: 16) { sales; pax }
                    .fixedSize(horizontal: false, vertical: true)   // both cards as tall as the taller one
            } else {
                VStack(spacing: wide ? 16 : 12) { sales; pax }
            }
        }
        .frame(maxWidth: .infinity)
        .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { cardsWidth = $0 }
    }

    /// One target card, as the web's (UI tour run 16, R16-B-12): the title with its hint under it, then
    /// "Rp 6.000.000 / Rp 150.000.000" with a grey percent chip, and the bar. Equal halves on Mac/iPad,
    /// stacked on iPhone.
    private func metricCard(title: String, hint: String?, actual: String, target: String?, pct: Int64?) -> some View {
        VStack(alignment: .leading, spacing: wide ? 12 : 10) {
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(NXFont.text(wide ? 15 : 14, .semibold)).foregroundStyle(NX.foreground)
                    .lineLimit(1)
                if let hint, !hint.isEmpty {
                    Text(hint).font(NXFont.text(12)).foregroundStyle(NX.mutedFg)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            // One line at a smaller size before the target drops under the figure: a portrait iPad's card put
            // "/ Rp 150.000.000 4%" on a second line where the Mac and the web keep one (UI tour run 17, iPad
            // R17-I-17).
            ViewThatFits(in: .horizontal) {
                figureLine(actual: actual, target: target, pct: pct)
                figureLine(actual: actual, target: target, pct: pct, size: wide ? 24 : 22, tail: wide ? 14 : 13)
                figureLine(actual: actual, target: target, pct: pct, size: wide ? 20 : 18, tail: 12)
                VStack(alignment: .leading, spacing: 4) {
                    Text(actual).font(NXFont.display(wide ? 30 : 26, .bold)).foregroundStyle(NX.foreground)
                        .monospacedDigit().lineLimit(1).minimumScaleFactor(0.6)
                    figureTail(target: target, pct: pct)
                }
            }
            if target != nil {
                OutletMeter(pct: pct, height: 8)
            } else {
                Text(T("No target for this month")).font(NXFont.text(13)).foregroundStyle(NX.mutedFg)
            }
        }
        .padding(wide ? 20 : 16)
        .frame(maxWidth: .infinity, maxHeight: wide ? CGFloat.infinity : nil, alignment: .topLeading)
        .background(NX.card, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(NX.border))
        .accessibilityElement(children: .combine)
    }

    private func figureLine(actual: String, target: String?, pct: Int64?, size: CGFloat? = nil, tail: CGFloat? = nil) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Text(actual).font(NXFont.display(size ?? (wide ? 30 : 26), .bold)).foregroundStyle(NX.foreground)
                .monospacedDigit().lineLimit(1).fixedSize()
            figureTail(target: target, pct: pct, size: tail)
        }
    }

    @ViewBuilder private func figureTail(target: String?, pct: Int64?, size: CGFloat? = nil) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            if let target {
                Text("/ \(target)").font(NXFont.text(size ?? (wide ? 16 : 14))).foregroundStyle(NX.mutedFg)
                    .monospacedDigit().lineLimit(1).fixedSize()
            }
            if let pct { SocialPctChip(pct: pct, size: 12).fixedSize() }
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
                        if !store.canManageTargets { Text(T("The Project Owner or a board member sets it.")) }
                    }
                }
                .font(NXFont.text(12)).foregroundStyle(NX.mutedFg)
                Spacer(minLength: 0)
                if store.canManageTargets {
                    let has = store.target?.salesTarget != nil || store.target?.paxTarget != nil
                    // A bordered button with a pencil, as the web's (UI tour run 16, R16-B-12).
                    Button { startEditing() } label: {
                        Label(has ? T("Change target") : T("Set target"), systemImage: "pencil")
                    }
                    .buttonStyle(NXButtonStyle(kind: .bordered, compact: true))
                    .frame(minHeight: 44)
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
            VStack(alignment: .leading, spacing: wide ? 20 : 14) {
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
                    // Three equal columns across the page; each as tall as its own cards.
                    HStack(alignment: .top, spacing: 16) {
                        ForEach(OutletStatus.allCases) { column($0) }
                    }
                } else {
                    VStack(spacing: 12) {
                        ForEach(OutletStatus.allCases) { column($0) }
                    }
                }
            }
            .outletPage(wide: wide)
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
        return VStack(alignment: .leading, spacing: wide ? 10 : 8) {
            HStack(spacing: 8) {
                Circle().fill(status.tone.fg).frame(width: 8, height: 8)
                Text(status.label).font(NXFont.text(wide ? 15 : 13, .bold)).foregroundStyle(NX.foreground)
                Spacer(minLength: 0)
                Text("\(list.count)").font(NXFont.text(12, .bold)).foregroundStyle(NX.mutedFg).monospacedDigit()
                    .padding(.horizontal, 8).padding(.vertical, 2).background(NX.card, in: Capsule())
            }
            .padding(.horizontal, 2).padding(.bottom, 2)
            .accessibilityElement(children: .combine)
            if list.isEmpty {
                Text(emptyText(status)).font(NXFont.text(12)).foregroundStyle(NX.mutedFg)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.vertical, 6)
            } else {
                ForEach(list) { card($0) }
            }
        }
        .padding(wide ? 14 : 12)
        .frame(maxWidth: .infinity, alignment: .topLeading)
        .background(NX.muted.opacity(0.45), in: RoundedRectangle(cornerRadius: 20, style: .continuous))
    }

    private func card(_ e: OutletEvent) -> some View {
        Button { store.sheetEventId = e.id } label: {
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 6) {
                    Text(OutletFormat.dayShort(e.date, thisYear: String(store.month.prefix(4))))
                        .font(NXFont.text(12, .semibold)).foregroundStyle(NX.mutedFg)
                    Spacer(minLength: 4)
                    if e.status == .waiting, let missing = e.missingLabel { NexusChip(text: missing, tone: .warning) }
                }
                Text(e.name).font(NXFont.text(wide ? 16 : 15, .semibold)).foregroundStyle(NX.foreground).lineLimit(2)
                VStack(alignment: .leading, spacing: 3) {
                    figureLine(T("Sales"), OutletFormat.vsTarget(e.sales, e.salesTarget, e.salesPct, money: true))
                    figureLine(T("Pax"), OutletFormat.vsTarget(e.pax, e.paxTarget, e.paxPct, money: false))
                }
                .padding(.top, 2)
            }
            .padding(wide ? 14 : 12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(NX.card, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(NX.border))
            .contentShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        }
        .buttonStyle(.plain)
        .hoverEffect(.lift)
    }

    /// "Sales    Rp2.000.000 / Rp4.000.000 (50%)": the label muted, the figure in the text colour.
    private func figureLine(_ label: String, _ value: String) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Text(label).foregroundStyle(NX.mutedFg).frame(minWidth: 34, alignment: .leading)
            Text(value).foregroundStyle(NX.foreground).lineLimit(1).minimumScaleFactor(0.75)
        }
        .font(NXFont.text(13)).monospacedDigit()
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
    /// The outlet's own breakdown (owner, 14 Oct 2026): RSVP, Hosting and Communities come from it.
    var config: OutletReportConfig = .standard
    /// The company's day (WIB, "2026-10-14"): a night after it cannot be reported yet (W-B5).
    var today: String? = nil
    var onEdit: (() -> Void)? = nil

    @Environment(\.horizontalSizeClass) private var hSize
    /// Wide enough on a Mac/iPad for "How to keep it from happening again" on one line (run 14, P-M20).
    private var labelWidth: CGFloat { hSize == .regular ? 280 : 132 }
    /// A night still to come: its report opens on the night itself.
    private var future: Bool { today.map { event.date.prefix(10) > $0.prefix(10) } ?? false }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .center, spacing: 10) {
                OutletStatusPill(status: event.status)
                Spacer(minLength: 0)
                if let onEdit, future && event.status != .reported {
                    Label(T("Reports open on the night itself"), systemImage: "clock")
                        .font(NXFont.text(12, .semibold)).foregroundStyle(NX.mutedFg)
                        .multilineTextAlignment(.trailing)
                        .fixedSize(horizontal: false, vertical: true)
                    Button(action: onEdit) {
                        Label(T("Fill report"), systemImage: "square.and.pencil")
                            .font(NXFont.text(13, .semibold)).foregroundStyle(NX.background)
                            .padding(.horizontal, 12).frame(minHeight: 40)
                            .background(NX.onyx, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                    }
                    .buttonStyle(.plain)
                    .disabled(true)
                    .opacity(0.45)
                } else if let onEdit {
                    let reported = event.status == .reported
                    Button(action: onEdit) {
                        Label(reported ? T("Edit report") : T("Fill report"), systemImage: "square.and.pencil")
                            .font(NXFont.text(13, .semibold))
                            .foregroundStyle(reported ? NX.foreground : NX.background)
                            .padding(.horizontal, 12).frame(minHeight: 40)
                            .background(reported ? NX.background : NX.onyx, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(reported ? NX.border : .clear))
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.bottom, 6)
            row(form.label("name", "Event name"), Text(event.name).fontWeight(.semibold))
            // "Date", not the question's "Day/Date": the answer is one date (run 14, N-28).
            row(T("Date"), Text(OutletFormat.dayLong(event.date, thisYear: thisYear)))
            row(form.label("sales", "Sales"), Text(OutletFormat.vsTarget(event.sales, event.salesTarget, event.salesPct, money: true)), number: true)
            row(form.label("pax", "Pax"), Text(OutletFormat.vsTarget(event.pax, event.paxTarget, event.paxPct, money: false)), number: true)
            if event.status == .reported || event.rsvpTotal != nil || event.hostingTotal != nil {
                total("rsvp", event.rsvpTotal)
                total("hosting", event.hostingTotal)
                communities
                if hSize == .regular {
                    // What worked beside what didn't, as the web's second column (UI tour run 15, Q-IB19).
                    Divider().overlay(NX.border).padding(.vertical, 4)
                    HStack(alignment: .top, spacing: 20) {
                        storyColumn("success")
                        storyColumn("fail")
                    }
                } else {
                    story("success")
                    story("fail")
                }
            } else {
                // A night with nothing reported says so once, instead of ~20 rows of "—" and "Not filled"
                // (UI tour run 15, Q-IB20).
                Text(future ? T("Reports open on the night itself") : T("No report yet. Fill report to add the figures."))
                    .font(NXFont.text(13)).foregroundStyle(NX.mutedFg)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.top, 10)
            }
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

    /// One label and its value. `indent` levels move the label in without moving the value, and figures
    /// (`number`) sit in one right-aligned column, children under their parents (F-22 / W-B13).
    private func row(_ label: String, _ value: Text, strong: Bool = false, indent: Int = 0, number: Bool = false) -> some View {
        let inset = CGFloat(indent) * 12
        return HStack(alignment: .firstTextBaseline, spacing: 10) {
            Text(label)
                .font(NXFont.text(13, strong ? .semibold : .regular))
                .foregroundStyle(strong ? NX.foreground : NX.mutedFg)
                .frame(width: labelWidth - inset, alignment: .leading)
            value.font(NXFont.text(13, strong ? .semibold : .regular)).foregroundStyle(NX.foreground)
                .monospacedDigit()
                .multilineTextAlignment(number ? .trailing : .leading)
                .frame(maxWidth: .infinity, alignment: number ? .trailing : .leading)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.leading, inset)
        .padding(.vertical, 5)
        .accessibilityElement(children: .combine)
    }

    /// The active items, and an archived one only when this report holds a figure for it.
    private func shown(_ items: [OutletItem]) -> [OutletItem] {
        items.filter { !$0.archived || event.values[$0.id] != nil }
    }

    private func itemLabel(_ label: String, archived: Bool) -> String {
        archived ? "\(label) · \(T("archived"))" : label
    }

    @ViewBuilder private func total(_ key: String, _ value: Int64?) -> some View {
        // "RSVP total", sentence case like "Communities total" (W-B13; the form's title said "RSVP – TOTAL").
        let title = key == "rsvp" ? T("RSVP total") : T("Hosting total")
        Divider().overlay(NX.border).padding(.vertical, 4)
        row(title, Text(OutletFormat.count(value)), strong: true, number: true)
        ForEach(shown(key == "rsvp" ? config.rsvp : config.hosting), id: \.rowId) { i in
            row(itemLabel(i.label, archived: i.archived), Text(OutletFormat.count(event.values[i.id])), indent: 1, number: true)
        }
    }

    /// Communities: the grand total, each community's, a Breakdown community's own items under it.
    @ViewBuilder private var communities: some View {
        let list = config.communities.filter { !$0.archived || event.communityTotals[$0.id] != nil }
        if !list.isEmpty {
            Divider().overlay(NX.border).padding(.vertical, 4)
            row(T("Communities total"), Text(OutletFormat.count(event.communityTotal)), strong: true, number: true)
            ForEach(list, id: \.rowId) { c in
                // A community with its own breakdown is a group header, bold as on the web (Q-IB19).
                row(itemLabel(c.name, archived: c.archived), Text(OutletFormat.count(event.communityTotals[c.id])),
                    strong: c.isBreakdown, indent: 1, number: true)
                if c.isBreakdown {
                    ForEach(shown(c.items), id: \.rowId) { i in
                        row(itemLabel(i.label, archived: i.archived), Text(OutletFormat.count(event.values[i.id])), indent: 2, number: true)
                    }
                    if let own = event.values[c.id] {
                        row(T("Total only"), Text(OutletFormat.count(own)), indent: 2, number: true)
                    }
                }
            }
        }
    }

    /// One story as a column: the title, then each question over its answer.
    @ViewBuilder private func storyColumn(_ key: String) -> some View {
        if let s = form.section(key) {
            VStack(alignment: .leading, spacing: 8) {
                Text(s.title.text).font(NXFont.text(13, .semibold)).foregroundStyle(NX.foreground)
                ForEach(s.fields, id: \.key) { f in
                    let answer = event.texts[f.key] ?? ""
                    VStack(alignment: .leading, spacing: 2) {
                        Text(f.label.text).font(NXFont.text(12)).foregroundStyle(NX.mutedFg)
                        Text(answer.isEmpty ? T("Not filled") : answer).font(NXFont.text(13))
                            .foregroundStyle(answer.isEmpty ? NX.mutedFg : NX.foreground)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .topLeading)
        }
    }

    @ViewBuilder private func story(_ key: String) -> some View {
        if let s = form.section(key) {
            Divider().overlay(NX.border).padding(.vertical, 4)
            // Sentence case like "RSVP total" / "Communities total" (run 14, N-28 / P-M20), not all caps.
            Text(s.title.text).font(NXFont.text(13, .semibold)).foregroundStyle(NX.foreground)
                .padding(.vertical, 5)
            ForEach(s.fields, id: \.key) { f in
                let answer = event.texts[f.key] ?? ""
                row(f.label.text, answer.isEmpty ? Text(T("Not filled")).foregroundColor(NX.mutedFg) : Text(answer), indent: 1)
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
                            OutletEventCard(event: e, form: store.form, thisYear: store.thisYear, config: store.config, today: store.today) { onEdit(e.id) }
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
