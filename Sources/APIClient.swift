import Foundation

/// JSON `null` for an absent value. `value ?? NSNull()` does not type-check when `value` is a
/// `String?` — `??` wants both sides to be the same type, and NSNull is not a String — and
/// `nil as Any` makes JSONSerialization throw. Widening to `Any?` first is the spelling that works,
/// and it keeps "clear this field" (explicit null) distinct from "leave it alone" (key omitted).
func jsonOrNull(_ value: Any?) -> Any { value ?? NSNull() }

/// Bytes as a person reads them. Lives here rather than in a view because the networking layer
/// names sizes in its own refusals ("this file is 140.2 MB, the limit is 64 MB") — and a view file
/// that a future refactor deletes must not be able to break uploads.
func nxBytes(_ b: Int) -> String {
    let units = ["B", "KB", "MB", "GB"]; var v = Double(b); var i = 0
    while v >= 1024 && i < units.count - 1 { v /= 1024; i += 1 }
    return String(format: i == 0 ? "%.0f %@" : "%.1f %@", v, units[i])
}
import UIKit

enum APIError: LocalizedError {
    /// A status the server answered with, and the reason it gave — when it gave one.
    ///
    /// The reason is the whole point. Every refusal in this API is written as a sentence meant for
    /// the person reading it ("Jatah cuti tahunan 2026 nggak cukup. Sisa 3 dari 12 hari, kamu minta
    /// 5 hari."), and showing "Server error (422)." instead turns a clear answer into a fault
    /// report about the wrong thing. `nil` is for the cases where there genuinely is no body.
    case http(Int, String?)
    case unauthorized
    case decoding
    case transport(String)
    /// NEXUS never formed an opinion about this request.
    ///
    /// That is broader than "no HTTP response": an edge status that says the origin was never
    /// reached (Cloudflare 520–527/530, nginx 502–504) means exactly the same thing to a tap as
    /// silence does. See `APIClient.meansOriginUnreachable`.
    ///
    /// Deliberately separate from `.transport`, which carries the server's own refusals: only this
    /// case may be queued and replayed, because replaying something the server already refused
    /// would be wrong.
    case offline
    /// The server refuses to talk to this build at all (HTTP 426, code UPGRADE_REQUIRED) and has
    /// already raised `AppVersionGate`. Carries the server's sentence.
    ///
    /// Its own case rather than `.http(426, …)` because of what it must NOT be mistaken for: it is
    /// not "nobody answered" (`nobodyAnswered` is false, it is never `.offline`), so nothing shows a
    /// cached copy as if the server were away and nothing queues a tap to replay — replaying against
    /// a floor that only an update can clear would fail forever. See `upgradeRefusal`.
    case upgradeRequired(String)

    var errorDescription: String? {
        switch self {
        case .http(let code, let message):
            // The server's own words win. It knows why it refused; this layer does not.
            if let message, !message.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { return message }
            // No sentence AND a status only nginx or Cloudflare sends when the app is not there (a
            // deploy restart, a tunnel blip). "Server error (502)." reads as a fault report about
            // something that is really a 30-second gap, so it gets the same calm line as silence.
            if Self.isEdgeOnly(code) { return Self.unreachableText }
            return "Server error (\(code))."
        case .unauthorized: return T("Session expired — please log in again.")
        case .decoding: return T("Couldn't read data from the server.")
        case .offline: return Self.unreachableText
        case .transport(let msg): return msg
        case .upgradeRequired(let msg): return msg
        }
    }

    /// The one sentence for "NEXUS did not answer", whichever way that happened. Calm and
    /// accurate on purpose: most of the time it is a deploy restart or a patchy connection that is
    /// over in seconds, and the old "NEXUS is down" made a 30-second gap read like an outage.
    static var unreachableText: String {
        T("Can't reach NEXUS right now. Check your connection, or try again in a moment.")
    }

    /// For a failure that happened before any status came back — no route, timeout, TLS, no
    /// network. `URLError`'s own text ("The network connection was lost.") is system wording in
    /// the system language, not the app's; this says the same thing in the app's voice. A
    /// cancellation keeps its own text: that is somebody leaving the screen, not an outage.
    static func nothingAnswered(_ error: Error) -> APIError {
        // Not a failure to answer at all: the server answered "update first". It arrives through
        // the same `catch` as a dropped connection only because `exchange` throws it from inside
        // `perform` — relabelling it here would turn a clear refusal into "check your connection".
        if let api = error as? APIError, case .upgradeRequired = api { return api }
        if error is CancellationError || (error as? URLError)?.code == .cancelled {
            return .transport(error.localizedDescription)
        }
        return .transport(unreachableText)
    }

    /// Statuses only the edge produces when the app itself is not there: nginx 502–504,
    /// Cloudflare 520–527 and 530. Narrower than `APIClient.meansOriginUnreachable` on purpose —
    /// that one counts 500 too, which is right for queueing a check-in but wrong for wording: a
    /// 500 is the app answering, and its body may say why.
    static func isEdgeOnly(_ code: Int) -> Bool {
        (502...504).contains(code) || (520...527).contains(code) || code == 530
    }

    /// True when nothing on NEXUS's side formed an opinion, so a saved copy is the honest thing to
    /// show instead of an error. Meant for READS through `run`, where `.transport` only ever means
    /// no response; an edge status only counts when it carried no sentence of its own (the app
    /// itself sends 502 with a reason, e.g. "Gagal ngirim email", and that is an answer).
    var nobodyAnswered: Bool {
        switch self {
        case .offline, .transport: return true
        case .http(let code, let message): return message == nil && Self.isEdgeOnly(code)
        default: return false
        }
    }
}

/// Stateless networking layer. Reads the session straight from the Keychain for each request and
/// attaches it as a `Cookie` header (native clients may set `__Secure-…` cookies directly), so
/// every existing NEXUS API route authenticates it as a normal session.
struct APIClient {
    static let shared = APIClient()

    /// Not private, unlike the rest of the plumbing below it, and not by accident: FormFillAPI.swift
    /// is an extension of this type in another file, and Swift's `private` does not reach across
    /// one. Giving forms their own copy of this is what left a submit — the one request in this app
    /// that routinely carries 20 MB — going out through Cloudflare and back while everything else
    /// took the shortcut.
    func makeRequest(_ path: String, method: String = "GET", authed: Bool = true) -> URLRequest {
        // Which host this leaves from is decided per request rather than once at launch: the office
        // LAN when the phone is provably on it, the public host everywhere else. Asking here costs
        // nothing — `currentBase()` never blocks and never touches the network on this thread; see
        // LANRoute.swift for why the route is probed instead of guessed from the Wi-Fi name.
        let base = LANRoute.shared.currentBase()
        // Build the URL via URLComponents so a "?query" in `path` stays a real query string.
        // (URL.appendingPathComponent percent-encodes "?" into "%3F", breaking the route → 404.)
        let url: URL
        if let q = path.firstIndex(of: "?") {
            var comps = URLComponents(url: base, resolvingAgainstBaseURL: false)!
            comps.path = String(path[..<q])
            comps.percentEncodedQuery = String(path[path.index(after: q)...])
            url = comps.url ?? base.appendingPathComponent(path)
        } else {
            url = base.appendingPathComponent(path)
        }
        var req = URLRequest(url: url)
        req.httpMethod = method
        req.setValue("application/json", forHTTPHeaderField: "Accept")
        // Who is asking, and what this build is capable of obeying.
        //
        // Rules on the server kept arriving that the shipped app had no way to satisfy — a permit
        // that must carry coordinates the app never sent, a single date a start-and-until picker
        // cannot express — and the only symptom was staff being refused with nothing they could do
        // about it. A server that knows the client version can hold each build to the rules that
        // build can actually meet, instead of every rule being a gamble on who has updated.
        req.setValue(Self.clientTag, forHTTPHeaderField: "X-Nexus-Client")
        if authed, let session = Keychain.load() {
            // Written onto the request itself, so the session travels with whichever host was picked.
            // Nothing here consults a cookie store, so no domain rule can quietly withhold it — and
            // the token is host-independent: the server validates it with AUTH_SECRET and a salt
            // derived from the cookie NAME, never from the Host header.
            req.setValue(session.cookieHeader, forHTTPHeaderField: "Cookie")
        }
        // A LAN-bound request gets a much shorter leash than the 60 s default, because the address it
        // is aimed at ceases to exist the moment someone walks out of the building.
        //
        // Applied unconditionally HERE and lifted again in `perform` for anything that carries a
        // body — see `retimed`. It cannot be decided here: this hands the request back BEFORE the
        // caller attaches its body, so an `httpBody != nil` test on this line is false for every
        // request in the app, uploads included.
        if base.host == Config.lanBaseURL.host { req.timeoutInterval = Config.lanRequestTimeout }
        return req
    }

    /// How a request that expects an answer in memory goes out — which is nearly all of them. The
    /// LAN detour still has exactly one exit: this and `download` are two doors into `send`.
    ///
    /// `session` is a parameter for one caller. `ImageLoader` owns a URLSession with a 256 MB
    /// URLCache, and making it borrow `URLSession.shared` in order to reach these rules would throw
    /// that cache away; passing its session in keeps the rules here instead of in a second copy that
    /// would be free to drift.
    ///
    /// `progress` is the second such parameter, and it is what makes a transfer watchable at all.
    /// `data(for:)` returns when the whole exchange is over and reports nothing on the way, so a body
    /// somebody is watching goes out as an upload task with a per-task delegate instead. Only the
    /// TRANSPORT changes: which host it is aimed at, and whether it may be sent a second time, are
    /// decided by exactly the same code either way. A second send path with its own idea of replay
    /// safety is the one thing this must never become.
    func perform(_ req: URLRequest, on session: URLSession = .shared,
                 reporting progress: UploadProgress? = nil) async throws -> (Data, URLResponse) {
        let done = try await exchange(req, on: session, reporting: progress, into: .memory)
        return (done.data, done.response)
    }

    /// The same journey for bytes coming the other way, and too many of them to hold.
    ///
    /// An attachment runs to 140 MB. `perform` hands back a `Data`, so saving one meant that file
    /// resident in memory AND written out — the same bytes twice, on a device that kills an app for
    /// less. A download task streams straight to disk and never assembles the file in RAM at all.
    ///
    /// Not a second send path: which host it is aimed at, the LAN leash, and whether it may be sent
    /// again are all decided by the code below, unchanged. The only difference is where the response
    /// body lands, which is exactly why that is a parameter here rather than a second copy of this
    /// function somewhere else.
    ///
    /// The file at `destination` belongs to the CALLER the moment this returns — including when the
    /// server refused, in which case what landed there is the refusal and not the file.
    func download(_ req: URLRequest, to destination: URL, on session: URLSession = .shared,
                  reporting progress: UploadProgress? = nil) async throws -> URLResponse {
        try await exchange(req, on: session, reporting: progress, into: .file(destination)).response
    }

    /// Where the bytes coming back should land.
    private enum Sink {
        /// In memory, as every request in this client did before there was anything else.
        case memory
        /// Streamed to this path, never assembled whole.
        case file(URL)
    }

    /// One finished round trip. `data` is empty for a download — the bytes are in the file the
    /// caller named, and handing them back here as well would undo the point of asking for a file.
    private struct Fetched {
        let data: Data
        let response: URLResponse
    }

    /// Everything `perform` and `download` share, which is nearly all of it. Named around the
    /// exchange rather than the sending because this type already has a `send` — FormFillAPI.swift
    /// declares one, privately, in its own file.
    private func exchange(_ req: URLRequest, on session: URLSession,
                          reporting progress: UploadProgress?, into sink: Sink) async throws -> Fetched {
        var outgoing = Self.retimed(req)
        // The body comes off the request only when something is watching it go out AND the answer is
        // coming back in memory: an upload task reads its bytes from `from:` and ignores the
        // request's own `httpBody`, so leaving it attached would carry 20 MB twice on a form submit.
        // A download task reads the body from the request as usual, so lifting it off there would
        // simply throw it away. Note the order — the leash above is decided while it is still there.
        var going: Data?
        if case .memory = sink, progress != nil, let body = outgoing.httpBody, !body.isEmpty {
            going = body
            outgoing.httpBody = nil
        }
        // Nothing to watch when nobody asked, and nothing to watch on a request that neither carries
        // a body nor fills a file. Both go out through the call this client has always made.
        let watchable: Bool
        switch sink {
        case .memory: watchable = going != nil
        case .file: watchable = true
        }
        guard let progress, watchable else {
            let done = try await route(outgoing, body: nil, on: session, reporting: nil, into: sink)
            try Self.screenForUpgrade(done, sink: sink)
            return done
        }
        do {
            let done = try await route(outgoing, body: going, on: session, reporting: progress, into: sink)
            try Self.screenForUpgrade(done, sink: sink)
            await progress.finish()
            return done
        } catch {
            // A refusal, a link that died, or a tap somebody took back. Whichever it was the bar
            // goes: one left sitting at 40% is the state this whole change exists to remove.
            await progress.stop()
            throw error
        }
    }

    /// A 426 UPGRADE_REQUIRED becomes `APIError.upgradeRequired` HERE, once, for every request in
    /// the app — `run`, `runSignup`, the uploads, the vault, forms, change-email, the attendance
    /// upload and the downloads all come through `exchange`. Checking at each status switch instead
    /// would mean eleven copies, and the next hand-rolled caller would forget it.
    ///
    /// After `route`, not inside it: `route`'s catch decides LAN replays, and a refusal is an
    /// answer, not a route failure.
    ///
    /// A download's body is in the caller's file. On this refusal that file is deleted before
    /// throwing: `downloadAttachment` treats any file at its destination as the attachment, and
    /// only cleans up on the statuses it sees — which it no longer will for this one.
    private static func screenForUpgrade(_ done: Fetched, sink: Sink) throws {
        guard (done.response as? HTTPURLResponse)?.statusCode == 426 else { return }
        var body = done.data
        if case .file(let url) = sink { body = (try? Data(contentsOf: url)) ?? Data() }
        guard let refusal = upgradeRefusal(done.response, body: body) else { return }
        if case .file(let url) = sink { try? FileManager.default.removeItem(at: url) }
        throw refusal
    }

    /// Which host the bytes are aimed at, and whether they may be sent a second time.
    ///
    /// A request aimed at the LAN that gets no answer at all demotes the route immediately, and — if
    /// it is safe to send twice, see `isReplayable` — is replayed once over the internet. That retry
    /// is silent on purpose: someone who has just walked out of the office must not be shown an error
    /// for a route the app chose on their behalf, and must not be left holding a stuck tap either.
    /// Anything the SERVER said — 401, 422, 500 — is not a route failure at all, and travels back to
    /// the caller untouched exactly as it did before.
    private func route(_ req: URLRequest, body: Data?, on session: URLSession,
                       reporting progress: UploadProgress?, into sink: Sink) async throws -> Fetched {
        // A download declares nothing to send, so it opens at zero and the meter learns the size off
        // the task once the response headers say what it is — see `UploadMeter.follow`.
        var meter = await progress?.start(expecting: body?.count ?? 0)
        guard req.url?.host == Config.lanBaseURL.host else {
            return try await transfer(req, body: body, on: session, meter: meter, into: sink)
        }
        do {
            return try await transfer(req, body: body, on: session, meter: meter, into: sink)
        } catch {
            // Cancellation is the caller changing its mind, not the LAN disappearing. Replaying it
            // would resurrect work that was deliberately abandoned — and, on an upload, send it twice.
            if error is CancellationError || (error as? URLError)?.code == .cancelled { throw error }
            // Demote the route first and unconditionally: whatever happens to THIS request, every
            // request after it must already be going out over the internet.
            LANRoute.shared.noteUnreachable()
            guard Self.isReplayable(req, after: error) else { throw error }
            // Whatever went out over the LAN went nowhere, so the bar counts the second attempt from
            // zero instead of resuming a number that now measures nothing. A NEW meter rather than a
            // reset one, and that is the whole guard against a backwards jump: anything the abandoned
            // task still reports lands in the old meter, which nothing reads any more.
            meter = await progress?.restart(expecting: body?.count ?? 0)
            return try await transfer(Self.overInternet(req), body: body, on: session, meter: meter, into: sink)
        }
    }

    /// One attempt. `data(for:)` when nothing is watching — byte for byte the call this client has
    /// always made — an upload task when a body is being watched, and a download task when the answer
    /// is going to a file. The task holds its delegate until it completes or fails, so nothing here
    /// has to keep it alive.
    private func transfer(_ req: URLRequest, body: Data?, on session: URLSession,
                          meter: UploadMeter?, into sink: Sink) async throws -> Fetched {
        switch sink {
        case .memory:
            guard let body, let meter else {
                let (data, response) = try await session.data(for: req)
                return Fetched(data: data, response: response)
            }
            let (data, response) = try await session.upload(for: req, from: body,
                                                            delegate: UploadReporter(meter))
            return Fetched(data: data, response: response)

        case .file(let destination):
            let watcher: (any URLSessionTaskDelegate)? = meter.map { DownloadReporter($0) }
            let (arrived, response) = try await session.download(for: req, delegate: watcher)
            // URLSession deletes its own temporary file as soon as this call returns, so the move
            // belongs here rather than back at the caller. A move and not a copy: the file is already
            // the size this whole path exists to avoid paying for twice.
            let fm = FileManager.default
            try? fm.createDirectory(at: destination.deletingLastPathComponent(),
                                    withIntermediateDirectories: true)
            try? fm.removeItem(at: destination)
            try fm.moveItem(at: arrived, to: destination)
            return Fetched(data: Data(), response: response)
        }
    }
    /// The LAN's short leash, lifted for a request that carries a body.
    ///
    /// `timeoutInterval` is an INACTIVITY timer, and the 10 s exists to notice a dead private
    /// address fast — which is settled while connecting, in the first few hundred milliseconds, not
    /// while a body is streaming. Once bytes are moving the short window buys nothing and costs a
    /// great deal: ten quiet seconds on a weak office AP would fail a 20 MB form submit that had
    /// sixty through Cloudflare. And that failure is one of the ones `isReplayable` correctly
    /// refuses to retry, because the route behind a submit creates a task, a submission and its
    /// attachments, writes an activity log, then fires the project's automations and its webhook.
    ///
    /// Decided here rather than in `makeRequest` because the body is attached after that returns,
    /// and on the request rather than in `route` because the watched path lifts the body off before
    /// sending. `overInternet` already rebuilds at the same value, so a replay is unaffected.
    private static func retimed(_ req: URLRequest) -> URLRequest {
        guard req.url?.host == Config.lanBaseURL.host,
              req.httpBody != nil || req.httpBodyStream != nil else { return req }
        var out = req
        out.timeoutInterval = standardTimeout
        return out
    }

