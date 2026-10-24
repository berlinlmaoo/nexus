import SwiftUI

// MARK: - Suspicious attendance (Fake GPS) models
//
// Wire shapes of GET /api/attendance/suspects (server lib/attendance-suspect.ts). Optional wherever
// the screen can do without, so a field the server stops sending costs a label, not the list.

struct SuspectSide: Decodable, Sendable {
    let at: String?
    let lat: Double?
    let lng: Double?
    let accuracyM: Double?
    let simulated: Bool?
    let photoUrl: String?
    let address: String?
    let offline: Bool?
    /// "FAKE" | "NOFACE" | "CHECK" | nil
    let level: String?
    let signals: [String]?
    /// Faces found in this selfie by the server's check; nil = not checked yet.
    let faceCount: Int?
}

struct SuspectItem: Decodable, Identifiable, Sendable {
    let recordId: String
    let date: String
    /// "open" | "valid" | "invalid"
    let state: String
    let level: String?
    let user: Person
    let place: String?
    let checkIn: SuspectSide?
    let checkOut: SuspectSide?
    let review: Review?
    /// Warnings already sent about this day, newest first.
    let warnings: [Warning]?
    var id: String { recordId }

    struct Warning: Decodable, Sendable {
        let at: String?
        let by: Review.Actor?
        let message: String?
    }

    struct Person: Decodable, Sendable { let id: String; let name: String? ; let image: String? }
    struct Review: Decodable, Sendable {
        let verdict: String
        let note: String?
        let reviewedAt: String?
        let reviewedBy: Actor?
        struct Actor: Decodable, Sendable { let id: String?; let name: String? }
    }
    var isFake: Bool { level == "FAKE" }
    var isNoFace: Bool { level == "NOFACE" }
}

struct SuspectList: Decodable, Sendable {
    let periodKey: String
    let periodLabel: String?
    let currentPeriodKey: String?
    let counts: Counts?
    let items: [SuspectItem]?
    struct Counts: Decodable, Sendable { let fakeOpen: Int?; let noFaceOpen: Int?; let checkOpen: Int?; let valid: Int?; let invalid: Int? }
}

struct SuspectReviewed: Decodable, Sendable { let ok: Bool?; let verdict: String?; let date: String? }
struct SuspectWarned: Decodable, Sendable { let ok: Bool?; let announcementId: String? }

// MARK: - Control Room → Fake GPS

/// Suspicious attendance (owner, 28 Sep 2026). Attendance the server flagged for its location, per
/// 28→27 period. Only PROOF of a fake location may be judged "Not valid" (the day becomes TK): the
/// phone itself reported a mock/simulated position, or an impossible jump. Weak signals ("same
/// coordinates as last time", fast travel) sit under "Worth a look" and can only be cleared.
/// Mirrors SuspectAttendanceAdmin on the web Control Room. BoD / One Above All; the server re-checks.
struct AdminSuspectSection: View {
    @State private var list: SuspectList?
    @State private var loading = true
    @State private var loadError: String?
    @State private var periodKey: String?
    @State private var tab = 0   // 0 Fake GPS · 1 Worth a look · 2 Reviewed
    @State private var notes: [String: String] = [:]
    @State private var busy: String?
    @State private var notice: String?
    @State private var problem: String?
    /// The ONE confirmation this view presents (two presentations on one view leave one dead).
    @State private var confirming: SuspectItem?
    /// The card a warning is being written for; the sheet hangs off the list, not the root, so it
    /// never shares a view with the confirmation dialog.
    @State private var warning: SuspectItem?
    @State private var warnDraft = ""

    private var items: [SuspectItem] {
        (list?.items ?? []).filter {
            switch tab {
            case 0: return $0.state == "open" && $0.isFake
            case 1: return $0.state == "open" && $0.isNoFace
            case 2: return $0.state == "open" && $0.level == "CHECK"
            default: return $0.state != "open"
            }
        }
    }
    private var isCurrent: Bool { periodKey != nil && periodKey == list?.currentPeriodKey }

