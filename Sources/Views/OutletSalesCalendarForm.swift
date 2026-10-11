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
    private let columns = Array(repeating: GridItem(.flexible(), spacing: 4), count: 7)

    /// The day panel's width beside the month on Mac/iPad.
    private static let panelWidth: CGFloat = 400

    var body: some View {
        let day = store.calendarDay
        if wide {
            // Mac/iPad: the month on the left, the picked day's reports in a panel beside it. Each side
            // scrolls on its own, so a long report never pushes the month out of view.
            VStack(alignment: .leading, spacing: 20) {
                OutletHeader(store: store, tab: $tab, newEventDate: day)
                HStack(alignment: .top, spacing: 20) {
                    ScrollView {
                        grid(selected: day)
                            .padding(.bottom, 24)
                    }
                    .scrollIndicators(.hidden)
                    .refreshable { await store.load() }
                    .frame(maxWidth: .infinity)
                    ScrollView {
                        dayDetail(day)
                            .padding(16)
                            .padding(.bottom, 8)
                    }
                    .frame(width: Self.panelWidth)
                    .background(NX.card.opacity(0.6), in: RoundedRectangle(cornerRadius: 20, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 20, style: .continuous).strokeBorder(NX.border))
                    .padding(.bottom, 24)
                }
            }
            .padding(.horizontal, OutletLayout.margin(true))
            .padding(.top, 24)
            .frame(maxWidth: OutletLayout.maxWidth + 2 * OutletLayout.margin(true), maxHeight: .infinity, alignment: .topLeading)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
            .opacity(store.switching ? 0.55 : 1)
        } else {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    OutletHeader(store: store, tab: $tab, newEventDate: day)
                    grid(selected: day)
                    dayDetail(day)
                }
                .outletPage(wide: false)
                .opacity(store.switching ? 0.55 : 1)
            }
            .refreshable { await store.load() }
        }
    }

    // MARK: the month grid

    private func grid(selected: String) -> some View {
        VStack(spacing: 4) {
            LazyVGrid(columns: columns, spacing: 4) {
                ForEach(Array(OutletFormat.weekHeader.enumerated()), id: \.offset) { _, name in
                    Text(name).font(NXFont.text(wide ? 12 : 11, .semibold)).foregroundStyle(NX.mutedFg)
                        .frame(maxWidth: .infinity, alignment: wide ? .leading : .center)
                        .padding(.leading, wide ? 8 : 0)
                        .padding(.vertical, wide ? 4 : 0)
                }
            }
            LazyVGrid(columns: columns, spacing: 4) {
                ForEach(OutletFormat.gridDays(store.month), id: \.self) { d in
                    cell(d, selected: d == selected)
                }
            }
        }
        .padding(wide ? 14 : 10)
        .background(NX.card, in: RoundedRectangle(cornerRadius: wide ? 20 : 16, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: wide ? 20 : 16, style: .continuous).strokeBorder(NX.border))
    }

    private func cell(_ d: String, selected: Bool) -> some View {
        let inMonth = d.hasPrefix(store.month)
        let list = inMonth ? store.events(on: d) : []
        let isToday = d == store.today
        let number = OutletFormat.parts(d)?.d ?? 0
        return Button {
            store.selectedDay = d
            // A day of the next or previous month switches to that month (web does the same).
            if !inMonth { Task { await store.show(month: String(d.prefix(7))) } }
        } label: {
            VStack(alignment: wide ? .leading : .center, spacing: 3) {
                Text("\(number)")
                    .font(NXFont.text(wide ? 14 : 13, isToday || selected ? .bold : .medium))
                    .foregroundStyle(isToday ? Color.white : (inMonth ? NX.foreground : NX.mutedFg.opacity(0.6)))
                    .frame(width: wide ? 28 : 26, height: wide ? 28 : 26)
                    .background(isToday ? NX.violetFill : .clear, in: Circle())
                if wide {
                    ForEach(list.prefix(2)) { e in
                        HStack(spacing: 4) {
                            Circle().fill(e.status.tone.fg).frame(width: 6, height: 6)
                            Text(e.name).font(NXFont.text(11, .semibold)).foregroundStyle(NX.foreground).lineLimit(1)
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
            .frame(maxWidth: .infinity, minHeight: wide ? 104 : 52, alignment: wide ? .topLeading : .top)
            .background(selected ? NX.violet.opacity(0.12) : .clear, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).strokeBorder(selected ? NX.violet.opacity(0.6) : .clear))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .hoverEffect(.highlight)
        .accessibilityLabel("\(OutletFormat.dayLong(d, thisYear: store.thisYear)), \(list.isEmpty ? T("No events") : (list.count == 1 ? T("1 event") : String(format: T("%d events"), list.count)))")
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
            // In the side panel the title gets the panel's full width; the action sits under it.
            if wide {
                VStack(alignment: .leading, spacing: 0) { title; add }
            } else {
                HStack(alignment: .center, spacing: 8) { title; Spacer(minLength: 4); add }
            }
            if list.isEmpty {
                Text(T("No event on this day. Add one to fill its report after the night."))
                    .font(NXFont.text(13)).foregroundStyle(NX.mutedFg)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(14)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(NX.muted.opacity(0.45), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            } else {
                ForEach(list) { e in
                    OutletEventCard(event: e, form: store.form, thisYear: store.thisYear, narrow: wide) {
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

    private func section(_ s: OutletFormSection) -> some View {
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
        let title = s.title.text
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
