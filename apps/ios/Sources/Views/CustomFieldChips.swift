import SwiftUI

/// A rendered custom-field value chip for a board/list card.
struct CFChip: Identifiable, Equatable {
    let id: String
    let label: String
    let tone: ChipTone
    /// A select option's colour (web choiceColor: the palette by the option's position); nil = tone.
    var colorKey: String? = nil
    /// A date value: drawn like web's PropValue date (calendar icon + muted text, no pill), so two date
    /// fields on one card read as dates and the field name is spoken (UI tour run 7).
    var isDate = false
    var fieldName: String? = nil
    /// A date field holding a name, not a date: Notion imports filled "Request by" (a Created-time field)
    /// with who asked. Drawn as that person — a grey pill with a person icon — not as a date with a
    /// clock (web PropValue, UI tour run 9).
    var isPerson = false
    /// A NUMBER value: its field's style and the bar / ring fill, so a card can draw Show as.
    var number: CFNumberChip? = nil
}

/// A NUMBER chip's drawing data (CustomFieldNumber.Style + fill 0…1).
struct CFNumberChip: Equatable {
    let style: CustomFieldNumber.Style
    let fill: Double
    /// Bar or Ring: drawn as CFNumberValue, not as a text pill.
    var isVisual: Bool { style.showAs != .number }
}

// Formatters are expensive to construct — build once and reuse. `customFieldChip` runs per card
// per render while scrolling, so a fresh NumberFormatter/DateFormatter each call was real jank.
private let cfYMD: DateFormatter = {
    let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"; f.timeZone = ProjDate.cal.timeZone
    return f
}()
private let cfDecoder = JSONDecoder()   // reused — a fresh JSONDecoder per chip per scroll was an allocation hit

/// A custom date value as a day: an ISO timestamp or "yyyy-MM-dd…"; nil for anything else (a name).
func cfParseDay(_ s: String) -> Date? {
    if let d = ProjDate.parse(s) { return d }
    return cfYMD.date(from: String(s.prefix(10)))
}

/// A date field that holds names, not dates: Notion's created-by / created-time import ("Request by")
/// filled it with who asked. True when most of its filled values on these tasks are not dates.
func cfFieldHoldsNames(_ fieldId: String, in tasks: [BoardTask]) -> Bool {
    var names = 0, dates = 0
    for t in tasks {
        guard let raw = t.customFieldValues?.first(where: { $0.customFieldId == fieldId })?.value?
            .trimmingCharacters(in: .whitespaces), !raw.isEmpty else { continue }
        if cfParseDay(raw) == nil { names += 1 } else { dates += 1 }
    }
    return names > dates
}

/// Port of the web `cfStatusTone` — colors a STATUS value.
func cfStatusTone(_ v: String) -> ChipTone {
    // Normalize "_"/"-" to spaces and collapse runs (was a per-call regex) — split/join is cheaper.
    let spaced = String(v.lowercased().map { ($0 == "_" || $0 == "-") ? " " : $0 })
    let s = spaced.split(separator: " ", omittingEmptySubsequences: true).joined(separator: " ")
    if ["done", "complete", "completed", "selesai"].contains(s) { return .success }
    if ["on progress", "in progress", "progress", "ongoing", "sedang berjalan"].contains(s) { return .warning }
    if ["blocked", "stuck", "terhambat"].contains(s) { return .danger }
    if ["not started", "todo", "to do"].contains(s) { return .neutral }
    return .info
}

