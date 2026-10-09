import SwiftUI

// MARK: - Pipeline Dashboard project view (owner, 9 Oct 2026)
//
// The main tab of a PIPELINE project, mirroring the web's PipelineView: the KPI strip over every deal,
// search + PM/BD filters + health chips, then Board (stage columns) · Table (compact rows, sortable,
// totals) · Health (what needs someone today). A deal opens in a sheet (PipelineDealView.swift).
//
// Moving a deal is the card's "Move to stage" menu (and its context menu), not drag and drop: dragging
// a card across columns that page sideways inside a scroll view is exactly the kind of gesture that
// broke the task board twice. The web keeps its drag; the menu is the same PATCH.
//
// Live: a colleague's edit arrives as `pipeline-changed` on the project's room (held by
// ProjectDetailView), RealtimeClient posts `.nexusPipelineChanged`, and the store refetches.

/// What the pipeline screen holds: the deals, the server's summary and option lists, and the people the
/// BD/PM pickers offer. Shared by the board and the deal sheet, so an edit in one shows in the other.
@MainActor
@Observable
final class PipelineStore {
    let projectId: String
    private(set) var deals: [PipelineDeal] = []
    private(set) var summary = PipelineSummary()
    private(set) var vocab = PipelineVocab.fallback
    private(set) var today = PipelineFormat.today
    private(set) var people: [PipelinePerson] = []
    private(set) var loaded = false
    /// Bumped on every successful read, so an open deal's History refetches with it.
    private(set) var revision = 0
    var loadError: String?
    var forbidden = false
    var signedOut = false
    /// A refused write, in the server's words when it gave some.
    var actionError: String?
    /// A one-line confirmation ("… deleted. Control Room → Audit can restore it.").
    var notice: String?
    @ObservationIgnored private var workspaceId: String?

    init(projectId: String) { self.projectId = projectId }

    func deal(_ id: String) -> PipelineDeal? { deals.first { $0.id == id } }

    /// The first load and every quiet reload. A reload that fails leaves what is drawn alone.
    func load() async {
        do {
            let r = try await APIClient.shared.pipeline(projectId: projectId)
            deals = r.deals
            summary = r.summary
            vocab = r.vocab
            today = r.today ?? PipelineFormat.today
            loadError = nil
            forbidden = false
            loaded = true
            revision += 1
            if let ws = r.project?.workspaceId, ws != workspaceId || people.isEmpty {
                workspaceId = ws
                await loadPeople(ws)
            }
        }
        catch APIError.unauthorized { signedOut = true }
        // The board's own rule: staff who are not members of the project get 403.
        catch APIError.http(403, _) { forbidden = true }
        catch {
            if !loaded { loadError = (error as? LocalizedError)?.errorDescription ?? T("Check your connection, then try again.") }
        }
    }

    private func loadPeople(_ workspaceId: String) async {
        guard let members = try? await APIClient.shared.pipelinePeople(workspaceId: workspaceId) else { return }
        people = members.compactMap { m -> PipelinePerson? in
            guard let id = m.userId, !id.isEmpty else { return nil }
            return PipelinePerson(id: id, name: m.displayName, avatar: m.avatarURL)
        }
        .sorted { ($0.name ?? "").localizedCaseInsensitiveCompare($1.name ?? "") == .orderedAscending }
    }

    /// One edit. The card changes at once; the server's answer (health, phases) replaces it, and a
    /// reload brings the KPIs along. A refusal puts the deal back as it was and says why.
    @discardableResult
    func patch(_ id: String, _ fields: [String: Any]) async -> Bool {
        guard let i = deals.firstIndex(where: { $0.id == id }) else { return false }
        let before = deals[i]
        var local = before
        local.apply(fields)
        if let uid = fields["pmUserId"] as? String { local.pm = people.first { $0.id == uid } }
        if let uid = fields["bdUserId"] as? String { local.bd = people.first { $0.id == uid } }
        deals[i] = local
        do {
            let saved = try await APIClient.shared.pipelineUpdate(projectId: projectId, dealId: id, fields: fields)
            if let j = deals.firstIndex(where: { $0.id == id }) { deals[j] = saved }
            await load()
            return true
        } catch {
            if let j = deals.firstIndex(where: { $0.id == id }) { deals[j] = before }
            fail(error, T("That change wasn't saved. Try again."))
            return false
        }
    }

    /// "Create execution project" (owner/GM, 9 Oct 2026): the deal's Task project, made now or the one it
    /// already has. Answers the project to open, or nil after showing the refusal.
    func createExecution(_ id: String) async -> ProjectRef? {
        do {
            let r = try await APIClient.shared.pipelineCreateExecution(projectId: projectId, dealId: id)
            if let saved = r.deal, let j = deals.firstIndex(where: { $0.id == id }) { deals[j] = saved }
            let name = r.deal?.executionProject?.name ?? deal(id)?.name ?? ""
            await load()
            return ProjectRef(id: r.projectId, name: name, icon: nil)
        } catch {
            fail(error, T("The execution project wasn't created. Try again."))
            return nil
        }
    }

    func create(_ fields: [String: Any]) async -> PipelineDeal? {
        do {
            let deal = try await APIClient.shared.pipelineCreate(projectId: projectId, fields: fields)
            deals.append(deal)
            await load()
            return deal
        } catch {
            fail(error, T("The deal wasn't created. Try again."))
            return nil
        }
    }

    func delete(_ id: String) async -> Bool {
        guard let i = deals.firstIndex(where: { $0.id == id }) else { return false }
        let gone = deals.remove(at: i)
        do {
            try await APIClient.shared.pipelineDelete(projectId: projectId, dealId: id)
            let name = gone.name.isEmpty ? T("Untitled deal") : gone.name
            notice = String(format: T("%@ deleted. Control Room → Audit can restore it."), name)
            await load()
            return true
        } catch {
            deals.insert(gone, at: min(i, deals.count))
            fail(error, T("The deal wasn't deleted. Try again."))
            return false
        }
    }

    func history(_ id: String) async throws -> PipelineDealDetail {
        try await APIClient.shared.pipelineDeal(projectId: projectId, dealId: id)
    }

    func exportFile() async -> URL? {
        do {
            return try await APIClient.shared.pipelineExport(projectId: projectId, lang: AppLanguage.shared.lang.rawValue)
        } catch {
            fail(error, T("The Excel file didn't download. Try again."))
            return nil
        }
    }

    private func fail(_ error: Error, _ fallback: String) {
        guard let api = error as? APIError else {
            actionError = (error as? LocalizedError)?.errorDescription ?? fallback
            return
        }
        switch api {
        case .unauthorized: signedOut = true
        // The server's sentence names the field that was wrong ("Tidak boleh negatif.").
        case .http(_, let message): actionError = (message?.isEmpty == false) ? message : fallback
        default: actionError = api.errorDescription ?? fallback
        }
    }
}

