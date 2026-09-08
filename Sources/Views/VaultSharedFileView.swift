import SwiftUI
import UIKit

/// What a tapped `/v/<slug>` link opens.
///
/// The slug is resolved by the SERVER — this screen sends it and is handed back a name, a type and
/// two URLs that both point at the slug again. It never learns where the file lives, which is the
/// same property that makes the link safe to send in the first place, and it means a revoked link
/// stops working here at the moment it is revoked rather than whenever something expires.
///
/// Only internal (`/v/`) links reach this screen at all. External ones use `/s/`, which the AASA
/// deliberately does not claim, so a client with no NEXUS account is never handed an app they
/// cannot sign into.
struct VaultSharedFileView: View {
    let slug: String

    @State private var info: VaultPublicFile?
    @State private var loading = true
    @State private var problem: String?
    @State private var preview: AttachmentPreview?
    @State private var shareItem: ShareItem?
    @State private var fetchProgress = UploadProgress()
    @State private var working = false

    var body: some View {
        ZStack {
            NX.background.ignoresSafeArea()
            content
        }
        .navigationTitle(info?.file.name ?? T("Shared file"))
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
        .fullScreenCover(item: $preview) { AttachmentViewerView(preview: $0) }
        .sheet(item: $shareItem) { ActivityView(items: [$0.url]) }
    }

    @ViewBuilder private var content: some View {
        if loading {
            ProgressView().tint(NX.violetText)
        } else if let problem {
            VStack(spacing: 10) {
                Image(systemName: "link.badge.plus").font(.system(size: 40)).foregroundStyle(NX.mutedFg)
                Text(T("This link cannot be opened")).font(NXFont.display(16, .bold)).foregroundStyle(NX.foreground)
                Text(problem).font(NXFont.text(13)).foregroundStyle(NX.mutedFg).multilineTextAlignment(.center)
            }
            .padding(32)
        } else if let info {
            VStack(spacing: 14) {
                Image(systemName: "externaldrive.fill")
                    .font(.system(size: 44)).foregroundStyle(NX.violetText)
                Text(info.file.name)
                    .font(NXFont.display(17, .bold)).foregroundStyle(NX.foreground)
                    .multilineTextAlignment(.center)
                if let size = info.file.size {
                    Text(VaultView.human(size)).font(NXFont.text(12)).foregroundStyle(NX.mutedFg)
                }
                if fetchProgress.isActive { UploadProgressBar(progress: fetchProgress).padding(.horizontal, 30) }

                Button {
                    Task { await open(info) }
                } label: {
                    Label(T("Open"), systemImage: "eye").frame(maxWidth: 220)
                }
                .buttonStyle(.borderedProminent)
                .disabled(working)

                if info.allowDownload {
                    Button {
                        Task { await save(info) }
                    } label: {
                        Label(T("Save / Share"), systemImage: "square.and.arrow.up").frame(maxWidth: 220)
                    }
                    .buttonStyle(.bordered)
                    .disabled(working)
                } else {
                    // Said plainly rather than by a missing button: "there is no download" is an
                    // answer, and a button that simply is not there is not one.
                    Text(T("The sender turned downloads off for this link."))
                        .font(NXFont.text(11)).foregroundStyle(NX.mutedFg)
                }
            }
            .padding(32)
        }
    }

    private func load() async {
        do { info = try await APIClient.shared.vaultPublic(slug: slug) }
        catch { problem = (error as? LocalizedError)?.errorDescription ?? T("This link is no longer valid.") }
        loading = false
    }

    private func open(_ info: VaultPublicFile) async {
        guard let kind = AttachmentKind(mime: info.file.mimeType, name: info.file.name) else {
            await save(info)
            return
        }
        if kind == .image, let remote = Self.remote(info.previewUrl) {
            preview = AttachmentPreview(id: slug, name: info.file.name, kind: kind, source: remote)
            return
        }
        guard let file = await fetch(info) else { return }
        preview = AttachmentPreview(id: slug, name: info.file.name, kind: kind, source: file)
    }

    private func save(_ info: VaultPublicFile) async {
        guard let file = await fetch(info) else { return }
        shareItem = ShareItem(url: file)
    }

    private func fetch(_ info: VaultPublicFile) async -> URL? {
        working = true
        defer { working = false }
        do {
            return try await APIClient.shared.downloadAttachment(
                url: info.previewUrl, fileName: info.file.name, progress: fetchProgress)
        } catch {
            problem = (error as? LocalizedError)?.errorDescription ?? T("Something went wrong.")
            return nil
        }
    }

    private static func remote(_ raw: String) -> URL? {
        URL(string: raw.hasPrefix("http") ? raw : Config.baseURL.absoluteString + raw)
    }
}
