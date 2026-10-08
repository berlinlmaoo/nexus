import SwiftUI
import UIKit
import PhotosUI
import UniformTypeIdentifiers

// ─────────────────────────────────────────────────────────────────────────────
// Z Vault on the phone, the iPad and the Mac.
//
// One folder at a time, the way the web browses it, because a shared drive grows without anybody
// deciding to and a screen that loads the whole tree is fine until the day it is not.
//
// Folders and plain files are rows; pictures and films are a grid of thumbnails (owner, 9 Oct 2026:
// "I want to see the thumbnail of the photo") and open in `VaultMediaViewer`, which pages through
// the folder's pictures and films. Everything else still opens through `AttachmentViewerView` (a
// PDF, a sound) or the share sheet.
//
// Moving things (owner, 9 Oct 2026: the INTOO folder had to come out of LOGO): "Move to…" on every
// item's menu is the path that works everywhere, and on iPad and Mac an item can also be dragged
// onto a folder or a crumb of the path. Files dragged in from Files or Finder upload into the
// folder they are dropped on, or into the one on screen.
//
// One `.sheet`, one `.alert` and one `.fullScreenCover`, each driven by an enum: two sheets (or two
// alerts) on the same view is how one of them silently never presents.
//
// One folder per SCREEN since 9 Oct 2026: opening a folder pushes the next VaultView on the
// navigation stack, so swipe-back (and the back button) goes up one folder, as everywhere else in
// iOS. A crumb of the path pops back to that level (`popTo`, handed down by the screen below).
// ─────────────────────────────────────────────────────────────────────────────

struct VaultView: View {
    @Environment(AuthStore.self) private var auth

    /// The folder this screen shows; nil is the top of the vault.
    var folder: VaultCrumb? = nil
    /// Back to a folder further down the navigation stack (a crumb tapped). Handed down by the screen
    /// that pushed this one; nil on the first screen.
    var popTo: ((VaultCrumb?) -> Void)? = nil

    /// The folder being shown, as the API takes it. nil is the root.
    private var parentId: String? { folder?.id }
    /// The next folder down, pushed on top of this screen.
    @State private var pushed: VaultCrumb?
    @State private var listing: VaultListing?
    @State private var loading = true
    @State private var problem: String?
    @State private var trash = false
    @State private var query = ""
    @State private var searchTask: Task<Void, Never>?

    @State private var uploadProgress = UploadProgress()
    @State private var fetchProgress = UploadProgress()
    @State private var busy = false
    /// Uploads run one after another, whichever way they arrived (the picker or a drop): the server
    /// caps how many chunked uploads one person may have open, and two loops racing would share one
    /// progress bar.
    @State private var uploadChain: Task<Void, Never>?

    @State private var sheet: VaultSheet?
    @State private var vaultAlert: VaultAlert?
    @State private var cover: VaultCover?
    @State private var renameText = ""
    @State private var newFolderName = ""

    /// Drag and drop: the folder row or path crumb a drag is over (`VaultDropKey`), with its name,
    /// and whether it is over the page itself.
    @State private var dropKey: String?
    @State private var dropName = ""
    @State private var pageTargeted = false
    /// A short line at the bottom after a move ("Moved to LOGO"), gone by itself.
    @State private var notice: String?
    @State private var noticeTask: Task<Void, Never>?
    /// Upload from Photos. Presented from the view, never from inside the toolbar Menu: a PhotosPicker
    /// nested in a Menu draws its row and never opens (the menu tears down its content as it closes).
    @State private var showPhotos = false
    @State private var pickedPhotos: [PhotosPickerItem] = []

