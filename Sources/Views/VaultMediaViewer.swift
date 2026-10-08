import SwiftUI
import AVKit

// ─────────────────────────────────────────────────────────────────────────────
// The pictures and films of one vault folder, full screen (owner, 9 Oct 2026: "a viewer for
// pictures and videos").
//
// One page at a time, in one view, rather than a paging TabView with a zoomable picture inside it:
// a picture's pan and the TabView's own swipe fight over the same drag, and that fight can only be
// judged on a device. Here a single drag does one or the other — it pans a zoomed picture, and
// otherwise it is the swipe to the next or previous one. The arrows on the sides and the keyboard's
// arrow keys (iPad, Mac) do the same.
//
// A picture is drawn from the full file (`ImageLoader` fetches it with the session and downsamples
// it to page size), with the grid's thumbnail underneath while it arrives. A film has to be a file
// on disk first, like every attachment: AVPlayer cannot carry the session cookie.
// ─────────────────────────────────────────────────────────────────────────────

struct VaultMediaViewer: View {
    let items: [VaultItem]
    @State private var index: Int
    @Environment(\.dismiss) private var dismiss

    @State private var sheet: ViewerSheet?
    @State private var saving = UploadProgress()
    @State private var problem: String?

    // The zoom of the picture on screen. Back to fit on every page change.
    @State private var scale: CGFloat = 1
    @State private var committedScale: CGFloat = 1
    @State private var offset: CGSize = .zero
    @State private var committedOffset: CGSize = .zero
    /// How far an unzoomed picture follows the finger during a swipe.
    @State private var swipe: CGFloat = 0

    init(items: [VaultItem], startIndex: Int) {
        self.items = items
        _index = State(initialValue: min(max(0, startIndex), max(0, items.count - 1)))
    }

