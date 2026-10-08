import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// The realtime connection itself: one Socket.IO v4 client socket to NEXUS over a WebSocket
/// (`URLSessionWebSocketTask`, no third-party package), kept alive, brought back after a drop, and
/// told which rooms to be in.
///
/// It knows nothing about the app. When to connect, where the session comes from and what an event
/// means are all handed in by RealtimeClient — which is what lets this file and SocketIOProtocol.swift
/// run against a real socket.io server on Linux, where SwiftUI does not exist.
///
/// One attempt goes:
///   1. `bootstrap` (GET /api/realtime-init). The server attaches its Socket.IO engine lazily, on the
///      first request to that route after a restart; until then an upgrade to /api/socket is
///      swallowed by Next.js and never answered (seen on production, 8 Oct 2026). The web does the
///      same call before every connect.
///   2. The WebSocket upgrade, carrying the session Cookie (pages/api/socket.ts reads it in `io.use`).
///   3. `0{…}` open → send `40` → `40{sid}` connected, or `44{message}` refused.
///   4. Connected: join `user:<me>` and every room a screen holds, start the heartbeat, report.
/// Then the server pings (`2`) every pingInterval and gets `3` back. Anything that ends the link — a
/// close, `41`, an error, or silence longer than pingInterval + pingTimeout — schedules the next
/// attempt after a backoff, unless the server refused the session itself.
///
/// Main actor only. Every callback below is called on it.
@MainActor
final class RealtimeEngine {
    enum State: Equatable {
        /// Not wanted (signed out, app in the background), or never started.
        case off
        /// The first attempt after `start()`.
        case connecting
        case connected
        /// Lost, or not through yet after a failure: the next attempt is scheduled or running.
        case reconnecting
        /// The server refused the session itself (signed out elsewhere, offboarded, revoked). No
        /// retry can change that answer, so none is made until `clearRefusal()` — a new sign-in.
        case refused
    }

    struct Settings {
        /// From the start of an attempt to the server's `40{sid}`. Also what rescues an upgrade the
        /// server never answers.
        var connectTimeout: TimeInterval = 15
        /// How long a room nobody holds any more stays joined, so a screen replaced by another
        /// screen of the same project does not leave and rejoin.
        var leaveGrace: TimeInterval = 2
        /// The web client's presence heartbeat period.
        var heartbeat: TimeInterval = 30
        var backoffBase: Double = 1
        var backoffCap: Double = 30
        /// A link that stayed up this long counts as healthy: the next drop starts the backoff over.
        /// A link that dies right after connecting keeps backing off instead of hammering the server.
        var stableAfter: TimeInterval = 30
    }

    // MARK: hooks

    /// The upgrade request for a new attempt: URL, Cookie and headers. nil = no session, stop.
    var makeRequest: @MainActor () -> URLRequest? = { nil }
    /// Who is connecting: the `user:<id>` room and the `join-room` payload.
    var identity: @MainActor () -> (userId: String, name: String)? = { nil }
    /// Awaited before every attempt; see step 1 above.
    var bootstrap: (@MainActor () async -> Void)?
    var onState: (@MainActor (State) -> Void)?
    /// After every successful connect, once the rooms are joined. Events sent while the link was
    /// down are gone for good, so this is the moment to catch up.
    var onConnected: (@MainActor () -> Void)?
    /// Every server event but `join-denied`: its name and first argument.
    var onEvent: (@MainActor (String, SIOJSON?) -> Void)?
    /// The server refused a room (`join-denied`).
    var onDenied: (@MainActor (String) -> Void)?
    /// 0..<1, for the backoff jitter. Replaceable so tests can pin it.
    var random: @MainActor () -> Double = { Double.random(in: 0..<1) }

    // MARK: state

    private(set) var state: State = .off {
        didSet { if state != oldValue { onState?(state) } }
    }
    /// Why the last link ended, for diagnostics.
    private(set) var lastDrop: String?
    let settings: Settings

    private let session: URLSession
    private var wanted = false
    private var link: SocketLink?
    private var linkCount = 0
    /// Failed attempts since the last healthy link: the backoff step.
    private var attempt = 0
    private var retry: Task<Void, Never>?
    /// How many screens hold each room right now.
    private var holders: [String: Int] = [:]
    /// Rooms nobody holds, still joined on the server until their grace period ends.
    private var leaving: [String: Task<Void, Never>] = [:]

    init(settings: Settings = Settings()) {
        self.settings = settings
        // Its own session, stateless: the session cookie is written on each request by hand (the same
        // way APIClient does it), so nothing here may store a cookie, or add one from a shared jar.
        let config = URLSessionConfiguration.ephemeral
        config.httpCookieStorage = nil
        config.httpShouldSetCookies = false
        config.urlCache = nil
        session = URLSession(configuration: config)
    }

