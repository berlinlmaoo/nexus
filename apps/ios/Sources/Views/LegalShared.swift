import SwiftUI
import PDFKit
import UniformTypeIdentifiers

// ─────────────────────────────────────────────────────────────────────────────
// Legal's shared pieces (owner, 14 Oct 2026): the labels and colours of the web's legal-labels.ts, the
// toast, the status chip, the "Belongs to" picker, word-diff text, the PDF preview and the input chrome.
// ─────────────────────────────────────────────────────────────────────────────

enum LegalLabels {
    static let docTypes = ["SURAT", "SP", "SK", "PKS", "SPK", "NDA", "MOU", "INVOICE", "PJM", "PGB", "OTHER"]
    static let statuses = ["DRAFT", "FINAL", "SENT", "SIGNED", "VOID"]

    /// Document types as people call them. The codes (SPK, PKS, …) are what the numbers print.
    static func docType(_ type: String) -> String {
        switch type {
        case "SURAT": return T("Letter")
        case "SP": return T("Warning letter (SP)")
        case "SK": return T("Power of attorney (SK)")
        case "PKS": return T("Cooperation agreement (PKS)")
        case "SPK": return T("Work agreement (SPK)")
        case "NDA": return T("Non-disclosure agreement (NDA)")
        case "MOU": return T("Memorandum of understanding (MOU)")
        case "INVOICE": return T("Invoice")
        case "PJM": return T("Loan of goods")
        case "PGB": return T("Return of goods")
        case "OTHER": return T("Other")
        default: return type
        }
    }

    static func fieldType(_ type: String) -> String {
        switch type {
        case "text": return T("Text")
        case "longtext": return T("Long text")
        case "date": return T("Date")
        case "number": return T("Number")
        case "money": return T("Amount (Rp)")
        case "select": return T("Choice")
        case "boolean": return T("Yes / no")
        case "list": return T("Table rows")
        default: return type
        }
    }

    static func status(_ status: String) -> String {
        switch status {
        case "DRAFT": return T("Draft")
        case "FINAL": return T("Final")
        case "SENT": return T("Sent")
        case "SIGNED": return T("Signed")
        case "VOID": return T("Void")
        default: return status
        }
    }

    /// A quiet draft, a blue final, an amber sent, a green signed, a struck-through void.
    static func statusTone(_ status: String) -> ChipTone {
        switch status {
        case "FINAL": return .info
        case "SENT": return .warning
        case "SIGNED": return .success
        default: return .neutral
        }
    }

    static func versionKind(_ kind: String) -> String {
        switch kind {
        case "GENERATED": return T("Generated")
        case "MANUAL": return T("Edited")
        case "GIDEON": return "GIDEON"
        case "UPLOAD": return T("Uploaded")
        case "RESTORE": return T("Restored")
        default: return kind
        }
    }

    static func resetPeriod(_ p: String) -> String { p == "MONTH" ? T("Monthly") : T("Yearly") }

    static func bytes(_ n: Int) -> String {
        if n < 1024 { return "\(n) B" }
        if n < 1024 * 1024 { return "\(Int((Double(n) / 1024).rounded())) KB" }
        return String(format: "%.1f MB", Double(n) / 1024 / 1024)
    }

    /// "2026-09-30" → "30 Sep 2026" in the interface language.
    static func day(_ day: String?) -> String {
        guard let day, let d = LegalText.date(fromDay: day) else { return "—" }
        return AppDateLocale.formatter("d MMM yyyy", timeZone: TimeZone(identifier: "Asia/Jakarta")).string(from: d)
    }

    /// An ISO timestamp → "14 Oct 2026".
    static func date(_ iso: String?) -> String {
        guard let iso, let d = parseISO(iso) else { return "—" }
        return AppDateLocale.formatter("d MMM yyyy").string(from: d)
    }

    static func parseISO(_ s: String) -> Date? {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let d = f.date(from: s) { return d }
        f.formatOptions = [.withInternetDateTime]
        return f.date(from: s)
    }

    static func role(_ r: String?) -> String? {
        guard let r, !r.isEmpty else { return nil }
        return orgRoleLabel(r)
    }
}

// MARK: - File types

