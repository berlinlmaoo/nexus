import SwiftUI

// New project gallery (owner, 12 Oct 2026; the web's components/projects/TemplateGallery.tsx): Blank
// first, then the server's templates, then the two dashboards that are project TYPES (Outlet Sales,
// Pipeline). Search, categories, and cards with a small drawing of what the project will look like,
// drawn from the template's own data (sections, fields, preview layout).

enum GalleryPick: Hashable {
    case blank
    case template(ProjectTemplate)
    case type(ProjectKind)

    /// What the server builds: every template and Blank are Task Projects.
    var kind: ProjectKind {
        if case .type(let k) = self { return k }
        return .task
    }
    var template: ProjectTemplate? {
        if case .template(let t) = self { return t }
        return nil
    }
}

extension ProjectKind {
    /// The kind's icon where it is drawn large (New project): the Pipeline wears the web's funnel, which
    /// SF Symbols does not have (UI tour run 13, F-07).
    var glyph: Image {
        self == .pipeline ? Image("FunnelGlyph").renderingMode(.template) : Image(systemName: symbol)
    }
}

struct TemplateGallery: View {
    let onPick: (GalleryPick) -> Void
    @State private var viewer = Viewer.shared
    @State private var templates: [ProjectTemplate] = []
    @State private var loading = true
    @State private var failed = false
    @State private var query = ""
    @State private var category = "all"

    private static let categoryOrder = ["marketing", "projects", "docs", "planning", "operations", "dashboards"]
    private static func categoryLabel(_ c: String) -> String {
        switch c {
        case "marketing": return T("Marketing")
        case "projects": return T("Projects & tasks")
        case "docs": return T("Docs & meetings")
        case "planning": return T("Planning")
        case "operations": return T("Operations")
        case "dashboards": return T("Dashboards")
        default: return humanizeEnum(c)
        }
    }

    /// Outlet Sales and Social Media Report for everyone; Pipeline for the company's own people (the server refuses it elsewhere).
    private var dashboards: [ProjectKind] {
        [.outlet, .social, .pipeline].filter { $0 != .pipeline || viewer.isCompanyMember }
    }

