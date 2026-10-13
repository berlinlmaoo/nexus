import SwiftUI

// Format ▸ Number ▸ Custom number format / Custom date and time / Custom currency (web FormatDialogs.tsx over
// lib/sheet-numfmt.ts → SheetNumFmt). Every example renders in the SHEET locale through the grid's own
// formatter (colour sections like [Red] included), so what the list shows is what the cell shows. Applying
// stores style nf "custom" + pt <pattern> on the selection (decimals dropped), like the web. The content
// views are also pushed from the iPhone Format sheet.

struct SheetNumFmtPanel: View {
    enum Kind { case number, date, currency }

    let ctx: SheetPanelContext
    let kind: Kind
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            SheetNumFmtContent(store: ctx.store, kind: kind) { pattern in
                ctx.store.setCustomFormat(pattern)
                dismiss()
            }
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button(T("Cancel")) { dismiss() } } }
        }
        .spPanelPresentation()
    }
}

/// One of the three dialogs, without its own navigation (a panel, or a page of the Format sheet).
struct SheetNumFmtContent: View {
    let store: SheetStore
    let kind: SheetNumFmtPanel.Kind
    let onApply: (String) -> Void

    var body: some View {
        switch kind {
        case .number:
            SheetCustomNumberView(locale: store.sheetLocale, initial: store.activeCustomPattern,
                                  sample: store.activeNumber ?? 1234.56, onApply: onApply)
                .navigationTitle(T("Custom number formats"))
                .navigationBarTitleDisplayMode(.inline)
        case .date:
            SheetCustomDateView(locale: store.sheetLocale, initial: store.activeCustomPattern,
                                sample: store.activeNumber ?? SheetNumFmt.DATE_SAMPLE, onApply: onApply)
                .navigationTitle(T("Custom date and time formats"))
                .navigationBarTitleDisplayMode(.inline)
        case .currency:
            SheetCustomCurrencyView(locale: store.sheetLocale, onApply: onApply)
                .navigationTitle(T("Custom currencies"))
                .navigationBarTitleDisplayMode(.inline)
        }
    }
}

/// A sample in its format's colour ([Red] etc.).
struct SheetFormatSample: View {
    let value: SheetCellValue
    let pattern: String
    let locale: String
    var muted = false

    var body: some View {
        let r = SheetNumFmt.formatPattern(value, pattern, locale)
        Text(r.text)
            .font(NXFont.text(13))
            .monospacedDigit()
            .foregroundStyle(Self.color(r.color, muted: muted))
            .lineLimit(1)
    }

    static func color(_ hex: String?, muted: Bool) -> Color {
        if let hex, let ui = SheetBridge.hexColor(hex) { return Color(uiColor: ui) }
        return muted ? NX.mutedFg : NX.foreground
    }
}

// MARK: - custom number format

private enum SheetRecentFormats {
    static let key = "nexus.sheet.recentFormats"

    static func read() -> [String] { Array((UserDefaults.standard.stringArray(forKey: key) ?? []).prefix(8)) }

    static func push(_ p: String) {
        let next = [p] + read().filter { $0 != p }
        UserDefaults.standard.set(Array(next.prefix(8)), forKey: key)
    }
}

struct SheetCustomNumberView: View {
    let locale: String
    let initial: String?
    let sample: Double
    let onApply: (String) -> Void
    @State private var pattern = ""
    @State private var recent: [String] = []

    var body: some View {
        Form {
            Section {
                HStack(spacing: 8) {
                    TextField(T("Custom number format"), text: $pattern)
                        .font(.system(size: 14, design: .monospaced))
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .onSubmit(apply)
                    Button(T("Apply"), action: apply)
                        .buttonStyle(.borderedProminent).tint(NX.violet)
                        .disabled(SheetJS.trim(pattern).isEmpty)
                }
                HStack {
                    Text(T("Example:")).font(NXFont.text(12)).foregroundStyle(NX.mutedFg)
                    SheetFormatSample(value: .number(sample), pattern: SheetJS.trim(pattern).isEmpty ? "General" : SheetJS.trim(pattern), locale: locale)
                }
            }
            if !recent.isEmpty {
                Section(T("Recently used")) {
                    ForEach(recent, id: \.self) { p in presetRow(p) }
                }
            }
            Section {
                ForEach(SheetNumFmt.NUMBER_PRESETS.filter { !recent.contains($0) }, id: \.self) { p in presetRow(p) }
            }
        }
        .onAppear {
            if pattern.isEmpty { pattern = initial ?? "" }
            recent = SheetRecentFormats.read()
        }
    }

