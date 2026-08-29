import SwiftUI
import CoreLocation   // "kirim lokasi" reads CLLocationCoordinate2D members off LocationManager

/// Port of messages.tsx: conversation list grouped Direct/Groups/Projects → tap → chat thread.
struct MessagesView: View {
    @Environment(AuthStore.self) private var auth
    @State private var convos: [Conversation] = []
    @State private var loading = true
    @State private var error: String?

    private var meId: String? { auth.session?.userId }
    private var groups: [(label: String, items: [Conversation])] {
        [(T("Direct"), convos.filter { $0.type == "DM" }),
         (T("Groups"), convos.filter { $0.type == "GROUP" }),
         (T("Projects"), convos.filter { $0.type == "PROJECT" })].filter { !$0.1.isEmpty }
    }

    var body: some View {
        ZStack {
            NX.background.ignoresSafeArea()
            content
        }
        .navigationTitle(T("Messages"))
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
    }

    @ViewBuilder private var content: some View {
        if loading {
            SkeletonList()
        } else if let error {
            VStack(spacing: 12) {
                Image(systemName: "bubble.left.and.bubble.right").font(.system(size: 40)).foregroundStyle(NX.mutedFg)
                Text(error).font(NXFont.text(14)).foregroundStyle(NX.mutedFg).multilineTextAlignment(.center)
                Button(T("Try again")) { Task { await load() } }.buttonStyle(NexusPrimaryButton(fullWidth: false))
            }.frame(maxWidth: .infinity, maxHeight: .infinity).padding(32)
        } else if convos.isEmpty {
            VStack(spacing: 8) {
                Image(systemName: "bubble.left.and.bubble.right").font(.system(size: 42)).foregroundStyle(NX.mutedFg)
                Text(T("No chats yet")).font(NXFont.display(16, .bold)).foregroundStyle(NX.foreground)
            }.frame(maxWidth: .infinity, maxHeight: .infinity)
        } else {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    ForEach(groups, id: \.label) { group in
                        VStack(alignment: .leading, spacing: 8) {
                            SectionLabel(group.label).padding(.leading, 4)
                            VStack(spacing: 0) {
                                ForEach(Array(group.items.enumerated()), id: \.element.id) { idx, c in
                                    if idx > 0 { Divider().overlay(NX.border) }
                                    NavigationLink {
                                        ChatThreadView(conversationId: c.id, title: c.title(meId: meId),
                                                       members: c.members ?? [], projectId: c.projectId)
                                    } label: { ConvoRow(convo: c, meId: meId) }
                                    .buttonStyle(.plain)
                                }
                            }
                            .background {
                                RoundedRectangle(cornerRadius: 18, style: .continuous).fill(NX.card)
                                    .nexusShadowSoft()
                                    .overlay(RoundedRectangle(cornerRadius: 18).strokeBorder(NX.border))
                            }
                        }
                    }
                }
                .padding(16)
            }
            .refreshable { await load() }
        }
    }

    private func load() async {
        error = nil
        do { convos = try await APIClient.shared.conversations() }
        catch APIError.unauthorized { auth.logout() }
        catch { self.error = (error as? LocalizedError)?.errorDescription ?? T("Couldn't load chats.") }
        loading = false
    }
}

struct ConvoRow: View {
    let convo: Conversation
    let meId: String?
    var body: some View {
        HStack(spacing: 12) {
            if convo.isGroupish {
                ZStack {
                    Circle().fill(NX.violet.opacity(0.12)).frame(width: 40, height: 40)
                    Image(systemName: "person.2.fill").font(.system(size: 15)).foregroundStyle(NX.violetText)
                }
            } else {
                AvatarView(url: convo.avatarURL(meId: meId), initial: convo.initial(meId: meId), size: 40)
            }
            VStack(alignment: .leading, spacing: 2) {
                Text(convo.title(meId: meId)).font(NXFont.text(15, .semibold)).foregroundStyle(NX.foreground).lineLimit(1)
                Text(convo.lastMessage?.content ?? T("No message yet")).font(NXFont.text(13)).foregroundStyle(NX.mutedFg).lineLimit(1)
            }
            Spacer(minLength: 4)
            if let u = convo.unreadCount, u > 0 {
                Text("\(u)").font(NXFont.text(10, .bold)).foregroundStyle(.white)
                    .padding(.horizontal, 6).padding(.vertical, 3).background(NX.danger, in: Capsule())
            }
        }
        .padding(14)
    }
}

// MARK: - Rich chat payloads
//
// The backend's message model is TEXT ONLY (no attachment/type column — /api/upload/chat and
// /api/polls don't exist), so anything richer has to survive as a plain string. These payloads are
// encoded so the web client still shows something readable, while the native app recognises the
// pattern and upgrades it to a tappable card.

