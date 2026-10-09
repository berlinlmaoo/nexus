import SwiftUI

// MARK: - One Pipeline Dashboard deal (owner, 9 Oct 2026)
//
// The web's DealDrawer as a sheet: every field of the deal, grouped by the division that owns it — the
// GM's sections (Commercial & pipeline · Contract · Vendor registration · Readiness & deliverable ·
// Billing & payment · Closing · Follow-up & notes · Documents & links). Each field saves on its own
// when it is left or picked (one PATCH, one line in History), so nobody loses an edit to a forgotten
// Save button and two divisions editing different fields never overwrite each other.
//
// The deal is read from the shared PipelineStore, so an edit made here, on the web, or by a colleague
// (realtime) shows at once. Delete asks first with a centred alert (never a confirmationDialog) and can
// be undone from Control Room → Audit.

struct PipelineDealView: View {
    let store: PipelineStore
    let dealId: String

    @Environment(\.dismiss) private var dismiss
    @Environment(\.horizontalSizeClass) private var hSize
    @State private var showHistory = false
    @State private var confirmDelete = false
    @State private var history: [PipelineChange] = []
    @State private var historyLoaded = false
    @State private var historyFailed = false

    private var wide: Bool { hSize == .regular }

    var body: some View {
        NavigationStack {
            Group {
                if let deal = store.deal(dealId) {
                    ScrollView {
                        VStack(alignment: .leading, spacing: 16) {
                            head(deal)
                            if showHistory { historyList(deal) } else { details(deal) }
                        }
                        .padding(16)
                        .frame(maxWidth: 820, alignment: .leading)
                        .frame(maxWidth: .infinity)
                    }
                    .safeAreaInset(edge: .bottom, spacing: 0) { footer(deal) }
                } else {
                    // Gone (deleted here or elsewhere): the sheet closes itself below.
                    ProgressView().tint(NX.violetText).frame(maxWidth: .infinity, maxHeight: .infinity)
                }
            }
            .background(NX.background.ignoresSafeArea())
            .navigationTitle(store.deal(dealId)?.code ?? "")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) { Button(T("Done")) { dismiss() } }
            }
            .keyboardDoneBar()
        }
        .task(id: "\(store.revision)-\(showHistory)") {
            if showHistory { await loadHistory() }
        }
        .onChange(of: store.deal(dealId) == nil) { _, gone in
            if gone && store.loaded { dismiss() }
        }
        // One alert for this sheet: the delete question, or a refused edit in the server's words.
        .alert(alertTitle, isPresented: Binding(
            get: { confirmDelete || store.actionError != nil },
            set: { if !$0 { confirmDelete = false; store.actionError = nil } })) {
            if confirmDelete {
                Button(T("Cancel"), role: .cancel) { confirmDelete = false }
                Button(T("Delete deal"), role: .destructive) {
                    confirmDelete = false
                    Task { _ = await store.delete(dealId) }
                }
            } else {
                Button("OK") { store.actionError = nil }
            }
        } message: {
            if confirmDelete {
                Text(T("It leaves the pipeline for everyone. Control Room → Audit can bring it back with its history."))
            }
        }
    }

    private var alertTitle: String {
        if confirmDelete {
            let name = store.deal(dealId)?.name ?? ""
            return String(format: T("Delete %@?"), name.isEmpty ? T("Untitled deal") : name)
        }
        return store.actionError ?? ""
    }

    private func patch(_ fields: [String: Any]) {
        Task { await store.patch(dealId, fields) }
    }

    // MARK: head

    private func head(_ deal: PipelineDeal) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 8) {
                Text(deal.code).font(NXFont.text(12, .semibold)).foregroundStyle(NX.mutedFg).monospacedDigit()
                Text(PipelineText.stage(deal.stage)).font(NXFont.text(12)).foregroundStyle(NX.mutedFg)
                Spacer(minLength: 4)
                if deal.health.key != "NONE" { PipelineHealthPill(key: deal.health.key) }
            }
            PipelineTextInput(label: T("Deal name"), value: deal.name, required: true, large: true,
                              placeholder: T("Deal name")) { patch(["name": $0]) }
            Picker("", selection: $showHistory) {
                Text(T("Details")).tag(false)
                Text(T("History")).tag(true)
            }
            .pickerStyle(.segmented)
            .frame(maxWidth: 320)
            .accessibilityLabel(T("Deal"))
        }
    }

    // MARK: details

    @ViewBuilder private func details(_ deal: PipelineDeal) -> some View {
        let v = store.vocab
        if !deal.health.reasons.isEmpty {
            PipelineReasonList(health: deal.health)
        }
        if !deal.phases.isEmpty { phaseProgress(deal) }

        PipelineSection(title: T("Commercial & pipeline"), owner: T("BD / account")) {
            PipelineFieldBox(T("Brand / client")) {
                PipelineTextInput(label: T("Brand / client"), value: deal.brand) { patch(["brand": $0]) }
            }
            PipelineFieldBox(T("Service")) {
                PipelineMenuInput(label: T("Service"), value: deal.service, options: v.services) { patch(["service": $0]) }
            }
            PipelineFieldBox(T("BD / account owner")) {
                PipelinePersonInput(label: T("BD / account owner"), userId: deal.bdUserId, name: deal.bdName, person: deal.bd,
                                    people: store.people) { uid, name in
                    patch(["bdUserId": jsonOrNull(uid), "bdName": jsonOrNull(name)])
                }
            }
            PipelineFieldBox("PM") {
                PipelinePersonInput(label: "PM", userId: deal.pmUserId, name: deal.pmName, person: deal.pm,
                                    people: store.people) { uid, name in
                    patch(["pmUserId": jsonOrNull(uid), "pmName": jsonOrNull(name)])
                }
            }
            PipelineFieldBox(T("Stage")) {
                PipelineMenuInput(label: T("Stage"), value: deal.stage, options: v.stages, text: PipelineText.stage) { patch(["stage": $0]) }
            }
            PipelineFieldBox(T("Probability")) {
                PipelineMenuInput(label: T("Probability"), value: String(deal.probability), options: v.probabilities.map { String($0) },
                                  text: { PipelineFormat.pct(Double($0) ?? 0) }) { picked in
                    if let p = Double(picked) { patch(["probability": p]) }
                }
            }
            PipelineFieldBox(T("Contract value")) {
                PipelineMoneyInput(label: T("Contract value"), value: deal.contractValue) { patch(["contractValue": $0]) }
            }
            PipelineFieldBox(T("Net project value")) {
                PipelineMoneyInput(label: T("Net project value"), value: deal.netValue) { patch(["netValue": $0]) }
            }
            PipelineFieldBox(T("Event / main date")) {
                PipelineDateInput(label: T("Event / main date"), value: deal.mainDate) { patch(["mainDate": jsonOrNull($0)]) }
            }
        }

        PipelineSection(title: T("Contract"), owner: "Legal") {
            PipelineFieldBox(T("Contract status")) {
                PipelineMenuInput(label: T("Contract status"), value: deal.contractStatus, options: v.contractStatuses) { patch(["contractStatus": $0]) }
            }
        }

        PipelineSection(title: T("Vendor registration"), owner: T("PM / admin")) {
            PipelineFieldBox(T("Vendor registration")) {
                PipelineMenuInput(label: T("Vendor registration"), value: deal.vregStatus, options: v.vregStatuses) { patch(["vregStatus": $0]) }
            }
        }

        PipelineSection(title: T("Readiness & deliverable"), owner: "PM") {
            PipelineFieldBox(T("Execution readiness")) {
                PipelineMenuInput(label: T("Execution readiness"), value: deal.readiness, options: v.readiness) { patch(["readiness": $0]) }
            }
            PipelineFieldBox(T("Deliverable status")) {
                PipelineMenuInput(label: T("Deliverable status"), value: deal.deliverableStatus, options: v.deliverableStatuses) { patch(["deliverableStatus": $0]) }
            }
            PipelineFieldBox(T("Deliverable risk")) {
                PipelineMenuInput(label: T("Deliverable risk"), value: deal.deliverableRisk, options: v.deliverableRisks,
                                  text: PipelineText.risk) { patch(["deliverableRisk": $0]) }
            }
        }

        PipelineSection(title: T("Billing & payment"), owner: "Finance") {
            PipelineFieldBox(T("Invoice value")) {
                PipelineMoneyInput(label: T("Invoice value"), value: deal.invoiceValue) { patch(["invoiceValue": $0]) }
            }
            PipelineFieldBox(T("Payment status")) {
                PipelineMenuInput(label: T("Payment status"), value: deal.paymentStatus, options: v.paymentStatuses) { patch(["paymentStatus": $0]) }
            }
            PipelineFieldBox(T("Outstanding receivable")) {
                PipelineMoneyInput(label: T("Outstanding receivable"), value: deal.outstandingReceivable) { patch(["outstandingReceivable": $0]) }
            }
            PipelineFieldBox(T("Payment due date")) {
                PipelineDateInput(label: T("Payment due date"), value: deal.paymentDueDate) { patch(["paymentDueDate": jsonOrNull($0)]) }
            }
            // With a due date the server counts the days itself (a typed number is wrong the next
            // morning); the typed number stays for rows without one, as in the GM's sheet.
            if deal.paymentDueDate != nil {
                PipelineFieldBox(T("Days overdue")) {
                    Text(deal.daysOverdue > 0 ? String(format: T("%d days, counted from the due date"), deal.daysOverdue) : T("Not overdue"))
                        .font(NXFont.text(14)).foregroundStyle(deal.daysOverdue > 7 ? ChipTone.danger.fg : NX.foreground)
                        .monospacedDigit()
                        .frame(maxWidth: .infinity, minHeight: 40, alignment: .leading)
                }
            } else {
                PipelineFieldBox(T("Days overdue (typed)")) {
                    PipelineDaysInput(label: T("Days overdue (typed)"), value: deal.maxDaysOverdue) { patch(["maxDaysOverdue": $0]) }
                }
            }
            PipelineFieldBox(T("Net cash position")) {
                PipelineMoneyInput(label: T("Net cash position"), value: deal.netCash, allowNegative: true) { patch(["netCash": $0]) }
            }
        }

        PipelineSection(title: T("Closing"), owner: "PM") {
            PipelineFieldBox(T("Closing status")) {
                PipelineMenuInput(label: T("Closing status"), value: deal.closingStatus, options: v.closingStatuses) { patch(["closingStatus": $0]) }
            }
        }

        PipelineSection(title: T("Follow-up & notes"), owner: T("Every division")) {
            PipelineFieldBox(T("Next action")) {
                PipelineTextInput(label: T("Next action"), value: deal.nextAction) { patch(["nextAction": $0]) }
            }
            PipelineFieldBox(T("Next action date")) {
                PipelineDateInput(label: T("Next action date"), value: deal.nextActionDate) { patch(["nextActionDate": jsonOrNull($0)]) }
            }
            PipelineFieldBox(T("Blocker / issue")) {
                PipelineTextInput(label: T("Blocker / issue"), value: deal.blocker, multiline: true) { patch(["blocker": $0]) }
            }
            PipelineFieldBox(T("Notes")) {
                PipelineTextInput(label: T("Notes"), value: deal.notes, multiline: true) { patch(["notes": $0]) }
            }
        }

        PipelineSection(title: T("Documents & links"), owner: T("Every division"), columns: 1) {
            PipelineLinksEditor(links: deal.links, linkTypes: v.linkTypes) { links in
                patch(["links": links.map(\.json)])
            }
        }
    }

    private func phaseProgress(_ deal: PipelineDeal) -> some View {
        LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 8, alignment: .top), count: wide ? 6 : 3),
                  alignment: .leading, spacing: 12) {
            ForEach(Array(deal.phases.enumerated()), id: \.offset) { _, p in
                VStack(alignment: .leading, spacing: 4) {
                    Capsule().fill(PipelineStyle.phaseTone(p.state)).frame(height: 5)
                    Text(PipelineText.phase(p.key)).font(NXFont.text(12, .semibold)).foregroundStyle(NX.foreground).lineLimit(1)
                    Text(PipelineText.phaseState(p.state)).font(NXFont.text(11)).foregroundStyle(NX.mutedFg).lineLimit(1)
                }
                .accessibilityElement(children: .combine)
            }
        }
        .accessibilityLabel(T("Phase progress"))
    }

    // MARK: footer

    private func footer(_ deal: PipelineDeal) -> some View {
        HStack(spacing: 10) {
            Text(lastUpdated(deal)).font(NXFont.text(11)).foregroundStyle(NX.mutedFg).lineLimit(2)
            Spacer(minLength: 8)
            Button(role: .destructive) { confirmDelete = true } label: {
                Label(T("Delete"), systemImage: "trash")
                    .font(NXFont.text(13, .semibold)).foregroundStyle(ChipTone.danger.fg)
                    .padding(.horizontal, 12).frame(minHeight: 40)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
        }
        .padding(.horizontal, 16).padding(.vertical, 6)
        .background(NX.card)
        .overlay(alignment: .top) { Rectangle().fill(NX.border).frame(height: 0.5) }
    }

    private func lastUpdated(_ deal: PipelineDeal) -> String {
        let when = PipelineFormat.stamp(deal.updatedAt)
        if let name = deal.updatedBy?.name, !name.isEmpty {
            return String(format: T("Last updated by %@, %@"), name, when)
        }
        return String(format: T("Last updated %@"), when)
    }

    // MARK: history

    private func loadHistory() async {
        do {
            let detail = try await store.history(dealId)
            history = detail.history
            historyFailed = false
        } catch {
            if !historyLoaded { historyFailed = true }
        }
        historyLoaded = true
    }

    @ViewBuilder private func historyList(_ deal: PipelineDeal) -> some View {
        if !historyLoaded {
            ProgressView().tint(NX.violetText).frame(maxWidth: .infinity).padding(.vertical, 30)
        } else if historyFailed {
            Text(T("The history didn't load. Close the deal and open it again."))
                .font(NXFont.text(13)).foregroundStyle(ChipTone.danger.fg)
        } else {
            VStack(alignment: .leading, spacing: 14) {
                ForEach(history) { h in historyRow(h) }
                HStack(alignment: .top, spacing: 10) {
                    Circle().fill(NX.border).frame(width: 8, height: 8).padding(.horizontal, 9).padding(.top, 5)
                    Text(created(deal)).font(NXFont.text(12)).foregroundStyle(NX.mutedFg)
                }
            }
        }
    }

    private func historyRow(_ h: PipelineChange) -> some View {
        HStack(alignment: .top, spacing: 10) {
            AvatarView(url: h.user?.avatar, initial: h.user?.initial ?? "?", size: 26)
            VStack(alignment: .leading, spacing: 3) {
                Text("\(h.user?.name ?? T("Someone")) \(T("changed")) \(PipelineText.field(h.field))")
                    .font(NXFont.text(13, .semibold)).foregroundStyle(NX.foreground)
                    .fixedSize(horizontal: false, vertical: true)
                if h.field == "notes" {
                    Text(shown(h.field, h.after)).font(NXFont.text(12)).foregroundStyle(NX.mutedFg).lineLimit(3)
                } else {
                    HStack(alignment: .firstTextBaseline, spacing: 6) {
                        Text(shown(h.field, h.before)).strikethrough(true, color: NX.mutedFg.opacity(0.6))
                            .foregroundStyle(NX.mutedFg)
                        Image(systemName: "arrow.right").font(.system(size: 10, weight: .bold)).foregroundStyle(NX.mutedFg)
                            .accessibilityLabel(T("to"))
                        Text(shown(h.field, h.after)).foregroundStyle(NX.foreground)
                    }
                    .font(NXFont.text(12))
                }
                Text(PipelineFormat.stamp(h.createdAt)).font(NXFont.text(11)).foregroundStyle(NX.mutedFg)
            }
            Spacer(minLength: 0)
        }
    }

    private func created(_ deal: PipelineDeal) -> String {
        let when = PipelineFormat.day(deal.createdAt)
        if let name = deal.createdBy?.name, !name.isEmpty { return String(format: T("Created by %@, %@"), name, when) }
        return String(format: T("Created %@"), when)
    }

    /// A value from the history as people read it: rupiah, dates, percentages, names, stage labels.
    private func shown(_ field: String, _ value: AuditJSON?) -> String {
        guard let value else { return T("empty") }
        switch value {
        case .null: return T("empty")
        case .string(let s):
            if s.isEmpty { return T("empty") }
            switch field {
            case "paymentDueDate", "mainDate", "nextActionDate": return PipelineFormat.day(s)
            case "bdUserId", "pmUserId": return store.people.first { $0.id == s }?.name ?? T("someone")
            case "stage": return PipelineText.stage(s)
            case "deliverableRisk": return PipelineText.risk(s)
            default: return s
            }
        case .number(let n):
            switch field {
            case "contractValue", "netValue", "invoiceValue", "outstandingReceivable", "netCash": return PipelineFormat.idrFull(n)
            case "probability": return PipelineFormat.pct(n)
            default: return n.rounded() == n ? String(Int(n)) : String(n)
            }
        case .array(let a):
            return field == "links" ? String(format: T("%d links"), a.count) : value.pretty
        case .bool(let b): return b ? "✓" : "–"
        case .object: return value.pretty
        }
    }
}

