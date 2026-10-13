import SwiftUI

// ─────────────────────────────────────────────────────────────────────────────
// One legal document (owner, 14 Oct 2026; web LegalDocumentSheet): its archive fields, its files, every
// version, and — for a Word version — Review & edit (paragraph edits, GIDEON's precise edit) and Compare.
// Pushed onto the Legal stack: on the phone a native push, on iPad / Mac it fills the detail column.
// ─────────────────────────────────────────────────────────────────────────────

/// The document, shared by the overview, the editor and GIDEON so a new version shows everywhere at once.
@MainActor
@Observable
final class LegalDocumentModel {
    let id: String
    private(set) var doc: LegalDocument?
    var error: String?

    init(id: String) { self.id = id }

    /// `quiet`: a background re-read (waiting for a PDF) that says nothing when it fails.
    func load(quiet: Bool = false) async {
        do {
            doc = try await APIClient.shared.legalDocument(id: id)
            error = nil
        } catch {
            if doc == nil { self.error = error.legalMessage } else if !quiet { LegalToasts.shared.failure(error) }
        }
    }

    /// PATCH; the answer replaces the document. Says "Saved" unless `quiet`.
    @discardableResult
    func patch(_ fields: [String: Any], quiet: Bool = false) async -> Bool {
        do {
            doc = try await APIClient.shared.legalUpdateDocument(id: id, fields: fields)
            if !quiet { LegalToasts.shared.success(T("Saved")) }
            return true
        } catch {
            LegalToasts.shared.failure(error)
            return false
        }
    }

    /// A version write the server refused. A 409 means someone else saved first: show the newer version.
    func versionRefused(_ error: Error) async {
        if (error as? LegalAPIError)?.conflict == true {
            await load()
            LegalToasts.shared.warning(T("Someone else saved a newer version first. It's shown now — make your change again on top of it."))
        } else {
            LegalToasts.shared.failure(error)
        }
    }
}

struct LegalDocumentView: View {
    let documentId: String

    enum Pane: String, Hashable { case overview, edit, compare }

    @Environment(\.horizontalSizeClass) private var hSize
    @State private var model: LegalDocumentModel
    @State private var editor = LegalEditorModel()
    @State private var pane: Pane = .overview
    @State private var route: LegalFileRoute?

    init(documentId: String) {
        self.documentId = documentId
        _model = State(initialValue: LegalDocumentModel(id: documentId))
    }

    private var gutter: CGFloat { hSize == .regular ? 32 : 16 }

