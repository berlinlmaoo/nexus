import SwiftUI

// Format pickers of the spreadsheet (web SheetToolbar / ColorPicker / BordersPanel): Sheets' 80-swatch
// colour grid, the Borders panel (ten presets, line style, colour — remembered per device like the web's
// "nexus-sheet-border"), and on iPhone one Format sheet that holds what the iPad / Mac format bar shows.

/// Sheets' colour grid plus "Reset". Picks are stored as hex, like the web.
struct SheetGridPalette: View {
    let selected: String?
    let resetTitle: String
    let onPick: (String?) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Button { onPick(nil) } label: {
                Label(resetTitle, systemImage: "arrow.uturn.backward").font(NXFont.text(13, .medium))
            }
            .buttonStyle(.borderless)
            VStack(spacing: 4) {
                ForEach(SheetGridStyle.palette.indices, id: \.self) { r in
                    HStack(spacing: 4) {
                        ForEach(SheetGridStyle.palette[r], id: \.self) { hex in swatch(hex) }
                    }
                    if r == 1 { Spacer().frame(height: 4) }
                }
            }
        }
        .padding(12)
    }

    private func swatch(_ hex: String) -> some View {
        let on = SheetGridStyle.toHex(selected) == hex
        return Button { onPick(hex) } label: {
            Circle()
                .fill(Color(uiColor: SheetBridge.hexColor(hex) ?? .clear))
                .overlay(Circle().strokeBorder(Color.primary.opacity(hex == "#ffffff" ? 0.25 : 0.08)))
                .overlay {
                    if on {
                        Image(systemName: "checkmark").font(.system(size: 9, weight: .bold))
                            .foregroundStyle(Color(uiColor: SheetBridge.hexColor(SheetGridStyle.readableText(hex)) ?? .black))
                    }
                }
                .frame(width: 22, height: 22)
                .contentShape(Circle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(hex)
    }
}

/// A preset's glyph: a 3×3 cell drawn faint, the preset's lines solid (web BorderGlyph).
struct SheetBorderGlyph: View {
    let preset: String

    private static let segments: [String: [String]] = [
        "all": ["t", "b", "l", "r", "h", "v"], "inner": ["h", "v"], "horizontal": ["h"], "vertical": ["v"],
        "outer": ["t", "b", "l", "r"], "left": ["l"], "top": ["t"], "right": ["r"], "bottom": ["b"], "clear": [],
    ]

    var body: some View {
        Canvas { ctx, size in
            let s = min(size.width, size.height) / 16
            func seg(_ k: String) -> Path {
                var p = Path()
                switch k {
                case "t": p.move(to: CGPoint(x: 2.5 * s, y: 2.5 * s)); p.addLine(to: CGPoint(x: 13.5 * s, y: 2.5 * s))
                case "b": p.move(to: CGPoint(x: 2.5 * s, y: 13.5 * s)); p.addLine(to: CGPoint(x: 13.5 * s, y: 13.5 * s))
                case "l": p.move(to: CGPoint(x: 2.5 * s, y: 2.5 * s)); p.addLine(to: CGPoint(x: 2.5 * s, y: 13.5 * s))
                case "r": p.move(to: CGPoint(x: 13.5 * s, y: 2.5 * s)); p.addLine(to: CGPoint(x: 13.5 * s, y: 13.5 * s))
                case "h": p.move(to: CGPoint(x: 2.5 * s, y: 8 * s)); p.addLine(to: CGPoint(x: 13.5 * s, y: 8 * s))
                default: p.move(to: CGPoint(x: 8 * s, y: 2.5 * s)); p.addLine(to: CGPoint(x: 8 * s, y: 13.5 * s))
                }
                return p
            }
            let on = Set(Self.segments[preset] ?? [])
            for k in ["t", "b", "l", "r", "h", "v"] {
                if on.contains(k) {
                    ctx.stroke(seg(k), with: .color(NX.foreground), lineWidth: 1.6 * s)
                } else {
                    ctx.stroke(seg(k), with: .color(NX.mutedFg.opacity(0.5)), style: StrokeStyle(lineWidth: s, dash: [s, 1.5 * s]))
                }
            }
        }
        .frame(width: 18, height: 18)
    }
}

/// The Borders panel: two rows of five presets, then the line style and colour (they stick per device).
struct SheetGridBordersPanel: View {
    let onApply: (String, String, String?) -> Void
    @AppStorage("nexus.sheet.border.line") private var line = "thin"
    @AppStorage("nexus.sheet.border.color") private var color = ""
    @State private var pickingColor = false

    static let presetLabels: [String: String] = [
        "all": "All borders", "inner": "Inner borders", "horizontal": "Horizontal borders", "vertical": "Vertical borders",
        "outer": "Outer borders", "left": "Left border", "top": "Top border", "right": "Right border", "bottom": "Bottom border",
        "clear": "Clear borders",
    ]
    static let lineLabels: [(String, String)] = [("thin", "Thin"), ("medium", "Medium"), ("thick", "Thick"),
                                                  ("dotted", "Dotted"), ("dashed", "Dashed"), ("double", "Double")]

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            ForEach([Array(SheetGridStyle.presets.prefix(5)), Array(SheetGridStyle.presets.suffix(5))], id: \.self) { row in
                HStack(spacing: 4) {
                    ForEach(row, id: \.self) { p in
                        Button { onApply(p, line, color.isEmpty ? nil : color) } label: {
                            SheetBorderGlyph(preset: p)
                                .frame(width: 36, height: 34)
                                .background(NX.muted.opacity(0.6), in: RoundedRectangle(cornerRadius: 7, style: .continuous))
                                .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel(T(Self.presetLabels[p] ?? p))
                    }
                }
            }
            Divider()
            HStack(spacing: 10) {
                Menu {
                    Picker(T("Border style"), selection: $line) {
                        ForEach(Self.lineLabels.indices, id: \.self) { i in Text(T(Self.lineLabels[i].1)).tag(Self.lineLabels[i].0) }
                    }
                } label: {
                    Label(T(Self.lineLabels.first { $0.0 == line }?.1 ?? "Thin"), systemImage: "line.3.horizontal")
                        .font(NXFont.text(13, .medium))
                }
                .accessibilityLabel(T("Border style"))
                Spacer()
                Button { pickingColor.toggle() } label: {
                    HStack(spacing: 6) {
                        Circle().fill(color.isEmpty ? NX.foreground : Color(uiColor: SheetBridge.hexColor(color) ?? .label)).frame(width: 14, height: 14)
                        Text(T("Border colour")).font(NXFont.text(13, .medium))
                    }
                }
                .buttonStyle(.borderless)
            }
            if pickingColor {
                SheetGridPalette(selected: color.isEmpty ? nil : color, resetTitle: T("Default")) { hex in
                    color = hex ?? ""
                    pickingColor = false
                }
            }
        }
        .padding(12)
    }
}