    /// URLRequest's own default, spelled out because two places have to agree on it: a LAN request
    /// that carries a body, and any request re-aimed at the public host.
    private static let standardTimeout: TimeInterval = 60

    /// Whether a request that failed on the LAN may simply be sent again over the internet.
    ///
    /// A read always may. Anything that WRITES may only be replayed when the error proves the body
    /// never reached the server — the connection was never established — because the one thing this
    /// shortcut must never invent is a second check-in, or a second message in a thread, out of a
    /// reply that was merely lost on the way back. A write that fails any other way is left to fail
    /// exactly as it did before the LAN existed, and attendance already answers that case properly:
    /// the tap is queued with an idempotency key and replayed (see PendingAttendance).
    private static func isReplayable(_ req: URLRequest, after error: Error) -> Bool {
        let method = (req.httpMethod ?? "GET").uppercased()
        if method == "GET" || method == "HEAD" { return true }
        switch (error as? URLError)?.code {
        case .some(.cannotFindHost), .some(.cannotConnectToHost), .some(.dnsLookupFailed),
             .some(.notConnectedToInternet), .some(.secureConnectionFailed):
            return true
        default:
            // Includes .timedOut and .networkConnectionLost, which can both happen AFTER the server
            // has already read and acted on the body.
            return false
        }
    }

    /// The same request re-aimed at the public host. Method, headers and body are carried over
    /// untouched — including `Cookie`, which is equally valid on either host.
    private static func overInternet(_ req: URLRequest) -> URLRequest {
        var out = req
        // Back to URLRequest's own default: the short leash above exists only for the private address.
        out.timeoutInterval = standardTimeout
        if let url = req.url { out.url = reaimed(url, at: Config.baseURL) }
        return out
    }