enum ChatPayload {
    case location(lat: Double, lng: Double, url: URL)
    case task(id: String, title: String)
    case plain

    static func parse(_ content: String) -> ChatPayload {
        // "📍 Lokasi saya: https://www.google.com/maps?q=<lat>,<lng>"
        if let hit = content.range(of: "google.com/maps?q=") {
            let coords = content[hit.upperBound...].prefix { !$0.isWhitespace }
            let parts = coords.split(separator: ",")
            if parts.count == 2, let lat = Double(parts[0]), let lng = Double(parts[1]),
               let url = URL(string: "https://www.google.com/maps?q=\(lat),\(lng)") {
                return .location(lat: lat, lng: lng, url: url)
            }
        }
        // "📋 Task: <judul> [task:<id>]"
        if let open = content.range(of: "[task:"),
           let close = content.range(of: "]", options: [], range: open.upperBound..<content.endIndex) {
            let id = String(content[open.upperBound..<close.lowerBound])
            let title = content[..<open.lowerBound]
                .replacingOccurrences(of: "📋 Task:", with: "")
                .trimmingCharacters(in: .whitespacesAndNewlines)
            if !id.isEmpty { return .task(id: id, title: title.isEmpty ? T("Open task") : title) }
        }
        return .plain
    }
}

extension Conversation.Member {
    var uid: String { userId ?? user?.id ?? "" }
    var displayName: String { user?.name ?? "?" }
    var initial: String { String((user?.name ?? "?").first ?? "?").uppercased() }
}

/// Chat thread — message bubbles (mine onyx-right / others muted-left + name) + input.
struct ChatThreadView: View {
    let conversationId: String
    let title: String
    /// Conversation roster → drives the @mention picker (empty = no mention button).
    var members: [Conversation.Member] = []
    /// Set for PROJECT rooms — scopes the "link ke task" picker to that project's tasks.
    var projectId: String? = nil
    @Environment(AuthStore.self) private var auth
    @State private var messages: [ChatMessage] = []
    @State private var input = ""
    @State private var loading = true
    @State private var sending = false
    @State private var loc = LocationManager()
    @State private var showMentions = false
    @State private var pendingMentions: [String: String] = [:]
    @State private var showTaskPicker = false
    @State private var notice: String?

    private var meId: String? { auth.session?.userId }
    private var mentionable: [Conversation.Member] {
        members.filter { !$0.uid.isEmpty && $0.uid != meId }
    }

    var body: some View {
        VStack(spacing: 0) {
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(spacing: 6) {
                        if loading { ProgressView().tint(NX.violetText).padding(.top, 40) }
                        else if messages.isEmpty {
                            Text(T("No messages yet. Say hi 👋")).font(NXFont.text(14)).foregroundStyle(NX.mutedFg).padding(.top, 40)
                        }
                        ForEach(messages) { m in bubble(m) }
                        Color.clear.frame(height: 1).id("bottom")
                    }
                    .padding(16)
                }
                .onChange(of: messages.count) { _, _ in withAnimation { proxy.scrollTo("bottom", anchor: .bottom) } }
                .task { await load(); withAnimation { proxy.scrollTo("bottom", anchor: .bottom) } }
            }

