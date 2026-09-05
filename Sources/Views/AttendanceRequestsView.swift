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
                ForEach(requests) { row($0) }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading).nexusCard()
        // Keyed on canReview: it starts false while /attendance/today is still in flight, and a
        // plain .task fetched scope=me once and never ran again — so a reviewer kept looking at
        // their own history while the crew's pending requests sat on the server unseen.
        .task(id: canReview) { await load() }
        .sheet(isPresented: $showComposer) { RequestComposerSheet(canGrant: canReview) { await load() } }
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
                Text(dateRange(r)).font(NXFont.text(11)).foregroundStyle(NX.mutedFg)
                if canReview, let n = r.user?.name { Text("· \(n)").font(NXFont.text(11)).foregroundStyle(NX.mutedFg).lineLimit(1) }
            }
            if let reason = r.reason, !reason.isEmpty {
                Text(reason).font(NXFont.text(12)).foregroundStyle(NX.foreground.opacity(0.85)).lineLimit(2)
            }
            if pending {
                HStack(spacing: 8) {
                    if working { ProgressView().scaleEffect(0.7) }
                    else if canReview {
                        actionBtn(T("Approve"), .success) { await review(r, "approve") }
                        actionBtn(T("Reject"), .danger) { await review(r, "reject") }
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

    private func dateRange(_ r: AttendanceRequest) -> String {
        let s = day(r.startDate); let e = day(r.endDate)
        return s == e || e.isEmpty ? s : "\(s) – \(e)"
    }
    private func day(_ iso: String?) -> String { attDayLabel(iso) }

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
