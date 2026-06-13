import CoreText
import Foundation

/// Registers the bundled variable fonts (Plus Jakarta Sans + Inter) at launch so `Font.custom`
/// can resolve them. Avoids needing a UIAppFonts Info.plist entry.
enum FontLoader {
    static func registerAll() {
        for name in ["PlusJakartaSans", "Inter"] {
            guard let url = Bundle.main.url(forResource: name, withExtension: "ttf") else { continue }
            CTFontManagerRegisterFontsForURL(url as CFURL, .process, nil)
        }
    }
}
