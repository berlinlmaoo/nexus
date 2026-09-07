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
// a three-tier cache:
//   • in-memory decoded UIImage (NSCache)  → instant, zero re-decode on re-scroll
//   • on-disk downsampled tiles            → survives relaunch WITH the decode already done
//   • on-disk HTTP cache (URLCache)        → survives relaunch, avoids re-download
//
// The middle tier exists because the bottom one was not enough. URLCache keeps the bytes of the
// ORIGINAL upload, so a relaunch still paid a full-size ImageIO downsample for every avatar on
// screen before it could draw one, and the synchronous warm-seed in `CachedImage.init` — the thing
// that stops the placeholder flashing — only ever looks at the NSCache, which dies with the
// process. `ImageDiskCache` stores the finished tile and is swept back into the NSCache in the
// background at startup, so the second launch paints on the first frame the same faces the first
// launch needed a round trip for.
//
// Decoding happens off the main thread AND off the loader's actor, so neither the first paint of a
// row nor a decode of a neighbouring row blocks the scroll. The NEXUS session cookie is attached for
// URLs on either of the app's own hosts — the public one and the office LAN — so private
// `/api/files` icons load just like the rest of the API, whichever route they took.
// ─────────────────────────────────────────────────────────────────────────────

/// Downsampled pictures kept on disk between launches, under the same (key, maxPixel) identity as
/// the memory cache — a key that deliberately does not name a host, so a face cached at an office
/// desk is still found from the sofa that evening. See `ImageLoader.canonicalKey`.
///
/// It lives inside `Caches/responses/` DELIBERATELY, as a subdirectory of `ResponseCache`'s own
/// folder rather than beside it. Logout calls `ResponseCache.clearAll()`, which removes that whole
/// tree — so the faces of a workspace's staff leave the device together with the roster that named
/// them, with no second call for anybody to remember. `clearAll()` afterwards recreates only its
/// own directory, which is why every write here is prepared to find its directory gone and put it
/// back.
///
/// Everything read back is treated as hostile: a truncated file, a leftover from an older layout,
/// or a collision on the hashed filename all resolve to "miss", and a miss is just a normal fetch.
/// Nothing in here can produce a WRONG or broken picture — at worst it produces no picture, and
/// then the network path runs exactly as it did before this type existed.
actor ImageDiskCache {
    static let shared = ImageDiskCache()

    /// Budget for the whole directory. A 300px tile lands around 20–40 KB, so this holds on the
    /// order of a thousand avatars and icons — far more than one workspace has — while staying
    /// small enough that iOS purging the Caches folder under storage pressure costs the user
    /// nothing worse than one slow launch.
    private static let maxBytes = 40 << 20
    /// A single entry this large is a page-sized photo of a document; anything beyond it is either
    /// a pathological upload or an encode that went wrong, and neither deserves a slice of the
    /// budget that size.
    private static let maxEntryBytes = 2 << 20
    /// How many entries the startup sweep may decode, and how many bytes it may read.
    ///
    /// The count is the constraint that matters, and it is deliberately small. A decoded 300px tile
    /// is around 360 KB of bitmap whatever the file on disk weighs, so this is a promise about
    /// RESIDENT MEMORY at launch, not about disk: 48 of them is roughly 17 MB, about what one busy
    /// screen of avatars already costs. The sweep is meant to cover the first screens somebody
    /// actually opens — Messages, Home — not to rebuild the whole cache; past that it is paying
    /// memory and launch CPU for pictures nobody is going to look at.
    private static let prewarmCount = 48
    private static let prewarmBytes = 8 << 20
    /// Sweeping the directory costs a `stat` per file, so it happens every N writes rather than on
    /// each one. A write only happens on a true miss, so N writes means N pictures never seen
    /// before.
    private static let writesBetweenTrims = 24

    private static let magic: [UInt8] = [0x4E, 0x58, 0x49, 0x31]   // "NXI1"
    private static let headerBytes = 12

    private static let dir: URL = {
        let base = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
        let d = base.appendingPathComponent("responses", isDirectory: true)
                    .appendingPathComponent("images", isDirectory: true)
        try? FileManager.default.createDirectory(at: d, withIntermediateDirectories: true)
        return d
    }()

    nonisolated private static func ensureDir() {
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    }

    // MARK: - Naming

    /// FNV-1a, written out by hand rather than reaching for `hashValue`. Swift's `Hasher` is seeded
    /// per process, so a filename derived from it would be a DIFFERENT filename on the next launch
    /// and this cache would never hit once — which is exactly the bug it exists to fix, and it
    /// would fail silently while looking like it worked.
    nonisolated private static func fingerprint(_ s: String) -> String {
        var h: UInt64 = 0xcbf2_9ce4_8422_2325
        for b in s.utf8 { h = (h ^ UInt64(b)) &* 0x0000_0100_0000_01b3 }
        return String(h, radix: 16)
    }

    /// The pixel size is repeated in the filename even though it also sits inside the file, so the
    /// startup sweep can pick out tile-sized entries by name and never open a page-sized one: a
    /// full-screen photo is not on any list, and decoding one at launch would spend the whole
    /// budget on a picture nobody is looking at.
    ///
    /// An entry written before the key dropped its host hashes to a different name than the one
    /// `load` now computes, so it is simply never opened again — a clean miss and an ordinary
    /// fetch, never a wrong picture. The sweep below still rescues those into memory, and `trim`
    /// reclaims the files in its own time.
    nonisolated private static func fileURL(_ key: URL, _ maxPixel: CGFloat) -> URL {
        dir.appendingPathComponent(fingerprint(key.absoluteString) + "-\(Int(maxPixel)).nxi")
    }

    // MARK: - Container format

    // One file is:  "NXI1" | UInt32 maxPixel | UInt32 key length | key UTF-8 | encoded image
    //
    // The key is written INTO the file, not merely hashed into its name, so a hash collision or a
    // stale file from an older naming scheme is detected rather than quietly handing back somebody
    // else's face — the one failure of an image cache a user would actually report. The startup
    // sweep needs it too: it has files, and it must know which memory-cache key each one goes under.
    //
    // The integers are assembled and read byte by byte on purpose. `Data`'s storage is not
    // guaranteed to be 4-byte aligned, and `load(as: UInt32.self)` against an unaligned buffer is
    // undefined behaviour rather than a slow path.

    nonisolated private static func le32(_ v: UInt32) -> [UInt8] {
        [UInt8(v & 0xff), UInt8((v >> 8) & 0xff), UInt8((v >> 16) & 0xff), UInt8((v >> 24) & 0xff)]
    }

    nonisolated private static func u32(_ d: Data, _ i: Int) -> UInt32 {
        UInt32(d[i]) | (UInt32(d[i + 1]) << 8) | (UInt32(d[i + 2]) << 16) | (UInt32(d[i + 3]) << 24)
    }

    /// JPEG unless the picture carries an alpha channel. Project icons are PNGs with transparent
    /// corners and re-encoding one as JPEG would put a black square behind it; a photograph is the
    /// opposite case — a PNG of it is several times the size of the JPEG for no visible gain, and
    /// this cache is bounded by size.
    nonisolated private static func encode(_ image: UIImage) -> Data? {
        guard let cg = image.cgImage else { return image.pngData() }
        let opaque = cg.alphaInfo == .none || cg.alphaInfo == .noneSkipFirst || cg.alphaInfo == .noneSkipLast
        return opaque ? image.jpegData(compressionQuality: 0.9) : image.pngData()
    }

    /// Builds the bytes of one entry. Kept separate from the write, and off the actor, so the
    /// encode runs on whichever concurrent thread produced the image instead of queueing behind
    /// every other encode — and so nothing but `Data` ever has to cross into the actor.
    nonisolated static func container(for image: UIImage, key: URL, maxPixel: CGFloat) -> Data? {
        guard let payload = encode(image), !payload.isEmpty, payload.count <= maxEntryBytes else { return nil }
        let keyBytes = Array(key.absoluteString.utf8)
        guard !keyBytes.isEmpty, keyBytes.count <= 4096 else { return nil }
        var out = Data(capacity: headerBytes + keyBytes.count + payload.count)
        out.append(contentsOf: magic)
        out.append(contentsOf: le32(UInt32(max(1, Int(maxPixel)))))
        out.append(contentsOf: le32(UInt32(keyBytes.count)))
        out.append(contentsOf: keyBytes)
        out.append(payload)
        return out
    }

    /// Every field is checked against the length actually on disk before it is used, so a truncated
    /// or foreign file returns nil instead of indexing past the end.
    nonisolated private static func parse(_ data: Data) -> (key: String, maxPixel: Int, payload: Data)? {
        let start = data.startIndex
        guard data.count > headerBytes,
              Array(data[start ..< (start + 4)]) == magic else { return nil }
        let px = Int(u32(data, start + 4))
        let keyLen = Int(u32(data, start + 8))
        guard px > 0, px <= 8192, keyLen > 0, keyLen <= 4096,
              data.count > headerBytes + keyLen else { return nil }
        let keyStart = start + headerBytes
        guard let key = String(data: Data(data[keyStart ..< (keyStart + keyLen)]), encoding: .utf8),
              !key.isEmpty else { return nil }
        return (key, px, Data(data[(keyStart + keyLen)...]))
    }

    // MARK: - Reading

    /// Reads and decodes one entry, or returns nil for absolutely any reason.
    ///
    /// Synchronous and off the actor: callers are already on a background thread, and putting reads
    /// behind the actor would serialise a screen's worth of them behind each other and behind every
    /// pending write. Plain read rather than a memory map — mapping would be marginally cheaper,
    /// but it turns a file that vanishes mid-read into a signal instead of an error, and this
    /// directory is swept both by the janitor below and by iOS itself.
    ///
    /// The payload goes back through `downsample` rather than straight into `UIImage(data:)` for
    /// two reasons: it forces the decode to happen HERE, off the main thread, instead of lazily
    /// during the first draw, and it clamps whatever the file contains to the size that was asked
    /// for, so a corrupt or swapped entry cannot expand into a full-resolution bitmap.
    nonisolated static func load(key: URL, maxPixel: CGFloat) -> UIImage? {
        let file = fileURL(key, maxPixel)
        guard let data = try? Data(contentsOf: file) else { return nil }
        guard let entry = parse(data),
              entry.key == key.absoluteString,
              entry.maxPixel == Int(maxPixel),
              let image = ImageLoader.downsample(entry.payload, maxPixel: maxPixel) else {
            // Unreadable, or not the picture this filename claims. Drop it so the next launch does
            // not pay to find out the same thing again. The caller falls through to the network and
            // the user sees nothing unusual.
            try? FileManager.default.removeItem(at: file)
            return nil
        }
        return image
    }

    // MARK: - Startup sweep

    /// Starts the disk → memory sweep, once per process.
    ///
    /// `CachedImage.init` calls this, so it runs on the main thread and must therefore do nothing
    /// but a `swift_once` check and, the first time, spawn a task. No file is touched here. An
    /// earlier audit found main-thread disk reads inside `init`/`.task` to be a real source of
    /// hitching, and seeding a cache is not worth reintroducing that.
    nonisolated static func prewarm() { _ = prewarmStarted }

    private static let prewarmStarted: Bool = {
        Task(priority: .utility) {
            await ImageDiskCache.sweepIn()
            // Also the only trim that is guaranteed to run. The counted one below needs a session
            // that fetches enough new pictures to reach its threshold, and plenty of sessions end
            // long before that — without this pass the directory could creep past its budget one
            // short launch at a time.
            await ImageDiskCache.shared.trim()
        }
        return true
    }()

    /// Newest entries first, tile-sized only, bounded by count and by bytes. Yields between
    /// pictures so this background catch-up can never hold on to a cooperative thread through a
    /// scroll.
    nonisolated private static func sweepIn() async {
        let fm = FileManager.default
        let wanted: [URLResourceKey] = [.contentModificationDateKey, .fileSizeKey]
        guard let files = try? fm.contentsOfDirectory(at: dir,
                                                      includingPropertiesForKeys: wanted,
                                                      options: [.skipsHiddenFiles]) else { return }
        let tileSuffix = "-\(Int(ImageLoader.tilePixel)).nxi"
        var rows: [(url: URL, at: Date, size: Int)] = []
        for f in files where f.lastPathComponent.hasSuffix(tileSuffix) {
            let v = try? f.resourceValues(forKeys: Set(wanted))
            rows.append((f, v?.contentModificationDate ?? Date.distantPast, v?.fileSize ?? 0))
        }
        rows.sort { $0.at > $1.at }

        var remaining = prewarmCount
        var budget = prewarmBytes
        for row in rows {
            if remaining <= 0 || budget <= 0 { break }
            remaining -= 1
            budget -= row.size
            guard let data = try? Data(contentsOf: row.url),
                  let entry = parse(data),
                  let stored = URL(string: entry.key) else { continue }
            // Through the same canonicalisation the live path uses, so an entry written back when
            // the key still carried a host lands under the key that will actually be looked up. The
            // sweep is the only thing that can rescue those files: their FILENAME no longer matches
            // what `load` computes, so nothing else will ever open them again.
            let key = ImageLoader.canonicalKey(stored)
            // Something already loaded this one the ordinary way; that decode is at least as fresh
            // as ours and replacing it would only churn the cache.
            if ImageLoader.memory.object(forKey: key as NSURL) != nil { continue }
            guard let image = ImageLoader.downsample(entry.payload, maxPixel: CGFloat(entry.maxPixel)) else { continue }
            ImageLoader.memory.setObject(image, forKey: key as NSURL)
            await Task.yield()
        }
    }

    // MARK: - Writing — the only part that has to be serialised

    private var writesSinceTrim = 0

    func write(_ bytes: Data, key: URL, maxPixel: CGFloat) {
        let file = Self.fileURL(key, maxPixel)
        if !store(bytes, at: file) {
            // Nearly always means logout removed the enclosing `responses` tree while this task was
            // in flight. Put the directory back and try once more; if that fails too the cache
            // simply does not persist, which is a slower app, not a broken one.
            Self.ensureDir()
            _ = store(bytes, at: file)
        }
        writesSinceTrim += 1
        if writesSinceTrim >= Self.writesBetweenTrims {
            writesSinceTrim = 0
            trim()
        }
    }

    /// `.atomic` so an entry is never half-written: a reader sees the old file or the new one, and
    /// an interrupted write leaves a temporary file for iOS to reclaim rather than a torn entry
    /// that decodes to nonsense.
    private func store(_ data: Data, at file: URL) -> Bool {
        do { try data.write(to: file, options: .atomic); return true } catch { return false }
    }

    /// Oldest first, down to well under the limit rather than exactly to it — trimming to the line
    /// would mean sweeping the whole directory again after the very next picture.
    func trim() {
        let fm = FileManager.default
        let wanted: [URLResourceKey] = [.contentModificationDateKey, .fileSizeKey]
        guard let files = try? fm.contentsOfDirectory(at: Self.dir,
                                                      includingPropertiesForKeys: wanted,
                                                      options: [.skipsHiddenFiles]) else { return }
        var rows: [(url: URL, at: Date, size: Int)] = []
        var total = 0
        for f in files {
            let v = try? f.resourceValues(forKeys: Set(wanted))
            let size = v?.fileSize ?? 0
            total += size
            rows.append((f, v?.contentModificationDate ?? Date.distantPast, size))
        }
        guard total > Self.maxBytes else { return }
        let target = Self.maxBytes * 3 / 4
        rows.sort { $0.at < $1.at }
        for row in rows where total > target {
            try? fm.removeItem(at: row.url)
            total -= row.size
        }
    }
}

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

    /// A cached picture is (which picture, what size). The same picture can legitimately be wanted
    /// as a 300px tile in a row AND as a full-screen page one tap later; keyed on its identity
    /// alone, whichever was decoded first would be handed to both.
    nonisolated static func cacheKey(_ url: URL, _ maxPixel: CGFloat) -> URL {
        let base = canonicalKey(url)
        guard maxPixel != tilePixel else { return base }
        return URL(string: base.absoluteString + "#px\(Int(maxPixel))") ?? base
    }

    /// The picture, with the route it happened to arrive by stripped off.
    ///
    /// `lan.nexus…/api/files/x.png` and `nexus…/api/files/x.png` are one picture reached two ways,
    /// so the host cannot be part of what identifies it. With it in the key, every walk between the
    /// office and anywhere else would miss on a whole screen at once and then write a SECOND copy of
    /// every face into a cache that is bounded by bytes — paying twice to be slower.
    ///
    /// What is left is path AND query, and the query has to stay: an avatar's file name is only the
    /// user's id, and the `?t=` stamp the upload route appends is the single thing that tells a new
    /// picture from the one it replaced. Dropping it would pin somebody to a face they changed.
    ///
    /// A URL on any other host keeps its host, where the host genuinely is part of which picture
    /// this is. The two kinds cannot collide: what comes back from here has no scheme, so it can
    /// never be mistaken for an absolute URL.
    ///
    /// A prefix match and a slice, not a parse into components and back. This runs inside
    /// `CachedImage.init` — on the main thread, once per row, on every rebuild — so it stays as
    /// close to free as the memory-cache peek it feeds. It also cannot re-encode anything: what
    /// comes out is a substring of a string the URL already produced.
    fileprivate nonisolated static func canonicalKey(_ url: URL) -> URL {
        let whole = url.absoluteString
        for prefix in ownPrefixes where whole.hasPrefix(prefix) {
            let rest = whole.dropFirst(prefix.count)
            // The prefix ends at the host, so `https://nexus.znetworks.id.example.com/x` starts
            // with it too. Only a path boundary makes this ours. An empty remainder — a nil project
            // icon concatenated onto the base URL, which several screens really do build — fails
            // the same test, and it is not an identity for anything anyway.
            guard rest.hasPrefix("/") else { continue }
            return URL(string: String(rest)) ?? url
        }
        return url
    }

    /// The two absolute prefixes one NEXUS picture can arrive under, resolved once at startup.
    private static let ownPrefixes = [Config.baseURL.absoluteString, Config.lanBaseURL.absoluteString]

    func image(for url: URL, maxPixel: CGFloat = ImageLoader.tilePixel) async -> UIImage? {
        let key = Self.cacheKey(url, maxPixel)
        if let hit = Self.memory.object(forKey: key as NSURL) { return hit }
        if let task = inFlight[key] { return await task.value }   // dedupe concurrent requests

        // The body of this task USED to be written inline here. `Task { }` inherits the isolation of
        // the context that creates it, so everything inside ran on THIS actor's executor —
        // including `downsample`, a synchronous multi-millisecond ImageIO job. Two consequences,
        // neither of them visible in the code and both very visible on a screen full of avatars: no
        // two pictures could decode at the same time even on an idle six-core phone, and every
        // other caller queued behind whichever decode was running — including callers that only
        // wanted to read the memory cache and return. `fetch` is `nonisolated async`, which runs on
        // the generic concurrent executor, so the work leaves this actor at the first await and
        // only the bookkeeping below stays here, where it has to be.
        let task = Task<UIImage?, Never> { await Self.fetch(url, key: key, maxPixel: maxPixel) }
        inFlight[key] = task
        let img = await task.value
        inFlight[key] = nil
        if let img { Self.memory.setObject(img, forKey: key as NSURL) }
        return img
    }

    /// Disk first, then the network. Deliberately not isolated to the actor — see `image(for:)`.
    nonisolated private static func fetch(_ url: URL, key: URL, maxPixel: CGFloat) async -> UIImage? {
        // The disk tier is consulted BEFORE URLSession, even though URLSession has a cache of its
        // own, because the two hold different things: URLCache holds the bytes of the original
        // upload, so answering from it still costs a full-size ImageIO downsample, while a disk
        // entry is already the tile about to be drawn. It also adds no staleness the app did not
        // already have — the server marks these `immutable` for a year, and an avatar URL carries
        // the upload time, so one URL is one picture, permanently.
        if let cached = ImageDiskCache.load(key: key, maxPixel: maxPixel) { return cached }

        // The REQUEST always uses the real URL — neither the size nor the route lives in it, so
        // no fragment ever reaches the server and the cache key never depends on which host did.
        var req = APIClient.routedRequest(for: url)
        if Config.isNexusHost(url), let s = Keychain.load() {
            req.setValue(s.cookieHeader, forHTTPHeaderField: "Cookie")
        }
        // Through `perform`, so a picture takes the office LAN and, when the LAN stops answering,
        // falls back to the internet instead of failing. That fallback had to be decided rather than
        // inherited, and it is safe here for a reason that does not generalise: the rule that makes
        // an automatic replay dangerous is about writes, and this is a GET — fetching a picture
        // twice costs one round trip and changes nothing anywhere. Not retrying costs a screen of
        // grey squares the moment somebody walks out of the building, held there until the row is
        // recycled, because nothing here remembers or re-drives a failure. A refusal the server
        // actually SENT — 401, 404 — is a response and not a thrown error, so it never reaches the
        // replay at all and cannot loop. Its own session, not the shared one, so the image URLCache
        // this loader exists for is still the thing answering.
        guard let (data, resp) = try? await APIClient.shared.perform(req, on: ImageLoader.session) else { return nil }
        if let http = resp as? HTTPURLResponse, !(200..<300).contains(http.statusCode) { return nil }
        // Almost every consumer is a small tile (avatar/icon). Decode AND downsample in one
        // ImageIO pass so we never hold a 1280px bitmap to draw into a 56px frame.
        guard let img = ImageLoader.downsample(data, maxPixel: maxPixel) ?? UIImage(data: data) else { return nil }
        // Encode here, on this concurrent thread, and hand the actor nothing but bytes. Awaiting the
        // write costs this one picture a file write on top of a network round trip it has already
        // paid for, and in exchange the entry is on disk before anything can cancel it.
        if let bytes = ImageDiskCache.container(for: img, key: key, maxPixel: maxPixel) {
            await ImageDiskCache.shared.write(bytes, key: key, maxPixel: maxPixel)
        }
        return img
    }

    /// Decode + downscale to `maxPixel` (longest edge) in a single ImageIO pass — the WWDC
    /// "Image and Graphics Best Practices" pattern. Honors EXIF orientation; caches the decoded
    /// bitmap immediately so the first draw on the main thread is cheap. ImageIO never enlarges, so
    /// passing something already smaller than `maxPixel` back through here is safe.
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
        // The first picture the app asks for is the cue to start refilling the memory cache from
        // disk. After that first call this is a once-check and nothing more, and it never touches a
        // file on this thread. It is done here rather than at launch because here is the earliest
        // moment the app has actually shown it cares about pictures.
        ImageDiskCache.prewarm()
        // Warm hit: seed the state synchronously so the first frame already carries the picture.
        // Without this every avatar draws its placeholder once and swaps a frame later - on a
        // screen full of them (Leaderboard) that reads as a flash of grey on every open, even
        // though nothing was downloaded. Still a memory-cache read and nothing else: the sweep
        // started above is what gives this line something to find on the second launch, precisely
        // so that it never has to go near the disk on the main thread.
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
