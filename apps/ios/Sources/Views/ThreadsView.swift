import SwiftUI
import PhotosUI

// MARK: - models
//
// Shape taken from the web bundle (assets/threads-*.js): the page renders
// .author / .text / .createdAt / .images / .likeCount / .commentCount and
// pages through a `nextCursor`. Every field is optional so a rename degrades
// instead of failing the whole decode.

struct FeedPostsResponse: Decodable, Sendable {
    let posts: [FeedPost]?
    let items: [FeedPost]?
    let nextCursor: String?
    var all: [FeedPost] { posts ?? items ?? [] }
}

/// Hashable because `.navigationDestination(item:)` requires it (SwiftUI uses it as the path value).
///
/// NOTE: the body field is `text`, not `content`, and `images` is an array of OBJECTS
/// ({id,url,width,height,position}) — not URL strings. Both were wrong in the first cut, and because
/// a present-but-mistyped key makes Codable throw, the whole feed died with "Couldn't read data".
struct FeedPost: Decodable, Identifiable, Hashable, Sendable {
    let id: String
    let text: String?
    let createdAt: String?
    /// Set once the author changed the text (web PostCard "· edited").
    let editedAt: String?
    let author: Author?
    let images: [FeedImage]?
    /// `var` so a like can flip them in place: the heart is drawn from the post itself, which is
    /// what the server says on every load. It used to be drawn from a screen-local set that started
    /// empty, so a post you had liked came back grey after leaving Threads and opening it again
    /// (owner, 9 Oct 2026).
    var likeCount: Int?
    let commentCount: Int?
    var likedByMe: Bool?
    /// The server's answer to "may THIS viewer remove this post" — their own, or anyone's if they
    /// are BoD. Read rather than re-derived: the app does not know the viewer's role here, and
    /// guessing it is how a button appears that the route then refuses.
    let canDelete: Bool?

    struct Author: Decodable, Hashable, Sendable { let id: String?; let name: String?; let avatar: String? }

    var authorName: String { author?.name ?? "Someone" }
    var initial: String { String(authorName.first ?? "?").uppercased() }
    var likes: Int { likeCount ?? 0 }
    var comments: Int { commentCount ?? 0 }
    var photos: [String] { (images ?? []).compactMap(\.url) }
}

/// POST /api/feed/posts/[id]/like — the state after the toggle, recounted by the server.
struct FeedLikeResult: Decodable, Sendable {
    let liked: Bool
    let likeCount: Int
}

/// One person who can be @mentioned (GET /api/members).
struct MentionUser: Decodable, Identifiable, Hashable, Sendable {
    let id: String
    let name: String?
    let email: String?
    let avatar: String?
    var displayName: String { (name?.isEmpty == false ? name : nil) ?? email ?? "—" }
    var initial: String { String(displayName.first ?? "?").uppercased() }
    /// "@Nama" with the spaces taken out, so it stays one token `mentionText` can highlight — the
    /// same shape the chat composer inserts.
    var tag: String { "@" + displayName.replacingOccurrences(of: " ", with: "") }
}

/// The @mention typing rules shared by the Threads post and comment composers. Same rules as the
/// chat composer: SwiftUI's TextField hides the caret, so the token being typed is read from the
/// tail of the draft.
enum MentionDraft {
    /// The text after a word-opening "@" at the end of the draft, or nil when not in a mention.
    /// The "@" must start a word, otherwise every email address would open the picker.
    static func query(in text: String) -> String? {
        guard let at = text.lastIndex(of: "@") else { return nil }
        if at > text.startIndex {
            let before = text[text.index(before: at)]
            guard before == " " || before == "\n" else { return nil }
        }
        let tail = text[text.index(after: at)...]
        guard !tail.contains(" "), !tail.contains("\n") else { return nil }
        return String(tail)
    }

    static func matches(_ roster: [MentionUser], in text: String) -> [MentionUser] {
        guard let q = query(in: text) else { return [] }
        let hits = q.isEmpty ? roster : roster.filter { $0.displayName.localizedCaseInsensitiveContains(q) }
        return Array(hits.prefix(20))
    }

