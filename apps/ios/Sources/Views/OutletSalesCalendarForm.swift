import SwiftUI

// MARK: - Outlet Sales Dashboard: Calendar and Report form (owner, 10 Oct 2026, for Ryan)
//
// Calendar: "Ketika pencet sebuah tanggal, di bawah muncul details" — a month grid (Monday first, six
// weeks), and under it the picked day with every event of that day as Ryan listed it.
// Report form: "form dengan pertanyaan yang diatas, supaya team nya tinggal isi form nya" — drawn from
// the server's form (`form` in every answer), one card per section in Ryan's order and words.

struct OutletCalendarView: View {
    @Bindable var store: OutletSalesStore
    @Binding var tab: ProjectTab

    @Environment(\.horizontalSizeClass) private var hSize
    private var wide: Bool { hSize == .regular }
    private let columns = Array(repeating: GridItem(.flexible(), spacing: 0), count: 7)

    var body: some View {
        let day = store.calendarDay
        // Every width as the web draws it (UI tour run 13, I-1 / M-11 / M-12): the month across the full
        // width, the picked day under it, one page that scrolls. The side panel squeezed the month into a
        // third of an iPad ("M/on", chips cut to "Z") and cut the day's report off on the Mac.
        ScrollView {
            VStack(alignment: .leading, spacing: wide ? 20 : 14) {
                OutletHeader(store: store, tab: $tab, newEventDate: day)
                grid(selected: day)
                OutletCalendarLegend(statuses: true)
                dayDetail(day)
            }
            .outletPage(wide: wide)
            .opacity(store.switching ? 0.55 : 1)
        }
        .refreshable { await store.load() }
    }

    // MARK: the month grid

    /// A bordered grid, the same as the Social Media calendar and the web (F-21).
    private func grid(selected: String) -> some View {
        // One month-grid style everywhere (NXMonthGrid.swift; UI tour run 16, R16-I-06).
        VStack(spacing: 0) {
            NXMonthWeekdayRow(names: OutletFormat.weekHeader, wide: wide)
            LazyVGrid(columns: columns, spacing: 0) {
                ForEach(OutletFormat.gridDays(store.month), id: \.self) { d in
                    cell(d, selected: d == selected)
                }
            }
        }
        .nxMonthGridCard()
    }

