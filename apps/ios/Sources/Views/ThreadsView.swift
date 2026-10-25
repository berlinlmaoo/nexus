import SwiftUI
import PhotosUI

// MARK: - models
//
// Shape of /api/feed/posts (src/lib/feed.ts serializePost). Every field is optional so a rename
// degrades instead of failing the whole decode.

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
    /// The people the post tags, with their names: "@QA Dev 6" is highlighted whole from these
    /// (names have spaces, so a one-word match would light up "@QA" only).
    let mentions: [FeedMention]?
    /// `var` so a like can flip them in place: the heart is drawn from the post itself, which is
    /// what the server says on every load (owner, 9 Oct 2026).
    var likeCount: Int?
    var commentCount: Int?
    var likedByMe: Bool?
    /// The server's answer to "may THIS viewer remove this post" — their own, or anyone's if they
    /// are BoD. Read rather than re-derived, so nobody sees a button the route would refuse.
    let canDelete: Bool?
    /// Author only. The route also refuses edits after 15 minutes and says so.
    let canEdit: Bool?

    struct Author: Decodable, Hashable, Sendable { let id: String?; let name: String?; let avatar: String? }

    var authorName: String { author?.name ?? "Someone" }
    var initial: String { String(authorName.first ?? "?").uppercased() }
    var likes: Int { likeCount ?? 0 }
    var comments: Int { commentCount ?? 0 }
    var mentionNames: [String] { (mentions ?? []).compactMap(\.name) }
}

struct FeedMention: Decodable, Hashable, Sendable {
    let userId: String?
    let name: String?
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
    /// "@Full Name", spaces kept: the same text the web composer inserts, so the post reads the same
    /// on every platform and the whole name is highlighted from the post's `mentions`.
    var tag: String { "@" + displayName }
}

/// The @mention typing rules shared by the Threads post, reply and edit fields. SwiftUI's TextField
/// hides the caret, so the token being typed is read from the tail of the draft.
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

/// The row of people to tag, shown under a field while an "@" is being typed.
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

    /// width / height from the server, so the box is reserved before the picture arrives. 4:5 when
    /// the upload had no size (the web's fallback too).
    var ratio: CGFloat {
        guard let w = width, let h = height, w > 0, h > 0 else { return 4.0 / 5.0 }
        return CGFloat(w) / CGFloat(h)
    }
    var resolvedURL: URL? {
        guard let u = url else { return nil }
        return URL(string: u.hasPrefix("http") ? u : Config.baseURL.absoluteString + u)
    }
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

/// What the feed pushes: a post (or only its id, from a notification) and whether the reply field
/// should take the keyboard straight away (the Reply icon).
struct ThreadOpen: Hashable, Identifiable {
    let id: String
    var post: FeedPost?
    var reply: Bool = false
}

// MARK: - shared look (nexus-qa/threads-ref/SPEC.md)

enum ThreadsStyle {
    /// Post side padding: 16 on a phone, 24 in the iPad / Mac column.
    static func rowX(_ wide: Bool) -> CGFloat { wide ? 24 : 16 }
    /// The liked heart (web rose-500 / rose-400).
    static let rose = Color(light: 0xf43f5e, dark: 0xfb7185)
    /// The column is never wider than this (Threads' 640).
    static let columnWidth: CGFloat = 640
    /// POST_TEXT_MAX in src/lib/feed.ts; the ring shows from 220.
    static let textMax = 280

    /// "now", "5m ago", "3h ago", "6d ago", then the date ("30 Jun"): one rule on every platform
    /// (UI tour run 13, F-36 / W-B9).
    static func timeAgo(_ iso: String?) -> String? {
        guard let iso, let d = ProjDate.parse(iso) else { return nil }
        let secs = Int(Date().timeIntervalSince(d))
        if secs < 60 { return T("now") }
        let m = secs / 60; if m < 60 { return String(format: T("%dm ago"), m) }
        let h = m / 60; if h < 24 { return String(format: T("%dh ago"), h) }
        let days = h / 24; if days < 7 { return String(format: T("%dd ago"), days) }
        return ProjDate.dayLabel(d)
    }

    static func repliesLabel(_ n: Int) -> String {
        n == 1 ? T("1 reply") : String(format: T("%d replies"), n)
    }

    /// The link a notification opens: `<origin>/threads?post=<id>`.
    static func link(_ postId: String) -> String {
        var c = URLComponents(url: Config.baseURL, resolvingAgainstBaseURL: false)
        c?.path = "/threads"
        c?.queryItems = [URLQueryItem(name: "post", value: postId)]
        return c?.url?.absoluteString ?? Config.baseURL.absoluteString + "/threads?post=" + postId
    }
}

/// The feed's one column: on an iPad or Mac a card at most 640 wide, centred, with 28 pt corners; on a
/// phone edge to edge with no card (Threads' own phone layout).
struct ThreadsColumn: ViewModifier {
    let wide: Bool

    func body(content: Content) -> some View {
        if wide {
            content
                .background(NX.card)
                .clipShape(RoundedRectangle(cornerRadius: 28, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 28, style: .continuous).strokeBorder(NX.border))
                .frame(maxWidth: ThreadsStyle.columnWidth)
                .frame(maxWidth: .infinity)
                .padding(.horizontal, 16)
                .padding(.vertical, 24)
        } else {
            content.background(NX.background)
        }
    }
}

/// Text with @mentions in the accent colour, weight 500. `names` are the people the text can tag
/// (the post's mentions, or every member for a reply): "@QA Dev 6" is matched whole, longest name
/// first; anything else after an "@" is highlighted up to the end of the word. Same rule as the web's
/// RenderText.
func mentionText(_ s: String, names: [String] = []) -> Text {
    var out = AttributedString()
    let known = Array(Set(names.filter { !$0.trimmingCharacters(in: .whitespaces).isEmpty }))
        .sorted { $0.count > $1.count }
    let word = "@[\\p{L}\\p{N}._-]+"
    let pattern = known.isEmpty
        ? word
        : "@(?:" + known.map { NSRegularExpression.escapedPattern(for: $0) }.joined(separator: "|") + ")(?![\\p{L}\\p{N}])|" + word
    guard let re = try? NSRegularExpression(pattern: pattern) else { return Text(s) }
    let ns = s as NSString
    var cursor = 0
    for m in re.matches(in: s, range: NSRange(location: 0, length: ns.length)) {
        if m.range.location > cursor {
            out += AttributedString(ns.substring(with: NSRange(location: cursor, length: m.range.location - cursor)))
        }
        var tag = AttributedString(ns.substring(with: m.range))
        tag.foregroundColor = NX.accentFg
        tag.font = NXFont.text(15, .medium)
        out += tag
        cursor = m.range.location + m.range.length
    }
    if cursor < ns.length { out += AttributedString(ns.substring(from: cursor)) }
    return Text(out)
}

