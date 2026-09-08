import SwiftUI
import PhotosUI
import UIKit

// MARK: - models
//
// Shape taken from `serializeComplaint` in src/lib/complaints.ts — the one serializer behind both
// the list route and the detail route, so a field missing there is missing from both.
// Everything optional so a backend field rename degrades instead of failing to decode.

struct ComplaintsResponse: Decodable, Sendable {
    let complaints: [Complaint]?
}

struct Complaint: Decodable, Identifiable, Sendable {
    let id: String
    let subject: String?
    let category: String?
    let status: String?
    let createdAt: String?
    /// What the list is ORDERED by. `createdAt` answers a different question — when it was filed —
    /// and a row stamped with it slides out of order the moment anybody replies.
    let lastMessageAt: String?
    let reporter: Reporter?
    let attachments: [Attachment]?
    /// The server already says whose ticket this is; the app needs it to decide who may file
    /// an attendance correction against it.
    let isMine: Bool?
    /// The two row markers. Both are deliberately INDEPENDENT of `status`: a director who has
    /// already taken a ticket on (so it reads IN_REVIEW) still needs to see a proposal sitting there
    /// undecided. Optional like everything else here, so a server that predates them decodes to nil
    /// and the row simply draws no marker.
    let gideonReplied: Bool?
    let pendingCorrection: Bool?

    struct Reporter: Decodable, Sendable { let name: String?; let avatar: String? }
    struct Attachment: Decodable, Sendable { let url: String? }

    var statusKey: String { (status ?? "OPEN").uppercased() }
    var title: String { subject?.isEmpty == false ? subject! : T("(no subject)") }
    var tone: ChipTone { ticketStatusTone(statusKey) }
    var statusLabel: String { ticketStatusLabel(statusKey) }
    /// Mirror of `isUnclaimedComplaintStatus` in src/lib/complaints.ts: no human has taken this on.
    /// GIDEON answering ANNOTATES a ticket, it does not hand it to anybody.
    var isUnclaimed: Bool { statusKey == "OPEN" || statusKey == "AWAITING_DECISION" }
    var awaitsDecision: Bool { pendingCorrection == true }
    var hasGideonReply: Bool { gideonReplied == true }
}

// Free functions rather than members of `Complaint`, because the detail sheet has to draw the same
// chip from the LIVE detail payload: a BoD's reply moves an OPEN ticket to IN_REVIEW, so the status
// on the list row it was opened from is stale the moment anybody answers.
func ticketStatusLabel(_ key: String) -> String {
    switch key {
    case "AWAITING_DECISION": return T("Awaiting decision")
    case "IN_REVIEW": return T("In review")
    case "RESOLVED": return T("Resolved")
    case "CLOSED": return T("Closed")
    default: return T("Open")
    }
}
func ticketStatusTone(_ key: String) -> ChipTone {
    switch key {
    case "RESOLVED": return .success
    case "IN_REVIEW": return .warning
    // Violet, the colour the web gives it, and its own case rather than OPEN's red on the way to
    // `default`: the ticket HAS been answered, it just is not anybody's yet. Red said "untouched".
    case "AWAITING_DECISION": return .accent
    case "CLOSED": return .neutral
    default: return .danger
    }
}

/// One turn in a ticket's thread.
///
/// `fromGideon` and `fromReviewer` are read in THAT order, and the order is the whole point: GIDEON
/// posts on the reviewer side of the thread — `fromReviewer` is true on its messages too — so a
/// label that checks the reviewer flag first tells the reporter a BoD read their ticket when the
/// only thing that answered was the assistant.
struct ComplaintMessage: Decodable, Identifiable, Sendable {
    let id: String
    let body: String?
    let createdAt: String?
    /// Written by the viewer.
    let mine: Bool?
    let fromReviewer: Bool?
    let fromGideon: Bool?
    let author: Author?

    struct Author: Decodable, Sendable { let id: String?; let name: String?; let avatar: String? }

    var isMine: Bool { mine == true }
    var isGideon: Bool { fromGideon == true }
    var text: String { body ?? "" }
    /// Only ever drawn on somebody else's bubble — one's own message needs no name on it.
    var authorLabel: String {
        if isGideon { return "GIDEON" }
        if fromReviewer == true { return "BoD" }
        let name = author?.name ?? ""
        return name.isEmpty ? T("Someone") : name
    }
    /// Same shape as the correction card's decided line, so two timestamps sitting one above the
    /// other in the same sheet read identically.
    var timeLabel: String {
        guard let createdAt, let d = ProjDate.parse(createdAt) else { return "" }
        return "\(ProjDate.dayLabel(d)) · \(AgendaRange.timeLabel(createdAt))"
    }
}

/// The ticket as the detail route serves it: the row the list already showed, plus the message
/// thread and the permissions the list cannot answer. Optional throughout for the same reason
/// `Complaint` is — a field rename should degrade, not fail to decode.
struct ComplaintDetail: Decodable, Sendable {
    let id: String?
    let status: String?
    /// Oldest first: the route orders them that way, so nothing here re-sorts and risks disagreeing
    /// with the web about what was said when.
    let messages: [ComplaintMessage]?
    let resolvedAt: String?
    let resolvedBy: Complaint.Reporter?
    /// May the viewer move the ticket's STATUS — roughly "is a BoD". NOT the attendance-write
    /// permission, which is `canDecide` on the correction payload; the two answer different
    /// questions and the sheet must not read one for the other.
    let canManage: Bool?
    /// The server's own answer to "may this person reply", which already folds in the closed case.
    let canReply: Bool?
}

/// A proposed rewrite of ONE day's attendance record, hanging off a ticket. Filed by GIDEON or by
/// the reporter — and filing one changes nothing at all: the record is rewritten only when a BoD
/// approves it. That separation is the whole point of the flow, so every label driven from here
/// keeps "proposed" and "recorded" apart.
struct AttendanceCorrection: Decodable, Identifiable, Sendable {
    let id: String
    let status: String?
    /// "YYYY-MM-DD" in Asia/Jakarta — a DAY KEY, not a timestamp. Parsed and formatted in the same
    /// zone (`AgendaRange.dayLabel`) so it can never slide onto the neighbouring day.
    let date: String?
    /// Whose attendance this would rewrite — not necessarily whoever proposed it.
    let user: Person?
    /// ISO timestamps. `nil` means "leave the recorded time alone", NOT "clear it".
    let proposedCheckInAt: String?
    let proposedCheckOutAt: String?
    let reason: String?
    let proposedBy: Person?
    let before: Snapshot?
    let decidedBy: Person?
    let decidedAt: String?
    let decisionNote: String?
    let createdAt: String?
    /// Row-level: is this row still PENDING. NOT the viewer's permission — that is `canDecide` on
    /// the response, and confusing the two is how an approve button appears for someone who has no
    /// business seeing one.
    let canApprove: Bool?

    /// WHAT this proposal asks for. "TIME_CORRECTION" rewrites the day's recorded clock;
    /// "PENALTY_CANCELLATION" leaves every timestamp alone and reverses the day's penalty instead —
    /// for a day whose clock is simply right and whose punishment is still unearned (a permit covers
    /// it, or NEXUS was down and there was nothing to check in to).
    ///
    /// Absent on rows written before the kind existed, and they were all time corrections, so the
    /// fallback below is the honest reading rather than a guess.
    let kind: String?
    /// What the day actually cost, read off the ledger when the proposal was written (negative, or
    /// 0). The cancellation card leads with this because it is the only number that moves.
    let beforePenaltyXp: Int?
    /// A day with no check-in also eats one day-off token, and approving gives that back too. Shown
    /// because a card that names only the XP under-reports what the approver is about to do.
    let beforeAutoDayOffs: Int?
    /// Filled in once decided: what actually came back. Kept server-side because the refund DELETES
    /// the ledger rows, so afterwards nothing else can answer "what did approving this do".
    let refundedXp: Int?
    let restoredDayOffs: Int?
    /// Whether the pardon was made permanent. Without it the nightly cron re-derives the day and
    /// re-cuts the same XP, so this is the difference between a refund that sticks and one that
    /// quietly disappears overnight.
    let waiverGranted: Bool?

