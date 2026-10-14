import SwiftUI
import UIKit

// Shared pieces of the spreadsheet panels: colours as the web stores them (hex, or a palette name), the
// Sheets 10 × 8 swatch grid with a custom colour, the A1 range field with "use the selected range", and the
// sheet presentation (detents on iPhone, a form sheet on iPad / Mac).

enum SPColors {
    /// Sheets' 10 × 8 swatches (web ConditionalFormatPanel HEX_PALETTE), row by row.
    static let HEX_PALETTE: [[String]] = [
        ["#000000", "#434343", "#666666", "#999999", "#b7b7b7", "#cccccc", "#d9d9d9", "#efefef", "#f3f3f3", "#ffffff"],
        ["#980000", "#ff0000", "#ff9900", "#ffff00", "#00ff00", "#00ffff", "#4a86e8", "#0000ff", "#9900ff", "#ff00ff"],
        ["#e6b8af", "#f4cccc", "#fce5cd", "#fff2cc", "#d9ead3", "#d0e0e3", "#c9daf8", "#cfe2f3", "#d9d2e9", "#ead1dc"],
        ["#dd7e6b", "#ea9999", "#f9cb9c", "#ffe599", "#b6d7a8", "#a2c4c9", "#a4c2f4", "#9fc5e8", "#b4a7d6", "#d5a6bd"],
        ["#cc4125", "#e06666", "#f6b26b", "#ffd966", "#93c47d", "#76a5af", "#6d9eeb", "#6fa8dc", "#8e7cc3", "#c27ba0"],
        ["#a61c00", "#cc0000", "#e69138", "#f1c232", "#6aa84f", "#45818e", "#3c78d8", "#3d85c6", "#674ea7", "#a64d79"],
        ["#85200c", "#990000", "#b45f06", "#bf9000", "#38761d", "#134f5c", "#1155cc", "#0b5394", "#351c75", "#741b47"],
        ["#5b0f00", "#660000", "#783f04", "#7f6000", "#274e13", "#0c343d", "#1c4587", "#073763", "#20124d", "#4c1130"],
    ]

    /// Dropdown chip colours (web sheet-style STYLE_COLORS) with their names.
    static let STYLE_COLORS: [(key: String, name: String)] = [
        ("black", "Black"), ("slate", "Grey"), ("red", "Red"), ("orange", "Orange"), ("amber", "Yellow"),
        ("green", "Green"), ("teal", "Teal"), ("blue", "Blue"), ("violet", "Purple"), ("pink", "Pink"),
    ]

    /// A stored colour (hex, or a palette name) as a SwiftUI colour.
    static func color(_ s: String?) -> Color {
        guard let s, !s.isEmpty else { return .clear }
        if let ui = SheetBridge.hexColor(s) { return Color(uiColor: ui) }
        return Color(uiColor: SheetBridge.paletteColor(s))
    }

    /// "#rrggbb" of a picked colour.
    static func hex(_ c: Color) -> String {
        var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
        UIColor(c).getRed(&r, green: &g, blue: &b, alpha: &a)
        func h(_ x: CGFloat) -> String { String(format: "%02x", Int((min(max(x, 0), 1) * 255).rounded())) }
        return "#" + h(r) + h(g) + h(b)
    }
}

/// The 10 × 8 swatch grid, Reset, and a custom colour (Sheets' colour menu).
struct SPSwatchGrid: View {
    let value: String?
    var allowReset = true
    let onPick: (String?) -> Void
    @State private var custom: Color = .black

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            if allowReset {
                Button(T("Reset")) { onPick(nil) }.font(NXFont.text(13))
            }
            Grid(horizontalSpacing: 4, verticalSpacing: 4) {
                ForEach(SPColors.HEX_PALETTE, id: \.self) { row in
                    GridRow {
                        ForEach(row, id: \.self) { hex in swatch(hex) }
                    }
                }
            }
            ColorPicker(T("Custom"), selection: $custom, supportsOpacity: false)
                .font(NXFont.text(13))
                .onChange(of: custom) { _, c in onPick(SPColors.hex(c)) }
        }
        .padding(14)
        .onAppear { if let value, let ui = SheetBridge.hexColor(value) { custom = Color(uiColor: ui) } }
    }

    private func swatch(_ hex: String) -> some View {
        let on = value?.lowercased() == hex
        return Button { onPick(hex) } label: {
            Circle().fill(SPColors.color(hex))
                .frame(width: 22, height: 22)
                .overlay(Circle().strokeBorder(Color.black.opacity(0.12)))
                .overlay(Circle().strokeBorder(on ? NX.violet : .clear, lineWidth: 2).padding(-3))
        }
        .buttonStyle(.plain)
        .accessibilityLabel(hex)
    }
}

