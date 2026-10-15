import SwiftUI

// MARK: - Outlet Sales Dashboard: the owner's revisions after the meeting with Ryan (14 Oct 2026)
//
// Guest overview (Overview tab): RSVP total with its items, Hosting total with its items, Communities with
// each community's total (a Breakdown community opens onto its own items). Day target (Calendar tab): the
// picked day's sales and pax against its own target, or the month's target split over its days. Report
// settings: the outlet's own RSVP items, Hosting items and Communities. The server works out every number
// (lib/outlet-sales.ts); this app draws them, as the web's OutletGuests / OutletDayTarget /
// OutletReportSettings do.

// MARK: Guest overview

struct OutletGuestOverview: View {
    @Bindable var store: OutletSalesStore
    @Binding var tab: ProjectTab

    @Environment(\.horizontalSizeClass) private var hSize
    @State private var open: Set<String> = []
    private var wide: Bool { hSize == .regular }

    var body: some View {
        let monthName = OutletFormat.monthLabel(store.month)
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .firstTextBaseline) {
                Text(String(format: T("Guests · %@"), monthName))
                    .font(NXFont.display(wide ? 18 : 16, .bold)).foregroundStyle(NX.foreground)
                Spacer(minLength: 8)
                if let g = store.guests, g.reportCount > 0 {
                    Text(g.reportCount == 1 ? T("From 1 report") : String(format: T("From %d reports"), Int(g.reportCount)))
                        .font(NXFont.text(13, .medium)).foregroundStyle(NX.mutedFg)
                }
            }
            .padding(.horizontal, wide ? 20 : 14).padding(.vertical, 12)
            Divider().overlay(NX.border)
            if let g = store.guests, g.reportCount > 0 {
                if wide {
                    HStack(alignment: .top, spacing: 0) {
                        group(T("RSVP total"), g.rsvp, empty: T("No RSVP items. Add them in Report settings."))
                        Divider().overlay(NX.border)
                        group(T("Hosting total"), g.hosting, empty: T("No hosting items. Add them in Report settings."))
                        Divider().overlay(NX.border)
                        communities(g)
                    }
                    .fixedSize(horizontal: false, vertical: true)
                } else {
                    VStack(spacing: 0) {
                        group(T("RSVP total"), g.rsvp, empty: T("No RSVP items. Add them in Report settings."))
                        Divider().overlay(NX.border)
                        group(T("Hosting total"), g.hosting, empty: T("No hosting items. Add them in Report settings."))
                        Divider().overlay(NX.border)
                        communities(g)
                    }
                }
            } else {
                EmptyState(icon: "person.3",
                           title: String(format: T("No guest numbers for %@ yet"), monthName),
                           subtitle: T("They come from each night's report. Fill one in and RSVP, hosting and community totals add up here."),
                           actionTitle: T("Fill a report"),
                           actionIcon: "square.and.pencil",
                           action: fill,
                           compact: true)
                    .padding(.vertical, 18)
                    .frame(maxWidth: .infinity)
            }
        }
        .background(NX.card, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(NX.border))
    }

    /// The oldest night still owed a report, else an upcoming one, else a new event.
    private func fill() {
        let next = store.allWaiting.first ?? store.events.first { $0.status != .reported }
        store.openForm(eventId: next?.id, date: nil)
        tab = .reportForm
    }

    private func total(_ title: String, _ value: Int64) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title).font(NXFont.text(12, .medium)).foregroundStyle(NX.mutedFg)
            Text(OutletFormat.count(value)).font(NXFont.display(wide ? 26 : 24, .bold)).foregroundStyle(NX.foreground)
                .monospacedDigit()
        }
        .accessibilityElement(children: .combine)
    }

    private func group(_ title: String, _ g: OutletGuests.Bucket, empty: String) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            total(title, g.total)
            if g.items.isEmpty {
                Text(empty).font(NXFont.text(12)).foregroundStyle(NX.mutedFg).fixedSize(horizontal: false, vertical: true)
            } else {
                VStack(spacing: 10) { ForEach(g.items) { line($0, of: g.total) } }
            }
        }
        .padding(wide ? 18 : 14)
        .frame(maxWidth: .infinity, alignment: .topLeading)
    }

    private func line(_ l: OutletGuestLine, of total: Int64, inset: Bool = false) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(l.archived ? "\(l.label) · \(T("archived"))" : l.label)
                    .font(NXFont.text(14)).foregroundStyle(l.archived ? NX.mutedFg : NX.foreground).lineLimit(1)
                Spacer(minLength: 4)
                Text(OutletFormat.count(l.total)).font(NXFont.text(14, .semibold)).foregroundStyle(NX.foreground).monospacedDigit()
            }
            share(l.total, of: total)
        }
        .padding(.leading, inset ? 18 : 0)
        .accessibilityElement(children: .combine)
    }

    private func share(_ value: Int64, of total: Int64) -> some View {
        let f = total > 0 ? Double(value) / Double(total) : 0
        return GeometryReader { geo in
            ZStack(alignment: .leading) {
                Capsule().fill(NX.muted)
                // Neutral, as the web's bars (UI tour run 15, Q-IB11: purple).
                Capsule().fill(NX.foreground.opacity(0.4)).frame(width: geo.size.width * f)
            }
        }
        .frame(height: 4)
        .accessibilityHidden(true)
    }

    /// One community: the chevron's slot on every row so the names line up (F-33 / I-27); the ones that
    /// open draw it. Same height and text colour for both kinds.
    private func communityRow(_ c: OutletGuestCommunity, expandable: Bool) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 6) {
            Image(systemName: "chevron.right").font(.system(size: 11, weight: .semibold))
                .foregroundStyle(NX.violetText)
                .rotationEffect(.degrees(open.contains(c.id) ? 90 : 0))
                .frame(width: 12)
                .opacity(expandable ? 1 : 0)
                .accessibilityHidden(true)
            Text(c.archived ? "\(c.name) · \(T("archived"))" : c.name)
                .font(NXFont.text(14)).foregroundStyle(c.archived ? NX.mutedFg : NX.foreground).lineLimit(1)
            Spacer(minLength: 4)
            Text(OutletFormat.count(c.total)).font(NXFont.text(14, .semibold)).foregroundStyle(NX.foreground)
                .monospacedDigit()
        }
        // The same height as the RSVP and Hosting rows beside it: a 32 pt row sat Run Club ~10 pt lower than
        // their first rows (UI tour run 15, Q-IB11).
        .contentShape(Rectangle())
    }

    private func communities(_ g: OutletGuests) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            total(T("Communities total"), g.communities.total)
            if g.communities.items.isEmpty {
                Text(T("No communities yet. Add the ones that come in Report settings."))
                    .font(NXFont.text(12)).foregroundStyle(NX.mutedFg).fixedSize(horizontal: false, vertical: true)
            } else {
                VStack(spacing: 10) {
                    ForEach(g.communities.items) { c in
                        let expandable = c.mode == "breakdown" && !c.items.isEmpty
                        VStack(alignment: .leading, spacing: 4) {
                            // A Total-only community is a plain row, not a disabled button: a disabled
                            // button greys its label, so "Run Club" read as switched off (run 14, N-27).
                            if expandable {
                                Button {
                                    withAnimation(.easeOut(duration: 0.18)) {
                                        if open.contains(c.id) { open.remove(c.id) } else { open.insert(c.id) }
                                    }
                                } label: {
                                    communityRow(c, expandable: true)
                                }
                                .buttonStyle(.plain)
                            } else {
                                communityRow(c, expandable: false)
                                    .accessibilityElement(children: .combine)
                            }
                            share(c.total, of: g.communities.total)
                            if expandable && open.contains(c.id) {
                                VStack(spacing: 8) { ForEach(c.items) { line($0, of: c.total, inset: true) } }
                                    .padding(.top, 6)
                            }
                        }
                    }
                }
            }
        }
        .padding(wide ? 18 : 14)
        .frame(maxWidth: .infinity, alignment: .topLeading)
    }
}

