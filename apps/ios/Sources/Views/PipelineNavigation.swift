import SwiftUI

/// The workspace role is the entry-point gate. Board membership alone never grants combined access.
@MainActor
@Observable
final class PipelineBoardDirectory {
    static let shared = PipelineBoardDirectory()
    private(set) var boards: [PipelineBoardRef] = []
    private(set) var workspaceId: String?
    private(set) var canView = false
    @ObservationIgnored private var viewerId: String?
    @ObservationIgnored private var loadedAt: Date?
    @ObservationIgnored private var generation = 0
    @ObservationIgnored private var loadingGeneration: Int?

    private init() {}

    func load(viewerId nextViewerId: String?, force: Bool = false) async {
        guard let nextViewerId else { reset(); return }
        if viewerId != nextViewerId {
            reset()
            viewerId = nextViewerId
        }
        if !force, let loadedAt, Date().timeIntervalSince(loadedAt) < 60 { return }
        guard loadingGeneration == nil else { return }
        let requestedGeneration = generation
        loadingGeneration = requestedGeneration
        defer {
            // A previous account's completion must not release the new account's in-flight read.
            if loadingGeneration == requestedGeneration { loadingGeneration = nil }
        }
        do {
            let info = try await APIClient.shared.workspaceInfo()
            guard generation == requestedGeneration && viewerId == nextViewerId else { return }
            workspaceId = info.workspaceId
            guard ["BOD", "ONE_ABOVE_ALL"].contains(info.role ?? "") else {
                hide(); loadedAt = Date(); return
            }
            // Do not call this endpoint at all for Manager / Staff / any other workspace role.
            let response = try await APIClient.shared.pipelineBoards(workspaceId: info.workspaceId)
            guard generation == requestedGeneration && viewerId == nextViewerId else { return }
            boards = response.boards
            workspaceId = response.workspaceId ?? info.workspaceId
            canView = true
            loadedAt = Date()
        } catch {
            guard generation == requestedGeneration && viewerId == nextViewerId else { return }
            if case APIError.http(403, _) = error { hide(); loadedAt = Date() }
            // A transient error can keep a previously authorized list, but never grants new access.
        }
    }

    func hide() { canView = false; boards = [] }

    func reset() {
        generation += 1
        loadingGeneration = nil
        hide(); viewerId = nil; workspaceId = nil; loadedAt = nil
    }
}

enum PipelineNavigationTarget: Identifiable, Hashable {
    case board(id: String, name: String)
    case all(workspaceId: String?)
    var id: String {
        switch self {
        case .board(let id, _): return "board-\(id)"
        case .all(let workspaceId): return "all-\(workspaceId ?? "")"
        }
    }
}

struct PipelineDestination: View {
    let target: PipelineNavigationTarget
    var boardReturnsToAll = false
    var body: some View {
        switch target {
        case .board(let id, let name):
            ProjectDetailView(projectId: id, projectName: name, pipelineReturnsToAll: boardReturnsToAll)
        case .all(let workspaceId): PipelineAllView(workspaceId: workspaceId)
        }
    }
}

/// A centered native alert guards every entry into the combined view while presenting.
struct PipelineAllConfirmation: ViewModifier {
    @Binding var isPresented: Bool
    let onShow: () -> Void
    func body(content: Content) -> some View {
        content.alert(T("Show all companies?"), isPresented: $isPresented) {
            Button(T("Cancel"), role: .cancel) {}
            Button(T("Show all companies")) { onShow() }
        } message: {
            Text(T("Presentation mode is on. All Pipelines shows the deals of every company's board on this screen. Amounts stay hidden."))
        }
    }
}

/// Native menu in the existing project title. Non-management sees precisely the plain project name.
struct PipelineBoardSwitcher: View {
    let projectId: String?
    let title: String
    var fontSize: CGFloat = 20
    var weight: Font.Weight = .bold
    var idealWraps = false
    @Environment(AuthStore.self) private var auth
    @State private var directory = PipelineBoardDirectory.shared
    @State private var presentation = PipelinePresentationSession.shared
    @State private var target: PipelineNavigationTarget?
    @State private var confirmAll = false