enum LegalFileTypes {
    static let docx: UTType = UTType("org.openxmlformats.wordprocessingml.document") ?? UTType(filenameExtension: "docx") ?? .data
    /// A document made elsewhere, or a new version: PDF, Word, or a photo of it.
    static let documents: [UTType] = [.pdf, docx, .jpeg, .png]

    /// A scan or a PDF upload becomes the signed copy (web UploadVersionButton).
    static func isSignedCopy(_ url: URL) -> Bool {
        ["pdf", "jpg", "jpeg", "png"].contains(url.pathExtension.lowercased())
    }
}

// MARK: - Toasts

/// One line of feedback after a write: green done, amber warning (e.g. the PDF couldn't be made), red failure.
@MainActor
@Observable
final class LegalToasts {
    static let shared = LegalToasts()
    enum Tone { case success, warning, failure }
    struct Item: Equatable, Identifiable {
        let id = UUID()
        let text: String
        let tone: Tone
    }
    var item: Item?

    func success(_ text: String) { item = Item(text: text, tone: .success) }
    func warning(_ text: String) { item = Item(text: text, tone: .warning) }
    func failure(_ text: String) { item = Item(text: text, tone: .failure) }
    func failure(_ error: Error) { failure(error.legalMessage) }
    /// A non-null `pdfError` from a write: the DOCX is there, the PDF can be retried.
    func pdfWarning(_ reason: String?) {
        guard let reason, !reason.isEmpty else { return }
        warning(String(format: T("The PDF couldn't be made yet: %@"), reason))
    }
}

private struct LegalToastOverlay: ViewModifier {
    @State private var toasts = LegalToasts.shared

    func body(content: Content) -> some View {
        content.overlay(alignment: .bottom) {
            if let item = toasts.item {
                HStack(alignment: .top, spacing: 10) {
                    Image(systemName: icon(item.tone)).foregroundStyle(color(item.tone)).padding(.top, 1)
                    Text(item.text).font(NXFont.text(13, .medium)).foregroundStyle(NX.foreground)
                        .fixedSize(horizontal: false, vertical: true)
                    Spacer(minLength: 0)
                    Button { toasts.item = nil } label: {
                        Image(systemName: "xmark").font(.system(size: 11, weight: .bold)).foregroundStyle(NX.mutedFg).touchTarget44(drawn: 12)
                    }
                    .buttonStyle(.plain).accessibilityLabel(T("Close"))
                }
                .padding(12)
                .background(NX.card, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(NX.border))
                .shadow(color: .black.opacity(0.12), radius: 8, y: 3)
                .padding(.horizontal, 16).padding(.bottom, 16)
                .frame(maxWidth: 520)
                .transition(.move(edge: .bottom).combined(with: .opacity))
                .task(id: item.id) {
                    try? await Task.sleep(nanoseconds: 4_500_000_000)
                    if toasts.item?.id == item.id { toasts.item = nil }
                }
                .accessibilityElement(children: .combine)
            }
        }
        .animation(.easeOut(duration: 0.2), value: toasts.item)
    }

    private func icon(_ t: LegalToasts.Tone) -> String {
        switch t {
        case .success: return "checkmark.circle.fill"
        case .warning: return "exclamationmark.triangle.fill"
        case .failure: return "exclamationmark.circle.fill"
        }
    }
    private func color(_ t: LegalToasts.Tone) -> Color {
        switch t {
        case .success: return NX.success
        case .warning: return NX.warning
        case .failure: return NX.danger
        }
    }
}

extension View {
    /// Legal's toasts at the bottom of this screen.
    func legalToasts() -> some View { modifier(LegalToastOverlay()) }
}

// MARK: - Small pieces

struct LegalStatusChip: View {
    let status: String
    var body: some View {
        Text(LegalLabels.status(status))
            .font(NXFont.text(11, .bold))
            .strikethrough(status == "VOID")
            .padding(.horizontal, 8).padding(.vertical, 4)
            .foregroundStyle(LegalLabels.statusTone(status).fg)
            .background(LegalLabels.statusTone(status).bg, in: Capsule())
    }
}

