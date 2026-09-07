import SwiftUI
import UIKit
import ImageIO

// ─────────────────────────────────────────────────────────────────────────────
// Cached async image loading.
//
// SwiftUI's built-in `AsyncImage` re-downloads AND re-decodes its image every time
// the view appears — so scrolling a list of avatars / project icons re-hits the
// network on every cell, which is the single biggest scroll-jank source on device.
//
// `CachedImage` is a drop-in replacement (same `url:content:placeholder:` shape) with
// a two-tier cache:
//   • in-memory decoded UIImage (NSCache) → instant, zero re-decode on re-scroll
//   • on-disk HTTP cache (URLCache)        → survives relaunch, avoids re-download
// Decoding happens off the main thread (`byPreparingForDisplay`) so the first paint
// of a row never blocks the scroll. The NEXUS session cookie is attached for same-host
// URLs so private `/api/files` icons load just like the rest of the API.
// ─────────────────────────────────────────────────────────────────────────────

actor ImageLoader {
    static let shared = ImageLoader()

    /// Decoded tiles, readable from any thread. It lives outside the actor's isolation on purpose:
    /// `CachedImage` peeks at it synchronously while building its body, which is what lets an
    /// already-loaded avatar paint on the very first frame instead of after an await.
    /// NSCache is thread-safe, so sharing it this way is sound.
    // `nonisolated(unsafe)`, not plain `nonisolated`: NSCache is not marked Sendable, and plain
    // `nonisolated` on a non-Sendable value is a warning today and an error under Swift 6. The
    // "unsafe" here is a promise we can actually keep - NSCache is documented as thread-safe.
    nonisolated(unsafe) static let memory: NSCache<NSURL, UIImage> = {
        let c = NSCache<NSURL, UIImage>()
        c.countLimit = 200                 // downsampled tiles; auto-evicts under memory pressure
        return c
    }()
    private var inFlight: [URL: Task<UIImage?, Never>] = [:]

    private static let session: URLSession = {
        let cfg = URLSessionConfiguration.default
        cfg.urlCache = URLCache(memoryCapacity: 16 << 20, diskCapacity: 256 << 20)
        cfg.requestCachePolicy = .returnCacheDataElseLoad
        return URLSession(configuration: cfg)
    }()

    /// The tile size every avatar, icon and list row asks for.
    static let tilePixel: CGFloat = 300
    /// What the full-screen viewer asks for. A sick note decoded at 300px is a grey smudge once it
    /// fills a phone, and reading it is the entire reason anybody opens it.
    static let pagePixel: CGFloat = 1600

    /// A cached picture is (URL, size). The same URL can legitimately be wanted as a 300px tile in
    /// a row AND as a full-screen page one tap later; keyed on the URL alone, whichever was decoded
    /// first would be handed to both.
    nonisolated static func cacheKey(_ url: URL, _ maxPixel: CGFloat) -> URL {
        guard maxPixel != tilePixel else { return url }
        return URL(string: url.absoluteString + "#px\(Int(maxPixel))") ?? url
    }

    func image(for url: URL, maxPixel: CGFloat = ImageLoader.tilePixel) async -> UIImage? {
        let key = Self.cacheKey(url, maxPixel)
        if let hit = Self.memory.object(forKey: key as NSURL) { return hit }
        if let task = inFlight[key] { return await task.value }   // dedupe concurrent requests

        let task = Task<UIImage?, Never> {
            // The REQUEST always uses the real URL — the size lives in the cache key and nowhere
            // else, so a fragment never reaches the server.
            var req = URLRequest(url: url)
            if url.host == Config.baseURL.host, let s = Keychain.load() {
                req.setValue(s.cookieHeader, forHTTPHeaderField: "Cookie")
            }
            guard let (data, resp) = try? await ImageLoader.session.data(for: req) else { return nil }
            if let http = resp as? HTTPURLResponse, !(200..<300).contains(http.statusCode) { return nil }
            // Almost every consumer is a small tile (avatar/icon). Decode AND downsample in one
            // ImageIO pass so we never hold a 1280px bitmap to draw into a 56px frame.
            return ImageLoader.downsample(data, maxPixel: maxPixel) ?? UIImage(data: data)
        }
        inFlight[key] = task
        let img = await task.value
        inFlight[key] = nil
        if let img { Self.memory.setObject(img, forKey: key as NSURL) }
        return img
    }

    /// Decode + downscale to `maxPixel` (longest edge) in a single ImageIO pass — the WWDC
    /// "Image and Graphics Best Practices" pattern. Honors EXIF orientation; caches the decoded
    /// bitmap immediately so the first draw on the main thread is cheap.
    nonisolated static func downsample(_ data: Data, maxPixel: CGFloat) -> UIImage? {
        guard let src = CGImageSourceCreateWithData(data as CFData,
                                                    [kCGImageSourceShouldCache: false] as CFDictionary) else { return nil }
        let opts: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceShouldCacheImmediately: true,
            kCGImageSourceThumbnailMaxPixelSize: maxPixel,
        ]
        guard let cg = CGImageSourceCreateThumbnailAtIndex(src, 0, opts as CFDictionary) else { return nil }
        return UIImage(cgImage: cg)
    }
}