    var body: some View {
        Group {
            if directory.canView {
                Menu {
                    Section(T("Pipeline boards")) {
                        ForEach(directory.boards) { board in
                            let count = String(format: T(board.dealCount == 1 ? "%d deal" : "%d deals"), board.dealCount)
                            // The count is the item's subtitle (a menu draws a second Text under the first), not
                            // " · 43 deals" glued to a long name that broke onto its own line (visual QA 24 Oct 2026).
                            // The board on screen is a ticked toggle: a menu draws its check AND the subtitle, which a
                            // Label inside a Button did not (the count went missing on that row).
                            if board.id == projectId {
                                Toggle(isOn: .constant(true)) {
                                    Text(board.name)
                                    Text(count)
                                }
                                .accessibilityIdentifier("pipeline.switch.board.\(board.id)")
                            } else {
                                Button {
                                    target = .board(id: board.id, name: board.name)
                                } label: {
                                    Text(board.name)
                                    Text(count)
                                }
                                .accessibilityIdentifier("pipeline.switch.board.\(board.id)")
                            }
                        }
                    }
                    Divider()
                    Button {
                        guard projectId != nil else { return }
                        if presentation.isPresenting { confirmAll = true }
                        else { showAll() }
                    } label: {
                        Label(T("All Pipelines"), systemImage: projectId == nil ? "checkmark" : "square.3.layers.3d")
                    }
                    .accessibilityIdentifier("pipeline.switch.all")
                } label: {
                    HStack(spacing: 7) {
                        titleText
                        Image(systemName: "chevron.down").font(.system(size: 12, weight: .semibold)).foregroundStyle(NX.mutedFg)
                    }
                }
                .menuIndicator(.hidden)
                .accessibilityIdentifier("pipeline.switcher")
                .accessibilityLabel(T("Switch pipeline board"))
                .accessibilityValue(title)
            } else {
                titleText
            }
        }
        .liveRefresh(every: 60, on: [.nexusPipelineChanged, .nexusWorkspaceChanged]) {
            await directory.load(viewerId: auth.session?.userId, force: true)
        }
        .navigationDestination(item: $target) {
            PipelineDestination(target: $0, boardReturnsToAll: projectId == nil)
        }
        .modifier(PipelineAllConfirmation(isPresented: $confirmAll, onShow: showAll))
    }

    private var titleText: some View {
        WordWrapText.projectTitle(title, size: fontSize, weight: weight, idealWraps: idealWraps).foregroundStyle(NX.foreground)
    }

    private func showAll() { target = .all(workspaceId: directory.workspaceId) }
}

/// Pinned above the workspace's folders and project rows, in either grid or list mode.
struct PipelineAllProjectsEntry: View {
    let onOpen: () -> Void
    @Environment(AuthStore.self) private var auth
    @State private var directory = PipelineBoardDirectory.shared
    @State private var presentation = PipelinePresentationSession.shared
    @State private var confirmAll = false

    var body: some View {
        Group {
            if directory.canView {
                Button {
                    if presentation.isPresenting { confirmAll = true }
                    else { showAll() }
                } label: {
                    HStack(spacing: 12) {
                        Image(systemName: "square.3.layers.3d").font(.system(size: 22, weight: .medium))
                            .foregroundStyle(NX.foreground).frame(width: 44, height: 44)
                            .background(NX.muted, in: Circle())
                        VStack(alignment: .leading, spacing: 3) {
                            Text(T("All Pipelines")).font(NXFont.text(16, .semibold)).foregroundStyle(NX.foreground)
                            Text(String(format: T(directory.boards.count == 1 ? "%d board · combined" : "%d boards · combined"), directory.boards.count))
                                .font(NXFont.text(12)).foregroundStyle(NX.mutedFg)
                        }
                        Spacer(minLength: 8)
                        Image(systemName: "arrow.right").font(.system(size: 15, weight: .semibold)).foregroundStyle(NX.mutedFg)
                    }
                    .padding(16).frame(maxWidth: .infinity, alignment: .leading)
                    .background(NX.card, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).strokeBorder(NX.border))
                    .contentShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
                }
                .buttonStyle(PressableCardStyle())
                .accessibilityIdentifier("pipeline.all.entry")
            }
        }
        .task { await directory.load(viewerId: auth.session?.userId) }
        .liveRefresh(every: 60, on: [.nexusWorkspaceChanged], kinds: [RealtimeKind.projects]) {
            await directory.load(viewerId: auth.session?.userId, force: true)
        }
        .modifier(PipelineAllConfirmation(isPresented: $confirmAll, onShow: showAll))
    }

    private func showAll() { onOpen() }
}

