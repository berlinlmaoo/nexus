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
    let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"; f.timeZone = ProjDate.cal.timeZone
    return f.date(from: String(iso.prefix(10))).map { ProjDate.dayLabel($0) } ?? ""
}

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
}

// MARK: - Requests card (submit + review)

struct AttendanceRequestsCard: View {
    let canReview: Bool
    /// Offsite check-outs are governed by `canManageAttendance`, requests by
    /// `canReviewAttendanceRequests` — two different permissions, and the offsite endpoint 403s on
    /// the wrong one. Merging the queues must not merge the rights: a team lead who can review
    /// requests but not manage attendance simply never sees the offsite kind, rather than seeing
    /// rows whose buttons can only fail.
    let canReviewOffsite: Bool
    @Environment(AuthStore.self) private var auth
    @State private var requests: [AttendanceRequest] = []
    @State private var offsite: [OffsiteCheckout] = []
    @State private var loading = true
    @State private var showComposer = false
    @State private var busy: String?
    @State private var viewingPhoto: PhotoRef?
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
    private var entries: [SubmissionEntry] {
        let combined = requests.map { SubmissionEntry.request($0) } + offsite.map { SubmissionEntry.offsite($0) }
        return combined.enumerated().sorted { a, b in
            if a.element.isPending != b.element.isPending { return a.element.isPending }
            if !a.element.isPending, a.element.decidedKey != b.element.decidedKey {
                return a.element.decidedKey > b.element.decidedKey
            }
            if a.element.dayKey != b.element.dayKey { return a.element.dayKey > b.element.dayKey }
            return a.offset < b.offset
        }.map { $0.element }
    }

    private var filtered: [SubmissionEntry] {
        let f = activeFilter
        return f == "ALL" ? entries : entries.filter { $0.statusKey == f }
    }

    private var subtitle: String {
        if canReviewOffsite { return T("Review requests and offsite check-outs, and file your own.") }
        return canReview ? T("Review the crew's requests and file your own.") : T("File leave, permit, sick or day-off.")
    }