    /// One URL pointed at a different host, with path, query and fragment left exactly as they
    /// arrived. Rebuilt through URLComponents rather than by pasting strings, so a query the server
    /// already escaped survives being moved.
    private static func reaimed(_ url: URL, at base: URL) -> URL {
        guard var comps = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return url }
        comps.scheme = base.scheme
        comps.host = base.host
        comps.port = base.port
        return comps.url ?? url
    }

    /// A request for a caller that already holds a whole URL rather than a path.
    ///
    /// `ImageLoader` is that caller: image URLs arrive from the server already absolute, and it
    /// builds its own requests so it can keep its own URLCache. Taking one apart into a path only to
    /// hand it back to `makeRequest` would re-encode a query the server chose — and an avatar's
    /// `?t=` stamp is the only thing that says which upload it is.
    ///
    /// A URL on any other host comes back untouched and un-routed. Somebody else's picture must not
    /// be asked of the office server: it would answer 404, and the asking alone says where the app
    /// is standing.
    static func routedRequest(for url: URL) -> URLRequest {
        guard Config.isNexusHost(url) else { return URLRequest(url: url) }
        let base = LANRoute.shared.currentBase()
        var req = URLRequest(url: reaimed(url, at: base))
        // The same short leash `makeRequest` applies, for the same reason: the private address stops
        // existing the moment somebody walks out, and a picture must not hang for a minute over it.
        // Nothing built here ever carries a body, so `retimed`'s exception for one cannot apply.
        if base.host == Config.lanBaseURL.host { req.timeoutInterval = Config.lanRequestTimeout }
        return req
    }

    /// `cache` opts an endpoint into keeping its last good response on disk. Only pass it for
    /// GETs whose data is fine to show a few seconds stale — never for attendance state, which has
    /// to be exact, and never for anything already delivered live over the socket.
    private func run<T: Decodable>(_ req: URLRequest, decode: T.Type, cache key: String? = nil,
                                   reporting progress: UploadProgress? = nil) async throws -> T {
        let (data, response): (Data, URLResponse)
        do {
            (data, response) = try await perform(req, reporting: progress)
        } catch {
            throw APIError.nothingAnswered(error)
        }
        guard let http = response as? HTTPURLResponse else { throw APIError.transport("No response") }
        if http.statusCode == 401 { throw APIError.unauthorized }
        guard (200..<300).contains(http.statusCode) else {
            throw APIError.http(http.statusCode, Self.serverMessage(data))
        }
        do {
            let value = try JSONDecoder().decode(T.self, from: data)
            // Only store what decoded cleanly: a cache that can hand back something unreadable is
            // worse than an empty one.
            if let key { ResponseCache.save(key, data) }
            return value
        } catch {
            throw APIError.decoding
        }
    }

    // MARK: - Endpoints

    func login(email: String, password: String) async throws -> LoginResponse {
        var req = makeRequest("/api/auth/app-login", method: "POST", authed: false)
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONSerialization.data(withJSONObject: ["email": email, "password": password])
        return try await run(req, decode: LoginResponse.self)
    }

    // MARK: - Self-serve sign-up (email code)
    //
    // Three unauthenticated calls, in the order the web's /register makes them. None of them signs
    // anybody in: /verify creates the account and answers with the bare user, and the caller then
    // goes through `login(email:password:)` like everyone else, so a session is only ever stored by
    // AuthStore's one path.

    /// Sends the 6-digit code. The workspace code is checked here as well as at /verify so a typo
    /// is caught before the person goes to their inbox and spends the code.
    func registerStart(name: String, email: String, password: String, workspaceCode: String?) async throws -> SignupCodeResponse {
        var body: [String: Any] = ["name": name, "email": email, "password": password]
        if let workspaceCode, !workspaceCode.isEmpty { body["workspaceCode"] = workspaceCode }
        return try await runSignup("/api/auth/register", body: body, decode: SignupCodeResponse.self)
    }

    /// Creates the account: joins the workspace as staff when the code is valid, otherwise gives
    /// the person a workspace of their own. The code must be sent AGAIN here — /register only
    /// validated it, it is /verify that acts on it.
    @discardableResult
    func registerVerify(email: String, code: String, workspaceCode: String?) async throws -> Bool {
        var body: [String: Any] = ["email": email, "code": code]
        if let workspaceCode, !workspaceCode.isEmpty { body["workspaceCode"] = workspaceCode }
        // The 201 body is the new user without its password; nothing in it is needed here, and
        // SuccessResponse decodes any object.
        _ = try await runSignup("/api/auth/register/verify", body: body, decode: SuccessResponse.self)
        return true
    }

    func registerResend(email: String) async throws -> SignupCodeResponse {
        try await runSignup("/api/auth/register/resend", body: ["email": email], decode: SignupCodeResponse.self)
    }

    // MARK: - Password reset (signed out)
    //
    // Same bodies as the web's forgot-password page (apps/nexus-lovable-ui/src/lib/nexus-api.ts,
    // passwordReset*), against src/app/api/auth/password/reset/{request,verify,resend}. They go
    // through `runSignup` because they fail the same two ways sign-up does: a 429 that names how
    // long to wait, and "Validation failed" with the useful sentence tucked into `details`.

    /// Emails a 6-digit code. The server answers 200 with the same shape whether or not the
    /// address has an account (so the endpoint cannot be used to probe who is registered), and
    /// while a code is still cooling down it answers 200 WITHOUT sending another — the remaining
    /// wait is then in `resendCooldownSeconds`.
    func passwordResetRequest(email: String) async throws -> SignupCodeResponse {
        try await runSignup("/api/auth/password/reset/request", body: ["email": email], decode: SignupCodeResponse.self)
    }

    /// Checks the code and sets the new password in one call; `{ok:true}` on success.
    @discardableResult
    func passwordResetVerify(email: String, code: String, password: String) async throws -> Bool {
        _ = try await runSignup("/api/auth/password/reset/verify",
                                body: ["email": email, "code": code, "password": password],
                                decode: SuccessResponse.self)
        return true
    }

    /// Unlike /request, a cooldown here is a 429 with `retryAfterSeconds`, which `runSignup`
    /// turns into SignupRetryLater.
    func passwordResetResend(email: String) async throws -> SignupCodeResponse {
        try await runSignup("/api/auth/password/reset/resend", body: ["email": email], decode: SignupCodeResponse.self)
    }

    /// `run` for the sign-up calls, differing in the two places sign-up needs something `run`
    /// throws away. A 429 carries how long to wait (`retryAfterSeconds` in the body for the
    /// resend cooldown, `Retry-After` for the rate limiter), and the button has to count that down
    /// rather than invite a tap the server will refuse again. And a schema refusal says only
    /// "Validation failed" with the real sentence in `details`, which is the one worth showing.
    // `Response`, not `T`: inside a generic whose parameter is called T, `T("…")` stops meaning
    // the localisation function and becomes "construct a T", which failed the build three ways.
    private func runSignup<Response: Decodable>(_ path: String, body: [String: Any], decode: Response.Type) async throws -> Response {
        var req = makeRequest(path, method: "POST", authed: false)
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONSerialization.data(withJSONObject: body)
        let (data, response): (Data, URLResponse)
        do {
            (data, response) = try await perform(req)
        } catch let refusal as APIError {
            // Only `.upgradeRequired` reaches here as an APIError; it must keep its own sentence.
            throw refusal
        } catch {
            throw APIError.transport(error.localizedDescription)
        }
        guard let http = response as? HTTPURLResponse else { throw APIError.transport("No response") }
        guard (200..<300).contains(http.statusCode) else {
            let obj = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
            if http.statusCode == 429 {
                let seconds = (obj?["retryAfterSeconds"] as? NSNumber)?.intValue
                    ?? http.value(forHTTPHeaderField: "Retry-After").flatMap { Int($0) }
                throw SignupRetryLater(message: Self.serverMessage(data)
                                           ?? T("Too many attempts. Wait a moment and try again."),
                                       seconds: seconds)
            }
            var message = Self.serverMessage(data)
            if message == "Validation failed", let details = obj?["details"] as? [String: Any] {
                // Field order fixed so the sentence shown is the first field on screen, not
                // whichever key a dictionary happened to yield first.
                for field in ["name", "email", "password", "code"] {
                    if let first = (details[field] as? [String])?.first { message = first; break }
                }
            }
            throw APIError.http(http.statusCode, message)
        }
        do {
            return try JSONDecoder().decode(Response.self, from: data)
        } catch {
            throw APIError.decoding
        }
    }

    /// Deletes the SIGNED-IN person's own account (App Store 5.1.1(v)). The literal "DELETE" is
    /// the server's own guard against a stray POST, not something the person's typing is relayed
    /// into — the screen checks that they typed it before this is ever called.
    @discardableResult
    func deleteOwnAccount() async throws -> Bool {
        var req = makeRequest("/api/user/account/delete", method: "POST")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONSerialization.data(withJSONObject: ["confirm": "DELETE"])
        // `{ok:true}`; SuccessResponse decodes it, and a refusal (409: the only owner of a
        // workspace other people are still in) arrives as APIError.http with the server's sentence.
        _ = try await run(req, decode: SuccessResponse.self)
        return true
    }

    // MARK: - Passkeys (WebAuthn)
    //
    // Transport only — the ceremony itself lives in Passkeys.swift. `credential` is passed as a
    // ready-made [String: Any] because it is WebAuthn's own JSON shape (the exact object a browser's
    // navigator.credentials.* produces), so the server verifies web and native with one code path;
    // modelling it as Encodable structs here would only invent a second shape to keep in sync.

    /// Options for enrolling a NEW passkey on this device. Needs the current session.
    func passkeyRegisterOptions() async throws -> PasskeyRegistrationOptions {
        var req = makeRequest("/api/auth/passkey/register/options", method: "POST")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        // An empty object, not an empty body: a Next.js route that calls request.json() throws on
        // a zero-length body and answers 500 rather than the options.
        req.httpBody = Data("{}".utf8)
        return try await run(req, decode: PasskeyRegistrationOptions.self)
    }

    /// Hand the signed attestation back. `challenge` must be the verbatim string from
    /// `passkeyRegisterOptions()` — the server looks its stored challenge up by that exact value.
    @discardableResult
    func passkeyRegisterVerify(credential: [String: Any], challenge: String, label: String?) async throws -> Bool {
        var req = makeRequest("/api/auth/passkey/register/verify", method: "POST")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        var body: [String: Any] = ["credential": credential, "challenge": challenge]
        if let label, !label.isEmpty { body["label"] = label }
        req.httpBody = try JSONSerialization.data(withJSONObject: body)
        _ = try await run(req, decode: SuccessResponse.self)
        return true
    }

    /// Options for signing in. Deliberately unauthenticated — this runs on the login screen.
    func passkeyLoginOptions() async throws -> PasskeyAssertionOptions {
        var req = makeRequest("/api/auth/passkey/login/options", method: "POST", authed: false)
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = Data("{}".utf8)
        return try await run(req, decode: PasskeyAssertionOptions.self)
    }

    /// Answers the SAME payload as `login(email:password:)`, which is the whole point: the caller
    /// stores the session through the one existing path instead of inventing a second one.
    func passkeyLoginVerify(credential: [String: Any], challenge: String) async throws -> LoginResponse {
        var req = makeRequest("/api/auth/passkey/login/verify", method: "POST", authed: false)
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONSerialization.data(withJSONObject: ["credential": credential, "challenge": challenge])
        return try await run(req, decode: LoginResponse.self)
    }

    /// The passkeys already enrolled on this account, in the order the server lists them.
    func passkeyList() async throws -> [PasskeyInfo] {
        try await run(makeRequest("/api/auth/passkey"), decode: PasskeyListResponse.self).passkeys
    }

    /// Revoke ONE passkey. The route only ever touches the caller's own credentials, so a 404 here
    /// means "already gone", not "not allowed" — the caller treats it as success and refreshes.
    /// The id goes in raw, like every other id in this file: `makeRequest` builds the URL with
    /// `appendingPathComponent`, which percent-encodes once and would double-encode a pre-escaped id.
    @discardableResult
    func passkeyRevoke(id: String) async throws -> Bool {
        _ = try await run(makeRequest("/api/auth/passkey/\(id)", method: "DELETE"), decode: SuccessResponse.self)
        return true
    }

    func projects() async throws -> [Project] {
        try await run(makeRequest("/api/projects"), decode: [Project].self, cache: "projects")
    }

    func project(_ id: String) async throws -> ProjectDetail {
        try await run(makeRequest("/api/projects/\(id)"), decode: ProjectDetail.self, cache: "project-\(id)")
    }

    /// All of a project's tasks INCLUDING subtasks (the project payload is parentId-only). Carries
    /// `parentId`/`taskListId`/`quests` → board & list merge subtasks into their lane + show "+N XP".
    func projectTasks(_ projectId: String) async throws -> [BoardTask] {
        try await run(makeRequest("/api/tasks?projectId=\(enc(projectId))"), decode: [BoardTask].self, cache: "project-tasks-\(projectId)")
    }

    func workspaceInfo() async throws -> WorkspaceInfo {
        try await run(makeRequest("/api/workspaces/members"), decode: WorkspaceInfo.self)
    }

    @discardableResult
    func createProject(workspaceId: String, name: String, color: String, icon: String) async throws -> Bool {
        var req = makeRequest("/api/projects", method: "POST")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONSerialization.data(withJSONObject: ["name": name, "workspaceId": workspaceId, "color": color, "icon": icon])
        _ = try await run(req, decode: SuccessResponse.self)
        return true
    }

    // MARK: - Project folders

    func projectFolders(workspaceId: String?) async throws -> [ProjectFolder] {
        let path = "/api/project-folders" + (workspaceId.map { "?workspaceId=\(enc($0))" } ?? "")
        return try await run(makeRequest(path), decode: [ProjectFolder].self)
    }
    /// Creates a folder and returns its id (needed to upload a photo icon afterward).
    func projectFolderCreate(workspaceId: String, name: String, icon: String, color: String, parentFolderId: String? = nil) async throws -> String {
        var req = makeRequest("/api/project-folders", method: "POST")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        var body: [String: Any] = ["workspaceId": workspaceId, "name": name, "icon": icon, "color": color]
        if let parentFolderId { body["parentFolderId"] = parentFolderId }
        req.httpBody = try JSONSerialization.data(withJSONObject: body)
        return (try await run(req, decode: CreatedTaskRef.self)).id
    }
    @discardableResult
    func projectFolderUpdate(folderId: String, name: String, icon: String, color: String) async throws -> Bool {
        var req = makeRequest("/api/project-folders/\(folderId)", method: "PATCH")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONSerialization.data(withJSONObject: ["name": name, "icon": icon, "color": color])
        _ = try await run(req, decode: SuccessResponse.self)
        return true
    }
    @discardableResult
    func projectFolderDelete(_ folderId: String) async throws -> Bool {
        _ = try await run(makeRequest("/api/project-folders/\(folderId)", method: "DELETE"), decode: SuccessResponse.self)
        return true
    }
    /// Curated project subset for a folder's aggregate view (empty = all projects in the folder).
    @discardableResult
    func setFolderAggregate(folderId: String, projectIds: [String]) async throws -> Bool {
        var req = makeRequest("/api/project-folders/\(folderId)", method: "PATCH")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONSerialization.data(withJSONObject: ["aggregateProjectIds": projectIds])
        _ = try await run(req, decode: SuccessResponse.self)
        return true
    }
    /// Tasks across a set of projects (the folder aggregate calendar). projectIds joined by comma.
    func folderTasks(projectIds: [String]) async throws -> [FolderTask] {
        guard !projectIds.isEmpty else { return [] }
        return try await run(makeRequest("/api/tasks?projectIds=\(enc(projectIds.joined(separator: ",")))"), decode: [FolderTask].self)
    }
    @discardableResult
    func uploadFolderIcon(folderId: String, fileName: String, data: Data,
                          progress: UploadProgress? = nil) async throws -> Bool {
        let boundary = "Boundary-\(UUID().uuidString)"
        var req = makeRequest("/api/upload/folder-icon", method: "POST")
        req.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        var body = Data()
        func add(_ s: String) { body.append(s.data(using: .utf8)!) }
        add("--\(boundary)\r\nContent-Disposition: form-data; name=\"folderId\"\r\n\r\n\(folderId)\r\n")
        add("--\(boundary)\r\nContent-Disposition: form-data; name=\"file\"; filename=\"\(fileName)\"\r\nContent-Type: application/octet-stream\r\n\r\n")
        body.append(data)
        add("\r\n--\(boundary)--\r\n")
        req.httpBody = body
        _ = try await run(req, decode: SuccessResponse.self, reporting: progress)
        return true
    }
    /// Profile photo. The server takes a multipart field named "file" (PNG/JPG/WEBP, 5 MB cap)
    /// and answers `{ user, url }`; `user.avatar` already carries a `?t=` cache-buster, so the
    /// new picture shows up immediately instead of being served from a stale cache.
    func uploadAvatar(fileName: String, mime: String, data: Data,
                      progress: UploadProgress? = nil) async throws -> String? {
        let boundary = "Boundary-\(UUID().uuidString)"
        var req = makeRequest("/api/upload/avatar", method: "POST")
        req.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        var body = Data()
        func add(_ s: String) { body.append(s.data(using: .utf8)!) }
        add("--\(boundary)\r\nContent-Disposition: form-data; name=\"file\"; filename=\"\(fileName)\"\r\nContent-Type: \(mime)\r\n\r\n")
        body.append(data)
        add("\r\n--\(boundary)--\r\n")
        req.httpBody = body
        return try await run(req, decode: ProfileResponse.self, reporting: progress).user.avatar
    }

    /// Foto profil orang LAIN, oleh BoD, lewat keanggotaan workspace-nya. Field multipart "file".
    @discardableResult
    func uploadMemberAvatar(memberId: String, fileName: String, mime: String, data: Data) async throws -> Bool {
        let boundary = "Boundary-\(UUID().uuidString)"
        var req = makeRequest("/api/workspaces/members/\(enc(memberId))/avatar", method: "POST")
        req.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        var body = Data()
        func add(_ s: String) { body.append(s.data(using: .utf8)!) }
        add("--\(boundary)\r\nContent-Disposition: form-data; name=\"file\"; filename=\"\(fileName)\"\r\nContent-Type: \(mime)\r\n\r\n")
        body.append(data)
        add("\r\n--\(boundary)--\r\n")
        req.httpBody = body
        _ = try await run(req, decode: SuccessResponse.self)
        return true
    }

    /// Identitas akun orang lain — nama, email login, sandi baru. BoD ke atas; server menolak sisanya.
    /// Hanya field yang diisi yang dikirim: mengirim email yang sama persis pun akan ditolak kalau
    /// kebetulan sudah dipakai akun lain, jadi jangan kirim yang tidak berubah.
    @discardableResult
    func updateAdminAccount(userId: String, name: String? = nil, email: String? = nil, password: String? = nil) async throws -> Bool {
        var body: [String: Any] = [:]
        if let name { body["name"] = name }
        if let email { body["email"] = email }
        if let password { body["password"] = password }
        var req = makeRequest("/api/admin/users/\(enc(userId))", method: "PATCH")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONSerialization.data(withJSONObject: body)
        _ = try await run(req, decode: SuccessResponse.self)
        return true
    }

    /// Drop the profile photo and fall back to the initial.
    @discardableResult
    func deleteAvatar() async throws -> Bool {
        _ = try await run(makeRequest("/api/upload/avatar", method: "DELETE"), decode: SuccessResponse.self)
        return true
    }

    /// Start a DM or a group. The server de-dupes DMs: asking for a 1:1 that already exists
    /// returns the existing conversation instead of a second one, so callers can treat this as
    /// "open a chat with these people" rather than strictly "create".
    func createConversation(type: String, userIds: [String], name: String?) async throws -> Conversation {
        var req = makeRequest("/api/conversations", method: "POST")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        var payload: [String: Any] = ["type": type, "userIds": userIds]
        if let name, !name.isEmpty { payload["name"] = name }
        req.httpBody = try JSONSerialization.data(withJSONObject: payload)
        return try await run(req, decode: ConversationResponse.self).conversation
    }

    /// Rename a group chat. The server refuses DMs (titled after the other person) and PROJECT
    /// rooms (named after the project), so only pass a GROUP here.
    func renameConversation(_ conversationId: String, name: String) async throws -> Conversation {
        var req = makeRequest("/api/conversations/\(conversationId)", method: "PATCH")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONSerialization.data(withJSONObject: ["name": name])
        return try await run(req, decode: ConversationResponse.self).conversation
    }

    /// Add people to a GROUP chat. The server refuses DMs (two people by definition) and PROJECT
    /// rooms (membership derives from the project), and silently skips anyone outside your
    /// workspace or already in the room.
    func addConversationMembers(_ conversationId: String, userIds: [String]) async throws -> Conversation {
        var req = makeRequest("/api/conversations/\(conversationId)/members", method: "POST")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONSerialization.data(withJSONObject: ["userIds": userIds])
        return try await run(req, decode: ConversationResponse.self).conversation
    }

    /// Move a project into a folder (or to root with nil).
    @discardableResult
    func setProjectFolder(projectId: String, folderId: String?) async throws -> Bool {
        var req = makeRequest("/api/projects/\(projectId)", method: "PATCH")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONSerialization.data(withJSONObject: ["folderId": folderId as Any])
        _ = try await run(req, decode: SuccessResponse.self)
        return true
    }

    @discardableResult
    func deleteTask(_ id: String) async throws -> Bool {
        _ = try await run(makeRequest("/api/tasks/\(id)", method: "DELETE"), decode: SuccessResponse.self)
        return true
    }

    func taskDetail(_ id: String) async throws -> TaskDetail {
        try await run(makeRequest("/api/tasks/\(id)"), decode: TaskDetail.self, cache: "task-\(id)")
    }

    // MARK: - Sprints

    func sprints(_ projectId: String) async throws -> SprintsResponse {
        try await run(makeRequest("/api/sprints?projectId=\(enc(projectId))"), decode: SprintsResponse.self)
    }
    @discardableResult
    func createSprint(projectId: String, name: String, startDate: String, endDate: String) async throws -> Bool {
        var req = makeRequest("/api/sprints", method: "POST")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONSerialization.data(withJSONObject: ["projectId": projectId, "name": name, "startDate": startDate, "endDate": endDate])
        _ = try await run(req, decode: SuccessResponse.self)
        return true
    }
    @discardableResult
    func updateSprint(id: String, status: String) async throws -> Bool {
        var req = makeRequest("/api/sprints", method: "PATCH")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONSerialization.data(withJSONObject: ["id": id, "status": status])
        _ = try await run(req, decode: SuccessResponse.self)
        return true
    }

    // MARK: - Automations / Finance / P&L

    func automations(_ projectId: String) async throws -> AutomationsResponse {
        try await run(makeRequest("/api/automations?projectId=\(enc(projectId))"), decode: AutomationsResponse.self)
    }
    @discardableResult
    func updateAutomation(id: String, enabled: Bool) async throws -> Bool {
        var req = makeRequest("/api/automations", method: "PATCH")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONSerialization.data(withJSONObject: ["id": id, "enabled": enabled])
        _ = try await run(req, decode: SuccessResponse.self)
        return true
    }
    func financeDashboard(projectId: String, year: Int) async throws -> FinanceDashboard {
        try await run(makeRequest("/api/finance/dashboard?projectId=\(enc(projectId))&year=\(year)"), decode: FinanceDashboard.self)
    }
    func pnlDashboard(projectId: String, year: Int) async throws -> PnlDashboard {
        try await run(makeRequest("/api/pnl/dashboard?projectId=\(enc(projectId))&year=\(year)"), decode: PnlDashboard.self)
    }

    func search(_ q: String) async throws -> SearchResults {
        try await run(makeRequest("/api/search?q=\(enc(q))"), decode: SearchResults.self)
    }

    // MARK: - Dashboard

    func profile() async throws -> ProfileResponse {
        try await run(makeRequest("/api/user/profile"), decode: ProfileResponse.self, cache: "profile")
    }

    func gamification() async throws -> Gamification {
        try await run(makeRequest("/api/gamification/me"), decode: Gamification.self, cache: "gamification")
    }

    /// Claim a finished quest's XP. Quest XP is never granted on completion alone, only here.
    /// `questKey` is the quest's `key` from /api/gamification/me (an auto-quest key or an admin
    /// quest id); same body as the web's `nexusApi.claimQuest`. Refusals (already claimed this
    /// period, not complete, not your task) arrive as APIError.http with the server's sentence.
    @discardableResult
    func claimQuest(_ questKey: String) async throws -> QuestClaimResponse {
        var req = makeRequest("/api/gamification/quests/claim", method: "POST")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONSerialization.data(withJSONObject: ["questKey": questKey])
        return try await run(req, decode: QuestClaimResponse.self)
    }

    func myTasks(assigneeId: String) async throws -> [MyTask] {
        // Keyed per assignee: two people on one device must never see each other's list.
        try await run(makeRequest("/api/tasks?assigneeId=\(assigneeId)"), decode: [MyTask].self,
                      cache: "tasks-\(assigneeId)")
    }

    func unreadCount() async throws -> Int {
        (try await run(makeRequest("/api/notifications"), decode: UnreadResponse.self)).unreadCount ?? 0
    }

    func leaderboard() async throws -> [LeaderboardRow] {
        (try await run(makeRequest("/api/gamification/leaderboard"), decode: LeaderboardResponse.self,
                       cache: "leaderboard")).rows ?? []
    }

    /// A workspace peer's XP ledger for the current period. Peer-scoped by the server — it answers
    /// 403 for somebody the caller shares no workspace with — which is also how the profile screen
    /// asks "may I show this person at all" without inventing a permission rule of its own.
    func xpLog(userId: String, limit: Int = 20) async throws -> XpLogResponse {
        try await run(makeRequest("/api/gamification/xp-log?userId=\(enc(userId))&limit=\(limit)"),
                      decode: XpLogResponse.self)
    }

    /// One person's record for one attendance period (28th → 27th; nil = the current one) — the
    /// data under the profile screen's period, streak row, XP log and requests. The server scopes
    /// it like Reports per crew: yourself, a manager's direct reports, the BoD everyone; anybody
    /// else is a 403, which the screen reads as "not yours to see" and simply leaves the sections out.
    func memberRecord(userId: String, period: String? = nil) async throws -> MemberRecord {
        var path = "/api/members/\(enc(userId))/record"
        if let period { path += "?period=\(enc(period))" }
        return try await run(makeRequest(path), decode: MemberRecord.self)
    }
    /// The XP rows of one earlier period — "Load older" on the profile's XP log.
    func memberRecordXp(userId: String, period: String) async throws -> RecordXpPage {
        try await run(makeRequest("/api/members/\(enc(userId))/record?period=\(enc(period))&only=xp"), decode: RecordXpPage.self)
    }
    /// BoD: remove ONE XP deduction — its XP goes back and the nightly jobs do not take it again.
    /// 409 when it was removed already, 400 when it is not a deduction; both surface as `.http`
    /// with the server's sentence.
    func removeXpDeduction(transactionId: String, note: String? = nil) async throws -> XpRefundResponse {
        var req = makeRequest("/api/gamification/xp-transactions/\(enc(transactionId))/refund", method: "POST")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        var body: [String: Any] = [:]
        if let note, !note.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { body["note"] = note }
        req.httpBody = try JSONSerialization.data(withJSONObject: body)
        return try await run(req, decode: XpRefundResponse.self)
    }

    func docs() async throws -> [Doc] {
        (try await run(makeRequest("/api/docs"), decode: DocsResponse.self)).docs ?? []
    }
    func doc(_ id: String) async throws -> Doc {
        (try await run(makeRequest("/api/docs/\(id)"), decode: DocResponse.self)).doc
    }
    func forms(projectId: String) async throws -> [NexusForm] {
        try await run(makeRequest("/api/forms?projectId=\(projectId)"), decode: [NexusForm].self)
    }
    func mySubmissions() async throws -> MySubmissionsResponse {
        try await run(makeRequest("/api/forms/my-submissions"), decode: MySubmissionsResponse.self, cache: "my-submissions")
    }
    /// One of your own submissions in full: the answers that were filled in, plus whatever the
    /// finance team has attached since. The board list carries none of that — there it is a title
    /// and a column name, which is why its cards had nothing to open.
    func mySubmissionDetail(_ id: String) async throws -> MySubmissionDetail {
        try await run(makeRequest("/api/forms/my-submissions/\(enc(id))"), decode: MySubmissionDetail.self)
    }
    func projectDocs(_ projectId: String) async throws -> [Doc] {
        (try await run(makeRequest("/api/docs?projectId=\(enc(projectId))"), decode: DocsResponse.self)).docs ?? []
    }
    func reports(days: Int) async throws -> Reports {
        try await run(makeRequest("/api/reports?days=\(days)"), decode: Reports.self, cache: "reports-\(days)")
    }
    /// Every team mutation is the same POST with a different `action`. Written as one funnel so a
    /// new action is a line rather than another near-copy of the request plumbing.
    ///
    /// The server re-checks permission on every one of these. Hiding a button is a courtesy to the
    /// person looking at it, never the thing that stops the action.
    @discardableResult
    private func teamAction(_ payload: [String: Any]) async throws -> Bool {
        var req = makeRequest("/api/teams", method: "POST")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONSerialization.data(withJSONObject: payload)
        _ = try await run(req, decode: SuccessResponse.self)
        return true
    }

    @discardableResult
    func teamAddMember(teamId: String, userId: String) async throws -> Bool {
        try await teamAction(["action": "add-member", "teamId": teamId, "userId": userId])
    }

    @discardableResult
    func teamRemoveMember(teamId: String, userId: String) async throws -> Bool {
        try await teamAction(["action": "remove-member", "teamId": teamId, "userId": userId])
    }

    @discardableResult
    func teamLinkProject(teamId: String, projectId: String) async throws -> Bool {
        try await teamAction(["action": "link-project", "teamId": teamId, "projectId": projectId])
    }

    @discardableResult
    func teamUnlinkProject(teamId: String, projectId: String) async throws -> Bool {
        try await teamAction(["action": "unlink-project", "teamId": teamId, "projectId": projectId])
    }

    @discardableResult
    func teamRename(teamId: String, name: String) async throws -> Bool {
        try await teamAction(["action": "rename-team", "teamId": teamId, "name": name])
    }

    @discardableResult
    func teamDelete(teamId: String) async throws -> Bool {
        try await teamAction(["action": "delete-team", "teamId": teamId])
    }

    @discardableResult
    func teamSetDivision(teamId: String, divisionId: String?) async throws -> Bool {
        // NSNull, bukan nil: `nil as Any` membuat JSONSerialization melempar, jadi "lepas dari
        // divisi" akan gagal sementara "pindah divisi" berhasil — bentuk kerusakan yang paling
        // sulit dilihat, karena separuh fiturnya jalan.
        try await teamAction(["action": "set-team-division", "teamId": teamId,
                              "divisionId": jsonOrNull(divisionId)])
    }

    @discardableResult
    func teamSetAttendancePrimary(teamId: String, userId: String, isPrimary: Bool) async throws -> Bool {
        try await teamAction(["action": "set-attendance-primary", "teamId": teamId,
                              "userId": userId, "isAttendancePrimary": isPrimary])
    }

    /// Jam shift khusus tim. Saat dimatikan, jamnya DIKIRIM sebagai null — bukan dibiarkan —
    /// supaya tidak ada jam yatim yang menunggu untuk hidup lagi kalau ada yang menyalakannya.
    @discardableResult
    func teamUpdateShift(teamId: String, enabled: Bool, start: String?, end: String?) async throws -> Bool {
        try await teamAction(["action": "update-attendance-shift", "teamId": teamId,
                              "attendanceShiftOverrideEnabled": enabled,
                              "attendanceShiftStartTime": jsonOrNull(enabled ? start : nil),
                              "attendanceShiftEndTime": jsonOrNull(enabled ? end : nil)])
    }

    func teamCreate(name: String) async throws -> Team {
        var req = makeRequest("/api/teams", method: "POST")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONSerialization.data(withJSONObject: ["name": name])
        return try await run(req, decode: Team.self)
    }

    func divisions() async throws -> [Division] {
        try await run(makeRequest("/api/teams?resource=divisions"), decode: [Division].self)
    }

    func divisionCreate(name: String) async throws -> Division {
        var req = makeRequest("/api/teams", method: "POST")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONSerialization.data(withJSONObject: ["action": "create-division", "name": name])
        return try await run(req, decode: Division.self)
    }

    @discardableResult
    func divisionRename(divisionId: String, name: String) async throws -> Bool {
        try await teamAction(["action": "update-division", "divisionId": divisionId, "name": name])
    }

    @discardableResult
    func divisionDelete(divisionId: String) async throws -> Bool {
        try await teamAction(["action": "delete-division", "divisionId": divisionId])
    }

    func teams() async throws -> [Team] {
        try await run(makeRequest("/api/teams"), decode: [Team].self)
    }
    func roomBookings(start: String, end: String) async throws -> [RoomBooking] {
        let path = "/api/room-bookings?rangeStart=\(enc(start))&rangeEnd=\(enc(end))"
        return (try await run(makeRequest(path), decode: RoomBookingsResponse.self)).bookings ?? []
    }
    /// `teamId` is REQUIRED — the route answers 400 without it. A previous version made it optional
    /// on the assumption the endpoint would fall back to the whole workspace; it does not, so
    /// "All teams" returned `Server error (400)` on every load. The web has always sent it:
    /// `masterCalendar:(e,t,n)=>/api/master-calendar?teamId=${e}&rangeStart=${t}&rangeEnd=${n}`.
    /// Callers that want every team ask for each team and merge — see TeamCalendarView.loadEvents.
    func masterCalendar(teamId: String, start: String, end: String) async throws -> [CalendarEvent] {
        let path = "/api/master-calendar?teamId=\(enc(teamId))&rangeStart=\(enc(start))&rangeEnd=\(enc(end))"
        return (try await run(makeRequest(path), decode: CalendarResponse.self)).events ?? []
    }
    /// `includeRegistered` = ikut membawa akun yang belum masuk workspace mana pun (Control Room
    /// memakainya untuk tombol "Masukkan"). Server menolak diam-diam untuk yang bukan Manager+:
    /// field-nya sekadar tidak ada.
    func roster(includeRegistered: Bool = false) async throws -> WorkspaceRoster {
        try await run(makeRequest("/api/workspaces/members" + (includeRegistered ? "?includeRegistered=1" : "")), decode: WorkspaceRoster.self)
    }
    @discardableResult
    /// `absorbPersonalWorkspace`: daftar tanpa kode = dapat workspace pribadi, dan workspace aktif
    /// dipilih dari joinedAt tertua. Tanpa memindahkannya, dia "masuk" tapi tetap mendarat di
    /// workspace pribadinya. Server menghapus yang kosong saja.
    func inviteWorkspaceMember(email: String, role: String, workspaceId: String, absorbPersonalWorkspace: Bool = false) async throws -> WorkspaceInviteResponse {
        var req = makeRequest("/api/workspaces/members", method: "POST")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONSerialization.data(withJSONObject: ["email": email, "role": role, "workspaceId": workspaceId,
                                                                   "absorbPersonalWorkspace": absorbPersonalWorkspace])
        return try await run(req, decode: WorkspaceInviteResponse.self)
    }
    @discardableResult
    func updateWorkspaceMemberRole(memberId: String, role: String, workspaceId: String) async throws -> Bool {
        var req = makeRequest("/api/workspaces/members", method: "PATCH")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONSerialization.data(withJSONObject: ["memberId": memberId, "role": role, "workspaceId": workspaceId])
        _ = try await run(req, decode: SuccessResponse.self)
        return true
    }
    /// Bagan Approval: taruh seorang STAFF di bawah seorang MANAGER, atau lepas (nil).
    ///
    /// NSNull, bukan `nil as Any`: yang kedua membuat JSONSerialization melempar, jadi "lepas dari
    /// bagan" gagal sementara "pindah manager" berhasil — separuh fitur yang jalan adalah bentuk
    /// kerusakan yang paling sulit dilihat. Server memvalidasi peran keduanya.
    @discardableResult
    func setAttendanceApprover(memberId: String, approverId: String?, workspaceId: String) async throws -> Bool {
        var req = makeRequest("/api/workspaces/members", method: "PATCH")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONSerialization.data(withJSONObject: [
            "memberId": memberId, "workspaceId": workspaceId, "approverId": jsonOrNull(approverId),
        ])
        _ = try await run(req, decode: SuccessResponse.self)
        return true
    }

    /// Flexi Time / Mode Mobile untuk satu orang. Dikirim terpisah, bukan digabung ke pembaruan
    /// peran: server menerapkan hanya field yang dikirim, dan mengirimkan `role` di sini akan
    /// menulis ulang peran orang itu dengan nilai yang kebetulan sedang ada di layar.
    @discardableResult
    func updateWorkspaceMemberAttendanceFlags(memberId: String, workspaceId: String,
                                              flexi: Bool? = nil, noGeofence: Bool? = nil, restDays: [Int]? = nil) async throws -> Bool {
        var body: [String: Any] = ["memberId": memberId, "workspaceId": workspaceId]
        if let flexi { body["flexiTimeEnabled"] = flexi }
        if let noGeofence { body["noGeofenceMode"] = noGeofence }
        if let restDays { body["restDays"] = restDays }
        var req = makeRequest("/api/workspaces/members", method: "PATCH")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONSerialization.data(withJSONObject: body)
        _ = try await run(req, decode: SuccessResponse.self)
        return true
    }

    @discardableResult
    func removeWorkspaceMember(memberId: String, workspaceId: String) async throws -> Bool {
        _ = try await run(makeRequest("/api/workspaces/members?memberId=\(enc(memberId))&workspaceId=\(enc(workspaceId))", method: "DELETE"), decode: SuccessResponse.self)
        return true
    }
    @discardableResult
    func changePassword(current: String, new: String) async throws -> Bool {
        var req = makeRequest("/api/user/password", method: "PATCH")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONSerialization.data(withJSONObject: ["currentPassword": current, "newPassword": new])
        _ = try await run(req, decode: SuccessResponse.self)
        return true
    }

    // MARK: - Admin (Control Room) editing

    // MARK: - Threads (the web's company feed — /api/feed/posts)

    func feedPosts(limit: Int = 30) async throws -> [FeedPost] {
        (try await run(makeRequest("/api/feed/posts?limit=\(limit)"), decode: FeedPostsResponse.self)).all
    }
    func postComments(_ postId: String) async throws -> [FeedComment] {
        (try await run(makeRequest("/api/feed/posts/\(postId)/comments"), decode: FeedCommentsResponse.self)).all
    }
    /// POST /api/feed/posts is **multipart**, not JSON — the route reads `text`, `mentions`
    /// (a JSON-encoded string, not a repeated field), `imageMeta` and any number of `images` parts:
    ///
    ///     createPost: e => { const t = new FormData
    ///       t.set("text", e.text); t.set("mentions", JSON.stringify(e.mentions))
    ///       e.imageMeta && t.set("imageMeta", …); e.images.forEach(n => t.append("images", n)) … }
    ///
    /// Two earlier attempts sent JSON — first `{content}`, then `{text, mentions}`. The second one
    /// had the right field names, which is why it looked correct, but the body was still the wrong
    /// format. (Comments ARE JSON: `addPostComment(e, t) => body: JSON.stringify(t)`. Same screen,
    /// two different content types — that's what made this easy to get wrong.)
    /// Photos ride along as repeated `images` parts, the same shape the web sends. Text-only posts
    /// still work: the route accepts either, and refuses only when BOTH are empty.
    ///
    /// `imageMeta` is a JSON array of `{w,h}` positionally matching `images`. It is optional on the
    /// route, but without it the feed cannot reserve the right aspect ratio while a photo loads and
    /// every post jumps as its images arrive. The caller measures the pixels — it is the side
    /// holding a UIImage — and a nil entry is sent as `{}` so the positions never shift.
    ///
    /// Limits mirror src/lib/feed.ts (IMG_MAX 4, 8MB each). Enforced here as well as there so a
    /// fifth photo is refused before it is uploaded rather than after.
    @discardableResult
    func createPost(text: String, images: [Data] = [], imageMeta: [(w: Int, h: Int)?] = [],
                    progress: UploadProgress? = nil) async throws -> Bool {
        let boundary = "Boundary-\(UUID().uuidString)"
        var req = makeRequest("/api/feed/posts", method: "POST")
        req.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")

        let meta = images.indices.map { i -> [String: Int] in
            guard i < imageMeta.count, let m = imageMeta[i] else { return [:] }
            return ["w": m.w, "h": m.h]
        }
        let metaJSON = (try? JSONSerialization.data(withJSONObject: meta))
            .flatMap { String(data: $0, encoding: .utf8) } ?? "[]"

        var files: [(name: String, filename: String, data: Data)] = []
        for (i, img) in images.enumerated() {
            files.append((name: "images", filename: "photo-\(i + 1).jpg", data: img))
        }
        req.httpBody = Self.multipartBody(
            boundary: boundary,
            // "mentions" JSON-encoded, exactly like the web's JSON.stringify([]).
            fields: ["text": text, "mentions": "[]", "imageMeta": metaJSON],
            files: files)

        let (data, response): (Data, URLResponse)
        do {
            (data, response) = try await perform(req, reporting: progress)
        } catch {
            throw APIError.nothingAnswered(error)
        }
        guard let http = response as? HTTPURLResponse else { throw APIError.transport("No response") }
        if http.statusCode == 401 { throw APIError.unauthorized }
        guard (200..<300).contains(http.statusCode) else {
            // The route's refusals are already sentences for the person reading them ("Maksimal 4
            // foto per post.", "Foto terlalu besar (maks 8MB)."), so they are passed through rather
            // than flattened into a status code.
            let payload = try? JSONDecoder().decode(ServerError.self, from: data)
            throw APIError.transport(payload?.error ?? T("Couldn't post that."))
        }
        return true
    }
    @discardableResult
    func addPostComment(postId: String, text: String) async throws -> Bool {
        var req = makeRequest("/api/feed/posts/\(postId)/comments", method: "POST")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONSerialization.data(withJSONObject: ["text": text, "mentions": []])
        _ = try await run(req, decode: SuccessResponse.self)
        return true
    }
    /// Delete a post. Your own, or anyone's if you are BoD — the server decides, and the payload's
    /// `canDelete` says which so the app never draws a button the route would refuse.
    ///
    /// A soft delete server-side (deletedAt), so this is recoverable in the database even though the
    /// feed stops showing it. Worth knowing before anyone is told a post is gone for good.
    @discardableResult
    func deletePost(_ postId: String) async throws -> Bool {
        _ = try await run(makeRequest("/api/feed/posts/\(postId)", method: "DELETE"), decode: SuccessResponse.self)
        return true
    }

    /// Toggle-like. Body-less POST, so nothing to guess about the payload.
    @discardableResult
    func likePost(_ postId: String) async throws -> Bool {
        _ = try await run(makeRequest("/api/feed/posts/\(postId)/like", method: "POST"), decode: SuccessResponse.self)
        return true
    }

    // MARK: - Ticket (web calls this "complaints" — a private line to the BoD)

    /// No status query param: the web builds it inside a helper we can't see, so we take the default
    /// set and filter client-side rather than guess a parameter name.
    func complaints() async throws -> [Complaint] {
        (try await run(makeRequest("/api/complaints"), decode: ComplaintsResponse.self)).complaints ?? []
    }

    /// Filing a ticket is multipart/form-data, not JSON: `category`, `subject`, `body`, and one or
    /// more photos that ALL share the part name `evidence` — the route collects them with
    /// form.getAll("evidence"), so an indexed name like `evidence[0]` would arrive as zero files and
    /// be refused as if nothing had been attached.
    ///
    /// Not routed through `run`: the interesting answers here are 422s the server already phrased
    /// for a human ("Foto bukti wajib dilampirin." with no photo, the subject/body length rules),
    /// and `run` would flatten every one of them into a bare "Server error (422)".
    @discardableResult
    func createComplaint(category: String, subject: String, body message: String,
                         evidence: [Data], progress: UploadProgress? = nil) async throws -> Bool {
        let boundary = "Boundary-\(UUID().uuidString)"
        var req = makeRequest("/api/complaints", method: "POST")
        req.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")

        var files: [(name: String, filename: String, data: Data)] = []
        for (index, photo) in evidence.enumerated() {
            files.append((name: "evidence", filename: "evidence-\(index + 1).jpg", data: photo))
        }
        req.httpBody = Self.multipartBody(
            boundary: boundary,
            fields: ["category": category, "subject": subject, "body": message],
            files: files)

        let (data, response): (Data, URLResponse)
        do {
            (data, response) = try await perform(req, reporting: progress)
        } catch {
            throw APIError.nothingAnswered(error)
        }
        guard let http = response as? HTTPURLResponse else { throw APIError.transport("No response") }
        if http.statusCode == 401 { throw APIError.unauthorized }
        guard (200..<300).contains(http.statusCode) else {
            let payload = try? JSONDecoder().decode(ServerError.self, from: data)
            throw APIError.transport(payload?.error ?? T("Couldn't file the ticket."))
        }
        return true
    }

    /// The whole ticket, message thread included. The list route answers with rows only, so this is
    /// the only place the conversation exists — without it the app shows people the complaint they
    /// filed and none of the answers to it.
    func complaintDetail(_ complaintId: String) async throws -> ComplaintDetail {
        try await run(makeRequest("/api/complaints/\(complaintId)"), decode: ComplaintDetail.self)
    }

    /// Post a reply. The route answers with the ticket detail all over again — status included, and
    /// a BoD replying to an OPEN ticket moves it to IN_REVIEW — so the caller redraws from that
    /// instead of splicing in a message it invented.
    ///
    /// Not routed through `run`, for the same reason `createComplaint` is not: the refusals here are
    /// sentences the server already wrote for whoever is reading them ("Balasan minimal 10
    /// karakter.", "Keluhan ini sudah ditutup."), and `run` would flatten both into a bare
    /// "Server error (422)".
    func replyToComplaint(_ complaintId: String, body text: String) async throws -> ComplaintDetail {
        var req = makeRequest("/api/complaints/\(complaintId)/messages", method: "POST")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONSerialization.data(withJSONObject: ["body": text])

        let (data, response): (Data, URLResponse)
        do {
            (data, response) = try await perform(req)
        } catch {
            throw APIError.nothingAnswered(error)
        }
        guard let http = response as? HTTPURLResponse else { throw APIError.transport("No response") }
        if http.statusCode == 401 { throw APIError.unauthorized }
        guard (200..<300).contains(http.statusCode) else {
            let payload = try? JSONDecoder().decode(ServerError.self, from: data)
            throw APIError.transport(payload?.error ?? T("Couldn't send the reply."))
        }
        do { return try JSONDecoder().decode(ComplaintDetail.self, from: data) }
        catch { throw APIError.decoding }
    }

    /// Move the ticket's STATUS. BoD only; the server answers everyone else with a 403, and the
    /// sheet draws the control only when `canManage` says so. Those are two separate answers on
    /// purpose — the app never treats its own guess as the permission.
    ///
    /// AWAITING_DECISION is deliberately not offered. The server writes it when GIDEON answers or a
    /// proposal lands, and refuses it here with a 422: a director setting it by hand would be saying
    /// "somebody else decide this" about a ticket they are already holding.
    ///
    /// Answers with the whole detail, status included, so the caller redraws from what the server
    /// actually did rather than from the move it asked for. RESOLVED and CLOSED also stamp
    /// resolvedAt/resolvedBy server-side, which no client could invent correctly.
    func updateComplaintStatus(_ complaintId: String, status: String) async throws -> ComplaintDetail {
        var req = makeRequest("/api/complaints/\(complaintId)", method: "PATCH")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONSerialization.data(withJSONObject: ["status": status])

        let (data, response): (Data, URLResponse)
        do {
            (data, response) = try await perform(req)
        } catch {
            throw APIError.nothingAnswered(error)
        }
        guard let http = response as? HTTPURLResponse else { throw APIError.transport("No response") }
        if http.statusCode == 401 { throw APIError.unauthorized }
        guard (200..<300).contains(http.statusCode) else {
            // Not flattened into "Server error (422)": the refusals on this route are sentences the
            // server already wrote for whoever is reading them ("Status ini diatur otomatis, gak
            // bisa disetel manual."), and those say more than a status code can.
            let payload = try? JSONDecoder().decode(ServerError.self, from: data)
            throw APIError.transport(payload?.error ?? T("Couldn't move the ticket."))
        }
        do { return try JSONDecoder().decode(ComplaintDetail.self, from: data) }
        catch { throw APIError.decoding }
    }

    // MARK: - Attendance correction (attached to a ticket)

    /// The ticket payload already carries `corrections`, but only this route answers the other half
    /// of the question — whether the VIEWER may decide one. Both come back together, so the sheet
    /// asks once instead of stitching two payloads into one card.
    func attendanceCorrections(complaintId: String) async throws -> AttendanceCorrectionsResponse {
        try await run(makeRequest("/api/complaints/\(complaintId)/correction"),
                      decode: AttendanceCorrectionsResponse.self)
    }

    /// APPROVE / REJECT a proposal. BoD only — the server answers everyone else with a 403.
    @discardableResult
    func decideAttendanceCorrection(complaintId: String, correctionId: String,
                                    approve: Bool, note: String?) async throws -> Bool {
        var body: [String: Any] = ["decision": approve ? "APPROVE" : "REJECT", "correctionId": correctionId]
        if let note, !note.isEmpty { body["note"] = note }
        try await postCorrection(complaintId, body)
        return true
    }

    /// File a proposal against ONE day. `checkInAt` / `checkOutAt` are office-local "HH:mm" and at
    /// least one has to be present. A side that is not being moved is DROPPED from the payload
    /// rather than sent as null — null on this route means "leave the recorded time alone", and a
    /// key that is there but empty is not the same promise.
    @discardableResult
    func proposeAttendanceCorrection(complaintId: String, date: String, checkInAt: String?,
                                     checkOutAt: String?, reason: String) async throws -> Bool {
        var body: [String: Any] = ["decision": "PROPOSE", "date": date, "reason": reason]
        if let checkInAt, !checkInAt.isEmpty { body["checkInAt"] = checkInAt }
        if let checkOutAt, !checkOutAt.isEmpty { body["checkOutAt"] = checkOutAt }
        try await postCorrection(complaintId, body)
        return true
    }

    /// Not routed through `run`, for the same reason `createComplaint` is not: every refusal here
    /// is a sentence the server already wrote for the person reading it, and `run` would flatten
    /// all of them into a bare "Server error (422)".
    private func postCorrection(_ complaintId: String, _ body: [String: Any]) async throws {
        var req = makeRequest("/api/complaints/\(complaintId)/correction", method: "POST")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (data, response): (Data, URLResponse)
        do {
            (data, response) = try await perform(req)
        } catch {
            throw APIError.nothingAnswered(error)
        }
        guard let http = response as? HTTPURLResponse else { throw APIError.transport("No response") }
        if http.statusCode == 401 { throw APIError.unauthorized }
        guard (200..<300).contains(http.statusCode) else {
            // 409 is the optimistic lock: the attendance record moved after the snapshot inside the
            // proposal was taken, so nothing was written — and re-sending this same proposal would
            // keep failing. Spelled out rather than passed through, because the way out is a NEW
            // proposal against the day as it stands now, which no status line says on its own.
            if http.statusCode == 409 {
                throw APIError.transport(T("That day's attendance moved after this proposal was written. Check the day again and ask for a fresh proposal."))
            }
            let payload = try? JSONDecoder().decode(ServerError.self, from: data)
            throw APIError.transport(payload?.error ?? T("Couldn't send the attendance correction."))
        }
    }

    /// Where the unfiltered first page of the audit log is kept for offline, shared with the screen
    /// that reads it back.
    static let auditCacheKey = "audit-first-page"

    /// GET /api/audit — one page, newest first. `action` is matched exactly by the route; `search`
    /// is its own case-insensitive match on entity name, entity type and action. `limit` is capped
    /// at 100 on the server.
    func auditLogs(limit: Int, offset: Int, action: String?, search: String?, cache: Bool) async throws -> AuditLogsResponse {
        var q = "limit=\(limit)&offset=\(offset)"
        if let action, !action.isEmpty { q += "&action=\(encValue(action))" }
        if let search, !search.isEmpty { q += "&search=\(encValue(search))" }
        return try await run(makeRequest("/api/audit?\(q)"), decode: AuditLogsResponse.self,
                             cache: cache ? Self.auditCacheKey : nil)
    }

    /// GET /api/audit/{id} — one entry with the server's title, field diff and linked details.
    func auditEntry(id: String) async throws -> AuditEntryDetail {
        try await run(makeRequest("/api/audit/\(encValue(id))"), decode: AuditEntryDetail.self)
    }
    func adminQuests(workspaceId: String) async throws -> [AdminQuest] {
        (try await run(makeRequest("/api/gamification/quests/admin?workspaceId=\(enc(workspaceId))"), decode: AdminQuestsResponse.self)).quests ?? []
    }
    @discardableResult
    func createAdminQuest(workspaceId: String, title: String, requirementType: String, requiredCount: Int, xpReward: Int, deadline: String?) async throws -> Bool {
        var req = makeRequest("/api/gamification/quests/admin", method: "POST")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        var body: [String: Any] = ["workspaceId": workspaceId, "title": title, "requirementType": requirementType, "requiredCount": requiredCount, "xpReward": xpReward]
        if let deadline { body["deadline"] = deadline }
        req.httpBody = try JSONSerialization.data(withJSONObject: body)
        _ = try await run(req, decode: SuccessResponse.self)
        return true
    }
    /// Bundle EXACT tasks into a `specific_tasks` quest (the per-task "Jadiin quest" button). The
    /// backend derives workspaceId + requiredCount from the tasks, so we send only title/xp/taskIds.
    @discardableResult
    func createTaskQuest(title: String, xpReward: Int, taskIds: [String]) async throws -> Bool {
        var req = makeRequest("/api/gamification/quests/admin", method: "POST")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONSerialization.data(withJSONObject: [
            "title": title, "xpReward": xpReward, "requirementType": "specific_tasks", "taskIds": taskIds,
        ])
        _ = try await run(req, decode: SuccessResponse.self)
        return true
    }
    @discardableResult
    func deleteAdminQuest(_ id: String) async throws -> Bool {
        _ = try await run(makeRequest("/api/gamification/quests/admin?id=\(enc(id))", method: "DELETE"), decode: SuccessResponse.self)
        return true
    }
    /// Who has the app and on which build. BoD and above.
    func appInstalls() async throws -> AppInstalls {
        try await run(makeRequest("/api/admin/app-installs"), decode: AppInstalls.self)
    }

    /// Who uses GIDEON, and how much. BoD and above; the server refuses everyone else.
    func gideonUsage() async throws -> GideonUsage {
        try await run(makeRequest("/api/gideon/usage"), decode: GideonUsage.self)
    }

    /// Extra day off (Control Room, BoD and above). One period, grantable periods and the grants
    /// in it, newest first, revoked ones included. nil = the period today is in.
    func dayOffBonuses(periodKey: String?) async throws -> DayOffBonusList {
        let q = periodKey.map { "?periodKey=\(enc($0))" } ?? ""
        return try await run(makeRequest("/api/attendance/day-off-bonus" + q), decode: DayOffBonusList.self)
    }

    /// Gives each person `days` extra day-off days for `periodKey` only. All or nothing on the
    /// server: a refusal (NOT_MEMBERS, BONUS_LIMIT, PERIOD_*) comes back as its Indonesian sentence.
    func grantDayOffBonus(userIds: [String], periodKey: String, days: Int, reason: String) async throws -> DayOffBonusCreated {
        var req = makeRequest("/api/attendance/day-off-bonus", method: "POST")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONSerialization.data(withJSONObject: ["userIds": userIds, "periodKey": periodKey,
                                                                   "days": days, "reason": reason])
        return try await run(req, decode: DayOffBonusCreated.self)
    }

    /// Revokes one grant. Idempotent server-side: a second tap answers `alreadyRevoked`.
    func revokeDayOffBonus(id: String) async throws -> DayOffBonusRevoked {
        let path = "/api/attendance/day-off-bonus/" + (id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? id)
        return try await run(makeRequest(path, method: "DELETE"), decode: DayOffBonusRevoked.self)
    }

    /// Active announcements this user has not dismissed yet — drives the pop-up.
    func activeAnnouncements() async throws -> [AdminAnnouncement] {
        (try await run(makeRequest("/api/announcements/active"), decode: AnnouncementsResponse.self)).announcements ?? []
    }

    /// The version currently on the App Store, so Tuning Room can say "update available" itself.
    func appLatest() async throws -> (version: String?, storeUrl: String) {
        struct R: Decodable { struct IOS: Decodable { let version: String?; let storeUrl: String }; let ios: IOS }
        let r = try await run(makeRequest("/api/app/latest"), decode: R.self)
        return (r.ios.version, r.ios.storeUrl)
    }

    /// One announcement by id, seen or not — what a tapped announcement push resolves against.
    func announcement(_ id: String) async throws -> AdminAnnouncement {
        struct One: Decodable { let announcement: AdminAnnouncement }
        return try await run(makeRequest("/api/announcements/\(id)"), decode: One.self).announcement
    }

    @discardableResult
    func markAnnouncementSeen(_ id: String) async throws -> Bool {
        _ = try await run(makeRequest("/api/announcements/\(id)/seen", method: "POST"), decode: SuccessResponse.self)
        return true
    }

    func announcements() async throws -> [AdminAnnouncement] {
        (try await run(makeRequest("/api/announcements"), decode: AnnouncementsResponse.self)).announcements ?? []
    }
    /// `repeatDays` counts the days AFTER today the notice should come back, at `repeatAtTime`
    /// ("HH:mm", Asia/Jakarta). 0 is the old behaviour exactly — posted once, never repeated — and
    /// the keys are omitted entirely in that case rather than sent as zero, so a server that has not
    /// been deployed yet behaves the same as before instead of erroring on fields it cannot read.
    @discardableResult
    func createAnnouncement(title: String, body: String, tone: String,
                            repeatDays: Int = 0, repeatAtTime: String = "09:00") async throws -> Bool {
        var req = makeRequest("/api/announcements", method: "POST")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        var payload: [String: Any] = ["title": title, "body": body, "tone": tone]
        if repeatDays > 0 {
            payload["repeatDays"] = repeatDays
            payload["repeatAtTime"] = repeatAtTime
        }
        req.httpBody = try JSONSerialization.data(withJSONObject: payload)
        _ = try await run(req, decode: SuccessResponse.self)
        return true
    }
    @discardableResult
    func updateAnnouncementActive(id: String, active: Bool) async throws -> Bool {
        var req = makeRequest("/api/announcements/\(id)", method: "PATCH")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONSerialization.data(withJSONObject: ["active": active])
        _ = try await run(req, decode: SuccessResponse.self)
        return true
    }
    @discardableResult
    func deleteAnnouncement(_ id: String) async throws -> Bool {
        _ = try await run(makeRequest("/api/announcements/\(id)", method: "DELETE"), decode: SuccessResponse.self)
        return true
    }
    @discardableResult
    func deleteUser(_ userId: String) async throws -> Bool {
        _ = try await run(makeRequest("/api/admin/users/\(userId)", method: "DELETE"), decode: SuccessResponse.self)
        return true
    }
    private func enc(_ s: String) -> String { s.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? s }
    /// Stricter than `enc`, for one VALUE inside a query rather than a whole query. `.urlQueryAllowed`
    /// leaves "&", "=", "+" and "#" alone, which is right for the string as a whole and wrong for a
    /// part of it: a file called "before & after.pdf" would end its parameter early and the server
    /// would store a truncated name against the wrong task.
    func encValue(_ s: String) -> String {
        var allowed = CharacterSet.urlQueryAllowed
        allowed.remove(charactersIn: "&=+#?")
        return s.addingPercentEncoding(withAllowedCharacters: allowed) ?? s
    }
    @discardableResult
    func updateProfile(name: String) async throws -> Bool {
        var req = makeRequest("/api/user/profile", method: "PATCH")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONSerialization.data(withJSONObject: ["name": name])
        _ = try await run(req, decode: SuccessResponse.self)
        return true
    }

    func conversations() async throws -> [Conversation] {
        (try await run(makeRequest("/api/conversations"), decode: ConversationsResponse.self,
                       cache: "conversations")).conversations ?? []
    }

    /// Sets the caller's `lastReadAt` so the conversation's unread count clears everywhere.
    func markConversationRead(_ id: String) async throws {
        struct Ack: Decodable { let success: Bool? }
        _ = try await run(makeRequest("/api/conversations/\(id)/read", method: "POST"), decode: Ack.self)
    }

    func conversationMessages(_ id: String) async throws -> [ChatMessage] {
        // Per conversation: reading one thread must never surface another's messages.
        (try await run(makeRequest("/api/conversations/\(id)/messages"), decode: MessagesResponse.self,
                       cache: "messages-\(id)")).messages ?? []
    }

    @discardableResult
    func sendMessage(_ conversationId: String, content: String, mentionedUserIds: [String] = [],
                     attachmentUrl: String? = nil, attachmentType: String? = nil,
                     replyToId: String? = nil) async throws -> Bool {
        var req = makeRequest("/api/conversations/\(conversationId)/messages", method: "POST")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        var payload: [String: Any] = ["content": content, "mentionedUserIds": mentionedUserIds]
        if let attachmentUrl { payload["attachmentUrl"] = attachmentUrl }
        if let attachmentType { payload["attachmentType"] = attachmentType }
        if let replyToId { payload["replyToId"] = replyToId }
        req.httpBody = try JSONSerialization.data(withJSONObject: payload)
        _ = try await run(req, decode: SuccessResponse.self)
        return true
    }

    /// Upload one chat picture and get back the path to attach to a message. The server checks that
    /// you belong to the conversation before writing anything.
    func uploadChatImage(conversationId: String, fileName: String, mime: String, data: Data,
                         progress: UploadProgress? = nil) async throws -> ChatUpload {
        let boundary = "Boundary-\(UUID().uuidString)"
        var req = makeRequest("/api/upload/chat", method: "POST")
        req.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        var body = Data()
        func add(_ s: String) { body.append(s.data(using: .utf8)!) }
        add("--\(boundary)\r\nContent-Disposition: form-data; name=\"conversationId\"\r\n\r\n\(conversationId)\r\n")
        add("--\(boundary)\r\nContent-Disposition: form-data; name=\"file\"; filename=\"\(fileName)\"\r\nContent-Type: \(mime)\r\n\r\n")
        body.append(data)
        add("\r\n--\(boundary)--\r\n")
        req.httpBody = body
        return try await run(req, decode: ChatUpload.self, reporting: progress)
    }

    @discardableResult
    func registerPushDevice(token: String, deviceId: String, environment: String) async throws -> Bool {
        var req = makeRequest("/api/push/devices", method: "POST")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        // Sent so Control Room can see who is on which build. Read from the bundle rather than a
        // constant: a constant is one more thing to remember to bump, and the version it reports
        // would eventually be a lie.
        let info = Bundle.main.infoDictionary
        req.httpBody = try JSONSerialization.data(withJSONObject: [
            "token": token,
            "deviceId": deviceId,
            "bundleId": "id.znetworks.nexus",
            "environment": environment,
            "appVersion": info?["CFBundleShortVersionString"] as? String ?? "",
            "buildNumber": info?["CFBundleVersion"] as? String ?? "",
            "osVersion": "\(UIDevice.current.systemName) \(UIDevice.current.systemVersion)",
            "deviceModel": UIDevice.current.model,
        ])
        _ = try await run(req, decode: SuccessResponse.self)
        return true
    }

    @discardableResult
    func unregisterPushDevice(token: String, session: Session) async throws -> Bool {
        var req = makeRequest("/api/push/devices", method: "DELETE", authed: false)
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.setValue(session.cookieHeader, forHTTPHeaderField: "Cookie")
        req.httpBody = try JSONSerialization.data(withJSONObject: ["token": token])
        _ = try await run(req, decode: SuccessResponse.self)
        return true
    }

    func notifications() async throws -> NotificationsResponse {
        try await run(makeRequest("/api/notifications"), decode: NotificationsResponse.self)
    }

    @discardableResult
    func markNotificationRead(id: String) async throws -> Bool {
        var req = makeRequest("/api/notifications", method: "PATCH")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONSerialization.data(withJSONObject: ["id": id])
        _ = try await run(req, decode: SuccessResponse.self)
        return true
    }

    @discardableResult
    func markAllNotificationsRead() async throws -> Bool {
        var req = makeRequest("/api/notifications", method: "PATCH")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONSerialization.data(withJSONObject: ["markAllRead": true])
        _ = try await run(req, decode: SuccessResponse.self)
        return true
    }

    /// PATCH /api/tasks/{id} with arbitrary fields (title/status/priority/dueDate/description).
    @discardableResult
    func updateTask(_ id: String, _ fields: [String: Any]) async throws -> Bool {
        var req = makeRequest("/api/tasks/\(id)", method: "PATCH")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONSerialization.data(withJSONObject: fields)
        _ = try await run(req, decode: SuccessResponse.self)  // returns the task; SuccessResponse ignores it
        return true
    }

    @discardableResult
    func setTaskStatus(taskId: String, status: String) async throws -> Bool {
        try await updateTask(taskId, ["status": status])
    }

    /// POST /api/tasks — create a task (or a subtask when parentId is set).
    @discardableResult
    func createTask(projectId: String, taskListId: String, title: String, parentId: String? = nil, status: String = "TODO", priority: String? = nil, dueDate: String? = nil) async throws -> String {
        var body: [String: Any] = ["projectId": projectId, "taskListId": taskListId, "title": title, "status": status]
        if let parentId { body["parentId"] = parentId }
        if let priority, priority.uppercased() != "NONE" { body["priority"] = priority }
        if let dueDate { body["dueDate"] = dueDate }
        var req = makeRequest("/api/tasks", method: "POST")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONSerialization.data(withJSONObject: body)
        return (try await run(req, decode: CreatedTaskRef.self)).id
    }

    func projectCustomFields(_ projectId: String) async throws -> [CustomField] {
        (try await run(makeRequest("/api/custom-fields?projectId=\(enc(projectId))"), decode: CustomFieldsResponse.self)).fields ?? []
    }
    /// PATCH a custom-field value. `value` must match the field's stored shape: String for
    /// text/select/status/number/date, [String] for MULTI_SELECT, ["label":,"mapUrl":] for PLACE.
    @discardableResult
    func setCustomFieldValue(fieldId: String, taskId: String, value: Any) async throws -> Bool {
        var req = makeRequest("/api/custom-fields", method: "PATCH")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONSerialization.data(withJSONObject: ["id": fieldId, "taskId": taskId, "value": value])
        _ = try await run(req, decode: SuccessResponse.self)
        return true
    }
    func taskCustomFields(projectId: String, taskId: String) async throws -> [CustomField] {
        (try await run(makeRequest("/api/custom-fields?projectId=\(enc(projectId))&taskId=\(enc(taskId))"), decode: CustomFieldsResponse.self)).fields ?? []
    }

    // MARK: - Project settings (identity / flags / fields / members / danger zone)
    /// PATCH /api/projects/{id} with any of name/description/color/icon/flags.
    @discardableResult
    func updateProject(_ id: String, fields: [String: Any]) async throws -> Bool {
        var req = makeRequest("/api/projects/\(id)", method: "PATCH")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONSerialization.data(withJSONObject: fields)
        _ = try await run(req, decode: SuccessResponse.self)
        return true
    }
    @discardableResult
    func createCustomFieldDef(projectId: String, name: String, type: String, options: [String: Any]?) async throws -> Bool {
        var body: [String: Any] = ["projectId": projectId, "name": name, "type": type]
        if let options { body["options"] = options }
        var req = makeRequest("/api/custom-fields", method: "POST")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONSerialization.data(withJSONObject: body)
        _ = try await run(req, decode: SuccessResponse.self)
        return true
    }
    @discardableResult
    func updateCustomFieldDef(id: String, name: String?, type: String?, options: [String: Any]?) async throws -> Bool {
        var body: [String: Any] = ["id": id]
        if let name { body["name"] = name }
        if let type { body["type"] = type }
        if let options { body["options"] = options }
        var req = makeRequest("/api/custom-fields", method: "PATCH")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONSerialization.data(withJSONObject: body)
        _ = try await run(req, decode: SuccessResponse.self)
        return true
    }
    @discardableResult
    func deleteCustomFieldDef(id: String) async throws -> Bool {
        _ = try await run(makeRequest("/api/custom-fields?id=\(enc(id))", method: "DELETE"), decode: SuccessResponse.self)
        return true
    }
    @discardableResult
    func addProjectMember(projectId: String, userId: String, role: String = "MEMBER") async throws -> Bool {
        var req = makeRequest("/api/projects/\(projectId)/members", method: "POST")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONSerialization.data(withJSONObject: ["userId": userId, "role": role])
        _ = try await run(req, decode: SuccessResponse.self)
        return true
    }
    @discardableResult
    func removeProjectMember(projectId: String, userId: String) async throws -> Bool {
        var req = makeRequest("/api/projects/\(projectId)/members", method: "DELETE")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONSerialization.data(withJSONObject: ["userId": userId])
        _ = try await run(req, decode: SuccessResponse.self)
        return true
    }
    @discardableResult
    func inviteProjectMember(projectId: String, email: String, role: String = "GUEST") async throws -> Bool {
        var req = makeRequest("/api/projects/\(projectId)/invite", method: "POST")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONSerialization.data(withJSONObject: ["email": email, "role": role])
        _ = try await run(req, decode: SuccessResponse.self)
        return true
    }
    /// POST /api/projects/{id}/duplicate → returns the new project id.
    func duplicateProject(projectId: String) async throws -> String {
        let req = makeRequest("/api/projects/\(projectId)/duplicate", method: "POST")
        return (try await run(req, decode: CreatedTaskRef.self)).id
    }
    @discardableResult
    func deleteProject(projectId: String) async throws -> Bool {
        _ = try await run(makeRequest("/api/projects/\(projectId)", method: "DELETE"), decode: SuccessResponse.self)
        return true
    }

    // MARK: - Uploads · what fits in one request, and what to say when it does not

    /// What `/api/upload/avatar` and `/api/upload/folder-icon` accept. Asked BEFORE the picked file
    /// is read, so choosing a 4 GB film where a folder icon was wanted is a sentence rather than a
    /// read of 4 GB into memory to be refused afterwards.
    static let iconByteLimit = 5 << 20

    /// A picked file's size, without reading it.
    ///
    /// Every upload in this app now asks this first, and on a large file it is the difference
    /// between a question and a freeze: `Data(contentsOf:)` on a 200 MB pick blocks whatever thread
    /// it is on for the length of the read, and on the main actor that is the whole screen.
    static func fileSize(of file: URL) -> Int {
        ((try? FileManager.default.attributesOfItem(atPath: file.path))?[.size] as? Int) ?? 0
    }

    /// A picked file's bytes, read somewhere that is not the main actor.
    ///
    /// `async` and nonisolated is the whole point: awaiting this from a view hops to the cooperative
    /// pool for the length of the read and comes back, so a 40 MB attachment off iCloud Drive costs
    /// a spinner rather than a locked screen. Callers are expected to have asked `fileSize` first —
    /// this reads whatever it is pointed at.
    ///
    /// A real copy and NOT `.mappedIfSafe`, deliberately. A form holds its picked files until the
    /// person taps Submit, long after the importer's security-scoped access has been given back,
    /// and a mapping whose file has gone out of scope faults at the moment the body is assembled.
    /// Where the bytes are used inside the same call — `uploadAttachment` — mapping is safe and
    /// is what that does.
    static func bytes(of file: URL) async -> Data? {
        try? Data(contentsOf: file)
    }

    /// A file this destination cannot carry, said out loud.
    ///
    /// The alternative is what the app used to do: send it anyway, have the edge drop it after a
    /// couple of megabytes, and show nothing. A destination with a chunk route never reaches here;
    /// one without it stops here instead of failing three seconds later with no reason attached.
    static func tooBigToSend(_ size: Int, limit: Int) -> APIError {
        .transport("\(T("This file is too big to upload here.")) (\(nxBytes(size)) → max \(nxBytes(limit)))")
    }

    /// The server's own words for a refusal, when it wrote any.
    ///
    /// Every route this client posts a file to answers a refusal it authored with `{ error }`, and
    /// those sentences — "File exceeds 200MB limit", a task deleted mid-upload, a finalize already
    /// running — say more than the status code they arrive with. `run` flattens all of them into
    /// "Server error (400)", which is why an upload that wants to be understood does not use it.
    private static func refusal(_ body: Data, status: Int) -> APIError {
        let said = try? JSONDecoder().decode(ServerError.self, from: body)
        return .transport(said?.error ?? "\(T("Upload failed. Try again.")) (\(status))")
    }

    // MARK: - Attachments

    func taskAttachments(_ taskId: String) async throws -> [TaskAttachment] {
        try await run(makeRequest("/api/attachments?taskId=\(enc(taskId))"), decode: [TaskAttachment].self,
                      cache: "task-attachments-\(taskId)")
    }
    /// Cloudflare will not carry a request body past roughly 100 MB, and it does not fail politely:
    /// measured against this server, a 120 MB POST is answered 502 at the edge after 2.3 MB and
    /// 199 ms, while a 95 MB one reaches the origin normally in 95 s. So a large attachment sent in
    /// one piece never leaves the building it was picked in, and the app was told nothing.
    ///
    /// It also explains the report that the progress bar on the attachments card "does not work":
    /// the wiring was correct, but the upload died in a fifth of a second — inside the bar's reveal
    /// delay — so it was cleared before it was ever drawn, leaving only the spinner beside the +.
    ///
    /// The server grew `/api/attachments/chunk` for exactly this and the web has used it for a
    /// while. This is iOS finally learning it.
    ///
    /// The number is now shared, because that wall stands in front of every upload in the app.
    /// `/api/attachments/chunk` is still the only chunk route, but it is no longer only about tasks:
    /// it takes a `target`, and Z Vault uses the same transport with `target=vault`. Form submits,
    /// chat photos, ticket evidence and the icons still have exactly one request to fit in, and for
    /// those this is not a threshold but a ceiling — see `tooBigToSend`.
    static let singleRequestCeiling = 64 << 20
    /// 1 GB spread over the route's 64-chunk ceiling is 16 MB, so this is the smallest chunk that
    /// can still carry the largest file the route accepts — and far enough under the edge's limit
    /// that a chunk is never the thing that fails.
    private static let chunkBytes = 16 << 20

    /// One task attachment, from a file on disk.
    ///
    /// Takes a URL rather than `Data` because the size decides the route, and because a 140 MB
    /// `Data` plus the multipart body built around it is 280 MB resident before a single byte goes
    /// out — a jetsam kill on a phone that is also holding a board and a screen of avatars.
    @discardableResult
    func uploadAttachment(taskId: String, file: URL, fileName: String,
                          progress: UploadProgress? = nil) async throws -> Bool {
        let size = Self.fileSize(of: file)
        guard size > 0 else { throw APIError.transport(T("Couldn't read that file.")) }
        guard size > Self.singleRequestCeiling else {
            // Small enough for one request, which is the path this app has always taken. Mapped
            // rather than read, so the pages the multipart builder copies are faulted in as it goes
            // instead of the whole file being resident first.
            let data = try Data(contentsOf: file, options: .mappedIfSafe)
            return try await uploadAttachment(taskId: taskId, fileName: fileName, data: data,
                                              progress: progress)
        }
        try await uploadInChunks(file: file, fileName: fileName, size: size,
                                 extraQuery: "&taskId=\(encValue(taskId))", progress: progress)
        return true
    }

    @discardableResult
    func uploadAttachment(taskId: String, fileName: String, data: Data,
                          progress: UploadProgress? = nil) async throws -> Bool {
        let boundary = "Boundary-\(UUID().uuidString)"
        var req = makeRequest("/api/attachments", method: "POST")
        req.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        var body = Data()
        func add(_ s: String) { body.append(s.data(using: .utf8)!) }
        add("--\(boundary)\r\nContent-Disposition: form-data; name=\"taskId\"\r\n\r\n\(taskId)\r\n")
        add("--\(boundary)\r\nContent-Disposition: form-data; name=\"file\"; filename=\"\(fileName)\"\r\nContent-Type: application/octet-stream\r\n\r\n")
        body.append(data)
        add("\r\n--\(boundary)--\r\n")
        req.httpBody = body
        _ = try await run(req, decode: SuccessResponse.self, reporting: progress)
        return true
    }

    /// The chunked path.
    ///
    /// Every chunk is an ordinary request through `perform`, so each one takes the office LAN, the
    /// replay rule and the timeouts like everything else in the app; nothing about routing is
    /// special here. What IS special is that the chunks share one bar. Left to itself the bar would
    /// fill and vanish once per chunk — nine of them for a 140 MB file, which says less than the
    /// spinner it replaced — so the run is bracketed by `beginWhole`/`endWhole` and each chunk's
    /// own `finish()` only banks what it sent. See UploadProgress.swift.
    ///
    /// Slices are read straight off the file at an offset. Reading the whole thing to slice it in
    /// memory would defeat the point, and this way the resident cost of a 1 GB upload is one chunk.
    ///
    /// `extraQuery` is where the destination goes — `&taskId=…` for an attachment, `&target=vault`
    /// (plus a folder) for the vault. Everything above it is transport and belongs to neither: the
    /// slicing, the shared progress bar, the refusal handling and the per-chunk authorization were
    /// all worked out once, against how this tunnel actually behaves, and a second copy for the
    /// vault would be a copy nobody re-tests. Internal rather than private so VaultAPI.swift can
    /// reach it; `private` does not cross a file boundary in Swift.
    func uploadInChunks(file: URL, fileName: String, size: Int, extraQuery: String,
                        progress: UploadProgress?) async throws {
        let uploadId = UUID().uuidString
        let total = (size + Self.chunkBytes - 1) / Self.chunkBytes
        let handle = try FileHandle(forReadingFrom: file)
        defer { try? handle.close() }

        await progress?.beginWhole(bytes: Int64(size))
        do {
            for index in 0..<total {
                try Task.checkCancellation()
                try handle.seek(toOffset: UInt64(index) * UInt64(Self.chunkBytes))
                guard let slice = try handle.read(upToCount: Self.chunkBytes), !slice.isEmpty else {
                    throw APIError.transport(T("Couldn't read that file."))
                }
                // Metadata in the query, the chunk as the RAW body — the route streams that body
                // straight to disk. Wrapping it in multipart would make the server buffer the whole
                // part in memory to parse it, which is the cost the chunk route exists to avoid.
                // `mime` is left out on purpose: the server derives it from the filename, and the
                // filename is the only one of the two this app actually knows.
                var req = makeRequest("/api/attachments/chunk?uploadId=\(encValue(uploadId))"
                                      + "&chunkIndex=\(index)&totalChunks=\(total)&totalSize=\(size)"
                                      + "&filename=\(encValue(fileName))" + extraQuery,
                                      method: "POST")
                req.setValue("application/octet-stream", forHTTPHeaderField: "Content-Type")
                req.httpBody = slice
                let (data, response) = try await perform(req, reporting: progress)
                guard let http = response as? HTTPURLResponse else {
                    throw APIError.transport("No response")
                }
                if http.statusCode == 401 { throw APIError.unauthorized }
                guard (200..<300).contains(http.statusCode) else {
                    // The route answers with a reason for every refusal it authors — a task that was
                    // deleted mid-upload, a finalize already running, too many sessions — and those
                    // are worth repeating to whoever is standing there.
                    throw Self.refusal(data, status: http.statusCode)
                }
            }
        } catch {
            await progress?.stop()
            throw error
        }
        await progress?.endWhole()
    }

    @discardableResult
    func deleteAttachment(_ id: String) async throws -> Bool {
        _ = try await run(makeRequest("/api/attachments/\(id)", method: "DELETE"), decode: SuccessResponse.self)
        return true
    }

    /// An attachment's bytes, fetched with the session and left in a file a viewer or the share
    /// sheet can be pointed at.
    ///
    /// `/api/files/…` requires the session cookie, so none of this can be handed to Safari or to a
    /// plain QuickLook fetch — the file has to come through this client, which is also what lets it
    /// take the office LAN like everything else. `url` may be a path or absolute; an attachment row
    /// carries whichever the server wrote.
    /// `offline: true` puts the file in the copy that survives the daily sweep — used by the
    /// prefetch, never by somebody merely opening an attachment.
    func downloadAttachment(url: String, fileName: String, offline: Bool = false,
                            progress: UploadProgress? = nil) async throws -> URL {
        if let here = AttachmentCache.existing(remote: url, fileName: fileName), !offline { return here }
        let out = offline
            ? AttachmentCache.offlineDestination(remote: url, fileName: fileName)
            : AttachmentCache.destination(remote: url, fileName: fileName)
        // Already here from an earlier look. One URL is one file permanently — the server writes a
        // random on-disk name per upload and never reuses one — and a partial download never reaches
        // this path, because the file is only moved into place once the transfer has completed.
        if (try? out.checkResourceIsReachable()) == true { return out }

        let req: URLRequest
        if url.hasPrefix("http"), let u = URL(string: url) {
            // The helper `ImageLoader` already uses, not a fourth request builder: it re-aims the URL
            // at whichever host is answering and applies the LAN leash. The cookie is attached the
            // same way it is there, and only ever to our own two hosts.
            var routed = Self.routedRequest(for: u)
            if Config.isNexusHost(u), let s = Keychain.load() {
                routed.setValue(s.cookieHeader, forHTTPHeaderField: "Cookie")
            }
            req = routed
        } else {
            req = makeRequest(url)
        }
        if offline { AttachmentCache.sweepOffline() } else { AttachmentCache.sweep() }
        let response = try await download(req, to: out, reporting: progress)
        guard let http = response as? HTTPURLResponse else {
            AttachmentCache.discard(out)
            throw APIError.transport("No response")
        }
        guard (200..<300).contains(http.statusCode) else {
            // What landed on disk is the server's refusal, not the file anybody asked for.
            AttachmentCache.discard(out)
            if http.statusCode == 401 { throw APIError.unauthorized }
            // No message to pass on: this path streams the body straight to a file and the refusal
            // was just discarded with it. Reading it back would mean keeping every failed download
            // on disk to look inside, which is a worse trade than a bare status code here.
            throw APIError.http(http.statusCode, nil)
        }
        return out
    }

    // MARK: - Dependencies

    func taskDependencies(_ taskId: String) async throws -> TaskDependenciesResponse {
        try await run(makeRequest("/api/tasks/\(taskId)/dependencies"), decode: TaskDependenciesResponse.self)
    }

    func timeEntries(_ taskId: String) async throws -> [TimeEntry] {
        (try await run(makeRequest("/api/time-entries?taskId=\(enc(taskId))"), decode: TimeEntriesResponse.self)).entries ?? []
    }
    @discardableResult
    func logTime(taskId: String, duration: Int, description: String? = nil) async throws -> Bool {
        var req = makeRequest("/api/time-entries", method: "POST")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        var body: [String: Any] = ["taskId": taskId, "duration": duration]
        if let d = description, !d.isEmpty { body["description"] = d }
        req.httpBody = try JSONSerialization.data(withJSONObject: body)
        _ = try await run(req, decode: SuccessResponse.self)
        return true
    }

    @discardableResult
    func addDependency(taskId: String, dependsOnTaskId: String) async throws -> Bool {
        var req = makeRequest("/api/tasks/\(taskId)/dependencies", method: "POST")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONSerialization.data(withJSONObject: ["dependsOnTaskId": dependsOnTaskId, "type": "BLOCKING"])
        _ = try await run(req, decode: SuccessResponse.self)
        return true
    }
    @discardableResult
    func removeDependency(taskId: String, id: String) async throws -> Bool {
        _ = try await run(makeRequest("/api/tasks/\(taskId)/dependencies?id=\(enc(id))", method: "DELETE"), decode: SuccessResponse.self)
        return true
    }

    @discardableResult
    func addComment(taskId: String, content: String) async throws -> Bool {
        var req = makeRequest("/api/tasks/\(taskId)/comments", method: "POST")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONSerialization.data(withJSONObject: ["content": content])
        _ = try await run(req, decode: SuccessResponse.self)
        return true
    }

    // MARK: - Attendance

    func attendanceToday() async throws -> AttendanceToday {
        try await run(makeRequest("/api/attendance/today"), decode: AttendanceToday.self, cache: "attendance-today")
    }

    // MARK: - Live location while checked in (0.1.6)

    /// One batch of working-hours positions. The reply is the server's verdict on the whole trail
    /// so far — `tracking:false` is an order to stop, see WorkLocationTracker.
    func postLocationTrail(recordId: String, points: [WorkTrailPoint]) async throws -> WorkTrailReply {
        var req = makeRequest("/api/attendance/location-trail", method: "POST")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONSerialization.data(withJSONObject: WorkTrailWire.body(recordId: recordId, points: points))
        let r = try await run(req, decode: LocationTrailPostReply.self)
        return WorkTrailReply(tracking: r.tracking ?? true, stage: r.stage,
                              outsideSince: WorkTrailWire.parseISO(r.outsideSince),
                              nextAt: WorkTrailWire.parseISO(r.nextAt))
    }

    /// "on" when Always was granted for this record, "denied" when it was refused — what puts the
    /// "location off" badge on the manager's board instead of a trail that is silently empty.
    func postLocationStatus(recordId: String, state: String) async throws {
        var req = makeRequest("/api/attendance/location-status", method: "POST")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONSerialization.data(withJSONObject: ["recordId": recordId, "state": state])
        _ = try await run(req, decode: SuccessResponse.self)
    }

    func locationTrail(recordId: String) async throws -> LocationTrailResponse {
        try await run(makeRequest("/api/attendance/records/\(recordId)/trail"), decode: LocationTrailResponse.self)
    }

    /// The last `days` days as compact dots — what the widget and the watch draw.
    func attendanceRecent(scope: String, days: Int = 7) async throws -> [AttendanceCompactDay] {
        let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"; f.timeZone = TimeZone(identifier: "Asia/Jakarta"); f.locale = Locale(identifier: "en_US_POSIX")
        let to = Date(), from = Calendar.current.date(byAdding: .day, value: -(days - 1), to: to) ?? to
        let path = "/api/attendance/history?scope=\(enc(scope))&dateFrom=\(f.string(from: from))&dateTo=\(f.string(from: to))&compact=1"
        return (try await run(makeRequest(path), decode: AttendanceCompactResponse.self)).records
    }

    func attendanceHistory(scope: String, month: String) async throws -> [AttendanceRow] {
        let path = "/api/attendance/history?scope=\(enc(scope))&month=\(enc(month))"
        return (try await run(makeRequest(path), decode: AttendanceHistoryResponse.self, cache: "attendance-history-\(scope)-\(month)")).all
    }
    /// One person's rows of the board for a period — the member profile's streak row. `scope` is
    /// "me" for yourself, "workspace" for someone else (the server narrows a manager to their
    /// direct reports). Not cached: it is re-read after every status change made from the row.
    func attendanceHistory(scope: String, month: String, userId: String) async throws -> [AttendanceRow] {
        var path = "/api/attendance/history?scope=\(enc(scope))&month=\(enc(month))"
        if scope != "me" { path += "&userId=\(enc(userId))" }
        return (try await run(makeRequest(path), decode: AttendanceHistoryResponse.self)).all
    }
    /// BoD cleanup: omit `part` to delete the whole record (e.g. an accidental check-in), or part="checkout" to clear only the check-out (reopen).
    @discardableResult
    func deleteAttendanceRecord(_ recordId: String, part: String? = nil) async throws -> Bool {
        var path = "/api/attendance/records/\(recordId)"
        if let part { path += "?part=\(enc(part))" }
        _ = try await run(makeRequest(path, method: "DELETE"), decode: SuccessResponse.self)
        return true
    }
    /// BoD status override from the crew board — POST /api/attendance/override. `action` is one of
    /// PRESENT | PERMIT | LEAVE | SICK | DAY_OFF | CLEAR_PENALTY; `date` is the day key (yyyy-MM-dd).
    /// Every action refunds that day's attendance XP penalties and any auto-cut day-off. A refusal
    /// (403 not BoD, 409 the day is part of a multi-day request) surfaces as `.http` with the
    /// server's own sentence.
    func attendanceOverride(userId: String, date: String, action: String, note: String? = nil) async throws -> AttendanceOverrideResponse {
        var req = makeRequest("/api/attendance/override", method: "POST")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        var body: [String: Any] = ["userId": userId, "date": date, "action": action]
        if let note, !note.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { body["note"] = note }
        req.httpBody = try JSONSerialization.data(withJSONObject: body)
        return try await run(req, decode: AttendanceOverrideResponse.self)
    }
    func attendanceRequests(scope: String) async throws -> [AttendanceRequest] {
        (try await run(makeRequest("/api/attendance/requests?scope=\(enc(scope))"), decode: AttendanceRequestsResponse.self, cache: "attendance-requests-\(scope)")).requests
    }
    @discardableResult
    /// `lat`/`lng` are required by the server for a self-filed PERMIT — the same evidence a
    /// check-in carries. The app never sent them, so every permit filed from an iPhone was refused
    /// with "Izin wajib menyertakan lokasi" and staff quietly moved to the web to file one.
    func createAttendanceRequest(type: String, startDate: String, endDate: String, reason: String,
                                 attachment: (name: String, data: Data)? = nil,
                                 lat: Double? = nil, lng: Double? = nil,
                                 progress: UploadProgress? = nil) async throws -> Bool {
        let boundary = "Boundary-\(UUID().uuidString)"
        var req = makeRequest("/api/attendance/requests", method: "POST")
        req.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        var body = Data()
        func field(_ name: String, _ value: String) {
            body.append("--\(boundary)\r\nContent-Disposition: form-data; name=\"\(name)\"\r\n\r\n\(value)\r\n".data(using: .utf8)!)
        }
        field("type", type); field("startDate", startDate); field("endDate", endDate); field("reason", reason)
        if let lat, let lng { field("lat", String(lat)); field("lng", String(lng)) }
        if let a = attachment {
            body.append("--\(boundary)\r\nContent-Disposition: form-data; name=\"supportingDocument\"; filename=\"\(a.name)\"\r\nContent-Type: application/octet-stream\r\n\r\n".data(using: .utf8)!)
            body.append(a.data)
            body.append("\r\n".data(using: .utf8)!)
        }
        body.append("--\(boundary)--\r\n".data(using: .utf8)!)
        req.httpBody = body
        _ = try await run(req, decode: SuccessResponse.self, reporting: progress)
        return true
    }
    /// `reviewNote` is the approver's reason for the decision, carried on the same PATCH:
    /// `attendanceRequestPatchSchema` accepts it beside `approve` and `reject` alike, and the route
    /// stores `trim() || null`. Left out rather than sent empty, so a blank field and an absent one
    /// cannot end up meaning two different things.
    @discardableResult
    func reviewAttendanceRequest(id: String, action: String, reviewNote: String? = nil) async throws -> Bool {
        var req = makeRequest("/api/attendance/requests/\(id)", method: "PATCH")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        var body: [String: Any] = ["action": action]
        if let reviewNote, !reviewNote.isEmpty { body["reviewNote"] = reviewNote }
        req.httpBody = try JSONSerialization.data(withJSONObject: body)
        _ = try await run(req, decode: SuccessResponse.self)
        return true
    }

    // MARK: - Offsite check-out approvals
    //
    // The SECOND approval queue, and the app never had it: when someone checks out beyond the
    // office geofence the shift is held at `checkOutApproval = PENDING` until a BoD approves it.
    // The web reviews these next to the leave/permit requests (`offsiteCheckouts("ALL")`); on the
    // app they were invisible, so a reviewer could never see — let alone clear — the queue.

    func offsiteCheckouts(status: String = "ALL") async throws -> [OffsiteCheckout] {
        let path = "/api/attendance/offsite-checkouts?status=\(enc(status))"
        return (try await run(makeRequest(path), decode: OffsiteCheckoutsResponse.self)).items ?? []
    }

    @discardableResult
    func reviewOffsiteCheckout(id: String, action: String) async throws -> Bool {
        var req = makeRequest("/api/attendance/offsite-checkouts/\(id)", method: "PATCH")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONSerialization.data(withJSONObject: ["action": action])
        _ = try await run(req, decode: SuccessResponse.self)
        return true
    }

    // MARK: - Attendance offices

    /// A month of someone's check-out reflections with GIDEON's summaries; nil userId = the viewer's own.
    func reflections(userId: String?, month: String) async throws -> ReflectionsResponse {
        var path = "/api/attendance/reflections?month=\(enc(month))"
        if let userId { path += "&userId=\(enc(userId))" }
        return try await run(makeRequest(path), decode: ReflectionsResponse.self)
    }
    func summarizeReflections(userId: String?, month: String) async throws -> ReflectionMonthly {
        var req = makeRequest("/api/attendance/reflections/summarize", method: "POST")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        var body: [String: Any] = ["month": month]
        if let userId { body["userId"] = userId }
        req.httpBody = try JSONSerialization.data(withJSONObject: body)
        return try await run(req, decode: ReflectionMonthly.self)
    }
    func attendanceOffices() async throws -> [Office] {
        (try await run(makeRequest("/api/attendance/offices"), decode: OfficesResponse.self)).offices ?? []
    }
    @discardableResult
    func createOffice(fields: [String: Any]) async throws -> Bool {
        var req = makeRequest("/api/attendance/offices", method: "POST")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONSerialization.data(withJSONObject: fields)
        _ = try await run(req, decode: SuccessResponse.self)
        return true
    }
    @discardableResult
    func deleteOffice(id: String) async throws -> Bool {
        _ = try await run(makeRequest("/api/attendance/offices/\(id)", method: "DELETE"), decode: SuccessResponse.self)
        return true
    }

    @discardableResult
    func updateOffice(id: String, fields: [String: Any]) async throws -> Bool {
        var req = makeRequest("/api/attendance/offices/\(id)", method: "PATCH")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONSerialization.data(withJSONObject: fields)
        _ = try await run(req, decode: SuccessResponse.self)
        return true
    }

    // MARK: attendance admin — per-user shift, day-off quota/grant, red-date quota, holidays (BoD+)
    /// PATCH /api/workspaces/members — set/clear a member's personal shift (HH:mm) + per-weekday overrides.
    @discardableResult
    func setAttendanceShift(memberId: String, workspaceId: String, start: String?, end: String?, byDay: [String: [String: String]]?) async throws -> Bool {
        var body: [String: Any] = ["memberId": memberId, "workspaceId": workspaceId]
        body["attendanceShiftStartTime"] = jsonOrNull(start)
        body["attendanceShiftEndTime"] = jsonOrNull(end)
        body["attendanceShiftByDay"] = jsonOrNull(byDay?.isEmpty == false ? byDay : nil)
        var req = makeRequest("/api/workspaces/members", method: "PATCH")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONSerialization.data(withJSONObject: body)
        _ = try await run(req, decode: SuccessResponse.self)
        return true
    }
    func dayoffs(userId: String, month: String) async throws -> DayoffsResponse {
        try await run(makeRequest("/api/attendance/dayoffs?userId=\(enc(userId))&month=\(enc(month))"), decode: DayoffsResponse.self)
    }
    @discardableResult
    func grantDayoff(userId: String, date: String, reason: String?) async throws -> Bool {
        var body: [String: Any] = ["userId": userId, "date": date]
        if let reason, !reason.isEmpty { body["reason"] = reason }
        var req = makeRequest("/api/attendance/dayoffs", method: "POST")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONSerialization.data(withJSONObject: body)
        _ = try await run(req, decode: SuccessResponse.self)
        return true
    }
    @discardableResult
    func setDayoffQuota(userId: String, quota: Int?, workspaceId: String) async throws -> Bool {
        var body: [String: Any] = ["userId": userId, "workspaceId": workspaceId]
        body["quota"] = jsonOrNull(quota)
        var req = makeRequest("/api/attendance/dayoffs", method: "PATCH")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONSerialization.data(withJSONObject: body)
        _ = try await run(req, decode: SuccessResponse.self)
        return true
    }
    @discardableResult
    func deleteDayoff(id: String) async throws -> Bool {
        _ = try await run(makeRequest("/api/attendance/dayoffs?id=\(enc(id))", method: "DELETE"), decode: SuccessResponse.self)
        return true
    }
    func redDateQuota(month: String) async throws -> RedDateQuotaInfo {
        try await run(makeRequest("/api/attendance/red-date-quota?month=\(enc(month))"), decode: RedDateQuotaInfo.self)
    }
    @discardableResult
    func setRedDateQuota(month: String, quota: Int) async throws -> Bool {
        var req = makeRequest("/api/attendance/red-date-quota", method: "POST")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONSerialization.data(withJSONObject: ["month": month, "quota": quota])
        _ = try await run(req, decode: SuccessResponse.self)
        return true
    }
    func holidays(month: String) async throws -> HolidaysResponse {
        try await run(makeRequest("/api/attendance/holidays?month=\(enc(month))"), decode: HolidaysResponse.self)
    }
    @discardableResult
    func addHoliday(date: String, name: String) async throws -> Bool {
        var req = makeRequest("/api/attendance/holidays", method: "POST")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONSerialization.data(withJSONObject: ["date": date, "name": name])
        _ = try await run(req, decode: SuccessResponse.self)
        return true
    }
    @discardableResult
    func deleteHoliday(id: String) async throws -> Bool {
        _ = try await run(makeRequest("/api/attendance/holidays?id=\(enc(id))", method: "DELETE"), decode: SuccessResponse.self)
        return true
    }

    /// `tooFarAsOutcome` is for the offline queue only. The live screen wants a check-in from too
    /// far away as the server's sentence ("You're 340 m from …"): there is no offsite check-in, so
    /// the answer is to walk closer and tap again. A replay cannot walk closer — the coordinates
    /// were stored — so the queue needs the refusal typed (`.outsideRadius`) to drop the entry and
    /// say so once, instead of reading it as a transient failure and replaying it five times.
    func checkIn(lat: Double, lng: Double, selfie: Data, notes: String? = nil,
                 fix: LocationManager.Fix? = nil,
                 clientId: String? = nil, deviceAt: Date? = nil, uptimeSec: Int? = nil,
                 tooFarAsOutcome: Bool = false,
                 progress: UploadProgress? = nil) async throws -> AttendanceOutcome {
        var fields = ["lat": String(lat), "lng": String(lng)]
        if let notes, !notes.isEmpty { fields["notes"] = notes }
        Self.applyFixFields(&fields, fix)
        Self.applyOfflineFields(&fields, clientId: clientId, deviceAt: deviceAt, uptimeSec: uptimeSec)
        return try await attendanceUpload("/api/attendance/check-in", fields: fields, selfie: selfie,
                                          checkInTooFar: tooFarAsOutcome ? .outcome : .sentence,
                                          progress: progress)
    }

    /// Only a replayed tap carries these. A live one omits them entirely, so the server records it
    /// exactly as it always did — server clock, not flagged.
    /// The rest of what CoreLocation reported. Coordinates alone can never show whether a position
    /// was real, so the supporting signals travel with them and the server decides what looks wrong.
    private static func applyFixFields(_ fields: inout [String: String], _ fix: LocationManager.Fix?) {
        guard let fix else { return }
        fields["accuracyM"] = String(fix.accuracyM)
        if let alt = fix.altitudeM { fields["altitudeM"] = String(alt) }
        if let sp = fix.speedMps { fields["speedMps"] = String(sp) }
        fields["simulated"] = fix.simulated ? "1" : "0"
        fields["fromAccessory"] = fix.fromAccessory ? "1" : "0"
    }

    private static func applyOfflineFields(_ fields: inout [String: String],
                                           clientId: String?, deviceAt: Date?, uptimeSec: Int?) {
        if let clientId { fields["clientId"] = clientId }
        if let deviceAt { fields["deviceAt"] = ISO8601DateFormatter().string(from: deviceAt) }
        if let uptimeSec { fields["uptimeSec"] = String(uptimeSec) }
    }

    /// `reflection` is REQUIRED by the server on check-out (min 200 chars) — same field the web
    /// sends. Without it the API rejects with "Refleksi harian wajib diisi minimal 200 karakter".
    func checkOut(lat: Double, lng: Double, selfie: Data, reflection: String,
                  offsite: Bool = false, reason: String? = nil,
                  fix: LocationManager.Fix? = nil,
                  clientId: String? = nil, deviceAt: Date? = nil, uptimeSec: Int? = nil,
                  progress: UploadProgress? = nil) async throws -> AttendanceOutcome {
        var fields = ["lat": String(lat), "lng": String(lng)]
        let trimmedReflection = reflection.trimmingCharacters(in: .whitespacesAndNewlines)
        if !trimmedReflection.isEmpty { fields["reflection"] = trimmedReflection }
        if offsite {
            fields["offsite"] = "1"
            if let reason, !reason.isEmpty { fields["reason"] = reason }
        }
        Self.applyFixFields(&fields, fix)
        Self.applyOfflineFields(&fields, clientId: clientId, deviceAt: deviceAt, uptimeSec: uptimeSec)
        return try await attendanceUpload("/api/attendance/check-out", fields: fields, selfie: selfie,
                                          progress: progress)
    }

    /// The only multipart body builder in this client. Attendance selfies and ticket evidence differ
    /// solely in how many files ride along, and a second hand-rolled boundary writer would be a
    /// second chance to drop a CRLF — which the server reports as an unreadable 500, not as
    /// "your body was malformed". Every file we upload is JPEG, hence the fixed part Content-Type.
    private static func multipartBody(boundary: String, fields: [String: String],
                                      files: [(name: String, filename: String, data: Data)]) -> Data {
        var body = Data()
        func appendStr(_ s: String) { body.append(s.data(using: .utf8)!) }
        for (key, value) in fields {
            appendStr("--\(boundary)\r\n")
            appendStr("Content-Disposition: form-data; name=\"\(key)\"\r\n\r\n")
            appendStr("\(value)\r\n")
        }
        for file in files {
            appendStr("--\(boundary)\r\n")
            appendStr("Content-Disposition: form-data; name=\"\(file.name)\"; filename=\"\(file.filename)\"\r\n")
            appendStr("Content-Type: image/jpeg\r\n\r\n")
            body.append(file.data)
            appendStr("\r\n")
        }
        appendStr("--\(boundary)--\r\n")
        return body
    }

    /// How a check-in's "too far from the office" 422 comes back (see `checkIn`).
    private enum CheckInTooFar { case sentence, outcome }

    /// Shared multipart upload for check-in/out. Maps the server's OUTSIDE_RADIUS 422 into a typed
    /// outcome so the UI can ask for an offsite reason; surfaces any other error message verbatim.
    /// `checkInTooFar` is nil for a check-out and says, for a check-in, what its geofence refusal
    /// becomes.
    private func attendanceUpload(_ path: String, fields: [String: String], selfie: Data,
                                  checkInTooFar: CheckInTooFar? = nil,
                                  progress: UploadProgress? = nil) async throws -> AttendanceOutcome {
        let boundary = "Boundary-\(UUID().uuidString)"
        var req = makeRequest(path, method: "POST")
        req.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")

        req.httpBody = Self.multipartBody(boundary: boundary, fields: fields,
                                          files: [(name: "selfie", filename: "selfie.jpg", data: selfie)])

        let (data, response): (Data, URLResponse)
        do {
            (data, response) = try await perform(req, reporting: progress)
        } catch let refusal as APIError {
            // "Update first" is the server answering, not silence. Thrown as `.offline` it would be
            // queued and replayed on every activation against a floor that only an update clears;
            // the caller shows the sentence and the update screen covers the app.
            throw refusal
        } catch {
            // Nothing came back at all, so the tap is queueable. Anything below this line is the
            // server having an opinion, which must never be replayed.
            throw APIError.offline
        }
        guard let http = response as? HTTPURLResponse else { throw APIError.offline }
        if (200..<300).contains(http.statusCode) { return .success }
        if http.statusCode == 401 { throw APIError.unauthorized }

        // The edge answered; NEXUS did not.
        //
        // 502/503/504 come from nginx when the app container is not there. 520–527 and 530 come
        // from Cloudflare when the tunnel cannot reach the origin at all — 530 is what every phone
        // saw on 8 September while the office had no power. 500 is the app itself falling over
        // before it decided anything, which is what a Postgres that has not come back after a
        // reboot looks like from out here.
        //
        // In all of them NEXUS formed no opinion about this tap, which is the exact condition
        // `.offline` describes. Throwing it here is what lets the tap be queued instead of lost,
        // and — just as important — what stops the queue from counting an outage as a refusal and
        // deleting somebody's attendance after five attempts.
        //
        // Everything BELOW this line is the server having an opinion (409 "already checked in",
        // 422 outside radius, 400 bad data). Those must never be replayed.
        if Self.meansOriginUnreachable(http.statusCode) { throw APIError.offline }

        // Decode the server's { error, code } body for a useful message.
        let payload = try? JSONDecoder().decode(ServerError.self, from: data)
        // A check-in refused for distance: 422 with `distanceMeters` and no `code` today, and
        // recognised by `code` too should the server add one — which must not open the offsite
        // sheet on the live screen, since check-in has no offsite form.
        if http.statusCode == 422, let tooFar = checkInTooFar,
           payload?.distanceMeters != nil || payload?.code == "OUTSIDE_RADIUS" {
            if tooFar == .outcome { return .outsideRadius }
            if let office = payload?.officeName, let away = payload?.distanceMeters, let radius = payload?.radiusMeters {
                throw APIError.transport(String(format: T("You're %d m from %@, and check-in works within %d m. Move closer and try again."),
                                                Int(away.rounded()), office, Int(radius.rounded())))
            }
            throw APIError.transport(payload?.error ?? "\(T("Failed")) (\(http.statusCode)).")
        }
        if http.statusCode == 422, payload?.code == "OUTSIDE_RADIUS" { return .outsideRadius }
        throw APIError.transport(payload?.error ?? "\(T("Failed")) (\(http.statusCode)).")
    }
}