// MARK: Day target (Calendar)

struct OutletDayTargetCard: View {
    @Bindable var store: OutletSalesStore
    let day: String

    @State private var editing = false
    @State private var salesText = ""
    @State private var paxText = ""
    @State private var saving = false

    var body: some View {
        if let info = store.day(day) {
            VStack(alignment: .leading, spacing: 12) {
                HStack {
                    Label(T("Day target"), systemImage: "target")
                        .font(NXFont.text(13, .bold)).foregroundStyle(NX.foreground)
                    Spacer(minLength: 4)
                    if store.canManageTargets && !editing {
                        Button(store.ownTarget(day) != nil ? T("Change day target") : T("Set day target")) { start() }
                            .font(NXFont.text(13, .semibold)).foregroundStyle(NX.violetText)
                            .frame(minHeight: 40)
                    }
                }
                if editing { editor } else {
                    metric(T("Sales"), info.sales, info.salesTarget, info.salesPct, info.salesTargetSource, money: true)
                    metric(T("Pax"), info.pax, info.paxTarget, info.paxPct, info.paxTargetSource, money: false)
                }
            }
            .padding(14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(NX.card, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(NX.border))
            .onChange(of: day) { _, _ in editing = false }
        }
    }

    private func sourceText(_ source: String?) -> String {
        switch source {
        case "day": return T("Own target")
        case "month": return T("Month's target ÷ days")
        default: return T("No target")
        }
    }

    private func metric(_ label: String, _ actual: Int64?, _ target: Int64?, _ pct: Int64?, _ source: String?, money: Bool) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .firstTextBaseline) {
                Text(label).font(NXFont.text(12, .semibold)).foregroundStyle(NX.mutedFg)
                Spacer(minLength: 4)
                Text(sourceText(source)).font(NXFont.text(11)).foregroundStyle(NX.mutedFg)
            }
            Text(OutletFormat.vsTarget(actual, target, pct, money: money))
                .font(NXFont.text(15, .semibold)).foregroundStyle(NX.foreground).monospacedDigit()
                .lineLimit(1).minimumScaleFactor(0.7)
            if target != nil { OutletMeter(pct: pct, height: 6) }
        }
        .accessibilityElement(children: .combine)
    }

    /// What an empty box falls back to: the month's target split over its days.
    private func share(_ monthly: Int64?) -> String {
        guard let monthly, let p = OutletFormat.parts(day + "") else { return T("No target") }
        var c = Calendar(identifier: .gregorian)
        c.timeZone = TimeZone(identifier: "UTC")!
        let days = c.range(of: .day, in: .month, for: c.date(from: DateComponents(year: p.y, month: p.m, day: 1)) ?? Date())?.count ?? 30
        return OutletFormat.grouped(Int64((Double(monthly) / Double(days)).rounded()))
    }

    @ViewBuilder private var editor: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(T("Sales target")).font(NXFont.text(12, .semibold)).foregroundStyle(NX.foreground)
            OutletNumberField(text: $salesText, money: true, placeholder: share(store.target?.salesTarget))
        }
        VStack(alignment: .leading, spacing: 6) {
            Text(T("Pax target")).font(NXFont.text(12, .semibold)).foregroundStyle(NX.foreground)
            OutletNumberField(text: $paxText, money: false, placeholder: share(store.target?.paxTarget))
        }
        Text(T("Fill sales, pax or both. An empty box uses the month's target split over its days."))
            .font(NXFont.text(11)).foregroundStyle(NX.mutedFg).fixedSize(horizontal: false, vertical: true)
        HStack(spacing: 10) {
            Button {
                Task {
                    saving = true
                    let ok = await store.setDayTarget(date: day, sales: OutletFormat.parse(salesText), pax: OutletFormat.parse(paxText))
                    saving = false
                    if ok { editing = false }
                }
            } label: {
                HStack(spacing: 6) { if saving { ProgressView().tint(.white) }; Text(T("Save target")) }
            }
            .buttonStyle(NexusPrimaryButton(fullWidth: false))
            .disabled(saving)
            Button(T("Cancel")) { editing = false }
                .font(NXFont.text(14, .semibold)).foregroundStyle(NX.mutedFg)
                .frame(minHeight: 44)
        }
    }

    private func start() {
        let own = store.ownTarget(day)
        salesText = own?.salesTarget.map(OutletFormat.grouped) ?? ""
        paxText = own?.paxTarget.map(OutletFormat.grouped) ?? ""
        editing = true
    }
}

