import SwiftUI
import PhotosUI
import UIKit

// MARK: - models
//
// Shape taken from the web bundle (assets/complaints-*.js), which renders
// .subject / .body / .category / .status / .createdAt / .reporter / .attachments.
// Everything optional so a backend field rename degrades instead of failing to decode.

struct ComplaintsResponse: Decodable, Sendable {
    let complaints: [Complaint]?
}

struct Complaint: Decodable, Identifiable, Sendable {
    let id: String
    let subject: String?
    let body: String?
    let category: String?
    let status: String?
    let createdAt: String?
    let reporter: Reporter?
    let attachments: [Attachment]?

    struct Reporter: Decodable, Sendable { let name: String?; let avatar: String? }
    struct Attachment: Decodable, Sendable { let url: String? }

    var statusKey: String { (status ?? "OPEN").uppercased() }
    var title: String { subject?.isEmpty == false ? subject! : T("(no subject)") }
    var tone: ChipTone {
        switch statusKey {
        case "RESOLVED": return .success
        case "IN_REVIEW": return .warning
        case "CLOSED": return .neutral
        default: return .danger
        }
    }
    var statusLabel: String {
        switch statusKey {
        case "IN_REVIEW": return "In review"
        case "RESOLVED": return "Resolved"
        case "CLOSED": return "Closed"
        default: return "Open"
        }
    }
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
        case "OPEN": return "Open"
        case "IN_REVIEW": return "In review"
        case "RESOLVED": return "Resolved"
        case "CLOSED": return "Closed"
        default: return T("All")
        }
    }
    private var filtered: [Complaint] {
        filter == "ALL" ? items : items.filter { $0.statusKey == filter }
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
        .sheet(item: $selected) { TicketDetailSheet(ticket: $0) }
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
            if let b = t.body, !b.isEmpty {
                Text(b).font(NXFont.text(12)).foregroundStyle(NX.mutedFg).lineLimit(2)
            }
            HStack(spacing: 8) {
                if let c = t.category, !c.isEmpty {
                    NexusChip(text: humanizeEnum(c), tone: .accent, systemImage: "tag.fill")
                }
                if let n = t.reporter?.name, !n.isEmpty {
                    Label(n, systemImage: "person.fill").font(NXFont.text(11)).foregroundStyle(NX.mutedFg)
                }
                Spacer(minLength: 0)
                if let d = ProjDate.parse(t.createdAt) {
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

    private func load() async {
        error = nil
        do { items = try await APIClient.shared.complaints() }
        catch APIError.unauthorized { auth.logout() }
        catch { self.error = (error as? LocalizedError)?.errorDescription ?? T("Couldn't load tickets.") }
        loading = false
    }
}

// MARK: - detail

struct TicketDetailSheet: View {
    let ticket: Complaint
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    HStack(alignment: .top, spacing: 8) {
                        Text(ticket.title).font(NXFont.display(20, .bold)).foregroundStyle(NX.foreground)
                        Spacer(minLength: 4)
                        NexusChip(text: ticket.statusLabel, tone: ticket.tone)
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
                    if let b = ticket.body, !b.isEmpty {
                        VStack(alignment: .leading, spacing: 6) {
                            SectionLabel(T("Report body"))
                            Text(b).font(NXFont.text(14)).foregroundStyle(NX.foreground)
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
                                        CachedImage(url: URL(string: p.hasPrefix("http") ? p : Config.baseURL.absoluteString + p)) {
                                            $0.resizable().scaledToFill()
                                        } placeholder: {
                                            NX.muted
                                        }
                                        .frame(width: 130, height: 130)
                                        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                                    }
                                }
                            }
                        }
                    }
                }
                .padding(16)
            }
            .background(NX.background.ignoresSafeArea())
            .navigationTitle(T("Ticket"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .topBarLeading) { Button(T("Close")) { dismiss() } } }
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
        for item in items {
            guard photos.count < Self.maxPhotos else { break }
            if let data = try? await item.loadTransferable(type: Data.self) {
                photos.append(GideonPanel.shrink(data))
            }
        }
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
                evidence: photos)
            await onCreated()
            dismiss()
        } catch APIError.unauthorized {
            auth.logout()
        } catch {
            err = (error as? LocalizedError)?.errorDescription ?? T("Couldn't file the ticket.")
        }
    }
}