/// The Post button of the composer and the reply box: outlined with faint text while there is
/// nothing to send, the filled primary once there is.
struct ThreadsPostButton: View {
    let ready: Bool
    var busy = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            ZStack {
                Text(T("Post")).opacity(busy ? 0 : 1)
                if busy { ProgressView().controlSize(.small).tint(NX.background) }
            }
            .font(NXFont.text(15, .semibold))
            .foregroundStyle(ready ? NX.background : NX.foreground.opacity(0.4))
            .padding(.horizontal, 16)
            .frame(height: 36)
            .background(ready ? NX.onyx : Color.clear, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
            .overlay {
                if !ready { RoundedRectangle(cornerRadius: 10, style: .continuous).strokeBorder(NX.border) }
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(!ready || busy)
    }
}

/// Press feedback of the action pills: a soft round fill and a slight shrink.
private struct ThreadsPillStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .background(configuration.isPressed ? NX.muted : Color.clear, in: Capsule())
            .scaleEffect(configuration.isPressed ? 0.92 : 1)
            .animation(.easeOut(duration: 0.15), value: configuration.isPressed)
    }
}

/// Like · Reply · Copy link. The row is pulled 12 pt left so the first icon lines up with the text.
struct ThreadsActionRow: View {
    let post: FeedPost
    let onLike: () -> Void
    let onReply: () -> Void
    let onCopy: () -> Void

    var body: some View {
        let liked = post.likedByMe == true
        HStack(spacing: 0) {
            Button(action: onLike) {
                pill(icon: liked ? "heart.fill" : "heart", count: post.likes)
                    .foregroundStyle(liked ? ThreadsStyle.rose : NX.foreground.opacity(0.75))
                    .symbolEffect(.bounce, value: liked)
            }
            .buttonStyle(ThreadsPillStyle())
            .accessibilityLabel(liked ? T("Unlike") : T("Like"))
            Button(action: onReply) {
                pill(icon: "bubble.right", count: post.comments).foregroundStyle(NX.foreground.opacity(0.75))
            }
            .buttonStyle(ThreadsPillStyle())
            .accessibilityLabel(T("Reply"))
            Button(action: onCopy) {
                pill(icon: "paperplane", count: 0).foregroundStyle(NX.foreground.opacity(0.75))
            }
            .buttonStyle(ThreadsPillStyle())
            .accessibilityLabel(T("Copy link"))
            Spacer(minLength: 0)
        }
        .padding(.leading, -12)
    }

    private func pill(icon: String, count: Int) -> some View {
        HStack(spacing: 4) {
            Image(systemName: icon).font(.system(size: 18, weight: .regular)).frame(width: 22, height: 22)
            if count > 0 {
                Text("\(count)").font(NXFont.text(13)).monospacedDigit()
                    .contentTransition(.numericText())
            }
        }
        .padding(.horizontal, 12)
        .frame(height: 44)
        .contentShape(Capsule())
    }
}

/// Name · time · edited and the ⋯ menu. The name wraps to two lines, then ends in "…"; the time never
/// wraps. The menu's 44 pt target hangs over the 21 pt line so the row never grows.
struct ThreadsNameRow<Trailing: View>: View {
    let name: String
    let time: String?
    var edited = false
    @ViewBuilder var menu: () -> Trailing

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Text(name).font(NXFont.text(15, .semibold)).foregroundStyle(NX.foreground)
                .lineLimit(2).truncationMode(.tail)
            if let time {
                Text(time).font(NXFont.text(15)).foregroundStyle(NX.mutedFg).lineLimit(1).fixedSize()
            }
            if edited {
                Text("· " + T("edited")).font(NXFont.text(15)).foregroundStyle(NX.mutedFg).lineLimit(1).fixedSize()
            }
            Spacer(minLength: 0)
            menu()
        }
    }
}

/// ⋯ → Copy link / Edit / Delete. Delete only raises the parent's centred alert; nothing is removed
/// from the menu itself.
struct ThreadsPostMenu: View {
    let post: FeedPost
    let onCopy: () -> Void
    let onEdit: () -> Void
    let onDelete: () -> Void

    var body: some View {
        Menu {
            Button(action: onCopy) { Label(T("Copy link"), systemImage: "link") }
            if post.canEdit == true {
                Button(action: onEdit) { Label(T("Edit"), systemImage: "pencil") }
            }
            if post.canDelete == true {
                Divider()
                Button(role: .destructive, action: onDelete) { Label(T("Delete"), systemImage: "trash") }
            }
        } label: {
            Image(systemName: "ellipsis")
                .font(.system(size: 17, weight: .medium))
                .foregroundStyle(NX.mutedFg)
                .frame(width: 44, height: 44)
                .contentShape(Rectangle())
        }
        .accessibilityLabel(T("More options"))
        // 44 × 44 around the glyph, pulled back into the row's padding and over the line above/below.
        .padding(.trailing, -12)
        .padding(.vertical, -12)
    }
}

/// A post's photos. One photo at its own shape, up to 430 pt tall and never wider than the text
/// column; two or more as a sideways row of equal-height tiles that runs to the post's right edge.
/// Buttons, not tap gestures: the row around them opens the post, and a button wins over that.
struct ThreadsMedia: View {
    let images: [FeedImage]
    let wide: Bool
    let onOpen: (PhotoRef) -> Void
    @State private var columnWidth: CGFloat = 0

    var body: some View {
        if images.count == 1, let im = images.first {
            single(im)
        } else {
            strip
        }
    }