/// A format-bar button that opens a popover (colours, borders) on iPad / Mac.
struct SheetPopoverButton<Content: View>: View {
    let icon: String
    let label: String
    var swatch: Color? = nil
    @ViewBuilder let content: (_ close: @escaping () -> Void) -> Content
    @State private var open = false

    var body: some View {
        Button { open = true } label: {
            VStack(spacing: 1) {
                Image(systemName: icon).font(.system(size: 14, weight: .medium)).foregroundStyle(NX.foreground)
                if let swatch {
                    RoundedRectangle(cornerRadius: 1).fill(swatch).frame(width: 16, height: 3)
                }
            }
            .frame(width: 34, height: 32)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .hoverEffect(.highlight)
        .accessibilityLabel(label)
        .popover(isPresented: $open) {
            content({ open = false })
                .presentationCompactAdaptation(.popover)
        }
    }
}

/// iPhone: everything the iPad / Mac format bar holds, in one sheet.
struct SheetGridFormatSheet: View {
    @Bindable var store: SheetStore
    @Environment(\.dismiss) private var dismiss
    /// The custom number format pages pushed from the Number section.
    @State private var path: [SheetNumFmtPanel.Kind] = []

    private var st: [String: Any] { store.activeStyle }

    var body: some View {
        NavigationStack(path: $path) {
            Form {
                Section(T("Text")) {
                    toggleRow(T("Bold"), "b", T("bold"))
                    toggleRow(T("Italic"), "i", T("italic"))
                    toggleRow(T("Underline"), "u", T("underline"))
                    toggleRow(T("Strikethrough"), "s", T("strikethrough"))
                    Picker(T("Font size"), selection: Binding(get: { Int(store.activeFontPt) }, set: { store.setFontSize($0) })) {
                        ForEach(SheetGridStyle.fontSizesPt, id: \.self) { Text("\($0)").tag($0) }
                    }
                    SheetFontFamilyPicker(store: store)
                    SheetRotationPicker(store: store)
                    NavigationLink(T("Text colour")) {
                        ScrollView { SheetGridPalette(selected: st["fc"] as? String, resetTitle: T("Reset")) { store.setTextColor($0) } }
                            .navigationTitle(T("Text colour"))
                    }
                    NavigationLink(T("Fill colour")) {
                        ScrollView { SheetGridPalette(selected: st["bg"] as? String, resetTitle: T("Reset")) { store.setFillColor($0) } }
                            .navigationTitle(T("Fill colour"))
                    }
                }
                Section(T("Alignment")) {
                    Picker(T("Horizontal align"), selection: Binding(get: { st["ha"] as? String ?? "" }, set: { v in
                        store.patchSelection(["ha": v.isEmpty ? nil : v], label: T("alignment"))
                    })) {
                        Text(T("Automatic")).tag("")
                        Text(T("Left")).tag("l")
                        Text(T("Centre")).tag("c")
                        Text(T("Right")).tag("r")
                    }
                    Picker(T("Vertical align"), selection: Binding(get: { st["va"] as? String ?? "b" }, set: { store.setVerticalAlign($0) })) {
                        Text(T("Top")).tag("t")
                        Text(T("Middle")).tag("m")
                        Text(T("Bottom")).tag("b")
                    }
                    Picker(T("Text wrapping"), selection: Binding(get: { SheetGridStyle.wrapMode(st) }, set: { store.setWrapMode($0) })) {
                        Text(T("Overflow")).tag("o")
                        Text(T("Wrap")).tag("w")
                        Text(T("Clip")).tag("c")
                    }
                }
                Section(T("Borders")) {
                    SheetGridBordersPanel { preset, line, color in store.applyBorders(preset, line: line, color: color) }
                        .listRowInsets(EdgeInsets())
                }
                Section(T("Merge cells")) {
                    Button(T("Merge all")) { Task { await store.merge("all") } }.disabled(!store.canMerge)
                    Button(T("Merge vertically")) { Task { await store.merge("vertical") } }.disabled(!store.canMerge || store.selection.current.rowCount < 2)
                    Button(T("Merge horizontally")) { Task { await store.merge("horizontal") } }.disabled(!store.canMerge || store.selection.current.colCount < 2)
                    Button(T("Unmerge")) { Task { await store.merge("unmerge") } }.disabled(store.mergedHere.isEmpty)
                }
                Section(T("Number")) {
                    SheetNumberFormatPicker(store: store)
                    NavigationLink(T("Custom currency…"), value: SheetNumFmtPanel.Kind.currency)
                    NavigationLink(T("Custom date and time…"), value: SheetNumFmtPanel.Kind.date)
                    NavigationLink(T("Custom number format…"), value: SheetNumFmtPanel.Kind.number)
                    HStack {
                        Text(T("Decimal places"))
                        Spacer()
                        Button { store.changeDecimals(-1) } label: { Image(systemName: "minus") }.buttonStyle(.bordered)
                        Button { store.changeDecimals(1) } label: { Image(systemName: "plus") }.buttonStyle(.bordered)
                    }
                }
                Section {
                    Button(T("Clear formatting"), role: .destructive) {
                        store.setStyles(label: T("clear formatting")) { old in
                            // A note is content, not format (web clearFormat).
                            if let nt = old["nt"] { return ["nt": nt] }
                            return [:]
                        }
                    }
                }
            }
            .navigationTitle(T("Format"))
            .navigationBarTitleDisplayMode(.inline)
            .navigationDestination(for: SheetNumFmtPanel.Kind.self) { kind in
                SheetNumFmtContent(store: store, kind: kind) { pattern in
                    store.setCustomFormat(pattern)
                    path.removeAll()
                }
            }
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button(T("Done")) { dismiss() } } }
        }
        .presentationDetents([.medium, .large])
    }

    private func toggleRow(_ title: String, _ key: String, _ label: String) -> some View {
        Toggle(title, isOn: Binding(get: { store.activeStyle[key] != nil }, set: { _ in store.toggleStyleFlag(key, label: label) }))
    }
}

