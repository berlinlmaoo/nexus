import SwiftUI
import PhotosUI
import UIKit
import CoreLocation   // "kirim lokasi" reads CLLocationCoordinate2D members off LocationManager

/// Port of messages.tsx: conversation list grouped Direct/Groups/Projects → tap → chat thread.
struct MessagesView: View {
    @Environment(AuthStore.self) private var auth
    @Environment(\.scenePhase) private var scenePhase
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
    /// The chat a notification pointed at (`AppRouter.focus`). On the phone it is pushed as a
    /// value — the rows are view-based NavigationLinks, which nothing can trigger from code — and
    /// the split layout simply selects it.
    @Environment(AppRouter.self) private var router
    @State private var pushedConvo: FocusedConversation?
    @State private var focusMissing = false
    /// Conversations fetched one by one because a push pointed at them before the list had them —
    /// a group somebody added you to a minute ago. Kept apart from `convos` so a list refresh that
    /// races the fetch cannot pull the open thread out from under the person reading it.
    @State private var focusedConvos: [String: Conversation] = [:]
    /// One background refresh at a time: a busy group pushing every second would otherwise stack
    /// up a list fetch per message.
    @State private var refreshing = false
    /// A refresh was asked for while one was running: one more pass follows it.
    @State private var refreshAgain = false
    @State private var realtime = RealtimeClient.shared

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
        .alert(T("That chat isn't in your list"), isPresented: $focusMissing) { Button("OK") {} } message: {
            Text(T("You may have been removed from it, or the list hasn't loaded yet — pull to refresh."))
        }
        // Runs again every time the list comes back on screen (popping back from a thread), which
        // is what brings that thread's unread count and mute icon up to date.
        .task {
            await load()
            // An empty right-hand pane on first open is a screen asking to be clicked before it
            // shows anything. The phone has no equivalent: there, nothing is open yet by design.
            if isSplit, selected == nil { selected = convos.first }
            await claimFocus()
        }
        .onChange(of: router.focus) { _, _ in
            if !loading { Task { await claimFocus() } }
        }
        // Same reason as the thread, at a calmer pace: this only moves badges and previews. Only
        // while the app is in front — `.task(id:)` cancels the loop when the phase changes and
        // starts a fresh one on the way back. Stretched while the realtime connection is up: it
        // brings every chat's news itself (`.nexusChatPush` below), and the timer is a safety net.
        .task(id: ChatPollPace(active: scenePhase == .active, live: realtime.isConnected)) {
            guard scenePhase == .active else { return }
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(LiveRefreshPolicy.interval(15)))
                if Task.isCancelled { return }
                await refreshQuietly()
            }
        }
        // Back from the background: the list is whatever it was when the phone was put down.
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { Task { await refreshQuietly() } }
        }
        // A chat push while the app is open, or the realtime connection's word: some conversation
        // just moved.
        .onReceive(NotificationCenter.default.publisher(for: .nexusChatPush)) { _ in
            Task { await refreshQuietly() }
        }
    }

    /// Opens the chat a notification asked for.
    private func claimFocus() async {
        guard case .conversation(let id) = router.focus else { return }
        router.focus = nil
        // That chat is already on screen (its push was tapped while reading it): bring it up to date
        // instead of pushing a second copy of it on top.
        if ChatPresence.visibleConversationId == id {
            NotificationCenter.default.post(name: .nexusChatPush, object: nil, userInfo: ["conversationId": id])
            return
        }
        var found = convos.first(where: { $0.id == id }) ?? focusedConvos[id]
        if found == nil, let fetched = try? await APIClient.shared.conversation(id) {
            // Not in the list this screen has — new, or the list is from before it existed. Ask the
            // server for that one chat rather than telling the person it does not exist.
            focusedConvos[fetched.id] = fetched
            found = fetched
            Task { await refreshQuietly() }
        }
        guard let c = found else { focusMissing = true; return }
        if isSplit { selected = c } else { pushedConvo = FocusedConversation(id: c.id) }
    }

    /// The list on its own — the whole screen on a phone, the left column on an iPad.
    private var listPane: some View {
        ZStack {
            NX.background.ignoresSafeArea()
            content
        }
        // Inside the stack, whichever stack that is: this pane is pushed into Home's, More's, or its own.
        .navigationDestination(item: $pushedConvo) { f in
            if let c = convos.first(where: { $0.id == f.id }) ?? focusedConvos[f.id] {
                ChatThreadView(conversationId: c.id, title: c.title(meId: meId),
                               members: c.members ?? [], projectId: c.projectId, type: c.type,
                               canManageMembers: c.canManageMembers)
            }
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
                           canManageMembers: c.canManageMembers,
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
            ErrorState(message: error, icon: "bubble.left.and.bubble.right") { Task { await load() } }
        } else if convos.isEmpty {
            EmptyState(icon: "bubble.left.and.bubble.right", title: T("No chats yet"),
                       subtitle: T("Direct messages and group chats with colleagues live here, and every project has a room of its own. Start one and it appears at the top."),
                       actionTitle: T("Start a chat"), actionIcon: "square.and.pencil") { showNewChat = true }
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
                                                           type: c.type, canManageMembers: c.canManageMembers)
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
        // Chat is what people reach for first when something is wrong, so it must not be the one
        // screen that is empty while the server is down.
        if convos.isEmpty, let hit = ResponseCache.decoded("conversations", as: ConversationsResponse.self) {
            convos = hit.value.conversations ?? []
            ChatStore.shared.absorbCached(hit.value)
            loading = false
        }
        do { convos = try await APIClient.shared.conversations() }
        catch APIError.unauthorized { auth.logout() }
        catch {
            if convos.isEmpty {
                self.error = (error as? LocalizedError)?.errorDescription ?? T("Couldn't load chats.")
            }
        }
        loading = false
    }

    /// The list again, without the skeleton or an error screen: for the timer, a push and a return
    /// to the app. A failure leaves what is on screen alone.
    private func refreshQuietly() async {
        guard !loading else { return }
        // Not dropped while one is running: news that lands mid-fetch may be newer than what that
        // fetch will return, and with the realtime connection up the next timer is minutes away.
        if refreshing {
            refreshAgain = true
            return
        }
        refreshing = true
        defer { refreshing = false }
        repeat {
            refreshAgain = false
            do { convos = try await APIClient.shared.conversations() }
            catch APIError.unauthorized { auth.logout(); return }
            catch {}
        } while refreshAgain
    }
}

