import SwiftUI

struct SearchResults: Decodable, Sendable {
    let tasks: [TaskHit]?
    let projects: [ProjHit]?
    let docs: [DocHit]?
    let forms: [FormHit]?
    let members: [MemberHit]?
    struct TaskHit: Decodable, Identifiable, Sendable { let id: String; let title: String }
    struct ProjHit: Decodable, Identifiable, Sendable { let id: String; let name: String; let color: String? }
    struct DocHit: Decodable, Identifiable, Sendable { let id: String; let title: String }
    struct FormHit: Decodable, Identifiable, Sendable { let id: String; let name: String }
    struct MemberHit: Decodable, Identifiable, Sendable { let id: String; let name: String?; let email: String?; let avatar: String? }

    var isEmpty: Bool {
        (tasks?.isEmpty ?? true) && (projects?.isEmpty ?? true) && (docs?.isEmpty ?? true) && (forms?.isEmpty ?? true) && (members?.isEmpty ?? true)
    }
}

/// Global search across projects / tasks / docs / forms / members (web /api/search).
struct SearchView: View {
    @Environment(AuthStore.self) private var auth
    @FocusState private var focused: Bool
    @State private var query = ""
    @State private var results: SearchResults?
    @State private var loading = false
    @State private var openTaskId: String?
    @State private var openProfile: ProfileTarget?
    @State private var searchTask: Task<Void, Never>?

    var body: some View {
        ZStack {
            NX.background.ignoresSafeArea()
            VStack(spacing: 0) {
                searchField
                content
            }
        }
        .navigationTitle("Search")
        .navigationBarTitleDisplayMode(.inline)
        .navigationDestination(item: $openTaskId) { tid in TaskDetailView(taskId: tid) }
        .navigationDestination(item: $openProfile) { MemberProfileView(target: $0) }
        .onAppear { focused = true; if query.trimmingCharacters(in: .whitespaces).count >= 2 { debounceSearch(query) } }
    }

    private var searchField: some View {
        HStack(spacing: 8) {
            Image(systemName: "magnifyingglass").font(.system(size: 15)).foregroundStyle(NX.mutedFg)
            TextField(T("Search tasks, projects, docs, members…"), text: $query)
                .font(NXFont.text(15)).focused($focused).autocorrectionDisabled().submitLabel(.search)
            if !query.isEmpty {
                Button { query = ""; results = nil } label: { Image(systemName: "xmark.circle.fill").foregroundStyle(NX.mutedFg) }.buttonStyle(.plain)
            }
        }
        .padding(.horizontal, 16).frame(height: 46)
        .background(NX.card, in: Capsule()).overlay(Capsule().strokeBorder(NX.border))
        .padding(16)
        .onChange(of: query) { _, q in debounceSearch(q) }
    }

    @ViewBuilder private var content: some View {
        if loading {
            ProgressView().tint(NX.violetText).frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if query.trimmingCharacters(in: .whitespaces).count < 2 {
            placeholder("magnifyingglass", T("Type at least 2 characters to search."))
        } else if let r = results, r.isEmpty {
            placeholder("text.magnifyingglass", "\(T("No results for")) \"\(query)\".")
        } else if let r = results {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    if let projects = r.projects, !projects.isEmpty {
                        group("PROJECTS") {
                            ForEach(projects) { p in
                                NavigationLink { ProjectDetailView(projectId: p.id, projectName: p.name) } label: {
                                    hit(icon: "rectangle.stack.fill", tint: Color(hex: p.color ?? "#7b68ee"), title: p.name, sub: nil)
                                }.buttonStyle(.plain)
                            }
                        }
                    }
                    if let tasks = r.tasks, !tasks.isEmpty {
                        group("TASKS") {
                            ForEach(tasks) { t in
                                Button { openTaskId = t.id } label: { hit(icon: "checklist", tint: NX.success, title: t.title, sub: nil) }.buttonStyle(.plain)
                            }
                        }
                    }
                    if let docs = r.docs, !docs.isEmpty {
                        group("DOCS") {
                            ForEach(docs) { d in
                                NavigationLink { DocReaderView(docId: d.id, title: d.title) } label: { hit(icon: "doc.text.fill", tint: NX.violetText, title: d.title, sub: nil) }.buttonStyle(.plain)
                            }
                        }
                    }
                    if let forms = r.forms, !forms.isEmpty {
                        group("FORMS") {
                            ForEach(forms) { f in
                                NavigationLink { FormFillView(formId: f.id, title: f.name) } label: {
                                    hit(icon: "list.clipboard.fill", tint: NX.blue, title: f.name, sub: nil)
                                }.buttonStyle(.plain)
                            }
                        }
                    }
                    if let members = r.members, !members.isEmpty {
                        group("MEMBERS") {
                            ForEach(members) { m in
                                Button { openProfile = ProfileTarget(userId: m.id, name: m.name, avatar: m.avatar) } label: {
                                    hit(icon: "person.fill", tint: NX.coral, title: m.name ?? m.email ?? "—", sub: m.email)
                                }.buttonStyle(.plain)
                            }
                        }
                    }
                }.padding(16)
            }
        } else {
            placeholder("magnifyingglass", T("Start typing to search."))
        }
    }

    private func group<C: View>(_ label: String, @ViewBuilder _ content: () -> C) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            SectionLabel(label).padding(.leading, 4)
            VStack(spacing: 8) { content() }
        }
    }
    private func hit(icon: String, tint: Color, title: String, sub: String?) -> some View {
        HStack(spacing: 12) {
            Image(systemName: icon).font(.system(size: 14)).foregroundStyle(tint)
                .frame(width: 34, height: 34).background(tint.opacity(0.14), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(NXFont.text(14, .semibold)).foregroundStyle(NX.foreground).lineLimit(1)
                if let sub, !sub.isEmpty { Text(sub).font(NXFont.text(11)).foregroundStyle(NX.mutedFg).lineLimit(1) }
            }
            Spacer(minLength: 4)
            Image(systemName: "chevron.right").font(.system(size: 11, weight: .bold)).foregroundStyle(NX.mutedFg.opacity(0.5))
        }
        .padding(12).frame(maxWidth: .infinity, alignment: .leading)
        .background(NX.card, in: RoundedRectangle(cornerRadius: 14, style: .continuous)).overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(NX.border))
    }
    private func placeholder(_ icon: String, _ text: String) -> some View {
        VStack(spacing: 8) {
            Image(systemName: icon).font(.system(size: 40)).foregroundStyle(NX.mutedFg.opacity(0.5))
            Text(text).font(NXFont.text(13)).foregroundStyle(NX.mutedFg).multilineTextAlignment(.center)
        }.frame(maxWidth: .infinity, maxHeight: .infinity).padding(32)
    }

    private func debounceSearch(_ q: String) {
        searchTask?.cancel()
        let trimmed = q.trimmingCharacters(in: .whitespaces)
        guard trimmed.count >= 2 else { results = nil; loading = false; return }
        searchTask = Task {
            try? await Task.sleep(nanoseconds: 300_000_000)
            if Task.isCancelled { return }
            loading = true
            let r = try? await APIClient.shared.search(trimmed)
            if Task.isCancelled { return }
            results = r; loading = false
        }
    }
}
