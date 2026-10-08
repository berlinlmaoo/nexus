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
// onto a folder or a crumb of the path. Files dragged in from Files, Finder or Photos upload into
// the folder they are dropped on, or into the one on screen.
//
// Uploads belong to the app, not to this screen (VaultUploads): the panel that shows them is an
// overlay on RootView, they keep going when the person leaves the vault, and nothing about them is
// drawn inside this scroll view any more — a bar appearing above the list pushed everything down.
//
// Several at once (owner, 9 Oct 2026): Select in the toolbar puts checkmarks on every item; the
// bottom bar moves, shares, saves to Files or trashes the selection. With a keyboard (iPad, Mac),
// ⌘-click adds or removes one item and ⇧-click a range, as in Finder. A long press or a right-click
// on any item opens the same actions as its "…" button — on the whole selection when the item is
// part of one.
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
    @Environment(\.horizontalSizeClass) private var hSize

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

    /// A file coming down to be opened, shared or saved. Drawn in the capsule at the bottom, never
    /// inside the list: a row that appears above the folder moves everything under it.
    @State private var fetchProgress = UploadProgress()
    /// "Downloading 2 of 5…" while several files come down for Share or Save to Files.
    @State private var fetchLabel: String?
    @State private var busy = false
    /// The app's upload queue; read here only to keep the bottom capsule clear of its pill.
    @State private var uploads = VaultUploads.shared

    @State private var sheet: VaultSheet?
    @State private var vaultAlert: VaultAlert?
    @State private var cover: VaultCover?
    @State private var renameText = ""
    @State private var newFolderName = ""

    /// Multi-select: on, which items, and where the last plain or ⌘-click was (the start of a ⇧-click range).
    @State private var selecting = false
    @State private var selection: Set<String> = []
    @State private var anchor: String?

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
        page
            .background { NX.background.ignoresSafeArea() }
            .navigationTitle(selecting ? selectionTitle : (folder?.name ?? T("Z Vault")))
            .navigationBarTitleDisplayMode(.inline)
            .navigationBarBackButtonHidden(selecting)
            // Always shown, from the first frame. With the default placement the field was laid over
            // the quota line for a few seconds after a folder opened and then jumped into its place
            // (owner, 9 Oct 2026): the bar was deciding whether to show it while the screen's scroll
            // view did not exist yet. Now the field's height is part of the bar from the start, and
            // the scroll view below is there from the start too (`page`).
            .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always), prompt: T("Search files…"))
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
                let name = currentFolderName
                pickedPhotos = []
                Task { await absorbPhotos(items, into: target, name: name) }
            }
            .toolbar { toolbarContent }
            // The bottom bar takes the tab bar's place while selecting, as in Photos and Files.
            .toolbar(selecting ? .hidden : .automatic, for: .tabBar)
            .task { await load() }
            // A colleague's upload, move, rename or delete shows up without a pull to refresh. The
            // server's "vault" ping carries no data; this refetches the folder on screen through the
            // API. VaultUploads posts the same notification when one of this person's files lands.
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
            .overlay(alignment: .bottom) { bottomCapsules }
            .animation(.easeOut(duration: 0.2), value: notice)
    }

    // MARK: Content

    /// The scroll view exists from the first frame, whatever is in it — a spinner, a refusal or the
    /// folder. The navigation bar (and its search field) attaches to it once, instead of re-laying
    /// itself out when a spinner is swapped for a list.
    private var page: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                if loading && listing == nil {
                    ProgressView().tint(NX.violetText)
                        .frame(maxWidth: .infinity, minHeight: 260)
                } else if let problem, listing == nil {
                    empty(icon: "externaldrive.badge.xmark", title: T("Vault unavailable"), msg: problem)
                        .frame(minHeight: 260)
                } else {
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
            }
            .padding(.vertical, 14)
        }
        .refreshable { await load() }
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

    /// The toolbar in its two modes. Two separate `if`s rather than an if/else: a plain `if` is what
    /// the toolbar builder is proven to take in this app (CalendarParts).
    @ToolbarContentBuilder private var toolbarContent: some ToolbarContent {
        if selecting {
            ToolbarItem(placement: .topBarLeading) {
                Button(allSelected ? T("Deselect All") : T("Select All")) { toggleAll() }
            }
            ToolbarItem(placement: .topBarTrailing) {
                Button(T("Done")) { endSelecting() }
                    .fontWeight(.semibold)
            }
            ToolbarItemGroup(placement: .bottomBar) { selectionBar }
        }
        if !selecting {
            if canSelect {
                ToolbarItem(placement: .topBarTrailing) {
                    Button(T("Select")) { startSelecting() }
                }
            }
            ToolbarItem(placement: .topBarTrailing) { addMenu }
        }
    }

    private var addMenu: some View {
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
            Button { trash.toggle(); endSelecting(); Task { await load() } } label: {
                Label(trash ? T("Back to files") : T("Trash"), systemImage: "trash")
            }
        } label: { Image(systemName: "ellipsis.circle") }
    }

    /// The bottom bar while selecting. Share and Save act on files: a folder has no bytes to hand to
    /// another app, and the bar says so when only folders are chosen by greying those two out.
    @ViewBuilder private var selectionBar: some View {
        Button { moveSelection() } label: { Label(T("Move to…"), systemImage: "folder") }
            .disabled(!canModifySelection)
            .accessibilityLabel(T("Move to…"))
        Spacer()
        Button { Task { await shareSelection() } } label: { Label(T("Share"), systemImage: "square.and.arrow.up") }
            .disabled(selectedFiles.isEmpty || fetchLabel != nil)
            .accessibilityLabel(T("Share"))
        Spacer()
        Button { Task { await saveSelection() } } label: { Label(T("Save to Files"), systemImage: "square.and.arrow.down") }
            .disabled(selectedFiles.isEmpty || fetchLabel != nil)
            .accessibilityLabel(T("Save to Files"))
        Spacer()
        Button(role: .destructive) { vaultAlert = .trashSelection(selectedItems) } label: {
            Label(T("Move to trash"), systemImage: "trash")
        }
        .disabled(!canModifySelection)
        .accessibilityLabel(T("Move to trash"))
    }

    /// The download capsule and the short notices, at the bottom of the screen and clear of the
    /// upload panel's pill (bottom-right on a phone).
    private var bottomCapsules: some View {
        VStack(spacing: 8) {
            if fetchProgress.isActive || fetchLabel != nil {
                HStack(spacing: 10) {
                    Text(fetchLabel ?? T("Downloading…"))
                        .font(NXFont.text(12, .semibold)).foregroundStyle(NX.foreground)
                        .lineLimit(1)
                    UploadProgressBar(progress: fetchProgress).frame(width: 120)
                }
                .padding(.horizontal, 16).padding(.vertical, 10)
                .background(.regularMaterial, in: Capsule())
                .transition(.opacity)
            }
            if let notice {
                Text(notice)
                    .font(NXFont.text(13, .semibold)).foregroundStyle(NX.foreground)
                    .lineLimit(2).multilineTextAlignment(.center)
                    .padding(.horizontal, 16).padding(.vertical, 10)
                    .background(.regularMaterial, in: Capsule())
                    .transition(.move(edge: .bottom).combined(with: .opacity))
            }
        }
        .padding(.horizontal, 24)
        .padding(.bottom, uploadPillShown ? 72 : 18)
        .allowsHitTesting(false)
    }

    private var uploadPillShown: Bool {
        hSize != .regular && !uploads.items.isEmpty && !uploads.expanded
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

    /// The items in the order they are on screen (folders, pictures and films, other files) — what
    /// Select All and a ⇧-click range count through.
    private var orderedItems: [VaultItem] {
        let items = listing?.items ?? []
        if trash { return items }
        return items.filter(\.isFolder)
            + items.filter { VaultMedia.isMedia($0) }
            + items.filter { !$0.isFolder && !VaultMedia.isMedia($0) }
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
            .disabled(selecting)
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
        let chosen = selecting && selection.contains(item.id)
        let base = HStack(spacing: 12) {
            if selecting { selectionMark(chosen) }
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
            // Not while selecting: a tap anywhere on the row chooses it then.
            if !trash && !selecting {
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

            if selecting {
                Color.clear.frame(width: 4, height: 44)
            } else if trash && !item.canModify {
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
        .background(targeted || chosen ? NX.accentBg : NX.card, in: RoundedRectangle(cornerRadius: 12))
        .overlay {
            RoundedRectangle(cornerRadius: 12)
                .strokeBorder(targeted ? NX.violet : chosen ? NX.violet.opacity(0.55) : Color.clear,
                              lineWidth: targeted ? 2 : 1.5)
        }
        .contentShape(Rectangle())
        .onTapGesture { tapped(item) }
        // Attached after the plain tap so it outranks it — only when ⌘ or ⇧ is held.
        .modifierClicks(enabled: Self.hasKeyboardClicks && !trash,
                        command: { commandClick(item) }, shift: { shiftClick(item) })
        .accessibilityAddTraits(chosen ? AccessibilityTraits([.isButton, .isSelected]) : AccessibilityTraits.isButton)
        .contextMenu { contextItems(item) }
        return movable(dropTarget(base, item), item)
    }

    private func rowIcon(_ item: VaultItem) -> some View {
        Image(systemName: Self.icon(for: item))
            .font(.system(size: 18))
            .foregroundStyle(item.isFolder ? NX.violetText : NX.mutedFg)
            .frame(width: 26)
    }

    /// The round checkmark of a row while selecting.
    private func selectionMark(_ on: Bool) -> some View {
        Image(systemName: on ? "checkmark.circle.fill" : "circle")
            .font(.system(size: 20, weight: .medium))
            .foregroundStyle(on ? NX.violetText : NX.mutedFg)
            .accessibilityHidden(true)
    }

    /// A picture or a film: its thumbnail as a square tile, the name and the menu underneath.
    private func tile(_ item: VaultItem, in media: [VaultItem]) -> some View {
        let chosen = selecting && selection.contains(item.id)
        let card = VStack(alignment: .leading, spacing: 4) {
            Color.clear
                .aspectRatio(1, contentMode: .fit)
                .overlay { VaultThumbnail(item: item) }
                .overlay(alignment: .topTrailing) {
                    if selecting {
                        Image(systemName: chosen ? "checkmark.circle.fill" : "circle")
                            .font(.system(size: 22, weight: .semibold))
                            .foregroundStyle(chosen ? NX.violet : Color.white)
                            .background(Circle().fill(chosen ? Color.white : Color.black.opacity(0.25)))
                            .shadow(color: .black.opacity(0.25), radius: 2)
                            .padding(7)
                            .accessibilityHidden(true)
                    }
                }
                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                .overlay {
                    if chosen {
                        RoundedRectangle(cornerRadius: 12, style: .continuous)
                            .strokeBorder(NX.violet, lineWidth: 3)
                    }
                }
                .contentShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                .onTapGesture {
                    if selecting { toggle(item) } else { openMedia(item, in: media) }
                }
                .modifierClicks(enabled: Self.hasKeyboardClicks,
                                command: { commandClick(item) }, shift: { shiftClick(item) })
                .accessibilityAddTraits(chosen ? AccessibilityTraits([.isButton, .isSelected]) : AccessibilityTraits.isButton)
                .accessibilityLabel(item.name)

            HStack(spacing: 2) {
                VStack(alignment: .leading, spacing: 1) {
                    Text(item.name).font(NXFont.text(12, .semibold)).foregroundStyle(NX.foreground).lineLimit(1)
                    Text(Self.subtitle(item)).font(NXFont.text(10)).foregroundStyle(NX.mutedFg).lineLimit(1)
                }
                Spacer(minLength: 0)
                if !selecting {
                    Menu { menuItems(item) } label: {
                        Image(systemName: "ellipsis")
                            .font(.system(size: 13))
                            .foregroundStyle(NX.mutedFg)
                            .frame(width: 32, height: 32)
                            .contentShape(Rectangle())
                    }
                }
            }
        }
        .contextMenu { contextItems(item) }
        return movable(card, item)
    }

    /// What a long press or a right-click offers: the item's own actions, or — on an item that is
    /// part of a selection of several — the selection's.
    @ViewBuilder private func contextItems(_ item: VaultItem) -> some View {
        if selecting && selection.contains(item.id) && selection.count > 1 {
            selectionMenuItems
        } else {
            menuItems(item)
        }
    }

    @ViewBuilder private var selectionMenuItems: some View {
        Section(String(format: T("%d selected"), selection.count)) {
            Button { moveSelection() } label: { Label(T("Move to…"), systemImage: "folder") }
                .disabled(!canModifySelection)
            Button { Task { await shareSelection() } } label: { Label(T("Share"), systemImage: "square.and.arrow.up") }
                .disabled(selectedFiles.isEmpty)
            Button { Task { await saveSelection() } } label: { Label(T("Save to Files"), systemImage: "square.and.arrow.down") }
                .disabled(selectedFiles.isEmpty)
        }
        Button(role: .destructive) { vaultAlert = .trashSelection(selectedItems) } label: {
            Label(T("Move to trash"), systemImage: "trash")
        }
        .disabled(!canModifySelection)
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
                Button { sheet = .move([item]) } label: { Label(T("Move to…"), systemImage: "folder") }
            }
            if listing?.canManageAccess == true {
                Button { sheet = .access(item) } label: { Label(T("Access…"), systemImage: "lock.shield") }
            }
            if canSelect && !selecting {
                Button { startSelecting(with: item) } label: { Label(T("Select"), systemImage: "checkmark.circle") }
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

    // MARK: Selecting

    /// A keyboard's ⌘- and ⇧-click are offered where there can be a keyboard and a pointer: iPad
    /// and Mac. On a phone the gestures are not attached at all.
    private static var hasKeyboardClicks: Bool {
        UIDevice.current.userInterfaceIdiom != .phone
    }

    private var canSelect: Bool { !trash && !(listing?.items.isEmpty ?? true) }
    private var selectedItems: [VaultItem] { orderedItems.filter { selection.contains($0.id) } }
    private var selectedFiles: [VaultItem] { selectedItems.filter { !$0.isFolder } }
    /// At least one chosen item this person may move or trash. The rest are sent too and the server
    /// refuses them with its reason, which the result then names.
    private var canModifySelection: Bool { selectedItems.contains(where: \.canModify) }
    private var allSelected: Bool { !orderedItems.isEmpty && selection.count == orderedItems.count }
    private var selectionTitle: String {
        selection.isEmpty ? T("Select items") : String(format: T("%d selected"), selection.count)
    }

    private func startSelecting(with item: VaultItem? = nil) {
        selection = item.map { [$0.id] } ?? []
        anchor = item?.id
        selecting = true
    }

    private func endSelecting() {
        selecting = false
        selection = []
        anchor = nil
    }

    private func toggleAll() {
        selection = allSelected ? [] : Set(orderedItems.map(\.id))
    }

    private func tapped(_ item: VaultItem) {
        if selecting { toggle(item) } else { open(item) }
    }

    private func toggle(_ item: VaultItem) {
        if selection.contains(item.id) { selection.remove(item.id) } else { selection.insert(item.id) }
        anchor = item.id
    }

    /// ⌘-click: one item in or out of the selection, starting it if there is none.
    private func commandClick(_ item: VaultItem) {
        guard canSelect else { return }
        if !selecting { startSelecting() }
        toggle(item)
    }

    /// ⇧-click: everything from the last item clicked to this one, in the order on screen. The
    /// anchor stays where it is, as in Finder, so a second ⇧-click measures from the same place.
    private func shiftClick(_ item: VaultItem) {
        guard canSelect else { return }
        if !selecting { startSelecting() }
        let order = orderedItems.map(\.id)
        guard let to = order.firstIndex(of: item.id) else { return }
        let from = anchor.flatMap { order.firstIndex(of: $0) } ?? to
        for id in order[min(from, to)...max(from, to)] { selection.insert(id) }
        if anchor == nil { anchor = item.id }
    }

    private func moveSelection() {
        guard canModifySelection else { return }
        sheet = .move(selectedItems)
    }

    private func shareSelection() async {
        guard let urls = await fetchSelection() else { return }
        sheet = .shareFiles(VaultFiles(urls: urls))
    }

    private func saveSelection() async {
        guard let urls = await fetchSelection() else { return }
        sheet = .export(VaultFiles(urls: urls))
    }

    /// The chosen files on this device, one after another (from the cache when one is already here).
    /// Folders are left out — a folder has no bytes to hand over — and the notice says so. If any
    /// file fails, nothing is handed over and the alert names what failed: a share sheet with three
    /// of the five files reads as if all five went.
    private func fetchSelection() async -> [URL]? {
        let files = selectedFiles
        guard !files.isEmpty else { return nil }
        var urls: [URL] = []
        var failed: [String] = []
        for (index, file) in files.enumerated() {
            fetchLabel = files.count == 1 ? T("Downloading…")
                : String(format: T("Downloading %d of %d…"), index + 1, files.count)
            do {
                urls.append(try await APIClient.shared.vaultDownload(item: file, progress: fetchProgress))
            } catch APIError.unauthorized {
                fetchLabel = nil
                auth.logout()
                return nil
            } catch {
                failed.append("\(file.name) — \(Self.message(error))")
            }
        }
        fetchLabel = nil
        if !failed.isEmpty {
            vaultAlert = .problem(title: T("Some files couldn't be downloaded"),
                                  message: failed.joined(separator: "\n"))
            return nil
        }
        let folders = selectedItems.count - files.count
        if folders > 0 {
            flash(folders == 1 ? T("1 folder left out — open it to send what's inside.")
                  : String(format: T("%d folders left out — open them to send what's inside."), folders))
        }
        return urls
    }

    private func trashSelection(_ items: [VaultItem]) async {
        busy = true
        defer { busy = false }
        let result = await VaultBatch.run(items) { item in
            try await APIClient.shared.vaultDelete(item.id)
        }
        if result.failed.contains(where: \.signedOut) { auth.logout(); return }
        endSelecting()
        if result.failed.isEmpty {
            flash(items.count == 1 ? String(format: T("“%@” moved to the trash"), items[0].name)
                  : String(format: T("%d items moved to the trash"), items.count))
        } else {
            await reportBatch(title: T("Some items weren't moved to the trash"),
                              summary: String(format: T("%d of %d moved to the trash"), result.done.count, items.count),
                              failed: result.failed)
        }
        await load(quiet: true)
    }

    /// After "Move to…" (one item or several) or a drop of several items onto a folder.
    private func finishMove(_ outcome: VaultMoveOutcome, of total: Int) {
        if outcome.failed.contains(where: \.signedOut) { auth.logout(); return }
        if selecting { endSelecting() }
        if outcome.failed.isEmpty {
            if outcome.moved.count == 1 {
                flash(Self.movedNotice(outcome.moved[0], to: outcome.destination))
            } else if !outcome.moved.isEmpty {
                flash(String(format: T("%d items moved to %@"), outcome.moved.count, outcome.destination))
            }
        } else {
            Task {
                await reportBatch(title: T("Some items didn't move"),
                                  summary: String(format: T("%d of %d moved to %@"), outcome.moved.count, total, outcome.destination),
                                  failed: outcome.failed)
            }
        }
    }

    /// "2 of 3 moved to LOGO" and, under it, each one that did not with the server's reason.
    private func reportBatch(title: String, summary: String, failed: [VaultBatch.Failure]) async {
        var lines = failed.prefix(6).map { "\($0.name) — \($0.reason)" }
        if failed.count > 6 { lines.append(String(format: T("…and %d more"), failed.count - 6)) }
        try? await Task.sleep(for: .milliseconds(350))
        vaultAlert = .problem(title: title, message: summary + "\n\n" + lines.joined(separator: "\n"))
    }

    // MARK: Drag and drop

    /// Whether a drop on the page itself means something: there is a folder on screen, and this
    /// person may add to it.
    private var pageAcceptsDrops: Bool {
        !trash && query.isEmpty && listing?.canWrite == true
    }

    private var currentFolderName: String {
        listing?.breadcrumb.last?.name ?? folder?.name ?? T("Vault")
    }

    /// An item someone may move can be picked up. The payload is its id behind a prefix
    /// (`VaultDrag`), the same light payload the project board drags. Picking up one item of a
    /// selection moves the whole selection where it is dropped (`receive`).
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
        let count = selecting && selection.contains(item.id) ? selection.count : 1
        return Label(count > 1 ? String(format: T("%d items"), count) : item.name, systemImage: Self.icon(for: item))
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

        // Items being moved. One of a selection stands for the whole selection.
        var ids: [String] = []
        for id in got.itemIds {
            let group = selecting && selection.contains(id) ? selectedItems.map(\.id) : [id]
            for g in group where !ids.contains(g) { ids.append(g) }
        }
        ids = ids.filter { id in
            // Onto itself, or back into the folder it is already in: nothing to do, and no request.
            if id == folderId { return false }
            if let here = listing?.items.first(where: { $0.id == id }), here.parentId == folderId { return false }
            return true
        }
        if ids.count == 1 {
            await move(itemId: ids[0], to: folderId, name: name)
        } else if ids.count > 1 {
            let known = ids.compactMap { id in listing?.items.first(where: { $0.id == id }) }
            let target = folderId
            let result = await VaultBatch.run(known) { item in
                try await APIClient.shared.vaultMove(item.id, to: target)
            }
            finishMove(VaultMoveOutcome(moved: result.done, failed: result.failed, destination: name), of: known.count)
            await load(quiet: true)
        }

        // Files coming in: handed to the app's upload queue, which shows its own panel.
        if !got.files.isEmpty { uploads.add(got.files, into: folderId, named: name) }
        if got.folders > 0 {
            vaultAlert = .problem(title: T("Folders can't be dropped yet"),
                                  message: T("Open the folder on your device and drop the files inside it. To keep them together here, make a folder in the vault first."))
        } else if !got.unreadable.isEmpty {
            vaultAlert = .problem(title: T("Couldn't read what was dropped"),
                                  message: got.unreadable.map { String(format: T("%@: couldn't be copied from the app it came from."), $0) }
                                    .joined(separator: "\n") + "\n\n" + T("Try the file again, or use Upload file in the menu."))
        }
    }

    // MARK: Sheets and alerts

    @ViewBuilder private func sheetContent(_ which: VaultSheet) -> some View {
        switch which {
        case .importer:
            DocumentPicker(types: [.item], multiple: true) { urls in
                // The picker hands back private copies (`asCopy`), so they are this app's to delete
                // once they are up.
                uploads.add(urls.map { VaultIncomingFile(file: $0, name: $0.lastPathComponent, owned: $0) },
                            into: parentId, named: currentFolderName)
            }
            .ignoresSafeArea()
        case .activity(let share):
            ActivityView(items: [share.url])
        case .shareFiles(let files):
            ActivityView(items: files.urls)
        case .export(let files):
            VaultExporter(urls: files.urls) {
                flash(files.urls.count == 1 ? T("Saved to Files") : String(format: T("%d files saved to Files"), files.urls.count))
            }
            .ignoresSafeArea()
        case .shareLink(let item):
            NavigationStack { VaultShareSheet(item: item) { sheet = nil; Task { await load() } } }
        case .replace(let item):
            DocumentPicker(types: [.item], multiple: false) { urls in
                if let url = urls.first {
                    uploads.replace(item.id, itemName: item.name,
                                    with: VaultIncomingFile(file: url, name: url.lastPathComponent, owned: url))
                }
            }
            .ignoresSafeArea()
        case .access(let item):
            NavigationStack {
                VaultAccessSheet(item: item) { saved in
                    sheet = nil
                    if saved { flash(T("Access saved")); Task { await load(quiet: true) } }
                }
            }
        case .move(let items):
            // Opens where the items are when browsing; search results come from anywhere, so those
            // start at the top.
            VaultMovePicker(items: items, trail: query.isEmpty ? (listing?.breadcrumb ?? []) : []) { outcome in
                sheet = nil
                finishMove(outcome, of: items.count)
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
        case .trashSelection(let items)?:
            return items.count == 1 ? "\(T("Move to trash")) \"\(items[0].name)\"?"
                : String(format: T("Move %d items to the trash?"), items.count)
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
        case .trashSelection(let items):
            Button(T("Move to trash"), role: .destructive) {
                Task { await trashSelection(items) }
            }
            Button(T("Cancel"), role: .cancel) {}
        case .problem:
            Button(T("OK"), role: .cancel) {}
        }
    }

    @ViewBuilder private func alertMessage(_ which: VaultAlert) -> some View {
        switch which {
        case .problem(_, let message): Text(message)
        case .trashSelection: Text(T("You can restore them from the trash."))
        default: EmptyView()
        }
    }

    // MARK: Actions

    private func load(quiet: Bool = false) async {
        if !quiet { problem = nil }
        do {
            let fresh = try await APIClient.shared.vaultList(
                parentId: trash ? nil : parentId,
                trash: trash,
                query: query.trimmingCharacters(in: .whitespaces)
            )
            listing = fresh
            problem = nil
            // What left the folder (moved, trashed, by anyone) leaves the selection too.
            if !selection.isEmpty { selection.formIntersection(Set(fresh.items.map(\.id))) }
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

    /// A crumb of the path, or a folder further up: this screen drops what is pushed above it when the
    /// target is its own folder, otherwise asks the screen below. The first screen, asked for a folder
    /// that is not on the stack (a search result opened deep in the tree), shows it on top of itself.
    private func go(to target: VaultCrumb?) {
        if target?.id == folder?.id { pushed = nil; return }
        if let popTo { popTo(target); return }
        pushed = target
    }

    /// Pictures and films from Photos, copied out of the library and handed to the upload queue like
    /// dropped files.
    private func absorbPhotos(_ items: [PhotosPickerItem], into folderId: String?, name: String) async {
        var files: [VaultIncomingFile] = []
        var lost = 0
        for item in items {
            if let picked = try? await item.loadTransferable(type: VaultPickedFile.self) {
                files.append(VaultIncomingFile(file: picked.url, name: picked.url.lastPathComponent,
                                               owned: picked.url.deletingLastPathComponent()))
            } else {
                // Still in iCloud, or nothing the library could hand over. Counted, not dropped silently.
                lost += 1
            }
        }
        if !files.isEmpty { uploads.add(files, into: folderId, named: name) }
        if lost > 0 {
            // A beat after the picker's own dismissal, or the alert asked for in that moment never shows.
            try? await Task.sleep(for: .milliseconds(350))
            vaultAlert = .problem(title: T("Some photos didn't come through"),
                                  message: lost == 1 ? T("1 item couldn't be read from Photos.")
                                      : String(format: T("%d items couldn't be read from Photos."), lost))
        }
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
        // Search results come from anywhere in the vault: say where (server `path`, since 9 Oct 2026).
        if let path = item.path {
            parts.append(String(format: T("in %@"), ([T("Vault")] + path.map(\.name)).joined(separator: " › ")))
        } else if let uploader = item.uploader {
            parts.append(uploader.name)
        }
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

/// Several downloaded files handed to one sheet.
struct VaultFiles: Identifiable {
    let id = UUID()
    let urls: [URL]
}

/// The one sheet `VaultView` can show.
private enum VaultSheet: Identifiable {
    case importer
    case activity(ShareItem)
    case shareFiles(VaultFiles)
    case export(VaultFiles)
    case shareLink(VaultItem)
    case move([VaultItem])
    case access(VaultItem)
    case replace(VaultItem)

    var id: String {
        switch self {
        case .importer: return "importer"
        case .activity(let share): return "activity-\(share.id.uuidString)"
        case .shareFiles(let files): return "share-\(files.id.uuidString)"
        case .export(let files): return "export-\(files.id.uuidString)"
        case .shareLink(let item): return "link-\(item.id)"
        case .move(let items): return "move-" + items.map(\.id).joined(separator: ",")
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
    case trashSelection([VaultItem])
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

/// ⌘-click and ⇧-click on an item, for a keyboard and a pointer (iPad, Mac). Attached after the
/// item's plain tap as high-priority gestures: each only recognises with its key held, so a plain
/// click still reaches the tap underneath. Not attached at all where `enabled` is false.
private struct VaultModifierClicks: ViewModifier {
    let enabled: Bool
    let command: () -> Void
    let shift: () -> Void

    @ViewBuilder func body(content: Content) -> some View {
        if enabled {
            content
                .highPriorityGesture(TapGesture().modifiers(.command).onEnded { command() })
                .highPriorityGesture(TapGesture().modifiers(.shift).onEnded { shift() })
        } else {
            content
        }
    }
}

private extension View {
    func modifierClicks(enabled: Bool, command: @escaping () -> Void, shift: @escaping () -> Void) -> some View {
        modifier(VaultModifierClicks(enabled: enabled, command: command, shift: shift))
    }
}

/// "Save to Files" for files already on the device: the system's export picker, which copies them
/// where the person chooses.
private struct VaultExporter: UIViewControllerRepresentable {
    let urls: [URL]
    let onSaved: () -> Void
    @Environment(\.dismiss) private var dismiss

    func makeUIViewController(context: Context) -> UIDocumentPickerViewController {
        let vc = UIDocumentPickerViewController(forExporting: urls, asCopy: true)
        vc.delegate = context.coordinator
        return vc
    }

    func updateUIViewController(_ vc: UIDocumentPickerViewController, context: Context) {}

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    final class Coordinator: NSObject, UIDocumentPickerDelegate {
        let parent: VaultExporter
        init(_ parent: VaultExporter) { self.parent = parent }

        func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
            parent.onSaved()
            parent.dismiss()
        }

        func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
            parent.dismiss()
        }
    }
}

/// Several items at once (multi-select): the one-item requests the vault already has, at most three
/// in flight, each failure kept with the item's name and the server's reason. There is no bulk route
/// on the server and none is needed — every request is checked on its own merits there anyway.
enum VaultBatch {
    struct Failure: Sendable {
        let name: String
        let reason: String
        /// The session was gone (401): the caller signs out rather than listing it.
        let signedOut: Bool
    }

    static func run<T: Sendable>(_ items: [VaultItem], limit: Int = 3,
                                 _ work: @escaping @Sendable (VaultItem) async throws -> T) async -> (done: [T], failed: [Failure]) {
        var done: [T] = []
        var failed: [Failure] = []
        var start = 0
        while start < items.count {
            let slice = Array(items[start..<min(start + limit, items.count)])
            start += limit
            await withTaskGroup(of: (T?, Failure?).self) { group in
                for item in slice {
                    group.addTask {
                        do {
                            let value = try await work(item)
                            return (value, nil)
                        } catch {
                            var signedOut = false
                            if let api = error as? APIError, case .unauthorized = api { signedOut = true }
                            let reason = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
                            return (nil, Failure(name: item.name, reason: reason, signedOut: signedOut))
                        }
                    }
                }
                for await (value, failure) in group {
                    if let value { done.append(value) }
                    if let failure { failed.append(failure) }
                }
            }
        }
        return (done, failed)
    }
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
    /// Copies in this app's temporary folder (`tmp/vault-drops/<uuid>/<name>`), for the upload queue.
    var files: [VaultIncomingFile] = []
    var folders = 0
    /// The names of what could not be read, so the alert can say which.
    var unreadable: [String] = []
}

/// Reads a drop: vault items being moved, and files coming in from Files, Finder, Photos or another
/// app.
///
/// NSItemProvider rather than a typed `dropDestination`: one drop target has to take both an item id
/// (text) and any kind of file, and a text FILE dropped from Files must still upload as a file.
///
/// The system's copy of a dropped file is deleted when its callback returns (Photos hands over a
/// temporary export; Files may hand over a security-scoped URL), so the file is copied out INSIDE
/// the callback (`VaultDropFiles.stash`) and only the copy goes to the upload queue. A source that
/// only has bytes in memory is read with `loadDataRepresentation` instead. The choice of type and the
/// file's name are in VaultDropFiles.swift, where they are tested on Linux.
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
            case .file(let incoming): out.files.append(incoming)
            case .folder: out.folders += 1
            case .nothing(let label): out.unreadable.append(label)
            }
        }
        return out
    }

    private enum Loaded { case file(VaultIncomingFile), folder, nothing(String) }

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
        // Read before any callback: the callbacks run on a queue of the system's choosing.
        let suggested = provider.suggestedName
        let label = suggested ?? "?"
        if let type = VaultDropFiles.contentType(provider.registeredTypeIdentifiers, conforms: conforms) {
            let ext = UTType(type)?.preferredFilenameExtension
            let copied: URL? = await withCheckedContinuation { done in
                _ = provider.loadFileRepresentation(forTypeIdentifier: type) { url, _ in
                    // The file at `url` is gone once this closure returns: copy it now.
                    guard let url else { done.resume(returning: nil); return }
                    let name = VaultDropFiles.fileName(suggested: suggested, received: url.lastPathComponent, ext: ext)
                    done.resume(returning: try? VaultDropFiles.stash(url, as: name))
                }
            }
            if let copied { return .file(incoming(copied)) }
            // Some sources hold the content only in memory and hand over bytes, not a file.
            let written: URL? = await withCheckedContinuation { done in
                _ = provider.loadDataRepresentation(forTypeIdentifier: type) { data, _ in
                    guard let data, !data.isEmpty else { done.resume(returning: nil); return }
                    let name = VaultDropFiles.fileName(suggested: suggested, received: nil, ext: ext)
                    done.resume(returning: try? VaultDropFiles.stash(data, as: name))
                }
            }
            if let written { return .file(incoming(written)) }
            return .nothing(label)
        }
        // Finder on the Mac can offer nothing but the file's URL, which may be security-scoped.
        guard provider.hasItemConformingToTypeIdentifier(UTType.fileURL.identifier) else { return .nothing(label) }
        return await withCheckedContinuation { done in
            _ = provider.loadObject(ofClass: URL.self) { url, _ in
                guard let url, url.isFileURL else { done.resume(returning: .nothing(label)); return }
                let scoped = url.startAccessingSecurityScopedResource()
                defer { if scoped { url.stopAccessingSecurityScopedResource() } }
                var isDirectory: ObjCBool = false
                guard FileManager.default.fileExists(atPath: url.path, isDirectory: &isDirectory) else {
                    done.resume(returning: .nothing(url.lastPathComponent))
                    return
                }
                if isDirectory.boolValue {
                    done.resume(returning: .folder)
                    return
                }
                let name = VaultDropFiles.fileName(suggested: nil, received: url.lastPathComponent, ext: nil)
                if let copy = try? VaultDropFiles.stash(url, as: name) {
                    done.resume(returning: .file(incoming(copy)))
                } else {
                    done.resume(returning: .nothing(url.lastPathComponent))
                }
            }
        }
    }

    /// A copy in `tmp/vault-drops/<uuid>/`: the whole folder goes once the upload is over.
    private static func incoming(_ copy: URL) -> VaultIncomingFile {
        VaultIncomingFile(file: copy, name: copy.lastPathComponent, owned: copy.deletingLastPathComponent())
    }

    private static func conforms(_ id: String, _ parent: String) -> Bool {
        guard let type = UTType(id), let other = UTType(parent) else { return false }
        return type.conforms(to: other)
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

    /// `tmp/vault-drops/<uuid>/<name>`, removed after the upload. The library's own file names are
    /// sometimes internal ("version=1&uuid=…"); those become "IMG_<date>.<ext>" (VaultDropFiles).
    private static func stash(_ file: URL) throws -> URL {
        let name = VaultDropFiles.fileName(suggested: nil, received: file.lastPathComponent, ext: file.pathExtension)
        return try VaultDropFiles.stash(file, as: name)
    }
}