/// Drop-in replacement for `AsyncImage(url:content:placeholder:)` that actually caches.
struct CachedImage<Content: View, Placeholder: View>: View {
    let url: URL?
    /// Defaults to the tile size, so every existing caller keeps the behaviour it was written for.
    let maxPixel: CGFloat
    let content: (Image) -> Content
    let placeholder: () -> Placeholder
    @State private var ui: UIImage?

    init(url: URL?,
         maxPixel: CGFloat = ImageLoader.tilePixel,
         @ViewBuilder content: @escaping (Image) -> Content,
         @ViewBuilder placeholder: @escaping () -> Placeholder) {
        self.url = url; self.maxPixel = maxPixel; self.content = content; self.placeholder = placeholder
        // Warm hit: seed the state synchronously so the first frame already carries the picture.
        // Without this every avatar draws its placeholder once and swaps a frame later - on a
        // screen full of them (Leaderboard) that reads as a flash of grey on every open, even
        // though nothing was downloaded.
        _ui = State(initialValue: url.flatMap { ImageLoader.memory.object(forKey: ImageLoader.cacheKey($0, maxPixel) as NSURL) })
    }

    var body: some View {
        ZStack {
            if let ui { content(Image(uiImage: ui)) }
            else { placeholder() }
        }
        .task(id: url) {
            // Re-runs when `url` changes (handles row recycling). Cache hits are ~instant;
            // only a true miss touches the network. Skip the redundant write on re-appear.
            guard let url else { ui = nil; return }
            if let img = await ImageLoader.shared.image(for: url, maxPixel: maxPixel), img !== ui { ui = img }
        }
    }
}

/// One picture the full-screen viewer can be opened on. Identifiable so `.fullScreenCover(item:)`
/// can be driven straight from a row.
struct PhotoRef: Identifiable, Hashable {
    let url: URL
    let name: String?
    var id: String { url.absoluteString }
}

/// Full-screen look at one uploaded picture: pinch to zoom, drag to pan, double-tap back to fit.
///
/// It exists because the pictures this app stores are EVIDENCE — a sick note, a ticket photo — and
/// a thumbnail is not something anybody can read. Requested at page size rather than tile size, or
/// enlarging it would only produce a bigger blur.
struct PhotoViewer: View {
    let photo: PhotoRef
    @Environment(\.dismiss) private var dismiss
    @State private var scale: CGFloat = 1
    @State private var committedScale: CGFloat = 1
    @State private var offset: CGSize = .zero
    @State private var committedOffset: CGSize = .zero

    var body: some View {
        ZStack {
            // Black rather than the app background: a photograph is judged against whatever
            // surrounds it, and a pale card behind a dim phone snapshot makes the snapshot look
            // worse than it is.
            Color.black.ignoresSafeArea()
            CachedImage(url: photo.url, maxPixel: ImageLoader.pagePixel) {
                $0.resizable().scaledToFit()
            } placeholder: {
                ProgressView().tint(Color.white)
            }
            .scaleEffect(scale)
            .offset(offset)
            .gesture(magnify)
            .simultaneousGesture(pan)
            .onTapGesture(count: 2) { reset() }
        }
        .overlay(alignment: .top) { bar }
    }

    private var bar: some View {
        HStack(spacing: 10) {
            if let name = photo.name, !name.isEmpty {
                Text(name).font(NXFont.text(13, .semibold)).foregroundStyle(Color.white).lineLimit(1)
            }
            Spacer(minLength: 0)
            Button { dismiss() } label: {
                Image(systemName: "xmark").font(.system(size: 14, weight: .bold)).foregroundStyle(Color.white)
                    .frame(width: 34, height: 34)
                    .background(Color.white.opacity(0.15), in: Circle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(T("Close"))
        }
        .padding(.horizontal, 16).padding(.top, 10)
    }

    private var magnify: some Gesture {
        MagnifyGesture()
            .onChanged { value in scale = min(max(committedScale * value.magnification, 1), 6) }
            .onEnded { _ in
                committedScale = scale
                // Pinching back to fit also puts the picture back in the middle. Left where it was,
                // a fully zoomed-out photo can sit half off the screen with nothing to drag it back.
                if scale <= 1 { reset() }
            }
    }

    private var pan: some Gesture {
        DragGesture()
            .onChanged { value in
                // Dragging an unzoomed picture would only slide it away; there is nothing hidden to
                // bring into view.
                guard scale > 1 else { return }
                offset = CGSize(width: committedOffset.width + value.translation.width,
                                height: committedOffset.height + value.translation.height)
            }
            .onEnded { _ in committedOffset = offset }
    }

    private func reset() {
        withAnimation(.spring(response: 0.3, dampingFraction: 0.85)) {
            scale = 1; committedScale = 1; offset = .zero; committedOffset = .zero
        }
    }
}
