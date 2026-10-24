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
    let workspaceId: String?
    let isAll: Bool
    private(set) var boards: [PipelineBoardRef] = []
    private(set) var years: [Int] = []
    /// View-only filters; the server computes the same KPIs over exactly this year/company.
    var year: Int? { didSet { if year != oldValue { scopeError = nil } } }
    var source: String? { didSet { if source != oldValue { scopeError = nil } } }
    private(set) var scopeError: String?
    private(set) var appliedYear: Int?
    private(set) var appliedSource: String?
    /// Never label the previous scope's deals or KPIs as a newly selected year/company.
    var hasUnappliedScope: Bool { loaded && (year != appliedYear || source != appliedSource) }
    private(set) var deals: [PipelineDeal] = []
    private(set) var summary = PipelineSummary()
    private(set) var vocab = PipelineVocab.fallback
    private(set) var today = PipelineFormat.today
    private(set) var people: [PipelinePerson] = []
    private(set) var loaded = false
    /// May the viewer change deals (Full / Can edit)? Only after the server grants it.
    private(set) var canEdit = false
    /// Bumped on every successful read, so an open deal's History refetches with it.
    private(set) var revision = 0
    var loadError: String?
    var forbidden = false
    var signedOut = false
    /// A refused write, in the server's words when it gave some.
    var actionError: String?
    /// A one-line confirmation ("… deleted. Control Room → Audit can restore it.").
    var notice: String?
    /// When the project's members were last read for the BD/PM pickers (a member the lead adds shows up
    /// within a minute, without reading the project on every edit's reload).
    @ObservationIgnored private var peopleAt: Date?
    @ObservationIgnored private var readGeneration = 0

    init(projectId: String, workspaceId: String? = nil, isAll: Bool = false) {
        self.projectId = projectId
        self.workspaceId = workspaceId
        self.isAll = isAll
    }

    func deal(_ id: String) -> PipelineDeal? { deals.first { $0.id == id } }

    /// The first load and every quiet reload. A reload that fails leaves what is drawn alone.
    func load() async {
        readGeneration += 1
        let generation = readGeneration
        let requestedYear = year
        let requestedSource = source
        scopeError = nil
        do {
            if isAll {
                let r = try await APIClient.shared.pipelineAll(workspaceId: workspaceId, source: requestedSource, year: requestedYear)
                guard generation == readGeneration && year == requestedYear && source == requestedSource else { return }
                deals = r.deals; summary = r.summary; vocab = r.vocab
                today = r.today ?? PipelineFormat.today
                boards = r.boards; years = r.years
                canEdit = false
            } else {
                let r = try await APIClient.shared.pipeline(projectId: projectId, year: requestedYear)
                guard generation == readGeneration && year == requestedYear else { return }
                deals = r.deals; summary = r.summary; vocab = r.vocab
                today = r.today ?? PipelineFormat.today
                years = r.years
                canEdit = r.canEdit
            }
            loadError = nil
            appliedYear = requestedYear
            appliedSource = requestedSource
            forbidden = false
            loaded = true
            revision += 1
            if !isAll && (people.isEmpty || (peopleAt.map { Date().timeIntervalSince($0) > 60 } ?? true)) {
                await loadPeople()
            }
        }
        catch {
            guard generation == readGeneration && year == requestedYear && source == requestedSource else { return }
            switch error {
            case APIError.unauthorized: signedOut = true
            case APIError.http(403, _): forbidden = true; canEdit = false
            default:
                let message = (error as? LocalizedError)?.errorDescription ?? T("Check your connection, then try again.")
                if !loaded { loadError = message }
                else if hasUnappliedScope { scopeError = message }
            }
        }
    }

    /// Item endpoints answer the whole deal, including derived budget totals and remaining amounts.
    func replaceDeal(_ saved: PipelineDeal) {
        if let i = deals.firstIndex(where: { $0.id == saved.id }) { deals[i] = saved }
        revision += 1
    }

    func reportFailure(_ error: Error, fallback: String) { fail(error, fallback) }

    /// BD and PM are picked from the board's own members (owner, 9 Oct 2026: access to the pipeline is
    /// project membership, added by its lead like a task project).
    private func loadPeople() async {
        guard let members = try? await APIClient.shared.pipelinePeople(projectId: projectId) else { return }
        peopleAt = Date()
        people = members.compactMap { m -> PipelinePerson? in
            guard !m.uid.isEmpty else { return nil }
            return PipelinePerson(id: m.uid, name: m.user?.name, avatar: m.user?.avatar)
        }
        .sorted { ($0.name ?? "").localizedCaseInsensitiveCompare($1.name ?? "") == .orderedAscending }
    }

    /// One edit. The card changes at once; the server's answer (health, phases) replaces it, and a
    /// reload brings the KPIs along. A refusal puts the deal back as it was and says why.
    @discardableResult
    func patch(_ id: String, _ fields: [String: Any]) async -> Bool {
        guard canEdit && !isAll else { return false }
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

    /// "Create execution project" (owner, 10 Oct 2026): the deal's folder with its Master Calendar and
    /// Master Task, made now or the one it already has. Answers the folder to open — or, from a server
    /// without folders, the project — or nil after showing the refusal.
    func createExecution(_ id: String) async -> PipelineExecutionTarget? {
        do {
            let r = try await APIClient.shared.pipelineCreateExecution(projectId: projectId, dealId: id)
            if let saved = r.deal, let j = deals.firstIndex(where: { $0.id == id }) { deals[j] = saved }
            let name = r.deal?.executionProject?.name ?? deal(id)?.name ?? ""
            await load()
            if let folderId = r.folderId ?? r.deal?.executionFolderId { return .folder(folderId) }
            return .project(ProjectRef(id: r.projectId, name: name, icon: nil))
        } catch {
            fail(error, T("The execution project wasn't created. Try again."))
            return nil
        }
    }

    func create(_ fields: [String: Any]) async -> PipelineDeal? {
        guard canEdit && !isAll else { return nil }
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
        guard canEdit && !isAll else { return false }
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

    // MARK: payment terms (owner, 9 Oct 2026: "perlu per termin")

    /// Add, edit or mark paid: the server answers the whole deal (receivable, status, health moved with
    /// the term), which replaces the local one; a reload brings the KPIs. Refusals go to `actionError`.
    @discardableResult
    func addTerm(_ dealId: String, _ fields: [String: Any]) async -> Bool {
        await termWrite(T("The payment term wasn't added. Try again.")) {
            try await APIClient.shared.pipelineAddTerm(projectId: self.projectId, dealId: dealId, fields: fields)
        }
    }

    @discardableResult
    func updateTerm(_ dealId: String, _ termId: String, _ fields: [String: Any]) async -> Bool {
        await termWrite(T("That change wasn't saved. Try again.")) {
            try await APIClient.shared.pipelineUpdateTerm(projectId: self.projectId, dealId: dealId, termId: termId, fields: fields)
        }
    }

    /// Restorable from Control Room → Audit, which the notice says.
    @discardableResult
    func deleteTerm(_ dealId: String, _ term: PipelineTerm) async -> Bool {
        let ok = await termWrite(T("The payment term wasn't deleted. Try again.")) {
            try await APIClient.shared.pipelineDeleteTerm(projectId: self.projectId, dealId: dealId, termId: term.id)
        }
        if ok { notice = String(format: T("%@ deleted. Control Room → Audit can restore it."), term.label) }
        return ok
    }

    private func termWrite(_ fallback: String, _ call: () async throws -> PipelineTermResponse) async -> Bool {
        do {
            let r = try await call()
            if let saved = r.deal, let j = deals.firstIndex(where: { $0.id == saved.id }) { deals[j] = saved }
            await load()
            return true
        } catch {
            fail(error, fallback)
            return false
        }
    }

    // MARK: documents (owner, 9 Oct 2026: "kenapa ga attach documentnya jg?")

    /// One file onto a deal's "Documents & links". The server adds the entry; a reload shows it.
    @discardableResult
    func uploadDocument(_ dealId: String, file: URL, fileName: String, type: String, label: String,
                        progress: UploadProgress?) async -> Bool {
        do {
            try await APIClient.shared.pipelineUploadDocument(projectId: projectId, dealId: dealId, file: file, fileName: fileName,
                                                              type: type, label: label, progress: progress)
            await load()
            return true
        } catch {
            fail(error, String(format: T("%@ wasn't attached. Try again."), fileName))
            return false
        }
    }

    /// A link or a file off the deal; the answer's deal replaces the local one.
    @discardableResult
    func removeDocument(_ dealId: String, _ doc: PipelineLink) async -> Bool {
        do {
            let r = try await APIClient.shared.pipelineRemoveDocument(projectId: projectId, dealId: dealId, docId: doc.id)
            if let saved = r.deal, let j = deals.firstIndex(where: { $0.id == saved.id }) { deals[j] = saved }
            await load()
            return true
        } catch {
            fail(error, T("That change wasn't saved. Try again."))
            return false
        }
    }

    func history(_ id: String) async throws -> PipelineDealDetail {
        try await APIClient.shared.pipelineDeal(projectId: projectId, dealId: id)
    }

    func exportFile() async -> URL? {
        do {
            if isAll {
                return try await APIClient.shared.pipelineAllExport(lang: AppLanguage.shared.lang.rawValue,
                    workspaceId: workspaceId, source: source, year: year)
            }
            return try await APIClient.shared.pipelineExport(projectId: projectId, lang: AppLanguage.shared.lang.rawValue, year: year)
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
    /// A service, preset or typed (owner, 9 Oct 2026: a deal has several).
    @State private var serviceFilter = ""
    @State private var healthFilter = ""
    @State private var route: PipelineRoute?
    @State private var exporting = false
    /// Shared only for the signed-in app session, so switching boards never exposes amounts.
    @State private var presentation = PipelinePresentationSession.shared
    @State private var directory = PipelineBoardDirectory.shared

    private var presenting: Bool { presentation.isPresenting }

    init(projectId: String, newDealRequest: Int) {
        self.projectId = projectId
        self.newDealRequest = newDealRequest
        _store = State(initialValue: PipelineStore(projectId: projectId))
    }

    init(allIn workspaceId: String?) {
        projectId = ""
        newDealRequest = 0
        _store = State(initialValue: PipelineStore(projectId: "", workspaceId: workspaceId, isAll: true))
    }

    private var mode: PipelineMode { PipelineMode(rawValue: modeRaw) ?? .board }
    private var wide: Bool { hSize == .regular }

    private var filtering: Bool {
        store.year != nil || store.source != nil || !search.trimmingCharacters(in: .whitespaces).isEmpty || !pmFilter.isEmpty || !bdFilter.isEmpty || !serviceFilter.isEmpty || !healthFilter.isEmpty
    }

    /// Search covers name, code, brand, BD and PM, like the web. Filters never change the KPIs.
    private var shown: [PipelineDeal] {
        let needle = search.trimmingCharacters(in: .whitespaces).lowercased()
        return store.deals.filter { d in
            if !healthFilter.isEmpty && d.health.key != healthFilter { return false }
            if !pmFilter.isEmpty && d.pmDisplay != pmFilter { return false }
            if !bdFilter.isEmpty && d.bdDisplay != bdFilter { return false }
            if !serviceFilter.isEmpty && !d.services.contains(serviceFilter) { return false }
            if !needle.isEmpty {
                let hay = ([d.code, d.name, d.brand, d.pmDisplay ?? "", d.bdDisplay ?? ""] + d.services).joined(separator: " ").lowercased()
                if !hay.contains(needle) { return false }
            }
            return true
        }
    }

    private var pmNames: [String] { Array(Set(store.deals.compactMap(\.pmDisplay))).sorted() }
    private var bdNames: [String] { Array(Set(store.deals.compactMap(\.bdDisplay))).sorted() }
    private var serviceNames: [String] { Array(Set(store.deals.flatMap(\.services))).sorted() }

    var body: some View {
        Group {
            if store.forbidden {
                EmptyState(icon: "lock", title: T(store.isAll ? "All Pipelines is for BoD and One Above All" : "This pipeline is for its project members"),
                           subtitle: T("Ask the Project Owner or a board member to add you to the project."))
            } else if !store.loaded {
                if let err = store.loadError {
                    ErrorState(message: err, icon: "chart.bar.doc.horizontal") {
                        Task { store.loadError = nil; await store.load() }
                    }
                } else {
                    ProgressView().tint(NX.violetText).frame(maxWidth: .infinity, maxHeight: .infinity)
                        .accessibilityLabel(T("Loading the pipeline"))
                }
            } else if store.hasUnappliedScope {
                pendingScope
            } else if store.deals.isEmpty && !filtering && !store.isAll {
                ScrollView {
                    EmptyState(icon: "line.3.horizontal.decrease.circle", title: T("No deals in this pipeline yet"),
                               subtitle: T("Every client job goes here, from the first brief to paid and closed. Add the first one, then BD, Legal, PM and Finance fill in their parts on the same card."),
                               actionTitle: store.canEdit ? T("Add your first deal") : nil,
                               action: store.canEdit ? { route = .newDeal("Incoming") } : nil)
                        .frame(minHeight: 440)
                }
                .refreshable { await store.load() }
            } else {
                VStack(spacing: 0) {
                    header
                    Divider().overlay(NX.border)
                    content
                }
                .environment(\.pipelinePresenting, presenting)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .task {
            await store.load()
        }
        .liveRefresh(every: 60, on: store.isAll ? [] : [.nexusPipelineChanged], projectId: store.isAll ? nil : projectId) {
            if !store.isAll || directory.canView { await store.load() }
        }
        .onReceive(NotificationCenter.default.publisher(for: .nexusPipelineChanged)) { note in
            guard store.isAll && directory.canView else { return }
            if let changed = note.userInfo?[RealtimeKey.projectId] as? String,
               !store.boards.contains(where: { $0.id == changed }) { return }
            Task { await store.load() }
        }
        .modifier(PipelineBoardRooms(boardIds: store.isAll ? store.boards.map(\.id) : []))
        .onChange(of: store.forbidden) { _, forbidden in
            if forbidden && store.isAll { directory.hide() }
        }
        .onChange(of: newDealRequest) { _, _ in if store.canEdit && !store.isAll { route = .newDeal("Incoming") } }
        .onChange(of: store.signedOut) { _, out in if out { auth.logout() } }
        .sheet(item: $route) { r in sheet(r).environment(\.pipelinePresenting, presenting) }
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
            if store.isAll, let source = store.deal(id)?.source {
                PipelineSourceDealSheet(projectId: source.projectId, sourceName: source.name, dealId: id)
            } else {
                PipelineDealView(store: store, dealId: id)
            }
        case .newDeal(let stage):
            // The GM's flow: the new deal opens straight away, for BD, Legal, PM and Finance to fill in.
            PipelineNewDealSheet(store: store, stage: stage) { deal in route = .deal(deal.id) }
        case .export(let url):
            ActivityView(items: [url])
        }
    }

    // MARK: header

    private var pendingScope: some View {
        VStack(spacing: 0) {
            scopeFilters.padding(.horizontal, 16).padding(.vertical, 12)
            Divider().overlay(NX.border)
            if let error = store.scopeError {
                ErrorState(message: error, icon: "chart.bar.doc.horizontal") { Task { await store.load() } }
            } else {
                ProgressView().tint(NX.violetText).frame(maxWidth: .infinity, maxHeight: .infinity)
                    .accessibilityLabel(T("Loading the pipeline"))
            }
        }
    }

    private var scopeFilters: some View {
        HStack(spacing: 8) {
            if store.isAll { companyPicker }
            yearPicker
            if !store.isAll { Spacer(minLength: 0) }
        }
    }

    /// Owner, 9 Oct 2026 ("UI UX di hape jg sempit bgt, tolong di rapihkan biar nyaman"): on a phone the
    /// header is four calm rows — the KPI chips scrolling sideways, search across the width with one menu
    /// for the PM/BD filters and Excel, a standard segmented Board · Table · Health, then the health chips.
    /// On an iPad or a Mac search, the switch and the menu share a row. Every sideways scroller is held to
    /// its content's height: a horizontal ScrollView otherwise takes all the height it is offered, which is
    /// what turned the KPI strip into a tall, mostly empty card.
    private var header: some View {
        VStack(alignment: .leading, spacing: 10) {
            PipelineKpiStrip(summary: store.summary, wide: wide)
            scopeFilters
            if wide {
                HStack(spacing: 10) {
                    searchField.frame(maxWidth: 380)
                    modePicker.frame(maxWidth: 320)
                    Spacer(minLength: 0)
                    presentationToggle
                    moreMenu
                }
            } else {
                HStack(spacing: 8) {
                    searchField
                    presentationToggle
                    moreMenu
                }
                modePicker
            }
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(["", "CRITICAL", "ATTENTION", "HEALTHY", "NOT_STARTED"], id: \.self) { healthChip($0) }
                }
                .padding(.vertical, 1)
            }
            .fixedSize(horizontal: false, vertical: true)
            if filtering {
                HStack(spacing: 10) {
                    Text(String(format: T("%d of %d deals"), shown.count, store.deals.count))
                        .font(NXFont.text(12)).foregroundStyle(NX.mutedFg).monospacedDigit()
                    Button(T("Clear filters")) { resetFilters() }
                        .font(NXFont.text(12, .semibold)).foregroundStyle(NX.violetText)
                }
            }
        }
        .padding(.horizontal, 16).padding(.top, 12).padding(.bottom, 10)
    }

    private var searchField: some View {
        HStack(spacing: 8) {
            Image(systemName: "magnifyingglass").font(.system(size: 14, weight: .semibold)).foregroundStyle(NX.mutedFg)
            TextField(T("Search deal, brand, code, BD or PM…"), text: $search)
                .font(NXFont.text(15)).foregroundStyle(NX.foreground)
                .textInputAutocapitalization(.never).autocorrectionDisabled().submitLabel(.search)
            if !search.isEmpty {
                Button { search = "" } label: {
                    Image(systemName: "xmark.circle.fill").font(.system(size: 15)).foregroundStyle(NX.mutedFg)
                        .frame(width: 28, height: 28).touchTarget44(drawn: 28)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(T("Clear filters"))
            }
        }
        .padding(.horizontal, 12).frame(height: 42)
        .frame(maxWidth: .infinity)
        .background(NX.card, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(search.isEmpty ? NX.border : NX.violet.opacity(0.55)))
        .accessibilityLabel(T("Search deals"))
    }

    /// The eye: presentation mode on and off (R-20). Tinted while it is on, so nobody forgets it.
    private var presentationToggle: some View {
        Button {
            withAnimation(.easeOut(duration: 0.15)) { presentation.isPresenting.toggle() }
        } label: {
            Image(systemName: presenting ? "eye.slash" : "eye")
                .font(.system(size: 17, weight: .semibold))
                .foregroundStyle(presenting ? NX.violetText : NX.foreground)
                .frame(width: 42, height: 42)
                .background(presenting ? NX.violet.opacity(0.12) : NX.card, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(presenting ? NX.violet.opacity(0.55) : NX.border))
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("pipeline.presentation")
        .accessibilityLabel(T("Presentation mode"))
        .accessibilityValue(presenting ? T("On") : T("Off"))
        .accessibilityHint(presenting ? T("Amounts are hidden. Tap to show them.") : T("Hides every amount on screen"))
        .accessibilityAddTraits(presenting ? .isSelected : [])
    }

    /// PM and BD filters and the Excel download, in one menu next to search (no row of small buttons).
    private var moreMenu: some View {
        let active = !pmFilter.isEmpty || !bdFilter.isEmpty || !serviceFilter.isEmpty
        return Menu {
            Menu {
                Button { pmFilter = "" } label: { check(pmFilter.isEmpty, T("All PMs")) }
                ForEach(pmNames, id: \.self) { n in Button { pmFilter = n } label: { check(pmFilter == n, n) } }
            } label: {
                Label(pmFilter.isEmpty ? T("Filter by PM") : "PM · \(pmFilter)", systemImage: "person")
            }
            Menu {
                Button { bdFilter = "" } label: { check(bdFilter.isEmpty, T("All BDs")) }
                ForEach(bdNames, id: \.self) { n in Button { bdFilter = n } label: { check(bdFilter == n, n) } }
            } label: {
                Label(bdFilter.isEmpty ? T("Filter by BD") : "BD · \(bdFilter)", systemImage: "person.2")
            }
            if serviceNames.count > 1 {
                Menu {
                    Button { serviceFilter = "" } label: { check(serviceFilter.isEmpty, T("All services")) }
                    ForEach(serviceNames, id: \.self) { n in Button { serviceFilter = n } label: { check(serviceFilter == n, n) } }
                } label: {
                    Label(serviceFilter.isEmpty ? T("Filter by service") : serviceFilter, systemImage: "tag")
                }
            }
            if active {
                Button { pmFilter = ""; bdFilter = ""; serviceFilter = "" } label: { Label(T("Clear filters"), systemImage: "xmark.circle") }
            }
            Divider()
            Button { export() } label: {
                Label(exporting ? T("Preparing…") : T("Download Excel"), systemImage: "square.and.arrow.down")
            }
            .disabled(exporting)
        } label: {
            Group {
                if exporting {
                    ProgressView().scaleEffect(0.8)
                } else {
                    Image(systemName: active ? "line.3.horizontal.decrease.circle.fill" : "line.3.horizontal.decrease.circle")
                        .font(.system(size: 18, weight: .semibold))
                        .foregroundStyle(active ? NX.violetText : NX.foreground)
                }
            }
            .frame(width: 42, height: 42)
            .background(active ? NX.violet.opacity(0.12) : NX.card, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(active ? NX.violet.opacity(0.55) : NX.border))
            .contentShape(Rectangle())
        }
        .menuIndicator(.hidden)
        .accessibilityLabel(T("Filters and export"))
    }

    @ViewBuilder private func check(_ on: Bool, _ text: String) -> some View {
        if on { Label(text, systemImage: "checkmark") } else { Text(text) }
    }

    private func export() {
        Task {
            exporting = true
            if let url = await store.exportFile() { route = .export(url) }
            exporting = false
        }
    }

    /// The standard segmented control (owner, 9 Oct 2026): full width on a phone, nothing to scroll.
    private var modePicker: some View {
        Picker(T("View"), selection: $modeRaw) {
            ForEach(PipelineMode.allCases) { m in
                Text(m.label).tag(m.rawValue)
            }
        }
        .pickerStyle(.segmented)
        .labelsHidden()
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
            .padding(.horizontal, 11).frame(height: 30)
            .nxChoiceChip(on: on)
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(on ? .isSelected : [])
    }

    private func resetFilters() {
        search = ""; pmFilter = ""; bdFilter = ""; serviceFilter = ""; healthFilter = ""
        if store.year != nil || store.source != nil {
            store.year = nil; store.source = nil
            Task { await store.load() }
        }
    }

    // MARK: content

    @ViewBuilder private var content: some View {
        let list = shown
        if store.isAll && store.deals.isEmpty && !filtering {
            ScrollView {
                EmptyState(icon: "square.3.layers.3d", title: T("No deals in any pipeline yet"),
                    subtitle: T("Every company's pipeline board, combined. Read-only: open a deal to change it in its own board."))
            }
            .refreshable { await store.load() }
        } else if filtering && list.isEmpty {
            ScrollView {
                EmptyState(icon: "magnifyingglass", title: T("No deal matches"),
                           subtitle: store.deals.count == 1 ? T("The filters hide the only deal.")
                               : String(format: T("The filters hide all %d deals."), store.deals.count),
                           actionTitle: T("Clear filters"), actionIcon: nil, action: { resetFilters() }, compact: true)
            }
        } else {
            switch mode {
            case .board:
                PipelineBoard(deals: list, stages: store.vocab.stages, today: store.today, compact: !wide,
                              canEdit: store.canEdit && !store.isAll,
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

    private var yearPicker: some View {
        Menu {
            Button { setYear(nil) } label: { check(store.year == nil, T("All years")) }
            ForEach(store.years, id: \.self) { year in
                Button { setYear(year) } label: { check(store.year == year, String(year)) }
            }
        } label: {
            filterLabel(store.year.map(String.init) ?? T("All years"), icon: "calendar")
        }
        .menuIndicator(.hidden)
        .accessibilityLabel(T("Filter by year"))
        .accessibilityValue(store.year.map(String.init) ?? T("All years"))
        .accessibilityIdentifier("pipeline.filter.year")
    }

    private var companyPicker: some View {
        Menu {
            Button { setSource(nil) } label: { check(store.source == nil, T("All companies")) }
            ForEach(store.boards) { board in
                Button { setSource(board.id) } label: { check(store.source == board.id, board.name) }
            }
        } label: {
            filterLabel(store.boards.first { $0.id == store.source }?.name ?? T("All companies"), icon: "building.2")
        }
        .menuIndicator(.hidden)
        .accessibilityLabel(T("Company"))
        .accessibilityIdentifier("pipeline.filter.company")
    }

    private func filterLabel(_ title: String, icon: String) -> some View {
        HStack(spacing: 7) {
            Image(systemName: icon).font(.system(size: 13))
            Text(title).font(NXFont.text(13, .semibold)).lineLimit(1)
            Spacer(minLength: 3)
            Image(systemName: "chevron.down").font(.system(size: 10, weight: .semibold))
        }
        .foregroundStyle(NX.foreground)
        .padding(.horizontal, 12).frame(minWidth: 120, maxWidth: store.isAll ? .infinity : 230, minHeight: 38)
        .background(NX.card, in: RoundedRectangle(cornerRadius: 11, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 11, style: .continuous).strokeBorder(NX.border))
    }

    private func setYear(_ year: Int?) {
        guard store.year != year else { return }
        store.year = year
        Task { await store.load() }
    }

    private func setSource(_ source: String?) {
        guard store.source != source else { return }
        store.source = source
        Task { await store.load() }
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

    /// Amber for a phase under way, like the GM's board (owner, 9 Oct 2026: green done, amber in progress,
    /// red problem, grey not started) — blue read as "info", not as "being worked on".
    static func phaseTone(_ state: String) -> Color {
        switch state {
        case "done": return NX.success
        case "active": return NX.warning
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

/// The six segments on a card: how far each line of work in the deal has come (the GM's stepper). On
/// every deal, open ones too: six grey segments say nothing has started, which is worth seeing (owner,
/// 9 Oct 2026). VoiceOver reads each phase with its detail line.
struct PipelinePhaseTrack: View {
    let deal: PipelineDeal
    var body: some View {
        let phases = deal.progressPhases
        HStack(spacing: 4) {
            ForEach(Array(phases.enumerated()), id: \.offset) { _, p in
                Capsule().fill(PipelineStyle.phaseTone(p.state)).frame(height: 4)
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(phases.map { "\(PipelineText.phase($0.key)): \(deal.phaseDetail($0.key))" }.joined(separator: ", "))
    }
}

/// The deal's blocker as a banner (owner, 9 Oct 2026: "kalo ada blocker harusnya masuk ke tampilan 1"):
/// red on a critical deal, amber otherwise. `lineLimit` 2 on a card, the full text in the deal.
struct PipelineBlockerBanner: View {
    let deal: PipelineDeal
    var lineLimit: Int? = nil
    var body: some View {
        if let text = deal.blockerText {
            let tone: ChipTone = deal.health.key == "CRITICAL" ? .danger : .warning
            HStack(alignment: .top, spacing: 6) {
                Image(systemName: "exclamationmark.triangle.fill").font(.system(size: 11, weight: .bold)).padding(.top, 1)
                Text(text).font(NXFont.text(12, .bold)).lineLimit(lineLimit)
                    .multilineTextAlignment(.leading)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .foregroundStyle(tone.fg)
            .padding(.horizontal, 9).padding(.vertical, 7)
            .background(tone.bg, in: RoundedRectangle(cornerRadius: 9, style: .continuous))
            .accessibilityElement(children: .combine)
            .accessibilityLabel("\(T("Blocker / issue")): \(text)")
        }
    }
}

/// "Phase progress": the six phases top to bottom, each with its mark (green check, amber ring, red !,
/// grey ring) and its detail line — the GM's PROGRES FASE — on every deal, open ones too. The phase the
/// blocker holds up carries the blocker text under it (owner, 9 Oct 2026).
struct PipelinePhaseStepper: View {
    let deal: PipelineDeal
    var body: some View {
        let phases = deal.progressPhases
        VStack(alignment: .leading, spacing: 10) {
            Text(T("Phase progress").uppercased())
                .font(NXFont.text(11, .bold)).foregroundStyle(NX.mutedFg).tracking(0.6)
            VStack(alignment: .leading, spacing: 0) {
                ForEach(Array(phases.enumerated()), id: \.offset) { i, p in
                    row(p, last: i == phases.count - 1)
                }
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(NX.card, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(NX.border))
    }

    private func row(_ p: PipelinePhase, last: Bool) -> some View {
        HStack(alignment: .top, spacing: 12) {
            mark(p.state)
            VStack(alignment: .leading, spacing: 2) {
                Text(PipelineText.phase(p.key)).font(NXFont.text(14, .semibold)).foregroundStyle(NX.foreground)
                Text(deal.phaseDetail(p.key)).font(NXFont.text(12, p.state == "bad" ? .semibold : .regular))
                    .foregroundStyle(p.state == "bad" ? ChipTone.danger.fg : NX.mutedFg)
                if p.blocked == true, let text = deal.blockerText {
                    HStack(alignment: .top, spacing: 4) {
                        Image(systemName: "exclamationmark.triangle.fill").font(.system(size: 10, weight: .bold)).padding(.top, 2)
                        Text(text).font(NXFont.text(12, .bold)).multilineTextAlignment(.leading)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    .foregroundStyle(ChipTone.danger.fg)
                    .padding(.top, 2)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.bottom, last ? 0 : 12)
        }
        // The line down to the next mark: an overlay takes the row's own height, so it never asks the
        // scroll view for more (a maxHeight: .infinity inside the row would).
        .overlay(alignment: .topLeading) {
            if !last {
                Rectangle().fill(p.state == "done" ? NX.success.opacity(0.6) : NX.border)
                    .frame(width: 2)
                    .padding(.top, 25).padding(.bottom, 3).padding(.leading, 10)
                    .accessibilityHidden(true)
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityValue(PipelineText.phaseState(p.state))
    }

    @ViewBuilder private func mark(_ state: String) -> some View {
        switch state {
        case "done":
            Image(systemName: "checkmark").font(.system(size: 11, weight: .heavy)).foregroundStyle(.white)
                .frame(width: 22, height: 22).background(NX.success, in: Circle())
        case "bad":
            Text("!").font(NXFont.text(13, .heavy)).foregroundStyle(.white)
                .frame(width: 22, height: 22).background(NX.danger, in: Circle())
        case "active":
            Circle().strokeBorder(NX.warning, lineWidth: 2.5).frame(width: 22, height: 22)
        default:
            Circle().strokeBorder(NX.border, lineWidth: 2).frame(width: 22, height: 22)
        }
    }
}

/// The instrument strip (the GM's "instruments"): over every deal, never the filtered view, so
/// filtering never changes the numbers people quote.
///
/// Owner, 9 Oct 2026: it had become a card ~500pt tall with three numbers in it — a horizontal ScrollView
/// takes every bit of height it is offered. Now: on a phone, small KPI chips (~64pt) in a row that scrolls
/// sideways; on an iPad or a Mac, one card with all eight side by side when they fit, else the same chips.
/// Both are held to their content's height. A reading of zero is drawn quietly instead of in bold.
struct PipelineKpiStrip: View {
    let summary: PipelineSummary
    var wide: Bool = false
    @Environment(\.pipelinePresenting) private var presenting

    private struct Tile: Identifiable {
        let id: String
        let label: String
        let value: String
        let sub: String
        var zero = false
        var tone: Color? = nil
        /// A small amber line under `sub`; nil = none.
        var warn: String? = nil
    }

    private var tiles: [Tile] {
        let s = summary
        guard presenting else { return readings(s) }
        // Presenting: every money tile reads "Rp ••••" in the same quiet tone, so neither a zero nor a red
        // (negative / overdue) tile gives a figure away.
        let money: Set<String> = ["open", "weighted", "won", "receivable", "realProfit"]
        return readings(s).map { t in
            guard money.contains(t.id) else { return t }
            let sub = t.id == "receivable" && s.receivableOverdue > 0
                ? String(format: T("%@ overdue"), PipelineFormat.moneyMask) : t.sub
            return Tile(id: t.id, label: t.label, value: PipelineFormat.moneyMask, sub: sub, zero: true)
        }
    }

    private func readings(_ s: PipelineSummary) -> [Tile] {
        [
            Tile(id: "open", label: T("Open pipeline"), value: PipelineFormat.idr(s.openValue),
                 sub: String(format: T(s.openCount == 1 ? "%d open deal" : "%d open deals"), s.openCount), zero: s.openValue == 0),
            Tile(id: "weighted", label: T("Weighted forecast"), value: PipelineFormat.idr(s.weightedValue),
                 sub: T("Value × probability"), zero: s.weightedValue == 0),
            Tile(id: "won", label: T("Won"), value: PipelineFormat.idr(s.wonValue),
                 sub: String(format: T("%d active · %d lost"), s.activeCount, s.lostCount), zero: s.wonValue == 0),
            Tile(id: "receivable", label: T("Receivable"), value: PipelineFormat.idr(s.receivable),
                 sub: s.receivableOverdue > 0 ? String(format: T("%@ overdue"), PipelineFormat.idr(s.receivableOverdue)) : T("None overdue"),
                 zero: s.receivable == 0, tone: s.receivableOverdue > 0 ? ChipTone.danger.fg : nil),
            // Control Tower v6 (14 Oct 2026): Σ (net value − real cost) of the deals not Lost that have costs and a
            // net value; red below zero. Deals with costs but no net value are left out and named in the warning.
            Tile(id: "realProfit", label: T("Real profit"), value: PipelineFormat.idr(s.realProfit),
                 sub: String(format: T("%d/%d with costs"), s.costDealCount, s.costEligibleCount),
                 zero: s.realProfit == 0, tone: s.realProfit < 0 ? ChipTone.danger.fg : nil,
                 warn: s.costNoNetCount > 0 ? String(format: T(s.costNoNetCount == 1 ? "%d deal has costs but no net value" : "%d deals have costs but no net value"), s.costNoNetCount) : nil),
            Tile(id: "critical", label: T("Critical"), value: "\(s.criticalCount)",
                 sub: String(format: T(s.attentionCount == 1 ? "%d needs attention" : "%d need attention"), s.attentionCount),
                 zero: s.criticalCount == 0, tone: s.criticalCount > 0 ? ChipTone.danger.fg : nil),
            Tile(id: "ready", label: T("Ready to execute"), value: "\(s.readyCount)",
                 sub: String(format: T("%d blocked"), s.blockedCount), zero: s.readyCount == 0,
                 tone: s.blockedCount > 0 ? ChipTone.warning.fg : (s.readyCount > 0 ? ChipTone.success.fg : nil)),
            Tile(id: "deliverables", label: T("Deliverables on track"), value: "\(s.deliverablesOnTrack)",
                 sub: String(format: T("%d completed"), s.deliverablesDone), zero: s.deliverablesOnTrack == 0),
        ]
    }

    var body: some View {
        Group {
            if wide {
                ViewThatFits(in: .horizontal) {
                    joined
                    chips
                }
            } else {
                chips
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(T("Pipeline at a glance"))
    }

    /// Phone: one small card per reading, scrolling sideways.
    private var chips: some View {
        // iPad / Mac fall back here when the eight readings do not fit side by side: the scroller shows once,
        // so the cut tile at the edge reads as "more to the right" (visual QA 24 Oct 2026: "C 5 6").
        ScrollView(.horizontal, showsIndicators: wide) {
            HStack(spacing: 8) {
                ForEach(tiles) { tile in
                    reading(tile)
                        .padding(.horizontal, 12).padding(.vertical, 9)
                        .frame(minWidth: 124, alignment: .leading)
                        .background(NX.card, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(NX.border))
                }
            }
            .padding(.vertical, 1)
            .padding(.bottom, wide ? 6 : 0)
        }
        .scrollIndicatorsFlash(onAppear: wide)
        .fixedSize(horizontal: false, vertical: true)
    }

    /// iPad / Mac: the eight readings in one card, hairlines between them.
    private var joined: some View {
        HStack(spacing: 0) {
            ForEach(Array(tiles.enumerated()), id: \.element.id) { i, tile in
                if i > 0 { Rectangle().fill(NX.border).frame(width: 1).padding(.vertical, 10) }
                reading(tile)
                    .padding(.horizontal, 14).padding(.vertical, 10)
                    .frame(minWidth: 118, maxWidth: .infinity, alignment: .leading)
            }
        }
        .fixedSize(horizontal: false, vertical: true)
        .background(NX.card, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(NX.border))
    }

    private func reading(_ tile: Tile) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            // Two lines between words, never "Deliverables on tr…" in an iPad / Mac column (owner QA 22 Oct 2026).
            WordWrapText(text: tile.label, size: 11) { NXFont.text($0, .semibold) }.foregroundStyle(NX.mutedFg)
            Text(tile.value).font(NXFont.display(17, .bold))
                .foregroundStyle(tile.zero ? NX.mutedFg.opacity(0.75) : (tile.tone ?? NX.foreground))
                .monospacedDigit().lineLimit(1)
            WordWrapText(text: tile.sub, size: 11) { NXFont.text($0).monospacedDigit() }.foregroundStyle(NX.mutedFg)
            if let warn = tile.warn {
                Text(warn).font(NXFont.text(11)).foregroundStyle(ChipTone.warning.fg).monospacedDigit().lineLimit(1)
            }
        }
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Board

private struct PipelineStageColumn: Identifiable {
    let stage: String
    let deals: [PipelineDeal]
    var id: String { stage }
}

extension PipelineDeal {
    /// The value a card and a column total show: net value when known, else the contract value (web dealValue).
    var shownValue: Double { netValue > 0 ? netValue : contractValue }
}

/// One column per stage, left to right from first contact to closed. Each column scrolls its own cards
/// under a fixed header (stage, count, total), like the task board's LaneColumn, so nothing scrolls two
/// ways at once. Non-lazy stacks only.
///
/// Phone (owner, 9 Oct 2026: "di hape jg sempit bgt"): one column fills the width and the strip pages
/// column by column (content margins + container-relative width + view-aligned snapping, Apple's
/// standard carousel), with a row of dots under it that says where you are and jumps to a stage.
/// iPad / Mac: 288pt columns side by side with the scroll bar shown.
struct PipelineBoard: View {
    let deals: [PipelineDeal]
    let stages: [String]
    let today: String
    let compact: Bool
    var canEdit = true
    let onOpen: (String) -> Void
    let onMove: (String, String) -> Void
    let onAdd: (String) -> Void
    let onRefresh: () async -> Void

    @State private var page: String?

    private var columns: [PipelineStageColumn] {
        var order = stages
        // A stage this build's server list does not have (an older vocab) is shown as-is, at the end.
        for d in deals where !order.contains(d.stage) { order.append(d.stage) }
        return order.map { s in PipelineStageColumn(stage: s, deals: deals.filter { $0.stage == s }.sorted(by: PipelineDeal.bySeverity)) }
    }

    var body: some View {
        let cols = columns
        if compact {
            VStack(spacing: 0) {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(alignment: .top, spacing: 12) {
                        ForEach(cols) { col in
                            column(col)
                                .containerRelativeFrame(.horizontal)
                                .id(col.stage)
                        }
                    }
                    .scrollTargetLayout()
                    .padding(.top, 12)
                    .frame(maxHeight: .infinity, alignment: .top)
                }
                .accessibilityIdentifier("pipeline.board.scroll")
                .contentMargins(.horizontal, 16, for: .scrollContent)
                .scrollTargetBehavior(.viewAligned)
                .scrollPosition(id: $page)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                pageDots(cols)
            }
        } else {
            ScrollView(.horizontal, showsIndicators: true) {
                HStack(alignment: .top, spacing: 12) {
                    ForEach(cols) { col in column(col).frame(width: 288) }
                }
                .padding(.horizontal, 16).padding(.vertical, 12)
                .frame(maxHeight: .infinity, alignment: .top)
            }
            .accessibilityIdentifier("pipeline.board.scroll")
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }

    private func column(_ col: PipelineStageColumn) -> some View {
        PipelineColumnView(stage: col.stage, deals: col.deals, stages: stages, today: today,
                           canEdit: canEdit,
                           onOpen: onOpen, onMove: onMove, onAdd: onAdd, onRefresh: onRefresh)
    }

    /// Where you are on the phone's paged board; a dot jumps to its stage.
    private func pageDots(_ cols: [PipelineStageColumn]) -> some View {
        let current = page ?? cols.first?.stage
        return HStack(spacing: 2) {
            ForEach(cols) { col in
                let on = col.stage == current
                Button {
                    withAnimation(.snappy) { page = col.stage }
                } label: {
                    Capsule()
                        .fill(on ? PipelineStyle.groupTone(col.stage) : NX.mutedFg.opacity(0.3))
                        .frame(width: on ? 18 : 7, height: 7)
                        .frame(width: on ? 30 : 20, height: 30)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(String(format: T("%@, %d deals"), PipelineText.stage(col.stage), col.deals.count))
                .accessibilityAddTraits(on ? .isSelected : [])
            }
        }
        .animation(.snappy, value: current)
        .frame(maxWidth: .infinity)
        .padding(.bottom, 4)
    }
}

struct PipelineColumnView: View {
    let stage: String
    let deals: [PipelineDeal]
    let stages: [String]
    let today: String
    var canEdit = true
    let onOpen: (String) -> Void
    let onMove: (String, String) -> Void
    let onAdd: (String) -> Void
    let onRefresh: () async -> Void
    @Environment(\.pipelinePresenting) private var presenting

    private var total: Double { deals.reduce(0) { $0 + $1.shownValue } }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            // Stage, count, total, add. It stays put while the cards scroll under it.
            HStack(spacing: 8) {
                Circle().fill(PipelineStyle.groupTone(stage)).frame(width: 8, height: 8)
                // The whole stage name, two lines between words, smaller before any "…", as the project title:
                // "Proposal / Quota…" was cut beside the total (owner, QA final #2, 24 Oct 2026). The name and its
                // count fill the room instead of a Spacer; the count, total and add button keep their size.
                HStack(spacing: 8) {
                    WordWrapText(text: PipelineText.stage(stage), size: 15) { NXFont.text($0, .bold) }
                        .foregroundStyle(NX.foreground)
                        .fixedSize(horizontal: false, vertical: true)
                        .layoutPriority(1)
                    Text("\(deals.count)").font(NXFont.text(12, .bold)).monospacedDigit().foregroundStyle(NX.mutedFg)
                        .padding(.horizontal, 7).padding(.vertical, 1)
                        .background(NX.background, in: Capsule()).overlay(Capsule().strokeBorder(NX.border))
                        .fixedSize()
                }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .layoutPriority(1)
                if total > 0 {
                    Text(PipelineFormat.idr(total, hidden: presenting)).font(NXFont.text(13, .semibold)).foregroundStyle(NX.mutedFg)
                        .monospacedDigit().lineLimit(1).fixedSize()
                }
                if canEdit && stage != PipelineVocab.lostStage {
                    Button { onAdd(stage) } label: {
                        Image(systemName: "plus").font(.system(size: 13, weight: .bold)).foregroundStyle(NX.foreground)
                            .frame(width: 32, height: 32)
                            .background(NX.card, in: Circle())
                            .overlay(Circle().strokeBorder(NX.border))
                            .contentShape(Circle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(String(format: T("Add a deal in %@"), PipelineText.stage(stage)))
                }
            }
            .padding(.leading, 14).padding(.trailing, 10).padding(.vertical, 10)

            ScrollView(.vertical, showsIndicators: false) {
                VStack(spacing: 8) {
                    ForEach(deals) { d in
                        PipelineDealCard(deal: d, stages: stages, today: today, canEdit: canEdit, onOpen: onOpen, onMove: onMove)
                    }
                    if deals.isEmpty {
                        Text(T("No deals")).font(NXFont.text(13)).foregroundStyle(NX.mutedFg)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(.horizontal, 6).padding(.vertical, 8)
                    }
                }
                .padding(.horizontal, 8).padding(.bottom, 12)
            }
            .refreshable { await onRefresh() }
        }
        .frame(maxHeight: .infinity, alignment: .top)
        .background(NX.muted.opacity(0.55), in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).strokeBorder(NX.border))
    }
}

/// The PM and the BD at the foot of a card.
private struct PipelineCardPerson: Identifiable {
    let role: String
    let name: String
    let avatar: String?
    var id: String { role }
}

/// A card, the GM's layout (owner, 9 Oct 2026, from his "Control Tower" screenshot: "blocker status di
/// board tiap dealnya belum ada"): code and health pill on top, the name, brand and value, the six-segment
/// phase bar on EVERY deal, the blocker as a banner whenever one is written (else the first health reason),
/// then PM (and BD when different), the next action's date and the services. Move: long-press for
/// "Move to stage", or the deal's Stage field.
struct PipelineDealCard: View {
    let deal: PipelineDeal
    let stages: [String]
    let today: String
    var canEdit = true
    let onOpen: (String) -> Void
    let onMove: (String, String) -> Void
    @Environment(\.pipelinePresenting) private var presenting

    private var group: String { PipelineVocab.group(of: deal.stage) }
    private var flagged: Bool { deal.health.key == "CRITICAL" || deal.health.key == "ATTENTION" }
    private var live: Bool { group != "Closed" && group != "Lost" }
    private var dueIn: Int? {
        guard live, let date = deal.nextActionDate else { return nil }
        return PipelineFormat.daysBetween(today, date)
    }
    private var needsPm: Bool { deal.pmDisplay == nil && (group == "Pre-Execution" || group == "Execution") }
    private var people: [PipelineCardPerson] {
        var out: [PipelineCardPerson] = []
        if let pm = deal.pmDisplay { out.append(PipelineCardPerson(role: "PM", name: pm, avatar: deal.pm?.avatar)) }
        if let bd = deal.bdDisplay, bd != deal.pmDisplay { out.append(PipelineCardPerson(role: "BD", name: bd, avatar: deal.bd?.avatar)) }
        return out
    }
    private var servicesText: String { deal.services.joined(separator: ", ") }

    var body: some View {
        Button { onOpen(deal.id) } label: { card }
            .buttonStyle(PressableCardStyle())
            .accessibilityIdentifier("pipeline.deal.\(deal.id)")
            .contextMenu {
                if canEdit { Section(T("Move to stage")) { stageButtons } }
            }
    }

    private var card: some View {
        VStack(alignment: .leading, spacing: 6) {
            PipelineCompanyChip(source: deal.source)
            HStack(spacing: 6) {
                Text(deal.code).font(NXFont.text(11, .semibold)).foregroundStyle(NX.mutedFg).monospacedDigit().lineLimit(1)
                Spacer(minLength: 6)
                if deal.health.key != "NONE" { PipelineHealthPill(key: deal.health.key) }
            }
            WordWrapText(text: deal.name.isEmpty ? T("Untitled deal") : deal.name, size: 15) { NXFont.text($0, .semibold) }
                .foregroundStyle(NX.foreground)
                .frame(maxWidth: .infinity, alignment: .leading)
            if !deal.brand.isEmpty || deal.shownValue > 0 {
                HStack(spacing: 6) {
                    if !deal.brand.isEmpty {
                        Text(deal.brand).font(NXFont.text(12)).foregroundStyle(NX.mutedFg).lineLimit(1)
                    }
                    Spacer(minLength: 6)
                    if deal.shownValue > 0 {
                        Text(PipelineFormat.idr(deal.shownValue, hidden: presenting)).font(NXFont.text(13, .bold)).foregroundStyle(NX.foreground)
                            .monospacedDigit().lineLimit(1).layoutPriority(1)
                    }
                }
            }
            // Margin on the net value (Control Tower v6, 14 Oct 2026); only on a deal with cost lines and a net value.
            // Presenting: no margin line at all (its percentage gives the money away too).
            if !presenting, !deal.costs.isEmpty, let margin = deal.margin {
                HStack(spacing: 4) {
                    Text("\(T("Margin")):").foregroundStyle(NX.mutedFg)
                    Text("\(PipelineFormat.idr(margin)) (\(PipelineFormat.pct(deal.marginPct ?? 0)))")
                        .fontWeight(.semibold)
                        .foregroundStyle(margin < 0 ? ChipTone.danger.fg : (margin > 0 ? ChipTone.success.fg : NX.mutedFg))
                }
                .font(NXFont.text(12)).monospacedDigit().lineLimit(1)
            }
            if !deal.phases.isEmpty {
                PipelinePhaseTrack(deal: deal).padding(.top, 2)
            }
            PipelineBlockerBanner(deal: deal, lineLimit: 2)
            // The banner already says the blocker; otherwise the first reason the deal is flagged.
            if flagged, deal.blockerText == nil, let first = deal.health.reasons.first {
                HStack(alignment: .top, spacing: 5) {
                    Image(systemName: "exclamationmark.triangle.fill").font(.system(size: 10, weight: .bold)).padding(.top, 2)
                    Text(deal.health.reasons.count > 1
                         ? "\(PipelineText.reason(first))  \(String(format: T("+%d more"), deal.health.reasons.count - 1))"
                         : PipelineText.reason(first))
                        .font(NXFont.text(12, .medium)).lineLimit(2).multilineTextAlignment(.leading)
                }
                .foregroundStyle(deal.health.key == "CRITICAL" ? ChipTone.danger.fg : ChipTone.warning.fg)
            }
            if !people.isEmpty || needsPm || dueIn != nil || !servicesText.isEmpty {
                Divider().overlay(NX.border).padding(.top, 2)
                HStack(spacing: 6) {
                    if !people.isEmpty {
                        HStack(spacing: -5) {
                            ForEach(people) { p in
                                AvatarView(url: p.avatar, initial: String(p.name.first ?? "?").uppercased(), size: 20, userId: p.id, name: p.name)
                                    .overlay(Circle().strokeBorder(NX.card, lineWidth: 1.5))
                            }
                        }
                        .accessibilityHidden(true)
                    }
                    if needsPm {
                        Text(T("No PM yet")).font(NXFont.text(12, .semibold)).foregroundStyle(ChipTone.danger.fg).lineLimit(1)
                    } else if !people.isEmpty {
                        // Two lines between names before "…" (visual QA 24 Oct 2026: "Ariq · Henryca…").
                        WordWrapText(text: people.map(\.name).joined(separator: " · "), size: 12) { NXFont.text($0) }
                            .foregroundStyle(NX.mutedFg)
                            .accessibilityLabel(people.map { "\($0.role) \($0.name)" }.joined(separator: ", "))
                    }
                    Spacer(minLength: 4)
                    if let due = dueIn { dueChip(due) }
                    if !servicesText.isEmpty {
                        Text(servicesText).font(NXFont.text(12)).foregroundStyle(NX.mutedFg).lineLimit(1)
                            .frame(maxWidth: 130, alignment: .trailing)
                    }
                }
            }
        }
        .padding(.horizontal, 12).padding(.vertical, 11)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(NX.card, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(NX.border))
    }

    /// The next action's date: red once it has passed, amber today, quiet otherwise.
    private func dueChip(_ due: Int) -> some View {
        let tone: Color = due < 0 ? ChipTone.danger.fg : (due == 0 ? ChipTone.warning.fg : NX.mutedFg)
        return HStack(spacing: 4) {
            Image(systemName: "calendar").font(.system(size: 10, weight: .semibold))
            Text(due == 0 ? T("Today") : PipelineFormat.shortDay(deal.nextActionDate))
                .font(NXFont.text(12, due <= 0 ? .semibold : .regular)).monospacedDigit()
        }
        .foregroundStyle(tone)
        .padding(.horizontal, due <= 0 ? 6 : 0).padding(.vertical, due <= 0 ? 2 : 0)
        .background(due < 0 ? ChipTone.danger.bg : (due == 0 ? ChipTone.warning.bg : Color.clear), in: RoundedRectangle(cornerRadius: 6, style: .continuous))
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(T("Next action date")): \(PipelineFormat.day(deal.nextActionDate))")
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
    @Environment(\.pipelinePresenting) private var presenting

    private var rows: [PipelineDeal] {
        let stageIndex = Dictionary(stages.enumerated().map { ($1, $0) }, uniquingKeysWith: { a, _ in a })
        let sorted: [PipelineDeal]
        switch sort {
        case .urgency: sorted = deals.sorted(by: PipelineDeal.bySeverity)
        case .name: sorted = deals.sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
        case .stage: sorted = deals.sorted { (stageIndex[$0.stage] ?? 99) < (stageIndex[$1.stage] ?? 99) }
        // Money and lateness read biggest first by default — the question is "where is the most".
        case .value: sorted = deals.sorted { $0.netValue > $1.netValue }
        case .receivable: sorted = deals.sorted { $0.receivable > $1.receivable }
        case .overdue: sorted = deals.sorted { $0.daysOverdue > $1.daysOverdue }
        // No date goes last whichever way.
        case .nextDate: sorted = deals.sorted { ($0.nextActionDate ?? "9999") < ($1.nextActionDate ?? "9999") }
        }
        return ascending ? sorted : sorted.reversed()
    }

    var body: some View {
        let list = rows
        GeometryReader { geometry in
            // A regular size class can still leave a narrow detail pane beside the iPad sidebar.
            // Keep company/deal names readable and let the remaining columns scroll into view.
            ScrollView(wide ? [.horizontal, .vertical] : .vertical) {
                let tableWidth = wide ? max(geometry.size.width, 1220) : geometry.size.width
                tableContent(list, dealWidth: Self.dealWidth(tableWidth: tableWidth))
                    .frame(width: tableWidth)
            }
            // The columns past Net value are off to the right on an iPad: show the scroller once so it reads
            // as scrollable (visual QA 24 Oct 2026: HEALTH off-screen with no hint).
            .scrollIndicatorsFlash(onAppear: wide)
            .accessibilityIdentifier("pipeline.table.scroll")
            .refreshable { await onRefresh() }
        }
    }

    private func tableContent(_ list: [PipelineDeal], dealWidth: CGFloat) -> some View {
        LazyVStack(alignment: .leading, spacing: 0, pinnedViews: wide ? [.sectionHeaders] : []) {
            Section {
                ForEach(list) { d in
                    Button { onOpen(d.id) } label: { wide ? AnyView(wideRow(d, dealWidth: dealWidth)) : AnyView(compactRow(d)) }
                        .buttonStyle(.plain)
                        .accessibilityIdentifier("pipeline.deal.\(d.id)")
                        .hoverEffect(.highlight)
                    Divider().overlay(NX.border)
                }
                totals(list)
            } header: {
                VStack(spacing: 0) {
                    sortBar
                    if wide { wideHeader(dealWidth: dealWidth) }
                    Divider().overlay(NX.border)
                }
                .background(NX.background)
            }
        }
        .padding(.bottom, 20)
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

    private func wideHeader(dealWidth: CGFloat) -> some View {
        HStack(spacing: 10) {
            head(T("Code")).frame(width: 78, alignment: .leading)
            head(T("Deal")).frame(width: dealWidth, alignment: .leading)
            head(T("Stage")).frame(width: 150, alignment: .leading)
            head(T("Prob.")).frame(width: 44, alignment: .trailing)
            head(T("Net value")).frame(width: 96, alignment: .trailing)
            head(T("Receivable")).frame(width: 96, alignment: .trailing)
            head(T("Overdue")).frame(width: 56, alignment: .trailing)
            head(T("Next action")).frame(width: Self.nextActionWidth, alignment: .leading)
            head(T("Health")).frame(width: 88, alignment: .leading)
        }
        .padding(.horizontal, 14).padding(.vertical, 7)
    }

    /// One flexible column (Deal) and every other column a fixed width: with two flexible columns each
    /// row split the spare width by its own text, so a row with a long next action pushed Stage, Prob.
    /// and Net value ~45 pt left of the rows around it (visual QA 24 Oct 2026, iPad).
    private static let nextActionWidth: CGFloat = 200
    /// Every other column is fixed too: the Deal column is exactly what they leave of the table's width, the
    /// same number on every row and the header. Even as the only flexible column, rows with an overdue
    /// receivable still came out ~65 pt narrower on iPad (visual QA re-shoot, 25 Oct 2026).
    private static func dealWidth(tableWidth: CGFloat) -> CGFloat {
        let fixed: CGFloat = 78 + 150 + 44 + 96 + 96 + 56 + nextActionWidth + 88
        let gaps: CGFloat = 8 * 10 + 2 * 14
        return max(230, tableWidth - fixed - gaps)
    }

    private func head(_ text: String) -> some View {
        Text(text.uppercased()).font(NXFont.text(10, .bold)).tracking(0.4).foregroundStyle(NX.mutedFg).lineLimit(1)
    }

    private func wideRow(_ d: PipelineDeal, dealWidth: CGFloat) -> some View {
        HStack(spacing: 10) {
            Text(d.code).font(NXFont.text(11)).foregroundStyle(NX.mutedFg).monospacedDigit().frame(width: 78, alignment: .leading)
            VStack(alignment: .leading, spacing: 1) {
                PipelineCompanyChip(source: d.source)
                WordWrapText(text: d.name.isEmpty ? T("Untitled deal") : d.name, size: 13) { NXFont.text($0, .semibold) }
                    .foregroundStyle(NX.foreground)
                Text([d.brand, d.pmDisplay.map { "PM \($0)" } ?? ""].filter { !$0.isEmpty }.joined(separator: " · "))
                    .font(NXFont.text(11)).foregroundStyle(NX.mutedFg).lineLimit(1)
            }
            .frame(width: dealWidth, alignment: .leading)
            HStack(spacing: 6) {
                Circle().fill(PipelineStyle.groupTone(d.stage)).frame(width: 6, height: 6)
                Text(PipelineText.stage(d.stage)).font(NXFont.text(12)).foregroundStyle(NX.foreground).lineLimit(1)
            }
            .frame(width: 150, alignment: .leading)
            Text(PipelineFormat.pct(d.probability)).font(NXFont.text(12)).foregroundStyle(NX.mutedFg).monospacedDigit()
                .frame(width: 44, alignment: .trailing)
            // Blank, not "–", where nothing is known yet (owner, 9 Oct 2026).
            Text(d.netValue != 0 ? PipelineFormat.idr(d.netValue, hidden: presenting) : "").font(NXFont.text(12, .semibold)).foregroundStyle(NX.foreground)
                .monospacedDigit().frame(width: 96, alignment: .trailing)
            Text(d.receivable != 0 ? PipelineFormat.idr(d.receivable, hidden: presenting) : "").font(NXFont.text(12))
                .foregroundStyle(NX.foreground).monospacedDigit().frame(width: 96, alignment: .trailing)
            overdueText(d).frame(width: 56, alignment: .trailing)
            VStack(alignment: .leading, spacing: 1) {
                if !d.nextAction.isEmpty {
                    Text(d.nextAction).font(NXFont.text(12)).foregroundStyle(NX.foreground).lineLimit(1)
                }
                if d.nextActionDate != nil {
                    Text(PipelineFormat.day(d.nextActionDate)).font(NXFont.text(11)).foregroundStyle(NX.mutedFg)
                }
            }
            .frame(width: Self.nextActionWidth, alignment: .leading)
            Group {
                // A pill only where there is something to say; an open deal's "Not started" is plain text.
                if d.health.key == "NOT_STARTED" {
                    Text(PipelineText.health(d.health.key)).font(NXFont.text(11)).foregroundStyle(NX.mutedFg).lineLimit(1)
                } else if d.health.key != "NONE" {
                    PipelineHealthPill(key: d.health.key)
                }
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
                PipelineCompanyChip(source: d.source)
                WordWrapText(text: d.name.isEmpty ? T("Untitled deal") : d.name, size: 14) { NXFont.text($0, .semibold) }
                    .foregroundStyle(NX.foreground)
                Text([d.code, PipelineText.stage(d.stage), d.pmDisplay.map { "PM \($0)" } ?? ""].filter { !$0.isEmpty }.joined(separator: " · "))
                    .font(NXFont.text(11)).foregroundStyle(NX.mutedFg).lineLimit(1)
                if !d.nextAction.isEmpty {
                    Text(d.nextActionDate.map { "\(PipelineFormat.day($0)) · \(d.nextAction)" } ?? d.nextAction)
                        .font(NXFont.text(11)).foregroundStyle(NX.mutedFg).lineLimit(1)
                }
            }
            Spacer(minLength: 6)
            VStack(alignment: .trailing, spacing: 3) {
                if d.netValue != 0 {
                    Text(PipelineFormat.idr(d.netValue, hidden: presenting)).font(NXFont.text(13, .bold)).foregroundStyle(NX.foreground).monospacedDigit()
                }
                if d.receivable > 0 {
                    HStack(spacing: 4) {
                        Text(PipelineFormat.idr(d.receivable, hidden: presenting)).font(NXFont.text(11)).foregroundStyle(NX.mutedFg).monospacedDigit()
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
        }
    }

    private func totals(_ list: [PipelineDeal]) -> some View {
        let net = list.reduce(0) { $0 + $1.netValue }
        let receivable = list.reduce(0) { $0 + $1.receivable }
        return HStack(spacing: 10) {
            Text(String(format: T("%d deals"), list.count)).font(NXFont.text(12, .bold)).foregroundStyle(NX.foreground)
            Spacer()
            VStack(alignment: .trailing, spacing: 2) {
                Text("\(T("Net value")) \(PipelineFormat.idrFull(net, hidden: presenting))").font(NXFont.text(12, .bold)).foregroundStyle(NX.foreground).monospacedDigit()
                Text("\(T("Receivable")) \(PipelineFormat.idrFull(receivable, hidden: presenting))").font(NXFont.text(11)).foregroundStyle(NX.mutedFg).monospacedDigit()
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
    @Environment(\.pipelinePresenting) private var presenting

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
        deals.filter { $0.daysOverdue > 0 && $0.receivable > 0 }.sorted { $0.daysOverdue > $1.daysOverdue }
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
                            PipelineCompanyChip(source: d.source)
                            HStack(alignment: .top, spacing: 8) {
                                PipelineHealthPill(key: d.health.key)
                                WordWrapText(text: d.name.isEmpty ? T("Untitled deal") : d.name, size: 14) { NXFont.text($0, .semibold) }.foregroundStyle(NX.foreground)
                                Spacer(minLength: 4)
                                Text(PipelineFormat.idr(d.netValue, hidden: presenting)).font(NXFont.text(12)).foregroundStyle(NX.mutedFg).monospacedDigit()
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
                    .accessibilityIdentifier("pipeline.deal.\(d.id)")
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
                                    PipelineCompanyChip(source: d.source)
                                    HStack(alignment: .top) {
                                        WordWrapText(text: d.name.isEmpty ? T("Untitled deal") : d.name, size: 13) { NXFont.text($0, .semibold) }.foregroundStyle(NX.foreground)
                                        Spacer(minLength: 4)
                                        Text(PipelineFormat.day(d.nextActionDate)).font(NXFont.text(11)).foregroundStyle(NX.mutedFg).monospacedDigit()
                                    }
                                    Text(d.nextAction.isEmpty ? T("No next action written") : d.nextAction)
                                        .font(NXFont.text(12)).foregroundStyle(NX.mutedFg).lineLimit(2)
                                }
                                .contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)
                            .accessibilityIdentifier("pipeline.deal.\(d.id)")
                        }
                    }
                    .padding(.horizontal, 14).padding(.vertical, 10)
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
        }
    }

    private var latePayments: some View {
        let sum = late.reduce(0) { $0 + $1.receivable }
        return PipelinePanel(icon: "creditcard", title: T("Late payments"), meta: late.isEmpty ? nil : PipelineFormat.idr(sum, hidden: presenting)) {
            if late.isEmpty {
                calm(T("No receivable is past its due date."))
            } else {
                ForEach(Array(late.enumerated()), id: \.element.id) { i, d in
                    if i > 0 { Divider().overlay(NX.border) }
                    Button { onOpen(d.id) } label: {
                        HStack(alignment: .firstTextBaseline, spacing: 8) {
                            VStack(alignment: .leading, spacing: 1) {
                                PipelineCompanyChip(source: d.source)
                                WordWrapText(text: d.name.isEmpty ? T("Untitled deal") : d.name, size: 13) { NXFont.text($0, .semibold) }.foregroundStyle(NX.foreground)
                                Text("\(d.paymentStatusShown) · \(PipelineFormat.idr(d.receivable, hidden: presenting))").font(NXFont.text(11)).foregroundStyle(NX.mutedFg)
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
                    .accessibilityIdentifier("pipeline.deal.\(d.id)")
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
                            PipelineCompanyChip(source: d.source)
                            WordWrapText(text: d.name.isEmpty ? T("Untitled deal") : d.name, size: 13) { NXFont.text($0, .semibold) }.foregroundStyle(NX.foreground)
                            Text(d.blocker).font(NXFont.text(12)).foregroundStyle(ChipTone.warning.fg).multilineTextAlignment(.leading)
                        }
                        .padding(.horizontal, 14).padding(.vertical, 10)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("pipeline.deal.\(d.id)")
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
