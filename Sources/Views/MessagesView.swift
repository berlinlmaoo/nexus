import SwiftUI
import PhotosUI
import UIKit
import CoreLocation   // "kirim lokasi" reads CLLocationCoordinate2D members off LocationManager

/// Port of messages.tsx: conversation list grouped Direct/Groups/Projects → tap → chat thread.
struct MessagesView: View {
    @Environment(AuthStore.self) private var auth
    @State private var convos: [Conversation] = []
    @State private var loading = true
    @State private var error: String?
    @State private var showNewChat = false
    /// projectId -> project icon. A PROJECT room has no picture of its own on the server, so it
    /// borrows the project's; without this every project chat falls back to the same grey glyph.
    @State private var projectIcons: [String: String] = [:]
    @Environment(\.horizontalSizeClass) private var hSize
    /// True when nothing outside is providing a NavigationStack — the sidebar shows this screen
    /// directly, while MoreView pushes it into a stack that already exists. Without the
    /// distinction, a narrow iPad window (regular root, compact detail) leaves the list with no
    /// navigation bar and rows that push into nothing.
    var providesOwnStack: Bool = false
    /// Which conversation the right-hand pane is showing. Only meaningful in the split layout —
    /// on a phone the thread is pushed, and the stack itself remembers where you are.
    @State private var selected: Conversation?

    /// A chat list and the chat itself are the pair every messaging app puts side by side once
    /// there is room, because the whole job is moving between conversations. Pushing a thread and
    /// popping back on a 13-inch screen is the phone's compromise, not a design.
    private var isSplit: Bool { hSize == .regular }

    private var meId: String? { auth.session?.userId }
    private var groups: [(label: String, items: [Conversation])] {
        [(T("Direct"), convos.filter { $0.type == "DM" }),
         (T("Groups"), convos.filter { $0.type == "GROUP" }),
         (T("Projects"), convos.filter { $0.type == "PROJECT" })].filter { !$0.1.isEmpty }
    }