    private var current: VaultItem? { items.indices.contains(index) ? items[index] : nil }

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()
            if let item = current {
                page(item)
                    .id(item.id)
                    .transition(.opacity)
            }
        }
        .overlay(alignment: .top) { bar }
        .overlay { arrows }
        .overlay(alignment: .bottom) {
            if saving.isActive {
                UploadProgressBar(progress: saving)
                    .frame(maxWidth: 260)
                    .padding(.bottom, 24)
            }
        }
        .sheet(item: $sheet) { which in
            switch which {
            case .shareLink(let item):
                NavigationStack { VaultShareSheet(item: item) { sheet = nil } }
            case .activity(let share):
                ActivityView(items: [share.url])
            }
        }
        .alert(T("Couldn't open the file"), isPresented: Binding(get: { problem != nil }, set: { if !$0 { problem = nil } })) {
            Button(T("OK"), role: .cancel) {}
        } message: {
            Text(problem ?? "")
        }
        .onChange(of: index) { _, _ in resetZoom(animated: false) }
    }

    // MARK: Pages

    @ViewBuilder private func page(_ item: VaultItem) -> some View {
        if VaultMedia.isVideo(item) {
            VaultVideoPage(item: item)
                .padding(.top, 64)
        } else {
            picture(item)
        }
    }

    private func picture(_ item: VaultItem) -> some View {
        CachedImage(url: VaultMedia.rawURL(item), maxPixel: ImageLoader.pagePixel) { image in
            image.resizable().scaledToFit()
        } placeholder: {
            ZStack {
                if let thumb = VaultMedia.thumbURL(item, width: 640) {
                    CachedImage(url: thumb) { $0.resizable().scaledToFit() } placeholder: { Color.clear }
                }
                ProgressView().tint(Color.white)
            }
        }
        .scaleEffect(scale)
        .offset(x: offset.width + swipe, y: offset.height)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .contentShape(Rectangle())
        .gesture(drag)
        .simultaneousGesture(magnify)
        .onTapGesture(count: 2) { toggleZoom() }
        .accessibilityLabel(item.name)
    }

    // MARK: Chrome

    private var bar: some View {
        HStack(spacing: 10) {
            VStack(alignment: .leading, spacing: 1) {
                Text(current?.name ?? "")
                    .font(NXFont.text(13, .semibold)).foregroundStyle(Color.white).lineLimit(1)
                if items.count > 1 {
                    Text("\(index + 1) / \(items.count)")
                        .font(NXFont.text(11).monospacedDigit()).foregroundStyle(Color.white.opacity(0.7))
                }
            }
            Spacer(minLength: 0)
            chromeButton("link", label: T("Share link")) {
                if let item = current { sheet = .shareLink(item) }
            }
            chromeButton("square.and.arrow.down", label: T("Download")) {
                Task { await save() }
            }
            .disabled(saving.isActive)
            chromeButton("xmark", label: T("Close")) { dismiss() }
                .keyboardShortcut(.cancelAction)
        }
        .padding(.horizontal, 16).padding(.top, 10).padding(.bottom, 14)
        .background(
            LinearGradient(colors: [Color.black.opacity(0.65), Color.black.opacity(0)], startPoint: .top, endPoint: .bottom)
                .ignoresSafeArea(edges: .top)
        )
    }

    @ViewBuilder private var arrows: some View {
        if items.count > 1 {
            HStack {
                chromeButton("chevron.left", label: T("Previous")) { step(-1) }
                    .keyboardShortcut(.leftArrow, modifiers: [])
                    .disabled(index == 0)
                    .opacity(index == 0 ? 0.35 : 1)
                Spacer()
                chromeButton("chevron.right", label: T("Next")) { step(1) }
                    .keyboardShortcut(.rightArrow, modifiers: [])
                    .disabled(index >= items.count - 1)
                    .opacity(index >= items.count - 1 ? 0.35 : 1)
            }
            .padding(.horizontal, 12)
        }
    }

    private func chromeButton(_ symbol: String, label: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(.system(size: 14, weight: .bold)).foregroundStyle(Color.white)
                .frame(width: 36, height: 36)
                .background(Color.white.opacity(0.16), in: Circle())
                .contentShape(Circle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
    }

    // MARK: Gestures

    /// One drag, two meanings: a zoomed picture pans; an unzoomed one is a swipe to its neighbour.
    private var drag: some Gesture {
        DragGesture(minimumDistance: 12)
            .onChanged { value in
                if scale > 1 {
                    offset = CGSize(width: committedOffset.width + value.translation.width,
                                    height: committedOffset.height + value.translation.height)
                } else if items.count > 1 {
                    swipe = value.translation.width
                }
            }
            .onEnded { value in
                if scale > 1 {
                    committedOffset = offset
                    return
                }
                let moved = value.translation.width
                let flung = value.predictedEndTranslation.width
                withAnimation(.spring(response: 0.3, dampingFraction: 0.86)) {
                    swipe = 0
                    if moved < -60 || flung < -180 { step(1) }
                    else if moved > 60 || flung > 180 { step(-1) }
                }
            }
    }

    private var magnify: some Gesture {
        MagnifyGesture()
            .onChanged { value in scale = min(max(committedScale * value.magnification, 1), 6) }
            .onEnded { _ in
                committedScale = scale
                // Pinching back to fit also puts the picture back in the middle.
                if scale <= 1 { resetZoom(animated: true) }
            }
    }

    private func toggleZoom() {
        if scale > 1 {
            resetZoom(animated: true)
        } else {
            withAnimation(.spring(response: 0.3, dampingFraction: 0.85)) { scale = 2.5; committedScale = 2.5 }
        }
    }

    private func resetZoom(animated: Bool) {
        let reset = {
            scale = 1; committedScale = 1; offset = .zero; committedOffset = .zero; swipe = 0
        }
        if animated { withAnimation(.spring(response: 0.3, dampingFraction: 0.85), reset) } else { reset() }
    }

    private func step(_ delta: Int) {
        let next = index + delta
        guard items.indices.contains(next) else { return }
        withAnimation(.easeOut(duration: 0.18)) { index = next }
    }

    // MARK: Download

    private func save() async {
        guard let item = current else { return }
        do {
            let file = try await APIClient.shared.vaultDownload(item: item, progress: saving)
            sheet = .activity(ShareItem(url: file))
        } catch {
            problem = (error as? LocalizedError)?.errorDescription ?? T("Something went wrong.")
        }
    }
}

private enum ViewerSheet: Identifiable {
    case shareLink(VaultItem)
    case activity(ShareItem)

    var id: String {
        switch self {
        case .shareLink(let item): return "link-\(item.id)"
        case .activity(let share): return "save-\(share.id.uuidString)"
        }
    }
}

/// One film: fetched to disk with the session (cached, so a second look is instant), then played
/// with the system's controls.
private struct VaultVideoPage: View {
    let item: VaultItem
    @State private var player: AVPlayer?
    @State private var progress = UploadProgress()
    @State private var failed: String?

    var body: some View {
        ZStack {
            if let player {
                VideoPlayer(player: player)
            } else if let failed {
                VStack(spacing: 10) {
                    Image(systemName: "exclamationmark.triangle").font(.system(size: 28))
                    Text(failed).font(NXFont.text(13)).multilineTextAlignment(.center)
                }
                .foregroundStyle(Color.white.opacity(0.8))
                .padding(32)
            } else {
                VStack(spacing: 14) {
                    ProgressView().tint(Color.white)
                    if progress.isActive {
                        UploadProgressBar(progress: progress).frame(maxWidth: 220)
                    }
                    Text(T("Loading the video…")).font(NXFont.text(12)).foregroundStyle(Color.white.opacity(0.7))
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .task(id: item.id) {
            do {
                let file = try await APIClient.shared.vaultDownload(item: item, progress: progress)
                let fresh = AVPlayer(url: file)
                player = fresh
                fresh.play()
            } catch {
                failed = (error as? LocalizedError)?.errorDescription ?? T("Couldn't open this file.")
            }
        }
        .onDisappear { player?.pause() }
    }
}