/// The text field / menu chrome of Legal's forms (the Pipeline deal sheet's).
struct LegalInputChrome: ViewModifier {
    var invalid = false
    func body(content: Content) -> some View {
        content
            .padding(.horizontal, 11)
            .frame(minHeight: 40)
            .background(NX.background, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).strokeBorder(invalid ? NX.danger.opacity(0.7) : NX.border))
    }
}

extension View {
    func legalInput(invalid: Bool = false) -> some View { modifier(LegalInputChrome(invalid: invalid)) }
}

/// A labelled form row: the label above the control, an optional hint / error below.
struct LegalFormRow<Content: View>: View {
    let label: String
    var required = false
    var mono: String? = nil
    var hint: String? = nil
    var error: String? = nil
    @ViewBuilder let content: () -> Content

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .firstTextBaseline, spacing: 4) {
                Text(label).font(NXFont.text(13, .semibold)).foregroundStyle(NX.foreground)
                if required { Text(verbatim: "*").font(NXFont.text(13, .bold)).foregroundStyle(NX.danger) }
                if let mono { Text(verbatim: mono).font(.system(size: 10, design: .monospaced)).foregroundStyle(NX.mutedFg) }
            }
            content()
            if let error, !error.isEmpty {
                Text(T(error)).font(NXFont.text(12)).foregroundStyle(NX.danger).fixedSize(horizontal: false, vertical: true)
            } else if let hint, !hint.isEmpty {
                Text(T(hint)).font(NXFont.text(12)).foregroundStyle(NX.mutedFg).fixedSize(horizontal: false, vertical: true)
            }
        }
    }
}

/// A menu that picks one of `options` (value, label), or "all" / nothing when `noneLabel` is given.
struct LegalMenuPicker: View {
    let options: [(value: String, label: String)]
    @Binding var selection: String?
    var noneLabel: String? = nil
    var placeholder: String = ""
    var invalid = false
    var compact = false

    private var current: String {
        if let s = selection, let o = options.first(where: { $0.value == s }) { return o.label }
        return noneLabel ?? placeholder
    }

    var body: some View {
        Menu {
            if let noneLabel {
                Button { selection = nil } label: {
                    if selection == nil { Label(noneLabel, systemImage: "checkmark") } else { Text(noneLabel) }
                }
            }
            ForEach(options, id: \.value) { o in
                Button { selection = o.value } label: {
                    if selection == o.value { Label(o.label, systemImage: "checkmark") } else { Text(o.label) }
                }
            }
        } label: {
            HStack(spacing: 6) {
                Text(current).font(NXFont.text(compact ? 13 : 14, compact ? .medium : .regular))
                    .foregroundStyle(selection == nil && noneLabel == nil ? NX.mutedFg : NX.foreground).lineLimit(1)
                if !compact { Spacer(minLength: 4) }
                Image(systemName: "chevron.up.chevron.down").font(.system(size: 9, weight: .semibold)).foregroundStyle(NX.mutedFg)
            }
            .legalInput(invalid: invalid)
            .contentShape(Rectangle())
        }
        .menuIndicator(.hidden)
    }
}

/// A switch with its label, the web's `<Switch/> label`.
struct LegalToggle: View {
    let label: String
    @Binding var isOn: Bool
    var body: some View {
        Toggle(isOn: $isOn) { Text(label).font(NXFont.text(14)).foregroundStyle(NX.foreground) }
            .tint(NX.violet)
    }
}

/// A red box listing what to fix (a template's problems, form errors not tied to a field).
struct LegalProblemList: View {
    var title: String? = nil
    let lines: [String]
    var body: some View {
        if !lines.isEmpty {
            VStack(alignment: .leading, spacing: 6) {
                if let title {
                    Label(title, systemImage: "exclamationmark.triangle.fill").font(NXFont.text(13, .semibold)).foregroundStyle(NX.danger)
                }
                ForEach(Array(lines.enumerated()), id: \.offset) { _, line in
                    HStack(alignment: .top, spacing: 6) {
                        Text(verbatim: "•").foregroundStyle(NX.danger)
                        Text(line).font(NXFont.text(13)).foregroundStyle(NX.danger).fixedSize(horizontal: false, vertical: true)
                    }
                }
            }
            .padding(12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(NX.danger.opacity(0.06), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).strokeBorder(NX.danger.opacity(0.35)))
        }
    }
}

