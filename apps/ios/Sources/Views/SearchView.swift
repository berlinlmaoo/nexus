import SwiftUI

struct SearchResults: Decodable, Sendable {
    let tasks: [TaskHit]?
    let projects: [ProjHit]?
    let docs: [DocHit]?
    let forms: [FormHit]?
    let members: [MemberHit]?
    struct TaskHit: Decodable, Identifiable, Sendable {
        let id: String
        let title: String
        /// The task's project, for the result's second line (web search, QA 13 Oct 2026).
        let taskList: ListRef?
        struct ListRef: Decodable, Sendable { let project: NameRef? }
        var projectName: String? { taskList?.project?.name }
    }
    struct ProjHit: Decodable, Identifiable, Sendable { let id: String; let name: String; let color: String?; let icon: String? }
    struct DocHit: Decodable, Identifiable, Sendable {
        let id: String
        let title: String
        let project: NameRef?
    }
    struct FormHit: Decodable, Identifiable, Sendable { let id: String; let name: String }
    struct MemberHit: Decodable, Identifiable, Sendable { let id: String; let name: String?; let email: String?; let avatar: String? }
    struct NameRef: Decodable, Sendable { let name: String? }

    var isEmpty: Bool {
        (tasks?.isEmpty ?? true) && (projects?.isEmpty ?? true) && (docs?.isEmpty ?? true) && (forms?.isEmpty ?? true) && (members?.isEmpty ?? true)
    }
}

/// Where a result leads. One destination for every kind, so a hardware keyboard's ↑ ↓ Enter can open any
/// of them the same way a tap does (web search, QA 13 Oct 2026).
private enum SearchTarget: Hashable {
    case project(id: String, name: String)
    case task(String)
    case doc(id: String, title: String)
    case form(id: String, name: String)
    case profile(ProfileTarget)
    case chat(id: String, title: String)
}

/// One row of the results, in the order they are drawn.
private struct SearchRow: Identifiable {
    let id: String
    let icon: String
    let tint: Color
    let title: String
    let sub: String?
    var mark: AnyView? = nil
    let open: () -> Void
}

/// Global search across projects / tasks / docs / forms / members (web /api/search).
struct SearchView: View {
    @Environment(AuthStore.self) private var auth
    @FocusState private var focused: Bool
    @State private var query = ""
    @State private var results: SearchResults?
    /// The words `results` answer (Enter must not open a result of the previous words while a search runs).
    @State private var resultsQuery = ""
    @State private var loading = false
    @State private var target: SearchTarget?
    @State private var searchTask: Task<Void, Never>?
    /// The row ↑ ↓ moved to (hardware keyboard); Enter opens it. -1 = none chosen yet (Enter = the first).
    @State private var active = -1
    @State private var startingChat = false
    @State private var chatError: String?
    @State private var viewer = Viewer.shared

    private var meId: String? { auth.session?.userId }

    var body: some View {
        ZStack {
            NX.background.ignoresSafeArea()
            VStack(spacing: 0) {
                searchField
                content
            }
        }
        .navigationTitle(T("Search"))
        .navigationBarTitleDisplayMode(.inline)
        .navigationDestination(item: $target) { t in destination(t) }
        .onAppear { focused = true; if query.trimmingCharacters(in: .whitespaces).count >= 2 { debounceSearch(query) } }
        .task { await viewer.loadIfNeeded() }
        .alert(T("Couldn't start the chat."), isPresented: Binding(get: { chatError != nil }, set: { if !$0 { chatError = nil } })) {
            Button("OK", role: .cancel) {}
        } message: { Text(chatError ?? "") }
    }

    @ViewBuilder private func destination(_ t: SearchTarget) -> some View {
        switch t {
        case .project(let id, let name): ProjectDetailView(projectId: id, projectName: name)
        case .task(let id): TaskDetailView(taskId: id)
        case .doc(let id, let title): DocReaderView(docId: id, title: title)
        case .form(let id, let name): FormFillView(formId: id, title: name)
        case .profile(let p): MemberProfileView(target: p)
        case .chat(let id, let title): ChatThreadView(conversationId: id, title: title, type: "DM")
        }
    }