    var isConnected: Bool { state == .connected }

    /// Every room this socket is in or about to leave, besides `user:<me>` and the rooms the server
    /// assigns by itself.
    var rooms: Set<String> { Set(holders.keys).union(leaving.keys) }

    // MARK: control

    /// Wanted from now on: connect if not connected or connecting. During a backoff pause this tries
    /// at once — the person just brought the app to the front, which beats waiting out a timer.
    func start() {
        wanted = true
        guard state != .refused, link == nil else { return }
        retry?.cancel()
        retry = nil
        open()
    }

    /// Not wanted: close the link and stop retrying. A refusal stays a refusal.
    func stop() {
        wanted = false
        retry?.cancel()
        retry = nil
        if let link { end(link, code: .normalClosure) }
        link = nil
        attempt = 0
        if state != .refused { state = .off }
    }

    /// A new session: whatever the server said about the last one no longer applies.
    func clearRefusal() {
        attempt = 0
        if state == .refused { state = .off }
    }

    /// A screen wants this room's events. Counted: two screens of the same project hold it twice and
    /// it is left only when both have let go.
    func join(_ room: String) {
        holders[room, default: 0] += 1
        // Let go of a moment ago and still joined on the server: nothing to send.
        if let pending = leaving.removeValue(forKey: room) {
            pending.cancel()
            return
        }
        guard holders[room] == 1, let link, link.connectedAt != nil, let me = identity() else { return }
        sendJoin(room, as: me, on: link)
    }

    func leave(_ room: String) {
        guard let n = holders[room] else { return }
        if n > 1 {
            holders[room] = n - 1
            return
        }
        holders[room] = nil
        leaving[room]?.cancel()
        leaving[room] = after(settings.leaveGrace) { [weak self] in
            guard let self, self.leaving.removeValue(forKey: room) != nil, self.holders[room] == nil else { return }
            if let link = self.link, link.connectedAt != nil {
                self.send(SIOWire.event("leave-room", .string(room)), on: link)
            }
        }
    }

    // MARK: one attempt

    private func open() {
        linkCount += 1
        let link = SocketLink(id: linkCount)
        self.link = link
        state = attempt == 0 ? .connecting : .reconnecting
        // Covers the whole attempt, bootstrap included: a server that never answers the upgrade (or
        // the bootstrap) is a failed attempt like any other.
        link.deadline = after(settings.connectTimeout) { [weak self] in self?.lost(link, "connect timeout") }
        Task { [weak self] in
            if let bootstrap = self?.bootstrap { await bootstrap() }
            guard let self, self.link === link else { return }
            guard let request = self.makeRequest() else {
                // Signed out while bootstrapping: nothing to connect as.
                self.stop()
                return
            }
            let task = self.session.webSocketTask(with: request)
            // Task and comment payloads are whole objects; the default 1 MB is a ceiling worth raising.
            task.maximumMessageSize = 8 << 20
            link.task = task
            task.resume()
            self.listen(link, task)
        }
    }

    private func listen(_ link: SocketLink, _ task: URLSessionWebSocketTask) {
        Task { [weak self] in
            while true {
                let message: URLSessionWebSocketTask.Message
                do {
                    message = try await task.receive()
                } catch {
                    self?.lost(link, "receive failed: \(error.localizedDescription)")
                    return
                }
                guard let self, self.link === link else { return }
                switch message {
                case .string(let text):
                    self.handle(SIOFrame(text), on: link)
                case .data:
                    break // binary attachments: nothing NEXUS emits carries any
                @unknown default:
                    break
                }
            }
        }
    }

    private func handle(_ frame: SIOFrame, on link: SocketLink) {
        // Any frame is proof the link is alive.
        if link.opened { watch(link) }
        switch frame {
        case .open(let info):
            guard !link.opened else { return }
            link.opened = true
            if let handshake = SIOHandshake(info) {
                link.pingWindow = Double(handshake.pingInterval + handshake.pingTimeout) / 1000
            }
            watch(link)
            send(SIOWire.connect, on: link)
        case .ping(let data):
            send(SIOWire.pong(data), on: link)
        case .connect(let namespace, _) where namespace == "/":
            connected(link)
        case .connectError(let namespace, let payload) where namespace == "/":
            if SIOConnectRefusal.isSessionRefused(payload) {
                refused(link, payload?["message"]?.string ?? "refused")
            } else {
                lost(link, "connect error: \(payload?["message"]?.string ?? frame.text)")
            }
        case .disconnect(let namespace) where namespace == "/":
            lost(link, "server disconnect")
        case .close:
            lost(link, "server close")
        case .event(let namespace, _, let name, let args) where namespace == "/":
            guard link.connectedAt != nil else { return }
            if name == "join-denied" {
                onDenied?(args.first?["room"]?.string ?? "")
            } else {
                onEvent?(name, args.first)
            }
        default:
            break
        }
    }