extension APIClient {
    /// `ios/<marketing version>/<build>`, e.g. `ios/0.1.6/12`. Read once; it cannot change while
    /// the app is running.
    static let clientTag: String = {
        let info = Bundle.main.infoDictionary
        let version = info?["CFBundleShortVersionString"] as? String ?? "0"
        let build = info?["CFBundleVersion"] as? String ?? "0"
        return "ios/\(version)/\(build)"
    }()

    /// The server's "this build is too old" answer, recognised and recorded; nil for anything else.
    ///
    /// Both halves are required: a bare 426 (some proxy's idea of protocol upgrade) is not the
    /// server's floor, and raising a blocking screen over it would lock people out for nothing — it
    /// falls through to the caller's ordinary refusal handling instead.
    ///
    /// The gate is raised asynchronously on the main actor; the error is thrown now, so the tap
    /// that hit it fails with the server's own sentence while the cover slides in.
    static func upgradeRefusal(_ response: URLResponse, body: Data) -> APIError? {
        guard (response as? HTTPURLResponse)?.statusCode == 426,
              let obj = (try? JSONSerialization.jsonObject(with: body)) as? [String: Any],
              obj["code"] as? String == "UPGRADE_REQUIRED" else { return nil }
        let floor = (obj["minSupported"] as? String).flatMap { $0.isEmpty ? nil : $0 }
        let store = (obj["storeUrl"] as? String).flatMap { URL(string: $0) }
        Task { @MainActor in AppVersionGate.shared.require(minSupported: floor, storeUrl: store) }
        let said = (obj["error"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines)
        return .upgradeRequired(said.flatMap { $0.isEmpty ? nil : $0 }
                                ?? T("This version of NEXUS is no longer supported. Update from the App Store to continue."))
    }

    /// Statuses that mean the request never reached a decision inside NEXUS.
    ///
    /// Deliberately a list, not `>= 500`: 501 and 505 say the request itself was unacceptable, and
    /// replaying something unacceptable forever is not resilience. Kept next to the one place that
    /// reads it so the two cannot drift.
    static func meansOriginUnreachable(_ code: Int) -> Bool {
        code == 500                       // the app fell over before deciding
            || (502...504).contains(code) // nginx: no upstream / unavailable / upstream timeout
            || (520...527).contains(code) // Cloudflare: origin unknown error, down, timeout, unreachable
            || code == 530                // Cloudflare: tunnel down (what 8 September looked like)
    }
}

extension APIClient {
    /// The `error` string every route in this API puts in its refusal body, or nil when there
    /// isn't one. Deliberately forgiving: a refusal that cannot be parsed must still fall back to
    /// the status code rather than throwing something else on the way out.
    static func serverMessage(_ data: Data) -> String? {
        guard let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return nil }
        // The Cloudflare Worker in front of NEXUS (maintenance/nexus-down-worker.js) answers API
        // calls with {"error":"NEXUS is down","code":"NEXUS_DOWN"} while the origin is unreachable.
        // That is the edge, not the app, so it is not a server sentence to show verbatim: returning
        // nil lets the status fall through to `unreachableText` like any other edge page.
        if (obj["code"] as? String) == "NEXUS_DOWN" || (obj["down"] as? Bool) == true { return nil }
        let text = (obj["error"] as? String) ?? (obj["message"] as? String)
        guard let text, !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return nil }
        return text
    }
}