    struct Person: Decodable, Sendable { let id: String?; let name: String?; let avatar: String? }
    /// The attendance record as it stood the moment the proposal was written.
    struct Snapshot: Decodable, Sendable {
        let recordId: String?
        let checkInAt: String?
        let checkOutAt: String?
        let status: String?
    }

    var statusKey: String { (status ?? "PENDING").uppercased() }
    var isPending: Bool { statusKey == "PENDING" }
    /// Anything not explicitly the cancellation is the times-diff card it has always been — the same
    /// fallback the web card uses, so the two screens cannot disagree about an old row.
    var isCancellation: Bool { (kind ?? "TIME_CORRECTION").uppercased() == "PENALTY_CANCELLATION" }
    var penaltyXp: Int { beforePenaltyXp ?? 0 }
    var autoDayOffs: Int { beforeAutoDayOffs ?? 0 }
    /// Every field of the snapshot empty means that day had NO attendance record at all. There is
    /// nothing to compare against, so the card says so instead of drawing a before/after against
    /// four blanks — which reads as "the times were wiped".
    var hadNoRecord: Bool {
        guard let before else { return true }
        return [before.recordId, before.checkInAt, before.checkOutAt, before.status]
            .allSatisfy { ($0 ?? "").isEmpty }
    }
    var statusLabel: String {
        switch statusKey {
        case "APPROVED": return T("Approved")
        case "REJECTED": return T("Rejected")
        default: return T("Pending")
        }
    }
    var tone: ChipTone {
        switch statusKey {
        case "APPROVED": return .success
        case "REJECTED": return .danger
        default: return .warning
        }
    }
}

struct AttendanceCorrectionsResponse: Decodable, Sendable {
    let corrections: [AttendanceCorrection]?
    /// The VIEWER's permission — may this person approve — not a property of any row.
    let canDecide: Bool?
}

// MARK: - list

/// Port of the web /complaints screen ("Ticket" in the sidebar) — a direct line to the BoD for
/// ops/HR issues. Filing one lives in `NewTicketSheet` below: the encoding turned out to be
/// multipart with repeated `evidence` parts, so it is no longer guesswork.
struct TicketsView: View {
    @Environment(AuthStore.self) private var auth
    @State private var items: [Complaint] = []
    @State private var loading = true
    @State private var error: String?
    @State private var filter = "ALL"
    @State private var selected: Complaint?
    @State private var showCreate = false

    private let filters = ["ALL", "OPEN", "IN_REVIEW", "RESOLVED", "CLOSED"]
    private func filterLabel(_ f: String) -> String {
        switch f {
        case "OPEN": return T("Open")
        case "IN_REVIEW": return T("In review")
        case "RESOLVED": return T("Resolved")
        case "CLOSED": return T("Closed")
        default: return T("All")
        }
    }
    /// A chip picks a QUEUE, not a status to compare against — which is why "Open" carries
    /// AWAITING_DECISION too. Mirror of COMPLAINT_INBOX_STATUSES in src/lib/complaints.ts and of the
    /// web's Inbox tab: a ticket GIDEON answered is still work nobody has claimed. A sixth chip
    /// would have split that one queue in two and pushed the rest off the scroller; the row's own
    /// status chip already says which of the two a ticket is. Without the widening an answered
    /// ticket would be reachable from ALL and nowhere else.
    private var filtered: [Complaint] {
        switch filter {
        case "ALL": return items
        case "OPEN": return items.filter { $0.isUnclaimed }
        default: return items.filter { $0.statusKey == filter }
        }
    }

    var body: some View {
        ZStack {
            NX.background.ignoresSafeArea()
            content
        }
        .navigationTitle(T("Ticket"))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button { showCreate = true } label: { Image(systemName: "square.and.pencil") }
                    .accessibilityLabel(T("New ticket"))
            }
        }
        .task { await load() }
        .sheet(item: $selected) { t in TicketDetailSheet(ticket: t) { await load() } }
        // Reloads rather than splicing the new ticket in: the server decides the status, the
        // reporter shown (anonymous tickets hide it) and the ordering, so a locally-invented row
        // would differ from the one everybody else sees.
        .sheet(isPresented: $showCreate) { NewTicketSheet { await load() } }
    }

    @ViewBuilder private var content: some View {
        if loading {
            SkeletonList()
        } else if let error {
            ErrorState(message: error) { Task { await load() } }
        } else {
            VStack(spacing: 0) {
                filterBar
                if filtered.isEmpty {
                    EmptyState(icon: "ticket", title: T("No tickets in this filter"),
                               subtitle: T("Switch the filter above to see other statuses."))
                } else {
                    ScrollView {
                        NXCardGrid(spacing: 10) {
                            ForEach(filtered) { t in
                                Button { selected = t } label: { row(t) }.buttonStyle(.plain)
                                    .hoverEffect(.highlight)
                            }
                        }
                        .padding(16)
                    }
                    .refreshable { await load() }
                }
            }
        }
    }

    private var filterBar: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(filters, id: \.self) { f in
                    let on = filter == f
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
            .padding(.horizontal, 16)
        }
        .padding(.vertical, 10)
    }

    private func row(_ t: Complaint) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .top, spacing: 8) {
                Text(t.title).font(NXFont.text(14, .bold)).foregroundStyle(NX.foreground)
                    .lineLimit(2).multilineTextAlignment(.leading)
                Spacer(minLength: 4)
                NexusChip(text: t.statusLabel, tone: t.tone)
            }
            markers(t)
            HStack(spacing: 8) {
                if let c = t.category, !c.isEmpty {
                    NexusChip(text: humanizeEnum(c), tone: .accent, systemImage: "tag.fill")
                }
                if let n = t.reporter?.name, !n.isEmpty {
                    Label(n, systemImage: "person.fill").font(NXFont.text(11)).foregroundStyle(NX.mutedFg)
                }
                Spacer(minLength: 0)
                // The date the list is SORTED by. Stamping the row with `createdAt` instead made a
                // correctly ordered list look shuffled as soon as an old ticket got a new reply.
                if let d = ProjDate.parse(t.lastMessageAt ?? t.createdAt) {
                    Text(ProjDate.dayLabel(d)).font(NXFont.text(11)).foregroundStyle(NX.mutedFg)
                }
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background {
            RoundedRectangle(cornerRadius: 18, style: .continuous).fill(NX.card)
                .nexusShadowSoft()
                .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).strokeBorder(NX.border))
        }
    }

    /// The two things a row could never say before: a decision is sitting unmade, and GIDEON has
    /// been in the thread. In that order, and both when both hold — the decision is the one that
    /// needs a person, the reply is only context for it.
    @ViewBuilder private func markers(_ t: Complaint) -> some View {
        if t.awaitsDecision || t.hasGideonReply {
            HStack(spacing: 6) {
                if t.awaitsDecision {
                    NexusChip(text: T("Decision waiting"), tone: .accent,
                              systemImage: "calendar.badge.clock")
                }
                if t.hasGideonReply { gideonMarker }
            }
        }
    }

    /// GIDEON's own mark rather than an SF Symbol — the same swap `TicketDetailSheet.shoulder`
    /// makes, for the same reason: a stock glyph beside the name reads as one more system notice.
    /// Hand-rolled instead of a `NexusChip` only because that one takes a symbol name, not an image;
    /// the metrics and the 0.16 tint are copied from it so the two capsules sit level.
    private var gideonMarker: some View {
        HStack(spacing: 4) {
            Image("GideonLogo").renderingMode(.template).resizable().scaledToFit()
                .frame(width: 10, height: 10)
            Text(T("GIDEON replied")).font(NXFont.text(11, .bold))
        }
        .padding(.horizontal, 8).padding(.vertical, 4)
        .foregroundStyle(NX.violetText)
        .background(NX.violetText.opacity(0.16), in: Capsule())
    }

    /// A decision nobody has made outranks everything else in the queue; inside each group the
    /// server's own `lastMessageAt desc` order survives, which a partition guarantees and
    /// `sort(by:)` would not — Swift's sort is not stable, so equal rows may come back reshuffled.
    ///
    /// Sorted once per fetch rather than inside `filtered`, which SwiftUI reads on every body pass.
    ///
    /// A ticket GIDEON merely ANSWERED is deliberately NOT floated, matching the web: an
    /// assistant-first queue buries the genuinely new tickets under a pile of replies. Those say so
    /// with a marker on the row instead.
    private static func decisionsFirst(_ list: [Complaint]) -> [Complaint] {
        let waiting = list.filter { $0.awaitsDecision }
        return waiting.isEmpty ? list : waiting + list.filter { !$0.awaitsDecision }
    }

    private func load() async {
        error = nil
        do {
            let fetched = try await APIClient.shared.complaints()
            items = Self.decisionsFirst(fetched)
        }
        catch APIError.unauthorized { auth.logout() }
        catch { self.error = (error as? LocalizedError)?.errorDescription ?? T("Couldn't load tickets.") }
        loading = false
    }
}

