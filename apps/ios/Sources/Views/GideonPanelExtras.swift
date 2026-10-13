import SwiftUI

// ─────────────────────────────────────────────────────────────────────────────
// GIDEON panel extras (web, 12 Oct 2026): the @ picker that adds pages, tasks and projects as context,
// Personalize (a name and standing instructions), and Save as doc (an answer becomes a page in a project).
// ─────────────────────────────────────────────────────────────────────────────

enum GideonMention {
    /// The "@query" at the end of the draft (web: `(^|\s)@([^\s@]{0,40})$`), or nil.
    static func query(in draft: String) -> String? {
        guard let r = draft.range(of: #"(^|\s)@([^\s@]{0,40})$"#, options: .regularExpression) else { return nil }
        let match = String(draft[r])
        guard let at = match.lastIndex(of: "@") else { return nil }
        return String(match[match.index(after: at)...])
    }

    /// The draft without its trailing "@query".
    static func strip(_ draft: String) -> String {
        guard let r = draft.range(of: #"@([^\s@]{0,40})$"#, options: .regularExpression) else { return draft }
        return String(draft[..<r.lowerBound])
    }
}

/// Search results for the @ picker: up to 4 projects, 4 pages and 6 tasks this account can see.
struct GideonMentionPicker: View {
    let query: String
    let onPick: (GideonRef) -> Void
    @State private var hits: [GideonRef] = []
    @State private var subtitles: [String: String] = [:]
    @State private var searching = false

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if query.isEmpty {
                Text(T("Type to search projects, tasks and docs you can see.")).font(NXFont.text(12)).foregroundStyle(NX.mutedFg).padding(10)
            } else if searching && hits.isEmpty {
                Text(T("Searching…")).font(NXFont.text(12)).foregroundStyle(NX.mutedFg).padding(10)
            } else if hits.isEmpty {
                Text(String(format: T("Nothing you can see matches “%@”."), query)).font(NXFont.text(12)).foregroundStyle(NX.mutedFg).padding(10)
            } else {
                ScrollView {
                    VStack(alignment: .leading, spacing: 0) {
                        ForEach(hits, id: \.self) { h in row(h) }
                    }
                }
                .frame(maxHeight: 220)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(NX.card, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(NX.border))
        .padding(.horizontal, 16).padding(.bottom, 6)
        .task(id: query) { await search() }
    }

    private func row(_ h: GideonRef) -> some View {
        Button { onPick(h) } label: {
            HStack(spacing: 8) {
                if h.kind == "project" {
                    ProjectMark(icon: nil, color: nil, size: 16, projectId: h.id).frame(width: 18)
                } else {
                    Image(systemName: h.kind == "task" ? "checklist" : "doc.text")
                        .font(.system(size: 12, weight: .semibold)).foregroundStyle(NX.mutedFg).frame(width: 18)
                }
                VStack(alignment: .leading, spacing: 1) {
                    Text(h.title ?? "").font(NXFont.text(13, .semibold)).foregroundStyle(NX.foreground).lineLimit(1)
                    if let sub = subtitles[h.kind + h.id] {
                        Text(sub).font(NXFont.text(11)).foregroundStyle(NX.mutedFg).lineLimit(1)
                    }
                }
                Spacer(minLength: 0)
                Text(kindLabel(h.kind)).font(NXFont.text(10, .semibold)).foregroundStyle(NX.mutedFg)
            }
            .padding(.horizontal, 10).frame(minHeight: 44)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .hoverEffect(.highlight)
    }

    private func kindLabel(_ k: String) -> String {
        k == "project" ? T("Project") : (k == "task" ? T("Task") : T("Doc"))
    }

    private func search() async {
        let q = query.trimmingCharacters(in: .whitespaces)
        guard !q.isEmpty else { hits = []; return }
        try? await Task.sleep(for: .milliseconds(180))
        if Task.isCancelled { return }
        searching = true
        defer { searching = false }
        guard let r = try? await APIClient.shared.search(q) else { return }
        let low = q.lowercased()
        func score(_ t: String) -> Int { let l = t.lowercased(); return l == low ? 3 : (l.hasPrefix(low) ? 2 : (l.contains(low) ? 1 : 0)) }
        let projects = (r.projects ?? []).prefix(4).map { GideonRef(kind: "project", id: $0.id, title: $0.name, projectId: $0.id) }
        let docs = (r.docs ?? []).filter { !$0.title.isEmpty && ($0.title != "Untitled" || "untitled".hasPrefix(low) || T("Untitled").lowercased().hasPrefix(low)) }.prefix(4)
            .map { GideonRef(kind: "doc", id: $0.id, title: DocTitle.display($0.title), projectId: nil) }
        let tasks = (r.tasks ?? []).prefix(6).map { GideonRef(kind: "task", id: $0.id, title: $0.title, projectId: nil) }
        hits = (Array(projects) + Array(docs) + Array(tasks)).sorted { score($0.title ?? "") > score($1.title ?? "") }
    }
}

/// Personalize GIDEON: what to call it, and how you like answers. Only for you.
struct GideonPersonalizeSheet: View {
    let onSaved: (GideonPrefs) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var instructions = ""
    @State private var loading = true
    @State private var saving = false
    @State private var problem: String?

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Text(T("Only for you. GIDEON still acts with your access and nothing more."))
                        .font(NXFont.text(13)).foregroundStyle(NX.mutedFg)
                }
                Section(T("What do you call it?")) {
                    TextField("GIDEON", text: $name)
                        .onChange(of: name) { _, v in if v.count > 40 { name = String(v.prefix(40)) } }
                }
                Section {
                    TextField(T("e.g. Answer in Indonesian, short bullet points. I lead the Atlas launch, so flag anything that blocks it."),
                              text: $instructions, axis: .vertical)
                        .lineLimit(4...12)
                        .onChange(of: instructions) { _, v in if v.count > 2000 { instructions = String(v.prefix(2000)) } }
                } header: { Text(T("Instructions")) } footer: {
                    HStack {
                        Text(T("How you like answers: language, length, tone, what to focus on. Applied to every chat of yours."))
                        Spacer()
                        Text("\(instructions.count)/2000").monospacedDigit()
                    }
                }
                if let problem { Text(problem).font(NXFont.text(12)).foregroundStyle(NX.danger) }
            }
            .disabled(loading)
            .navigationTitle(T("Personalize GIDEON"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(T("Cancel")) { dismiss() }.keyboardShortcut(.cancelAction) }
                ToolbarItem(placement: .confirmationAction) {
                    Button { Task { await save() } } label: { if saving { ProgressView() } else { Text(T("Save")).bold() } }
                        .disabled(saving || loading)
                }
            }
            .task {
                if let p = try? await GideonClient.prefs() {
                    name = p.assistantName ?? ""
                    instructions = p.instructions ?? ""
                }
                loading = false
            }
        }
    }

    private func save() async {
        guard !saving else { return }
        saving = true
        defer { saving = false }
        do {
            let p = try await GideonClient.savePrefs(GideonPrefs(assistantName: name.trimmingCharacters(in: .whitespacesAndNewlines),
                                                               instructions: instructions.trimmingCharacters(in: .whitespacesAndNewlines)))
            onSaved(p)
            dismiss()
        } catch {
            problem = (error as? LocalizedError)?.errorDescription ?? T("Couldn't save.")
        }
    }
}