private struct ServerError: Decodable {
    let error: String?
    let code: String?
    /// Sent with a 422 from outside the geofence. Check-out carries `code: OUTSIDE_RADIUS` (the
    /// offsite flow); check-in carries only these, because there is no offsite check-in — the
    /// answer there is to walk closer, and for that the distance is the whole message.
    let officeName: String?
    let distanceMeters: Double?
    let radiusMeters: Double?
}

/// Where a fetched attachment sits while somebody is looking at it.
///
/// Inside `Caches/responses/` deliberately — a subdirectory of `ResponseCache`'s own folder rather
/// than beside it, the same arrangement `ImageDiskCache` uses and for the same reason. Logout calls
/// `ResponseCache.clearAll()`, which removes that whole tree, so a payslip somebody opened on the
/// way home leaves the device with the session that fetched it and nobody has to remember to do it.
///
/// Not the temporary directory, which iOS is free to empty between launches while a video is still
/// playing out of it, and not Documents, which would put a 140 MB film in the user's iCloud backup.
///
/// Every read here treats what it finds as disposable: a missing file is a normal fetch, and the
/// worst this can do is make somebody wait for bytes they already had.
enum AttachmentCache {
    /// Longer than anybody keeps a file open, shorter than "forever".
    private static let maxAge: TimeInterval = 24 * 60 * 60
    /// Two films' worth. Whatever survives the age sweep is trimmed to this, oldest first.
    private static let maxBytes = 512 << 20