enum PipelineMode: String, CaseIterable, Identifiable {
    case board, table, health
    var id: String { rawValue }
    var label: String {
        switch self {
        case .board: return T("Board")
        case .table: return T("Table")
        case .health: return T("Health")
        }
    }
    var icon: String {
        switch self {
        case .board: return "rectangle.split.3x1"
        case .table: return "tablecells"
        case .health: return "heart.text.square"
        }
    }
}

/// The one sheet this screen presents, whichever it is (one `.sheet` per view).
enum PipelineRoute: Identifiable {
    case deal(String)
    case newDeal(String)
    case export(URL)
    var id: String {
        switch self {
        case .deal(let id): return "deal-\(id)"
        case .newDeal(let stage): return "new-\(stage)"
        case .export(let url): return "export-\(url.path)"
        }
    }
}

struct PipelineTab: View {
    let projectId: String
    /// Bumped by the project header's "+": New deal.
    let newDealRequest: Int

    @Environment(AuthStore.self) private var auth
    @Environment(\.horizontalSizeClass) private var hSize
    @State private var store: PipelineStore
    /// Board · Table · Health, remembered on this device like the web remembers it per browser.
    @AppStorage("nexus.pipeline.view") private var modeRaw = PipelineMode.board.rawValue
    @State private var search = ""
    @State private var pmFilter = ""
    @State private var bdFilter = ""
    @State private var healthFilter = ""
    @State private var route: PipelineRoute?
    @State private var exporting = false

    init(projectId: String, newDealRequest: Int) {
        self.projectId = projectId
        self.newDealRequest = newDealRequest
        _store = State(initialValue: PipelineStore(projectId: projectId))
    }

    private var mode: PipelineMode { PipelineMode(rawValue: modeRaw) ?? .board }
    private var wide: Bool { hSize == .regular }

    private var filtering: Bool {
        !search.trimmingCharacters(in: .whitespaces).isEmpty || !pmFilter.isEmpty || !bdFilter.isEmpty || !healthFilter.isEmpty
    }

    /// Search covers name, code, brand, BD and PM, like the web. Filters never change the KPIs.
    private var shown: [PipelineDeal] {
        let needle = search.trimmingCharacters(in: .whitespaces).lowercased()
        return store.deals.filter { d in
            if !healthFilter.isEmpty && d.health.key != healthFilter { return false }
            if !pmFilter.isEmpty && d.pmDisplay != pmFilter { return false }
            if !bdFilter.isEmpty && d.bdDisplay != bdFilter { return false }
            if !needle.isEmpty {
                let hay = [d.code, d.name, d.brand, d.pmDisplay ?? "", d.bdDisplay ?? ""].joined(separator: " ").lowercased()
                if !hay.contains(needle) { return false }
            }
            return true
        }
    }

    private var pmNames: [String] { Array(Set(store.deals.compactMap(\.pmDisplay))).sorted() }
    private var bdNames: [String] { Array(Set(store.deals.compactMap(\.bdDisplay))).sorted() }

