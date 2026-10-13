import SwiftUI

/// An avatar that opens the person's photo full screen when tapped (owner, 9 Oct 2026: a way to
/// actually see someone's profile picture). A drop-in for `AvatarView`: same look, same arguments,
/// plus the name to show above the photo.
///
/// Only a photo that actually loaded is tappable. No photo, or one the server could not serve,
/// draws the initials exactly as `AvatarView` does and opens nothing: a letter on a tint has
/// nothing more to show at full size, and a black screen with a spinner that never ends reads as
/// broken. Whether it loaded is asked of the same cache `AvatarView` fills, under the same key, so
/// knowing costs no second download.
///
/// The viewer is the app's `PhotoViewer` (pinch to zoom, drag to pan, double-tap to fit, Close),
/// with swipe-down to close turned on. Its `.fullScreenCover` hangs off THIS view rather than the
/// screen that draws it, so a screen that already presents a sheet still has one presentation per
/// view. Where it is used as a button, keep `size` at 44 pt or more.
struct ZoomableAvatar: View {
    let url: String?
    let initial: String
    var size: CGFloat = 36
    /// Shown above the photo in the viewer.
    var name: String? = nil

    @State private var hasPhoto = false
    @State private var viewing: PhotoRef?

    /// `AvatarView`'s rule: a server path is joined to the API host, a full URL is used as it is.
    private var photoURL: URL? {
        guard let url, !url.isEmpty else { return nil }
        return URL(string: url.hasPrefix("http") ? url : Config.baseURL.absoluteString + url)
    }

    var body: some View {
        ZStack {
            if hasPhoto, let photoURL {
                Button {
                    viewing = PhotoRef(url: photoURL, name: name)
                } label: {
                    AvatarView(url: url, initial: initial, size: size)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(T("View profile photo"))
            } else {
                AvatarView(url: url, initial: initial, size: size)
            }
        }
        .task(id: photoURL) {
            guard let photoURL else { hasPhoto = false; return }
            hasPhoto = await ImageLoader.shared.image(for: photoURL) != nil
        }
        .fullScreenCover(item: $viewing) { photo in
            PhotoViewer(photo: photo, dismissOnSwipeDown: true)
        }
    }
}