/// Save an answer as a page: pick the project (the chat's own first), then it is created on the server.
struct GideonSaveDocSheet: View {
    let title: String
    let markdown: String
    let contextProjectId: String?
    let contextProjectName: String?
    let onSaved: (String) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var projects: [Project] = []
    @State private var query = ""
    @State private var saving: String?
    @State private var problem: String?

    private var shown: [Project] {
        let q = query.trimmingCharacters(in: .whitespaces).lowercased()
        return Array(projects.filter { $0.id != contextProjectId && (q.isEmpty || $0.name.lowercased().contains(q)) }.prefix(60))
    }

    var body: some View {
        NavigationStack {
            List {
                if let problem { Text(problem).font(NXFont.text(12)).foregroundStyle(NX.danger) }
                if let pid = contextProjectId, query.isEmpty {
                    Section { projectRow(id: pid, name: contextProjectName ?? T("This project"), label: T("This project")) }
                }
                Section(T("Save into project")) {
                    if shown.isEmpty && !query.isEmpty {
                        Text(String(format: T("No project matches “%@”."), query)).foregroundStyle(NX.mutedFg)
                    }
                    ForEach(shown) { p in projectRow(id: p.id, name: p.name, label: nil) }
                }
            }
            .searchable(text: $query, prompt: T("Search projects"))
            .navigationTitle(T("Save as doc"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button(T("Cancel")) { dismiss() }.keyboardShortcut(.cancelAction) } }
            .task { projects = (try? await APIClient.shared.projects()) ?? [] }
        }
    }

    private func projectRow(id: String, name: String, label: String?) -> some View {
        Button { Task { await save(id) } } label: {
            HStack {
                VStack(alignment: .leading, spacing: 1) {
                    Text(name).foregroundStyle(NX.foreground).lineLimit(1)
                    if let label { Text(label).font(NXFont.text(11)).foregroundStyle(NX.mutedFg) }
                }
                Spacer()
                if saving == id { ProgressView() }
            }
            .frame(minHeight: 44).contentShape(Rectangle())
        }
        .disabled(saving != nil)
    }

    private func save(_ projectId: String) async {
        guard saving == nil else { return }
        saving = projectId
        defer { saving = nil }
        do {
            let id = try await GideonClient.saveAsDoc(projectId: projectId, title: title, markdown: markdown)
            dismiss()
            onSaved(id)
        } catch {
            problem = (error as? LocalizedError)?.errorDescription ?? T("Couldn't save.")
        }
    }
}

/// An answer to save (sheet item).
struct GideonSaveRequest: Identifiable {
    let id = UUID()
    let title: String
    let markdown: String
}