/// A section heading inside a Legal pane: title, and a muted line under it.
struct LegalSectionHeader<Trailing: View>: View {
    let title: String
    var subtitle: String? = nil
    @ViewBuilder var trailing: () -> Trailing
    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            VStack(alignment: .leading, spacing: 3) {
                Text(title).font(NXFont.text(16, .semibold)).foregroundStyle(NX.foreground)
                if let subtitle, !subtitle.isEmpty {
                    Text(subtitle).font(NXFont.text(13)).foregroundStyle(NX.mutedFg).fixedSize(horizontal: false, vertical: true)
                }
            }
            Spacer(minLength: 0)
            trailing()
        }
    }
}

extension LegalSectionHeader where Trailing == EmptyView {
    init(title: String, subtitle: String? = nil) {
        self.title = title; self.subtitle = subtitle; self.trailing = { EmptyView() }
    }
}

struct LegalLoadingRow: View {
    var body: some View {
        HStack(spacing: 8) {
            ProgressView()
            Text(T("Loading…")).font(NXFont.text(13)).foregroundStyle(NX.mutedFg)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.vertical, 18)
    }
}

/// A card wrapper for list rows (hairline, rounded), the web's `rounded-lg border divide-y`.
struct LegalListCard<Content: View>: View {
    @ViewBuilder let content: () -> Content
    var body: some View {
        VStack(spacing: 0) { content() }
            .background(NX.card, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(NX.border))
    }
}

/// Words removed struck through in red, words added highlighted in green.
enum LegalDiffText {
    static func attributed(_ segments: [LegalSegment]) -> AttributedString {
        var out = AttributedString()
        for s in segments {
            var run = AttributedString(s.text)
            switch s.type {
            case "del":
                run.swiftUI.foregroundColor = ChipTone.danger.fg
                run.swiftUI.backgroundColor = NX.danger.opacity(0.14)
                run.swiftUI.strikethroughStyle = Text.LineStyle(pattern: .solid)
            case "ins":
                run.swiftUI.foregroundColor = ChipTone.success.fg
                run.swiftUI.backgroundColor = NX.success.opacity(0.16)
            default:
                break
            }
            out.append(run)
        }
        return out
    }
}

struct LegalSegmentsView: View {
    let segments: [LegalSegment]
    var size: CGFloat = 14
    var body: some View {
        Text(LegalDiffText.attributed(segments))
            .font(NXFont.text(size)).foregroundStyle(NX.foreground)
            .lineSpacing(3)
            .frame(maxWidth: .infinity, alignment: .leading)
            .fixedSize(horizontal: false, vertical: true)
    }
}

// MARK: - PDF preview

/// A downloaded PDF drawn in place (the web's iframe of the shown version).
struct LegalPDFView: UIViewRepresentable {
    let file: URL
    func makeUIView(context: Context) -> PDFView {
        let v = PDFView()
        v.autoScales = true
        v.displayMode = .singlePageContinuous
        v.displayDirection = .vertical
        v.backgroundColor = .secondarySystemBackground
        v.document = PDFDocument(url: file)
        return v
    }
    func updateUIView(_ v: PDFView, context: Context) {
        if v.document?.documentURL != file { v.document = PDFDocument(url: file) }
    }
}

// MARK: - Sheets

/// What a Legal screen's one `.sheet(item:)` shows: the Files picker or the share sheet.
enum LegalFileRoute: Identifiable {
    case pick([UTType], tag: String)
    case share(URL)
    var id: String {
        switch self {
        case .pick(_, let tag): return "pick-\(tag)"
        case .share(let u): return "share-\(u.path)"
        }
    }
}

extension View {
    /// The Files picker (one file) and the share sheet, behind one `.sheet(item:)`.
    func legalFileSheet(_ route: Binding<LegalFileRoute?>, onPick: @escaping (String, URL) -> Void) -> some View {
        sheet(item: route) { r in
            switch r {
            case .pick(let types, let tag):
                DocumentPicker(types: types, multiple: false) { urls in
                    if let u = urls.first { onPick(tag, u) }
                }
                .ignoresSafeArea()
            case .share(let file):
                ActivityView(items: [file])
            }
        }
    }
}