/// Port of the web `customFieldChip` — turns a stored value into a labelled chip.
func customFieldChip(_ cfv: BoardTask.CFValue) -> CFChip? {
    let type = (cfv.customField?.type ?? "").uppercased()
    let raw = (cfv.value ?? "").trimmingCharacters(in: .whitespaces)
    guard !raw.isEmpty else { return nil }

    func parseDay(_ s: String) -> Date? { cfParseDay(s) }

    switch type {
    case "NUMBER":
        // The field's Number format (Notion style, run 14): "Rp 369.000", "42%", "US$1.234,50"…, always
        // with id-ID grouping; Rupiah still reads legacy "369.000" as 369 000 (CustomFieldNumber.swift).
        let style = cfv.customField?.options?.numberStyle ?? .plain
        guard let value = CustomFieldNumber.decimal(raw, style: style) else {
            let label = CustomFieldNumber.display(raw, style: style)
            return label.isEmpty ? nil : CFChip(id: cfv.customFieldId, label: label, tone: .neutral)
        }
        return CFChip(id: cfv.customFieldId, label: CustomFieldNumber.format(value, style: style), tone: .neutral,
                      fieldName: cfv.customField?.name,
                      number: CFNumberChip(style: style, fill: CustomFieldNumber.fill(value, style: style)))
    case "STATUS":
        return CFChip(id: cfv.customFieldId, label: raw, tone: cfStatusTone(raw))
    case "MULTI_SELECT":
        if let data = raw.data(using: .utf8), let arr = try? cfDecoder.decode([String].self, from: data) {
            let s = arr.joined(separator: ", ")
            return s.isEmpty ? nil : CFChip(id: cfv.customFieldId, label: s, tone: .neutral)
        }
        return CFChip(id: cfv.customFieldId, label: raw, tone: .neutral)
    case "PLACE":
        if let data = raw.data(using: .utf8), let o = try? cfDecoder.decode([String: String].self, from: data),
           let l = o["label"], !l.isEmpty {
            return CFChip(id: cfv.customFieldId, label: l, tone: .neutral)
        }
        return nil
    case "DATE", "CREATED":
        guard let day = parseDay(raw) else {
            return CFChip(id: cfv.customFieldId, label: raw, tone: .neutral, fieldName: cfv.customField?.name, isPerson: true)
        }
        return CFChip(id: cfv.customFieldId, label: ProjDate.dayLabel(day), tone: .neutral, isDate: true, fieldName: cfv.customField?.name)
    case "SELECT":
        return CFChip(id: cfv.customFieldId, label: raw, tone: .neutral, colorKey: choiceColorKey(raw, choices: cfv.customField?.options?.list ?? []))
    default:
        return CFChip(id: cfv.customFieldId, label: raw, tone: .neutral)
    }
}

/// The colour a select option draws in: the option palette by its position (gray and brown are left
/// for "none"), else a stable hash of the text — the web's choiceColor.
func choiceColorKey(_ value: String, choices: [String]) -> String {
    let palette = StatusColor.keys.filter { $0 != "gray" && $0 != "brown" }
    if let i = choices.firstIndex(of: value) { return palette[i % palette.count] }
    var h: UInt32 = 0
    for u in value.unicodeScalars { h = h &* 31 &+ u.value }
    return palette[Int(h % UInt32(palette.count))]
}

/// Compact, single-line chip for cards.
struct CFChipView: View {
    let chip: CFChip
    var body: some View {
        if let n = chip.number, n.isVisual {
            // Show as Bar / Ring: the number (unless hidden) and a short bar or a ring, no pill.
            CFNumberValue(text: chip.label, style: n.style, fill: n.fill, font: NXFont.text(10, .semibold), color: NX.mutedFg, barWidth: 40)
        } else if chip.isPerson {
            // A text value that names someone ("Request by" holding "Sifal") is text, not a person: the text
            // glyph and the field's name, never an assignee-looking chip (decision 5 of run 19, R19-M-05).
            // The web's "T" text glyph, as every text property (decision 2 of run 20, R20-B-11; it was "≡").
            Label { Text(chip.fieldName.map { "\($0): \(chip.label)" } ?? chip.label) } icon: { TextPropertyGlyph(size: 10) }
                .font(NXFont.text(10, .medium)).lineLimit(1)
                .labelStyle(CFPersonLabelStyle())
                .padding(.vertical, 3)
                .foregroundStyle(NX.mutedFg)
                .accessibilityLabel(chip.fieldName.map { "\($0): \(chip.label)" } ?? chip.label)
        } else if chip.isDate {
            // A date field wears the calendar; the clock is the due date's alone (web PropValue / DateChips,
            // UI tour run 10, IP-3: both dates on a card had a clock).
            // Named as web WD-4 does ("Request by 15 Apr", "Tanggal Penggunaan 4 Jul"): a bare date read like a due
            // date, and three in a row said nothing (UI tour run 20, R20-B-03).
            Label(chip.fieldName.map { "\($0) \(chip.label)" } ?? chip.label, systemImage: "calendar")
                .font(NXFont.text(11)).foregroundStyle(NX.mutedFg).lineLimit(1)
                .padding(.vertical, 2)
                .accessibilityLabel(chip.fieldName.map { "\($0): \(chip.label)" } ?? chip.label)
        } else if let key = chip.colorKey {
            let sw = StatusColor.swatch(key)
            Text(chip.label).font(NXFont.text(10, .semibold)).lineLimit(1)
                .padding(.horizontal, 7).padding(.vertical, 3)
                .foregroundStyle(sw.fg).background(sw.bg, in: RoundedRectangle(cornerRadius: 4, style: .continuous))
        } else if chip.number != nil {
            // Money and other numbers as plain text on the meta line, no grey chip, as the web card (UI tour run 20,
            // R20-B-12, decision 22).
            Text(chip.label).font(NXFont.text(11, .medium)).foregroundStyle(NX.mutedFg).monospacedDigit().lineLimit(1)
                .padding(.vertical, 2)
        } else {
            Text(chip.label).font(NXFont.text(10, .semibold)).lineLimit(1)
                .padding(.horizontal, 7).padding(.vertical, 3)
                .foregroundStyle(chip.tone.fg).background(chip.tone.bg, in: Capsule())
        }
    }
}