    var body: some View {
        Group {
            if let doc = model.doc {
                content(doc)
            } else if let error = model.error {
                EmptyState(icon: "exclamationmark.triangle", title: T("Couldn't open this document"), subtitle: error,
                           actionTitle: T("Try again"), actionIcon: "arrow.clockwise") { Task { await model.load() } }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .background(NX.background.ignoresSafeArea())
        .navigationTitle(model.doc.map { $0.number.isEmpty ? $0.title : $0.number } ?? T("Document"))
        .navigationBarTitleDisplayMode(.inline)
        .task { await model.load() }
        // PDFs are made in the background after generate / save / upload / approve: while a recent Word
        // version has none yet, ask again every 4 s, for at most 3 minutes after it was made.
        .task(id: pdfPollKey) { await pollForPdf() }
        .legalFileSheet($route) { _, url in Task { await uploadVersion(url) } }
        .legalToasts()
    }

    /// The versions still waiting for their PDF; a change restarts the poll.
    private var pdfPollKey: String {
        (model.doc?.versionsAwaitingPdf() ?? []).map { String($0.version) }.joined(separator: ",")
    }

    private func pollForPdf() async {
        while let doc = model.doc, !doc.versionsAwaitingPdf().isEmpty {
            try? await Task.sleep(nanoseconds: 4_000_000_000)
            guard !Task.isCancelled else { return }
            await model.load(quiet: true)
        }
    }

    private func content(_ doc: LegalDocument) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                header(doc)
                statusRow(doc)
                panePicker(doc)
                switch pane {
                case .overview: LegalDocumentOverview(model: model, doc: doc, wide: hSize == .regular, route: $route)
                case .edit: editPane(doc)
                case .compare: LegalCompareView(doc: doc)
                }
            }
            .padding(.horizontal, gutter)
            .padding(.vertical, 18)
            .frame(maxWidth: 980, alignment: .leading)
            .frame(maxWidth: .infinity)
        }
        .scrollDismissesKeyboard(.interactively)
        .refreshable { await model.load() }
        .safeAreaInset(edge: .bottom) {
            if pane == .edit && !editor.pending.isEmpty {
                LegalSaveEditsBar(editor: editor) { await saveEdits(doc) }
            }
        }
        .onChange(of: doc.currentVersion) { _, _ in editor.selected = [] }
    }

    private func header(_ doc: LegalDocument) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            Text(doc.number.isEmpty ? T("No number") : doc.number)
                .font(.system(size: 13, design: .monospaced)).foregroundStyle(NX.mutedFg).textSelection(.enabled)
            Text(doc.title).font(NXFont.text(hSize == .regular ? 24 : 21, .semibold)).foregroundStyle(NX.foreground)
                .fixedSize(horizontal: false, vertical: true)
            Text(headerLine(doc)).font(NXFont.text(13)).foregroundStyle(NX.mutedFg).fixedSize(horizontal: false, vertical: true)
        }
    }

    private func headerLine(_ doc: LegalDocument) -> String {
        var parts = [LegalLabels.docType(doc.docType), doc.company?.name ?? "—", LegalLabels.day(doc.docDate)]
        if let t = doc.template { parts.append(String(format: T("from %@ v%d"), t.name, t.version)) }
        return parts.joined(separator: " · ")
    }

    private func statusRow(_ doc: LegalDocument) -> some View {
        HStack(spacing: 10) {
            LegalStatusChip(status: doc.status)
            Menu {
                ForEach(LegalLabels.statuses, id: \.self) { s in
                    Button {
                        guard s != doc.status else { return }
                        Task { await model.patch(["status": s]) }
                    } label: {
                        if s == doc.status { Label(LegalLabels.status(s), systemImage: "checkmark") } else { Text(LegalLabels.status(s)) }
                    }
                }
            } label: {
                HStack(spacing: 4) {
                    Text(T("Status")).font(NXFont.text(13, .medium))
                    Image(systemName: "chevron.up.chevron.down").font(.system(size: 9, weight: .semibold))
                }
                .foregroundStyle(NX.foreground)
                .padding(.horizontal, 10).frame(minHeight: 30)
                .overlay(RoundedRectangle(cornerRadius: 9, style: .continuous).strokeBorder(NX.border))
            }
            .menuIndicator(.hidden)
            .accessibilityLabel(T("Status"))
            Spacer(minLength: 0)
        }
    }

    @ViewBuilder private func panePicker(_ doc: LegalDocument) -> some View {
        let hasWord = doc.versions.contains(where: \.hasDocx)
        let canCompare = doc.wordVersions.count >= 2
        if hasWord {
            Picker(T("Document view"), selection: $pane) {
                Text(T("Overview")).tag(Pane.overview)
                Text(T("Review & edit")).tag(Pane.edit)
                if canCompare { Text(T("Compare")).tag(Pane.compare) }
            }
            .pickerStyle(.segmented)
            .frame(maxWidth: 460)
            .onChange(of: canCompare) { _, can in if !can && pane == .compare { pane = .overview } }
        }
    }

    @ViewBuilder private func editPane(_ doc: LegalDocument) -> some View {
        if doc.current?.hasDocx == true {
            LegalGideonPanel(model: model, doc: doc, editor: editor)
            LegalParagraphEditor(doc: doc, editor: editor)
        } else {
            Text(T("The current version is not a Word file, so it can't be edited here. Restore a Word version to edit it."))
                .font(NXFont.text(14)).foregroundStyle(NX.mutedFg)
        }
    }

    private func saveEdits(_ doc: LegalDocument) async {
        let edits = editor.pending.map { (index: $0.key, text: $0.value) }.sorted { $0.index < $1.index }
        do {
            let res = try await APIClient.shared.legalSaveEdits(id: doc.id, baseVersion: doc.currentVersion, edits: edits,
                                                                note: editor.note.trimmingCharacters(in: .whitespacesAndNewlines))
            LegalToasts.shared.success(String(format: T("Saved as version %d"), res.version))
            LegalToasts.shared.pdfWarning(res.pdfError)
            editor.reset()
            await model.load()
        } catch {
            if (error as? LegalAPIError)?.conflict == true { editor.reset() }
            await model.versionRefused(error)
        }
    }

    private func uploadVersion(_ file: URL) async {
        guard let doc = model.doc else { return }
        do {
            let res = try await APIClient.shared.legalUploadVersion(id: doc.id, baseVersion: doc.currentVersion, file: file, note: "",
                                                                    status: LegalFileTypes.isSignedCopy(file) ? "SIGNED" : nil)
            LegalToasts.shared.success(String(format: T("Uploaded as version %d"), res.version))
            LegalToasts.shared.pdfWarning(res.pdfError)
            await model.load()
        } catch {
            await model.versionRefused(error)
        }
    }
}

// MARK: - Overview

private struct LegalDocumentOverview: View {
    let model: LegalDocumentModel
    let doc: LegalDocument
    let wide: Bool
    @Binding var route: LegalFileRoute?