    private var searchField: some View {
        HStack(spacing: 8) {
            Image(systemName: "magnifyingglass").font(.system(size: 15)).foregroundStyle(NX.mutedFg)
            TextField(T("Search tasks, projects, docs, members…"), text: $query)
                .font(NXFont.text(15)).focused($focused).autocorrectionDisabled().submitLabel(.search)
                // Enter opens the chosen result (the first when none was chosen); ↑ ↓ move (web).
                .onSubmit { openActive() }
                .onKeyPress(.downArrow) { move(1); return .handled }
                .onKeyPress(.upArrow) { move(-1); return .handled }
            if !query.isEmpty {
                Button { query = ""; results = nil } label: { Image(systemName: "xmark.circle.fill").foregroundStyle(NX.mutedFg).touchTarget44(drawn: 20) }
                    .buttonStyle(.plain)
                    .accessibilityLabel(T("Clear"))
            }
        }
        .padding(.horizontal, 16).frame(height: 46)
        .background(NX.card, in: Capsule()).overlay(Capsule().strokeBorder(NX.border))
        .padding(16)
        .onChange(of: query) { _, q in debounceSearch(q) }
        // ⌘F puts the cursor back in the box (iPad keyboard, Mac).
        .background {
            Button("") { focused = true }
                .keyboardShortcut("f", modifiers: .command)
                .opacity(0).accessibilityHidden(true)
        }
    }