    var body: some View {
        Group {
            if isSplit {
                splitLayout
            } else if providesOwnStack {
                NavigationStack { listPane }
            } else {
                listPane
            }
        }
        .sheet(isPresented: $showNewChat) {
            NewConversationSheet { _ in Task { await load() } }
        }
        .task {
            await load()
            // An empty right-hand pane on first open is a screen asking to be clicked before it
            // shows anything. The phone has no equivalent: there, nothing is open yet by design.
            if isSplit, selected == nil { selected = convos.first }
        }
        // Same reason as the thread, at a calmer pace: this only moves badges and previews.
        .task {
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(15))
                if Task.isCancelled { return }
                if let fresh = try? await APIClient.shared.conversations() { convos = fresh }
            }
        }
    }

    /// The list on its own — the whole screen on a phone, the left column on an iPad.
    private var listPane: some View {
        ZStack {
            NX.background.ignoresSafeArea()
            content
        }
        .navigationTitle(T("Messages"))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button { showNewChat = true } label: {
                    Image(systemName: "square.and.pencil").font(.system(size: 16, weight: .semibold))
                        .foregroundStyle(NX.violetText)
                }
                // The split layout draws its own compose button; these two never coexist, so the
                // shortcut is never registered twice.
                .keyboardShortcut("n", modifiers: .command)
            }
        }
    }

    /// Two panes. Only the right one gets a NavigationStack.
    ///
    /// Giving each pane its own stack was the obvious move and it did not work: the two bars merged
    /// into one strip across the whole window, with the list's compose button and the thread's edit
    /// button sitting side by side above both columns — one bar claiming to belong to two screens.
    ///
    /// So the left column stops asking for a navigation bar and draws its own header instead. It
    /// never needed one: nothing is pushed from the list in this layout, picking a row only moves
    /// the selection. The right column keeps a real stack, because the thread does push — into a
    /// task, into project settings.
    private var splitLayout: some View {
        HStack(spacing: 0) {
            VStack(spacing: 0) {
                splitListHeader
                Divider().overlay(NX.border)
                ZStack {
                    NX.background.ignoresSafeArea()
                    content
                }
            }
            .frame(width: 340)

            Divider().overlay(NX.border)

            NavigationStack { threadPane }
                .frame(maxWidth: .infinity)
        }
    }

    /// Stands in for the list column's navigation bar: same title, same compose button, drawn by us.
    private var splitListHeader: some View {
        HStack {
            Text(T("Messages"))
                .font(NXFont.display(17, .bold))
                .foregroundStyle(NX.foreground)
            Spacer()
            Button { showNewChat = true } label: {
                Image(systemName: "square.and.pencil")
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(NX.violetText)
            }
            .buttonStyle(.plain)
            .hoverEffect(.lift)
            .keyboardShortcut("n", modifiers: .command)
        }
        .padding(.horizontal, 16)
        .frame(height: 52)
        .background(NX.background)
    }

    @ViewBuilder private var threadPane: some View {
        if let c = selected {
            ChatThreadView(conversationId: c.id, title: c.title(meId: meId),
                           members: c.members ?? [], projectId: c.projectId, type: c.type,
                           usesInlineHeader: true)
                // Keyed by id: without it, switching conversations reuses the same view and the
                // previous chat's messages sit under the new one's title until the fetch lands.
                .id(c.id)
        } else {
            ZStack {
                NX.background.ignoresSafeArea()
                VStack(spacing: 10) {
                    Image(systemName: "bubble.left.and.bubble.right")
                        .font(.system(size: 44)).foregroundStyle(NX.mutedFg)
                    Text(T("Pick a conversation")).font(NXFont.text(14)).foregroundStyle(NX.mutedFg)
                }
            }
        }
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
                Button(T("Start a chat")) { showNewChat = true }
                    .buttonStyle(NexusPrimaryButton(fullWidth: false))
                    .padding(.top, 4)
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
                                    if isSplit {
                                        Button { selected = c } label: {
                                            ConvoRow(convo: c, meId: meId,
                                                     projectIcon: c.projectId.flatMap { projectIcons[$0] })
                                        }
                                        .buttonStyle(.plain)
                                        .hoverEffect(.highlight)
                                        .background(selected?.id == c.id ? NX.violet.opacity(0.10) : .clear)
                                    } else {
                                        NavigationLink {
                                            ChatThreadView(conversationId: c.id, title: c.title(meId: meId),
                                                           members: c.members ?? [], projectId: c.projectId,
                                                           type: c.type)
                                        } label: {
                                            ConvoRow(convo: c, meId: meId,
                                                     projectIcon: c.projectId.flatMap { projectIcons[$0] })
                                        }
                                        .buttonStyle(.plain)
                                        .hoverEffect(.highlight)
                                    }
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
        // Fired alongside the conversations so the rows don't visibly pop from glyph to photo.
        Task {
            if let projects = try? await APIClient.shared.projects() {
                projectIcons = Dictionary(uniqueKeysWithValues: projects.compactMap { p in
                    guard let icon = p.icon, !icon.isEmpty else { return nil }
                    return (p.id, icon)
                })
            }
        }
        do { convos = try await APIClient.shared.conversations() }
        catch APIError.unauthorized { auth.logout() }
        catch { self.error = (error as? LocalizedError)?.errorDescription ?? T("Couldn't load chats.") }
        loading = false
    }
}

struct ConvoRow: View {
    let convo: Conversation
    let meId: String?
    var projectIcon: String?

    /// A project's `icon` is a path most of the time, but it can also hold an emoji. Only treat it
    /// as a picture when it actually looks like one, otherwise CachedImage silently shows nothing.
    private var projectIconURL: URL? {
        guard let icon = projectIcon, icon.hasPrefix("/") || icon.hasPrefix("http") else { return nil }
        return URL(string: icon.hasPrefix("http") ? icon : Config.baseURL.absoluteString + icon)
    }

