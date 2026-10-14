import SwiftUI

// Settings › Security › Active sessions, the same card as the web's components/settings/ActiveSessions.tsx.

struct UserSessionList: Decodable { let sessions: [UserSessionRow] }

struct UserSessionRow: Decodable, Identifiable, Equatable {
    let id: String
    let client: String?
    let ipAddress: String?
    let userAgent: String?
    let lastActiveAt: String?
    let createdAt: String?
    let current: Bool?
}

/// What a session is, ported from the web's lib/device-label.ts: the NEXUS app (from X-Nexus-Client,
/// or the `NEXUS/<build>` User-Agent of iOS 0.1.5 and older) or a browser on an OS.
enum DeviceLabel {
    enum Kind { case phone, tablet, desktop, unknown }

    case app(ios: Bool, version: String?, build: String?, kind: Kind)
    case browser(name: String?, os: String?, kind: Kind)
    case unknown

    var kind: Kind {
        switch self {
        case .app(_, _, _, let k): return k
        case .browser(_, _, let k): return k
        case .unknown: return .unknown
        }
    }

    private static func has(_ s: String, _ pattern: String, caseless: Bool = false) -> Bool {
        s.range(of: pattern, options: caseless ? [.regularExpression, .caseInsensitive] : .regularExpression) != nil
    }

    /// Capture groups of the first match, nil for a group that did not take part.
    private static func groups(_ s: String, _ pattern: String, caseless: Bool = false) -> [String?]? {
        guard let re = try? NSRegularExpression(pattern: pattern, options: caseless ? [.caseInsensitive] : []),
              let m = re.firstMatch(in: s, range: NSRange(s.startIndex..., in: s)) else { return nil }
        return (0..<m.numberOfRanges).map { i in Range(m.range(at: i), in: s).map { String(s[$0]) } }
    }