// MARK: - detail

struct TicketDetailSheet: View {
    let ticket: Complaint
    /// Reloads the list behind this sheet — a reply or a correction decision can move the ticket
    /// itself, and a reply also changes the message count the row shows.
    let onChanged: () async -> Void
    @Environment(AuthStore.self) private var auth
    @Environment(\.dismiss) private var dismiss

    /// The route's own rules (BODY_MIN / BODY_MAX in src/lib/complaints.ts). Mirrored so the send
    /// button stays down instead of spending a round trip to be told the reply was too short — and
    /// so nothing over the ceiling goes out: past it the server TRUNCATES rather than refusing, and
    /// silently posting half a reply is worse than a button that is visibly not ready.
    private static let replyMin = 10
    private static let replyMax = 4000

    @State private var detail: ComplaintDetail?
    @State private var loadingThread = true
    @State private var threadError: String?
    @State private var draft = ""
    @State private var sending = false
    @State private var sendError: String?
    @State private var movingStatus = false
    /// Kept beside the chip rather than in the reply area: a refusal about the STATUS shown next to
    /// the send button reads as the reply having failed.
    @State private var statusError: String?
    /// Bumped after a reply lands, to make the correction card refetch. A reply from anyone but a
    /// BoD wakes GIDEON on an attendance ticket, and what comes back can be a proposal rather than
    /// only a message.
    @State private var correctionsToken = 0
    @State private var viewingPhoto: PhotoRef?

    /// The live status where there is one. The list row behind this sheet was correct when it was
    /// fetched and not one moment longer.
    private var statusKey: String { (detail?.status ?? ticket.status ?? "OPEN").uppercased() }
    private var messages: [ComplaintMessage] { detail?.messages ?? [] }
    /// The report itself, which is NOT a field on the ticket: `serializeComplaint` has never sent a
    /// `body`, and POST /api/complaints writes what the reporter typed as the first message of the
    /// thread. The card above was reading a key the server does not send and so drew nothing at all.
    private var reportBody: String { messages.first?.text ?? "" }
    /// …and the thread therefore starts at the second message. The report is already up there in its
    /// own card, and drawing it again as the opening bubble reads as the reporter saying it twice.
    private var replies: [ComplaintMessage] { Array(messages.dropFirst()) }
    private var trimmedDraft: String { draft.trimmingCharacters(in: .whitespacesAndNewlines) }
    private var canSend: Bool { !sending && (Self.replyMin...Self.replyMax).contains(trimmedDraft.count) }
    /// The server already decided this and its answer covers cases this app cannot see. The fallback
    /// only runs if the field is missing, and re-derives the same rule: the reporter or a BoD, on a
    /// ticket that is not closed.
    private var canReply: Bool {
        if let flag = detail?.canReply { return flag }
        return statusKey != "CLOSED" && (ticket.isMine == true || detail?.canManage == true)
    }

    /// The status chip, and for a BoD also the way to move it. Put ON the chip rather than in a
    /// separate button row because the chip is already the thing everyone looks at to answer "where
    /// is this ticket" — the control belongs on the answer, not somewhere else on the screen.
    ///
    /// Anyone without `canManage` gets the plain chip, unchanged. The server enforces this too; the
    /// gate here is about not offering a control that would only ever be refused.
    @ViewBuilder private var statusControl: some View {
        if detail?.canManage == true {
            Menu {
                ForEach(Self.settableStatuses, id: \.self) { key in
                    Button {
                        Task { await move(to: key) }
                    } label: {
                        // The current one stays in the list with a tick rather than being hidden:
                        // a menu whose contents shift depending on where you are is harder to learn
                        // than one that always shows the same four and says which you are on.
                        if key == statusKey {
                            Label(ticketStatusLabel(key), systemImage: "checkmark")
                        } else {
                            Text(ticketStatusLabel(key))
                        }
                    }
                    .disabled(key == statusKey)
                }
            } label: {
                HStack(spacing: 4) {
                    NexusChip(text: ticketStatusLabel(statusKey), tone: ticketStatusTone(statusKey))
                    if movingStatus {
                        ProgressView().scaleEffect(0.6)
                    } else {
                        Image(systemName: "chevron.down").font(.system(size: 9, weight: .bold))
                            .foregroundStyle(NX.mutedFg)
                    }
                }
            }
            .disabled(movingStatus)
        } else {
            NexusChip(text: ticketStatusLabel(statusKey), tone: ticketStatusTone(statusKey))
        }
    }

    /// AWAITING_DECISION is missing on purpose and the server refuses it too (422): it is written
    /// when GIDEON answers or a proposal lands, and a director setting it by hand would be saying
    /// "somebody else decide this" about a ticket they are already holding.
    private static let settableStatuses = ["OPEN", "IN_REVIEW", "RESOLVED", "CLOSED"]