    /// Files kept ON PURPOSE so the app works with no signal, as opposed to files that happen to
    /// still be here because somebody opened them recently.
    ///
    /// A separate folder, not a flag, because the two have opposite rules: the browse cache is
    /// swept at a day old so a film watched on Monday is not still occupying a phone on Friday,
    /// while the offline copy exists precisely to survive that. Prefetching into the browse cache
    /// would have meant everything downloaded for offline use being deleted by the age sweep on the
    /// second day — exactly the day somebody needs it.
    /// Not private: Tuning Room draws what is used against it.
    static let offlineBudget = 1_024 << 20   // 1 GB

    /// Recomputed rather than stored, because `ResponseCache.clearAll()` deletes the parent and
    /// recreates only its own directory — so this one has to be prepared to find itself gone.
    private static var dir: URL {
        FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("responses", isDirectory: true)
            .appendingPathComponent("attachments", isDirectory: true)
    }
    private static var offlineDir: URL {
        FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("responses", isDirectory: true)
            .appendingPathComponent("attachments-offline", isDirectory: true)
    }

    /// One folder per remote file, named from its URL, with the human filename kept inside it.
    /// Two tasks can both hold a "scan.pdf" without one answering for the other, and the share sheet
    /// still offers the name the person recognises rather than a hash.
    /// Where an offline copy of this file belongs.
    static func offlineDestination(remote: String, fileName: String) -> URL {
        destination(remote: remote, fileName: fileName, in: offlineDir)
    }