// MARK: - New deal

/// Name, brand and stage, then the full deal opens for every division to fill in (the GM's flow).
struct PipelineNewDealSheet: View {
    let store: PipelineStore
    let stage: String
    let onCreated: (PipelineDeal) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var brand = ""
    @State private var chosenStage = ""
    @State private var busy = false
    @State private var err: String?
    @FocusState private var nameFocused: Bool

    private var trimmed: String { name.trimmingCharacters(in: .whitespacesAndNewlines) }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    PipelineFieldBox(T("Deal name")) {
                        TextField(T("Deal name"), text: $name)
                            .font(NXFont.text(16)).focused($nameFocused).submitLabel(.next)
                            .padding(12)
                            .background(NX.card, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(NX.border))
                    }
                    PipelineFieldBox(T("Brand / client")) {
                        TextField(T("Brand / client"), text: $brand)
                            .font(NXFont.text(16)).submitLabel(.done)
                            .onSubmit { if !trimmed.isEmpty { Task { await create() } } }
                            .padding(12)
                            .background(NX.card, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(NX.border))
                    }
                    PipelineFieldBox(T("Stage")) {
                        PipelineMenuInput(label: T("Stage"), value: chosenStage,
                                          options: store.vocab.stages.filter { $0 != PipelineVocab.lostStage },
                                          text: PipelineText.stage) { chosenStage = $0 }
                    }
                    Text(T("BD, Legal, PM and Finance fill in their parts on the deal once it is created."))
                        .font(NXFont.text(12)).foregroundStyle(NX.mutedFg).fixedSize(horizontal: false, vertical: true)
                    if let err { Text(err).font(NXFont.text(13, .semibold)).foregroundStyle(NX.danger) }
                    Button { Task { await create() } } label: {
                        HStack(spacing: 8) {
                            if busy { ProgressView().tint(.white) }
                            Text(busy ? T("Adding…") : T("Create deal"))
                        }
                    }
                    .buttonStyle(NexusPrimaryButton())
                    .disabled(busy || trimmed.isEmpty)
                }
                .padding(20)
            }
            .background(NX.background.ignoresSafeArea())
            .navigationTitle(T("New deal"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .topBarLeading) { Button(T("Cancel")) { dismiss() } } }
        }
        .presentationDetents([.medium, .large])
        .onAppear {
            if chosenStage.isEmpty { chosenStage = stage }
            nameFocused = true
        }
    }

    private func create() async {
        guard !busy, !trimmed.isEmpty else { return }
        busy = true; err = nil
        defer { busy = false }
        var fields: [String: Any] = ["name": trimmed, "stage": chosenStage.isEmpty ? stage : chosenStage]
        let b = brand.trimmingCharacters(in: .whitespacesAndNewlines)
        if !b.isEmpty { fields["brand"] = b }
        if let deal = await store.create(fields) {
            onCreated(deal)
        } else {
            // Shown here rather than on the board underneath, which cannot show it while this is up.
            err = store.actionError ?? T("The deal wasn't created. Try again.")
            store.actionError = nil
        }
    }
}

