import SwiftUI
import UIKit

// ─────────────────────────────────────────────────────────────────────────────
// NEXUS design system — ports the web design tokens (src/styles.css) to SwiftUI:
// ClickUp-style onyx + deep-violet #7b68ee, light/dark adaptive, soft cards, rounded display type.
// ─────────────────────────────────────────────────────────────────────────────

extension UIColor {
    convenience init(rgb: UInt) {
        self.init(
            red: CGFloat((rgb >> 16) & 0xFF) / 255,
            green: CGFloat((rgb >> 8) & 0xFF) / 255,
            blue: CGFloat(rgb & 0xFF) / 255,
            alpha: 1
        )
    }
}

extension Color {
    /// Light/dark adaptive color from two hex literals (mirrors :root vs .dark in styles.css).
    init(light: UInt, dark: UInt) {
        self.init(uiColor: UIColor { trait in
            UIColor(rgb: trait.userInterfaceStyle == .dark ? dark : light)
        })
    }

    /// Parse "#rrggbb" / "#rgb" strings (used for per-project/category colors from the API).
    init(hex raw: String) {
        var s = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if s.hasPrefix("#") { s.removeFirst() }
        if s.count == 3 { s = s.map { "\($0)\($0)" }.joined() }
        guard s.count == 6, let v = UInt64(s, radix: 16) else { self = .gray; return }
        self = Color(red: Double((v >> 16) & 0xFF) / 255, green: Double((v >> 8) & 0xFF) / 255, blue: Double(v & 0xFF) / 255)
    }
}

/// Semantic palette — names match the web tokens.
enum NX {
    static let background  = Color(light: 0xf8f9fb, dark: 0x11141b)
    static let card        = Color(light: 0xffffff, dark: 0x181c25)
    static let foreground  = Color(light: 0x292d34, dark: 0xe6e8ec)
    static let mutedFg     = Color(light: 0x656d76, dark: 0x9aa3af)
    static let muted       = Color(light: 0xf1f3f6, dark: 0x222732)
    static let border      = Color(light: 0xe6e8ec, dark: 0x2a2f3a)
    static let onyx        = Color(light: 0x202023, dark: 0xe6e8ec)   // web --primary (high-contrast CTA/text)
    static let violet      = Color(light: 0x7b68ee, dark: 0x8b7bf0)   // brand (--ring / --sidebar-primary)
    static let blue        = Color(light: 0x0091ff, dark: 0x38a3ff)
    static let success     = Color(light: 0x16a34a, dark: 0x34d399)
    static let warning     = Color(light: 0xf59e0b, dark: 0xfbbf24)
    static let danger      = Color(light: 0xef4444, dark: 0xf87171)
    static let accentBg    = Color(light: 0xf1eefe, dark: 0x2a2546)
    static let accentFg    = Color(light: 0x6750cf, dark: 0xb9acff)
    static let coral       = Color(hex: "#FF7F50")   // "Secure Uplink Ready" pill
    static let cream       = Color(light: 0xfdfcfb, dark: 0x11141b)   // login background
    static let ink         = Color(hex: "#11141b")
    static let inkGradient = LinearGradient(colors: [Color(hex: "#11141b"), Color(hex: "#3a2f7a")],
                                            startPoint: .topLeading, endPoint: .bottomTrailing)
}

/// Back-compat alias (old views referenced `Brand.*`).
enum Brand {
    static let violet = NX.violet
    static let blue = NX.blue
    static let ink = NX.ink
    static let success = NX.success
}

/// Typography. SF Pro stands in for Plus Jakarta Sans (display, geometric — NOT rounded) and Inter
/// (body) — swap to `Font.custom("PlusJakartaSans-Bold"/"Inter", size:)` once the .ttf are bundled.
enum NXFont {
    static func display(_ size: CGFloat, _ weight: Font.Weight = .bold) -> Font {
        .system(size: size, weight: weight, design: .default)
    }
    static func text(_ size: CGFloat, _ weight: Font.Weight = .regular) -> Font {
        .system(size: size, weight: weight)
    }
}

// MARK: - Reusable modifiers / components (the web .card / .chip / .button--primary equivalents)

extension View {
    func nexusShadowSoft() -> some View { shadow(color: .black.opacity(0.06), radius: 14, x: 0, y: 6) }
    func nexusShadowPop() -> some View { shadow(color: .black.opacity(0.14), radius: 24, x: 0, y: 10) }

    /// `.card` — rounded-3xl, hairline border, soft shadow.
    func nexusCard(padding: CGFloat = 16, radius: CGFloat = 24) -> some View {
        self
            .padding(padding)
            .background(NX.card, in: RoundedRectangle(cornerRadius: radius, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: radius, style: .continuous).strokeBorder(NX.border, lineWidth: 1))
            .nexusShadowSoft()
    }
}

enum ChipTone {
    case neutral, accent, success, warning, danger, info
    var fg: Color {
        switch self {
        case .neutral: return NX.mutedFg
        case .accent: return NX.accentFg
        case .success: return NX.success
        case .warning: return NX.warning
        case .danger: return NX.danger
        case .info: return NX.blue
        }
    }
    var bg: Color { fg.opacity(0.14) }
}

struct NexusChip: View {
    let text: String
    var tone: ChipTone = .neutral
    var systemImage: String? = nil
    var body: some View {
        HStack(spacing: 4) {
            if let systemImage { Image(systemName: systemImage).font(.system(size: 10, weight: .bold)) }
            Text(text).font(NXFont.text(11, .bold))
        }
        .padding(.horizontal, 8).padding(.vertical, 4)
        .foregroundStyle(tone.fg)
        .background(tone.bg, in: Capsule())
    }
}

/// `.button--primary` — violet, white, rounded, with a subtle press spring.
struct NexusPrimaryButton: ButtonStyle {
    var tint: Color = NX.violet
    var fullWidth: Bool = true
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(NXFont.display(16, .bold))
            .foregroundStyle(.white)
            .frame(maxWidth: fullWidth ? .infinity : nil)
            .padding(.vertical, 15)
            .background(tint, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            .opacity(configuration.isPressed ? 0.85 : 1)
            .scaleEffect(configuration.isPressed ? 0.98 : 1)
            .animation(.spring(response: 0.3, dampingFraction: 0.7), value: configuration.isPressed)
    }
}
