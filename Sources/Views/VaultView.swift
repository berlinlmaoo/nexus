import SwiftUI
import UIKit

// ─────────────────────────────────────────────────────────────────────────────
// Z Vault on the phone.
//
// One folder at a time, the way the web browses it, because a shared drive grows without anybody
// deciding to and a screen that loads the whole tree is fine until the day it is not.
//
// Nothing here draws a viewer of its own: a tapped file becomes an `AttachmentPreview` and goes to
// `AttachmentViewerView`, which already knows how to show a picture, a PDF and a film and how to
// hand everything else to the share sheet. A fourth viewer for the vault would be a fourth place
// for "this file won't open" to come from.
// ─────────────────────────────────────────────────────────────────────────────

struct VaultView: View {
    @Environment(AuthStore.self) private var auth

    /// The folder being shown. nil is the root — the same value the API takes.
    @State private var parentId: String?
    @State private var listing: VaultListing?
    @State private var loading = true
    @State private var problem: String?
    @State private var trash = false
    @State private var query = ""
    @State private var searchTask: Task<Void, Never>?

    @State private var showImporter = false
    @State private var uploadProgress = UploadProgress()
    @State private var fetchProgress = UploadProgress()
    @State private var busy = false

    @State private var preview: AttachmentPreview?
    @State private var shareItem: ShareItem?
    @State private var sharing: VaultItem?
    @State private var renaming: VaultItem?
    @State private var renameText = ""
    @State private var deleteTarget: VaultItem?
    @State private var newFolder = false
    @State private var newFolderName = ""