    /// Replaces the half-typed "@ali" (or appends) with the person's tag and remembers who it was.
    static func insert(_ u: MentionUser, into text: inout String, picked: inout [String: String]) {
        if query(in: text) != nil, let at = text.lastIndex(of: "@") {
            text.replaceSubrange(at..., with: u.tag + " ")
        } else {
            if !text.isEmpty && !text.hasSuffix(" ") && !text.hasSuffix("\n") { text += " " }
            text += u.tag + " "
        }
        picked[u.id] = u.tag
    }

    /// The ids to send: only people picked from the list whose tag is still in the text, so a tag
    /// deleted before sending notifies nobody.
    static func ids(in text: String, picked: [String: String]) -> [String] {
        picked.compactMap { text.contains($0.value) ? $0.key : nil }
    }
}

/// The row of people to tag, shown above a composer while an "@" is being typed.
struct MentionSuggestions: View {
    let matches: [MentionUser]
    let onPick: (MentionUser) -> Void

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(matches) { m in
                    Button { onPick(m) } label: {
                        HStack(spacing: 6) {
                            AvatarView(url: m.avatar, initial: m.initial, size: 22, userId: m.id, name: m.displayName)
                            Text(m.displayName).font(NXFont.text(12, .semibold))
                                .foregroundStyle(NX.foreground).lineLimit(1)
                        }
                        .padding(.horizontal, 8).padding(.vertical, 6)
                        .background(NX.muted, in: Capsule())
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }
}

struct FeedImage: Decodable, Hashable, Sendable {
    let id: String?
    let url: String?
    let width: Int?
    let height: Int?
}

struct FeedCommentsResponse: Decodable, Sendable {
    let comments: [FeedComment]?
    let items: [FeedComment]?
    var all: [FeedComment] { comments ?? items ?? [] }
}

struct FeedComment: Decodable, Identifiable, Sendable {
    let id: String
    let text: String?
    let createdAt: String?
    let author: FeedPost.Author?
    var authorName: String { author?.name ?? "Someone" }
    var initial: String { String(authorName.first ?? "?").uppercased() }
}

// MARK: - feed

/// Port of the web /threads page — the company feed. Posts, likes and comments.
struct ThreadsView: View {
    @Environment(AuthStore.self) private var auth
    /// The post a notification pointed at (`/threads?post=<id>`, a mention or a comment on yours).
    @Environment(AppRouter.self) private var router
    @Environment(\.horizontalSizeClass) private var hSize
    @State private var posts: [FeedPost] = []
    @State private var loading = true
    @State private var error: String?
    @State private var draft = ""
    @State private var posting = false
    /// JPEG bytes already downscaled, in the order they were picked — the route stores `position`
    /// from that order, so it is the order they appear in for everyone else too.
    @State private var photos: [Data] = []
    /// Pixel size per photo, positionally matched to `photos`. Sent so the feed can hold the right
    /// aspect ratio while an image loads instead of reflowing as each one arrives.
    @State private var photoSizes: [(w: Int, h: Int)?] = []
    @State private var picking: [PhotosPickerItem] = []
    @State private var showLibrary = false
    /// Mirrors IMG_MAX in src/lib/feed.ts. Enforced here too so the fifth photo is refused before
    /// it is uploaded rather than after.
    private static let maxPhotos = 4
    /// Everyone who can be tagged, and who was picked for the draft (userId → "@Tag").
    @State private var roster: [MentionUser] = []
    @State private var pickedMentions: [String: String] = [:]
    @State private var openPost: FeedPost?
    /// Held rather than deleted on the spot: removing somebody's post in front of everyone is not a
    /// thing to do on one accidental tap.
    @State private var confirmingDelete: FeedPost?
    @State private var viewingPhoto: PhotoRef?
    /// Your photo beside the composer (web). The Keychain session has none: fetched once.
    @State private var myAvatar: String?
    /// All | Mentions, as on the web (UI tour 13 Oct 2026: the app had no way to see only the posts
    /// that tag you). Mentions asks the server for `&mentions=me`.
    @State private var tab: FeedTab = .all
    enum FeedTab: Hashable { case all, mentions }
    private var tabItems: [NXTabItem<FeedTab>] {
        [NXTabItem(id: .all, label: T("All")), NXTabItem(id: .mentions, label: T("Mentions"))]
    }