    private func connected(_ link: SocketLink) {
        guard link.connectedAt == nil else { return }
        link.deadline?.cancel()
        link.connectedAt = Date()
        // The server forgets every room with the old link; a room on its way out is simply not rejoined.
        if let me = identity() {
            sendJoin("user:\(me.userId)", as: me, on: link)
            for room in holders.keys.sorted() { sendJoin(room, as: me, on: link) }
        }
        link.heartbeat = every(settings.heartbeat) { [weak self] in
            self?.send(SIOWire.event("heartbeat"), on: link)
        }
        lastDrop = nil
        state = .connected
        onConnected?()
    }

    /// The link ended for a reason a retry may fix.
    private func lost(_ link: SocketLink, _ why: String) {
        guard self.link === link else { return }
        end(link, code: .goingAway)
        self.link = nil
        lastDrop = why
        if let since = link.connectedAt, Date().timeIntervalSince(since) >= settings.stableAfter { attempt = 0 }
        guard wanted else {
            if state != .refused { state = .off }
            return
        }
        let delay = SIOBackoff.delay(attempt: attempt, unit: random(), base: settings.backoffBase, cap: settings.backoffCap)
        attempt += 1
        state = .reconnecting
        retry?.cancel()
        retry = after(delay) { [weak self] in
            guard let self, self.wanted, self.link == nil, self.state != .refused else { return }
            self.retry = nil
            self.open()
        }
    }

    /// The server refused the session: stay off until a new sign-in.
    private func refused(_ link: SocketLink, _ why: String) {
        guard self.link === link else { return }
        end(link, code: .normalClosure)
        self.link = nil
        lastDrop = why
        retry?.cancel()
        retry = nil
        state = .refused
    }

    private func end(_ link: SocketLink, code: URLSessionWebSocketTask.CloseCode) {
        link.watchdog?.cancel()
        link.deadline?.cancel()
        link.heartbeat?.cancel()
        link.outbox.removeAll()
        link.task?.cancel(with: code, reason: nil)
        for pending in leaving.values { pending.cancel() }
        leaving.removeAll()
    }

    // MARK: sending

    private func sendJoin(_ room: String, as me: (userId: String, name: String), on link: SocketLink) {
        send(SIOWire.event("join-room", .fields([
            "room": .string(room), "userId": .string(me.userId), "name": .string(me.name),
        ])), on: link)
    }

    /// Frames go out one at a time, in the order they were asked for.
    private func send(_ text: String, on link: SocketLink) {
        guard self.link === link, let task = link.task else { return }
        link.outbox.append(text)
        guard !link.draining else { return }
        link.draining = true
        Task { [weak self] in
            while !link.outbox.isEmpty {
                let next = link.outbox.removeFirst()
                do {
                    try await task.send(.string(next))
                } catch {
                    self?.lost(link, "send failed: \(error.localizedDescription)")
                    break
                }
            }
            link.draining = false
        }
    }

    // MARK: timers

    /// (Re)arms the dead-link check: nothing heard for pingInterval + pingTimeout means the server's
    /// ping is overdue and the link is gone, whatever the socket itself believes.
    private func watch(_ link: SocketLink) {
        link.watchdog?.cancel()
        link.watchdog = after(link.pingWindow) { [weak self] in self?.lost(link, "ping timeout") }
    }

    private func after(_ seconds: TimeInterval, _ body: @escaping @MainActor () -> Void) -> Task<Void, Never> {
        Task { @MainActor in
            try? await Task.sleep(nanoseconds: UInt64(max(0, seconds) * 1_000_000_000))
            if Task.isCancelled { return }
            body()
        }
    }

    private func every(_ seconds: TimeInterval, _ body: @escaping @MainActor () -> Void) -> Task<Void, Never> {
        Task { @MainActor in
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: UInt64(max(0.1, seconds) * 1_000_000_000))
                if Task.isCancelled { return }
                body()
            }
        }
    }
}

/// One WebSocket connection attempt and everything that dies with it.
@MainActor
private final class SocketLink {
    let id: Int
    /// nil until the bootstrap has run and the upgrade has been sent.
    var task: URLSessionWebSocketTask?
    var outbox: [String] = []
    var draining = false
    /// The Engine.IO open packet has arrived.
    var opened = false
    /// The server accepted the Socket.IO connect (`40{sid}`).
    var connectedAt: Date?
    /// pingInterval + pingTimeout, in seconds; the server's defaults until its open packet says.
    var pingWindow: TimeInterval = 45
    var watchdog: Task<Void, Never>?
    var deadline: Task<Void, Never>?
    var heartbeat: Task<Void, Never>?

    init(id: Int) { self.id = id }
}
