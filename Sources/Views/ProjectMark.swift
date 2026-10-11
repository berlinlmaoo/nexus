import SwiftUI

/// A PROJECT's mark (owner, 11 Oct 2026): one default for every project — the full-colour task icon,
/// identical to web (an amber clipboard holding a checklist, two green ticks and one empty box, on a
/// 24×24 grid scaled to the slot, no background tile) — unless the project has an uploaded photo.
/// Emoji and named icons ("folder", "rocket", "🚀") stored by older screens are ignored on purpose,
/// and so is the project's colour.
///
/// Folders are NOT drawn with this: they keep their own emoji/photo (FolderIconTile).
struct ProjectMark: View {
    let icon: String?
    /// Kept so call sites stay as they are; ignored — the default icon is the same for every project.
    let color: String?
    /// The slot the mark sits in. A photo and the default icon both fill it.
    var size: CGFloat = 20
    /// Draw the default icon at this side instead of `size` (centred in the slot), for a slot where a
    /// photo should fill a larger area than the icon.
    var glyph: CGFloat? = nil

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
        return Canvas { ctx, canvas in
            // Drawn on web's 24×24 grid, scaled to the slot.
            let k = min(canvas.width, canvas.height) / 24
            func rect(_ x: CGFloat, _ y: CGFloat, _ w: CGFloat, _ h: CGFloat, _ r: CGFloat, _ c: Color) {
                ctx.fill(Path(roundedRect: CGRect(x: x * k, y: y * k, width: w * k, height: h * k),
                              cornerRadius: r * k, style: .continuous), with: .color(c))
            }
            func tick(_ x: CGFloat, _ y: CGFloat) {
                var p = Path()
                p.move(to: CGPoint(x: x * k, y: y * k))
                p.addLine(to: CGPoint(x: (x + 0.9) * k, y: (y + 0.9) * k))
                p.addLine(to: CGPoint(x: (x + 2.3) * k, y: (y - 0.7) * k))
                ctx.stroke(p, with: .color(.white),
                           style: StrokeStyle(lineWidth: 0.9 * k, lineCap: .round, lineJoin: .round))
            }
            rect(3, 3, 18, 20, 3.5, Self.amber)          // board
            rect(5.5, 5.5, 13, 15.5, 1.8, .white)        // sheet
            rect(8.5, 1.5, 7, 4, 1.4, Self.slate)        // clip
            rect(7.2, 8.2, 3.4, 3.4, 0.8, Self.green)    // row 1, checked
            tick(7.9, 9.9)
            rect(11.8, 9.2, 5.2, 1.4, 0.7, Self.line)
            rect(7.2, 12.6, 3.4, 3.4, 0.8, Self.green)   // row 2, checked
            tick(7.9, 14.3)
            rect(11.8, 13.6, 5.2, 1.4, 0.7, Self.line)
            rect(7.2, 17, 3.4, 3.4, 0.8, Self.empty)     // row 3, unchecked
            rect(11.8, 18, 3.6, 1.4, 0.7, Self.line)
        }
        .frame(width: side, height: side)
    }

    private static func rgb(_ hex: UInt32) -> Color {
        Color(red: Double((hex >> 16) & 0xFF) / 255, green: Double((hex >> 8) & 0xFF) / 255, blue: Double(hex & 0xFF) / 255)
    }
    private static let amber = rgb(0xF59E0B)
    private static let slate = rgb(0x475569)
    private static let green = rgb(0x22C55E)
    private static let line = rgb(0xCBD5E1)
    private static let empty = rgb(0xE2E8F0)
}
