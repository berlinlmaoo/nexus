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

    var body: some View {
        let day = store.calendarDay
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                OutletHeader(store: store, tab: $tab, newEventDate: day)
                grid(selected: day)
                dayDetail(day)
            }
            .padding(16)
            .frame(maxWidth: 1000, alignment: .leading)
            .frame(maxWidth: .infinity)
            .opacity(store.switching ? 0.55 : 1)
        }
        .refreshable { await store.load() }
    }

    // MARK: the month grid

    private func grid(selected: String) -> some View {
        VStack(spacing: 4) {
            LazyVGrid(columns: columns, spacing: 4) {
                ForEach(Array(OutletFormat.weekHeader.enumerated()), id: \.offset) { _, name in
                    Text(name).font(NXFont.text(11, .semibold)).foregroundStyle(NX.mutedFg)
                        .frame(maxWidth: .infinity)
                }
            }
            LazyVGrid(columns: columns, spacing: 4) {
                ForEach(OutletFormat.gridDays(store.month), id: \.self) { d in
                    cell(d, selected: d == selected)
                }
            }
        }
        .padding(10)
        .background(NX.card, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(NX.border))
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
                    .font(NXFont.text(13, isToday || selected ? .bold : .medium))
                    .foregroundStyle(isToday ? Color.white : (inMonth ? NX.foreground : NX.mutedFg.opacity(0.6)))
                    .frame(width: 26, height: 26)
                    .background(isToday ? NX.violetFill : .clear, in: Circle())
                if wide {
                    ForEach(list.prefix(2)) { e in
                        HStack(spacing: 4) {
                            Circle().fill(e.status.tone.fg).frame(width: 6, height: 6)
                            Text(e.name).font(NXFont.text(10, .semibold)).foregroundStyle(NX.foreground).lineLimit(1)
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
            .frame(maxWidth: .infinity, minHeight: wide ? 92 : 52, alignment: wide ? .topLeading : .top)
            .background(selected ? NX.violet.opacity(0.12) : .clear, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).strokeBorder(selected ? NX.violet.opacity(0.6) : .clear))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("\(OutletFormat.dayLong(d, thisYear: store.thisYear)), \(list.isEmpty ? T("No events") : (list.count == 1 ? T("1 event") : String(format: T("%d events"), list.count)))")
        .accessibilityAddTraits(selected ? .isSelected : [])
    }

    // MARK: the picked day

    private func dayDetail(_ day: String) -> some View {
        let list = store.events(on: day)
        return VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .center, spacing: 8) {
                Text(OutletFormat.dayLong(day, thisYear: store.thisYear))
                    .font(NXFont.display(17, .bold)).foregroundStyle(NX.foreground)
                Spacer(minLength: 4)
                Button {
                    store.openForm(eventId: nil, date: day)
                    tab = .reportForm
                } label: {
                    Label(T("Add event on this day"), systemImage: "plus")
                        .font(NXFont.text(13, .semibold)).foregroundStyle(NX.violetText)
                        .lineLimit(1).minimumScaleFactor(0.85)
                        .frame(minHeight: 40)
                }
                .buttonStyle(.plain)
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
                    OutletEventCard(event: e, form: store.form, thisYear: store.thisYear) {
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
                ForEach(store.form.sections) { section($0) }
                if !isNew {
                    Button(role: .destructive) { confirmDelete = true } label: {
                        Label(T("Delete event"), systemImage: "trash")
                            .font(NXFont.text(14, .semibold)).foregroundStyle(NX.danger)
                            .frame(maxWidth: .infinity, minHeight: 44)
                            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(NX.danger.opacity(0.4)))
                    }
                    .buttonStyle(.plain)
                    .padding(.top, 4)
                }
            }
            .padding(16)
            .frame(maxWidth: 760, alignment: .leading)
            .frame(maxWidth: .infinity)
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
                Text(T("Event report")).font(NXFont.display(19, .bold)).foregroundStyle(NX.foreground)
                Text(T("Fill it after every night. It goes straight into Overview, Calendar and Board."))
                    .font(NXFont.text(12)).foregroundStyle(NX.mutedFg).fixedSize(horizontal: false, vertical: true)
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

    private var saveBar: some View {
        VStack(spacing: 6) {
            if let fieldError {
                Text(fieldError).font(NXFont.text(12, .semibold)).foregroundStyle(NX.danger)
            }
            Button { Task { await save() } } label: {
                HStack(spacing: 8) {
                    if saving { ProgressView().tint(.white) }
                    Text(isNew ? T("Add event") : T("Save report"))
                }
            }
            .buttonStyle(NexusPrimaryButton())
            .disabled(saving || (!isNew && !draft.dirty))
        }
        .padding(.horizontal, 16).padding(.top, 10).padding(.bottom, 10)
        .frame(maxWidth: 760)
        .frame(maxWidth: .infinity)
        .background(.bar)
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