struct PipelineAllView: View {
    let workspaceId: String?
    @Environment(AuthStore.self) private var auth
    var body: some View {
        PipelineTab(allIn: workspaceId)
            .background(NX.background.ignoresSafeArea())
            .navigationTitle(T("All Pipelines"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar(.visible, for: .navigationBar)
            .toolbar {
                ToolbarItem(placement: .principal) {
                    PipelineBoardSwitcher(projectId: nil, title: T("All Pipelines"))
                }
            }
            .task(id: auth.session?.userId) {
                await PipelineBoardDirectory.shared.load(viewerId: auth.session?.userId)
            }
    }
}

/// Hold all source rooms while the combined screen is visible. Reference counting also permits an
/// open source-board deal to hold its own room without leaving the combined view's subscription.
struct PipelineBoardRooms: ViewModifier {
    let boardIds: [String]
    func body(content: Content) -> some View {
        content.task(id: boardIds.sorted()) {
            let rooms = boardIds.map { "project:\($0)" }
            for room in rooms { RealtimeClient.shared.join(room) }
            defer { for room in rooms { RealtimeClient.shared.leave(room) } }
            while !Task.isCancelled { try? await Task.sleep(for: .seconds(60)) }
        }
    }
}

/// The combined board never edits directly. Read permission again in the deal's own board before
/// rendering the normal editor, and label the company plus the route back to All Pipelines.
struct PipelineSourceDealSheet: View {
    let projectId: String
    let sourceName: String
    let dealId: String
    @State private var store: PipelineStore
    @Environment(AuthStore.self) private var auth
    @Environment(\.dismiss) private var dismiss

    init(projectId: String, sourceName: String, dealId: String) {
        self.projectId = projectId; self.sourceName = sourceName; self.dealId = dealId
        _store = State(initialValue: PipelineStore(projectId: projectId))
    }

    var body: some View {
        Group {
            if store.forbidden {
                NavigationStack {
                    EmptyState(icon: "lock", title: T("This pipeline is for its project members"),
                        subtitle: T("Ask the Project Owner or a board member to add you to the project."))
                        .toolbar { ToolbarItem(placement: .cancellationAction) { Button(T("Done")) { dismiss() } } }
                }
            } else if store.loaded && store.deal(dealId) == nil {
                NavigationStack {
                    EmptyState(icon: "doc.questionmark", title: T("This deal is no longer available"),
                        subtitle: T("What this link opened is no longer available. Ask the sender for a new link."),
                        actionTitle: T("All Pipelines"), actionIcon: "arrow.left", action: { dismiss() })
                        .toolbar { ToolbarItem(placement: .cancellationAction) { Button(T("Done")) { dismiss() } } }
                }
            } else if store.loaded {
                PipelineDealView(store: store, dealId: dealId, sourceName: sourceName, fromAll: true)
            } else if let error = store.loadError {
                NavigationStack {
                    ErrorState(message: error) { Task { await store.load() } }
                        .toolbar { ToolbarItem(placement: .cancellationAction) { Button(T("Done")) { dismiss() } } }
                }
            } else {
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .task { await store.load() }
        .realtimeRoom("project:\(projectId)")
        .liveRefresh(every: 60, on: [.nexusPipelineChanged], projectId: projectId) { await store.load() }
        .onChange(of: store.signedOut) { _, out in if out { auth.logout() } }
    }
}

struct PipelineCompanyChip: View {
    let source: PipelineDealSource?
    var body: some View {
        if let source {
            Label(shortName(source.name), systemImage: "building.2")
                .font(NXFont.text(10, .semibold)).foregroundStyle(NX.violetText)
                .padding(.horizontal, 7).padding(.vertical, 3)
                .background(NX.violet.opacity(0.08), in: Capsule())
                .lineLimit(1).help(source.name)
                .accessibilityLabel("\(T("Company")): \(source.name)")
                .accessibilityIdentifier("pipeline.company.label")
        }
    }
    private func shortName(_ name: String) -> String {
        name.hasPrefix("Pipeline ") ? String(name.dropFirst("Pipeline ".count)) : name
    }
}