/// The number formats the app offers (a compact subset of the web's "123" menu).
struct SheetNumberFormatPicker: View {
    let store: SheetStore

    static let formats: [(String?, String)] = [
        (nil, "Automatic"), ("text", "Plain text"), ("num", "Number"), ("pct", "Percent"), ("sci", "Scientific"),
        ("acct", "Accounting"), ("idr", "Rupiah"), ("date", "Date"), ("time", "Time"), ("dt", "Date time"), ("dur", "Duration"),
    ]

    var body: some View {
        Picker(T("Number format"), selection: Binding(get: { store.activeStyle["nf"] as? String ?? "" }, set: { v in
            store.patchSelection(["nf": v.isEmpty ? nil : v, "dp": nil, "pt": nil], label: T("number format"))
        })) {
            ForEach(Self.formats.indices, id: \.self) { i in
                Text(T(Self.formats[i].1)).tag(Self.formats[i].0 ?? "")
            }
        }
    }
}

/// Font family (`ff`): the web's list, each name in its own look; Default = the app font.
struct SheetFontFamilyPicker: View {
    let store: SheetStore

    var body: some View {
        Picker(T("Font"), selection: Binding(get: { SheetGridText.family(store.activeStyle) ?? "" }, set: { v in
            store.setFontFamily(v.isEmpty ? nil : v)
        })) {
            Text(T("Default (Sans Serif)")).tag("")
            ForEach(SheetGridText.fontFamilies.indices, id: \.self) { i in
                let name = SheetGridText.fontFamilies[i].name
                Text(name).font(SheetGridFonts.preview(name)).tag(name)
            }
            if let ff = SheetGridText.family(store.activeStyle), !SheetGridText.fontFamilies.contains(where: { $0.name.lowercased() == ff.lowercased() }) {
                Text(ff).tag(ff)
            }
        }
    }
}

