import PhotosUI
import SwiftUI
import UniformTypeIdentifiers

// MARK: - shared request helpers

private func reqLabel(_ t: String?) -> String {
    switch (t ?? "").uppercased() {
    case "LEAVE": return T("Leave"); case "SICK": return T("Sick"); case "PERMIT": return T("Permit")
    case "DAY_OFF": return "Day Off"; case "RED_DATE": return T("Public Holiday"); default: return (t ?? "—").capitalized
    }
}
private func reqStatusLabel(_ s: String?) -> String {
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

// MARK: - Requests card (submit + review)

struct AttendanceRequestsCard: View {
    let canReview: Bool
    @Environment(AuthStore.self) private var auth
    @State private var requests: [AttendanceRequest] = []
    @State private var loading = true
    @State private var showComposer = false
    @State private var busy: String?
    @State private var viewingPhoto: PhotoRef?
    @State private var rejecting: AttendanceRequest?
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

    private var filtered: [AttendanceRequest] {
        let f = activeFilter
        return f == "ALL" ? requests : requests.filter { ($0.status ?? "").uppercased() == f }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 1) {
                    Text(T("Submissions")).font(NXFont.display(16, .bold)).foregroundStyle(NX.foreground)
                    Text(canReview ? T("Review the crew's requests and file your own.") : T("File leave, permit, sick or day-off."))
                        .font(NXFont.text(11)).foregroundStyle(NX.mutedFg)
                }
                Spacer()
                Button { showComposer = true } label: {
                    Label(T("New"), systemImage: "plus").font(NXFont.text(12, .bold)).foregroundStyle(.white)
                        .padding(.horizontal, 12).padding(.vertical, 8).background(NX.violet, in: Capsule())
                }.buttonStyle(.plain)
            }
            if loading {
                ProgressView().tint(NX.violetText).frame(maxWidth: .infinity).padding(.vertical, 8)
            } else if requests.isEmpty {
                Text(T("No requests yet.")).font(NXFont.text(13)).foregroundStyle(NX.mutedFg)
            } else {
                filterBar
                if filtered.isEmpty {
                    Text(T("Nothing in this filter.")).font(NXFont.text(13)).foregroundStyle(NX.mutedFg)
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
        // Keyed on canReview: it starts false while /attendance/today is still in flight, and a
        // plain .task fetched scope=me once and never ran again — so a reviewer kept looking at
        // their own history while the crew's pending requests sat on the server unseen.
        .task(id: canReview) { await load() }
        .sheet(isPresented: $showComposer) { RequestComposerSheet(canGrant: canReview) { await load() } }
        .fullScreenCover(item: $viewingPhoto) { PhotoViewer(photo: $0) }
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

    private func row(_ r: AttendanceRequest) -> some View {
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
            if let note = r.reviewNoteText { decisionNote(note, rejected: r.status?.uppercased() == "REJECTED", by: r.reviewedBy?.name) }
            if pending {
                HStack(spacing: 8) {
                    if working { ProgressView().scaleEffect(0.7) }
                    else if canReview {
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
    private func decisionNote(_ note: String, rejected: Bool, by: String?) -> some View {
        let tint = rejected ? NX.danger : NX.success
        return HStack(alignment: .top, spacing: 6) {
            Image(systemName: rejected ? "exclamationmark.bubble.fill" : "text.bubble.fill")
                .font(.system(size: 10)).foregroundStyle(tint).padding(.top, 2)
            VStack(alignment: .leading, spacing: 2) {
                Text(rejected ? T("Why it was rejected") : T("Note from the approver"))
                    .font(NXFont.text(10, .bold)).foregroundStyle(tint)
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
        .background(tint.opacity(0.1), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
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

    private func review(_ r: AttendanceRequest, _ action: String) async {
        busy = r.id; defer { busy = nil }
        try? await APIClient.shared.reviewAttendanceRequest(id: r.id, action: action)
        await load()
    }
    private func load() async {
        do {
            let all = try await APIClient.shared.attendanceRequests(scope: canReview ? "workspace" : "me")
            // PENDING first. The web renders this queue as two blocks (pending, then the rest); the
            // app rendered whatever order the API returned, so a reviewer's actual work — somebody
            // else's pending request — sat below dozens of their own cancelled rows and looked like
            // "no one ever asks me for approval". `enumerated()` keeps it stable: Swift's sort isn't.
            requests = all.enumerated().sorted { a, b in
                let ap = (a.element.status ?? "").uppercased() == "PENDING"
                let bp = (b.element.status ?? "").uppercased() == "PENDING"
                return ap == bp ? a.offset < b.offset : ap
            }.map { $0.element }
        }
        catch APIError.unauthorized { auth.logout() } catch { requests = [] }
        loading = false
    }
}

// MARK: - Offsite check-out approvals (BoD)

/// The second approval queue, which the app was missing entirely: check-outs taken outside the
/// office geofence sit at `PENDING` until a BoD approves them. Only rendered for reviewers.
struct OffsiteCheckoutsCard: View {
    @Environment(AuthStore.self) private var auth
    @State private var items: [OffsiteCheckout] = []
    @State private var loading = true
    @State private var busy: String?

    private var pendingCount: Int { items.filter(\.isPending).count }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 1) {
                    Text(T("Offsite checkouts")).font(NXFont.display(16, .bold)).foregroundStyle(NX.foreground)
                    Text(T("Check-outs from outside the office area, waiting on you."))
                        .font(NXFont.text(11)).foregroundStyle(NX.mutedFg)
                }
                Spacer()
                if pendingCount > 0 { NexusChip(text: "\(pendingCount)", tone: .warning) }
            }
            if loading {
                ProgressView().tint(NX.violetText).frame(maxWidth: .infinity).padding(.vertical, 8)
            } else if items.isEmpty {
                Text(T("Nothing waiting for approval.")).font(NXFont.text(13)).foregroundStyle(NX.mutedFg)
            } else {
                ForEach(items) { row($0) }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading).nexusCard()
        .task { await load() }
    }

    private func row(_ o: OffsiteCheckout) -> some View {
        // Anti self-approve, same rule as the web: the buttons only appear on somebody else's row.
        let mine = o.user?.id != nil && o.user?.id == auth.session?.userId
        let working = busy == o.id
        return VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(o.user?.name ?? T("Someone")).font(NXFont.text(13, .bold)).foregroundStyle(NX.foreground).lineLimit(1)
                Spacer()
                NexusChip(text: reqStatusLabel(o.approval), tone: reqStatusTone(o.approval))
            }
            HStack(spacing: 6) {
                Image(systemName: "clock").font(.system(size: 10)).foregroundStyle(NX.mutedFg)
                Text("\(attDayLabel(o.attendanceDate)) · \(AgendaRange.timeLabel(o.checkOutAt ?? ""))")
                    .font(NXFont.text(11)).foregroundStyle(NX.mutedFg)
            }
            if let d = o.distanceMeters {
                Text("±\(Int(d.rounded())) m · \(o.officeName ?? T("office"))")
                    .font(NXFont.text(11)).foregroundStyle(NX.mutedFg)
            }
            if let reason = o.reason, !reason.isEmpty {
                Text(reason).font(NXFont.text(12)).foregroundStyle(NX.foreground.opacity(0.85)).lineLimit(3)
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
                        actionBtn(T("Approve"), .success) { await review(o, "approve") }
                        actionBtn(T("Reject"), .danger) { await review(o, "reject") }
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

    private func review(_ o: OffsiteCheckout, _ action: String) async {
        busy = o.id; defer { busy = nil }
        try? await APIClient.shared.reviewOffsiteCheckout(id: o.id, action: action)
        await load()
    }

    private func load() async {
        do {
            let all = try await APIClient.shared.offsiteCheckouts()
            items = all.enumerated().sorted { a, b in
                a.element.isPending == b.element.isPending ? a.offset < b.offset : a.element.isPending
            }.map { $0.element }
        }
        catch APIError.unauthorized { auth.logout() } catch { items = [] }
        loading = false
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

    private var types: [String] { canGrant ? ["LEAVE", "SICK", "PERMIT", "DAY_OFF", "RED_DATE"] : ["PERMIT", "SICK", "DAY_OFF", "RED_DATE"] }
    private var showAttachment: Bool { type == "SICK" || type == "PERMIT" }
    private var attachmentRequired: Bool { !canGrant && type == "SICK" }
    private var canSubmit: Bool { !reason.trimmingCharacters(in: .whitespaces).isEmpty && !(attachmentRequired && attach == nil) }

    var body: some View {
        NavigationStack {
            ZStack {
                NX.background.ignoresSafeArea()
                ScrollView {
                    VStack(alignment: .leading, spacing: 18) {
                        field("TIPE") {
                            ScrollView(.horizontal, showsIndicators: false) {
                                HStack(spacing: 8) {
                                    ForEach(types, id: \.self) { t in
                                        Button { type = t; if !showAttachment { attach = nil } } label: {
                                            Text(reqLabel(t)).font(NXFont.text(13, .semibold))
                                                .padding(.horizontal, 14).padding(.vertical, 9)
                                                .foregroundStyle(type == t ? .white : NX.mutedFg)
                                                .background(type == t ? NX.violet : NX.card, in: Capsule())
                                                .overlay(Capsule().strokeBorder(type == t ? .clear : NX.border))
                                        }.buttonStyle(.plain)
                                    }
                                }
                            }
                        }
                        HStack(spacing: 12) {
                            field(T("START")) { DatePicker("", selection: $start, displayedComponents: .date).datePickerStyle(.compact).labelsHidden().tint(NX.violetText) }
                            field(T("UNTIL")) { DatePicker("", selection: $end, in: start..., displayedComponents: .date).datePickerStyle(.compact).labelsHidden().tint(NX.violetText) }
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
            .fileImporter(isPresented: $showImporter, allowedContentTypes: [.image, .pdf], allowsMultipleSelection: false) { result in
                if case let .success(urls) = result, let url = urls.first {
                    let scoped = url.startAccessingSecurityScopedResource()
                    defer { if scoped { url.stopAccessingSecurityScopedResource() } }
                    if let data = try? Data(contentsOf: url), data.count <= 10 * 1024 * 1024 {
                        attach = (url.lastPathComponent, data)
                    } else { err = T("File is over the 10MB limit.") }
                }
            }
            // A PhotosPicker nested in a Menu draws its row but never opens, so the menu only
            // flips these flags and the sheets live out here.
            .photosPicker(isPresented: $showPhotoPicker, selection: $pickedPhoto,
                          matching: .images, photoLibrary: .shared())
            .onChange(of: pickedPhoto) { _, item in
                guard let item else { return }
                Task {
                    if let data = try? await item.loadTransferable(type: Data.self) {
                        if data.count <= 10 * 1024 * 1024 { attach = ("sick-note.jpg", data) }
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
                    attach = ("sick-note.jpg", data)
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

    private func submit() async {
        busy = true; err = nil; defer { busy = false }
        let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"; f.timeZone = ProjDate.cal.timeZone
        do {
            try await APIClient.shared.createAttendanceRequest(type: type, startDate: f.string(from: start), endDate: f.string(from: end),
                                                               reason: reason.trimmingCharacters(in: .whitespaces), attachment: attach)
            await onCreated()
            dismiss()
        } catch {
            err = (error as? LocalizedError)?.errorDescription ?? T("Couldn't send the request.")
        }
    }
}