// MARK: Report settings

/// A removal waiting for its answer: the item holds figures in `reports` reports, so it is archived.
private struct OutletPendingArchive: Identifiable {
    let id = UUID()
    let name: String
    let reports: Int64
    let apply: () -> Void
}

struct OutletReportSettingsView: View {
    @Bindable var store: OutletSalesStore

    @Environment(\.dismiss) private var dismiss
    @State private var loaded: OutletConfigResponse?
    @State private var draft: OutletReportConfig?
    @State private var loadFailed = false
    @State private var saving = false
    @State private var error: String?
    @State private var pending: OutletPendingArchive?
    @State private var confirmDiscard = false
    @State private var newRsvp = ""
    @State private var newHosting = ""
    @State private var newCommunity = ""
    @State private var newSub: [String: String] = [:]

    private var dirty: Bool { draft != nil && draft != loaded?.config }
    @Environment(\.horizontalSizeClass) private var hSize

    var body: some View {
        NavigationStack {
            Group {
                if let binding = Binding($draft) {
                    form(binding)
                } else if loadFailed {
                    EmptyState(icon: "wifi.exclamationmark", title: T("The settings didn't load. Check your connection, then try again."),
                               actionTitle: T("Try again"), actionIcon: "arrow.clockwise", action: { Task { await load() } })
                } else {
                    ProgressView().tint(NX.violetText).frame(maxWidth: .infinity, maxHeight: .infinity)
                }
            }
            .navigationTitle(T("Report settings"))
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
            // iPad / Mac: the web drawer's "Cancel" and "Save settings" at the bottom, instead of a greyed
            // Save in the title bar (UI tour run 16, R16-M-15).
            .safeAreaInset(edge: .bottom, spacing: 0) {
                if hSize == .regular && draft != nil {
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
        .alert(alertTitle, isPresented: Binding(get: { pending != nil || confirmDiscard || error != nil },
                                                set: { if !$0 { pending = nil; confirmDiscard = false; error = nil } })) {
            if let p = pending {
                Button(T("Cancel"), role: .cancel) { pending = nil }
                Button(T("Archive")) { p.apply(); pending = nil }
            } else if confirmDiscard {
                Button(T("Keep editing"), role: .cancel) { confirmDiscard = false }
                Button(T("Discard"), role: .destructive) { confirmDiscard = false; dismiss() }
            } else {
                Button("OK") { error = nil }
            }
        } message: {
            if let p = pending {
                Text(p.reports == 1
                     ? T("1 report has figures for it. It leaves the form, and that report keeps its numbers and totals. You can restore it later.")
                     : String(format: T("%d reports have figures for it. It leaves the form, and those reports keep their numbers and totals. You can restore it later."), Int(p.reports)))
            } else if confirmDiscard {
                Text(T("The report settings stay as they were."))
            }
        }
    }

    private var alertTitle: String {
        if let p = pending { return String(format: T("Archive %@?"), p.name) }
        if confirmDiscard { return T("Discard the changes you haven't saved?") }
        return error ?? ""
    }

    private func load() async {
        loadFailed = false
        do {
            let r = try await APIClient.shared.outletConfig(projectId: store.projectId)
            loaded = r
            if draft == nil { draft = r.config }
        } catch {
            loadFailed = true
        }
    }

    private func save() async {
        guard let draft else { return }
        saving = true
        defer { saving = false }
        do {
            let r = try await APIClient.shared.outletSaveConfig(projectId: store.projectId, config: draft)
            loaded = r
            self.draft = r.config
            store.notice = T("Report settings saved. The form uses them from now on.")
            await store.load()
            dismiss()
        } catch APIError.http(_, let message) {
            error = (message?.isEmpty == false) ? message : T("The settings weren't saved. Try again.")
        } catch {
            self.error = T("The settings weren't saved. Try again.")
        }
    }

    private func used(_ ids: [String]) -> Int64 {
        ids.compactMap { loaded?.usage[$0] }.max() ?? 0
    }

    /// Remove: archived (after asking) when reports hold figures for it, else simply gone.
    private func remove(_ name: String, ids: [String], archive: @escaping () -> Void, drop: () -> Void) {
        let n = used(ids.filter { !$0.isEmpty })
        if n > 0 { pending = OutletPendingArchive(name: name, reports: n, apply: archive) } else { drop() }
    }

    // MARK: the form

    private func form(_ cfg: Binding<OutletReportConfig>) -> some View {
        List {
            Section {
                Text(T("What this outlet's team reports after each night. Renaming keeps every figure; past reports never change."))
                    .font(NXFont.text(13)).foregroundStyle(NX.mutedFg)
                    .listRowBackground(Color.clear)
            }
            itemSection(T("RSVP items"), footer: T("RSVP total is the sum of these."), items: cfg.rsvp, newText: $newRsvp, addLabel: T("Add RSVP item"))
            itemSection(T("Hosting items"), footer: T("Hosting total is the sum of these."), items: cfg.hosting, newText: $newHosting, addLabel: T("Add hosting item"))
            communitySections(cfg.communities)
        }
        .listStyle(.insetGrouped)
        // One even gap between the item cards and the communities (run 14, P-M21: the default spacing
        // left wide, uneven bands on a Mac).
        .listSectionSpacing(.compact)
        // The intro sits right under the bar, not below an empty band (run 14, P-M21).
        .contentMargins(.top, 8, for: .scrollContent)
        // The sheet goes on below its edge (Communities): the indicator shows once (I-5), and on an iPad /
        // Mac the sheet is page sized (see `tallSheet`), so Communities start inside the first screen.
        .scrollIndicatorsFlash(onAppear: true)
        .scrollDismissesKeyboard(.interactively)
    }

    /// A row's label by its stable row id, never by index: a row removed mid-edit can't trap.
    private func label(_ items: Binding<[OutletItem]>, _ rowId: String) -> Binding<String> {
        Binding(get: { items.wrappedValue.first { $0.rowId == rowId }?.label ?? "" },
                set: { v in if let k = items.wrappedValue.firstIndex(where: { $0.rowId == rowId }) { items.wrappedValue[k].label = String(v.prefix(60)) } })
    }

    private func setArchived(_ items: Binding<[OutletItem]>, _ rowId: String, _ on: Bool) {
        if let k = items.wrappedValue.firstIndex(where: { $0.rowId == rowId }) { items.wrappedValue[k].archived = on }
    }

    /// Insert a new item after the last active one (archived ones stay at the end).
    private func append(_ items: Binding<[OutletItem]>, _ text: String) {
        let at = (items.wrappedValue.lastIndex { !$0.archived }).map { $0 + 1 } ?? 0
        items.wrappedValue.insert(OutletItem(id: "", label: text), at: at)
    }

    @ViewBuilder
    private func itemRows(_ items: Binding<[OutletItem]>, newText: Binding<String>, addLabel: String, inset: CGFloat = 0) -> some View {
        let active = items.wrappedValue.filter { !$0.archived }
        let archived = items.wrappedValue.filter(\.archived)
        // ↑ ↓ and a trash can on every row, the same controls as the communities and the web (UI tour run 15,
        // Q-IB12: drag handles and red minus buttons for items, arrows for communities, in one sheet).
        ForEach(Array(active.enumerated()), id: \.element.rowId) { pos, item in
            HStack(spacing: 14) {
                TextField(T("Item name"), text: label(items, item.rowId))
                    .font(NXFont.text(15))
                    .submitLabel(.done)
                Button { moveItem(items, item.rowId, by: -1) } label: { Label(T("Move up"), systemImage: "arrow.up") }
                    .disabled(pos == 0)
                Button { moveItem(items, item.rowId, by: 1) } label: { Label(T("Move down"), systemImage: "arrow.down") }
                    .disabled(pos == active.count - 1)
                Button(role: .destructive) {
                    remove(item.label, ids: [item.id],
                           archive: { setArchived(items, item.rowId, true) },
                           drop: { items.wrappedValue.removeAll { $0.rowId == item.rowId } })
                } label: { Label(T("Remove"), systemImage: "trash") }
            }
            .labelStyle(.iconOnly)
            .buttonStyle(.borderless)
            // Grey controls, as the web's (UI tour run 16, R16-B-18: purple arrows, red trash).
            .foregroundStyle(NX.mutedFg)
            .tint(NX.mutedFg)
            .padding(.leading, inset)
            // Only the separator under a row: a reordered row kept a full-width top line too, so
            // "Hosting Team" showed two lines (UI tour run 13 F-23 / run 14 N-29).
            .listRowSeparator(.hidden, edges: .top)
        }
        addRow(newText, label: addLabel) { append(items, $0) }
            .padding(.leading, inset)
            .listRowSeparator(.hidden, edges: .top)
        ForEach(archived, id: \.rowId) { item in
            archivedRow(item.label) { setArchived(items, item.rowId, false) }
                .padding(.leading, inset)
                .listRowSeparator(.hidden, edges: .top)
        }
    }

    private func itemSection(_ title: String, footer: String, items: Binding<[OutletItem]>, newText: Binding<String>, addLabel: String) -> some View {
        // The helper line under the heading, as the web's ("RSVP total is the sum of these."), not under the card
        // (UI tour run 16, R16-B-18).
        Section {
            itemRows(items, newText: newText, addLabel: addLabel)
        } header: {
            OutletSettingsHeading(title: title, helper: footer)
        }
    }


    private func addRow(_ text: Binding<String>, label: String, add: @escaping (String) -> Void) -> some View {
        HStack(spacing: 10) {
            Image(systemName: "plus.circle.fill").foregroundStyle(NX.violetText)
            TextField(label, text: text)
                .font(NXFont.text(15))
                .submitLabel(.done)
                .onSubmit { commit(text, add) }
            if !text.wrappedValue.trimmingCharacters(in: .whitespaces).isEmpty {
                Button(T("Add")) { commit(text, add) }.font(NXFont.text(14, .semibold)).buttonStyle(.borderless)
            }
        }
    }

    private func commit(_ text: Binding<String>, _ add: (String) -> Void) {
        let label = text.wrappedValue.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !label.isEmpty else { return }
        add(String(label.prefix(60)))
        text.wrappedValue = ""
    }

    private func archivedRow(_ label: String, restore: @escaping () -> Void) -> some View {
        HStack {
            Text("\(label) · \(T("archived"))").font(NXFont.text(14)).foregroundStyle(NX.mutedFg).lineLimit(1)
            Spacer(minLength: 8)
            Button { restore() } label: { Label(T("Restore"), systemImage: "arrow.uturn.backward") }
                .font(NXFont.text(13, .semibold)).buttonStyle(.borderless)
        }
    }

    /// A community by its stable row id (see `label`).
    private func community(_ list: Binding<[OutletCommunity]>, _ rowId: String) -> Binding<OutletCommunity> {
        Binding(get: { list.wrappedValue.first { $0.rowId == rowId } ?? OutletCommunity(id: "", name: "", mode: "total", items: []) },
                set: { v in if let k = list.wrappedValue.firstIndex(where: { $0.rowId == rowId }) { list.wrappedValue[k] = v } })
    }

    @ViewBuilder private func communitySections(_ list: Binding<[OutletCommunity]>) -> some View {
        let active = list.wrappedValue.filter { !$0.archived }
        let archived = list.wrappedValue.filter(\.archived)
        ForEach(Array(active.enumerated()), id: \.element.rowId) { pos, item in
            let c = community(list, item.rowId)
            Section {
                // The name with its order and remove controls on one row: on their own row under the picker
                // they left an empty band in every community card (run 14, P-M21).
                HStack(spacing: 14) {
                    TextField(T("Community name"), text: Binding(get: { c.wrappedValue.name }, set: { c.wrappedValue.name = String($0.prefix(60)) }))
                        .font(NXFont.text(15, .semibold))
                    Button { moveCommunity(list, item.rowId, by: -1) } label: { Label(T("Move up"), systemImage: "arrow.up") }
                        .disabled(pos == 0)
                    Button { moveCommunity(list, item.rowId, by: 1) } label: { Label(T("Move down"), systemImage: "arrow.down") }
                        .disabled(pos == active.count - 1)
                    Button(role: .destructive) {
                        remove(item.name, ids: [item.id] + item.items.map(\.id),
                               archive: { c.wrappedValue.archived = true },
                               drop: { list.wrappedValue.removeAll { $0.rowId == item.rowId } })
                    } label: { Label(T("Remove"), systemImage: "trash") }
                }
                .labelStyle(.iconOnly)
                .buttonStyle(.borderless)
                .foregroundStyle(NX.mutedFg)
                .tint(NX.mutedFg)
                .font(NXFont.text(15, .semibold))
                // Inline with its label, as the web's, not a full-width row (UI tour run 16, R16-B-18).
                HStack(spacing: 10) {
                    Text(T("How it is counted")).font(NXFont.text(13)).foregroundStyle(NX.mutedFg)
                    Spacer(minLength: 8)
                    Picker(T("How it is counted"), selection: c.mode) {
                        Text(T("Total only")).tag("total")
                        Text(T("Breakdown")).tag("breakdown")
                    }
                    .pickerStyle(.segmented)
                    .labelsHidden()
                    .fixedSize()
                }
                if item.isBreakdown {
                    itemRows(c.items,
                             newText: Binding(get: { newSub[item.rowId] ?? "" }, set: { newSub[item.rowId] = $0 }),
                             addLabel: String(format: T("Add item to %@"), item.name.isEmpty ? T("this community") : item.name))
                }
            } header: {
                if pos == 0 {
                    OutletSettingsHeading(title: T("Communities"), helper: T("The communities that came. Each counts one number, or its own items."))
                }
            }
        }
        Section {
            addRow($newCommunity, label: T("Add community")) { name in
                let at = (list.wrappedValue.lastIndex { !$0.archived }).map { $0 + 1 } ?? 0
                list.wrappedValue.insert(OutletCommunity(id: "", name: name, mode: "total", items: []), at: at)
            }
            ForEach(archived, id: \.rowId) { c in
                archivedRow(c.name) { community(list, c.rowId).wrappedValue.archived = false }
            }
        } header: {
            if active.isEmpty {
                OutletSettingsHeading(title: T("Communities"), helper: T("The communities that came. Each counts one number, or its own items."))
            }
        }
    }

    /// Swap a community with its active neighbour above or below.
    /// One step up or down among the active items (archived ones stay at the end).
    private func moveItem(_ items: Binding<[OutletItem]>, _ rowId: String, by: Int) {
        let active = items.wrappedValue.indices.filter { !items.wrappedValue[$0].archived }
        guard let pos = active.firstIndex(where: { items.wrappedValue[$0].rowId == rowId }), active.indices.contains(pos + by) else { return }
        items.wrappedValue.swapAt(active[pos], active[pos + by])
    }

    private func moveCommunity(_ list: Binding<[OutletCommunity]>, _ rowId: String, by: Int) {
        let active = list.wrappedValue.indices.filter { !list.wrappedValue[$0].archived }
        guard let pos = active.firstIndex(where: { list.wrappedValue[$0].rowId == rowId }), active.indices.contains(pos + by) else { return }
        list.wrappedValue.swapAt(active[pos], active[pos + by])
    }
}


extension View {
    /// A settings sheet with a long form: page sized on an iPad / Mac (iOS 18+), so the form sheet's fixed
    /// height doesn't end the visible part halfway (run 14, P-I3 Communities, P-I31 Add platform).
    @ViewBuilder func tallSheet() -> some View {
        if #available(iOS 18.0, *) {
            self.presentationSizing(.page)
        } else {
            self.presentationDetents([.large])
        }
    }
}


/// A settings section's heading with its helper line right under it, as the web's (UI tour run 16, R16-B-18).
struct OutletSettingsHeading: View {
    let title: String
    let helper: String
    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(title)
            Text(helper).font(NXFont.text(12)).foregroundStyle(NX.mutedFg).textCase(nil)
                .fixedSize(horizontal: false, vertical: true)
        }
    }
}
