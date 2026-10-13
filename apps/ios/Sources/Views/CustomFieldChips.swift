import SwiftUI

/// A rendered custom-field value chip for a board/list card.
struct CFChip: Identifiable, Equatable {
    let id: String
    let label: String
    let tone: ChipTone
    /// A select option's colour (web choiceColor: the palette by the option's position); nil = tone.
    var colorKey: String? = nil
    /// A date value: drawn like web's PropValue date (clock icon + muted text, no pill), so two date
    /// fields on one card read as dates and the field name is spoken (UI tour run 7).
    var isDate = false
    var fieldName: String? = nil
}

// Formatters are expensive to construct — build once and reuse. `customFieldChip` runs per card
// per render while scrolling, so a fresh NumberFormatter/DateFormatter each call was real jank.
private let cfYMD: DateFormatter = {
    let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"; f.timeZone = ProjDate.cal.timeZone
    return f
}()
private let cfDecoder = JSONDecoder()   // reused — a fresh JSONDecoder per chip per scroll was an allocation hit

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

    func parseDay(_ s: String) -> Date? {
        if let d = ProjDate.parse(s) { return d }
        return cfYMD.date(from: String(s.prefix(10)))
    }

    switch type {
    case "NUMBER":
        // Rupiah reads id-ID grouping ("369.000" = 369 000, owner bug 12 Oct 2026); every other number
        // is grouped in the app's language and is never shown with "Rp" (CustomFieldNumber.swift).
        let label = CustomFieldNumber.display(raw, format: cfv.customField?.options?.format)
        return label.isEmpty ? nil : CFChip(id: cfv.customFieldId, label: label, tone: .neutral)
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
        let label = parseDay(raw).map { ProjDate.dayLabel($0) } ?? raw
        return CFChip(id: cfv.customFieldId, label: label, tone: .neutral, isDate: true, fieldName: cfv.customField?.name)
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
        if chip.isDate {
            Label(chip.label, systemImage: "clock").font(NXFont.text(11)).foregroundStyle(NX.mutedFg).lineLimit(1)
                .padding(.vertical, 2)
                .accessibilityLabel(chip.fieldName.map { "\($0): \(chip.label)" } ?? chip.label)
        } else if let key = chip.colorKey {
            let sw = StatusColor.swatch(key)
            Text(chip.label).font(NXFont.text(10, .semibold)).lineLimit(1)
                .padding(.horizontal, 7).padding(.vertical, 3)
                .foregroundStyle(sw.fg).background(sw.bg, in: RoundedRectangle(cornerRadius: 4, style: .continuous))
        } else {
            Text(chip.label).font(NXFont.text(10, .semibold)).lineLimit(1)
                .padding(.horizontal, 7).padding(.vertical, 3)
                .foregroundStyle(chip.tone.fg).background(chip.tone.bg, in: Capsule())
        }
    }
}

/// Wrapping chip row for a task's custom-field values (board / list / calendar / timeline cards).
struct CFChipRow: View {
    let values: [BoardTask.CFValue]?
    var body: some View {
        let chips = (values ?? []).compactMap(customFieldChip)
        if !chips.isEmpty {
            FlowLayout(spacing: 5) {
                ForEach(chips) { CFChipView(chip: $0) }
            }
        }
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
    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var x = bounds.minX, y = bounds.minY, rowH: CGFloat = 0
        for v in subviews {
            let s = v.sizeThatFits(.unspecified)
            if x > bounds.minX && x + s.width > bounds.maxX { x = bounds.minX; y += rowH + spacing; rowH = 0 }
            v.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(s))
            x += s.width + spacing; rowH = max(rowH, s.height)
        }
    }
}

/// A NUMBER custom field's input (owner bug 12 Oct 2026, web RupiahInput). Rupiah: "Rp" and the digits
/// grouped as they are typed ("369.000"); the binding holds the plain digits ("369000"), so what is saved
/// can never be read back as 369. Plain: the decimal pad, the text as typed (normalised when it is saved).
struct NumberFieldInput: View {
    @Binding var text: String
    let idr: Bool
    var font: Font = NXFont.text(15)
    /// Optional focus tracking, so a screen can save the value when focus leaves it.
    var focus: FocusState<String?>.Binding? = nil
    var focusId: String = ""

    var body: some View {
        if idr {
            HStack(spacing: 6) {
                Text("Rp").font(font).foregroundStyle(NX.mutedFg)
                focusable(TextField("0", text: rupiah).keyboardType(.numberPad).font(font))
            }
        } else {
            focusable(TextField("0", text: $text).keyboardType(.decimalPad).font(font))
        }
    }

    @ViewBuilder private func focusable<V: View>(_ field: V) -> some View {
        if let focus { field.focused(focus, equals: focusId) } else { field }
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