/// Icon and name close together, like web's pill (gap 4).
/// The web's text-property glyph (lucide "Type"): a plain "T". SF Symbols has no bare T, so it is a letter drawn
/// at the size and weight of the symbols beside it. `symbol` stands for it wherever an icon name is passed on.
struct TextPropertyGlyph: View {
    static let symbol = "nx.text"
    var size: CGFloat = 12

    var body: some View {
        Text(verbatim: "T").font(.system(size: size * 1.1, weight: .medium)).frame(minWidth: size)
            .accessibilityHidden(true)
    }

    /// The text glyph for `symbol`, else that SF Symbol.
    @ViewBuilder static func icon(_ name: String, size: CGFloat) -> some View {
        if name == symbol { TextPropertyGlyph(size: size) } else { Image(systemName: name).font(.system(size: size)) }
    }
}

private struct CFPersonLabelStyle: LabelStyle {
    func makeBody(configuration: Configuration) -> some View {
        HStack(spacing: 4) { configuration.icon.imageScale(.small); configuration.title }
    }
}

/// Wrapping chip row for a task's custom-field values (board / list / calendar / timeline cards).
struct CFChipRow: View {
    let values: [BoardTask.CFValue]?
    /// The fields this project has, when known: a card linked in from another project carries that
    /// project's fields too ("PATS Foundation" from SBU's own Category), which the web never draws — its
    /// card shows the viewing project's properties only (UI tour run 10, IP-3). nil = show every value.
    var only: Set<String>? = nil
    /// The card's due day as it is drawn ("26 May"), when it has one: a date field saying the same day is
    /// left out, and the card shows two dates at most, then "+N", as the web card (UI tour run 15, Q-M11 /
    /// R15-I-13: "26 May 31 May ⏱ 26 May", "15 May 15 May"). nil = every date, as before.
    var capDates = false
    var due: String? = nil
    /// A task's priority, drawn as the first item of the same flow: beside the row, the chips wrapped under its
    /// second chip, not at the card's text edge (UI tour run 20, iPhone R20-I-08, R20-B-13).
    var priority: String? = nil
    var body: some View {
        let all = (values ?? []).filter { only?.contains($0.customFieldId) ?? true }.compactMap(customFieldChip)
        let (chips, hidden) = capDates ? Self.capped(all, due: due) : (all, 0)
        let prio = priority.flatMap { $0.uppercased() == "NONE" ? nil : $0 }
        if !chips.isEmpty || hidden > 0 || prio != nil {
            FlowLayout(spacing: 5) {
                if let prio { PriorityPill(priority: prio).fixedSize() }
                ForEach(chips) { CFChipView(chip: $0) }
                if hidden > 0 {
                    Text("+\(hidden)").font(NXFont.text(11, .semibold)).foregroundStyle(NX.mutedFg)
                        .accessibilityLabel(String(format: T("%d more dates"), hidden))
                }
            }
        }
    }

    private static func capped(_ chips: [CFChip], due: String?) -> ([CFChip], Int) {
        var seen = Set([due].compactMap { $0 })
        var room = due == nil ? 2 : 1
        var hidden = 0
        var out: [CFChip] = []
        for c in chips {
            guard c.isDate else { out.append(c); continue }
            guard seen.insert(c.label).inserted else { continue }
            if room > 0 { out.append(c); room -= 1 } else { hidden += 1 }
        }
        return (out, hidden)
    }
}

/// Minimal flow (wrap) layout — iOS 16+.
struct FlowLayout: Layout {
    var spacing: CGFloat = 6

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let maxW = proposal.width ?? .greatestFiniteMagnitude
        var x: CGFloat = 0, y: CGFloat = 0, rowH: CGFloat = 0
        for v in subviews {
            let s = v.sizeThatFits(.unspecified)
            if x > 0 && x + s.width > maxW { x = 0; y += rowH + spacing; rowH = 0 }
            x += s.width + spacing; rowH = max(rowH, s.height)
        }
        return CGSize(width: proposal.width ?? x, height: y + rowH)
    }
    /// Each line's items are centred on the line, so a plain "Rp 350.000" sits level with the taller chips
    /// beside it instead of riding above their middle (UI tour run 15, R15-I-12 / Q-IA24).
    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var lines: [[(index: Int, size: CGSize)]] = [[]]
        var x = bounds.minX
        for (i, v) in subviews.enumerated() {
            let s = v.sizeThatFits(.unspecified)
            if x > bounds.minX && x + s.width > bounds.maxX { lines.append([]); x = bounds.minX }
            lines[lines.count - 1].append((i, s))
            x += s.width + spacing
        }
        var y = bounds.minY
        for line in lines where !line.isEmpty {
            let rowH = line.map(\.size.height).max() ?? 0
            var lx = bounds.minX
            for item in line {
                subviews[item.index].place(at: CGPoint(x: lx, y: y + (rowH - item.size.height) / 2),
                                           proposal: ProposedViewSize(item.size))
                lx += item.size.width + spacing
            }
            y += rowH + spacing
        }
    }
}