            composer
        }
        .background(NX.background.ignoresSafeArea())
        .navigationTitle(title)
        .navigationBarTitleDisplayMode(.inline)
        .onAppear { loc.requestPermissionIfNeeded() }
        .sheet(isPresented: $showTaskPicker) {
            TaskLinkPicker(projectId: projectId, meId: meId) { t in Task { await sendTaskLink(t) } }
        }
    }

    // MARK: composer

    private var composer: some View {
        VStack(spacing: 0) {
            if let notice {
                Text(notice).font(NXFont.text(11, .semibold)).foregroundStyle(NX.danger)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 14).padding(.top, 8)
            }
            if showMentions && !mentionable.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach(mentionable, id: \.uid) { m in
                            Button { mention(m) } label: {
                                HStack(spacing: 6) {
                                    AvatarView(url: m.user?.avatar, initial: m.initial, size: 22)
                                    Text(m.displayName).font(NXFont.text(12, .semibold))
                                        .foregroundStyle(NX.foreground).lineLimit(1)
                                }
                                .padding(.horizontal, 8).padding(.vertical, 6)
                                .background(NX.muted, in: Capsule())
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    .padding(.horizontal, 12)
                }
                .padding(.top, 8)
            }
            HStack(alignment: .bottom, spacing: 8) {
                Menu {
                    Button { Task { await sendLocation() } } label: { Label(T("Send location"), systemImage: "mappin.and.ellipse") }
                    Button { showTaskPicker = true } label: { Label(T("Link to a task"), systemImage: "checklist") }
                } label: {
                    Image(systemName: "plus").font(.system(size: 17, weight: .bold)).foregroundStyle(NX.violetText)
                        .frame(width: 36, height: 36).background(NX.muted, in: Circle())
                }
                .disabled(sending)

                if !mentionable.isEmpty {
                    Button { showMentions.toggle() } label: {
                        Text("@").font(NXFont.display(17, .bold))
                            .foregroundStyle(showMentions ? Color.white : NX.violetText)
                            .frame(width: 36, height: 36)
                            .background(showMentions ? NX.violet : NX.muted, in: Circle())
                    }
                    .buttonStyle(.plain)
                }

                TextField(T("Write a message…"), text: $input, axis: .vertical)
                    .font(NXFont.text(15)).lineLimit(1...4)
                    .padding(.horizontal, 14).padding(.vertical, 10)
                    .background(NX.muted, in: RoundedRectangle(cornerRadius: 18, style: .continuous))

                Button { Task { await send() } } label: {
                    Image(systemName: sending ? "ellipsis" : "paperplane.fill").font(.system(size: 16, weight: .bold)).foregroundStyle(.white)
                        .frame(width: 40, height: 40).background(NX.onyx, in: Circle())
                }.disabled(input.trimmingCharacters(in: .whitespaces).isEmpty || sending)
            }
            .padding(12)
        }
        .background(NX.card)
        .overlay(Rectangle().fill(NX.border).frame(height: 1), alignment: .top)
    }

    // MARK: bubbles

    @ViewBuilder private func bubble(_ m: ChatMessage) -> some View {
        let mine = m.userId != nil && m.userId == meId
        HStack(alignment: .bottom, spacing: 8) {
            if mine {
                Spacer(minLength: 50)
            } else {
                AvatarView(url: m.user?.avatar, initial: String((m.user?.name ?? "?").first ?? "?").uppercased(), size: 28)
            }
            VStack(alignment: .leading, spacing: 4) {
                if !mine, let n = m.user?.name { Text(n).font(NXFont.text(11, .semibold)).foregroundStyle(NX.mutedFg) }
                switch ChatPayload.parse(m.content) {
                case .location(let lat, let lng, let url):
                    locationCard(lat: lat, lng: lng, url: url, mine: mine)
                case .task(let id, let title):
                    taskCard(id: id, title: title, mine: mine)
                case .plain:
                    styledText(m.content).font(NXFont.text(15))
                        .foregroundStyle(mine ? Color.white : NX.foreground)
                }
            }
            .padding(.horizontal, 13).padding(.vertical, 9)
            .background(mine ? NX.onyx : NX.muted, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
            if !mine { Spacer(minLength: 50) }
        }
    }

    /// Highlights @mention tokens. Concatenating `Text` (not a wrapping view) keeps it one
    /// selectable, wrapping paragraph — which is why this uses the deprecated `foregroundColor`
    /// (`foregroundStyle` on Text returns `some View` and can't be concatenated).
    private func styledText(_ s: String) -> Text {
        var out = Text("")
        var first = true
        for w in s.split(separator: " ", omittingEmptySubsequences: false) {
            let sep = first ? "" : " "
            first = false
            if w.count > 1, w.hasPrefix("@") {
                out = out + Text(sep) + Text(String(w)).foregroundColor(NX.violetText).fontWeight(.bold)
            } else {
                out = out + Text(sep + String(w))
            }
        }
        return out
    }

    private func locationCard(lat: Double, lng: Double, url: URL, mine: Bool) -> some View {
        Link(destination: url) {
            HStack(spacing: 10) {
                Image(systemName: "mappin.circle.fill").font(.system(size: 22))
                    .foregroundStyle(mine ? Color.white : NX.violetText)
                VStack(alignment: .leading, spacing: 2) {
                    Text(T("Shared location")).font(NXFont.text(13, .bold))
                        .foregroundStyle(mine ? Color.white : NX.foreground)
                    Text(String(format: "%.5f, %.5f", lat, lng)).font(NXFont.text(11))
                        .foregroundStyle(mine ? Color.white.opacity(0.75) : NX.mutedFg)
                }
                Image(systemName: "arrow.up.right").font(.system(size: 11, weight: .bold))
                    .foregroundStyle(mine ? Color.white.opacity(0.7) : NX.mutedFg)
            }
        }
    }

    private func taskCard(id: String, title: String, mine: Bool) -> some View {
        NavigationLink { TaskDetailView(taskId: id) } label: {
            HStack(spacing: 10) {
                Image(systemName: "checklist").font(.system(size: 18))
                    .foregroundStyle(mine ? Color.white : NX.violetText)
                VStack(alignment: .leading, spacing: 2) {
                    Text(T("TASK")).font(NXFont.text(10, .bold)).tracking(0.5)
                        .foregroundStyle(mine ? Color.white.opacity(0.7) : NX.mutedFg)
                    Text(title).font(NXFont.text(13, .bold)).lineLimit(2).multilineTextAlignment(.leading)
                        .foregroundStyle(mine ? Color.white : NX.foreground)
                }
                Image(systemName: "chevron.right").font(.system(size: 11, weight: .bold))
                    .foregroundStyle(mine ? Color.white.opacity(0.7) : NX.mutedFg)
            }
        }
        .buttonStyle(.plain)
    }

    // MARK: actions

    /// Inserts "@Nama" (spaces stripped so it stays one highlightable token).
    private func mention(_ m: Conversation.Member) {
        let tag = "@" + m.displayName.replacingOccurrences(of: " ", with: "")
        if !input.isEmpty && !input.hasSuffix(" ") { input += " " }
        input += tag + " "
        pendingMentions[m.uid] = tag
        showMentions = false
    }

    private func load() async {
        do { messages = try await APIClient.shared.conversationMessages(conversationId) }
        catch APIError.unauthorized { auth.logout() }
        catch {}
        loading = false
    }
    private func send() async {
        let v = input.trimmingCharacters(in: .whitespaces)
        guard !v.isEmpty else { return }
        let mentionedUserIds = pendingMentions.compactMap { v.contains($0.value) ? $0.key : nil }
        sending = true; input = ""; pendingMentions = [:]; notice = nil
        try? await APIClient.shared.sendMessage(conversationId, content: v, mentionedUserIds: mentionedUserIds)
        await load()
        sending = false
    }
    private func sendLocation() async {
        sending = true; notice = nil
        defer { sending = false }
        do {
            let fix = try await loc.currentFix()
            let text = "📍 Lokasi saya: https://www.google.com/maps?q=\(fix.latitude),\(fix.longitude)"
            try await APIClient.shared.sendMessage(conversationId, content: text)
            await load()
        } catch {
            notice = (error as? LocalizedError)?.errorDescription ?? T("Couldn't send your location.")
        }
    }
    private func sendTaskLink(_ t: ChatTaskRef) async {
        sending = true; notice = nil
        defer { sending = false }
        try? await APIClient.shared.sendMessage(conversationId, content: "📋 Task: \(t.title) [task:\(t.id)]")
        await load()
    }
}