    /// A copy already on this device, kept for offline use or merely browsed recently. The offline
    /// folder is asked first: it is the one that is meant to be there.
    static func existing(remote: String, fileName: String) -> URL? {
        for candidate in [offlineDestination(remote: remote, fileName: fileName),
                          destination(remote: remote, fileName: fileName)] {
            if (try? candidate.checkResourceIsReachable()) == true { return candidate }
        }
        return nil
    }

    /// A file kept for offline use, found by its URL and nothing else.
    ///
    /// `existing(remote:fileName:)` needs the name the file was saved under, and a picture only
    /// ever arrives at the image loader as a URL — nothing in an `<img>` knows what the upload was
    /// called. The folder is named from the URL alone and holds exactly one file, so the name is
    /// recoverable from the folder rather than from the caller.
    static func offlineCopy(of remote: String) -> URL? {
        let folder = offlineDir.appendingPathComponent(fingerprint(remote), isDirectory: true)
        guard let files = try? FileManager.default.contentsOfDirectory(
            at: folder, includingPropertiesForKeys: nil, options: [.skipsHiddenFiles]) else { return nil }
        return files.first
    }

    /// How much of the phone the offline copies are using.
    static func offlineBytes() -> Int {
        guard let folders = try? FileManager.default.contentsOfDirectory(at: offlineDir, includingPropertiesForKeys: nil, options: [.skipsHiddenFiles])
        else { return 0 }
        return folders.reduce(0) { $0 + bytes(of: $1) }
    }

