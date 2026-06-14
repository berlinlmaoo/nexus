import SwiftUI

/// A rendered custom-field value chip for a board/list card.
struct CFChip: Identifiable, Equatable {
    let id: String
    let label: String
    let tone: ChipTone
}

/// Port of the web `cfStatusTone` — colors a STATUS value.
func cfStatusTone(_ v: String) -> ChipTone {
    let s = v.lowercased().replacingOccurrences(of: "[_-]+", with: " ", options: .regularExpression)
        .trimmingCharacters(in: .whitespaces)
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
        let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"; f.timeZone = ProjDate.cal.timeZone
        return f.date(from: String(s.prefix(10)))
    }

    switch type {
    case "NUMBER":
        let digits = raw.filter(\.isNumber)
        guard !digits.isEmpty else { return nil }
        if cfv.customField?.options?.format == "currency-idr", let n = Int(digits) {
            let f = NumberFormatter(); f.numberStyle = .currency; f.currencyCode = "IDR"
            f.maximumFractionDigits = 0; f.locale = Locale(identifier: "id_ID")
            return CFChip(id: cfv.customFieldId, label: f.string(from: NSNumber(value: n)) ?? raw, tone: .neutral)
        }
        return CFChip(id: cfv.customFieldId, label: raw, tone: .neutral)
    case "STATUS":
        return CFChip(id: cfv.customFieldId, label: raw, tone: cfStatusTone(raw))
    case "MULTI_SELECT":
        if let data = raw.data(using: .utf8), let arr = try? JSONDecoder().decode([String].self, from: data) {
            let s = arr.joined(separator: ", ")
            return s.isEmpty ? nil : CFChip(id: cfv.customFieldId, label: s, tone: .neutral)
        }
        return CFChip(id: cfv.customFieldId, label: raw, tone: .neutral)
    case "PLACE":
        if let data = raw.data(using: .utf8), let o = try? JSONDecoder().decode([String: String].self, from: data),
           let l = o["label"], !l.isEmpty {
            return CFChip(id: cfv.customFieldId, label: l, tone: .neutral)
        }
        return nil
    case "DATE", "CREATED":
        if let d = parseDay(raw) { return CFChip(id: cfv.customFieldId, label: ProjDate.dayLabel(d), tone: .neutral) }
        return CFChip(id: cfv.customFieldId, label: raw, tone: .neutral)
    default:
        return CFChip(id: cfv.customFieldId, label: raw, tone: .neutral)
    }
}

/// Compact, single-line chip for cards.
struct CFChipView: View {
    let chip: CFChip
    var body: some View {
        Text(chip.label).font(NXFont.text(10, .semibold)).lineLimit(1)
            .padding(.horizontal, 7).padding(.vertical, 3)
            .foregroundStyle(chip.tone.fg).background(chip.tone.bg, in: Capsule())
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