    @State private var title = ""
    @State private var counterparty = ""
    @State private var notes = ""
    @State private var pdf: URL?
    @State private var pdfFailed = false
    @State private var saving = false
    @State private var restoring: Int?

    private var dirty: Bool { title != doc.title || counterparty != doc.counterparty || notes != doc.notes }

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            if let shown = doc.shownVersion {
                LegalFileButtons(doc: doc, version: shown, model: model, route: $route)
                if shown.hasPdf { preview(shown) }
            }
            detailsCard
            versionsCard
        }
        .onAppear(perform: syncDraft)
        .onChange(of: doc.updatedAt) { _, _ in syncDraft() }
    }

    private func syncDraft() {
        title = doc.title
        counterparty = doc.counterparty
        notes = doc.notes
    }

    private func preview(_ v: LegalDocVersion) -> some View {
        ZStack {
            if let pdf {
                LegalPDFView(file: pdf)
            } else if pdfFailed {
                Text(T("Couldn't open this file.")).font(NXFont.text(13)).foregroundStyle(NX.mutedFg)
            } else {
                ProgressView()
            }
        }
        .frame(maxWidth: .infinity)
        .frame(height: wide ? 620 : 460)
        .background(NX.muted, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(NX.border))
        .task(id: "\(doc.id)-\(v.version)-\(v.hasPdf)") {
            pdf = nil
            pdfFailed = false
            do { pdf = try await APIClient.shared.legalDownloadDocument(id: doc.id, version: v.version, format: .pdf, inline: true) }
            catch { if !Task.isCancelled { pdfFailed = true } }
        }
    }

    private var detailsCard: some View {
        NXCard(padding: 16) {
            VStack(alignment: .leading, spacing: 14) {
                if wide {
                    HStack(alignment: .top, spacing: 12) { titleField; counterpartyField }
                } else {
                    titleField
                    counterpartyField
                }
                LegalFormRow(label: T("Notes")) {
                    TextEditor(text: $notes)
                        .font(NXFont.text(14)).scrollContentBackground(.hidden)
                        .frame(minHeight: 64)
                        .padding(.horizontal, 6).padding(.vertical, 4)
                        .background(NX.background, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                        .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).strokeBorder(NX.border))
                }
                Button {
                    Task {
                        saving = true
                        await model.patch(["title": title.trimmingCharacters(in: .whitespacesAndNewlines), "counterparty": counterparty, "notes": notes])
                        saving = false
                    }
                } label: { Text(T("Save")) }
                    .buttonStyle(.nxPrimary)
                    .disabled(!dirty || title.trimmingCharacters(in: .whitespaces).isEmpty || saving)
                Divider().overlay(NX.border)
                LegalFormRow(label: T("Belongs to")) {
                    // A link the viewer can't open comes back as null project / deal with linkHidden: say so
                    // rather than draw "not linked". Picking another link still replaces it.
                    LegalLinkButton(value: LegalLink.of(project: doc.project, deal: doc.deal),
                                    placeholder: doc.linkHidden ? T("Linked to a project you can't open") : nil) { v in
                        let fields: [String: Any]
                        switch v {
                        case .deal(let id, _)?: fields = ["dealId": id, "projectId": NSNull()]
                        case .project(let id, _)?: fields = ["projectId": id, "dealId": NSNull()]
                        case nil: fields = ["projectId": NSNull(), "dealId": NSNull()]
                        }
                        Task { await model.patch(fields) }
                    }
                }
            }
        }
    }

    private var titleField: some View {
        LegalFormRow(label: T("Title")) { TextField("", text: $title).font(NXFont.text(14)).legalInput() }
    }

    private var counterpartyField: some View {
        LegalFormRow(label: T("Counterparty")) { TextField("", text: $counterparty).font(NXFont.text(14)).legalInput() }
    }

    private var versionsCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            LegalSectionHeader(title: T("Versions")) {
                Button { route = .pick(LegalFileTypes.documents, tag: "version") } label: {
                    Label(T("Upload new version"), systemImage: "arrow.up.doc")
                }
                .buttonStyle(NXButtonStyle(kind: .bordered, compact: true))
                .accessibilityHint(T("A signed scan, or the file edited in Word"))
            }
            LegalListCard {
                ForEach(Array(doc.versions.enumerated()), id: \.element.id) { i, v in
                    if i > 0 { Divider().overlay(NX.border) }
                    versionRow(v)
                }
            }
        }
    }

    private func versionRow(_ v: LegalDocVersion) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .top, spacing: 10) {
                Text(verbatim: "v\(v.version)").font(NXFont.text(14, .semibold)).foregroundStyle(NX.foreground).frame(minWidth: 30, alignment: .leading)
                VStack(alignment: .leading, spacing: 2) {
                    HStack(spacing: 6) {
                        Text(LegalLabels.versionKind(v.kind) + (v.note.isEmpty ? "" : " — \(v.note)"))
                            .font(NXFont.text(14)).foregroundStyle(NX.foreground).lineLimit(2)
                        if doc.finalVersion == v.version { NexusChip(text: T("Final"), tone: .accent) }
                    }
                    Text([v.author?.name ?? "—", LegalLabels.date(v.createdAt), LegalLabels.bytes(v.size)].joined(separator: " · "))
                        .font(NXFont.text(12)).foregroundStyle(NX.mutedFg).lineLimit(1)
                }
                Spacer(minLength: 0)
            }
            HStack(spacing: 6) {
                LegalFileButtons(doc: doc, version: v, model: model, route: $route, compact: true)
                Spacer(minLength: 0)
                if doc.finalVersion != v.version {
                    Button {
                        var fields: [String: Any] = ["finalVersion": v.version]
                        if doc.status == "DRAFT" { fields["status"] = "FINAL" }
                        Task { await model.patch(fields) }
                    } label: { Label(T("Mark final"), systemImage: "checkmark.circle") }
                        .buttonStyle(NXButtonStyle(kind: .ghost, compact: true))
                        .accessibilityHint(T("Final DOCX/PDF come from this version"))
                }
                if v.version != doc.currentVersion {
                    Button { Task { await restore(v.version) } } label: {
                        if restoring == v.version { ProgressView() } else { Label(T("Restore"), systemImage: "arrow.counterclockwise") }
                    }
                    .buttonStyle(NXButtonStyle(kind: .ghost, compact: true))
                    .disabled(restoring != nil)
                }
            }
        }
        .padding(.horizontal, 14).padding(.vertical, 11)
    }

    private func restore(_ version: Int) async {
        restoring = version
        defer { restoring = nil }
        do {
            let res = try await APIClient.shared.legalRestore(id: doc.id, version: version, baseVersion: doc.currentVersion)
            LegalToasts.shared.success(String(format: T("Restored as version %d"), res.version))
            await model.load()
        } catch {
            await model.versionRefused(error)
        }
    }
}