/// Text rotation (`rt`): Sheets' presets, and a custom angle in 15° steps.
struct SheetRotationPicker: View {
    let store: SheetStore

    private static func tag(_ value: Any?) -> String {
        if let s = value as? String { return s }
        if let n = value as? Int { return "\(n)" }
        return "0"
    }

    private var current: SheetGridText.Rotation { SheetGridText.rotation(store.activeStyle) }
    private var currentTag: String { current.vertical ? "v" : "\(Int(current.degrees))" }

    var body: some View {
        Picker(T("Text rotation"), selection: Binding(get: { currentTag }, set: { tag in
            if tag == "v" { store.setRotation("v") } else { store.setRotation(Int(tag) ?? 0) }
        })) {
            ForEach(SheetGridText.rotationPresets.indices, id: \.self) { i in
                let p = SheetGridText.rotationPresets[i]
                Text(T(p.label)).tag(Self.tag(p.value))
            }
            if !SheetGridText.rotationPresets.contains(where: { Self.tag($0.value) == currentTag }) {
                Text(T("Custom angle")).tag(currentTag)
            }
        }
        if !current.vertical {
            Stepper(value: Binding(get: { Int(current.degrees) }, set: { store.setRotation($0) }), in: -90...90, step: 15) {
                HStack {
                    Text(T("Custom angle"))
                    Spacer()
                    Text("\(Int(current.degrees))°").monospacedDigit().foregroundStyle(NX.mutedFg)
                }
            }
        }
    }
}
