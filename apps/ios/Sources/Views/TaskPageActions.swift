import SwiftUI
import Observation

extension APIClient {
    func taskPageRequest(_ path: String, method: String = "GET", body: [String: Any]? = nil) async throws -> Any {
        var req = makeRequest(path, method: method)
        if let body {
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            req.httpBody = try JSONSerialization.data(withJSONObject: body)
        }
        let (data, response) = try await perform(req)
        guard let http = response as? HTTPURLResponse else { throw APIError.offline }
        guard (200..<300).contains(http.statusCode) else { throw APIError.http(http.statusCode, Self.serverMessage(data)) }
        return try JSONSerialization.jsonObject(with: data)
    }
}

@MainActor @Observable
final class TaskPageActions {
    var following = false
    var favourite = false
    var liked = false
    var likes = 0
    var busy = false
    var error: String?
    func load(_ id: String) async {
        if let r = try? await APIClient.shared.taskPageRequest("/api/tasks/\(id)/followers") as? [String: Any] { following = r["isFollowing"] as? Bool ?? false }
        if let r = try? await APIClient.shared.taskPageRequest("/api/tasks/\(id)/likes") as? [String: Any] { liked = r["liked"] as? Bool ?? false; likes = r["count"] as? Int ?? 0 }
        if let r = try? await APIClient.shared.taskPageRequest("/api/favorites") as? [[String: Any]] { favourite = r.contains { $0["type"] as? String == "task" && $0["targetId"] as? String == id } }
    }
    func toggle(_ action: String, id: String) async {
        guard !busy else { return }
        busy = true
        defer { busy = false }
        do {
            if action == "favourite" {
                _ = try await APIClient.shared.taskPageRequest("/api/favorites", method: "POST", body: ["type": "task", "targetId": id])
            } else {
                _ = try await APIClient.shared.taskPageRequest("/api/tasks/\(id)/\(action)", method: "POST")
            }
            await load(id)
        } catch { self.error = error.localizedDescription; await load(id) }
    }
}

struct TaskCopyProjectSheet: View {
    let taskId: String
    let sourceProjectId: String?
    @Environment(\.dismiss) private var dismiss
    @State private var projects: [Project] = []
    @State private var loading = true
    @State private var busy = false
    @State private var error: String?
    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    if loading { ProgressView().frame(maxWidth: .infinity) }
                    else if projects.isEmpty {
                        EmptyState(icon: "folder", title: T("No other projects to copy to"), subtitle: T("You need Can edit access in the destination project."))
                    }
                    if let error { Text(error).font(NXFont.text(13)).foregroundStyle(NX.danger) }
                    ForEach(projects) { project in
                        Button { Task { await copy(to: project.id) } } label: {
                            HStack {
                                Image(systemName: "folder")
                                Text(project.name).font(NXFont.text(14, .medium))
                                Spacer()
                                Image(systemName: "doc.on.doc")
                            }.foregroundStyle(NX.foreground).padding(14).nexusCard()
                        }.buttonStyle(.plain).disabled(busy)
                    }
                }.padding(20)
            }
            .background(NX.background)
            .navigationTitle(T("Copy to another project")).navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button(T("Cancel")) { dismiss() } } }
            .task {
                do { projects = try await APIClient.shared.projects().filter { $0.id != sourceProjectId } }
                catch { self.error = error.localizedDescription }
                loading = false
            }
        }
    }
    private func copy(to projectId: String) async {
        busy = true
        defer { busy = false }
        do {
            let destination = try await APIClient.shared.project(projectId)
            guard destination.canEditProject else { error = T("You need Can edit access in the destination project."); return }
            guard let section = StatusOptions.defaultOption(destination.taskLists ?? []) ?? destination.taskLists?.first else { error = T("Add a section to the destination project first."); return }
            _ = try await APIClient.shared.taskPageRequest("/api/tasks/\(taskId)/duplicate", method: "POST", body: ["taskListId": section.id])
            dismiss()
        } catch { self.error = error.localizedDescription }
    }
}

/// One presentation contract for task pages: a centred dialog on a regular-width device, full screen on phone.
struct TaskPagePresentation: ViewModifier {
    @Binding var task: TaskSheetRef?
    let onDismiss: () -> Void
    @Environment(\.horizontalSizeClass) private var sizeClass
    private var wide: Binding<TaskSheetRef?> { Binding(get: { sizeClass == .regular ? task : nil }, set: { task = $0 }) }
    private var phone: Binding<TaskSheetRef?> { Binding(get: { sizeClass == .regular ? nil : task }, set: { task = $0 }) }
    func body(content: Content) -> some View {
        content
            .sheet(item: wide, onDismiss: onDismiss) { ref in page(ref).frame(idealWidth: 720, idealHeight: 820) }
            .fullScreenCover(item: phone, onDismiss: onDismiss) { ref in page(ref) }
    }
    private func page(_ ref: TaskSheetRef) -> some View {
        NavigationStack {
            TaskDetailView(taskId: ref.id)
                .toolbar { ToolbarItem(placement: .cancellationAction) { Button(T("Close")) { task = nil }.keyboardShortcut(.cancelAction) } }
        }
    }
}