    @ViewBuilder private var content: some View {
        if loading {
            ProgressView().tint(NX.violetText).frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if query.trimmingCharacters(in: .whitespaces).count < 2 {
            placeholder("magnifyingglass", T("Type at least 2 characters to search."))
        } else if let r = results, r.isEmpty {
            placeholder("text.magnifyingglass", "\(T("No results for")) \"\(query)\".")
        } else if let r = results {
            let groups = sections(r)
            ScrollViewReader { proxy in
                ScrollView {
                    VStack(alignment: .leading, spacing: 18) {
                        ForEach(groups, id: \.label) { g in
                            group(g.label) {
                                ForEach(g.rows) { row in
                                    let index = flat(groups).firstIndex(where: { $0.id == row.id }) ?? -1
                                    Button { row.open() } label: {
                                        hit(icon: row.icon, tint: row.tint, title: row.title, sub: row.sub, mark: row.mark, on: index == active)
                                    }
                                    .buttonStyle(.plain)
                                    .hoverEffect(.highlight)
                                    .id(row.id)
                                }
                            }
                        }
                    }.padding(16)
                }
                .onChange(of: active) { _, i in
                    let rows = flat(groups)
                    if rows.indices.contains(i) { withAnimation(.easeOut(duration: 0.15)) { proxy.scrollTo(rows[i].id, anchor: .center) } }
                }
            }
        } else {
            placeholder("magnifyingglass", T("Start typing to search."))
        }
    }

    // MARK: rows

    private struct ResultGroup { let label: String; let rows: [SearchRow] }

    private func sections(_ r: SearchResults) -> [ResultGroup] {
        var out: [ResultGroup] = []
        let projects = (r.projects ?? []).prefix(6).map { p in
            SearchRow(id: "p:\(p.id)", icon: "rectangle.stack.fill", tint: .clear, title: p.name, sub: nil,
                      mark: AnyView(ProjectMark(icon: p.icon, color: p.color, size: 34, projectId: p.id))) { target = .project(id: p.id, name: p.name) }
        }
        if !projects.isEmpty { out.append(ResultGroup(label: "PROJECTS", rows: projects)) }
        let tasks = (r.tasks ?? []).prefix(6).map { t in
            SearchRow(id: "t:\(t.id)", icon: "checklist", tint: NX.success, title: t.title, sub: t.projectName) { target = .task(t.id) }
        }
        if !tasks.isEmpty { out.append(ResultGroup(label: "TASKS", rows: tasks)) }
        let docs = (r.docs ?? []).prefix(6).map { d in
            // A page stored as "Untitled" reads "Tanpa judul" in Indonesian (web docTitle).
            SearchRow(id: "d:\(d.id)", icon: "doc.text.fill", tint: NX.violetText, title: DocTitle.display(d.title), sub: d.project?.name) {
                target = .doc(id: d.id, title: DocTitle.display(d.title))
            }
        }
        if !docs.isEmpty { out.append(ResultGroup(label: "DOCS", rows: docs)) }
        let forms = (r.forms ?? []).prefix(6).map { f in
            SearchRow(id: "f:\(f.id)", icon: "list.clipboard.fill", tint: NX.blue, title: f.name, sub: nil) { target = .form(id: f.id, name: f.name) }
        }
        if !forms.isEmpty { out.append(ResultGroup(label: "FORMS", rows: forms)) }
        let people = (r.members ?? []).prefix(6).map { m -> SearchRow in
            let record = opensRecord(m.id)
            return SearchRow(id: "m:\(m.id)", icon: record ? "person.fill" : "bubble.left.fill", tint: NX.coral,
                             title: m.name ?? m.email ?? "—", sub: record ? m.email : T("Message")) { openPerson(m) }
        }
        if !people.isEmpty { out.append(ResultGroup(label: "MEMBERS", rows: people)) }
        return out
    }

    private func flat(_ groups: [ResultGroup]) -> [SearchRow] { groups.flatMap(\.rows) }

    /// A person opens their record only where the viewer may read it (BoD, One Above All, themselves);
    /// for everyone else the chat with that person (web search, QA 13 Oct 2026 S-08: never a page that
    /// answers "not for your role").
    private func opensRecord(_ userId: String) -> Bool { userId == meId || viewer.isBoD }

    private func openPerson(_ m: SearchResults.MemberHit) {
        if opensRecord(m.id) {
            target = .profile(ProfileTarget(userId: m.id, name: m.name, avatar: m.avatar))
            return
        }
        guard !startingChat else { return }
        startingChat = true
        Task {
            defer { startingChat = false }
            do {
                // The DM with that person (the server answers the existing one when there is one).
                let convo = try await APIClient.shared.createConversation(type: "DM", userIds: [m.id], name: nil)
                target = .chat(id: convo.id, title: m.name ?? m.email ?? T("Message"))
            } catch APIError.unauthorized {
                auth.logout()
            } catch {
                chatError = (error as? LocalizedError)?.errorDescription ?? T("Try again.")
            }
        }
    }

    // MARK: keyboard

    private func move(_ d: Int) {
        guard let r = results else { return }
        let count = flat(sections(r)).count
        guard count > 0 else { return }
        active = active < 0 ? (d > 0 ? 0 : count - 1) : (active + d + count) % count
    }

    private func openActive() {
        guard let r = results, !loading, resultsQuery == query.trimmingCharacters(in: .whitespaces) else { return }
        let rows = flat(sections(r))
        guard !rows.isEmpty else { return }
        rows[rows.indices.contains(active) ? active : 0].open()
    }

    // MARK: drawing

    private func group<C: View>(_ label: String, @ViewBuilder _ content: () -> C) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            SectionLabel(label).padding(.leading, 4)
            VStack(spacing: 8) { content() }
        }
    }
    private func hit(icon: String, tint: Color, title: String, sub: String?, mark: AnyView? = nil, on: Bool = false) -> some View {
        HStack(spacing: 12) {
            Group {
                if let mark { mark } else { Image(systemName: icon).font(.system(size: 14)).foregroundStyle(tint) }
            }
                .frame(width: 34, height: 34).background(tint.opacity(0.14), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(NXFont.text(14, .semibold)).foregroundStyle(NX.foreground).lineLimit(1)
                if let sub, !sub.isEmpty { Text(sub).font(NXFont.text(11)).foregroundStyle(NX.mutedFg).lineLimit(1) }
            }
            Spacer(minLength: 4)
            Image(systemName: on ? "return" : "chevron.right").font(.system(size: 11, weight: .bold)).foregroundStyle(NX.mutedFg.opacity(on ? 0.9 : 0.5))
        }
        .padding(12).frame(maxWidth: .infinity, alignment: .leading)
        .background(on ? NX.muted : NX.card, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(on ? NX.violet.opacity(0.5) : NX.border))
    }
    private func placeholder(_ icon: String, _ text: String) -> some View {
        VStack(spacing: 8) {
            Image(systemName: icon).font(.system(size: 40)).foregroundStyle(NX.mutedFg.opacity(0.5))
            Text(text).font(NXFont.text(13)).foregroundStyle(NX.mutedFg).multilineTextAlignment(.center)
        }.frame(maxWidth: .infinity, maxHeight: .infinity).padding(32)
    }

    private func debounceSearch(_ q: String) {
        searchTask?.cancel()
        active = -1
        let trimmed = q.trimmingCharacters(in: .whitespaces)
        guard trimmed.count >= 2 else { results = nil; loading = false; return }
        searchTask = Task {
            try? await Task.sleep(nanoseconds: 300_000_000)
            if Task.isCancelled { return }
            loading = true
            let r = try? await APIClient.shared.search(trimmed)
            if Task.isCancelled { return }
            results = r; resultsQuery = trimmed; loading = false
        }
    }
}