    private func move(to status: String) async {
        guard status != statusKey, !movingStatus else { return }
        movingStatus = true
        statusError = nil
        defer { movingStatus = false }
        do {
            // Redrawn from what the server returned, never from the value we asked for: RESOLVED and
            // CLOSED also stamp resolvedAt/resolvedBy, and the reporter is notified, none of which
            // this side can invent.
            detail = try await APIClient.shared.updateComplaintStatus(ticket.id, status: status)
            // The row behind this sheet still shows the old chip until the list refetches.
            await onChanged()
        } catch {
            statusError = (error as? LocalizedError)?.errorDescription ?? T("Couldn't move the ticket.")
        }
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                ScrollView {
                    VStack(alignment: .leading, spacing: 16) {
                        HStack(alignment: .top, spacing: 8) {
                            Text(ticket.title).font(NXFont.display(20, .bold)).foregroundStyle(NX.foreground)
                            Spacer(minLength: 4)
                            statusControl
                        }
                        if let statusError {
                            Text(statusError).font(NXFont.text(11, .semibold)).foregroundStyle(NX.danger)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                        HStack(spacing: 8) {
                            if let c = ticket.category, !c.isEmpty {
                                NexusChip(text: humanizeEnum(c), tone: .accent, systemImage: "tag.fill")
                            }
                            if let d = ProjDate.parse(ticket.createdAt) {
                                Text(ProjDate.longLabel(d)).font(NXFont.text(11)).foregroundStyle(NX.mutedFg)
                            }
                        }
                        if let n = ticket.reporter?.name, !n.isEmpty {
                            HStack(spacing: 8) {
                                AvatarView(url: ticket.reporter?.avatar,
                                           initial: String(n.first ?? "?").uppercased(), size: 30)
                                Text(n).font(NXFont.text(13, .semibold)).foregroundStyle(NX.foreground)
                            }
                        }
                        if !reportBody.isEmpty {
                            VStack(alignment: .leading, spacing: 6) {
                                SectionLabel(T("Report body"))
                                Text(reportBody).font(NXFont.text(14)).foregroundStyle(NX.foreground)
                                    .fixedSize(horizontal: false, vertical: true)
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .nexusCard()
                        }
                        let photos = (ticket.attachments ?? []).compactMap { $0.url }
                        if !photos.isEmpty {
                            VStack(alignment: .leading, spacing: 8) {
                                SectionLabel("Foto bukti · \(photos.count)")
                                ScrollView(.horizontal, showsIndicators: false) {
                                    HStack(spacing: 8) {
                                        ForEach(photos, id: \.self) { p in
                                            let url = URL(string: p.hasPrefix("http") ? p : Config.baseURL.absoluteString + p)
                                            // A 130pt tile is not evidence anybody can read. Same
                                            // viewer the attendance requests use, so a photograph
                                            // opens the same way wherever it is filed.
                                            Button { if let url { viewingPhoto = PhotoRef(url: url, name: nil) } } label: {
                                                CachedImage(url: url) {
                                                    $0.resizable().scaledToFill()
                                                } placeholder: {
                                                    NX.muted
                                                }
                                                .frame(width: 130, height: 130)
                                                .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                                            }
                                            .buttonStyle(.plain)
                                        }
                                    }
                                }
                            }
                        }
                        // The thread first, the proposal card last — the same order the web uses, and
                        // for the same reason: a pending correction is a decision somebody has to
                        // make, so it belongs where the sheet ends rather than above a conversation
                        // that grows until it pushes the decision off the screen.
                        thread
                        AttendanceCorrectionCard(ticket: ticket, reloadToken: correctionsToken,
                                                 onDecided: onChanged)
                    }
                    .padding(16)
                }
                // Manual, on purpose: GIDEON's reply can arrive minutes after the send-time refresh
                // gave up, and nothing pushes it to the phone.
                .refreshable { await refreshEverything() }
                // Only once the thread has landed: the composer's own permission comes off that
                // payload, and a box that appears and then disappears is worse than a short wait.
                if detail != nil {
                    if canReply {
                        composer
                    } else if statusKey == "CLOSED" {
                        Text(T("This ticket is closed. No more replies."))
                            .font(NXFont.text(12, .semibold)).foregroundStyle(NX.mutedFg)
                            .frame(maxWidth: .infinity)
                            .padding(.horizontal, 16).padding(.vertical, 14)
                            .overlay(Rectangle().fill(NX.border).frame(height: 1), alignment: .top)
                    }
                }
            }
            .background(NX.background.ignoresSafeArea())
            .navigationTitle(T("Ticket"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .topBarLeading) { Button(T("Close")) { dismiss() } } }
        }
        .task { await loadThread() }
        .fullScreenCover(item: $viewingPhoto) { PhotoViewer(photo: $0) }
    }

    // MARK: thread

    @ViewBuilder private var thread: some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionLabel(T("Conversation"))
            if loadingThread {
                ProgressView().tint(NX.violetText).frame(maxWidth: .infinity).padding(.vertical, 8)
            } else if let threadError {
                Text(threadError).font(NXFont.text(12, .semibold)).foregroundStyle(NX.danger)
                    .fixedSize(horizontal: false, vertical: true)
            } else if replies.isEmpty {
                Text(T("No replies yet. Answers land right here."))
                    .font(NXFont.text(13)).foregroundStyle(NX.mutedFg)
                    .fixedSize(horizontal: false, vertical: true)
            } else {
                ForEach(replies) { bubble($0) }
            }
            closingNote
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func bubble(_ m: ComplaintMessage) -> some View {
        HStack(alignment: .top, spacing: 8) {
            if m.isMine { Spacer(minLength: 44) } else { shoulder(m) }
            VStack(alignment: .leading, spacing: 4) {
                if !m.isMine {
                    Text(m.authorLabel).font(NXFont.text(11, .bold))
                        .foregroundStyle(m.isGideon ? NX.violetText : NX.mutedFg).lineLimit(1)
                }
                Text(m.text).font(NXFont.text(14))
                    .foregroundStyle(m.isMine ? Color.white : NX.foreground)
                    .textSelection(.enabled)
                    .fixedSize(horizontal: false, vertical: true)
                // Skipped rather than drawn blank: an unparseable timestamp would otherwise leave an
                // empty line inside the bubble that looks like a stripped-out attachment.
                if !m.timeLabel.isEmpty {
                    Text(m.timeLabel).font(NXFont.text(10))
                        .foregroundStyle(m.isMine ? Color.white.opacity(0.7) : NX.mutedFg)
                }
            }
            .padding(.horizontal, 13).padding(.vertical, 9)
            .background(m.isMine ? NX.violet : NX.card,
                        in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous)
                .strokeBorder(m.isMine ? Color.clear : NX.border))
            if !m.isMine { Spacer(minLength: 44) }
        }
    }

    /// The face beside somebody else's bubble. GIDEON gets its own mark rather than an initial: it
    /// has no avatar on the server, and a circled "G" among the photographs would read as one more
    /// colleague.
    @ViewBuilder private func shoulder(_ m: ComplaintMessage) -> some View {
        if m.isGideon {
            Image("GideonLogo")
                .renderingMode(.template).resizable().scaledToFit()
                .frame(width: 15, height: 15).foregroundStyle(NX.foreground)
                .frame(width: 28, height: 28)
                .background(NX.card, in: Circle())
                .overlay(Circle().strokeBorder(NX.border))
        } else {
            AvatarView(url: m.author?.avatar,
                       initial: String((m.author?.name ?? "?").first ?? "?").uppercased(), size: 28)
        }
    }

    /// Closes the thread off the way the web does, so a resolved ticket does not simply stop with
    /// no sign that anything was concluded.
    @ViewBuilder private var closingNote: some View {
        if statusKey == "RESOLVED" || statusKey == "CLOSED", let at = detail?.resolvedAt, !at.isEmpty {
            let verb = statusKey == "RESOLVED" ? T("Marked resolved") : T("Ticket closed")
            let who = detail?.resolvedBy?.name ?? ""
            Text(who.isEmpty ? verb : "\(verb) · \(who)")
                .font(NXFont.text(11, .semibold)).foregroundStyle(NX.mutedFg)
                .frame(maxWidth: .infinity, alignment: .center)
                .padding(.top, 2)
        }
    }

    // MARK: composer

    private var composer: some View {
        VStack(alignment: .leading, spacing: 6) {
            if let sendError {
                Text(sendError).font(NXFont.text(11, .semibold)).foregroundStyle(NX.danger)
                    .fixedSize(horizontal: false, vertical: true)
            }
            HStack(alignment: .bottom, spacing: 10) {
                TextField(T("Write a reply…"), text: $draft, axis: .vertical)
                    .font(NXFont.text(14)).lineLimit(1...5)
                    .padding(.horizontal, 14).padding(.vertical, 10)
                    .background(NX.card, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 20, style: .continuous).strokeBorder(NX.border))
                    .disabled(sending)
                Button { Task { await send() } } label: {
                    Image(systemName: sending ? "ellipsis" : "arrow.up")
                        .font(.system(size: 15, weight: .bold)).foregroundStyle(.white)
                        .frame(width: 38, height: 38)
                        .background(canSend ? NX.violet : NX.muted, in: Circle())
                }
                .buttonStyle(.plain).disabled(!canSend)
            }
            // Nothing is drawn while the reply is within the rules, so the ordinary case stays quiet
            // instead of counting at people while they type.
            if !trimmedDraft.isEmpty && trimmedDraft.count < Self.replyMin {
                Text("\(trimmedDraft.count)/\(Self.replyMin)")
                    .font(NXFont.text(11)).foregroundStyle(NX.mutedFg)
            } else if trimmedDraft.count > Self.replyMax {
                Text("\(trimmedDraft.count)/\(Self.replyMax)")
                    .font(NXFont.text(11)).foregroundStyle(NX.danger)
            }
        }
        .padding(.horizontal, 16).padding(.vertical, 12)
        .background(NX.background)
        .overlay(Rectangle().fill(NX.border).frame(height: 1), alignment: .top)
    }

    // MARK: work

    private func send() async {
        let text = trimmedDraft
        guard (Self.replyMin...Self.replyMax).contains(text.count), !sending else { return }
        sendError = nil
        sending = true
        var posted = false
        do {
            // The POST answers with the whole ticket again, so the thread redraws from the server's
            // own copy instead of a locally-invented row — the reply can also move the status, which
            // a spliced-in message would not show.
            let fresh = try await APIClient.shared.replyToComplaint(ticket.id, body: text)
            apply(fresh)
            draft = ""
            posted = true
        } catch APIError.unauthorized {
            auth.logout()
        } catch {
            sendError = (error as? LocalizedError)?.errorDescription ?? T("Couldn't send the reply.")
        }
        // Dropped BEFORE the second look below: the reply itself is already through, and a send
        // button still spinning for another few seconds reads as "it didn't go".
        sending = false
        guard posted else { return }
        await onChanged()
        // A reply from anyone but a BoD wakes GIDEON on attendance / EXP / day-off tickets, and its
        // answer — plus any correction it proposes off the back of it — lands a moment after the
        // response above was written. Without this the reporter sees their own message sitting alone
        // and concludes nobody came. Best-effort: if GIDEON is slower than this, pull-to-refresh is
        // the way to see it, and pretending otherwise would mean holding the composer hostage.
        try? await Task.sleep(for: .seconds(4))
        await refreshEverything()
    }

    private func refreshEverything() async {
        await loadThread(spinner: false)
        correctionsToken += 1
    }

    private func loadThread(spinner: Bool = true) async {
        if spinner { loadingThread = true }
        do {
            let fresh = try await APIClient.shared.complaintDetail(ticket.id)
            apply(fresh)
        } catch APIError.unauthorized {
            auth.logout()
        } catch {
            // A failed REFRESH must not paint an error over a thread that is already on screen: the
            // messages sitting there are still exactly what was said.
            if detail == nil {
                threadError = (error as? LocalizedError)?.errorDescription ?? T("Couldn't load the conversation.")
            }
        }
        loadingThread = false
    }

    private func apply(_ fresh: ComplaintDetail) {
        detail = fresh
        threadError = nil
    }
}

