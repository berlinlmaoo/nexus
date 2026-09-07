import Foundation
import Observation
import SwiftUI

/// How far an upload has actually got, carried from URLSession's delegate queue to the one view that
/// draws it.
///
/// `URLSession.data(for:)` — the call every request in this client used to go through — returns when
/// the whole exchange is over and says nothing on the way, so a 40 KB attachment and a 40 MB one
/// looked identical from a screen: a spinner, for however long it took. Watching a body go out needs
/// an upload task with a delegate, which is why this lives at the transport layer instead of being a
/// bar somebody added to a card.
///
/// One instance belongs to one screen and is handed to `APIClient` for the length of one call, so
/// nothing global has to know which screen is uploading, and two screens uploading at once cannot
/// read each other's numbers.
///
/// It meters bytes coming IN as well, and the name is the only thing about it that is still purely
/// about uploads. A download reports its progress through a different callback but needs the same
/// three things — a reveal delay, a sampled reading, a hold at the end — and giving downloads their
/// own near-identical copy would have been the more expensive kind of honesty.
@MainActor
@Observable
final class UploadProgress {

    /// Whether there is a bar to draw at all. It flips twice in the life of an upload, so a
    /// container that reads it — the attachments card, with its list of files — is rebuilt twice
    /// rather than ten times a second. The fraction itself is deliberately NOT read there.
    private(set) var isActive = false

    /// 0…1, and read only by `UploadProgressBar`. Observation tracks per property, so bytes moving
    /// invalidate a 6pt capsule and nothing above it.
    private(set) var fraction: Double = 0

    /// Nothing is drawn until an upload has proved it is slow enough to be worth watching. A 97 KB
    /// file over the office LAN is finished inside this window, and a bar that appears and vanishes
    /// in 40 ms reads as a glitch rather than as information.
    private static let revealDelay: Duration = .milliseconds(280)

    /// How often the meter is read, and the entire budget this spends on the main thread — the same
    /// ten reads a second whether the link is a phone mast or a switch three metres away.
    private static let sampleInterval: Duration = .milliseconds(100)

    /// A bar that disappears the instant it fills reads as something having gone wrong. Long enough
    /// to register as finished, short enough that nobody is kept waiting by it.
    private static let fullHold: Duration = .milliseconds(220)

    /// None of the four below is view state, and writing them must invalidate nothing.
    @ObservationIgnored private var meter: UploadMeter?
    /// The size of a transfer that goes out in several requests, and how much of it is already up.
    /// Both zero for the ordinary case of one request carrying one body, which is what every check
    /// on `whole` below is really asking.
    @ObservationIgnored private var whole: Int64 = 0
    @ObservationIgnored private var landed: Int64 = 0
    /// The reveal-then-sample loop while a body is going out, and afterwards the brief hold at 100%.
    /// One handle for both, so starting a second upload during the hold simply cancels it.
    @ObservationIgnored private var driver: Task<Void, Never>?

    /// `nonisolated` because nothing here needs the isolation, and because it lets a view write
    /// `@State private var uploadProgress = UploadProgress()` without leaning on `View`'s own
    /// main-actor inference — which is a property of how the SDK declares that protocol, not of
    /// anything this file controls.
    nonisolated init() {}

    // MARK: - driven by APIClient

    /// A body is going out, or a file is coming in. The meter handed back is written to from
    /// URLSession's delegate queue.
    func start(expecting bytes: Int) -> UploadMeter {
        let fresh = UploadMeter(expecting: Int64(bytes))
        // Mid-run of a chunked body this is the NEXT chunk of an upload already being drawn, so the
        // bar is not reset and the reveal delay is not re-armed. Blinking it off and starting the
        // count again between chunks would say a second upload had begun.
        guard whole == 0 else { meter = fresh; return fresh }
        driver?.cancel()
        meter = fresh
        isActive = false
        fraction = 0
        driver = Task { [weak self] in await self?.watch() }
        return fresh
    }

    /// A body too large for one request. Cloudflare refuses anything past about 100 MB, so a large
    /// attachment goes up as a run of chunks — see `APIClient.uploadAttachmentInChunks`.
    ///
    /// Between this and `endWhole` the fraction is measured against the WHOLE file rather than
    /// against the chunk in flight, and each chunk's own `finish()` only banks what it sent. Without
    /// that the bar would fill and vanish once per chunk: nine bars for a 140 MB file, which says
    /// less than the spinner this replaced.
    func beginWhole(bytes: Int64) {
        driver?.cancel()
        whole = bytes
        landed = 0
        meter = nil
        isActive = false
        fraction = 0
        driver = Task { [weak self] in await self?.watch() }
    }

