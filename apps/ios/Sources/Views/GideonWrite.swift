import SwiftUI

// ─────────────────────────────────────────────────────────────────────────────
// GIDEON's writing actions in the editor (web "Ask AI", Space / ⌘J): improve, fix, shorter, longer, tone,
// summarize, explain, translate, action items, continue, and a free prompt. POST /api/gideon/write streams
// delta / reset / final {content, doc, items} / error / done. The result is shown first and applied only
// when the person picks Replace or Insert below (or creates the action items as tasks).
// ─────────────────────────────────────────────────────────────────────────────

struct GideonWriteRequest: Identifiable {
    let id = UUID()
    let action: String
    var tone: String? = nil
    var language: String? = nil
    var prompt: String? = nil
    /// The selection (the focused block) or the page, per the web's table.
    let text: String
    var context: String = ""
    /// The block the result replaces / goes under; nil = the end of the page.
    var blockId: UUID? = nil
    /// Whether "Replace" makes sense (an action on a selection).
    var onSelection: Bool = true
    var label: String

    func with(blockId: UUID?) -> GideonWriteRequest {
        var r = self
        r.blockId = blockId
        return r
    }
}

/// One action item GIDEON found.
struct GideonActionItem: Identifiable, Hashable {
    let id = UUID()
    let title: String
    let due: String?
    let owner: String?
}

enum GideonWriteEvent {
    case delta(String)
    case reset
    case final(text: String, doc: RawJSON?, items: [GideonActionItem])
}