// MARK: - Fields

/// A section of the deal: the GM's division groups, with the division that owns it on the right.
struct PipelineSection<Content: View>: View {
    let title: String
    let owner: String
    var columns: Int = 2
    @ViewBuilder let content: () -> Content
    @Environment(\.horizontalSizeClass) private var hSize

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .firstTextBaseline) {
                Text(title).font(NXFont.text(15, .bold)).foregroundStyle(NX.foreground)
                Spacer(minLength: 8)
                Text(owner.uppercased()).font(NXFont.text(10, .bold)).tracking(0.5).foregroundStyle(NX.mutedFg)
            }
            // Two columns where there is room (Mac, iPad), one on a phone.
            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 12, alignment: .top),
                                     count: hSize == .regular ? max(1, columns) : 1),
                      alignment: .leading, spacing: 12) {
                content()
            }
        }
        .padding(14)
        .background(NX.card, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).strokeBorder(NX.border))
    }
}

/// A field's label above its control.
struct PipelineFieldBox<Content: View>: View {
    let label: String
    @ViewBuilder let content: () -> Content
    init(_ label: String, @ViewBuilder content: @escaping () -> Content) {
        self.label = label
        self.content = content
    }
    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            Text(label).font(NXFont.text(12, .semibold)).foregroundStyle(NX.mutedFg)
            content()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// The box every control sits in, so text, menus, money and dates line up.
private struct PipelineInputChrome: ViewModifier {
    var active = false
    func body(content: Content) -> some View {
        content
            .padding(.horizontal, 11)
            .frame(minHeight: 40)
            .background(NX.background, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).strokeBorder(active ? NX.violet.opacity(0.6) : NX.border))
    }
}