    var body: some View {
        Group {
            if store.forbidden {
                EmptyState(icon: "lock", title: T("This pipeline is for its project members"),
                           subtitle: T("Ask the project lead or a manager to add you to the project."))
            } else if !store.loaded {
                if let err = store.loadError {
                    ErrorState(message: err, icon: "chart.bar.doc.horizontal") {
                        Task { store.loadError = nil; await store.load() }
                    }
                } else {
                    ProgressView().tint(NX.violetText).frame(maxWidth: .infinity, maxHeight: .infinity)
                        .accessibilityLabel(T("Loading the pipeline"))
                }
            } else if store.deals.isEmpty {
                ScrollView {
                    EmptyState(icon: "line.3.horizontal.decrease.circle", title: T("No deals in this pipeline yet"),
                               subtitle: T("Every client job goes here, from the first brief to paid and closed. Add the first one, then BD, Legal, PM and Finance fill in their parts on the same card."),
                               actionTitle: T("Add the first deal"), action: { route = .newDeal("Incoming") })
                        .frame(minHeight: 440)
                }
                .refreshable { await store.load() }
            } else {
                VStack(spacing: 0) {
                    header
                    Divider().overlay(NX.border)
                    content
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .task { await store.load() }
        .liveRefresh(every: 60, on: [.nexusPipelineChanged], projectId: projectId) { await store.load() }
        .onChange(of: newDealRequest) { _, _ in route = .newDeal("Incoming") }
        .onChange(of: store.signedOut) { _, out in if out { auth.logout() } }
        .sheet(item: $route) { r in sheet(r) }
        // While a sheet is up it shows the refusal itself (PipelineDealView); this one is for the board.
        .alert(store.actionError ?? "", isPresented: Binding(
            get: { route == nil && store.actionError != nil },
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

    @ViewBuilder private func sheet(_ r: PipelineRoute) -> some View {
        switch r {
        case .deal(let id):
            PipelineDealView(store: store, dealId: id)
        case .newDeal(let stage):
            // The GM's flow: the new deal opens straight away, for BD, Legal, PM and Finance to fill in.
            PipelineNewDealSheet(store: store, stage: stage) { deal in route = .deal(deal.id) }
        case .export(let url):
            ActivityView(items: [url])
        }
    }

    // MARK: header

    private var header: some View {
        VStack(alignment: .leading, spacing: 10) {
            PipelineKpiStrip(summary: store.summary)
            HStack(spacing: 8) {
                searchField
                filterMenu
                exportButton
            }
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    modePicker
                    Rectangle().fill(NX.border).frame(width: 1, height: 22)
                    ForEach(["", "CRITICAL", "ATTENTION", "HEALTHY", "NOT_STARTED"], id: \.self) { healthChip($0) }
                }
                .padding(.vertical, 1)
            }
            if filtering {
                HStack(spacing: 10) {
                    Text(String(format: T("%d of %d deals"), shown.count, store.deals.count))
                        .font(NXFont.text(12)).foregroundStyle(NX.mutedFg).monospacedDigit()
                    Button(T("Clear filters")) { resetFilters() }
                        .font(NXFont.text(12, .semibold)).foregroundStyle(NX.violetText)
                }
            }
        }
        .padding(.horizontal, 14).padding(.top, 10).padding(.bottom, 10)
    }

    private var searchField: some View {
        HStack(spacing: 8) {
            Image(systemName: "magnifyingglass").font(.system(size: 13, weight: .semibold)).foregroundStyle(NX.mutedFg)
            TextField(T("Search deal, brand, code, BD or PM…"), text: $search)
                .font(NXFont.text(14)).foregroundStyle(NX.foreground)
                .textInputAutocapitalization(.never).autocorrectionDisabled().submitLabel(.search)
            if !search.isEmpty {
                Button { search = "" } label: {
                    Image(systemName: "xmark.circle.fill").font(.system(size: 15)).foregroundStyle(NX.mutedFg)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(T("Clear filters"))
            }
        }
        .padding(.horizontal, 12).frame(height: 40)
        .background(NX.card, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(search.isEmpty ? NX.border : NX.violet.opacity(0.55)))
        .accessibilityLabel(T("Search deals"))
    }

    private var filterMenu: some View {
        let active = !pmFilter.isEmpty || !bdFilter.isEmpty
        return Menu {
            Section(T("Filter by PM")) {
                Button { pmFilter = "" } label: { check(pmFilter.isEmpty, T("All PMs")) }
                ForEach(pmNames, id: \.self) { n in Button { pmFilter = n } label: { check(pmFilter == n, n) } }
            }
            Section(T("Filter by BD")) {
                Button { bdFilter = "" } label: { check(bdFilter.isEmpty, T("All BDs")) }
                ForEach(bdNames, id: \.self) { n in Button { bdFilter = n } label: { check(bdFilter == n, n) } }
            }
        } label: {
            Image(systemName: active ? "line.3.horizontal.decrease.circle.fill" : "line.3.horizontal.decrease.circle")
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(active ? NX.violetText : NX.foreground)
                .frame(width: 40, height: 40)
                .background(active ? NX.violet.opacity(0.12) : NX.card, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(active ? NX.violet.opacity(0.55) : NX.border))
        }
        .menuIndicator(.hidden)
        .accessibilityLabel(T("Filter by PM"))
    }

    @ViewBuilder private func check(_ on: Bool, _ text: String) -> some View {
        if on { Label(text, systemImage: "checkmark") } else { Text(text) }
    }

    private var exportButton: some View {
        Button {
            Task {
                exporting = true
                if let url = await store.exportFile() { route = .export(url) }
                exporting = false
            }
        } label: {
            Group {
                if exporting { ProgressView().scaleEffect(0.8) }
                else { Image(systemName: "square.and.arrow.down").font(.system(size: 15, weight: .semibold)).foregroundStyle(NX.foreground) }
            }
            .frame(width: 40, height: 40)
            .background(NX.card, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(NX.border))
        }
        .buttonStyle(.plain)
        .disabled(exporting)
        .accessibilityLabel(exporting ? T("Preparing…") : T("Download Excel"))
    }

    private var modePicker: some View {
        HStack(spacing: 2) {
            ForEach(PipelineMode.allCases) { m in
                Button { modeRaw = m.rawValue } label: {
                    HStack(spacing: 5) {
                        Image(systemName: m.icon).font(.system(size: 11, weight: .semibold))
                        Text(m.label).font(NXFont.text(12, .semibold))
                    }
                    .foregroundStyle(mode == m ? Color.white : NX.mutedFg)
                    .padding(.horizontal, 10).frame(height: 30)
                    .background(mode == m ? NX.violetFill : Color.clear, in: RoundedRectangle(cornerRadius: 9, style: .continuous))
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(mode == m ? .isSelected : [])
            }
        }
        .padding(2)
        .background(NX.card, in: RoundedRectangle(cornerRadius: 11, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 11, style: .continuous).strokeBorder(NX.border))
    }

    private func healthChip(_ key: String) -> some View {
        let on = healthFilter == key
        let count = key.isEmpty ? store.deals.count : store.deals.filter { $0.health.key == key }.count
        return Button { healthFilter = key } label: {
            HStack(spacing: 5) {
                if !key.isEmpty { Circle().fill(PipelineStyle.healthDot(key)).frame(width: 6, height: 6) }
                Text(key.isEmpty ? T("All") : PipelineText.health(key)).font(NXFont.text(12, .semibold))
                Text("\(count)").font(NXFont.text(11, .semibold)).monospacedDigit().opacity(on ? 0.85 : 0.6)
            }
            .foregroundStyle(on ? Color.white : NX.mutedFg)
            .padding(.horizontal, 11).frame(height: 30)
            .background(on ? NX.violetFill : NX.card, in: Capsule())
            .overlay(Capsule().strokeBorder(on ? Color.clear : NX.border))
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(on ? .isSelected : [])
    }

    private func resetFilters() { search = ""; pmFilter = ""; bdFilter = ""; healthFilter = "" }

    // MARK: content

    @ViewBuilder private var content: some View {
        let list = shown
        if filtering && list.isEmpty {
            ScrollView {
                EmptyState(icon: "magnifyingglass", title: T("No deal matches"),
                           subtitle: store.deals.count == 1 ? T("The filters hide the only deal.")
                               : String(format: T("The filters hide all %d deals."), store.deals.count),
                           actionTitle: T("Clear filters"), actionIcon: nil, action: { resetFilters() }, compact: true)
            }
        } else {
            switch mode {
            case .board:
                PipelineBoard(deals: list, stages: store.vocab.stages, compact: !wide,
                              onOpen: { route = .deal($0) },
                              onMove: { id, stage in Task { await store.patch(id, ["stage": stage]) } },
                              onAdd: { route = .newDeal($0) },
                              onRefresh: { await store.load() })
            case .table:
                PipelineTable(deals: list, stages: store.vocab.stages, wide: wide,
                              onOpen: { route = .deal($0) }, onRefresh: { await store.load() })
            case .health:
                PipelineHealthView(deals: list, today: store.today, wide: wide,
                                   onOpen: { route = .deal($0) }, onRefresh: { await store.load() })
            }
        }
    }
}

// MARK: - Shared pieces

enum PipelineStyle {
    static func healthDot(_ key: String) -> Color {
        switch key {
        case "CRITICAL": return NX.danger
        case "ATTENTION": return NX.warning
        case "HEALTHY": return NX.success
        case "NOT_STARTED": return NX.mutedFg.opacity(0.5)
        default: return NX.mutedFg.opacity(0.3)
        }
    }

    /// A stage group's mark in a column head (web GROUP_TONE).
    static func groupTone(_ stage: String) -> Color {
        switch PipelineVocab.group(of: stage) {
        case "Pipeline": return NX.blue
        case "Pre-Execution": return NX.warning
        case "Execution": return NX.success
        case "Closed": return NX.foreground.opacity(0.6)
        default: return NX.mutedFg.opacity(0.4)
        }
    }

    static func phaseTone(_ state: String) -> Color {
        switch state {
        case "done": return NX.success
        case "active": return NX.blue
        case "bad": return NX.danger
        default: return NX.border
        }
    }
}

struct PipelineHealthPill: View {
    let key: String
    var body: some View {
        let tone = PipelineText.healthTone(key)
        HStack(spacing: 4) {
            Circle().fill(PipelineStyle.healthDot(key)).frame(width: 5, height: 5)
            Text(PipelineText.health(key)).font(NXFont.text(10, .bold))
        }
        .padding(.horizontal, 7).padding(.vertical, 3)
        .foregroundStyle(tone.fg)
        .background(tone.bg, in: Capsule())
        .fixedSize()
    }
}

/// The six segments on a card: how far each line of work in the deal has come (the GM's stepper).
struct PipelinePhaseTrack: View {
    let phases: [PipelinePhase]
    var body: some View {
        HStack(spacing: 4) {
            ForEach(Array(phases.enumerated()), id: \.offset) { _, p in
                Capsule().fill(PipelineStyle.phaseTone(p.state)).frame(height: 4)
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(phases.map { "\(PipelineText.phase($0.key)): \(PipelineText.phaseState($0.state))" }.joined(separator: ", "))
    }
}

/// The instrument strip (the GM's "instruments"): over every deal, never the filtered view, so
/// filtering never changes the numbers people quote. Scrolls sideways on a phone.
struct PipelineKpiStrip: View {
    let summary: PipelineSummary

    private struct Tile: Identifiable {
        let id: String
        let label: String
        let value: String
        let sub: String
        var tone: Color? = nil
    }

    private var tiles: [Tile] {
        let s = summary
        return [
            Tile(id: "open", label: T("Open pipeline"), value: PipelineFormat.idr(s.openValue),
                 sub: String(format: T("%d deals in play"), s.openCount)),
            Tile(id: "weighted", label: T("Weighted forecast"), value: PipelineFormat.idr(s.weightedValue),
                 sub: T("Value × probability")),
            Tile(id: "won", label: T("Won"), value: PipelineFormat.idr(s.wonValue),
                 sub: String(format: T("%d active · %d lost"), s.activeCount, s.lostCount)),
            Tile(id: "receivable", label: T("Receivable"), value: PipelineFormat.idr(s.receivable),
                 sub: String(format: T("%@ overdue"), PipelineFormat.idr(s.receivableOverdue)),
                 tone: s.receivableOverdue > 0 ? ChipTone.danger.fg : nil),
            Tile(id: "critical", label: T("Critical"), value: "\(s.criticalCount)",
                 sub: String(format: T("%d need attention"), s.attentionCount),
                 tone: s.criticalCount > 0 ? ChipTone.danger.fg : nil),
            Tile(id: "ready", label: T("Ready to execute"), value: "\(s.readyCount)",
                 sub: String(format: T("%d blocked"), s.blockedCount),
                 tone: s.blockedCount > 0 ? ChipTone.warning.fg : (s.readyCount > 0 ? ChipTone.success.fg : nil)),
            Tile(id: "deliverables", label: T("Deliverables on track"), value: "\(s.deliverablesOnTrack)",
                 sub: String(format: T("%d completed"), s.deliverablesDone)),
        ]
    }

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 0) {
                ForEach(Array(tiles.enumerated()), id: \.element.id) { i, tile in
                    if i > 0 { Rectangle().fill(NX.border).frame(width: 1).padding(.vertical, 10) }
                    VStack(alignment: .leading, spacing: 3) {
                        Text(tile.label.uppercased()).font(NXFont.text(10, .bold)).tracking(0.4).foregroundStyle(NX.mutedFg).lineLimit(1)
                        Text(tile.value).font(NXFont.display(19, .bold)).foregroundStyle(tile.tone ?? NX.foreground)
                            .monospacedDigit().lineLimit(1)
                        Text(tile.sub).font(NXFont.text(11)).foregroundStyle(NX.mutedFg).monospacedDigit().lineLimit(1)
                    }
                    .padding(.horizontal, 14).padding(.vertical, 10)
                    .frame(minWidth: 136, alignment: .leading)
                    .accessibilityElement(children: .combine)
                }
            }
            .background(NX.card, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(NX.border))
        }
        .accessibilityLabel(T("Pipeline at a glance"))
    }
}

// MARK: - Board

private struct PipelineStageColumn: Identifiable {
    let stage: String
    let deals: [PipelineDeal]
    var id: String { stage }
}

/// One column per stage, left to right from first contact to closed. On a phone a column is nearly the
/// screen's width and the strip snaps column by column; on a Mac or iPad the columns sit side by side.
/// Each column scrolls its own cards, like the task board (LaneColumn), so nothing scrolls two ways.
struct PipelineBoard: View {
    let deals: [PipelineDeal]
    let stages: [String]
    let compact: Bool
    let onOpen: (String) -> Void
    let onMove: (String, String) -> Void
    let onAdd: (String) -> Void
    let onRefresh: () async -> Void

    private var columns: [PipelineStageColumn] {
        var order = stages
        // A stage this build's server list does not have (an older vocab) is shown as-is, at the end.
        for d in deals where !order.contains(d.stage) { order.append(d.stage) }
        return order.map { s in PipelineStageColumn(stage: s, deals: deals.filter { $0.stage == s }.sorted(by: PipelineDeal.bySeverity)) }
    }

    var body: some View {
        if compact {
            ScrollView(.horizontal, showsIndicators: false) { strip }
                .scrollTargetBehavior(.viewAligned)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else {
            ScrollView(.horizontal, showsIndicators: true) { strip }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }

    private var strip: some View {
        HStack(alignment: .top, spacing: 12) {
            ForEach(columns) { col in
                PipelineColumnView(stage: col.stage, deals: col.deals, stages: stages,
                                   onOpen: onOpen, onMove: onMove, onAdd: onAdd, onRefresh: onRefresh)
                    .containerRelativeFrame(.horizontal) { length, _ in compact ? max(240, length - 56) : 288 }
            }
        }
        .scrollTargetLayout()
        .padding(.horizontal, 14).padding(.vertical, 12)
        .frame(maxHeight: .infinity, alignment: .top)
    }
}

struct PipelineColumnView: View {
    let stage: String
    let deals: [PipelineDeal]
    let stages: [String]
    let onOpen: (String) -> Void
    let onMove: (String, String) -> Void
    let onAdd: (String) -> Void
    let onRefresh: () async -> Void

    private var total: Double { deals.reduce(0) { $0 + $1.netValue } }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                VStack(alignment: .leading, spacing: 2) {
                    HStack(spacing: 6) {
                        Circle().fill(PipelineStyle.groupTone(stage)).frame(width: 7, height: 7)
                        Text(PipelineText.stage(stage)).font(NXFont.text(13, .bold)).foregroundStyle(NX.foreground).lineLimit(1)
                    }
                    Text(total > 0 ? PipelineFormat.idr(total) : " ").font(NXFont.text(11)).foregroundStyle(NX.mutedFg).monospacedDigit()
                }
                Spacer(minLength: 4)
                Text("\(deals.count)").font(NXFont.text(11, .bold)).monospacedDigit().foregroundStyle(NX.mutedFg)
                    .padding(.horizontal, 8).padding(.vertical, 2)
                    .background(NX.background, in: Capsule()).overlay(Capsule().strokeBorder(NX.border))
            }
            .padding(.horizontal, 12).padding(.top, 12).padding(.bottom, 8)
            .accessibilityElement(children: .combine)

            ScrollView(.vertical, showsIndicators: false) {
                VStack(spacing: 8) {
                    ForEach(deals) { d in
                        PipelineDealCard(deal: d, stages: stages, onOpen: onOpen, onMove: onMove)
                    }
                    if deals.isEmpty {
                        Text(T("No deals")).font(NXFont.text(12)).foregroundStyle(NX.mutedFg)
                            .frame(maxWidth: .infinity).padding(.vertical, 22)
                            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous)
                                .strokeBorder(NX.border, style: StrokeStyle(lineWidth: 1, dash: [4])))
                    }
                    if stage != PipelineVocab.lostStage {
                        Button { onAdd(stage) } label: {
                            Label(T("Add in this stage"), systemImage: "plus")
                                .font(NXFont.text(12, .semibold)).foregroundStyle(NX.mutedFg)
                                .frame(maxWidth: .infinity, minHeight: 40)
                                .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(.horizontal, 8).padding(.bottom, 10)
            }
            .refreshable { await onRefresh() }
        }
        .frame(maxHeight: .infinity, alignment: .top)
        .background(NX.muted.opacity(0.55), in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).strokeBorder(NX.border))
    }
}

struct PipelineDealCard: View {
    let deal: PipelineDeal
    let stages: [String]
    let onOpen: (String) -> Void
    let onMove: (String, String) -> Void

    var body: some View {
        Button { onOpen(deal.id) } label: { card }
            .buttonStyle(PressableCardStyle())
            // Above the card's own button, so a tap here moves instead of opening.
            .overlay(alignment: .bottomTrailing) { moveMenu.padding(4) }
            .contextMenu {
                Section(T("Move to stage")) { stageButtons }
            }
    }

    private var card: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .top, spacing: 6) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(deal.code).font(NXFont.text(10, .semibold)).foregroundStyle(NX.mutedFg).monospacedDigit()
                    Text(deal.name.isEmpty ? T("Untitled deal") : deal.name)
                        .font(NXFont.text(14, .semibold)).foregroundStyle(NX.foreground)
                        .multilineTextAlignment(.leading).lineLimit(3)
                }
                Spacer(minLength: 4)
                if deal.health.key != "NONE" { PipelineHealthPill(key: deal.health.key) }
            }
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Text(deal.brand.isEmpty ? "–" : deal.brand).font(NXFont.text(12)).foregroundStyle(NX.mutedFg).lineLimit(1)
                Spacer(minLength: 4)
                // No value yet (a fresh lead): a quiet dash, not "Rp0" in bold.
                if deal.netValue != 0 {
                    Text(PipelineFormat.idr(deal.netValue)).font(NXFont.text(12, .bold)).foregroundStyle(NX.foreground).monospacedDigit()
                } else {
                    Text("–").font(NXFont.text(12)).foregroundStyle(NX.mutedFg).accessibilityLabel(T("No value yet"))
                }
            }
            if !deal.phases.isEmpty { PipelinePhaseTrack(phases: deal.phases) }
            if !deal.blocker.isEmpty {
                HStack(alignment: .top, spacing: 5) {
                    Image(systemName: "exclamationmark.triangle.fill").font(.system(size: 10, weight: .bold)).padding(.top, 2)
                    Text(deal.blocker).font(NXFont.text(12)).lineLimit(2).multilineTextAlignment(.leading)
                }
                .foregroundStyle(ChipTone.warning.fg)
            }
            HStack(spacing: 6) {
                owner
                Spacer(minLength: 36)   // room for the move button laid over this corner
            }
            .frame(minHeight: 24)
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(NX.card, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(NX.border))
    }

