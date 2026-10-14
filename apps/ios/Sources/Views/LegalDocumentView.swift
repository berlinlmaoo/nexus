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
    @State private var confirmVoid = false
    @State private var addendumOpen = false
    @State private var other: LegalOpenID?

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
        // The number and the title are both in the header below; the bar repeated the number cut to
        // "SPK/CH/PATS-UNIV/YOGYAKARTA/JAN/…" (UI tour run 10, IP-2), so it carries a short word instead.
        // The document's title once it is in (I-25 / M-22: a generic "Document"); the number stays in the header.
        .navigationTitle(model.doc.map { $0.title.isEmpty ? T("Document") : $0.title } ?? T("Document"))
        .navigationBarTitleDisplayMode(.inline)
        .task { await model.load() }
        // PDFs are made in the background after generate / save / upload / approve: while a recent Word
        // version has none yet, ask again every 4 s, for at most 3 minutes after it was made.
        .task(id: pdfPollKey) { await pollForPdf() }
        .legalFileSheet($route) { tag, url in Task { await uploadVersion(url, signed: tag == "signed") } }
        // Owner, 9 Oct: confirmations are centred alerts, never a confirmationDialog.
        .alert(voidTitle, isPresented: $confirmVoid) {
            Button(T("Cancel"), role: .cancel) {}
            Button(T("Void document"), role: .destructive) { Task { await model.patch(["status": "VOID"]) } }
        } message: {
            Text(voidMessage)
        }
        .sheet(isPresented: $addendumOpen) {
            if let doc = model.doc {
                LegalNewDocumentSheet(parent: LegalNewDocumentSheet.Parent(id: doc.id, number: doc.number, title: doc.title)) { id in
                    Task { await model.load() }
                    other = LegalOpenID(id: id)
                }
            }
        }
        .navigationDestination(item: $other) { o in LegalDocumentView(documentId: o.id) }
        .onChange(of: model.doc?.status) { _, s in if (s == "SIGNED" || s == "VOID") && pane == .edit { pane = .overview } }
        .legalToasts()
    }

    private var voidTitle: String {
        String(format: T("Void %@?"), model.doc.map { $0.number.isEmpty ? $0.title : $0.number } ?? "")
    }

    /// Says what happens to the number (owner, 14 Oct 2026: VOID frees an unsigned document's number).
    private var voidMessage: String {
        guard let doc = model.doc else { return "" }
        if doc.voidReleasesNumber { return String(format: T("Void can't be undone. The number %@ will be reused by the next document of this series."), doc.number) }
        if doc.signedAt != nil { return T("Void can't be undone. This document was signed, so its number stays retired and is never reused.") }
        return T("Void can't be undone.")
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
            VStack(alignment: .leading, spacing: hSize == .regular ? 14 : 18) {
                header(doc)
                if hSize == .regular {
                    // The status sits in the header's number row on an iPad / Mac; only the actions remain.
                    HStack(spacing: 8) { docActions(doc); Spacer(minLength: 0) }
                } else {
                    statusRow(doc)
                }
                LegalDocumentFacts(doc: doc) { other = LegalOpenID(id: $0) }
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

    /// iPhone: the number, the title in full (the bar cuts it) and what it is. iPad / Mac: the bar shows the
    /// whole title, so the header is one compact block, the number with its status beside it and the line
    /// below; the title is not repeated and the preview gets the window (run 14, P-I21 / P-M17 / P-M24).
    @ViewBuilder private func header(_ doc: LegalDocument) -> some View {
        let number = Text(doc.number.isEmpty ? T("No number") : doc.number)
            .font(.system(size: 13, design: .monospaced)).foregroundStyle(NX.mutedFg)
            .strikethrough(doc.numberReleased)
        if hSize == .regular {
            VStack(alignment: .leading, spacing: 6) {
                HStack(alignment: .center, spacing: 10) {
                    number.textSelection(.enabled).lineLimit(1).minimumScaleFactor(0.7)
                    statusControls(doc)
                    Spacer(minLength: 0)
                }
                Text(headerLine(doc)).font(NXFont.text(13)).foregroundStyle(NX.mutedFg).fixedSize(horizontal: false, vertical: true)
            }
        } else {
            VStack(alignment: .leading, spacing: 5) {
                number.textSelection(.enabled)
                Text(LegalText.wrappable(doc.title)).font(NXFont.text(21, .semibold)).foregroundStyle(NX.foreground)
                    .fixedSize(horizontal: false, vertical: true)
                Text(headerLine(doc)).font(NXFont.text(13)).foregroundStyle(NX.mutedFg).fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    private func headerLine(_ doc: LegalDocument) -> String {
        var parts = [LegalLabels.docType(doc.docType), doc.company?.name ?? "—", LegalLabels.day(doc.docDate)]
        if let t = doc.template { parts.append(String(format: T("from %@ v%d"), t.name, t.version)) }
        return parts.joined(separator: " · ")
    }

    private func statusRow(_ doc: LegalDocument) -> some View {
        ViewThatFits(in: .horizontal) {
            HStack(spacing: 10) { statusControls(doc); docActions(doc); Spacer(minLength: 0) }
            VStack(alignment: .leading, spacing: 10) {
                HStack(spacing: 10) { statusControls(doc); Spacer(minLength: 0) }
                HStack(spacing: 8) { docActions(doc); Spacer(minLength: 0) }
            }
        }
    }

    /// Upload signed copy (FINAL / SENT) and Create addendum (SIGNED).
    @ViewBuilder private func docActions(_ doc: LegalDocument) -> some View {
        if doc.canUploadSignedCopy {
            Button { route = .pick(LegalFileTypes.signedCopy, tag: "signed") } label: {
                Label(T("Upload signed copy"), systemImage: "signature")
            }
            .buttonStyle(NXButtonStyle(kind: .bordered, compact: true))
            .accessibilityHint(T("A PDF or a photo of the signed document"))
        }
        if doc.status == "SIGNED" {
            Button { addendumOpen = true } label: { Label(T("Create addendum"), systemImage: "doc.badge.plus") }
                .buttonStyle(NXButtonStyle(kind: .bordered, compact: true))
        }
    }

    /// One control (web, UI tour run 10): the current status, tinted as its chip, opens the status menu.
    /// A void document has nowhere to go, so it shows the chip alone.
    @ViewBuilder private func statusControls(_ doc: LegalDocument) -> some View {
        if doc.status == "VOID" {
            LegalStatusChip(status: doc.status)
        } else {
            Menu {
                ForEach(doc.statusChoices, id: \.self) { s in
                    Button {
                        guard s != doc.status else { return }
                        if s == "VOID" { confirmVoid = true } else { Task { await model.patch(["status": s]) } }
                    } label: {
                        if s == doc.status { Label(LegalLabels.status(s), systemImage: "checkmark") } else { Text(LegalLabels.status(s)) }
                    }
                }
            } label: {
                let tone = LegalLabels.statusTone(doc.status)
                HStack(spacing: 5) {
                    Text(LegalLabels.status(doc.status)).font(NXFont.text(13, .semibold))
                    Image(systemName: "chevron.up.chevron.down").font(.system(size: 9, weight: .semibold))
                }
                .foregroundStyle(tone.fg)
                .padding(.horizontal, 12).frame(minHeight: 30)
                .background(tone.bg, in: Capsule())
                .contentShape(Capsule())
                .fixedSize()
            }
            .menuIndicator(.hidden)
            .accessibilityLabel(T("Status"))
            .accessibilityValue(LegalLabels.status(doc.status))
        }
    }

    @ViewBuilder private func panePicker(_ doc: LegalDocument) -> some View {
        let hasWord = doc.versions.contains(where: \.hasDocx) && !doc.isLocked && doc.status != "VOID"
        let canCompare = doc.wordVersions.count >= 2
        if hasWord {
            Picker(T("Document view"), selection: $pane) {
                Text(T("Overview")).tag(Pane.overview)
                Text(T("Review & edit")).tag(Pane.edit)
                if canCompare { Text(T("Compare")).tag(Pane.compare) }
            }
            // The page's full width, as the web's tab row (P-I21 / P-M17: it stopped at ⅓–⅔ of the width).
            .pickerStyle(.segmented)
            .frame(maxWidth: .infinity)
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

    /// `signed`: the signed copy of a final document — it becomes SIGNED and locked.
    private func uploadVersion(_ file: URL, signed: Bool) async {
        guard let doc = model.doc else { return }
        do {
            let res = try await APIClient.shared.legalUploadVersion(id: doc.id, baseVersion: doc.currentVersion, file: file, note: "",
                                                                    status: signed ? "SIGNED" : nil)
            LegalToasts.shared.success(signed ? T("Signed copy uploaded. The document is now signed and locked.")
                                              : String(format: T("Uploaded as version %d"), res.version))
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
        // On an iPad / Mac the preview takes most of the window once it is scrolled to (P-M24: a fixed
        // 620 pt left it in the bottom part of the window).
        .modifier(LegalPreviewHeight(wide: wide))
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

    /// Grows onto more lines, so a long title is read in full (P-I21: "…City_Head_PATS_Un…").
    private var titleField: some View {
        LegalFormRow(label: T("Title")) {
            TextField("", text: $title, axis: .vertical).lineLimit(1...4).font(NXFont.text(14)).legalInput()
        }
    }

    private var counterpartyField: some View {
        LegalFormRow(label: T("Counterparty")) { TextField("", text: $counterparty).font(NXFont.text(14)).legalInput() }
    }

    private var versionsCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            LegalSectionHeader(title: T("Versions")) {
                if doc.isLocked {
                    Label(T("Signed: locked"), systemImage: "lock").font(NXFont.text(12)).foregroundStyle(NX.mutedFg)
                } else if doc.status != "VOID" {
                    Button { route = .pick(LegalFileTypes.documents, tag: "version") } label: {
                        Label(T("Upload new version"), systemImage: "arrow.up.doc")
                    }
                    .buttonStyle(NXButtonStyle(kind: .bordered, compact: true))
                    .accessibilityHint(T("The file edited in Word, or a scan"))
                }
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
                        if doc.signedVersion == v.version { NexusChip(text: T("Signed copy"), tone: .success) }
                        if doc.finalVersion == v.version { NexusChip(text: T("Final"), tone: .accent) }
                    }
                    // "REV 1" says what "v1" beside it already says; only FINAL / SIGNED add something (N-39).
                    Text(([v.label == "REV \(v.version)" ? nil : v.label, v.author?.name ?? "—", LegalLabels.date(v.createdAt), LegalLabels.bytes(v.size)] as [String?])
                            .compactMap { $0 }.joined(separator: " · "))
                        .font(NXFont.text(12)).foregroundStyle(NX.mutedFg).lineLimit(1)
                }
                Spacer(minLength: 0)
            }
            HStack(spacing: 6) {
                LegalFileButtons(doc: doc, version: v, model: model, route: $route, compact: true)
                Spacer(minLength: 0)
                if doc.finalVersion != v.version && !doc.isLocked && doc.status != "VOID" {
                    Button {
                        var fields: [String: Any] = ["finalVersion": v.version]
                        if doc.status == "DRAFT" { fields["status"] = "FINAL" }
                        Task { await model.patch(fields) }
                    } label: { Label(T("Mark final"), systemImage: "checkmark.circle") }
                        .buttonStyle(NXButtonStyle(kind: .ghost, compact: true))
                        .accessibilityHint(T("Final DOCX/PDF come from this version"))
                }
                if v.version != doc.currentVersion && !doc.isLocked && doc.status != "VOID" {
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
            } else if version.hasDocx && !doc.isLocked {
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
            let file = try await APIClient.shared.legalDownloadDocument(id: doc.id, version: version.version, format: format,
                                                                        name: version.shareName(format.rawValue))
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

// MARK: - Signed, void, parent and addenda

/// Who uploaded the signed copy and when, what became of a void number, the parent of an addendum and the
/// addenda of a document (web DocumentFacts).
/// The PDF preview's height: 460 pt on a phone; on an iPad / Mac most of the visible window.
private struct LegalPreviewHeight: ViewModifier {
    let wide: Bool
    func body(content: Content) -> some View {
        if wide {
            content.containerRelativeFrame(.vertical) { h, _ in max(480, h * 0.86) }
        } else {
            content.frame(height: 460)
        }
    }
}

private struct LegalDocumentFacts: View {
    let doc: LegalDocument
    let open: (String) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if let at = doc.signedAt {
                Label(String(format: T("Signed copy uploaded %@ by %@"), LegalLabels.date(at), doc.signedBy?.name ?? "—"), systemImage: "signature")
                    .foregroundStyle(ChipTone.success.fg)
            }
            if doc.status == "VOID" {
                if let by = doc.numberReusedBy {
                    linkRow(T("Void — number reused by"), by)
                } else {
                    Text(doc.numberReleased ? T("Void — the number is free for the next document of this series")
                         : doc.signedAt != nil ? T("Void — signed, so the number is never reused") : T("Void"))
                }
            }
            ForEach(doc.numberReusedFrom) { from in linkRow(T("Number reused from void document"), from) }
            if let parent = doc.parent {
                linkRow(String(format: T("Addendum %d to"), doc.addendumNo ?? 0), parent)
            }
            if !doc.addenda.isEmpty { addendaList }
        }
        .font(NXFont.text(13)).foregroundStyle(NX.mutedFg)
    }

    private func linkRow(_ text: String, _ ref: LegalDocRef) -> some View {
        Button { open(ref.id) } label: {
            // The number stays on one line, cut in the middle, never broken part-way (UI tour run 11, IP-12 / PD-13).
            HStack(spacing: 4) {
                Text(text).lineLimit(1).layoutPriority(1)
                Text(ref.number.isEmpty ? ref.title : ref.number).font(.system(size: 13, design: .monospaced)).foregroundStyle(NX.violetText)
                    .lineLimit(1).truncationMode(.middle)
            }
            .help(ref.number.isEmpty ? ref.title : ref.number)
        }
        .buttonStyle(.plain)
    }

    private var addendaList: some View {
        VStack(alignment: .leading, spacing: 6) {
            Label(T("Addenda"), systemImage: "arrow.triangle.branch").font(NXFont.text(13, .semibold)).foregroundStyle(NX.foreground)
            LegalListCard {
                ForEach(Array(doc.addenda.enumerated()), id: \.element.id) { i, a in
                    if i > 0 { Divider().overlay(NX.border) }
                    Button { open(a.id) } label: {
                        HStack(spacing: 8) {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(a.number).font(.system(size: 12, design: .monospaced)).foregroundStyle(NX.foreground)
                                    .strikethrough(a.numberReleased).lineLimit(1)
                                Text([a.title, LegalLabels.shortDay(a.docDate)].joined(separator: " · ")).font(NXFont.text(12)).foregroundStyle(NX.mutedFg).lineLimit(1)
                            }
                            Spacer(minLength: 4)
                            LegalStatusChip(status: a.status ?? "DRAFT")
                        }
                        .padding(.horizontal, 12).padding(.vertical, 9)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }
}