// MARK: - Task picker (for "link ke task")

struct ChatTaskRef: Identifiable, Sendable {
    let id: String
    let title: String
}

/// Picks a task to drop into the chat. Scoped to the project for a PROJECT room; falls back to the
/// caller's own assigned tasks in a DM/group.
struct TaskLinkPicker: View {
    let projectId: String?
    let meId: String?
    let onPick: (ChatTaskRef) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var items: [ChatTaskRef] = []
    @State private var loading = true
    @State private var query = ""

    private var filtered: [ChatTaskRef] {
        let q = query.trimmingCharacters(in: .whitespaces)
        return q.isEmpty ? items : items.filter { $0.title.localizedCaseInsensitiveContains(q) }
    }

    var body: some View {
        NavigationStack {
            ZStack {
                NX.background.ignoresSafeArea()
                if loading {
                    ProgressView().tint(NX.violetText)
                } else if items.isEmpty {
                    TabEmpty(icon: "checklist", text: T("No tasks available to link from here."))
                } else {
                    ScrollView {
                        LazyVStack(spacing: 8) {
                            ForEach(filtered) { t in
                                Button { onPick(t); dismiss() } label: {
                                    HStack(spacing: 10) {
                                        Image(systemName: "checklist").font(.system(size: 14)).foregroundStyle(NX.violetText)
                                            .frame(width: 32, height: 32)
                                            .background(NX.violet.opacity(0.12), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                                        Text(t.title).font(NXFont.text(14, .semibold)).foregroundStyle(NX.foreground)
                                            .lineLimit(2).multilineTextAlignment(.leading)
                                        Spacer(minLength: 0)
                                    }
                                    .padding(12)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                                    .background(NX.card, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                                    .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(NX.border))
                                }
                                .buttonStyle(.plain)
                            }
                        }
                        .padding(16)
                    }
                }
            }
            .searchable(text: $query, prompt: T("Search a task"))
            .navigationTitle(T("Link to a task"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .topBarLeading) { Button(T("Cancel")) { dismiss() } } }
            .task { await load() }
        }
    }

    private func load() async {
        if let projectId, let tasks = try? await APIClient.shared.projectTasks(projectId) {
            items = tasks.map { ChatTaskRef(id: $0.id, title: $0.title) }
        } else if let meId, let mine = try? await APIClient.shared.myTasks(assigneeId: meId) {
            items = mine.map { ChatTaskRef(id: $0.id, title: $0.title ?? "Untitled") }
        }
        loading = false
    }
}