    private var needle: String { query.trimmingCharacters(in: .whitespaces).lowercased() }
    private func matches(_ texts: [String]) -> Bool {
        needle.isEmpty || texts.contains { $0.lowercased().contains(needle) }
    }
    private var shownTemplates: [ProjectTemplate] {
        templates.filter { tp in
            (category == "all" || tp.category == category)
                && matches([tp.name.en, tp.name.id, tp.blurb.en, tp.blurb.id] + tp.fields.flatMap { [$0.name.en, $0.name.id] })
        }
    }
    private var shownDashboards: [ProjectKind] {
        dashboards.filter { (category == "all" || category == "dashboards") && matches([$0.title, $0.blurb]) }
    }
    private var showBlank: Bool {
        category == "all" && matches(["blank", T("Blank project"), T("Start empty")])
    }
    private var categories: [String] {
        Self.categoryOrder.filter { c in
            c == "dashboards" ? !dashboards.isEmpty : templates.contains { $0.category == c }
        }
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                Text(T("The project starts with default sections and opens when it's ready."))
                    .font(NXFont.text(13)).foregroundStyle(NX.mutedFg)
                    .fixedSize(horizontal: false, vertical: true)
                Text(T("What is this project for?")).font(NXFont.display(18, .bold)).foregroundStyle(NX.foreground)
                searchField
                categoryChips
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 250), spacing: 10)], spacing: 10) {
                    if showBlank {
                        Button { onPick(.blank) } label: {
                            GalleryCard(glyph: Image(systemName: "plus"), tint: NX.violet, title: T("Blank project"),
                                        blurb: T("Start empty: To Do, In Progress and Done. You pick the tabs.")) { BlankPreview() }
                        }
                        .buttonStyle(PressableCardStyle())
                    }
                    if loading {
                        ForEach(0..<4, id: \.self) { _ in
                            RoundedRectangle(cornerRadius: 18, style: .continuous).fill(NX.muted.opacity(0.5))
                                .frame(height: 196)
                        }
                    }
                    ForEach(shownTemplates) { tp in
                        Button { onPick(.template(tp)) } label: {
                            GalleryCard(glyph: Image(systemName: TemplateTint.symbol(tp.icon)), tint: TemplateTint.color(tp.tint),
                                        title: tp.name.text, blurb: tp.blurb.text) { TemplatePreview(template: tp) }
                        }
                        .buttonStyle(PressableCardStyle())
                    }
                    ForEach(shownDashboards) { k in
                        Button { onPick(.type(k)) } label: {
                            GalleryCard(glyph: k.glyph, tint: NX.violet, title: k.title, blurb: k.blurb) {
                                DashboardPreview(kind: k)
                            }
                        }
                        .buttonStyle(PressableCardStyle())
                    }
                }
                if failed {
                    Text(T("Templates couldn't load. You can still start blank, or try again in a moment."))
                        .font(NXFont.text(12)).foregroundStyle(NX.mutedFg)
                        .padding(10).frame(maxWidth: .infinity, alignment: .leading)
                        .background(NX.muted.opacity(0.5), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                }
                if !loading && !showBlank && shownTemplates.isEmpty && shownDashboards.isEmpty {
                    VStack(spacing: 8) {
                        Text(String(format: T("No template matches “%@”."), query.trimmingCharacters(in: .whitespaces)))
                            .font(NXFont.text(13)).foregroundStyle(NX.mutedFg).multilineTextAlignment(.center)
                        Button(T("Show all")) { query = ""; category = "all" }
                            .font(NXFont.text(13, .semibold)).foregroundStyle(NX.violetText)
                    }
                    .frame(maxWidth: .infinity).padding(.vertical, 20)
                }
            }
            .padding(20)
        }
        .task {
            await viewer.loadIfNeeded()
            do { templates = try await ProjectTemplateStore.load(); failed = false }
            catch { failed = true }
            loading = false
        }
    }

    private var searchField: some View {
        HStack(spacing: 8) {
            Image(systemName: "magnifyingglass").font(.system(size: 13, weight: .semibold)).foregroundStyle(NX.mutedFg)
            TextField(T("Search templates"), text: $query)
                .font(NXFont.text(14)).textInputAutocapitalization(.never).autocorrectionDisabled()
            if !query.isEmpty {
                Button { query = "" } label: {
                    Image(systemName: "xmark.circle.fill").font(.system(size: 15)).foregroundStyle(NX.mutedFg)
                        .touchTarget44(drawn: 18)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(T("Clear search"))
            }
        }
        .padding(.horizontal, 12).padding(.vertical, 9)
        .background(NX.card, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(NX.border))
    }

    private var categoryChips: some View {
        // Wrapped, not a sideways strip: the strip opened scrolled, with "All" cut on the left and the picked
        // "Dashboards" cut to "D" on the right (UI tour run 13, I-11 / M-8).
        FlowLayout(spacing: 6) {
                ForEach(["all"] + categories, id: \.self) { c in
                    Button { category = c } label: {
                        Text(c == "all" ? T("All") : Self.categoryLabel(c))
                            .font(NXFont.text(12, .semibold))
                            .padding(.horizontal, 12).padding(.vertical, 6)
                            .nxChoiceChip(on: category == c)
                    }
                    .buttonStyle(.plain)
                    .accessibilityAddTraits(category == c ? .isSelected : [])
                }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(T("Template categories"))
    }
}

/// One gallery card: tinted header (icon, name, blurb) above a framed mini preview.
private struct GalleryCard<Preview: View>: View {
    let glyph: Image
    let tint: Color
    let title: String
    let blurb: String
    @ViewBuilder let preview: () -> Preview

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top, spacing: 10) {
                glyph.resizable().scaledToFit().fontWeight(.semibold).foregroundStyle(tint)
                    .frame(width: 16, height: 16)
                    .frame(width: 32, height: 32)
                    .background(tint.opacity(0.15), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                VStack(alignment: .leading, spacing: 2) {
                    Text(title).font(NXFont.text(14, .bold)).foregroundStyle(NX.foreground).lineLimit(1)
                    Text(blurb).font(NXFont.text(12)).foregroundStyle(NX.mutedFg).lineLimit(2)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: 0)
            }
            preview()
                .padding(8)
                .frame(maxWidth: .infinity)
                .frame(height: 104)
                .background(NX.card, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(NX.border))
                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                .accessibilityHidden(true)
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(tint.opacity(0.06), in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).strokeBorder(NX.border))
        .contentShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
    }
}