    private func single(_ im: FeedImage) -> some View {
        let r = im.ratio
        let w = columnWidth > 0 ? min(columnWidth, 430 * r) : 0
        return Button { if let u = im.resolvedURL { onOpen(PhotoRef(url: u, name: nil)) } } label: {
            CachedImage(url: im.resolvedURL) { $0.resizable().scaledToFill() } placeholder: { NX.muted }
                .frame(width: w, height: w > 0 ? w / r : 0)
                .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(NX.border.opacity(0.7)))
        }
        .buttonStyle(.plain)
        .accessibilityLabel(T("Open photo"))
        .frame(maxWidth: .infinity, alignment: .leading)
        .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { columnWidth = $0 }
    }

    private var strip: some View {
        let h: CGFloat = wide ? 250 : 220
        let x = ThreadsStyle.rowX(wide)
        return ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 6) {
                ForEach(Array(images.enumerated()), id: \.offset) { _, im in
                    Button { if let u = im.resolvedURL { onOpen(PhotoRef(url: u, name: nil)) } } label: {
                        CachedImage(url: im.resolvedURL) { $0.resizable().scaledToFill() } placeholder: { NX.muted }
                            .frame(width: h * im.ratio, height: h)
                            .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                            .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(NX.border.opacity(0.7)))
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(T("Open photo"))
                }
            }
            .scrollTargetLayout()
        }
        .scrollTargetBehavior(.viewAligned)
        .contentMargins(.trailing, x, for: .scrollContent)
        // Runs to the post's right edge, past the text column's padding.
        .padding(.trailing, -x)
    }
}

/// Edit a post in place (author, first 15 minutes): the text with its tags, Cancel and Save.
struct ThreadsEditBox: View {
    let post: FeedPost
    let roster: [MentionUser]
    let onCancel: () -> Void
    let onSaved: (FeedPost) -> Void
    @State private var text = ""
    @State private var picked: [String: String] = [:]
    @State private var saving = false
    @State private var failure: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            TextField("", text: $text, axis: .vertical)
                .font(NXFont.text(15)).lineLimit(3...12)
                .padding(.horizontal, 12).padding(.vertical, 8)
                .background(NX.background, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(NX.border))
            let tagMatches = MentionDraft.matches(roster, in: text)
            if !tagMatches.isEmpty {
                MentionSuggestions(matches: tagMatches) { MentionDraft.insert($0, into: &text, picked: &picked) }
            }
            if let failure {
                Text(failure).font(NXFont.text(13, .semibold)).foregroundStyle(ThreadsStyle.rose)
            }
            HStack(spacing: 8) {
                Spacer(minLength: 0)
                Button(T("Cancel"), action: onCancel)
                    .font(NXFont.text(15, .semibold)).foregroundStyle(NX.mutedFg)
                    .padding(.horizontal, 14).frame(height: 36)
                    .buttonStyle(.plain)
                Button { Task { await save() } } label: {
                    ZStack {
                        Text(T("Save")).opacity(saving ? 0 : 1)
                        if saving { ProgressView().controlSize(.small).tint(NX.background) }
                    }
                    .font(NXFont.text(15, .semibold)).foregroundStyle(NX.background)
                    .padding(.horizontal, 16).frame(height: 36)
                    .background(NX.onyx, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                }
                .buttonStyle(.plain)
                .disabled(saving || trimmed.isEmpty)
                .opacity(trimmed.isEmpty ? 0.4 : 1)
            }
        }
        .padding(.top, 6).padding(.bottom, 8)
        .onAppear {
            text = post.text ?? ""
            for m in post.mentions ?? [] {
                if let id = m.userId, let name = m.name { picked[id] = "@" + name }
            }
        }
    }

    private var trimmed: String { text.trimmingCharacters(in: .whitespacesAndNewlines) }

    private func save() async {
        saving = true
        defer { saving = false }
        do {
            let updated = try await APIClient.shared.editPost(post.id, text: trimmed,
                                                              mentions: MentionDraft.ids(in: trimmed, picked: picked))
            onSaved(updated)
        } catch {
            failure = (error as? LocalizedError)?.errorDescription ?? T("Couldn't edit the post.")
        }
    }
}

/// A placeholder row while the feed or the replies load: a 36 pt circle and two bars.
struct ThreadsSkeletonRow: View {
    let wide: Bool
    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Circle().fill(NX.muted).frame(width: 36, height: 36)
            VStack(alignment: .leading, spacing: 8) {
                RoundedRectangle(cornerRadius: 4).fill(NX.muted).frame(width: 112, height: 12)
                RoundedRectangle(cornerRadius: 4).fill(NX.muted).frame(height: 12).padding(.trailing, 60)
            }
            .padding(.top, 4)
        }
        .padding(.horizontal, ThreadsStyle.rowX(wide)).padding(.vertical, 12)
        .shimmer()
        .overlay(alignment: .bottom) { Rectangle().fill(NX.border).frame(height: 0.5) }
    }
}

/// "Link copied" for a moment at the bottom of the screen.
struct ThreadsToast: View {
    let text: String
    var body: some View {
        Text(text)
            .font(NXFont.text(13, .semibold)).foregroundStyle(NX.background)
            .padding(.horizontal, 14).padding(.vertical, 9)
            .background(NX.onyx, in: Capsule())
            .padding(.bottom, 20)
            .transition(.move(edge: .bottom).combined(with: .opacity))
            .allowsHitTesting(false)
    }
}

// MARK: - feed

/// The company feed (web /threads), laid out like Threads: one column, All / Mentions, the
/// "What's new?" composer, then the posts. A post opens its own page with the replies.
struct ThreadsView: View {
    @Environment(AuthStore.self) private var auth
    /// The post a notification pointed at (`/threads?post=<id>`, a mention or a reply to yours).
    @Environment(AppRouter.self) private var router
    @Environment(\.horizontalSizeClass) private var hSize
    @State private var posts: [FeedPost] = []
    @State private var loading = true
    @State private var error: String?
    @State private var draft = ""
    @FocusState private var composerFocused: Bool
    /// JPEG bytes already downscaled, in the order they were picked — the route stores `position`
    /// from that order, so it is the order they appear in for everyone else too.
    @State private var photos: [Data] = []
    /// Pixel size per photo, positionally matched to `photos`, so the feed can hold the right aspect
    /// ratio while an image loads instead of reflowing as each one arrives.
    @State private var photoSizes: [(w: Int, h: Int)?] = []
    @State private var picking: [PhotosPickerItem] = []
    @State private var showLibrary = false
    /// Mirrors IMG_MAX in src/lib/feed.ts. Enforced here too so the fifth photo is refused before
    /// it is uploaded rather than after.
    private static let maxPhotos = 4
    /// Everyone who can be tagged, and who was picked for the draft (userId → "@Name").
    @State private var roster: [MentionUser] = []
    @State private var pickedMentions: [String: String] = [:]
    @State private var opening: ThreadOpen?
    /// Held rather than deleted on the spot: removing somebody's post in front of everyone is not a
    /// thing to do on one accidental tap.
    @State private var confirmingDelete: FeedPost?
    @State private var editingId: String?
    @State private var viewingPhoto: PhotoRef?
    /// Your photo beside the composer. The Keychain session has none: fetched once.
    @State private var myAvatar: String?
    /// The post on its way to the server ("Posting…"), or the one that failed (Try again / Discard).
    @State private var pending: PendingPost?
    /// Newer posts found by the 30 s check, held until the "↑ N new posts" pill is tapped so the list
    /// never moves under the reader.
    @State private var incoming: [FeedPost] = []
    @State private var toast: String?
    @State private var tab: FeedTab = .all
    enum FeedTab: Hashable { case all, mentions }