// MARK: - Belongs to (a project or a Pipeline deal)

enum LegalLink: Equatable {
    case project(id: String, label: String)
    case deal(id: String, label: String)

    var label: String {
        switch self {
        case .project(_, let l), .deal(_, let l): return l
        }
    }
    var icon: String {
        switch self {
        case .project: return "folder"
        case .deal: return "briefcase"
        }
    }
    var projectId: String? { if case .project(let id, _) = self { return id } else { return nil } }
    var dealId: String? { if case .deal(let id, _) = self { return id } else { return nil } }

    static func of(project: LegalProjectRef?, deal: LegalDealRef?) -> LegalLink? {
        if let deal { return .deal(id: deal.id, label: "\(deal.code) · \(deal.name)") }
        if let project { return .project(id: project.id, label: project.name) }
        return nil
    }
}

/// The "Belongs to" control: shows the link, opens the search sheet, ✕ clears it.
struct LegalLinkButton: View {
    let value: LegalLink?
    var placeholder: String? = nil
    let onChange: (LegalLink?) -> Void
    @State private var picking = false

    var body: some View {
        HStack(spacing: 6) {
            Button { picking = true } label: {
                HStack(spacing: 6) {
                    Image(systemName: value?.icon ?? "link").font(.system(size: 12, weight: .medium)).foregroundStyle(NX.mutedFg)
                    Text(value?.label ?? placeholder ?? T("Link to a project or deal"))
                        .font(NXFont.text(14)).foregroundStyle(value == nil ? NX.mutedFg : NX.foreground).lineLimit(1)
                    Spacer(minLength: 0)
                }
                .legalInput()
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            if value != nil {
                Button { onChange(nil) } label: {
                    Image(systemName: "xmark").font(.system(size: 11, weight: .bold)).foregroundStyle(NX.mutedFg)
                        .frame(width: 32, height: 32).touchTarget44(drawn: 32)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(T("Remove link"))
            }
        }
        .sheet(isPresented: $picking) {
            LegalLinkPickerSheet { picked in onChange(picked) }
        }
    }
}

/// Search the projects and deals the viewer can open.
struct LegalLinkPickerSheet: View {
    let onPick: (LegalLink) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var q = ""
    @State private var links: LegalLinks?
    @State private var error: String?

    var body: some View {
        NavigationStack {
            List {
                if let error {
                    Text(error).font(NXFont.text(13)).foregroundStyle(NX.danger)
                } else if links == nil {
                    LegalLoadingRow()
                } else if let links, links.deals.isEmpty && links.projects.isEmpty {
                    Text(T("Nothing found")).font(NXFont.text(14)).foregroundStyle(NX.mutedFg)
                }
                if let deals = links?.deals, !deals.isEmpty {
                    Section(T("Pipeline deals")) {
                        ForEach(deals, id: \.id) { d in
                            row("briefcase", "\(d.code) · \(d.name)") { onPick(.deal(id: d.id, label: "\(d.code) · \(d.name)")) }
                        }
                    }
                }
                if let projects = links?.projects, !projects.isEmpty {
                    Section(T("Projects")) {
                        ForEach(projects, id: \.id) { p in
                            row("folder", p.name) { onPick(.project(id: p.id, label: p.name)) }
                        }
                    }
                }
            }
            .searchable(text: $q, placement: .navigationBarDrawer(displayMode: .always), prompt: T("Search projects and deals…"))
            .task(id: q) {
                if !q.isEmpty { try? await Task.sleep(nanoseconds: 250_000_000) }
                if Task.isCancelled { return }
                do { links = try await APIClient.shared.legalLinks(q: q.trimmingCharacters(in: .whitespaces)); error = nil }
                catch { if !Task.isCancelled { self.error = error.legalMessage } }
            }
            .navigationTitle(T("Belongs to"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button(T("Cancel")) { dismiss() } } }
        }
        .presentationDetents([.medium, .large])
    }

    private func row(_ icon: String, _ text: String, action: @escaping () -> Void) -> some View {
        Button { action(); dismiss() } label: {
            Label { Text(text).foregroundStyle(NX.foreground).lineLimit(1) } icon: { Image(systemName: icon).foregroundStyle(NX.mutedFg) }
        }
    }
}
