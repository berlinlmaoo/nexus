import SwiftUI

/// A PROJECT's mark (owner, 11 Oct 2026): one default for every project — the Tasks icon
/// ("checklist", as in the sidebar and More) in muted grey — unless the project has an uploaded photo.
/// Emoji and named icons ("folder", "rocket", "🚀") stored by older screens are ignored on purpose,
/// and so is the project's colour (it went from the square to grey the same day).
///
/// Folders are NOT drawn with this: they keep their own emoji/photo (FolderIconTile).
struct ProjectMark: View {
    let icon: String?
    /// Kept so call sites stay as they are; ignored — the default mark is grey whatever the colour.
    let color: String?
    /// The slot the mark sits in. A photo fills it; the default icon is 0.6 of it.
    var size: CGFloat = 20
    /// Measure the icon from this instead of `size`: for a mark on a larger tile, where a photo
    /// should fill the tile but the icon stays glyph-sized.
    var glyph: CGFloat? = nil

    /// The Tasks symbol (AppScreen.tasks.icon, More → Tasks).
    static let defaultSymbol = "checklist"

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
                    .clipShape(RoundedRectangle(cornerRadius: size * 0.22, style: .continuous))
            } else {
                defaultMark.frame(width: size, height: size)
            }
        }
        .accessibilityHidden(true)
    }

    private var defaultMark: some View {
        Image(systemName: Self.defaultSymbol)
            .font(.system(size: (glyph ?? size) * 0.6, weight: .semibold))
            .foregroundStyle(NX.mutedFg)
    }
}
