import SwiftUI

/// The announcement pop-up, finally on the phone.
///
/// The whole system existed already — the table, the API, and an admin screen in this very app that
/// can post one. What was missing was the half that matters: nothing in the app ever READ them, so
/// an announcement posted from Control Room reached the web and nobody else. The person posting had
/// no way of knowing.
struct AnnouncementModal: View {
    @Environment(AuthStore.self) private var auth
    @Environment(\.scenePhase) private var scenePhase
    /// The announcement a notification pointed at (`AppRouter.focus`). Fetched by id and put at the
    /// front of the queue even if it was dismissed before — the active list would hide it, and a
    /// tap that shows nothing reads as broken.
    @Environment(AppRouter.self) private var router

    @State private var queue: [AdminAnnouncement] = []
    @State private var dismissing = false
    /// The SP's PDF, opened in the in-app viewer with the session.
    @State private var pdfPreview: AttachmentPreview?
    @State private var openingPDF = false

    private var current: AdminAnnouncement? { queue.first }

    var body: some View {
        ZStack {
            if let current {
                Color.black.opacity(0.55)
                    .ignoresSafeArea()
                    // Tapping the backdrop does NOT dismiss. An announcement is the one thing in the
                    // app somebody must not close by accident on the way to something else.
                    .transition(.opacity)
                card(current)
                    .transition(.scale(scale: 0.94).combined(with: .opacity))
            }
        }
        .animation(.spring(response: 0.34, dampingFraction: 0.86), value: current?.id)
        .fullScreenCover(item: $pdfPreview) { AttachmentViewerView(preview: $0) }
        .task { await load() }
        .onChange(of: router.focus) { _, _ in Task { await load() } }
        .onChange(of: scenePhase) { _, phase in
            // Coming back to the app is the moment a new announcement should appear — the same
            // moment the push that announced it was probably tapped.
            guard phase == .active else { return }
            Task { await load() }
        }
    }

    private func card(_ announcement: AdminAnnouncement) -> some View {
        VStack(spacing: 0) {
            VStack(alignment: .leading, spacing: 12) {
                HStack(spacing: 10) {
                    Image(systemName: icon(announcement.tone))
                        .font(.system(size: 17, weight: .bold))
                        .foregroundStyle(tint(announcement.tone))
                        .frame(width: 36, height: 36)
                        .background(tint(announcement.tone).opacity(0.14), in: Circle())
                    if announcement.kind == "sp" {
                        Text("SP").font(NXFont.text(11, .black)).foregroundStyle(.white)
                            .padding(.horizontal, 7).padding(.vertical, 3)
                            .background(NX.danger, in: Capsule())
                    }
                    Text(announcement.title)
                        .font(NXFont.display(17, .bold))
                        .foregroundStyle(NX.foreground)
                        .fixedSize(horizontal: false, vertical: true)
                    Spacer(minLength: 0)
                }

                if let body = announcement.body, !body.isEmpty {
                    // Scrolls rather than clips: an announcement long enough to overflow is exactly
                    // the kind whose last line carries the instruction.
                    ScrollView {
                        Text(body)
                            .font(NXFont.text(14))
                            .foregroundStyle(NX.mutedFg)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    .frame(maxHeight: 280)
                }

                if let urlString = announcement.imageUrl,
                   let url = URL(string: urlString.hasPrefix("http") ? urlString : Config.baseURL.absoluteString + urlString) {
                    AsyncImage(url: url) { image in
                        image.resizable().scaledToFit()
                    } placeholder: {
                        RoundedRectangle(cornerRadius: 12).fill(NX.muted).frame(height: 120)
                    }
                    .frame(maxHeight: 220)
                    .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                }
            }
            .padding(20)

            if let url = announcement.attachmentUrl {
                Button { Task { await openPDF(url, name: announcement.attachmentName ?? "SP.pdf") } } label: {
                    HStack(spacing: 8) {
                        if openingPDF { ProgressView().tint(NX.danger) } else { Image(systemName: "doc.richtext.fill") }
                        Text(T("Open PDF"))
                    }
                    .font(NXFont.text(14, .bold)).foregroundStyle(NX.danger)
                    .frame(maxWidth: .infinity).padding(.vertical, 12)
                    .background(NX.danger.opacity(0.1))
                }
                .buttonStyle(.plain)
                .disabled(openingPDF)
            }

            Divider().overlay(NX.border)

            Button {
                Task { await acknowledge(announcement) }
            } label: {
                Text(queue.count > 1 ? T("Next") : T("Got it"))
                    .font(NXFont.display(15, .bold))
                    .foregroundStyle(NX.violetText)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 14)
            }
            .buttonStyle(.plain)
            .disabled(dismissing)
            .opacity(dismissing ? 0.4 : 1)
        }
        .background(NX.card, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 22, style: .continuous).stroke(NX.border, lineWidth: 1))
        .padding(.horizontal, 28)
        .shadow(color: .black.opacity(0.35), radius: 30, y: 14)
    }

    // MARK: - work

    private func load() async {
        guard auth.isAuthenticated else { return }
        if case .announcement(let id) = router.focus {
            router.focus = nil
            if let one = try? await APIClient.shared.announcement(id) {
                queue.removeAll { $0.id == one.id }
                queue.insert(one, at: 0)
            }
        }
        guard let rows = try? await APIClient.shared.activeAnnouncements() else { return }
        // Only replace the queue when it is empty. Refreshing mid-read would swap the card out from
        // under somebody halfway through a sentence.
        guard queue.isEmpty else { return }
        queue = rows
    }

    private func acknowledge(_ announcement: AdminAnnouncement) async {
        guard !dismissing else { return }
        dismissing = true
        defer { dismissing = false }
        // Removed locally whatever the server says. A failed "seen" call means it comes back next
        // launch, which is a far better outcome than a card that cannot be closed.
        try? await APIClient.shared.markAnnouncementSeen(announcement.id)
        queue.removeAll { $0.id == announcement.id }
    }

    private func openPDF(_ url: String, name: String) async {
        openingPDF = true; defer { openingPDF = false }
        let file = name.lowercased().hasSuffix(".pdf") ? name : name + ".pdf"
        guard let local = try? await APIClient.shared.downloadAttachment(url: url, fileName: file) else { return }
        pdfPreview = AttachmentPreview(id: url, name: file, kind: .pdf, source: local)
    }

    private func tint(_ tone: String?) -> Color {
        switch (tone ?? "info").lowercased() {
        case "success": return NX.success
        case "warning": return NX.warning
        case "danger": return NX.danger
        default: return NX.violetText
        }
    }

    private func icon(_ tone: String?) -> String {
        switch (tone ?? "info").lowercased() {
        case "success": return "checkmark.seal.fill"
        case "warning": return "exclamationmark.triangle.fill"
        default: return "megaphone.fill"
        }
    }
}