    private var groupGlyph: some View {
        ZStack {
            Circle().fill(NX.violet.opacity(0.12)).frame(width: 40, height: 40)
            Image(systemName: "person.2.fill").font(.system(size: 15)).foregroundStyle(NX.violetText)
        }
    }

    var body: some View {
        HStack(spacing: 12) {
            if convo.isGroupish {
                if let url = projectIconURL {
                    CachedImage(url: url) { $0.resizable().scaledToFill() } placeholder: { groupGlyph }
                        .frame(width: 40, height: 40)
                        .clipShape(Circle())
                        .overlay(Circle().strokeBorder(NX.border, lineWidth: 0.5))
                } else {
                    groupGlyph
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
    /// DM | GROUP | PROJECT. Only a GROUP can be renamed; the server rejects the other two.
    var type: String? = nil
    /// True when the thread is one column of a two-pane layout.
    ///
    /// A navigation bar belongs to a whole screen, not to a column of one: in the split layout it
    /// stretched across both panes, so the conversation's name sat centred above the chat list next
    /// to it. Drawing the header inside the column puts the title over the thread it names. The
    /// NavigationStack stays — the thread still pushes into a task and into project settings — only
    /// its bar is hidden.
    var usesInlineHeader: Bool = false
    @Environment(AuthStore.self) private var auth
    @State private var messages: [ChatMessage] = []
    @State private var input = ""
    @State private var loading = true
    @State private var sending = false
    @State private var loc = LocationManager()
    @State private var pendingMentions: [String: String] = [:]
    @State private var showTaskPicker = false
    @State private var showAddPeople = false
    @State private var showRename = false
    @State private var pickedPhoto: PhotosPickerItem?
    @State private var showPhotoPicker = false
    @State private var showCamera = false
    @State private var pendingAttachment: ChatUpload?
    @State private var replyingTo: ChatMessage?
    @State private var uploadingPhoto = false
    @State private var renameDraft = ""
    @State private var shownTitle: String? = nil
    @State private var notice: String?

    private var meId: String? { auth.session?.userId }
    private var mentionable: [Conversation.Member] {
        members.filter { !$0.uid.isEmpty && $0.uid != meId }
    }

    /// Stands in for the navigation bar in the split layout: the same title and the same two
    /// actions, drawn inside the column so they sit over the conversation they belong to.
    private var inlineHeader: some View {
        HStack(spacing: 12) {
            Text(shownTitle ?? title)
                .font(NXFont.display(17, .bold))
                .foregroundStyle(NX.foreground)
                .lineLimit(1)
            Spacer(minLength: 8)
            // Same conditions as the toolbar above: a DM can neither grow nor be renamed.
            if projectId != nil || type == "GROUP" {
                Button { showAddPeople = true } label: {
                    Image(systemName: "person.badge.plus")
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundStyle(NX.violetText)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(T("Add people"))
            }
            if type == "GROUP" {
                Button {
                    renameDraft = shownTitle ?? title
                    showRename = true
                } label: {
                    Image(systemName: "pencil")
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundStyle(NX.violetText)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(T("Rename group"))
            }
        }
        .padding(.horizontal, 16)
        .frame(height: 52)
        .background(NX.background)
    }

    /// The mention token currently being typed, or nil when we aren't in one.
    ///
    /// SwiftUI's TextField doesn't expose the caret, so we read the tail of the draft instead: an
    /// "@" that still opens the last word and hasn't been closed by a space. That is enough for the
    /// way people actually type a mention - straight through, at the end of what they're writing.
    /// The "@" must also start a word, otherwise every email address would open the picker.
    private var mentionQuery: String? {
        guard let at = input.lastIndex(of: "@") else { return nil }
        if at > input.startIndex {
            let before = input[input.index(before: at)]
            guard before == " " || before == "\n" else { return nil }
        }
        let tail = input[input.index(after: at)...]
        guard !tail.contains(" "), !tail.contains("\n") else { return nil }
        return String(tail)
    }

    /// Roster filtered by what has been typed after the "@". Empty query = show everyone.
    private var mentionMatches: [Conversation.Member] {
        guard let q = mentionQuery else { return [] }
        guard !q.isEmpty else { return mentionable }
        return mentionable.filter { $0.displayName.localizedCaseInsensitiveContains(q) }
    }

    var body: some View {
        VStack(spacing: 0) {
            if usesInlineHeader {
                inlineHeader
                Divider().overlay(NX.border)
            }
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
                // The iOS client has no socket, so an open thread refreshes itself. .task cancels
                // this loop the moment the screen goes away - no timer to invalidate, and it can
                // never outlive the view. The existing onChange above handles the scroll.
                .task {
                    while !Task.isCancelled {
                        try? await Task.sleep(for: .seconds(5))
                        if Task.isCancelled { return }
                        await load()
                    }
                }
            }

            composer
        }
        .background(NX.background.ignoresSafeArea())
        .navigationTitle(usesInlineHeader ? "" : (shownTitle ?? title))
        .toolbar(usesInlineHeader ? .hidden : .visible, for: .navigationBar)
        .toolbar {
            // Project rooms add through the project; a plain GROUP owns its own member list and
            // has had an endpoint of its own since /api/conversations/[id]/members. A DM stays
            // closed: two people is what a DM means.
            if projectId != nil || type == "GROUP" {
                ToolbarItem(placement: .topBarTrailing) {
                    Button { showAddPeople = true } label: {
                        Image(systemName: "person.badge.plus").font(.system(size: 15, weight: .semibold))
                            .foregroundStyle(NX.violetText)
                    }
                }
            }
            // Only a GROUP carries a name of its own: a DM is titled after the other person and a
            // PROJECT room follows the project, and the server rejects renaming either.
            if type == "GROUP" {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        renameDraft = shownTitle ?? title
                        showRename = true
                    } label: {
                        Image(systemName: "pencil").font(.system(size: 15, weight: .semibold))
                            .foregroundStyle(NX.violetText)
                    }
                }
            }
        }
        .alert(T("Rename group"), isPresented: $showRename) {
            TextField(T("Group name"), text: $renameDraft)
            Button(T("Cancel"), role: .cancel) { }
            Button(T("Save")) { Task { await rename() } }
        }
        .onChange(of: pickedPhoto) { _, item in
            guard let item else { return }
            Task { await uploadPhoto(item) }
        }
        .photosPicker(isPresented: $showPhotoPicker, selection: $pickedPhoto,
                      matching: .images, photoLibrary: .shared())
        .fullScreenCover(isPresented: $showCamera) {
            CameraPicker(cameraDevice: .rear) { data in Task { await uploadJPEG(data) } }
                .ignoresSafeArea()
        }
        .sheet(isPresented: $showAddPeople) {
            if let pid = projectId {
                AddProjectPeopleSheet(
                    target: .project(pid),
                    existingUserIds: Set(members.compactMap { $0.userId ?? $0.user?.id }),
                    onAdded: { notice = T("Added. They'll show up here once they open the app.") }
                )
            } else if type == "GROUP" {
                AddProjectPeopleSheet(
                    target: .group(conversationId: conversationId),
                    existingUserIds: Set(members.compactMap { $0.userId ?? $0.user?.id }),
                    // A group owns its member list outright, so the change is immediate — no
                    // waiting for the other person to open the app, unlike a project room.
                    onAdded: { notice = T("Added to the group.") }
                )
            }
        }
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
            if !mentionMatches.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach(mentionMatches, id: \.uid) { m in
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
            if let target = replyingTo {
                HStack(spacing: 8) {
                    RoundedRectangle(cornerRadius: 1.5, style: .continuous).fill(NX.violet).frame(width: 2.5, height: 30)
                    VStack(alignment: .leading, spacing: 1) {
                        Text(T("Replying to") + " " + (target.user?.name ?? T("Message")))
                            .font(NXFont.text(11, .bold)).foregroundStyle(NX.violetText)
                        Text(Self.quotePreview(.init(id: target.id, content: target.content,
                                                     attachmentType: target.attachmentType, user: target.user)))
                            .font(NXFont.text(11)).foregroundStyle(NX.mutedFg).lineLimit(1)
                    }
                    Spacer()
                    Button { replyingTo = nil } label: {
                        Image(systemName: "xmark.circle.fill").font(.system(size: 18)).foregroundStyle(NX.mutedFg)
                    }
                }
                .padding(.horizontal, 12).padding(.top, 8)
            }
            if let pending = pendingAttachment {
                HStack(spacing: 8) {
                    CachedImage(url: URL(string: Config.baseURL.absoluteString + pending.url)) {
                        $0.resizable().scaledToFill()
                    } placeholder: { NX.muted }
                        .frame(width: 54, height: 54)
                        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                    Button { pendingAttachment = nil } label: {
                        Image(systemName: "xmark.circle.fill").font(.system(size: 18)).foregroundStyle(NX.mutedFg)
                    }
                    Spacer()
                }
                .padding(.horizontal, 12).padding(.top, 8)
            }
            HStack(alignment: .bottom, spacing: 8) {
                Menu {
                    Button { Task { await sendLocation() } } label: { Label(T("Send location"), systemImage: "mappin.and.ellipse") }
                    Button { showTaskPicker = true } label: { Label(T("Link to a task"), systemImage: "checklist") }
                    // A PhotosPicker nested in a Menu draws its row but never opens: the menu tears
                    // down its content as it dismisses, and the picker's presentation goes with it.
                    // Flip a flag here and present from the composer, which outlives the menu.
                    Button { showPhotoPicker = true } label: { Label(T("Send a photo"), systemImage: "photo") }
                    Button { showCamera = true } label: { Label(T("Take a photo"), systemImage: "camera") }
                } label: {
                    Image(systemName: "plus").font(.system(size: 17, weight: .bold)).foregroundStyle(NX.violetText)
                        .frame(width: 36, height: 36).background(NX.muted, in: Circle())
                }
                .disabled(sending)

                if !mentionable.isEmpty {
                    // Kept for discoverability only: it types the "@" for you, then the inline
                    // path above takes over exactly as if you had typed it yourself.
                    Button {
                        if !input.isEmpty && !input.hasSuffix(" ") { input += " " }
                        input += "@"
                    } label: {
                        let active = mentionQuery != nil
                        // SF Symbol rather than Text("@"): the display face centres the glyph on its
                        // own baseline, which lands visibly high inside a 36pt circle.
                        Image(systemName: "at").font(.system(size: 17, weight: .bold))
                            .foregroundStyle(active ? Color.white : NX.violetText)
                            .frame(width: 36, height: 36)
                            .background(active ? NX.violet : NX.muted, in: Circle())
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
                // A picture on its own is a message. send() always allowed that; the button did
                // not, so a photo-only reply looked broken until you typed something.
                }.disabled((input.trimmingCharacters(in: .whitespaces).isEmpty && pendingAttachment == nil) || sending)
            }
            .padding(12)
        }
        .background(NX.card)
        .overlay(Rectangle().fill(NX.border).frame(height: 1), alignment: .top)
    }

    // MARK: bubbles

    @ViewBuilder private func bubble(_ m: ChatMessage) -> some View {
        let mine = m.userId != nil && m.userId == meId
        SwipeToReply(onReply: { replyingTo = m }) {
            HStack(alignment: .bottom, spacing: 8) {
                if mine {
                    Spacer(minLength: 50)
                } else {
                    AvatarView(url: m.user?.avatar, initial: String((m.user?.name ?? "?").first ?? "?").uppercased(), size: 28)
                }
                VStack(alignment: .leading, spacing: 4) {
                    if !mine, let n = m.user?.name { Text(n).font(NXFont.text(11, .semibold)).foregroundStyle(NX.mutedFg) }
                    if let quoted = m.replyTo { quoteBlock(quoted, mine: mine) }
                    if let path = m.attachmentUrl, !path.isEmpty,
                       let url = URL(string: path.hasPrefix("http") ? path : Config.baseURL.absoluteString + path) {
                        CachedImage(url: url) { $0.resizable().scaledToFit() } placeholder: {
                            RoundedRectangle(cornerRadius: 12, style: .continuous).fill(NX.muted)
                                .frame(height: 140)
                        }
                        .frame(maxWidth: 240)
                        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                    }
                    // A picture can travel without a caption; don't draw an empty text line under it.
                    if !m.content.isEmpty {
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
                }
                .padding(.horizontal, 13).padding(.vertical, 9)
                .background(mine ? NX.onyx : NX.muted, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                // On the bubble, not on the row: a context menu lifts whatever it is attached to,
                // and the row is full width with Spacers on both sides — so the preview came out as
                // a wide grey slab with the bubble floating inside it.
                .contextMenu {
                    Button { replyingTo = m } label: { Label(T("Reply"), systemImage: "arrowshape.turn.up.left") }
                }
                if !mine { Spacer(minLength: 50) }
            }
        }
    }

    /// The quote drawn inside a reply. Colours follow the bubble it sits in, so it stays legible
    /// on the dark "mine" bubble as well as the light one.
    @ViewBuilder private func quoteBlock(_ q: ChatMessage.Quoted, mine: Bool) -> some View {
        HStack(spacing: 6) {
            RoundedRectangle(cornerRadius: 1.5, style: .continuous)
                .fill(mine ? Color.white.opacity(0.55) : NX.violet)
                .frame(width: 2.5)
            VStack(alignment: .leading, spacing: 1) {
                Text(q.user?.name ?? T("Message"))
                    .font(NXFont.text(10, .bold))
                    .foregroundStyle(mine ? Color.white.opacity(0.85) : NX.violetText)
                Text(Self.quotePreview(q))
                    .font(NXFont.text(11))
                    .foregroundStyle(mine ? Color.white.opacity(0.7) : NX.mutedFg)
                    .lineLimit(2)
            }
            Spacer(minLength: 0)
        }
        .fixedSize(horizontal: false, vertical: true)
        .padding(.bottom, 1)
    }

    /// A picture with no caption still has to say something, otherwise the quote renders blank.
    static func quotePreview(_ q: ChatMessage.Quoted) -> String {
        let body = (q.content ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        if body.isEmpty { return q.attachmentType != nil ? T("📎 Attachment") : "…" }
        return body.count > 80 ? String(body.prefix(78)) + "…" : body
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
        // Replace the half-typed "@ali" rather than appending, otherwise picking from the list
        // while mid-token leaves "@ali @Alifawan" behind.
        if mentionQuery != nil, let at = input.lastIndex(of: "@") {
            input.replaceSubrange(at..., with: tag + " ")
        } else {
            if !input.isEmpty && !input.hasSuffix(" ") { input += " " }
            input += tag + " "
        }
        pendingMentions[m.uid] = tag
    }

    private func rename() async {
        let name = renameDraft.trimmingCharacters(in: .whitespaces)
        guard !name.isEmpty else { return }
        do {
            let updated = try await APIClient.shared.renameConversation(conversationId, name: name)
            shownTitle = updated.name ?? name
        } catch {
            notice = (error as? LocalizedError)?.errorDescription ?? T("Couldn't rename that group.")
        }
    }

    private func load() async {
        do { messages = try await APIClient.shared.conversationMessages(conversationId) }
        catch APIError.unauthorized { auth.logout() }
        catch {}
        loading = false
    }
    private func send() async {
        let v = input.trimmingCharacters(in: .whitespaces)
        // A picture on its own is a message; text is only required when nothing is attached.
        guard !v.isEmpty || pendingAttachment != nil else { return }
        let mentionedUserIds = pendingMentions.compactMap { v.contains($0.value) ? $0.key : nil }
        let attachment = pendingAttachment
        let replyId = replyingTo?.id
        sending = true; input = ""; pendingMentions = [:]; pendingAttachment = nil; notice = nil
        replyingTo = nil
        try? await APIClient.shared.sendMessage(conversationId, content: v, mentionedUserIds: mentionedUserIds,
                                                attachmentUrl: attachment?.url, attachmentType: attachment?.type,
                                                replyToId: replyId)
        await load()
        sending = false
    }

    /// The library hands back whatever the camera produced - often HEIC, which the server rejects.
    /// Re-encode to JPEG and cap the long edge so a photo straight off the camera doesn't blow the
    /// 8 MB limit.
    private func uploadPhoto(_ item: PhotosPickerItem) async {
        notice = nil
        defer { pickedPhoto = nil }
        guard let raw = try? await item.loadTransferable(type: Data.self), let image = UIImage(data: raw) else {
            notice = T("Couldn't read that photo.")
            return
        }
        let maxEdge: CGFloat = 1600
        let scale = min(1, maxEdge / max(image.size.width, image.size.height))
        let target = CGSize(width: image.size.width * scale, height: image.size.height * scale)
        let resized = UIGraphicsImageRenderer(size: target).image { _ in
            image.draw(in: CGRect(origin: .zero, size: target))
        }
        guard let jpeg = resized.jpegData(compressionQuality: 0.85) else {
            notice = T("Couldn't read that photo.")
            return
        }
        await uploadJPEG(jpeg)
    }

    /// Shared tail for both sources: the library path re-encodes above, the camera hands back
    /// JPEG that CameraPicker has already downscaled.
    private func uploadJPEG(_ jpeg: Data) async {
        uploadingPhoto = true
        defer { uploadingPhoto = false }
        do {
            pendingAttachment = try await APIClient.shared.uploadChatImage(
                conversationId: conversationId, fileName: "photo.jpg", mime: "image/jpeg", data: jpeg)
        } catch {
            notice = (error as? LocalizedError)?.errorDescription ?? T("Upload failed. Try again.")
        }
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

/// Drag a bubble to the right to answer it.
///
/// The gesture is attached with `.gesture`, not `.highPriorityGesture`, so the enclosing ScrollView
/// keeps ownership of vertical pans — a reply gesture that eats scrolling is worse than no gesture.
/// It also refuses any drag that is more vertical than horizontal, which is what stops a slightly
/// slanted scroll from nudging bubbles sideways. Long-press still offers Reply for anyone who
/// never discovers the swipe.
private struct SwipeToReply<Content: View>: View {
    let onReply: () -> Void
    @ViewBuilder var content: () -> Content

    @State private var offset: CGFloat = 0
    private let trigger: CGFloat = 48

    var body: some View {
        content()
            .offset(x: offset)
            .overlay(alignment: .leading) {
                Image(systemName: "arrowshape.turn.up.left.fill")
                    .font(.system(size: 12))
                    .foregroundStyle(NX.mutedFg)
                    .opacity(Double(min(offset, trigger) / trigger))
                    .offset(x: -26)
            }
            .gesture(
                DragGesture(minimumDistance: 20)
                    .onChanged { value in
                        guard abs(value.translation.width) > abs(value.translation.height) else { return }
                        offset = max(0, min(value.translation.width, 68))
                    }
                    .onEnded { _ in
                        let fired = offset >= trigger
                        withAnimation(.spring(response: 0.28, dampingFraction: 0.82)) { offset = 0 }
                        if fired { onReply() }
                    }
            )
    }
}
