import SwiftUI

// ─────────────────────────────────────────────────────────────────────────────
// The block editor's documents, read-only (dev server, 12 Oct 2026: TipTap 3 + Yjs on the web; format in
// the server's src/lib/blockdoc.ts header). Pages are stored as ProseMirror JSON
// `{type:"doc",content:[block…]}`; the app draws them instead of the flat `contentText` it had before.
//
// Editing stays on the web for pages: live collaboration runs through Yjs over socket rooms, which the app
// would bypass. Task descriptions keep the plain-text editor — the server merges a plain edit into the
// block doc line by line (mergeTextIntoDoc), keeping the formatting of every line that did not change.
//
// Rule from the spec: a block type this build does not know is drawn as its children's text, never dropped.
// Structure: plain non-lazy stacks only (house rule — no lazy stack inside a two-way scroll).
// ─────────────────────────────────────────────────────────────────────────────

final class BlockNode: Decodable, Identifiable, @unchecked Sendable {
    let id = UUID()
    let type: String
    let text: String?
    let attrs: [String: GideonLoose]
    let content: [BlockNode]
    let marks: [Mark]

    struct Mark: Decodable, Sendable {
        let type: String
        let attrs: [String: GideonLoose]?
    }

    enum CodingKeys: String, CodingKey { case type, text, attrs, content, marks }

    required init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        type = (try? c.decode(String.self, forKey: .type)) ?? "paragraph"
        text = try? c.decodeIfPresent(String.self, forKey: .text)
        attrs = (try? c.decodeIfPresent([String: GideonLoose].self, forKey: .attrs)) ?? [:]
        content = (try? c.decodeIfPresent([BlockNode].self, forKey: .content)) ?? []
        marks = (try? c.decodeIfPresent([Mark].self, forKey: .marks)) ?? []
    }

    func attr(_ key: String) -> String? { attrs[key]?.text }

    /// All the text under this node, for unknown blocks and summaries.
    var plainText: String {
        if type == "text" { return text ?? "" }
        if type == "hardBreak" { return "\n" }
        if type == "mention" { return "@" + (attr("label") ?? "") }
        if type == "dateChip" { return attr("date") ?? "" }
        return content.map(\.plainText).joined()
    }

    /// True when the document has anything to draw.
    var hasContent: Bool { content.contains { !$0.plainText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || ["image", "fileBlock", "bookmark", "horizontalRule", "table"].contains($0.type) } }
}

struct BlockDocView: View {
    let doc: BlockNode
    var fontSize: CGFloat = 15

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            ForEach(doc.content) { block($0, depth: 0) }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    // MARK: blocks