/// The chat a notification asked for, as a value the phone's stack can push.
struct FocusedConversation: Identifiable, Hashable { let id: String }

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

    /// The last line under the name. A picture sent without a caption has empty content, which
    /// used to leave the row with a blank second line.
    private var preview: String {
        guard let last = convo.lastMessage else { return T("No message yet") }
        if last.content.isEmpty, let path = last.attachmentUrl, !path.isEmpty { return T("📷 Photo") }
        return last.content
    }

    private var groupGlyph: some View {
        ZStack {
            Circle().fill(NX.violet.opacity(0.12)).frame(width: 40, height: 40)
            Image(systemName: "person.2.fill").font(.system(size: 15)).foregroundStyle(NX.violetText)
        }
    }

    var body: some View {
        let muted = ChatStore.shared.isMuted(convo)
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
                HStack(spacing: 5) {
                    Text(convo.title(meId: meId)).font(NXFont.text(15, .semibold)).foregroundStyle(NX.foreground).lineLimit(1)
                    if muted {
                        Image(systemName: "bell.slash.fill")
                            .font(.system(size: 11))
                            .foregroundStyle(NX.mutedFg)
                            .accessibilityLabel(T("Muted"))
                    }
                }
                Text(preview).font(NXFont.text(13)).foregroundStyle(NX.mutedFg).lineLimit(1)
            }
            Spacer(minLength: 4)
            if let u = convo.unreadCount, u > 0 {
                // Grey on a muted chat, the way every messaging app draws it: still counted, no
                // longer asking for attention.
                let badgeFill: Color = muted ? NX.mutedFg : NX.danger
                Text("\(u)").font(NXFont.text(10, .bold)).foregroundStyle(.white)
                    .padding(.horizontal, 6).padding(.vertical, 3).background(badgeFill, in: Capsule())
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

/// Colours for what sits on the sender's own bubble.
private enum ChatInk {
    /// Type and icons on `NX.onyx`, which is near-black in light mode and near-white in dark. Plain
    /// white was used before and all but vanished on the dark-mode bubble (about 1.2:1).
    static let onMine = Color(light: 0xffffff, dark: 0x202023)
}

/// The thread's sheets. One `.sheet(item:)` for all of them: two `.sheet` modifiers on one view and
/// only one of them ever presents, which is how a button ends up doing nothing.
private enum ChatThreadSheet: String, Identifiable {
    case addPeople, taskPicker
    var id: String { rawValue }
}

/// How a poll's attempt to stitch a hole shut ended.
private enum ChatGapResult { case closed, unreachable, tooFar }

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
    /// The server's `canManageMembers` for this room: only Manager and above may add or remove
    /// people in a GROUP (owner, 8 Oct 2026). nil = a server from before the rule, so the add
    /// button keeps showing as it always has.
    var canManageMembers: Bool? = nil
    /// True when the thread is one column of a two-pane layout.
    ///
    /// A navigation bar belongs to a whole screen, not to a column of one: in the split layout it
    /// stretched across both panes, so the conversation's name sat centred above the chat list next
    /// to it. Drawing the header inside the column puts the title over the thread it names. The
    /// NavigationStack stays — the thread still pushes into a task and into project settings — only
    /// its bar is hidden.
    var usesInlineHeader: Bool = false
    @Environment(AuthStore.self) private var auth
    @Environment(\.scenePhase) private var scenePhase
    @State private var store = ChatStore.shared
    @State private var messages: [ChatMessage] = []
    @State private var input = ""
    @State private var loading = true
    @State private var sending = false
    /// Only for "Send location". Opening a chat used to ask for location permission on appear;
    /// `currentFix()` asks by itself the first time somebody actually sends their location.
    @State private var loc = LocationManager()
    @State private var deniedPermission: PermissionKind?
    @State private var pendingMentions: [String: String] = [:]
    @State private var sheet: ChatThreadSheet?
    @State private var showRename = false
    @State private var pickedPhoto: PhotosPickerItem?
    @State private var showPhotoPicker = false
    @State private var showCamera = false
    @State private var pendingAttachment: ChatUpload?
    @State private var replyingTo: ChatMessage?
    @State private var uploadingPhoto = false
    @State private var uploadProgress = UploadProgress()
    @State private var renameDraft = ""
    @State private var shownTitle: String? = nil
    @State private var notice: String?
    @State private var viewingPhoto: PhotoRef?

    // Paging and live updates.
    /// The server has answered at least once. Its first page REPLACES whatever the cache drew (that
    /// copy may be days old and not continuous with today); every later answer is merged by id.
    @State private var serverAnswered = false
    /// The newest message this thread has fetched with nothing missing before it — what the next
    /// poll asks `after`. Deliberately not `messages.last`: a message just sent is drawn at once,
    /// and polling after it would skip whatever somebody else posted a moment before it.
    @State private var pollAnchor: String?
    @State private var pollInFlight = false
    /// A poll was asked for while one was out: one more follows it (see `pollNewer`).
    @State private var pollAgain = false
    @State private var realtime = RealtimeClient.shared
    /// Whether this server answers `after=` (nil until a poll has shown it either way). Only a
    /// hint for the page size: every answer is checked on its own, so a server updated while the
    /// thread is open is picked up by the next poll.
    @State private var afterSupported: Bool?
    @State private var hasOlder = false
    @State private var olderCursor: String?
    @State private var loadingOlder = false
    /// The end of the thread is on screen. New messages scroll into view only then; otherwise
    /// they wait behind the "new messages" pill instead of yanking the person away from what
    /// they scrolled up to read.
    @State private var atBottom = true
    @State private var viewportHeight: CGFloat = 0
    @State private var unseenCount = 0
    @State private var markedReadId: String?
    @State private var readFailed = false

    private static let pageSize = 50
    private static let maxCatchUpPages = 5
    private static let bottomId = "chat-bottom"
    private static let scrollSpace = "chat-scroll"
    /// How far below the visible area the end may sit and still count as "at the bottom".
    private static let bottomSlack: CGFloat = 60

    private var meId: String? { auth.session?.userId }
    private var mentionable: [Conversation.Member] {
        members.filter { !$0.uid.isEmpty && $0.uid != meId }
    }
    private var isMuted: Bool { store.isMuted(conversationId: conversationId) }
    /// Hidden once the server has said it cannot mute (404 from the old server).
    private var showsMuteMenu: Bool { store.muteSupported != false }

    /// Project rooms add through the project; a plain GROUP owns its own member list and has had an
    /// endpoint of its own since /api/conversations/[id]/members, which only Manager and above may
    /// use. A DM stays closed: two people is what a DM means.
    private var showsAddPeople: Bool {
        projectId != nil || (type == "GROUP" && canManageMembers != false)
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
            // Same conditions as the toolbar below: a DM can neither grow nor be renamed.
            if showsAddPeople {
                Button { sheet = .addPeople } label: {
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
            if showsMuteMenu {
                muteMenu(iconSize: 16)
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
                    VStack(spacing: 0) {
                        LazyVStack(spacing: 6) {
                            if hasOlder && !messages.isEmpty { olderRow(proxy) }
                            if loading { ProgressView().tint(NX.violetText).padding(.top, 40) }
                            else if messages.isEmpty {
                                Text(T("No messages yet. Say hi 👋")).font(NXFont.text(14)).foregroundStyle(NX.mutedFg).padding(.top, 40)
                            }
                            ForEach(messages) { m in
                                bubble(m).id(m.id)
                            }
                        }
                        .padding(.horizontal, 16)
                        .padding(.top, 16)
                        bottomMarker
                    }
                }
                .coordinateSpace(.named(Self.scrollSpace))
                .background {
                    GeometryReader { g in
                        Color.clear
                            .onAppear { viewportHeight = g.size.height }
                            .onChange(of: g.size.height) { old, h in
                                viewportHeight = h
                                // The keyboard came up while the end of the thread was in view:
                                // keep the end in view instead of letting it slide under the keyboard.
                                if h < old, atBottom { proxy.scrollTo(Self.bottomId, anchor: .bottom) }
                            }
                    }
                }
                .overlay(alignment: .bottom) {
                    if unseenCount > 0 { newMessagesPill(proxy) }
                }
                // Keyed on the newest message's id, not on the count: the count stops moving once a
                // page is full, and loading older history changes it without anything new arriving.
                .onChange(of: messages.last?.id) { old, new in
                    lastMessageChanged(from: old, to: new, proxy: proxy)
                }
                .task { await firstLoad() }
                // An open thread also refreshes itself — only while it is on screen (.task ends with
                // the view) and only while the app is in front (`id` restarts the loop when the phase
                // or the realtime connection changes, and the restart catches up at once).
                .task(id: ChatPollPace(active: scenePhase == .active, live: realtime.isConnected)) { await pollWhileActive() }
                // A push for this chat while it is open, or the realtime connection's word that it
                // moved: fetch now rather than at the next tick.
                .onReceive(NotificationCenter.default.publisher(for: .nexusChatPush)) { note in
                    let target = note.userInfo?["conversationId"] as? String
                    guard target == nil || target == conversationId else { return }
                    Task { await pollNewer() }
                }
                // On the scroll view rather than on the VStack below, which already carries the
                // camera's cover: two of these on one view and only the last one ever presents.
                .fullScreenCover(item: $viewingPhoto) { PhotoViewer(photo: $0) }
            }

            composer
        }
        .background(NX.background.ignoresSafeArea())
        // Links in messages: a NEXUS form or vault link opens in the app, the way it does when
        // tapped anywhere else; everything else goes to the system (Safari, Maps, Mail).
        .environment(\.openURL, OpenURLAction { url in
            let parts = url.pathComponents.filter { $0 != "/" }
            if Config.isNexusHost(url), parts.count == 2, parts[0] == "f" || parts[0] == "v" {
                Task { @MainActor in AppRouter.shared.open(url) }
                return .handled
            }
            return .systemAction
        })
        .navigationTitle(usesInlineHeader ? "" : (shownTitle ?? title))
        .toolbar(usesInlineHeader ? .hidden : .visible, for: .navigationBar)
        .toolbar {
            // See showsAddPeople: project rooms add through the project, a GROUP only for Manager
            // and above, and a DM never.
            if showsAddPeople {
                ToolbarItem(placement: .topBarTrailing) {
                    Button { sheet = .addPeople } label: {
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
            if showsMuteMenu {
                ToolbarItem(placement: .topBarTrailing) { muteMenu(iconSize: 15) }
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
            // Close it from here rather than leaving it to the picker. CameraPicker dismisses via
            // @Environment(\.dismiss) read inside a UIViewControllerRepresentable, which its
            // coordinator then calls on a captured copy of the struct — that works under .sheet,
            // where attendance uses it, and does not under .fullScreenCover. The camera stayed up,
            // so the photo looked like it never arrived even though the upload had started.
            CameraPicker(cameraDevice: .rear) { data in
                showCamera = false
                Task { await uploadJPEG(data) }
            }
            .ignoresSafeArea()
        }
        .sheet(item: $sheet) { which in
            switch which {
            case .addPeople:
                addPeopleSheet
            case .taskPicker:
                TaskLinkPicker(projectId: projectId, meId: meId) { t in Task { await sendTaskLink(t) } }
            }
        }
        .navigationBarTitleDisplayMode(.inline)
        .permissionAlert($deniedPermission)
        // Which chat is on screen, for the notification delegate: a push for the chat being read
        // is not shown as a banner. Its banners already in Notification Center go once it opens.
        .onAppear {
            ChatPresence.visibleConversationId = conversationId
            ChatPresence.clearDelivered(conversationId: conversationId)
        }
        // `message-created` goes only to the conversation's room, as on the web (ChatThread.tsx).
        .realtimeRoom("conversation:\(conversationId)")
        .onDisappear {
            if ChatPresence.visibleConversationId == conversationId {
                ChatPresence.visibleConversationId = nil
            }
        }
    }

    @ViewBuilder private var addPeopleSheet: some View {
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

    // MARK: mute

    private func muteMenu(iconSize: CGFloat) -> some View {
        Menu {
            if let until = store.mutedUntil(conversationId: conversationId) {
                Section(Self.mutedCaption(until)) {
                    Button { Task { await setMute(nil) } } label: {
                        Label(T("Unmute"), systemImage: "bell")
                    }
                }
            } else {
                Button { Task { await setMute(Self.muteUntil(hours: 8)) } } label: {
                    Label(T("Mute for 8 hours"), systemImage: "bell.slash")
                }
                Button { Task { await setMute(Self.muteUntil(hours: 24 * 7)) } } label: {
                    Label(T("Mute for 1 week"), systemImage: "bell.slash")
                }
                Button { Task { await setMute("forever") } } label: {
                    Label(T("Mute always"), systemImage: "bell.slash.fill")
                }
            }
        } label: {
            Image(systemName: isMuted ? "bell.slash" : "bell")
                .font(.system(size: iconSize, weight: .semibold))
                .foregroundStyle(NX.violetText)
        }
        .accessibilityLabel(isMuted ? T("Muted") : T("Mute notifications"))
    }

    /// "Muted until 9 Oct, 02:00", or just "Muted" for "Always" (stored as a far-future date).
    private static func mutedCaption(_ raw: String) -> String {
        guard let until = ChatStore.parseDate(raw),
              until.timeIntervalSinceNow < 5 * 365 * 24 * 3600 else { return T("Muted") }
        return String(format: T("Muted until %@"), until.formatted(date: .abbreviated, time: .shortened))
    }

    private static func muteUntil(hours: Double) -> String {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f.string(from: Date().addingTimeInterval(hours * 3600))
    }

    private func setMute(_ until: String?) async {
        notice = nil
        do {
            let stored = try await APIClient.shared.setConversationMute(conversationId, until: until)
            // A server that answers without the field still did what was asked.
            let effective: String? = until == nil ? nil : (stored ?? until)
            store.setMuted(conversationId, until: effective)
        } catch APIError.unauthorized {
            auth.logout()
        } catch APIError.http(let code, _) where code == 404 {
            // The old server has no mute route. Take the option away rather than offer it again.
            store.muteUnavailable()
            notice = T("Muting isn't available yet. It comes with the next server update.")
        } catch {
            notice = (error as? LocalizedError)?.errorDescription ?? T("Couldn't change notifications for this chat.")
        }
    }

    // MARK: scroll position

    /// The end of the thread. Outside the lazy stack on purpose: a lazy child only exists near the
    /// screen, so where it sits cannot be read once it is far away. This one always exists, and its
    /// position in the scroll view's own coordinates says whether the person is at the end.
    private var bottomMarker: some View {
        Color.clear
            .frame(height: 16)
            .id(Self.bottomId)
            .background {
                GeometryReader { g in
                    let y = g.frame(in: .named(Self.scrollSpace)).minY
                    Color.clear
                        .onAppear { updateAtBottom(markerY: y) }
                        .onChange(of: y) { _, v in updateAtBottom(markerY: v) }
                }
            }
    }

    /// Called on every scroll frame, so it writes state only when something actually changes.
    private func updateAtBottom(markerY y: CGFloat) {
        guard viewportHeight > 0 else { return }
        let now = y <= viewportHeight + Self.bottomSlack
        if now != atBottom { atBottom = now }
        if now {
            if unseenCount != 0 { unseenCount = 0 }
            markReadIfNeeded()
        }
    }

    private func lastMessageChanged(from old: String?, to new: String?, proxy: ScrollViewProxy) {
        guard new != nil else { return }
        guard let old else {
            // First draw, from the cache or the server: start at the end, without sliding down
            // from the top. Again a moment later, once the lazy stack has measured the bubbles it
            // only estimated the first time round.
            scrollToBottom(proxy, animated: false)
            Task { @MainActor in
                try? await Task.sleep(for: .milliseconds(150))
                proxy.scrollTo(Self.bottomId, anchor: .bottom)
            }
            return
        }
        let newestIsMine = messages.last.map { $0.userId != nil && $0.userId == meId } ?? false
        if atBottom || newestIsMine {
            scrollToBottom(proxy, animated: true)
        } else {
            let added: Int
            if let i = messages.firstIndex(where: { $0.id == old }) {
                added = messages.count - 1 - i
            } else {
                added = 1
            }
            unseenCount += max(added, 1)
        }
    }

    private func scrollToBottom(_ proxy: ScrollViewProxy, animated: Bool) {
        unseenCount = 0
        if animated {
            withAnimation(.easeOut(duration: 0.2)) { proxy.scrollTo(Self.bottomId, anchor: .bottom) }
        } else {
            proxy.scrollTo(Self.bottomId, anchor: .bottom)
        }
        // Said here as well as by the geometry: a jump made in code lands before the next layout
        // pass reports where the end is.
        atBottom = true
        markReadIfNeeded()
    }

    private func newMessagesPill(_ proxy: ScrollViewProxy) -> some View {
        let label: String = unseenCount == 1 ? T("1 new message") : String(format: T("%d new messages"), unseenCount)
        return Button {
            scrollToBottom(proxy, animated: true)
        } label: {
            HStack(spacing: 6) {
                Image(systemName: "arrow.down").font(.system(size: 12, weight: .bold))
                Text(label).font(NXFont.text(13, .semibold))
            }
            .foregroundStyle(.white)
            .padding(.horizontal, 14).padding(.vertical, 8)
            .background(NX.violetFill, in: Capsule())
            .nexusShadowSoft()
        }
        .buttonStyle(.plain)
        .padding(.bottom, 10)
    }

    /// The top of what is loaded, when the conversation goes further back.
    private func olderRow(_ proxy: ScrollViewProxy) -> some View {
        Button { Task { await loadOlder(proxy) } } label: {
            HStack(spacing: 6) {
                if loadingOlder {
                    ProgressView().controlSize(.small).tint(NX.violetText)
                } else {
                    Image(systemName: "arrow.up").font(.system(size: 11, weight: .bold))
                }
                Text(T("Load earlier messages")).font(NXFont.text(12, .semibold))
            }
            .foregroundStyle(NX.violetText)
            .padding(.horizontal, 12).padding(.vertical, 7)
            .background(NX.accentBg, in: Capsule())
        }
        .buttonStyle(.plain)
        .disabled(loadingOlder)
        .padding(.bottom, 6)
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
            if uploadProgress.isActive {
                UploadProgressBar(progress: uploadProgress).padding(.horizontal, 12).padding(.top, 8)
            }
            HStack(alignment: .bottom, spacing: 8) {
                Menu {
                    Button { Task { await sendLocation() } } label: { Label(T("Send location"), systemImage: "mappin.and.ellipse") }
                    Button { sheet = .taskPicker } label: { Label(T("Link to a task"), systemImage: "checklist") }
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
                    Image(systemName: sending ? "ellipsis" : "paperplane.fill").font(.system(size: 16, weight: .bold)).foregroundStyle(ChatInk.onMine)
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
        let ink: Color = mine ? ChatInk.onMine : NX.foreground
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
                        // A tap gesture rather than a Button, because of what is already wrapped
                        // around this bubble. SwipeToReply's drag waits for 20pt of travel, and a
                        // button takes the touch down and holds it — every swipe that happened to
                        // start on the picture would die there. A TapGesture gives the touch back
                        // the moment the finger moves, so the swipe still fires, and it is not the
                        // long-press the context menu below listens for either.
                        .onTapGesture { viewingPhoto = PhotoRef(url: url, name: nil) }
                    }
                    // A picture can travel without a caption; don't draw an empty text line under it.
                    if !m.content.isEmpty {
                    switch ChatPayload.parse(m.content) {
                    case .location(let lat, let lng, let url):
                        locationCard(lat: lat, lng: lng, url: url, mine: mine)
                    case .task(let id, let title):
                        taskCard(id: id, title: title, mine: mine)
                    case .plain:
                        Self.richText(m.content, mine: mine).font(NXFont.text(15))
                            .foregroundStyle(ink)
                            // Links take the tint. On the sender's own dark bubble the brand
                            // violet would not read, so there they are the bubble's ink, underlined.
                            .tint(mine ? ChatInk.onMine : NX.violetText)
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
                    if !m.content.isEmpty {
                        Button { UIPasteboard.general.string = m.content } label: {
                            Label(T("Copy"), systemImage: "doc.on.doc")
                        }
                    }
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
                .fill(mine ? ChatInk.onMine.opacity(0.55) : NX.violet)
                .frame(width: 2.5)
            VStack(alignment: .leading, spacing: 1) {
                Text(q.user?.name ?? T("Message"))
                    .font(NXFont.text(10, .bold))
                    .foregroundStyle(mine ? ChatInk.onMine.opacity(0.85) : NX.violetText)
                Text(Self.quotePreview(q))
                    .font(NXFont.text(11))
                    .foregroundStyle(mine ? ChatInk.onMine.opacity(0.7) : NX.mutedFg)
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

    /// One detector for every bubble: building it is the expensive part, matching is cheap.
    private static let linkDetector = try? NSDataDetector(types: NSTextCheckingResult.CheckingType.link.rawValue)

    /// Web addresses (and email addresses) in a message, in order.
    static func linkRanges(in s: String) -> [(Range<String.Index>, URL)] {
        // Every address has a dot or an "@" in it; most messages have neither, and skip the detector.
        guard s.contains(".") || s.contains("@"), let detector = linkDetector else { return [] }
        let whole = NSRange(s.startIndex..<s.endIndex, in: s)
        return detector.matches(in: s, options: [], range: whole).compactMap { match -> (Range<String.Index>, URL)? in
            guard let url = match.url, let r = Range(match.range, in: s) else { return nil }
            return (r, url)
        }
    }

    /// The message as one Text: links tappable and underlined, @mentions bold. Concatenating
    /// `Text` (not a wrapping view) keeps it one selectable, wrapping paragraph — which is why the
    /// mentions use the deprecated `foregroundColor`, the form that still returns a Text. A link is
    /// a Text built from an AttributedString carrying `.link`, which SwiftUI opens through the
    /// `openURL` action set on the thread.
    static func richText(_ s: String, mine: Bool) -> Text {
        var out = Text(verbatim: "")
        var cursor = s.startIndex
        for (range, url) in linkRanges(in: s) {
            guard range.lowerBound >= cursor else { continue }
            if cursor < range.lowerBound {
                out = out + mentionText(String(s[cursor..<range.lowerBound]), mine: mine)
            }
            var link = AttributedString(String(s[range]))
            link.link = url
            out = out + Text(link).underline()
            cursor = range.upperBound
        }
        if cursor < s.endIndex {
            out = out + mentionText(String(s[cursor...]), mine: mine)
        }
        return out
    }

    /// Highlights @mention tokens. On the sender's own bubble the mention keeps the bubble's ink
    /// and only turns bold: the brand violet does not read on onyx.
    private static func mentionText(_ s: String, mine: Bool) -> Text {
        let mentionInk: Color = mine ? ChatInk.onMine : NX.violetText
        var out = Text(verbatim: "")
        var first = true
        for w in s.split(separator: " ", omittingEmptySubsequences: false) {
            let sep = first ? "" : " "
            first = false
            if w.count > 1, w.hasPrefix("@") {
                out = out + Text(verbatim: sep) + Text(String(w)).foregroundColor(mentionInk).fontWeight(.bold)
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
                    .foregroundStyle(mine ? ChatInk.onMine : NX.violetText)
                VStack(alignment: .leading, spacing: 2) {
                    Text(T("Shared location")).font(NXFont.text(13, .bold))
                        .foregroundStyle(mine ? ChatInk.onMine : NX.foreground)
                    Text(String(format: "%.5f, %.5f", lat, lng)).font(NXFont.text(11))
                        .foregroundStyle(mine ? ChatInk.onMine.opacity(0.75) : NX.mutedFg)
                }
                Image(systemName: "arrow.up.right").font(.system(size: 11, weight: .bold))
                    .foregroundStyle(mine ? ChatInk.onMine.opacity(0.7) : NX.mutedFg)
            }
        }
    }

    private func taskCard(id: String, title: String, mine: Bool) -> some View {
        NavigationLink { TaskDetailView(taskId: id) } label: {
            HStack(spacing: 10) {
                Image(systemName: "checklist").font(.system(size: 18))
                    .foregroundStyle(mine ? ChatInk.onMine : NX.violetText)
                VStack(alignment: .leading, spacing: 2) {
                    Text(T("TASK")).font(NXFont.text(10, .bold)).tracking(0.5)
                        .foregroundStyle(mine ? ChatInk.onMine.opacity(0.7) : NX.mutedFg)
                    Text(title).font(NXFont.text(13, .bold)).lineLimit(2).multilineTextAlignment(.leading)
                        .foregroundStyle(mine ? ChatInk.onMine : NX.foreground)
                }
                Image(systemName: "chevron.right").font(.system(size: 11, weight: .bold))
                    .foregroundStyle(mine ? ChatInk.onMine.opacity(0.7) : NX.mutedFg)
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

    // MARK: loading

    /// On appear: the cached end of the thread at once, then the server's.
    private func firstLoad() async {
        if messages.isEmpty,
           let hit = ResponseCache.decoded("messages-\(conversationId)", as: MessagesResponse.self) {
            let cached = hit.value.messages ?? []
            messages = cached
            hasOlder = hit.value.hasMore ?? (cached.count >= Self.pageSize)
            olderCursor = hit.value.nextCursor ?? cached.first?.createdAt
            loading = false
        }
        await loadLatest()
    }

    /// The newest page. The first answer replaces the cached copy; after that it is merged, and if
    /// it no longer reaches back to what the thread already had, the hole is filled from below.
    private func loadLatest() async {
        do {
            let page = try await APIClient.shared.conversationMessagesPage(conversationId)
            let rows = page.messages ?? []
            if !serverAnswered {
                serverAnswered = true
                messages = rows
                hasOlder = page.hasMore ?? (rows.count >= Self.pageSize)
                olderCursor = page.nextCursor ?? rows.first?.createdAt
                pollAnchor = rows.last?.id
            } else {
                let anchor = pollAnchor
                merge(rows)
                if let anchor, !rows.isEmpty, !rows.contains(where: { $0.id == anchor }) {
                    switch await closeGap(below: rows.first, anchor: anchor) {
                    case .closed: pollAnchor = rows.last?.id
                    case .unreachable: break
                    case .tooFar: await restartFromNewest()
                    }
                } else if let last = rows.last?.id {
                    pollAnchor = last
                }
            }
            markReadIfNeeded()
        }
        catch APIError.unauthorized { auth.logout() }
        // A failed refresh leaves whatever was already read on screen rather than blanking it.
        catch {}
        loading = false
    }

    /// Runs while the thread is on screen and the app is in front.
    private func pollWhileActive() async {
        guard scenePhase == .active else { return }
        // Back from the background or the lock screen: catch up now rather than five seconds from
        // now, and take this chat's banners out of Notification Center — they are on screen.
        if serverAnswered {
            ChatPresence.clearDelivered(conversationId: conversationId)
            await pollNewer()
        }
        while !Task.isCancelled {
            // Every 5 s on its own; every 30 s while the realtime connection is up, which brings this
            // chat's messages the moment they are sent and leaves the poll as a safety net.
            try? await Task.sleep(for: .seconds(realtime.isConnected ? 30 : 5))
            if Task.isCancelled { return }
            await pollNewer()
        }
    }

    /// Whatever arrived after `pollAnchor`, merged by id. Never replaces the list with the newest
    /// page: a long chat that has scrolled back keeps what it loaded, and nothing in between goes
    /// missing however many messages arrived.
    private func pollNewer() async {
        // One poll at a time, but one asked for while another is out is not dropped: a message's
        // realtime event can land while a poll that left before the message was saved is still on
        // its way back without it, and with the connection up the next tick is 30 s off.
        if pollInFlight {
            pollAgain = true
            return
        }
        repeat {
            pollAgain = false
            await pollNewerOnce()
        } while pollAgain
    }

    private func pollNewerOnce() async {
        guard !pollInFlight else { return }
        guard serverAnswered, let anchor = pollAnchor else { await loadLatest(); return }
        pollInFlight = true
        defer { pollInFlight = false }
        do {
            var cursor = anchor
            pages: for _ in 0..<Self.maxCatchUpPages {
                let page = try await APIClient.shared.conversationMessagesPage(
                    conversationId, after: cursor, limit: afterSupported == true ? 100 : Self.pageSize)
                let rows = page.messages ?? []
                if rows.contains(where: { $0.id == cursor }) {
                    // An older server ignores `after` and answers the newest page, as it always
                    // did. That page still holds the message asked after, so it joins on with
                    // nothing missing in between.
                    afterSupported = false
                    merge(rows)
                    if let last = rows.last?.id { pollAnchor = last }
                    break pages
                }
                if rows.isEmpty {
                    // Nothing newer. Only a server that understands `after` ever says that: the
                    // old one always answers with a page.
                    afterSupported = true
                    break pages
                }
                merge(rows)
                if page.hasCursorField { afterSupported = true }
                if afterSupported == true {
                    if let last = rows.last?.id {
                        pollAnchor = last
                        cursor = last
                    }
                    if page.hasMore != true { break pages }
                } else {
                    // Can't tell which server this is: an old one with more than a page of new
                    // messages, or a new one that sent no cursor. Walk back from the oldest message
                    // just received until the anchor shows up; that is right for both.
                    switch await closeGap(below: rows.first, anchor: cursor) {
                    case .closed: if let last = rows.last?.id { pollAnchor = last }
                    case .unreachable: break
                    case .tooFar: await restartFromNewest()
                    }
                    break pages
                }
            }
            if readFailed {
                readFailed = false
                markedReadId = nil
            }
            markReadIfNeeded()
        } catch APIError.unauthorized {
            auth.logout()
        } catch APIError.http(let code, _) where code == 400 || code == 404 {
            // The message asked after is gone, or `after` was refused outright: the newest page,
            // merged, is still right.
            await loadLatest()
        } catch {}
    }

    /// Walks back from `oldest` (the oldest message just received) until `anchor` (the newest one
    /// the thread already had) turns up, merging every page on the way.
    private func closeGap(below oldest: ChatMessage?, anchor: String) async -> ChatGapResult {
        var cursor = oldest?.createdAt
        var firstPage = true
        for _ in 0..<Self.maxCatchUpPages {
            guard let c = cursor else { return .unreachable }
            guard let page = try? await APIClient.shared.conversationMessagesPage(
                conversationId, before: c, limit: 100) else { return .unreachable }
            let rows = page.messages ?? []
            merge(rows)
            if let i = rows.firstIndex(where: { $0.id == anchor }) {
                // The anchor was the newest message just under what `after` returned: that answer
                // joined on exactly, so this server does understand `after`.
                if firstPage && i == rows.count - 1 { afterSupported = true }
                return .closed
            }
            if rows.isEmpty || page.hasMore == false { return .closed }
            firstPage = false
            cursor = page.nextCursor ?? rows.first?.createdAt
        }
        return .tooFar
    }

    /// Hundreds of messages arrived while the phone was away — more than is worth stitching. Start
    /// again from the newest page so what is on screen is at least continuous; older history is
    /// still one tap away at the top.
    private func restartFromNewest() async {
        guard let page = try? await APIClient.shared.conversationMessagesPage(conversationId) else { return }
        let rows = page.messages ?? []
        messages = rows
        hasOlder = page.hasMore ?? (rows.count >= Self.pageSize)
        olderCursor = page.nextCursor ?? rows.first?.createdAt
        pollAnchor = rows.last?.id
    }

    /// One page further back, kept in place on screen.
    private func loadOlder(_ proxy: ScrollViewProxy) async {
        guard !loadingOlder, let cursor = olderCursor ?? messages.first?.createdAt else { return }
        let keep = messages.first?.id
        loadingOlder = true
        defer { loadingOlder = false }
        do {
            let page = try await APIClient.shared.conversationMessagesPage(
                conversationId, before: cursor, limit: Self.pageSize)
            let rows = page.messages ?? []
            merge(rows)
            hasOlder = !rows.isEmpty && (page.hasMore ?? (rows.count >= Self.pageSize))
            if let next = page.nextCursor ?? rows.first?.createdAt { olderCursor = next }
            // Stay on the message that was at the top. Prepending leaves the scroll offset where it
            // was, which would slide the older page in under the finger.
            if let keep {
                proxy.scrollTo(keep, anchor: .top)
                // Again once the new rows have been laid out, which may be after this returns.
                Task { @MainActor in
                    try? await Task.sleep(for: .milliseconds(50))
                    proxy.scrollTo(keep, anchor: .top)
                }
            }
        } catch APIError.unauthorized {
            auth.logout()
        } catch {
            notice = (error as? LocalizedError)?.errorDescription ?? T("Couldn't load earlier messages.")
        }
    }

    /// Adds what is new, by id, and keeps the thread in time order. A message already on screen is
    /// left as it is.
    private func merge(_ incoming: [ChatMessage]) {
        guard !incoming.isEmpty else { return }
        var known = Set(messages.map(\.id))
        var added: [ChatMessage] = []
        for m in incoming where !known.contains(m.id) {
            known.insert(m.id)
            added.append(m)
        }
        guard !added.isEmpty else { return }
        messages = Self.chronological(messages + added)
    }

    /// Oldest first by `createdAt` (the server's ISO times sort as text), ties kept in arrival order.
    private static func chronological(_ list: [ChatMessage]) -> [ChatMessage] {
        list.enumerated().sorted { a, b in
            let ka = a.element.createdAt ?? ""
            let kb = b.element.createdAt ?? ""
            if ka != kb { return ka < kb }
            return a.offset < b.offset
        }.map(\.element)
    }

    /// Read on screen = read on the server: only while the end of the thread is in view and the app
    /// is in front, and only up to the last message actually shown. One request per new last
    /// message, however often the scroll position reports in.
    private func markReadIfNeeded() {
        guard scenePhase == .active, atBottom, let last = messages.last?.id, last != markedReadId else { return }
        markedReadId = last
        store.markedRead(conversationId)
        let id = conversationId
        Task {
            do {
                try await APIClient.shared.markConversationRead(id, upToMessageId: last)
            } catch {
                // Retried by the next poll, not on the next scroll frame.
                readFailed = true
            }
        }
    }

    private func send() async {
        let v = input.trimmingCharacters(in: .whitespaces)
        // A picture on its own is a message; text is only required when nothing is attached.
        guard !v.isEmpty || pendingAttachment != nil else { return }
        let mentionedUserIds = pendingMentions.compactMap { v.contains($0.value) ? $0.key : nil }
        let attachment = pendingAttachment
        let replyId = replyingTo?.id
        sending = true; notice = nil
        defer { sending = false }
        // The composer is cleared AFTER the server says yes. It used to be cleared before, with the
        // send behind `try?` — a 403, a 413 or a dead network made the message vanish with nothing
        // on screen, and the person walked away believing it was delivered.
        do {
            let sent = try await APIClient.shared.sendMessage(conversationId, content: v, mentionedUserIds: mentionedUserIds,
                                                              attachmentUrl: attachment?.url, attachmentType: attachment?.type,
                                                              replyToId: replyId)
            input = ""; pendingMentions = [:]; pendingAttachment = nil; replyingTo = nil
            await showSent(sent)
        } catch {
            notice = (error as? LocalizedError)?.errorDescription ?? T("Couldn't send. Your message is still here — try again.")
        }
    }

    /// Draws the message just sent at once, then fetches whatever else arrived — polling after the
    /// thread's own anchor, not after the new message, so nothing posted a moment earlier by
    /// somebody else is skipped.
    private func showSent(_ sent: ChatMessage?) async {
        if let sent { merge([sent]) }
        await pollNewer()
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
                conversationId: conversationId, fileName: "photo.jpg", mime: "image/jpeg", data: jpeg,
                progress: uploadProgress)
        } catch {
            notice = (error as? LocalizedError)?.errorDescription ?? T("Upload failed. Try again.")
        }
    }
    private func sendLocation() async {
        sending = true; notice = nil
        defer { sending = false }
        do {
            let fix = try await loc.currentFix()
            let text = "📍 " + T("My location") + ": https://www.google.com/maps?q=\(fix.latitude),\(fix.longitude)"
            let sent = try await APIClient.shared.sendMessage(conversationId, content: text)
            await showSent(sent)
        } catch LocationManager.LocationError.denied {
            deniedPermission = .location
        } catch {
            notice = (error as? LocalizedError)?.errorDescription ?? T("Couldn't send your location.")
        }
    }
    private func sendTaskLink(_ t: ChatTaskRef) async {
        sending = true; notice = nil
        defer { sending = false }
        do {
            let sent = try await APIClient.shared.sendMessage(conversationId, content: "📋 Task: \(t.title) [task:\(t.id)]")
            await showSent(sent)
        } catch {
            notice = (error as? LocalizedError)?.errorDescription ?? T("Couldn't send the task link.")
        }
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

/// What restarts a chat screen's polling loop: the app coming to the front or leaving it, and the
/// realtime connection coming up or going down (the pace changes with it).
private struct ChatPollPace: Equatable {
    let active: Bool
    let live: Bool
}