/// Text that saves when it is left (or on Return). A required field that is emptied goes back to what
/// it was instead of being sent: the server would refuse it anyway.
struct PipelineTextInput: View {
    let label: String
    let value: String
    var required = false
    var multiline = false
    var large = false
    var placeholder = ""
    let onCommit: (String) -> Void

    @State private var draft = ""
    @State private var sent: String?
    @FocusState private var focused: Bool

    var body: some View {
        Group {
            if multiline {
                TextField(placeholder, text: $draft, axis: .vertical).lineLimit(2...10)
            } else {
                TextField(placeholder, text: $draft)
            }
        }
        .font(large ? NXFont.display(20, .bold) : NXFont.text(14))
        .foregroundStyle(NX.foreground)
        .focused($focused)
        .submitLabel(.done)
        .onSubmit(commit)
        .padding(.vertical, large ? 4 : 9)
        .modifier(PipelineTextChrome(large: large, active: focused))
        .accessibilityLabel(label)
        .onAppear { draft = value }
        .onChange(of: value) { _, v in
            sent = nil
            if !focused { draft = v }
        }
        .onChange(of: focused) { _, f in if !f { commit() } }
        .onDisappear { commit() }
    }

    private func commit() {
        let t = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        if required && t.isEmpty { draft = value; return }
        guard t != value, t != sent else { return }
        sent = t
        onCommit(t)
    }
}