    var body: some View {
        Group {
            if loading && list == nil {
                ProgressView().tint(NX.violetText).frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if list == nil, let loadError {
                EmptyState(icon: "exclamationmark.triangle", title: T("Couldn't load suspicious attendance"), subtitle: loadError,
                           tint: NX.warning, actionTitle: T("Try again"), actionIcon: "arrow.clockwise",
                           action: { Task { await load() } })
            } else {
                content
            }
        }
        .task { await load() }
        // Control Room › Attendance monitor: a check-in, check-out or verdict anywhere refetches the month on
        // screen (R-15: `attendance-board-changed`), and on return to the app.
        .liveRefresh(every: 120, on: [.nexusAttendanceChanged, .nexusRealtimeConnected], refreshOnReturn: true) {
            if list != nil && !loading { await load() }
        }
        .alert(T("Make this day TK?"), isPresented: Binding(get: { confirming != nil }, set: { if !$0 { confirming = nil } }), presenting: confirming) { item in
            Button(T("Not valid — make it TK"), role: .destructive) { confirming = nil; Task { await review(item, verdict: "INVALID") } }
            Button(T("Cancel"), role: .cancel) { confirming = nil }
        } message: { item in
            Text(String(format: T("%@ · %@\n\nThe day's attendance is deleted (the evidence is kept) and counted as TK: remaining day off first, then −150 XP. They get a notification with your note."),
                        item.user.name ?? "—", Self.dayLabel(item.date)))
        }
    }

    private var content: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                header
                if let notice {
                    Label(notice, systemImage: "checkmark.circle.fill").font(NXFont.text(13, .semibold)).foregroundStyle(NX.success)
                }
                if let problem {
                    Label(problem, systemImage: "exclamationmark.triangle.fill").font(NXFont.text(13)).foregroundStyle(NX.danger)
                }
                if items.isEmpty {
                    EmptyState(icon: "checkmark.shield", title: emptyTitle, subtitle: emptySubtitle, tint: NX.success, compact: true)
                } else {
                    ForEach(items) { card($0) }
                }
            }
            .padding(16)
        }
        .refreshable { await load() }
        .scrollDismissesKeyboard(.interactively)
        .sheet(item: $warning) { item in warnSheet(item) }
    }

    private var emptyTitle: String {
        switch tab { case 0: return T("No fake GPS this period"); case 1: return T("Every selfie shows a face"); case 2: return T("Nothing to look at"); default: return T("Nothing reviewed yet") }
    }
    private var emptySubtitle: String {
        switch tab {
        case 0: return T("No phone reported a mock location and nobody jumped impossibly far.")
        case 1: return T("No check-in or check-out selfie without a face this period.")
        case 2: return T("No weak signals this period.")
        default: return T("Verdicts given this period show here.")
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(T("Check-ins and check-outs whose location looks faked. Not valid is only possible with proof — the phone itself reported a fake-GPS app, or an impossible jump — and turns the day into TK. The person is told."))
                .font(NXFont.text(12)).foregroundStyle(NX.mutedFg)
            HStack {
                Button { shift(-1) } label: { Image(systemName: "chevron.left") }.disabled(periodKey == nil)
                Spacer()
                Text(list?.periodLabel ?? "…").font(NXFont.text(14, .semibold)).monospacedDigit()
                Spacer()
                Button { shift(1) } label: { Image(systemName: "chevron.right") }.disabled(periodKey == nil || isCurrent)
            }
            .foregroundStyle(NX.violetText)
            // All four chips on one line when they fit (tighter padding before scrolling); the scrolling row
            // fades at its edges so a chip past the card's edge reads as "more", not cut ("Reviewed 1", visual
            // QA 24 Oct 2026).
            ViewThatFits(in: .horizontal) {
                chipRow(padding: 12)
                chipRow(padding: 9)
                ScrollView(.horizontal, showsIndicators: false) { chipRow(padding: 12) }.nxEdgeFade(16)
            }
        }
        .nexusCard()
    }

    private func chipRow(padding: CGFloat) -> some View {
        HStack(spacing: 6) {
            chip(0, T("Fake GPS"), list?.counts?.fakeOpen, padding: padding)
            chip(1, T("No face"), list?.counts?.noFaceOpen, padding: padding)
            chip(2, T("Worth a look"), list?.counts?.checkOpen, padding: padding)
            chip(3, T("Reviewed"), (list?.counts?.valid ?? 0) + (list?.counts?.invalid ?? 0), padding: padding)
        }
        .fixedSize(horizontal: true, vertical: false)
    }

    private func chip(_ i: Int, _ title: String, _ n: Int?, padding: CGFloat = 12) -> some View {
        Button { tab = i } label: {
            Text(n.map { "\(title) \($0)" } ?? title)
                .font(NXFont.text(12, .semibold))
                .lineLimit(1)
                .padding(.horizontal, padding).padding(.vertical, 6)
                .nxChoiceChip(on: tab == i)
                .frame(minHeight: 44).contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    private func card(_ item: SuspectItem) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 10) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(item.user.name ?? "—").font(NXFont.text(15, .semibold)).foregroundStyle(NX.foreground)
                    Text([Self.dayLabel(item.date), item.place].compactMap { $0 }.joined(separator: " · "))
                        .font(NXFont.text(12)).foregroundStyle(NX.mutedFg).lineLimit(1)
                }
                Spacer()
                badge(item)
            }
            side(T("Check-in"), item.checkIn)
            side(T("Check-out"), item.checkOut)
            if let r = item.review {
                Text("\(r.verdict == "INVALID" ? T("Not valid") : T("Fine")) · \(r.reviewedBy?.name ?? T("Board"))\(r.note.map { " — “\($0)”" } ?? "")")
                    .font(NXFont.text(12)).foregroundStyle(NX.mutedFg)
            }
            if item.state == "open" {
                TextField(item.isFake ? T("Note for them (required for Not valid)") : T("Note (optional)"),
                          text: Binding(get: { notes[item.recordId] ?? "" }, set: { notes[item.recordId] = String($0.prefix(300)) }))
                    .font(NXFont.text(14))
                    .padding(10)
                    .background(NX.muted.opacity(0.5), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                HStack(spacing: 8) {
                    Button { Task { await review(item, verdict: "VALID") } } label: {
                        Text(T("It's fine")).font(NXFont.text(14, .semibold)).frame(maxWidth: .infinity).padding(.vertical, 10)
                            .background(NX.muted.opacity(0.7), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                            .foregroundStyle(NX.foreground)
                    }
                    .buttonStyle(.plain)
                    if item.isFake {
                        Button {
                            if (notes[item.recordId] ?? "").trimmingCharacters(in: .whitespacesAndNewlines).count < 3 {
                                problem = T("Write a note first — they will read it.")
                            } else { problem = nil; confirming = item }
                        } label: {
                            Text(T("Not valid…")).font(NXFont.text(14, .bold)).frame(maxWidth: .infinity).padding(.vertical, 10)
                                .background(NX.danger.opacity(0.12), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                                .foregroundStyle(NX.danger)
                        }
                        .buttonStyle(.plain)
                    }
                }
                .disabled(busy != nil)
            }
            // A warning goes to the person as a push and a personal pop-up (owner, 29 Sep 2026).
            Button { warnDraft = Self.defaultWarning(item); warning = item } label: {
                Label(T("Send warning…"), systemImage: "exclamationmark.bubble.fill")
                    .font(NXFont.text(14, .bold)).frame(maxWidth: .infinity).padding(.vertical, 10)
                    .background(NX.warning.opacity(0.14), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                    .foregroundStyle(NX.warning)
            }
            .buttonStyle(.plain)
            .disabled(busy != nil)
            if let ws = item.warnings, !ws.isEmpty {
                VStack(alignment: .leading, spacing: 4) {
                    ForEach(Array(ws.enumerated()), id: \.offset) { _, w in
                        Text("⚠︎ \(w.by?.name ?? T("Board")) · \(Self.clock(w.at)) — \(w.message ?? "")")
                            .font(NXFont.text(11)).foregroundStyle(NX.mutedFg).lineLimit(3)
                    }
                }
            }
        }
        .nexusCard()
    }

    private func badge(_ item: SuspectItem) -> some View {
        let (text, tint): (String, Color) = {
            switch item.state {
            case "invalid": return (T("Not valid · TK"), NX.danger)
            case "valid": return (T("Fine"), NX.success)
            default: return item.isFake ? (T("Fake GPS"), NX.danger) : (T("Worth a look"), NX.warning)
            }
        }()
        return Text(text).font(NXFont.text(11, .bold)).foregroundStyle(tint)
            .padding(.horizontal, 8).padding(.vertical, 4)
            .background(tint.opacity(0.14), in: Capsule())
    }

    @ViewBuilder
    private func side(_ label: String, _ s: SuspectSide?) -> some View {
        if let s {
            HStack(alignment: .top, spacing: 10) {
                CachedImage(url: Self.url(s.photoUrl)) { $0.resizable().scaledToFill() } placeholder: {
                    Image(systemName: "camera").foregroundStyle(NX.mutedFg.opacity(0.5))
                }
                .frame(width: 54, height: 68)
                .background(NX.muted.opacity(0.5))
                .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                VStack(alignment: .leading, spacing: 3) {
                    Text("\(label) \(Self.clock(s.at))\(s.offline == true ? " · offline" : "")")
                        .font(NXFont.text(13, .semibold)).foregroundStyle(NX.foreground)
                    let signals = s.signals ?? []
                    if signals.isEmpty {
                        Text(T("No signal on this side.")).font(NXFont.text(12)).foregroundStyle(NX.mutedFg)
                    } else {
                        ForEach(signals, id: \.self) { t in
                            Text("• \(T(Self.signalKey(t)) == Self.signalKey(t) ? t : Self.localized(t))")
                                .font(NXFont.text(12, s.level == "FAKE" ? .semibold : .regular))
                                .foregroundStyle(s.level == "FAKE" ? NX.danger : NX.warning)
                        }
                    }
                    HStack(spacing: 8) {
                        if let a = s.address, !a.isEmpty {
                            Text(a.components(separatedBy: ",").prefix(2).joined(separator: ","))
                                .font(NXFont.text(11)).foregroundStyle(NX.mutedFg).lineLimit(1)
                        }
                        if let acc = s.accuracyM, acc > 0 {
                            Text("±\(Int(acc.rounded())) m").font(NXFont.text(11)).foregroundStyle(NX.mutedFg).monospacedDigit()
                        }
                        if let la = s.lat, let lo = s.lng, let maps = URL(string: "https://maps.apple.com/?q=\(la),\(lo)") {
                            Link(T("Map"), destination: maps).font(NXFont.text(11, .semibold)).foregroundStyle(NX.violetText)
                        }
                    }
                }
                Spacer(minLength: 0)
            }
            .padding(10)
            .background((s.level == "FAKE" ? NX.danger : s.level == "CHECK" ? NX.warning : NX.muted).opacity(0.08),
                        in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        }
    }

    // The server words its signals in English; the known ones are translated whole here, with the
    // speed carried over. Anything new is shown as sent.
    private static func signalKey(_ t: String) -> String {
        if t.hasPrefix("The phone reported a simulated location") { return "The phone reported a simulated location (a fake-GPS / mock-location app)" }
        if t.hasPrefix("Impossible travel") { return "Impossible travel: %@ since the previous check" }
        if t.hasPrefix("Fast travel") { return "Fast travel: %@ since the previous check — can also be an old cached position" }
        if t.hasPrefix("Same coordinates") { return "Same coordinates as the previous check — usually a phone that hasn't moved or a cached position, not a fake" }
        return t
    }
    private static func localized(_ t: String) -> String {
        let key = signalKey(t)
        guard key.contains("%@") else { return T(key) }
        let speed = t.range(of: #"\d+ km/h"#, options: .regularExpression).map { String(t[$0]) } ?? ""
        return String(format: T(key), speed)
    }

    private static func url(_ s: String?) -> URL? {
        guard let s, !s.isEmpty else { return nil }
        return URL(string: s.hasPrefix("http") ? s : Config.baseURL.absoluteString + s)
    }
    private static func clock(_ iso: String?) -> String {
        let frac = ISO8601DateFormatter(); frac.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        guard let iso, let d = frac.date(from: iso) ?? ISO8601DateFormatter().date(from: iso) else { return "--:--" }
        let f = DateFormatter(); f.dateFormat = "HH:mm"; f.timeZone = TimeZone(identifier: "Asia/Jakarta")
        return f.string(from: d)
    }
    static func dayLabel(_ key: String) -> String {
        let p = DateFormatter(); p.dateFormat = "yyyy-MM-dd"; p.timeZone = TimeZone(identifier: "UTC")
        guard let d = p.date(from: key) else { return key }
        let f = DateFormatter(); f.dateFormat = "EEE d MMM"; f.timeZone = TimeZone(identifier: "UTC")
        f.locale = Locale(identifier: AppLanguage.shared.lang.rawValue == "id" ? "id_ID" : "en_US")
        return f.string(from: d)
    }

    private func warnSheet(_ item: SuspectItem) -> some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 12) {
                Text(String(format: T("%@ gets this as a push notification and a pop-up in NEXUS."), item.user.name ?? "—"))
                    .font(NXFont.text(13)).foregroundStyle(NX.mutedFg)
                TextField(T("Message"), text: $warnDraft, axis: .vertical)
                    .font(NXFont.text(15)).lineLimit(4...10).padding(12)
                    .background(NX.muted.opacity(0.5), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                Button { Task { await sendWarning(item) } } label: {
                    Text(busy != nil ? T("Sending…") : T("Send warning"))
                }
                .buttonStyle(NexusPrimaryButton())
                .disabled(busy != nil || warnDraft.trimmingCharacters(in: .whitespacesAndNewlines).count < 3)
                if let problem {
                    Text(problem).font(NXFont.text(12, .semibold)).foregroundStyle(NX.danger)
                }
                Spacer()
            }
            .padding(20)
            .navigationTitle(T("Send warning")).navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .topBarLeading) { Button(T("Cancel")) { warning = nil } } }
        }
        .presentationDetents([.medium, .large])
    }

    private static func defaultWarning(_ item: SuspectItem) -> String {
        let day = dayLabel(item.date)
        if item.isNoFace {
            return String(format: T("Your attendance selfie on %@ doesn't show your face. Attendance selfies must show your face clearly — next time it may count as absent."), day)
        }
        if item.isFake {
            return String(format: T("Your attendance on %@ came from a faked location. Turn off any fake-GPS app — next time it counts as absent."), day)
        }
        return String(format: T("Your attendance location on %@ looked unusual. Make sure location is on and accurate when you check in."), day)
    }

    private func sendWarning(_ item: SuspectItem) async {
        busy = item.recordId
        defer { busy = nil }
        do {
            _ = try await APIClient.shared.warnSuspectAttendance(recordId: item.recordId,
                                                                 message: warnDraft.trimmingCharacters(in: .whitespacesAndNewlines))
            warning = nil
            problem = nil
            notice = String(format: T("Warning sent to %@."), item.user.name ?? "—")
            await load()
        } catch {
            problem = error.localizedDescription
        }
    }

    private func shift(_ by: Int) {
        guard let key = periodKey else { return }
        let parts = key.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 2 else { return }
        var y = parts[0], m = parts[1] + by
        if m < 1 { m = 12; y -= 1 } else if m > 12 { m = 1; y += 1 }
        periodKey = String(format: "%04d-%02d", y, m)
        Task { await load() }
    }

    private func load() async {
        loading = true
        defer { loading = false }
        do {
            let r = try await APIClient.shared.suspectAttendance(periodKey: periodKey)
            list = r
            if periodKey == nil { periodKey = r.periodKey }
            loadError = nil
        } catch {
            loadError = FailureText.text(error)
        }
    }

    private func review(_ item: SuspectItem, verdict: String) async {
        busy = item.recordId
        defer { busy = nil }
        let note = (notes[item.recordId] ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        do {
            _ = try await APIClient.shared.reviewSuspectAttendance(recordId: item.recordId, verdict: verdict, note: note)
            problem = nil
            notice = verdict == "INVALID"
                ? String(format: T("%@ · %@ is now TK. They were notified."), item.user.name ?? "—", Self.dayLabel(item.date))
                : T("Marked as fine.")
            notes[item.recordId] = nil
            await load()
        } catch {
            notice = nil
            problem = error.localizedDescription
        }
    }
}
