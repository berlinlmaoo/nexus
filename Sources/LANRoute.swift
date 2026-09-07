import Foundation
import Network
import UIKit

/// Chooses, per request, between the office LAN and the internet.
///
/// The office pays for its uplink twice on every upload. An attendance selfie or a chat photo leaves
/// the building for Cloudflare and comes straight back to a server on the other side of the same
/// wall. `Config.lanBaseURL` is that server reached directly: the same nginx, the same app container,
/// the same `/api` and `/auth` routes, with a real Let's Encrypt certificate — so from a desk in the
/// office the round trip never leaves the switch. The second prize is that NEXUS keeps working on the
/// days the office ISP does not.
///
/// The route is decided by ASKING the server, never by recognising the WiFi. Matching an SSID would
/// need a location permission, would break silently the day someone renames the network, and would
/// still not answer the only question that matters: does the server answer *this phone*, right now.
///
/// The probe deliberately hits an endpoint that REQUIRES the session rather than `/api/health`. A
/// health check proves the box is up; it proves nothing about whether the session this phone carries
/// is accepted there. Moving a logged-in person onto a host that then answers 401 would look exactly
/// like being logged out — a far worse failure than being slow. Requiring a 200 from an authenticated
/// route also makes a stranger's network harmless: another building's 192.168.223.111 cannot present
/// a valid certificate for this host name, let alone accept this session.
final class LANRoute {
    static let shared = LANRoute()

    /// 300 ms. A phone on cellular must never wait on a private address, and a server three metres
    /// away that needs longer than this is not worth preferring anyway.
    private static let probeTimeout: TimeInterval = 0.3
    /// Floor between two lazily-triggered probes, so a burst of requests on a cold route asks once.
    private static let probeCooldown: TimeInterval = 2
    /// How long after a LAN request failed before asking again. The usual cause of a failure is
    /// walking out of the building, and the usual cure is walking back in.
    private static let recheckDelay: TimeInterval = 30

    /// One row lookup by primary key behind a plain `auth()` gate — the cheapest strictly
    /// authenticated route in the app, and one the client already calls, so this adds no new server
    /// surface. It answers 401, not 200, when the session is not accepted, which is precisely the
    /// condition that must never be mistaken for success. It is also outside `apiHandler`, so probing
    /// it cannot eat into anyone's rate limit.
    private static let probePath = "/api/user/profile"

    private enum Choice {
        /// Not asked since the last network change, launch, or sign-in.
        case unknown
        case lan
        /// Internet only.
        case wide
    }

    private let lock = NSLock()
    private var choice: Choice = .unknown
    private var probing = false
    private var nextAttempt = Date.distantPast

    /// Everything this type does happens here: the path monitor delivers onto it and every probe runs
    /// on it. No caller is ever blocked, and nothing touches the main thread.
    private let queue = DispatchQueue(label: "id.znetworks.nexus.lan-route")
    private let monitor = NWPathMonitor()
    private var foregroundObserver: NSObjectProtocol?

    /// Its own session rather than `URLSession.shared`, for two reasons that both have to hold:
    /// `waitsForConnectivity` must stay off — giving up quickly IS the feature — and a probe must
    /// never leave over cellular, where this host name resolves to somebody else's network.
    private let probeSession: URLSession = {
        let cfg = URLSessionConfiguration.ephemeral
        cfg.timeoutIntervalForRequest = LANRoute.probeTimeout
        cfg.timeoutIntervalForResource = LANRoute.probeTimeout
        cfg.waitsForConnectivity = false
        cfg.allowsCellularAccess = false
        cfg.httpShouldSetCookies = false
        cfg.httpCookieAcceptPolicy = .never
        cfg.requestCachePolicy = .reloadIgnoringLocalCacheData
        return URLSession(configuration: cfg)
    }()

    private init() {
        monitor.pathUpdateHandler = { [weak self] path in
            self?.pathChanged(path)
        }
        monitor.start(queue: queue)

        // A phone that slept at a desk and woke somewhere else usually reports a path change, but not
        // always — Wi-Fi that reassociates to the same network while suspended can look unchanged.
        // Re-asking on foreground costs one 300 ms request and closes that gap.
        foregroundObserver = NotificationCenter.default.addObserver(
            forName: UIApplication.didBecomeActiveNotification, object: nil, queue: nil
        ) { [weak self] _ in
            self?.probe(force: true)
        }
    }

    /// The host to build the next request against. Never blocks and never touches the network on the
    /// calling thread.
    func currentBase() -> URL {
        lock.lock()
        let current = choice
        lock.unlock()

        switch current {
        case .lan:
            return Config.lanBaseURL
        case .wide:
            return Config.baseURL
        case .unknown:
            // The first request after launch (or after signing in — there is no network event for
            // that) answers over the internet immediately and finds out in the background. Making a
            // request wait on the probe would trade a certain 300 ms for an uncertain saving.
            probe(force: false)
            return Config.baseURL
        }
    }

    /// Called when a request that was already aimed at the LAN got no answer at all. Demotes the
    /// route at once so nothing else follows it, and asks again later.
    ///
    /// A probe in flight at this exact moment can still promote the route back to `.lan` a fraction
    /// of a second later. That is tolerable by construction: the cost of being wrong here is one more
    /// request that fails over silently, not an error anyone sees.
    func noteUnreachable() {
        lock.lock()
        choice = .wide
        lock.unlock()
        queue.asyncAfter(deadline: .now() + LANRoute.recheckDelay) { [weak self] in
            self?.probe(force: true)
        }
    }

    private func pathChanged(_ path: NWPath) {
        guard LANRoute.isPlausible(path) else {
            settle(.wide)
            return
        }
        settle(.unknown)
        probe(force: true)
    }

    /// Cellular, or no link at all, can never be the office LAN. Ruling that out from the path itself
    /// saves the 300 ms — and, more importantly, means a request is never pointed at a private
    /// address over a metered link.
    private static func isPlausible(_ path: NWPath) -> Bool {
        path.status == .satisfied
            && (path.usesInterfaceType(.wifi) || path.usesInterfaceType(.wiredEthernet))
    }

    private func probe(force: Bool) {
        queue.async { [weak self] in
            guard let self = self else { return }
            let now = Date()

            self.lock.lock()
            if self.probing || (!force && now < self.nextAttempt) {
                self.lock.unlock()
                return
            }
            self.probing = true
            self.nextAttempt = now.addingTimeInterval(LANRoute.probeCooldown)
            self.lock.unlock()

            guard LANRoute.isPlausible(self.monitor.currentPath) else {
                self.settle(.wide)
                return
            }

            guard let session = Keychain.load() else {
                // Nothing to prove a session with yet. Stay `.unknown` rather than `.wide` so the
                // first request after signing in asks again.
                self.settle(.unknown)
                return
            }

            var req = URLRequest(url: Config.lanBaseURL.appendingPathComponent(LANRoute.probePath))
            req.timeoutInterval = LANRoute.probeTimeout
            req.setValue("application/json", forHTTPHeaderField: "Accept")
            req.setValue(session.cookieHeader, forHTTPHeaderField: "Cookie")

            self.probeSession.dataTask(with: req) { [weak self] _, response, _ in
                // Only a 200 promotes. A 401 means the LAN host reached the app but would not take
                // this session, which is the one outcome that must NOT be read as "reachable".
                let accepted = (response as? HTTPURLResponse)?.statusCode == 200
                self?.settle(accepted ? .lan : .wide)
            }.resume()
        }
    }

    private func settle(_ next: Choice) {
        lock.lock()
        choice = next
        probing = false
        lock.unlock()
    }
}
