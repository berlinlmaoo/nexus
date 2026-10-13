import SwiftUI
import UIKit

/// What a tapped `/v/<slug>` link opens: a file, or (since 9 Oct 2026) a folder to browse.
///
/// The slug is resolved by the SERVER — this screen sends it and is handed back a name, a type and
/// URLs that all point at the slug again. It never learns where the file lives, which is the same
/// property that makes the link safe to send in the first place, and it means a revoked link stops
/// working here at the moment it is revoked rather than whenever something expires.
///
/// Only internal (`/v/`) links reach this screen at all. External ones use `/s/`, which the AASA
/// deliberately does not claim, so a client with no NEXUS account is never handed an app they
/// cannot sign into.
///
/// A view-only link (allowDownload = false) never reaches the share sheet: a picture, a film, a sound
/// or a PDF opens in the app's own viewer, and anything else says it cannot be opened here — the
/// server refuses those bytes anyway (403 PREVIEW_ONLY).
struct VaultSharedFileView: View {
    let slug: String

    @State private var info: VaultPublicFile?
    @State private var loading = true
    @State private var problem: String?

    var body: some View {
        Group {
            if loading {
                ZStack { NX.background.ignoresSafeArea(); ProgressView().tint(NX.violetText) }
            } else if let problem {
                ZStack {
                    NX.background.ignoresSafeArea()
                    EmptyState(icon: "link.badge.plus", title: T("This link cannot be opened"), subtitle: problem,
                               actionTitle: T("Try again"), actionIcon: "arrow.clockwise") {
                        Task { await load() }
                    }
                }
            } else if let info, info.isFolder {
                VaultSharedFolderView(slug: slug, folder: nil, rootName: info.folder?.name ?? info.file.name,
                                      allowDownload: info.allowDownload, sharedBy: info.sharedBy?.name)
            } else if let info {
                VaultSharedSingleFile(slug: slug, info: info)
            }
        }
        .navigationTitle(info?.folder?.name ?? info?.file.name ?? T("Shared file"))
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
    }

    private func load() async {
        loading = info == nil
        do {
            info = try await APIClient.shared.vaultPublic(slug: slug)
            problem = nil
        } catch {
            problem = (error as? LocalizedError)?.errorDescription ?? T("This link is no longer valid.")
        }
        loading = false
    }
}

// ─────────────────────────────────────────────────────────────────────────────

/// What one shared file opens: the app's own viewer for a picture, film, sound or PDF; the share
/// sheet only when the link allows downloads.
private enum SharedCover: Identifiable {
    case media(items: [VaultItem], start: Int)
    case attachment(AttachmentPreview)
    var id: String {
        switch self {
        case .media(let items, let start): return "media-\(items.indices.contains(start) ? items[start].id : "")"
        case .attachment(let preview): return "file-\(preview.id)"
        }
    }
}

/// Opening one item behind a link — shared by the single-file screen and the folder browser.
@MainActor
private struct SharedOpener {
    let allowDownload: Bool
    let progress: UploadProgress

    enum Outcome { case cover(SharedCover), activity(ShareItem), refused(String) }

