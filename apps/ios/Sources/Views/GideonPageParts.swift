import SwiftUI

// ─────────────────────────────────────────────────────────────────────────────
// Pieces of the GIDEON page that follow the dev web (Mac parity, 13 Oct 2026; components/gideon/GideonPanel.tsx):
// the step line worded from the tool (never the raw tool name), the chat list column with search and day
// groups, and the empty state with the three suggestion pills.
// ─────────────────────────────────────────────────────────────────────────────

/// A step, in words (web stepText). The server sends the tool and its human handle (a query, a name).
enum GideonStepText {
    static func text(_ s: GideonStep) -> String {
        let a = String((s.arg ?? "").prefix(60))
        let has = !a.isEmpty
        switch s.tool ?? "" {
        case "list_projects": return T("Listing projects")
        case "list_members": return T("Looking up people")
        case "list_tasks": return has ? String(format: T("Listing tasks in %@"), a) : T("Listing tasks")
        case "search_tasks": return has ? String(format: T("Searching tasks for “%@”"), a) : T("Searching tasks")
        case "search_workspace": return has ? String(format: T("Searching your workspace for “%@”"), a) : T("Searching your workspace")
        case "get_project_summary": return has ? String(format: T("Reading project %@"), a) : T("Reading a project")
        case "read_context": return has ? String(format: T("Reading %@"), a) : T("Reading a project")
        case "list_custom_fields": return T("Reading the project's fields")
        case "get_task": return has ? String(format: T("Reading task %@"), a) : T("Reading a task")
        case "search_docs": return has ? String(format: T("Searching docs for “%@”"), a) : T("Searching docs")
        case "get_doc": return has ? String(format: T("Reading doc %@"), a) : T("Reading a doc")
        case "create_task": return has ? String(format: T("Creating task %@"), a) : T("Creating a task")
        case "update_task": return has ? String(format: T("Updating task %@"), a) : T("Updating a task")
        case "add_task_comment": return has ? String(format: T("Commenting on %@"), a) : T("Commenting on a task")
        case "create_document": return has ? String(format: T("Writing doc %@"), a) : T("Writing a doc")
        case "get_calendar": return has ? String(format: T("Reading the calendar, %@"), a) : T("Reading the calendar")
        case "list_room_bookings": return has ? String(format: T("Checking room bookings, %@"), a) : T("Checking room bookings")
        case "book_room": return has ? String(format: T("Booking %@"), a) : T("Booking a room")
        case "move_room_booking": return has ? String(format: T("Moving booking %@"), a) : T("Moving a booking")
        case "cancel_room_booking": return has ? String(format: T("Cancelling booking %@"), a) : T("Cancelling a booking")
        case "vision_analyze", "vision": return T("Looking at the image")
        default:
            // A tool this build does not know: the server's own label, never the snake_case name.
            if let label = s.label, !label.isEmpty { return label }
            return T("Working on it")
        }
    }

    /// The steps worth showing (web AssistantTurn): once the answer is in, a step that failed on its
    /// arguments and was retried — the same tool succeeded later — is GIDEON's own detour, not news.
    static func shown(_ all: [GideonStep], streaming: Bool) -> [GideonStep] {
        if streaming { return all }
        return all.enumerated().filter { i, s in
            guard s.status == "error" else { return true }
            let required = (s.error ?? "").range(of: #"\bis required\b"#, options: [.regularExpression, .caseInsensitive]) != nil
            let retried = all[(i + 1)...].contains { $0.tool == s.tool && $0.status == "done" }
            return !(required || retried)
        }.map { $0.element }
    }
}

/// What GIDEON did, above its answer (web): while it works, the running step with a spinner; afterwards
/// a quiet "N steps" that unfolds into the list.
struct GideonStepsLine: View {
    let steps: [GideonStep]
    let streaming: Bool
    @State private var open = false