    /// `.task(id:)` takes one value, and this card now waits on two permissions that land at
    /// different moments — the offsite fetch has to start when `canReviewOffsite` flips, not only
    /// when `canReview` does.
    private var permissionKey: String { "\(canReview)-\(canReviewOffsite)" }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 1) {
                    Text(T("Submissions")).font(NXFont.display(16, .bold)).foregroundStyle(NX.foreground)
                    Text(subtitle)
                        .font(NXFont.text(11)).foregroundStyle(NX.mutedFg)
                }
                Spacer()
                Button { showComposer = true } label: {
                    Label(T("New"), systemImage: "plus").font(NXFont.text(12, .bold)).foregroundStyle(.white)
                        .padding(.horizontal, 12).padding(.vertical, 8).background(NX.violet, in: Capsule())
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
            } else if entries.isEmpty {
                EmptyState(icon: "calendar.badge.plus", title: canReview ? T("Nothing to review yet") : T("No requests yet"),
                           subtitle: canReview
                               ? T("Leave, sick days, permits and offsite check-outs from your people appear here the moment they're filed, with Approve and Reject right on the row.")
                               : T("Leave, sick days, permits and day-offs you file show up here with their status, and your approver is told the moment you send one."),
                           actionTitle: T("File a request"), actionIcon: "plus", action: { showComposer = true }, compact: true)
            } else {
                filterBar
                if filtered.isEmpty {
                    EmptyState(icon: "line.3.horizontal.decrease.circle", title: T("Nothing in this filter"),
                               subtitle: T("Only requests with this status are shown. The rest are under All."),
                               actionTitle: T("Show all"), actionIcon: nil, action: { filter = "ALL" }, compact: true)
                } else {
                    ForEach(filtered) { row($0) }
                }
            }
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
        .sheet(isPresented: $showComposer) { RequestComposerSheet(canGrant: canReview) { await load() } }
        .fullScreenCover(item: $viewingPhoto) { PhotoViewer(photo: $0) }
        // A push tapped while this card is already on screen: claim it now rather than on the next load.
        .onChange(of: router.focus) { _, _ in if !loading { claimFocus() } }
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
        let hit: SubmissionEntry?
        switch f {
        case .attendanceRequest(let id): hit = requests.first { $0.id == id }.map { .request($0) }
        case .offsiteCheckout(let id):   hit = offsite.first { $0.id == id }.map { .offsite($0) }
        default: return
        }
        router.focus = nil
        if let hit { filter = "ALL"; focusEntry = hit } else { focusMissing = true }
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
                            .foregroundStyle(on ? Color.white : NX.mutedFg)
                            .padding(.horizontal, 13).padding(.vertical, 7)
                            .background(on ? NX.violet : NX.card, in: Capsule())
                            .overlay(Capsule().strokeBorder(on ? Color.clear : NX.border))
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }

    @ViewBuilder private func row(_ entry: SubmissionEntry) -> some View {
        switch entry {
        case .request(let r): requestRow(r)
        case .offsite(let o): offsiteRow(o)
        }
    }

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
                Text(reason).font(NXFont.text(12)).foregroundStyle(NX.foreground.opacity(0.85)).lineLimit(2)
            }
            if let url = r.attachmentURL { attachment(r, url) }
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

    /// The evidence behind the request. The web offers it as a link; a link is no use here, because
    /// the file route needs the session cookie and Safari does not have it — and a sick note is a
    /// photograph anyway, so it belongs on the card rather than one navigation away.
    @ViewBuilder private func attachment(_ r: AttendanceRequest, _ url: URL) -> some View {
        let label = r.supportingDocumentName ?? T("View attachment")
        if r.attachmentIsPDF {
            HStack(spacing: 6) {
                Image(systemName: "doc.fill").font(.system(size: 11)).foregroundStyle(NX.mutedFg)
                Text(label).font(NXFont.text(11, .semibold)).foregroundStyle(NX.mutedFg).lineLimit(1)
                Text(T("PDF · open it on the web")).font(NXFont.text(11)).foregroundStyle(NX.mutedFg)
            }
        } else {
            Button { viewingPhoto = PhotoRef(url: url, name: r.supportingDocumentName) } label: {
                HStack(spacing: 8) {
                    CachedImage(url: url) { $0.resizable().scaledToFill() } placeholder: { NX.muted }
                        .frame(width: 54, height: 54)
                        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                    VStack(alignment: .leading, spacing: 2) {
                        Text(label).font(NXFont.text(11, .semibold)).foregroundStyle(NX.violetText).lineLimit(1)
                        Text(T("Tap to enlarge")).font(NXFont.text(10)).foregroundStyle(NX.mutedFg)
                    }
                    Spacer(minLength: 0)
                }
            }
            .buttonStyle(.plain)
        }
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
                Text(reason).font(NXFont.text(12)).foregroundStyle(NX.foreground.opacity(0.85)).lineLimit(3)
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
        do {
            let all = try await APIClient.shared.attendanceRequests(scope: canReview ? "workspace" : "me")
            // Auto-deductions are the nightly cron's penalties, not something anyone filed, so they
            // do not belong in a list of submissions. The server drops them from this endpoint; we
            // repeat the test rather than trust it, because a build outlives the server it was
            // written against and the alternative is a penalty row wearing an approver's face.
            requests = all.filter { !$0.isAutoDeduction }
        }
        catch APIError.unauthorized { auth.logout(); loading = false; return } catch { requests = [] }
        // Only if this reviewer can actually act on them — see `canReviewOffsite`. Fetched second and
        // separately: a 403 or an outage here must leave the requests already on screen alone.
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
    @State private var viewingPhoto: PhotoRef?

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
            .navigationTitle(T("From your notification"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button(T("Close")) { dismiss() } } }
            .fullScreenCover(item: $viewingPhoto) { PhotoViewer(photo: $0) }
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
            if let url = r.attachmentURL {
                if r.attachmentIsPDF {
                    Label(r.supportingDocumentName ?? T("Attachment"), systemImage: "doc.fill")
                        .font(NXFont.text(12, .semibold)).foregroundStyle(NX.mutedFg)
                    Text(T("PDF · open it on the web")).font(NXFont.text(11)).foregroundStyle(NX.mutedFg)
                } else {
                    Button { viewingPhoto = PhotoRef(url: url, name: r.supportingDocumentName) } label: {
                        CachedImage(url: url) { $0.resizable().scaledToFill() } placeholder: { NX.muted }
                            .frame(height: 160).frame(maxWidth: .infinity)
                            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                    }.buttonStyle(.plain)
                }
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
                            .lineLimit(2...5).textFieldStyle(.roundedBorder)
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
                                .background(NX.card, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                                .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(NX.border))
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
    let onCreated: () async -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var type: String = "DAY_OFF"
    @State private var start = Date()
    @State private var end = Date()
    @State private var reason = ""
    @State private var attach: (name: String, data: Data)?
    @State private var showImporter = false
    @State private var showPhotoPicker = false
    @State private var showCamera = false
    @State private var pickedPhoto: PhotosPickerItem?
    @State private var busy = false
    @State private var err: String?
    @State private var uploadProgress = UploadProgress()
    /// Quotas and eligibility, so a type nobody can use is never offered in the first place.
    @State private var quota: AttendanceToday?

    /// Only what this person can actually file. Leave needs a year of service AND days left; public
    /// holiday needs the BoD to have set a quota for the month. Offering either without that is a
    /// button whose only outcome is a refusal, and people read a refusal as the app being broken.
    private var types: [String] {
        var out: [String] = []
        if canGrant || leaveUsable { out.append("LEAVE") }
        out.append(contentsOf: ["SICK", "PERMIT", "DAY_OFF"])
        if canGrant || (quota?.redDateQuota ?? 0) > 0 { out.append("RED_DATE") }
        return out
    }
    private var leaveUsable: Bool {
        guard let l = quota?.annualLeave else { return false }
        return l.eligible && (l.remaining ?? 0) > 0
    }
    /// Sakit and izin are one day each: one date, one piece of evidence, one decision. The server
    /// says the same, so the form cannot promise something the submit will refuse.
    private var singleDay: Bool { !canGrant && (type == "SICK" || type == "PERMIT") }
    /// Izin is today or later; sakit may be filed for a day that has already happened.
    private var earliest: Date? { type == "PERMIT" && !canGrant ? Calendar.current.startOfDay(for: Date()) : nil }
    private var dayCount: Int {
        let cal = Calendar.current
        let a = cal.startOfDay(for: start)
        let b = cal.startOfDay(for: singleDay ? start : end)
        return max(1, (cal.dateComponents([.day], from: a, to: b).day ?? 0) + 1)
    }
    /// Days left in the bucket this type draws from, if it draws from one.
    private var remainingDays: Int? {
        switch type {
        case "DAY_OFF": return max(0, (quota?.dayOffQuota ?? 0) - (quota?.dayOffUsedThisMonth ?? 0))
        case "RED_DATE": return max(0, (quota?.redDateQuota ?? 0) - (quota?.redDateUsedThisMonth ?? 0))
        case "LEAVE": return quota?.annualLeave?.remaining
        default: return nil
        }
    }
    /// Said before the submit, not after: asking for four days out of two left is caught here.
    private var quotaProblem: String? {
        guard !canGrant, quota != nil, let left = remainingDays, dayCount > left else { return nil }
        return String(format: T("You're asking for %d days and only %d is left."), dayCount, left)
    }
    private var showAttachment: Bool { type == "SICK" || type == "PERMIT" }
    private var attachmentRequired: Bool { !canGrant && type == "SICK" }
    private var canSubmit: Bool {
        !reason.trimmingCharacters(in: .whitespaces).isEmpty
            && !(attachmentRequired && attach == nil)
            && quotaProblem == nil
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
            return T("One day per request, and a photo of the doctor's note is required. A day that has already passed is fine.")
        case "PERMIT":
            return T("One day per request, today or later, with a photo and your location.")
        case "DAY_OFF":
            guard let left = remainingDays else { return T("Uses your day-off quota.") }
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
                                                .foregroundStyle(type == t ? .white : NX.mutedFg)
                                                .background(type == t ? NX.violet : NX.card, in: Capsule())
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
                        if singleDay {
                            field(T("DATE")) {
                                DatePicker("", selection: $start, displayedComponents: .date)
                                    .datePickerStyle(.compact).labelsHidden().tint(NX.violetText)
                                    .onChange(of: start) { _, v in end = v }
                            }
                        } else {
                            VStack(alignment: .leading, spacing: 8) {
                                HStack(spacing: 12) {
                                    field(T("START")) {
                                        DatePicker("", selection: $start, in: dateRange, displayedComponents: .date)
                                            .datePickerStyle(.compact).labelsHidden().tint(NX.violetText)
                                    }
                                    field(T("UNTIL")) {
                                        DatePicker("", selection: $end, in: start..., displayedComponents: .date)
                                            .datePickerStyle(.compact).labelsHidden().tint(NX.violetText)
                                    }
                                }
                                if let left = remainingDays {
                                    HStack(spacing: 6) {
                                        Text(String(format: T("%d days"), dayCount))
                                            .font(NXFont.text(12, .bold))
                                            .padding(.horizontal, 9).padding(.vertical, 4)
                                            .background(quotaProblem == nil ? NX.violet.opacity(0.12) : NX.danger.opacity(0.14), in: Capsule())
                                            .foregroundStyle(quotaProblem == nil ? NX.violetText : NX.danger)
                                        Text(String(format: T("%d left"), left)).font(NXFont.text(12)).foregroundStyle(NX.mutedFg)
                                    }
                                    .animation(.easeInOut(duration: 0.15), value: dayCount)
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
                        field(T("REASON")) {
                            TextField(T("Reason / context…"), text: $reason, axis: .vertical)
                                .font(NXFont.text(15)).lineLimit(3...6).padding(12)
                                .background(NX.card, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                                .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(NX.border))
                        }
                        if showAttachment {
                            field(type == "SICK"
                                  ? T("SICK NOTE PHOTO") + (attachmentRequired ? T(" (REQUIRED)") : T(" (OPTIONAL)"))
                                  : T("SUPPORTING PHOTO (OPTIONAL)")) {
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
                                    .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(attach == nil ? NX.border : NX.violet.opacity(0.5), style: StrokeStyle(lineWidth: 1, dash: [5])))
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
            .navigationTitle(T("New request"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .topBarLeading) { Button(T("Cancel")) { dismiss() } } }
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

    /// Switching type is not only a label: izin cannot be backdated and the one-day types collapse
    /// the range, so the dates are brought into line the moment the type changes rather than at
    /// submit time.
    private func pick(_ t: String) {
        type = t
        err = nil
        if !showAttachment { attach = nil }
        if let floor = earliest, start < floor { start = floor }
        if singleDay || end < start { end = start }
    }

    /// Dates a range may start on. Only izin has a floor, and izin is never a range.
    private var dateRange: PartialRangeFrom<Date> {
        (earliest ?? Date.distantPast)...
    }

    private func submit() async {
        busy = true; err = nil; defer { busy = false }
        let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"; f.timeZone = ProjDate.cal.timeZone
        do {
            try await APIClient.shared.createAttendanceRequest(type: type, startDate: f.string(from: start), endDate: f.string(from: end),
                                                               reason: reason.trimmingCharacters(in: .whitespaces), attachment: attach,
                                                               progress: uploadProgress)
            await onCreated()
            dismiss()
        } catch {
            err = (error as? LocalizedError)?.errorDescription ?? T("Couldn't send the request.")
        }
    }
}
