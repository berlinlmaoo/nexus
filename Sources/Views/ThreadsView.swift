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
    let author: Author?
    let images: [FeedImage]?
    let likeCount: Int?
    let commentCount: Int?
    let likedByMe: Bool?

    struct Author: Decodable, Hashable, Sendable { let id: String?; let name: String?; let avatar: String? }

    var authorName: String { author?.name ?? "Someone" }
    var initial: String { String(authorName.first ?? "?").uppercased() }
    var likes: Int { likeCount ?? 0 }
    var comments: Int { commentCount ?? 0 }
    var photos: [String] { (images ?? []).compactMap(\.url) }
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
    @State private var liked: Set<String> = []      // optimistic, so a tap reacts instantly
    @State private var openPost: FeedPost?
    @State private var viewingPhoto: PhotoRef?

    var body: some View {
        ZStack {
            NX.background.ignoresSafeArea()
            content
        }
        .navigationTitle(T("Threads"))
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
        .navigationDestination(item: $openPost) { p in PostThreadView(post: p) }
        .fullScreenCover(item: $viewingPhoto) { PhotoViewer(photo: $0) }
    }

    @ViewBuilder private var content: some View {
        if loading {
            SkeletonList()
        } else if let error {
            ErrorState(message: error) { Task { await load() } }
        } else {
            ScrollView {
                LazyVStack(spacing: 12) {
                    composer
                    if posts.isEmpty {
                        Text(T("Nothing on the feed yet. Be the first to post."))
                            .font(NXFont.text(13)).foregroundStyle(NX.mutedFg)
                            .frame(maxWidth: .infinity).padding(.vertical, 30)
                    } else {
                        ForEach(posts) { p in postCard(p) }
                    }
                }
                .padding(16)
            }
            .refreshable { await load() }
        }
    }

    private var composer: some View {
        VStack(alignment: .leading, spacing: 8) {
            TextField(T("What's new?"), text: $draft, axis: .vertical)
                .font(NXFont.text(15)).lineLimit(2...6)
                .padding(10)
                .background(NX.muted.opacity(0.5), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
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
            HStack(spacing: 10) {
                Button { showLibrary = true } label: {
                    Image(systemName: "photo.on.rectangle.angled")
                        .font(.system(size: 17, weight: .semibold))
                        .foregroundStyle(photos.count >= Self.maxPhotos ? NX.mutedFg : NX.violetText)
                }
                .buttonStyle(.plain)
                .disabled(posting || photos.count >= Self.maxPhotos)
                if !photos.isEmpty {
                    Text("\(photos.count)/\(Self.maxPhotos)")
                        .font(NXFont.text(11)).foregroundStyle(NX.mutedFg)
                }
                Spacer()
                Button { Task { await post() } } label: {
                    HStack(spacing: 6) {
                        if posting { ProgressView().scaleEffect(0.7).tint(.white) }
                        Text(T("Post"))
                    }
                    .font(NXFont.text(13, .bold)).foregroundStyle(.white)
                    .padding(.horizontal, 16).padding(.vertical, 8)
                    .background(NX.violet, in: Capsule())
                }
                .buttonStyle(.plain)
                // A photo alone is a post. The route refuses only when text AND images are both
                // empty, and a picture with nothing to say is the commonest thing on this screen.
                .disabled(posting || !canPost)
                .opacity(canPost ? 1 : 0.5)
            }
        }
        .nexusCard()
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

    private func postCard(_ p: FeedPost) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 10) {
                AvatarView(url: p.author?.avatar, initial: p.initial, size: 34)
                VStack(alignment: .leading, spacing: 1) {
                    Text(p.authorName).font(NXFont.text(14, .bold)).foregroundStyle(NX.foreground).lineLimit(1)
                    if let d = ProjDate.parse(p.createdAt) {
                        Text(ProjDate.dayLabel(d)).font(NXFont.text(11)).foregroundStyle(NX.mutedFg)
                    }
                }
                Spacer(minLength: 0)
            }
            if let c = p.text, !c.isEmpty {
                mentionText(c).font(NXFont.text(14)).foregroundStyle(NX.foreground)
                    .fixedSize(horizontal: false, vertical: true)
            }
            if !p.photos.isEmpty {
                FeedPhotoStrip(photos: p.photos) { viewingPhoto = $0 }
            }
            HStack(spacing: 16) {
                Button { Task { await like(p) } } label: {
                    let on = liked.contains(p.id)
                    Label("\(p.likes + (on ? 1 : 0))", systemImage: on ? "heart.fill" : "heart")
                        .font(NXFont.text(12, .semibold))
                        .foregroundStyle(on ? NX.danger : NX.mutedFg)
                }
                .buttonStyle(.plain)
                Button { openPost = p } label: {
                    Label("\(p.comments)", systemImage: "bubble.left")
                        .font(NXFont.text(12, .semibold)).foregroundStyle(NX.mutedFg)
                }
                .buttonStyle(.plain)
                Spacer()
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background {
            RoundedRectangle(cornerRadius: 18, style: .continuous).fill(NX.card)
                .nexusShadowSoft()
                .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).strokeBorder(NX.border))
        }
        // The comment count was the only way into a thread. On a feed the post itself is the door;
        // the like and comment buttons sit deeper in the hierarchy and still take their own taps.
        .contentShape(Rectangle())
        .onTapGesture { openPost = p }
    }

    private func load() async {
        error = nil
        do { posts = try await APIClient.shared.feedPosts() }
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
            try await APIClient.shared.createPost(text: v, images: photos, imageMeta: photoSizes)
            draft = ""
            photos = []
            photoSizes = []
            await load()
        } catch {
            self.error = (error as? LocalizedError)?.errorDescription ?? T("Couldn't post.")
        }
    }
    private func like(_ p: FeedPost) async {
        Haptics.tap()
        if liked.contains(p.id) { liked.remove(p.id) } else { liked.insert(p.id) }
        try? await APIClient.shared.likePost(p.id)
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
    @State private var viewingPhoto: PhotoRef?
    @FocusState private var replying: Bool

    var body: some View {
        VStack(spacing: 0) {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    VStack(alignment: .leading, spacing: 8) {
                        HStack(spacing: 10) {
                            AvatarView(url: post.author?.avatar, initial: post.initial, size: 34)
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
        .task { await load() }
        .fullScreenCover(item: $viewingPhoto) { PhotoViewer(photo: $0) }
    }

    private func commentRow(_ c: FeedComment) -> some View {
        HStack(alignment: .top, spacing: 10) {
            AvatarView(url: c.author?.avatar, initial: c.initial, size: 28)
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
        draft = ""
        try? await APIClient.shared.addPostComment(postId: post.id, text: v)
        await load()
        sending = false
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