    var body: some View {
        let shown = GideonStepText.shown(steps, streaming: streaming)
        let running = shown.filter { $0.status == "running" }
        let failed = shown.filter { $0.status == "error" }.count
        if !shown.isEmpty {
            VStack(alignment: .leading, spacing: 4) {
                Button { open.toggle() } label: {
                    HStack(spacing: 5) {
                        if streaming && !running.isEmpty {
                            ProgressView().controlSize(.mini)
                        } else {
                            Image(systemName: open ? "chevron.down" : "checkmark").font(.system(size: 9, weight: .semibold))
                        }
                        Text(title(shown, running: running)).lineLimit(1)
                        if !streaming && failed > 0 {
                            Text("· " + (failed == 1 ? T("1 failed") : String(format: T("%d failed"), failed)))
                                .foregroundStyle(NX.danger)
                        }
                    }
                    .frame(minHeight: 24)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .disabled(streaming)
                if streaming || open {
                    VStack(alignment: .leading, spacing: 3) {
                        ForEach(shown) { s in row(s) }
                    }
                    .padding(.leading, 10)
                    .overlay(alignment: .leading) { Rectangle().fill(NX.border).frame(width: 1) }
                }
            }
            .font(NXFont.text(13))
            .foregroundStyle(NX.mutedFg)
        }
    }

    private func title(_ shown: [GideonStep], running: [GideonStep]) -> String {
        if streaming, let last = running.last { return GideonStepText.text(last) }
        return shown.count == 1 ? T("1 step") : String(format: T("%d steps"), shown.count)
    }

    private func row(_ s: GideonStep) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 6) {
            Group {
                if s.status == "running" {
                    ProgressView().controlSize(.mini)
                } else if s.status == "error" {
                    Image(systemName: "exclamationmark.triangle").foregroundStyle(NX.danger)
                } else {
                    Image(systemName: "checkmark").foregroundStyle(NX.success)
                }
            }
            .font(.system(size: 10, weight: .semibold))
            VStack(alignment: .leading, spacing: 1) {
                Text(GideonStepText.text(s)).fixedSize(horizontal: false, vertical: true)
                if s.status == "error", let e = s.error, !e.isEmpty {
                    Text(e).foregroundStyle(NX.danger.opacity(0.8)).fixedSize(horizontal: false, vertical: true)
                }
            }
        }
    }
}

/// The empty conversation (web): the mark, "What can GIDEON do for you?" (or "Ask GIDEON about <page>"),
/// what it reads, and three suggestions that are asked with one tap.
struct GideonEmptyPrompt: View {
    let assistant: String
    let page: GideonContext?
    let wide: Bool
    let onAsk: (String) -> Void

    static func suggestions(for page: GideonContext?) -> [String] {
        if let page, page.docId != nil {
            return [T("Summarize this page"), T("Find the action items in this page"), T("What questions does this page leave open?")]
        }
        if let page, page.taskId != nil {
            return [T("What's the latest on this task?"), T("Break this task into subtasks"), T("Draft a status comment for this task")]
        }
        if let page, page.projectId != nil {
            let name = page.projectName ?? T("this project")
            return [String(format: T("Summarize where %@ stands this week"), name),
                    String(format: T("What's overdue in %@, and who owns it?"), name),
                    String(format: T("Turn the next steps of %@ into tasks"), name)]
        }
        return [T("What's on my calendar this week?"), T("What's overdue for me?"), T("Summarize my week across projects"), T("What did my team decide recently? Cite the sources.")]
    }

    var body: some View {
        VStack(spacing: 0) {
            Image("GideonLogo")
                .renderingMode(.template)
                .resizable().scaledToFit()
                .frame(width: wide ? 28 : 24, height: wide ? 28 : 24)
                .foregroundStyle(NX.foreground.opacity(0.8))
                .frame(width: wide ? 56 : 48, height: wide ? 56 : 48)
                .background(NX.background, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(NX.border))
                .padding(.bottom, 12)
                .accessibilityHidden(true)
            // One line where it fits, a size down before it wraps: the iPad's 377 pt pane broke "What can
            // GIDEON do / for you?" in two (UI tour run 15, Q-IA12).
            ViewThatFits(in: .horizontal) {
                Text(headline).font(NXFont.text(wide ? 26 : 18, .bold)).lineLimit(1).fixedSize()
                Text(headline).font(NXFont.text(wide ? 21 : 17, .bold)).lineLimit(1).fixedSize()
                Text(headline).font(NXFont.text(wide ? 21 : 17, .bold))
            }
                .foregroundStyle(NX.foreground)
                .multilineTextAlignment(.center)
            Text(T("It searches and reads your projects, tasks, docs and chats with your access only, and shows what it read."))
                .font(NXFont.text(wide ? 14 : 13))
                .foregroundStyle(NX.mutedFg)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: 420)
                .padding(.top, 6)
            VStack(spacing: 6) {
                ForEach(Array(Self.suggestions(for: page).enumerated()), id: \.offset) { index, s in
                    Button { onAsk(s) } label: {
                        // One line where a size down makes it fit ("…Cite / the sources.", Q-IA12).
                        HStack(spacing: 10) {
                            Image(systemName: ["calendar", "checklist", "doc.text", "bubble.left"][index % 4])
                                .font(.system(size: 14)).foregroundStyle(NX.mutedFg).frame(width: 18)
                        ViewThatFits(in: .horizontal) {
                            Text(s).font(NXFont.text(14, .medium)).lineLimit(1).fixedSize()
                            Text(s).font(NXFont.text(12.5, .medium)).lineLimit(1).fixedSize()
                            Text(s).font(NXFont.text(14, .medium))
                        }
                            .foregroundStyle(NX.foreground)
                            .multilineTextAlignment(.leading)
                            .frame(maxWidth: .infinity, alignment: .leading)
                        }
                            .padding(.horizontal, 8).padding(.vertical, 10)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .hoverEffect(.highlight)
                }
            }
            .frame(maxWidth: 520)
            .padding(.top, 20)
        }
        .frame(maxWidth: .infinity)
        .padding(.top, wide ? 96 : 32)
        .padding(.horizontal, 8)
    }

