import SwiftUI
import UIKit
import AVKit
import AVFoundation
import PDFKit

// ─────────────────────────────────────────────────────────────────────────────
// Looking at an attachment inside the app.
//
// `/api/files/…` refuses anyone without the session cookie, so none of this can be delegated: a URL
// handed to Safari comes back as a login page, and QuickLook's own fetch has no cookie to send.
// Whatever is drawn here was fetched by `APIClient`, which is also what makes it take the office LAN
// like the rest of the app.
//
// Three viewers, and a deliberate refusal to invent a fourth. A picture goes to `PhotoViewer`, which
// the app already had. A PDF goes to PDFKit and a film to AVKit — both system frameworks, both
// already the thing every other iOS app shows those in, and neither a dependency.
// ─────────────────────────────────────────────────────────────────────────────

/// What the app can show for itself, and what it can only hand to the share sheet.
///
/// Narrow on purpose, and read off the extension first. A `video/webm` attachment has a mimeType iOS
/// recognises and no codec to play it with, so trusting the type alone would open a black rectangle
/// with a spinner on it — worse than the share sheet it replaced, because it looks like a fault.
enum AttachmentKind: Equatable {
    case image, pdf, video, audio

    init?(mime: String?, name: String?) {
        let ext = (name ?? "").lowercased().split(separator: ".").last.map(String.init) ?? ""
        let type = (mime ?? "").lowercased()
        if ["png", "jpg", "jpeg", "gif", "webp", "heic", "heif", "bmp"].contains(ext)
            || (type.hasPrefix("image/") && type != "image/svg+xml") {
            self = .image
        } else if ext == "pdf" || type == "application/pdf" {
            self = .pdf
        } else if ["mp4", "mov", "m4v"].contains(ext) {
            self = .video
        } else if ["mp3", "m4a", "wav", "aac"].contains(ext) {
            self = .audio
        } else {
            return nil
        }
    }

    /// The glyph a row wears before anybody opens it, so a list of files says what is in it.
    var glyph: String {
        switch self {
        case .image: return "photo"
        case .pdf: return "doc.richtext"
        case .video: return "play.rectangle"
        case .audio: return "waveform"
        }
    }
}

/// One attachment being looked at. Identifiable so a `.fullScreenCover(item:)` can be driven
/// straight from a row.
struct AttachmentPreview: Identifiable {
    let id: String
    let name: String
    let kind: AttachmentKind
    /// The REMOTE url for a picture, and a LOCAL file for everything else.
    ///
    /// A picture goes through `ImageLoader`: it already fetches with the session, downsamples in one
    /// ImageIO pass and keeps the result, so saving one to disk as well would fetch the same bytes
    /// twice and decode them at full size to draw them small. A PDF and a film have to be files —
    /// PDFKit and AVPlayer both want somewhere they can seek in, and neither can be handed a cookie.
    let source: URL
}

struct AttachmentViewerView: View {
    let preview: AttachmentPreview

    var body: some View {
        switch preview.kind {
        case .image:
            PhotoViewer(photo: PhotoRef(url: preview.source, name: preview.name))
        case .pdf:
            framed { PDFPreview(file: preview.source) }
        case .video, .audio:
            framed { MediaPreview(file: preview.source) }
        }
    }

    /// Black behind, the file's name and a way out on top — the same chrome `PhotoViewer` wears, so
    /// opening a scan and opening a photo do not feel like two different apps.
    private func framed<Content: View>(@ViewBuilder _ content: () -> Content) -> some View {
        ZStack {
            Color.black.ignoresSafeArea()
            content()
        }
        .overlay(alignment: .top) { AttachmentViewerBar(name: preview.name) }
    }
}

private struct AttachmentViewerBar: View {
    let name: String
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        HStack(spacing: 10) {
            Text(name).font(NXFont.text(13, .semibold)).foregroundStyle(Color.white).lineLimit(1)
            Spacer(minLength: 0)
            Button { dismiss() } label: {
                Image(systemName: "xmark").font(.system(size: 14, weight: .bold)).foregroundStyle(Color.white)
                    .frame(width: 34, height: 34)
                    .background(Color.white.opacity(0.15), in: Circle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(T("Close"))
        }
        .padding(.horizontal, 16).padding(.top, 10)
    }
}

/// A PDF, in PDFKit's own view. Paging, pinch-zoom and text selection come with it; a reader written
/// by hand would be a project of its own and would still be worse.
private struct PDFPreview: View {
    let file: URL
    @State private var document: PDFDocument?
    @State private var failed = false

    var body: some View {
        ZStack {
            if let document {
                PDFCanvas(document: document)
            } else if failed {
                Text(T("Couldn't open this file."))
                    .font(NXFont.text(14)).foregroundStyle(Color.white.opacity(0.75))
            } else {
                ProgressView().tint(Color.white)
            }
        }
        .task(id: file) {
            // `PDFDocument(url:)` parses the file's cross-reference table on whichever thread calls
            // it, which on a large scan is long enough to drop frames — and this opens over a task
            // detail somebody may still be scrolling. Off the main thread, then, even though the
            // rest of the work PDFKit does is already its own.
            let loaded: PDFDocument? = await withCheckedContinuation { done in
                DispatchQueue.global(qos: .userInitiated).async {
                    done.resume(returning: PDFDocument(url: file))
                }
            }
            document = loaded
            failed = loaded == nil
        }
    }
}

private struct PDFCanvas: UIViewRepresentable {
    let document: PDFDocument

    func makeUIView(context: Context) -> PDFView {
        let view = PDFView()
        view.autoScales = true
        view.displayDirection = .vertical
        view.backgroundColor = .black
        view.document = document
        return view
    }

    /// The document is set once, above. Re-assigning it here would throw the reader back to page one
    /// on every unrelated SwiftUI update.
    func updateUIView(_ view: PDFView, context: Context) {}
}

/// Video and audio, played off the file already on disk.
///
/// Off a file and not off the URL: `AVURLAsset` has no supported way to carry the session cookie,
/// and `/api/files` answers a request without one with a 401 that plays as "cannot play this".
private struct MediaPreview: View {
    let file: URL
    @State private var player: AVPlayer?

    var body: some View {
        ZStack {
            if let player {
                VideoPlayer(player: player)
            } else {
                ProgressView().tint(Color.white)
            }
        }
        .onAppear {
            // Without this the silent switch silences the film: an app that has never said otherwise
            // is treated as ambient. Set and not put back — nothing else in this app plays anything.
            try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .moviePlayback)
            try? AVAudioSession.sharedInstance().setActive(true)
            let made = AVPlayer(url: file)
            player = made
            made.play()
        }
        .onDisappear {
            // A player left holding the file keeps it alive after the sheet has gone, and the
            // audio session left active tells the phone this app is still playing something.
            player?.pause()
            player = nil
            try? AVAudioSession.sharedInstance().setActive(false, options: [.notifyOthersOnDeactivation])
        }
    }
}
