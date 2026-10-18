import SwiftUI

// ─────────────────────────────────────────────────────────────────────────────
// The Markdown GIDEON writes, drawn natively (web components/gideon/GideonMarkdown.tsx, Mac parity 13 Oct
// 2026: the app showed raw "**bold**" and "- " lists). The same small subset as the web and no HTML:
// headings, paragraphs, bullet and numbered lists, quotes, fenced code, simple tables, rules; inline
// **bold**, *italic*, `code` and [links](…) through AttributedString's inline-only parser. A NEXUS path
// (/tasks/…, /projects/…, /docs/…) opens inside the app; anything else goes to the system.
// ─────────────────────────────────────────────────────────────────────────────

/// One block of an answer.
enum GideonMarkdownBlock: Equatable {
    struct Item: Equatable {
        let level: Int
        let text: String
    }
    case heading(Int, String)
    case paragraph(String)
    case bullets([Item])
    case numbered([Item])
    case quote(String)
    case code(String)
    case table([String], [[String]])
    case rule
}

/// Foundation-only, so it can be tested on Linux.
enum GideonMarkdownParser {
    private static func has(_ s: String, _ pattern: String) -> Bool {
        s.range(of: pattern, options: .regularExpression) != nil
    }

    private static func strip(_ s: String, _ pattern: String) -> String {
        guard let r = s.range(of: pattern, options: .regularExpression) else { return s }
        return String(s[r.upperBound...])
    }

    private static func indent(_ s: String) -> Int {
        var n = 0
        for ch in s {
            if ch == " " { n += 1 } else if ch == "\t" { n += 4 } else { break }
        }
        return min(n / 2, 3)
    }

    private static func cells(_ line: String) -> [String] {
        var t = line.trimmingCharacters(in: .whitespaces)
        if t.hasPrefix("|") { t.removeFirst() }
        if t.hasSuffix("|") { t.removeLast() }
        return t.components(separatedBy: "|").map { $0.trimmingCharacters(in: .whitespaces) }
    }

    static let bullet = #"^\s*[-*•]\s+"#
    static let number = #"^\s*\d+[.)]\s+"#
    static let tableRow = #"^\s*\|.*\|\s*$"#
    static let fence = #"^\s*```"#
    static let headingPattern = #"^\s*#{1,4}\s+"#
    static let rulePattern = #"^\s*([-*_])\s*\1\s*\1[\s\-*_]*$"#
    static let continuation = #"^\s{2,}\S"#

