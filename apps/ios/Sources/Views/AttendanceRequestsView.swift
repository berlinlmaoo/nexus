import PhotosUI
import SwiftUI
import UniformTypeIdentifiers

// MARK: - shared request helpers

func reqLabel(_ t: String?) -> String {
    switch (t ?? "").uppercased() {
    case "LEAVE": return T("Leave"); case "SICK": return T("Sick"); case "PERMIT": return T("Permit")
    case "DAY_OFF": return "Day Off"; case "RED_DATE": return T("Public Holiday"); default: return (t ?? "—").capitalized
    }
}
func reqStatusLabel(_ s: String?) -> String {
    switch (s ?? "").uppercased() {
    case "APPROVED": return T("Approved"); case "REJECTED": return T("Rejected"); case "CANCELED", "CANCELLED": return T("Canceled")
    default: return T("Pending")
    }
}
/// What to call an attached PHOTO — by what it is evidence of, never by its file name. Builds
/// before 0.1.5 uploaded every picture as "sick-note.jpg", a permit's included, so the name told a
/// reviewer the wrong thing about half the time; and the thumbnail beside it already shows the file.
func reqPhotoLabel(_ type: String?) -> String {
    switch (type ?? "").uppercased() {
    case "PERMIT": return T("Permit photo")
    case "SICK": return T("Sick note")
    default: return T("Photo")
    }
}

/// The extension of a request attachment, read off the stored path first and the uploaded name
/// second. The path is what the server actually serves (it keeps the upload's extension); the
/// name is only a fallback for a path without one. Only the last path component is looked at, so
/// the dots in a host name never pass for an extension.
func requestAttachmentExtension(path: String?, name: String?) -> String? {
    for candidate in [path, name] {
        guard let c = candidate, !c.isEmpty else { continue }
        let bare = c.split(separator: "?", maxSplits: 1).first.map(String.init) ?? c
        let last = bare.split(separator: "/").last.map(String.init) ?? bare
        if let dot = last.lastIndex(of: "."), last.index(after: dot) < last.endIndex {
            return String(last[last.index(after: dot)...]).lowercased()
        }
    }
    return nil
}

/// A request's attachment, drawn the same way everywhere one is shown: the list row, the sheet a
/// notification opens, and a day's detail in the attendance history.
///
/// A photo is a thumbnail with a label saying what it is evidence of, never its file name. Any
/// other file keeps its name — there the name IS the useful part — and a PDF (or film) opens in the
/// app's own viewer, fetched through the client because the file route refuses anyone without the
/// session cookie.
///
/// It owns its full-screen cover, so the screens that embed it do not stack a second cover on a
/// view that already presents something — SwiftUI then silently opens only one of them.
struct RequestAttachmentView: View {
    /// As the server sent it: an app-relative `/api/files/…` path, or an absolute URL.
    let path: String
    let name: String?
    let type: String?
    /// The sheets draw the photo wide; the list draws a thumbnail.
    var large = false
    @State private var preview: AttachmentPreview?
    @State private var fetching = false
    @State private var failed = false

    private var url: URL? { AttendanceRow.fileURL(path) }
    private var ext: String? { requestAttachmentExtension(path: path, name: name) }
    /// Decided by the app's own `AttachmentKind`, the same test the task and vault viewers use.
    private var kind: AttachmentKind? { ext.flatMap { AttachmentKind(mime: nil, name: "file.\($0)") } }
    /// No extension anybody recognises is drawn as a picture, as every attachment here was before:
    /// the route only takes photos and PDFs. A known office document is the one exception.
    private var isPhoto: Bool {
        if let kind { return kind == .image }
        return !["doc", "docx", "xls", "xlsx", "ppt", "pptx", "txt", "csv", "rtf", "zip", "pages", "numbers", "key"].contains(ext ?? "")
    }
    private var fileName: String {
        if let name, !name.isEmpty { return name }
        return path.split(separator: "/").last.map(String.init) ?? T("Attachment")
    }

    var body: some View {
        Group {
            if let url {
                if isPhoto { photo(url) } else { document }
            }
        }
        .fullScreenCover(item: $preview) { AttachmentViewerView(preview: $0) }
    }

    @ViewBuilder private func photo(_ url: URL) -> some View {
        let label = reqPhotoLabel(type)
        Button {
            preview = AttachmentPreview(id: path, name: label, kind: .image, source: url)
        } label: {
            if large {
                VStack(alignment: .leading, spacing: 6) {
                    CachedImage(url: url) { $0.resizable().scaledToFill() } placeholder: { NX.muted }
                        .frame(height: 160).frame(maxWidth: .infinity)
                        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                    HStack(spacing: 6) {
                        Image(systemName: "photo").font(.system(size: 10)).foregroundStyle(NX.mutedFg)
                        Text(label).font(NXFont.text(12, .semibold)).foregroundStyle(NX.violetText)
                        Text("· " + PlatformWording.tapOrClick(tap: "Tap to enlarge", click: "Click to enlarge")).font(NXFont.text(11)).foregroundStyle(NX.mutedFg)
                    }
                }
            } else {
                HStack(spacing: 8) {
                    CachedImage(url: url) { $0.resizable().scaledToFill() } placeholder: { NX.muted }
                        .frame(width: 54, height: 54)
                        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                    VStack(alignment: .leading, spacing: 2) {
                        Text(label).font(NXFont.text(11, .semibold)).foregroundStyle(NX.violetText).lineLimit(1)
                        Text(PlatformWording.tapOrClick(tap: "Tap to enlarge", click: "Click to enlarge")).font(NXFont.text(10)).foregroundStyle(NX.mutedFg)
                    }
                    Spacer(minLength: 0)
                }
            }
        }
        .buttonStyle(.plain)
    }

    /// A file the app can draw is a button; one it cannot (a .docx — the route refuses those, so
    /// only very old rows) stays a plain line pointing at the web, rather than a tap that does nothing.
    @ViewBuilder private var document: some View {
        let line = HStack(spacing: 8) {
            Image(systemName: kind?.glyph ?? "doc.fill")
                .font(.system(size: large ? 16 : 13)).foregroundStyle(kind == nil ? NX.mutedFg : NX.violetText)
                .frame(width: large ? 40 : 34, height: large ? 40 : 34)
                .background(NX.violet.opacity(0.12), in: RoundedRectangle(cornerRadius: 9, style: .continuous))
            VStack(alignment: .leading, spacing: 2) {
                Text(fileName).font(NXFont.text(large ? 13 : 11, .semibold))
                    .foregroundStyle(kind == nil ? NX.foreground : NX.violetText).lineLimit(1)
                Text(failed ? T("Couldn't open this file.") : (kind == nil ? T("Open it on the web") : PlatformWording.tapOrClick(tap: "Tap to open", click: "Click to open")))
                    .font(NXFont.text(10)).foregroundStyle(failed ? NX.danger : NX.mutedFg)
            }
            Spacer(minLength: 0)
            if fetching { ProgressView().scaleEffect(0.7) }
        }
        if kind != nil {
            Button { Task { await open() } } label: { line }
                .buttonStyle(.plain)
                .disabled(fetching)
        } else {
            line
        }
    }

    /// Fetched to a file first: PDFKit and AVPlayer both want something they can seek in, and
    /// neither can carry the session cookie.
    private func open() async {
        guard let kind else { return }
        fetching = true; failed = false
        defer { fetching = false }
        do {
            let file = try await APIClient.shared.downloadAttachment(url: path, fileName: fileName)
            preview = AttachmentPreview(id: path, name: fileName, kind: kind, source: file)
        } catch {
            failed = true
        }
    }
}

private func reqStatusTone(_ s: String?) -> ChipTone {
    switch (s ?? "").uppercased() {
    case "APPROVED": return .success; case "REJECTED": return .danger; case "CANCELED", "CANCELLED": return .neutral; default: return .warning
    }
}
private func reqDateRange(_ r: AttendanceRequest) -> String {
    let s = attDayLabel(r.startDate), e = attDayLabel(r.endDate)
    return s == e || e.isEmpty ? s : "\(s) – \(e)"
}
private func attDayLabel(_ iso: String?) -> String {
    guard let iso, !iso.isEmpty else { return "" }
    if let d = ProjDate.parse(iso) { return ProjDate.dayLabel(d) }
    return attDayOnly.date(from: String(iso.prefix(10))).map { ProjDate.dayLabel($0) } ?? ""
}
/// Built once: this runs for every row the list draws, and a DateFormatter per call is the most
/// expensive line in a row.
private let attDayOnly: DateFormatter = {
    let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"; f.timeZone = ProjDate.cal.timeZone; return f
}()

// MARK: - one queue, two kinds

/// A leave request and an offsite check-out are different models, from different endpoints, decided
/// through different endpoints — but for a reviewer they are the same job: something is waiting on a
/// decision. They used to be two cards, so clearing the queue meant remembering the second one
/// existed. This wrapper is the merge, and it is a UI merge only: it carries nothing but what the
/// list has to sort and filter on, and each kind still approves through the endpoint that owns it.
private enum SubmissionEntry: Identifiable {
    case request(AttendanceRequest)
    case offsite(OffsiteCheckout)

    /// Prefixed because the two ids come from different tables and nothing guarantees they differ.
    var id: String {
        switch self {
        case .request(let r): return "req-" + r.id
        case .offsite(let o): return "off-" + o.id
        }
    }

    /// Matched against the filter chips, which speak the AttendanceRequest vocabulary. An offsite
    /// approval only ever holds three of those five values, so CANCELED simply matches none.
    var statusKey: String {
        switch self {
        case .request(let r): return (r.status ?? "").uppercased()
        case .offsite(let o): return (o.approval ?? "").uppercased()
        }
    }

    var isPending: Bool { statusKey == "PENDING" }

    /// The day the entry is ABOUT, not when it was filed — the one scale both kinds share, and the
    /// only thing that lets them interleave instead of sitting in two blocks. ISO-8601 dates sort
    /// correctly as plain strings, so this needs no date parsing.
    var dayKey: String {
        switch self {
        case .request(let r): return String((r.startDate ?? "").prefix(10))
        case .offsite(let o): return String((o.attendanceDate ?? "").prefix(10))
        }
    }

    /// When this was decided, or "" for one nobody has decided: a pending row, and a withdrawn one
    /// (cancelling your own request is not a review, so the server records no moment for it).
    var decidedKey: String {
        switch self {
        case .request(let r): return r.reviewedAt ?? ""
        case .offsite(let o): return o.approvedAt ?? ""
        }
    }