    private func cell(_ d: String, selected: Bool) -> some View {
        let inMonth = d.hasPrefix(store.month)
        let list = inMonth ? store.events(on: d) : []
        let isToday = d == store.today
        let number = OutletFormat.parts(d)?.d ?? 0
        // A date with its own target (owner, 14 Oct 2026): a small marker in the cell's corner.
        let ownTarget = inMonth && store.ownTarget(d) != nil
        return Button {
            store.selectedDay = d
            // A day of the next or previous month switches to that month (web does the same).
            if !inMonth { Task { await store.show(month: String(d.prefix(7))) } }
        } label: {
            VStack(alignment: .leading, spacing: 3) {
                NXMonthDayNumber(day: number, inMonth: inMonth, isToday: isToday, wide: wide)
                if wide {
                    ForEach(list.prefix(2)) { e in
                        // Two lines for the name: one line cut every event to "ZZ QA cu…" on an iPad (run 14, P-I28).
                        HStack(alignment: .firstTextBaseline, spacing: 4) {
                            Circle().fill(e.status.tone.fg).frame(width: 6, height: 6)
                            // The whole name: three lines still cut "ZZ QA / custom / report ni…" in a portrait
                            // iPad's cell (UI tour run 15, Q-IB18; run 16, R16-I-16), so four, a size smaller there.
                            Text(e.name).font(NXFont.text(11, .semibold)).foregroundStyle(NX.foreground)
                                .lineLimit(4).minimumScaleFactor(0.85).multilineTextAlignment(.leading)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                        .padding(.horizontal, 5).padding(.vertical, 2)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(e.status.tone.bg, in: RoundedRectangle(cornerRadius: 6, style: .continuous))
                    }
                    if list.count > 2 {
                        Text(String(format: T("+%d more"), list.count - 2))
                            .font(NXFont.text(10, .semibold)).foregroundStyle(NX.mutedFg)
                    }
                } else {
                    HStack(spacing: 3) {
                        ForEach(list.prefix(3)) { e in
                            Circle().fill(e.status.tone.fg).frame(width: 6, height: 6)
                        }
                    }
                    .frame(height: 6)
                }
                Spacer(minLength: 0)
            }
            .padding(wide ? 6 : 3)
            .frame(maxWidth: .infinity, minHeight: wide ? 104 : 56, alignment: .topLeading)
            .overlay(alignment: .topTrailing) {
                if ownTarget { NXMonthTargetMark(wide: wide).padding(wide ? 7 : 4) }
            }
            .nxMonthCell(inMonth: inMonth, selected: selected)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .hoverEffect(.highlight)
        .accessibilityLabel("\(OutletFormat.dayLong(d, thisYear: store.thisYear)), \(list.isEmpty ? T("No events") : (list.count == 1 ? T("1 event") : String(format: T("%d events"), list.count)))\(ownTarget ? ", " + T("Own daily target") : "")")
        .accessibilityAddTraits(selected ? .isSelected : [])
    }

    // MARK: the picked day

    private func dayDetail(_ day: String) -> some View {
        let list = store.events(on: day)
        return VStack(alignment: .leading, spacing: 12) {
            let title = Text(OutletFormat.dayLong(day, thisYear: store.thisYear))
                .font(NXFont.display(wide ? 19 : 17, .bold)).foregroundStyle(NX.foreground)
            let add = Button {
                store.openForm(eventId: nil, date: day)
                tab = .reportForm
            } label: {
                Label(T("Add event on this day"), systemImage: "plus")
                    .font(NXFont.text(13, .semibold)).foregroundStyle(NX.violetText)
                    .lineLimit(1).minimumScaleFactor(0.85)
                    .frame(minHeight: 40)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            HStack(alignment: .center, spacing: 8) { title; Spacer(minLength: 4); add }
            OutletDayTargetCard(store: store, day: day)
            if list.isEmpty {
                Text(T("No event on this day. Add one to fill its report after the night."))
                    .font(NXFont.text(13)).foregroundStyle(NX.mutedFg)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(14)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(NX.muted.opacity(0.45), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            } else {
                ForEach(list) { e in
                    OutletEventCard(event: e, form: store.form, thisYear: store.thisYear, config: store.config, today: store.today) {
                        store.openForm(eventId: e.id, date: nil)
                        tab = .reportForm
                    }
                }
            }
        }
    }
}

// MARK: - Report form

/// The one alert of the form: discard unsaved changes, delete the event, or a refused save.
enum OutletFormAlert { case discard, delete, refused }

struct OutletReportFormView: View {
    @Bindable var store: OutletSalesStore
    @Binding var tab: ProjectTab

    @State private var saving = false
    @State private var confirmDelete = false
    @State private var fieldError: String?

    @Environment(\.horizontalSizeClass) private var hSize

    private var draft: OutletDraft { store.draft }
    private var isNew: Bool { draft.eventId == nil }
    private var current: OutletEvent? { draft.eventId.flatMap { store.event($0) } }

    private var wide: Bool { hSize == .regular }

    /// Sections with a long answer (what went well / what didn't); the rest are figures.
    private var storySections: [OutletFormSection] {
        store.form.sections.filter { $0.fields.contains { $0.type == "longtext" } }
    }
    private var figureSections: [OutletFormSection] {
        store.form.sections.filter { !$0.fields.contains { $0.type == "longtext" } }
    }

    @ViewBuilder private var deleteButton: some View {
        if !isNew {
            Button(role: .destructive) { confirmDelete = true } label: {
                Label(T("Delete event"), systemImage: "trash")
                    .font(NXFont.text(14, .semibold)).foregroundStyle(NX.danger)
                    .frame(maxWidth: .infinity, minHeight: 44)
                    .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(NX.danger.opacity(0.4)))
                    .contentShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            }
            .buttonStyle(.plain)
            .padding(.top, 4)
        }
    }

    private var alert: OutletFormAlert? {
        if store.pendingForm != nil { return .discard }
        if confirmDelete { return .delete }
        if store.actionError != nil { return .refused }
        return nil
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                head
                picker
                if futureNight {
                    // W-B5: a night after today (WIB) has nothing to report yet; the event itself can be planned.
                    Label(T("Reports open on the night itself"), systemImage: "clock")
                        .font(NXFont.text(13, .semibold)).foregroundStyle(NX.mutedFg)
                }
                if let current { currentLine(current) }
                else if draft.eventId != nil {
                    Text(T("This event no longer exists. It may have been deleted; Control Room → Audit can restore it."))
                        .font(NXFont.text(12, .semibold)).foregroundStyle(NX.danger)
                }
                if wide && !storySections.isEmpty {
                    // Mac/iPad: the figures (name, date, sales, pax, RSVP, hosting) on the left, what
                    // went well and what didn't on the right — the whole report in one view.
                    HStack(alignment: .top, spacing: 20) {
                        VStack(alignment: .leading, spacing: 14) {
                            ForEach(figureSections) { section($0) }
                        }
                        .frame(maxWidth: .infinity, alignment: .top)
                        VStack(alignment: .leading, spacing: 14) {
                            ForEach(storySections) { section($0) }
                            deleteButton
                        }
                        .frame(maxWidth: .infinity, alignment: .top)
                    }
                } else {
                    ForEach(store.form.sections) { section($0) }
                    deleteButton
                }
            }
            .outletPage(wide: wide, maxWidth: wide ? 1120 : 760)
        }
        .scrollDismissesKeyboard(.interactively)
        .keyboardDoneBar()
        .safeAreaInset(edge: .bottom, spacing: 0) { saveBar }
        .onChange(of: draft.eventId) { _, _ in fieldError = nil }
        .alert(alertTitle, isPresented: Binding(get: { alert != nil }, set: { if !$0 { dismissAlert() } })) {
            switch alert {
            case .discard:
                Button(T("Cancel"), role: .cancel) { store.pendingForm = nil }
                Button(T("Discard"), role: .destructive) {
                    if let p = store.pendingForm { store.apply(p) }
                }
            case .delete:
                Button(T("Cancel"), role: .cancel) { confirmDelete = false }
                Button(T("Delete event"), role: .destructive) {
                    confirmDelete = false
                    if let id = draft.eventId { Task { _ = await store.delete(id) } }
                }
            default:
                Button("OK") { store.actionError = nil }
            }
        } message: {
            switch alert {
            case .delete:
                Text(T("The event and its report leave the calendar, the board and the month's totals. Control Room → Audit can restore it."))
            default:
                EmptyView()
            }
        }
    }

    private var alertTitle: String {
        switch alert {
        case .discard: return T("Discard the changes you haven't saved?")
        case .delete: return String(format: T("Delete %@?"), current?.name ?? draft.text("name"))
        case .refused: return store.actionError ?? ""
        case nil: return ""
        }
    }

    private func dismissAlert() {
        switch alert {
        case .discard: store.pendingForm = nil
        case .delete: confirmDelete = false
        case .refused: store.actionError = nil
        case nil: break
        }
    }

    // MARK: header, picker, the event's state

    private var head: some View {
        HStack(alignment: .top, spacing: 10) {
            VStack(alignment: .leading, spacing: 4) {
                Text(T("Event report")).font(NXFont.display(wide ? 24 : 19, .bold)).foregroundStyle(NX.foreground)
                Text(T("Fill it after every night. It goes straight into Overview, Calendar and Board."))
                    .font(NXFont.text(wide ? 14 : 12)).foregroundStyle(NX.mutedFg).fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 4)
            Button { store.copyFormLink(eventId: draft.eventId) } label: {
                Image(systemName: "link").font(.system(size: 15, weight: .semibold)).foregroundStyle(NX.foreground)
                    .frame(width: 40, height: 40)
                    .background(NX.card, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(NX.border))
            }
            .buttonStyle(.plain)
            .accessibilityLabel(T("Copy form link"))
        }
    }

    private func option(_ e: OutletEvent) -> String {
        "\(OutletFormat.dayShort(e.date, thisYear: store.thisYear)) · \(e.name)"
    }

    private var picker: some View {
        let upcoming = store.events.filter { $0.status == .upcoming }
        let reported = store.events.filter { $0.status == .reported }
        let waiting = store.allWaiting
        let label = isNew ? T("New event") : (current.map(option) ?? draft.text("name"))
        return VStack(alignment: .leading, spacing: 6) {
            Text(T("Which event?")).font(NXFont.text(12, .semibold)).foregroundStyle(NX.foreground)
            Menu {
                Button { choose(nil) } label: { check(isNew, T("New event")) }
                if !waiting.isEmpty {
                    Section(T("Waiting for a report")) {
                        ForEach(waiting) { e in Button { choose(e.id) } label: { check(draft.eventId == e.id, option(e)) } }
                    }
                }
                if !upcoming.isEmpty {
                    Section(T("Upcoming")) {
                        ForEach(upcoming) { e in Button { choose(e.id) } label: { check(draft.eventId == e.id, option(e)) } }
                    }
                }
                if !reported.isEmpty {
                    Section(T("Reported")) {
                        ForEach(reported) { e in Button { choose(e.id) } label: { check(draft.eventId == e.id, option(e)) } }
                    }
                }
            } label: {
                HStack(spacing: 8) {
                    Text(label).font(NXFont.text(15, .semibold)).foregroundStyle(NX.foreground).lineLimit(1)
                    Spacer(minLength: 4)
                    Image(systemName: "chevron.up.chevron.down").font(.system(size: 12, weight: .semibold)).foregroundStyle(NX.mutedFg)
                }
                .padding(.horizontal, 12).frame(minHeight: 46)
                .background(NX.card, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(NX.border))
                .contentShape(Rectangle())
            }
            .accessibilityLabel(T("Which event?"))
            .accessibilityValue(label)
        }
        .frame(maxWidth: wide ? 540 : .infinity, alignment: .leading)
    }

    @ViewBuilder private func check(_ on: Bool, _ text: String) -> some View {
        if on { Label(text, systemImage: "checkmark") } else { Text(text) }
    }

    private func choose(_ id: String?) {
        guard id != draft.eventId || id == nil else { return }
        if id == nil && isNew && !draft.dirty { return }
        store.openForm(eventId: id, date: nil)
    }

    private func currentLine(_ e: OutletEvent) -> some View {
        HStack(spacing: 8) {
            OutletStatusPill(status: e.status)
            if let who = (e.updatedBy ?? e.createdBy)?.name {
                Text(String(format: T("Last changed by %@"), who) + (OutletFormat.stamp(e.updatedAt).map { " · \($0)" } ?? ""))
                    .font(NXFont.text(11)).foregroundStyle(NX.mutedFg).lineLimit(2)
            }
        }
    }

    // MARK: the sections, exactly as the server's form lists them

    /// The draft's night is after today (WIB): only the event's name and date can be filled.
    private var futureNight: Bool { draft.date.prefix(10) > store.today.prefix(10) }

    @ViewBuilder private func section(_ s: OutletFormSection) -> some View {
        // RSVP and Hosting come from the outlet's own items (owner, 14 Oct 2026); Communities follow Hosting.
        if s.key == "rsvp" {
            breakdownSection(T("RSVP total"), store.config.rsvp).disabled(futureNight)
        } else if s.key == "hosting" {
            breakdownSection(T("Hosting total"), store.config.hosting).disabled(futureNight)
            communitiesSection.disabled(futureNight)
        } else {
            let planning = s.fields.contains { $0.type == "date" || $0.key == "name" }
            formSection(s).disabled(futureNight && !planning)
        }
    }

    /// The active items, and an archived one only when this report already holds a figure for it.
    private func shown(_ items: [OutletItem]) -> [OutletItem] {
        items.filter { !$0.archived || OutletFormat.parse(draft.originalFigures[$0.id] ?? "") != nil }
    }

    private func itemLabel(_ label: String, archived: Bool) -> String {
        archived ? "\(label) · \(T("archived"))" : label
    }

    private func figure(_ id: String) -> Binding<String> {
        Binding(get: { store.draft.figures[id] ?? "" }, set: { store.draft.figures[id] = $0 })
    }

    private func figureBox(_ id: String, _ label: String) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label).font(NXFont.text(13, .semibold)).foregroundStyle(NX.foreground).lineLimit(2)
            OutletNumberField(text: figure(id), money: false, placeholder: "—")
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var boxColumns: [GridItem] { Array(repeating: GridItem(.flexible(), spacing: 12, alignment: .top), count: 2) }