/// The name in the sheet's head reads as a title, not a form box.
private struct PipelineTextChrome: ViewModifier {
    let large: Bool
    let active: Bool
    @ViewBuilder func body(content: Content) -> some View {
        if large {
            content
                .overlay(alignment: .bottom) { Rectangle().fill(active ? NX.violet.opacity(0.6) : Color.clear).frame(height: 1) }
        } else {
            content.modifier(PipelineInputChrome(active: active))
        }
    }
}

/// Rupiah, typed with or without separators ("950.000.000", "950000000"); saved when left.
struct PipelineMoneyInput: View {
    let label: String
    let value: Double
    var allowNegative = false
    let onCommit: (Double) -> Void

    @State private var draft = ""
    @State private var sent: Double?
    @FocusState private var focused: Bool

    var body: some View {
        HStack(spacing: 6) {
            Text("Rp").font(NXFont.text(13, .semibold)).foregroundStyle(NX.mutedFg)
            TextField("0", text: $draft)
                .font(NXFont.text(14)).foregroundStyle(NX.foreground).monospacedDigit()
                // A minus sign needs the punctuation keyboard; the number pad has none.
                .keyboardType(allowNegative ? .numbersAndPunctuation : .numberPad)
                .focused($focused)
                .submitLabel(.done)
                .onSubmit(commit)
        }
        .modifier(PipelineInputChrome(active: focused))
        .accessibilityElement(children: .combine)
        .accessibilityLabel(label)
        .onAppear { draft = value == 0 ? "" : PipelineFormat.plain(value) }
        .onChange(of: value) { _, v in
            sent = nil
            if !focused { draft = v == 0 ? "" : PipelineFormat.plain(v) }
        }
        .onChange(of: focused) { _, f in if !f { commit() } }
        .onDisappear { commit() }
    }