extension GideonClient {
    /// Streams one writing action. `docId` / `taskId` only label the run log.
    static func write(_ r: GideonWriteRequest, docTitle: String, docId: String?, taskId: String?) -> AsyncThrowingStream<GideonWriteEvent, Error> {
        AsyncThrowingStream { continuation in
            let task = Task {
                do {
                    var request = URLRequest(url: Config.baseURL.appendingPathComponent("/api/gideon/write"))
                    if let session = Keychain.load() { request.setValue(session.cookieHeader, forHTTPHeaderField: "Cookie") }
                    request.setValue(APIClient.clientTag, forHTTPHeaderField: "X-Nexus-Client")
                    request.setValue(APIClient.userAgent, forHTTPHeaderField: "User-Agent")
                    request.httpMethod = "POST"
                    request.timeoutInterval = 120
                    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
                    request.setValue("text/event-stream", forHTTPHeaderField: "Accept")
                    var body: [String: Any] = ["action": r.action, "text": String(r.text.prefix(12_000)), "context": r.context, "docTitle": docTitle]
                    if let t = r.tone { body["tone"] = t }
                    if let l = r.language { body["language"] = l }
                    if let p = r.prompt { body["prompt"] = String(p.prefix(1000)) }
                    if let docId { body["docId"] = docId }
                    if let taskId { body["taskId"] = taskId }
                    request.httpBody = try JSONSerialization.data(withJSONObject: body)
                    let bytes: URLSession.AsyncBytes
                    let response: URLResponse
                    do { (bytes, response) = try await URLSession.shared.bytes(for: request) } catch { throw GideonProblem.from(error) }
                    guard let http = response as? HTTPURLResponse else { throw GideonProblem.unreachable }
                    if http.statusCode == 401 { throw APIError.unauthorized }
                    if !(200..<300).contains(http.statusCode) {
                        var text = ""
                        for try await line in bytes.lines { text += line; if text.count > 4000 { break } }
                        let obj = (try? JSONSerialization.jsonObject(with: Data(text.utf8))) as? RawJSON
                        // 429 rate_limited (60 AI edits an hour), 503 when GIDEON is not connected, a proxy's
                        // 502/504: worded in the app's language (QA 13 Oct 2026).
                        throw GideonProblem.http(status: http.statusCode, code: obj?["code"] as? String, message: obj?["error"] as? String)
                    }
                    for try await line in bytes.lines {
                        guard line.hasPrefix("data:") else { continue }
                        let payload = line.dropFirst(5).trimmingCharacters(in: .whitespaces)
                        guard let data = payload.data(using: .utf8), let o = (try? JSONSerialization.jsonObject(with: data)) as? RawJSON else { continue }
                        switch o["type"] as? String ?? "" {
                        case "delta":
                            if let c = o["content"] as? String { continuation.yield(.delta(c)) }
                        case "reset":
                            continuation.yield(.reset)
                        case "final":
                            let items = (o["items"] as? [Any] ?? []).compactMap { $0 as? RawJSON }.compactMap { i -> GideonActionItem? in
                                guard let t = i["title"] as? String, !t.isEmpty else { return nil }
                                return GideonActionItem(title: t, due: i["due"] as? String, owner: i["owner"] as? String)
                            }
                            continuation.yield(.final(text: o["content"] as? String ?? "", doc: o["doc"] as? RawJSON, items: items))
                        case "error":
                            throw GideonProblem.stream(o["content"] as? String ?? "GIDEON couldn't write that. Try again.")
                        case "done":
                            continuation.finish()
                            return
                        default:
                            continue
                        }
                    }
                    continuation.finish()
                } catch {
                    // A connection dropped mid-answer reads "can't be reached", not URLSession's sentence.
                    continuation.finish(throwing: (error is URLError) ? GideonProblem.unreachable : error)
                }
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }
}

/// The action list (web menu groups). `selectionText` empty = only the "Write" (page) group.
struct GideonWriteMenuItems: View {
    let selectionText: String
    let pageText: String
    let onPick: (GideonWriteRequest) -> Void

    private var hasSelection: Bool { !selectionText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }

    var body: some View {
        if hasSelection {
            Section(T("Edit")) {
                item("improve", T("Improve writing"))
                item("fix", T("Fix spelling & grammar"))
                item("shorter", T("Make shorter"))
                item("longer", T("Make longer"))
            }
            Menu(T("Change tone")) {
                ForEach(Self.tones, id: \.key) { t in
                    Button(t.label) {
                        onPick(GideonWriteRequest(action: "tone", tone: t.key, text: selectionText, context: pageText, label: t.label))
                    }
                }
            }
            Section(T("Understand")) {
                item("summarize", T("Summarize"))
                item("explain", T("Explain this"))
                Button(T("Translate to English")) { onPick(GideonWriteRequest(action: "translate", language: "en", text: selectionText, context: pageText, label: T("Translate to English"))) }
                Button(T("Translate to Indonesian")) { onPick(GideonWriteRequest(action: "translate", language: "id", text: selectionText, context: pageText, label: T("Translate to Indonesian"))) }
                item("action_items", T("Find action items"))
            }
        }
        Section(T("Write")) {
            Button(T("Continue writing")) { onPick(GideonWriteRequest(action: "continue", text: pageText, onSelection: false, label: T("Continue writing"))) }
            Button(T("Summarize this page")) { onPick(GideonWriteRequest(action: "summarize", text: pageText, onSelection: false, label: T("Summarize this page"))) }
            Button(T("Find action items in this page")) { onPick(GideonWriteRequest(action: "action_items", text: pageText, onSelection: false, label: T("Find action items in this page"))) }
            Button(T("Translate this page to English")) { onPick(GideonWriteRequest(action: "translate", language: "en", text: pageText, onSelection: false, label: T("Translate this page to English"))) }
            Button(T("Translate this page to Indonesian")) { onPick(GideonWriteRequest(action: "translate", language: "id", text: pageText, onSelection: false, label: T("Translate this page to Indonesian"))) }
            Button(T("Ask GIDEON to write…")) { onPick(GideonWriteRequest(action: "custom", text: hasSelection ? selectionText : "", context: String(pageText.prefix(4000)), onSelection: hasSelection, label: T("Ask GIDEON to write…"))) }
        }
    }

    private func item(_ action: String, _ label: String) -> some View {
        Button(label) { onPick(GideonWriteRequest(action: action, text: selectionText, context: pageText, label: label)) }
    }

    private struct Tone { let key: String; let label: String }
    private static var tones: [Tone] {
        [Tone(key: "professional", label: T("Professional")), Tone(key: "casual", label: T("Casual")),
         Tone(key: "friendly", label: T("Friendly")), Tone(key: "confident", label: T("Confident")),
         Tone(key: "straightforward", label: T("Straightforward"))]
    }
}

/// Runs one action and shows the result before anything changes in the page.
struct GideonWriteSheet: View {
    let request: GideonWriteRequest
    let docTitle: String
    let docId: String?
    let taskId: String?
    /// The project the page / task belongs to: action items can become its tasks.
    let projectId: String?
    let onReplace: (String, RawJSON?) -> Void
    let onInsert: (RawJSON?, String) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var prompt = ""
    @State private var started = false
    @State private var text = ""
    @State private var resultDoc: RawJSON?
    @State private var items: [GideonActionItem] = []
    @State private var running = false
    @State private var failure: String?
    @State private var runTask: Task<Void, Never>?
    @State private var creating = false

    private var needsPrompt: Bool { request.action == "custom" && !started }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    if needsPrompt { promptBox } else { resultBox }
                    if let failure { Text(failure).font(NXFont.text(13)).foregroundStyle(NX.danger) }
                }
                .padding(16)
            }
            .background(NX.background.ignoresSafeArea())
            .navigationTitle(request.label)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(T("Discard")) { runTask?.cancel(); dismiss() }.keyboardShortcut(.cancelAction) }
            }
            .safeAreaInset(edge: .bottom) { actions }
        }
        .task { if request.action != "custom" { run() } }
        .onDisappear { runTask?.cancel() }
    }

    private var promptBox: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(request.onSelection ? T("Ask AI to edit or explain the selection…") : T("Ask AI to write anything…"))
                .font(NXFont.text(13)).foregroundStyle(NX.mutedFg)
            TextField(T("Ask GIDEON to write…"), text: $prompt, axis: .vertical)
                .lineLimit(2...6)
                .padding(10)
                .background(NX.card, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).strokeBorder(NX.border))
        }
    }

    @ViewBuilder private var resultBox: some View {
        if running && text.isEmpty {
            HStack(spacing: 8) {
                ProgressView()
                Text(T("GIDEON is writing…")).font(NXFont.text(13)).foregroundStyle(NX.mutedFg)
            }
        }
        if !text.isEmpty {
            Text(text).font(NXFont.text(15)).foregroundStyle(NX.foreground).textSelection(.enabled)
                .fixedSize(horizontal: false, vertical: true)
        }
        if !items.isEmpty {
            VStack(alignment: .leading, spacing: 6) {
                ForEach(items) { i in
                    Label([i.title, i.due, i.owner].compactMap { $0 }.joined(separator: " · "), systemImage: "checklist")
                        .font(NXFont.text(13)).foregroundStyle(NX.foreground)
                }
            }
        }
    }

    @ViewBuilder private var actions: some View {
        HStack(spacing: 10) {
            if needsPrompt {
                Spacer()
                Button(T("Ask")) { started = true; run() }
                    .buttonStyle(NexusPrimaryButton())
                    .disabled(prompt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            } else if running {
                Spacer()
                Button(T("Stop")) { runTask?.cancel(); running = false }
                    .font(NXFont.text(14, .semibold))
            } else {
                Button(T("Try again")) { run() }.font(NXFont.text(14, .semibold))
                Spacer()
                if !items.isEmpty, projectId != nil {
                    Button(String(format: T("Create %d tasks"), items.count)) { Task { await createTasks() } }
                        .font(NXFont.text(14, .semibold)).disabled(creating)
                }
                if request.onSelection && !text.isEmpty {
                    Button(T("Replace selection")) { onReplace(text, resultDoc); dismiss() }
                        .font(NXFont.text(14, .semibold))
                }
                if !text.isEmpty {
                    Button(request.onSelection ? T("Insert below") : T("Insert")) { onInsert(resultDoc, text); dismiss() }
                        .buttonStyle(NexusPrimaryButton())
                }
            }
        }
        .padding(.horizontal, 16).padding(.vertical, 10)
        .background(NX.card)
    }

    private func run() {
        runTask?.cancel()
        text = ""; resultDoc = nil; items = []; failure = nil; running = true
        var r = request
        if r.action == "custom" { r.prompt = prompt.trimmingCharacters(in: .whitespacesAndNewlines) }
        let req = r
        runTask = Task {
            do {
                for try await ev in GideonClient.write(req, docTitle: docTitle, docId: docId, taskId: taskId) {
                    switch ev {
                    case .delta(let c): text += c
                    case .reset: text = ""
                    case .final(let t, let doc, let found):
                        if !t.isEmpty { text = t }
                        resultDoc = doc
                        items = found
                    }
                }
                if !Task.isCancelled && text.isEmpty && items.isEmpty { failure = T("GIDEON couldn't write that. Try again.") }
            } catch is CancellationError {
            } catch {
                failure = (error as? LocalizedError)?.errorDescription ?? T("GIDEON couldn't write that. Try again.")
            }
            running = false
        }
    }

    /// The action items as tasks in the project's default status (web "Create {n} tasks").
    private func createTasks() async {
        guard let projectId, !creating else { return }
        creating = true
        defer { creating = false }
        let options = (try? await APIClient.shared.statusOptions(projectId: projectId)) ?? []
        let lanes = options.map { ProjectDetail.Lane(id: $0.id, name: $0.name, tasks: nil, taskStatus: $0.taskStatus, color: $0.color, position: $0.position) }
        guard let lane = StatusOptions.defaultOption(lanes) ?? lanes.first else {
            failure = T("This project has no sections yet. Add one from Project settings.")
            return
        }
        var made = 0
        for i in items {
            let due = i.due.flatMap { $0.count >= 10 ? String($0.prefix(10)) : nil }
            if (try? await APIClient.shared.createTask(projectId: projectId, taskListId: lane.id, title: i.title, dueDate: due)) != nil { made += 1 }
        }
        if made == items.count { dismiss() } else { failure = String(format: T("%d of the tasks couldn't be created."), items.count - made) }
    }
}