    /// The Jakarta day a SETTLED row counts from for the date window: the day it was decided; for a
    /// withdrawn request, which has no review and so no `reviewedAt`, the day it was last written —
    /// the withdrawal; and only failing both, the day the request is about.
    var windowKey: String {
        switch self {
        case .request(let r): return SubmissionClock.dayKey(r.reviewedAt ?? r.updatedAt ?? r.startDate)
        case .offsite(let o): return SubmissionClock.dayKey(o.approvedAt ?? o.attendanceDate)
        }
    }

    /// Requester name or reason, ignoring case and accents — "desi" finds "Dési", and a reviewer
    /// looking for "the one about the dentist" finds it by the reason.
    func matches(_ q: String) -> Bool {
        let hay: [String?]
        switch self {
        case .request(let r): hay = [r.user?.name, r.reason]
        case .offsite(let o): hay = [o.user?.name, o.reason]
        }
        return hay.contains { ($0 ?? "").range(of: q, options: [.caseInsensitive, .diacriticInsensitive]) != nil }
    }
}

/// Which stretch of settled history the non-Pending chips show.
private enum SubmissionWindow { case recent, period }

/// Day keys ("yyyy-MM-dd", Jakarta) and the attendance period, for the date window. Keys compare
/// as plain strings, so the filter never builds a Date per row beyond the one parse.
private enum SubmissionClock {
    private static let keyFormatter: DateFormatter = {
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd"
        f.timeZone = ProjDate.cal.timeZone
        f.locale = Locale(identifier: "en_US_POSIX")
        return f
    }()

    static func key(_ d: Date) -> String { keyFormatter.string(from: d) }

    /// The Jakarta day an ISO timestamp falls on. Date-only columns are stored at 00:00 UTC, which is
    /// 07:00 the same day in Jakarta, so they land on their own day too.
    static func dayKey(_ iso: String?) -> String {
        guard let iso, !iso.isEmpty else { return "" }
        if let d = ProjDate.parse(iso) { return key(d) }
        return String(iso.prefix(10))
    }

    /// The attendance period (28th → 27th, Jakarta) that `now` falls in — the same cut-off
    /// `attendancePeriodRange` uses on the server. Starting from the 28th, adding a month never has
    /// to clamp, so February needs no special case.
    static func period(containing now: Date = Date()) -> (start: Date, end: Date) {
        let cal = ProjDate.cal
        let today = cal.startOfDay(for: now)
        var c = cal.dateComponents([.year, .month], from: today)
        c.day = 28
        var start = cal.date(from: c) ?? today
        if cal.component(.day, from: today) < 28 { start = cal.date(byAdding: .month, value: -1, to: start) ?? start }
        let next = cal.date(byAdding: .month, value: 1, to: start) ?? start
        let end = cal.date(byAdding: .day, value: -1, to: next) ?? next
        return (start, end)
    }

    /// Inclusive day-key bounds. "Last 3 days" is today and the two before it, open-ended forward.
    static func bounds(_ w: SubmissionWindow) -> (from: String, to: String?) {
        switch w {
        case .recent:
            let today = ProjDate.cal.startOfDay(for: Date())
            return (key(ProjDate.cal.date(byAdding: .day, value: -2, to: today) ?? today), nil)
        case .period:
            let p = period()
            return (key(p.start), key(p.end))
        }
    }

    /// "28 Agu – 27 Sep"
    static var periodLabel: String {
        let p = period()
        return "\(ProjDate.dayLabel(p.start)) – \(ProjDate.dayLabel(p.end))"
    }
}

// MARK: - Requests card (submit + review)

struct AttendanceRequestsCard: View {
    let canReview: Bool
    /// Whether the offsite check-out queue is fetched and its rows can be decided:
    /// `canManageAttendance || canReviewAttendanceRequests`, the server's own test. The list
    /// scopes itself (BoD: everyone; a manager: their direct reports) and the decision is checked
    /// against the approval chain per record, so a manager sees exactly what they may act on.
    /// A 403 (a permission that changed since today was loaded) reads as an empty list.
    let canReviewOffsite: Bool
    /// Filing FOR somebody else, with the BoD's exemptions — `canManageAttendance` only. Kept apart
    /// from `canReviewOffsite`: a manager who may decide their reports' check-outs is not exempt
    /// from filing rules, and offering them the exemptions only led to a refusal at submit.
    let canGrant: Bool
    @Environment(AuthStore.self) private var auth
    @State private var requests: [AttendanceRequest] = []
    @State private var offsite: [OffsiteCheckout] = []
    /// Set when the list came off the disk rather than the server.
    @State private var cachedFrom: Date?
    @State private var loading = true
    @State private var showComposer = false
    /// The composer opened from an "outside the office" push: PERMIT, today, reason started.
    /// A flag on the one composer sheet rather than a second sheet — two `.sheet` on one view and
    /// one of them never opens.
    @State private var composerPermit = false
    @State private var busy: String?
    @State private var rejecting: AttendanceRequest?
    /// The request a notification pointed at (`AppRouter.focus`), shown on its own sheet the moment
    /// the list is in — with Approve and Reject on it, which is the whole point of tapping the push.
    @Environment(AppRouter.self) private var router
    @State private var focusEntry: SubmissionEntry?
    @State private var focusMissing = false
    /// A decision the server refused (403 outside the approval chain, 409 already decided by
    /// somebody else, 500). It used to be swallowed: the row just stayed pending.
    @State private var actionError: String?
    /// Settled requests are hidden until somebody asks for them. This list is every request ever
    /// filed, newest last, so the handful that still need a decision sat under months of finished
    /// ones — the reviewer had to scroll past their own history to find any work.
    ///
    /// nil means "the user has not chosen", NOT a value — see `activeFilter`. Storing a default
    /// here instead would have to be decided before `canReview` has loaded, latching the wrong
    /// answer for the whole session.
    @State private var filter: String?
    /// Settled rows open on the last three days, not the whole history: a reviewer's Approved chip
    /// was every approval ever made, and what they come to check is what just happened. One tap
    /// widens it to the attendance period, which is what anyone reconciling a month needs.
    @State private var window: SubmissionWindow = .recent
    @State private var query = ""
    private var trimmedQuery: String { query.trimmingCharacters(in: .whitespacesAndNewlines) }

    private let filters = ["PENDING", "APPROVED", "REJECTED", "CANCELED", "ALL"]
    private func filterLabel(_ f: String) -> String { f == "ALL" ? T("All") : reqStatusLabel(f) }

    /// Pending-first is right for a reviewer: this is their work queue and finished rows are noise.
    /// It is wrong for everybody else. A staff member opens this screen to find out what happened to
    /// what they filed — and a rejection now carries the reason it was rejected, which is the single
    /// most important thing on the screen for them. Defaulting them to PENDING would hide exactly
    /// that behind a chip they have no reason to tap.
    ///
    /// Computed rather than stored so it follows `canReview` when the permission finally lands, and
    /// stops following it the moment the user taps a chip themselves.
    private var activeFilter: String { filter ?? (canReview ? "PENDING" : "ALL") }

    /// Both kinds in one list. Pending first — this is a work queue and a settled row is noise —
    /// and then, within each group, on the scale that group is actually read on: a pending row by
    /// the day it is ABOUT, the one key both kinds share and what makes them interleave instead of
    /// sitting in two blocks; a settled one by WHEN IT WAS DECIDED, newest decision first.
    ///
    /// That second half is a fix, not a preference. Ordering settled rows by their day too put a
    /// check-out approved ten seconds ago wherever its attendance date happened to fall — under
    /// every approved leave and public holiday dated later in the year, a few hundred rows down the
    /// Approved chip. The row was in the list; it was nowhere near the person who had just decided
    /// it. Nothing of the sort happened before the merge, because an offsite decision landed at the
    /// top of a card of its own that held nothing else.
    ///
    /// ISO-8601 sorts correctly as a plain string, so neither key needs date parsing. `enumerated()`
    /// breaks the remaining ties: Swift's sort is not stable, so equal keys would otherwise shuffle
    /// on every redraw.
    ///
    /// This is a computed property and body runs on every tap in the card (a "Read it all", a busy
    /// spinner), so it filters BEFORE it sorts and body reads it exactly once. It used to sort the
    /// whole history two or three times per pass to show one chip's worth of it. The offsets are
    /// taken before the filter so the tie-break is the same one the unfiltered list had.
    ///
    /// The date window and the search are applied in the same pass. A PENDING row is never cut by
    /// date — not under Pending and not under All: it is the work queue, and a request filed a week
    /// ago that nobody has decided is exactly the one that must not drop out of sight.
    private var filtered: [SubmissionEntry] {
        let f = activeFilter
        let q = trimmedQuery
        let range: (from: String, to: String?)? = f == "PENDING" ? nil : SubmissionClock.bounds(window)
        let combined = requests.map { SubmissionEntry.request($0) } + offsite.map { SubmissionEntry.offsite($0) }
        return combined.enumerated().filter { item in
            let e = item.element
            guard f == "ALL" || e.statusKey == f else { return false }
            if let range, !e.isPending {
                let k = e.windowKey
                if k.isEmpty || k < range.from { return false }
                if let to = range.to, k > to { return false }
            }
            return q.isEmpty || e.matches(q)
        }.sorted { a, b in
            if a.element.isPending != b.element.isPending { return a.element.isPending }
            if !a.element.isPending, a.element.decidedKey != b.element.decidedKey {
                return a.element.decidedKey > b.element.decidedKey
            }
            if a.element.dayKey != b.element.dayKey { return a.element.dayKey > b.element.dayKey }
            return a.offset < b.offset
        }.map { $0.element }
    }

    private var subtitle: String {
        // Web's copy (attendance.tsx "Requests and approvals"), UI tour run 7.
        if canReviewOffsite { return T("One queue: leave, sick and permit requests plus offsite check-outs waiting on a decision.") }
        return canReview ? T("Review pending requests (leave, sick, permit, day off) and submit your own.") : T("Submit leave, sick or permit requests.")
    }