    func open(_ item: VaultPublicItem, siblings: [VaultPublicItem]) async -> Outcome {
        let kind = AttachmentKind(mime: item.mimeType, name: item.name)
        guard let preview = item.previewUrl else {
            // View-only, and nothing can show it. Said plainly — never a share sheet.
            return .refused(T("This file can't be previewed, and the sender turned downloads off."))
        }
        if kind == .image || kind == .video {
            let media = siblings.filter { s in
                let k = AttachmentKind(mime: s.mimeType, name: s.name)
                return (k == .image || k == .video) && s.previewUrl != nil
            }
            let items = (media.isEmpty ? [item] : media).map(VaultItem.fromLink)
            let start = items.firstIndex { $0.id == item.id } ?? 0
            return .cover(.media(items: items, start: start))
        }
        if kind == .pdf || kind == .audio, let kind {
            do {
                let file = try await APIClient.shared.downloadAttachment(url: preview, fileName: item.name, progress: progress)
                return .cover(.attachment(AttachmentPreview(id: item.id, name: item.name, kind: kind, source: file)))
            } catch {
                return .refused((error as? LocalizedError)?.errorDescription ?? T("Couldn't open the file"))
            }
        }
        // Nothing in the app can show it: a copy to hand on, only when the link allows downloads.
        guard allowDownload else {
            return .refused(T("This file can't be previewed, and the sender turned downloads off."))
        }
        do {
            let file = try await APIClient.shared.downloadAttachment(url: preview, fileName: item.name, progress: progress)
            return .activity(ShareItem(url: file))
        } catch {
            return .refused((error as? LocalizedError)?.errorDescription ?? T("Couldn't open the file"))
        }
    }

    func copy(_ item: VaultPublicItem) async -> Outcome {
        guard allowDownload, let url = item.downloadUrl ?? item.previewUrl else {
            return .refused(T("This link is view-only. The sender turned downloads off."))
        }
        do {
            let file = try await APIClient.shared.downloadAttachment(url: url, fileName: item.name, progress: progress)
            return .activity(ShareItem(url: file))
        } catch {
            return .refused((error as? LocalizedError)?.errorDescription ?? T("Couldn't open the file"))
        }
    }
}

private struct VaultSharedSingleFile: View {
    let slug: String
    let info: VaultPublicFile

    @State private var cover: SharedCover?
    @State private var shareItem: ShareItem?
    @State private var refusal: String?
    @State private var fetchProgress = UploadProgress()
    @State private var working = false

    /// The link's own file, in the folder-listing shape (older servers send no `item`).
    private var item: VaultPublicItem {
        info.item ?? VaultPublicItem(id: slug, kind: "FILE", name: info.file.name, mimeType: info.file.mimeType,
                                     size: info.file.size, width: nil, height: nil, childCount: 0,
                                     previewKind: info.previewKind, previewUrl: info.previewUrl,
                                     downloadUrl: info.downloadUrl, thumbUrl: info.thumbUrl, fileVersion: nil)
    }