    /// Budget only, never age: these files exist to be here when there is no signal, and the day
    /// they are needed is the day nothing has refreshed them. Least recently used goes first.
    static func sweepOffline() {
        let fm = FileManager.default
        guard let folders = try? fm.contentsOfDirectory(at: offlineDir, includingPropertiesForKeys: [.contentModificationDateKey], options: [.skipsHiddenFiles])
        else { return }
        var kept = folders.map { folder -> (url: URL, at: Date, bytes: Int) in
            let at = (try? folder.resourceValues(forKeys: [.contentModificationDateKey]))?.contentModificationDate ?? .distantPast
            return (folder, at, bytes(of: folder))
        }
        var total = kept.reduce(0) { $0 + $1.bytes }
        guard total > offlineBudget else { return }
        kept.sort { $0.at < $1.at }
        for entry in kept {
            try? fm.removeItem(at: entry.url)
            total -= entry.bytes
            if total <= offlineBudget { return }
        }
    }

    static func clearOffline() {
        try? FileManager.default.removeItem(at: offlineDir)
    }

    static func destination(remote: String, fileName: String) -> URL {
        destination(remote: remote, fileName: fileName, in: dir)
    }

    private static func destination(remote: String, fileName: String, in folder: URL) -> URL {
        // A name that came off a server row rather than out of this app: slashes would make it a
        // path, and a 300-character one is simply refused by the file system. The extension is what
        // both PDFKit and AVPlayer sniff the type from, so the tail is what survives a trim.
        var safe = fileName.replacingOccurrences(of: "/", with: "-")
        if safe.utf8.count > 180 { safe = String(safe.suffix(60)) }
        if safe.isEmpty || safe == "." || safe == ".." { safe = "file" }
        return folder.appendingPathComponent(fingerprint(remote), isDirectory: true)
                     .appendingPathComponent(safe)
    }

    /// Throws away a file and the folder that was made for it — a refusal that landed on disk, or
    /// bytes nobody can use.
    static func discard(_ file: URL) {
        try? FileManager.default.removeItem(at: file.deletingLastPathComponent())
    }

    /// FNV-1a, spelled out by hand for the reason `ImageDiskCache` spells it out: `Hasher` is seeded
    /// per process, so a folder named from it would be a different folder on the next launch and
    /// nothing would ever be found again — a cache that fails silently while looking like it works.
    private static func fingerprint(_ s: String) -> String {
        var h: UInt64 = 0xcbf2_9ce4_8422_2325
        for b in s.utf8 { h = (h ^ UInt64(b)) &* 0x0000_0100_0000_01b3 }
        return String(h, radix: 16)
    }

    /// Called before a fetch, and never on the main thread: `downloadAttachment` is a nonisolated
    /// async method, so this runs on the cooperative pool along with the request it precedes.
    static func sweep() {
        let fm = FileManager.default
        let keys: [URLResourceKey] = [.contentModificationDateKey]
        guard let folders = try? fm.contentsOfDirectory(at: dir, includingPropertiesForKeys: keys,
                                                        options: [.skipsHiddenFiles]) else { return }
        let cutoff = Date().addingTimeInterval(-maxAge)
        var kept: [(url: URL, at: Date, bytes: Int)] = []
        for folder in folders {
            let at = (try? folder.resourceValues(forKeys: [.contentModificationDateKey]))?
                .contentModificationDate ?? .distantPast
            if at < cutoff { try? fm.removeItem(at: folder); continue }
            kept.append((folder, at, bytes(of: folder)))
        }
        var total = kept.reduce(0) { $0 + $1.bytes }
        guard total > maxBytes else { return }
        // Oldest first. A file somebody is watching right now is also the newest one here, so the
        // trim reaches it last and only ever when the budget is already spent on nothing else.
        for entry in kept.sorted(by: { $0.at < $1.at }) {
            try? fm.removeItem(at: entry.url)
            total -= entry.bytes
            if total <= maxBytes { return }
        }
    }

    private static func bytes(of folder: URL) -> Int {
        let fm = FileManager.default
        guard let files = try? fm.contentsOfDirectory(at: folder, includingPropertiesForKeys: [.fileSizeKey])
        else { return 0 }
        return files.reduce(0) { $0 + (((try? $1.resourceValues(forKeys: [.fileSizeKey]))?.fileSize) ?? 0) }
    }
}

/// What /api/auth/register and /register/resend answer with once a code is on its way. Optional
/// throughout: the screen falls back to the server's current values (10 minutes, 60 seconds)
/// rather than failing a sign-up whose email has already been sent.
struct SignupCodeResponse: Decodable, Sendable {
    /// The address as the server stored it (trimmed, lowercased). Every later call uses this one,
    /// not what was typed, so /verify and the sign-in after it look up the same row.
    let email: String?
    let expiresInSeconds: Int?
    let resendCooldownSeconds: Int?
}

/// POST /api/workspaces/members (201). Only what the Members card reads; every field optional so
/// a server from before `emailSent` existed still decodes.
struct WorkspaceInviteResponse: Decodable, Sendable {
    struct Member: Decodable, Sendable {
        let email: String?
    }
    let member: Member?
    /// true once the invite email (with its set-your-password link) went out; false when the
    /// member was added but the mail failed; nil from a server that does not report it yet.
    let emailSent: Bool?
}

/// A 429 from the sign-up calls, with the wait the server asked for when it named one.
struct SignupRetryLater: LocalizedError, Sendable {
    let message: String
    let seconds: Int?
    var errorDescription: String? { message }
}