    /// `.task(id:)` takes one value, and this card now waits on two permissions that land at
    /// different moments — the offsite fetch has to start when `canReviewOffsite` flips, not only
    /// when `canReview` does.
    private var permissionKey: String { "\(canReview)-\(canReviewOffsite)" }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 1) {
                    Text(T("Requests and approvals")).font(NXFont.display(16, .bold)).foregroundStyle(NX.foreground)
                    Text(subtitle)
                        .font(NXFont.text(11)).foregroundStyle(NX.mutedFg)
                }
                Spacer()
                Button { composerPermit = false; showComposer = true } label: {
                    // The web's near-black primary (UI tour run 15, Q-IB22), with its words (run 20, Mac R20-M-04: "+ New").
                    Label(T("New request"), systemImage: "plus").font(NXFont.text(12, .bold)).foregroundStyle(NX.background)
                        .padding(.horizontal, 12).padding(.vertical, 8).background(NX.onyx, in: Capsule())
                        .lineLimit(1).fixedSize()
                }.buttonStyle(.plain)
            }
            // On the header, not the card: the card already presents the reject sheet, and two
            // .sheet modifiers on one view is the oldest way to end up with one that never opens.
            .sheet(item: $focusEntry) { entry in
                RequestFocusSheet(entry: entry, canReview: canReview, canReviewOffsite: canReviewOffsite,
                                  viewerId: auth.session?.userId) { await load() }
            }
            if loading {
                ProgressView().tint(NX.violetText).frame(maxWidth: .infinity).padding(.vertical, 8)
            } else if requests.isEmpty && offsite.isEmpty {
                EmptyState(icon: "calendar.badge.plus", title: canReview ? T("Nothing to review yet") : T("No requests yet"),
                           subtitle: canReview
                               ? T("Leave, sick days, permits and offsite check-outs from your people appear here the moment they're filed, with Approve and Reject right on the row.")
                               : T("Leave, sick days, permits and day-offs you file show up here with their status, and your approver is told the moment you send one."),
                           // No second "File a request": "New request" sits right above (Mac R20-M-04).
                           compact: true)
            } else {
                filterBar
                refineBar
                let shown = filtered
                if shown.isEmpty {
                    emptyForFilter
                } else {
                    // Lazy, and that is the fix for the scroll. A reviewer's All chip is the whole
                    // workspace's history — hundreds of rows — and a plain ForEach in this VStack
                    // built every one of them, and started every thumbnail's fetch, the moment the
                    // card appeared, then rebuilt them all on each tap. The spacing repeats the
                    // card's own 12 so the rows sit exactly where they did.
                    LazyVStack(alignment: .leading, spacing: 12) {
                        ForEach(shown) { row($0) }
                    }
                }
            }
            if let cachedFrom { OfflineNotice(savedAt: cachedFrom) }
        }
        // Hung here rather than on the outer chain beside the composer: two .sheet modifiers on one
        // view is the oldest way in SwiftUI to end up with one of them that never opens.
        .sheet(item: $rejecting) { r in
            RejectReasonSheet(request: r) { await load() }
        }
        .frame(maxWidth: .infinity, alignment: .leading).nexusCard()
        // Keyed on the permissions: both start false while /attendance/today is still in flight, and
        // a plain .task fetched scope=me once and never ran again — so a reviewer kept looking at
        // their own history while the crew's pending requests sat on the server unseen.
        .task(id: permissionKey) { await load() }
        .liveRefresh(every: 60, on: [.nexusAttendanceChanged, .nexusRealtimeConnected]) { await load() }
        // canGrant, not canReview: it is canManageAttendance, the same test the server uses for its
        // BoD exemptions. A manager who may REVIEW requests is not exempt from filing rules, and
        // offering them the exemptions only led to a refusal at submit.
        .sheet(isPresented: $showComposer) { RequestComposerSheet(canGrant: canGrant, prefillPermit: composerPermit) { await load() } }
        // A push tapped while this card is already on screen: claim it now rather than on the next load.
        .onChange(of: router.focus) { _, focus in
            // A permit request never waits for the list; a record does, to be found in it.
            if case .permitToday = focus { claimFocus() } else if !loading { claimFocus() }
        }
        .alert(T("That request isn't in your list anymore"), isPresented: $focusMissing) {
            Button("OK") {}
        } message: { Text(T("It may already have been decided, or it belongs to someone outside your approval chain.")) }
        .alert(T("Couldn't record the decision"), isPresented: Binding(get: { actionError != nil }, set: { if !$0 { actionError = nil } })) {
            Button("OK") { actionError = nil }
        } message: { Text(actionError ?? "") }
    }

    /// Hand the record the router is holding to a sheet, once. Filter to "All" so the row is also
    /// in the list behind the sheet — a settled request the person was told about would otherwise
    /// sit hidden behind the Pending chip.
    private func claimFocus() {
        guard let f = router.focus else { return }
        // Not a record in this list: the push asks for a new permit, so the composer opens — and
        // it does not need the list to have loaded first.
        if case .permitToday = f {
            router.focus = nil
            composerPermit = true
            showComposer = true
            return
        }
        let hit: SubmissionEntry?
        switch f {
        case .attendanceRequest(let id): hit = requests.first { $0.id == id }.map { .request($0) }
        case .offsiteCheckout(let id):   hit = offsite.first { $0.id == id }.map { .offsite($0) }
        default: return
        }
        router.focus = nil
        // Widened and unsearched as well, for the same reason: a decision from last week is outside
        // the three-day window, and a leftover search would hide the row just as well.
        if let hit { filter = "ALL"; window = .period; query = ""; focusEntry = hit } else { focusMissing = true }
    }

    /// The Ticket screen's chip row, same shape and same colours — one filter idiom in the app
    /// is worth more than a second one tuned to this card.
    private var filterBar: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(filters, id: \.self) { f in
                    let on = activeFilter == f
                    Button { filter = f } label: {
                        Text(filterLabel(f)).font(NXFont.text(12, .semibold))
                            .padding(.horizontal, 13).padding(.vertical, 7)
                            .nxChoiceChip(on: on)
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }

    /// The date window (settled chips only) and the search. Under the chips because both narrow
    /// what the chip already chose.
    private var refineBar: some View {
        VStack(alignment: .leading, spacing: 8) {
            if activeFilter != "PENDING" {
                HStack(spacing: 6) {
                    windowChip(.recent, T("Last 3 days"))
                    windowChip(.period, T("This period"))
                    if window == .period {
                        Text(SubmissionClock.periodLabel).font(NXFont.text(11)).foregroundStyle(NX.mutedFg).lineLimit(1)
                    }
                    Spacer(minLength: 0)
                }
            }
            HStack(spacing: 8) {
                Image(systemName: "magnifyingglass").font(.system(size: 12)).foregroundStyle(NX.mutedFg)
                TextField(T("Search name or reason"), text: $query)
                    .font(NXFont.text(13)).autocorrectionDisabled().submitLabel(.search)
                if !query.isEmpty {
                    Button { query = "" } label: {
                        Image(systemName: "xmark.circle.fill").foregroundStyle(NX.mutedFg).touchTarget44(drawn: 20)
                    }.buttonStyle(.plain).accessibilityLabel(T("Clear search"))
                }
            }
            .padding(.horizontal, 11).padding(.vertical, 8)
            .nxSoftField(radius: 11)
        }
    }

    private func windowChip(_ w: SubmissionWindow, _ title: String) -> some View {
        let on = window == w
        return Button { window = w } label: {
            Text(title).font(NXFont.text(11, .semibold))
                .foregroundStyle(on ? NX.violetText : NX.mutedFg)
                .padding(.horizontal, 10).padding(.vertical, 5)
                .background(on ? NX.violet.opacity(0.14) : Color.clear, in: Capsule())
                .overlay(Capsule().strokeBorder(on ? Color.clear : NX.border))
        }
        .buttonStyle(.plain)
    }

    /// Says which of the three narrowings emptied the list, and offers the one step that undoes it.
    @ViewBuilder private var emptyForFilter: some View {
        let f = activeFilter
        if !trimmedQuery.isEmpty {
            EmptyState(icon: "magnifyingglass", title: T("No matches"),
                       subtitle: String(format: T("Nobody's name or reason here contains “%@”."), trimmedQuery),
                       actionTitle: T("Clear search"), actionIcon: nil, action: { query = "" }, compact: true)
        } else if f == "PENDING" {
            EmptyState(icon: "checkmark.circle", title: T("Nothing waiting for a decision"),
                       subtitle: T("Decided requests are under Approved, Rejected and All."),
                       actionTitle: T("Show all"), actionIcon: nil, action: { filter = "ALL" }, compact: true)
        } else if window == .recent {
            EmptyState(icon: "clock.arrow.circlepath", title: Self.emptyTitle(f, recent: true),
                       subtitle: PlatformWording.tapOrClick(tap: "Only the last 3 days are shown, so the list opens on what just happened. The rest of this period is one tap away.", click: "Only the last 3 days are shown, so the list opens on what just happened. The rest of this period is one click away."),
                       actionTitle: T("Show this period"), actionIcon: nil, action: { window = .period }, compact: true)
        } else if f != "ALL" {
            EmptyState(icon: "calendar", title: Self.emptyTitle(f, recent: false),
                       subtitle: String(format: T("This attendance period runs %@."), SubmissionClock.periodLabel),
                       actionTitle: T("Show all"), actionIcon: nil, action: { filter = "ALL" }, compact: true)
        } else {
            EmptyState(icon: "calendar", title: Self.emptyTitle(f, recent: false),
                       subtitle: String(format: T("This attendance period runs %@."), SubmissionClock.periodLabel),
                       compact: true)
        }
    }

    /// Whole sentences per chip rather than a verb spliced into a template: Indonesian does not put
    /// the words in the same order, and a spliced sentence cannot be translated.
    private static func emptyTitle(_ f: String, recent: Bool) -> String {
        switch (f, recent) {
        case ("APPROVED", true): return T("Nothing approved in the last 3 days")
        case ("REJECTED", true): return T("Nothing rejected in the last 3 days")
        case ("CANCELED", true): return T("Nothing canceled in the last 3 days")
        case (_, true): return T("Nothing in the last 3 days")
        case ("APPROVED", false): return T("Nothing approved this period")
        case ("REJECTED", false): return T("Nothing rejected this period")
        case ("CANCELED", false): return T("Nothing canceled this period")
        default: return T("Nothing this period")
        }
    }

    @ViewBuilder private func row(_ entry: SubmissionEntry) -> some View {
        switch entry {
        case .request(let r): requestRow(r)
        case .offsite(let o): offsiteRow(o)
        }
    }

    /// Reasons long enough to be cut off, that the reader has opened. Kept by id so the list can
    /// reload underneath without collapsing what somebody is in the middle of reading.
    @State private var expandedReasons: Set<String> = []

    /// A reason, with a way to see the rest of it. It used to be two lines and an ellipsis, and the
    /// rest existed nowhere in the app — an approver decided on half a sentence.
    private func reasonText(_ text: String, id: String, collapsedLines: Int) -> some View {
        let open = expandedReasons.contains(id)
        let long = text.count > 90 || text.contains("\n")
        return VStack(alignment: .leading, spacing: 2) {
            Text(text).font(NXFont.text(12)).foregroundStyle(NX.foreground.opacity(0.85))
                .lineLimit(open ? nil : collapsedLines)
                .fixedSize(horizontal: false, vertical: open)
            if long {
                Text(open ? T("Show less") : T("Read it all"))
                    .font(NXFont.text(10, .bold)).foregroundStyle(NX.violetText)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .contentShape(Rectangle())
        .onTapGesture {
            guard long else { return }
            withAnimation(.easeInOut(duration: 0.18)) {
                if open { expandedReasons.remove(id) } else { expandedReasons.insert(id) }
            }
        }
    }

    /// Who settled this and when — drawn for every decided row, note or no note. Approving without
    /// typing a note left the row saying only "Approved", so nobody could tell who had done it or
    /// when, and a question about a decision had nowhere to start.
    @ViewBuilder private func decisionStamp(_ r: AttendanceRequest) -> some View {
        let status = (r.status ?? "").uppercased()
        if status != "PENDING" {
            let verb = status == "APPROVED" ? T("Approved") : status == "REJECTED" ? T("Rejected") : T("Canceled")
            let who = r.reviewerName
            let when = Self.stamp(r.reviewedAt)
            HStack(spacing: 5) {
                Image(systemName: status == "APPROVED" ? "checkmark.seal.fill" : status == "REJECTED" ? "xmark.seal.fill" : "slash.circle.fill")
                    .font(.system(size: 10))
                    .foregroundStyle(status == "APPROVED" ? NX.success : status == "REJECTED" ? NX.danger : NX.mutedFg)
                Text([verb, who.map { "\(T("by")) \($0)" } ?? T("automatically"), when].compactMap { $0 }.joined(separator: " · "))
                    .font(NXFont.text(10, .semibold)).foregroundStyle(NX.mutedFg)
                    .lineLimit(2).fixedSize(horizontal: false, vertical: true)
                Spacer(minLength: 0)
            }
        }
    }

    /// "23 Sep · 19:04" in Jakarta time, or nil when the server sent no timestamp.
    ///
    /// Every decided row calls this, and it used to build three formatters per call — for a
    /// reviewer scrolling the Approved chip that was the bulk of the cost of drawing a row.
    static func stamp(_ iso: String?) -> String? {
        guard let iso, let date = ProjDate.parse(iso) else { return nil }
        return stampFormatter.string(from: date)
    }
    private static let stampFormatter: DateFormatter = {
        let f = DateFormatter()
        f.dateFormat = "d MMM · HH:mm"
        f.timeZone = TimeZone(identifier: "Asia/Jakarta")
        f.locale = Locale(identifier: "en_US_POSIX")
        return f
    }()

    private func requestRow(_ r: AttendanceRequest) -> some View {
        let pending = (r.status ?? "").uppercased() == "PENDING"
        let working = busy == r.id
        return VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(reqLabel(r.type)).font(NXFont.text(13, .bold)).foregroundStyle(NX.foreground)
                Spacer()
                NexusChip(text: reqStatusLabel(r.status), tone: reqStatusTone(r.status))
            }
            HStack(spacing: 6) {
                Image(systemName: "calendar").font(.system(size: 10)).foregroundStyle(NX.mutedFg)
                Text(reqDateRange(r)).font(NXFont.text(11)).foregroundStyle(NX.mutedFg)
                if canReview, let n = r.user?.name { Text("· \(n)").font(NXFont.text(11)).foregroundStyle(NX.mutedFg).lineLimit(1) }
            }
            if let reason = r.reason, !reason.isEmpty {
                reasonText(reason, id: r.id, collapsedLines: 3)
            }
            if r.attachmentURL != nil, let path = r.supportingDocumentUrl {
                RequestAttachmentView(path: path, name: r.supportingDocumentName, type: r.type)
            }
            decisionStamp(r)
            if let note = r.reviewNoteText { decisionNote(note, rejected: r.status?.uppercased() == "REJECTED", by: r.reviewerName) }
            if pending {
                HStack(spacing: 8) {
                    if working { ProgressView().scaleEffect(0.7) }
                    // `canReview` is a ROLE, and a role does not stop applying to the person
                    // holding it. A reviewer's own pending request was drawn with Approve and
                    // Reject on it, and the server answered 403 SELF_REVIEW every time — the
                    // four-eyes rule doing its job, reached through a button that should never
                    // have been offered. What their own request actually needs is the same
                    // action everybody else gets for theirs.
                    else if canReview && !r.isOwn(viewerId: auth.session?.userId) {
                        actionBtn(T("Approve"), .success) { await review(r, "approve") }
                        // Straight to the reason sheet: the decision and the reason go up in the
                        // same PATCH, so there is nothing to undo if the sheet is cancelled.
                        actionBtn(T("Reject"), .danger) { rejecting = r }
                    } else {
                        actionBtn(T("Cancel it"), .neutral) { await review(r, "cancel") }
                    }
                }.padding(.top, 2)
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(NX.muted.opacity(0.4), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
    }

    private func actionBtn(_ title: String, _ tone: ChipTone, _ action: @escaping () async -> Void) -> some View {
        Button { Task { await action() } } label: {
            Text(title).font(NXFont.text(12, .bold)).foregroundStyle(tone.fg)
                .padding(.horizontal, 12).padding(.vertical, 6).background(tone.bg, in: Capsule())
        }.buttonStyle(.plain)
    }

    /// Why the request was decided the way it was. The field has been in this payload all along and
    /// nothing read it, so somebody whose leave was refused saw a red chip and had to go and ask.
    ///
    /// The heading follows `by`, and that is the whole point of it: the nightly cron writes a note
    /// too ("Auto-deducted: bolos …") with `reviewedById` null, and calling that "Note from the
    /// approver" tells the reader a person judged them when nothing of the sort happened.
    private func decisionNote(_ note: String, rejected: Bool, by: String?) -> some View {
        let accent = rejected ? NX.danger : NX.success
        let heading = rejected ? T("Why it was rejected")
            : (by == nil ? T("Recorded automatically") : T("Note from the approver"))
        return HStack(alignment: .top, spacing: 6) {
            Image(systemName: rejected ? "exclamationmark.bubble.fill" : "text.bubble.fill")
                .font(.system(size: 10)).foregroundStyle(accent).padding(.top, 2)
            VStack(alignment: .leading, spacing: 2) {
                Text(heading)
                    .font(NXFont.text(10, .bold)).foregroundStyle(accent)
                Text(note).font(NXFont.text(12)).foregroundStyle(NX.foreground.opacity(0.85))
                    .fixedSize(horizontal: false, vertical: true)
                if let by, !by.isEmpty {
                    Text("· \(by)").font(NXFont.text(10)).foregroundStyle(NX.mutedFg)
                }
            }
            Spacer(minLength: 0)
        }
        .padding(8)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(accent.opacity(0.1), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
    }

    /// The offsite kind. Same list, same spacing, same chips — but spelled out as its own thing,
    /// because approving one means "that check-out from outside the geofence was legitimate", not
    /// "this person may have the day off", and a reviewer must not confuse the two.
    private func offsiteRow(_ o: OffsiteCheckout) -> some View {
        // Anti self-approve, same rule as the web: the buttons only appear on somebody else's row.
        let mine = o.user?.id != nil && o.user?.id == auth.session?.userId
        let working = busy == o.id
        return VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 6) {
                Image(systemName: "location.fill").font(.system(size: 10)).foregroundStyle(NX.violetText)
                Text(T("Offsite check-out")).font(NXFont.text(13, .bold)).foregroundStyle(NX.foreground)
                Spacer()
                NexusChip(text: reqStatusLabel(o.approval), tone: reqStatusTone(o.approval))
            }
            HStack(spacing: 6) {
                Image(systemName: "clock").font(.system(size: 10)).foregroundStyle(NX.mutedFg)
                Text("\(attDayLabel(o.attendanceDate)) · \(AgendaRange.timeLabel(o.checkOutAt ?? ""))")
                    .font(NXFont.text(11)).foregroundStyle(NX.mutedFg)
                if let n = o.user?.name { Text("· \(n)").font(NXFont.text(11)).foregroundStyle(NX.mutedFg).lineLimit(1) }
            }
            if let reason = o.reason, !reason.isEmpty {
                reasonText(reason, id: "offsite-\(o.id)", collapsedLines: 3)
            }
            // Where they actually were, in the order a reviewer reads it: the place first, then how
            // far off it is from the office they should have been at.
            if let addr = o.address, !addr.isEmpty {
                Text(addr).font(NXFont.text(11)).foregroundStyle(NX.mutedFg).lineLimit(2)
            }
            if let d = o.distanceMeters {
                Text("±\(Int(d.rounded())) m · \(o.officeName ?? T("office"))")
                    .font(NXFont.text(11)).foregroundStyle(NX.mutedFg)
            }
            if let url = o.mapURL {
                Link(destination: url) {
                    Label(T("View map"), systemImage: "mappin.and.ellipse")
                        .font(NXFont.text(11, .semibold)).foregroundStyle(NX.violetText)
                }
            }
            if !o.isPending, let by = o.approverName, !by.isEmpty {
                Text("· \(by)").font(NXFont.text(11)).foregroundStyle(NX.mutedFg)
            }
            if o.isPending {
                HStack(spacing: 8) {
                    if working { ProgressView().scaleEffect(0.7) }
                    else if mine {
                        Text(T("You can't approve your own.")).font(NXFont.text(11)).foregroundStyle(NX.mutedFg)
                    } else {
                        actionBtn(T("Approve"), .success) { await reviewOffsite(o, "approve") }
                        actionBtn(T("Reject"), .danger) { await reviewOffsite(o, "reject") }
                    }
                }.padding(.top, 2)
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(NX.muted.opacity(0.4), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
    }

    private func review(_ r: AttendanceRequest, _ action: String) async {
        busy = r.id; defer { busy = nil }
        do { _ = try await APIClient.shared.reviewAttendanceRequest(id: r.id, action: action) }
        catch { actionError = (error as? LocalizedError)?.errorDescription ?? T("The server refused it. Try again.") }
        await load()
    }

    /// Deliberately a second call to a second endpoint. The queue is merged; the decision is not —
    /// an offsite check-out is an AttendanceRecord and only `/attendance/offsite-checkouts/[id]`
    /// knows what approving one has to do (the −25 XP on reject, the four-eyes guard, the notify).
    private func reviewOffsite(_ o: OffsiteCheckout, _ action: String) async {
        busy = o.id; defer { busy = nil }
        do { _ = try await APIClient.shared.reviewOffsiteCheckout(id: o.id, action: action) }
        catch { actionError = (error as? LocalizedError)?.errorDescription ?? T("The server refused it. Try again.") }
        await load()
    }

    private func load() async {
        let scope = canReview ? "workspace" : "me"
        do {
            let all = try await APIClient.shared.attendanceRequests(scope: scope)
            // Auto-deductions are the nightly cron's penalties, not something anyone filed, so they
            // do not belong in a list of submissions. The server drops them from this endpoint; we
            // repeat the test rather than trust it, because a build outlives the server it was
            // written against and the alternative is a penalty row wearing an approver's face.
            requests = all.filter { !$0.isAutoDeduction }
            cachedFrom = nil
        }
        catch APIError.unauthorized { auth.logout(); loading = false; return }
        catch {
            // Filed requests and their decisions are exactly what somebody wants to check on a
            // site with no bars. The same auto-deduction filter is applied to the saved copy —
            // a cache is not a reason to relax a rule.
            if let hit = ResponseCache.decoded("attendance-requests-\(scope)", as: AttendanceRequestsResponse.self) {
                requests = hit.value.requests.filter { !$0.isAutoDeduction }
                cachedFrom = hit.savedAt
            } else {
                requests = []
                cachedFrom = nil
            }
        }
        // Only for a reviewer — see `canReviewOffsite`; the server narrows the list to what this
        // reviewer may decide. Fetched second and separately: a 403 or an outage here must leave the
        // requests already on screen alone.
        if canReviewOffsite {
            do { offsite = try await APIClient.shared.offsiteCheckouts() }
            catch APIError.unauthorized { auth.logout() } catch { offsite = [] }
        } else {
            offsite = []
        }
        loading = false
        claimFocus()
    }
}

// MARK: - The request a notification was about

/// One request or offsite check-out, alone on a sheet, with its decision buttons.
///
/// This is where a tapped push lands. It repeats the card's row rather than reusing it because the
/// row's Reject opens a sheet hung on the card — underneath this one, where SwiftUI will not
/// present it. Here the reason is a field on the same sheet, so the decision is one screen.
private struct RequestFocusSheet: View {
    let entry: SubmissionEntry
    let canReview: Bool
    let canReviewOffsite: Bool
    let viewerId: String?
    /// Runs after a decision has been recorded, so the list behind the sheet is refreshed.
    let onDone: () async -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var busy = false
    @State private var rejecting = false
    @State private var note = ""
    @State private var err: String?

    var body: some View {
        NavigationStack {
            ZStack {
                NX.background.ignoresSafeArea()
                ScrollView {
                    VStack(alignment: .leading, spacing: 14) {
                        switch entry {
                        case .request(let r): requestBody(r)
                        case .offsite(let o): offsiteBody(o)
                        }
                        if let err { Text(err).font(NXFont.text(12)).foregroundStyle(NX.danger) }
                    }
                    .padding(16)
                }
            }
            .keyboardDoneBar()
            .navigationTitle(T("From your notification"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button(T("Close")) { dismiss() } } }
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
    }

    // MARK: request

    @ViewBuilder private func requestBody(_ r: AttendanceRequest) -> some View {
        let pending = (r.status ?? "").uppercased() == "PENDING"
        let mine = r.isOwn(viewerId: viewerId)
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text(reqLabel(r.type)).font(NXFont.display(18, .bold)).foregroundStyle(NX.foreground)
                Spacer()
                NexusChip(text: reqStatusLabel(r.status), tone: reqStatusTone(r.status))
            }
            if let n = r.user?.name, !n.isEmpty {
                Label(n, systemImage: "person").font(NXFont.text(13, .semibold)).foregroundStyle(NX.foreground)
            }
            Label(reqDateRange(r), systemImage: "calendar").font(NXFont.text(13)).foregroundStyle(NX.mutedFg)
            if let reason = r.reason, !reason.isEmpty {
                Text(reason).font(NXFont.text(14)).foregroundStyle(NX.foreground.opacity(0.9))
                    .fixedSize(horizontal: false, vertical: true)
            }
            if r.attachmentURL != nil, let path = r.supportingDocumentUrl {
                RequestAttachmentView(path: path, name: r.supportingDocumentName, type: r.type, large: true)
            }
            if let note = r.reviewNoteText {
                VStack(alignment: .leading, spacing: 2) {
                    Text(r.status?.uppercased() == "REJECTED" ? T("Why it was rejected") : T("Note from the approver"))
                        .font(NXFont.text(10, .bold)).foregroundStyle(NX.mutedFg)
                    Text(note).font(NXFont.text(13)).foregroundStyle(NX.foreground.opacity(0.85))
                    if let by = r.reviewerName, !by.isEmpty { Text("· \(by)").font(NXFont.text(10)).foregroundStyle(NX.mutedFg) }
                }
                .padding(10).frame(maxWidth: .infinity, alignment: .leading)
                .background(NX.muted.opacity(0.4), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading).nexusCard()

        if pending {
            if busy {
                ProgressView().tint(NX.violetText).frame(maxWidth: .infinity)
            } else if canReview && !mine {
                if rejecting {
                    VStack(alignment: .leading, spacing: 8) {
                        Text(T("Why is it rejected?")).font(NXFont.text(12, .bold)).foregroundStyle(NX.foreground)
                        TextField(T("The requester will read this"), text: $note, axis: .vertical)
                            .lineLimit(2...5).textFieldStyle(.nxSoft)
                        HStack(spacing: 8) {
                            Button(T("Back")) { rejecting = false }.buttonStyle(.bordered)
                            Button(T("Confirm rejection")) { Task { await decide("reject", note: note) } }
                                .buttonStyle(NexusPrimaryButton())
                                .disabled(note.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                        }
                    }
                } else {
                    HStack(spacing: 10) {
                        Button(T("Approve")) { Task { await decide("approve") } }.buttonStyle(NexusPrimaryButton())
                        Button(T("Reject")) { rejecting = true }.buttonStyle(NexusPrimaryButton(tint: NX.danger))
                    }
                }
            } else if mine {
                Button(T("Cancel this request")) { Task { await decide("cancel") } }.buttonStyle(.bordered)
            }
        }
    }

    // MARK: offsite

    @ViewBuilder private func offsiteBody(_ o: OffsiteCheckout) -> some View {
        let mine = o.user?.id != nil && o.user?.id == viewerId
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Label(T("Offsite check-out"), systemImage: "location.fill").font(NXFont.display(18, .bold)).foregroundStyle(NX.foreground)
                Spacer()
                NexusChip(text: reqStatusLabel(o.approval), tone: reqStatusTone(o.approval))
            }
            if let n = o.user?.name, !n.isEmpty {
                Label(n, systemImage: "person").font(NXFont.text(13, .semibold)).foregroundStyle(NX.foreground)
            }
            Label("\(attDayLabel(o.attendanceDate)) · \(AgendaRange.timeLabel(o.checkOutAt ?? ""))", systemImage: "clock")
                .font(NXFont.text(13)).foregroundStyle(NX.mutedFg)
            if let reason = o.reason, !reason.isEmpty {
                Text(reason).font(NXFont.text(14)).foregroundStyle(NX.foreground.opacity(0.9)).fixedSize(horizontal: false, vertical: true)
            }
            if let addr = o.address, !addr.isEmpty { Text(addr).font(NXFont.text(12)).foregroundStyle(NX.mutedFg) }
            if let d = o.distanceMeters {
                Text("±\(Int(d.rounded())) m · \(o.officeName ?? T("office"))").font(NXFont.text(12)).foregroundStyle(NX.mutedFg)
            }
            if let url = o.mapURL {
                Link(destination: url) {
                    Label(T("View map"), systemImage: "mappin.and.ellipse").font(NXFont.text(12, .semibold)).foregroundStyle(NX.violetText)
                }
            }
            if !o.isPending, let by = o.approverName, !by.isEmpty {
                Text("· \(by)").font(NXFont.text(11)).foregroundStyle(NX.mutedFg)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading).nexusCard()

        if o.isPending {
            if busy {
                ProgressView().tint(NX.violetText).frame(maxWidth: .infinity)
            } else if mine {
                Text(T("You can't approve your own.")).font(NXFont.text(12)).foregroundStyle(NX.mutedFg)
            } else if canReviewOffsite {
                HStack(spacing: 10) {
                    Button(T("Approve")) { Task { await decideOffsite("approve") } }.buttonStyle(NexusPrimaryButton())
                    Button(T("Reject")) { Task { await decideOffsite("reject") } }.buttonStyle(NexusPrimaryButton(tint: NX.danger))
                }
            }
        }
    }

    // MARK: work

    private func decide(_ action: String, note: String? = nil) async {
        guard case .request(let r) = entry else { return }
        busy = true; defer { busy = false }
        do {
            _ = try await APIClient.shared.reviewAttendanceRequest(id: r.id, action: action,
                                                                    reviewNote: note?.trimmingCharacters(in: .whitespacesAndNewlines))
            await onDone(); dismiss()
        } catch { err = (error as? LocalizedError)?.errorDescription ?? T("Couldn't record the decision. Try again.") }
    }

    private func decideOffsite(_ action: String) async {
        guard case .offsite(let o) = entry else { return }
        busy = true; defer { busy = false }
        do {
            _ = try await APIClient.shared.reviewOffsiteCheckout(id: o.id, action: action)
            await onDone(); dismiss()
        } catch { err = (error as? LocalizedError)?.errorDescription ?? T("Couldn't record the decision. Try again.") }
    }
}

// MARK: - Reject with a reason

/// Rejecting used to be one tap and no explanation, which left the requester with a red chip and a
/// conversation to start. The server takes the reason as `reviewNote` on the very same PATCH that
/// records the decision, so there is no second call and nothing to reconcile if this sheet is
/// dismissed instead.
///
/// A reason is REQUIRED here even though the route would accept the reject without one: an empty
/// note puts the requester back exactly where this change is meant to move them from.
struct RejectReasonSheet: View {
    let request: AttendanceRequest
    let onReviewed: () async -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var note = ""
    @State private var busy = false
    @State private var err: String?

    private var trimmed: String { note.trimmingCharacters(in: .whitespacesAndNewlines) }

    var body: some View {
        NavigationStack {
            ZStack {
                NX.background.ignoresSafeArea()
                ScrollView {
                    VStack(alignment: .leading, spacing: 18) {
                        VStack(alignment: .leading, spacing: 3) {
                            Text(reqLabel(request.type)).font(NXFont.display(16, .bold)).foregroundStyle(NX.foreground)
                            Text([request.user?.name, reqDateRange(request)].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " — "))
                                .font(NXFont.text(12)).foregroundStyle(NX.mutedFg)
                            if let reason = request.reason, !reason.isEmpty {
                                Text(reason).font(NXFont.text(13)).foregroundStyle(NX.foreground.opacity(0.85))
                                    .padding(.top, 4).fixedSize(horizontal: false, vertical: true)
                            }
                        }
                        VStack(alignment: .leading, spacing: 7) {
                            SectionLabel(T("REJECTION REASON"))
                            TextField(T("Say why, so they can fix it and file again…"), text: $note, axis: .vertical)
                                .font(NXFont.text(15)).lineLimit(3...6).padding(12)
                                .nxSoftField(radius: 12)
                            Text(T("The person who filed it reads this next to the decision."))
                                .font(NXFont.text(11)).foregroundStyle(NX.mutedFg)
                        }
                        if let err { Text(err).font(NXFont.text(13, .semibold)).foregroundStyle(NX.danger) }
                        Button { Task { await send() } } label: {
                            HStack(spacing: 8) { if busy { ProgressView().tint(.white) }; Text(T("Reject request")) }
                        }
                        .buttonStyle(NexusPrimaryButton(tint: NX.danger)).disabled(busy || trimmed.isEmpty)
                    }
                    .padding(20)
                }
            }
            .keyboardDoneBar()
            .navigationTitle(T("Reject"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .topBarLeading) { Button(T("Cancel")) { dismiss() } } }
        }
    }

    private func send() async {
        busy = true; err = nil; defer { busy = false }
        do {
            try await APIClient.shared.reviewAttendanceRequest(id: request.id, action: "reject", reviewNote: trimmed)
            await onReviewed()
            dismiss()
        } catch {
            err = (error as? LocalizedError)?.errorDescription ?? T("Could not send the decision.")
        }
    }
}

// MARK: - New request composer

struct RequestComposerSheet: View {
    let canGrant: Bool
    /// Opened from the "outside the office" push: starts on PERMIT for today with the reason begun
    /// and the location already being fetched. Declared before `onCreated` so every existing
    /// `RequestComposerSheet(canGrant:) { … }` call keeps its trailing closure.
    var prefillPermit: Bool = false
    let onCreated: () async -> Void
    @State private var didPrefill = false
    /// Started for the person, finished by them: the server wants a reason, not a template.
    private static var permitReasonPrefix: String { T("Out-of-office activity: ") }
    @Environment(\.dismiss) private var dismiss
    @State private var type: String = "DAY_OFF"
    @State private var start = Date()
    /// Annual leave is picked as one range (owner, 29 Sep 2026), capped at the days left; each run
    /// of consecutive dates is sent as one request.
    @State private var leaveStart: Date?
    @State private var leaveEnd: Date?
    @State private var leaveCapNote: String?
    @State private var reason = ""
    @State private var attach: (name: String, data: Data)?
    @State private var showImporter = false
    @State private var showPhotoPicker = false
    @State private var showCamera = false
    @State private var pickedPhoto: PhotosPickerItem?
    @State private var busy = false
    @State private var err: String?
    @State private var uploadProgress = UploadProgress()
    /// One idempotency key per submit, kept while the form says the same thing (a retry after a timeout or a
    /// second tap sends the same key and gets back the request already stored); a changed form gets a new one.
    @State private var submitKey: SubmitKey?
    private struct SubmitKey { let form: String; let key: String }
    /// Quotas and eligibility, so a type nobody can use is never offered in the first place.
    @State private var quota: AttendanceToday?
    /// Izin carries the same evidence a check-in does: a photo AND where it was filed from.
    @State private var loc = LocationManager()
    @State private var coords: (lat: Double, lng: Double)?
    @State private var geoBusy = false
    @State private var geoError: String?

    /// Only what this person can actually file. Leave needs a year of service AND days left; public
    /// holiday needs the BoD to have set a quota for the month, with days of it left. Offering either
    /// without that is a button whose only outcome is a refusal, and people read a refusal as the app
    /// being broken.
    ///
    /// The same for a BoD as for staff. This composer only ever files for the signed-in person — it
    /// sends no `targetUserId` — and the server's quota and eligibility checks skip only a grant FOR
    /// SOMEBODY ELSE (`isGrant`), never a BoD filing their own. The old `canGrant ||` offered a BoD
    /// Leave and Public Holiday they could not use, and the submit was then refused.
    private var types: [String] {
        var out: [String] = []
        if leaveUsable { out.append("LEAVE") }
        out.append(contentsOf: ["SICK", "PERMIT", "DAY_OFF"])
        if redDateUsable { out.append("RED_DATE") }
        return out
    }
    private var redDateUsable: Bool {
        guard let q = quota, let total = q.redDateQuota, total > 0 else { return false }
        return total - (q.redDateUsedThisMonth ?? 0) > 0
    }
    private var leaveUsable: Bool {
        guard let l = quota?.annualLeave else { return false }
        return l.eligible && (l.remaining ?? 0) > 0
    }
    // Every request is ONE date, for every type and for everyone, a BoD included: one date, one
    // piece of evidence, one decision. A range was a second way to file several days that nothing
    // else in attendance understood, so the UNTIL picker is gone and endDate is always startDate.
    /// Izin is today or later; sakit may be filed for a day that has already happened.
    /// Today or later for every type (owner, 29 Sep 2026): a past day is filed by a BoD for the person.
    private var earliest: Date? { Calendar.current.startOfDay(for: Date()) }
    /// Days left in the bucket this type draws from, if it draws from one.
    private var remainingDays: Int? {
        switch type {
        case "DAY_OFF":
            let distance = dayOffPeriodDistance
            if distance == 1 { return quota?.dayOffNextPeriod?.remaining }
            if distance > 1 { return nil }
            return quota.map { max(0, ($0.dayOffQuota ?? 0) - ($0.dayOffUsedThisMonth ?? 0)) }
        case "RED_DATE": return max(0, (quota?.redDateQuota ?? 0) - (quota?.redDateUsedThisMonth ?? 0))
        case "LEAVE": return quota?.annualLeave?.remaining
        default: return nil
        }
    }
    private var dayOffPeriodDistance: Int {
        let c = ProjDate.cal
        func period(_ date: Date) -> Date {
            let shifted = c.component(.day, from: date) >= 28 ? c.date(byAdding: .month, value: 1, to: date) ?? date : date
            return c.date(from: c.dateComponents([.year, .month], from: shifted)) ?? shifted
        }
        return c.dateComponents([.month], from: period(Date()), to: period(start)).month ?? 0
    }
    /// Said before the submit, not after. One date is one day, so this is simply "none left".
    /// Not waived for `canGrant`: the server charges a BoD's own request to their own quota exactly
    /// as it does anybody's (only a grant for somebody else skips it).
    private var quotaProblem: String? {
        guard quota != nil, let left = remainingDays, left < 1 else { return nil }
        return String(format: T("You're asking for %d days and only %d is left."), 1, left)
    }
    private var showAttachment: Bool { type == "SICK" || type == "PERMIT" }
    /// The server demands a photo for a self-filed izin too, not only for sakit. The form said
    /// "(OPTIONAL)" and the submit was then refused — so the label lied and the person had no idea why.
    /// A sick day needs the doctor's note for everyone filing their own, a BoD included (owner, 29 Sep
    /// 2026) — this composer only ever files for the signed-in person.
    private var attachmentRequired: Bool { type == "SICK" || type == "PERMIT" }
    private var isLeave: Bool { type == "LEAVE" }
    /// The picked leave dates as days, oldest first.
    private var leaveDays: [Date] {
        guard let a = leaveStart else { return [] }
        let b = leaveEnd ?? a
        var out: [Date] = []
        var d = a
        while d <= b {
            out.append(d)
            guard let n = ProjDate.cal.date(byAdding: .day, value: 1, to: d) else { break }
            d = n
        }
        return out
    }
    /// Leave is a RANGE (owner, 29 Sep 2026): tap the first day, then the last, and every day between
    /// is taken; a third tap starts a new range, tapping a lone first day again clears it. Capped at the days left.
    private func tapLeave(_ d: Date) {
        if let a = leaveStart, leaveEnd == nil {
            if d == a { leaveStart = nil; leaveCapNote = nil; return }
            let (lo, hi) = a < d ? (a, d) : (d, a)
            let n = (ProjDate.cal.dateComponents([.day], from: lo, to: hi).day ?? 0) + 1
            if let left = remainingDays, n > left {
                leaveCapNote = String(format: T("That's %d days — only %d left."), n, left)
                return
            }
            leaveStart = lo; leaveEnd = hi; leaveCapNote = nil
        } else {
            // Nothing picked yet, or a whole range already is: this tap starts over from here.
            leaveStart = d; leaveEnd = nil; leaveCapNote = nil
        }
    }

    private var leaveSummary: String {
        let days = leaveDays
        guard let first = days.first, let last = days.last else { return PlatformWording.tapOrClick(tap: "Tap the first day, then the last", click: "Click the first day, then the last") }
        let f = DateFormatter(); f.dateFormat = "d MMM"; f.timeZone = ProjDate.cal.timeZone
        f.locale = Locale(identifier: AppLanguage.shared.lang.rawValue == "id" ? "id_ID" : "en_US")
        let range = days.count == 1 ? f.string(from: first) : "\(f.string(from: first)) – \(f.string(from: last))"
        return String(format: T("%@ · %d of %d days"), range, days.count, remainingDays ?? 0)
    }

    /// Consecutive days → one (start, end) block each.
    private var leaveBlocks: [(Date, Date)] {
        var out: [(Date, Date)] = []
        for d in leaveDays {
            if let last = out.last, let next = ProjDate.cal.date(byAdding: .day, value: 1, to: last.1),
               ProjDate.cal.isDate(next, inSameDayAs: d) {
                out[out.count - 1].1 = d
            } else {
                out.append((d, d))
            }
        }
        return out
    }
    private var needsLocation: Bool { !canGrant && type == "PERMIT" }
    private var canSubmit: Bool {
        reason.trimmingCharacters(in: .whitespaces).count >= 3
            // The prefilled start alone is not a reason.
            && !(prefillPermit && reason.trimmingCharacters(in: .whitespaces) == Self.permitReasonPrefix.trimmingCharacters(in: .whitespaces))
            && !(attachmentRequired && attach == nil)
            && !(needsLocation && coords == nil)
            && quotaProblem == nil
            && !(isLeave && leaveStart == nil)
    }
    /// What the picked photo is called once it reaches the reviewer's screen. It used to be
    /// "sick-note.jpg" for every type, so an izin arrived carrying a sick note's name.
    private var attachmentName: String { type == "SICK" ? "sick-note.jpg" : "permit-photo.jpg" }
    private func icon(_ t: String) -> String {
        switch t {
        case "LEAVE": return "sun.max.fill"
        case "SICK": return "cross.case.fill"
        case "PERMIT": return "hand.raised.fill"
        case "DAY_OFF": return "moon.zzz.fill"
        default: return "flag.fill"
        }
    }
    /// One line under the chips saying what this type costs and what it needs.
    private var typeHint: String {
        switch type {
        case "LEAVE":
            guard let l = quota?.annualLeave else { return T("Uses your annual leave.") }
            if !l.eligible { return l.reason ?? T("Annual leave needs 12 months of service.") }
            return String(format: T("Annual leave: %d of %d days left this year."), l.remaining ?? 0, l.quota ?? 12)
        case "SICK":
            return T("One day per request, today or later, with a photo of the doctor's note. A past day is filed by a board member.")
        case "PERMIT":
            return T("One day per request, today or later, with a photo and your location.")
        case "DAY_OFF":
            guard let left = remainingDays else { return T("Your day-off balance for that period is checked when you submit.") }
            if dayOffPeriodDistance == 1 { return String(format: T("Day off: %d of %d left in the period of that date."), left, quota?.dayOffNextPeriod?.quota ?? 0) }
            return String(format: T("Day off: %d of %d left this period."), left, quota?.dayOffQuota ?? 0)
        default:
            guard let left = remainingDays else { return T("Uses this month's public-holiday quota.") }
            return String(format: T("Public holiday: %d of %d left this month."), left, quota?.redDateQuota ?? 0)
        }
    }

    var body: some View {
        NavigationStack {
            ZStack {
                NX.background.ignoresSafeArea()
                ScrollView {
                    VStack(alignment: .leading, spacing: 18) {
                        field(T("TYPE")) {
                            VStack(alignment: .leading, spacing: 10) {
                                ScrollView(.horizontal, showsIndicators: false) {
                                    HStack(spacing: 8) {
                                        ForEach(types, id: \.self) { t in
                                            Button { pick(t) } label: {
                                                HStack(spacing: 6) {
                                                    Image(systemName: icon(t)).font(.system(size: 11, weight: .bold))
                                                    Text(reqLabel(t)).font(NXFont.text(13, .semibold))
                                                }
                                                .padding(.horizontal, 14).padding(.vertical, 9)
                                                .nxChoiceChip(on: type == t)
                                                .overlay(Capsule().strokeBorder(type == t ? .clear : NX.border))
                                            }.buttonStyle(.plain)
                                        }
                                    }
                                    .padding(.vertical, 1)
                                }
                                HStack(alignment: .top, spacing: 7) {
                                    Image(systemName: "info.circle").font(.system(size: 11)).foregroundStyle(NX.mutedFg).padding(.top, 1)
                                    Text(typeHint).font(NXFont.text(12)).foregroundStyle(NX.mutedFg)
                                        .fixedSize(horizontal: false, vertical: true)
                                }
                                .animation(.easeInOut(duration: 0.15), value: typeHint)
                            }
                        }
                        if isLeave {
                            field(T("DATES")) {
                                VStack(alignment: .leading, spacing: 8) {
                                    // Not MultiDatePicker: it draws each picked day as a loose dot and cannot show
                                    // the days between as one range (owner, 29 Sep 2026).
                                    LeaveRangeCalendar(start: leaveStart, end: leaveEnd,
                                                       earliest: ProjDate.cal.startOfDay(for: Date()),
                                                       onTap: tapLeave)
                                        .padding(.horizontal, 8).padding(.vertical, 12)
                                        .background(NX.card, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                                        .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(NX.border))
                                    HStack(spacing: 8) {
                                        Text(leaveSummary)
                                            .font(NXFont.text(12, .bold))
                                            .padding(.horizontal, 9).padding(.vertical, 4)
                                            .background(NX.violet.opacity(0.12), in: Capsule())
                                            .foregroundStyle(NX.violetText)
                                        if let leaveCapNote {
                                            Text(leaveCapNote).font(NXFont.text(11, .semibold)).foregroundStyle(NX.danger)
                                        }
                                    }
                                }
                            }
                        } else {
                        field(T("DATE")) {
                            HStack(spacing: 10) {
                                // `in: dateRange` carries the per-type floor: izin cannot be backdated,
                                // sakit can.
                                DatePicker("", selection: $start, in: dateRange, displayedComponents: .date)
                                    .datePickerStyle(.compact).labelsHidden().tint(NX.violetText)
                                if let left = remainingDays {
                                    Text(String(format: T("%d left"), left))
                                        .font(NXFont.text(12, .bold))
                                        .padding(.horizontal, 9).padding(.vertical, 4)
                                        .background(quotaProblem == nil ? NX.violet.opacity(0.12) : NX.danger.opacity(0.14), in: Capsule())
                                        .foregroundStyle(quotaProblem == nil ? NX.violetText : NX.danger)
                                }
                                Spacer(minLength: 0)
                            }
                        }
                        }
                        if let quotaProblem {
                            HStack(alignment: .top, spacing: 7) {
                                Image(systemName: "exclamationmark.triangle.fill").font(.system(size: 12)).foregroundStyle(NX.danger)
                                Text(quotaProblem).font(NXFont.text(12, .semibold)).foregroundStyle(NX.danger)
                                    .fixedSize(horizontal: false, vertical: true)
                            }
                            .padding(10)
                            .background(NX.danger.opacity(0.08), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                            .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(NX.danger.opacity(0.3)))
                        }
                        if needsLocation {
                            field(T("PERMIT EVIDENCE")) {
                                VStack(alignment: .leading, spacing: 7) {
                                    Text(T("A permit needs a photo and where you filed it from, the same evidence a check-in carries."))
                                        .font(NXFont.text(12)).foregroundStyle(NX.mutedFg)
                                        .fixedSize(horizontal: false, vertical: true)
                                    if let coords {
                                        Label(String(format: T("Location locked (%.5f, %.5f)"), coords.lat, coords.lng),
                                              systemImage: "checkmark.circle.fill")
                                            .font(NXFont.text(12, .semibold)).foregroundStyle(NX.success)
                                    } else {
                                        Button { Task { await askLocation() } } label: {
                                            HStack(spacing: 6) {
                                                if geoBusy { ProgressView().scaleEffect(0.7) } else { Image(systemName: "location.fill").font(.system(size: 11, weight: .bold)) }
                                                Text(geoBusy ? T("Getting your location…") : T("Use my location")).font(NXFont.text(12, .bold))
                                            }
                                            .padding(.horizontal, 12).padding(.vertical, 7)
                                            .background(NX.violet.opacity(0.12), in: Capsule())
                                            .foregroundStyle(NX.violetText)
                                        }
                                        .buttonStyle(.plain).disabled(geoBusy)
                                    }
                                    if let geoError {
                                        Text(geoError).font(NXFont.text(12, .semibold)).foregroundStyle(NX.danger)
                                            .fixedSize(horizontal: false, vertical: true)
                                    }
                                }
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .padding(11)
                                .background(NX.card, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                                .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(NX.border))
                            }
                        }
                        field(T("REASON")) {
                            TextField(T("Reason / context…"), text: $reason, axis: .vertical)
                                .font(NXFont.text(15)).lineLimit(3...6).padding(12)
                                .nxSoftField(radius: 12)
                        }
                        if showAttachment {
                            field((type == "SICK" ? T("SICK NOTE PHOTO") : T("SUPPORTING PHOTO"))
                                  + (attachmentRequired ? T(" (REQUIRED)") : T(" (OPTIONAL)"))) {
                                // The file picker alone meant a sick note had to already exist as
                                // a file. Same three sources as the chat composer.
                                Menu {
                                    Button { showCamera = true } label: { Label(T("Take a photo"), systemImage: "camera") }
                                    Button { showPhotoPicker = true } label: { Label(T("Choose from library"), systemImage: "photo") }
                                    Button { showImporter = true } label: { Label(T("Choose a file"), systemImage: "folder") }
                                    if attach != nil {
                                        Divider()
                                        Button(role: .destructive) { attach = nil } label: { Label(T("Remove"), systemImage: "trash") }
                                    }
                                } label: {
                                    HStack(spacing: 8) {
                                        Image(systemName: "camera").foregroundStyle(NX.mutedFg)
                                        Text(attach?.name ?? T("Pick a photo / file (max 10MB)")).font(NXFont.text(14))
                                            .foregroundStyle(attach == nil ? NX.mutedFg : NX.foreground).lineLimit(1)
                                        Spacer()
                                        if attach != nil { Image(systemName: "xmark.circle.fill").foregroundStyle(NX.mutedFg) }
                                    }
                                    .padding(12).background(NX.card, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                                    .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(attach == nil ? NX.border : NX.violet.opacity(0.5), lineWidth: 1))
                                }.buttonStyle(.plain)
                            }
                        }
                        if let err { Text(err).font(NXFont.text(13, .semibold)).foregroundStyle(NX.danger) }
                        if uploadProgress.isActive { UploadProgressBar(progress: uploadProgress) }
                        Button { Task { await submit() } } label: {
                            HStack(spacing: 8) { if busy { ProgressView().tint(.white) }; Text(T("Submit request")) }
                        }
                        .buttonStyle(NexusPrimaryButton()).disabled(busy || !canSubmit)
                    }
                    .padding(20)
                }
            }
            .keyboardDoneBar()
            .navigationTitle(T("New request"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .topBarLeading) { Button(T("Cancel")) { dismiss() } } }
            .onAppear {
                loc.requestPermissionIfNeeded()
                if prefillPermit && !didPrefill {
                    didPrefill = true
                    start = Date()
                    reason = Self.permitReasonPrefix
                    pick("PERMIT")
                    // `pick` only fetches a position when the permit rules require one; from this
                    // push it is always wanted — it is where the person actually is.
                    if coords == nil && !needsLocation { Task { await askLocation() } }
                }
            }
            .task {
                quota = try? await APIClient.shared.attendanceToday()
                // The list can shrink once the answer arrives; never leave a vanished type selected.
                if !types.contains(type) { pick(types.first ?? "DAY_OFF") }
            }
            .sheet(isPresented: $showImporter) {
                DocumentPicker(types: [.image, .pdf], multiple: false) { urls in
                    let result: Result<[URL], Error> = .success(urls)
                    if case let .success(urls) = result, let url = urls.first {
                        let scoped = url.startAccessingSecurityScopedResource()
                        defer { if scoped { url.stopAccessingSecurityScopedResource() } }
                        // Size first, bytes second. The old order read the file and then measured it,
                        // so picking a two-hour video here locked the main actor for the length of the
                        // read before saying it was too big — and said "over the 10MB limit" even when
                        // the real problem was that the file could not be read at all.
                        let size = APIClient.fileSize(of: url)
                        guard size > 0 else { err = T("Couldn't read that file."); return }
                        guard size <= 10 * 1024 * 1024 else { err = T("File is over the 10MB limit."); return }
                        guard let data = try? Data(contentsOf: url) else {
                            err = T("Couldn't read that file.")
                            return
                        }
                        err = nil
                        attach = (url.lastPathComponent, data)
                    }
                }
                .ignoresSafeArea()
            }
            // A PhotosPicker nested in a Menu draws its row but never opens, so the menu only
            // flips these flags and the sheets live out here.
            .photosPicker(isPresented: $showPhotoPicker, selection: $pickedPhoto,
                          matching: .images, photoLibrary: .shared())
            .onChange(of: pickedPhoto) { _, item in
                guard let item else { return }
                Task {
                    if let data = try? await item.loadTransferable(type: Data.self) {
                        if data.count <= 10 * 1024 * 1024 { attach = (attachmentName, data) }
                        else { err = T("File is over the 10MB limit.") }
                    }
                    pickedPhoto = nil
                }
            }
            .fullScreenCover(isPresented: $showCamera) {
                // Same reason as the chat composer: under .fullScreenCover the picker cannot
                // reliably dismiss itself, so whoever presented it closes it.
                CameraPicker(cameraDevice: .rear) { data in
                    showCamera = false
                    attach = (attachmentName, data)
                }
                .ignoresSafeArea()
            }
        }
    }

    private func field<C: View>(_ label: String, @ViewBuilder _ content: () -> C) -> some View {
        VStack(alignment: .leading, spacing: 7) {
            SectionLabel(label)
            content()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    /// Switching type is not only a label: izin cannot be backdated, so the date is brought into line
    /// the moment the type changes rather than at submit time.
    private func pick(_ t: String) {
        type = t
        err = nil
        geoError = nil
        if !showAttachment { attach = nil }
        // Asked the moment izin is picked, not at submit: a permission prompt on the last tap is
        // where people give up.
        if needsLocation && coords == nil { Task { await askLocation() } }
        if let floor = earliest, start < floor { start = floor }
    }

    private func askLocation() async {
        geoBusy = true; geoError = nil
        defer { geoBusy = false }
        do {
            let fix = try await loc.currentFix()
            coords = (fix.latitude, fix.longitude)
        } catch {
            geoError = (error as? LocalizedError)?.errorDescription ?? T("Couldn't read your location.")
        }
    }

    /// Dates the request may be for. Only izin has a floor.
    private var dateRange: PartialRangeFrom<Date> {
        (earliest ?? Date.distantPast)...
    }

    private func keyForSubmit(_ form: String) -> String {
        if let k = submitKey, k.form == form { return k.key }
        let k = SubmitKey(form: form, key: UUID().uuidString)
        submitKey = k
        return k.key
    }

    private func submit() async {
        busy = true; err = nil; defer { busy = false }
        let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"; f.timeZone = ProjDate.cal.timeZone
        let dates = isLeave ? leaveBlocks.map { "\(f.string(from: $0.0))..\(f.string(from: $0.1))" }.joined(separator: ",") : f.string(from: start)
        let key = keyForSubmit([type, dates, reason.trimmingCharacters(in: .whitespaces), attach?.name ?? "", String(attach?.data.count ?? 0)].joined(separator: "|"))
        if isLeave {
            // One request per run of consecutive dates. A refusal stops the rest and says which dates
            // were already sent, so nothing is filed twice on a retry.
            var sent: [String] = []
            for (i, (from, to)) in leaveBlocks.enumerated() {
                do {
                    try await APIClient.shared.createAttendanceRequest(type: type, startDate: f.string(from: from),
                                                                       endDate: f.string(from: to),
                                                                       reason: reason.trimmingCharacters(in: .whitespaces), attachment: nil,
                                                                       lat: nil, lng: nil, idempotencyKey: "\(key)-\(i)",
                                                                       progress: uploadProgress)
                    sent.append(from == to ? f.string(from: from) : "\(f.string(from: from))–\(f.string(from: to))")
                } catch {
                    let why = (error as? LocalizedError)?.errorDescription ?? T("Couldn't send the request.")
                    err = sent.isEmpty ? why : String(format: T("Sent: %@. Then refused: %@"), sent.joined(separator: ", "), why)
                    if !sent.isEmpty { await onCreated() }
                    return
                }
            }
            await onCreated()
            dismiss()
            return
        }
        do {
            // endDate is sent, and equal to startDate, rather than left out: the route still reads a
            // range, and one date is the range that starts and ends on it.
            let day = f.string(from: start)
            try await APIClient.shared.createAttendanceRequest(type: type, startDate: day,
                                                               endDate: day,
                                                               reason: reason.trimmingCharacters(in: .whitespaces), attachment: attach,
                                                               lat: coords?.lat, lng: coords?.lng,
                                                               idempotencyKey: key,
                                                               progress: uploadProgress)
            // A request for today holds the outside-the-office clock on the server the moment it
            // exists (PENDING counts), so the Live Activity's countdown and the phone's own outside
            // alerts go now, not at the next trail reply.
            if day == f.string(from: Date()) { WorkLocationTracker.shared.excuseFiledForToday() }
            await onCreated()
            dismiss()
        } catch {
            err = (error as? LocalizedError)?.errorDescription ?? T("Couldn't send the request.")
        }
    }
}

/// A month grid for picking annual leave as one range: the first and last day as filled circles, the
/// days between joined by a band. Plain stacks, no lazy grid, no offsets.
private struct LeaveRangeCalendar: View {
    let start: Date?
    let end: Date?
    let earliest: Date
    let onTap: (Date) -> Void
    @State private var month: Date?

    private static let cell: CGFloat = 40
    private static let dot: CGFloat = 36

    private var cal: Calendar { var c = ProjDate.cal; c.firstWeekday = 2; return c }
    private var locale: Locale { Locale(identifier: AppLanguage.shared.lang.rawValue == "id" ? "id_ID" : "en_US") }
    private func firstOfMonth(_ d: Date) -> Date { cal.date(from: cal.dateComponents([.year, .month], from: d)) ?? d }
    private var shown: Date { month ?? firstOfMonth(start ?? earliest) }
    private var canGoBack: Bool { shown > firstOfMonth(earliest) }

    private var title: String {
        let f = DateFormatter(); f.dateFormat = "LLLL yyyy"; f.timeZone = cal.timeZone; f.locale = locale
        return f.string(from: shown)
    }
    /// Short weekday names, Monday first.
    private var weekdays: [String] {
        let f = DateFormatter(); f.locale = locale
        let sym = f.shortStandaloneWeekdaySymbols ?? ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
        return (0..<7).map { sym[($0 + cal.firstWeekday - 1) % 7].uppercased() }
    }
    /// The month as rows of seven, nil where a cell belongs to the month before or after.
    private var weeks: [[Date?]] {
        let first = shown
        let count = cal.range(of: .day, in: .month, for: first)?.count ?? 30
        let lead = (cal.component(.weekday, from: first) - cal.firstWeekday + 7) % 7
        var cells: [Date?] = Array(repeating: nil, count: lead)
        for i in 0..<count { cells.append(cal.date(byAdding: .day, value: i, to: first)) }
        while cells.count % 7 != 0 { cells.append(nil) }
        return stride(from: 0, to: cells.count, by: 7).map { Array(cells[$0..<$0 + 7]) }
    }

    var body: some View {
        VStack(spacing: 6) {
            HStack {
                Text(title).font(NXFont.text(16, .bold)).foregroundStyle(NX.foreground)
                Spacer()
                Button { step(-1) } label: {
                    Image(systemName: "chevron.left").font(.system(size: 15, weight: .semibold)).frame(width: 36, height: 32)
                }
                .disabled(!canGoBack)
                .opacity(canGoBack ? 1 : 0.3)
                Button { step(1) } label: {
                    Image(systemName: "chevron.right").font(.system(size: 15, weight: .semibold)).frame(width: 36, height: 32)
                }
            }
            .buttonStyle(.plain)
            .foregroundStyle(NX.violetText)
            .padding(.horizontal, 6)
            HStack(spacing: 0) {
                ForEach(Array(weekdays.enumerated()), id: \.offset) { _, w in
                    Text(w).font(NXFont.text(11, .semibold)).foregroundStyle(NX.mutedFg).frame(maxWidth: .infinity)
                }
            }
            ForEach(Array(weeks.enumerated()), id: \.offset) { _, week in
                HStack(spacing: 0) {
                    ForEach(0..<7, id: \.self) { i in dayCell(week[i]) }
                }
            }
        }
    }

    private func step(_ by: Int) {
        if let d = cal.date(byAdding: .month, value: by, to: shown) { month = d }
    }

    @ViewBuilder private func dayCell(_ day: Date?) -> some View {
        if let d = day {
            let lo = start
            let hi = end ?? start
            let inRange = lo != nil && hi != nil && d >= lo! && d <= hi!
            let isEdge = d == lo || d == hi
            let isRange = end != nil && end != start
            let disabled = d < earliest
            let isToday = cal.isDate(d, inSameDayAs: Date())
            ZStack {
                if isRange && inRange {
                    // The band: a half on the first and last day so it starts and ends inside their circles.
                    HStack(spacing: 0) {
                        Rectangle().fill(d == lo ? Color.clear : NX.violet.opacity(0.16))
                        Rectangle().fill(d == hi ? Color.clear : NX.violet.opacity(0.16))
                    }
                    .frame(height: Self.dot)
                }
                if isEdge {
                    Circle().fill(NX.violet).frame(width: Self.dot, height: Self.dot)
                } else if isToday {
                    Circle().strokeBorder(NX.violetText.opacity(0.6), lineWidth: 1).frame(width: Self.dot, height: Self.dot)
                }
                Text("\(cal.component(.day, from: d))")
                    .font(NXFont.text(15, isEdge ? .bold : (inRange ? .semibold : .regular)))
                    .monospacedDigit()
                    .foregroundStyle(isEdge ? Color.white
                                     : disabled ? NX.mutedFg.opacity(0.4)
                                     : inRange ? NX.violetText : NX.foreground)
            }
            .frame(maxWidth: .infinity)
            .frame(height: Self.cell)
            .contentShape(Rectangle())
            .onTapGesture { if !disabled { onTap(d) } }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(ProjDate.longLabel(d))
            .accessibilityAddTraits(isEdge ? [.isButton, .isSelected] : .isButton)
        } else {
            Color.clear.frame(maxWidth: .infinity).frame(height: Self.cell)
        }
    }
}