    /// The last chunk is up. The bar stops being measured against a whole and resolves the way every
    /// other upload in the app resolves. A run that FAILED calls `stop()` instead.
    func endWhole() {
        whole = 0
        landed = 0
        finish()
    }

    /// A second attempt over the public host, after the office LAN went silent mid-body. The bytes
    /// that went out are gone with the route, so the bar goes back to the start of what is being
    /// re-sent — carrying on from where a dead route stopped would be a number about nothing.
    ///
    /// A NEW meter rather than a reset one, and that is the whole guard against a backwards jump:
    /// whatever the abandoned task still reports lands in the old meter, which nothing reads any
    /// more. The reveal delay is not re-armed and the bar is not hidden — from where anyone is
    /// standing this is still one upload, and blinking it off and on would say otherwise.
    func restart(expecting bytes: Int) -> UploadMeter {
        let fresh = UploadMeter(expecting: Int64(bytes))
        meter = fresh
        // Mid-run of a chunked body the bar drops back only as far as the start of THIS chunk:
        // everything banked before it did reach the server and is not being sent a second time.
        if whole == 0 { fraction = 0 }
        return fresh
    }

    /// The server has answered. Fill the bar, hold it there long enough to be seen, then drop it.
    func finish() {
        // Mid-run of a chunked body this is one chunk landing, not the upload finishing: bank what
        // went out and leave the bar exactly where it is, for the next chunk to carry on from.
        if whole > 0 {
            landed += meter?.bytesSent() ?? 0
            meter = nil
            return
        }
        driver?.cancel()
        guard isActive else {
            // Never drawn: the upload beat the reveal delay, so there is nothing to resolve.
            clear()
            return
        }
        meter = nil
        fraction = 1
        driver = Task { [weak self] in
            try? await Task.sleep(for: Self.fullHold)
            guard !Task.isCancelled else { return }
            self?.clear()
        }
    }

    /// Anything that is not success: a refusal, a link that died, a tap somebody took back. The bar
    /// goes at once — one left stuck at 40% is the "is this still going?" state this change exists
    /// to remove.
    func stop() {
        driver?.cancel()
        clear()
    }

    // MARK: - internals

    private func clear() {
        driver = nil
        meter = nil
        whole = 0
        landed = 0
        isActive = false
        fraction = 0
    }

    /// Sampling, not being called back.
    ///
    /// `didSendBodyData` fires once per chunk — hundreds of times a second over the office LAN — and
    /// every one of those would otherwise be a hop onto the main actor and a view invalidation, on a
    /// screen that is also a scroll view. Reading two integers on a timer costs the same however
    /// fast the bytes are moving, which puts a ceiling on this that does not depend on the network.
    private func watch() async {
        try? await Task.sleep(for: Self.revealDelay)
        guard !Task.isCancelled, whole > 0 || meter != nil else { return }
        isActive = true
        while !Task.isCancelled {
            let value = reading()
            if value != fraction { fraction = value }
            try? await Task.sleep(for: Self.sampleInterval)
        }
    }

    /// 0…1 for whatever is being watched: the body of one request, or the whole of a body split over
    /// several. With no meter to read — between two chunks, or after the last one — the bar holds
    /// the number it already had rather than falling back to zero.
    private func reading() -> Double {
        guard whole > 0 else { return meter?.fraction() ?? fraction }
        return min(Double(landed + (meter?.bytesSent() ?? 0)) / Double(whole), 1)
    }
}

/// The only thing that crosses between URLSession's delegate queue and the main actor: two counters
/// behind a lock.
///
/// A lock rather than an actor or a hop per callback, because the traffic is lopsided — written once
/// per chunk, read ten times a second — and an uncontended `NSLock` costs a fraction of what
/// scheduling anything would. One meter belongs to one URLSession task, which is what keeps an
/// abandoned attempt from writing into the attempt that replaced it.
///
/// `@unchecked Sendable` is a promise the lock actually keeps: every access to the two pieces of
/// mutable state below is taken under it, and `expected` never changes after init.
final class UploadMeter: @unchecked Sendable {
    private let lock = NSLock()
    private var sent: Int64 = 0
    private let expected: Int64
    /// Set only for a download, which counts itself — see `follow`. Weak because a meter must not be
    /// the thing keeping a task alive: one that has finished or been cancelled is free to go.
    private weak var followed: URLSessionTask?

    init(expecting bytes: Int64) { expected = bytes }

    /// Called on the session's delegate queue, once per chunk.
    func record(_ totalSent: Int64) {
        lock.lock()
        sent = totalSent
        lock.unlock()
    }