    private func breakdownSection(_ title: String, _ items: [OutletItem]) -> some View {
        let list = shown(items)
        return OutletCard {
            Text("\(title): \(OutletFormat.count(draft.figureTotal(items.map(\.id))))")
                .font(NXFont.text(12, .bold)).tracking(0.3).foregroundStyle(NX.foreground)
            if list.isEmpty {
                Text(T("No items yet. Report settings sets them up.")).font(NXFont.text(12)).foregroundStyle(NX.mutedFg)
            } else {
                LazyVGrid(columns: boxColumns, alignment: .leading, spacing: 12) {
                    ForEach(list, id: \.rowId) { i in figureBox(i.id, itemLabel(i.label, archived: i.archived)) }
                }
            }
        }
    }

    /// Communities: per community one number (Total only) or its own items (Breakdown), the grand total on top.
    @ViewBuilder private var communitiesSection: some View {
        let list = store.config.communities.filter { c in
            !c.archived || ([c.id] + c.items.map(\.id)).contains { OutletFormat.parse(draft.originalFigures[$0] ?? "") != nil }
        }
        if !list.isEmpty {
            let grand: Int64? = {
                let totals = list.compactMap { c in draft.figureTotal([c.id] + c.items.map(\.id)) }
                return totals.isEmpty ? nil : totals.reduce(0, +)
            }()
            OutletCard {
                Text("\(T("Communities total")): \(OutletFormat.count(grand))")
                    .font(NXFont.text(12, .bold)).tracking(0.3).foregroundStyle(NX.foreground)
                ForEach(list, id: \.rowId) { c in
                    let subs = shown(c.items)
                    let name = itemLabel(c.name, archived: c.archived)
                    if !c.isBreakdown || subs.isEmpty {
                        figureBox(c.id, name)
                    } else {
                        VStack(alignment: .leading, spacing: 10) {
                            HStack {
                                Text(name).font(NXFont.text(13, .bold)).foregroundStyle(NX.foreground)
                                Spacer(minLength: 4)
                                Text(OutletFormat.count(draft.figureTotal([c.id] + c.items.map(\.id))))
                                    .font(NXFont.text(13, .semibold)).foregroundStyle(NX.mutedFg).monospacedDigit()
                            }
                            LazyVGrid(columns: boxColumns, alignment: .leading, spacing: 12) {
                                ForEach(subs, id: \.rowId) { i in figureBox(i.id, itemLabel(i.label, archived: i.archived)) }
                                // Filled as one number before the community was split: still editable.
                                if OutletFormat.parse(draft.originalFigures[c.id] ?? "") != nil { figureBox(c.id, T("Total only")) }
                            }
                        }
                        .padding(12)
                        .background(NX.background, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(NX.border))
                    }
                }
            }
        }
    }