    private var headline: String {
        if let label = page?.shortLabel, !label.isEmpty {
            return String(format: T("Ask %@ about %@"), assistant, label)
        }
        return String(format: T("What can %@ do for you?"), assistant)
    }
}

/// The conversation list at the left of the GIDEON page (web ChatHistoryList): Search chats, New chat,
/// grouped Today / Yesterday / Previous 7 days / Older; rename and delete on hover or right-click.
struct GideonChatListColumn: View {
    let activeId: String?
    /// Anything that should re-read the list: the open chat, a question finishing.
    let reloadKey: String
    let onPick: (String) -> Void
    let onNew: () -> Void

    @State private var query = ""
    @State private var rows: [GideonChatSummary]?
    @State private var failure: String?
    @State private var hovered: String?
    @State private var renaming: GideonChatSummary?
    @State private var renameText = ""
    @State private var deleting: GideonChatSummary?
    @State private var actionFailure: String?
    @State private var tick = 0

    private struct ChatGroup: Identifiable {
        let id: String
        let label: String
        var items: [GideonChatSummary]
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 8) {
                HStack(spacing: 6) {
                    Image(systemName: "magnifyingglass").font(.system(size: 13)).foregroundStyle(NX.mutedFg)
                    TextField(T("Search chats"), text: $query)
                        .font(NXFont.text(15))
                        .textFieldStyle(.plain)
                        .submitLabel(.search)
                }
                .padding(.horizontal, 10)
                .frame(height: 36)
                .background(NX.background, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(NX.border))
                Button(action: onNew) {
                    Image(systemName: "square.and.pencil")
                        .font(.system(size: 14, weight: .medium))
                        .foregroundStyle(NX.foreground)
                        .frame(width: 36, height: 36)
                        .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(NX.border))
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .hoverEffect(.highlight)
                .help(T("New chat (⌘O)"))
                .accessibilityLabel(T("New chat"))
            }
            .padding(12)