    /// A download task to read the numbers off, instead of being told them.
    ///
    /// The callback that reports bytes ARRIVING belongs to `URLSessionDownloadDelegate`, and
    /// conforming to that protocol means implementing `didFinishDownloadingTo` — the one method
    /// `URLSession.download(for:)` needs for itself in order to hand the finished file back. Reading
    /// the task's own counters leaves that alone entirely, and costs the same ten reads a second the
    /// upload bar was already paying for. See `DownloadReporter`.
    func follow(_ task: URLSessionTask) {
        lock.lock()
        followed = task
        lock.unlock()
    }

    /// What has actually gone out, for a caller composing several requests into one bar.
    func bytesSent() -> Int64 {
        lock.lock()
        defer { lock.unlock() }
        return sent
    }

    /// 0…1, measured against the body WE handed to URLSession rather than the delegate's
    /// `totalBytesExpectedToSend`, which is allowed to arrive as `NSURLSessionTransferSizeUnknown`
    /// and would turn the bar into a lie the one time it did.
    ///
    /// A download has no body we handed over, so it is measured against what the task says it is
    /// still expecting — and that number IS allowed to be unknown, which is why an unknown one reads
    /// as 0 rather than as a full bar. In practice `/api/files` always sends a Content-Length.
    func fraction() -> Double {
        lock.lock()
        let done = sent
        let task = followed
        lock.unlock()
        if let task {
            let total = task.countOfBytesExpectedToReceive
            guard total > 0 else { return 0 }
            return min(Double(task.countOfBytesReceived) / Double(total), 1)
        }
        guard expected > 0 else { return 0 }
        return min(Double(done) / Double(expected), 1)
    }
}

/// Hands a download's task to the meter, which then reads it.
///
/// Deliberately a `URLSessionTaskDelegate` and NOT a `URLSessionDownloadDelegate`: the byte-by-byte
/// callback lives on the latter, but so does `didFinishDownloadingTo`, which is the method
/// `URLSession.download(for:)` relies on to hand the finished file back to its caller. Conforming in
/// order to watch would mean stepping between that call and its own file. `didCreateTask` gives us
/// the task itself, and the task has been counting all along.
final class DownloadReporter: NSObject, URLSessionTaskDelegate {
    private let meter: UploadMeter

    init(_ meter: UploadMeter) { self.meter = meter }

    func urlSession(_ session: URLSession, didCreateTask task: URLSessionTask) {
        meter.follow(task)
    }
}

/// Turns URLSession's byte callbacks into meter readings, for one task.
///
/// Per-task rather than per-session on purpose: `upload(for:from:delegate:)` holds this until the
/// task completes or fails, so nothing else has to keep it alive, and the sessions this client
/// sends through — `URLSession.shared`, and `ImageLoader`'s — were not built with a delegate and
/// must not be rebuilt with one.
final class UploadReporter: NSObject, URLSessionTaskDelegate {
    private let meter: UploadMeter

    init(_ meter: UploadMeter) { self.meter = meter }

    func urlSession(_ session: URLSession, task: URLSessionTask, didSendBodyData bytesSent: Int64,
                    totalBytesSent: Int64, totalBytesExpectedToSend: Int64) {
        meter.record(totalBytesSent)
    }
}

/// The bar, and the only reader of `fraction` — which is the point of it being its own view. Drawn
/// inline, a card would rebuild its whole body, attachment list included, ten times a second for as
/// long as the transfer lasted.
///
/// Direction-agnostic: the same capsule is drawn over a file going out and one coming in. What is
/// moving is said by whatever the caller puts beside it, not by this.
///
/// Same shape as every other progress bar in the app (sprints, project health, mission energy): a
/// muted capsule track under a filled one, in the brand fill token.
struct UploadProgressBar: View {
    let progress: UploadProgress

    var body: some View {
        let value = progress.fraction
        HStack(spacing: 8) {
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    Capsule().fill(NX.muted)
                    Capsule().fill(NX.violet).frame(width: geo.size.width * value)
                }
            }
            .frame(height: 6)
            Text("\(Int(value * 100))%")
                .font(NXFont.text(10, .medium).monospacedDigit())
                .foregroundStyle(NX.mutedFg)
                .fixedSize()
        }
        // Ten samples a second is a step every 100 ms; matching the animation to the interval makes
        // it read as one continuous move. Going back to zero is a replay starting over rather than
        // ground being lost, so that one step is deliberately not animated.
        .animation(value == 0 ? nil : .linear(duration: 0.1), value: value)
    }
}
