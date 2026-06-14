import SwiftUI
import UniformTypeIdentifiers

// MARK: - shared request helpers

private func reqLabel(_ t: String?) -> String {
    switch (t ?? "").uppercased() {
    case "LEAVE": return "Cuti"; case "SICK": return "Sakit"; case "PERMIT": return "Izin"
    case "DAY_OFF": return "Day Off"; case "RED_DATE": return "Tanggal Merah"; default: return (t ?? "—").capitalized
    }
}
private func reqStatusLabel(_ s: String?) -> String {
    switch (s ?? "").uppercased() {
    case "APPROVED": return "Disetujui"; case "REJECTED": return "Ditolak"; case "CANCELED", "CANCELLED": return "Dibatalkan"
    default: return "Pending"
    }
}
private func reqStatusTone(_ s: String?) -> ChipTone {
    switch (s ?? "").uppercased() {
    case "APPROVED": return .success; case "REJECTED": return .danger; case "CANCELED", "CANCELLED": return .neutral; default: return .warning
    }
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
                    Text("Pengajuan").font(NXFont.display(16, .bold)).foregroundStyle(NX.foreground)
                    Text(canReview ? "Review request crew + ajuin punyamu." : "Ajuin cuti / izin / sakit / day-off.")
                        .font(NXFont.text(11)).foregroundStyle(NX.mutedFg)
                }
                Spacer()
                Button { showComposer = true } label: {
                    Label("New", systemImage: "plus").font(NXFont.text(12, .bold)).foregroundStyle(.white)
                        .padding(.horizontal, 12).padding(.vertical, 8).background(NX.violet, in: Capsule())
                }.buttonStyle(.plain)
            }
            if loading {
                ProgressView().tint(NX.violet).frame(maxWidth: .infinity).padding(.vertical, 8)
            } else if requests.isEmpty {
                Text("Belum ada pengajuan.").font(NXFont.text(13)).foregroundStyle(NX.mutedFg)
            } else {
                ForEach(requests) { row($0) }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading).nexusCard()
        .task { await load() }
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
                        actionBtn("Approve", .success) { await review(r, "approve") }
                        actionBtn("Reject", .danger) { await review(r, "reject") }
                    } else {
                        actionBtn("Batalin", .neutral) { await review(r, "cancel") }
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
    private func day(_ iso: String?) -> String {
        guard let iso, !iso.isEmpty else { return "" }
        if let d = ProjDate.parse(iso) { return ProjDate.dayLabel(d) }
        let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"; f.timeZone = ProjDate.cal.timeZone
        return f.date(from: String(iso.prefix(10))).map { ProjDate.dayLabel($0) } ?? ""
    }

    private func review(_ r: AttendanceRequest, _ action: String) async {
        busy = r.id; defer { busy = nil }
        try? await APIClient.shared.reviewAttendanceRequest(id: r.id, action: action)
        await load()
    }
    private func load() async {
        do { requests = try await APIClient.shared.attendanceRequests(scope: canReview ? "workspace" : "me") }
        catch APIError.unauthorized { auth.logout() } catch { requests = [] }
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
                            field("MULAI") { DatePicker("", selection: $start, displayedComponents: .date).datePickerStyle(.compact).labelsHidden().tint(NX.violet) }
                            field("SAMPAI") { DatePicker("", selection: $end, in: start..., displayedComponents: .date).datePickerStyle(.compact).labelsHidden().tint(NX.violet) }
                        }
                        field("ALASAN") {
                            TextField("Alasan / konteks…", text: $reason, axis: .vertical)
                                .font(NXFont.text(15)).lineLimit(3...6).padding(12)
                                .background(NX.card, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                                .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(NX.border))
                        }
                        if showAttachment {
                            field(type == "SICK" ? "FOTO SURAT SAKIT\(attachmentRequired ? " (WAJIB)" : " (OPSIONAL)")" : "FOTO PENDUKUNG (OPSIONAL)") {
                                Button { showImporter = true } label: {
                                    HStack(spacing: 8) {
                                        Image(systemName: "camera").foregroundStyle(NX.mutedFg)
                                        Text(attach?.name ?? "Pilih foto / file (maks 10MB)").font(NXFont.text(14))
                                            .foregroundStyle(attach == nil ? NX.mutedFg : NX.foreground).lineLimit(1)
                                        Spacer()
                                        if attach != nil { Image(systemName: "xmark.circle.fill").foregroundStyle(NX.mutedFg).onTapGesture { attach = nil } }
                                    }
                                    .padding(12).background(NX.card, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                                    .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(attach == nil ? NX.border : NX.violet.opacity(0.5), style: StrokeStyle(lineWidth: 1, dash: [5])))
                                }.buttonStyle(.plain)
                            }
                        }
                        if let err { Text(err).font(NXFont.text(13, .semibold)).foregroundStyle(NX.danger) }
                        Button { Task { await submit() } } label: {
                            HStack(spacing: 8) { if busy { ProgressView().tint(.white) }; Text("Submit request") }
                        }
                        .buttonStyle(NexusPrimaryButton()).disabled(busy || !canSubmit)
                    }
                    .padding(20)
                }
            }
            .navigationTitle("Pengajuan baru")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .topBarLeading) { Button("Batal") { dismiss() } } }
            .fileImporter(isPresented: $showImporter, allowedContentTypes: [.image, .pdf], allowsMultipleSelection: false) { result in
                if case let .success(urls) = result, let url = urls.first {
                    let scoped = url.startAccessingSecurityScopedResource()
                    defer { if scoped { url.stopAccessingSecurityScopedResource() } }
                    if let data = try? Data(contentsOf: url), data.count <= 10 * 1024 * 1024 {
                        attach = (url.lastPathComponent, data)
                    } else { err = "File maks 10MB." }
                }
            }
        }
    }

    private func field<C: View>(_ label: String, @ViewBuilder _ content: () -> C) -> some View {
        VStack(alignment: .leading, spacing: 7) {
            Text(label).font(NXFont.text(11, .bold)).tracking(0.5).foregroundStyle(NX.mutedFg)
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
            err = (error as? LocalizedError)?.errorDescription ?? "Gagal kirim pengajuan."
        }
    }
}