    private func block(_ n: BlockNode, depth: Int) -> AnyView {
        switch n.type {
        case "paragraph":
            return AnyView(inline(n).font(NXFont.text(fontSize)).foregroundStyle(NX.foreground)
                .fixedSize(horizontal: false, vertical: true).lineSpacing(3).textSelection(.enabled))
        case "heading":
            let level = Int(n.attr("level") ?? "1") ?? 1
            let size: CGFloat = level == 1 ? fontSize + 9 : (level == 2 ? fontSize + 5 : fontSize + 2)
            return AnyView(inline(n).font(NXFont.display(size, .bold)).foregroundStyle(NX.foreground)
                .fixedSize(horizontal: false, vertical: true).padding(.top, level == 1 ? 8 : 4))
        case "bulletList", "orderedList", "taskList":
            let start = Int(n.attr("start") ?? "1") ?? 1
            return AnyView(VStack(alignment: .leading, spacing: 6) {
                ForEach(Array(n.content.enumerated()), id: \.element.id) { i, item in
                    listItem(item, marker: n.type == "orderedList" ? "\(start + i)." : (n.type == "taskList" ? nil : "•"), depth: depth)
                }
            })
        case "blockquote":
            return AnyView(HStack(alignment: .top, spacing: 10) {
                Rectangle().fill(NX.foreground.opacity(0.6)).frame(width: 3)
                VStack(alignment: .leading, spacing: 6) { ForEach(n.content) { block($0, depth: depth) } }
            }.fixedSize(horizontal: false, vertical: true))
        case "callout":
            return AnyView(HStack(alignment: .top, spacing: 10) {
                Text(n.attr("emoji") ?? "💡").font(.system(size: fontSize + 2))
                VStack(alignment: .leading, spacing: 6) { ForEach(n.content) { block($0, depth: depth) } }
            }
            .padding(12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(NX.muted, in: RoundedRectangle(cornerRadius: 10, style: .continuous)))
        case "details":
            let summary = n.content.first { $0.type == "detailsSummary" }
            let body = n.content.first { $0.type == "detailsContent" }
            return AnyView(DisclosureGroup {
                VStack(alignment: .leading, spacing: 6) { ForEach(body?.content ?? []) { block($0, depth: depth) } }
                    .padding(.leading, 4)
            } label: {
                Text(summary?.plainText ?? "").font(NXFont.text(fontSize, .semibold)).foregroundStyle(NX.foreground)
            }
            .tint(NX.foreground))
        case "codeBlock":
            return AnyView(ScrollView(.horizontal, showsIndicators: false) {
                Text(n.plainText).font(.system(size: fontSize - 2, design: .monospaced)).foregroundStyle(NX.foreground)
                    .textSelection(.enabled).padding(12)
            }
            .background(NX.muted, in: RoundedRectangle(cornerRadius: 8, style: .continuous)))
        case "horizontalRule":
            return AnyView(Divider().overlay(NX.border).padding(.vertical, 4))
        case "image":
            if let src = n.attr("src"), let url = Self.remote(src) {
                return AnyView(CachedImage(url: url) { $0.resizable().scaledToFit() } placeholder: { NX.muted.frame(height: 160) }
                    .frame(maxWidth: .infinity)
                    .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                    .accessibilityLabel(n.attr("alt") ?? T("Image")))
            }
            return AnyView(EmptyView())
        case "fileBlock":
            return AnyView(HStack(spacing: 8) {
                Image(systemName: "paperclip").foregroundStyle(NX.mutedFg)
                Text(n.attr("name") ?? T("File")).font(NXFont.text(fontSize - 1, .semibold)).foregroundStyle(NX.foreground).lineLimit(1)
                Spacer(minLength: 0)
            }
            .padding(10).background(NX.muted.opacity(0.6), in: RoundedRectangle(cornerRadius: 8, style: .continuous)))
        case "bookmark":
            let raw = n.attr("url") ?? ""
            return AnyView(Group {
                if let url = URL(string: raw) {
                    Link(destination: url) {
                        HStack(spacing: 8) {
                            Image(systemName: "link")
                            Text(n.attr("title") ?? raw).lineLimit(2).multilineTextAlignment(.leading)
                            Spacer(minLength: 0)
                        }
                        .font(NXFont.text(fontSize - 1, .semibold)).foregroundStyle(NX.violetText)
                        .padding(10).overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(NX.border))
                    }
                }
            })
        case "table":
            return AnyView(ScrollView(.horizontal, showsIndicators: true) {
                VStack(alignment: .leading, spacing: 0) {
                    ForEach(n.content) { row in
                        HStack(alignment: .top, spacing: 0) {
                            ForEach(row.content) { cell in
                                Text(cell.plainText)
                                    .font(NXFont.text(fontSize - 2, cell.type == "tableHeader" ? .semibold : .regular))
                                    .foregroundStyle(NX.foreground)
                                    .frame(width: 140, alignment: .topLeading)
                                    .padding(8)
                                    .background(cell.type == "tableHeader" ? NX.muted : Color.clear)
                                    .overlay(Rectangle().strokeBorder(NX.border, lineWidth: 0.5))
                            }
                        }
                    }
                }
            })
        default:
            // Unknown (or a container like listItem reached directly): its children, or its text.
            if n.content.contains(where: { $0.type != "text" && $0.type != "hardBreak" && $0.type != "mention" && $0.type != "dateChip" }) {
                return AnyView(VStack(alignment: .leading, spacing: 6) { ForEach(n.content) { block($0, depth: depth) } })
            }
            return AnyView(inline(n).font(NXFont.text(fontSize)).foregroundStyle(NX.foreground).fixedSize(horizontal: false, vertical: true))
        }
    }

    private func listItem(_ item: BlockNode, marker: String?, depth: Int) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            if let marker {
                Text(marker).font(NXFont.text(fontSize)).foregroundStyle(NX.mutedFg).frame(minWidth: 14, alignment: .trailing)
            } else {
                let checked = item.attr("checked") == "true"
                Image(systemName: checked ? "checkmark.square.fill" : "square")
                    .font(.system(size: fontSize)).foregroundStyle(checked ? NX.violetText : NX.mutedFg)
                    .accessibilityLabel(checked ? T("Done") : T("Not done"))
            }
            VStack(alignment: .leading, spacing: 4) {
                ForEach(item.content) { block($0, depth: depth + 1) }
            }
            .opacity(item.attr("checked") == "true" ? 0.6 : 1)
        }
    }

    // MARK: inline

    private func inline(_ n: BlockNode) -> Text {
        Text(Self.attributed(n.content))
    }

    static func attributed(_ nodes: [BlockNode]) -> AttributedString {
        var out = AttributedString()
        for c in nodes {
            switch c.type {
            case "text":
                var a = AttributedString(c.text ?? "")
                var intent: InlinePresentationIntent = []
                for m in c.marks {
                    switch m.type {
                    case "bold": intent.insert(.stronglyEmphasized)
                    case "italic": intent.insert(.emphasized)
                    case "code": intent.insert(.code)
                    case "strike": a.strikethroughStyle = .single
                    case "underline": a.underlineStyle = .single
                    case "link": if let href = m.attrs?["href"]?.text, let url = URL(string: href) { a.link = url }
                    case "highlight": a.backgroundColor = NX.warning.opacity(0.25)
                    default: break
                    }
                }
                if !intent.isEmpty { a.inlinePresentationIntent = intent }
                out += a
            case "hardBreak":
                out += AttributedString("\n")
            case "mention":
                var a = AttributedString("@" + (c.attr("label") ?? ""))
                a.foregroundColor = NX.violetText
                out += a
            case "dateChip":
                var a = AttributedString([c.attr("date"), c.attr("time")].compactMap { $0 }.joined(separator: " "))
                a.foregroundColor = NX.violetText
                out += a
            default:
                out += AttributedString(c.plainText)
            }
        }
        return out
    }

    private static func remote(_ raw: String) -> URL? {
        URL(string: raw.hasPrefix("http") ? raw : Config.baseURL.absoluteString + raw)
    }
}
