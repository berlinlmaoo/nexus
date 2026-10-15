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

    /// `os` is which Apple system the iOS-family app runs on ("macOS", "iPadOS", "iOS"), from its
    /// User-Agent; nil when the UA does not say (the web's appleAppOs).
    case app(ios: Bool, version: String?, build: String?, kind: Kind, os: String? = nil)
    case browser(name: String?, os: String?, kind: Kind)
    case unknown

    var kind: Kind {
        switch self {
        case .app(_, _, _, let k, _): return k
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

    /// The `(iPad; …)` / `(iPhone; …)` / `(Macintosh; …)` part of the app's own User-Agent.
    private static func appleAppOs(_ ua: String) -> String? {
        guard let g = groups(ua, #"^NEXUS/\d+[^(]*\(([^)]*)\)"#), g.count >= 2, let inside = g[1] else { return nil }
        return has(inside, "iPad") ? "iPadOS" : has(inside, "iPhone|iPod") ? "iOS" : has(inside, "Macintosh|Mac OS X") ? "macOS" : nil
    }

    private static func kind(ofAppleOs os: String) -> Kind {
        os == "macOS" ? .desktop : os == "iPadOS" ? .tablet : .phone
    }

    static func describe(userAgent: String?, client: String?) -> DeviceLabel {
        let ua = userAgent ?? ""
        let tag = (client ?? "").trimmingCharacters(in: .whitespaces)
        if let g = groups(tag, #"^(ios|android)/(\d+(?:\.\d+){0,2})(?:[^/\s]*)(?:/([^/\s]+))?"#, caseless: true), g.count >= 4 {
            let ios = g[1]?.lowercased() == "ios"
            let os = ios ? appleAppOs(ua) : nil
            let kind: Kind = os.map(kind(ofAppleOs:)) ?? (has(ua, "iPad|Tablet", caseless: true) ? .tablet
                : ios && has(ua, "Macintosh|Mac OS X", caseless: true) && !has(ua, "iPhone", caseless: true) ? .desktop
                : .phone)
            return .app(ios: ios, version: g[2], build: g[3], kind: kind, os: os)
        }
        if let g = groups(ua, #"^NEXUS/(\d+)\b"#), g.count >= 2 {
            let os = appleAppOs(ua)
            return .app(ios: true, version: nil, build: g[1], kind: os.map(kind(ofAppleOs:)) ?? .phone, os: os)
        }
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
        case .app(let ios, let version, let build, _, let os):
            // The Mac app is the iOS build under Mac Catalyst; its User-Agent says Macintosh, an iPad says iPad
            // (APIClient.userAgent). The same names as the web: the iPad called itself "iOS" (run 15, Q-IB2).
            let app = !ios ? T("NEXUS app for Android")
                : os == "macOS" || (os == nil && kind == .desktop) ? T("NEXUS app for macOS")
                : os == "iPadOS" ? T("NEXUS app for iPadOS")
                : T("NEXUS app for iOS")
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

/// Sessions that name the same device, as one row (the web's groupSessions).
private struct SessionGroup: Identifiable {
    let id: String
    let name: String
    let device: DeviceLabel
    var sessions: [UserSessionRow]
    let unknown: Bool
}

struct ActiveSessionsCard: View {
    @Environment(AuthStore.self) private var auth
    @State private var rows: [UserSessionRow] = []
    @State private var loading = true
    @State private var loadFailed = false
    @State private var busyId: String?
    @State private var busyGroup: String?
    @State private var busyOthers = false
    @State private var failed = false
    @State private var confirmOne: UserSessionRow?
    @State private var confirmGroup: SessionGroup?
    @State private var confirmOthers = false
    @State private var expanded: Set<String> = []

    private var others: Int { rows.filter { $0.current != true }.count }

    private static func lastActive(_ s: UserSessionRow) -> String { s.lastActiveAt ?? s.createdAt ?? "" }

    /// Grouped by the device they name, as on the web (UI tour run 15, R15-I-02 / Q-IB3: a flat list of 165
    /// rows with "NEXUS app for iOS 0.1.7 (14)" twice). This device first; then one row per device name,
    /// newest activity first, "Unknown device" last. A group of one is a plain session row; a larger group
    /// shows its count, its latest activity, "Sign out all", and expands to the single sessions.
    private var groups: [SessionGroup] {
        var current: [SessionGroup] = []
        var byName: [String: SessionGroup] = [:]
        var order: [String] = []
        for s in rows {
            let device = DeviceLabel.describe(userAgent: s.userAgent, client: s.client)
            let name = device.name
            if s.current == true {
                current.append(SessionGroup(id: "current:\(s.id)", name: name, device: device, sessions: [s], unknown: false))
                continue
            }
            if byName[name] == nil {
                let unknown: Bool
                switch device { case .app, .browser: unknown = false; case .unknown: unknown = true }
                byName[name] = SessionGroup(id: "name:\(name)", name: name, device: device, sessions: [], unknown: unknown)
                order.append(name)
            }
            byName[name]?.sessions.append(s)
        }
        var rest = order.compactMap { byName[$0] }
        for i in rest.indices { rest[i].sessions.sort { Self.lastActive($0) > Self.lastActive($1) } }
        rest.sort { a, b in
            if a.unknown != b.unknown { return !a.unknown }
            return Self.lastActive(a.sessions[0]) > Self.lastActive(b.sessions[0])
        }
        return current + rest
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            // The button beside the title while it fits on one line, under it otherwise: on a phone
            // "Sign out other sessions" wrapped into a two-line pill (UI tour run 14, N-41).
            ViewThatFits(in: .horizontal) {
                HStack(alignment: .top, spacing: 10) {
                    header
                    Spacer(minLength: 0)
                    othersButton
                }
                VStack(alignment: .leading, spacing: 10) {
                    header
                    othersButton
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
                let list = groups
                VStack(spacing: 0) {
                    ForEach(list) { g in
                        if g.sessions.count == 1 {
                            row(g.sessions[0], name: g.name, device: g.device)
                        } else {
                            groupRow(g)
                        }
                        if g.id != list.last?.id { Divider() }
                    }
                }
                .background(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(NX.mutedFg.opacity(0.2)))
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
        .alert(T("Sign out all"), isPresented: Binding(get: { confirmGroup != nil }, set: { if !$0 { confirmGroup = nil } }), presenting: confirmGroup) { g in
            Button(T("Sign out all"), role: .destructive) { Task { await revokeGroup(g) } }
            Button(T("Cancel"), role: .cancel) {}
        } message: { g in
            Text(T("Sign out all {n} sessions of “{name}”? Those devices will need to sign in again.")
                .replacingOccurrences(of: "{n}", with: AppNumber.int(g.sessions.count))
                .replacingOccurrences(of: "{name}", with: g.name))
        }
        .alert(T("Sign out other sessions"), isPresented: $confirmOthers) {
            Button(T("Sign out"), role: .destructive) { Task { await revokeOthers() } }
            Button(T("Cancel"), role: .cancel) {}
        } message: {
            Text(T("Sign out of every other device? They will need to sign in again. This device stays signed in."))
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(T("Active sessions")).font(NXFont.text(15, .bold))
            Text(T("Devices signed in to your account. Sign out any you don't recognise."))
                .font(NXFont.text(12)).foregroundStyle(NX.mutedFg)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    @ViewBuilder private var othersButton: some View {
        if others > 0 {
            // A neutral bordered button, as on the web; red text on the accent pill mixed two meanings
            // (UI tour run 15, R15-I-04 / Q-IB29).
            Button { confirmOthers = true } label: {
                HStack(spacing: 5) {
                    if busyOthers { ProgressView().controlSize(.mini) } else { Image(systemName: "rectangle.portrait.and.arrow.right") }
                    Text(T("Sign out other sessions")).lineLimit(1)
                }
                .font(NXFont.text(12, .semibold)).foregroundStyle(NX.foreground)
                .fixedSize()
                .padding(.horizontal, 12).padding(.vertical, 7)
                .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(NX.border))
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain).hoverEffect(.highlight).disabled(busyOthers)
        }
    }

    /// The small neutral bordered "Sign out" / "Sign out all" of a row.
    private func rowButton(_ title: String, busy: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 4) {
                if busy { ProgressView().controlSize(.mini) }
                Text(title)
            }
            .font(NXFont.text(12, .semibold)).foregroundStyle(NX.foreground).lineLimit(1).fixedSize()
            .padding(.horizontal, 10).padding(.vertical, 6)
            .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(NX.border))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain).hoverEffect(.highlight).disabled(busy)
    }

    /// One fact of a row's meta line with its spaces made non-breaking, so the line wraps only between
    /// facts (at " · "), never inside "Signed in 15 Oct" (UI tour run 14, N-41 / P-I9).
    private static func unbroken(_ s: String) -> String { s.replacingOccurrences(of: " ", with: "\u{00A0}") }

    private func icon(_ device: DeviceLabel, current: Bool) -> some View {
        Image(systemName: device.symbol)
            .font(.system(size: 15, weight: .semibold))
            .foregroundStyle(current ? NX.violet : NX.mutedFg)
            .frame(width: 34, height: 34)
            .background((current ? NX.violet : NX.mutedFg).opacity(0.12), in: RoundedRectangle(cornerRadius: 9, style: .continuous))
    }

    /// A device name that wraps only between words, never between a version and its build:
    /// "0.1.7 (14)" stays together (run 14, R14-WM-24).
    private static func nameText(_ name: String) -> String {
        name.replacingOccurrences(of: " (", with: "\u{00A0}(")
    }

    /// One session. `nested`: a session inside an expanded group, without its own icon and name.
    private func row(_ s: UserSessionRow, name: String, device: DeviceLabel, nested: Bool = false) -> some View {
        let isCurrent = s.current == true
        let meta = [
            s.ipAddress.flatMap { $0.isEmpty ? nil : $0 },
            isCurrent ? nil : Self.activeLabel(s.lastActiveAt),
            T("Signed in {date}").replacingOccurrences(of: "{date}", with: Self.startedLabel(s.createdAt)),
        ].compactMap { $0 }.map(Self.unbroken).joined(separator: " · ")
        return HStack(spacing: 10) {
            if !nested { icon(device, current: isCurrent) }
            VStack(alignment: .leading, spacing: 2) {
                if !nested {
                    HStack(spacing: 6) {
                        Text(Self.nameText(name)).font(NXFont.text(13, .semibold)).lineLimit(2)
                        if isCurrent {
                            Text(T("This device")).font(NXFont.text(10, .bold)).foregroundStyle(NX.success)
                                .padding(.horizontal, 7).padding(.vertical, 2)
                                .background(NX.success.opacity(0.15), in: Capsule())
                                .fixedSize()
                        }
                    }
                }
                Text(meta).font(NXFont.text(11)).foregroundStyle(NX.mutedFg).monospacedDigit().lineLimit(2)
            }
            Spacer(minLength: 0)
            if !isCurrent {
                rowButton(T("Sign out"), busy: busyId == s.id) { confirmOne = s }
            }
        }
        .padding(10)
        .padding(.leading, nested ? 34 : 0)
    }

    private func groupRow(_ g: SessionGroup) -> some View {
        let open = expanded.contains(g.id)
        return VStack(spacing: 0) {
            HStack(alignment: .top, spacing: 10) {
                icon(g.device, current: false)
                VStack(alignment: .leading, spacing: 3) {
                    // The count chip on its own line under the name, the same for every group
                    // (run 15, R15-WM-9: one group put it inline, the others under the name).
                    Text(Self.nameText(g.name)).font(NXFont.text(13, .semibold)).lineLimit(2)
                    HStack(spacing: 6) {
                        Text(T("{n} sessions").replacingOccurrences(of: "{n}", with: AppNumber.int(g.sessions.count)))
                            .font(NXFont.text(10, .bold)).foregroundStyle(NX.mutedFg).monospacedDigit()
                            .padding(.horizontal, 7).padding(.vertical, 2)
                            .background(NX.muted, in: Capsule())
                            .fixedSize()
                        if let active = Self.activeLabel(g.sessions[0].lastActiveAt) {
                            Text(Self.unbroken(active)).font(NXFont.text(11)).foregroundStyle(NX.mutedFg).lineLimit(1)
                        }
                    }
                    Button {
                        withAnimation(.snappy(duration: 0.2)) {
                            if open { expanded.remove(g.id) } else { expanded.insert(g.id) }
                        }
                    } label: {
                        HStack(spacing: 4) {
                            Image(systemName: "chevron.down").font(.system(size: 10, weight: .bold))
                                .rotationEffect(.degrees(open ? 180 : 0))
                            Text(open ? T("Hide sessions") : T("Show all {n}").replacingOccurrences(of: "{n}", with: AppNumber.int(g.sessions.count)))
                        }
                        .font(NXFont.text(12, .semibold)).foregroundStyle(NX.violetText)
                        .frame(minHeight: 28)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityAddTraits(open ? .isSelected : [])
                }
                Spacer(minLength: 0)
                rowButton(T("Sign out all"), busy: busyGroup == g.id) { confirmGroup = g }
            }
            .padding(10)
            if open {
                Divider()
                VStack(spacing: 0) {
                    ForEach(g.sessions) { s in
                        row(s, name: g.name, device: g.device, nested: true)
                        if s.id != g.sessions.last?.id { Divider().padding(.leading, 44) }
                    }
                }
                .background(NX.muted.opacity(0.3))
            }
        }
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

    private func revokeGroup(_ g: SessionGroup) async {
        guard busyGroup == nil else { return }
        busyGroup = g.id; failed = false; defer { busyGroup = nil }
        do {
            for s in g.sessions {
                _ = try await APIClient.shared.revokeSession(s.id)
                rows.removeAll { $0.id == s.id }
            }
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