/// A NUMBER custom field's input (owner bug 12 Oct 2026, web RupiahInput), in the field's Number format.
/// Rupiah (Default / 0 decimals): "Rp" and the digits grouped as they are typed ("369.000"); the binding
/// holds the plain digits ("369000"), so what is saved can never be read back as 369. Every other format:
/// the text as typed (normalised when it is saved), and — while the field is not being edited — the value
/// as the field shows it everywhere ("42%", "US$1.234,50", with its bar or ring).
struct NumberFieldInput: View {
    @Binding var text: String
    let style: CustomFieldNumber.Style
    var font: Font = NXFont.text(15)
    /// Optional focus tracking, so a screen can save the value when focus leaves it.
    var focus: FocusState<String?>.Binding? = nil
    var focusId: String = ""
    @FocusState private var ownFocus: Bool

    init(text: Binding<String>, style: CustomFieldNumber.Style, font: Font = NXFont.text(15),
         focus: FocusState<String?>.Binding? = nil, focusId: String = "") {
        _text = text; self.style = style; self.font = font; self.focus = focus; self.focusId = focusId
    }

    /// The legacy call: Rupiah or a plain number.
    init(text: Binding<String>, idr: Bool, font: Font = NXFont.text(15),
         focus: FocusState<String?>.Binding? = nil, focusId: String = "") {
        self.init(text: text, style: idr ? CustomFieldNumber.Style(numberFormat: "IDR") : .plain, font: font, focus: focus, focusId: focusId)
    }

    private var wholeRupiah: Bool { style.isIDR && (style.decimals ?? 0) == 0 }
    private var editing: Bool { focus.map { $0.wrappedValue == focusId } ?? ownFocus }
    /// The value drawn over the field while it is not being edited; nil = the field shows itself.
    private var shown: (text: String, fill: Double)? {
        guard !editing, let d = CustomFieldNumber.decimal(text, style: style) else { return nil }
        if wholeRupiah && style.showAs == .number { return nil }   // the grouped "Rp" field already reads right
        return (CustomFieldNumber.format(d, style: style), CustomFieldNumber.fill(d, style: style))
    }

    var body: some View {
        let over = shown
        // The same text field whether or not it is being edited (switching views would drop the focus):
        // its own text goes clear and the formatted value is drawn over it.
        HStack(spacing: 6) {
            if wholeRupiah {
                Text("Rp").font(font).foregroundStyle(over == nil ? NX.mutedFg : .clear)
                focusable(TextField("0", text: rupiah).keyboardType(.numberPad).font(font)
                    .foregroundStyle(over == nil ? NX.foreground : .clear))
            } else {
                // Percent takes "42%" (stored 0.42), so its keyboard has the sign.
                focusable(TextField(CustomFieldNumber.format(0, style: style), text: $text)
                    .keyboardType(style.isPercent ? .numbersAndPunctuation : .decimalPad).font(font)
                    .foregroundStyle(over == nil ? NX.foreground : .clear))
            }
        }
        .overlay(alignment: .leading) {
            if let over {
                CFNumberValue(text: over.text, style: style, fill: over.fill, font: font, barWidth: nil)
                    .allowsHitTesting(false)
            }
        }
    }

    @ViewBuilder private func focusable<V: View>(_ field: V) -> some View {
        if let focus { field.focused(focus, equals: focusId) } else { field.focused($ownFocus) }
    }

    /// Shown grouped; stored as digits. While typing on the number pad the dots are only the grouping
    /// this field drew itself, so the digits are kept as they are (reading "3.69" — a backspace away from
    /// "3.690" — as 3,69 would round it to 4). Anything pasted with a comma, "Rp" or "jt" goes through
    /// the full Rupiah rules.
    private var rupiah: Binding<String> {
        Binding(
            get: { CustomFieldNumber.groupIDR(CustomFieldNumber.normalize(text, idr: true)) },
            set: { typed in
                let plainTyping = typed.allSatisfy { $0.isNumber || $0 == "." }
                text = plainTyping ? typed.filter(\.isNumber) : CustomFieldNumber.normalize(typed, idr: true)
            }
        )
    }
}