    /// The sidebar's Threads page on an iPad or Mac: the web's page header instead of the nav bar.
    private var isRoot: Bool { NXSidebarPage.isRoot(.threads, hSize: hSize, router: router) }

    var body: some View {
        VStack(spacing: 0) {
            // On the iPad / Mac page the tabs sit in the header.
            if !isRoot {
                NXUnderlineTabs(items: tabItems, selection: $tab, accessibilityName: T("Threads"))
            }
            ZStack {
                NX.background.ignoresSafeArea()
                content
            }
        }
        .background(NX.background.ignoresSafeArea())
        .nxSidebarPageChrome(isRoot, phoneSubtitle: T("Short updates from the team. Tag someone with @ and they get notified.")) {
            VStack(spacing: 0) {
                NXPageHeader(title: T("Threads"), subtitle: T("Short updates from the team. Tag someone with @ and they get notified."))
                NXPageTabsRow(items: tabItems, selection: $tab, accessibilityName: T("Threads"))
            }
        }
        .onChange(of: tab) { _, _ in Task { await load() } }
        .navigationTitle(T("Threads"))
        .navigationBarTitleDisplayMode(.inline)
        .task { await load(); claimFocus(); await loadRoster() }
        .task(id: auth.session?.userId) { myAvatar = try? await APIClient.shared.profile().user.avatar }
        .onChange(of: router.focus) { _, _ in if !loading { claimFocus() } }
        .navigationDestination(item: $openPost) { p in PostThreadView(post: p) }
        .fullScreenCover(item: $viewingPhoto) { PhotoViewer(photo: $0) }
        .alert(T("Delete this post?"), isPresented: Binding(
            get: { confirmingDelete != nil },
            set: { if !$0 { confirmingDelete = nil } }
        )) {
            Button(T("Delete"), role: .destructive) {
                if let p = confirmingDelete { Task { await remove(p) } }
            }
            Button(T("Cancel"), role: .cancel) { confirmingDelete = nil }
        } message: {
            Text(T("It disappears from the feed for everyone."))
        }
    }

    @ViewBuilder private var content: some View {
        if loading {
            SkeletonList()
        } else if let error {
            ErrorState(message: error) { Task { await load() } }
        } else {
            ScrollView {
                // Web feed: ONE hairline card, the composer on top and every post a row under it,
                // split by hairlines (UI tour run 5: the app drew a card per post).
                LazyVStack(spacing: 0) {
                    if tab == .all { composer }
                    if posts.isEmpty, tab == .mentions {
                        EmptyState(icon: "at", title: T("No mentions yet"),
                                   subtitle: T("When someone tags you, it shows up here."), compact: true)
                            .padding(.vertical, 12)
                    } else if posts.isEmpty {
                        EmptyState(icon: "bubble.left.and.text.bubble.right", title: T("Nothing on the feed yet"),
                                   subtitle: T("Threads is the company feed: wins, photos, questions for everyone. Write the first post in the box above and it appears here for the whole office."),
                                   compact: true)
                            .padding(.vertical, 12)
                    } else {
                        ForEach(posts) { p in postCard(p) }
                    }
                }
                .background(NX.card, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(NX.border))
                // The page's full width, so the feed ends on the same right edge as its header and every other
                // page (UI tour run 15, Q-M21: a 900 pt cap stopped it ~85 px short on the Mac).
                .frame(maxWidth: .infinity)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, NXSidebarPage.gutter(isRoot))
                .padding(.vertical, isRoot ? 24 : 16)
            }
            .refreshable { await load() }
        }
    }

