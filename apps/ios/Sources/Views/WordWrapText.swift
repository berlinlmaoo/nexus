import SwiftUI

/// Text that is never cut inside a word: on one line at full size when it fits, else wrapped between words onto
/// up to `lines` lines at the largest size, down to `minimumScale`, at which every word fits the width. Only text
/// that still doesn't fit at the smallest size is cut with "…". The owner's device test (22 Oct 2026) showed
/// "Finance Manag…" and "Pipelin / e Z N…" in the project header; QA then found the same in the Pipeline
/// readings ("Deliverables on track") and the board's status chips ("Belum dikerjakan").
struct WordWrapText: View {
    let text: String
    let size: CGFloat
    var lines = 2
    var minimumScale: CGFloat = 0.75
    /// The ideal width is the narrowest at which the text fits its lines at `minimumScale`, not one line at full
    /// size: a header choosing between layouts (ViewThatFits) then knows whether the wrapped name fits.
    var idealWraps = false
    let font: (CGFloat) -> Font

    private static let steps = 6

    /// One word per line: as a Text, its width is the widest word. A zero-width space is a break too: file
    /// names carry one after "_" (LegalLabels.title) so that they wrap at the joins.
    private var wordColumn: String { text.split(whereSeparator: { $0.isWhitespace || $0 == "\u{200B}" }).joined(separator: "\n") }
    private var scales: [CGFloat] {
        (0...Self.steps).map { 1 - (1 - minimumScale) * CGFloat($0) / CGFloat(Self.steps) }
    }

    var body: some View {
        let column = wordColumn
        let scales = self.scales
        WordWrapLayout(scales: scales, lines: lines, idealWraps: idealWraps) {
            // Measured only: the widest word at each size. Measured, not scaled from the full size: Text widths
            // step (120, 114, 108, 108 pt), and a one-word name scaled to 105 pt broke at 106 (23 Oct 2026).
            ForEach(scales.indices, id: \.self) { i in
                Text(column).font(font(size * scales[i])).fixedSize().hidden()
            }
            // The text at each size, wrapped by SwiftUI itself, so the line count is measured, not guessed.
            ForEach(scales.indices, id: \.self) { i in
                Text(text).font(font(size * scales[i])).lineLimit(nil)
            }
            Text(text).font(font(size * minimumScale)).lineLimit(lines).truncationMode(.tail)
            // A first word wider than the line even at the smallest size is split inside it on `lines` lines (a later
            // one only meets "…" on the last line): then the text is cut on one line instead.
            Text(text).font(font(size * minimumScale)).lineLimit(1).truncationMode(.tail)
            Text(column.prefix { $0 != "\n" }).font(font(size * minimumScale)).fixedSize().hidden()
        }
        // The sizes not chosen are placed outside the frame.
        .clipped()
        .multilineTextAlignment(.leading)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(text)
        .accessibilityAddTraits(.isStaticText)
    }
}

extension WordWrapText {
    /// A project's name in its header (Plus Jakarta Sans).
    static func projectTitle(_ text: String, size: CGFloat, weight: Font.Weight = .bold, idealWraps: Bool = false) -> WordWrapText {
        WordWrapText(text: text, size: size, idealWraps: idealWraps) { NXFont.display($0, weight) }
    }
}

/// Subviews: the hidden word column at each scale, the wrapped text at each scale, the text cut on `lines` lines
/// and on one line at the smallest scale, then the hidden first word at the smallest scale.
private struct WordWrapLayout: Layout {
    let scales: [CGFloat]
    let lines: Int
    let idealWraps: Bool

    /// At `scales[i]`, every word fits `width` and the text takes at most `lines` lines.
    private func fits(_ i: Int, width: CGFloat, subviews: Subviews) -> CGSize? {
        guard subviews[i].sizeThatFits(.unspecified).width <= width else { return nil }
        let view = subviews[scales.count + i]
        let line = view.sizeThatFits(.unspecified).height
        let size = view.sizeThatFits(ProposedViewSize(width: width, height: nil))
        return size.height < line * (CGFloat(lines) + 0.5) ? size : nil
    }

    /// Which subview to show, its size, and the width it was measured at: it is placed with that same proposal,
    /// not its frame's pixel-rounded width, which can be a hair narrower than a line that just fits.
    /// nil = on one line, unconstrained.
    private func choice(width: CGFloat?, subviews: Subviews) -> (index: Int, size: CGSize, measured: CGFloat?) {
        let first = scales.count
        // The ideal size, and any width it fits: the text on one line at full size, as a plain Text.
        let oneLine = subviews[first].sizeThatFits(.unspecified)
        guard let width, width.isFinite else {
            guard idealWraps, oneLine.width > 1 else { return (first, oneLine, nil) }
            // The narrowest width that still holds the text at the smallest size, to the point.
            let smallest = scales.count - 1
            var low = subviews[smallest].sizeThatFits(.unspecified).width, high = oneLine.width
            for _ in 0..<12 where high - low > 1 {
                let mid = (low + high) / 2
                if fits(smallest, width: mid, subviews: subviews) != nil { high = mid } else { low = mid }
            }
            return choice(width: high.rounded(.up), subviews: subviews)
        }
        guard oneLine.width > width else { return (first, oneLine, nil) }
        for i in scales.indices {
            if let size = fits(i, width: width, subviews: subviews) { return (first + i, size, width) }
        }
        let firstWord = subviews[subviews.count - 1].sizeThatFits(.unspecified).width
        let cut = firstWord <= width ? subviews.count - 3 : subviews.count - 2
        return (cut, subviews[cut].sizeThatFits(ProposedViewSize(width: width, height: nil)), width)
    }

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        choice(width: proposal.width, subviews: subviews).size
    }

    /// The shown text's baselines, so a dot or icon aligned to `.firstTextBaseline` sits on its first line as
    /// beside a plain Text (the Outlet calendar chip, QA final #2).
    func explicitAlignment(of guide: VerticalAlignment, in bounds: CGRect, proposal: ProposedViewSize,
                           subviews: Subviews, cache: inout ()) -> CGFloat? {
        guard guide == .firstTextBaseline || guide == .lastTextBaseline else { return nil }
        let chosen = choice(width: proposal.width, subviews: subviews)
        return bounds.minY + subviews[chosen.index].dimensions(in: ProposedViewSize(width: chosen.measured, height: nil))[guide]
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let chosen = choice(width: proposal.width, subviews: subviews)
        for (i, view) in subviews.enumerated() {
            if i == chosen.index {
                view.place(at: bounds.origin, proposal: ProposedViewSize(width: chosen.measured, height: nil))
            } else {
                view.place(at: CGPoint(x: bounds.minX - 100_000, y: bounds.minY), proposal: .zero)
            }
        }
    }
}