    private func formSection(_ s: OutletFormSection) -> some View {
        OutletCard {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(sectionTitle(s)).font(NXFont.text(12, .bold)).tracking(0.3).foregroundStyle(NX.foreground)
                Spacer(minLength: 4)
                if let live = liveVsTarget(s) {
                    Text(live).font(NXFont.text(12, .semibold)).foregroundStyle(NX.mutedFg).monospacedDigit()
                        .lineLimit(1).minimumScaleFactor(0.7)
                }
            }
            ForEach(s.fields, id: \.key) { field($0) }
        }
    }

    private func sectionTitle(_ s: OutletFormSection) -> String {
        // The server still titles the totals "RSVP – TOTAL"; the app says "RSVP total" as the web does.
        let title = s.key == "rsvp" ? T("RSVP total") : s.key == "hosting" ? T("Hosting total") : s.title.text
        guard s.total != nil else { return title.uppercased() }
        return "\(title): \(OutletFormat.count(draft.total(of: s.fields)))"
    }

    /// Sales and Pax show "actual / target (pct%)" as it is being typed.
    private func liveVsTarget(_ s: OutletFormSection) -> String? {
        switch s.key {
        case "sales":
            let a = draft.number("sales"), t = draft.number("salesTarget")
            return OutletFormat.vsTarget(a, t, OutletFormat.pct(a, t), money: true)
        case "pax":
            let a = draft.number("pax"), t = draft.number("paxTarget")
            return OutletFormat.vsTarget(a, t, OutletFormat.pct(a, t), money: false)
        default:
            return nil
        }
    }

    private func value(_ key: String) -> Binding<String> {
        Binding(get: { store.draft.values[key] ?? "" },
                set: { store.draft.values[key] = $0; if key == "name" { fieldError = nil } })
    }

    @ViewBuilder private func field(_ f: OutletFormField) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 2) {
                Text(f.label.text).font(NXFont.text(13, .semibold)).foregroundStyle(NX.foreground)
                if f.required { Text("*").font(NXFont.text(13, .bold)).foregroundStyle(NX.danger).accessibilityHidden(true) }
            }
            switch f.type {
            case "date":
                HStack(spacing: 10) {
                    DatePicker("", selection: dateBinding, displayedComponents: .date)
                        .labelsHidden()
                        .environment(\.locale, Locale(identifier: OutletFormat.isID ? "id_ID" : "en_GB"))
                    Text(OutletFormat.dayLong(draft.date, thisYear: store.thisYear))
                        .font(NXFont.text(13)).foregroundStyle(NX.mutedFg).lineLimit(1).minimumScaleFactor(0.8)
                }
            case "money", "count":
                OutletNumberField(text: value(f.key), money: f.type == "money", placeholder: "—")
            case "longtext":
                TextField("", text: value(f.key), axis: .vertical)
                    .lineLimit(2...6)
                    .font(NXFont.text(15)).foregroundStyle(NX.foreground)
                    .padding(12)
                    .background(NX.background, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(NX.border))
            default:
                TextField("", text: value(f.key))
                    .font(NXFont.text(15)).foregroundStyle(NX.foreground)
                    .submitLabel(.done)
                    .padding(.horizontal, 12).frame(minHeight: 44)
                    .background(NX.background, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .strokeBorder(f.key == "name" && fieldError != nil ? NX.danger : NX.border))
            }
            if let hint = f.hint?.text, !hint.isEmpty {
                Text(hint).font(NXFont.text(11)).foregroundStyle(NX.mutedFg).fixedSize(horizontal: false, vertical: true)
            }
            if let max = f.max, max > 0, f.type == "text" || f.type == "longtext",
               draft.text(f.key).count > Int(max) {
                Text("\(draft.text(f.key).count) / \(Int(max))").font(NXFont.text(11, .semibold)).foregroundStyle(NX.danger)
            }
        }
    }

    /// The draft's "YYYY-MM-DD" as the date picker's Date, both read on this device's calendar, so the
    /// day picked is the day stored whatever the time zone.
    private var dateBinding: Binding<Date> {
        Binding(get: {
            guard let p = OutletFormat.parts(store.draft.date),
                  let d = Calendar.current.date(from: DateComponents(year: p.y, month: p.m, day: p.d, hour: 12)) else { return Date() }
            return d
        }, set: { new in
            let c = Calendar.current.dateComponents([.year, .month, .day], from: new)
            store.draft.date = String(format: "%04d-%02d-%02d", c.year ?? 2026, c.month ?? 1, c.day ?? 1)
        })
    }

    // MARK: save

    private var saveButton: some View {
        Button { Task { await save() } } label: {
            HStack(spacing: 8) {
                if saving { ProgressView().tint(.white) }
                Text(isNew ? T("Add event") : T("Save report"))
            }
            .frame(minWidth: wide ? 180 : nil)
        }
        .buttonStyle(NexusPrimaryButton(fullWidth: !wide))
        // ⌘↩ saves (⌘S is the sidebar's).
        .keyboardShortcut(.return, modifiers: .command)
        .disabled(saving || (!isNew && !draft.dirty))
    }

    @ViewBuilder private var saveBar: some View {
        if wide {
            // Mac/iPad: the save button at the trailing edge of the form's width, the problem beside it.
            HStack(spacing: 14) {
                if let fieldError {
                    Text(fieldError).font(NXFont.text(13, .semibold)).foregroundStyle(NX.danger)
                }
                Spacer(minLength: 8)
                saveButton
            }
            .padding(.horizontal, OutletLayout.margin(true)).padding(.vertical, 12)
            .frame(maxWidth: 1120 + 2 * OutletLayout.margin(true))
            .frame(maxWidth: .infinity)
            .background(.bar)
        } else {
            VStack(spacing: 6) {
                if let fieldError {
                    Text(fieldError).font(NXFont.text(12, .semibold)).foregroundStyle(NX.danger)
                }
                saveButton
            }
            .padding(.horizontal, 16).padding(.top, 10).padding(.bottom, 10)
            .frame(maxWidth: 760)
            .frame(maxWidth: .infinity)
            .background(.bar)
        }
    }

    private func save() async {
        if draft.text("name").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            fieldError = T("Give the event a name.")
            return
        }
        if OutletFormat.parts(draft.date) == nil {
            fieldError = T("Pick the day of the event.")
            return
        }
        fieldError = nil
        saving = true
        defer { saving = false }
        guard let saved = await store.saveDraft() else { return }
        // Then the calendar on that night, as on the web.
        await store.land(on: saved)
        tab = .calendar
    }
}