/// DOCX / PDF / the original file of one version (download → share sheet), or "Make PDF" when missing.
struct LegalFileButtons: View {
    let doc: LegalDocument
    let version: LegalDocVersion
    let model: LegalDocumentModel
    @Binding var route: LegalFileRoute?
    var compact = false

    @State private var busy: LegalFileFormat?
    @State private var making = false

    var body: some View {
        HStack(spacing: 6) {
            if version.hasDocx { fileButton(.docx, "DOCX", "arrow.down.doc") }
            if version.hasPdf {
                fileButton(.pdf, "PDF", "doc.richtext")
            } else if doc.versionsAwaitingPdf().contains(where: { $0.version == version.version }) {
                // The server is making it in the background; the document screen polls until it lands.
                HStack(spacing: 5) {
                    ProgressView()
                    Text(T("Making the PDF…"))
                }
                .font(NXFont.text(compact ? 13 : 14, .medium)).foregroundStyle(NX.mutedFg)
                .padding(.horizontal, compact ? 10 : 14).frame(minHeight: compact ? 30 : 36)
            } else if version.hasDocx {
                Button { Task { await makePdf() } } label: {
                    HStack(spacing: 5) {
                        if making { ProgressView() } else { Image(systemName: "arrow.clockwise") }
                        Text(T("Make PDF"))
                    }
                }
                .buttonStyle(NXButtonStyle(kind: .ghost, compact: compact))
                .disabled(making)
            }
            if version.hasFile { fileButton(.original, T("File"), "paperclip") }
        }
    }

    private func fileButton(_ format: LegalFileFormat, _ title: String, _ icon: String) -> some View {
        Button { Task { await fetch(format) } } label: {
            HStack(spacing: 5) {
                if busy == format { ProgressView() } else { Image(systemName: icon) }
                Text(title)
            }
        }
        .buttonStyle(NXButtonStyle(kind: .bordered, compact: compact))
        .disabled(busy != nil)
    }

    private func fetch(_ format: LegalFileFormat) async {
        busy = format
        defer { busy = nil }
        do {
            let file = try await APIClient.shared.legalDownloadDocument(id: doc.id, version: version.version, format: format)
            route = .share(file)
        } catch {
            LegalToasts.shared.failure(error)
        }
    }

    private func makePdf() async {
        making = true
        defer { making = false }
        do {
            try await APIClient.shared.legalMakePdf(id: doc.id, version: version.version)
            LegalToasts.shared.success(T("PDF made"))
            await model.load()
        } catch {
            LegalToasts.shared.failure(error)
        }
    }
}
