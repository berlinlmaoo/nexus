import SwiftUI
import UIKit

/// A chat picture that is never an empty box (owner, 8 Oct 2026: a reply bubble showed a blank white
/// rectangle where its picture should have been, while the same picture loaded fine in a later
/// message).
///
/// `CachedImage` knows two states, the picture or its placeholder, and asks once per appearance. When
/// that one request failed (a moment without signal, the office LAN route going away mid-request) the
/// placeholder stayed up for good, and in the thread the placeholder was a 140 pt rectangle in
/// `NX.muted` — on the sender's own dark bubble, a plain white slab with nothing in it. Here loading
/// and failing each look like what they are: one quiet retry happens on its own, and after that the
/// tile says "Photo" and a tap tries again.
///
/// Taps are a TapGesture, not a Button, for the reason the thread gives: SwipeToReply's drag must
/// still start on a picture.
struct ChatPhoto: View {
    enum Style {
        /// The picture inside a message bubble: fitted, at most 240 pt wide.
        case bubble
        /// A small square: a quote's thumbnail, the composer's pending picture.
        case thumb
        /// A square that fills whatever frame its parent gives it (the media grid).
        case tile
    }

    let url: URL
    var style: Style = .bubble
    /// The colour of what is drawn over the bubble — the bubble's own ink — so the states read on the
    /// sender's dark bubble as well as on the light one.
    var ink: Color = NX.foreground
    /// A tap once the picture is showing (open the viewer, jump to the quoted message).
    var onOpen: (() -> Void)? = nil

    @State private var image: UIImage?
    @State private var failed = false
    @State private var attempt = 0

    init(url: URL, style: Style = .bubble, ink: Color = NX.foreground, onOpen: (() -> Void)? = nil) {
        self.url = url
        self.style = style
        self.ink = ink
        self.onOpen = onOpen
        // A picture already decoded draws on the first frame, as CachedImage does.
        _image = State(initialValue: ImageLoader.memory.object(
            forKey: ImageLoader.cacheKey(url, ImageLoader.tilePixel) as NSURL))
    }

    /// What restarts the load: another picture, or a tap on "try again".
    private struct Attempt: Equatable {
        let url: URL
        let number: Int
    }

    var body: some View {
        content
            .contentShape(Rectangle())
            .onTapGesture {
                if image != nil {
                    onOpen?()
                } else if failed {
                    failed = false
                    attempt += 1
                }
            }
            .task(id: Attempt(url: url, number: attempt)) { await load() }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(failed ? T("Photo couldn't load. Tap to try again.") : T("Photo"))
            .accessibilityAddTraits(.isButton)
    }

    @ViewBuilder private var content: some View {
        switch style {
        case .bubble:
            if let image {
                Image(uiImage: image).resizable().scaledToFit()
                    .frame(maxWidth: 240)
                    .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            } else {
                bubbleState
            }
        case .thumb, .tile:
            if let image {
                Color.clear
                    .overlay { Image(uiImage: image).resizable().scaledToFill() }
                    .clipped()
            } else {
                squareState
            }
        }
    }

    /// In a bubble: a framed tile with the photo glyph, and either a spinner or "try again".
    private var bubbleState: some View {
        VStack(spacing: 6) {
            Image(systemName: "photo")
                .font(.system(size: 22, weight: .regular))
            if failed {
                Text(T("Photo couldn't load")).font(NXFont.text(12, .semibold))
                Label(T("Tap to try again"), systemImage: "arrow.clockwise")
                    .font(NXFont.text(11))
                    .opacity(0.8)
            } else {
                ProgressView().controlSize(.small).tint(ink)
            }
        }
        .foregroundStyle(ink.opacity(0.75))
        .frame(width: 200, height: 130)
        .background(ink.opacity(0.06), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(ink.opacity(0.18)))
    }

    /// In a square: the glyph only — there is no room for words — with the retry arrow once it failed.
    private var squareState: some View {
        ZStack {
            Rectangle().fill(ink.opacity(0.08))
            Image(systemName: failed ? "arrow.clockwise" : "photo")
                .font(.system(size: style == .tile ? 20 : 13, weight: .semibold))
                .foregroundStyle(ink.opacity(0.6))
        }
    }

    private func load() async {
        guard image == nil else { return }
        if let picture = await ImageLoader.shared.image(for: url) {
            image = picture
            return
        }
        // One quiet retry before saying anything: most failures here are a second without signal,
        // or the LAN route being dropped in favour of the internet one, and the second ask works.
        if attempt == 0 {
            try? await Task.sleep(for: .seconds(2))
            if Task.isCancelled { return }
            if let picture = await ImageLoader.shared.image(for: url) {
                image = picture
                return
            }
        }
        if !Task.isCancelled { failed = true }
    }
}

extension ChatMessage {
    /// A chat file's address, resolved the same way everywhere: absolute as sent, or the server's
    /// own path on the app's host. The thread's bubble, a quote's thumbnail and the media screen all
    /// come through here, so none of them can resolve one differently.
    static func fileURL(_ path: String?) -> URL? {
        guard let path, !path.isEmpty else { return nil }
        return URL(string: path.hasPrefix("http") ? path : Config.baseURL.absoluteString + path)
    }
}