    var body: some View {
        ZStack {
            NX.background.ignoresSafeArea()
            content
        }
        .navigationTitle(folder?.name ?? T("Z Vault"))
        .navigationBarTitleDisplayMode(.inline)
        .searchable(text: $query, prompt: T("Search files…"))
        .navigationDestination(item: $pushed) { next in
            VaultView(folder: next, popTo: { go(to: $0) })
        }
        .photosPicker(isPresented: $showPhotos, selection: $pickedPhotos, maxSelectionCount: 20,
                      matching: .any(of: [.images, .videos]),
                      // JPEG and H.264 rather than HEIC/HEVC: the web's thumbnails and every browser
                      // (and the people a link is sent to) can show those; HEIC only Safari can.
                      preferredItemEncoding: .compatible, photoLibrary: .shared())
        .onChange(of: pickedPhotos) { _, items in
            guard !items.isEmpty else { return }
            let target = parentId
            pickedPhotos = []
            Task { await absorbPhotos(items, into: target) }
        }
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    if listing?.canWrite == true && !trash {
                        Button { newFolderName = ""; vaultAlert = .newFolder } label: {
                            Label(T("New folder"), systemImage: "folder.badge.plus")
                        }
                        Button { sheet = .importer } label: {
                            Label(T("Upload file"), systemImage: "arrow.up.doc")
                        }
                        Button { showPhotos = true } label: {
                            Label(T("Upload from Photos"), systemImage: "photo.on.rectangle")
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
        // A colleague's upload, move, rename or delete shows up without a pull to refresh. The
        // server's "vault" ping carries no data; this refetches the folder on screen through the API.
        .liveRefresh(every: 60, on: [.nexusWorkspaceChanged], kinds: [RealtimeKind.vault]) {
            await load(quiet: true)
        }
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
        .sheet(item: $sheet) { which in sheetContent(which) }
        .fullScreenCover(item: $cover) { which in
            switch which {
            case .media(let items, let start): VaultMediaViewer(items: items, startIndex: start)
            case .attachment(let preview): AttachmentViewerView(preview: preview)
            }
        }
        .alert(alertTitle, isPresented: alertShown, presenting: vaultAlert) { which in
            alertActions(which)
        } message: { which in
            alertMessage(which)
        }
        .overlay(alignment: .bottom) {
            if let notice {
                Text(notice)
                    .font(NXFont.text(13, .semibold)).foregroundStyle(NX.foreground)
                    .lineLimit(2).multilineTextAlignment(.center)
                    .padding(.horizontal, 16).padding(.vertical, 10)
                    .background(.regularMaterial, in: Capsule())
                    .padding(.horizontal, 24).padding(.bottom, 18)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
                    .allowsHitTesting(false)
            }
        }
        .animation(.easeOut(duration: 0.2), value: notice)
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
                        sections(items)
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
            // The page itself takes a drop: files land in the folder on screen. Not in the trash or
            // in search results, where "the folder on screen" is not something the person can see.
            .onDrop(of: pageAcceptsDrops ? VaultDropReader.types : [], isTargeted: $pageTargeted) { providers in
                accept(providers, into: parentId, name: currentFolderName)
            }
            .overlay {
                if pageTargeted && pageAcceptsDrops {
                    RoundedRectangle(cornerRadius: 18, style: .continuous)
                        .strokeBorder(NX.violet, style: StrokeStyle(lineWidth: 2, dash: [7, 5]))
                        .padding(6)
                        .allowsHitTesting(false)
                }
            }
            .overlay(alignment: .top) {
                if (pageTargeted && pageAcceptsDrops) || dropKey != nil {
                    Label(String(format: T("Drop to add to %@"), dropKey != nil ? dropName : currentFolderName),
                          systemImage: "arrow.down.doc")
                        .font(NXFont.text(13, .bold)).foregroundStyle(Color.white)
                        .lineLimit(1)
                        .padding(.horizontal, 14).padding(.vertical, 8)
                        .background(NX.violetFill, in: Capsule())
                        .padding(.top, 8)
                        .allowsHitTesting(false)
                }
            }
        }
    }

    /// Folders first, then the pictures and films as a grid, then every other file — the order the
    /// server sends inside each group is kept. The trash stays one flat list: nothing in it can be
    /// opened, so a grid of pictures there would promise something a tap cannot do.
    @ViewBuilder private func sections(_ items: [VaultItem]) -> some View {
        if trash {
            LazyVStack(spacing: 8) { ForEach(items) { row($0) } }
                .padding(.horizontal, 16)
        } else {
            let folders = items.filter(\.isFolder)
            let media = items.filter { VaultMedia.isMedia($0) }
            let files = items.filter { !$0.isFolder && !VaultMedia.isMedia($0) }
            if !folders.isEmpty {
                LazyVStack(spacing: 8) { ForEach(folders) { row($0) } }
                    .padding(.horizontal, 16)
            }
            if !media.isEmpty {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 104, maximum: 180), spacing: 10)], spacing: 12) {
                    ForEach(media) { tile($0, in: media) }
                }
                .padding(.horizontal, 16)
            }
            if !files.isEmpty {
                LazyVStack(spacing: 8) { ForEach(files) { row($0) } }
                    .padding(.horizontal, 16)
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

    /// The path, and on iPad and Mac also a drop target: an item dragged onto "Vault" goes to the
    /// top level, onto any other crumb into that folder.
    private var breadcrumb: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 4) {
                crumb(id: nil, name: T("Vault"), muted: true)
                ForEach(listing?.breadcrumb ?? []) { c in
                    Image(systemName: "chevron.right").font(.system(size: 9)).foregroundStyle(NX.mutedFg)
                    crumb(id: c.id, name: c.name, muted: false)
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 2)
        }
    }

    private func crumb(id: String?, name: String, muted: Bool) -> some View {
        let key = VaultDropKey.crumb(id)
        let targeted = dropKey == key
        return Button(name) { go(to: id.map { VaultCrumb(id: $0, name: name) }) }
            .font(NXFont.text(12, targeted ? .bold : .regular))
            .foregroundStyle(targeted ? NX.violetText : muted ? NX.mutedFg : NX.foreground)
            .padding(.horizontal, 6).padding(.vertical, 3)
            .background(targeted ? NX.accentBg : Color.clear, in: Capsule())
            .onDrop(of: VaultDropReader.types, isTargeted: dropBinding(key, name: name)) { providers in
                accept(providers, into: id, name: name)
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
        let key = VaultDropKey.row(item.id)
        let targeted = dropKey == key
        let base = HStack(spacing: 12) {
            rowIcon(item)

            VStack(alignment: .leading, spacing: 2) {
                Text(item.name).font(NXFont.text(14, .bold)).foregroundStyle(NX.foreground).lineLimit(1)
                Text(Self.subtitle(item)).font(NXFont.text(11)).foregroundStyle(NX.mutedFg).lineLimit(1)
            }
            Spacer(minLength: 6)

            if item.isRestricted || (item.isFolder && item.isWriteLocked) {
                Image(systemName: item.isRestricted ? "lock.fill" : "pencil.slash")
                    .font(.system(size: 11)).foregroundStyle(NX.mutedFg)
                    .accessibilityLabel(T("Locked"))
            }

            // Share, in plain sight on every row (owner, 9 Oct 2026: behind "…" nobody found it).
            if !trash {
                Button { sheet = .shareLink(item) } label: {
                    Image(systemName: "link")
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(NX.violetText)
                        .frame(width: 40, height: 44)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(String(format: T("Share link to %@"), item.name))
            }

            if trash && !item.canModify {
                Image(systemName: "lock")
                    .font(.system(size: 12))
                    .foregroundStyle(NX.mutedFg)
                    .frame(width: 44, height: 44)
                    .accessibilityLabel(T("Only whoever uploaded it, or BoD, can restore it"))
            } else {
                Menu { menuItems(item) } label: {
                    Image(systemName: "ellipsis")
                        .font(.system(size: 15))
                        .foregroundStyle(NX.mutedFg)
                        // 44pt of tappable area behind a 15pt glyph. The same fix the Threads delete
                        // button needed: a menu that only opens on the third try reads as a broken app.
                        .frame(width: 44, height: 44)
                        .contentShape(Rectangle())
                }
            }
        }
        .padding(.vertical, 8)
        .padding(.leading, 12)
        .background(targeted ? NX.accentBg : NX.card, in: RoundedRectangle(cornerRadius: 12))
        .overlay {
            RoundedRectangle(cornerRadius: 12)
                .strokeBorder(targeted ? NX.violet : Color.clear, lineWidth: 2)
        }
        .contentShape(Rectangle())
        .onTapGesture { open(item) }
        .accessibilityAddTraits(.isButton)
        .contextMenu { menuItems(item) }
        return movable(dropTarget(base, item), item)
    }

    private func rowIcon(_ item: VaultItem) -> some View {
        Image(systemName: Self.icon(for: item))
            .font(.system(size: 18))
            .foregroundStyle(item.isFolder ? NX.violetText : NX.mutedFg)
            .frame(width: 26)
    }

    /// A picture or a film: its thumbnail as a square tile, the name and the menu underneath.
    private func tile(_ item: VaultItem, in media: [VaultItem]) -> some View {
        let card = VStack(alignment: .leading, spacing: 4) {
            Color.clear
                .aspectRatio(1, contentMode: .fit)
                .overlay { VaultThumbnail(item: item) }
                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                .contentShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                .onTapGesture { openMedia(item, in: media) }
                .accessibilityAddTraits(.isButton)
                .accessibilityLabel(item.name)

            HStack(spacing: 2) {
                VStack(alignment: .leading, spacing: 1) {
                    Text(item.name).font(NXFont.text(12, .semibold)).foregroundStyle(NX.foreground).lineLimit(1)
                    Text(Self.subtitle(item)).font(NXFont.text(10)).foregroundStyle(NX.mutedFg).lineLimit(1)
                }
                Spacer(minLength: 0)
                Menu { menuItems(item) } label: {
                    Image(systemName: "ellipsis")
                        .font(.system(size: 13))
                        .foregroundStyle(NX.mutedFg)
                        .frame(width: 32, height: 32)
                        .contentShape(Rectangle())
                }
            }
        }
        .contextMenu { menuItems(item) }
        return movable(card, item)
    }

    /// The actions of one item. The same list behind the "…" button and the long-press / right-click
    /// menu, so the two can never offer different things.
    @ViewBuilder private func menuItems(_ item: VaultItem) -> some View {
        if trash {
            // Restoring and deleting for good are the uploader's or BoD's (the server refuses anyone
            // else), so neither is offered to anyone else; the row shows a padlock instead of "…".
            if item.canModify {
                Button { Task { await restore(item) } } label: { Label(T("Restore"), systemImage: "arrow.uturn.backward") }
                Button(role: .destructive) { vaultAlert = .delete(item) } label: { Label(T("Delete forever"), systemImage: "trash") }
            }
        } else {
            // A LINK to the item, and a COPY of the file, are two different things to hand somebody:
            // they sit in separate groups and say which is which (owner, 9 Oct 2026).
            Section {
                Button { sheet = .shareLink(item) } label: { Label(T("Share link…"), systemImage: "link") }
            }
            if !item.isFolder {
                Section {
                    Button { open(item) } label: { Label(T("Open"), systemImage: "eye") }
                    Button { Task { await save(item) } } label: { Label(T("Send a copy…"), systemImage: "square.and.arrow.up") }
                }
            }
            if item.canModify && !item.isFolder {
                // New bytes under the same item: its links keep working and show the new version.
                Button { sheet = .replace(item) } label: { Label(T("Replace file…"), systemImage: "arrow.triangle.2.circlepath") }
            }
            if item.canModify {
                Button { renameText = item.name; vaultAlert = .rename(item) } label: { Label(T("Rename"), systemImage: "pencil") }
                Button { sheet = .move(item) } label: { Label(T("Move to…"), systemImage: "folder") }
            }
            if listing?.canManageAccess == true {
                Button { sheet = .access(item) } label: { Label(T("Access…"), systemImage: "lock.shield") }
            }
            if item.canModify {
                Button(role: .destructive) { vaultAlert = .delete(item) } label: { Label(T("Move to trash"), systemImage: "trash") }
            }
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

    // MARK: Drag and drop

    /// Whether a drop on the page itself means something: there is a folder on screen, and this
    /// person may add to it.
    private var pageAcceptsDrops: Bool {
        !trash && query.isEmpty && listing?.canWrite == true
    }

    private var currentFolderName: String {
        listing?.breadcrumb.last?.name ?? T("Vault")
    }

    /// An item someone may move can be picked up. The payload is its id behind a prefix
    /// (`VaultDrag`), the same light payload the project board drags.
    @ViewBuilder private func movable<V: View>(_ view: V, _ item: VaultItem) -> some View {
        if !trash && item.canModify {
            view.draggable(VaultDrag.payload(item)) { dragPreview(item) }
        } else {
            view
        }
    }

    /// A folder takes drops: an item dragged onto it moves in, files dragged onto it upload into it.
    @ViewBuilder private func dropTarget<V: View>(_ view: V, _ item: VaultItem) -> some View {
        if item.isFolder && !trash {
            view.onDrop(of: VaultDropReader.types, isTargeted: dropBinding(VaultDropKey.row(item.id), name: item.name)) { providers in
                accept(providers, into: item.id, name: item.name)
            }
        } else {
            view
        }
    }

    private func dragPreview(_ item: VaultItem) -> some View {
        Label(item.name, systemImage: Self.icon(for: item))
            .font(NXFont.text(13, .semibold)).foregroundStyle(NX.foreground)
            .lineLimit(1)
            .padding(.horizontal, 12).padding(.vertical, 8)
            .background(NX.card, in: Capsule())
    }

    private func dropBinding(_ key: String, name: String) -> Binding<Bool> {
        Binding(
            get: { dropKey == key },
            set: { over in
                if over { dropKey = key; dropName = name }
                else if dropKey == key { dropKey = nil }
            }
        )
    }

    /// Takes the drop at once and does the work afterwards: reading what was dropped is
    /// asynchronous, and the system only waits for the yes or no.
    private func accept(_ providers: [NSItemProvider], into folderId: String?, name: String) -> Bool {
        guard !trash, !providers.isEmpty else { return false }
        dropKey = nil
        Task { await receive(providers, into: folderId, name: name) }
        return true
    }

    private func receive(_ providers: [NSItemProvider], into folderId: String?, name: String) async {
        let got = await VaultDropReader.read(providers)
        for id in got.itemIds {
            // Onto itself, or back into the folder it is already in: nothing to do, and no request.
            if id == folderId { continue }
            if let here = listing?.items.first(where: { $0.id == id }), here.parentId == folderId { continue }
            await move(itemId: id, to: folderId, name: name)
        }
        if !got.files.isEmpty { enqueueUpload(got.files, into: folderId, temporary: true) }
        if got.folders > 0 {
            vaultAlert = .problem(title: T("Folders can't be dropped yet"),
                                  message: T("Open the folder on your device and drop the files inside it. To keep them together here, make a folder in the vault first."))
        } else if got.unreadable > 0 {
            vaultAlert = .problem(title: T("Couldn't read what was dropped"),
                                  message: T("Try the file again, or use Upload file in the menu."))
        }
    }

    // MARK: Sheets and alerts

    @ViewBuilder private func sheetContent(_ which: VaultSheet) -> some View {
        switch which {
        case .importer:
            DocumentPicker(types: [.item], multiple: true) { urls in
                enqueueUpload(urls, into: parentId, temporary: false)
            }
            .ignoresSafeArea()
        case .activity(let share):
            ActivityView(items: [share.url])
        case .shareLink(let item):
            NavigationStack { VaultShareSheet(item: item) { sheet = nil; Task { await load() } } }
        case .replace(let item):
            DocumentPicker(types: [.item], multiple: false) { urls in
                if let url = urls.first { enqueueReplace(item, with: url) }
            }
            .ignoresSafeArea()
        case .access(let item):
            NavigationStack {
                VaultAccessSheet(item: item) { saved in
                    sheet = nil
                    if saved { flash(T("Access saved")); Task { await load(quiet: true) } }
                }
            }
        case .move(let item):
            // Opens where the item is when browsing; search results come from anywhere, so those
            // start at the top.
            VaultMovePicker(item: item, trail: query.isEmpty ? (listing?.breadcrumb ?? []) : []) { moved, destination in
                sheet = nil
                flash(Self.movedNotice(moved, to: destination))
                Task { await load() }
            } onCancel: {
                sheet = nil
            }
        }
    }

    private var alertShown: Binding<Bool> {
        Binding(get: { vaultAlert != nil }, set: { if !$0 { vaultAlert = nil } })
    }

    private var alertTitle: String {
        switch vaultAlert {
        case .newFolder?: return T("New folder")
        case .rename?: return T("Rename")
        case .delete(let item)?: return "\(trash ? T("Delete forever") : T("Move to trash")) \"\(item.name)\"?"
        case .problem(let title, _)?: return title
        case nil: return ""
        }
    }

    @ViewBuilder private func alertActions(_ which: VaultAlert) -> some View {
        switch which {
        case .newFolder:
            TextField(T("Name"), text: $newFolderName)
            Button(T("Create")) { Task { await createFolder() } }
            Button(T("Cancel"), role: .cancel) {}
        case .rename(let item):
            TextField(T("Name"), text: $renameText)
            Button(T("Save")) { Task { await rename(item) } }
            Button(T("Cancel"), role: .cancel) {}
        case .delete(let item):
            // In the trash this is the irreversible one, and it says so rather than sharing a word
            // with the reversible one a screen earlier.
            Button(trash ? T("Delete forever") : T("Move to trash"), role: .destructive) {
                Task { await remove(item, purge: trash) }
            }
            Button(T("Cancel"), role: .cancel) {}
        case .problem:
            Button(T("OK"), role: .cancel) {}
        }
    }

    @ViewBuilder private func alertMessage(_ which: VaultAlert) -> some View {
        switch which {
        case .problem(_, let message): Text(message)
        default: EmptyView()
        }
    }

    // MARK: Actions

    private func load(quiet: Bool = false) async {
        if !quiet { problem = nil }
        do {
            listing = try await APIClient.shared.vaultList(
                parentId: trash ? nil : parentId,
                trash: trash,
                query: query.trimmingCharacters(in: .whitespaces)
            )
            problem = nil
        } catch APIError.unauthorized {
            auth.logout()
        } catch {
            // A background refresh that fails leaves what is on screen alone.
            if !quiet { problem = Self.message(error) }
        }
        loading = false
    }

    private func open(_ item: VaultItem) {
        guard !trash else { return }
        if item.isFolder {
            pushed = VaultCrumb(id: item.id, name: item.name)
        } else if VaultMedia.isMedia(item) {
            let media = (listing?.items ?? []).filter { VaultMedia.isMedia($0) }
            openMedia(item, in: media)
        } else {
            Task { await openFile(item) }
        }
    }

    private func openMedia(_ item: VaultItem, in media: [VaultItem]) {
        guard !trash else { return }
        let start = media.firstIndex(where: { $0.id == item.id }) ?? 0
        cover = .media(items: media.isEmpty ? [item] : media, start: start)
    }

    /// A PDF or a sound opens in the app's own viewer; anything else goes to the share sheet.
    private func openFile(_ item: VaultItem) async {
        guard let kind = AttachmentKind(mime: item.mimeType, name: item.name), kind == .pdf || kind == .audio else {
            await save(item)
            return
        }
        guard let file = await fetch(item) else { return }
        cover = .attachment(AttachmentPreview(id: item.id, name: item.name, kind: kind, source: file))
    }

    private func save(_ item: VaultItem) async {
        guard let file = await fetch(item) else { return }
        sheet = .activity(ShareItem(url: file))
    }

    private func fetch(_ item: VaultItem) async -> URL? {
        do { return try await APIClient.shared.vaultDownload(item: item, progress: fetchProgress) }
        catch APIError.unauthorized { auth.logout(); return nil }
        catch { await report(T("Couldn't open the file"), error); return nil }
    }

    private func enqueueUpload(_ urls: [URL], into folderId: String?, temporary: Bool) {
        guard !urls.isEmpty else { return }
        let before = uploadChain
        uploadChain = Task {
            await before?.value
            await upload(urls, into: folderId, temporary: temporary)
        }
    }

    /// `temporary`: the files are copies this screen made of a drop, and go once they are sent.
    private func upload(_ urls: [URL], into folderId: String?, temporary: Bool) async {
        busy = true
        defer { busy = false }
        var failures: [String] = []
        for url in urls {
            let scoped = url.startAccessingSecurityScopedResource()
            defer {
                if scoped { url.stopAccessingSecurityScopedResource() }
                if temporary { try? FileManager.default.removeItem(at: url.deletingLastPathComponent()) }
            }
            do {
                try await APIClient.shared.vaultUpload(file: url, fileName: url.lastPathComponent,
                                                       parentId: folderId, progress: uploadProgress)
            } catch APIError.unauthorized {
                auth.logout()
                return
            } catch {
                failures.append("\(url.lastPathComponent): \(Self.message(error))")
            }
        }
        if !failures.isEmpty {
            try? await Task.sleep(for: .milliseconds(350))
            vaultAlert = .problem(title: failures.count == urls.count ? T("Upload failed") : T("Some files didn't upload"),
                                  message: failures.joined(separator: "\n"))
        }
        await load(quiet: true)
    }

    /// A crumb of the path, or a folder further up: this screen drops what is pushed above it when the
    /// target is its own folder, otherwise asks the screen below. The first screen, asked for a folder
    /// that is not on the stack (a search result opened deep in the tree), shows it on top of itself.
    private func go(to target: VaultCrumb?) {
        if target?.id == folder?.id { pushed = nil; return }
        if let popTo { popTo(target); return }
        pushed = target
    }

    /// Pictures and films from Photos, copied out of the library and uploaded like dropped files.
    private func absorbPhotos(_ items: [PhotosPickerItem], into folderId: String?) async {
        var files: [URL] = []
        var lost = 0
        for item in items {
            if let picked = try? await item.loadTransferable(type: VaultPickedFile.self) {
                files.append(picked.url)
            } else {
                // Still in iCloud, or nothing the library could hand over. Counted, not dropped silently.
                lost += 1
            }
        }
        if !files.isEmpty { enqueueUpload(files, into: folderId, temporary: true) }
        if lost > 0 {
            // A beat after the picker's own dismissal, or the alert asked for in that moment never shows.
            try? await Task.sleep(for: .milliseconds(350))
            vaultAlert = .problem(title: T("Some photos didn't come through"),
                                  message: lost == 1 ? T("1 item couldn't be read from Photos.")
                                      : String(format: T("%d items couldn't be read from Photos."), lost))
        }
    }

    /// Replace file…: queued behind any upload in flight, like every other transfer on this screen.
    private func enqueueReplace(_ item: VaultItem, with url: URL) {
        let before = uploadChain
        uploadChain = Task {
            await before?.value
            await replace(item, with: url)
        }
    }

    private func replace(_ item: VaultItem, with url: URL) async {
        busy = true
        defer { busy = false }
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        do {
            try await APIClient.shared.vaultReplace(itemId: item.id, file: url, fileName: url.lastPathComponent,
                                                    progress: uploadProgress)
            flash(String(format: T("“%@” replaced — its links show the new version"), item.name))
        } catch APIError.unauthorized {
            auth.logout()
            return
        } catch {
            await report(String(format: T("Couldn't replace %@"), item.name), error)
        }
        await load(quiet: true)
    }

    private func move(itemId: String, to folderId: String?, name: String) async {
        do {
            let moved = try await APIClient.shared.vaultMove(itemId, to: folderId)
            flash(Self.movedNotice(moved, to: name))
        } catch APIError.unauthorized {
            auth.logout()
            return
        } catch {
            // The server's reason, as it gave it: into its own subfolder, no write access there…
            await report(T("Couldn't move it"), error)
        }
        await load(quiet: true)
    }

    private func createFolder() async {
        let name = newFolderName.trimmingCharacters(in: .whitespaces)
        guard !name.isEmpty else { return }
        do { try await APIClient.shared.vaultCreateFolder(name: name, parentId: parentId) }
        catch APIError.unauthorized { auth.logout(); return }
        catch { await report(T("Couldn't create the folder"), error) }
        await load(quiet: true)
    }

    private func rename(_ item: VaultItem) async {
        let name = renameText.trimmingCharacters(in: .whitespaces)
        guard !name.isEmpty, name != item.name else { return }
        do { try await APIClient.shared.vaultRename(item.id, to: name) }
        catch APIError.unauthorized { auth.logout(); return }
        catch { await report(T("Couldn't rename it"), error) }
        await load(quiet: true)
    }

    private func remove(_ item: VaultItem, purge: Bool) async {
        do { try await APIClient.shared.vaultDelete(item.id, purge: purge) }
        catch APIError.unauthorized { auth.logout(); return }
        catch { await report(T("Couldn't delete it"), error) }
        await load(quiet: true)
    }

    private func restore(_ item: VaultItem) async {
        do { try await APIClient.shared.vaultRestore(item.id) }
        catch APIError.unauthorized { auth.logout(); return }
        catch { await report(T("Couldn't restore it"), error) }
        await load(quiet: true)
    }

    private func emptyTrash() async {
        busy = true
        defer { busy = false }
        do { _ = try await APIClient.shared.vaultEmptyTrash() }
        catch APIError.unauthorized { auth.logout(); return }
        catch { await report(T("Couldn't empty the trash"), error) }
        await load(quiet: true)
    }

    /// A failure in the screen's one alert. A beat after the failure itself: when it follows an
    /// alert's own button (Save, Move to trash) that alert is still closing, and a second one asked
    /// for in that moment never appears.
    private func report(_ title: String, _ error: Error) async {
        try? await Task.sleep(for: .milliseconds(350))
        vaultAlert = .problem(title: title, message: Self.message(error))
    }

    private func flash(_ text: String) {
        noticeTask?.cancel()
        notice = text
        noticeTask = Task {
            try? await Task.sleep(for: .seconds(2.6))
            guard !Task.isCancelled else { return }
            notice = nil
        }
    }

    // MARK: Small helpers

    private static func message(_ error: Error) -> String {
        (error as? LocalizedError)?.errorDescription ?? T("Something went wrong.")
    }

    /// "“INTOO” moved to Vault". The name is the one the server answered with: when the destination
    /// already had an INTOO it is "INTOO (2)" now, and this is where the person learns that.
    static func movedNotice(_ moved: VaultItem, to destination: String) -> String {
        String(format: T("“%@” moved to %@"), moved.name, destination)
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

    static func icon(for item: VaultItem) -> String {
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

/// The one sheet `VaultView` can show.
private enum VaultSheet: Identifiable {
    case importer
    case activity(ShareItem)
    case shareLink(VaultItem)
    case move(VaultItem)
    case access(VaultItem)
    case replace(VaultItem)

    var id: String {
        switch self {
        case .importer: return "importer"
        case .activity(let share): return "activity-\(share.id.uuidString)"
        case .shareLink(let item): return "link-\(item.id)"
        case .move(let item): return "move-\(item.id)"
        case .access(let item): return "access-\(item.id)"
        case .replace(let item): return "replace-\(item.id)"
        }
    }
}

/// The one alert `VaultView` can show. Centred alerts only, never a confirmationDialog (owner,
/// 29 Sep 2026 — 173ffff).
private enum VaultAlert {
    case newFolder
    case rename(VaultItem)
    case delete(VaultItem)
    case problem(title: String, message: String)
}

/// The one full-screen cover `VaultView` can show.
private enum VaultCover: Identifiable {
    case media(items: [VaultItem], start: Int)
    case attachment(AttachmentPreview)

    var id: String {
        switch self {
        case .media(let items, let start): return "media-\(items.indices.contains(start) ? items[start].id : "")"
        case .attachment(let preview): return "file-\(preview.id)"
        }
    }
}

/// Which drop target a drag is over: a folder row, or a crumb of the path ("" = the top level).
private enum VaultDropKey {
    static func row(_ id: String) -> String { "row:\(id)" }
    static func crumb(_ id: String?) -> String { "crumb:\(id ?? "")" }
}

/// A picture's thumbnail, or a film's tile, filling a square. Pictures that are usually artwork on
/// a transparent background (PNG, GIF, WebP — the LOGO folder) are shown whole on a soft
/// background; photographs fill the square, the way the Photos app shows them.
struct VaultThumbnail: View {
    let item: VaultItem

    var body: some View {
        ZStack {
            NX.muted
            if let thumb = VaultMedia.thumbURL(item, width: 320) {
                CachedImage(url: thumb) { image in
                    if VaultMedia.fillsTile(item) {
                        image.resizable().scaledToFill()
                    } else {
                        image.resizable().scaledToFit().padding(10)
                    }
                } placeholder: {
                    glyph
                }
            } else {
                glyph
            }
            if VaultMedia.isVideo(item) {
                Image(systemName: "play.fill")
                    .font(.system(size: 14, weight: .bold)).foregroundStyle(Color.white)
                    .frame(width: 34, height: 34)
                    .background(Color.black.opacity(0.45), in: Circle())
            }
        }
    }

    private var glyph: some View {
        Image(systemName: VaultView.icon(for: item))
            .font(.system(size: 26)).foregroundStyle(NX.mutedFg)
    }
}

/// What makes a vault item a picture or a film, and the addresses of its bytes and thumbnail.
enum VaultMedia {
    static func kind(_ item: VaultItem) -> AttachmentKind? {
        item.isFolder ? nil : AttachmentKind(mime: item.mimeType, name: item.name)
    }

    static func isMedia(_ item: VaultItem) -> Bool {
        let k = kind(item)
        return k == .image || k == .video
    }

    static func isVideo(_ item: VaultItem) -> Bool { kind(item) == .video }

    static func absolute(_ raw: String?) -> URL? {
        guard let raw, !raw.isEmpty else { return nil }
        return URL(string: raw.hasPrefix("http") ? raw : Config.baseURL.absoluteString + raw)
    }

    static func rawURL(_ item: VaultItem) -> URL? { absolute(item.url) }

    /// The server's small copy at about `width` pixels. nil for anything without one (a film, a
    /// HEIC photo, an older server): the caller draws the type's glyph instead.
    static func thumbURL(_ item: VaultItem, width: Int) -> URL? {
        guard let thumb = item.thumbUrl, !thumb.isEmpty else { return nil }
        return absolute(thumb + (thumb.contains("?") ? "&" : "?") + "w=\(width)")
    }

    /// Photographs fill their square; formats that usually carry transparency are shown whole.
    static func fillsTile(_ item: VaultItem) -> Bool {
        let ext = (item.name as NSString).pathExtension.lowercased()
        let mime = (item.mimeType ?? "").lowercased()
        if ["png", "gif", "webp", "svg"].contains(ext) || mime == "image/png" || mime == "image/gif" || mime == "image/webp" {
            return false
        }
        return true
    }
}

/// What a dragged vault item carries: its id behind a prefix nobody types by accident, so a drop can
/// tell an item being moved apart from text or a file being brought in.
enum VaultDrag {
    static let prefix = "nexus-vault-item:"
    static func payload(_ item: VaultItem) -> String { prefix + item.id }
    static func itemId(_ text: String) -> String? {
        text.hasPrefix(prefix) ? String(text.dropFirst(prefix.count)) : nil
    }
}

/// What a drop held, once read.
struct VaultDropContents {
    var itemIds: [String] = []
    /// Copies in this app's temporary folder, one folder per file, removed after the upload.
    var files: [URL] = []
    var folders = 0
    var unreadable = 0
}

/// Reads a drop: vault items being moved, and files coming in from Files, Finder or another app.
///
/// NSItemProvider rather than a typed `dropDestination`: one drop target has to take both an item id
/// (text) and any kind of file, and a text FILE dropped from Files must still upload as a file.
/// The system's copy of a dropped file is deleted when its callback returns, so it is copied out
/// inside the callback.
enum VaultDropReader {
    static let types: [UTType] = [.item]

    static func read(_ providers: [NSItemProvider]) async -> VaultDropContents {
        var out = VaultDropContents()
        for provider in providers {
            if provider.canLoadObject(ofClass: NSString.self),
               let text = await loadText(provider), let id = VaultDrag.itemId(text) {
                out.itemIds.append(id)
                continue
            }
            if isFolder(provider) {
                out.folders += 1
                continue
            }
            switch await loadFile(provider) {
            case .file(let url): out.files.append(url)
            case .folder: out.folders += 1
            case .nothing: out.unreadable += 1
            }
        }
        return out
    }

    private enum Loaded { case file(URL), folder, nothing }

    private static func loadText(_ provider: NSItemProvider) async -> String? {
        await withCheckedContinuation { done in
            _ = provider.loadObject(ofClass: NSString.self) { object, _ in
                done.resume(returning: (object as? NSString).map { String($0) })
            }
        }
    }

    private static func isFolder(_ provider: NSItemProvider) -> Bool {
        provider.registeredTypeIdentifiers.contains { id in
            guard let type = UTType(id) else { return false }
            return (type.conforms(to: .folder) || type.conforms(to: .directory)) && !type.conforms(to: .package)
        }
    }

    private static func loadFile(_ provider: NSItemProvider) async -> Loaded {
        // The richest representation that is the file's content — not its URL, not a text form of it.
        let content = provider.registeredTypeIdentifiers.first { id in
            guard let type = UTType(id) else { return false }
            return !type.conforms(to: .url) && (type.conforms(to: .data) || type.conforms(to: .package))
        }
        if let content {
            return await withCheckedContinuation { done in
                _ = provider.loadFileRepresentation(forTypeIdentifier: content) { url, _ in
                    guard let url, let copy = Self.stash(url, suggested: provider.suggestedName, type: content) else {
                        done.resume(returning: .nothing)
                        return
                    }
                    done.resume(returning: .file(copy))
                }
            }
        }
        // Finder on the Mac can offer nothing but the file's URL.
        guard provider.hasItemConformingToTypeIdentifier(UTType.fileURL.identifier) else { return .nothing }
        return await withCheckedContinuation { done in
            _ = provider.loadObject(ofClass: URL.self) { url, _ in
                guard let url, url.isFileURL else { done.resume(returning: .nothing); return }
                let scoped = url.startAccessingSecurityScopedResource()
                defer { if scoped { url.stopAccessingSecurityScopedResource() } }
                var isDirectory: ObjCBool = false
                if FileManager.default.fileExists(atPath: url.path, isDirectory: &isDirectory), isDirectory.boolValue {
                    done.resume(returning: .folder)
                    return
                }
                done.resume(returning: Self.stash(url, suggested: nil, type: nil).map { Loaded.file($0) } ?? Loaded.nothing)
            }
        }
    }

    /// Copy a dropped file into `tmp/vault-drops/<uuid>/<name>`, keeping its real name (which the
    /// vault stores) and adding the type's extension when the suggested name has none.
    private static func stash(_ url: URL, suggested: String?, type: String?) -> URL? {
        var name = (suggested?.isEmpty == false ? suggested! : url.lastPathComponent)
            .replacingOccurrences(of: "/", with: "-")
        if (name as NSString).pathExtension.isEmpty {
            let ext = url.pathExtension.isEmpty ? (type.flatMap { UTType($0)?.preferredFilenameExtension } ?? "") : url.pathExtension
            if !ext.isEmpty { name += "." + ext }
        }
        let folder = FileManager.default.temporaryDirectory
            .appendingPathComponent("vault-drops", isDirectory: true)
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        do {
            try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
            let destination = folder.appendingPathComponent(name)
            try FileManager.default.copyItem(at: url, to: destination)
            return destination
        } catch {
            return nil
        }
    }
}

/// A picture or film from the photo library, as a file this app owns. The library hands over a
/// temporary copy that is gone once the import closure returns, so it is copied out inside it — the
/// same rule `VaultDropReader` follows for drops. The picture is asked for first, so a Live Photo
/// arrives as its still; a film has no picture representation and arrives as the film.
struct VaultPickedFile: Transferable {
    let url: URL

    static var transferRepresentation: some TransferRepresentation {
        FileRepresentation(importedContentType: .image) { received in
            Self(url: try stash(received.file))
        }
        FileRepresentation(importedContentType: .movie) { received in
            Self(url: try stash(received.file))
        }
    }

    /// `tmp/vault-drops/<uuid>/<name>`, removed after the upload (`temporary: true`). The library's own
    /// file names are sometimes internal ("version=1&uuid=…"); those become "Photo <date>.<ext>".
    private static func stash(_ file: URL) throws -> URL {
        let ext = file.pathExtension.lowercased()
        var name = file.lastPathComponent.replacingOccurrences(of: "/", with: "-")
        if name.contains("=") || name.count > 80 || ext.isEmpty {
            let f = DateFormatter()
            f.locale = Locale(identifier: "en_US_POSIX")
            f.dateFormat = "yyyy-MM-dd HH.mm.ss"
            name = "Photo \(f.string(from: Date()))" + (ext.isEmpty ? "" : ".\(ext)")
        }
        let folder = FileManager.default.temporaryDirectory
            .appendingPathComponent("vault-drops", isDirectory: true)
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let destination = folder.appendingPathComponent(name)
        try FileManager.default.copyItem(at: file, to: destination)
        return destination
    }
}