    var body: some View {
        ZStack {
            NX.background.ignoresSafeArea()
            content
        }
        .navigationTitle(T("Z Vault"))
        .navigationBarTitleDisplayMode(.inline)
        .searchable(text: $query, prompt: T("Search files…"))
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    if listing?.canWrite == true && !trash {
                        Button { newFolderName = ""; newFolder = true } label: {
                            Label(T("New folder"), systemImage: "folder.badge.plus")
                        }
                        Button { showImporter = true } label: {
                            Label(T("Upload file"), systemImage: "arrow.up.doc")
                        }
                    }
                    Divider()
                    Button { trash.toggle(); Task { await load() } } label: {
                        Label(trash ? T("Back to files") : T("Trash"), systemImage: "trash")
                    }
                } label: { Image(systemName: "ellipsis.circle") }
            }
        }
        .task { await load() }
        .onChange(of: query) { _, _ in
            // One search in flight at a time, replaced on every keystroke. Without the cancel this
            // sends a request per letter and the answers arrive out of order, so the list settles on
            // whichever reply happened to be slowest rather than on what was typed.
            searchTask?.cancel()
            searchTask = Task {
                try? await Task.sleep(for: .milliseconds(300))
                guard !Task.isCancelled else { return }
                await load()
            }
        }
        .refreshable { await load() }
        .sheet(isPresented: $showImporter) {
            DocumentPicker(types: [.item], multiple: true) { urls in
                let result: Result<[URL], Error> = .success(urls)
                if case let .success(urls) = result { Task { await upload(urls) } }
            }
            .ignoresSafeArea()
        }
        .fullScreenCover(item: $preview) { AttachmentViewerView(preview: $0) }
        .sheet(item: $shareItem) { ActivityView(items: [$0.url]) }
        .sheet(item: $sharing) { item in
            NavigationStack { VaultShareSheet(item: item) { sharing = nil; Task { await load() } } }
        }
        .alert(T("New folder"), isPresented: $newFolder) {
            TextField(T("Name"), text: $newFolderName)
            Button(T("Create")) { Task { await createFolder() } }
            Button(T("Cancel"), role: .cancel) {}
        }
        .alert(T("Rename"), isPresented: Binding(get: { renaming != nil }, set: { if !$0 { renaming = nil } })) {
            TextField(T("Name"), text: $renameText)
            Button(T("Save")) { Task { await rename() } }
            Button(T("Cancel"), role: .cancel) { renaming = nil }
        }
        .confirmationDialog(
            deleteTarget.map { "\(trash ? T("Delete forever") : T("Move to trash")) \"\($0.name)\"?" } ?? "",
            isPresented: Binding(get: { deleteTarget != nil }, set: { if !$0 { deleteTarget = nil } }),
            titleVisibility: .visible
        ) {
            // In the trash this is the irreversible one, and it says so rather than sharing a word
            // with the reversible one a screen earlier.
            Button(trash ? T("Delete forever") : T("Move to trash"), role: .destructive) {
                if let item = deleteTarget { deleteTarget = nil; Task { await remove(item, purge: trash) } }
            }
            Button(T("Cancel"), role: .cancel) { deleteTarget = nil }
        }
    }

    // MARK: Content

    @ViewBuilder private var content: some View {
        if loading && listing == nil {
            ProgressView().tint(NX.violetText).frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if let problem, listing == nil {
            empty(icon: "externaldrive.badge.xmark", title: T("Vault unavailable"), msg: problem)
        } else {
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    if uploadProgress.isActive { UploadProgressBar(progress: uploadProgress).padding(.horizontal, 16) }
                    if fetchProgress.isActive { UploadProgressBar(progress: fetchProgress).padding(.horizontal, 16) }

                    if let quota = listing?.quota { quotaBar(quota) }
                    if !trash && query.isEmpty { breadcrumb }
                    if trash { trashBanner }

                    if let items = listing?.items, !items.isEmpty {
                        LazyVStack(spacing: 8) {
                            ForEach(items) { item in row(item) }
                        }
                        .padding(.horizontal, 16)
                    } else {
                        empty(
                            icon: trash ? "trash" : query.isEmpty ? "externaldrive" : "magnifyingglass",
                            title: trash ? T("Trash is empty") : query.isEmpty ? T("Nothing here yet") : T("No matches"),
                            msg: trash ? T("Deleted files show up here first.")
                                : query.isEmpty ? T("Shared logos, decks and assets live in here. Upload the first file from the toolbar, or start with a folder so everything has a place.")
                                : T("Try another keyword.")
                        )
                        .frame(minHeight: 260)
                    }
                }
                .padding(.vertical, 14)
            }
        }
    }

    private func quotaBar(_ quota: VaultQuota) -> some View {
        let fraction = quota.totalBytes > 0 ? min(1, Double(quota.usedBytes) / Double(quota.totalBytes)) : 0
        return VStack(alignment: .leading, spacing: 5) {
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    Capsule().fill(NX.muted)
                    Capsule()
                        .fill(fraction > 0.9 ? NX.danger : NX.violet)
                        .frame(width: geo.size.width * fraction)
                }
            }
            .frame(height: 5)
            Text("\(Self.human(quota.usedBytes)) / \(Self.human(quota.totalBytes))")
                .font(NXFont.text(11)).foregroundStyle(NX.mutedFg)
        }
        .padding(.horizontal, 16)
    }

    private var breadcrumb: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 4) {
                Button(T("Vault")) { parentId = nil; Task { await load() } }
                    .font(NXFont.text(12)).foregroundStyle(NX.mutedFg)
                ForEach(listing?.breadcrumb ?? []) { crumb in
                    Image(systemName: "chevron.right").font(.system(size: 9)).foregroundStyle(NX.mutedFg)
                    Button(crumb.name) { parentId = crumb.id; Task { await load() } }
                        .font(NXFont.text(12)).foregroundStyle(NX.foreground)
                }
            }
            .padding(.horizontal, 16)
        }
    }

    private var trashBanner: some View {
        HStack(spacing: 10) {
            Text(T("Files in the trash still take up space."))
                .font(NXFont.text(12)).foregroundStyle(NX.mutedFg)
            Spacer()
            Button(T("Empty")) { Task { await emptyTrash() } }
                .font(NXFont.text(12, .bold)).foregroundStyle(NX.danger)
                .disabled(busy || listing?.items.isEmpty != false)
        }
        .padding(12)
        .background(NX.muted, in: RoundedRectangle(cornerRadius: 12))
        .padding(.horizontal, 16)
    }

    private func row(_ item: VaultItem) -> some View {
        HStack(spacing: 12) {
            Image(systemName: Self.icon(for: item))
                .font(.system(size: 18))
                .foregroundStyle(item.isFolder ? NX.violetText : NX.mutedFg)
                .frame(width: 26)

            VStack(alignment: .leading, spacing: 2) {
                Text(item.name).font(NXFont.text(14, .bold)).foregroundStyle(NX.foreground).lineLimit(1)
                Text(Self.subtitle(item)).font(NXFont.text(11)).foregroundStyle(NX.mutedFg).lineLimit(1)
            }
            Spacer(minLength: 6)

            if item.isRestricted {
                Image(systemName: "lock.fill").font(.system(size: 11)).foregroundStyle(NX.mutedFg)
            }

            Menu {
                if trash {
                    Button { Task { await restore(item) } } label: { Label(T("Restore"), systemImage: "arrow.uturn.backward") }
                    if item.canModify {
                        Button(role: .destructive) { deleteTarget = item } label: { Label(T("Delete forever"), systemImage: "trash") }
                    }
                } else {
                    if !item.isFolder {
                        Button { Task { await open(item) } } label: { Label(T("Open"), systemImage: "eye") }
                        Button { Task { await save(item) } } label: { Label(T("Save / Share"), systemImage: "square.and.arrow.up") }
                        Button { sharing = item } label: { Label(T("Share link"), systemImage: "link") }
                    }
                    if item.canModify {
                        Button { renaming = item; renameText = item.name } label: { Label(T("Rename"), systemImage: "pencil") }
                        Button(role: .destructive) { deleteTarget = item } label: { Label(T("Move to trash"), systemImage: "trash") }
                    }
                }
            } label: {
                Image(systemName: "ellipsis")
                    .font(.system(size: 15))
                    .foregroundStyle(NX.mutedFg)
                    // 44pt of tappable area behind a 15pt glyph. The same fix the Threads delete
                    // button needed: a menu that only opens on the third try reads as a broken app.
                    .frame(width: 44, height: 44)
                    .contentShape(Rectangle())
            }
        }
        .padding(.vertical, 8)
        .padding(.leading, 12)
        .background(NX.card, in: RoundedRectangle(cornerRadius: 12))
        .contentShape(Rectangle())
        .onTapGesture {
            guard !trash else { return }
            if item.isFolder { parentId = item.id; query = ""; Task { await load() } }
            else { Task { await open(item) } }
        }
    }

    private func empty(icon: String, title: String, msg: String) -> some View {
        VStack(spacing: 8) {
            Image(systemName: icon).font(.system(size: 40)).foregroundStyle(NX.mutedFg)
            Text(title).font(NXFont.display(16, .bold)).foregroundStyle(NX.foreground)
            Text(msg).font(NXFont.text(13)).foregroundStyle(NX.mutedFg).multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(32)
    }

    // MARK: Actions

    private func load() async {
        problem = nil
        do {
            listing = try await APIClient.shared.vaultList(
                parentId: trash ? nil : parentId,
                trash: trash,
                query: query.trimmingCharacters(in: .whitespaces)
            )
        } catch APIError.unauthorized {
            auth.logout()
        } catch {
            problem = Self.message(error)
        }
        loading = false
    }

    private func open(_ item: VaultItem) async {
        guard let raw = item.url, let kind = AttachmentKind(mime: item.mimeType, name: item.name) else {
            await save(item)
            return
        }
        if kind == .image {
            // The remote URL, not a copy on disk: ImageLoader fetches it with the session,
            // downsamples in one pass and keeps the result.
            guard let remote = Self.remote(raw) else { return }
            preview = AttachmentPreview(id: item.id, name: item.name, kind: kind, source: remote)
            return
        }
        guard let file = await fetch(item) else { return }
        preview = AttachmentPreview(id: item.id, name: item.name, kind: kind, source: file)
    }

    private func save(_ item: VaultItem) async {
        guard let file = await fetch(item) else { return }
        shareItem = ShareItem(url: file)
    }

    private func fetch(_ item: VaultItem) async -> URL? {
        do { return try await APIClient.shared.vaultDownload(item: item, progress: fetchProgress) }
        catch APIError.unauthorized { auth.logout(); return nil }
        catch { problem = Self.message(error); return nil }
    }

    private func upload(_ urls: [URL]) async {
        busy = true
        defer { busy = false }
        for url in urls {
            let scoped = url.startAccessingSecurityScopedResource()
            defer { if scoped { url.stopAccessingSecurityScopedResource() } }
            do {
                try await APIClient.shared.vaultUpload(file: url, fileName: url.lastPathComponent,
                                                       parentId: parentId, progress: uploadProgress)
            } catch APIError.unauthorized {
                auth.logout()
                return
            } catch {
                problem = Self.message(error)
            }
        }
        await load()
    }

    private func createFolder() async {
        let name = newFolderName.trimmingCharacters(in: .whitespaces)
        guard !name.isEmpty else { return }
        do { try await APIClient.shared.vaultCreateFolder(name: name, parentId: parentId) }
        catch APIError.unauthorized { auth.logout(); return }
        catch { problem = Self.message(error) }
        await load()
    }

    private func rename() async {
        guard let item = renaming else { return }
        let name = renameText.trimmingCharacters(in: .whitespaces)
        renaming = nil
        guard !name.isEmpty, name != item.name else { return }
        do { try await APIClient.shared.vaultRename(item.id, to: name) }
        catch APIError.unauthorized { auth.logout(); return }
        catch { problem = Self.message(error) }
        await load()
    }

    private func remove(_ item: VaultItem, purge: Bool) async {
        do { try await APIClient.shared.vaultDelete(item.id, purge: purge) }
        catch APIError.unauthorized { auth.logout(); return }
        catch { problem = Self.message(error) }
        await load()
    }

    private func restore(_ item: VaultItem) async {
        do { try await APIClient.shared.vaultRestore(item.id) }
        catch APIError.unauthorized { auth.logout(); return }
        catch { problem = Self.message(error) }
        await load()
    }

    private func emptyTrash() async {
        busy = true
        defer { busy = false }
        do { _ = try await APIClient.shared.vaultEmptyTrash() }
        catch APIError.unauthorized { auth.logout(); return }
        catch { problem = Self.message(error) }
        await load()
    }

    // MARK: Small helpers

    private static func remote(_ raw: String) -> URL? {
        URL(string: raw.hasPrefix("http") ? raw : Config.baseURL.absoluteString + raw)
    }

    private static func message(_ error: Error) -> String {
        (error as? LocalizedError)?.errorDescription ?? T("Something went wrong.")
    }

    static func human(_ bytes: Int) -> String {
        let f = ByteCountFormatter()
        f.countStyle = .binary
        return f.string(fromByteCount: Int64(bytes))
    }

    private static func subtitle(_ item: VaultItem) -> String {
        var parts: [String] = []
        if item.isFolder {
            parts.append("\(item.childCount) \(T("items"))")
        } else if let size = item.size {
            parts.append(human(size))
        }
        if item.shareCount > 0 { parts.append("\(item.shareCount) \(T("links"))") }
        if let uploader = item.uploader { parts.append(uploader.name) }
        return parts.joined(separator: " · ")
    }

    private static func icon(for item: VaultItem) -> String {
        if item.isFolder { return "folder.fill" }
        switch AttachmentKind(mime: item.mimeType, name: item.name) {
        case .image?: return "photo"
        case .pdf?:   return "doc.richtext"
        case .video?: return "film"
        case .audio?: return "waveform"
        case nil:     return "doc"
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────

/// Making and revoking links for one file.
struct VaultShareSheet: View {
    let item: VaultItem
    var onClose: () -> Void

    @State private var requireAuth = true
    @State private var allowDownload = true
    @State private var expires: VaultExpiry = .permanent
    @State private var shares: [VaultShare] = []
    @State private var busy = false
    @State private var problem: String?
    @State private var copied = false

    var body: some View {
        List {
            Section {
                Toggle(isOn: $requireAuth) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(requireAuth ? T("Internal") : T("External")).font(NXFont.text(14, .bold))
                        Text(requireAuth
                             ? T("Needs a NEXUS account. On iPhone and Mac the link opens the app straight to this file.")
                             : T("Anyone with the link can open it, no account. That link deliberately stays in the browser."))
                            .font(NXFont.text(11)).foregroundStyle(NX.mutedFg)
                    }
                }
                Toggle(T("Allow download"), isOn: $allowDownload)
                Picker(T("Expires"), selection: $expires) {
                    ForEach(VaultExpiry.allCases) { Text($0.label).tag($0) }
                }
            }

            Section {
                Button {
                    Task { await create() }
                } label: {
                    HStack {
                        Image(systemName: "link")
                        Text(copied ? T("Link copied") : T("Create link"))
                    }
                }
                .disabled(busy)
            }

            if !shares.isEmpty {
                Section(T("Existing links")) {
                    ForEach(shares) { share in
                        VStack(alignment: .leading, spacing: 4) {
                            HStack {
                                Text(Self.statusLabel(share)).font(NXFont.text(11, .bold))
                                    .foregroundStyle(share.status == "active" ? NX.success : NX.mutedFg)
                                Spacer()
                                Text("\(share.viewCount)×").font(NXFont.text(11)).foregroundStyle(NX.mutedFg)
                            }
                            Text(share.url).font(NXFont.text(11)).foregroundStyle(NX.mutedFg).lineLimit(1)
                            HStack(spacing: 14) {
                                Button(T("Copy")) { UIPasteboard.general.string = share.url }
                                    .font(NXFont.text(12))
                                if share.status == "active" {
                                    Button(T("Revoke"), role: .destructive) { Task { await revoke(share) } }
                                        .font(NXFont.text(12))
                                }
                            }
                        }
                        .padding(.vertical, 2)
                    }
                }
            }

            if let problem {
                Section { Text(problem).font(NXFont.text(12)).foregroundStyle(NX.danger) }
            }
        }
        .navigationTitle(item.name)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .cancellationAction) { Button(T("Close")) { onClose() } }
        }
        .task { await loadShares() }
    }

    private static func statusLabel(_ share: VaultShare) -> String {
        switch share.status {
        case "revoked": return T("Revoked")
        case "expired": return T("Expired")
        default:        return share.requireAuth ? T("Internal") : T("External")
        }
    }

    private func loadShares() async {
        do { shares = try await APIClient.shared.vaultShares(itemId: item.id) }
        catch { problem = (error as? LocalizedError)?.errorDescription }
    }

    private func create() async {
        busy = true
        defer { busy = false }
        problem = nil
        do {
            let share = try await APIClient.shared.vaultCreateShare(
                itemId: item.id, requireAuth: requireAuth, allowDownload: allowDownload, expires: expires)
            UIPasteboard.general.string = share.url
            copied = true
            await loadShares()
        } catch {
            problem = (error as? LocalizedError)?.errorDescription ?? T("Something went wrong.")
        }
    }

    private func revoke(_ share: VaultShare) async {
        do { try await APIClient.shared.vaultRevokeShare(share.id) }
        catch { problem = (error as? LocalizedError)?.errorDescription }
        await loadShares()
    }
}