    private func presetRow(_ p: String) -> some View {
        Button { pattern = p } label: {
            HStack(spacing: 8) {
                Text(p).font(.system(size: 12, design: .monospaced)).foregroundStyle(NX.foreground).lineLimit(1)
                Spacer(minLength: 8)
                SheetFormatSample(value: p == "@" ? .text(SheetJS.numberToString(sample)) : .number(sample), pattern: p, locale: locale, muted: true)
                if p == pattern { Image(systemName: "checkmark").font(.system(size: 12, weight: .semibold)).foregroundStyle(NX.violetText) }
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    private func apply() {
        let p = SheetJS.trim(pattern)
        guard !p.isEmpty else { return }
        SheetRecentFormats.push(p)
        onApply(p)
    }
}

// MARK: - custom date and time

struct SheetCustomDateView: View {
    let locale: String
    let initial: String?
    let sample: Double
    let onApply: (String) -> Void
    @State private var parts: [SheetNumFmt.DatePart] = []

    private var shown: Double { sample.isFinite && sample > 0 ? sample : SheetNumFmt.DATE_SAMPLE }
    private var pattern: String { SheetNumFmt.joinDatePattern(parts) }

    var body: some View {
        Form {
            Section {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 2) {
                        ForEach(parts.indices, id: \.self) { i in partView(i) }
                        addMenu
                    }
                    .padding(.vertical, 4)
                }
                HStack {
                    Text(T("Example:")).font(NXFont.text(12)).foregroundStyle(NX.mutedFg)
                    SheetFormatSample(value: .number(shown), pattern: pattern.isEmpty ? "General" : pattern, locale: locale)
                    Spacer(minLength: 8)
                    Button(T("Apply")) { if !pattern.isEmpty { onApply(pattern) } }
                        .buttonStyle(.borderedProminent).tint(NX.violet)
                        .disabled(pattern.isEmpty)
                }
            }
            Section {
                ForEach(SheetNumFmt.datePresets(locale), id: \.self) { p in
                    Button { parts = Self.normalize(SheetNumFmt.parseDatePattern(p)) } label: {
                        HStack {
                            SheetFormatSample(value: .number(SheetNumFmt.DATE_SAMPLE), pattern: p, locale: locale)
                            Spacer(minLength: 8)
                            if p == pattern { Image(systemName: "checkmark").font(.system(size: 12, weight: .semibold)).foregroundStyle(NX.violetText) }
                        }
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(p)
                }
            }
        }
        .onAppear {
            if parts.isEmpty { parts = Self.normalize(SheetNumFmt.parseDatePattern(initial ?? "yyyy-mm-dd")) }
        }
    }

    @ViewBuilder private func partView(_ i: Int) -> some View {
        switch parts[i] {
        case .lit(let text):
            TextField("", text: Binding(get: { Self.litText(parts, i) }, set: { setPart(i, .lit($0)) }))
                .font(NXFont.text(13))
                .multilineTextAlignment(.center)
                .frame(width: max(14, CGFloat(text.count) * 8 + 10))
                .accessibilityLabel(T("Separator text"))
        case .token(let field, let code):
            tokenMenu(i, field: field, code: code)
        }
    }

    private func tokenMenu(_ i: Int, field: SheetNumFmt.DateField, code: String) -> some View {
        let info = SheetNumFmt.DATE_FIELDS.first { $0.field == field }
        let label = T(info?.label ?? field.rawValue)
        return Menu {
            ForEach(info?.codes ?? [], id: \.self) { c in
                Button { setPart(i, .token(field: field, code: c)) } label: {
                    if c == code { Label(SheetNumFmt.datePartSample(field, c, locale, shown), systemImage: "checkmark") } else { Text(SheetNumFmt.datePartSample(field, c, locale, shown)) }
                }
            }
            Divider()
            Button(role: .destructive) { setPart(i, nil) } label: { Label(T("Remove"), systemImage: "trash") }
        } label: {
            HStack(spacing: 3) {
                Text("\(label) (\(SheetNumFmt.datePartSample(field, code, locale, shown)))").font(NXFont.text(12, .medium)).lineLimit(1)
                Image(systemName: "chevron.down").font(.system(size: 8, weight: .semibold))
            }
            .foregroundStyle(NX.foreground)
            .padding(.horizontal, 6).frame(height: 26)
            .background(NX.muted, in: RoundedRectangle(cornerRadius: 5, style: .continuous))
        }
        .accessibilityLabel(T("Change %@ format").replacingOccurrences(of: "%@", with: label))
    }

    private var addMenu: some View {
        Menu {
            ForEach(SheetNumFmt.DATE_FIELDS.indices, id: \.self) { k in
                let f = SheetNumFmt.DATE_FIELDS[k]
                Button("\(T(f.label)) · \(SheetNumFmt.datePartSample(f.field, f.codes[0], locale, shown))") {
                    parts = Self.normalize(parts + [.token(field: f.field, code: f.codes[0])])
                }
            }
        } label: {
            Image(systemName: "plus.circle").font(.system(size: 17)).frame(width: 30, height: 26)
        }
        .accessibilityLabel(T("Add date or time format"))
    }

    private static func litText(_ parts: [SheetNumFmt.DatePart], _ i: Int) -> String {
        guard parts.indices.contains(i), case .lit(let t) = parts[i] else { return "" }
        return t
    }

    private func setPart(_ i: Int, _ p: SheetNumFmt.DatePart?) {
        guard parts.indices.contains(i) else { return }
        var next = parts
        if let p { next[i] = p } else { next.remove(at: i) }
        parts = Self.normalize(next)
    }

    /// Always a literal between two chips (and at both ends) so separators can be typed anywhere (web normalizeParts).
    static func normalize(_ parts: [SheetNumFmt.DatePart]) -> [SheetNumFmt.DatePart] {
        var out: [SheetNumFmt.DatePart] = []
        for p in parts {
            switch p {
            case .lit(let t):
                if case .lit(let prev)? = out.last { out[out.count - 1] = .lit(prev + t) } else { out.append(.lit(t)) }
            case .token:
                if case .lit? = out.last {} else { out.append(.lit("")) }
                out.append(p)
            }
        }
        if case .lit? = out.last {} else { out.append(.lit("")) }
        return out
    }
}

// MARK: - custom currency

struct SheetCustomCurrencyView: View {
    let locale: String
    let onApply: (String) -> Void
    @State private var query = ""
    @State private var variant = "symbol"
    @State private var code = ""

    private static let variantLabel: [String: String] = [
        "symbol": "Symbol first", "symbolRounded": "Symbol first, rounded", "symbolParen": "Negative in brackets",
        "symbolRed": "Negative in red", "symbolAfter": "Symbol after", "code": "Currency code",
    ]

    private var list: [SheetNumFmt.Currency] {
        let q = SheetJS.trim(query).lowercased()
        guard !q.isEmpty else { return SheetNumFmt.CURRENCIES }
        return SheetNumFmt.CURRENCIES.filter { c in
            [c.code, c.symbol, c.nameEn, c.nameId].contains { $0.lowercased().contains(q) }
        }
    }

    private var current: String { code.isEmpty ? (locale == "en-US" ? "USD" : "IDR") : code }

    var body: some View {
        Form {
            Section {
                TextField(T("Search currencies"), text: $query)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                Picker(T("Currency format"), selection: $variant) {
                    ForEach(SheetNumFmt.CURRENCY_VARIANTS, id: \.self) { v in
                        Text("\(SheetNumFmt.formatPattern(.number(-1000), SheetNumFmt.currencyPattern(current, v), locale).text) · \(T(Self.variantLabel[v] ?? v))").tag(v)
                    }
                }
                Button(T("Apply")) { onApply(SheetNumFmt.currencyPattern(current, variant)) }
                    .buttonStyle(.borderedProminent).tint(NX.violet)
            }
            Section {
                if list.isEmpty {
                    Text(T("No currencies match")).font(NXFont.text(13)).foregroundStyle(NX.mutedFg)
                }
                ForEach(list, id: \.code) { c in row(c) }
            }
        }
    }

    private func row(_ c: SheetNumFmt.Currency) -> some View {
        Button { code = c.code } label: {
            HStack(spacing: 8) {
                Text(AppLanguage.shared.lang == .id ? c.nameId : c.nameEn).font(NXFont.text(13)).foregroundStyle(NX.foreground).lineLimit(1)
                Text("(\(c.code))").font(NXFont.text(12)).foregroundStyle(NX.mutedFg)
                Spacer(minLength: 8)
                SheetFormatSample(value: .number(1000.12), pattern: SheetNumFmt.currencyPattern(c.code, variant), locale: locale, muted: true)
                if c.code == current { Image(systemName: "checkmark").font(.system(size: 12, weight: .semibold)).foregroundStyle(NX.violetText) }
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}