    @ViewBuilder private var owner: some View {
        let group = PipelineVocab.group(of: deal.stage)
        if let pm = deal.pmDisplay {
            HStack(spacing: 6) {
                AvatarView(url: deal.pm?.avatar, initial: String(pm.first ?? "?").uppercased(), size: 18)
                Text(pm).font(NXFont.text(12)).foregroundStyle(NX.mutedFg).lineLimit(1)
            }
        } else if group == "Pipeline" || group == "Lost" {
            Text(deal.service).font(NXFont.text(12)).foregroundStyle(NX.mutedFg).lineLimit(1)
        } else {
            // Won without a PM: someone has to run it.
            Text(T("No PM yet")).font(NXFont.text(12, .semibold)).foregroundStyle(ChipTone.danger.fg)
        }
    }

    private var moveMenu: some View {
        Menu {
            Section(T("Move to stage")) { stageButtons }
        } label: {
            Image(systemName: "arrow.left.arrow.right")
                .font(.system(size: 12, weight: .semibold)).foregroundStyle(NX.mutedFg)
                .frame(width: 36, height: 36).contentShape(Rectangle())
        }
        .menuIndicator(.hidden)
        .accessibilityLabel(String(format: T("Move %@ to another stage"), deal.name))
    }

    @ViewBuilder private var stageButtons: some View {
        ForEach(stages, id: \.self) { s in
            Button { onMove(deal.id, s) } label: {
                if s == deal.stage { Label(PipelineText.stage(s), systemImage: "checkmark") } else { Text(PipelineText.stage(s)) }
            }
            .disabled(s == deal.stage)
        }
    }
}

