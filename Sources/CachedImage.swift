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

    func image(for url: URL) async -> UIImage? {
        if let hit = Self.memory.object(forKey: url as NSURL) { return hit }
        if let task = inFlight[url] { return await task.value }   // dedupe concurrent requests

        let task = Task<UIImage?, Never> {
            var req = URLRequest(url: url)
            if url.host == Config.baseURL.host, let s = Keychain.load() {
                req.setValue(s.cookieHeader, forHTTPHeaderField: "Cookie")
            }
            guard let (data, resp) = try? await ImageLoader.session.data(for: req) else { return nil }
            if let http = resp as? HTTPURLResponse, !(200..<300).contains(http.statusCode) { return nil }
            // Every consumer is a small tile (avatar/icon). Decode AND downsample in one ImageIO
            // pass so we never hold a 1280px bitmap to draw into a 56px frame.
            return ImageLoader.downsample(data, maxPixel: 300) ?? UIImage(data: data)
        }
        inFlight[url] = task
        let img = await task.value
        inFlight[url] = nil
        if let img { Self.memory.setObject(img, forKey: url as NSURL) }
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
    let content: (Image) -> Content
    let placeholder: () -> Placeholder
    @State private var ui: UIImage?

    init(url: URL?,
         @ViewBuilder content: @escaping (Image) -> Content,
         @ViewBuilder placeholder: @escaping () -> Placeholder) {
        self.url = url; self.content = content; self.placeholder = placeholder
        // Warm hit: seed the state synchronously so the first frame already carries the picture.
        // Without this every avatar draws its placeholder once and swaps a frame later - on a
        // screen full of them (Leaderboard) that reads as a flash of grey on every open, even
        // though nothing was downloaded.
        _ui = State(initialValue: url.flatMap { ImageLoader.memory.object(forKey: $0 as NSURL) })
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
            if let img = await ImageLoader.shared.image(for: url), img !== ui { ui = img }
        }
    }
}