    struct PendingPost {
        var text: String
        var mentions: [String]
        var photos: [Data]
        var sizes: [(w: Int, h: Int)?]
        var failed = false
    }

    /// The sidebar's Threads page on an iPad or Mac: the web's page header instead of the nav bar.
    private var isRoot: Bool { NXSidebarPage.isRoot(.threads, hSize: hSize, router: router) }
    private var wide: Bool { hSize == .regular }
    private var rowX: CGFloat { ThreadsStyle.rowX(wide) }
    private static let subtitle = "Short updates from the team. Tag someone with @ and they get notified."

    var body: some View {
        ZStack(alignment: .top) {
            NX.background.ignoresSafeArea()
            content
            if !incoming.isEmpty { newPostsPill }
        }
        .overlay(alignment: .bottom) { if let toast { ThreadsToast(text: toast) } }
        .nxSidebarPageChrome(isRoot, phoneSubtitle: T(Self.subtitle)) {
            NXPageHeader(title: T("Threads"), subtitle: T(Self.subtitle))
        }
        .navigationTitle(T("Threads"))
        .navigationBarTitleDisplayMode(.inline)
        .onChange(of: tab) { _, _ in
            incoming = []
            Task { await load() }
        }
        .task { await load(); claimFocus(); await loadRoster() }
        .task(id: auth.session?.userId) { myAvatar = try? await APIClient.shared.profile().user.avatar }
        // The web's 30 s head check: newer posts wait behind the pill instead of shifting the list.
        .task(id: tab) {
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(30))
                if Task.isCancelled { break }
                await checkForNew()
            }
        }
        .onChange(of: router.focus) { _, _ in if !loading { claimFocus() } }
        .navigationDestination(item: $opening) { open in
            ThreadPostView(open: open, roster: roster,
                           onUpdate: { updated in replace(updated) },
                           onDeleted: { id in posts.removeAll { $0.id == id } })
        }
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
            Text(T("It disappears from Threads for everyone. You can restore it from Control Room → Audit."))
        }
    }

    @ViewBuilder private var content: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(spacing: 0, pinnedViews: [.sectionHeaders]) {
                    Section {
                        Color.clear.frame(height: 0).id("threads.top")
                        if tab == .all { composer }
                        feedBody
                    } header: {
                        ThreadsTabs(selection: $tab, wide: wide)
                    }
                }
                .modifier(ThreadsColumn(wide: wide))
            }
            .scrollDismissesKeyboard(.interactively)
            .refreshable { await load() }
            .onChange(of: posts.first?.id) { _, _ in
                withAnimation(.snappy) { proxy.scrollTo("threads.top", anchor: .top) }
            }
        }
    }

    @ViewBuilder private var feedBody: some View {
        if loading {
            ForEach(0..<4, id: \.self) { _ in ThreadsSkeletonRow(wide: wide) }
        } else if let error, posts.isEmpty {
            ErrorState(message: error) { Task { await load() } }
                .padding(.vertical, 24)
        } else {
            if let pending { pendingRow(pending) }
            if posts.isEmpty, pending == nil {
                if tab == .mentions {
                    EmptyState(icon: "at", title: T("No mentions yet"),
                               subtitle: T("When someone tags you, it shows up here."), compact: true)
                        .padding(.vertical, 24)
                } else {
                    EmptyState(icon: "bubble.left.and.text.bubble.right", title: T("Nothing on the feed yet"),
                               subtitle: T("Threads is the company feed: wins, photos, questions for everyone. Write the first post in the box above and it appears here for the whole office."),
                               compact: true)
                        .padding(.vertical, 24)
                }
            } else {
                ForEach(Array(posts.enumerated()), id: \.element.id) { i, p in
                    postRow(p)
                        .overlay(alignment: .bottom) {
                            if i < posts.count - 1 { Rectangle().fill(NX.border).frame(height: 0.5) }
                        }
                }
            }
        }
    }

    private var newPostsPill: some View {
        Button {
            withAnimation(.snappy) {
                posts = incoming
                incoming = []
            }
        } label: {
            HStack(spacing: 6) {
                Image(systemName: "arrow.up").font(.system(size: 12, weight: .bold))
                Text(newCount == 1 ? T("1 new post") : String(format: T("%d new posts"), newCount))
            }
            .font(NXFont.text(13, .semibold)).foregroundStyle(NX.background)
            .padding(.horizontal, 14).frame(height: 36)
            .background(NX.onyx, in: Capsule())
            .shadow(color: .black.opacity(0.15), radius: 8, y: 2)
        }
        .buttonStyle(.plain)
        .padding(.top, 12)
        .transition(.move(edge: .top).combined(with: .opacity))
    }

    private var newCount: Int {
        let known = Set(posts.map(\.id))
        return incoming.filter { !known.contains($0.id) }.count
    }

    // MARK: composer

    private var meName: String { auth.session.map { $0.userName.isEmpty ? $0.userEmail : $0.userName } ?? "" }

    private var composer: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .top, spacing: 12) {
                AvatarView(url: myAvatar, initial: String(meName.first ?? "?").uppercased(), size: 36,
                           userId: auth.session?.userId, name: meName)
                VStack(alignment: .leading, spacing: 4) {
                    TextField(T("What's new?"), text: $draft, axis: .vertical)
                        .font(NXFont.text(15)).lineLimit(1...16)
                        .focused($composerFocused)
                        .padding(.vertical, 7)
                    if composerFocused || !draft.isEmpty || !photos.isEmpty {
                        HStack(spacing: 6) {
                            Button { showLibrary = true } label: {
                                Image(systemName: "photo")
                                    .font(.system(size: 18)).foregroundStyle(NX.mutedFg)
                                    .frame(width: 36, height: 36)
                                    .contentShape(Circle())
                            }
                            .buttonStyle(ThreadsPillStyle())
                            .accessibilityLabel(T("Add photo"))
                            .disabled(photos.count >= Self.maxPhotos)
                            .padding(.leading, -8)
                            if !photos.isEmpty {
                                Text("\(photos.count)/\(Self.maxPhotos)").font(NXFont.text(13)).foregroundStyle(NX.mutedFg)
                                    .monospacedDigit()
                            }
                            Spacer(minLength: 0)
                            if draft.count >= 220 { CharRing(count: draft.count) }
                        }
                    }
                }
                ThreadsPostButton(ready: canPost, busy: pending != nil && pending?.failed == false) {
                    Task { await post() }
                }
            }
            let tagMatches = MentionDraft.matches(roster, in: draft)
            if !tagMatches.isEmpty {
                MentionSuggestions(matches: tagMatches) { MentionDraft.insert($0, into: &draft, picked: &pickedMentions) }
                    .padding(.top, 8).padding(.leading, 48)
            }
            if !photos.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 6) {
                        ForEach(photos.indices, id: \.self) { i in
                            if let ui = UIImage(data: photos[i]) {
                                let r = ui.size.height > 0 ? ui.size.width / ui.size.height : 1
                                Image(uiImage: ui).resizable().scaledToFill()
                                    .frame(width: min(160 * r, 320), height: 160)
                                    .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                                    .overlay(alignment: .topTrailing) {
                                        Button {
                                            photos.remove(at: i)
                                            if i < photoSizes.count { photoSizes.remove(at: i) }
                                        } label: {
                                            Image(systemName: "xmark").font(.system(size: 12, weight: .bold))
                                                .foregroundStyle(.white)
                                                .frame(width: 28, height: 28)
                                                .background(.black.opacity(0.6), in: Circle())
                                        }
                                        .buttonStyle(.plain)
                                        .accessibilityLabel(T("Remove photo"))
                                        .padding(6)
                                    }
                            }
                        }
                    }
                }
                .padding(.top, 8).padding(.leading, 48)
            }
        }
        .padding(.horizontal, rowX).padding(.vertical, 16)
        .overlay(alignment: .bottom) { Rectangle().fill(NX.border).frame(height: 0.5) }
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

    /// A photo alone is a post; the route refuses only when text AND photos are both empty.
    private var canPost: Bool {
        let hasText = !draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        return (hasText || !photos.isEmpty) && draft.count <= ThreadsStyle.textMax && pending?.failed != false
    }

    /// Shrunk on the way in: `GideonPanel.shrink` is the same downscaler the ticket composer uses, and
    /// a modern iPhone photo is well past the route's 8MB ceiling untouched.
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
                // A pick the library could not hand over (still in iCloud, or undecodable). Counted
                // rather than dropped silently: five of these read as a broken picker.
                lost += 1
            }
        }
        if lost > 0 { flash(T("Couldn't read that photo.")) }
        picking = []
    }

    // MARK: rows

    private func postRow(_ p: FeedPost) -> some View {
        HStack(alignment: .top, spacing: 12) {
            AvatarView(url: p.author?.avatar, initial: p.initial, size: 36, userId: p.author?.id, name: p.authorName)
                .padding(.top, 1)
            VStack(alignment: .leading, spacing: 0) {
                ThreadsNameRow(name: p.authorName, time: ThreadsStyle.timeAgo(p.createdAt),
                               edited: p.editedAt?.isEmpty == false) {
                    if editingId != p.id {
                        ThreadsPostMenu(post: p, onCopy: { copyLink(p) }, onEdit: { editingId = p.id },
                                        onDelete: { confirmingDelete = p })
                    }
                }
                if editingId == p.id {
                    ThreadsEditBox(post: p, roster: roster, onCancel: { editingId = nil },
                                   onSaved: { updated in replace(updated); editingId = nil })
                } else if let c = p.text, !c.isEmpty {
                    mentionText(c, names: p.mentionNames)
                        .font(NXFont.text(15)).foregroundStyle(NX.foreground).lineSpacing(3)
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(.top, 2)
                }
                if !(p.images ?? []).isEmpty {
                    ThreadsMedia(images: p.images ?? [], wide: wide) { viewingPhoto = $0 }
                        .padding(.top, 8)
                }
                if editingId != p.id {
                    ThreadsActionRow(post: p, onLike: { Task { await like(p) } },
                                     onReply: { opening = ThreadOpen(id: p.id, post: p, reply: true) },
                                     onCopy: { copyLink(p) })
                        .padding(.top, 2)
                }
            }
        }
        .padding(.horizontal, rowX).padding(.top, 12).padding(.bottom, 4)
        .frame(maxWidth: .infinity, alignment: .leading)
        // The post itself opens its page; the buttons, menu and photos take their own taps.
        .contentShape(Rectangle())
        .onTapGesture { if editingId != p.id { opening = ThreadOpen(id: p.id, post: p) } }
    }

    /// The post being sent ("Posting…" under a violet line) or the one that failed (rose tint, Try
    /// again / Discard). No action row: there is nothing to like yet.
    private func pendingRow(_ p: PendingPost) -> some View {
        HStack(alignment: .top, spacing: 12) {
            AvatarView(url: myAvatar, initial: String(meName.first ?? "?").uppercased(), size: 36,
                       userId: auth.session?.userId, name: meName)
            VStack(alignment: .leading, spacing: 2) {
                ThreadsNameRow(name: meName, time: p.failed ? nil : T("Posting…")) { EmptyView() }
                if !p.text.isEmpty {
                    mentionText(p.text, names: roster.map(\.displayName))
                        .font(NXFont.text(15)).foregroundStyle(NX.foreground).lineSpacing(3)
                        .fixedSize(horizontal: false, vertical: true)
                }
                if !p.photos.isEmpty {
                    HStack(spacing: 6) {
                        ForEach(p.photos.indices, id: \.self) { i in
                            if let ui = UIImage(data: p.photos[i]) {
                                Image(uiImage: ui).resizable().scaledToFill()
                                    .frame(width: 64, height: 64)
                                    .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                            }
                        }
                    }
                    .padding(.top, 6)
                }
                if p.failed {
                    HStack(spacing: 10) {
                        Text(T("Couldn't send.")).font(NXFont.text(14, .semibold)).foregroundStyle(ThreadsStyle.rose)
                        Button { Task { await send(p) } } label: {
                            Label(T("Try again"), systemImage: "arrow.clockwise")
                                .font(NXFont.text(13, .semibold)).foregroundStyle(.white)
                                .padding(.horizontal, 10).frame(height: 30)
                                .background(ThreadsStyle.rose, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                        }
                        .buttonStyle(.plain)
                        Button(T("Discard")) { withAnimation(.snappy) { pending = nil } }
                            .font(NXFont.text(13, .semibold)).foregroundStyle(NX.mutedFg)
                            .buttonStyle(.plain)
                    }
                    .padding(.top, 8)
                }
            }
        }
        .padding(.horizontal, rowX).padding(.vertical, 12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(p.failed ? ThreadsStyle.rose.opacity(0.08) : Color.clear)
        .overlay(alignment: .top) {
            if !p.failed { Rectangle().fill(NX.violet).frame(height: 2) }
        }
        .overlay(alignment: .bottom) { Rectangle().fill(NX.border).frame(height: 0.5) }
    }

    // MARK: actions

    private func flash(_ text: String) {
        withAnimation(.snappy) { toast = text }
        Task {
            try? await Task.sleep(for: .seconds(1.8))
            withAnimation(.snappy) { if toast == text { toast = nil } }
        }
    }

    private func copyLink(_ p: FeedPost) {
        UIPasteboard.general.string = ThreadsStyle.link(p.id)
        Haptics.tap()
        flash(T("Link copied"))
    }

    private func replace(_ updated: FeedPost) {
        if let i = posts.firstIndex(where: { $0.id == updated.id }) { posts[i] = updated }
    }

    private func claimFocus() {
        guard case .post(let id) = router.focus else { return }
        router.focus = nil
        // Opened even when the post is not in the loaded page: the post page fetches it by id.
        opening = ThreadOpen(id: id, post: posts.first(where: { $0.id == id }))
    }

    private func load() async {
        error = nil
        let asked = tab
        do {
            let fresh = try await APIClient.shared.feedPosts(mentionsMe: asked == .mentions)
            // A tab switched while this was loading: the newer load owns the list.
            guard asked == tab else { return }
            posts = fresh
            incoming = []
        }
        catch APIError.unauthorized { auth.logout() }
        catch { self.error = (error as? LocalizedError)?.errorDescription ?? T("Couldn't load the feed.") }
        loading = false
    }

    private func checkForNew() async {
        let asked = tab
        guard !loading, let fresh = try? await APIClient.shared.feedPosts(mentionsMe: asked == .mentions),
              asked == tab else { return }
        let known = Set(posts.map(\.id))
        if fresh.contains(where: { !known.contains($0.id) }) {
            withAnimation(.snappy) { incoming = fresh }
        }
    }

    private func post() async {
        let v = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !v.isEmpty || !photos.isEmpty else { return }
        let p = PendingPost(text: v, mentions: MentionDraft.ids(in: v, picked: pickedMentions),
                            photos: photos, sizes: photoSizes)
        draft = ""
        pickedMentions = [:]
        photos = []
        photoSizes = []
        composerFocused = false
        await send(p)
    }

    private func send(_ p: PendingPost) async {
        var p = p
        p.failed = false
        withAnimation(.snappy) { pending = p }
        do {
            try await APIClient.shared.createPost(text: p.text, mentions: p.mentions, images: p.photos, imageMeta: p.sizes)
            Haptics.success()
            pending = nil
            await load()
        } catch {
            p.failed = true
            withAnimation(.snappy) { pending = p }
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
            flash((error as? LocalizedError)?.errorDescription ?? T("Couldn't delete that post."))
        }
        await load()
    }

    /// Like X: the heart and the count flip on the tap, then the server's `{liked, likeCount}`
    /// replaces the guess — it recounts from the like rows.
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
            // Optimistic, so put it back: a heart that stays lit after the server said no is a lie.
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

/// All / Mentions: two equal halves, 48 pt tall. The selected half is the foreground colour over a
/// 1 pt foreground line; the other is muted over a hairline. Pinned under the header while scrolling.
private struct ThreadsTabs: View {
    @Binding var selection: ThreadsView.FeedTab
    let wide: Bool

    var body: some View {
        HStack(spacing: 0) {
            tab(.all, T("All"))
            tab(.mentions, T("Mentions"))
        }
        .background(wide ? NX.card : NX.background)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(T("Threads"))
    }

    private func tab(_ id: ThreadsView.FeedTab, _ label: String) -> some View {
        let on = selection == id
        return Button { selection = id } label: {
            Text(label)
                .font(NXFont.text(15, .semibold))
                .foregroundStyle(on ? NX.foreground : NX.mutedFg)
                .frame(maxWidth: .infinity)
                .frame(height: 48)
                .contentShape(Rectangle())
                .overlay(alignment: .bottom) {
                    Rectangle().fill(on ? NX.foreground : NX.border).frame(height: 1)
                }
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(on ? .isSelected : [])
    }
}

/// The composer's length ring from 220 characters (web Composer): violet, amber in the last 20,
/// rose past the limit, with the characters left once that is 20 or fewer.
private struct CharRing: View {
    let count: Int
    var body: some View {
        let remaining = ThreadsStyle.textMax - count
        let tint = remaining < 0 ? ThreadsStyle.rose : (remaining <= 20 ? NX.warning : NX.violet)
        HStack(spacing: 4) {
            if remaining <= 20 {
                Text("\(remaining)").font(NXFont.text(12, .semibold)).monospacedDigit().foregroundStyle(tint)
            }
            ZStack {
                Circle().stroke(NX.border, lineWidth: 2.5)
                Circle().trim(from: 0, to: min(1, CGFloat(count) / CGFloat(ThreadsStyle.textMax)))
                    .stroke(tint, style: StrokeStyle(lineWidth: 2.5, lineCap: .round))
                    .rotationEffect(.degrees(-90))
            }
            .frame(width: 20, height: 20)
        }
        .accessibilityLabel(String(format: T("%d characters left"), remaining))
    }
}

// MARK: - one post (Threads' post page)

/// An open post: author row, the text at full width, photos, actions, the reply box, then the replies
/// oldest first. Replies by the same person in a row are joined by the thread line.
struct ThreadPostView: View {
    let open: ThreadOpen
    let roster: [MentionUser]
    var onUpdate: (FeedPost) -> Void = { _ in }
    var onDeleted: (String) -> Void = { _ in }

    @Environment(AuthStore.self) private var auth
    @Environment(\.horizontalSizeClass) private var hSize
    @Environment(\.dismiss) private var dismiss
    @State private var post: FeedPost?
    @State private var postMissing = false
    @State private var postError: String?
    @State private var comments: [FeedComment] = []
    @State private var loading = true
    @State private var loadFailed = false
    @State private var draft = ""
    @State private var sending = false
    @State private var sendFailed = false
    @State private var viewingPhoto: PhotoRef?
    @FocusState private var replying: Bool
    @State private var members: [MentionUser] = []
    @State private var pickedMentions: [String: String] = [:]
    @State private var confirmingDelete = false
    @State private var editing = false
    @State private var toast: String?
    @State private var myAvatar: String?

    private var wide: Bool { hSize == .regular }
    private var rowX: CGFloat { ThreadsStyle.rowX(wide) }

    var body: some View {
        ScrollView {
            VStack(spacing: 0) {
                if let post {
                    mainPost(post)
                    replyBox(post)
                    replies
                } else if postMissing {
                    Text(T("This post was deleted."))
                        .font(NXFont.text(15)).foregroundStyle(NX.mutedFg)
                        .frame(maxWidth: .infinity).padding(.vertical, 48)
                } else if let postError {
                    ErrorState(message: postError) { Task { await loadPost() } }.padding(.vertical, 24)
                } else {
                    ThreadsSkeletonRow(wide: wide)
                }
            }
            .modifier(ThreadsColumn(wide: wide))
        }
        .scrollDismissesKeyboard(.interactively)
        .background(NX.background.ignoresSafeArea())
        .overlay(alignment: .bottom) { if let toast { ThreadsToast(text: toast) } }
        .navigationTitle(T("Thread"))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .principal) {
                VStack(spacing: 0) {
                    Text(T("Thread")).font(NXFont.text(16, .bold)).foregroundStyle(NX.foreground)
                    if let post {
                        Text(ThreadsStyle.repliesLabel(post.comments))
                            .font(NXFont.text(12)).foregroundStyle(NX.mutedFg).contentTransition(.numericText())
                    }
                }
            }
        }
        .task {
            post = open.post
            if post == nil { await loadPost() }
            await loadComments()
            if open.reply, post != nil {
                try? await Task.sleep(for: .milliseconds(350))
                replying = true
            }
            if roster.isEmpty {
                members = await ThreadsView.mentionRoster(excluding: auth.session?.userId)
            } else {
                members = roster
            }
        }
        .task(id: auth.session?.userId) { myAvatar = try? await APIClient.shared.profile().user.avatar }
        // No socket for Threads: replies refresh every 20 s while the post is open.
        .task {
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(20))
                if Task.isCancelled { break }
                await loadComments(quiet: true)
            }
        }
        .alert(T("Delete this post?"), isPresented: $confirmingDelete) {
            Button(T("Delete"), role: .destructive) { Task { await remove() } }
            Button(T("Cancel"), role: .cancel) {}
        } message: {
            Text(T("It disappears from Threads for everyone. You can restore it from Control Room → Audit."))
        }
        .fullScreenCover(item: $viewingPhoto) { PhotoViewer(photo: $0) }
    }

    // MARK: parts

    private func mainPost(_ p: FeedPost) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .center, spacing: 12) {
                AvatarView(url: p.author?.avatar, initial: p.initial, size: 36, userId: p.author?.id, name: p.authorName)
                ThreadsNameRow(name: p.authorName, time: ThreadsStyle.timeAgo(p.createdAt),
                               edited: p.editedAt?.isEmpty == false) {
                    if !editing {
                        ThreadsPostMenu(post: p, onCopy: { copyLink(p) }, onEdit: { editing = true },
                                        onDelete: { confirmingDelete = true })
                    }
                }
            }
            if editing {
                ThreadsEditBox(post: p, roster: members, onCancel: { editing = false },
                               onSaved: { updated in post = updated; onUpdate(updated); editing = false })
                    .padding(.top, 8)
            } else if let c = p.text, !c.isEmpty {
                mentionText(c, names: p.mentionNames)
                    .font(NXFont.text(15)).foregroundStyle(NX.foreground).lineSpacing(3)
                    .fixedSize(horizontal: false, vertical: true)
                    .textSelection(.enabled)
                    .padding(.top, 12)
            }
            if !(p.images ?? []).isEmpty {
                ThreadsMedia(images: p.images ?? [], wide: wide) { ref in
                    // The reply box can be holding the keyboard, and a cover raised underneath it
                    // comes up with the keyboard still on top.
                    replying = false
                    viewingPhoto = ref
                }
                .padding(.top, 8)
            }
            if !editing {
                ThreadsActionRow(post: p, onLike: { Task { await like() } },
                                 onReply: { replying = true }, onCopy: { copyLink(p) })
                    .padding(.top, 4)
            }
        }
        .padding(.horizontal, rowX).padding(.top, 12).padding(.bottom, 4)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func replyBox(_ p: FeedPost) -> some View {
        let me = auth.session.map { $0.userName.isEmpty ? $0.userEmail : $0.userName } ?? ""
        return VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .top, spacing: 12) {
                AvatarView(url: myAvatar, initial: String(me.first ?? "?").uppercased(), size: 36,
                           userId: auth.session?.userId, name: me)
                TextField(String(format: T("Reply to %@…"), p.authorName), text: $draft, axis: .vertical)
                    .font(NXFont.text(15)).lineLimit(1...10)
                    .focused($replying)
                    .padding(.vertical, 7)
                ThreadsPostButton(ready: !draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, busy: sending) {
                    Task { await send() }
                }
            }
            let tagMatches = MentionDraft.matches(members, in: draft)
            if !tagMatches.isEmpty {
                MentionSuggestions(matches: tagMatches) { MentionDraft.insert($0, into: &draft, picked: &pickedMentions) }
                    .padding(.leading, 48)
            }
            if sendFailed {
                Text(T("Couldn't send.")).font(NXFont.text(13, .semibold)).foregroundStyle(ThreadsStyle.rose)
                    .padding(.leading, 48)
            }
        }
        .padding(.horizontal, rowX).padding(.vertical, 12)
        .overlay(alignment: .top) { Rectangle().fill(NX.border).frame(height: 0.5) }
        .overlay(alignment: .bottom) { Rectangle().fill(NX.border).frame(height: 0.5) }
    }

    @ViewBuilder private var replies: some View {
        if loading {
            ForEach(0..<2, id: \.self) { _ in ThreadsSkeletonRow(wide: wide) }
        } else if loadFailed && comments.isEmpty {
            HStack(spacing: 6) {
                Text(T("Couldn't load the replies.")).foregroundStyle(NX.mutedFg)
                Button(T("Try again")) { Task { await loadComments() } }
                    .foregroundStyle(NX.foreground).fontWeight(.semibold).buttonStyle(.plain)
            }
            .font(NXFont.text(15))
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, rowX).padding(.vertical, 24)
        } else if comments.isEmpty {
            EmptyState(icon: "bubble.right", title: T("No replies yet"),
                       subtitle: T("Be the first to reply. Tag someone with @ to bring them in."), compact: true)
                .padding(.vertical, 32)
        } else {
            let names = members.map(\.displayName) + [post?.authorName].compactMap { $0 }
            ForEach(Array(comments.enumerated()), id: \.element.id) { i, c in
                let chained = i + 1 < comments.count && comments[i + 1].author?.id != nil
                    && comments[i + 1].author?.id == c.author?.id
                replyRow(c, chained: chained, last: i == comments.count - 1, names: names)
            }
        }
    }

    /// One reply. A run by the same person is joined by a 2 pt line under the avatar, with no hairline
    /// between them, the way Threads draws an author's chain.
    private func replyRow(_ c: FeedComment, chained: Bool, last: Bool, names: [String]) -> some View {
        HStack(alignment: .top, spacing: 12) {
            AvatarView(url: c.author?.avatar, initial: c.initial, size: 36, userId: c.author?.id, name: c.author?.name)
            VStack(alignment: .leading, spacing: 2) {
                ThreadsNameRow(name: c.authorName, time: ThreadsStyle.timeAgo(c.createdAt)) { EmptyView() }
                mentionText(c.text ?? "", names: names)
                    .font(NXFont.text(15)).foregroundStyle(NX.foreground).lineSpacing(3)
                    .fixedSize(horizontal: false, vertical: true)
                    .textSelection(.enabled)
            }
            .padding(.bottom, chained ? 16 : 0)
        }
        .padding(.horizontal, rowX).padding(.top, 12).padding(.bottom, chained ? 0 : 12)
        .frame(maxWidth: .infinity, alignment: .leading)
        // The thread line: from 6 pt under this avatar down to the next one (which sits 12 pt into
        // the next row).
        .background(alignment: .topLeading) {
            if chained {
                Capsule().fill(NX.border)
                    .frame(width: 2)
                    .padding(.top, 12 + 36 + 6)
                    .padding(.bottom, -6)
                    .padding(.leading, rowX + 17)
            }
        }
        .overlay(alignment: .bottom) {
            if !chained && !last { Rectangle().fill(NX.border).frame(height: 0.5) }
        }
    }

    // MARK: actions

    private func flash(_ text: String) {
        withAnimation(.snappy) { toast = text }
        Task {
            try? await Task.sleep(for: .seconds(1.8))
            withAnimation(.snappy) { if toast == text { toast = nil } }
        }
    }

    private func copyLink(_ p: FeedPost) {
        UIPasteboard.general.string = ThreadsStyle.link(p.id)
        Haptics.tap()
        flash(T("Link copied"))
    }

    private func loadPost() async {
        postError = nil
        do {
            post = try await APIClient.shared.feedPost(open.id)
        } catch APIError.http(let status, _) where status == 404 || status == 410 {
            postMissing = true
        } catch APIError.unauthorized {
            auth.logout()
        } catch {
            postError = (error as? LocalizedError)?.errorDescription ?? T("Couldn't load the feed.")
        }
    }

    private func loadComments(quiet: Bool = false) async {
        guard post != nil || !quiet else { return }
        do {
            let fresh = try await APIClient.shared.postComments(open.id)
            comments = fresh
            loadFailed = false
            // The count in the bar follows what is on screen.
            if var p = post, p.comments != fresh.count {
                p.commentCount = fresh.count
                post = p
                onUpdate(p)
            }
        }
        catch APIError.unauthorized { auth.logout() }
        catch { if !quiet { loadFailed = true } }
        loading = false
    }

    private func send() async {
        let v = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !v.isEmpty, !sending else { return }
        sending = true
        sendFailed = false
        defer { sending = false }
        do {
            _ = try await APIClient.shared.addPostComment(postId: open.id, text: v,
                                                          mentions: MentionDraft.ids(in: v, picked: pickedMentions))
            draft = ""
            pickedMentions = [:]
            Haptics.success()
            await loadComments(quiet: true)
        } catch {
            // The text stays in the box for another try.
            sendFailed = true
        }
    }

    private func like() async {
        guard var p = post else { return }
        Haptics.tap()
        let before = p
        let nowLiked = p.likedByMe != true
        p.likedByMe = nowLiked
        p.likeCount = max(0, p.likes + (nowLiked ? 1 : -1))
        withAnimation(.snappy(duration: 0.2)) { post = p }
        do {
            let r = try await APIClient.shared.likePost(p.id)
            p.likedByMe = r.liked
            p.likeCount = r.likeCount
            post = p
            onUpdate(p)
        } catch {
            post = before
        }
    }

    private func remove() async {
        guard let p = post else { return }
        do {
            try await APIClient.shared.deletePost(p.id)
            onDeleted(p.id)
            dismiss()
        } catch {
            flash((error as? LocalizedError)?.errorDescription ?? T("Couldn't delete that post."))
        }
    }
}