    var body: some View {
        ZStack {
            NX.background.ignoresSafeArea()
            VStack(spacing: 14) {
                Image(systemName: "externaldrive.fill")
                    .font(.system(size: 44)).foregroundStyle(NX.violetText)
                Text(info.file.name)
                    .font(NXFont.display(17, .bold)).foregroundStyle(NX.foreground)
                    .multilineTextAlignment(.center)
                Text(subtitle).font(NXFont.text(12)).foregroundStyle(NX.mutedFg).multilineTextAlignment(.center)
                if fetchProgress.isActive { UploadProgressBar(progress: fetchProgress).padding(.horizontal, 30) }

                if item.previewUrl != nil {
                    Button {
                        Task { await run { await $0.open(item, siblings: [item]) } }
                    } label: {
                        Label(T("Open"), systemImage: "eye").frame(maxWidth: 220)
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(working)
                }

                if info.allowDownload {
                    Button {
                        Task { await run { await $0.copy(item) } }
                    } label: {
                        Label(T("Send a copy…"), systemImage: "square.and.arrow.up").frame(maxWidth: 220)
                    }
                    .buttonStyle(.bordered)
                    .disabled(working)
                } else {
                    // Said plainly rather than by a missing button: "there is no download" is an
                    // answer, and a button that simply is not there is not one.
                    Text(item.previewUrl == nil
                         ? T("This file can't be previewed, and the sender turned downloads off.")
                         : T("The sender turned downloads off for this link."))
                        .font(NXFont.text(11)).foregroundStyle(NX.mutedFg).multilineTextAlignment(.center)
                }
            }
            .padding(32)
        }
        .fullScreenCover(item: $cover) { which in
            switch which {
            case .media(let items, let start):
                VaultMediaViewer(items: items, startIndex: start, allowsShareLink: false, allowsDownload: info.allowDownload)
            case .attachment(let preview):
                AttachmentViewerView(preview: preview)
            }
        }
        .sheet(item: $shareItem) { ActivityView(items: [$0.url]) }
        .alert(T("Couldn't open the file"), isPresented: Binding(get: { refusal != nil }, set: { if !$0 { refusal = nil } })) {
            Button(T("OK"), role: .cancel) {}
        } message: {
            Text(refusal ?? "")
        }
    }

    private var subtitle: String {
        var parts: [String] = []
        if let size = info.file.size { parts.append(VaultView.human(size)) }
        if let name = info.sharedBy?.name { parts.append(String(format: T("Shared by %@"), name)) }
        return parts.joined(separator: " · ")
    }

    private func run(_ action: (SharedOpener) async -> SharedOpener.Outcome) async {
        working = true
        defer { working = false }
        switch await action(SharedOpener(allowDownload: info.allowDownload, progress: fetchProgress)) {
        case .cover(let c): cover = c
        case .activity(let a): shareItem = a
        case .refused(let message): refusal = message
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────

/// A folder shared by an internal link, read-only (since 9 Oct 2026). One level per screen, pushed
/// on the sheet's navigation stack, so swipe-back goes up a level; the server keeps every level
/// inside what the link opens (404 for anything else), and the path starts at the shared folder.
struct VaultSharedFolderView: View {
    let slug: String
    /// nil = the shared folder itself.
    let folder: VaultCrumb?
    let rootName: String
    let allowDownload: Bool
    var sharedBy: String? = nil

    @State private var listing: VaultPublicListing?
    @State private var loading = true
    @State private var problem: String?
    @State private var openFolder: VaultCrumb?
    @State private var cover: SharedCover?
    @State private var shareItem: ShareItem?
    @State private var refusal: String?
    @State private var fetchProgress = UploadProgress()

    var body: some View {
        ZStack {
            NX.background.ignoresSafeArea()
            content
        }
        .navigationTitle(folder?.name ?? rootName)
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
        .refreshable { await load() }
        .navigationDestination(item: $openFolder) { next in
            VaultSharedFolderView(slug: slug, folder: next, rootName: rootName, allowDownload: allowDownload)
        }
        .fullScreenCover(item: $cover) { which in
            switch which {
            case .media(let items, let start):
                VaultMediaViewer(items: items, startIndex: start, allowsShareLink: false, allowsDownload: allowDownload)
            case .attachment(let preview):
                AttachmentViewerView(preview: preview)
            }
        }
        .sheet(item: $shareItem) { ActivityView(items: [$0.url]) }
        .alert(T("Couldn't open the file"), isPresented: Binding(get: { refusal != nil }, set: { if !$0 { refusal = nil } })) {
            Button(T("OK"), role: .cancel) {}
        } message: {
            Text(refusal ?? "")
        }
    }

    @ViewBuilder private var content: some View {
        if loading && listing == nil {
            ProgressView().tint(NX.violetText)
        } else if let problem, listing == nil {
            EmptyState(icon: "folder.badge.questionmark", title: T("Couldn't open this folder."), subtitle: problem,
                       actionTitle: T("Try again"), actionIcon: "arrow.clockwise") {
                Task { await load() }
            }
        } else if let listing {
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    header(listing)
                    if fetchProgress.isActive { UploadProgressBar(progress: fetchProgress).padding(.horizontal, 16) }
                    if listing.items.isEmpty {
                        EmptyState(icon: "folder", title: T("This folder is empty"),
                                   subtitle: T("Nothing has been put in this folder yet."), compact: true)
                            .padding(.top, 24)
                    } else {
                        rows(listing.items)
                    }
                }
                .padding(.vertical, 14)
            }
        }
    }

    private func header(_ listing: VaultPublicListing) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(listing.breadcrumb.map(\.name).joined(separator: " › "))
                .font(NXFont.text(12)).foregroundStyle(NX.mutedFg).lineLimit(2)
            if let sharedBy, folder == nil {
                Text(String(format: T("Shared by %@"), sharedBy)).font(NXFont.text(11)).foregroundStyle(NX.mutedFg)
            }
            if !allowDownload {
                Text(T("The sender turned downloads off for this link.")).font(NXFont.text(11)).foregroundStyle(NX.mutedFg)
            }
        }
        .padding(.horizontal, 16)
    }