            ScrollView {
                LazyVStack(alignment: .leading, spacing: 0) {
                    listBody
                }
                .padding(.horizontal, 8)
                .padding(.bottom, 12)
            }
        }
        .task(id: "\(query)|\(reloadKey)|\(tick)") {
            try? await Task.sleep(for: .milliseconds(220))
            if Task.isCancelled { return }
            await load()
        }
        .background { Color.clear.alert(T("Rename"), isPresented: Binding(get: { renaming != nil }, set: { if !$0 { renaming = nil } })) {
            TextField(T("Chat title"), text: $renameText)
            Button(T("Save")) { Task { await rename() } }
            Button(T("Cancel"), role: .cancel) {}
        } }
        .alert(T("Delete this chat?"), isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } }), presenting: deleting) { r in
            Button(T("Delete"), role: .destructive) { Task { await delete(r) } }
            Button(T("Cancel"), role: .cancel) {}
        } message: { r in
            let name = GideonChatTitle.text(r.title).map { "“\($0)”. " } ?? ""
            Text(name + T("The conversation and its attached files are deleted for good. Tasks and docs GIDEON made stay."))
        }
        .background { Color.clear.alert(T("Couldn't do that"), isPresented: Binding(get: { actionFailure != nil }, set: { if !$0 { actionFailure = nil } })) {
            Button("OK", role: .cancel) {}
        } message: { Text(actionFailure ?? "") } }
    }

    @ViewBuilder private var listBody: some View {
        if rows == nil {
            ProgressView().frame(maxWidth: .infinity).padding(.vertical, 32)
        } else if let failure, (rows ?? []).isEmpty {
            EmptyState(icon: "bubble.left.and.text.bubble.right", title: T("Couldn't load your chats."), subtitle: failure,
                       actionTitle: T("Try again"), actionIcon: "arrow.clockwise", action: { tick += 1 }, compact: true)
                .padding(.top, 24)
        } else if (rows ?? []).isEmpty {
            EmptyState(icon: "bubble.left.and.text.bubble.right",
                       title: query.isEmpty ? T("No chats yet") : T("No chats match"),
                       subtitle: query.isEmpty ? T("Ask something to start one.")
                                               : String(format: T("No chat mentions “%@”."), query),
                       compact: true)
                .padding(.top, 24)
        } else {
            ForEach(groups()) { g in
                Text(g.label)
                    .font(NXFont.text(12, .semibold))
                    .foregroundStyle(NX.mutedFg)
                    .padding(.horizontal, 8).padding(.top, 10).padding(.bottom, 4)
                    .accessibilityAddTraits(.isHeader)
                ForEach(g.items) { r in row(r) }
            }
        }
    }

    private func row(_ r: GideonChatSummary) -> some View {
        let active = r.id == activeId
        return HStack(spacing: 2) {
            Button { onPick(r.id) } label: {
                VStack(alignment: .leading, spacing: 1) {
                    Text(GideonChatTitle.text(r.title) ?? T("Untitled chat"))
                        .font(NXFont.text(15))
                        .foregroundStyle(NX.foreground)
                        .lineLimit(1)
                    if let m = r.match, !m.isEmpty {
                        Text(m).font(NXFont.text(12)).foregroundStyle(NX.mutedFg).lineLimit(1)
                    }
                }
                .frame(maxWidth: .infinity, minHeight: 32, alignment: .leading)
                .padding(.horizontal, 8).padding(.vertical, 4)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            if hovered == r.id {
                iconButton("pencil", label: T("Rename")) { renameText = r.title ?? ""; renaming = r }
                iconButton("trash", label: T("Delete this chat")) { deleting = r }
                    .padding(.trailing, 4)
            }
        }
        .background(active ? NX.muted : (hovered == r.id ? NX.muted.opacity(0.6) : Color.clear),
                    in: RoundedRectangle(cornerRadius: 8, style: .continuous))
        .onHover { inside in hovered = inside ? r.id : (hovered == r.id ? nil : hovered) }
        .contextMenu {
            Button { renameText = r.title ?? ""; renaming = r } label: { Label(T("Rename"), systemImage: "pencil") }
            Button(role: .destructive) { deleting = r } label: { Label(T("Delete this chat"), systemImage: "trash") }
        }
    }

    private func iconButton(_ icon: String, label: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: icon).font(.system(size: 12)).foregroundStyle(NX.mutedFg)
                .frame(width: 26, height: 26).contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
    }

    private func groups() -> [ChatGroup] {
        var out: [ChatGroup] = [
            ChatGroup(id: "today", label: T("Today"), items: []),
            ChatGroup(id: "yesterday", label: T("Yesterday"), items: []),
            ChatGroup(id: "week", label: T("Previous 7 days"), items: []),
            ChatGroup(id: "older", label: T("Older"), items: []),
        ]
        let cal = Calendar.current
        let start = cal.startOfDay(for: Date())
        for r in rows ?? [] {
            let d = ProjDate.parse(r.updatedAt) ?? .distantPast
            let slot: Int
            if d >= start { slot = 0 }
            else if d >= start.addingTimeInterval(-86_400) { slot = 1 }
            else if d >= start.addingTimeInterval(-7 * 86_400) { slot = 2 }
            else { slot = 3 }
            out[slot].items.append(r)
        }
        return out.filter { !$0.items.isEmpty }
    }

    private func load() async {
        do {
            rows = try await GideonClient.chats(query: query)
            failure = nil
        } catch {
            if Task.isCancelled { return }
            // A failed list is not "No chats yet" (web QA 13 Oct 2026); the last rows stay.
            failure = (error as? LocalizedError)?.errorDescription ?? T("Couldn't load your chats.")
            if rows == nil { rows = [] }
        }
    }

    private func rename() async {
        guard let r = renaming else { return }
        let title = renameText.trimmingCharacters(in: .whitespacesAndNewlines)
        renaming = nil
        guard !title.isEmpty, title != r.title else { return }
        do { try await GideonClient.renameChat(r.id, title: title) }
        catch { actionFailure = T("Couldn't rename this chat.") }
        tick += 1
    }

    private func delete(_ r: GideonChatSummary) async {
        rows = (rows ?? []).filter { $0.id != r.id }
        do {
            try await GideonClient.deleteChat(r.id)
            if r.id == activeId { onNew() }
        } catch {
            actionFailure = T("Couldn't delete this chat.")
        }
        tick += 1
    }
}