// MARK: - Previews (plain blocks, like the web's)

private struct Bar: View {
    var fraction: CGFloat = 0.7
    var body: some View {
        GeometryReader { g in
            Capsule().fill(NX.foreground.opacity(0.15)).frame(width: g.size.width * fraction, height: 4)
        }
        .frame(height: 4)
    }
}

private struct Mini: View {
    let text: String
    let color: Color
    var body: some View {
        Text(text).font(.system(size: 8, weight: .medium)).lineLimit(1)
            .foregroundStyle(color)
            .padding(.horizontal, 3).padding(.vertical, 1)
            .background(color.opacity(0.15), in: RoundedRectangle(cornerRadius: 3, style: .continuous))
    }
}

/// One sample value for a preview cell: an option chip, a section chip, a person dot or a bar.
private struct PreviewCell: View {
    let template: ProjectTemplate
    let column: String
    let row: Int
    var body: some View {
        if column.hasPrefix("cf:"), let f = template.fields.first(where: { "cf:\($0.key)" == column }),
           let opts = f.options, !opts.isEmpty {
            let o = opts[row % opts.count]
            Mini(text: o.label.text, color: TemplateTint.color(o.color))
        } else if column == "status", !template.sections.isEmpty {
            let s = template.sections[row % template.sections.count]
            Mini(text: s.name.text, color: TemplateTint.color(s.color))
        } else if column == "assignee" {
            HStack(spacing: 3) {
                Circle().fill(NX.foreground.opacity(0.25)).frame(width: 8, height: 8)
                Bar(fraction: 0.6)
            }
        } else {
            Bar(fraction: row % 2 == 0 ? 0.7 : 0.5)
        }
    }
}

private struct TemplatePreview: View {
    let template: ProjectTemplate
    private var cols: [String] { template.preview.columns ?? [] }

    var body: some View {
        switch template.preview.layout {
        case "board": board
        case "calendar": calendar
        case "gallery": gallery
        case "list": list
        default: table
        }
    }

    private var board: some View {
        HStack(alignment: .top, spacing: 5) {
            ForEach(Array(template.sections.prefix(3).enumerated()), id: \.offset) { c, s in
                VStack(alignment: .leading, spacing: 4) {
                    Mini(text: s.name.text, color: TemplateTint.color(s.color))
                    ForEach(0..<(c == 2 ? 1 : 2), id: \.self) { i in
                        VStack(alignment: .leading, spacing: 3) {
                            Bar(fraction: i == 0 ? 0.8 : 0.5)
                            if let first = cols.first { PreviewCell(template: template, column: first, row: c * 2 + i) }
                        }
                        .padding(4)
                        .background(NX.card, in: RoundedRectangle(cornerRadius: 4, style: .continuous))
                        .overlay(RoundedRectangle(cornerRadius: 4, style: .continuous).strokeBorder(NX.border))
                    }
                    Spacer(minLength: 0)
                }
                .padding(4)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                .background(NX.foreground.opacity(0.04), in: RoundedRectangle(cornerRadius: 6, style: .continuous))
            }
        }
    }

