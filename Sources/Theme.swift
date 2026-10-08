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

    /// The same, plus the values for Increase Contrast (Settings › Accessibility › Display & Text
    /// Size). iOS's own colours deepen when it is on; tokens built from two hexes stayed exactly as
    /// faint as before (impeccable audit, 6 Oct 2026).
    init(light: UInt, dark: UInt, lightHC: UInt, darkHC: UInt) {
        self.init(uiColor: UIColor { trait in
            let high = trait.accessibilityContrast == .high
            if trait.userInterfaceStyle == .dark { return UIColor(rgb: high ? darkHC : dark) }
            return UIColor(rgb: high ? lightHC : light)
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

// MARK: - Appearance (in-app light/dark override)

/// `.system` follows iOS Settings; the other two override it inside the app only.
enum AppTheme: String, CaseIterable, Identifiable, Sendable {
    case system, light, dark
    var id: String { rawValue }
    var label: String {
        switch self {
        case .system: return T("Follow system")
        case .light:  return T("Light")
        case .dark:   return T("Dark")
        }
    }
    var icon: String {
        switch self {
        case .system: return "iphone"
        case .light:  return "sun.max.fill"
        case .dark:   return "moon.fill"
        }
    }
    /// nil = don't override, i.e. inherit whatever iOS is set to.
    var colorScheme: ColorScheme? {
        switch self {
        case .system: return nil
        case .light:  return .light
        case .dark:   return .dark
        }
    }
}

/// Same pattern as AppLanguage: @Observable so flipping it re-renders every screen at once,
/// persisted so the choice survives a relaunch.
@Observable
final class AppAppearance {
    static let shared = AppAppearance()
    private static let key = "nexus.theme"

    var theme: AppTheme {
        didSet { UserDefaults.standard.set(theme.rawValue, forKey: Self.key) }
    }

    private init() {
        theme = AppTheme(rawValue: UserDefaults.standard.string(forKey: Self.key) ?? "") ?? .system
    }
}

/// Semantic palette — names match the web tokens.
enum NX {
    // Dark values are tuned for measured contrast, not vibes:
    //   • card vs background was 1.08:1 — cards were invisible, so every screen read as one flat
    //     sheet. Deepening the background and lifting the card gets that to ~1.2:1, and the border
    //     (which was 2a2f3a — indistinguishable from the card) now actually draws the edge.
    //   • mutedFg / foreground raised so secondary text stays >7:1 on the lifted card.
    static let background  = Color(light: 0xf8f9fb, dark: 0x0d1017)
    static let card        = Color(light: 0xffffff, dark: 0x1c2130)
    static let foreground  = Color(light: 0x292d34, dark: 0xe8eaef)
    //   • Increase Contrast: secondary text goes a step further from the surface. The border keeps
    //     its faint value there too: owner, 8 Oct 2026, a darker card outline on every screen was
    //     not wanted.
    static let mutedFg     = Color(light: 0x656d76, dark: 0xa6b0bd, lightHC: 0x4b525a, darkHC: 0xc4cbd4)
    static let muted       = Color(light: 0xf1f3f6, dark: 0x252c3d)
    static let border      = Color(light: 0xe6e8ec, dark: 0x333b52)
    static let onyx        = Color(light: 0x202023, dark: 0xe8eaef)   // web --primary (high-contrast CTA/text)

    // The brand violet is TWO tokens because one colour cannot do both jobs: a fill needs to be
    // dark enough for white label text, type needs to be light enough to read on a dark card.
    // The single old token (8b7bf0) failed both — 3.39:1 under white, 5.03:1 as 12pt type.
    /// Brand FILL: buttons, selected pills, progress bars, dots. White text on this clears AA.
    static let violet      = Color(light: 0x7b68ee, dark: 0x6f5ae6)   // brand (--ring / --sidebar-primary)
    /// Brand as TEXT or ICON on a surface. Use this for type — never `violet`.
    ///
    /// The violets that carry type have Increase Contrast values, the ones the Calendar's own accent
    /// already had: with it on, half the accent strengthened and half stayed put, two violets side by
    /// side, and TODAY, the scope and the filter chips never reached 7:1 (impeccable re-audit, 7 Oct
    /// 2026). Measured with them on: text 9.0:1 on white and 10.4:1 on the dark card, 7.3:1 / 8.3:1
    /// on `accentBg`; white on `violetFill` 9.0:1 / 6.5:1. The normal values are unchanged.
    static let violetText  = Color(light: 0x6247d6, dark: 0xb3a6ff, lightHC: 0x4a2fb0, darkHC: 0xd2caff)
    /// Brand FILL under small white type (13 pt labels): white on `violet` is 4.15:1 in light mode,
    /// under AA for text that size; this deeper shade is 6.2:1. Dark is `violet`'s own value.
    static let violetFill  = Color(light: 0x6247d6, dark: 0x6f5ae6, lightHC: 0x4a2fb0, darkHC: 0x5a44d4)
    static let blue        = Color(light: 0x0091ff, dark: 0x38a3ff)
    static let success     = Color(light: 0x16a34a, dark: 0x34d399)
    static let warning     = Color(light: 0xf59e0b, dark: 0xfbbf24)
    static let danger      = Color(light: 0xef4444, dark: 0xf87171)
    /// The accent's wash under `violetText` (chips, badges). A shade deeper under Increase Contrast, so
    /// a chip's edge shows against the card too.
    static let accentBg    = Color(light: 0xf1eefe, dark: 0x2c2551, lightHC: 0xe9e4fd, darkHC: 0x332a63)
    static let accentFg    = Color(light: 0x6750cf, dark: 0xbfb3ff)
    static let coral       = Color(light: 0xff7f50, dark: 0xff9d76)   // "Secure Uplink Ready" pill
    static let cream       = Color(light: 0xfdfcfb, dark: 0x0d1017)   // login background
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

/// Typography — the REAL web fonts, bundled: Plus Jakarta Sans (display) + Inter (body).
/// Registered at launch by FontLoader; variable-weight axis driven via `.weight()`.
enum NXFont {
    static func display(_ size: CGFloat, _ weight: Font.Weight = .bold) -> Font {
        .custom("Plus Jakarta Sans", size: size).weight(weight)
    }
    static func text(_ size: CGFloat, _ weight: Font.Weight = .regular) -> Font {
        .custom("Inter", size: size).weight(weight)
    }
}

// MARK: - Reusable modifiers / components (the web .card / .chip / .button--primary equivalents)

extension View {
    func nexusShadowSoft() -> some View { shadow(color: .black.opacity(0.06), radius: 14, x: 0, y: 6) }
    func nexusShadowPop() -> some View { shadow(color: .black.opacity(0.14), radius: 24, x: 0, y: 10) }

    /// `.card` — rounded-3xl, hairline border, soft shadow.
    /// The shadow rides on the flat background shape (not the rich content), so scrolling a list
    /// of cards rasterizes a solid rounded-rect per card instead of all the text/avatars inside.
    func nexusCard(padding: CGFloat = 16, radius: CGFloat = 24) -> some View {
        self
            .padding(padding)
            .background {
                RoundedRectangle(cornerRadius: radius, style: .continuous)
                    .fill(NX.card)
                    .nexusShadowSoft()
                    .overlay(RoundedRectangle(cornerRadius: radius, style: .continuous).strokeBorder(NX.border, lineWidth: 1))
            }
    }
}

enum ChipTone {
    case neutral, accent, success, warning, danger, info, coral

    /// Text and icon colour. Like `NX.violet` / `NX.violetText`, a tone is two colours because one
    /// cannot do both jobs: the bright fills read 1.9–3.3:1 as 11 pt type on their own 16% tint in
    /// light mode, and the Calendar's "High" priority chip (amber on amber) all but vanished
    /// (impeccable audit, 6 Oct 2026). Light text is now a deeper shade of the same hue, measured at
    /// 4.9–6.4:1 on the tint over a card; dark mode keeps the fill, which already clears 4.5:1 there.
    var fg: Color {
        switch self {
        case .neutral: return ChipText.neutral
        case .accent: return ChipText.accent
        case .success: return ChipText.success
        case .warning: return ChipText.warning
        case .danger: return ChipText.danger
        case .info: return ChipText.info
        case .coral: return ChipText.coral
        }
    }
    /// The chip's wash: the bright tone, unchanged, so every chip keeps its colour.
    var bg: Color { chipFill.opacity(0.16) }

    private var chipFill: Color {
        switch self {
        case .neutral: return NX.mutedFg
        case .accent: return NX.accentFg
        case .success: return NX.success
        case .warning: return NX.warning
        case .danger: return NX.danger
        case .info: return NX.blue
        case .coral: return NX.coral
        }
    }

    /// Stable colour for a free-text label (room name, category…) so the same string is always the
    /// same colour — without anyone maintaining a lookup table.
    ///
    /// Deliberately NOT `hashValue`: Swift seeds that per launch, so the palette would reshuffle
    /// every cold start. This folds the scalars with a fixed multiplier — same string, same colour,
    /// on every launch and every device.
    static func forLabel(_ s: String) -> ChipTone {
        let palette: [ChipTone] = [.accent, .info, .success, .coral, .warning]
        let seed = s.unicodeScalars.reduce(0) { ($0 &* 31 &+ Int($1.value)) & 0xFFFF }
        return palette[seed % palette.count]
    }
}

/// ChipTone's text colours, built once (light = a deeper shade of the fill, dark = the fill itself).
private enum ChipText {
    static let neutral = Color(light: 0x5a626b, dark: 0xa6b0bd)
    static let accent  = Color(light: 0x6247d6, dark: 0xbfb3ff)
    static let success = Color(light: 0x14703a, dark: 0x34d399)
    static let warning = Color(light: 0x92400e, dark: 0xfbbf24)
    static let danger  = Color(light: 0xb91c1c, dark: 0xf87171)
    static let info    = Color(light: 0x0369a1, dark: 0x38a3ff)
    static let coral   = Color(light: 0xb13c10, dark: 0xff9d76)
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

/// Canonical section header — the small UPPERCASE muted label above a card/group.
/// Single source of truth so every screen spaces it identically (was hand-rolled 30+ times).
struct SectionLabel: View {
    let text: String
    init(_ text: String) { self.text = text }
    var body: some View {
        Text(text.uppercased())
            .font(NXFont.text(11, .bold)).tracking(0.5).foregroundStyle(NX.mutedFg)
    }
}

/// `.button--primary` — violet, white, rounded, with a subtle press spring.
struct NexusPrimaryButton: ButtonStyle {
    var tint: Color = NX.violet
    var fullWidth: Bool = true
    /// A disabled button used to draw exactly like an enabled one — full violet, white label — so
    /// a form with a missing required field looked like a button that ignores taps (the BoD hit
    /// "Post" on an announcement with an empty body, 16 Sep 2026). Dimmed now, like the web's
    /// `disabled:opacity-40`.
    @Environment(\.isEnabled) private var isEnabled
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(NXFont.display(16, .bold))
            .foregroundStyle(.white)
            .frame(maxWidth: fullWidth ? .infinity : nil)
            .padding(.vertical, 15)
            .background(tint, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            .opacity(!isEnabled ? 0.4 : configuration.isPressed ? 0.85 : 1)
            .scaleEffect(configuration.isPressed ? 0.98 : 1)
            .animation(.spring(response: 0.3, dampingFraction: 0.7), value: configuration.isPressed)
    }
}