    private func commit() {
        guard var v = PipelineFormat.parseMoney(draft) else {
            draft = value == 0 ? "" : PipelineFormat.plain(value)
            return
        }
        if !allowNegative { v = Swift.abs(v) }
        // Tidy what is shown: "950000000" becomes "950.000.000".
        if !focused { draft = v == 0 ? "" : PipelineFormat.plain(v) }
        guard v != value, v != sent else { return }
        sent = v
        onCommit(v)
    }
}

/// Whole days (the GM's typed "days overdue" for rows without a due date).
struct PipelineDaysInput: View {
    let label: String
    let value: Int
    let onCommit: (Int) -> Void

    @State private var draft = ""
    @FocusState private var focused: Bool

    var body: some View {
        TextField("0", text: $draft)
            .font(NXFont.text(14)).foregroundStyle(NX.foreground).monospacedDigit()
            .keyboardType(.numberPad)
            .focused($focused)
            .modifier(PipelineInputChrome(active: focused))
            .accessibilityLabel(label)
            .onAppear { draft = String(value) }
            .onChange(of: value) { _, v in if !focused { draft = String(v) } }
            .onChange(of: focused) { _, f in if !f { commit() } }
            .onDisappear { commit() }
    }

    private func commit() {
        let digits = draft.filter(\.isNumber)
        guard let n = Int(digits.isEmpty ? "0" : digits), n <= 3650 else { draft = String(value); return }
        draft = String(n)
        if n != value { onCommit(n) }
    }
}