// MARK: - attendance correction

/// The app's half of the web's attendance-correction flow.
///
/// A correction is a PROPOSAL: it rewrites nothing on its own. The AttendanceRecord moves only when
/// a BoD approves it, which is the whole safety design — so nothing here calls a pending row a
/// change, and the approve button is drawn only from `canDecide` (the viewer's permission), never
/// from the row's own `canApprove`.
struct AttendanceCorrectionCard: View {
    let ticket: Complaint
    /// Bumped by the sheet whenever the thread moves. A reply from anyone but a BoD wakes GIDEON,
    /// which can answer with a PROPOSAL rather than only a message — and that proposal arrives on
    /// this route, not in the reply's own response.
    var reloadToken: Int = 0
    /// Reloads the list behind the sheet: a decision can move the ticket's own status too.
    let onDecided: () async -> Void

    @Environment(AuthStore.self) private var auth
    @State private var corrections: [AttendanceCorrection] = []
    @State private var canDecide = false
    @State private var loading = true
    @State private var busy: String?
    /// Per-row, keyed by correction id: a note typed against one proposal must not follow the
    /// reviewer onto the next.
    @State private var notes: [String: String] = [:]
    @State private var err: String?
    @State private var showComposer = false

    private var isAttendanceTicket: Bool { (ticket.category ?? "").uppercased() == "ATTENDANCE" }
    private var hasPending: Bool { corrections.contains { $0.isPending } }
    /// One open proposal at a time, and never on a ticket that is already closed — a proposal filed
    /// against one has nobody left to decide it. A BoD may file their own; the server allows it and
    /// it is how a proposal gets written for somebody who cannot describe the times themselves.
    private var canPropose: Bool {
        isAttendanceTicket && !hasPending && ticket.statusKey != "CLOSED"
            && (canDecide || ticket.isMine == true)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if loading {
                // Only where a card is actually expected: a spinner that resolves to nothing on an
                // EXP ticket is worse than never having drawn one.
                if isAttendanceTicket {
                    ProgressView().tint(NX.violetText).frame(maxWidth: .infinity).padding(.vertical, 8)
                }
            } else if !corrections.isEmpty || canPropose {
                card
            }
        }
        .task(id: reloadToken) { await load() }
        .sheet(isPresented: $showComposer) {
            CorrectionComposerSheet(ticket: ticket) { await load() }
        }
    }

    private var card: some View {
        VStack(alignment: .leading, spacing: 12) {
            VStack(alignment: .leading, spacing: 2) {
                Text(T("Attendance correction")).font(NXFont.display(16, .bold)).foregroundStyle(NX.foreground)
                Text(T("A proposal only — the attendance record moves when a BoD approves it, not before."))
                    .font(NXFont.text(11)).foregroundStyle(NX.mutedFg)
                    .fixedSize(horizontal: false, vertical: true)
            }
            if corrections.isEmpty {
                Text(T("No correction has been proposed for this ticket yet."))
                    .font(NXFont.text(13)).foregroundStyle(NX.mutedFg)
            } else {
                ForEach(corrections) { row($0) }
            }
            if let err {
                Text(err).font(NXFont.text(12, .semibold)).foregroundStyle(NX.danger)
                    .fixedSize(horizontal: false, vertical: true)
            }
            if canPropose {
                Button { showComposer = true } label: {
                    Label(T("Propose an attendance correction"), systemImage: "calendar.badge.clock")
                        .font(NXFont.text(13, .semibold)).foregroundStyle(NX.violetText)
                        .frame(maxWidth: .infinity).padding(.vertical, 11)
                        .background(NX.card, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                        .overlay(RoundedRectangle(cornerRadius: 12)
                            .strokeBorder(NX.border, style: StrokeStyle(lineWidth: 1, dash: [5])))
                }
                .buttonStyle(.plain)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .nexusCard()
    }

    private func row(_ c: AttendanceCorrection) -> some View {
        let working = busy == c.id
        return VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .top, spacing: 8) {
                Text(c.date.map { AgendaRange.dayLabel($0) } ?? "—")
                    .font(NXFont.text(13, .bold)).foregroundStyle(NX.foreground).lineLimit(2)
                Spacer(minLength: 4)
                NexusChip(text: c.statusLabel, tone: c.tone)
            }
            if let by = c.proposedBy?.name, !by.isEmpty {
                HStack(spacing: 6) {
                    AvatarView(url: c.proposedBy?.avatar, initial: String(by.first ?? "?").uppercased(), size: 20)
                    Text("\(T("Proposed by")) \(by)").font(NXFont.text(11)).foregroundStyle(NX.mutedFg).lineLimit(1)
                }
            }
            // Only when they differ: on a ticket somebody filed about their own day, repeating the
            // same name twice says nothing.
            if let who = c.user?.name, !who.isEmpty, who != c.proposedBy?.name {
                Text("\(T("Attendance of")) \(who)").font(NXFont.text(11)).foregroundStyle(NX.mutedFg).lineLimit(1)
            }
            comparison(c)
            if let reason = c.reason, !reason.isEmpty {
                Text(reason).font(NXFont.text(12)).foregroundStyle(NX.foreground.opacity(0.85))
                    .fixedSize(horizontal: false, vertical: true)
            }
            if c.isPending {
                if canDecide {
                    decideControls(c, working: working)
                } else {
                    Text(T("Waiting on a BoD decision. The attendance record has not changed."))
                        .font(NXFont.text(11)).foregroundStyle(NX.warning)
                        .fixedSize(horizontal: false, vertical: true)
                }
            } else {
                decision(c)
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(NX.muted.opacity(0.4), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
    }

    @ViewBuilder private func comparison(_ c: AttendanceCorrection) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            if c.isCancellation {
                // No times move here, so the card leads with the number that does. The recorded
                // clock is shown underneath precisely BECAUSE it is staying: an approver needs to
                // see that approving this leaves the attendance history exactly as it stands.
                penaltyRow(T("XP cut that day"), value: c.penaltyXp == 0 ? "—" : "\(c.penaltyXp)")
                if c.autoDayOffs > 0 {
                    penaltyRow(T("Day off taken"), value: "-\(c.autoDayOffs)")
                }
                Text(c.autoDayOffs > 0
                     ? T("Proposal: cancel that penalty — the XP and the day off both come back. The recorded times are not touched.")
                     : T("Proposal: cancel that penalty. The recorded times are not touched."))
                    .font(NXFont.text(11)).foregroundStyle(NX.mutedFg)
                    .fixedSize(horizontal: false, vertical: true)
                if c.hadNoRecord {
                    Text(T("That day has no attendance record, and it still will not have one."))
                        .font(NXFont.text(11)).foregroundStyle(NX.mutedFg)
                        .fixedSize(horizontal: false, vertical: true)
                } else {
                    compareRow(T("Check-in"), before: c.before?.checkInAt, proposed: nil)
                    compareRow(T("Check-out"), before: c.before?.checkOutAt, proposed: nil)
                }
            } else if c.hadNoRecord {
                Text(T("No attendance was recorded that day — this would create it."))
                    .font(NXFont.text(11)).foregroundStyle(NX.mutedFg)
                    .fixedSize(horizontal: false, vertical: true)
                proposedRow(T("Check-in"), c.proposedCheckInAt)
                proposedRow(T("Check-out"), c.proposedCheckOutAt)
            } else {
                compareRow(T("Check-in"), before: c.before?.checkInAt, proposed: c.proposedCheckInAt)
                compareRow(T("Check-out"), before: c.before?.checkOutAt, proposed: c.proposedCheckOutAt)
            }
        }
    }

    /// Before → after for one side of the day. A `nil` proposal is "leave this one alone", so the
    /// row draws no arrow and strikes nothing through: an empty after-column would read as an
    /// erasure, which is the opposite of what null means here.
    private func compareRow(_ label: String, before: String?, proposed: String?) -> some View {
        HStack(spacing: 8) {
            Text(label).font(NXFont.text(11)).foregroundStyle(NX.mutedFg).frame(width: 68, alignment: .leading)
            Text(clock(before)).font(NXFont.text(13, .semibold)).foregroundStyle(NX.mutedFg)
                .strikethrough(proposed != nil)
            if let proposed {
                Image(systemName: "arrow.right").font(.system(size: 9, weight: .bold)).foregroundStyle(NX.mutedFg)
                Text(clock(proposed)).font(NXFont.text(13, .bold)).foregroundStyle(NX.violetText)
            } else {
                Text(T("unchanged")).font(NXFont.text(11)).foregroundStyle(NX.mutedFg)
            }
            Spacer(minLength: 0)
        }
    }

    /// One figure the day cost, drawn in the danger tone because every value here is a deduction.
    private func penaltyRow(_ label: String, value: String) -> some View {
        HStack(spacing: 8) {
            Text(label).font(NXFont.text(11)).foregroundStyle(NX.mutedFg)
            Spacer(minLength: 4)
            Text(value).font(NXFont.text(17, .bold)).foregroundStyle(NX.danger)
                .monospacedDigit()
        }
    }

    private func proposedRow(_ label: String, _ proposed: String?) -> some View {
        HStack(spacing: 8) {
            Text(label).font(NXFont.text(11)).foregroundStyle(NX.mutedFg).frame(width: 68, alignment: .leading)
            Text(clock(proposed)).font(NXFont.text(13, .bold))
                .foregroundStyle(proposed == nil ? NX.mutedFg : NX.violetText)
            Spacer(minLength: 0)
        }
    }

    private func decision(_ c: AttendanceCorrection) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            HStack(spacing: 6) {
                Image(systemName: "checkmark.seal").font(.system(size: 10)).foregroundStyle(NX.mutedFg)
                Text(decidedLine(c)).font(NXFont.text(11)).foregroundStyle(NX.mutedFg).lineLimit(2)
            }
            // What approving ACTUALLY handed back. The refund deletes the ledger rows, so if this
            // is not shown here there is nowhere left to read it.
            if c.isCancellation, c.statusKey == "APPROVED" {
                let back = [(c.refundedXp ?? 0) > 0 ? "+\(c.refundedXp ?? 0) XP" : nil,
                            (c.restoredDayOffs ?? 0) > 0 ? "\((c.restoredDayOffs ?? 0)) \(T("day off"))" : nil]
                    .compactMap { $0 }
                if !back.isEmpty {
                    Text("\(T("Given back")): \(back.joined(separator: " + "))")
                        .font(NXFont.text(11, .semibold)).foregroundStyle(NX.success)
                }
                if c.waiverGranted == true {
                    Text(T("That day is now marked penalty-free, so it cannot be cut again."))
                        .font(NXFont.text(11)).foregroundStyle(NX.mutedFg)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            if let note = c.decisionNote, !note.isEmpty {
                Text(note).font(NXFont.text(12)).foregroundStyle(NX.foreground.opacity(0.85))
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    private func decidedLine(_ c: AttendanceCorrection) -> String {
        var parts = ["\(T("Decided by")) \(c.decidedBy?.name ?? "BoD")"]
        if let at = c.decidedAt, let d = ProjDate.parse(at) {
            parts.append("\(ProjDate.dayLabel(d)) · \(AgendaRange.timeLabel(at))")
        }
        return parts.joined(separator: " · ")
    }

    private func decideControls(_ c: AttendanceCorrection, working: Bool) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            TextField(T("Note for the decision (optional)"),
                      text: Binding(get: { notes[c.id] ?? "" }, set: { notes[c.id] = $0 }),
                      axis: .vertical)
                .font(NXFont.text(13)).lineLimit(1...3).padding(10)
                .background(NX.card, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(NX.border))
            HStack(spacing: 8) {
                if working {
                    ProgressView().scaleEffect(0.7)
                } else {
                    actionBtn(T("Approve"), .success) { await decide(c, approve: true) }
                    actionBtn(T("Reject"), .danger) { await decide(c, approve: false) }
                }
            }
            // The old single sentence was actively wrong for a cancellation: it promised a rewrite
            // of the attendance record, which is the one thing this remedy never does.
            Text(c.isCancellation
                 ? T("Approving gives back what that day cost and writes NOTHING to the attendance record. If no leave covers the day, it is also marked penalty-free so the nightly job cannot cut it again.")
                 : T("Approving rewrites that day's attendance record straight away."))
                .font(NXFont.text(11)).foregroundStyle(NX.mutedFg)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.top, 2)
    }

    private func actionBtn(_ title: String, _ tone: ChipTone, _ action: @escaping () async -> Void) -> some View {
        Button { Task { await action() } } label: {
            Text(title).font(NXFont.text(12, .bold)).foregroundStyle(tone.fg)
                .padding(.horizontal, 12).padding(.vertical, 6).background(tone.bg, in: Capsule())
        }.buttonStyle(.plain)
    }

    private func clock(_ iso: String?) -> String {
        guard let iso, !iso.isEmpty else { return "—" }
        let t = AgendaRange.timeLabel(iso)
        return t.isEmpty ? "—" : t
    }

    private func decide(_ c: AttendanceCorrection, approve: Bool) async {
        busy = c.id; defer { busy = nil }
        err = nil
        do {
            try await APIClient.shared.decideAttendanceCorrection(
                complaintId: ticket.id, correctionId: c.id, approve: approve,
                note: (notes[c.id] ?? "").trimmingCharacters(in: .whitespacesAndNewlines))
            notes[c.id] = ""
            await load()
            await onDecided()
            // An approval rewrites a real AttendanceRecord, so the widgets and the Live Activity can
            // be sitting on a day that just moved under them. Best-effort on purpose: failing to
            // refresh those must not turn a decision that went through into an error on screen.
            if approve, let today = try? await APIClient.shared.attendanceToday() {
                AttendancePresence.refresh(today: today, userName: auth.session?.userName)
            }
        } catch APIError.unauthorized {
            auth.logout()
        } catch {
            err = (error as? LocalizedError)?.errorDescription ?? T("Couldn't send the attendance correction.")
        }
    }

    private func load() async {
        do {
            let res = try await APIClient.shared.attendanceCorrections(complaintId: ticket.id)
            corrections = res.corrections ?? []
            canDecide = res.canDecide ?? false
            err = nil
        } catch APIError.unauthorized {
            auth.logout()
        } catch {
            // Deliberately silent. Most tickets never carry a correction, and this card is not why
            // anybody opened the ticket — a red line under a report they can still read would only
            // suggest the report itself failed to load.
            corrections = []
            canDecide = false
        }
        loading = false
    }
}

/// Filing a correction proposal.
///
/// The copy carries the load here: this form ASKS for a day to be rewritten, it does not rewrite
/// one. Somebody who is owed hours has to be able to tell those apart from the submit button alone.
struct CorrectionComposerSheet: View {
    let ticket: Complaint
    let onFiled: () async -> Void
    @Environment(AuthStore.self) private var auth
    @Environment(\.dismiss) private var dismiss

    /// The route's own rule. Mirrored so the button stays down instead of spending a round trip to
    /// be told the reason was too short.
    private static let reasonMin = 10

    @State private var date = Date()
    @State private var setCheckIn = true
    @State private var checkIn = ShiftClock.date("09:00")
    @State private var setCheckOut = false
    @State private var checkOut = ShiftClock.date("18:00")
    @State private var reason = ""
    @State private var busy = false
    @State private var err: String?

    private var trimmedReason: String { reason.trimmingCharacters(in: .whitespacesAndNewlines) }
    /// At least one side has to move — the server refuses a proposal that changes neither.
    private var canSubmit: Bool { (setCheckIn || setCheckOut) && trimmedReason.count >= Self.reasonMin }

    var body: some View {
        NavigationStack {
            ZStack {
                NX.background.ignoresSafeArea()
                ScrollView {
                    VStack(alignment: .leading, spacing: 18) {
                        Text(T("This asks the BoD to rewrite one day's attendance. Nothing changes until they approve it."))
                            .font(NXFont.text(12)).foregroundStyle(NX.mutedFg)
                            .fixedSize(horizontal: false, vertical: true)
                        field(T("DATE")) {
                            DatePicker("", selection: $date, in: ...Date(), displayedComponents: .date)
                                .datePickerStyle(.compact).labelsHidden().tint(NX.violetText)
                        }
                        field(T("CHECK-IN")) { timeToggle(on: $setCheckIn, time: $checkIn) }
                        field(T("CHECK-OUT")) { timeToggle(on: $setCheckOut, time: $checkOut) }
                        if !setCheckIn && !setCheckOut {
                            Text(T("Set at least one of check-in or check-out."))
                                .font(NXFont.text(11)).foregroundStyle(NX.danger)
                        }
                        field(T("REASON")) {
                            VStack(alignment: .leading, spacing: 5) {
                                TextField(T("Why the record is wrong…"), text: $reason, axis: .vertical)
                                    .font(NXFont.text(15)).lineLimit(3...6).padding(12)
                                    .background(NX.card, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                                    .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(NX.border))
                                // Counts only while it is still short, so the ordinary case stays
                                // quiet instead of counting at people while they type.
                                if trimmedReason.count < Self.reasonMin {
                                    Text("\(trimmedReason.count)/\(Self.reasonMin)")
                                        .font(NXFont.text(11)).foregroundStyle(NX.mutedFg)
                                }
                            }
                        }
                        if let err {
                            Text(err).font(NXFont.text(13, .semibold)).foregroundStyle(NX.danger)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                        Button { Task { await submit() } } label: {
                            HStack(spacing: 8) { if busy { ProgressView().tint(.white) }; Text(T("Send the proposal")) }
                        }
                        .buttonStyle(NexusPrimaryButton()).disabled(busy || !canSubmit)
                    }
                    .padding(20)
                }
            }
            .navigationTitle(T("Attendance correction"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .topBarLeading) { Button(T("Cancel")) { dismiss() }.disabled(busy) } }
        }
    }

    /// Off is not "blank" — it is "leave the recorded time alone", and the payload drops the field
    /// entirely so the server reads it that way rather than as a clear.
    private func timeToggle(on: Binding<Bool>, time: Binding<Date>) -> some View {
        HStack(spacing: 10) {
            Toggle("", isOn: on).labelsHidden().tint(NX.violetText)
            if on.wrappedValue {
                DatePicker("", selection: time, displayedComponents: .hourAndMinute)
                    .datePickerStyle(.compact).labelsHidden().tint(NX.violetText)
            } else {
                Text(T("Leave the recorded time as it is")).font(NXFont.text(12)).foregroundStyle(NX.mutedFg)
            }
            Spacer(minLength: 0)
        }
    }

    private func field<C: View>(_ label: String, @ViewBuilder _ content: () -> C) -> some View {
        VStack(alignment: .leading, spacing: 7) {
            SectionLabel(label)
            content()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func submit() async {
        guard canSubmit, !busy else { return }
        busy = true; defer { busy = false }
        err = nil
        // The day key is Asia/Jakarta, like every other date this API takes; the times go out as the
        // office-local "HH:mm" the picker just showed, through the same helper the shift editor uses.
        let day = DateFormatter()
        day.dateFormat = "yyyy-MM-dd"
        day.locale = Locale(identifier: "en_US_POSIX")
        day.timeZone = ProjDate.cal.timeZone
        do {
            try await APIClient.shared.proposeAttendanceCorrection(
                complaintId: ticket.id,
                date: day.string(from: date),
                checkInAt: setCheckIn ? ShiftClock.hhmm(checkIn) : nil,
                checkOutAt: setCheckOut ? ShiftClock.hhmm(checkOut) : nil,
                reason: trimmedReason)
            await onFiled()
            dismiss()
        } catch APIError.unauthorized {
            auth.logout()
        } catch {
            err = (error as? LocalizedError)?.errorDescription ?? T("Couldn't send the attendance correction.")
        }
    }
}

// MARK: - composer

/// Filing a ticket.
///
/// The server refuses one without at least a single evidence photo — 422 "Foto bukti wajib
/// dilampirin." before it looks at anything else — so the submit button stays down until a photo is
/// attached. A round trip that can only ever fail is worse than a button that is visibly not ready.
struct NewTicketSheet: View {
    let onCreated: () async -> Void
    @Environment(AuthStore.self) private var auth
    @Environment(\.dismiss) private var dismiss

    // The route's own limits (src/app/api/complaints/route.ts + src/lib/complaints.ts). Mirrored
    // here so the form refuses what the server would refuse, before several megabytes of photos go
    // out over mobile data and come back as a 422.
    private static let subjectMin = 4
    private static let subjectMax = 140
    private static let bodyMin = 10
    private static let bodyMax = 4000
    private static let maxPhotos = 5

    /// Only the four categories the route still ACCEPTS. PAYROLL / OPERATIONAL / HR / LEADERSHIP
    /// survive in the Prisma enum so the older tickets in the list keep rendering, but they were
    /// dropped from COMPLAINT_CATEGORIES, and filing under one comes back as "Kategori gak valid."
    private static let categories = ["ATTENDANCE", "EXP", "DAY_OFF", "OTHER"]

    @State private var category = "ATTENDANCE"
    @State private var subject = ""
    @State private var detail = ""
    /// JPEG bytes, already downscaled, in the order they were picked — `position` on the server
    /// keeps that order, so the gallery in the detail sheet reads the way it was assembled.
    @State private var photos: [Data] = []
    @State private var pickedPhotos: [PhotosPickerItem] = []
    @State private var showLibrary = false
    @State private var showCamera = false
    @State private var busy = false
    @State private var err: String?
    @State private var uploadProgress = UploadProgress()

    private var trimmedSubject: String { subject.trimmingCharacters(in: .whitespacesAndNewlines) }
    private var trimmedBody: String { detail.trimmingCharacters(in: .whitespacesAndNewlines) }
    /// Both ends of every length rule, because the route rejects an over-long subject or body with
    /// a 422 instead of trimming it — and trimming it here on the way out would silently file
    /// something other than what was typed, which is the last thing a complaint should do.
    private var canSubmit: Bool {
        (Self.subjectMin...Self.subjectMax).contains(trimmedSubject.count)
            && (Self.bodyMin...Self.bodyMax).contains(trimmedBody.count)
            && !photos.isEmpty
    }

    var body: some View {
        NavigationStack {
            ZStack {
                NX.background.ignoresSafeArea()
                ScrollView {
                    VStack(alignment: .leading, spacing: 18) {
                        field(T("CATEGORY")) { categoryRow }
                        field(T("SUBJECT")) {
                            VStack(alignment: .leading, spacing: 5) {
                                TextField(T("Short title for the issue"), text: $subject)
                                    .font(NXFont.text(15)).padding(12)
                                    .background(NX.card, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                                    .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(NX.border))
                                overLimit(trimmedSubject.count, Self.subjectMax)
                            }
                        }
                        field(T("WHAT HAPPENED")) {
                            VStack(alignment: .leading, spacing: 5) {
                                TextField(T("Tell the BoD what happened…"), text: $detail, axis: .vertical)
                                    .font(NXFont.text(15)).lineLimit(5...10).padding(12)
                                    .background(NX.card, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                                    .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(NX.border))
                                overLimit(trimmedBody.count, Self.bodyMax)
                            }
                        }
                        field(T("EVIDENCE PHOTOS (REQUIRED)")) { evidence }
                        if let err { Text(err).font(NXFont.text(13, .semibold)).foregroundStyle(NX.danger) }
                        if uploadProgress.isActive { UploadProgressBar(progress: uploadProgress) }
                        Button { Task { await submit() } } label: {
                            HStack(spacing: 8) { if busy { ProgressView().tint(.white) }; Text(T("File ticket")) }
                        }
                        .buttonStyle(NexusPrimaryButton()).disabled(busy || !canSubmit)
                    }
                    .padding(20)
                }
            }
            .navigationTitle(T("New ticket"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .topBarLeading) { Button(T("Cancel")) { dismiss() }.disabled(busy) } }
            // Presented from here, never from inside a Menu: a PhotosPicker nested in a Menu draws
            // its row and never opens, because the menu tears down its content as it dismisses and
            // the picker's presentation goes with it.
            .photosPicker(isPresented: $showLibrary, selection: $pickedPhotos,
                          maxSelectionCount: max(1, Self.maxPhotos - photos.count),
                          matching: .images, photoLibrary: .shared())
            .onChange(of: pickedPhotos) { _, items in
                guard !items.isEmpty else { return }
                Task { await absorb(items) }
            }
            .fullScreenCover(isPresented: $showCamera) {
                // CameraPicker dismisses itself through an @Environment(\.dismiss) read inside the
                // representable, which its coordinator calls on a captured copy of the struct. That
                // holds under .sheet and does NOT under .fullScreenCover — the camera stays up and
                // the photo looks like it never arrived. So the presenter closes it, exactly as the
                // chat composer and the leave-request sheet do.
                CameraPicker(cameraDevice: .rear) { data in
                    showCamera = false
                    // Not run through shrink(): CameraPicker already downscales to 1280px and
                    // re-encodes at 0.7, so a second pass would only re-compress a small frame.
                    if photos.count < Self.maxPhotos { photos.append(data) }
                }
                .ignoresSafeArea()
            }
        }
    }

    private var categoryRow: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(Self.categories, id: \.self) { key in
                    Button { category = key } label: {
                        Text(categoryLabel(key)).font(NXFont.text(13, .semibold))
                            .padding(.horizontal, 14).padding(.vertical, 9)
                            .foregroundStyle(category == key ? .white : NX.mutedFg)
                            .background(category == key ? NX.violet : NX.card, in: Capsule())
                            .overlay(Capsule().strokeBorder(category == key ? .clear : NX.border))
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }

    /// Spelled out rather than run through `humanizeEnum`, which would render EXP as "Exp" and
    /// DAY_OFF as "Day Off" — neither is what either of those is called out loud.
    private func categoryLabel(_ key: String) -> String {
        switch key {
        case "ATTENDANCE": return T("Attendance")
        case "EXP": return T("EXP / Gamification")
        case "DAY_OFF": return T("Leave / Day-off")
        default: return T("Other")
        }
    }

    @ViewBuilder private var evidence: some View {
        VStack(alignment: .leading, spacing: 10) {
            if !photos.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        // Indexed by position, not by the bytes: two shots of the same whiteboard
                        // can be byte-identical, and \.self on Data would collapse them into one.
                        ForEach(Array(photos.enumerated()), id: \.offset) { index, data in
                            if let image = UIImage(data: data) {
                                Image(uiImage: image)
                                    .resizable().scaledToFill()
                                    .frame(width: 84, height: 84)
                                    .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                                    .overlay(alignment: .topTrailing) {
                                        Button { photos.remove(at: index) } label: {
                                            Image(systemName: "xmark.circle.fill")
                                                .font(.system(size: 16))
                                                .foregroundStyle(.white, .black.opacity(0.45))
                                        }
                                        .buttonStyle(.plain)
                                        .padding(4)
                                    }
                            }
                        }
                    }
                }
            }
            HStack(spacing: 8) {
                sourceButton(T("Take a photo"), icon: "camera") { showCamera = true }
                sourceButton(T("Choose from library"), icon: "photo.on.rectangle") { showLibrary = true }
            }
            .disabled(photos.count >= Self.maxPhotos)
            .opacity(photos.count >= Self.maxPhotos ? 0.5 : 1)
            Text(photos.isEmpty ? T("At least one photo is required.") : "\(photos.count)/\(Self.maxPhotos)")
                .font(NXFont.text(11))
                .foregroundStyle(photos.isEmpty ? NX.danger : NX.mutedFg)
        }
    }

    private func sourceButton(_ title: String, icon: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 6) {
                Image(systemName: icon).font(.system(size: 13))
                Text(title).font(NXFont.text(13, .semibold)).lineLimit(1)
            }
            .foregroundStyle(NX.violetText)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 11)
            .background(NX.card, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 12)
                .strokeBorder(NX.border, style: StrokeStyle(lineWidth: 1, dash: [5])))
        }
        .buttonStyle(.plain)
    }

    /// Shows up only once the text is past what the route accepts. Nothing is drawn below the
    /// limit, so the ordinary case stays quiet instead of counting at people while they type.
    @ViewBuilder private func overLimit(_ count: Int, _ limit: Int) -> some View {
        if count > limit {
            Text("\(count)/\(limit)").font(NXFont.text(11)).foregroundStyle(NX.danger)
        }
    }

    private func field<C: View>(_ label: String, @ViewBuilder _ content: () -> C) -> some View {
        VStack(alignment: .leading, spacing: 7) {
            SectionLabel(label)
            content()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    /// A library original is a full-size camera frame — several megabytes each, and up to five of
    /// them on a phone connection — so every pick is downscaled before it is even held in memory.
    private func absorb(_ items: [PhotosPickerItem]) async {
        var lost = 0
        for item in items {
            guard photos.count < Self.maxPhotos else { break }
            if let data = try? await item.loadTransferable(type: Data.self) {
                photos.append(GideonPanel.shrink(data))
            } else {
                // A pick the library could not hand over — a photo still in iCloud, or one it
                // cannot decode. Dropped silently, five of these read as "the picker is broken".
                lost += 1
            }
        }
        if lost > 0 { err = T("Couldn't read that photo.") }
        pickedPhotos = []
    }

    private func submit() async {
        guard canSubmit, !busy else { return }
        busy = true; defer { busy = false }
        err = nil
        do {
            try await APIClient.shared.createComplaint(
                category: category,
                subject: trimmedSubject,
                body: trimmedBody,
                evidence: photos,
                progress: uploadProgress)
            await onCreated()
            dismiss()
        } catch APIError.unauthorized {
            auth.logout()
        } catch {
            err = (error as? LocalizedError)?.errorDescription ?? T("Couldn't file the ticket.")
        }
    }
}