    static func blocks(_ source: String) -> [GideonMarkdownBlock] {
        let lines = source.replacingOccurrences(of: "\r\n", with: "\n").replacingOccurrences(of: "\r", with: "\n")
            .components(separatedBy: "\n")
        var out: [GideonMarkdownBlock] = []
        var i = 0
        while i < lines.count {
            let line = lines[i]
            if line.trimmingCharacters(in: .whitespaces).isEmpty { i += 1; continue }
            if has(line, fence) {
                var buf: [String] = []
                i += 1
                while i < lines.count && !has(lines[i], fence) { buf.append(lines[i]); i += 1 }
                i += 1
                out.append(.code(buf.joined(separator: "\n")))
                continue
            }
            if has(line, headingPattern) {
                let trimmed = line.trimmingCharacters(in: .whitespaces)
                let level = trimmed.prefix(while: { $0 == "#" }).count
                out.append(.heading(level, strip(line, headingPattern)))
                i += 1
                continue
            }
            if has(line, rulePattern) { out.append(.rule); i += 1; continue }
            if has(line, tableRow) && i + 1 < lines.count && has(lines[i + 1], #"^\s*\|?\s*:?-{2,}"#) {
                let head = cells(line)
                i += 2
                var rows: [[String]] = []
                while i < lines.count && has(lines[i], tableRow) { rows.append(cells(lines[i])); i += 1 }
                out.append(.table(head, rows))
                continue
            }
            if has(line, #"^\s*>"#) {
                var buf: [String] = []
                while i < lines.count && has(lines[i], #"^\s*>"#) { buf.append(strip(lines[i], #"^\s*>\s?"#)); i += 1 }
                out.append(.quote(buf.joined(separator: " ")))
                continue
            }
            if has(line, bullet) || has(line, number) {
                let ordered = has(line, number)
                let marker = ordered ? number : bullet
                var items: [GideonMarkdownBlock.Item] = []
                while i < lines.count {
                    let l = lines[i]
                    if has(l, marker) {
                        items.append(.init(level: indent(l), text: strip(l, marker)))
                    } else if indent(l) > 0 && !items.isEmpty && (has(l, number) || has(l, bullet)) {
                        // The other kind of marker, indented under this list: drawn one level in.
                        items.append(.init(level: indent(l), text: strip(l, has(l, number) ? number : bullet)))
                    } else if has(l, continuation) && !items.isEmpty {
                        let last = items.removeLast()
                        items.append(.init(level: last.level, text: last.text + " " + l.trimmingCharacters(in: .whitespaces)))
                    } else {
                        break
                    }
                    i += 1
                }
                out.append(ordered ? .numbered(items) : .bullets(items))
                continue
            }
            var buf: [String] = []
            while i < lines.count {
                let l = lines[i]
                if l.trimmingCharacters(in: .whitespaces).isEmpty { break }
                if has(l, #"^\s*(#{1,4}\s|```|>|[-*•]\s|\d+[.)]\s)"#) || has(l, tableRow) { break }
                buf.append(l)
                i += 1
            }
            if buf.isEmpty { buf.append(line); i += 1 }
            out.append(.paragraph(buf.joined(separator: "\n")))
        }
        return out
    }

    /// Bare http(s) links become CommonMark autolinks so the inline parser makes them tappable.
    static func autolink(_ s: String) -> String {
        guard s.contains("http") else { return s }
        return s.replacingOccurrences(of: #"(?<![(<\[\w])(https?://[^\s)>\]]+)"#, with: "<$1>", options: .regularExpression)
    }
}

/// The internal NEXUS address a link names, if any (web internalPath): "/tasks/<id>", "/projects/<id>",
/// "/docs/<id>" — relative, or on this server's host, or on the public NEXUS address.
enum GideonLinkTarget {
    static func ref(for url: URL) -> GideonRef? {
        let host = url.host?.lowercased()
        let ownHost = Config.baseURL.host?.lowercased()
        guard host == nil || host == ownHost || host == "nexus.znetworks.id" else { return nil }
        let parts = url.path.split(separator: "/").map(String.init)
        guard parts.count >= 2 else { return nil }
        let id = parts[1]
        switch parts[0] {
        case "tasks": return GideonRef(kind: "task", id: id, title: nil, projectId: nil)
        case "projects": return GideonRef(kind: "project", id: id, title: nil, projectId: id)
        case "docs": return GideonRef(kind: "doc", id: id, title: nil, projectId: nil)
        default: return nil
        }
    }
}

/// An answer, rendered. `onOpen` gets the NEXUS pages a link names; other links open in the browser.
struct GideonMarkdownView: View {
    let text: String
    var size: CGFloat = 15
    var onOpen: ((GideonRef) -> Void)? = nil

    @State private var exportedFile: ShareItem?
    @State private var downloadError: String?
    @State private var downloading = false

    var body: some View {
        let blocks = GideonMarkdownParser.blocks(text)
        VStack(alignment: .leading, spacing: 8) {
            ForEach(blocks.indices, id: \.self) { index in
                block(blocks[index])
            }
        }
        .foregroundStyle(NX.foreground)
        .tint(NX.violetText)
        .textSelection(.enabled)
        .overlay(alignment: .bottomTrailing) { if downloading { ProgressView() } }
        .sheet(item: $exportedFile) { ActivityView(items: [$0.url]) }
        .alert(T("Couldn't download file"), isPresented: Binding(get: { downloadError != nil }, set: { if !$0 { downloadError = nil } })) {
            Button(T("OK"), role: .cancel) {}
        } message: { Text(downloadError ?? "") }
        .environment(\.openURL, OpenURLAction { url in
            if (url.host == nil || Config.isNexusHost(url)), url.path.hasPrefix("/api/gideon/files/") {
                guard !downloading else { return .handled }
                downloading = true
                Task {
                    defer { downloading = false }
                    do {
                        let file = try await APIClient.shared.gideonExport(url)
                        exportedFile = ShareItem(url: file)
                    } catch { downloadError = error.localizedDescription }
                }
                return .handled
            }
            if (url.host == nil || Config.isNexusHost(url)), url.path == "/reminders" { AppRouter.shared.open(.reminders); return .handled }
            if let ref = GideonLinkTarget.ref(for: url), let onOpen {
                onOpen(ref)
                return .handled
            }
            return url.scheme == nil ? .discarded : .systemAction
        })
    }

    static func inline(_ s: String) -> AttributedString {
        var options = AttributedString.MarkdownParsingOptions(interpretedSyntax: .inlineOnlyPreservingWhitespace)
        options.failurePolicy = .returnPartiallyParsedIfPossible
        if let parsed = try? AttributedString(markdown: GideonMarkdownParser.autolink(s), options: options) {
            return parsed
        }
        return AttributedString(s)
    }

    @ViewBuilder private func block(_ b: GideonMarkdownBlock) -> some View {
        switch b {
        case .heading(let level, let t):
            Text(Self.inline(t))
                .font(NXFont.text(level == 1 ? size + 4 : (level == 2 ? size + 2 : size + 1), .semibold))
                .fixedSize(horizontal: false, vertical: true)
                .padding(.top, 2)
        case .paragraph(let t):
            Text(Self.inline(t))
                .font(NXFont.text(size))
                .lineSpacing(3)
                .fixedSize(horizontal: false, vertical: true)
        case .bullets(let items):
            listView(items, ordered: false)
        case .numbered(let items):
            listView(items, ordered: true)
        case .quote(let t):
            HStack(alignment: .top, spacing: 10) {
                RoundedRectangle(cornerRadius: 1.5).fill(NX.border).frame(width: 3)
                Text(Self.inline(t)).font(NXFont.text(size)).foregroundStyle(NX.mutedFg)
                    .fixedSize(horizontal: false, vertical: true)
            }
        case .code(let t):
            ScrollView(.horizontal, showsIndicators: false) {
                Text(t)
                    .font(.system(size: size - 2, design: .monospaced))
                    .fixedSize(horizontal: true, vertical: true)
                    .padding(10)
            }
            .background(NX.foreground.opacity(0.06), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
        case .table(let head, let rows):
            GideonMarkdownTable(head: head, rows: rows, size: size)
        case .rule:
            Rectangle().fill(NX.border).frame(height: 1).padding(.vertical, 2)
        }
    }

    private func listView(_ items: [GideonMarkdownBlock.Item], ordered: Bool) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            ForEach(items.indices, id: \.self) { n in
                let item = items[n]
                HStack(alignment: .firstTextBaseline, spacing: 7) {
                    Text(verbatim: Self.marker(items, n, ordered: ordered))
                        .font(NXFont.text(size))
                        .foregroundStyle(NX.mutedFg)
                        .monospacedDigit()
                    Text(Self.inline(item.text))
                        .font(NXFont.text(size))
                        .lineSpacing(3)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .padding(.leading, CGFloat(item.level) * 16)
            }
        }
    }

    private static func marker(_ items: [GideonMarkdownBlock.Item], _ index: Int, ordered: Bool) -> String {
        let level = items[index].level
        if ordered && level == 0 { return "\(ordinal(items, index))." }
        return level == 0 ? "•" : "◦"
    }

    /// The number a top-level item shows: its place among the top-level items.
    private static func ordinal(_ items: [GideonMarkdownBlock.Item], _ index: Int) -> Int {
        items[...index].filter { $0.level == 0 }.count
    }
}

/// A Markdown table as a bordered grid that scrolls sideways when it is wider than the answer.
private struct GideonMarkdownTable: View {
    let head: [String]
    let rows: [[String]]
    let size: CGFloat

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            Grid(alignment: .leading, horizontalSpacing: 0, verticalSpacing: 0) {
                GridRow {
                    ForEach(head.indices, id: \.self) { c in
                        cell(head[c], bold: true)
                    }
                }
                ForEach(rows.indices, id: \.self) { r in
                    GridRow {
                        ForEach(head.indices, id: \.self) { c in
                            cell(c < rows[r].count ? rows[r][c] : "", bold: false)
                        }
                    }
                }
            }
            .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(NX.border))
            .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
        }
    }

    private func cell(_ text: String, bold: Bool) -> some View {
        Text(GideonMarkdownView.inline(text))
            .font(NXFont.text(size - 1, bold ? .semibold : .regular))
            .fixedSize(horizontal: false, vertical: true)
            .frame(minWidth: 60, maxWidth: 280, alignment: .leading)
            .padding(.horizontal, 10).padding(.vertical, 6)
            .background(bold ? NX.foreground.opacity(0.04) : Color.clear)
            .overlay(alignment: .bottom) { Rectangle().fill(NX.border).frame(height: 1) }
    }
}