// MARK: - Table

/// One compact row per deal, sortable, with totals. Read here, edited in the deal sheet: inline editing
/// in rows this small is the web's, on a mouse; a phone gets the sheet's bigger targets instead.
struct PipelineTable: View {
    let deals: [PipelineDeal]
    let stages: [String]
    let wide: Bool
    let onOpen: (String) -> Void
    let onRefresh: () async -> Void

    enum SortKey: String, CaseIterable, Identifiable {
        case urgency, name, stage, value, receivable, overdue, nextDate
        var id: String { rawValue }
        var label: String {
            switch self {
            case .urgency: return T("Most urgent first")
            case .name: return T("Deal")
            case .stage: return T("Stage")
            case .value: return T("Net value")
            case .receivable: return T("Receivable")
            case .overdue: return T("Days overdue")
            case .nextDate: return T("Next action date")
            }
        }
    }

    @State private var sort: SortKey = .urgency
    @State private var ascending = true

    private var rows: [PipelineDeal] {
        let stageIndex = Dictionary(stages.enumerated().map { ($1, $0) }, uniquingKeysWith: { a, _ in a })
        let sorted: [PipelineDeal]
        switch sort {
        case .urgency: sorted = deals.sorted(by: PipelineDeal.bySeverity)
        case .name: sorted = deals.sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
        case .stage: sorted = deals.sorted { (stageIndex[$0.stage] ?? 99) < (stageIndex[$1.stage] ?? 99) }
        // Money and lateness read biggest first by default — the question is "where is the most".
        case .value: sorted = deals.sorted { $0.netValue > $1.netValue }
        case .receivable: sorted = deals.sorted { $0.outstandingReceivable > $1.outstandingReceivable }
        case .overdue: sorted = deals.sorted { $0.daysOverdue > $1.daysOverdue }
        // No date goes last whichever way.
        case .nextDate: sorted = deals.sorted { ($0.nextActionDate ?? "9999") < ($1.nextActionDate ?? "9999") }
        }
        return ascending ? sorted : sorted.reversed()
    }