    private var calendar: some View {
        let days = AppLanguage.shared.lang == .id ? ["Sen", "Sel", "Rab", "Kam", "Jum"] : ["Mon", "Tue", "Wed", "Thu", "Fri"]
        let lit: [Int: Int] = [1: 0, 3: 1, 7: 2, 8: 0, 12: 1]
        return VStack(spacing: 3) {
            HStack(spacing: 3) {
                ForEach(days, id: \.self) { d in
                    Text(d).font(.system(size: 8, weight: .semibold)).foregroundStyle(NX.mutedFg).frame(maxWidth: .infinity, alignment: .leading)
                }
            }
            Grid(horizontalSpacing: 3, verticalSpacing: 3) {
                ForEach(0..<3, id: \.self) { r in
                    GridRow {
                        ForEach(0..<5, id: \.self) { c in
                            let i = r * 5 + c
                            RoundedRectangle(cornerRadius: 3, style: .continuous).fill(NX.foreground.opacity(0.05))
                                .overlay(alignment: .bottom) {
                                    if let k = lit[i], !template.sections.isEmpty {
                                        Capsule().fill(TemplateTint.color(template.sections[k % template.sections.count].color).opacity(0.5))
                                            .frame(height: 4).padding(2)
                                    }
                                }
                        }
                    }
                }
            }
        }
    }

    private var gallery: some View {
        HStack(spacing: 5) {
            ForEach(0..<3, id: \.self) { i in
                VStack(alignment: .leading, spacing: 4) {
                    RoundedRectangle(cornerRadius: 4).fill(NX.foreground.opacity(0.07)).frame(height: 30)
                    Bar(fraction: 0.8)
                    if let first = cols.first { PreviewCell(template: template, column: first, row: i) }
                    Spacer(minLength: 0)
                }
                .padding(4)
                .background(NX.foreground.opacity(0.04), in: RoundedRectangle(cornerRadius: 6, style: .continuous))
            }
        }
    }

    private var list: some View {
        VStack(alignment: .leading, spacing: 9) {
            ForEach(0..<4, id: \.self) { i in
                HStack(spacing: 6) {
                    Image(systemName: "doc.text").font(.system(size: 9)).foregroundStyle(NX.mutedFg)
                    Bar(fraction: i % 2 == 0 ? 0.75 : 0.5)
                }
            }
        }
        .frame(maxHeight: .infinity)
    }

    private var table: some View {
        let shown = Array(cols.prefix(2))
        return Grid(alignment: .leading, horizontalSpacing: 6, verticalSpacing: 6) {
            GridRow {
                Text(T("Name")).lineLimit(1)
                ForEach(shown, id: \.self) { c in Text(template.columnLabel(c)).lineLimit(1) }
            }
            .font(.system(size: 8, weight: .semibold)).foregroundStyle(NX.mutedFg)
            Divider().overlay(NX.border).gridCellUnsizedAxes(.horizontal)
            ForEach(0..<3, id: \.self) { r in
                GridRow {
                    Bar(fraction: r % 2 == 0 ? 0.75 : 0.5)
                    ForEach(shown, id: \.self) { c in PreviewCell(template: template, column: c, row: r) }
                }
            }
        }
        .frame(maxHeight: .infinity, alignment: .top)
    }
}

private struct BlankPreview: View {
    var body: some View {
        HStack(alignment: .top, spacing: 5) {
            ForEach(Array([2, 1, 0].enumerated()), id: \.offset) { _, n in
                VStack(alignment: .leading, spacing: 4) {
                    Bar(fraction: 0.5)
                    ForEach(0..<n, id: \.self) { _ in
                        RoundedRectangle(cornerRadius: 3).fill(NX.foreground.opacity(0.06)).frame(height: 12)
                    }
                    Spacer(minLength: 0)
                }
                .padding(4)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                .overlay(RoundedRectangle(cornerRadius: 6, style: .continuous).strokeBorder(NX.border, lineWidth: 1))
            }
        }
    }
}

