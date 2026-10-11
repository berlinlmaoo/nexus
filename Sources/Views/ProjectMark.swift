import SwiftUI

/// A PROJECT's mark (owner, 11 Oct 2026): one default for every project — a blue task tile, identical
/// to web (rounded square, corners 28% of its side, vertical gradient #3B82F6 → #2563EB, hairline inner
/// stroke black 12%, white bold checkmark at ~62% of the side) — unless the project has an uploaded
/// photo. Emoji and named icons ("folder", "rocket", "🚀") stored by older screens are ignored on
/// purpose, and so is the project's colour.
///
/// Folders are NOT drawn with this: they keep their own emoji/photo (FolderIconTile).
struct ProjectMark: View {
    let icon: String?
    /// Kept so call sites stay as they are; ignored — the default tile is the same blue for every project.
    let color: String?
    /// The slot the mark sits in. A photo and the default tile both fill it.
    var size: CGFloat = 20
    /// Draw the default tile at this side instead of `size` (centred in the slot), for a slot where a
    /// photo should fill a larger area than the tile.
    var glyph: CGFloat? = nil

    private static let tileTop = Color(red: 0x3B / 255, green: 0x82 / 255, blue: 0xF6 / 255)    // #3B82F6
    private static let tileBottom = Color(red: 0x25 / 255, green: 0x63 / 255, blue: 0xEB / 255) // #2563EB

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
                CachedImage(url: url) { $0.resizable().scaledToFill() } placeholder: { defaultMark }
                    .frame(width: size, height: size)
                    .clipShape(RoundedRectangle(cornerRadius: size * 0.28, style: .continuous))
            } else {
                defaultMark.frame(width: size, height: size)
            }
        }
        .accessibilityHidden(true)
    }

    private var defaultMark: some View {
        let side = glyph ?? size
        let shape = RoundedRectangle(cornerRadius: side * 0.28, style: .continuous)
        return ZStack {
            shape.fill(LinearGradient(colors: [Self.tileTop, Self.tileBottom], startPoint: .top, endPoint: .bottom))
            shape.strokeBorder(Color.black.opacity(0.12), lineWidth: 0.5)
            Image(systemName: "checkmark")
                .font(.system(size: side * 0.62, weight: .heavy))
                .foregroundStyle(.white)
        }
        .frame(width: side, height: side)
    }
}
