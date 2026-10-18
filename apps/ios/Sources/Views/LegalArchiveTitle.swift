import SwiftUI

/// Archive titles may wrap at spaces and underscores, never in the middle of a word.
struct LegalArchiveTitle: View {
    let text: String
    private var words: [String] {
        var parts: [String] = []; var word = ""
        for character in text {
            word.append(character == "\n" ? " " : character)
            if character.isWhitespace || character == "_" { parts.append(word); word = "" }
        }
        if !word.isEmpty { parts.append(word) }
        return parts
    }
    var body: some View {
        LegalWordLayout {
            ForEach(Array(words.enumerated()), id: \.offset) { _, word in Text(word).lineLimit(1) }
        }
        .accessibilityElement(children: .ignore).accessibilityLabel(text)
        .accessibilityIdentifier("legal.archive.title")
    }
}
private struct LegalWordLayout: Layout {
    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        measure(width: proposal.width ?? 300, subviews: subviews).size
    }
    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let measured = measure(width: bounds.width, subviews: subviews)
        for (index, item) in measured.items.enumerated() {
            subviews[index].place(at: CGPoint(x: bounds.minX + item.minX, y: bounds.minY + item.minY), proposal: ProposedViewSize(item.size))
        }
    }
    private func measure(width: CGFloat, subviews: Subviews) -> (size: CGSize, items: [CGRect]) {
        let width = max(1, width); var x: CGFloat = 0; var y: CGFloat = 0; var line: CGFloat = 0; var items: [CGRect] = []
        for view in subviews {
            let natural = view.sizeThatFits(.unspecified)
            let size = CGSize(width: min(width, natural.width), height: natural.height)
            if x > 0 && x + size.width > width { x = 0; y += line; line = 0 }
            items.append(CGRect(origin: CGPoint(x: x, y: y), size: size)); x += size.width; line = max(line, size.height)
        }
        return (CGSize(width: width, height: y + line), items)
    }
}