    private var composer: some View {
        VStack(alignment: .leading, spacing: 8) {
            // Web Composer: your photo, then a borderless field.
            HStack(alignment: .top, spacing: 12) {
                let me = auth.session.map { $0.userName.isEmpty ? $0.userEmail : $0.userName } ?? ""
                AvatarView(url: myAvatar, initial: String(me.first ?? "?").uppercased(), size: 40, userId: Keychain.load()?.userId, name: me)
                TextField(T("What's new?"), text: $draft, axis: .vertical)
                    .font(NXFont.text(15)).lineLimit(2...6)
                    .padding(.vertical, 8)
            }
            let tagMatches = MentionDraft.matches(roster, in: draft)
            if !tagMatches.isEmpty {
                MentionSuggestions(matches: tagMatches) { MentionDraft.insert($0, into: &draft, picked: &pickedMentions) }
            }
            if !photos.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach(photos.indices, id: \.self) { i in
                            ZStack(alignment: .topTrailing) {
                                if let ui = UIImage(data: photos[i]) {
                                    Image(uiImage: ui).resizable().scaledToFill()
                                        .frame(width: 74, height: 74)
                                        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                                }
                                Button {
                                    photos.remove(at: i)
                                    if i < photoSizes.count { photoSizes.remove(at: i) }
                                } label: {
                                    Image(systemName: "xmark.circle.fill")
                                        .font(.system(size: 17))
                                        .symbolRenderingMode(.palette)
                                        .foregroundStyle(.white, .black.opacity(0.55))
                                }
                                .buttonStyle(.plain).padding(3)
                            }
                        }
                    }
                    .padding(.vertical, 2)
                }
            }
            Divider().overlay(NX.border)
            HStack(spacing: 10) {
                // Web: "Photo" as a labelled button, with the count once there are any.
                Button { showLibrary = true } label: {
                    HStack(spacing: 6) {
                        Image(systemName: "photo").font(.system(size: 14, weight: .semibold))
                        Text(photos.isEmpty ? T("Photo") : "\(T("Photo")) (\(photos.count)/\(Self.maxPhotos))")
                            .font(NXFont.text(14, .semibold))
                    }
                    .foregroundStyle(NX.foreground)
                    .padding(.horizontal, 8).frame(minHeight: 36).contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .hoverEffect(.highlight)
                .padding(.leading, -8)
                .disabled(posting || photos.count >= Self.maxPhotos)
                Spacer()
                Button { Task { await post() } } label: {
                    HStack(spacing: 6) {
                        if posting { ProgressView().scaleEffect(0.7).tint(NX.background) } else {
                            Image(systemName: "paperplane").font(.system(size: 13, weight: .semibold))
                        }
                        Text(T("Post"))
                    }
                    // Near-black like the web's primary (it was a violet capsule).
                    .font(NXFont.text(14, .semibold)).foregroundStyle(NX.background)
                    .padding(.horizontal, 16).padding(.vertical, 8)
                    .background(NX.onyx, in: Capsule())
                }
                .buttonStyle(.plain)
                // A photo alone is a post. The route refuses only when text AND images are both
                // empty, and a picture with nothing to say is the commonest thing on this screen.
                // .disabled alone: a plain-style Button already dims when disabled, and the extra
                // .opacity(0.5) on top left "Post" all but invisible (UI tour run 5).
                .disabled(posting || !canPost)
            }
        }
        .padding(.horizontal, 16).padding(.vertical, 12)
        .overlay(alignment: .bottom) { Rectangle().fill(NX.border).frame(height: 1) }
        // Presented from the view, not from inside a Menu: a PhotosPicker nested in a Menu draws its
        // row and never opens, because the menu tears down its content as it dismisses.
        .photosPicker(isPresented: $showLibrary, selection: $picking,
                      maxSelectionCount: max(1, Self.maxPhotos - photos.count),
                      matching: .images, photoLibrary: .shared())
        .onChange(of: picking) { _, items in
            guard !items.isEmpty else { return }
            Task { await absorb(items) }
        }
    }

    private var canPost: Bool {
        !draft.trimmingCharacters(in: .whitespaces).isEmpty || !photos.isEmpty
    }

    /// Shrunk on the way in, not on the way out: `GideonPanel.shrink` is the same downscaler the
    /// ticket composer uses, and a modern iPhone photo is well past the route's 8MB ceiling
    /// untouched. Measuring here also gets the size from the image that will actually be sent.
    private func absorb(_ items: [PhotosPickerItem]) async {
        var lost = 0
        for item in items {
            guard photos.count < Self.maxPhotos else { break }
            if let data = try? await item.loadTransferable(type: Data.self) {
                let shrunk = GideonPanel.shrink(data)
                photos.append(shrunk)
                if let ui = UIImage(data: shrunk) {
                    photoSizes.append((w: Int(ui.size.width * ui.scale), h: Int(ui.size.height * ui.scale)))
                } else {
                    photoSizes.append(nil)
                }
            } else {
                // A pick the library could not hand over — one still in iCloud, or one it cannot
                // decode. Counted rather than dropped silently: five of these read as a broken picker.
                lost += 1
            }
        }
        if lost > 0 { error = T("Couldn't read that photo.") }
        picking = []
    }

    /// "now", "5m ago", "3h ago", "6d ago", then the date ("30 Jun"): a relative time reads as one next to
    /// a date (UI tour run 13, F-36 / W-B9: "6d" beside "30 Jun").
    private static func timeAgo(_ iso: String) -> String? {
        guard let d = ProjDate.parse(iso) else { return nil }
        let secs = Int(Date().timeIntervalSince(d))
        if secs < 60 { return T("now") }
        let m = secs / 60; if m < 60 { return String(format: T("%dm ago"), m) }
        let h = m / 60; if h < 24 { return String(format: T("%dh ago"), h) }
        let days = h / 24; if days < 7 { return String(format: T("%dd ago"), days) }
        return ProjDate.dayLabel(d)
    }

    /// One post as a row of the feed card, laid out like the web's PostCard: the photo on the left,
    /// "Name · 5d · edited" on one line, the text and photos under the name, then like · comment.
    private func postCard(_ p: FeedPost) -> some View {
        HStack(alignment: .top, spacing: 12) {
            AvatarView(url: p.author?.avatar, initial: p.initial, size: 40, userId: p.author?.id, name: p.authorName)
            VStack(alignment: .leading, spacing: 4) {
                HStack(alignment: .firstTextBaseline, spacing: 5) {
                    Text(p.authorName).font(NXFont.text(15, .bold)).foregroundStyle(NX.foreground).lineLimit(1)
                        .layoutPriority(1)
                    let edited = (p.editedAt?.isEmpty == false) ? T("edited") : nil
                    let meta = [p.createdAt.flatMap { Self.timeAgo($0) }, edited].compactMap { $0 }
                    if !meta.isEmpty {
                        Text("· " + meta.joined(separator: " · ")).font(NXFont.text(14)).foregroundStyle(NX.mutedFg).lineLimit(1)
                    }
                    Spacer(minLength: 0)
                    if p.canDelete == true {
                        Button { confirmingDelete = p } label: {
                            Image(systemName: "ellipsis")
                                .font(.system(size: 15, weight: .semibold))
                                .foregroundStyle(NX.mutedFg)
                                // 44x44 target around a small glyph, pulled back into the row's padding.
                                .frame(width: 44, height: 44)
                                .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel(T("More options"))
                        .padding(.trailing, -12)
                        .padding(.vertical, -14)
                    }
                }
                if let c = p.text, !c.isEmpty {
                    mentionText(c).font(NXFont.text(15)).foregroundStyle(NX.foreground)
                        .fixedSize(horizontal: false, vertical: true)
                }
                if !p.photos.isEmpty {
                    FeedPhotoStrip(photos: p.photos) { viewingPhoto = $0 }.padding(.top, 4)
                }
                HStack(spacing: 16) {
                    Button { Task { await like(p) } } label: {
                        let on = p.likedByMe == true
                        // Icon and count in one centred row: a Label with an empty title sat ~3 pt lower than one
                        // with a count, so a row's heart and bubble did not line up (UI tour run 17, iPhone R17-I-19).
                        ThreadActionLabel(count: p.likes, icon: on ? "heart.fill" : "heart")
                            .foregroundStyle(on ? NX.danger : NX.mutedFg)
                            .contentTransition(.numericText())
                            .frame(minHeight: 32).contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    Button { openPost = p } label: {
                        ThreadActionLabel(count: p.comments, icon: "message")
                            .foregroundStyle(NX.mutedFg)
                            .frame(minHeight: 32).contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    Spacer()
                }
                .padding(.top, 2)
            }
        }
        .padding(.horizontal, 16).padding(.vertical, 12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .overlay(alignment: .bottom) { Rectangle().fill(NX.border).frame(height: 1) }
        // The post itself opens its thread; the like / comment / menu buttons take their own taps.
        .contentShape(Rectangle())
        .onTapGesture { openPost = p }
    }

    private func claimFocus() {
        guard case .post(let id) = router.focus else { return }
        router.focus = nil
        if let p = posts.first(where: { $0.id == id }) { openPost = p }
    }

    private func load() async {
        error = nil
        let asked = tab
        do {
            let fresh = try await APIClient.shared.feedPosts(mentionsMe: asked == .mentions)
            // A tab switched while this was loading: the newer load owns the list.
            guard asked == tab else { return }
            posts = fresh
        }
        catch APIError.unauthorized { auth.logout() }
        catch { self.error = (error as? LocalizedError)?.errorDescription ?? T("Couldn't load the feed.") }
        loading = false
    }
    private func post() async {
        let v = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !v.isEmpty || !photos.isEmpty else { return }
        posting = true
        defer { posting = false }
        do {
            try await APIClient.shared.createPost(text: v, mentions: MentionDraft.ids(in: v, picked: pickedMentions),
                                                  images: photos, imageMeta: photoSizes)
            draft = ""
            pickedMentions = [:]
            photos = []
            photoSizes = []
            await load()
        } catch {
            self.error = (error as? LocalizedError)?.errorDescription ?? T("Couldn't post.")
        }
    }
    private func remove(_ p: FeedPost) async {
        confirmingDelete = nil
        // Removed from the list first so the tap answers immediately, then reloaded from the server
        // — which is also what puts it back if the delete was refused.
        posts.removeAll { $0.id == p.id }
        do {
            try await APIClient.shared.deletePost(p.id)
        } catch {
            self.error = (error as? LocalizedError)?.errorDescription ?? T("Couldn't delete that post.")
        }
        await load()
    }

    /// Like X: the heart and the count flip on the tap, then the server's `{liked, likeCount}`
    /// replaces the guess — it recounts from the like rows, so it is also right when someone else
    /// liked in between.
    private func like(_ p: FeedPost) async {
        Haptics.tap()
        guard let i = posts.firstIndex(where: { $0.id == p.id }) else { return }
        let before = (liked: posts[i].likedByMe, count: posts[i].likeCount)
        let nowLiked = posts[i].likedByMe != true
        withAnimation(.snappy(duration: 0.2)) {
            posts[i].likedByMe = nowLiked
            posts[i].likeCount = max(0, posts[i].likes + (nowLiked ? 1 : -1))
        }
        do {
            let r = try await APIClient.shared.likePost(p.id)
            // Looked up again: a reload while the request was out may have rebuilt the list.
            if let j = posts.firstIndex(where: { $0.id == p.id }) {
                posts[j].likedByMe = r.liked
                posts[j].likeCount = r.likeCount
            }
        } catch {
            // Optimistic, so put it back: a heart that stays lit after the server said no is a lie
            // the next refresh quietly corrects, and the person never learns why.
            if let j = posts.firstIndex(where: { $0.id == p.id }) {
                posts[j].likedByMe = before.liked
                posts[j].likeCount = before.count
            }
        }
    }

    private func loadRoster() async {
        guard roster.isEmpty else { return }
        roster = await Self.mentionRoster(excluding: auth.session?.userId)
    }

    /// The cached roster first (instant), then the network. Yourself left out: the route drops a
    /// self-mention anyway.
    static func mentionRoster(excluding me: String?) async -> [MentionUser] {
        let all = (try? await APIClient.shared.mentionRoster())
            ?? ResponseCache.decoded("mention-roster", as: [MentionUser].self)?.value ?? []
        return all.filter { $0.id != me }
            .sorted { $0.displayName.localizedCaseInsensitiveCompare($1.displayName) == .orderedAscending }
    }
}

// MARK: - photos

/// A post's pictures, drawn the same on the feed card and inside the thread it opens. One strip
/// rather than two: a photograph that changed size, shape or tap behaviour depending on which
/// screen you reached it from would read as two different pictures.
///
/// A Button and not a tap gesture on the tile: on the feed the whole card is one tap target, and a
/// button sits deeper in the hierarchy — the same reason the like and comment buttons still take
/// their own taps instead of opening the thread. Same viewer as ticket evidence and attendance
/// documents, so a photograph enlarges the same way wherever it is drawn.
private struct FeedPhotoStrip: View {
    let photos: [String]
    let onOpen: (PhotoRef) -> Void

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(photos, id: \.self) { u in
                    let url = URL(string: u.hasPrefix("http") ? u : Config.baseURL.absoluteString + u)
                    Button { if let url { onOpen(PhotoRef(url: url, name: nil)) } } label: {
                        CachedImage(url: url) {
                            $0.resizable().scaledToFill()
                        } placeholder: { NX.muted }
                        .frame(width: 160, height: 160)
                        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }
}

// MARK: - one thread (post + comments)

struct PostThreadView: View {
    let post: FeedPost
    @Environment(AuthStore.self) private var auth
    @State private var comments: [FeedComment] = []
    @State private var loading = true
    @State private var draft = ""
    @State private var sending = false
    @State private var sendError: String?
    @State private var viewingPhoto: PhotoRef?
    @FocusState private var replying: Bool
    @State private var roster: [MentionUser] = []
    @State private var pickedMentions: [String: String] = [:]

    var body: some View {
        VStack(spacing: 0) {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    VStack(alignment: .leading, spacing: 8) {
                        HStack(spacing: 10) {
                            AvatarView(url: post.author?.avatar, initial: post.initial, size: 34, userId: post.author?.id, name: post.authorName)
                            VStack(alignment: .leading, spacing: 1) {
                                Text(post.authorName).font(NXFont.text(14, .bold)).foregroundStyle(NX.foreground)
                                if let d = ProjDate.parse(post.createdAt) {
                                    Text(ProjDate.dayLabel(d)).font(NXFont.text(11)).foregroundStyle(NX.mutedFg)
                                }
                            }
                            Spacer(minLength: 0)
                        }
                        if let c = post.text, !c.isEmpty {
                            mentionText(c).font(NXFont.text(15)).foregroundStyle(NX.foreground)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                        // The pictures come with the post the feed handed over — nothing here asks
                        // the server for them, because there is nothing to ask: /api/feed/posts/[id]
                        // answers DELETE and PATCH only, and the comments route returns comments.
                        if !post.photos.isEmpty {
                            FeedPhotoStrip(photos: post.photos) { ref in
                                // The reply box below can be holding the keyboard, and a cover
                                // raised underneath it comes up with the keyboard still on top.
                                replying = false
                                viewingPhoto = ref
                            }
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .nexusCard()

                    SectionLabel(T("Comments"))
                    if loading {
                        ProgressView().tint(NX.violetText).frame(maxWidth: .infinity).padding(.vertical, 20)
                    } else if comments.isEmpty {
                        Text(T("No comments yet.")).font(NXFont.text(13)).foregroundStyle(NX.mutedFg)
                    } else {
                        ForEach(comments) { c in commentRow(c) }
                    }
                }
                .padding(16)
            }

            let tagMatches = MentionDraft.matches(roster, in: draft)
            if !tagMatches.isEmpty {
                MentionSuggestions(matches: tagMatches) { MentionDraft.insert($0, into: &draft, picked: &pickedMentions) }
                    .padding(.horizontal, 12).padding(.top, 8)
                    .background(NX.card)
            }
            HStack(alignment: .bottom, spacing: 8) {
                TextField(T("Reply… (@ to mention)"), text: $draft, axis: .vertical)
                    .font(NXFont.text(15)).lineLimit(1...4)
                    .focused($replying)
                    .padding(.horizontal, 14).padding(.vertical, 10)
                    .background(NX.muted, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                Button { Task { await send() } } label: {
                    Image(systemName: sending ? "ellipsis" : "paperplane.fill")
                        .font(.system(size: 16, weight: .bold)).foregroundStyle(.white)
                        .frame(width: 40, height: 40).background(NX.onyx, in: Circle())
                }
                .disabled(sending || draft.trimmingCharacters(in: .whitespaces).isEmpty)
            }
            .padding(12)
            .background(NX.card)
            .overlay(Rectangle().fill(NX.border).frame(height: 1), alignment: .top)
        }
        .background(NX.background.ignoresSafeArea())
        .navigationTitle(T("Thread"))
        .navigationBarTitleDisplayMode(.inline)
        .task {
            await load()
            if roster.isEmpty { roster = await ThreadsView.mentionRoster(excluding: auth.session?.userId) }
        }
        .alert(T("Couldn't post"), isPresented: Binding(get: { sendError != nil }, set: { if !$0 { sendError = nil } })) {
            Button("OK") { sendError = nil }
        } message: { Text(sendError ?? "") }
        .fullScreenCover(item: $viewingPhoto) { PhotoViewer(photo: $0) }
    }

    private func commentRow(_ c: FeedComment) -> some View {
        HStack(alignment: .top, spacing: 10) {
            AvatarView(url: c.author?.avatar, initial: c.initial, size: 28, userId: c.author?.id, name: c.author?.name)
            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 6) {
                    Text(c.authorName).font(NXFont.text(13, .bold)).foregroundStyle(NX.foreground)
                    Spacer(minLength: 0)
                    if let d = ProjDate.parse(c.createdAt) {
                        Text(ProjDate.dayLabel(d)).font(NXFont.text(10)).foregroundStyle(NX.mutedFg)
                    }
                }
                mentionText(c.text ?? "").font(NXFont.text(13)).foregroundStyle(NX.foreground.opacity(0.9))
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(11)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(NX.muted.opacity(0.45), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
    }

    private func load() async {
        do { comments = try await APIClient.shared.postComments(post.id) }
        catch APIError.unauthorized { auth.logout() }
        catch { comments = [] }
        loading = false
    }
    private func send() async {
        let v = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !v.isEmpty else { return }
        sending = true
        defer { sending = false }
        do {
            _ = try await APIClient.shared.addPostComment(postId: post.id, text: v,
                                                          mentions: MentionDraft.ids(in: v, picked: pickedMentions))
            draft = ""
            pickedMentions = [:]
            await load()
        } catch {
            sendError = (error as? LocalizedError)?.errorDescription ?? T("Couldn't post the comment. It's still in the box.")
        }
    }
}

/// Highlights @mention tokens. Concatenates `Text` so the paragraph still wraps as one block —
/// same approach (and same `foregroundColor` caveat) as the chat bubbles.
func mentionText(_ s: String) -> Text {
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

/// A post's like / comment button face: the icon in a fixed box, then the count when there is one.
private struct ThreadActionLabel: View {
    let count: Int
    let icon: String
    var body: some View {
        HStack(alignment: .center, spacing: 5) {
            Image(systemName: icon).font(.system(size: 14, weight: .medium)).frame(width: 18, height: 18)
            if count > 0 { Text("\(count)").font(NXFont.text(13, .medium)).monospacedDigit() }
        }
    }
}