    static func describe(userAgent: String?, client: String?) -> DeviceLabel {
        let ua = userAgent ?? ""
        let tag = (client ?? "").trimmingCharacters(in: .whitespaces)
        if let g = groups(tag, #"^(ios|android)/(\d+(?:\.\d+){0,2})(?:[^/\s]*)(?:/([^/\s]+))?"#, caseless: true), g.count >= 4 {
            let ios = g[1]?.lowercased() == "ios"
            let kind: Kind = has(ua, "iPad|Tablet", caseless: true) ? .tablet
                : ios && has(ua, "Macintosh|Mac OS X", caseless: true) && !has(ua, "iPhone", caseless: true) ? .desktop
                : .phone
            return .app(ios: ios, version: g[2], build: g[3], kind: kind)
        }
        if let g = groups(ua, #"^NEXUS/(\d+)\b"#), g.count >= 2 { return .app(ios: true, version: nil, build: g[1], kind: .phone) }
        if has(ua, "^okhttp/", caseless: true) { return .app(ios: false, version: nil, build: nil, kind: .phone) }
        if ua.isEmpty { return .unknown }

        let browser: String? =
            has(ua, #"EdgA?/|EdgiOS/"#) ? "Edge"
            : has(ua, #"OPR/|Opera"#) ? "Opera"
            : has(ua, #"SamsungBrowser/"#) ? "Samsung Internet"
            : has(ua, #"Firefox/|FxiOS/"#) ? "Firefox"
            : has(ua, #"Chrome/|CriOS/"#) ? "Chrome"
            : has(ua, #"Safari/"#) && has(ua, #"Version/"#) ? "Safari"
            : nil
        let os: String? =
            has(ua, "iPad") ? "iPadOS"
            : has(ua, "iPhone|iPod") ? "iOS"
            : has(ua, "Android") ? "Android"
            : has(ua, "Windows") ? "Windows"
            : has(ua, "CrOS") ? "ChromeOS"
            : has(ua, "Macintosh|Mac OS X") ? "macOS"
            : has(ua, "Linux") ? "Linux"
            : nil
        let kind: Kind =
            has(ua, "iPad|Tablet") || (has(ua, "Android") && !has(ua, "Mobile")) ? .tablet
            : has(ua, "iPhone|iPod|Mobile|Android") ? .phone
            : os != nil ? .desktop : .unknown
        if browser == nil && os == nil { return .unknown }
        return .browser(name: browser, os: os, kind: kind)
    }

    var name: String {
        switch self {
        case .app(let ios, let version, let build, _):
            let app = ios ? T("NEXUS app for iOS") : T("NEXUS app for Android")
            if let version { return build.map { "\(app) \(version) (\($0))" } ?? "\(app) \(version)" }
            return build.map { "\(app) (" + T("build {n}").replacingOccurrences(of: "{n}", with: $0) + ")" } ?? app
        case .browser(let name, let os, _):
            if let name, let os { return T("{browser} on {os}").replacingOccurrences(of: "{browser}", with: name).replacingOccurrences(of: "{os}", with: os) }
            return name ?? os ?? T("Unknown device")
        case .unknown:
            return T("Unknown device")
        }
    }

    var symbol: String {
        switch kind {
        case .phone: return "iphone"
        case .tablet: return "ipad"
        case .desktop: return "desktopcomputer"
        case .unknown: return "questionmark.circle"
        }
    }
}

struct ActiveSessionsCard: View {
    @Environment(AuthStore.self) private var auth
    @State private var rows: [UserSessionRow] = []
    @State private var loading = true
    @State private var loadFailed = false
    @State private var busyId: String?
    @State private var busyOthers = false
    @State private var failed = false
    @State private var confirmOne: UserSessionRow?
    @State private var confirmOthers = false

    @State private var showAll = false

    private var others: Int { rows.filter { $0.current != true }.count }

    /// This device first, then the most recently active. Only the 5 latest are drawn until "Show all"
    /// (UI tour run 11, MC-16: a Mac account listed 40+ rows and pushed the rest of Security off the page).
    private static let collapsedCount = 5
    private var ordered: [UserSessionRow] {
        rows.sorted { a, b in
            if (a.current == true) != (b.current == true) { return a.current == true }
            return (a.lastActiveAt ?? a.createdAt ?? "") > (b.lastActiveAt ?? b.createdAt ?? "")
        }
    }
    private var shown: [UserSessionRow] { showAll ? ordered : Array(ordered.prefix(Self.collapsedCount)) }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top, spacing: 10) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(T("Active sessions")).font(NXFont.text(15, .bold))
                    Text(T("Devices signed in to your account. Sign out any you don't recognise."))
                        .font(NXFont.text(12)).foregroundStyle(NX.mutedFg)
                }
                Spacer(minLength: 0)
                if others > 0 {
                    Button { confirmOthers = true } label: {
                        HStack(spacing: 5) {
                            if busyOthers { ProgressView().controlSize(.mini) } else { Image(systemName: "rectangle.portrait.and.arrow.right") }
                            Text(T("Sign out other sessions"))
                        }
                        .font(NXFont.text(12, .semibold)).foregroundStyle(NX.danger)
                    }
                    .buttonStyle(.bordered).disabled(busyOthers)
                }
            }

            if loading && rows.isEmpty {
                Text(T("Loading…")).font(NXFont.text(13)).foregroundStyle(NX.mutedFg)
            } else if loadFailed && rows.isEmpty {
                EmptyState(icon: "exclamationmark.triangle", title: T("Couldn't load your sessions."),
                           subtitle: T("Check your connection, then try again."),
                           actionTitle: T("Try again"), actionIcon: "arrow.clockwise",
                           action: { Task { await load() } }, compact: true)
            } else if rows.isEmpty {
                EmptyState(icon: "iphone", title: T("No active sessions."),
                           subtitle: T("Every device you sign in on shows up here."), compact: true)
            } else {
                let list = shown
                VStack(spacing: 0) {
                    ForEach(list) { s in
                        row(s)
                        if s.id != list.last?.id { Divider() }
                    }
                }
                .background(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(NX.mutedFg.opacity(0.2)))
                if rows.count > Self.collapsedCount {
                    Button {
                        withAnimation(.snappy(duration: 0.2)) { showAll.toggle() }
                    } label: {
                        Text(showAll ? T("Show less") : String(format: T("Show all %d"), rows.count))
                            .font(NXFont.text(12, .semibold)).foregroundStyle(NX.violetText)
                            .frame(minHeight: 32)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                }
            }
            if failed {
                Text(T("Couldn't sign that out. Try again.")).font(NXFont.text(12, .semibold)).foregroundStyle(NX.danger)
            }
        }
        .nexusCard()
        .task { await load() }
        .alert(T("Sign out this device?"), isPresented: Binding(get: { confirmOne != nil }, set: { if !$0 { confirmOne = nil } }), presenting: confirmOne) { s in
            Button(T("Sign out"), role: .destructive) { Task { await revoke(s) } }
            Button(T("Cancel"), role: .cancel) {}
        } message: { s in
            Text(T("Sign out “{name}”? That device will need to sign in again.")
                .replacingOccurrences(of: "{name}", with: DeviceLabel.describe(userAgent: s.userAgent, client: s.client).name))
        }
        .alert(T("Sign out other sessions"), isPresented: $confirmOthers) {
            Button(T("Sign out"), role: .destructive) { Task { await revokeOthers() } }
            Button(T("Cancel"), role: .cancel) {}
        } message: {
            Text(T("Sign out of every other device? They will need to sign in again. This device stays signed in."))
        }
    }

    private func row(_ s: UserSessionRow) -> some View {
        let device = DeviceLabel.describe(userAgent: s.userAgent, client: s.client)
        let isCurrent = s.current == true
        let meta = [
            s.ipAddress.flatMap { $0.isEmpty ? nil : $0 },
            isCurrent ? nil : Self.activeLabel(s.lastActiveAt),
            T("Signed in {date}").replacingOccurrences(of: "{date}", with: Self.startedLabel(s.createdAt)),
        ].compactMap { $0 }.joined(separator: " · ")
        return HStack(spacing: 10) {
            Image(systemName: device.symbol)
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(isCurrent ? NX.violet : NX.mutedFg)
                .frame(width: 34, height: 34)
                .background((isCurrent ? NX.violet : NX.mutedFg).opacity(0.12), in: RoundedRectangle(cornerRadius: 9, style: .continuous))
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 6) {
                    Text(device.name).font(NXFont.text(13, .semibold)).lineLimit(1)
                    if isCurrent {
                        Text(T("This device")).font(NXFont.text(10, .bold)).foregroundStyle(NX.success)
                            .padding(.horizontal, 7).padding(.vertical, 2)
                            .background(NX.success.opacity(0.15), in: Capsule())
                    }
                }
                Text(meta).font(NXFont.text(11)).foregroundStyle(NX.mutedFg).monospacedDigit().lineLimit(2)
            }
            Spacer(minLength: 0)
            if !isCurrent {
                Button { confirmOne = s } label: {
                    HStack(spacing: 4) {
                        if busyId == s.id { ProgressView().controlSize(.mini) }
                        Text(T("Sign out"))
                    }.font(NXFont.text(12, .semibold))
                }
                .buttonStyle(.bordered).disabled(busyId == s.id)
            }
        }
        .padding(10)
    }

    // MARK: actions

    private func load() async {
        loading = true; defer { loading = false }
        do {
            rows = try await APIClient.shared.userSessions()
            loadFailed = false
        } catch APIError.unauthorized {
            // This session was signed out from another device: end it here too.
            auth.logout()
        } catch {
            loadFailed = true
        }
    }

    private func revoke(_ s: UserSessionRow) async {
        guard busyId == nil else { return }
        busyId = s.id; failed = false; defer { busyId = nil }
        do {
            let wasMine = try await APIClient.shared.revokeSession(s.id)
            if wasMine { auth.logout(); return }
            rows.removeAll { $0.id == s.id }
            await load()
        } catch APIError.unauthorized {
            auth.logout()
        } catch {
            failed = true
        }
    }

    private func revokeOthers() async {
        guard !busyOthers else { return }
        busyOthers = true; failed = false; defer { busyOthers = false }
        do {
            try await APIClient.shared.revokeOtherSessions()
            rows.removeAll { $0.current != true }
            await load()
        } catch APIError.unauthorized {
            auth.logout()
        } catch {
            failed = true
        }
    }

    // MARK: labels

    /// The app's date language (en_GB: "14 Oct", day before month, as the web), not en_US's "Oct 14"
    /// (UI tour run 9, M3).
    private static var locale: Locale { AppDateLocale.current }

    private static func parse(_ iso: String?) -> Date? {
        guard let iso else { return nil }
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let d = f.date(from: iso) { return d }
        f.formatOptions = [.withInternetDateTime]
        return f.date(from: iso)
    }

    /// "Active now" under 5 minutes (the server writes lastActiveAt at most every 5), else "Active 3 hours ago".
    static func activeLabel(_ iso: String?) -> String? {
        guard let d = parse(iso) else { return nil }
        let secs = Date().timeIntervalSince(d)
        if secs < 5 * 60 { return T("Active now") }
        let rel: String
        if secs < 30 * 86_400 {
            let f = RelativeDateTimeFormatter()
            f.locale = locale
            f.dateTimeStyle = .named
            rel = f.localizedString(for: d, relativeTo: Date())
        } else {
            rel = d.formatted(Date.FormatStyle(date: .abbreviated, time: .omitted).locale(locale))
        }
        return T("Active {time}").replacingOccurrences(of: "{time}", with: rel)
    }

    static func startedLabel(_ iso: String?) -> String {
        guard let d = parse(iso) else { return "—" }
        let sameYear = Calendar.current.component(.year, from: d) == Calendar.current.component(.year, from: Date())
        // "14 Oct" / "14 Okt", the year only when it is not this one; "Sept" is written "Sep" as on the web.
        return AppDateLocale.formatter(sameYear ? "d MMM" : "d MMM yyyy").string(from: d)
            .replacingOccurrences(of: "Sept", with: "Sep")
    }
}