private struct DashboardPreview: View {
    let kind: ProjectKind
    var body: some View {
        if kind == .pipeline {
            VStack(spacing: 6) {
                ForEach(Array([1.0, 0.78, 0.55, 0.34].enumerated()), id: \.offset) { i, w in
                    GeometryReader { g in
                        RoundedRectangle(cornerRadius: 3)
                            .fill(i == 3 ? NX.violet.opacity(0.6) : NX.foreground.opacity(0.15))
                            .frame(width: g.size.width * w, height: 12)
                            .frame(maxWidth: .infinity)
                    }
                    .frame(height: 12)
                }
            }
            .frame(maxHeight: .infinity)
        } else if kind == .social {
            // A line, like the report's engagement trend (the web draws this card as a line chart, F-07 / I-11).
            VStack(spacing: 6) {
                HStack(spacing: 6) {
                    ForEach(0..<2, id: \.self) { _ in RoundedRectangle(cornerRadius: 4).fill(NX.foreground.opacity(0.07)).frame(height: 20) }
                }
                SocialSparkline(values: [3, 5, 4, 7, 6, 9, 8, 11])
            }
        } else {
            VStack(spacing: 6) {
                HStack(spacing: 6) {
                    ForEach(0..<2, id: \.self) { _ in RoundedRectangle(cornerRadius: 4).fill(NX.foreground.opacity(0.07)).frame(height: 20) }
                }
                HStack(alignment: .bottom, spacing: 4) {
                    ForEach(Array([0.4, 0.7, 0.55, 0.9, 0.65, 0.8].enumerated()), id: \.offset) { i, h in
                        GeometryReader { g in
                            VStack {
                                Spacer(minLength: 0)
                                RoundedRectangle(cornerRadius: 2)
                                    .fill(i == 3 ? NX.violet.opacity(0.6) : NX.foreground.opacity(0.15))
                                    .frame(height: g.size.height * h)
                            }
                        }
                    }
                }
            }
        }
    }
}

/// The pick above the details form: what it will create, and the way back to the gallery.
struct GalleryChosenHeader: View {
    let pick: GalleryPick
    let onChange: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 8) {
                glyph.resizable().scaledToFit().fontWeight(.semibold).frame(width: 14, height: 14)
                Text(title).font(NXFont.text(13, .semibold)).lineLimit(1)
                Spacer(minLength: 4)
                Button(T("Change template"), action: onChange).font(NXFont.text(12, .semibold)).foregroundStyle(NX.mutedFg)
            }
            .foregroundStyle(NX.violetText)
            if let tp = pick.template {
                Text("\(T("Sections")): " + tp.sections.map { $0.name.text }.joined(separator: " → "))
                    .font(NXFont.text(12)).foregroundStyle(NX.mutedFg).fixedSize(horizontal: false, vertical: true)
                if !tp.fields.isEmpty {
                    Text("\(T("Fields")): " + tp.fields.map { $0.name.text }.joined(separator: ", "))
                        .font(NXFont.text(12)).foregroundStyle(NX.mutedFg).fixedSize(horizontal: false, vertical: true)
                }
                if !tp.builtins.isEmpty {
                    Text(tp.builtins.map { $0.name.text }.joined(separator: " · "))
                        .font(NXFont.text(11)).foregroundStyle(NX.mutedFg.opacity(0.8)).lineLimit(2)
                }
            }
        }
        .padding(.horizontal, 12).padding(.vertical, 9)
        .background(NX.violet.opacity(0.08), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
    }

    private var glyph: Image {
        switch pick {
        case .blank: return Image(systemName: "plus")
        case .template(let t): return Image(systemName: TemplateTint.symbol(t.icon))
        case .type(let k): return k.glyph
        }
    }
    private var title: String {
        switch pick {
        case .blank: return T("Blank project")
        case .template(let t): return t.name.text
        case .type(let k): return k.title
        }
    }
}