/// One of the GM's option lists. A stored value that is not in the list (a newer option) is shown as-is.
struct PipelineMenuInput: View {
    let label: String
    let value: String
    let options: [String]
    var text: (String) -> String = { $0 }
    let onCommit: (String) -> Void

    var body: some View {
        Menu {
            ForEach(options, id: \.self) { o in
                Button { if o != value { onCommit(o) } } label: {
                    if o == value { Label(text(o), systemImage: "checkmark") } else { Text(text(o)) }
                }
            }
        } label: {
            HStack(spacing: 6) {
                Text(value.isEmpty ? "–" : text(value)).font(NXFont.text(14)).foregroundStyle(NX.foreground).lineLimit(1)
                Spacer(minLength: 4)
                Image(systemName: "chevron.up.chevron.down").font(.system(size: 10, weight: .semibold)).foregroundStyle(NX.mutedFg)
            }
            .modifier(PipelineInputChrome())
            .contentShape(Rectangle())
        }
        .menuIndicator(.hidden)
        .accessibilityLabel(label)
        .accessibilityValue(value.isEmpty ? "–" : text(value))
    }
}

/// A day, or none. "Add date" sets today, which the picker then changes; the cross clears it.
struct PipelineDateInput: View {
    let label: String
    let value: String?
    let onCommit: (String?) -> Void

    private static let jakarta = TimeZone(identifier: "Asia/Jakarta")!

    var body: some View {
        HStack(spacing: 8) {
            if let date = PipelineFormat.parseDay(value) {
                DatePicker(label, selection: Binding(get: { date }, set: { onCommit(PipelineFormat.isoDay($0)) }),
                           displayedComponents: .date)
                    .labelsHidden()
                    .environment(\.timeZone, Self.jakarta)
                Spacer(minLength: 4)
                Button { onCommit(nil) } label: {
                    Image(systemName: "xmark.circle.fill").font(.system(size: 15)).foregroundStyle(NX.mutedFg)
                        .frame(width: 32, height: 32).contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(String(format: T("Clear %@"), label))
            } else {
                Button { onCommit(PipelineFormat.today) } label: {
                    Label(T("Add date"), systemImage: "calendar.badge.plus")
                        .font(NXFont.text(13, .semibold)).foregroundStyle(NX.violetText)
                        .frame(maxWidth: .infinity, minHeight: 38, alignment: .leading)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("\(label): \(T("Add date"))")
            }
        }
        .modifier(PipelineInputChrome())
    }
}

/// BD or PM: a member of the project's workspace, nobody, or someone outside NEXUS by name (a freelancer,
/// an imported row). A user id wins over the name, as on the server.
struct PipelinePersonInput: View {
    let label: String
    let userId: String?
    let name: String?
    let person: PipelinePerson?
    let people: [PipelinePerson]
    let onCommit: (_ userId: String?, _ name: String?) -> Void

    @State private var outside = false

    private var typedName: String { (name ?? "").trimmingCharacters(in: .whitespaces) }
    private var showsNameField: Bool { userId == nil && (outside || !typedName.isEmpty) }

    private var shownName: String? {
        if let userId {
            return person?.name ?? people.first { $0.id == userId }?.name ?? T("(not in this workspace)")
        }
        return typedName.isEmpty ? nil : typedName
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Menu {
                Button { outside = false; onCommit(nil, nil) } label: {
                    if userId == nil && typedName.isEmpty && !outside { Label(T("Not assigned"), systemImage: "checkmark") } else { Text(T("Not assigned")) }
                }
                Section {
                    ForEach(people, id: \.id) { p in
                        Button { outside = false; onCommit(p.id, nil) } label: {
                            if p.id == userId { Label(p.name ?? "?", systemImage: "checkmark") } else { Text(p.name ?? "?") }
                        }
                    }
                }
                Section {
                    Button { outside = true } label: {
                        if showsNameField { Label(T("Someone outside NEXUS…"), systemImage: "checkmark") } else { Text(T("Someone outside NEXUS…")) }
                    }
                }
            } label: {
                HStack(spacing: 8) {
                    if let shownName {
                        AvatarView(url: person?.avatar, initial: String(shownName.first ?? "?").uppercased(), size: 22)
                        Text(shownName).font(NXFont.text(14)).foregroundStyle(NX.foreground).lineLimit(1)
                    } else {
                        Text(T("Not assigned")).font(NXFont.text(14)).foregroundStyle(NX.mutedFg)
                    }
                    Spacer(minLength: 4)
                    Image(systemName: "chevron.up.chevron.down").font(.system(size: 10, weight: .semibold)).foregroundStyle(NX.mutedFg)
                }
                .modifier(PipelineInputChrome())
                .contentShape(Rectangle())
            }
            .menuIndicator(.hidden)
            .accessibilityLabel(label)
            .accessibilityValue(shownName ?? T("Not assigned"))

            if showsNameField {
                PipelineTextInput(label: String(format: T("%@ name"), label), value: name ?? "", placeholder: T("Their name")) { t in
                    onCommit(nil, t.isEmpty ? nil : t)
                }
            }
        }
    }
}

/// SPK, contract, MOU, invoice and other links. The whole list is saved on each add or remove.
struct PipelineLinksEditor: View {
    let links: [PipelineLink]
    let linkTypes: [String]
    let onCommit: ([PipelineLink]) -> Void

