import SwiftUI

/// NEXUS brand palette (mirrors the web design tokens: onyx + deep-violet #7b68ee + electric-blue).
enum Brand {
    static let violet = Color(hex: "#7b68ee")
    static let blue = Color(hex: "#0091ff")
    static let ink = Color(hex: "#11141b")
    static let success = Color(hex: "#16a34a")
}

extension Color {
    /// Parse "#rrggbb" / "#rgb" hex strings into a Color. Falls back to gray on bad input.
    init(hex raw: String) {
        var s = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if s.hasPrefix("#") { s.removeFirst() }
        if s.count == 3 { s = s.map { "\($0)\($0)" }.joined() }
        guard s.count == 6, let v = UInt64(s, radix: 16) else {
            self = .gray
            return
        }
        self = Color(
            red: Double((v >> 16) & 0xFF) / 255,
            green: Double((v >> 8) & 0xFF) / 255,
            blue: Double(v & 0xFF) / 255
        )
    }
}