    @ViewBuilder private func rows(_ items: [VaultPublicItem]) -> some View {
        let folders = items.filter(\.isFolder)
        let media = items.filter { !$0.isFolder && VaultMedia.isMedia(VaultItem.fromLink($0)) && $0.previewUrl != nil }
        let files = items.filter { item in !item.isFolder && !media.contains(where: { $0.id == item.id }) }
        if !folders.isEmpty {
            LazyVStack(spacing: 8) { ForEach(folders) { row($0, siblings: items) } }.padding(.horizontal, 16)
        }
        if !media.isEmpty {
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 104, maximum: 180), spacing: 10)], spacing: 12) {
                ForEach(media) { item in
                    Button { Task { await open(item, siblings: media) } } label: {
                        VStack(alignment: .leading, spacing: 4) {
                            Color.clear
                                .aspectRatio(1, contentMode: .fit)
                                .overlay { VaultThumbnail(item: VaultItem.fromLink(item)) }
                                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                            Text(item.name).font(NXFont.text(12, .semibold)).foregroundStyle(NX.foreground).lineLimit(1)
                        }
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(item.name)
                }
            }
            .padding(.horizontal, 16)
        }
        if !files.isEmpty {
            LazyVStack(spacing: 8) { ForEach(files) { row($0, siblings: items) } }.padding(.horizontal, 16)
        }
    }

    private func row(_ item: VaultPublicItem, siblings: [VaultPublicItem]) -> some View {
        Button {
            if item.isFolder { openFolder = VaultCrumb(id: item.id, name: item.name) }
            else { Task { await open(item, siblings: siblings) } }
        } label: {
            HStack(spacing: 12) {
                Image(systemName: VaultView.icon(for: VaultItem.fromLink(item)))
                    .font(.system(size: 18))
                    .foregroundStyle(item.isFolder ? NX.violetText : NX.mutedFg)
                    .frame(width: 26)
                VStack(alignment: .leading, spacing: 2) {
                    Text(item.name).font(NXFont.text(14, .bold)).foregroundStyle(NX.foreground).lineLimit(1)
                    Text(item.isFolder ? "\(item.childCount ?? 0) \(T("items"))" : (item.size.map(VaultView.human) ?? ""))
                        .font(NXFont.text(11)).foregroundStyle(NX.mutedFg).lineLimit(1)
                }
                Spacer(minLength: 6)
                if item.isFolder {
                    Image(systemName: "chevron.right").font(.system(size: 12, weight: .semibold)).foregroundStyle(NX.mutedFg)
                }
            }
            .padding(.vertical, 10)
            .padding(.horizontal, 12)
            .background(NX.card, in: RoundedRectangle(cornerRadius: 12))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    private func load() async {
        if listing == nil { loading = true }
        do {
            listing = try await APIClient.shared.vaultPublicItems(slug: slug, folderId: folder?.id)
            problem = nil
        } catch {
            problem = (error as? LocalizedError)?.errorDescription ?? T("Something went wrong.")
        }
        loading = false
    }

    private func open(_ item: VaultPublicItem, siblings: [VaultPublicItem]) async {
        switch await SharedOpener(allowDownload: allowDownload, progress: fetchProgress).open(item, siblings: siblings) {
        case .cover(let c): cover = c
        case .activity(let a): shareItem = a
        case .refused(let message): refusal = message
        }
    }
}