    @Environment(\.openURL) private var openURL
    @State private var type = "SPK"
    @State private var url = ""
    @State private var label = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            if links.isEmpty {
                Text(T("No SPK, contract, MOU or invoice linked yet.")).font(NXFont.text(13)).foregroundStyle(NX.mutedFg)
            } else {
                VStack(spacing: 0) {
                    ForEach(Array(links.enumerated()), id: \.element.id) { i, l in
                        if i > 0 { Divider().overlay(NX.border) }
                        HStack(spacing: 8) {
                            NexusChip(text: PipelineText.link(l.type))
                            Button { if let u = URL(string: l.url) { openURL(u) } } label: {
                                HStack(spacing: 4) {
                                    Text(l.label.isEmpty ? l.url : l.label).font(NXFont.text(13, .semibold)).foregroundStyle(NX.violetText).lineLimit(1)
                                    Image(systemName: "arrow.up.right").font(.system(size: 10, weight: .bold)).foregroundStyle(NX.violetText)
                                }
                                .contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)
                            Spacer(minLength: 4)
                            Button { onCommit(links.filter { $0.id != l.id }) } label: {
                                Image(systemName: "xmark").font(.system(size: 11, weight: .bold)).foregroundStyle(NX.mutedFg)
                                    .frame(width: 32, height: 32).contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)
                            .accessibilityLabel(T("Remove link"))
                        }
                        .padding(.horizontal, 10).padding(.vertical, 4)
                    }
                }
                .background(NX.background, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(NX.border))
            }

            HStack(spacing: 8) {
                Menu {
                    ForEach(linkTypes, id: \.self) { k in
                        Button { type = k } label: {
                            if k == type { Label(PipelineText.link(k), systemImage: "checkmark") } else { Text(PipelineText.link(k)) }
                        }
                    }
                } label: {
                    HStack(spacing: 4) {
                        Text(PipelineText.link(type)).font(NXFont.text(13, .semibold)).foregroundStyle(NX.foreground).lineLimit(1)
                        Image(systemName: "chevron.up.chevron.down").font(.system(size: 9, weight: .semibold)).foregroundStyle(NX.mutedFg)
                    }
                    .modifier(PipelineInputChrome())
                }
                .menuIndicator(.hidden)
                .accessibilityLabel(T("Link type"))
                TextField(T("Paste a link (https://…)"), text: $url)
                    .font(NXFont.text(14)).keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled()
                    .modifier(PipelineInputChrome())
                    .accessibilityLabel(T("Link"))
            }
            TextField(T("Document name (optional)"), text: $label)
                .font(NXFont.text(14))
                .modifier(PipelineInputChrome())
                .accessibilityLabel(T("Document name"))
            Button { add() } label: {
                Label(T("Add link"), systemImage: "plus").font(NXFont.text(13, .bold)).foregroundStyle(.white)
                    .padding(.horizontal, 14).frame(minHeight: 38)
                    .background(NX.violetFill, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
            }
            .buttonStyle(.plain)
            .disabled(url.trimmingCharacters(in: .whitespaces).isEmpty)
            .opacity(url.trimmingCharacters(in: .whitespaces).isEmpty ? 0.4 : 1)
        }
    }

    private func add() {
        var u = url.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !u.isEmpty else { return }
        let lower = u.lowercased()
        if !lower.hasPrefix("http://") && !lower.hasPrefix("https://") { u = "https://\(u)" }
        let id = "lnk" + String(Int(Date().timeIntervalSince1970 * 1000), radix: 36)
        onCommit(links + [PipelineLink(id: id, type: type, label: label.trimmingCharacters(in: .whitespaces), url: u)])
        url = ""
        label = ""
    }
}