/// A colour well that opens the swatch grid in a popover.
struct SPColorButton: View {
    let label: String
    let value: String?
    var icon: String? = nil
    var allowReset = true
    var disabled = false
    let onChange: (String?) -> Void
    @State private var open = false

    var body: some View {
        Button { open = true } label: {
            HStack(spacing: 4) {
                if let icon { Image(systemName: icon).font(.system(size: 13, weight: .medium)) }
                Circle().fill(value == nil ? Color.clear : SPColors.color(value))
                    .frame(width: 18, height: 18)
                    .overlay(Circle().strokeBorder(NX.border))
                Image(systemName: "chevron.down").font(.system(size: 9, weight: .semibold)).foregroundStyle(NX.mutedFg)
            }
            .foregroundStyle(NX.foreground)
            .padding(.horizontal, 6).frame(height: 30)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(disabled)
        .accessibilityLabel(label)
        .popover(isPresented: $open) {
            SPSwatchGrid(value: value, allowReset: allowReset) { c in onChange(c); open = false }
                .presentationCompactAdaptation(.popover)
        }
    }
}

/// "Apply to range": A1 text, with a button that takes the current selection.
struct SPRangeField: View {
    let title: String
    @Binding var text: String
    let selection: String
    var invalid = false
    var disabled = false
    var placeholder = "A1:B10"

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 6) {
                TextField(placeholder, text: $text)
                    .font(.system(size: 14, design: .monospaced))
                    .textInputAutocapitalization(.characters)
                    .autocorrectionDisabled()
                    .disabled(disabled)
                    .accessibilityLabel(title)
                if !disabled && !selection.isEmpty {
                    Button { text = selection } label: {
                        Image(systemName: "tablecells").font(.system(size: 14))
                    }
                    .buttonStyle(.borderless)
                    .accessibilityLabel(T("Use the selected range"))
                }
            }
            if invalid {
                Text(T("Invalid range")).font(NXFont.text(12)).foregroundStyle(NX.danger)
            }
        }
    }
}

/// "123" in a rule's look (conditional format list, presets).
struct SPStyleSwatch: View {
    let fill: String?
    let text: String?
    var bold = false
    var italic = false
    var underline = false
    var strike = false
    var size: CGFloat = 40

    var body: some View {
        Text("123")
            .font(.system(size: 12, weight: bold ? .bold : .regular))
            .italic(italic)
            .underline(underline)
            .strikethrough(strike)
            .foregroundStyle(text.map { SPColors.color($0) } ?? NX.foreground)
            .frame(width: size, height: size * 0.8)
            .background(fill.map { SPColors.color($0) } ?? Color.clear, in: RoundedRectangle(cornerRadius: 6, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 6, style: .continuous).strokeBorder(Color.black.opacity(0.08)))
    }
}

/// A left-to-right gradient of a colour scale.
struct SPGradientBar: View {
    let colors: [String]
    var height: CGFloat = 22

    var body: some View {
        LinearGradient(colors: colors.map { SPColors.color($0) }, startPoint: .leading, endPoint: .trailing)
            .frame(height: height)
            .clipShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 6, style: .continuous).strokeBorder(Color.black.opacity(0.08)))
    }
}

/// How every panel is presented: detents on iPhone, the system form sheet on iPad / Mac.
struct SPPanelPresentation: ViewModifier {
    @Environment(\.horizontalSizeClass) private var hSize

    @ViewBuilder func body(content: Content) -> some View {
        if hSize == .compact {
            content.presentationDetents([.medium, .large]).presentationDragIndicator(.visible)
        } else {
            content
        }
    }
}

extension View {
    func spPanelPresentation() -> some View { modifier(SPPanelPresentation()) }
}

enum SPFormat {
    /// "12 Okt, 14.05" in the app's language (web: day + month + hour + minute).
    static func when(_ iso: String) -> String {
        guard let d = SPVersions.date(iso) else { return "" }
        let f = DateFormatter()
        f.locale = Locale(identifier: AppLanguage.shared.lang == .id ? "id_ID" : "en_US")
        f.timeZone = TimeZone(identifier: "Asia/Jakarta")
        f.setLocalizedDateFormatFromTemplate("dMMMHHmm")
        return f.string(from: d)
    }

    /// "Senin 12 Okt" / "Monday 12 Oct" for a YYYY-MM-DD day.
    static func day(_ key: String) -> String {
        guard let d = SPVersions.date("\(key)T12:00:00+07:00") else { return key }
        // "Monday 12 Oct", the year only outside the current one: the app's weekday format (run 14, N-35).
        return AppDateLocale.weekdayDate(d)
    }

    /// A model cell's address ("C5").
    static func a1(row: Int, col: Int) -> String { "\(SheetFormula.colLetter(col))\(row + 1)" }
}