    var body: some View {
        let list = rows
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 0, pinnedViews: wide ? [.sectionHeaders] : []) {
                Section {
                    ForEach(list) { d in
                        Button { onOpen(d.id) } label: { wide ? AnyView(wideRow(d)) : AnyView(compactRow(d)) }
                            .buttonStyle(.plain)
                            .hoverEffect(.highlight)
                        Divider().overlay(NX.border)
                    }
                    totals(list)
                } header: {
                    VStack(spacing: 0) {
                        sortBar
                        if wide { wideHeader }
                        Divider().overlay(NX.border)
                    }
                    .background(NX.background)
                }
            }
            .padding(.bottom, 20)
        }
        .refreshable { await onRefresh() }
    }

    private var sortBar: some View {
        HStack(spacing: 8) {
            Menu {
                ForEach(SortKey.allCases) { k in
                    Button {
                        if sort == k { ascending.toggle() } else { sort = k; ascending = true }
                    } label: {
                        if sort == k { Label(k.label, systemImage: ascending ? "checkmark" : "arrow.up.arrow.down") } else { Text(k.label) }
                    }
                }
            } label: {
                HStack(spacing: 5) {
                    Image(systemName: "arrow.up.arrow.down").font(.system(size: 11, weight: .bold))
                    Text(sort.label).font(NXFont.text(12, .semibold))
                }
                .foregroundStyle(NX.violetText)
            }
            .menuIndicator(.hidden)
            .accessibilityLabel(T("Sort"))
            if sort != .urgency || !ascending {
                Button { ascending.toggle() } label: {
                    Image(systemName: ascending ? "chevron.down" : "chevron.up").font(.system(size: 11, weight: .bold)).foregroundStyle(NX.mutedFg)
                        .frame(width: 28, height: 28).contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
            Spacer()
        }
        .padding(.horizontal, 14).padding(.vertical, 6)
    }

    private var wideHeader: some View {
        HStack(spacing: 10) {
            head(T("Code")).frame(width: 78, alignment: .leading)
            head(T("Deal")).frame(maxWidth: .infinity, alignment: .leading)
            head(T("Stage")).frame(width: 150, alignment: .leading)
            head(T("Prob.")).frame(width: 44, alignment: .trailing)
            head(T("Net value")).frame(width: 96, alignment: .trailing)
            head(T("Receivable")).frame(width: 96, alignment: .trailing)
            head(T("Overdue")).frame(width: 56, alignment: .trailing)
            head(T("Next action")).frame(maxWidth: .infinity, alignment: .leading)
            head(T("Health")).frame(width: 88, alignment: .leading)
        }
        .padding(.horizontal, 14).padding(.vertical, 7)
    }

    private func head(_ text: String) -> some View {
        Text(text.uppercased()).font(NXFont.text(10, .bold)).tracking(0.4).foregroundStyle(NX.mutedFg).lineLimit(1)
    }

    private func wideRow(_ d: PipelineDeal) -> some View {
        HStack(spacing: 10) {
            Text(d.code).font(NXFont.text(11)).foregroundStyle(NX.mutedFg).monospacedDigit().frame(width: 78, alignment: .leading)
            VStack(alignment: .leading, spacing: 1) {
                Text(d.name.isEmpty ? T("Untitled deal") : d.name).font(NXFont.text(13, .semibold)).foregroundStyle(NX.foreground).lineLimit(1)
                Text([d.brand, d.pmDisplay.map { "PM \($0)" } ?? ""].filter { !$0.isEmpty }.joined(separator: " · "))
                    .font(NXFont.text(11)).foregroundStyle(NX.mutedFg).lineLimit(1)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            HStack(spacing: 6) {
                Circle().fill(PipelineStyle.groupTone(d.stage)).frame(width: 6, height: 6)
                Text(PipelineText.stage(d.stage)).font(NXFont.text(12)).foregroundStyle(NX.foreground).lineLimit(1)
            }
            .frame(width: 150, alignment: .leading)
            Text(PipelineFormat.pct(d.probability)).font(NXFont.text(12)).foregroundStyle(NX.mutedFg).monospacedDigit()
                .frame(width: 44, alignment: .trailing)
            Text(d.netValue != 0 ? PipelineFormat.idr(d.netValue) : "–").font(NXFont.text(12, .semibold)).foregroundStyle(NX.foreground)
                .monospacedDigit().frame(width: 96, alignment: .trailing)
            Text(d.outstandingReceivable != 0 ? PipelineFormat.idr(d.outstandingReceivable) : "–").font(NXFont.text(12))
                .foregroundStyle(NX.foreground).monospacedDigit().frame(width: 96, alignment: .trailing)
            overdueText(d).frame(width: 56, alignment: .trailing)
            VStack(alignment: .leading, spacing: 1) {
                Text(d.nextAction.isEmpty ? "–" : d.nextAction).font(NXFont.text(12)).foregroundStyle(NX.foreground).lineLimit(1)
                if d.nextActionDate != nil {
                    Text(PipelineFormat.day(d.nextActionDate)).font(NXFont.text(11)).foregroundStyle(NX.mutedFg)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            Group {
                if d.health.key != "NONE" { PipelineHealthPill(key: d.health.key) } else { Text("–").foregroundStyle(NX.mutedFg) }
            }
            .frame(width: 88, alignment: .leading)
        }
        .padding(.horizontal, 14).padding(.vertical, 9)
        .contentShape(Rectangle())
    }

    private func compactRow(_ d: PipelineDeal) -> some View {
        HStack(alignment: .top, spacing: 10) {
            Circle().fill(PipelineStyle.healthDot(d.health.key)).frame(width: 8, height: 8).padding(.top, 5)
                .accessibilityLabel(PipelineText.health(d.health.key))
            VStack(alignment: .leading, spacing: 3) {
                Text(d.name.isEmpty ? T("Untitled deal") : d.name).font(NXFont.text(14, .semibold)).foregroundStyle(NX.foreground).lineLimit(1)
                Text([d.code, PipelineText.stage(d.stage), d.pmDisplay.map { "PM \($0)" } ?? ""].filter { !$0.isEmpty }.joined(separator: " · "))
                    .font(NXFont.text(11)).foregroundStyle(NX.mutedFg).lineLimit(1)
                if !d.nextAction.isEmpty {
                    Text(d.nextActionDate.map { "\(PipelineFormat.day($0)) · \(d.nextAction)" } ?? d.nextAction)
                        .font(NXFont.text(11)).foregroundStyle(NX.mutedFg).lineLimit(1)
                }
            }
            Spacer(minLength: 6)
            VStack(alignment: .trailing, spacing: 3) {
                Text(d.netValue != 0 ? PipelineFormat.idr(d.netValue) : "–").font(NXFont.text(13, .bold)).foregroundStyle(NX.foreground).monospacedDigit()
                if d.outstandingReceivable > 0 {
                    HStack(spacing: 4) {
                        Text(PipelineFormat.idr(d.outstandingReceivable)).font(NXFont.text(11)).foregroundStyle(NX.mutedFg).monospacedDigit()
                        overdueText(d)
                    }
                }
            }
        }
        .padding(.horizontal, 14).padding(.vertical, 10)
        .contentShape(Rectangle())
    }

    @ViewBuilder private func overdueText(_ d: PipelineDeal) -> some View {
        if d.daysOverdue > 0 {
            Text(String(format: T("%dd"), d.daysOverdue)).font(NXFont.text(11, .bold)).monospacedDigit()
                .foregroundStyle(d.daysOverdue > 7 ? ChipTone.danger.fg : ChipTone.warning.fg)
        } else {
            Text("–").font(NXFont.text(11)).foregroundStyle(NX.mutedFg)
        }
    }

    private func totals(_ list: [PipelineDeal]) -> some View {
        let net = list.reduce(0) { $0 + $1.netValue }
        let receivable = list.reduce(0) { $0 + $1.outstandingReceivable }
        return HStack(spacing: 10) {
            Text(String(format: T("%d deals"), list.count)).font(NXFont.text(12, .bold)).foregroundStyle(NX.foreground)
            Spacer()
            VStack(alignment: .trailing, spacing: 2) {
                Text("\(T("Net value")) \(PipelineFormat.idrFull(net))").font(NXFont.text(12, .bold)).foregroundStyle(NX.foreground).monospacedDigit()
                Text("\(T("Receivable")) \(PipelineFormat.idrFull(receivable))").font(NXFont.text(11)).foregroundStyle(NX.mutedFg).monospacedDigit()
            }
        }
        .padding(.horizontal, 14).padding(.vertical, 12)
        .background(NX.muted.opacity(0.6))
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Health

/// What needs someone today: Critical and Attention deals with their reasons, then next actions by when
/// they are due, payments that are late, and every blocker — so a weekly review runs top to bottom
/// without opening each deal (web: PipelineHealth).
struct PipelineHealthView: View {
    let deals: [PipelineDeal]
    let today: String
    let wide: Bool
    let onOpen: (String) -> Void
    let onRefresh: () async -> Void

    private var live: [PipelineDeal] { deals.filter { $0.stageGroup != "Lost" && $0.stageGroup != "Closed" } }
    private var flagged: [PipelineDeal] {
        deals.filter { $0.health.key == "CRITICAL" || $0.health.key == "ATTENTION" }.sorted(by: PipelineDeal.bySeverity)
    }
    private var actions: [PipelineDeal] {
        live.filter { d in
            guard let date = d.nextActionDate, let n = PipelineFormat.daysBetween(today, date) else { return false }
            return n <= 7
        }
        .sorted { ($0.nextActionDate ?? "") < ($1.nextActionDate ?? "") }
    }
    private var late: [PipelineDeal] {
        deals.filter { $0.daysOverdue > 0 && $0.outstandingReceivable > 0 }.sorted { $0.daysOverdue > $1.daysOverdue }
    }
    private var blockers: [PipelineDeal] { live.filter { !$0.blocker.isEmpty }.sorted(by: PipelineDeal.bySeverity) }

    var body: some View {
        ScrollView {
            Group {
                if wide {
                    HStack(alignment: .top, spacing: 16) {
                        needsAttention.frame(maxWidth: .infinity)
                        VStack(spacing: 16) { nextActions; latePayments; blockerList }.frame(maxWidth: .infinity)
                    }
                } else {
                    VStack(spacing: 14) { needsAttention; nextActions; latePayments; blockerList }
                }
            }
            .padding(14)
        }
        .refreshable { await onRefresh() }
    }

    private var needsAttention: some View {
        let healthy = deals.filter { $0.health.key == "HEALTHY" }.count
        let notStarted = deals.filter { $0.health.key == "NOT_STARTED" }.count
        return PipelinePanel(icon: "exclamationmark.triangle", title: T("Needs attention"),
                             meta: String(format: T("%d healthy · %d not started"), healthy, notStarted)) {
            if flagged.isEmpty {
                calm(T("Nothing critical and nothing waiting on attention. Deals in execution are on track."))
            } else {
                ForEach(Array(flagged.enumerated()), id: \.element.id) { i, d in
                    if i > 0 { Divider().overlay(NX.border) }
                    Button { onOpen(d.id) } label: {
                        VStack(alignment: .leading, spacing: 6) {
                            HStack(alignment: .firstTextBaseline, spacing: 8) {
                                PipelineHealthPill(key: d.health.key)
                                Text(d.name.isEmpty ? T("Untitled deal") : d.name).font(NXFont.text(14, .semibold)).foregroundStyle(NX.foreground).lineLimit(1)
                                Spacer(minLength: 4)
                                Text(PipelineFormat.idr(d.netValue)).font(NXFont.text(12)).foregroundStyle(NX.mutedFg).monospacedDigit()
                            }
                            Text([d.code, PipelineText.stage(d.stage), d.pmDisplay.map { "PM \($0)" } ?? ""].filter { !$0.isEmpty }.joined(separator: " · "))
                                .font(NXFont.text(11)).foregroundStyle(NX.mutedFg).lineLimit(1)
                            PipelineReasonList(health: d.health)
                        }
                        .padding(.horizontal, 14).padding(.vertical, 11)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }

    private var nextActions: some View {
        let overdue = actions.filter { ($0.nextActionDate ?? "") < today }
        let dueToday = actions.filter { $0.nextActionDate == today }
        let week = actions.filter { ($0.nextActionDate ?? "") > today }
        let groups = [
            PipelineAgendaGroup(label: T("Overdue"), deals: overdue, tone: ChipTone.danger.fg),
            PipelineAgendaGroup(label: T("Today"), deals: dueToday, tone: NX.foreground),
            PipelineAgendaGroup(label: T("This week"), deals: week, tone: NX.mutedFg),
        ]
        return PipelinePanel(icon: "calendar.badge.clock", title: T("Next actions"), meta: T("Due within 7 days")) {
            if actions.isEmpty {
                calm(T("No next action is due this week. Give each live deal a next step and a date, and it shows up here."))
            } else {
                ForEach(groups.filter { !$0.deals.isEmpty }) { group in
                    VStack(alignment: .leading, spacing: 6) {
                        Text(group.label.uppercased()).font(NXFont.text(10, .bold)).tracking(0.4).foregroundStyle(group.tone)
                        ForEach(group.deals) { d in
                            Button { onOpen(d.id) } label: {
                                VStack(alignment: .leading, spacing: 1) {
                                    HStack(alignment: .firstTextBaseline) {
                                        Text(d.name.isEmpty ? T("Untitled deal") : d.name).font(NXFont.text(13, .semibold)).foregroundStyle(NX.foreground).lineLimit(1)
                                        Spacer(minLength: 4)
                                        Text(PipelineFormat.day(d.nextActionDate)).font(NXFont.text(11)).foregroundStyle(NX.mutedFg).monospacedDigit()
                                    }
                                    Text(d.nextAction.isEmpty ? T("No next action written") : d.nextAction)
                                        .font(NXFont.text(12)).foregroundStyle(NX.mutedFg).lineLimit(2)
                                }
                                .contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    .padding(.horizontal, 14).padding(.vertical, 10)
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
        }
    }

    private var latePayments: some View {
        let sum = late.reduce(0) { $0 + $1.outstandingReceivable }
        return PipelinePanel(icon: "creditcard", title: T("Late payments"), meta: late.isEmpty ? nil : PipelineFormat.idr(sum)) {
            if late.isEmpty {
                calm(T("No receivable is past its due date."))
            } else {
                ForEach(Array(late.enumerated()), id: \.element.id) { i, d in
                    if i > 0 { Divider().overlay(NX.border) }
                    Button { onOpen(d.id) } label: {
                        HStack(alignment: .firstTextBaseline, spacing: 8) {
                            VStack(alignment: .leading, spacing: 1) {
                                Text(d.name.isEmpty ? T("Untitled deal") : d.name).font(NXFont.text(13, .semibold)).foregroundStyle(NX.foreground).lineLimit(1)
                                Text("\(d.paymentStatus) · \(PipelineFormat.idr(d.outstandingReceivable))").font(NXFont.text(11)).foregroundStyle(NX.mutedFg)
                            }
                            Spacer(minLength: 4)
                            Text(String(format: T(d.daysOverdue == 1 ? "%d day" : "%d days"), d.daysOverdue))
                                .font(NXFont.text(13, .bold)).monospacedDigit()
                                .foregroundStyle(d.daysOverdue > 7 ? ChipTone.danger.fg : ChipTone.warning.fg)
                        }
                        .padding(.horizontal, 14).padding(.vertical, 10)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }

    private var blockerList: some View {
        PipelinePanel(icon: "exclamationmark.octagon", title: T("Blockers"), meta: blockers.isEmpty ? nil : "\(blockers.count)") {
            if blockers.isEmpty {
                calm(T("No live deal has a blocker written down."))
            } else {
                ForEach(Array(blockers.enumerated()), id: \.element.id) { i, d in
                    if i > 0 { Divider().overlay(NX.border) }
                    Button { onOpen(d.id) } label: {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(d.name.isEmpty ? T("Untitled deal") : d.name).font(NXFont.text(13, .semibold)).foregroundStyle(NX.foreground).lineLimit(1)
                            Text(d.blocker).font(NXFont.text(12)).foregroundStyle(ChipTone.warning.fg).multilineTextAlignment(.leading)
                        }
                        .padding(.horizontal, 14).padding(.vertical, 10)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }

    private func calm(_ text: String) -> some View {
        HStack(alignment: .top, spacing: 8) {
            Image(systemName: "checkmark.circle").font(.system(size: 14, weight: .semibold)).foregroundStyle(ChipTone.success.fg)
            Text(text).font(NXFont.text(13)).foregroundStyle(NX.mutedFg).fixedSize(horizontal: false, vertical: true)
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// Overdue / Today / This week in the Next actions panel.
private struct PipelineAgendaGroup: Identifiable {
    let label: String
    let deals: [PipelineDeal]
    let tone: Color
    var id: String { label }
}

struct PipelinePanel<Content: View>: View {
    let icon: String
    let title: String
    var meta: String? = nil
    @ViewBuilder let content: () -> Content

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 8) {
                Image(systemName: icon).font(.system(size: 13, weight: .semibold)).foregroundStyle(NX.mutedFg)
                Text(title).font(NXFont.text(14, .bold)).foregroundStyle(NX.foreground)
                Spacer(minLength: 6)
                if let meta { Text(meta).font(NXFont.text(11)).foregroundStyle(NX.mutedFg).monospacedDigit() }
            }
            .padding(.horizontal, 14).padding(.vertical, 11)
            Divider().overlay(NX.border)
            content()
        }
        .background(NX.card, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).strokeBorder(NX.border))
    }
}

/// A deal's reasons as small tinted lines, red while it is critical, amber while it needs attention.
struct PipelineReasonList: View {
    let health: PipelineHealth
    var body: some View {
        let tone: ChipTone = health.key == "CRITICAL" ? .danger : .warning
        VStack(alignment: .leading, spacing: 4) {
            ForEach(Array(health.reasons.enumerated()), id: \.offset) { _, r in
                Text(PipelineText.reason(r))
                    .font(NXFont.text(11, .semibold)).foregroundStyle(tone.fg)
                    .padding(.horizontal, 7).padding(.vertical, 3)
                    .background(tone.bg, in: RoundedRectangle(cornerRadius: 6, style: .continuous))
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }
}
