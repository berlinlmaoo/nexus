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

    /// Neither of the two below is view state, and writing them must invalidate nothing.
    @ObservationIgnored private var meter: UploadMeter?
    /// The reveal-then-sample loop while a body is going out, and afterwards the brief hold at 100%.
    /// One handle for both, so starting a second upload during the hold simply cancels it.
    @ObservationIgnored private var driver: Task<Void, Never>?

    /// `nonisolated` because nothing here needs the isolation, and because it lets a view write
    /// `@State private var uploadProgress = UploadProgress()` without leaning on `View`'s own
    /// main-actor inference — which is a property of how the SDK declares that protocol, not of
    /// anything this file controls.
    nonisolated init() {}

    // MARK: - driven by APIClient

    /// A body is going out. The meter handed back is written to from URLSession's delegate queue.
    func start(expecting bytes: Int) -> UploadMeter {
        driver?.cancel()
        let fresh = UploadMeter(expecting: Int64(bytes))
        meter = fresh
        isActive = false
        fraction = 0
        driver = Task { [weak self] in await self?.watch() }
        return fresh
    }

    /// A second attempt over the public host, after the office LAN went silent mid-body. The bytes
    /// that went out are gone with the route, so the bar goes back to zero and climbs again —
    /// carrying on from where a dead route stopped would be a number about nothing.
    ///
    /// A NEW meter rather than a reset one, and that is the whole guard against a backwards jump:
    /// whatever the abandoned task still reports lands in the old meter, which nothing reads any
    /// more. The reveal delay is not re-armed and the bar is not hidden — from where anyone is
    /// standing this is still one upload, and blinking it off and on would say otherwise.
    func restart(expecting bytes: Int) -> UploadMeter {
        let fresh = UploadMeter(expecting: Int64(bytes))
        meter = fresh
        fraction = 0
        return fresh
    }

    /// The server has answered. Fill the bar, hold it there long enough to be seen, then drop it.
    func finish() {
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
        guard !Task.isCancelled, meter != nil else { return }
        isActive = true
        while !Task.isCancelled {
            if let value = meter?.fraction(), value != fraction { fraction = value }
            try? await Task.sleep(for: Self.sampleInterval)
        }
    }
}

/// The only thing that crosses between URLSession's delegate queue and the main actor: two numbers
/// behind a lock.
///
/// A lock rather than an actor or a hop per callback, because the traffic is lopsided — written once
/// per chunk, read ten times a second — and an uncontended `NSLock` costs a fraction of what
/// scheduling anything would. One meter belongs to one URLSession task, which is what keeps an
/// abandoned attempt from writing into the attempt that replaced it.
///
/// `@unchecked Sendable` is a promise the lock actually keeps: every access to the one piece of
/// mutable state below is taken under it, and `expected` never changes after init.
final class UploadMeter: @unchecked Sendable {
    private let lock = NSLock()
    private var sent: Int64 = 0
    private let expected: Int64

    init(expecting bytes: Int64) { expected = bytes }

    /// Called on the session's delegate queue, once per chunk.
    func record(_ totalSent: Int64) {
        lock.lock()
        sent = totalSent
        lock.unlock()
    }

    /// 0…1, measured against the body WE handed to URLSession rather than the delegate's
    /// `totalBytesExpectedToSend`, which is allowed to arrive as `NSURLSessionTransferSizeUnknown`
    /// and would turn the bar into a lie the one time it did.
    func fraction() -> Double {
        guard expected > 0 else { return 0 }
        lock.lock()
        let done = sent
        lock.unlock()
        return min(Double(done) / Double(expected), 1)
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
/// long as the upload lasted.
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
