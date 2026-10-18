import SwiftUI

// A form's Responses (web components/forms/FormStudio.tsx ResponsesTab, 12 Oct 2026): each response is the task
// it created, newest first, with who sent it and when. The answers live on the task, so a row opens it. Project
// members only (server: GET /api/forms/:formId/responses, VIEWER). Live: `form-responses-changed` to the
// project's room reloads the list.

struct FormResponsesPayload: Decodable {
    let total: Int?
    let projectId: String?
    let responses: [FormResponseRow]?
}

struct FormResponseRow: Decodable, Identifiable {
    let id: String
    let createdAt: String?
    let submitter: Person?
    let task: TaskRef?

    struct Person: Decodable {
        let id: String
        let name: String?
        let email: String?
        let avatar: String?
    }

    struct TaskRef: Decodable {
        let id: String
        let title: String?
        let status: String?
        let section: String?
    }
}

extension APIClient {
    func formResponses(_ formId: String) async throws -> FormResponsesPayload {
        let enc = formId.addingPercentEncoding(withAllowedCharacters: CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "-._~"))) ?? formId
        let (data, response): (Data, URLResponse)
        do { (data, response) = try await perform(makeRequest("/api/forms/\(enc)/responses")) } catch { throw APIError.nothingAnswered(error) }
        guard let http = response as? HTTPURLResponse else { throw APIError.transport("No response") }
        if http.statusCode == 401 { throw APIError.unauthorized }
        guard (200..<300).contains(http.statusCode) else { throw APIError.http(http.statusCode, Self.serverMessage(data)) }
        do { return try JSONDecoder().decode(FormResponsesPayload.self, from: data) } catch { throw APIError.decoding }
    }
}

struct FormResponsesView: View {
    let formId: String
    let projectId: String
    /// Inside the form builder's Responses tab: the builder's bar keeps its own title.
    var embedded = false
    /// The total, for the builder's "Responses (n)" tab.
    var onCount: ((Int) -> Void)? = nil

    @Environment(AuthStore.self) private var auth
    @State private var payload: FormResponsesPayload?
    @State private var loadError: Error?
    @State private var loading = true
    @State private var openTask: String?

    private var rows: [FormResponseRow] { payload?.responses ?? [] }

    var body: some View {
        content
            .background(NX.background.ignoresSafeArea())
            .modifier(ResponsesTitle(on: !embedded))
            .task { await load() }
            .refreshable { await load() }
            // Held here too: the builder may be opened from the Forms page, where nothing else joined the room.
            .realtimeRoom("project:\(projectId)")
            .onReceive(NotificationCenter.default.publisher(for: .nexusFormResponsesChanged)) { note in
                let theirs = note.userInfo?[RealtimeKey.formId] as? String
                guard theirs == nil || theirs == formId else { return }
                Task { await load() }
            }
            .navigationDestination(item: $openTask) { id in TaskDetailView(taskId: id) }
            // Back from a task (moved, renamed, deleted): the list follows.
            .onChange(of: openTask) { _, now in if now == nil { Task { await load() } } }
    }

    @ViewBuilder private var content: some View {
        if loading && payload == nil {
            ProgressView().tint(NX.violetText).frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if let loadError, payload == nil {
            LoadErrorView(error: loadError, what: T("the responses"), retry: { Task { await load() } })
        } else if rows.isEmpty {
            EmptyState(icon: "tray", title: T("No responses yet"),
                       subtitle: T("Share the form's link. Each answer arrives here and on the project board as a task."))
        } else {
            list
        }
    }

    private var list: some View {
        List {
            Section {
                ForEach(rows) { r in
                    FormResponseRowView(row: r) { if let id = r.task?.id { openTask = id } }
                }
            } header: {
                Text(countText)
            } footer: {
                Text(T("Each response is a task in this project. Open one to work on it."))
            }
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
    }

    private var countText: String {
        let n = payload?.total ?? rows.count
        return n == 1 ? T("1 response") : T("%d responses").replacingOccurrences(of: "%d", with: "\(n)")
    }

    private func load() async {
        loading = true
        defer { loading = false }
        do {
            let p = try await APIClient.shared.formResponses(formId)
            payload = p
            loadError = nil
            onCount?(p.total ?? p.responses?.count ?? 0)
        } catch APIError.unauthorized {
            auth.logout()
        } catch {
            loadError = error
        }
    }
}

/// The screen's title when pushed on its own; none when embedded in the builder.
private struct ResponsesTitle: ViewModifier {
    let on: Bool
    func body(content: Content) -> some View {
        if on {
            content.navigationTitle(T("Responses")).navigationBarTitleDisplayMode(.inline)
        } else {
            content
        }
    }
}

/// One response: the sender's avatar, the task's title, who and when, the task's section or status.
private struct FormResponseRowView: View {
    let row: FormResponseRow
    let onOpen: () -> Void

    private var sender: String {
        if let n = row.submitter?.name, !n.isEmpty { return n }
        if let e = row.submitter?.email, !e.isEmpty { return e }
        return T("Unknown sender")
    }

    private var when: String {
        guard let d = ProjDate.parse(row.createdAt) else { return "" }
        let f = DateFormatter()
        f.locale = Locale(identifier: AppLanguage.shared.lang == .id ? "id_ID" : "en_GB")
        f.timeZone = TimeZone(identifier: "Asia/Jakarta")
        f.setLocalizedDateFormatFromTemplate("dMMMHHmm")
        return f.string(from: d)
    }

    private var chip: String? {
        guard let t = row.task else { return nil }
        if let s = t.section, !s.isEmpty { return s }
        return t.status.map { TaskStatusName.label($0.uppercased()) }
    }

    var body: some View {
        Button(action: onOpen) {
            HStack(spacing: 10) {
                if let p = row.submitter {
                    AvatarView(url: p.avatar, initial: String((p.name ?? p.email ?? "?").prefix(1)).uppercased(), size: 28, userId: p.id, name: p.name ?? p.email)
                } else {
                    Circle().fill(NX.muted).frame(width: 28, height: 28)
                }
                VStack(alignment: .leading, spacing: 2) {
                    Text(row.task?.title ?? T("Task deleted"))
                        .font(NXFont.text(14, .medium)).foregroundStyle(row.task == nil ? NX.mutedFg : NX.foreground).lineLimit(1)
                    Text(when.isEmpty ? sender : "\(sender) · \(when)")
                        .font(NXFont.text(12)).foregroundStyle(NX.mutedFg).lineLimit(1)
                }
                Spacer(minLength: 6)
                if let chip {
                    Text(chip).font(NXFont.text(11, .medium)).foregroundStyle(NX.mutedFg).lineLimit(1)
                        .padding(.horizontal, 7).padding(.vertical, 3)
                        .background(NX.muted, in: RoundedRectangle(cornerRadius: 6, style: .continuous))
                }
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(row.task == nil)
    }
}
