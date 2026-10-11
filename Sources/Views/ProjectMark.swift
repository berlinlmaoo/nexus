import SwiftUI

/// A PROJECT's mark (owner, 11 Oct 2026): one default for every project — a small rounded square in
/// the project's colour — unless the project has an uploaded photo. Emoji and named icons ("folder",
/// "rocket", "🚀") stored by older screens are ignored on purpose. Same drawing as web's ProjectMark
/// (square 0.6 of the slot, corners 28% of its side, fallback #7B2FBE).
///
/// Folders are NOT drawn with this: they keep their own emoji/photo (FolderIconTile).
struct ProjectMark: View {
    let icon: String?
    let color: String?
    /// The slot the mark sits in. A photo fills it; the default square is 0.6 of it.
    var size: CGFloat = 20
    /// Measure the square from this instead of `size`: for a mark on a larger tile, where a photo
    /// should fill the tile but the square stays glyph-sized (web sizes it 0.6em of the slot's text).
    var glyph: CGFloat? = nil

    static let fallbackColor = "#7B2FBE"

    /// True when the stored icon is an uploaded picture ("/api/files/…" or an absolute URL).
    static func isPhoto(_ icon: String?) -> Bool {
        guard let icon else { return false }
        return icon.hasPrefix("/") || icon.hasPrefix("http")
    }

    /// The uploaded picture's URL, or nil when the project has none.
    static func photoURL(_ icon: String?) -> URL? {
        guard let icon, isPhoto(icon) else { return nil }
        return URL(string: icon.hasPrefix("http") ? icon : Config.baseURL.absoluteString + icon)
    }

    var body: some View {
        Group {
            if let url = Self.photoURL(icon) {
                CachedImage(url: url) { $0.resizable().scaledToFill() } placeholder: { square }
                    .frame(width: size, height: size)
                    .clipShape(RoundedRectangle(cornerRadius: size * 0.22, style: .continuous))
            } else {
                square.frame(width: size, height: size)
            }
        }
        .accessibilityHidden(true)
    }

    private var square: some View {
        let side = (glyph ?? size) * 0.6
        let hex = (color?.isEmpty == false) ? color! : Self.fallbackColor
        return RoundedRectangle(cornerRadius: side * 0.28, style: .continuous)
            .fill(Color(hex: hex))
            .frame(width: side, height: side)
    }
}
